// Crypto payouts through NOWPayments: destination verification, sending with the two-factor code,
// signed result notifications, and what happens when the provider refuses or does not answer.
// The provider's HTTP API is faked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || ''; process.env.SEED_DEMO_PASSWORD = 'test-pass-123'; process.env.SIMULATE_PROVIDERS = 'true';
process.env.AUTH_RATE_LIMIT = '1000'; process.env.PAYMENTS = 'nowpayments'; process.env.PAYOUTS = 'nowpayments'; process.env.API_URL = 'https://api.example.com';
const { createStore } = await import('../src/store.js');
const { seedStore } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { migrate } = await import('../src/migrate.js');
const { nowPayments, signBody } = await import('../src/payments.js');
const { storeBuckets } = await import('@crateline/domain/fin.js');

const SECRET = 'ipn-secret'; const ADDRESS = 'TEmGwPeRTPiLFLVfBxXkSP91yc5GMNQhfS'; const calls = []; let create = 'ok'; let batch = 5000;
const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
// Fake NOWPayments: /auth, POST /payout (per `create`), POST /payout/:id/verify (code 123456), GET /payout/:id.
const fetchImpl = async (url, opts) => {
  const path = url.replace('https://api.nowpayments.io/v1', ''); const body = opts.body ? JSON.parse(opts.body) : null; calls.push({ path, method: opts.method, body, headers: opts.headers });
  if (path === '/auth') return body.email === 'owner@example.com' && body.password === 'pw' ? json(200, { token: 'jwt-1' }) : json(403, { message: 'Invalid credentials' });
  if (path === '/payout') { if (create === 'refuse') return json(400, { message: 'IP address is not whitelisted.' }); if (create === 'silent') throw new Error('socket hang up'); return json(200, { id: String(++batch), withdrawals: [{ id: 'w' + batch, status: 'CREATING' }] }); }
  if (path.endsWith('/verify')) return body.verification_code === '123456' ? json(200, 'OK') : json(400, { message: 'Invalid verification code' });
  return json(200, { id: path.split('/').pop(), withdrawals: [{ status: 'SENDING', address: ADDRESS, hash: null }] });
};
let server, base, store;
before(async () => { if (process.env.DATABASE_URL) await migrate(); store = createStore(); await store.init(); await seedStore(store, { force: true }); server = createApp(store, { payments: nowPayments({ apiKey: 'key-1', ipnSecret: SECRET, sandbox: false, email: 'owner@example.com', password: 'pw', fetchImpl }) }).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); await store.close(); });
const req = async (path, { method = 'GET', body, token, headers = {} } = {}) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const post = (path, body, token) => req(path, { method: 'POST', body, token });
const login = async (email, staff) => (await post(staff ? '/api/auth/staff/login' : '/api/auth/login', { email, password: 'test-pass-123' })).body.token;
const act = (token, name, args) => post('/api/actions/' + name, { args }, token);
const state = async token => (await req('/api/state', { token })).body.view;
const ipn = body => req('/api/webhooks/nowpayments', { method: 'POST', body, headers: { 'x-nowpayments-sig': signBody(body, SECRET) } });
const atlas = async () => storeBuckets((await store.read()).doc, 'st_atlas');
const creates = () => calls.filter(c => c.path === '/payout');
// Rafi requests USD 50 to his verified wallet and Finance approves it. Returns the payout.
async function approvedPayout(rafi, felix) {
  const m = (await state(rafi)).payoutMethods.find(x => x.address === ADDRESS);
  const r = await act(rafi, 'requestPayout', { methodId: m.id, amountC: 5000 }); assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = (await state(felix)).payouts.find(x => x.id === r.body.result.payoutId);
  const ok = await act(felix, 'decideApproval', { approvalId: p.approvalId, decision: 'approve', reason: 'Balance and destination checked' }); assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return (await state(felix)).payouts.find(x => x.id === p.id);
}

test('a crypto destination needs a valid address and Finance verification before it can be used', async () => {
  const rafi = await login('rafi@atlas.example'); const felix = await login('felix.fin-01@staff.example.com', true);
  const add = acct => post('/api/payout-methods', { type: 'Crypto', holder: 'Rafi Ahmed', acct, net: 'USDT TRC-20', password: 'test-pass-123' }, rafi);
  assert.equal((await add('0x1EBAeF7Bee7B3a7B2EEfC72e86593Bf15ED37522')).status, 422); // an Ethereum address on Tron
  assert.equal((await add(ADDRESS)).status, 201);
  assert.equal((await add(ADDRESS)).status, 422); // already added
  const m = (await state(rafi)).payoutMethods.find(x => x.address === ADDRESS); assert.equal(m.verified, false); assert.equal(m.net, 'USDT TRC-20');
  assert.equal((await act(rafi, 'requestPayout', { methodId: m.id, amountC: 5000 })).status, 400);
  assert.equal((await act(rafi, 'verifyPayoutMethod', { storeId: 'st_atlas', methodId: m.id, reason: 'mine' })).status, 404); // not a customer action
  assert.equal((await act(await login('sam.sup-01@staff.example.com', true), 'verifyPayoutMethod', { storeId: 'st_atlas', methodId: m.id, reason: 'x' })).status, 403);
  assert.equal((await act(felix, 'verifyPayoutMethod', { storeId: 'st_atlas', methodId: m.id, reason: 'Address whitelisted at NOWPayments' })).status, 200);
  assert.equal((await state(rafi)).payoutMethods.find(x => x.id === m.id).verified, true);
});

test('a refused transfer can be sent again; an unanswered one keeps the funds reserved until reconciled', async () => {
  const rafi = await login('rafi@atlas.example'); const felix = await login('felix.fin-01@staff.example.com', true);
  const b0 = await atlas(); // the fixtures already hold one reserved payout for Atlas
  const p = await approvedPayout(rafi, felix); const held = b0.reserved + 5000; assert.equal((await atlas()).reserved, held);
  // The simulated execution is not available for a real transfer, and a code is required.
  assert.equal((await act(felix, 'executePayout', { payoutId: p.id, version: p.version })).status, 400);
  assert.equal((await post(`/api/payouts/${p.id}/execute`, { version: p.version }, felix)).status, 422);
  assert.equal((await post(`/api/payouts/${p.id}/execute`, { version: p.version, code: '123456' }, rafi)).status, 403);
  assert.equal(creates().length, 0);
  // Refused by the provider: nothing sent, Approved again.
  create = 'refuse';
  const r1 = await post(`/api/payouts/${p.id}/execute`, { version: p.version, code: '123456' }, felix);
  assert.equal(r1.status, 400); assert.match(r1.body.error, /IP address is not whitelisted\. Nothing was sent/);
  let cur = (await state(felix)).payouts.find(x => x.id === p.id); assert.equal(cur.status, 'Approved'); assert.equal((await atlas()).reserved, held);
  // No answer: unknown. Funds stay reserved and it cannot be sent again.
  create = 'silent';
  assert.equal((await post(`/api/payouts/${p.id}/execute`, { version: cur.version, code: '123456' }, felix)).status, 502);
  cur = (await state(felix)).payouts.find(x => x.id === p.id); assert.equal(cur.status, 'Reconciliation required'); assert.equal((await atlas()).reserved, held);
  create = 'ok'; const n = creates().length;
  assert.equal((await post(`/api/payouts/${p.id}/execute`, { version: cur.version, code: '123456' }, felix)).status, 400);
  assert.equal(creates().length, n);
  assert.equal((await post(`/api/payouts/${p.id}/status`, {}, felix)).status, 400); // no provider id to look up
  // Finance checks the provider's dashboard and settles it by hand.
  assert.equal((await act(felix, 'reconcilePayout', { payoutId: p.id, outcome: 'paid', reason: 'x' })).status, 422); // needs the reference
  assert.equal((await act(felix, 'reconcilePayout', { payoutId: p.id, outcome: 'not_sent', reason: 'No such payout in the NOWPayments dashboard' })).status, 200);
  assert.equal((await state(felix)).payouts.find(x => x.id === p.id).status, 'Failed');
  const b = await atlas(); assert.equal(b.reserved, b0.reserved); assert.equal(b.available, b0.available);
});

test('a transfer is created once, confirmed with the code, and paid only by the signed notification', async () => {
  const rafi = await login('rafi@atlas.example'); const felix = await login('felix.fin-01@staff.example.com', true);
  const b0 = await atlas(); const p = await approvedPayout(rafi, felix); const n = creates().length;
  // Wrong code: the transfer exists at the provider but is not confirmed.
  const r1 = await post(`/api/payouts/${p.id}/execute`, { version: p.version, code: '000000' }, felix); assert.equal(r1.status, 422); assert.equal(r1.body.field, 'code');
  let cur = (await state(felix)).payouts.find(x => x.id === p.id); assert.equal(cur.status, 'Processing'); assert.equal(cur.awaitingCode, true);
  const made = creates().slice(n); assert.equal(made.length, 1); assert.equal(made[0].headers.Authorization, 'Bearer jwt-1');
  assert.deepEqual(made[0].body.withdrawals, [{ address: ADDRESS, currency: 'usdttrc20', amount: (p.amountC - p.feeC) / 100, fiat_amount: (p.amountC - p.feeC) / 100, fiat_currency: 'usd', ipn_callback_url: 'https://api.example.com/api/webhooks/nowpayments', unique_external_id: p.opRef }]);
  // Executing again never creates a second transfer; a new code confirms the first one.
  assert.equal((await post(`/api/payouts/${p.id}/execute`, { version: cur.version, code: '123456' }, felix)).status, 400);
  assert.equal(creates().length, n + 1);
  assert.equal((await post(`/api/payouts/${p.id}/verify`, { code: '123456' }, felix)).status, 200);
  cur = (await state(felix)).payouts.find(x => x.id === p.id); assert.equal(cur.awaitingCode, false); assert.equal(cur.providerBatch, String(batch));
  assert.equal((await post(`/api/payouts/${p.id}/verify`, { code: '123456' }, felix)).status, 400);
  // The demo result button cannot settle a real transfer; asking the provider while it is sending changes nothing.
  assert.equal((await act(felix, 'payoutProviderEvent', { payoutId: p.id, outcome: 'success' })).status, 403);
  assert.equal((await post(`/api/payouts/${p.id}/status`, {}, felix)).body.providerStatus, 'sending');
  assert.equal((await atlas()).reserved, b0.reserved + 5000);
  // Notifications: unsigned is refused; an in-between status is ignored; finished pays it once.
  const done = { id: 'w' + batch, batch_withdrawal_id: String(batch), status: 'FINISHED', address: ADDRESS, hash: '0xabc', currency: 'usdttrc20', amount: '48' };
  assert.equal((await post('/api/webhooks/nowpayments', done)).status, 401);
  assert.equal((await ipn({ ...done, status: 'SENDING' })).body.result, 'ignored');
  assert.equal((await ipn({ ...done, batch_withdrawal_id: '999' })).body.result, 'unknown');
  assert.equal((await ipn(done)).body.result, 'success');
  assert.equal((await ipn(done)).body.result, 'duplicate');
  cur = (await state(felix)).payouts.find(x => x.id === p.id); assert.equal(cur.status, 'Paid'); assert.equal(cur.providerRef, '0xabc');
  const b = await atlas(); assert.equal(b.reserved, b0.reserved); assert.equal(b.available, b0.available - 5000); assert.equal(b.paidOut, b0.paidOut + 5000);
});

test('a notification for a different address than the approved one does not mark the payout paid', async () => {
  const rafi = await login('rafi@atlas.example'); const felix = await login('felix.fin-01@staff.example.com', true);
  const b0 = await atlas(); const p = await approvedPayout(rafi, felix);
  assert.equal((await post(`/api/payouts/${p.id}/execute`, { version: p.version, code: '123456' }, felix)).status, 200);
  assert.equal((await ipn({ id: 'w', batch_withdrawal_id: String(batch), status: 'FINISHED', address: 'TXYZ', hash: '0xdef' })).body.result, 'unknown');
  assert.equal((await state(felix)).payouts.find(x => x.id === p.id).status, 'Reconciliation required');
  assert.equal((await atlas()).reserved, b0.reserved + 5000);
});
