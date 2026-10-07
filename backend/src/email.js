// Transactional email: templates, transports and the outbox worker.
// Emails are never sent inside a request. They are queued in the outbox in the same transaction
// as the change that causes them, then delivered by processOutbox() with retries, so a crash or a
// provider outage loses nothing and a failed request sends nothing.
import { config } from './config.js';

// ---------- transports
// send(msg) resolves on acceptance and throws on failure; err.permanent stops further retries.
export function brevoTransport({ apiKey = config.brevoApiKey, from = config.emailFrom, fromName = config.emailFromName, fetchImpl = fetch } = {}) {
  return {
    name: 'brevo',
    async send(msg) {
      let res;
      try {
        res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
          method: 'POST', headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sender: { name: fromName, email: from }, to: [{ email: msg.to }], subject: msg.subject, htmlContent: msg.html, textContent: msg.text, tags: [msg.template] }),
        });
      } catch (e) { throw Object.assign(new Error('Could not reach Brevo: ' + e.message), { permanent: false }); }
      if (res.ok) { const body = await res.json().catch(() => ({})); return { providerId: body.messageId || null }; }
      const detail = await res.text().catch(() => '');
      // 400 (bad request) cannot succeed on retry; auth, rate-limit and server errors can.
      throw Object.assign(new Error(`Brevo refused the email (${res.status}): ${detail.slice(0, 300)}`), { permanent: res.status === 400 });
    },
  };
}
// Resend (https://resend.com). The sender's domain must be verified in Resend.
export function resendTransport({ apiKey = config.resendApiKey, from = config.emailFrom, fromName = config.emailFromName, fetchImpl = fetch } = {}) {
  return {
    name: 'resend',
    async send(msg) {
      let res;
      try {
        res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST', headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({ from: `${fromName} <${from}>`, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, tags: [{ name: 'template', value: String(msg.template).replace(/[^\w-]/g, '_') }] }),
        });
      } catch (e) { throw Object.assign(new Error('Could not reach Resend: ' + e.message), { permanent: false }); }
      if (res.ok) { const body = await res.json().catch(() => ({})); return { providerId: body.id || null }; }
      const detail = await res.text().catch(() => '');
      // A request Resend calls invalid (400, 422) cannot succeed on retry; auth, rate-limit and server errors can.
      throw Object.assign(new Error(`Resend refused the email (${res.status}): ${detail.slice(0, 300)}`), { permanent: res.status === 400 || res.status === 422 });
    },
  };
}
export function logTransport(log = console.log) {
  return { name: 'log', async send(msg) { log(`\n[email:${msg.template}] to ${msg.to}\nSubject: ${msg.subject}\n${msg.text}\n`); return { providerId: null }; } };
}
// Test transport: keeps sent messages; `fail` can make sends throw.
export function memoryTransport() {
  const t = { name: 'memory', sent: [], fail: null, async send(msg) { if (t.fail) throw t.fail(msg); t.sent.push(msg); return { providerId: 'mem-' + t.sent.length }; } };
  return t;
}
export function createTransport() {
  if (config.emailTransport === 'resend') return resendTransport();
  if (config.emailTransport === 'brevo') return brevoTransport();
  if (config.emailTransport === 'log') return logTransport();
  return null;
}
export const emailEnabled = () => config.emailTransport !== 'off';

// ---------- templates
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function layout(title, lines, action) {
  const text = [title, '', ...lines, ...(action ? ['', `${action.label}: ${action.url}`] : []), '', 'Crateline marketplace. You received this because of activity on your account.'].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#e9ebed;font-family:Manrope,Segoe UI,Arial,sans-serif;color:#151a2d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:20px" cellpadding="0" cellspacing="0"><tr><td style="padding:32px">
<p style="margin:0 0 20px;font-weight:600;font-size:16px">Crateline</p>
<h1 style="margin:0 0 14px;font-size:22px;font-weight:500;letter-spacing:-0.02em">${esc(title)}</h1>
${lines.map(l => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3b4152">${esc(l)}</p>`).join('')}
${action ? `<p style="margin:22px 0"><a href="${esc(action.url)}" style="display:inline-block;background:#d2461f;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:999px;font-size:14px">${esc(action.label)}</a></p>
<p style="margin:0;font-size:12px;color:#6b6f76">If the button does not work, paste this address into your browser:<br>${esc(action.url)}</p>` : ''}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#6b6f76">You received this because of activity on your Crateline account.</p>
</td></tr></table></body></html>`;
  return { html, text };
}
const link = (param, token) => `${config.appUrl}/?${param}=${encodeURIComponent(token)}`;
export const templates = {
  verify: ({ name, token }) => ({ subject: 'Confirm your email address', ...layout('Confirm your email address', [`Hello ${name},`, 'Confirm this address to finish setting up your Crateline account. The link expires in 24 hours.'], { label: 'Confirm email address', url: link('verify', token) }) }),
  reset: ({ name, token }) => ({ subject: 'Reset your Crateline password', ...layout('Reset your password', [`Hello ${name},`, 'Someone asked to reset the password for this account. The link works once and expires in 30 minutes.', 'If it was not you, ignore this email. Your password stays the same.'], { label: 'Choose a new password', url: link('reset', token) }) }),
  staffInvite: ({ name, token, by, role }) => ({ subject: 'You have been added to the Crateline admin panel', ...layout('Set up your staff sign-in', [`Hello ${name},`, `${by} added you to the Crateline admin panel as ${role}.`, 'Choose a password to activate your sign-in. The link works once and expires in 72 hours. After that, sign in with this email address on the staff sign-in page.', 'If you were not expecting this, ignore this email.'], { label: 'Choose a password', url: link('reset', token) }) }),
  emailChange: ({ name, token }) => ({ subject: 'Confirm your new email address', ...layout('Confirm your new email address', [`Hello ${name},`, 'Confirm that you want to use this address for your Crateline account. Until you do, your current address stays active. The link expires in 24 hours.'], { label: 'Confirm new address', url: link('email', token) }) }),
  emailChanged: ({ name, newEmail }) => ({ subject: 'Your Crateline email address was changed', ...layout('Your email address was changed', [`Hello ${name},`, `Your account now uses ${newEmail}. If you did not make this change, contact Crateline support straight away.`]) }),
  passwordChanged: ({ name }) => ({ subject: 'Your Crateline password was changed', ...layout('Your password was changed', [`Hello ${name},`, 'Your password was changed and other sessions were signed out. If you did not do this, reset your password and contact support.']) }),
  twoFactorOn: ({ name }) => ({ subject: 'Two-factor sign-in is on', ...layout('Two-factor sign-in is on', [`Hello ${name},`, 'Signing in to your Crateline account now needs a code from your authenticator app. Keep your recovery codes somewhere safe.', 'If you did not do this, reset your password and contact support straight away.']) }),
  twoFactorOff: ({ name }) => ({ subject: 'Two-factor sign-in was turned off', ...layout('Two-factor sign-in was turned off', [`Hello ${name},`, 'Your account no longer asks for an authenticator code when you sign in.', 'If you did not do this, reset your password, turn two-factor sign-in back on and contact support.']) }),
  notification: ({ name, text }) => ({ subject: text.length > 70 ? text.slice(0, 67) + '…' : text, ...layout('Update on your account', [`Hello ${name},`, text]) , }),
};
// A queued email: { to, template, subject, html, text, dedupeKey? }.
export function compose(template, to, data, dedupeKey = null) { return { to: to.toLowerCase(), template, dedupeKey, ...templates[template](data) }; }

// Notification emails for notifications created by a transaction, to customers who chose
// "Also send by email". Built from the difference between the document before and after.
export function notificationEmails(before, after) {
  if (!emailEnabled()) return [];
  const old = new Set((before.notifications || []).map(n => n.id));
  return (after.notifications || []).filter(n => !old.has(n.id)).flatMap(n => {
    const u = after.users?.[n.userId];
    // Queued once, in the transaction that creates the notification. No dedupe key: notification
    // ids restart after a demo reset, so an id-based key would silently drop new emails.
    return u?.email && u.prefs?.email && u.emailVerified ? [compose('notification', u.email, { name: u.name.split(' ')[0], text: n.text })] : [];
  });
}

// ---------- outbox worker
// Retry delays after each failed attempt; after the last one the email is marked failed.
export const BACKOFF_MS = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 12 * 3600e3];
export async function processOutbox(store, transport, { limit = 20, now = Date.now() } = {}) {
  if (!transport) return { sent: 0, failed: 0 };
  const batch = await store.claimEmails(limit, now);
  let sent = 0, failed = 0;
  for (const m of batch) {
    // One log line per attempt (recipient masked), so delivery problems can be read from the server log.
    const who = String(m.to).replace(/^(.).*(@.*)$/, '$1***$2');
    try { const r = await transport.send(m); await store.markEmailSent(m.id, r.providerId, Date.now()); sent++; if (transport.name !== 'log' && transport.name !== 'memory') console.log(`email sent: ${m.template} to ${who} (${transport.name} ${r.providerId || 'no id'})`); }
    catch (e) {
      const attempts = m.attempts + 1; const giveUp = e.permanent || attempts > BACKOFF_MS.length;
      console.error(`email not sent: ${m.template} to ${who}, attempt ${attempts}${giveUp ? ', giving up' : ', will retry'}: ${e.message}`);
      await store.markEmailFailed(m.id, attempts, giveUp ? null : now + BACKOFF_MS[attempts - 1], String(e.message).slice(0, 500));
      failed++;
    }
  }
  return { sent, failed };
}
