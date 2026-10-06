// Seller identity verification through Didit. The seller completes the check on Didit's hosted
// page; we keep only the outcome and a few verified fields, never the documents. A signed webhook
// tells us a session changed; the result itself is always read from Didit's API with our key.
import crypto from 'node:crypto';
import { config } from './config.js';

const BASE = 'https://verification.didit.me/v3';
// Canonical JSON as Didit signs it (X-Signature-V2): whole floats as integers, keys sorted.
const shorten = v => Array.isArray(v) ? v.map(shorten) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shorten(x)])) : typeof v === 'number' && !Number.isInteger(v) && v % 1 === 0 ? Math.trunc(v) : v;
const sorted = v => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
const hmac = (s, secret) => crypto.createHmac('sha256', secret).update(s, 'utf8').digest('hex');
export const signV2 = (body, secret) => hmac(JSON.stringify(sorted(shorten(body))), secret);
export const signSimple = (b, secret) => hmac([b.timestamp ?? '', b.session_id ?? '', b.status ?? '', b.webhook_type ?? ''].join(':'), secret);
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(String(b || '').trim().toLowerCase()); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export function didit({ apiKey = config.didit.apiKey, webhookSecret = config.didit.webhookSecret, workflowId = config.didit.workflowId, fetchImpl = fetch } = {}) {
  const call = async (path, opts = {}) => {
    let res;
    try { res = await fetchImpl(BASE + path, { ...opts, headers: { 'x-api-key': apiKey, 'content-type': 'application/json' } }); }
    catch { throw Object.assign(new Error('The identity verification service could not be reached. Try again in a minute.'), { status: 502 }); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { console.error('Didit refused', path, res.status, body); throw Object.assign(new Error('The identity verification service refused the request. Try again, or contact support.'), { status: 502 }); }
    return body;
  };
  return {
    name: 'Didit',
    // Starts a hosted verification for a store. Returns { id, url }.
    async createSession({ storeId, returnUrl }) {
      const b = await call('/session/', { method: 'POST', body: JSON.stringify({ workflow_id: workflowId, vendor_data: storeId, callback: returnUrl }) });
      if (!b.session_id || !b.url) throw Object.assign(new Error('The identity verification service did not return a session. Try again.'), { status: 502 });
      return { id: b.session_id, url: b.url };
    },
    // The current outcome of a session, with the few verified fields staff need for review.
    async decision(sessionId) {
      const b = await call(`/session/${encodeURIComponent(sessionId)}/decision/`);
      const idv = b.id_verifications?.[0] || b.id_verification || null; const aml = b.aml_screenings?.[0] || b.aml || null;
      return { status: String(b.status || ''), storeId: b.vendor_data || null,
        result: idv ? { name: idv.full_name || [idv.first_name, idv.last_name].filter(Boolean).join(' '), dob: idv.date_of_birth || '', document: idv.document_type || '', country: idv.issuing_state || '', aml: aml?.status || null } : null };
    },
    // True for a webhook signed with our secret within the last 5 minutes.
    verify(body, headers, nowS = Math.floor(Date.now() / 1000)) {
      if (!body || typeof body !== 'object' || !webhookSecret) return false;
      if (!(Math.abs(nowS - parseInt(headers['x-timestamp'], 10)) <= 300)) return false;
      return (!!headers['x-signature-v2'] && same(signV2(body, webhookSecret), headers['x-signature-v2'])) || (!!headers['x-signature-simple'] && same(signSimple(body, webhookSecret), headers['x-signature-simple']));
    },
  };
}
export function createKyc() { return config.kyc === 'didit' ? didit() : null; }
