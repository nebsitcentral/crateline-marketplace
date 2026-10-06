// Crypto payments through NOWPayments: invoice creation, signed notifications (IPN) and the rule
// that only a verified, full, exact payment creates orders. The provider's HTTP API is faked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || ''; process.env.SEED_DEMO_PASSWORD = 'test-pass-123'; process.env.SIMULATE_PROVIDERS = 'true';
process.env.AUTH_RATE_LIMIT = '1000'; process.env.PAYMENTS = 'nowpayments'; process.env.API_URL = 'https://api.example.com'; process.env.APP_URL = 'https://shop.example.com';
const { createStore } = await import('../src/store.js');
const { seedStore } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { migrate } = await import('../src/migrate.js');
const { nowPayments, signBody } = await import('../src/payments.js');

const SECRET = 'ipn-secret'; const calls = [];
const fetchImpl = async (url, opts) => { calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) }); return { ok: true, status: 200, json: async () => ({ id: 4500 + calls.length, invoice_url: 'https://nowpayments.io/payment/?iid=' + (4500 + calls.length) }) }; };
let server, base, store;
before(async () => { if (process.env.DATABASE_URL) await migrate(); store = createStore(); await store.init(); await seedStore(store, { force: true }); server = createApp(store, { payments: nowPayments({ apiKey: 'key-1', ipnSecret: SECRET, sandbox: false, fetchImpl }) }).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); await store.close(); });
const req = async (path, { method = 'GET', body, token, headers = {} } = {}) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const post = (path, body, token) => req(path, { method: 'POST', body, token });
const login = async (email, staff) => (await post(staff ? '/api/auth/staff/login' : '/api/auth/login', { email, password: 'test-pass-123' })).body.token;
const act = (token, name, args) => post('/api/actions/' + name, { args }, token);
const state = async token => (await req('/api/state', { token })).body.view;
// A notification as NOWPayments sends it, signed with `secret`.
const ipn = (fields, secret = SECRET) => { const body = { payment_id: 9001, payment_status: 'finished', price_currency: 'usd', pay_currency: 'usdttrc20', pay_amount: 44, actually_paid: 44, ...fields }; return req('/api/webhooks/nowpayments', { method: 'POST', body, headers: { 'x-nowpayments-sig': signBody(body, secret) } }); };
async function cryptoPurchase(mira) {
  const l = (await req('/api/catalog')).body.listings.find(x => x.storeId === 'st_atlas');
  // The requested outcome is ignored for a real payment.
  const co = await act(mira, 'checkout', { items: [{ listingId: l.id, pkgId: l.packages[0].id, count: 1, requirements: 'CSV' }], method: 'Crypto', outcome: 'success' });
  assert.equal(co.status, 200, JSON.stringify(co.body));
  return (await state(mira)).purchases.find(p => p.id === co.body.result.purchaseId);
}

test('the signature covers the body with sorted keys', () => {
  assert.equal(signBody({ b: 1, a: { d: 2, c: 3 } }, 's'), signBody({ a: { c: 3, d: 2 }, b: 1 }, 's'));
  assert.notEqual(signBody({ a: 1 }, 's'), signBody({ a: 2 }, 's'));
  const np = nowPayments({ apiKey: 'k', ipnSecret: 's' });
  assert.equal(np.verify({ a: 1 }, signBody({ a: 1 }, 's')), true);
  assert.equal(np.verify({ a: 1 }, signBody({ a: 1 }, 'other')), false);
  assert.equal(np.verify({ a: 1 }, undefined), false);
});

test('a crypto checkout waits for the provider; only its signed, exact notification creates orders', async () => {
  const mira = await login('mira@example.com');
  const p = await cryptoPurchase(mira);
  assert.equal(p.status, 'Pending'); assert.equal(p.provider, 'NOWPayments'); assert.equal(p.ordersCreated, false);
  // The demo confirmation cannot be used on a real payment.
  assert.equal((await act(mira, 'confirmPayment', { purchaseId: p.id })).status, 403);
  // The invoice is created once, for the purchase total, with our callback address.
  const s1 = await post(`/api/payments/${p.id}/start`, {}, mira); assert.equal(s1.status, 200, JSON.stringify(s1.body));
  const s2 = await post(`/api/payments/${p.id}/start`, {}, mira); assert.equal(s2.body.url, s1.body.url);
  const made = calls.filter(c => c.body.order_id === p.id); assert.equal(made.length, 1);
  assert.equal(made[0].url, 'https://api.nowpayments.io/v1/invoice'); assert.equal(made[0].headers['x-api-key'], 'key-1');
  assert.deepEqual(made[0].body, { price_amount: p.total, price_currency: 'usd', order_id: p.id, order_description: `Crateline purchase ${p.id}`, ipn_callback_url: 'https://api.example.com/api/webhooks/nowpayments', success_url: `https://shop.example.com/?paid=${p.id}`, cancel_url: `https://shop.example.com/?paid=${p.id}` });
  // Another customer cannot open this payment.
  assert.equal((await post(`/api/payments/${p.id}/start`, {}, await login('rafi@atlas.example'))).status, 404);

  // Wrong secret, or no signature: refused, nothing changes.
  assert.equal((await ipn({ order_id: p.id, price_amount: p.total }, 'wrong')).status, 401);
  assert.equal((await post('/api/webhooks/nowpayments', { order_id: p.id, payment_id: 1, payment_status: 'finished', price_amount: p.total, price_currency: 'usd' })).status, 401);
  assert.equal((await state(mira)).purchases.find(x => x.id === p.id).status, 'Pending');
  // Seen on the network but not final: still no order.
  assert.equal((await ipn({ order_id: p.id, price_amount: p.total, payment_status: 'confirming' })).body.result, 'processing');
  assert.equal((await state(mira)).purchases.find(x => x.id === p.id).ordersCreated, false);
  // Finished, but for a different price than the purchase: reconciliation, no order.
  assert.equal((await ipn({ order_id: p.id, price_amount: 1, payment_id: 9000 })).body.result, 'reconciliation');
  assert.equal((await state(mira)).purchases.find(x => x.id === p.id).status, 'Pending');

  // The real one.
  const before = (await state(mira)).orders.length;
  assert.equal((await ipn({ order_id: p.id, price_amount: p.total })).body.result, 'paid');
  const v = await state(mira); const paid = v.purchases.find(x => x.id === p.id);
  assert.equal(paid.status, 'Paid'); assert.equal(v.orders.length, before + 1);
  const o = v.orders.find(x => x.id === paid.orderIds[0]);
  assert.ok(o.events.some(e => e.text === 'Payment verified (Crypto, by NOWPayments)'));
  // Sent again: ignored. A second payment for the same purchase: reconciliation. Neither adds an order.
  assert.equal((await ipn({ order_id: p.id, price_amount: p.total })).body.result, 'duplicate');
  assert.equal((await ipn({ order_id: p.id, price_amount: p.total, payment_id: 9002 })).body.result, 'reconciliation');
  assert.equal((await state(mira)).orders.length, before + 1);
  // Finance sees the receipts that need a decision.
  const fin = await state(await login('felix.fin-01@staff.example.com', true));
  assert.deepEqual(fin.recon.filter(r => r.receipt?.network === 'NOWPayments').map(r => r.type), ['Amount mismatch', 'Duplicate payment']);
  const pay = fin.payments.find(x => x.purchaseId === p.id); assert.equal(pay.state, 'Paid'); assert.equal(pay.providerRef, String(4500 + calls.indexOf(made[0]) + 1));
});

test('an expired payment creates nothing; a payment that arrives later goes to reconciliation', async () => {
  const mira = await login('mira@example.com');
  const p = await cryptoPurchase(mira); const before = (await state(mira)).orders.length;
  assert.equal((await ipn({ order_id: p.id, price_amount: p.total, payment_id: 9100, payment_status: 'expired' })).body.result, 'expired');
  assert.equal((await state(mira)).purchases.find(x => x.id === p.id).status, 'Expired');
  assert.equal((await post(`/api/payments/${p.id}/start`, {}, mira)).status, 400);
  assert.equal((await ipn({ order_id: p.id, price_amount: p.total, payment_id: 9101 })).body.result, 'reconciliation');
  assert.equal((await ipn({ order_id: 'PG-nope', price_amount: 5 })).body.result, 'unknown');
  assert.equal((await state(mira)).orders.length, before);
});

test('an underpayment creates no order and tells the buyer', async () => {
  const mira = await login('mira@example.com'); const p = await cryptoPurchase(mira);
  assert.equal((await ipn({ order_id: p.id, price_amount: p.total, payment_id: 9200, payment_status: 'partially_paid', actually_paid: 40 })).body.result, 'reconciliation');
  const v = await state(mira); assert.equal(v.purchases.find(x => x.id === p.id).ordersCreated, false);
  assert.ok(v.notifications.some(n => n.text.includes('less than the full amount for ' + p.id)));
});
