// Cross-tenant isolation test against a real Supabase project. Usage: npm run test:rls
import { createClient } from '@supabase/supabase-js';
const url = process.env.VITE_SUPABASE_URL, anon = process.env.VITE_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const mk = () => createClient(url, anon, { auth: { persistSession: false } });
const tag = Math.random().toString(36).slice(2, 8);
let fails = 0; const check = (name, cond) => { console.log(cond ? 'PASS' : 'FAIL', name); if (!cond) fails++; };

async function tenant(n) {
  const email = `rls-${n}-${tag}@example.test`;
  const { data: u } = await admin.auth.admin.createUser({ email, password: 'Password123!', email_confirm: true });
  const c = mk(); await c.auth.signInWithPassword({ email, password: 'Password123!' });
  const { data: bid, error } = await c.rpc('create_business', { p_name: `T${n}`, p_slug: `rls-${n}-${tag}`, p_timezone: 'UTC' });
  if (error) throw error;
  const { data: svc } = await c.from('services').insert({ business_id: bid, name: 'S', duration_minutes: 30, price_cents: 100 }).select().single();
  const { data: prov } = await c.from('providers').select('id').eq('business_id', bid).single();
  const { data: cl } = await c.from('clients').insert({ business_id: bid, name: 'Secret', notes: 'private' }).select().single();
  const { data: bk } = await admin.from('bookings').insert({ business_id: bid, service_id: svc.id, provider_id: prov.id, client_id: cl.id, starts_at: new Date(Date.now() + 864e5).toISOString(), ends_at: new Date(Date.now() + 864e5 + 18e5).toISOString(), price_cents: 100 }).select().single();
  return { c, bid, uid: u.user.id, svc, cl, bk, prov };
}
const A = await tenant('a'), B = await tenant('b');
try {
  check('A sees only own clients', (await A.c.from('clients').select('id')).data.every((r) => r.id === A.cl.id));
  check('A cannot read B client by id', (await A.c.from('clients').select('*').eq('id', B.cl.id)).data.length === 0);
  check('A cannot read B bookings', (await A.c.from('bookings').select('id').eq('business_id', B.bid)).data.length === 0);
  check('A cannot read B subscription', (await A.c.from('subscriptions').select('*').eq('business_id', B.bid)).data.length === 0);
  check('A cannot read B business', (await A.c.from('businesses').select('*').eq('id', B.bid)).data.length === 0);
  check('A cannot insert service into B', !!(await A.c.from('services').insert({ business_id: B.bid, name: 'x', duration_minutes: 30, price_cents: 1 })).error);
  check('A cannot update B booking', ((await A.c.from('bookings').update({ status: 'cancelled' }).eq('id', B.bk.id).select()).data || []).length === 0);
  check('A cannot delete B service', ((await A.c.from('services').delete().eq('id', B.svc.id).select()).data || []).length === 0);
  check('A cannot write subscriptions', ((await A.c.from('subscriptions').update({ status: 'active' }).eq('business_id', A.bid).select()).data || []).length === 0);
  check('A cannot book B service (tenant guard)', !!(await admin.from('bookings').insert({ business_id: A.bid, service_id: B.svc.id, provider_id: A.prov.id, client_id: A.cl.id, starts_at: new Date(Date.now() + 9e8).toISOString(), ends_at: new Date(Date.now() + 9e8 + 18e5).toISOString(), price_cents: 1 })).error);
  const anon = mk();
  check('anonymous reads nothing', (await anon.from('clients').select('id')).data.length === 0 && (await anon.from('businesses').select('id')).data.length === 0);
  check('anonymous cannot call create_booking', !!(await anon.rpc('create_booking', { p_business: A.bid, p_service: A.svc.id, p_provider: A.prov.id, p_start: new Date(Date.now() + 9e8).toISOString(), p_name: 'x', p_email: 'x@x.co', p_phone: null, p_notes: null })).error);
} finally {
  for (const t of [A, B]) await admin.auth.admin.deleteUser(t.uid); // cascades to tenant data
}
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
