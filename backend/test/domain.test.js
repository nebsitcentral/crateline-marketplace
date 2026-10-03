// Financial and approval rules from the specification (Section 18 and 19), run against the
// shared domain package so the frontend and API are held to the same numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '@crateline/domain/data.js';
import { storeBuckets, platformTotals, decideApproval, executeRefund, refundProviderEvent, executePayout, payoutProviderEvent, requestRefund, DomainError } from '@crateline/domain/fin.js';

const fresh = () => seed();
const S = (d, id) => d.staff[id];

test('seed totals match Section 18', () => {
  const d = fresh(); const t = platformTotals(d); const a = storeBuckets(d, 'st_atlas'); const n = storeBuckets(d, 'st_nova');
  assert.equal(t.gross, 46000); assert.equal(t.comm, 4600);
  assert.deepEqual([a.pending, a.held, a.available, a.reserved], [9000, 9000, 13000, 5000]);
  assert.equal(n.pending, 5400); assert.equal(a.total + n.total, 41400);
});

test('requester cannot approve own refund, even after switching role', () => {
  const d = fresh(); const priya = S(d, 'FIN-02');
  assert.throws(() => decideApproval(d, priya, 'APR-1', 'approve', 'ok'), DomainError);
  priya.activeRole = 'finance';
  assert.throws(() => decideApproval(d, priya, 'APR-1', 'approve', 'ok'), /different staff account/);
});

test('USD 20 refund reverses USD 2 commission and USD 18 seller funds; duplicate event ignored', () => {
  const d = fresh(); const felix = S(d, 'FIN-01');
  decideApproval(d, felix, 'APR-1', 'approve', 'Evidence supports partial refund');
  assert.throws(() => executeRefund(d, S(d, 'FIN-02'), 'RF-3001'), /requested this refund|cannot execute/); // requester cannot execute
  executeRefund(d, felix, 'RF-3001');
  refundProviderEvent(d, felix, 'RF-3001', 'success');
  const t = platformTotals(d); const a = storeBuckets(d, 'st_atlas');
  assert.equal(t.comm - t.commRev, 4400); assert.equal(t.refunded, 2000); assert.equal(a.held, 7200); assert.equal(a.refunded, 1800);
  const before = JSON.stringify([platformTotals(d), storeBuckets(d, 'st_atlas')]);
  assert.equal(refundProviderEvent(d, felix, 'RF-3001', 'success'), 'duplicate');
  assert.equal(JSON.stringify([platformTotals(d), storeBuckets(d, 'st_atlas')]), before);
});

test('refunds cannot exceed the refundable amount', () => {
  const d = fresh();
  assert.throws(() => requestRefund(d, S(d, 'FIN-01'), { orderId: 'ORD-1003', amountC: 9000, reason: 'too much' }), /Only \$80\.00 is refundable/);
});

for (const [outcome, available, reserved] of [['success', 13000, 0], ['failure', 18000, 0], ['unknown', 13000, 5000]]) {
  test(`payout PAY-1001 ${outcome}`, () => {
    const d = fresh(); const felix = S(d, 'FIN-01');
    decideApproval(d, felix, 'APR-2', 'approve', 'Destination verified');
    executePayout(d, felix, 'PAY-1001');
    assert.throws(() => executePayout(d, felix, 'PAY-1001'), /already processing/);
    payoutProviderEvent(d, felix, 'PAY-1001', outcome);
    const a = storeBuckets(d, 'st_atlas'); assert.equal(a.available, available); assert.equal(a.reserved, reserved);
  });
}

test('Finance cannot approve above its limit', () => {
  const d = fresh(); const r = requestRefund(d, S(d, 'SA-02'), { orderId: 'ORD-1002', amountC: 15000, reason: 'Large refund' });
  const apr = d.approvals.find(a => a.ref === r.id);
  assert.throws(() => decideApproval(d, S(d, 'FIN-01'), apr.id, 'approve', 'ok'), /above your/);
  decideApproval(d, S(d, 'SA-01'), apr.id, 'approve', 'Super Admin approval');
});

test('new ids never reuse an id that already exists (counter starts after the highest)', async () => {
  const { nid } = await import('@crateline/domain/fin.js');
  const d = fresh();
  assert.ok(d.securityEvents.some(e => e.id === 'SE-3')); assert.equal(d.seq.SE, undefined);
  assert.equal(nid(d, 'SE'), 'SE-4'); assert.equal(nid(d, 'SE'), 'SE-5');
  assert.equal(nid(d, 'NEWPREFIX'), 'NEWPREFIX-1');
});
