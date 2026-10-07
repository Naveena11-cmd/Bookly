import { createClient } from '@supabase/supabase-js';
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
// Service-role client: bypasses RLS. Use ONLY for public flows, webhooks, cron.
export const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// Per-request client acting AS the user: RLS is enforced by Postgres.
export const asUser = (token) =>
  createClient(url, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
