// Concurrency test: N parallel bookings for the same slot -> exactly one 201.
// Usage: node --env-file=.env scripts/race-test.mjs demo-barber   (API must be running)
const base = process.env.API_BASE || 'http://localhost:3001';
const slug = process.argv[2] || 'demo-barber';
const j = async (p, o) => { const r = await fetch(base + '/api' + p, { ...o, headers: { 'content-type': 'application/json' } }); return { status: r.status, body: await r.json() }; };
const { body: cat } = await j(`/public/businesses/${slug}/services`);
const svc = cat.data.services[0];
let slot;
for (let d = 1; d < 14 && !slot; d++) {
  const date = new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  const r = await j(`/public/businesses/${slug}/availability?service_id=${svc.id}&date=${date}`);
  slot = r.body.data?.slots?.[0]?.start;
}
if (!slot) { console.error('no free slot found'); process.exit(1); }
const N = 8;
const res = await Promise.all(Array.from({ length: N }, (_, i) => j(`/public/businesses/${slug}/bookings`, { method: 'POST', body: JSON.stringify({ service_id: svc.id, starts_at: slot, name: `Racer ${i}`, email: `racer${i}-${Date.now()}@example.test` }) })));
const wins = res.filter((r) => r.status === 201).length, conflicts = res.filter((r) => r.status === 409).length;
console.log({ wins, conflicts, other: N - wins - conflicts });
console.log(wins === 1 ? 'PASS: exactly one booking succeeded' : 'FAIL'); process.exit(wins === 1 ? 0 : 1);
