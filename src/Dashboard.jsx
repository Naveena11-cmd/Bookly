import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api, money } from './api.js';
import { useMe } from './App.jsx';

function useLoad(path) {
  const [s, setS] = useState({ loading: true });
  const reload = useCallback(() => {
    api(path).then((data) => setS({ data, loading: false })).catch((err) => setS((x) => ({ ...x, err, loading: false })));
  }, [path]);
  useEffect(() => { setS((x) => ({ ...x, loading: true, err: undefined })); reload(); }, [reload]);
  return { ...s, reload };
}
function State({ s, children }) {
  if (s.err) return s.err.status === 402
    ? <div className="card">A subscription is required for this feature. <Link to="/dashboard/billing">Manage billing</Link></div>
    : <p className="error">{s.err.message}</p>;
  if (!s.data) return <div className="skeleton" />;
  return children(s.data);
}
const Badge = ({ s }) => <span className={`badge s-${s.status}`}>{s.status.replace('_', ' ')}</span>;

export function Overview() {
  const { business } = useMe();
  const s = useLoad('/dashboard/summary');
  return (<><h2>{business.name}</h2>
    <p>Public booking page: <a href={`/booking/${business.slug}`} target="_blank" rel="noreferrer">/booking/{business.slug}</a></p>
    <State s={s}>{(d) => (<div className="stats">
      <div className="card"><b>{d.today}</b>Today's appointments</div>
      <div className="card"><b>{d.upcoming}</b>Upcoming bookings</div>
      <div className="card"><b>{money(d.revenue_cents)}</b>Booking value (confirmed + completed)</div>
      <div className="card"><b>{d.clients}</b>Clients</div>
      <div className="card"><b>{d.no_show_rate}%</b>No-show rate (no-show ÷ completed+no-show)</div></div>)}</State></>);
}

export function Bookings() {
  const { business } = useMe(); const tz = business.timezone;
  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(() => DateTime.now().setZone(tz));
  const unit = view === 'day' ? 'day' : view === 'week' ? 'week' : 'month';
  const from = anchor.startOf(unit), to = from.plus({ [unit + 's']: 1 });
  const s = useLoad(`/bookings?from=${encodeURIComponent(from.toUTC().toISO())}&to=${encodeURIComponent(to.toUTC().toISO())}`);
  const [open, setOpen] = useState();
  return (<><h2>Calendar</h2>
    <div className="row"><select value={view} onChange={(e) => setView(e.target.value)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select>
      <button className="ghost" onClick={() => setAnchor(anchor.minus({ [unit + 's']: 1 }))}>◀ Prev</button>
      <button className="ghost" onClick={() => setAnchor(DateTime.now().setZone(tz))}>Today</button>
      <button className="ghost" onClick={() => setAnchor(anchor.plus({ [unit + 's']: 1 }))}>Next ▶</button></div>
    <p className="mut">{from.toFormat('d LLL yyyy')} – {to.minus({ days: 1 }).toFormat('d LLL yyyy')} · {tz}</p>
    <State s={s}>{(d) => {
      if (!d.items.length) return <div className="card mut">No appointments in this range.</div>;
      const days = {};
      d.items.forEach((b) => { (days[DateTime.fromISO(b.starts_at, { zone: tz }).toISODate()] ||= []).push(b); });
      return Object.entries(days).map(([day, items]) => (<div key={day}><h4>{DateTime.fromISO(day).toFormat('cccc d LLL')}</h4>
        {items.map((b) => (<div key={b.id} className="appt" onClick={() => setOpen(b)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(b)}>
          <span><b>{DateTime.fromISO(b.starts_at, { zone: tz }).toFormat('h:mm a')}</b> {b.service.name} · {b.client.name}<br /><span className="mut">{b.provider.name}</span></span><Badge s={b} /></div>))}</div>));
    }}</State>
    {open && <BookingModal b={open} onClose={() => setOpen(undefined)} onChange={() => { setOpen(undefined); s.reload(); }} />}
  </>);
}

function BookingModal({ b, onClose, onChange }) {
  const { business } = useMe(); const tz = business.timezone;
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false), [date, setDate] = useState(''), [slots, setSlots] = useState();
  const act = async (fn) => { if (busy) return; setBusy(true); setErr(''); try { await fn(); onChange(); } catch (e) { setErr(e.message); setBusy(false); } };
  const setStatus = (status) => act(() => api(`/bookings/${b.id}`, { method: 'PATCH', body: { status } }));
  useEffect(() => {
    setSlots(undefined); if (!date) return;
    api(`/public/businesses/${business.slug}/availability?service_id=${b.service_id}&date=${date}&provider_id=${b.provider.id}`).then((r) => setSlots(r.slots)).catch((e) => setErr(e.message));
  }, [date]);
  const active = ['pending', 'confirmed'].includes(b.status);
  return (<div className="modal" onClick={onClose}><div className="card" onClick={(e) => e.stopPropagation()}>
    <h3>{b.service.name} <Badge s={b} /></h3>
    <p>{DateTime.fromISO(b.starts_at, { zone: tz }).toFormat('ccc d LLL yyyy, h:mm a')} · {b.service.duration_minutes} min · {money(b.price_cents)}<br />
      {b.client.name} · {b.client.email || b.client.phone}<br />Provider: {b.provider.name}</p>
    <div className="row">
      {b.status === 'pending' && <button disabled={busy} onClick={() => setStatus('confirmed')}>Confirm</button>}
      {b.status === 'confirmed' && <><button disabled={busy} onClick={() => setStatus('completed')}>Complete</button><button className="ghost" disabled={busy} onClick={() => setStatus('no_show')}>No-show</button></>}
      {active && <button className="ghost" disabled={busy} onClick={() => window.confirm('Cancel this booking?') && setStatus('cancelled')}>Cancel</button>}
    </div>
    {active && <><h4>Reschedule</h4><input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      {slots && !slots.length && <p className="mut">No times that day.</p>}
      <div className="slots">{slots?.map((x) => <button key={x.start} disabled={busy} onClick={() => act(() => api(`/bookings/${b.id}/reschedule`, { method: 'POST', body: { starts_at: x.start } }))}>{DateTime.fromISO(x.start, { zone: tz }).toFormat('h:mm a')}</button>)}</div></>}
    {err && <p className="error">{err}</p>}<button className="ghost" onClick={onClose}>Close</button></div></div>);
}

export function Clients() {
  const [q, setQ] = useState(''), [sel, setSel] = useState();
  const s = useLoad(`/clients?q=${encodeURIComponent(q)}`);
  return (<><h2>Clients</h2><input placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
    <State s={s}>{(d) => d.items.length ? d.items.map((c) => (<div key={c.id} className="appt" onClick={() => setSel(c.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSel(c.id)}>
      <span><b>{c.name}</b><br /><span className="mut">{c.email || c.phone}</span></span><span>LTV {money(c.lifetime_value_cents)} · {c.total_bookings} bookings</span></div>)) : <div className="card mut">No clients yet. They appear after the first booking.</div>}</State>
    {sel && <ClientModal id={sel} onClose={() => { setSel(undefined); s.reload(); }} />}</>);
}
function ClientModal({ id, onClose }) {
  const s = useLoad(`/clients/${id}`); const [notes, setNotes] = useState(null), [msg, setMsg] = useState('');
  const save = async () => { try { await api(`/clients/${id}`, { method: 'PATCH', body: { notes } }); setMsg('Saved'); } catch (e) { setMsg(e.message); } };
  return (<div className="modal" onClick={onClose}><div className="card" onClick={(e) => e.stopPropagation()}><State s={s}>{(c) => (<>
    <h3>{c.name}</h3><p>{c.email} {c.phone}</p>
    <p>Lifetime value <b>{money(c.lifetime_value_cents)}</b> · Last: {c.last_appointment ? DateTime.fromISO(c.last_appointment).toFormat('d LLL yyyy') : '—'} · Next: {c.next_appointment ? DateTime.fromISO(c.next_appointment).toFormat('d LLL yyyy') : '—'}</p>
    <label>Private notes<textarea rows={3} maxLength={2000} value={notes ?? c.notes ?? ''} onChange={(e) => setNotes(e.target.value)} /></label>
    <button onClick={save}>Save notes</button> <span className="mut">{msg}</span><h4>History</h4>
    {c.bookings.map((b) => <div key={b.id} className="row"><span>{DateTime.fromISO(b.starts_at).toFormat('d LLL yyyy')} · {b.service.name}</span><Badge s={b} /></div>)}</>)}</State>
    <button className="ghost" onClick={onClose}>Close</button></div></div>);
}

export function Services() {
  const s = useLoad('/services'); const [f, setF] = useState({ name: '', duration_minutes: 30, price: 25 }); const [err, setErr] = useState('');
  const add = async (e) => { e.preventDefault(); setErr(''); try { await api('/services', { method: 'POST', body: { name: f.name, duration_minutes: +f.duration_minutes, price_cents: Math.round(+f.price * 100) } }); setF({ ...f, name: '' }); s.reload(); } catch (x) { setErr(x.message); } };
  const toggle = async (sv) => { await api(`/services/${sv.id}`, { method: 'PATCH', body: { active: !sv.active } }); s.reload(); };
  return (<><h2>Services</h2><form className="card row" onSubmit={add}>
    <input required placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
    <input type="number" min={5} max={480} step={5} value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: e.target.value })} aria-label="Minutes" />
    <input type="number" min={0} step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} aria-label="Price" /><button>Add</button></form>
    {err && <p className="error">{err}</p>}
    <State s={s}>{(d) => d.map((sv) => <div key={sv.id} className="appt"><span><b>{sv.name}</b> · {sv.duration_minutes} min · {money(sv.price_cents)}</span><button className="ghost" onClick={() => toggle(sv)}>{sv.active ? 'Disable' : 'Enable'}</button></div>)}</State></>);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function Settings() {
  const me = useMe(); const s = useLoad('/schedule'); const [p, setP] = useState({ name: me.business.name, slug: me.business.slug, timezone: me.business.timezone, phone: me.business.phone || '' });
  const [hours, setHours] = useState(), [msg, setMsg] = useState(''), [blk, setBlk] = useState({ starts_at: '', ends_at: '', reason: '' }), [pname, setPname] = useState('');
  useEffect(() => { if (s.data && !hours) setHours(DAYS.map((_, d) => { const r = s.data.hours.find((x) => x.day_of_week === d); return { day_of_week: d, start_time: (r?.start_time || '09:00').slice(0, 5), end_time: (r?.end_time || '17:00').slice(0, 5), enabled: r?.enabled ?? false }; })); }, [s.data]);
  const run = async (fn, ok = 'Saved') => { setMsg(''); try { await fn(); setMsg(ok); s.reload(); } catch (e) { setMsg(e.message); } };
  return (<><h2>Settings</h2><p className="ok">{msg}</p>
    <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/business', { method: 'PATCH', body: { ...p, phone: p.phone || null } }); me.reload(); }); }}><h3>Business profile</h3>
      <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} aria-label="Name" /><input value={p.slug} onChange={(e) => setP({ ...p, slug: e.target.value })} aria-label="Slug" />
      <input value={p.timezone} onChange={(e) => setP({ ...p, timezone: e.target.value })} aria-label="Timezone" /><input placeholder="Phone" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} /><button>Save</button></form>
    <div className="card"><h3>Working hours (business timezone)</h3>{hours?.map((h, i) => (<div className="row" key={h.day_of_week}>
      <label><input type="checkbox" style={{ width: 'auto' }} checked={h.enabled} onChange={(e) => setHours(hours.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x))} /> {DAYS[i]}</label>
      <input type="time" value={h.start_time} onChange={(e) => setHours(hours.map((x, j) => j === i ? { ...x, start_time: e.target.value } : x))} />
      <input type="time" value={h.end_time} onChange={(e) => setHours(hours.map((x, j) => j === i ? { ...x, end_time: e.target.value } : x))} /></div>))}
      <button onClick={() => run(() => api('/schedule/hours', { method: 'PUT', body: { hours } }))}>Save hours</button></div>
    <div className="card"><h3>Blocked periods</h3><span className="mut">Entered in your browser's timezone.</span>
      <div className="row"><input type="datetime-local" value={blk.starts_at} onChange={(e) => setBlk({ ...blk, starts_at: e.target.value })} /><input type="datetime-local" value={blk.ends_at} onChange={(e) => setBlk({ ...blk, ends_at: e.target.value })} /><input placeholder="Reason" value={blk.reason} onChange={(e) => setBlk({ ...blk, reason: e.target.value })} />
        <button onClick={() => run(async () => { await api('/schedule/blocked', { method: 'POST', body: { starts_at: new Date(blk.starts_at).toISOString(), ends_at: new Date(blk.ends_at).toISOString(), reason: blk.reason || null } }); setBlk({ starts_at: '', ends_at: '', reason: '' }); })}>Block</button></div>
      {s.data?.blocked.map((b) => <div key={b.id} className="row"><span>{new Date(b.starts_at).toLocaleString()} → {new Date(b.ends_at).toLocaleString()} {b.reason}</span><button className="ghost" onClick={() => run(() => api(`/schedule/blocked/${b.id}`, { method: 'DELETE' }), 'Removed')}>Remove</button></div>)}</div>
    <div className="card"><h3>Providers</h3>{s.data?.providers.map((x) => <div key={x.id}>{x.name}</div>)}
      <div className="row"><input placeholder="New provider name" value={pname} onChange={(e) => setPname(e.target.value)} /><button onClick={() => run(async () => { await api('/providers', { method: 'POST', body: { name: pname } }); setPname(''); })}>Add</button></div></div></>);
}

export function Billing() {
  const me = useMe(); const sub = me.subscription; const [msg, setMsg] = useState('');
  const checkout = async () => { try { const r = await api('/billing/checkout', { method: 'POST' }); window.location = r.url; } catch (e) { setMsg(e.message); } };
  const sim = async (action) => { try { await api('/billing/simulate', { method: 'POST', body: { action } }); me.reload(); } catch (e) { setMsg(e.message); } };
  return (<><h2>Billing</h2><div className="card">
    <p>Status: <b>{sub?.status}</b> {sub?.current_period_end && <>· period ends {new Date(sub.current_period_end).toLocaleDateString()}</>}</p>
    <p>Premium access (CRM, dashboard stats): <b className={me.access ? 'ok' : 'error'}>{me.access ? 'enabled' : 'locked'}</b></p>
    {me.billing.stripe && <button onClick={checkout}>Subscribe (monthly)</button>}
    {me.billing.simulate && <div className="row"><button onClick={() => sim('subscribe')}>Simulate subscribe</button><button className="ghost" onClick={() => sim('cancel')}>Simulate cancel</button></div>}
    {msg && <p className="error">{msg}</p>}</div></>);
}
