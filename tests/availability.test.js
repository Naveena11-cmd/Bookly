import { describe, it, expect } from 'vitest';
import { computeSlots, overlaps } from '../api/_lib/availability.js';

const base = { tz: 'America/New_York', durationMin: 30, windows: [{ start: '09:00', end: '17:00' }], now: new Date('2020-01-01') };
const iso = (s) => new Date(s).toISOString();

describe('availability engine', () => {
  it('generates 16 half-hour slots for a 9-17 day', () => {
    expect(computeSlots({ ...base, date: '2030-06-12' })).toHaveLength(16);
  });
  it('90-minute service: last start is 15:30 local', () => {
    const s = computeSlots({ ...base, date: '2030-06-12', durationMin: 90 });
    expect(s.at(-1)).toBe(iso('2030-06-12T15:30:00-04:00'));
    expect(s).toHaveLength(14);
  });
  it('a booking ending exactly when the next starts does not overlap', () => {
    expect(overlaps(10, 11, 11, 12)).toBe(false);
    const s = computeSlots({ ...base, date: '2030-06-12', bookings: [{ starts_at: iso('2030-06-12T10:00:00-04:00'), ends_at: iso('2030-06-12T10:30:00-04:00') }] });
    expect(s).toContain(iso('2030-06-12T09:30:00-04:00'));
    expect(s).not.toContain(iso('2030-06-12T10:00:00-04:00'));
    expect(s).toContain(iso('2030-06-12T10:30:00-04:00'));
  });
  it('service crossing a boundary is rejected', () => {
    const s = computeSlots({ ...base, date: '2030-06-12', durationMin: 60, bookings: [{ starts_at: iso('2030-06-12T10:00:00-04:00'), ends_at: iso('2030-06-12T10:30:00-04:00') }] });
    expect(s).not.toContain(iso('2030-06-12T09:30:00-04:00'));
  });
  it('blocked periods remove overlapping slots', () => {
    const s = computeSlots({ ...base, date: '2030-06-12', blocked: [{ starts_at: iso('2030-06-12T12:00:00-04:00'), ends_at: iso('2030-06-12T13:00:00-04:00') }] });
    expect(s).toHaveLength(14);
  });
  it('is DST-correct (spring forward 2030-03-10, New York)', () => {
    expect(computeSlots({ ...base, date: '2030-03-09' })[0]).toBe('2030-03-09T14:00:00.000Z'); // EST
    expect(computeSlots({ ...base, date: '2030-03-10' })[0]).toBe('2030-03-10T13:00:00.000Z'); // EDT
  });
  it('respects minimum notice / past times', () => {
    const now = new Date(iso('2030-06-12T12:10:00-04:00'));
    expect(computeSlots({ ...base, date: '2030-06-12', now, noticeMin: 30 })[0]).toBe(iso('2030-06-12T13:00:00-04:00'));
  });
  it('closed day (no windows) has no slots', () => {
    expect(computeSlots({ ...base, date: '2030-06-12', windows: [] })).toEqual([]);
  });
});
