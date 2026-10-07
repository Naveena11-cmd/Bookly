import { admin } from './supabase.js';

const templates = {
  confirmation: (d) => ({ subject: `Booking confirmed: ${d.service}`, text: `Hi ${d.name}, your ${d.service} at ${d.business} is confirmed for ${d.when}.` }),
  reminder: (d) => ({ subject: `Reminder: ${d.service} tomorrow`, text: `Hi ${d.name}, a reminder of your ${d.service} at ${d.business} on ${d.when}.` })
};

/** Provider abstraction: Resend email if configured, else a console mock. Never throws. */
export async function notify({ businessId, bookingId, channel = 'email', to, template, data }) {
  let status = 'sent', providerId = null, error = null;
  try {
    const msg = templates[template](data);
    if (channel === 'email' && process.env.EMAIL_PROVIDER_API_KEY) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.EMAIL_PROVIDER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.EMAIL_FROM || 'onboarding@resend.dev', to, subject: msg.subject, text: msg.text })
      });
      if (!r.ok) throw new Error(`provider_status_${r.status}`);
      providerId = (await r.json()).id;
    } else {
      console.log(JSON.stringify({ mock_notification: true, channel, template, to: String(to).replace(/(.).+(@.*)/, '$1***$2') }));
      providerId = 'mock';
    }
  } catch (e) { status = 'failed'; error = e.message; }
  await admin.from('notification_logs').insert({ business_id: businessId, booking_id: bookingId, channel, template, status, provider_message_id: providerId, error });
  return { ok: status === 'sent', error };
}
