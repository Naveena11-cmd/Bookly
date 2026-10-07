import { DateTime } from 'luxon';
import { computeSlots } from './availability.js';

const must = ({ data, error }) => { if (error) throw error; return data; };
export const INTERVAL_MIN = 30;
export const NOTICE_MIN = 30;

/** Returns [{start, provider_id}] (one per distinct start, first free provider). Bounded to ONE day. */
export async function slotsFor(db, { business, service, date, providerId, excludeBookingId }) {
  let pq = db.from('providers').select('id').eq('business_id', business.id).eq('active', true);
  if (providerId) pq = pq.eq('id', providerId);
  const ids = (must(await pq) || []).map((p) => p.id);
  if (!ids.length) return [];

  const day = DateTime.fromISO(date, { zone: business.timezone }).startOf('day');
  const next = day.plus({ days: 1 });
  const dow = day.weekday % 7; // luxon Mon=1..Sun=7 -> 0=Sunday
  const [maps, bh, ph, blocked, bookings] = (await Promise.all([
    db.from('provider_services').select('provider_id,service_id').in('provider_id', ids),
    db.from('business_hours').select('start_time,end_time').eq('business_id', business.id).eq('day_of_week', dow).eq('enabled', true),
    db.from('provider_hours').select('provider_id,day_of_week,start_time,end_time,enabled').in('provider_id', ids),
    db.from('blocked_periods').select('provider_id,starts_at,ends_at').eq('business_id', business.id)
      .lt('starts_at', next.toISO()).gt('ends_at', day.toISO()),
    db.from('bookings').select('id,provider_id,starts_at,ends_at').eq('business_id', business.id)
      .in('status', ['pending', 'confirmed']).lt('starts_at', next.toISO()).gt('ends_at', day.toISO())
  ])).map(must);

  const hhmm = (t) => t.slice(0, 5);
  const result = new Map();
  for (const pid of ids) {
    const m = maps.filter((x) => x.provider_id === pid);
    if (m.length && !m.some((x) => x.service_id === service.id)) continue; // cannot do this service
    const own = ph.filter((x) => x.provider_id === pid);
    const rows = own.length ? own.filter((x) => x.day_of_week === dow && x.enabled) : bh;
    const slots = computeSlots({
      date, tz: business.timezone, durationMin: service.duration_minutes, intervalMin: INTERVAL_MIN,
      windows: rows.map((r) => ({ start: hhmm(r.start_time), end: hhmm(r.end_time) })),
      blocked: blocked.filter((b) => !b.provider_id || b.provider_id === pid),
      bookings: bookings.filter((b) => b.provider_id === pid && b.id !== excludeBookingId),
      noticeMin: NOTICE_MIN
    });
    for (const s of slots) if (!result.has(s)) result.set(s, pid);
  }
  return [...result].sort(([a], [b]) => (a < b ? -1 : 1)).map(([start, provider_id]) => ({ start, provider_id }));
}
