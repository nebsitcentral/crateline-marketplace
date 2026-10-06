// File storage: signed URLs, the upload / complete / attach / download flow and who may download.
// Uses an in-memory storage in place of Cloudflare R2.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || ''; process.env.SEED_DEMO_PASSWORD = 'test-pass-123'; process.env.SIMULATE_PROVIDERS = 'true';
process.env.AUTH_RATE_LIMIT = '1000'; process.env.FILE_STORAGE = 'memory';
const { createStore } = await import('../src/store.js');
const { seedStore } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { migrate } = await import('../src/migrate.js');
const { memoryStorage, presign, r2Storage } = await import('../src/files.js');

let server, base, store; const storage = memoryStorage();
before(async () => { if (process.env.DATABASE_URL) await migrate(); store = createStore(); await store.init(); await seedStore(store, { force: true }); server = createApp(store, { storage }).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); await store.close(); });
const req = async (path, { method = 'GET', body, token } = {}) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const post = (path, body, token) => req(path, { method: 'POST', body, token });
const login = async (email, staff) => (await post(staff ? '/api/auth/staff/login' : '/api/auth/login', { email, password: 'test-pass-123' })).body.token;
const act = (token, name, args) => post('/api/actions/' + name, { args }, token);
// Announces a file, "uploads" it to the test storage and completes it. Returns { id, name, size }.
async function upload(token, name, size, storedSize = size) {
  const r = await post('/api/files', { name, size, type: 'text/csv' }, token); assert.equal(r.status, 201, JSON.stringify(r.body));
  storage.objects.set(r.body.upload.url.replace('memory://put/', ''), storedSize);
  const done = await post(`/api/files/${r.body.id}/complete`, {}, token);
  return { ...done, id: r.body.id };
}
// A paid order from Mira to Atlas, started by the seller.
async function preparingOrder(mira, rafi) {
  const l = (await req('/api/catalog')).body.listings.find(x => x.storeId === 'st_atlas');
  const co = await act(mira, 'checkout', { items: [{ listingId: l.id, pkgId: l.packages[0].id, count: 1, requirements: 'CSV with headers' }], method: 'Card' });
  const order = (await req('/api/state', { token: mira })).body.view.orders.find(o => o.purchaseRef === co.body.result.purchaseId);
  assert.equal((await act(rafi, 'startPreparation', { orderId: order.id })).status, 200);
  return order;
}

test('signed URLs match the AWS Signature Version 4 reference example', () => {
  const url = presign({ method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', expires: 86400, at: new Date('2013-05-24T00:00:00Z') });
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
  const r2 = r2Storage({ accountId: 'acct', accessKeyId: 'k', secret: 's', bucket: 'crateline' });
  assert.match(r2.putUrl('files/FL-1/a.csv'), /^https:\/\/acct\.r2\.cloudflarestorage\.com\/crateline\/files\/FL-1\/a\.csv\?/);
  assert.match(r2.getUrl('files/FL-1/a.csv', 'a b.csv'), /response-content-disposition=attachment%3B%20filename%3D%22a%20b\.csv%22/);
});

test('upload rules: sign-in, size, executables, and the stored size must match', async () => {
  const rafi = await login('rafi@atlas.example');
  assert.equal((await post('/api/files', { name: 'a.csv', size: 10 })).status, 401);
  assert.equal((await post('/api/files', { name: 'tool.exe', size: 10 }, rafi)).status, 422);
  assert.equal((await post('/api/files', { name: 'big.zip', size: 61 * 1048576 }, rafi)).status, 422);
  assert.equal((await post('/api/files', { name: 'empty.csv', size: 0 }, rafi)).status, 422);
  // Announced but never uploaded.
  const r = await post('/api/files', { name: 'a.csv', size: 10 }, rafi);
  assert.equal((await post(`/api/files/${r.body.id}/complete`, {}, rafi)).status, 400);
  // Uploaded with a different size: refused and removed from storage.
  const bad = await upload(rafi, 'b.csv', 10, 999); assert.equal(bad.status, 400);
  assert.equal(storage.objects.size, 0);
  // Another customer cannot complete someone else's upload.
  const mira = await login('mira@example.com'); const r2 = await post('/api/files', { name: 'c.csv', size: 5 }, rafi);
  assert.equal((await post(`/api/files/${r2.body.id}/complete`, {}, mira)).status, 404);
});

test('a delivery file is uploaded, attached once, and downloaded only by people on the order', async () => {
  const mira = await login('mira@example.com'); const rafi = await login('rafi@atlas.example');
  const order = await preparingOrder(mira, rafi);
  // With file storage on, a name and size alone are not accepted.
  assert.equal((await act(rafi, 'submitDelivery', { orderId: order.id, note: 'Full file attached', file: { name: 'leads.csv', size: 2048 }, qty: order.totalQty })).status, 422);
  // Mira's upload cannot be attached by Rafi.
  const hers = await upload(mira, 'hers.csv', 100);
  assert.equal((await act(rafi, 'submitDelivery', { orderId: order.id, note: 'Full file attached', file: { id: hers.id }, qty: order.totalQty })).status, 422);
  const f = await upload(rafi, 'leads final.csv', 2048); assert.equal(f.status, 200);
  const del = await act(rafi, 'submitDelivery', { orderId: order.id, note: 'Full file attached', file: { id: f.id, name: 'renamed.csv', size: 1 }, qty: order.totalQty });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  // The order shows the server's record of the file, not what the request claimed.
  const seen = (await req('/api/state', { token: mira })).body.view.orders.find(o => o.id === order.id).deliveries.at(-1).file;
  assert.deepEqual(seen, { id: f.id, name: 'leads final.csv', size: 2048 });
  // Buyer and seller get a download link; a customer outside the order does not.
  const link = await req(`/api/files/${f.id}/url`, { token: mira }); assert.equal(link.status, 200); assert.match(link.body.url, /^memory:\/\/get\/files\//);
  assert.equal((await req(`/api/files/${f.id}/url`, { token: rafi })).status, 200);
  const other = (await post('/api/auth/register', { name: 'Olu Other', username: 'olu.other', email: 'olu@example.org', password: 'passw0rd!', acceptTerms: true })).body.token;
  assert.equal((await req(`/api/files/${f.id}/url`, { token: other })).status, 404);
  assert.equal((await req(`/api/files/${f.id}/url`)).status, 401);
  // A file is attached once.
  const again = await act(rafi, 'sendMessage', { conversationId: (await req('/api/state', { token: rafi })).body.view.conversations[0].id, text: 'Same file', files: [{ id: f.id }] });
  assert.equal(again.status, 422); assert.match(again.body.error, /already attached/);
});

test('staff need the evidence permission to download; each download is audited', async () => {
  const mira = await login('mira@example.com'); const rafi = await login('rafi@atlas.example');
  const order = await preparingOrder(mira, rafi);
  const f = await upload(rafi, 'export.csv', 512);
  assert.equal((await act(rafi, 'submitDelivery', { orderId: order.id, note: 'Full file attached', file: { id: f.id }, qty: order.totalQty })).status, 200);
  // Support Admin sees orders but not delivery files.
  const sup = await login('sam.sup-01@staff.example.com', true);
  assert.notEqual((await req(`/api/files/${f.id}/url`, { token: sup })).status, 200);
  const sa = await login('sofia.sa-01@staff.example.com', true);
  assert.equal((await req(`/api/files/${f.id}/url`, { token: sa })).status, 200);
  const audit = (await req('/api/state', { token: sa })).body.view.audit.find(a => a.action === 'File downloaded');
  assert.equal(audit.object, f.id); assert.equal(audit.reason, 'export.csv');
});
