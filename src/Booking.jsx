import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api, money } from './api.js';
import './style.css';

export default function Booking() {
  const { slug } = useParams();
  const [biz, setBiz] = useState(), [cat, setCat] = useState(), [err, setErr] = useState('');
  const [svc, setSvc] = useState(), [prov, setProv] = useState(''), [date, setDate] = useState('');
  const [slots, setSlots] = useState(), [slot, setSlot] = useState(), [tick, setTick] = useState(0);
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' });
  const [busy, setBusy] = useState(false), [fe, setFe] = useState(''), [done, setDone] = useState();

  useEffect(() => {
    Promise.all([api(`/public/businesses/${slug}`), api(`/public/businesses/${slug}/services`)])
      .then(([b, c]) => { setBiz(b); setCat(c); }).catch((e) => setErr(e.message));
  }, [slug]);
  useEffect(() => {
    setSlots(undefined); setSlot(undefined); setFe('');
    if (!svc || !date) return;
    let live = true;
    api(`/public/businesses/${slug}/availability?service_id=${svc.id}&date=${date}${prov ? `&provider_id=${prov}` : ''}`)
      .then((r) => live && setSlots(r.slots)).catch((e) => live && (setFe(e.message), setSlots([])));
    return () => { live = false; };
  }, [svc, date, prov, tick]);

  const fmt = (iso) => DateTime.fromISO(iso, { zone: biz.timezone }).toFormat('h:mm a');
  const submit = async (e) => {
    e.preventDefault(); if (busy) return; setBusy(true); setFe('');
    try {
      const r = await api(`/public/businesses/${slug}/bookings`, { method: 'POST', body: { service_id: svc.id, provider_id: prov || undefined, starts_at: slot, ...form } });
      setDone(r.booking);
    } catch (x) { setFe(x.message); if (x.status === 409) { setSlot(undefined); setTick((t) => t + 1); } }
    setBusy(false);
  };

  if (err) return <p className="center error">{err}</p>;
  if (!biz || !cat) return <div className="wrap narrow"><div className="skeleton" /></div>;
  if (done) return (<div className="wrap narrow card center"><h2>You're booked ✅</h2>
    <p><b>{done.service}</b> at {done.business}</p>
    <p>{DateTime.fromISO(done.starts_at, { zone: biz.timezone }).toFormat("cccc d LLLL yyyy, h:mm a ZZZZ")}</p>
    <p className="mut">A confirmation was sent if you provided an email.</p></div>);

  const today = DateTime.now().setZone(biz.timezone).toISODate();
  return (<div className="wrap narrow">
    <h1>{biz.name}</h1><p className="mut">{[biz.phone, biz.email].filter(Boolean).join(' · ')} · Times shown in {biz.timezone}</p>
    <div className="card"><h3>1. Choose a service</h3>
      {cat.services.length === 0 && <p className="mut">No services available yet.</p>}
      {cat.services.map((s) => (<div key={s.id} className="appt" onClick={() => { setSvc(s); }} style={svc?.id === s.id ? { outline: '2px solid var(--pri)' } : {}} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSvc(s)}>
        <span><b>{s.name}</b><br /><span className="mut">{s.description}</span></span><span>{s.duration_minutes} min · {money(s.price_cents)}</span></div>))}
    </div>
    {svc && <div className="card"><h3>2. Pick a date</h3>
      {cat.providers.length > 1 && <label>Provider<select value={prov} onChange={(e) => setProv(e.target.value)}><option value="">Anyone available</option>{cat.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      <input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
      {date && slots === undefined && <div className="skeleton" />}
      {slots && slots.length === 0 && <p className="mut">No times available on this day. Try another date.</p>}
      {slots && slots.length > 0 && <div className="slots">{slots.map((s) => <button type="button" key={s.start} className={slot === s.start ? 'sel' : ''} onClick={() => setSlot(s.start)}>{fmt(s.start)}</button>)}</div>}
    </div>}
    {slot && <form className="card" onSubmit={submit}><h3>3. Your details</h3>
      <input required placeholder="Name" maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <input type="tel" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <textarea placeholder="Notes (optional)" maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      <p className="mut">Email or phone is required.</p>
      <button disabled={busy || !form.name || (!form.email && !form.phone)}>{busy ? 'Booking…' : `Book ${fmt(slot)}`}</button>
    </form>}
    {fe && <p className="error">{fe}</p>}
  </div>);
}
