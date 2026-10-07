// Launch reset: turns the demo marketplace into an empty one. Every customer, store, order,
// money record and staff member is removed except the Super Admin who runs it. Categories, roles,
// settings, payout configuration, FAQs and published policies stay. Used once, when going live.
const LISTS = ['listings', 'reviews', 'reports', 'verifications', 'purchases', 'payments', 'orders', 'conversations', 'offers', 'cases', 'refunds', 'payouts', 'approvals', 'ledger', 'platform', 'audit', 'notifications', 'staffNotes', 'tickets', 'securityEvents', 'recon', 'tasks', 'invites', 'exports', 'events', 'processedOps', 'blocked'];
const MAPS = ['users', 'stores', 'carts', 'payoutMethods', 'payoutSettings', 'holds', 'assign', 'notes', 'files', 'onboarding'];

export function launchDocument(doc, keepStaffId, { name = null, at = Date.now() } = {}) {
  const d = structuredClone(doc); const me = d.staff[keepStaffId];
  if (!me || !me.roles.includes('superadmin')) throw new Error('Only a Super Admin can be kept.');
  for (const k of LISTS) d[k] = [];
  for (const k of MAPS) d[k] = {};
  d.staff = { [me.id]: { ...me, name: name || me.name, roles: ['superadmin'], activeRole: 'superadmin', active: true, sessions: [] } };
  d.clockOffset = 0; d.scenario = { provider: 'success', testConn: 'success' };
  // Settings keep their current values; proposed and past versions referred to removed staff.
  d.settings = { ...d.settings, versions: [] };
  d.content = { ...d.content, banners: [], featured: [], announcements: [] };
  // Published policy text stays; drafts go.
  d.policies = d.policies.map(p => ({ ...p, versions: p.versions.filter(v => v.state === 'Published') }));
  d.audit = [{ id: 'AU-1', at, actorId: me.id, actor: d.staff[me.id].name, role: 'Super Admin', action: 'Marketplace reset for launch', object: 'marketplace', reason: 'Demo data and demo staff removed', before: null, after: null, approval: null, outcome: 'Success', sensitive: true }];
  // Counters keep counting, so new record ids never repeat ids already sent to payment providers.
  return d;
}
