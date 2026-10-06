// With simulated providers off, only a payment method with a real provider can be used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SIMULATE_PROVIDERS = 'false'; process.env.PAYMENTS = 'nowpayments';
const { seed } = await import('@crateline/domain/data.js');
const { customer } = await import('../src/actions.js');

test('without simulation, card checkout is refused and crypto waits for the provider', () => {
  const d = seed(); const u = d.users.u_mira; const ci = d.carts.u_mira[0]; const items = [{ listingId: ci.listingId, pkgId: ci.pkgId, count: 1 }];
  assert.throws(() => customer.checkout(d, u, { items, method: 'Card', outcome: 'success' }), /Card payments are not available yet/);
  const r = customer.checkout(d, u, { items, method: 'Crypto', outcome: 'success' });
  assert.equal(r.status, 'Pending'); assert.equal(d.purchases[0].provider, 'NOWPayments'); assert.equal(d.purchases[0].ordersCreated, false);
  assert.throws(() => customer.confirmPayment(d, u, { purchaseId: r.purchaseId }), /disabled/);
});
