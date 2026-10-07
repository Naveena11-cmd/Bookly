import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { canTransition, hasAccess } from '../api/_lib/access.js';

describe('booking lifecycle', () => {
  it('allows only valid transitions', () => {
    expect(canTransition('pending', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'completed')).toBe(true);
    expect(canTransition('cancelled', 'confirmed')).toBe(false); // terminal
    expect(canTransition('completed', 'cancelled')).toBe(false);
  });
});
describe('subscription gating', () => {
  const now = new Date('2030-01-10'), day = 864e5;
  it('active ok; trial depends on expiry; cancelled/incomplete denied', () => {
    expect(hasAccess({ status: 'active' }, now)).toBe(true);
    expect(hasAccess({ status: 'trialing', current_period_end: new Date(+now + day) }, now)).toBe(true);
    expect(hasAccess({ status: 'trialing', current_period_end: new Date(+now - day) }, now)).toBe(false);
    expect(hasAccess({ status: 'cancelled', current_period_end: new Date(+now + day) }, now)).toBe(false);
    expect(hasAccess({ status: 'incomplete' }, now)).toBe(false);
    expect(hasAccess(null, now)).toBe(false);
  });
  it('past_due has a 7-day grace period', () => {
    expect(hasAccess({ status: 'past_due', current_period_end: new Date(+now - 3 * day) }, now)).toBe(true);
    expect(hasAccess({ status: 'past_due', current_period_end: new Date(+now - 8 * day) }, now)).toBe(false);
  });
});
describe('HTTP edge (no database needed)', () => {
  let server, base;
  beforeAll(async () => {
    Object.assign(process.env, { SUPABASE_URL: 'http://127.0.0.1:9', VITE_SUPABASE_ANON_KEY: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', CRON_SECRET: 'secret' });
    const { default: app } = await import('../api/index.js');
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => server.close());
  it('rejects private routes without a token (auth failure)', async () => {
    const r = await fetch(`${base}/api/bookings?from=2030-01-01T00:00:00Z&to=2030-01-02T00:00:00Z`);
    expect(r.status).toBe(401);
  });
  it('rejects webhooks with an invalid signature', async () => {
    const r = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': 't=1,v1=bad', 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(400);
  });
  it('rejects cron calls without the secret', async () => {
    expect((await fetch(`${base}/api/cron/reminders`)).status).toBe(401);
  });
  it('validates public inputs before touching the database', async () => {
    const r = await fetch(`${base}/api/public/businesses/x/bookings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"a"}' });
    expect(r.status).toBe(400);
  });
});
