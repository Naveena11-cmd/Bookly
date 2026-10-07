import express from 'express';
import rateLimit from 'express-rate-limit';
import Stripe from 'stripe';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import { admin, asUser } from './_lib/supabase.js';
import { slotsFor } from './_lib/slots.js';
import { notify } from './_lib/notify.js';
import { canTransition, hasAccess } from './_lib/access.js';

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
// No CORS headers on purpose: the SPA and API share one origin on Vercel.
app.use((req, res, next) => { req.id = randomUUID(); res.setHeader('x-request-id', req.id); next(); });
app.use('/api/billing/webhook', express.raw({ type: '*/*' })); // raw body needed for signature check
app.use(express.json({ limit: '50kb' }));

// ---------- helpers ----------
class HttpError extends Error { constructor(status, code, message) { super(message || code); this.status = status; this.code = code; } }
const ok = (res, data, status = 200) => res.status(status).json({ data });
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const must = ({ data, error }) => { if (error) throw error; return data; };
const log = (req, msg, extra = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), req: req.id, msg, ...extra }));
const id = z.string().uuid();
const clean = (s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
const text = (max) => z.string().max(max).transform(clean);
const tzSchema = z.string().refine((t) => DateTime.now().setZone(t).isValid, 'invalid timezone');
const slugSchema = z.string().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'slug: 3-40 chars, a-z 0-9 and -');
const router = express.Router();

const publicLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
const bookLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

// ---------- auth + tenancy ----------
// business_id is ALWAYS derived from the verified identity, never from the request.
async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in required');
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) throw new HttpError(401, 'unauthenticated', 'Invalid session');
    req.user = data.user;
    req.db = asUser(token); // queries run under the user's RLS
    const m = must(await req.db.from('business_members').select('business_id,role').limit(1).maybeSingle());
    req.businessId = m?.business_id || null;
    next();
  } catch (e) { next(e); }
}
const tenant = (req, res, next) => (req.businessId ? next() : next(new HttpError(403, 'no_business', 'Create a business first')));
async function premium(req, res, next) {
  try {
    const sub = must(await req.db.from('subscriptions').select('status,current_period_end').eq('business_id', req.businessId).maybeSingle());
    if (!hasAccess(sub)) throw new HttpError(402, 'subscription_required', 'An active subscription is required');
    next();
  } catch (e) { next(e); }
}
const priv = [auth, tenant];
const getBusiness = async (req) => must(await req.db.from('businesses').select('*').eq('id', req.businessId).single());

// ---------- public ----------
async function loadPublic(slug) {
  const b = must(await admin.from('businesses').select('id,name,slug,timezone,phone,email')
    .eq('slug', String(slug).toLowerCase()).eq('status', 'active').maybeSingle());
  if (!b) throw new HttpError(404, 'not_found', 'Business not found');
  return b;
}
router.get('/public/businesses/:slug', publicLimiter, h(async (req, res) => {
  const { id: _omit, ...pub } = await loadPublic(req.params.slug);
  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  ok(res, pub);
}));
router.get('/public/businesses/:slug/services', publicLimiter, h(async (req, res) => {
  const b = await loadPublic(req.params.slug);
  const [services, providers] = await Promise.all([
    admin.from('services').select('id,name,description,duration_minutes,price_cents').eq('business_id', b.id).eq('active', true).order('name'),
    admin.from('providers').select('id,name').eq('business_id', b.id).eq('active', true).order('name')
  ]).then((r) => r.map(must));
  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  ok(res, { services, providers });
}));
const availQuery = z.object({ service_id: id, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), provider_id: id.optional() });
router.get('/public/businesses/:slug/availability', publicLimiter, h(async (req, res) => {
  const q = availQuery.parse(req.query);
  const b = await loadPublic(req.params.slug);
  const d = DateTime.fromISO(q.date, { zone: b.timezone });
  const today = DateTime.now().setZone(b.timezone).startOf('day');
  if (!d.isValid || d < today || d > today.plus({ days: 120 })) throw new HttpError(400, 'bad_date', 'Date out of range');
  const service = must(await admin.from('services').select('id,duration_minutes').eq('id', q.service_id).eq('business_id', b.id).eq('active', true).maybeSingle());
  if (!service) throw new HttpError(404, 'not_found', 'Service not found');
  const slots = await slotsFor(admin, { business: b, service, date: q.date, providerId: q.provider_id });
  res.setHeader('Cache-Control', 'no-store');
  ok(res, { timezone: b.timezone, slots: slots.map((s) => ({ start: s.start })) });
}));
const bookingBody = z.object({
  service_id: id, provider_id: id.optional(), starts_at: z.string().datetime(),
  name: text(100).pipe(z.string().min(1)), email: z.string().email().max(200).optional().or(z.literal('')),
  phone: z.string().regex(/^[0-9+()\-\s]{6,25}$/).optional().or(z.literal('')),
  notes: text(500).optional()
}).refine((b) => b.email || b.phone, { message: 'email or phone is required' });
router.post('/public/businesses/:slug/bookings', bookLimiter, h(async (req, res) => {
  const b = bookingBody.parse(req.body);
  const biz = await loadPublic(req.params.slug);
  const service = must(await admin.from('services').select('id,name,duration_minutes,price_cents').eq('id', b.service_id).eq('business_id', biz.id).eq('active', true).maybeSingle());
  if (!service) throw new HttpError(404, 'not_found', 'Service not found');
  // 1) server-side re-validation of availability
  const date = DateTime.fromISO(b.starts_at).setZone(biz.timezone).toISODate();
  const hit = (await slotsFor(admin, { business: biz, service, date, providerId: b.provider_id }))
    .find((s) => +new Date(s.start) === +new Date(b.starts_at));
  if (!hit) throw new HttpError(409, 'slot_unavailable', 'That time is no longer available');
  // 2) atomic insert; the exclusion constraint is the final guard against races
  const bookingId = must(await admin.rpc('create_booking', {
    p_business: biz.id, p_service: service.id, p_provider: hit.provider_id, p_start: hit.start,
    p_name: b.name, p_email: b.email || null, p_phone: b.phone || null, p_notes: b.notes || null
  }));
  log(req, 'booking.created', { booking: bookingId, business: biz.id });
  const when = DateTime.fromISO(hit.start).setZone(biz.timezone).toFormat("ccc d LLL yyyy, h:mm a ZZZZ");
  if (b.email) await notify({ businessId: biz.id, bookingId, to: b.email, template: 'confirmation', data: { name: b.name, service: service.name, business: biz.name, when } });
  ok(res, { booking: { id: bookingId, starts_at: hit.start, service: service.name, price_cents: service.price_cents, business: biz.name, timezone: biz.timezone } }, 201);
}));

// ---------- onboarding / me ----------
router.post('/onboarding', auth, h(async (req, res) => {
  const b = z.object({ name: text(120).pipe(z.string().min(1)), slug: slugSchema, timezone: tzSchema }).parse(req.body);
  must(await req.db.rpc('create_business', { p_name: b.name, p_slug: b.slug, p_timezone: b.timezone }));
  ok(res, { created: true }, 201);
}));
router.get('/me', auth, h(async (req, res) => {
  let business = null, subscription = null;
  if (req.businessId) {
    business = await getBusiness(req);
    subscription = must(await req.db.from('subscriptions').select('status,current_period_end').eq('business_id', req.businessId).maybeSingle());
  }
  ok(res, { user: { id: req.user.id, email: req.user.email }, business, subscription, access: hasAccess(subscription),
    billing: { stripe: !!stripe, simulate: process.env.BILLING_MODE === 'simulate' } });
}));
router.patch('/business', priv, h(async (req, res) => {
  const b = z.object({ name: text(120).pipe(z.string().min(1)), slug: slugSchema, timezone: tzSchema, phone: text(30).nullish(), email: z.string().email().nullish().or(z.literal('')) }).partial().parse(req.body);
  ok(res, must(await req.db.from('businesses').update(b).eq('id', req.businessId).select().single()));
}));

// ---------- bookings ----------
const range = z.object({ from: z.string().datetime(), to: z.string().datetime(), page: z.coerce.number().int().min(1).default(1) });
const PAGE = 100;
router.get('/bookings', priv, h(async (req, res) => {
  const q = range.parse(req.query);
  const { data, error, count } = await req.db.from('bookings')
    .select('id,service_id,starts_at,ends_at,status,price_cents,service:services(name,duration_minutes),provider:providers(id,name),client:clients(id,name,email,phone)', { count: 'exact' })
    .eq('business_id', req.businessId).gte('starts_at', q.from).lt('starts_at', q.to)
    .order('starts_at').range((q.page - 1) * PAGE, q.page * PAGE - 1);
  if (error) throw error;
  ok(res, { items: data, total: count, page: q.page, page_size: PAGE });
}));
async function loadBooking(req) {
  const b = must(await req.db.from('bookings')
    .select('id,service_id,provider_id,starts_at,ends_at,status,price_cents,notes,source,service:services(name,duration_minutes),provider:providers(name),client:clients(id,name,email,phone)')
    .eq('id', id.parse(req.params.id)).eq('business_id', req.businessId).maybeSingle());
  if (!b) throw new HttpError(404, 'not_found', 'Booking not found');
  return b;
}
const event = (req, bookingId, type, metadata) =>
  req.db.from('booking_events').insert({ business_id: req.businessId, booking_id: bookingId, event_type: type, actor_id: req.user.id, metadata });
router.get('/bookings/:id', priv, h(async (req, res) => {
  const booking = await loadBooking(req);
  const events = must(await req.db.from('booking_events').select('event_type,metadata,created_at').eq('booking_id', booking.id).order('created_at'));
  ok(res, { ...booking, events });
}));
router.patch('/bookings/:id', priv, h(async (req, res) => {
  const { status } = z.object({ status: z.enum(['confirmed', 'cancelled', 'completed', 'no_show']) }).parse(req.body);
  const b = await loadBooking(req);
  if (!canTransition(b.status, status)) throw new HttpError(409, 'bad_transition', `Cannot go from ${b.status} to ${status}`);
  const upd = must(await req.db.from('bookings').update({ status }).eq('id', b.id).eq('business_id', req.businessId).select('id,status').single());
  await event(req, b.id, `status_${status}`, { from: b.status });
  log(req, 'booking.status', { booking: b.id, from: b.status, to: status });
  ok(res, upd);
}));
router.post('/bookings/:id/reschedule', priv, h(async (req, res) => {
  const { starts_at } = z.object({ starts_at: z.string().datetime() }).parse(req.body);
  const b = await loadBooking(req);
  if (!['pending', 'confirmed'].includes(b.status)) throw new HttpError(409, 'bad_transition', 'Only active bookings can be rescheduled');
  const biz = await getBusiness(req);
  const date = DateTime.fromISO(starts_at).setZone(biz.timezone).toISODate();
  const slots = await slotsFor(req.db, { business: biz, service: { id: b.service_id, duration_minutes: b.service.duration_minutes }, date, providerId: b.provider_id, excludeBookingId: b.id });
  if (!slots.some((s) => +new Date(s.start) === +new Date(starts_at))) throw new HttpError(409, 'slot_unavailable', 'That time is not available');
  const ends = new Date(+new Date(starts_at) + b.service.duration_minutes * 60000).toISOString();
  const upd = must(await req.db.from('bookings').update({ starts_at, ends_at: ends }).eq('id', b.id).eq('business_id', req.businessId).select('id,starts_at,ends_at').single());
  await event(req, b.id, 'rescheduled', { from: b.starts_at, to: starts_at }); // old time is freed automatically (same row)
  log(req, 'booking.rescheduled', { booking: b.id });
  ok(res, upd);
}));

// ---------- services / providers / schedule ----------
const serviceBody = z.object({ name: text(120).pipe(z.string().min(1)), description: text(500).nullish(),
  duration_minutes: z.number().int().min(5).max(480), price_cents: z.number().int().min(0).max(10_000_000), active: z.boolean() });
router.get('/services', priv, h(async (req, res) => ok(res, must(await req.db.from('services').select('*').eq('business_id', req.businessId).order('name')))));
router.post('/services', priv, h(async (req, res) => {
  const b = serviceBody.partial({ active: true, description: true }).parse(req.body);
  ok(res, must(await req.db.from('services').insert({ ...b, business_id: req.businessId }).select().single()), 201);
}));
router.patch('/services/:id', priv, h(async (req, res) => {
  const b = serviceBody.partial().parse(req.body);
  ok(res, must(await req.db.from('services').update(b).eq('id', id.parse(req.params.id)).eq('business_id', req.businessId).select().single()));
}));
router.get('/providers', priv, h(async (req, res) => ok(res, must(await req.db.from('providers').select('*').eq('business_id', req.businessId).order('name')))));
router.post('/providers', priv, h(async (req, res) => {
  const b = z.object({ name: text(100).pipe(z.string().min(1)) }).parse(req.body);
  ok(res, must(await req.db.from('providers').insert({ ...b, business_id: req.businessId }).select().single()), 201);
}));
const hoursBody = z.object({ hours: z.array(z.object({ day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}/), end_time: z.string().regex(/^\d{2}:\d{2}/), enabled: z.boolean() })).max(7) });
router.get('/schedule', priv, h(async (req, res) => {
  const [hours, blocked, providers] = await Promise.all([
    req.db.from('business_hours').select('*').eq('business_id', req.businessId).order('day_of_week'),
    req.db.from('blocked_periods').select('*').eq('business_id', req.businessId).gte('ends_at', new Date().toISOString()).order('starts_at'),
    req.db.from('providers').select('*').eq('business_id', req.businessId)
  ]).then((r) => r.map(must));
  ok(res, { hours, blocked, providers });
}));
router.put('/schedule/hours', priv, h(async (req, res) => {
  const { hours } = hoursBody.parse(req.body);
  ok(res, must(await req.db.from('business_hours').upsert(hours.map((x) => ({ ...x, business_id: req.businessId })), { onConflict: 'business_id,day_of_week' }).select()));
}));
router.put('/schedule/providers/:pid/hours', priv, h(async (req, res) => {
  const { hours } = hoursBody.parse(req.body);
  const pid = id.parse(req.params.pid); // RLS rejects providers of other tenants
  ok(res, must(await req.db.from('provider_hours').upsert(hours.map((x) => ({ ...x, provider_id: pid })), { onConflict: 'provider_id,day_of_week' }).select()));
}));
router.post('/schedule/blocked', priv, h(async (req, res) => {
  const b = z.object({ provider_id: id.nullish(), starts_at: z.string().datetime(), ends_at: z.string().datetime(), reason: text(200).nullish() })
    .refine((x) => x.ends_at > x.starts_at, 'ends_at must be after starts_at').parse(req.body);
  ok(res, must(await req.db.from('blocked_periods').insert({ ...b, business_id: req.businessId }).select().single()), 201);
}));
router.delete('/schedule/blocked/:id', priv, h(async (req, res) => {
  must(await req.db.from('blocked_periods').delete().eq('id', id.parse(req.params.id)).eq('business_id', req.businessId));
  ok(res, { deleted: true });
}));

// ---------- CRM + dashboard (premium) ----------
router.get('/clients', priv, premium, h(async (req, res) => {
  const page = z.coerce.number().int().min(1).default(1).parse(req.query.page);
  const qs = String(req.query.q || '').replace(/[^\w@.+\- ]/g, '').slice(0, 60); // safe inside PostgREST or()
  let q = req.db.from('client_stats').select('*', { count: 'exact' }).eq('business_id', req.businessId);
  if (qs) q = q.or(`name.ilike.%${qs}%,email.ilike.%${qs}%,phone.ilike.%${qs}%`);
  const { data, error, count } = await q.order('name').range((page - 1) * 50, page * 50 - 1);
  if (error) throw error;
  ok(res, { items: data, total: count, page });
}));
router.get('/clients/:id', priv, premium, h(async (req, res) => {
  const cid = id.parse(req.params.id);
  const client = must(await req.db.from('client_stats').select('*').eq('id', cid).eq('business_id', req.businessId).maybeSingle());
  if (!client) throw new HttpError(404, 'not_found', 'Client not found');
  const bookings = must(await req.db.from('bookings').select('id,starts_at,status,price_cents,service:services(name)').eq('client_id', cid).eq('business_id', req.businessId).order('starts_at', { ascending: false }).limit(100));
  ok(res, { ...client, bookings });
}));
router.patch('/clients/:id', priv, premium, h(async (req, res) => {
  const b = z.object({ name: text(100).pipe(z.string().min(1)), email: z.string().email().toLowerCase().nullish(), phone: z.string().regex(/^[0-9+()\-\s]{6,25}$/).nullish().transform((p) => (p ? p.replace(/[^0-9+]/g, '') : p)), notes: text(2000).nullish() }).partial().parse(req.body);
  ok(res, must(await req.db.from('clients').update(b).eq('id', id.parse(req.params.id)).eq('business_id', req.businessId).select().single()));
}));
router.get('/dashboard/summary', priv, premium, h(async (req, res) => {
  const biz = await getBusiness(req);
  const s = DateTime.now().setZone(biz.timezone).startOf('day');
  ok(res, must(await req.db.rpc('dashboard_summary', { p_business: req.businessId, p_day_start: s.toUTC().toISO(), p_day_end: s.plus({ days: 1 }).toUTC().toISO() })));
}));

// ---------- billing ----------
router.post('/billing/checkout', priv, h(async (req, res) => {
  if (!stripe) throw new HttpError(501, 'billing_disabled', 'Stripe not configured (use BILLING_MODE=simulate)');
  const sub = must(await admin.from('subscriptions').select('provider_customer_id').eq('business_id', req.businessId).single());
  let customer = sub.provider_customer_id;
  if (!customer) {
    customer = (await stripe.customers.create({ email: req.user.email, metadata: { business_id: req.businessId } })).id;
    await admin.from('subscriptions').update({ provider_customer_id: customer }).eq('business_id', req.businessId);
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription', customer, client_reference_id: req.businessId,
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    subscription_data: { metadata: { business_id: req.businessId } },
    success_url: `${process.env.APP_URL}/dashboard/billing?ok=1`, cancel_url: `${process.env.APP_URL}/dashboard/billing`
  });
  ok(res, { url: session.url });
}));
// Simulation (BILLING_MODE=simulate only): the server decides the resulting state from a fixed action.
router.post('/billing/simulate', priv, h(async (req, res) => {
  if (process.env.BILLING_MODE !== 'simulate') throw new HttpError(404, 'not_found', 'Not found');
  const { action } = z.object({ action: z.enum(['subscribe', 'cancel', 'lapse']) }).parse(req.body);
  const end = action === 'subscribe' ? new Date(Date.now() + 30 * 864e5) : new Date(Date.now() - (action === 'lapse' ? 1 : 0) * 864e5);
  const status = { subscribe: 'active', cancel: 'cancelled', lapse: 'cancelled' }[action];
  ok(res, must(await admin.from('subscriptions').update({ status, current_period_end: end.toISOString() }).eq('business_id', req.businessId).select('status,current_period_end').single()));
}));
const STRIPE_STATUS = { active: 'active', trialing: 'trialing', past_due: 'past_due', unpaid: 'past_due', canceled: 'cancelled', incomplete: 'incomplete', incomplete_expired: 'incomplete' };
router.post('/billing/webhook', h(async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) throw new HttpError(501, 'billing_disabled', 'Billing disabled');
  let ev;
  try { ev = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'] || '', process.env.STRIPE_WEBHOOK_SECRET); }
  catch { throw new HttpError(400, 'bad_signature', 'Invalid signature'); }
  const seen = must(await admin.from('processed_webhook_events').select('id').eq('id', ev.id).maybeSingle());
  if (seen) return ok(res, { duplicate: true }); // replay protection
  const o = ev.data.object;
  if (ev.type === 'checkout.session.completed' && o.mode === 'subscription') {
    await admin.from('subscriptions').update({ provider_customer_id: o.customer, provider_subscription_id: o.subscription }).eq('business_id', o.client_reference_id);
  } else if (ev.type.startsWith('customer.subscription.')) {
    const end = o.current_period_end || o.items?.data?.[0]?.current_period_end;
    const upd = { status: STRIPE_STATUS[o.status] || 'incomplete', provider_subscription_id: o.id, current_period_end: end ? new Date(end * 1000).toISOString() : null };
    const q = admin.from('subscriptions').update(upd);
    await (o.metadata?.business_id ? q.eq('business_id', o.metadata.business_id) : q.eq('provider_customer_id', o.customer));
  }
  await admin.from('processed_webhook_events').insert({ id: ev.id, type: ev.type });
  log(req, 'stripe.webhook', { type: ev.type, event: ev.id });
  ok(res, { received: true });
}));

// ---------- cron: 24h reminders (idempotent) ----------
const MAX_ATTEMPTS = 3;
router.get('/cron/reminders', h(async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) throw new HttpError(401, 'unauthorized', 'Unauthorized');
  const now = new Date(), horizon = new Date(+now + 24 * 3600e3).toISOString();
  const due = must(await admin.from('bookings').select('id,business_id').in('status', ['pending', 'confirmed']).gt('starts_at', now.toISOString()).lte('starts_at', horizon).limit(500));
  // Claim: unique(booking_id, channel) means a booking is inserted at most once, even if the job runs twice.
  if (due.length) await admin.from('reminders').upsert(due.map((b) => ({ booking_id: b.id, business_id: b.business_id, channel: 'email' })), { onConflict: 'booking_id,channel', ignoreDuplicates: true });
  const todo = must(await admin.from('reminders').select('id,attempts,business_id,booking_id,booking:bookings!inner(starts_at,status,client:clients(name,email),service:services(name),business:businesses(name,timezone))')
    .in('status', ['pending', 'failed']).lt('attempts', MAX_ATTEMPTS).gt('booking.starts_at', now.toISOString()).in('booking.status', ['pending', 'confirmed']).limit(200));
  let sent = 0, failed = 0, skipped = 0;
  for (const r of todo) {
    // optimistic lock so two concurrent runs never send the same reminder
    const lock = must(await admin.from('reminders').update({ status: 'sending', attempts: r.attempts + 1 }).eq('id', r.id).eq('attempts', r.attempts).in('status', ['pending', 'failed']).select('id'));
    if (!lock.length) { skipped++; continue; }
    const b = r.booking;
    if (!b.client.email) { await admin.from('reminders').update({ status: 'failed', attempts: MAX_ATTEMPTS, last_error: 'no_email' }).eq('id', r.id); skipped++; continue; }
    const when = DateTime.fromISO(b.starts_at).setZone(b.business.timezone).toFormat("ccc d LLL, h:mm a ZZZZ");
    const result = await notify({ businessId: r.business_id, bookingId: r.booking_id, to: b.client.email, template: 'reminder', data: { name: b.client.name, service: b.service.name, business: b.business.name, when } });
    await admin.from('reminders').update(result.ok ? { status: 'sent', sent_at: new Date().toISOString(), last_error: null } : { status: 'failed', last_error: result.error }).eq('id', r.id);
    result.ok ? sent++ : failed++;
  }
  log(req, 'cron.reminders', { sent, failed, skipped });
  ok(res, { sent, failed, skipped });
}));

app.use('/api', router);
app.use('/api', (req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Not found', request_id: req.id } }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  let status = err.status || 500, code = err.code || 'internal', message = err.message;
  if (err instanceof z.ZodError) { status = 400; code = 'validation'; message = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '); }
  else if (!err.status) {
    if (/slot_taken/.test(err.message || '') || err.code === '23P01') { status = 409; code = 'slot_taken'; message = 'That time was just taken'; }
    else if (err.code === '23505') { status = 409; code = 'conflict'; message = 'Already exists'; }
    else if (err.code === '42501') { status = 403; code = 'forbidden'; message = 'Forbidden'; }
    else if (err.code === 'P0001') { status = 400; code = 'rejected'; message = err.message; }
    else { status = 500; code = 'internal'; message = 'Internal error'; }
  }
  if (status >= 500) console.error(JSON.stringify({ req: req.id, err: err.message }));
  res.status(status).json({ error: { code, message, request_id: req.id } });
});

export default app;
