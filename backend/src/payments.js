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

export function nowPayments({ apiKey = config.nowpayments.apiKey, ipnSecret = config.nowpayments.ipnSecret, sandbox = config.nowpayments.sandbox, fetchImpl = fetch } = {}) {
  const base = sandbox ? 'https://api-sandbox.nowpayments.io/v1' : 'https://api.nowpayments.io/v1';
  return {
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
