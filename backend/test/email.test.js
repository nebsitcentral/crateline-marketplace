// Transactional email: verification, password reset, email change, notification emails, the
// outbox worker (retries and backoff) and the Brevo request format. Uses an in-memory transport.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || ''; process.env.SEED_DEMO_PASSWORD = 'test-pass-123'; process.env.SIMULATE_PROVIDERS = 'true';
process.env.AUTH_RATE_LIMIT = '1000'; process.env.EMAIL_TRANSPORT = 'log'; process.env.APP_URL = 'https://shop.example.com';
const { createStore } = await import('../src/store.js');
const { seedStore } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { migrate } = await import('../src/migrate.js');
const { memoryTransport, brevoTransport, resendTransport, processOutbox, BACKOFF_MS, compose } = await import('../src/email.js');

let server, base, store; const transport = memoryTransport();
before(async () => { if (process.env.DATABASE_URL) await migrate(); store = createStore(); await store.init(); await seedStore(store, { force: true }); server = createApp(store, { transport }).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); await store.close(); });
const req = async (path, { method = 'GET', body, token } = {}) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const post = (path, body, token) => req(path, { method: 'POST', body, token });
const login = async (email, password = 'test-pass-123') => (await post('/api/auth/login', { email, password })).body.token;
// Waits for the outbox to deliver and returns the newest email to `to` with this template.
async function mailTo(to, template) {
  for (let i = 0; i < 50; i++) {
    await processOutbox(store, transport);
    const m = transport.sent.filter(x => x.to === to && x.template === template).at(-1); if (m) return m;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error(`no ${template} email to ${to}`);
}
const tokenIn = (m, param) => decodeURIComponent(m.text.match(new RegExp(`\\?${param}=([^\\s]+)`))[1]);

test('registration sends a verification link; the link verifies once', async () => {
  const r = await post('/api/auth/register', { name: 'Vera Lane', username: 'vera_l', email: 'Vera@Example.com', password: 'verapass1', acceptTerms: true });
  assert.equal(r.status, 201);
  const m = await mailTo('vera@example.com', 'verify');
  assert.match(m.text, /https:\/\/shop\.example\.com\/\?verify=/); assert.match(m.html, /Confirm email address/);
  const token = tokenIn(m, 'verify');
  assert.equal((await req('/api/state', { token: r.body.token })).body.view.me.emailVerified, false);
  assert.equal((await post('/api/auth/verify/confirm', { token })).status, 200);
  assert.equal((await req('/api/state', { token: r.body.token })).body.view.me.emailVerified, true);
  assert.equal((await post('/api/auth/verify/confirm', { token })).status, 400); // single use
  assert.equal((await post('/api/auth/verify/confirm', { token: 'made-up' })).status, 400);
  assert.equal((await post('/api/auth/verify/request', {}, r.body.token)).status, 400); // already verified
});

test('password reset: same answer for unknown accounts, link works once, every session ends', async () => {
  const before = transport.sent.length;
  assert.equal((await post('/api/auth/password/forgot', { email: 'nobody@example.com' })).status, 200);
  await processOutbox(store, transport); assert.equal(transport.sent.length, before); // nothing sent
  const old = await login('linao@example.com');
  assert.equal((await post('/api/auth/password/forgot', { email: 'linao@example.com' })).status, 200);
  const token = tokenIn(await mailTo('linao@example.com', 'reset'), 'reset');
  assert.equal((await post('/api/auth/password/reset', { token, password: 'short' })).status, 422);
  const ok = await post('/api/auth/password/reset', { token, password: 'brandnew42' });
  assert.equal(ok.status, 200); assert.equal(ok.body.kind, 'user');
  assert.equal((await req('/api/state', { token: old })).status, 401); // old session ended
  assert.ok(await login('linao@example.com', 'brandnew42'));
  assert.equal((await post('/api/auth/login', { email: 'linao@example.com', password: 'test-pass-123' })).status, 401);
  assert.equal((await post('/api/auth/password/reset', { token, password: 'another42' })).status, 400); // used
  await mailTo('linao@example.com', 'passwordChanged');
});

test('a reset link expires after 30 minutes; staff can reset too', async () => {
  await post('/api/auth/password/forgot', { email: 'omar.ops-01@staff.example.com' });
  const token = tokenIn(await mailTo('omar.ops-01@staff.example.com', 'reset'), 'reset');
  const realNow = Date.now; Date.now = () => realNow() + 31 * 60e3;
  try { assert.equal((await post('/api/auth/password/reset', { token, password: 'staffpass9' })).status, 400); }
  finally { Date.now = realNow; }
  await post('/api/auth/password/forgot', { email: 'omar.ops-01@staff.example.com' });
  const fresh = tokenIn(await mailTo('omar.ops-01@staff.example.com', 'reset'), 'reset');
  const r = await post('/api/auth/password/reset', { token: fresh, password: 'staffpass9' }); assert.equal(r.body.kind, 'staff');
  assert.equal((await post('/api/auth/staff/login', { email: 'omar.ops-01@staff.example.com', password: 'staffpass9' })).status, 200);
});

test('email change: needs the password, confirmed from the new address, old address told', async () => {
  const t = await login('samir@example.com');
  assert.equal((await post('/api/auth/email/change', { newEmail: 'sam2@example.com', password: 'wrong' }, t)).body.field, 'password');
  assert.equal((await post('/api/auth/email/change', { newEmail: 'mira@example.com', password: 'test-pass-123' }, t)).body.field, 'email'); // taken
  assert.equal((await post('/api/auth/email/change', { newEmail: 'Sam2@Example.com', password: 'test-pass-123' }, t)).status, 200);
  const token = tokenIn(await mailTo('sam2@example.com', 'emailChange'), 'email');
  assert.equal((await req('/api/state', { token: t })).body.view.me.email, 'samir@example.com'); // unchanged until confirmed
  assert.equal((await post('/api/auth/email/confirm', { token })).status, 200);
  assert.equal((await req('/api/state', { token: t })).body.view.me.email, 'sam2@example.com');
  assert.ok(await login('sam2@example.com')); assert.equal((await post('/api/auth/login', { email: 'samir@example.com', password: 'test-pass-123' })).status, 401);
  const told = await mailTo('samir@example.com', 'emailChanged'); assert.match(told.text, /sam2@example\.com/);
});

test('notification emails go only to verified customers who chose email', async () => {
  const mira = await login('mira@example.com'); const rafi = await login('rafi@atlas.example');
  const act = (token, name, args) => post('/api/actions/' + name, { args }, token);
  const conv = (await req('/api/state', { token: mira })).body.view.conversations.find(c => c.storeId === 'st_atlas');
  await act(mira, 'setPreference', { key: 'email', value: true });
  await act(rafi, 'sendMessage', { conversationId: conv.id, text: 'Your file is ready.' });
  const m = await mailTo('mira@example.com', 'notification'); assert.match(m.subject, /New message from Atlas/);
  await act(mira, 'setPreference', { key: 'email', value: false });
  const count = transport.sent.filter(x => x.to === 'mira@example.com' && x.template === 'notification').length;
  await act(rafi, 'sendMessage', { conversationId: conv.id, text: 'Second note.' }); await processOutbox(store, transport);
  assert.equal(transport.sent.filter(x => x.to === 'mira@example.com' && x.template === 'notification').length, count);
});

test('outbox retries with backoff and stops after the last attempt; permanent errors stop at once', async () => {
  // Queued directly (no request), so only this test's transports see them.
  const queue = to => store.transact(async (d, tx) => { await tx.queueEmail(compose('passwordChanged', to, { name: 'Test' })); });
  const t = memoryTransport(); t.fail = () => Object.assign(new Error('provider down'), { permanent: false });
  await queue('retry@example.com');
  let now = Date.now() + 1;
  assert.deepEqual(await processOutbox(store, t, { now }), { sent: 0, failed: 1 });
  assert.deepEqual(await processOutbox(store, t, { now: now + 1000 }), { sent: 0, failed: 0 }); // waits for its backoff
  for (const wait of BACKOFF_MS) { now += wait + 1; assert.deepEqual(await processOutbox(store, t, { now }), { sent: 0, failed: 1 }); }
  assert.deepEqual(await processOutbox(store, t, { now: now + 30 * 24 * 3600e3 }), { sent: 0, failed: 0 }); // given up
  const p = memoryTransport(); p.fail = () => Object.assign(new Error('invalid recipient'), { permanent: true });
  await queue('bad@example.com');
  assert.deepEqual(await processOutbox(store, p), { sent: 0, failed: 1 });
  assert.deepEqual(await processOutbox(store, p, { now: Date.now() + 365 * 24 * 3600e3 }), { sent: 0, failed: 0 });
  // a later success is delivered normally
  await queue('fine@example.com'); const ok = memoryTransport();
  assert.deepEqual(await processOutbox(store, ok), { sent: 1, failed: 0 }); assert.equal(ok.sent[0].to, 'fine@example.com');
});

test('Resend transport sends the documented request and classifies failures', async () => {
  const calls = []; const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ id: 'e-123' }) }; };
  const t = resendTransport({ apiKey: 're_test', from: 'no-reply@shop.example.com', fromName: 'Crateline', fetchImpl });
  const r = await t.send({ to: 'a@x.com', template: 'verify', subject: 'Hi', html: '<p>h</p>', text: 't' });
  assert.equal(r.providerId, 'e-123');
  assert.equal(calls[0].url, 'https://api.resend.com/emails'); assert.equal(calls[0].init.headers.authorization, 'Bearer re_test');
  assert.deepEqual(JSON.parse(calls[0].init.body), { from: 'Crateline <no-reply@shop.example.com>', to: ['a@x.com'], subject: 'Hi', html: '<p>h</p>', text: 't', tags: [{ name: 'template', value: 'verify' }] });
  const fail = status => resendTransport({ apiKey: 'k', from: 'f@x.com', fetchImpl: async () => ({ ok: false, status, text: async () => 'nope' }) }).send({ to: 'a@x.com', template: 't', subject: 's', html: 'h', text: 't' });
  await assert.rejects(fail(422), e => e.permanent === true);
  await assert.rejects(fail(429), e => e.permanent === false);
  await assert.rejects(fail(500), e => e.permanent === false);
  await assert.rejects(resendTransport({ apiKey: 'k', from: 'f@x.com', fetchImpl: async () => { throw new Error('down'); } }).send({ to: 'a@x.com', template: 't', subject: 's', html: 'h', text: 't' }), e => e.permanent === false);
});

test('Brevo transport sends the documented request and classifies failures', async () => {
  const calls = []; const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ messageId: '<abc@brevo>' }) }; };
  const b = brevoTransport({ apiKey: 'xkeysib-test', from: 'hello@shop.example.com', fromName: 'Crateline', fetchImpl });
  const r = await b.send({ to: 'a@example.com', template: 'verify', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' });
  assert.equal(r.providerId, '<abc@brevo>');
  assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email'); assert.equal(calls[0].init.headers['api-key'], 'xkeysib-test');
  assert.deepEqual(JSON.parse(calls[0].init.body), { sender: { name: 'Crateline', email: 'hello@shop.example.com' }, to: [{ email: 'a@example.com' }], subject: 'Hi', htmlContent: '<p>Hi</p>', textContent: 'Hi', tags: ['verify'] });
  const fail = status => brevoTransport({ apiKey: 'k', from: 'f@x.com', fetchImpl: async () => ({ ok: false, status, text: async () => 'nope' }) }).send({ to: 'a@x.com', template: 't', subject: 's', html: 'h', text: 't' });
  await assert.rejects(fail(400), e => e.permanent === true);
  await assert.rejects(fail(503), e => e.permanent === false);
  await assert.rejects(fail(401), e => e.permanent === false);
});
