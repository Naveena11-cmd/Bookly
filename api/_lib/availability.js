import { DateTime } from 'luxon';

// Half-open intervals: back-to-back appointments do NOT overlap.
export const overlaps = (aS, aE, bS, bE) => aS < bE && aE > bS;

/**
 * Pure slot generator. windows: [{start:'09:00', end:'17:00'}] in business-local time.
 * Wall-clock times are resolved with luxon in the IANA zone (DST-safe);
 * stepping and comparisons use absolute UTC milliseconds.
 */
export function computeSlots({ date, tz, durationMin, intervalMin = 30, windows, blocked = [], bookings = [], now = new Date(), noticeMin = 0 }) {
  const day = DateTime.fromISO(date, { zone: tz }).startOf('day');
  if (!day.isValid) return [];
  const earliest = +now + noticeMin * 60000;
  const blk = blocked.map((b) => [+new Date(b.starts_at), +new Date(b.ends_at)]);
  const bks = bookings.map((b) => [+new Date(b.starts_at), +new Date(b.ends_at)]);
  const out = new Set();
  for (const w of windows) {
    const [sh, sm] = w.start.split(':').map(Number);
    const [eh, em] = w.end.split(':').map(Number);
    const wS = day.set({ hour: sh, minute: sm });
    const wE = +day.set({ hour: eh, minute: em });
    for (let c = wS; +c.plus({ minutes: durationMin }) <= wE; c = c.plus({ minutes: intervalMin })) {
      const s = +c, e = +c.plus({ minutes: durationMin });
      if (s < earliest) continue;
      if (blk.some(([bs, be]) => overlaps(s, e, bs, be))) continue;
      if (bks.some(([bs, be]) => overlaps(s, e, bs, be))) continue;
      out.add(new Date(s).toISOString());
    }
  }
  return [...out].sort();
}
