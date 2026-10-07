import { supabase } from './supabase.js';
export async function api(path, { method = 'GET', body } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || 'Request failed'), { status: r.status, code: j.error?.code });
  return j.data;
}
export const money = (c) => `₹${Math.round((c || 0) / 100).toLocaleString('en-IN')}`;
