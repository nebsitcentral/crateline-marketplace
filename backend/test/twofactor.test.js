// Two-factor sign-in: TOTP against the RFC 6238 test vectors, set-up, the two-step sign-in,
// replay protection, recovery codes, ticket expiry and turning it off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || ''; process.env.SEED_DEMO_PASSWORD = 'test-pass-123'; process.env.SIMULATE_PROVIDERS = 'true';
process.env.AUTH_RATE_LIMIT = '1000'; process.env.EMAIL_TRANSPORT = 'log';
const { createStore } = await import('../src/store.js');
const { seedStore } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { migrate } = await import('../src/migrate.js');
const { codeAt, stepAt, verifyCode } = await import('../src/totp.js');

let server, base, store;
before(async () => { if (process.env.DATABASE_URL) await migrate(); store = createStore(); await store.init(); await seedStore(store, { force: true }); server = createApp(store).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); await store.close(); });
const req = async (path, { method = 'GET', body, token } = {}) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const post = (path, body, token) => req(path, { method: 'POST', body, token });
const code = (secret, offset = 0) => codeAt(secret, stepAt() + offset);

test('TOTP matches the RFC 6238 SHA-1 test vectors and allows one step of clock drift', () => {
  const s = Buffer.from('12345678901234567890');
  for (const [t, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) assert.equal(codeAt(s, Math.floor(t / 30), 8), expected);
  const secret = 'JBSWY3DPEHPK3PXP'; const now = Date.now();
  assert.equal(verifyCode(secret, codeAt(secret, stepAt(now) - 1), { now }), stepAt(now) - 1);
  assert.equal(verifyCode(secret, codeAt(secret, stepAt(now) - 2), { now }), null);
  assert.equal(verifyCode(secret, codeAt(secret, stepAt(now)), { now, lastStep: stepAt(now) }), null); // already used
});

test('customer turns on two-factor sign-in; sign-in then needs a code, used once', async () => {
  const t = (await post('/api/auth/login', { email: 'mira@example.com', password: 'test-pass-123' })).body.token;
  const setup = await post('/api/auth/2fa/setup', {}, t);
  assert.equal(setup.status, 200); assert.match(setup.body.uri, /^otpauth:\/\/totp\/Crateline(:|%3A)mira%40example\.com\?secret=[A-Z2-7]+&issuer=Crateline/);
  const secret = setup.body.secret;
  assert.equal((await post('/api/auth/2fa/enable', { code: '000000' }, t)).body.field, 'code');
  const en = await post('/api/auth/2fa/enable', { code: code(secret) }, t);
  assert.equal(en.status, 200); assert.equal(en.body.recoveryCodes.length, 8);
  assert.equal((await req('/api/state', { token: t })).body.view.me.twoFA, true);
  const db = (await store.read()).doc; assert.equal(JSON.stringify(db).includes(secret), false); // secret is not in the document

  const step1 = await post('/api/auth/login', { email: 'mira@example.com', password: 'test-pass-123' });
  assert.equal(step1.body.mfa, 'required'); assert.equal(step1.body.token, undefined);
  assert.equal((await req('/api/state', { token: step1.body.ticket })).status, 401); // a ticket is not a session
  assert.equal((await post('/api/auth/mfa', { ticket: step1.body.ticket, code: '123456' })).status, 422);
  const next = code(secret, 1); // the set-up used the current step; the next one is still accepted
  const ok = await post('/api/auth/mfa', { ticket: step1.body.ticket, code: next });
  assert.equal(ok.status, 200); assert.equal((await req('/api/state', { token: ok.body.token })).status, 200);
  const again = await post('/api/auth/login', { email: 'mira@example.com', password: 'test-pass-123' });
  assert.equal((await post('/api/auth/mfa', { ticket: again.body.ticket, code: next })).status, 422); // same code twice

  // recovery codes work once each
  const rc = en.body.recoveryCodes[0];
  assert.equal((await post('/api/auth/mfa', { ticket: again.body.ticket, code: rc.toLowerCase() })).status, 200);
  assert.equal((await post('/api/auth/mfa', { ticket: again.body.ticket, code: rc })).status, 422);
});

test('the code step expires after 5 minutes; turning it off needs the password and a code', async () => {
  const step1 = await post('/api/auth/login', { email: 'mira@example.com', password: 'test-pass-123' });
  const real = Date.now; Date.now = () => real() + 6 * 60e3;
  try { assert.equal((await post('/api/auth/mfa', { ticket: step1.body.ticket, code: '123456' })).status, 401); } finally { Date.now = real; }
  // sign in with a recovery code to get a session, then turn it off
  const acc = await store.findAccount('mira@example.com'); assert.equal(acc.recoveryHashes.length, 7);
  const regen = async token => (await post('/api/auth/2fa/recovery', { code: 'NOPE-NOPE' }, token)).status;
  // The previous test used the next code, so earlier codes are refused; a real user waits for a
  // new code. Move the clock forward 90 seconds instead (the server runs in this process).
  const s = await store.findAccount('mira@example.com'); const { decrypt } = await import('../src/totp.js'); const secret = decrypt(s.totpSecret);
  const real2 = Date.now; Date.now = () => real2() + 90e3;
  try {
    const fresh = await post('/api/auth/login', { email: 'mira@example.com', password: 'test-pass-123' });
    const session = (await post('/api/auth/mfa', { ticket: fresh.body.ticket, code: codeAt(secret, stepAt()) })).body.token;
    assert.ok(session); assert.equal(await regen(session), 422);
    assert.equal((await post('/api/auth/2fa/disable', { password: 'wrong', code: '123456' }, session)).body.field, 'password');
    const off = await post('/api/auth/2fa/disable', { password: 'test-pass-123', code: codeAt(secret, stepAt() + 1) }, session);
    assert.equal(off.status, 200);
  } finally { Date.now = real2; }
  const plain = await post('/api/auth/login', { email: 'mira@example.com', password: 'test-pass-123' });
  assert.ok(plain.body.token); assert.equal(plain.body.mfa, undefined);
  assert.equal((await req('/api/state', { token: plain.body.token })).body.view.me.twoFA, false);
});

test('staff can use two-factor sign-in; the sign-in is recorded with the method', async () => {
  const t = (await post('/api/auth/staff/login', { email: 'felix.fin-01@staff.example.com', password: 'test-pass-123' })).body.token;
  const { secret } = (await post('/api/auth/2fa/setup', {}, t)).body;
  assert.equal((await post('/api/auth/2fa/enable', { code: code(secret) }, t)).status, 200);
  const step1 = await post('/api/auth/staff/login', { email: 'felix.fin-01@staff.example.com', password: 'test-pass-123' });
  assert.equal(step1.body.mfa, 'required');
  const ok = await post('/api/auth/mfa', { ticket: step1.body.ticket, code: code(secret, 1) }); assert.equal(ok.status, 200);
  const sa = (await post('/api/auth/staff/login', { email: 'sofia.sa-01@staff.example.com', password: 'test-pass-123' })).body.token;
  const v = (await req('/api/state', { token: sa })).body.view;
  assert.ok(v.securityEvents.some(e => e.detail === 'Password and authenticator code sign-in' && e.who === 'Felix Brandt'));
  assert.ok(v.audit.some(a => a.action === 'Two-factor sign-in turned on' && a.actorId === 'FIN-01'));
});
