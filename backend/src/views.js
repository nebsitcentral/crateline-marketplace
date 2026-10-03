// What each caller may read. The browser only ever receives these filtered views;
// private records are removed on the server, not hidden in the interface.
import { can, roleOf } from '@crateline/domain/fin.js';
import { isPublic } from '@crateline/domain/logic.js';

const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));
const STORE_PUBLIC = ['id', 'name', 'tagline', 'cat', 'hue', 'status', 'paused', 'joined', 'country', 'description', 'replacementTerms', 'ownerId'];
const maskEmail = e => e ? e.replace(/^(.)(.*)(@.*)$/, (m, a, b, c) => a + '•••' + c) : '';
// Counts a customer cannot derive from their own records, computed here from the full data.
const publicStore = (d, s) => ({ ...pick(s, STORE_PUBLIC), stats: {
  completed: d.orders.filter(o => o.storeId === s.id && o.status === 'completed').length,
  followers: Object.values(d.users).filter(u => u.following.includes(s.id)).length } });
// Public identity only (name and avatar colour) for people the caller deals with.
const people = (d, ids) => [...new Set(ids)].filter(id => d.users[id]).map(id => pick(d.users[id], ['id', 'name', 'hue']));

export function catalogView(d) {
  return {
    // Inactive categories are included with their flags so existing listings still render; the
    // listings below are already filtered to public ones.
    categories: d.categories,
    stores: Object.values(d.stores).filter(s => s.status === 'Active').map(s => publicStore(d, s)),
    people: people(d, Object.values(d.stores).filter(s => s.status === 'Active').map(s => s.ownerId)),
    listings: d.listings.filter(l => isPublic(d, l)),
    reviews: d.reviews,
    banners: d.content.banners.filter(b => b.state === 'Active'),
    featured: d.content.featured,
    faqs: d.content.faqs,
    features: d.settings.current.features,
    clockOffset: d.clockOffset || 0,
    // Published legal text is public; drafts stay with staff.
    policies: d.policies.map(p => ({ id: p.id, title: p.title, versions: p.versions.filter(v => v.state === 'Published') })),
  };
}

export function customerView(d, user) {
  const sid = user.storeId; const mineOrder = o => o.buyerId === user.id || (sid && o.storeId === sid);
  const orders = d.orders.filter(mineOrder); const orderIds = new Set(orders.map(o => o.id));
  const convs = d.conversations.filter(c => c.buyerId === user.id || (sid && c.storeId === sid));
  const offers = d.offers.filter(o => o.buyerId === user.id || (sid && o.storeId === sid));
  const catalog = catalogView(d);
  // Stores the customer has dealt with stay visible even if no longer active.
  const touched = new Set([...orders, ...convs, ...offers].map(x => x.storeId));
  const extraStores = Object.values(d.stores).filter(s => touched.has(s.id) && s.status !== 'Active').map(s => publicStore(d, s));
  const counterparties = [...orders, ...convs, ...offers].flatMap(x => [x.buyerId, d.stores[x.storeId]?.ownerId]);
  return {
    ...catalog,
    stores: [...catalog.stores, ...extraStores],
    people: people(d, [...catalog.people.map(p => p.id), ...counterparties]),
    me: pick(user, ['id', 'name', 'username', 'email', 'phone', 'telegram', 'hue', 'acct', 'joined', 'storeId', 'emailVerified', 'twoFA', 'prefs', 'deletion', 'following', 'restrictions']),
    myStore: sid ? d.stores[sid] : null,
    myListings: sid ? d.listings.filter(l => l.storeId === sid) : [],
    cart: d.carts[user.id] || [],
    purchases: d.purchases.filter(p => p.buyerId === user.id),
    orders,
    conversations: convs,
    offers,
    cases: d.cases.filter(c => orderIds.has(c.orderId)).map(c => { const { internal, ...rest } = c; return rest; }),
    refunds: d.refunds.filter(r => orderIds.has(r.orderId)).map(r => pick(r, ['id', 'orderId', 'caseId', 'amountC', 'cur', 'status', 'createdAt', 'confirmedAt'])),
    notifications: d.notifications.filter(n => n.userId === user.id),
    tickets: d.tickets.filter(t => t.userId === user.id).map(t => ({ ...t, thread: t.thread.filter(m => m.kind !== 'internal') })),
    payouts: sid ? d.payouts.filter(p => p.storeId === sid) : [],
    payoutMethods: sid ? d.payoutMethods[sid] || [] : [],
    ledger: sid ? d.ledger.filter(e => e.store === sid) : [],
    platform: sid ? d.platform.filter(e => e.store === sid) : [],
    verification: sid ? (d.verifications.find(v => v.storeId === sid) || null) : null,
    settings: { payoutMinC: d.settings.current.payoutMinC, payoutFeeC: d.settings.current.payoutFeeC, releaseDays: d.settings.current.releaseDays, buyerFeeRate: d.settings.current.buyerFeeRate, listingApproval: d.settings.current.listingApproval },
  };
}

// Staff receive whole collections only for the resources their role can view.
export function staffView(d, staff) {
  const c = p => can(d, staff, p);
  const out = { me: pick(staff, ['id', 'name', 'email', 'roles', 'activeRole', 'team', 'active']), role: roleOf(d, staff), roles: d.roles, settings: d.settings, categories: d.categories, clockOffset: d.clockOffset || 0 };
  if (c('users.view')) out.users = Object.values(d.users).map(u => ({ ...pick(u, ['id', 'name', 'username', 'hue', 'acct', 'joined', 'storeId', 'emailVerified', 'twoFA', 'deletion', 'restrictions', 'lastActive']), email: maskEmail(u.email) }));
  // Every staff role sees store names (orders, payouts and refunds refer to them); full store
  // records only with seller or catalog access.
  const full = c('sellers.view') || c('catalog.view');
  out.stores = Object.fromEntries(Object.entries(d.stores).map(([k, s]) => [k, full ? { ...s, stats: publicStore(d, s).stats } : publicStore(d, s)]));
  if (c('sellers.view')) out.verifications = d.verifications.map(v => c('sellers.evidence') ? v : { ...v, evidence: v.evidence.map(() => ({ name: 'hidden', size: 0 })), identity: { ...v.identity, dob: 'hidden' } });
  if (c('catalog.view')) { out.listings = d.listings; out.reports = d.reports; }
  if (c('content.draft')) { out.content = d.content; out.policies = d.policies; }
  if (c('orders.view')) { out.orders = d.orders.map(o => c('orders.evidence') ? o : { ...o, deliveries: o.deliveries.map(x => ({ ...x, file: null })) }); out.purchases = d.purchases; }
  if (c('cases.view')) { const scoped = roleOf(d, staff).scope?.cases === 'assigned'; out.cases = d.cases.filter(cs => !scoped || !d.assign['case:' + cs.id]?.assigneeId || d.assign['case:' + cs.id].assigneeId === staff.id); }
  if (c('orders.evidence') || c('cases.evidence')) out.conversations = d.conversations;
  if (c('payments.view')) { out.payments = d.payments; out.recon = d.recon; }
  if (c('refunds.view')) out.refunds = d.refunds;
  if (c('payouts.view')) { out.payouts = d.payouts; out.payoutMethods = d.payoutMethods; out.ledger = d.ledger; }
  if (c('reports.financial') || c('bizreports.view')) { out.ledger = d.ledger; out.platform = d.platform; }
  if (c('approvals.view')) out.approvals = d.approvals;
  if (c('support.view')) out.tickets = d.tickets;
  if (c('queue.view')) out.assign = d.assign;
  if (c('staff.view')) { out.staff = Object.fromEntries(Object.entries(d.staff).map(([k, s]) => [k, { ...s, sessions: s.sessions.map(x => pick(x, ['id', 'device', 'at'])) }])); out.invites = d.invites; }
  if (c('settings.view')) { out.integrations = d.integrations.map(i => ({ ...i, keyLabel: i.keyLabel ? i.keyLabel.replace(/[^•_]{4}$/, '••••') : '' })); out.payoutConfig = d.payoutConfig; }
  if (c('audit.view')) { out.audit = d.audit; out.securityEvents = d.securityEvents; }
  else if (c('activity.view')) out.audit = d.audit.filter(a => !a.sensitive);
  if (c('health.view')) out.tasks = d.tasks;
  out.notes = Object.fromEntries(Object.entries(d.notes || {}).filter(([k]) => k.startsWith('case:') ? c('cases.view') : k.startsWith('order:') ? c('orders.view') : true));
  out.staffNotes = d.staffNotes.filter(n => n.staffId === staff.id);
  // Simulated provider outcomes (demo setting, not secret); staff screens label which outcome applies.
  out.scenario = { provider: d.scenario?.provider || 'success', testConn: d.scenario?.testConn || 'success' };
  // Every staff member can browse the public marketplace; roles without catalog or content
  // access get the same public data guests see.
  const pub = catalogView(d);
  out.listings = out.listings || pub.listings; out.reviews = d.reviews;
  out.content = out.content || { banners: pub.banners, featured: pub.featured, faqs: pub.faqs };
  out.policies = out.policies || pub.policies;
  return out;
}
