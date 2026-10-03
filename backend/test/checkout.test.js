// Server checkout rules (backend/src/actions.js) run directly on a seed document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SIMULATE_PROVIDERS = 'true';
const { seed } = await import('@crateline/domain/data.js');
const { customer } = await import('../src/actions.js');
const { now } = await import('@crateline/domain/clock.js');

test('cart checkout removes only the purchased cart lines; an unknown cart line is refused', () => {
  const d = seed(); const u = d.users.u_mira;
  d.carts.u_mira.push({ id: 'ci2', listingId: 'l_vps', pkgId: 'pk11', count: 2 });
  const ci = d.carts.u_mira[0];
  assert.throws(() => customer.checkout(d, u, { items: [{ listingId: ci.listingId, pkgId: ci.pkgId, count: 1 }], method: 'Card', cartIds: ['nope'] }), /cart changed/);
  const r = customer.checkout(d, u, { items: [{ listingId: ci.listingId, pkgId: ci.pkgId, count: 1 }], method: 'Card', cartIds: ['ci1'] });
  assert.equal(r.status, 'Paid'); assert.deepEqual(d.carts.u_mira.map(x => x.id), ['ci2']);
});

test('custom offer checkout uses the offer price and only for its buyer while accepted', () => {
  const d = seed(); const l = d.listings.find(x => x.storeId === 'st_atlas');
  d.offers.push({ id: 'OF-900', kind: 'offer', status: 'Sent', buyerId: 'u_mira', storeId: 'st_atlas', listingId: l.id, price: 77, qty: 100, days: 2, scope: 'Custom scope', replacement: '7 days', expiresAt: now() + 864e5 });
  const buy = u => customer.checkout(d, d.users[u], { items: [{ offerId: 'OF-900' }], method: 'Card' });
  assert.throws(() => buy('u_mira'), /cannot be purchased \(Sent\)/);
  d.offers.at(-1).status = 'Accepted awaiting payment';
  assert.throws(() => buy('u_sami'), /Offer not found/);
  const r = buy('u_mira'); const p = d.purchases.find(x => x.id === r.purchaseId);
  assert.equal(p.total, 77); assert.equal(d.offers.at(-1).status, 'Paid');
  assert.throws(() => buy('u_mira'), /cannot be purchased/); // already paid
});

test('crypto checkout requires a supported network; failed payments notify the buyer', () => {
  const d = seed(); const u = d.users.u_mira; const it = { listingId: 'l_vps', pkgId: 'pk11', count: 1 };
  assert.throws(() => customer.checkout(d, u, { items: [it], method: 'Crypto' }), /network/);
  const r = customer.checkout(d, u, { items: [it], method: 'Crypto', net: 'USDC on Base', outcome: 'failure' });
  assert.equal(r.status, 'Failed'); assert.ok(d.notifications.some(n => n.userId === 'u_mira' && n.text.includes(r.purchaseId)));
  assert.equal(d.orders.filter(o => o.purchaseRef === r.purchaseId).length, 0);
});
