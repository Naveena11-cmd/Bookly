export const TRANSITIONS = { pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled', 'no_show'] };
export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

export const GRACE_DAYS = 7; // past_due keeps access for 7 days after period end
export function hasAccess(sub, now = new Date()) {
  if (!sub) return false;
  const end = sub.current_period_end ? +new Date(sub.current_period_end) : 0;
  if (sub.status === 'active') return true;
  if (sub.status === 'trialing') return end > +now;
  if (sub.status === 'past_due') return end + GRACE_DAYS * 864e5 > +now;
  return false; // cancelled | incomplete
}
