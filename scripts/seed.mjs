// Creates two demo tenants. Usage: npm run seed
import { createClient } from '@supabase/supabase-js';
const url = process.env.VITE_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const demos = [
  { email: 'barber@demo.test', slug: 'demo-barber', name: 'Demo Barber', tz: 'America/New_York', services: [['Haircut', 30, 2500], ['Beard trim + cut', 60, 4000]] },
  { email: 'clinic@demo.test', slug: 'demo-clinic', name: 'Demo Clinic', tz: 'Europe/London', services: [['Consultation', 45, 8000]] }
];
for (const d of demos) {
  await admin.auth.admin.createUser({ email: d.email, password: 'Password123!', email_confirm: true }); // ignore "already exists"
  const u = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: se } = await u.auth.signInWithPassword({ email: d.email, password: 'Password123!' });
  if (se) { console.error(d.email, se.message); continue; }
  const { data: bid, error } = await u.rpc('create_business', { p_name: d.name, p_slug: d.slug, p_timezone: d.tz });
  if (error) { console.log(d.slug, 'skipped:', error.message); continue; }
  await admin.from('services').insert(d.services.map(([name, m, p]) => ({ business_id: bid, name, duration_minutes: m, price_cents: p })));
  await admin.from('subscriptions').update({ status: 'active', current_period_end: new Date(Date.now() + 30 * 864e5).toISOString() }).eq('business_id', bid);
  console.log('seeded', d.slug, d.email, 'Password123!');
}
