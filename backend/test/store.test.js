// Postgres storage checks (tables.js, PgStore). Runs only when TEST_DATABASE_URL points at a
// disposable database, for example:
//   TEST_DATABASE_URL=postgres://postgres:crateline@localhost:55432/crateline npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = url || '';
const skip = !url && 'TEST_DATABASE_URL is not set';
const { seed } = await import('@crateline/domain/data.js');
let migrate, createStore, pg, stores = [], db;
before(async () => {
  if (skip) return;
  ({ migrate } = await import('../src/migrate.js')); ({ createStore } = await import('../src/store.js'));
  pg = (await import('pg')).default; db = new pg.Pool({ connectionString: url });
  await migrate();
});
after(async () => { for (const s of stores) await s.close(); await db?.end(); });
const open = async () => { const s = createStore(); await s.init(); stores.push(s); return s; };
const plain = o => JSON.parse(JSON.stringify(o));

test('the whole document round-trips exactly, including list order and messages', { skip }, async () => {
  const s = await open(); const doc = seed(); await s.replace(doc, []);
  const fresh = await open(); const { doc: back } = await fresh.read();
  assert.deepEqual(plain(back), plain(doc));
  const settings = (await db.query('select doc from app_state where id = 1')).rows[0].doc;
  assert.equal(settings.orders, undefined); assert.equal(settings.ledger, undefined); assert.ok(settings.settings);
});

test('a transaction writes only its changes, and another instance reads them', { skip }, async () => {
  const a = await open(); const b = await open(); await a.replace(seed(), []);
  await b.read(); // b now holds a cached copy
  const untouched = async () => (await db.query("select xmin::text from orders where id = 'ORD-1002'")).rows[0].xmin;
  const x0 = await untouched();
  const { doc: base } = await a.read(); const order = { ...structuredClone(base.orders[0]), id: 'ORD-9001', placedAt: Date.now() };
  await a.transact(d => { d.orders.unshift(order); d.ledger.push({ id: 'LE-9001', at: Date.now(), cur: 'USD', store: order.storeId, order: 'ORD-9001', kind: 'Test', from: 'ext', to: 'pending', amt: 100 }); d.users.u_mira.name = 'Mira Changed'; });
  const { doc } = await b.read();
  assert.equal(doc.orders[0].id, 'ORD-9001'); assert.equal(doc.ledger.at(-1).id, 'LE-9001'); assert.equal(doc.users.u_mira.name, 'Mira Changed');
  const row = (await db.query("select store_id, order_id from ledger_entries where id = 'LE-9001'")).rows[0];
  assert.deepEqual(row, { store_id: order.storeId, order_id: 'ORD-9001' });
  assert.equal(await untouched(), x0); // an unrelated row was not rewritten
});

test('foreign keys refuse orphaned rows and nothing is written', { skip }, async () => {
  const s = await open(); await s.replace(seed(), []);
  const before = (await s.read()).version;
  await assert.rejects(s.transact(d => { d.orders.unshift({ ...structuredClone(d.orders[0]), id: 'ORD-BAD', storeId: 'st_does_not_exist' }); }), /foreign key/);
  const fresh = await open(); const { doc, version } = await fresh.read();
  assert.equal(version, before); assert.ok(!doc.orders.some(o => o.id === 'ORD-BAD'));
});

test('concurrent transactions are serialised; no update is lost', { skip }, async () => {
  const a = await open(); const b = await open(); await a.replace(seed(), []);
  const v0 = (await a.read()).version;
  await Promise.all([
    a.transact(d => { d.notifications.unshift({ id: 'n-a', userId: 'u_mira', panel: 'buyer', at: Date.now(), text: 'A', read: false }); }),
    b.transact(d => { d.notifications.unshift({ id: 'n-b', userId: 'u_mira', panel: 'buyer', at: Date.now(), text: 'B', read: false }); }),
  ]);
  const { doc, version } = await (await open()).read();
  assert.equal(version, v0 + 2); assert.ok(doc.notifications.some(n => n.id === 'n-a')); assert.ok(doc.notifications.some(n => n.id === 'n-b'));
});

test('removed records are deleted from their table', { skip }, async () => {
  const s = await open(); await s.replace(seed(), []);
  await s.transact(d => { d.listings.push({ ...structuredClone(d.listings[0]), id: 'l_tmp', availability: 'Draft' }); });
  assert.equal((await db.query("select count(*) from listings where id = 'l_tmp'")).rows[0].count, '1');
  await s.transact(d => { d.listings = d.listings.filter(l => l.id !== 'l_tmp'); });
  assert.equal((await db.query("select count(*) from listings where id = 'l_tmp'")).rows[0].count, '0');
});

test('a database with some lists still in the document moves only those lists', { skip }, async () => {
  const s = await open(); await s.replace(seed(), []);
  const orders = (await db.query('select count(*) from orders')).rows[0].count;
  // Simulate a database from before carts and processed operations had tables.
  await db.query('delete from cart_items'); await db.query('delete from processed_ops');
  await db.query(`update app_state set doc = doc || $1::jsonb where id = 1`, [JSON.stringify({ carts: { u_mira: [{ id: 'ci-old', listingId: 'l_vps', pkgId: 'pk11', count: 2 }] }, processedOps: ['OP-OLD-1'] })]);
  const fresh = await open(); const { doc } = await fresh.read();
  assert.deepEqual(doc.carts.u_mira.map(c => c.id), ['ci-old']); assert.deepEqual(doc.processedOps, ['OP-OLD-1']);
  assert.equal((await db.query('select count(*) from orders')).rows[0].count, orders); // other tables untouched
  const settings = (await db.query('select doc from app_state where id = 1')).rows[0].doc;
  assert.equal(settings.carts, undefined); assert.equal(settings.processedOps, undefined);
});

test('a provider operation can be recorded only once', { skip }, async () => {
  const s = await open(); await s.replace(seed(), []);
  await s.transact(d => { d.processedOps.push('OP-ONCE'); });
  await assert.rejects(s.transact(d => { d.processedOps.push('OP-ONCE'); }), /Duplicate record OP-ONCE/);
  assert.deepEqual((await (await open()).read()).doc.processedOps.filter(x => x === 'OP-ONCE'), ['OP-ONCE']);
  assert.equal((await db.query("select count(*) from processed_ops where id = 'OP-ONCE'")).rows[0].count, '1');
});
