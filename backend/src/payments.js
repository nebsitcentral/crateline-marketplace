// Crypto payments through NOWPayments. The buyer pays on NOWPayments' hosted invoice page; the
// only thing that marks a purchase paid is their signed notification (IPN) to our webhook.
import crypto from 'node:crypto';
import { config } from './config.js';

// NOWPayments payment_status -> the status the domain understands (paymentProviderEvent).
// 'waiting' (invoice opened, nothing sent yet) is not listed and is ignored.
export const STATUS = { confirming: 'processing', confirmed: 'processing', sending: 'processing', finished: 'paid', partially_paid: 'partial', failed: 'failed', expired: 'expired', refunded: 'refunded' };

// NOWPayments signs the JSON body with its keys sorted, at every level.
const sorted = v => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
export const signBody = (body, secret) => crypto.createHmac('sha512', secret).update(JSON.stringify(sorted(body))).digest('hex');

// NOWPayments payout status (sent uppercase in notifications) -> payoutProviderEvent outcome.
// Only finished and rejected are final; 'failed' may still be retried on their side, so it is
// treated as unknown and the funds stay reserved until it is settled.
export const PAYOUT_STATUS = { finished: 'success', rejected: 'failure', failed: 'unknown' };

export function nowPayments({ apiKey = config.nowpayments.apiKey, ipnSecret = config.nowpayments.ipnSecret, sandbox = config.nowpayments.sandbox, email = config.nowpayments.email, password = config.nowpayments.password, fetchImpl = fetch } = {}) {
  const base = sandbox ? 'https://api-sandbox.nowpayments.io/v1' : 'https://api.nowpayments.io/v1';
  // Payout calls. A thrown error says whether the transfer certainly did not happen (`refused`,
  // with the provider's own message) or whether we cannot know (`unknown`: no answer, or a 5xx).
  const payoutCall = async (path, { method = 'GET', body, token } = {}) => {
    let res;
    try { res = await fetchImpl(base + path, { method, headers: { 'x-api-key': apiKey, 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw Object.assign(new Error('NOWPayments could not be reached.'), { unknown: true }); }
    const text = await res.text().catch(() => ''); let data; try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) }; }
    if (res.status >= 500) throw Object.assign(new Error(`NOWPayments answered with an error (${res.status}).`), { unknown: true });
    if (!res.ok) throw Object.assign(new Error(String(data?.message || `Request refused (${res.status}).`).slice(0, 300)), { refused: true });
    return data;
  };
  // Payout requests need a short-lived token from the account's sign-in details.
  const token = async () => { try { return (await payoutCall('/auth', { method: 'POST', body: { email, password } })).token; } catch (e) { throw Object.assign(e, { refused: true, unknown: false, message: 'Sign-in to NOWPayments failed: ' + e.message }); } };
  return {
    canPayOut: !!(email && password),
    // Creates one transfer of `usd` US dollars' worth of `currency` to `address`. Returns { batchId }.
    async createPayout({ address, currency, usd, ref, description, callbackUrl }) {
      const t = await token();
      const b = await payoutCall('/payout', { method: 'POST', token: t, body: { ipn_callback_url: callbackUrl, payout_description: description, withdrawals: [{ address, currency, amount: usd, fiat_amount: usd, fiat_currency: 'usd', ipn_callback_url: callbackUrl, unique_external_id: ref }] } });
      if (!b?.id) throw Object.assign(new Error('NOWPayments did not return a payout id.'), { unknown: true });
      return { batchId: String(b.id) };
    },
    // Confirms a created transfer with the account's two-factor code. False if the code was refused.
    async verifyPayout(batchId, code) {
      const t = await token();
      try { await payoutCall(`/payout/${encodeURIComponent(batchId)}/verify`, { method: 'POST', token: t, body: { verification_code: code } }); return true; }
      catch (e) { if (e.refused) return false; throw e; }
    },
    // The transfer's current state at the provider: { status (lowercase), hash, address }.
    async payoutStatus(batchId) {
      const b = await payoutCall(`/payout/${encodeURIComponent(batchId)}`); const w = (Array.isArray(b) ? b : b?.withdrawals || [])[0];
      if (!w) throw Object.assign(new Error('NOWPayments has no record of this payout.'), { refused: true });
      return { status: String(w.status || '').toLowerCase(), hash: w.hash || null, address: w.address || null };
    },
    name: 'NOWPayments', sandbox,
    // Creates a hosted invoice for the purchase total in USD. Returns { id, url }.
    async createInvoice({ purchaseId, amount, description, callbackUrl, returnUrl }) {
      let res;
      try {
        res = await fetchImpl(base + '/invoice', { method: 'POST', headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({ price_amount: amount, price_currency: 'usd', order_id: purchaseId, order_description: description, ipn_callback_url: callbackUrl, success_url: returnUrl, cancel_url: returnUrl }) });
      } catch (e) { throw Object.assign(new Error('The payment provider could not be reached. Try again in a minute.'), { status: 502 }); }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.invoice_url) { console.error('NOWPayments invoice refused', res.status, body); throw Object.assign(new Error('The payment provider refused the request. Try again, or contact support.'), { status: 502 }); }
      return { id: String(body.id), url: body.invoice_url };
    },
    // True only for a body signed with our IPN secret.
    verify(body, signature) {
      if (!body || typeof body !== 'object' || typeof signature !== 'string') return false;
      const want = Buffer.from(signBody(body, ipnSecret)); const got = Buffer.from(signature.trim().toLowerCase());
      return want.length === got.length && crypto.timingSafeEqual(want, got);
    },
  };
}
export function createPayments() { return config.payments === 'nowpayments' ? nowPayments() : null; }
