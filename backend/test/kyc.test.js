// Seller identity verification through Didit: session creation, signed webhooks, and the rule
// that the provider completes the identity check but never approves the store. Didit's API is faked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || ''; process.env.SEED_DEMO_PASSWORD = 'test-pass-123'; process.env.SIMULATE_PROVIDERS = 'true';
process.env.AUTH_RATE_LIMIT = '1000'; process.env.KYC = 'didit'; process.env.APP_URL = 'https://shop.example.com';
const { createStore } = await import('../src/store.js');
const { seedStore } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { migrate } = await import('../src/migrate.js');
const { didit, signV2, signSimple } = await import('../src/kyc.js');

const SECRET = 'whsec'; const calls = []; const decisions = {}; let n = 0;
// Fake Didit: POST /session/ opens a session; GET .../decision/ returns what the test set.
const fetchImpl = async (url, opts) => {
  calls.push({ url, method: opts.method || 'GET', headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null });
  if (url.endsWith('/v3/session/')) { const id = 'sess-' + (++n); decisions[id] = { session_id: id, status: 'Not Started', vendor_data: JSON.parse(opts.body).vendor_data }; return { ok: true, status: 201, json: async () => ({ session_id: id, url: 'https://verify.didit.me/en/session/' + id, status: 'Not Started' }) }; }
  const id = url.match(/session\/([^/]+)\/decision/)[1]; return decisions[id] ? { ok: true, status: 200, json: async () => decisions[id] } : { ok: false, status: 404, json: async () => ({}) };
};
let server, base, store;
before(async () => { if (process.env.DATABASE_URL) await migrate(); store = createStore(); await store.init(); await seedStore(store, { force: true }); server = createApp(store, { kyc: didit({ apiKey: 'key-1', webhookSecret: SECRET, workflowId: 'wf-1', fetchImpl }) }).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); await store.close(); });
const req = async (path, { method = 'GET', body, token, headers = {} } = {}) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const post = (path, body, token) => req(path, { method: 'POST', body, token });
const act = (token, name, args) => post('/api/actions/' + name, { args }, token);
const state = async token => (await req('/api/state', { token })).body.view;
const staff = async email => (await post('/api/auth/staff/login', { email, password: 'test-pass-123' })).body.token;
const hook = (fields, { secret = SECRET, at = Math.floor(Date.now() / 1000), simple = false } = {}) => { const body = { webhook_type: 'status.updated', timestamp: at, ...fields }; return req('/api/webhooks/didit', { method: 'POST', body, headers: { 'x-timestamp': String(at), ...(simple ? { 'x-signature-simple': signSimple(body, secret) } : { 'x-signature-v2': signV2(body, secret) }) } }); };
// A new customer who applies as a seller. No documents are attached.
async function applicant(tag) {
  const token = (await post('/api/auth/register', { name: 'Kyra Seller', username: 'kyra.' + tag, email: `kyra.${tag}@example.org`, password: 'passw0rd!', acceptTerms: true })).body.token;
  const r = await act(token, 'applyAsSeller', { name: 'Kyra Seller', dob: '1990-04-02', store: 'Kyra Data ' + tag, cat: 'data', types: [Object.values((await req('/api/catalog')).body.categories.find(c => c.id === 'data').subs)[0].id], desc: 'Verified business contact lists for outreach.', country: 'Bangladesh', city: 'Dhaka', addr: '12 Example Road' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { token, storeId: r.body.result.storeId };
}

test('the webhook signature covers the sorted body and whole floats as integers', () => {
  assert.equal(signV2({ b: 1.0, a: { d: 2, c: 'ü' } }, 's'), signV2({ a: { c: 'ü', d: 2 }, b: 1 }, 's'));
  const d = didit({ apiKey: 'k', webhookSecret: 's', workflowId: 'w' }); const now = 1774970000; const body = { session_id: 'x', status: 'Approved', webhook_type: 'status.updated', timestamp: now };
  assert.equal(d.verify(body, { 'x-timestamp': String(now), 'x-signature-v2': signV2(body, 's') }, now), true);
  assert.equal(d.verify(body, { 'x-timestamp': String(now), 'x-signature-simple': signSimple(body, 's') }, now), true);
  assert.equal(d.verify(body, { 'x-timestamp': String(now), 'x-signature-v2': signV2(body, 'other') }, now), false);
  assert.equal(d.verify(body, { 'x-timestamp': String(now), 'x-signature-v2': signV2(body, 's') }, now + 301), false); // too old
  assert.equal(d.verify(body, { 'x-signature-v2': signV2(body, 's') }, now), false); // no timestamp
});

test('a seller verifies with Didit; the result completes the identity check but staff still approve', async () => {
  const { token, storeId } = await applicant('a');
  let v = (await state(token)).verification;
  assert.equal(v.kyc.status, 'Not started'); assert.equal(v.checks.identity, false); assert.deepEqual(v.evidence, []);
  // The session is opened once, for this store, and comes back to the website.
  const s1 = await post('/api/kyc/start', {}, token); assert.equal(s1.status, 200, JSON.stringify(s1.body));
  assert.equal((await post('/api/kyc/start', {}, token)).body.url, s1.body.url);
  const made = calls.filter(c => c.method === 'POST'); assert.equal(made.length, 1);
  assert.equal(made[0].url, 'https://verification.didit.me/v3/session/'); assert.equal(made[0].headers['x-api-key'], 'key-1');
  assert.deepEqual(made[0].body, { workflow_id: 'wf-1', vendor_data: storeId, callback: 'https://shop.example.com/?kyc=1' });
  const sessionId = s1.body.url.split('/').pop();

  // Staff cannot tick the identity check by hand, and never receive the seller's session link.
  const vera = await staff('vera.ver-01@staff.example.com');
  const tick = await act(vera, 'sellerMarkCheck', { storeId, check: 'identity' }); assert.equal(tick.status, 400); assert.match(tick.body.error, /checked by Didit/);
  assert.equal((await state(vera)).verifications.find(x => x.storeId === storeId).kyc.url, null);

  // Unsigned, wrongly signed or stale webhooks change nothing.
  decisions[sessionId] = { session_id: sessionId, status: 'Approved', vendor_data: storeId, id_verifications: [{ status: 'Approved', full_name: 'Kyra Seller', date_of_birth: '1990-04-02', document_type: 'Passport', issuing_state: 'BGD' }], aml_screenings: [{ status: 'Approved' }] };
  assert.equal((await post('/api/webhooks/didit', { session_id: sessionId, status: 'Approved', vendor_data: storeId, webhook_type: 'status.updated' })).status, 401);
  assert.equal((await hook({ session_id: sessionId, status: 'Approved', vendor_data: storeId }, { secret: 'wrong' })).status, 401);
  assert.equal((await hook({ session_id: sessionId, status: 'Approved', vendor_data: storeId }, { at: Math.floor(Date.now() / 1000) - 900 })).status, 401);
  assert.equal((await state(token)).verification.checks.identity, false);
  // A signed webhook naming another store's id does not move this result there.
  assert.equal((await hook({ session_id: sessionId, status: 'Approved', vendor_data: 'st_atlas' })).body.result, 'unknown');

  // The signed webhook: the outcome is read from Didit and recorded.
  assert.equal((await hook({ session_id: sessionId, status: 'Approved', vendor_data: storeId })).body.result, 'Approved');
  assert.equal((await hook({ session_id: sessionId, status: 'Approved', vendor_data: storeId }, { simple: true })).body.result, 'unchanged');
  v = (await state(token)).verification;
  assert.equal(v.kyc.status, 'Approved'); assert.equal(v.checks.identity, true); assert.equal(v.checks.sanctions, true);
  assert.equal(v.state, 'Verification pending'); // not approved by the provider
  assert.equal((await post('/api/kyc/start', {}, token)).status, 400);
  // Verified fields are for staff with the evidence permission only.
  const seen = (await state(vera)).verifications.find(x => x.storeId === storeId);
  assert.deepEqual(seen.kyc.result, { name: 'Kyra Seller', dob: '1990-04-02', document: 'Passport', country: 'BGD', aml: 'Approved' });
  assert.equal((await state(await staff('omar.ops-01@staff.example.com'))).verifications.find(x => x.storeId === storeId).kyc.result, null);
  assert.ok(seen.decisions.some(x => x.by === 'Didit' && x.decision === 'Identity check: Approved'));
});

test('a declined check keeps identity outstanding; the seller can refresh and try again', async () => {
  const { token, storeId } = await applicant('b');
  const first = (await post('/api/kyc/start', {}, token)).body.url.split('/').pop();
  decisions[first] = { session_id: first, status: 'Declined', vendor_data: storeId, id_verifications: [{ status: 'Declined', first_name: 'Kyra', last_name: 'Seller' }] };
  // Back from Didit without waiting for the webhook.
  assert.equal((await post('/api/kyc/refresh', {}, token)).body.status, 'Declined');
  const v = (await state(token)).verification; assert.equal(v.checks.identity, false);
  assert.ok((await state(token)).notifications.some(x => /identity check was not accepted/.test(x.text)));
  // Approval is refused while the identity check is outstanding.
  const vera = await staff('vera.ver-01@staff.example.com');
  const ap = await act(vera, 'sellerApprove', { storeId, reason: 'Looks fine', message: 'Welcome', version: (await state(vera)).verifications.find(x => x.storeId === storeId).version });
  assert.equal(ap.status, 400); assert.match(ap.body.error, /identity/);
  // A new attempt opens a new session.
  const second = (await post('/api/kyc/start', {}, token)).body.url.split('/').pop(); assert.notEqual(second, first);
  // The old session's result no longer applies.
  decisions[first].status = 'Approved'; assert.equal((await hook({ session_id: first, status: 'Approved', vendor_data: storeId })).body.result, 'unknown');
  assert.equal((await state(token)).verification.checks.identity, false);
});

test('accounts without a provider check cannot use the endpoints', async () => {
  const rafi = (await post('/api/auth/login', { email: 'rafi@atlas.example', password: 'test-pass-123' })).body.token;
  assert.equal((await post('/api/kyc/start', {}, rafi)).status, 400); // seeded store, verified before Didit
  assert.equal((await post('/api/kyc/start', {})).status, 401);
});
