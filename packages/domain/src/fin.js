// Domain core shared by the customer panels and the management panels:
// money in integer minor units, a movement ledger, permissions, approvals, audit and
// named state transitions. Every transition checks permission, state and version,
// and throws DomainError on failure so the caller can keep the previous state.
import { now, DAY, HOUR } from './clock.js';
export { now };

export class DomainError extends Error { constructor(msg, code) { super(msg); this.code = code || 'rejected'; } }
const fail = (m, c) => { throw new DomainError(m, c); };

// ---------- money (one formatter, integer cents, round half up on cents)
export const toC = dollars => Math.round(dollars * 100);
export const fromC = c => c / 100;
export const pct = (c, rate) => Math.round(c * rate);
export function fmtMoney(c, cur = 'USD') {
  const s = (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (c < 0 ? '−' : '') + (cur === 'USD' ? '$' + s : cur === 'BDT' ? '৳' + s : s + ' ' + cur);
}
export const ROUNDING = 'Amounts are stored in cents. Percentages are rounded half up to the nearest cent per order.';

// Next id for a prefix. A counter that was never used starts after the highest existing id with
// that prefix, so records loaded from fixtures or older data are never reused or overwritten.
export function nid(d, p) { if (!d.seq[p]) d.seq[p] = highestId(d, p) + 1; return `${p}-${d.seq[p]++}`; }
function highestId(d, p) {
  let max = 0; const re = new RegExp(`^${p}-(\\d+)$`);
  for (const v of Object.values(d)) for (const r of Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []) {
    const m = r && typeof r.id === 'string' && r.id.match(re); if (m) max = Math.max(max, +m[1]);
  }
  return max;
}
export const key = (type, id) => type + ':' + id;

// ---------- settings
export const DEFAULT_SETTINGS = {
  platformName: 'Crateline', markets: ['United States', 'United Kingdom', 'United Arab Emirates', 'Saudi Arabia', 'Bangladesh'], currencies: ['USD'],
  commissionDefault: 0.10, commissionCategory: {}, commissionSeller: {},
  buyerFeeRate: 0, sellerChargeRate: 0, paymentFeeRate: 0, payoutFeeC: 0,
  payoutMinC: 2000, releaseDays: 3, financeRefundLimitC: 10000, financePayoutLimitC: 50000,
  disputeResponseHours: 48, appealDays: 7, replacementDays: 7, replacementAttempts: 1, autoComplete: false, reviewWindowDays: 3,
  deliveryClock: 'After verified payment and required buyer information', cancellation: 'Before delivery, by agreement of both parties or an authorised decision',
  listingApproval: true, storeLimit: 1,
  features: { customOffers: true, reviews: true, follows: true, scheduledPayouts: false, autoCompletion: false },
  deliveryMethods: ['Manual file delivery', 'Secure access information', 'Service delivery'],
  retention: { orders: '7 years (placeholder)', messages: '2 years (placeholder)', evidence: '3 years after case closure (placeholder)', identity: 'Until legal review (placeholder)' },
};
// Keys whose change needs independent approval (Section 15)
export const SENSITIVE = ['commissionDefault', 'commissionCategory', 'commissionSeller', 'financeRefundLimitC', 'financePayoutLimitC', 'retention', 'payoutMinC', 'releaseDays', 'buyerFeeRate', 'payoutFeeC'];
export const S = d => d.settings.current;

export function commissionFor(d, storeId, cat) {
  const s = S(d);
  if (s.commissionSeller[storeId] != null) return { rate: s.commissionSeller[storeId], rule: `Seller override (${d.stores[storeId]?.name})` };
  if (s.commissionCategory[cat] != null) return { rate: s.commissionCategory[cat], rule: `Category override (${cat})` };
  return { rate: s.commissionDefault, rule: 'Platform default' };
}

// ---------- ledger. Seller funds move between buckets; sinks are paidOut and refunded.
export const BUCKETS = ['pending', 'held', 'available', 'reserved'];
export function mv(d, e) { if (!e.amt) return; d.ledger.push({ id: nid(d, 'LE'), at: e.at ?? now(), cur: 'USD', ...e }); }
export function plat(d, e) { d.platform.push({ id: nid(d, 'PE'), at: e.at ?? now(), cur: 'USD', ...e }); }
export function bucketsOf(entries) {
  const b = { pending: 0, held: 0, available: 0, reserved: 0, paidOut: 0, refunded: 0 };
  for (const e of entries) { if (e.to in b) b[e.to] += e.amt; if (e.from in b) b[e.from] -= e.amt; }
  b.total = b.pending + b.held + b.available + b.reserved; return b;
}
export const storeBuckets = (d, storeId) => bucketsOf(d.ledger.filter(e => e.store === storeId));
export const orderBuckets = (d, orderId) => bucketsOf(d.ledger.filter(e => e.order === orderId));

export function recordSale(d, o, at) {
  const amt = toC(o.subtotal), comm = pct(amt, o.commissionRate);
  plat(d, { at, store: o.storeId, order: o.id, kind: 'Sale', amt });
  plat(d, { at, store: o.storeId, order: o.id, kind: 'Commission', amt: comm });
  mv(d, { at, store: o.storeId, order: o.id, kind: 'Seller earnings', from: 'ext', to: 'pending', amt: amt - comm });
}
export const hasOpenHold = (d, o) => d.cases.some(c => c.orderId === o.id && c.holdActive);
export function releasable(d, o) { return o.status === 'completed' && o.completedAt && o.completedAt + S(d).releaseDays * DAY <= now(); }
export function holdOrder(d, o, caseId, at) {
  const b = orderBuckets(d, o.id);
  for (const from of ['pending', 'available']) if (b[from] > 0) mv(d, { at, store: o.storeId, order: o.id, ref: caseId, kind: 'Dispute hold', from, to: 'held', amt: b[from] });
}
export function releaseHold(d, o, caseId) {
  const b = orderBuckets(d, o.id); if (b.held <= 0) return 0;
  const to = releasable(d, o) ? 'available' : 'pending';
  mv(d, { store: o.storeId, order: o.id, ref: caseId, kind: 'Hold released', from: 'held', to, amt: b.held });
  return b.held;
}
export function releaseDue(d) {
  for (const o of d.orders) {
    if (!releasable(d, o) || hasOpenHold(d, o)) continue;
    const b = orderBuckets(d, o.id);
    if (b.pending > 0) mv(d, { store: o.storeId, order: o.id, kind: 'Earnings released', from: 'pending', to: 'available', amt: b.pending });
  }
}

// ---------- refund amounts
export const paidC = o => o.payment.status === 'Paid' ? toC(o.total) : 0;
export const refundedC = (d, o) => d.refunds.filter(r => r.orderId === o.id && ['Refunded', 'Partially refunded'].includes(r.status)).reduce((a, r) => a + r.amountC, 0);
export const reservedRefundC = (d, o, exceptId) => d.refunds.filter(r => r.orderId === o.id && r.id !== exceptId && ['Requested', 'Approved', 'Processing', 'Reconciliation required', 'Failed', 'Changes requested'].includes(r.status)).reduce((a, r) => a + r.amountC, 0);
export const refundableC = (d, o, exceptId) => paidC(o) - refundedC(d, o) - reservedRefundC(d, o, exceptId);

function refundReversal(d, o, r) {
  const commRev = pct(r.amountC, o.commissionRate); let seller = r.amountC - commRev;
  plat(d, { store: o.storeId, order: o.id, ref: r.id, kind: 'Sale reversal', amt: -r.amountC });
  plat(d, { store: o.storeId, order: o.id, ref: r.id, kind: 'Commission reversal', amt: -commRev });
  const b = orderBuckets(d, o.id);
  for (const from of ['held', 'pending', 'available']) { const take = Math.min(seller, Math.max(0, b[from])); if (take) { mv(d, { store: o.storeId, order: o.id, ref: r.id, kind: 'Refund reversal', from, to: 'refunded', amt: take }); seller -= take; } }
  if (seller > 0) mv(d, { store: o.storeId, order: o.id, ref: r.id, kind: 'Refund reversal (recovery)', from: 'available', to: 'refunded', amt: seller });
}

// ---------- roles and permissions
export const PERM_GROUPS = [
  ['Work queue', [['queue.view', 'View queue'], ['queue.assign', 'Assign and reassign']]],
  ['Users', [['users.view', 'View'], ['users.restrict', 'Restrict and restore'], ['users.contact', 'Contact and recovery']]],
  ['Sellers', [['sellers.view', 'View'], ['sellers.evidence', 'View sensitive evidence'], ['sellers.decide', 'Verification decisions'], ['stores.control', 'Pause, suspend, restore stores']]],
  ['Catalog', [['catalog.view', 'View'], ['catalog.moderate', 'Moderate listings'], ['categories.edit', 'Edit categories']]],
  ['Content', [['content.draft', 'Draft content'], ['content.publish', 'Publish content'], ['policies.publish', 'Publish policies']]],
  ['Orders', [['orders.view', 'View summaries'], ['orders.act', 'Operational actions'], ['orders.evidence', 'Open delivery files and messages']]],
  ['Disputes', [['cases.view', 'View cases'], ['cases.decide', 'Decide cases'], ['cases.evidence', 'View case evidence']]],
  ['Payments', [['payments.view', 'View'], ['payments.reconcile', 'Reconcile']]],
  ['Refunds', [['refunds.view', 'View'], ['refunds.request', 'Request'], ['refunds.approve', 'Approve'], ['refunds.execute', 'Execute']]],
  ['Payouts', [['payouts.view', 'View'], ['payouts.approve', 'Approve'], ['payouts.execute', 'Execute']]],
  ['Support', [['support.view', 'View tickets'], ['support.reply', 'Reply and update']]],
  ['Reports', [['reports.view', 'Operational reports'], ['reports.financial', 'Financial reports'], ['reports.export', 'Export']]],
  ['Oversight', [['activity.view', 'Activity history'], ['sa.overview', 'Business overview'], ['approvals.view', 'View approvals'], ['approvals.decide', 'Decide non-financial approvals'], ['bizreports.view', 'Business reports']]],
  ['Platform', [['staff.view', 'View staff'], ['staff.manage', 'Manage staff and roles'], ['settings.view', 'View settings'], ['settings.edit', 'Propose setting changes'], ['integrations.edit', 'Edit integrations'], ['audit.view', 'Security and audit'], ['health.view', 'System health'], ['health.retry', 'Retry failed tasks']]],
];
export const ALL_PERMS = PERM_GROUPS.flatMap(g => g[1].map(p => p[0]));
const SENSITIVE_PERMS = ['refunds.approve', 'refunds.execute', 'payouts.approve', 'payouts.execute', 'staff.manage', 'settings.edit', 'integrations.edit', 'sellers.evidence', 'policies.publish', 'approvals.decide'];
export const ROLE_TEMPLATES = {
  support: { name: 'Support Admin', perms: ['queue.view', 'users.view', 'users.contact', 'orders.view', 'support.view', 'support.reply', 'reports.view', 'reports.export'], scope: {} },
  verification: { name: 'Verification Admin', perms: ['queue.view', 'users.view', 'sellers.view', 'sellers.evidence', 'sellers.decide', 'reports.view'], scope: {} },
  catalog: { name: 'Catalog Admin', perms: ['queue.view', 'catalog.view', 'catalog.moderate', 'categories.edit', 'content.draft', 'reports.view'], scope: {} },
  dispute: { name: 'Dispute Admin', perms: ['queue.view', 'cases.view', 'cases.decide', 'cases.evidence', 'orders.view', 'orders.evidence', 'refunds.view', 'refunds.request', 'reports.view'], scope: { cases: 'assigned' } },
  finance: { name: 'Finance Admin', perms: ['queue.view', 'approvals.view', 'orders.view', 'payments.view', 'payments.reconcile', 'refunds.view', 'refunds.request', 'refunds.approve', 'refunds.execute', 'payouts.view', 'payouts.approve', 'payouts.execute', 'reports.view', 'reports.financial', 'reports.export'], scope: {}, finance: true },
  ops: { name: 'Operations Manager', perms: ['queue.view', 'queue.assign', 'users.view', 'users.restrict', 'users.contact', 'sellers.view', 'stores.control', 'catalog.view', 'orders.view', 'orders.act', 'cases.view', 'support.view', 'support.reply', 'reports.view', 'reports.export', 'activity.view'], scope: {} },
  superadmin: { name: 'Super Admin', perms: ALL_PERMS.filter(p => !['refunds.execute', 'payouts.execute'].includes(p)), scope: {}, super: true },
};
export function roleOf(d, staff) { return staff && d.roles[staff.activeRole]; }
export function can(d, staff, p) { const r = roleOf(d, staff); return !!(staff && staff.active && r && r.perms.includes(p)); }
export function need(d, staff, p, what) { if (!can(d, staff, p)) fail(`Access denied. ${roleOf(d, staff)?.name || 'This account'} cannot ${what || p.replace('.', ' ')}.`, 'denied'); }
export function limitFor(d, staff, kind) {
  const r = roleOf(d, staff); if (!r) return 0;
  if (r.super) return Infinity;
  if (!r.perms.includes(kind + '.approve')) return 0;
  return kind === 'refunds' ? S(d).financeRefundLimitC : S(d).financePayoutLimitC;
}
export const isSuper = (d, s) => !!roleOf(d, s)?.super;
export const activeSupers = d => Object.values(d.staff).filter(s => s.active && s.roles.includes('superadmin'));

// ---------- audit & staff notifications
export function audit(d, actor, action, object, x = {}) {
  const role = actor?.activeRole ? d.roles[actor.activeRole]?.name : actor?.kind || 'System';
  d.audit.unshift({ id: nid(d, 'AU'), at: now(), actorId: actor?.id || 'system', actor: actor?.name || 'System', role, action, object, reason: x.reason || '', before: x.before ?? null, after: x.after ?? null, approval: x.approval || null, outcome: x.outcome || 'Success', sensitive: !!x.sensitive });
}
export function snotify(d, staffIds, type, text, route) {
  for (const sid of new Set(staffIds.filter(Boolean))) d.staffNotes.unshift({ id: nid(d, 'SN'), staffId: sid, type, text, route, at: now(), read: false });
}
export const staffWith = (d, p) => Object.values(d.staff).filter(s => s.active && s.roles.some(r => d.roles[r]?.perms.includes(p))).map(s => s.id);
// customer notification with simulated delivery status; failure never undoes the event
export function cnotify(d, userId, panel, text, route) {
  const failed = d.scenario?.notifyFail;
  const n = { id: nid(d, 'N'), userId, panel, at: now(), text, route, read: false, delivery: failed ? 'Failed' : 'Delivered' };
  d.notifications.unshift(n);
  if (failed) d.tasks.unshift({ id: nid(d, 'TSK'), type: 'Notification email', ref: n.id, refLabel: `${d.users[userId]?.name}: ${text.slice(0, 60)}`, attempts: 1, lastError: 'Simulated mail relay timeout', status: 'Failed', at: now() });
  return n;
}

// ---------- assignment
export function assignment(d, k) { return d.assign[k] || { assigneeId: null, priority: 'Normal', history: [] }; }
export function setAssignee(d, actor, k, staffId, reason, label) {
  const a = d.assign[k] = { ...assignment(d, k) };
  const before = a.assigneeId ? d.staff[a.assigneeId]?.name : 'Unassigned';
  a.assigneeId = staffId; a.history = [...(a.history || []), { at: now(), by: actor.name, to: staffId ? d.staff[staffId].name : 'Unassigned', reason }];
  audit(d, actor, 'Assign', label || k, { reason, before, after: staffId ? d.staff[staffId].name : 'Unassigned' });
  if (staffId && staffId !== actor.id) snotify(d, [staffId], 'Assignment', `${actor.name} assigned ${label || k} to you.`, routeFor(k));
}
export function setPriority(d, actor, k, priority, reason, label) {
  need(d, actor, 'queue.view', 'change priority');
  if (!['Low', 'Normal', 'High', 'Urgent'].includes(priority)) fail('Choose a priority.', 'validation');
  if (!reason || !String(reason).trim()) fail('Enter a reason for the priority change.', 'validation');
  const a = d.assign[k] = { ...assignment(d, k) }; const before = a.priority;
  a.priority = priority; a.history = [...(a.history || []), { at: now(), by: actor.name, to: 'Priority ' + priority, reason }];
  audit(d, actor, 'Priority changed', label || k, { before, after: priority, reason });
}
// Raises an item to Urgent and tells everyone who can assign work.
export function escalateWork(d, actor, k, reason) {
  need(d, actor, 'queue.view', 'escalate work');
  if (!reason || !String(reason).trim()) fail('Enter a reason. It is recorded in the audit history.', 'validation');
  const a = assignment(d, k); const label = k.split(':')[1];
  d.assign[k] = { ...a, priority: 'Urgent', history: [...(a.history || []), { at: now(), by: actor.name, to: 'Urgent', reason }] };
  snotify(d, staffWith(d, 'queue.assign'), 'Escalation', `${label} escalated by ${actor.name}: ${reason}`, { page: 'a-queue' });
  audit(d, actor, 'Escalated', label, { reason, after: 'Urgent' });
}
export function addNote(d, actor, k, text, label) {
  need(d, actor, 'queue.view', 'add notes');
  if (!text || !String(text).trim()) fail('Note is required.', 'validation');
  (d.notes[k] = d.notes[k] || []).push({ by: actor.name, at: now(), text: String(text).trim().slice(0, 5000) });
  audit(d, actor, 'Internal note added', label || k);
}
export function switchRole(d, actor, role) {
  if (!actor.roles.includes(role) || !d.roles[role]) fail('You do not hold that role.', 'denied');
  actor.activeRole = role; audit(d, actor, 'Switched active role', actor.id, { after: d.roles[role].name });
}
// Staff notifications: one by id, or all of the actor's when id is null.
export function markStaffNotesRead(d, actor, id = null) { for (const n of d.staffNotes) if (n.staffId === actor.id && (id == null || n.id === id)) n.read = true; }
// Access records: viewing sensitive evidence and generating exports are audited with a reason.
export function logEvidenceView(d, actor, k, reason) {
  if (!reason || !String(reason).trim()) fail('Enter a reason. It is recorded in the audit history.', 'validation');
  audit(d, actor, 'Sensitive evidence viewed', k, { reason, sensitive: true });
}
export function logExport(d, actor, name, rows, columns, sensitive) {
  audit(d, actor, 'Export generated', name, { reason: `${rows} rows; columns ${columns.join(', ')}`, sensitive: !!sensitive });
  d.exports.unshift({ id: nid(d, 'EX'), at: now(), by: actor.name, name, rows });
}
export function routeFor(k) {
  const [t, id] = k.split(':');
  return { case: { page: 'a-case', id }, order: { page: 'a-order', id }, seller: { page: 'a-seller', id }, listing: { page: 'a-product', id }, refund: { page: 'a-refund', id }, payout: { page: 'a-payout', id }, ticket: { page: 'a-ticket', id }, recon: { page: 'a-recon' }, approval: { page: 'sa-approval', id } }[t] || { page: 'a-queue' };
}

// ---------- approvals
export function createApproval(d, a) {
  const apr = { id: nid(d, 'APR'), status: 'Pending', createdAt: now(), expiresAt: now() + 7 * DAY, comments: [], version: 1, ...a };
  d.approvals.unshift(apr);
  const p = apr.type === 'refund' ? 'refunds.approve' : apr.type === 'payout' ? 'payouts.approve' : 'approvals.decide';
  snotify(d, staffWith(d, p).filter(id => id !== apr.requesterId), 'Approval request', `${apr.title} needs approval.`, { page: 'sa-approval', id: apr.id });
  return apr;
}
export function requiredAuthority(d, type, amountC) {
  if (type === 'refund') return amountC <= S(d).financeRefundLimitC ? `Finance Admin (up to ${fmtMoney(S(d).financeRefundLimitC)}) or Super Admin` : 'Super Admin (above Finance limit)';
  if (type === 'payout') return amountC <= S(d).financePayoutLimitC ? `Finance Admin (up to ${fmtMoney(S(d).financePayoutLimitC)}) or Super Admin` : 'Super Admin (above Finance limit)';
  return 'Super Admin, other than the requester';
}
export function approvalCheck(d, staff, apr) {
  if (!staff?.active) return 'Your staff account is inactive.';
  if (apr.status !== 'Pending') return `This request is ${apr.status.toLowerCase()} and cannot be decided.`;
  if (apr.expiresAt < now()) return 'This approval request expired. The requester must resubmit.';
  if (apr.requesterId === staff.id) return 'You requested this. A different staff account must approve it, whichever role you switch to.';
  if (apr.type === 'refund' || apr.type === 'payout') {
    const k = apr.type + 's'; const lim = limitFor(d, staff, k);
    if (!lim) return `${roleOf(d, staff).name} cannot approve ${k}.`;
    if (apr.amountC > lim) return `${fmtMoney(apr.amountC)} is above your ${fmtMoney(lim)} limit. A Super Admin must approve.`;
    return null;
  }
  if (!can(d, staff, 'approvals.decide')) return `${roleOf(d, staff).name} cannot decide ${apr.type} approvals.`;
  if (apr.type === 'role' && apr.beneficiaries?.includes(staff.id)) return 'This change raises your own authority. Another Super Admin must approve it.';
  return null;
}
export function decideApproval(d, staff, id, decision, reason, ver) {
  const apr = d.approvals.find(a => a.id === id); if (!apr) fail('Approval not found.');
  if (ver != null && apr.version !== ver) fail('This request changed since you opened it. The latest version has been loaded; review it again.', 'stale');
  if (!reason?.trim()) fail('Enter a reason for the decision.', 'validation');
  const why = approvalCheck(d, staff, apr);
  if (why) { audit(d, staff, `Approval ${decision} blocked`, apr.id, { reason: why, outcome: 'Blocked' }); d.blocked.push({ at: now(), id: apr.id, staff: staff.id, why }); fail(why, 'denied'); }
  const before = apr.status;
  apr.status = decision === 'approve' ? 'Approved' : decision === 'reject' ? 'Rejected' : 'Changes requested';
  apr.approverId = staff.id; apr.decidedAt = now(); apr.decisionReason = reason; apr.version++;
  apr.comments.push({ by: staff.name, at: now(), text: `${apr.status}: ${reason}` });
  audit(d, staff, 'Approval ' + apr.status.toLowerCase(), apr.id, { reason, before, after: apr.status, approval: apr.id });
  APPLY[apr.type]?.(d, staff, apr);
  if (apr.requesterId && d.staff[apr.requesterId]) snotify(d, [apr.requesterId], 'Approval decision', `${apr.title}: ${apr.status} by ${staff.name}.`, { page: 'sa-approval', id: apr.id });
  return apr;
}
const APPLY = {
  refund(d, staff, apr) {
    const r = d.refunds.find(x => x.id === apr.ref);
    r.status = apr.status === 'Approved' ? 'Approved' : apr.status === 'Rejected' ? 'Rejected' : 'Changes requested';
    r.approverId = staff.id; r.version++; r.approvalVersion = r.version;
    const o = d.orders.find(x => x.id === r.orderId);
    if (r.status === 'Approved') { o.refund = { amount: fromC(r.amountC), state: 'Approved', at: now() }; cnotify(d, o.buyerId, 'buyer', `Refund ${r.id} of ${fmtMoney(r.amountC)} approved. It is not yet processed.`, { page: 'u-order', id: o.id }); }
    if (r.status === 'Rejected') { o.refund = null; cnotify(d, o.buyerId, 'buyer', `Refund request ${r.id} was not approved.`, { page: 'u-order', id: o.id }); }
  },
  payout(d, staff, apr) {
    const p = d.payouts.find(x => x.id === apr.ref);
    if (apr.status === 'Approved') { p.status = 'Approved'; p.approvalVersion = p.version; }
    else if (apr.status === 'Rejected') { p.status = 'Rejected'; mv(d, { store: p.storeId, payout: p.id, kind: 'Payout reservation released', from: 'reserved', to: 'available', amt: p.amountC }); cnotify(d, d.stores[p.storeId].ownerId, 'seller', `Payout ${p.id} was rejected: ${apr.decisionReason}. Funds returned to available.`, { page: 's-payouts' }); }
    else p.status = 'Changes requested';
    p.approverId = staff.id;
  },
  setting(d, staff, apr) { const v = d.settings.versions.find(x => x.id === apr.ref); if (apr.status === 'Approved') activateOrSchedule(d, v, staff); else v.state = apr.status === 'Rejected' ? 'Rejected' : 'Draft'; },
  role(d, staff, apr) { if (apr.status === 'Approved') applyRoleChange(d, staff, apr.payload, apr.id); },
  staffRole(d, staff, apr) { if (apr.status === 'Approved') { const s = d.staff[apr.payload.staffId]; const before = s.roles.join(', '); s.roles = apr.payload.roles; if (!s.roles.includes(s.activeRole)) s.activeRole = s.roles[0]; audit(d, staff, 'Staff roles changed', s.id, { before, after: s.roles.join(', '), approval: apr.id }); } },
  integration(d, staff, apr) { if (apr.status === 'Approved') { const p = d.integrations.find(x => x.id === apr.payload.id); const before = p.mode; p.mode = apr.payload.mode; audit(d, staff, 'Integration mode changed', p.id, { before, after: p.mode, approval: apr.id }); } },
  policy(d, staff, apr) { if (apr.status === 'Approved') publishPolicy(d, staff, apr.payload.policyId, apr.payload.v, apr.id); },
};

// ---------- refunds
export function requestRefund(d, actor, { orderId, amountC, reason, caseId, kind = 'staff' }) {
  const o = d.orders.find(x => x.id === orderId); if (!o) fail('Order not found.');
  if (kind === 'staff') need(d, actor, 'refunds.request', 'request refunds');
  if (o.payment.status !== 'Paid') fail(`${o.id} has no verified payment (${o.payment.status}), so there is nothing to refund.`);
  if (!(amountC > 0)) fail('Enter a refund amount greater than zero.', 'validation');
  if (!reason?.trim()) fail('Enter a reason.', 'validation');
  const rem = refundableC(d, o);
  if (amountC > rem) fail(`Only ${fmtMoney(rem)} is refundable: paid ${fmtMoney(paidC(o))}, refunded ${fmtMoney(refundedC(d, o))}, reserved by other requests ${fmtMoney(reservedRefundC(d, o))}.`, 'validation');
  const r = { id: nid(d, 'RF'), orderId, caseId: caseId || null, storeId: o.storeId, amountC, cur: 'USD', reason, requesterId: kind === 'staff' ? actor.id : null, requestedBy: kind === 'staff' ? `${actor.name} (${roleOf(d, actor).name})` : actor.name + ' (' + kind + ')', status: 'Requested', createdAt: now(), version: 1, opRef: 'OP-RF-' + Math.random().toString(36).slice(2, 8).toUpperCase(), attempts: [] };
  d.refunds.unshift(r);
  const apr = createApproval(d, { type: 'refund', ref: r.id, amountC, requesterId: r.requesterId, requester: r.requestedBy, title: `Refund ${r.id} for ${o.id}`, reason, before: `Refunded ${fmtMoney(refundedC(d, o))}`, after: `Refund ${fmtMoney(amountC)} of ${fmtMoney(paidC(o))}`, requiredAuthority: requiredAuthority(d, 'refund', amountC), refVersion: 1 });
  r.approvalId = apr.id;
  o.refund = { amount: fromC(amountC), state: 'Requested', at: now() };
  audit(d, kind === 'staff' ? actor : { name: actor.name, kind: 'Customer' }, 'Refund requested', r.id, { reason, after: fmtMoney(amountC), approval: apr.id });
  return r;
}
export function editRefundAmount(d, staff, id, amountC, reason, ver) {
  const r = d.refunds.find(x => x.id === id);
  if (ver != null && r.version !== ver) fail('This refund changed since you opened it. Latest version loaded.', 'stale');
  need(d, staff, 'refunds.request', 'edit refund requests');
  if (!['Requested', 'Approved', 'Changes requested'].includes(r.status)) fail(`A ${r.status.toLowerCase()} refund cannot be edited.`);
  const o = d.orders.find(x => x.id === r.orderId);
  if (amountC > refundableC(d, o, r.id)) fail(`Only ${fmtMoney(refundableC(d, o, r.id))} is refundable.`, 'validation');
  const before = r.amountC; r.amountC = amountC; r.version++; r.status = 'Requested';
  const old = d.approvals.find(a => a.id === r.approvalId);
  if (old && ['Pending', 'Approved'].includes(old.status)) { old.status = 'Invalidated'; old.comments.push({ by: 'System', at: now(), text: `Invalidated: amount changed from ${fmtMoney(before)} to ${fmtMoney(amountC)}.` }); }
  const apr = createApproval(d, { type: 'refund', ref: r.id, amountC, requesterId: staff.id, requester: staff.name, title: `Refund ${r.id} for ${o.id} (revised)`, reason, before: fmtMoney(before), after: fmtMoney(amountC), requiredAuthority: requiredAuthority(d, 'refund', amountC), supersedes: old?.id });
  r.approvalId = apr.id; r.requesterId = staff.id; r.requestedBy = `${staff.name} (${roleOf(d, staff).name})`;
  audit(d, staff, 'Refund amount changed; approval invalidated', r.id, { reason, before: fmtMoney(before), after: fmtMoney(amountC), approval: apr.id });
}
export function executeRefund(d, staff, id, ver) {
  const r = d.refunds.find(x => x.id === id);
  if (ver != null && r.version !== ver) fail('This refund changed since you opened it. Latest version loaded.', 'stale');
  need(d, staff, 'refunds.execute', 'execute refunds');
  if (r.requesterId === staff.id) fail('You requested this refund, so you cannot execute it.', 'denied');
  if (r.status === 'Processing') fail('This refund is already processing with the provider. Wait for the result.');
  if (r.status === 'Reconciliation required') fail('The previous attempt has an unknown result. Reconcile it before sending again.');
  if (!['Approved', 'Failed'].includes(r.status)) fail(`A refund in status ${r.status} cannot be executed. It needs an approved request.`);
  const apr = d.approvals.find(a => a.id === r.approvalId);
  if (!apr || apr.status !== 'Approved') fail('The approval for this version is missing or no longer valid.');
  r.status = 'Processing'; r.version++;
  r.attempts.push({ op: r.opRef, at: now(), by: staff.name, result: 'Sent to provider (simulated)' });
  const o = d.orders.find(x => x.id === r.orderId); o.refund = { amount: fromC(r.amountC), state: 'Processing', at: now() };
  audit(d, staff, r.attempts.length > 1 ? 'Refund retry sent (same operation)' : 'Refund sent to provider', r.id, { after: 'Processing', approval: r.approvalId, reason: 'Operation ' + r.opRef });
  cnotify(d, o.buyerId, 'buyer', `Refund ${r.id} is processing.`, { page: 'u-order', id: o.id });
}
// simulated provider result for a refund operation; repeats of a processed event change nothing
export function refundProviderEvent(d, actor, id, outcome) {
  const r = d.refunds.find(x => x.id === id); const o = d.orders.find(x => x.id === r.orderId);
  const evKey = r.opRef + ':' + outcome;
  if (d.processedOps.includes(r.opRef) || d.processedOps.includes(evKey)) { d.events.unshift({ id: nid(d, 'EV'), at: now(), op: r.opRef, ref: r.id, result: 'Duplicate event ignored. Already processed; no financial effect.' }); audit(d, actor, 'Duplicate provider event ignored', r.id, { reason: r.opRef, outcome: 'Ignored' }); return 'duplicate'; }
  if (!['Processing', 'Reconciliation required'].includes(r.status)) fail(`No provider request is outstanding for ${r.id} (${r.status}).`);
  d.events.unshift({ id: nid(d, 'EV'), at: now(), op: r.opRef, ref: r.id, result: outcome });
  if (outcome === 'success') {
    d.processedOps.push(r.opRef);
    refundReversal(d, o, r);
    const full = refundedC(d, o) + r.amountC >= paidC(o);
    r.status = full ? 'Refunded' : 'Partially refunded'; r.confirmedAt = now(); r.version++;
    o.refund = { amount: fromC(refundedC(d, o)), state: r.status, at: now() };
    if (full && o.status !== 'cancelled') o.status = 'refunded';
    o.events.push({ id: 'ev' + now(), at: now(), actor: 'System', text: `Refund ${r.id} of ${fmtMoney(r.amountC)} confirmed by provider (simulated)`, kind: 'ok' });
    cnotify(d, o.buyerId, 'buyer', `Refund of ${fmtMoney(r.amountC)} for ${o.id} confirmed.`, { page: 'u-order', id: o.id });
    cnotify(d, d.stores[o.storeId].ownerId, 'seller', `Refund of ${fmtMoney(r.amountC)} on ${o.id} reversed from your earnings.`, { page: 's-earnings' });
    audit(d, actor, 'Refund confirmed', r.id, { after: r.status, reason: 'Provider event ' + r.opRef });
    const c = r.caseId && d.cases.find(x => x.id === r.caseId);
    if (c && c.remedy && c.remedy.refundId === r.id) { c.remedy.state = 'Implemented'; c.timeline.push({ id: nid(d, 'EV'), at: now(), actor: 'System', text: `Refund confirmed. Remedy implemented`, kind: 'ok' }); if (c.remedy.closeOnRefund) resolveCase(d, actor, c, 'Refund confirmed'); }
  } else if (outcome === 'failure') {
    r.status = 'Failed'; r.version++; r.attempts[r.attempts.length - 1].result = 'Provider confirmed failure';
    o.refund = { amount: fromC(r.amountC), state: 'Failed', at: now() };
    cnotify(d, o.buyerId, 'buyer', `Refund ${r.id} failed at the provider. The marketplace will retry.`, { page: 'u-order', id: o.id });
    audit(d, actor, 'Refund failed', r.id, { outcome: 'Failed' });
    snotify(d, staffWith(d, 'refunds.execute'), 'Provider failure', `Refund ${r.id} failed at the provider.`, { page: 'a-refund', id: r.id });
  } else {
    r.status = 'Reconciliation required'; r.version++; r.attempts[r.attempts.length - 1].result = 'No response (unknown)';
    audit(d, actor, 'Refund result unknown', r.id, { outcome: 'Unknown' });
    snotify(d, staffWith(d, 'payments.reconcile'), 'Provider failure', `Refund ${r.id} result unknown. Reconciliation required.`, { page: 'a-refund', id: r.id });
  }
  return outcome;
}

// ---------- payouts
// Crypto payout networks sellers can choose, with the address format each one uses.
export const PAYOUT_NETS = { 'USDT TRC-20': { ticker: 'usdttrc20', address: /^T[1-9A-HJ-NP-Za-km-z]{33}$/ }, 'USDT ERC-20': { ticker: 'usdterc20', address: /^0x[0-9a-fA-F]{40}$/ }, 'USDC Base': { ticker: 'usdcbase', address: /^0x[0-9a-fA-F]{40}$/ } };
// Finance confirms a seller's payout destination before it can be used (for crypto: after the
// address is allowed at the payout provider). Sellers cannot verify their own destinations.
export function verifyPayoutMethod(d, staff, storeId, methodId, reason) {
  need(d, staff, 'payouts.approve', 'verify payout destinations');
  const m = (d.payoutMethods[storeId] || []).find(x => x.id === methodId); if (!m) fail('Payout method not found.', 'not_found');
  if (m.verified) fail('This destination is already verified.');
  m.verified = true; m.verifiedBy = staff.name; m.verifiedAt = now();
  audit(d, staff, 'Payout destination verified', storeId, { reason, after: m.label });
  cnotify(d, d.stores[storeId].ownerId, 'seller', `Your payout destination ${m.label} is verified. You can now request payouts to it.`, { page: 's-payouts' });
}
export function requestPayout(d, user, storeId, methodId, amountC) {
  const st = d.stores[storeId]; const m = (d.payoutMethods[storeId] || []).find(x => x.id === methodId);
  if (st.status !== 'Active') fail('Payouts are available once your store is active.');
  if (d.holds?.[storeId]) fail('Payouts are on hold for this store: ' + d.holds[storeId].reason);
  if (!m) fail('Choose a payout method.'); if (!m.verified) fail('This payout destination is not verified yet.');
  if (!(amountC >= S(d).payoutMinC)) fail(`The minimum payout is ${fmtMoney(S(d).payoutMinC)}.`);
  const b = storeBuckets(d, storeId); if (amountC > b.available) fail(`You can withdraw up to ${fmtMoney(b.available)}, your available balance.`);
  const p = { id: nid(d, 'PAY'), storeId, amountC, feeC: S(d).payoutFeeC, cur: 'USD', method: m.type, methodId, dest: m.label, destNet: m.net || null, destAddress: m.address || null, destVerified: true, status: 'Awaiting approval', requestedAt: now(), version: 1, opRef: 'OP-PO-' + Math.random().toString(36).slice(2, 8).toUpperCase(), attempts: [], provider: d.integrations.find(i => i.payoutMethods?.includes(m.type))?.name || 'Demo payout provider' };
  d.payouts.unshift(p);
  mv(d, { store: storeId, payout: p.id, kind: 'Payout reserved', from: 'available', to: 'reserved', amt: amountC });
  const apr = createApproval(d, { type: 'payout', ref: p.id, amountC, requesterId: user.id, requester: `${user.name} (seller)`, title: `Payout ${p.id} for ${st.name}`, reason: 'Seller payout request', before: `Available ${fmtMoney(b.available)}`, after: `Reserve ${fmtMoney(amountC)} to ${m.label}`, requiredAuthority: requiredAuthority(d, 'payout', amountC) });
  p.approvalId = apr.id;
  audit(d, { name: user.name, kind: 'Seller' }, 'Payout requested', p.id, { after: fmtMoney(amountC), approval: apr.id });
  return p;
}
export function cancelPayout(d, actor, id, reason, byStaff) {
  const p = d.payouts.find(x => x.id === id);
  if (byStaff) need(d, actor, 'payouts.approve', 'cancel payouts');
  if (!['Awaiting approval', 'Approved', 'Changes requested'].includes(p.status)) fail(`A payout that is ${p.status.toLowerCase()} cannot be cancelled. Cancellation is only possible before processing.`);
  p.status = 'Cancelled'; p.version++;
  mv(d, { store: p.storeId, payout: p.id, kind: 'Payout reservation released', from: 'reserved', to: 'available', amt: p.amountC });
  const apr = d.approvals.find(a => a.id === p.approvalId); if (apr && apr.status === 'Pending') apr.status = 'Withdrawn';
  audit(d, byStaff ? actor : { name: actor.name, kind: 'Seller' }, 'Payout cancelled', p.id, { reason });
}
export function changePayoutDestination(d, actor, id, methodId) {
  const p = d.payouts.find(x => x.id === id); const m = d.payoutMethods[p.storeId].find(x => x.id === methodId);
  if (!['Awaiting approval', 'Approved'].includes(p.status)) fail('The destination can only change before processing.');
  const before = p.dest; p.dest = m.label; p.destNet = m.net || null; p.destAddress = m.address || null; p.method = m.type; p.methodId = m.id; p.version++; p.status = 'Awaiting approval';
  const old = d.approvals.find(a => a.id === p.approvalId);
  if (old && ['Pending', 'Approved'].includes(old.status)) { old.status = 'Invalidated'; old.comments.push({ by: 'System', at: now(), text: `Invalidated: destination changed from ${before} to ${m.label}.` }); }
  const apr = createApproval(d, { type: 'payout', ref: p.id, amountC: p.amountC, requesterId: d.stores[p.storeId].ownerId, requester: `${d.users[d.stores[p.storeId].ownerId].name} (seller)`, title: `Payout ${p.id} (destination changed)`, reason: 'Destination changed after submission', before, after: m.label, requiredAuthority: requiredAuthority(d, 'payout', p.amountC), supersedes: old?.id });
  p.approvalId = apr.id;
  audit(d, actor, 'Payout destination changed; approval invalidated', p.id, { before, after: m.label, approval: apr.id });
}
// `via` names the real payout provider the transfer is about to be sent through; without it the
// transfer is simulated.
export function executePayout(d, staff, id, ver, via = null) {
  const p = d.payouts.find(x => x.id === id);
  if (ver != null && p.version !== ver) fail('This payout changed since you opened it. Latest version loaded.', 'stale');
  need(d, staff, 'payouts.execute', 'execute payouts');
  if (p.status === 'Processing') fail('This transfer is already processing. It will not be sent twice.');
  if (p.status === 'Reconciliation required') fail('The previous transfer has an unknown result. Reconcile it before any new attempt.');
  if (p.status !== 'Approved') fail(`A payout that is ${p.status.toLowerCase()} cannot be executed. It needs an approved request.`);
  const apr = d.approvals.find(a => a.id === p.approvalId);
  if (!apr || apr.status !== 'Approved' || p.approvalVersion !== p.version) fail('The approval does not match the current version of this payout.');
  p.status = 'Processing'; p.version++; p.sentVia = via; p.attempts.push({ op: p.opRef, at: now(), by: staff.name, result: via ? `Sending through ${via}` : 'Transfer sent (simulated)' });
  audit(d, staff, 'Payout transfer sent', p.id, { approval: p.approvalId, reason: 'Operation ' + p.opRef });
  cnotify(d, d.stores[p.storeId].ownerId, 'seller', `Payout ${p.id} of ${fmtMoney(p.amountC)} is processing.`, { page: 's-payouts' });
}
// The provider refused the transfer before creating it: nothing was sent, so the payout goes
// back to Approved (same approval) and can be executed again.
export function payoutNotSent(d, id, reason) {
  const p = d.payouts.find(x => x.id === id);
  if (p.status !== 'Processing' || !p.sentVia || p.providerBatch) fail(`${p.id} cannot be returned to Approved (${p.status}).`);
  p.attempts[p.attempts.length - 1].result = `Not sent. ${p.sentVia} refused: ${reason}`;
  p.status = 'Approved'; p.version++; p.approvalVersion = p.version; p.sentVia = null;
  audit(d, { name: 'System' }, 'Payout transfer not sent', p.id, { reason, outcome: 'Rejected' });
}
// The provider created the transfer. `verified` is false while it still waits for the
// provider's two-factor code; an unverified transfer is rejected by the provider after an hour.
export function payoutSent(d, id, { batchId, verified }) {
  const p = d.payouts.find(x => x.id === id);
  if (batchId) p.providerBatch = String(batchId);
  p.awaitingCode = !verified; p.version++;
  p.attempts[p.attempts.length - 1].result = verified ? `Transfer accepted by ${p.sentVia} (batch ${p.providerBatch})` : `Created at ${p.sentVia} (batch ${p.providerBatch}); waiting for the two-factor code`;
}
// A payout whose result is unknown, settled by Finance after checking the provider's own records.
export function reconcilePayout(d, staff, id, outcome, ref, reason) {
  need(d, staff, 'payments.reconcile', 'reconcile payouts');
  const p = d.payouts.find(x => x.id === id); if (!p) fail('Payout not found.', 'not_found');
  if (p.status !== 'Reconciliation required') fail(`${p.id} is ${p.status.toLowerCase()}; only a payout with an unknown result can be reconciled.`);
  if (!['paid', 'not_sent'].includes(outcome)) fail('Choose whether the provider shows the transfer as paid or not sent.', 'validation');
  if (outcome === 'paid' && !ref) fail('Enter the provider reference or transaction hash of the transfer.', 'validation');
  audit(d, staff, 'Payout reconciled by hand', p.id, { reason, after: outcome === 'paid' ? `Paid, reference ${ref}` : 'Not sent' });
  return payoutProviderEvent(d, staff, id, outcome === 'paid' ? 'success' : 'failure', ref || null);
}
export function payoutProviderEvent(d, actor, id, outcome, ref = null) {
  const p = d.payouts.find(x => x.id === id); const owner = d.stores[p.storeId].ownerId;
  if (d.processedOps.includes(p.opRef)) { d.events.unshift({ id: nid(d, 'EV'), at: now(), op: p.opRef, ref: p.id, result: 'Duplicate event ignored. Already processed; no financial effect.' }); audit(d, actor, 'Duplicate provider event ignored', p.id, { reason: p.opRef, outcome: 'Ignored' }); return 'duplicate'; }
  if (!['Processing', 'Reconciliation required'].includes(p.status)) fail(`No transfer is outstanding for ${p.id} (${p.status}).`);
  d.events.unshift({ id: nid(d, 'EV'), at: now(), op: p.opRef, ref: p.id, result: outcome });
  if (outcome === 'success') {
    d.processedOps.push(p.opRef); p.status = 'Paid'; p.paidAt = now(); p.version++; p.awaitingCode = false; p.providerRef = ref || 'TRF-' + p.id.slice(4) + 'X';
    mv(d, { store: p.storeId, payout: p.id, kind: 'Payout paid', from: 'reserved', to: 'paidOut', amt: p.amountC });
    cnotify(d, owner, 'seller', `Payout ${p.id} of ${fmtMoney(p.amountC)} paid to ${p.dest}.`, { page: 's-payouts' });
    audit(d, actor, 'Payout paid', p.id, { after: 'Paid' });
  } else if (outcome === 'failure') {
    d.processedOps.push(p.opRef); p.status = 'Failed'; p.version++; p.awaitingCode = false;
    mv(d, { store: p.storeId, payout: p.id, kind: 'Payout failed, funds released', from: 'reserved', to: 'available', amt: p.amountC });
    cnotify(d, owner, 'seller', `Payout ${p.id} failed. ${fmtMoney(p.amountC)} returned to your available balance.`, { page: 's-payouts' });
    audit(d, actor, 'Payout failed', p.id, { outcome: 'Failed' });
    snotify(d, staffWith(d, 'payouts.execute'), 'Provider failure', `Payout ${p.id} failed at the provider.`, { page: 'a-payout', id: p.id });
  } else {
    p.status = 'Reconciliation required'; p.version++;
    audit(d, actor, 'Payout result unknown', p.id, { outcome: 'Unknown' });
    snotify(d, staffWith(d, 'payments.reconcile'), 'Provider failure', `Payout ${p.id} result unknown. Funds stay reserved.`, { page: 'a-payout', id: p.id });
  }
  return outcome;
}

// ---------- cases
export function resolveCase(d, actor, c, reason) {
  c.status = 'Resolved'; c.version++; c.resolvedAt = now(); c.appealUntil = now() + S(d).appealDays * DAY;
  const o = d.orders.find(x => x.id === c.orderId);
  if (c.holdActive) { const amt = releaseHold(d, o, c.id); c.holdActive = false; c.timeline.push({ id: nid(d, 'EV'), at: now(), actor: 'System', text: amt ? `Remaining hold of ${fmtMoney(amt)} released` : 'Hold closed', kind: 'ok' }); }
  c.timeline.push({ id: nid(d, 'EV'), at: now(), actor: actor?.name || 'System', text: 'Case resolved: ' + reason, kind: 'ok' });
  cnotify(d, c.buyerId, 'buyer', `Case ${c.id} resolved: ${reason}.`, { page: 'case', id: c.id });
  cnotify(d, d.stores[c.storeId].ownerId, 'seller', `Case ${c.id} resolved: ${reason}.`, { page: 'case', id: c.id });
  audit(d, actor, 'Case resolved', c.id, { reason });
}

// ---------- settings versions
export function proposeSetting(d, staff, k, value, reason, effectiveAt) {
  need(d, staff, 'settings.edit', 'change settings');
  if (!reason?.trim()) fail('Enter a reason for the change.', 'validation');
  const from = S(d)[k];
  if (JSON.stringify(from) === JSON.stringify(value)) fail('The proposed value is the same as the current value.', 'validation');
  if (d.settings.versions.some(v => v.key === k && ['Pending approval', 'Scheduled'].includes(v.state))) fail('Another change to this setting is already pending or scheduled. Resolve it first to avoid ambiguous precedence.', 'validation');
  const v = { id: nid(d, 'SV'), key: k, from, to: value, reason, by: staff.name, byId: staff.id, at: now(), effectiveAt: effectiveAt || now(), state: 'Draft' };
  d.settings.versions.unshift(v);
  if (SENSITIVE.includes(k)) {
    v.state = 'Pending approval';
    const apr = createApproval(d, { type: 'setting', ref: v.id, requesterId: staff.id, requester: staff.name, title: `Setting change: ${k}`, reason, before: JSON.stringify(from), after: JSON.stringify(value), requiredAuthority: requiredAuthority(d, 'setting') });
    v.approvalId = apr.id; audit(d, staff, 'Setting change proposed', k, { reason, before: JSON.stringify(from), after: JSON.stringify(value), approval: apr.id });
  } else activateOrSchedule(d, v, staff);
  return v;
}
function activateOrSchedule(d, v, actor) {
  if (v.effectiveAt > now()) { v.state = 'Scheduled'; audit(d, actor, 'Setting change scheduled', v.key, { before: JSON.stringify(v.from), after: JSON.stringify(v.to) }); return; }
  for (const x of d.settings.versions) if (x.key === v.key && x.state === 'Active') x.state = 'Superseded';
  d.settings.current = { ...d.settings.current, [v.key]: v.to }; v.state = 'Active'; v.activatedAt = now();
  audit(d, actor, 'Setting activated', v.key, { before: JSON.stringify(v.from), after: JSON.stringify(v.to), approval: v.approvalId });
}

// ---------- roles
export function roleDiff(oldPerms, newPerms) { return { added: newPerms.filter(p => !oldPerms.includes(p)), removed: oldPerms.filter(p => !newPerms.includes(p)) }; }
export function proposeRoleChange(d, staff, roleId, perms, reason) {
  need(d, staff, 'staff.manage', 'edit roles');
  if (!reason?.trim()) fail('Enter a reason for the role change.', 'validation');
  const r = d.roles[roleId]; const diff = roleDiff(r.perms, perms);
  if (!diff.added.length && !diff.removed.length) fail('No permission changes to save.', 'validation');
  if (roleId === 'superadmin' && diff.removed.includes('staff.manage')) fail('The Super Admin role must keep Manage staff and roles, or no one could administer access.');
  const holders = Object.values(d.staff).filter(s => s.roles.includes(roleId)).map(s => s.id);
  const sensitive = diff.added.some(p => SENSITIVE_PERMS.includes(p)) || holders.includes(staff.id) && diff.added.length > 0;
  const payload = { roleId, perms, diff };
  if (sensitive) {
    const apr = createApproval(d, { type: 'role', ref: roleId, requesterId: staff.id, requester: staff.name, title: `Role change: ${r.name}`, reason, before: `${r.perms.length} permissions`, after: `+${diff.added.join(', +') || 'none'}; −${diff.removed.join(', −') || 'none'}`, requiredAuthority: 'Super Admin who does not hold this role and did not request it', payload, beneficiaries: holders });
    audit(d, staff, 'Role change proposed', roleId, { reason, after: apr.after, approval: apr.id });
    return { approval: apr };
  }
  applyRoleChange(d, staff, payload, null, reason); return { applied: true };
}
function applyRoleChange(d, actor, { roleId, perms, diff }, aprId, reason) {
  const r = d.roles[roleId];
  r.history = [...(r.history || []), { v: r.version, perms: r.perms, at: now(), by: actor.name }];
  r.perms = perms; r.version++;
  audit(d, actor, `Role ${r.name} updated to version ${r.version}`, roleId, { reason, before: diff.removed.join(', ') ? 'Removed: ' + diff.removed.join(', ') : '', after: diff.added.length ? 'Added: ' + diff.added.join(', ') : '', approval: aprId });
}
export function deactivateStaff(d, actor, sid, reason) {
  need(d, actor, 'staff.manage', 'deactivate staff');
  const s = d.staff[sid];
  if (!reason?.trim()) fail('Enter a reason.', 'validation');
  if (!s.active) fail('This account is already inactive.');
  if (s.roles.includes('superadmin') && activeSupers(d).length <= 1) fail('You cannot deactivate the last active Super Admin.');
  if (sid === actor.id) fail('You cannot deactivate your own account. Ask another Super Admin.');
  s.active = false; const sessions = s.sessions.length; s.sessions = [];
  let moved = 0; for (const k in d.assign) if (d.assign[k].assigneeId === sid) { d.assign[k] = { ...d.assign[k], assigneeId: null, history: [...d.assign[k].history, { at: now(), by: 'System', to: 'Unassigned', reason: 'Assignee deactivated' }] }; moved++; }
  let returned = 0;
  for (const a of d.approvals) if (a.approverId === sid && a.status === 'Approved' && unexecuted(d, a)) { a.status = 'Pending'; a.approverId = null; a.comments.push({ by: 'System', at: now(), text: 'Returned for approval: approver was deactivated before execution.' }); returned++; const ref = a.type === 'refund' ? d.refunds.find(r => r.id === a.ref) : a.type === 'payout' ? d.payouts.find(p => p.id === a.ref) : null; if (ref) ref.status = a.type === 'refund' ? 'Requested' : 'Awaiting approval'; }
  audit(d, actor, 'Staff deactivated', sid, { reason, before: 'Active', after: `Inactive; ${sessions} sessions ended; ${moved} assignments unassigned; ${returned} approvals returned` });
  return { moved, returned };
}
function unexecuted(d, a) { if (a.type === 'refund') return d.refunds.find(r => r.id === a.ref)?.status === 'Approved'; if (a.type === 'payout') return d.payouts.find(p => p.id === a.ref)?.status === 'Approved'; return false; }

// ---------- policies
export function publishPolicy(d, actor, policyId, v, aprId) {
  const p = d.policies.find(x => x.id === policyId); const ver = p.versions.find(x => x.v === v);
  for (const x of p.versions) if (x.state === 'Published') x.state = 'Superseded';
  ver.state = 'Published'; ver.publishedAt = now(); ver.publishedBy = actor.name;
  audit(d, actor, 'Policy published', `${p.title} v${v}`, { approval: aprId });
}

// ---------- scheduled work when demo time moves
export function tick(d) {
  releaseDue(d);
  for (const c of d.cases) if (['Open', 'Awaiting seller', 'Awaiting buyer'].includes(c.status) && c.deadline && c.deadline < now()) {
    c.status = 'Escalated'; c.escalation = (c.escalation || 0) + 1; c.version++;
    c.timeline.push({ id: nid(d, 'EV'), at: now(), actor: 'System', text: `Response deadline passed. Escalated to level ${c.escalation}. No outcome decided automatically`, kind: 'bad' });
    snotify(d, staffWith(d, 'cases.decide'), 'Overdue work', `${c.id} passed its response deadline and was escalated.`, { page: 'a-case', id: c.id });
  }
  for (const v of d.settings.versions) if (v.state === 'Scheduled' && v.effectiveAt <= now()) activateOrSchedule(d, v, { name: 'Scheduler' });
  for (const a of d.approvals) if (a.status === 'Pending' && a.expiresAt < now()) { a.status = 'Expired'; a.comments.push({ by: 'System', at: now(), text: 'Expired without a decision.' }); }
  for (const i of d.invites) if (i.status === 'Pending' && i.expiresAt < now()) i.status = 'Expired';
  for (const u of Object.values(d.users)) for (const r of u.restrictions || []) if (r.active && r.expiresAt && r.expiresAt < now()) { r.active = false; r.endedAt = now(); audit(d, { name: 'Scheduler' }, 'Restriction expired', u.acct, { reason: r.scope }); }
  if (S(d).autoComplete) for (const o of d.orders) if (o.status === 'delivered' && !hasOpenHold(d, o) && !(o.replacement?.state === 'Requested')) {
    const last = o.deliveries[o.deliveries.length - 1]; if (last && last.at + S(d).reviewWindowDays * DAY < now()) { o.status = 'completed'; o.completedAt = now(); o.events.push({ id: 'ev' + now(), at: now(), actor: 'System', text: 'Completed automatically after the review window (administrative rule, not buyer confirmation)', kind: 'ok' }); }
  }
}

// ---------- reports (single calculation layer)
export function platformTotals(d, filter = () => true) {
  const es = d.platform.filter(filter); const sum = k => es.filter(e => e.kind === k).reduce((a, e) => a + e.amt, 0);
  const gross = sum('Sale'), refunded = -sum('Sale reversal'), comm = sum('Commission'), commRev = -sum('Commission reversal');
  return { gross, refunded, net: gross - refunded, comm, commRev, netRevenue: comm - commRev, sellerEarnings: gross - refunded - (comm - commRev) };
}
export function sellerFundsAll(d) { const t = { pending: 0, held: 0, available: 0, reserved: 0, paidOut: 0, refunded: 0, total: 0 }; for (const s of Object.keys(d.stores)) { const b = storeBuckets(d, s); for (const k in t) t[k] += b[k]; } return t; }
