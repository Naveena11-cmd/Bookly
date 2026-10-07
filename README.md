# Bookly — multi-tenant appointment booking SaaS

Public booking pages (`/booking/:slug`) + a private dashboard for service businesses.
**Stack:** React 18 + Vite + React Router · Express (one Vercel serverless function) · Supabase (Postgres, Auth, RLS) · Stripe (or built-in simulation) · Vercel Cron.

**Live demo:** _add your Vercel URL here_

## Architecture
```
Browser ── React SPA (Vercel static)
   │  Supabase JS: sign-in only (anon key)
   └─ fetch /api/* ──► Express (api/index.js, Vercel function)
          ├─ private routes: verify JWT -> membership lookup -> queries run as the USER (RLS enforced)
          ├─ public routes : service-role client, explicit column lists, validated slug, rate limited
          ├─ create_booking() SQL function (atomic) + GiST exclusion constraint (final double-booking guard)
          ├─ Stripe webhook (signature + replay protection) ─► subscriptions table
          └─ /api/cron/reminders (Vercel Cron, CRON_SECRET) ─► reminders (unique booking+channel) ─► notify adapter
```
Key decisions
- **Tenancy:** `business_id` on every tenant row; `is_member(business_id)` RLS policy (via `auth.uid()`); the API never accepts a business id from the browser. A trigger blocks cross-tenant references (e.g. booking another tenant's service).
- **Anonymous users have no RLS policies at all.** The public flow goes through the API, which returns only name/slug/timezone/contact, active services, and slot start times.
- **Double-booking:** availability is re-computed server-side at booking time, then `bookings_no_overlap` (`EXCLUDE USING gist (provider_id =, tstzrange(starts_at, ends_at,'[)') &&) WHERE status IN ('pending','confirmed')`) guarantees at most one winner. Intervals are half-open, so back-to-back bookings are fine. Cancelling frees the slot; rescheduling updates the same row.
- **Time:** `timestamptz` everywhere; wall-clock hours resolved in the business IANA zone with luxon (DST-safe).
- **Money:** integer cents.
- **Billing gate:** `hasAccess()` — active ✓; trialing ✓ until period end (14-day trial on signup); past_due ✓ for a 7-day grace; cancelled/incomplete ✗. Gated (HTTP 402): CRM + dashboard summary. Calendar/services/settings stay available so owners can still manage bookings.
- **Metrics:** revenue = confirmed + completed (cancelled/no-show excluded); no-show rate = no_show ÷ (completed + no_show); LTV = sum of completed bookings.

## Local setup
Requires Node ≥ 20.6.
1. `npm install`
2. Create a Supabase project. In **SQL editor** run `supabase/migrations/001_schema_and_rls.sql` (creates schema, RLS policies, functions).
3. Supabase → Authentication → Providers → Email: for easy demos turn **off** "Confirm email".
4. `cp .env.example .env` and fill in the three Supabase values (URL, anon key, service-role key).
5. `npm run seed` (two demo tenants: `barber@demo.test`, `clinic@demo.test`, password `Password123!`, slugs `demo-barber`, `demo-clinic`).
6. `npm run dev` → frontend http://localhost:5173, API http://localhost:3001 (proxied).

## Environment variables
See `.env.example`. `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_*`, `EMAIL_PROVIDER_API_KEY`, `CRON_SECRET` are server-only (no `VITE_` prefix → never in the browser bundle).

## Tests
- `npm test` — unit + HTTP-edge tests (availability, overlap boundaries, 90-min duration, blocked periods, DST, lifecycle, subscription gating, 401 without token, webhook bad-signature 400, cron 401). No database needed.
- `npm run test:rls` — creates two real tenants in your Supabase project and tries every cross-tenant read/write (all must be denied); cleans up after itself.
- `npm run test:race` (with `npm run dev` running) — fires 8 concurrent bookings for one slot; exactly one must return 201.

## Reminders job
`GET /api/cron/reminders` with header `Authorization: Bearer $CRON_SECRET`. Run locally:
`curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/cron/reminders`
Running it twice sends once: reminders have `UNIQUE(booking_id, channel)` plus an optimistic `sending` lock; failures retry up to 3 times and are recorded in `reminders` and `notification_logs`. Without `EMAIL_PROVIDER_API_KEY` emails are mocked (console + log row).

## Billing
- **Simulation (default):** `BILLING_MODE=simulate` — Billing page shows Simulate subscribe/cancel buttons (server decides the resulting state).
- **Stripe:** create a monthly Price, set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `APP_URL`, `BILLING_MODE=stripe`. Add a webhook endpoint `https://YOUR_APP/api/billing/webhook` for `checkout.session.completed` and `customer.subscription.*`; put its signing secret in `STRIPE_WEBHOOK_SECRET`. Local: `stripe listen --forward-to localhost:3001/api/billing/webhook`.

## Deploy (Vercel + Supabase)
1. Push to GitHub. In Vercel: **Add New → Project →** import the repo (framework preset Vite; defaults are fine).
2. Add the environment variables from `.env.example` (set `APP_URL` to your production URL, `CRON_SECRET` to a long random string).
3. Deploy. `vercel.json` routes `/api/*` to the Express function, everything else to the SPA, and registers an hourly cron (Hobby plan allows daily only — change the schedule to `0 8 * * *`).
4. Supabase → Authentication → URL Configuration: set Site URL to your Vercel URL.

## Known limitations
- One working-hours window per day (use blocked periods for lunch breaks); provider hours override business hours entirely when present.
- Provider-specific hours/services have API support but only basic UI (add providers; per-provider hours via `PUT /api/schedule/providers/:id/hours`).
- Rate limiting is in-memory per serverless instance (use Upstash/Redis for a global limit).
- Blocked-period inputs use the browser timezone. Email only (SMS adapter not implemented). Bookings are auto-confirmed (the `pending` workflow is supported by API/UI but not created by default).
- Dashboard calendar is an agenda-style day/week/month grouped list, not a drag-and-drop grid.
- No AI features.

## Scaling notes (hundreds → thousands of tenants)
Indexes exist on `(business_id, starts_at)`, `client_id`, slug and the GiST exclusion index; all list endpoints are range-bound or paginated and use joins (no N+1); stats are SQL aggregates. At scale: use Supabase's pooled connection string, move reminders to a queue (e.g. Supabase Queues/Inngest) with batching, shard the cron by business, cache public business/service config (already `Cache-Control` + could add Redis), and partition `bookings` by month.

## Future improvements
SMS adapter, customer self-service reschedule via signed token, iCal export, waitlist, cancellation windows, drag-and-drop calendar, AI scheduling assistant calling the same availability endpoint.
