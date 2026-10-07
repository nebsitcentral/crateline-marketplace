// The one-time launch reset: an empty marketplace with only the Super Admin who ran it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || ''; process.env.SEED_DEMO_PASSWORD = 'test-pass-123'; process.env.SIMULATE_PROVIDERS = 'true';
process.env.AUTH_RATE_LIMIT = '1000'; process.env.ALLOW_LAUNCH_RESET = 'true';
const { createStore } = await import('../src/store.js');
const { seedStore } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { migrate } = await import('../src/migrate.js');
const { config } = await import('../src/config.js');
const { storeBuckets, platformTotals } = await import('@crateline/domain/fin.js');

let server, base, store;
before(async () => { if (process.env.DATABASE_URL) await migrate(); store = createStore(); await store.init(); await seedStore(store, { force: true }); server = createApp(store).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); await store.close(); });
const req = async (path, { method = 'GET', body, token } = {}) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const post = (path, body, token) => req(path, { method: 'POST', body, token });
const login = async (email, staff) => (await post(staff ? '/api/auth/staff/login' : '/api/auth/login', { email, password: 'test-pass-123' })).body.token;

test('the launch reset needs the server switch, a Super Admin, their password and the word LAUNCH', async () => {
  const sa = await login('sofia.sa-01@staff.example.com', true); const fin = await login('felix.fin-01@staff.example.com', true);
  config.allowLaunchReset = false;
  assert.equal((await post('/api/admin/launch', { password: 'test-pass-123', confirm: 'LAUNCH' }, sa)).status, 403);
  config.allowLaunchReset = true;
  assert.equal((await post('/api/admin/launch', { password: 'test-pass-123', confirm: 'LAUNCH' }, fin)).status, 403);
  assert.equal((await post('/api/admin/launch', { password: 'test-pass-123', confirm: 'LAUNCH' }, await login('mira@example.com'))).status, 403);
  assert.equal((await post('/api/admin/launch', { password: 'wrong', confirm: 'LAUNCH' }, sa)).status, 422);
  assert.equal((await post('/api/admin/launch', { password: 'test-pass-123', confirm: 'yes' }, sa)).status, 422);
  assert.ok((await store.read()).doc.orders.length > 0); // nothing removed so far
});

test('after the reset only that Super Admin and the configuration remain', async () => {
  const sa = await login('sofia.sa-01@staff.example.com', true); const before = (await store.read()).doc;
  assert.equal((await post('/api/admin/launch', { password: 'test-pass-123', confirm: 'LAUNCH', name: 'Owner Name' }, sa)).status, 200);
  const d = (await store.read()).doc;
  assert.deepEqual(Object.keys(d.staff), ['SA-01']); assert.equal(d.staff['SA-01'].name, 'Owner Name'); assert.deepEqual(d.staff['SA-01'].roles, ['superadmin']);
  for (const k of ['users', 'stores', 'carts', 'payoutMethods']) assert.deepEqual(d[k], {}, k);
  for (const k of ['listings', 'orders', 'purchases', 'payments', 'ledger', 'platform', 'refunds', 'payouts', 'approvals', 'cases', 'conversations', 'notifications', 'verifications', 'tickets', 'recon', 'invites']) assert.deepEqual(d[k], [], k);
  // No money is left anywhere, and the configuration is untouched.
  assert.equal(platformTotals(d).gross, 0); assert.equal(storeBuckets(d, 'st_atlas').available, 0);
  assert.deepEqual(d.categories, before.categories); assert.deepEqual(d.roles, before.roles); assert.deepEqual(d.settings.current, before.settings.current);
  assert.equal(d.policies.length, before.policies.length); assert.ok(d.policies.every(p => p.versions.every(v => v.state === 'Published')));
  assert.equal(d.audit.length, 1); assert.equal(d.audit[0].action, 'Marketplace reset for launch');
  // The admin stays signed in and can sign in again; every other account is gone.
  assert.equal((await req('/api/state', { token: sa })).body.view.me.name, 'Owner Name');
  assert.ok(await login('sofia.sa-01@staff.example.com', true));
  assert.equal(await login('felix.fin-01@staff.example.com', true), undefined);
  assert.equal(await login('mira@example.com'), undefined);
  assert.deepEqual((await req('/api/catalog')).body.listings, []);
  // The emptied marketplace works: a new customer can register.
  assert.equal((await post('/api/auth/register', { name: 'First Buyer', username: 'first.buyer', email: 'first@example.org', password: 'passw0rd!', acceptTerms: true })).status, 201);
});
