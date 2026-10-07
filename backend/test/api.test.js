// End-to-end checks against the HTTP API. Uses the in-memory store, or Postgres when
// TEST_DATABASE_URL is set (the database is reset to the fixtures first).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || ''; process.env.SEED_DEMO_PASSWORD = 'test-pass-123'; process.env.SIMULATE_PROVIDERS = 'true'; process.env.AUTH_RATE_LIMIT = '1000';
const { createStore } = await import('../src/store.js');
const { seedStore } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { migrate } = await import('../src/migrate.js');

let server, base;
let store;
before(async () => { if (process.env.DATABASE_URL) await migrate(); store = createStore(); await store.init(); await seedStore(store, { force: true }); server = createApp(store).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); await store.close(); });
const req = async (path, { method = 'GET', body, token } = {}) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
const login = async (email, staff) => (await req(staff ? '/api/auth/staff/login' : '/api/auth/login', { method: 'POST', body: { email, password: 'test-pass-123' } })).body.token;

test('health and public catalog', async () => {
  assert.equal((await req('/health')).body.ok, true);
  const c = await req('/api/catalog'); assert.ok(c.body.listings.length > 5); assert.ok(c.body.listings.every(l => l.availability === 'Active'));
});

test('wrong password is refused without revealing the account', async () => {
  const r = await req('/api/auth/login', { method: 'POST', body: { email: 'mira@example.com', password: 'nope' } });
  assert.equal(r.status, 401); assert.match(r.body.error, /Email or password is incorrect/);
});

test('buyer sees only their own orders', async () => {
  const t = await login('mira@example.com'); const s = await req('/api/state', { token: t });
  assert.equal(s.status, 200); assert.ok(s.body.view.orders.every(o => o.buyerId === 'u_mira'));
  assert.equal(s.body.view.users, undefined);
});

test('support staff cannot touch refunds; finance can approve', async () => {
  const sup = await login('sam.sup-01@staff.example.com', true);
  const v = (await req('/api/state', { token: sup })).body.view; assert.equal(v.refunds, undefined);
  const r1 = await req('/api/actions/decideApproval', { method: 'POST', token: sup, body: { args: { approvalId: 'APR-1', decision: 'approve', reason: 'x' } } });
  assert.equal(r1.status, 403);
  const fin = await login('felix.fin-01@staff.example.com', true);
  const r2 = await req('/api/actions/decideApproval', { method: 'POST', token: fin, body: { args: { approvalId: 'APR-1', decision: 'approve', reason: 'Evidence reviewed' } } });
  assert.equal(r2.status, 200);
});

test('buyer checkout creates a paid order with server-side prices', async () => {
  const t = await login('mira@example.com'); const cat = (await req('/api/catalog')).body; const l = cat.listings.find(x => x.storeId !== 'st_atlas');
  const r = await req('/api/actions/checkout', { method: 'POST', token: t, body: { args: { items: [{ listingId: l.id, pkgId: l.packages[0].id, count: 2, requirements: 'Frankfurt' }], method: 'Card' } } });
  assert.equal(r.status, 200); assert.equal(r.body.result.status, 'Paid');
  const s = (await req('/api/state', { token: t })).body.view; const o = s.orders.find(x => x.purchaseRef === r.body.result.purchaseId);
  assert.equal(o.subtotal, l.packages[0].price * 2);
});

test('a buyer cannot confirm someone else\'s order', async () => {
  const t = await login('samir@example.com');
  const r = await req('/api/actions/confirmReceived', { method: 'POST', token: t, body: { args: { orderId: 'ORD-1001' } } });
  assert.equal(r.status, 403);
});

test('catalog carries public store stats, owner names only and published policies', async () => {
  const c = (await req('/api/catalog')).body;
  const atlas = c.stores.find(s => s.id === 'st_atlas');
  assert.equal(typeof atlas.stats.completed, 'number'); assert.equal(typeof atlas.stats.followers, 'number');
  assert.ok(c.people.some(p => p.id === atlas.ownerId));
  assert.ok(c.people.every(p => Object.keys(p).sort().join() === 'hue,id,name'));
  assert.ok(c.policies.length && c.policies.every(p => p.versions.every(v => v.state === 'Published')));
});

test('a seller sees public names for their buyers, and nobody else\'s private fields', async () => {
  const t = await login('rafi@atlas.example'); const v = (await req('/api/state', { token: t })).body.view;
  const buyers = new Set(v.orders.filter(o => o.storeId === v.me.storeId).map(o => o.buyerId));
  assert.ok(buyers.size > 0);
  for (const id of buyers) assert.ok(v.people.some(p => p.id === id), 'missing buyer ' + id);
  assert.ok(v.people.every(p => !('email' in p) && !('restrictions' in p)));
  assert.equal(typeof v.settings.listingApproval, 'boolean');
});

test('finance sees store names for payouts but not full seller records', async () => {
  const t = await login('felix.fin-01@staff.example.com', true); const v = (await req('/api/state', { token: t })).body.view;
  assert.ok(v.payouts.length && v.payouts.every(p => v.stores[p.storeId]?.name));
  assert.equal('completedBase' in v.stores.st_atlas, false); assert.equal(v.verifications, undefined);
});

test('customers can sign in with their username; staff cannot use the customer sign-in', async () => {
  const r = await req('/api/auth/login', { method: 'POST', body: { email: 'MIRA.P', password: 'test-pass-123' } });
  assert.equal(r.status, 200); assert.equal(r.body.id, 'u_mira');
  const s = await req('/api/auth/login', { method: 'POST', body: { email: 'felix.fin-01@staff.example.com', password: 'test-pass-123' } });
  assert.equal(s.status, 401);
});

test('registration names the failing field, records terms acceptance and signs in', async () => {
  const base = { name: 'Nadia Karim', username: 'nadia_k', email: 'nadia@example.com', password: 'longpass1', acceptTerms: true };
  const post = body => req('/api/auth/register', { method: 'POST', body });
  let r = await post({ ...base, acceptTerms: false }); assert.equal(r.status, 422); assert.equal(r.body.field, 'consent');
  r = await post({ ...base, username: 'Mira.P' }); assert.equal(r.status, 422); assert.equal(r.body.field, 'username');
  r = await post({ ...base, email: 'MIRA@example.com' }); assert.equal(r.status, 409); assert.equal(r.body.field, 'email');
  r = await post({ ...base, telegram: 'nadia' }); assert.equal(r.status, 422); assert.equal(r.body.field, 'telegram');
  r = await post(base); assert.equal(r.status, 201);
  const v = (await req('/api/state', { token: r.body.token })).body.view;
  assert.equal(v.me.username, 'nadia_k'); assert.equal(v.orders.length, 0);
  const again = await req('/api/auth/login', { method: 'POST', body: { email: 'nadia_k', password: 'longpass1' } }); assert.equal(again.status, 200);
});

test('order flow over the API: checkout, start, deliver, confirm, open case, payout', async () => {
  const mira = await login('mira@example.com'); const rafi = await login('rafi@atlas.example');
  const act = (token, name, args) => req('/api/actions/' + name, { method: 'POST', token, body: { args } });
  const l = (await req('/api/catalog')).body.listings.find(x => x.storeId === 'st_atlas');
  const co = await act(mira, 'checkout', { items: [{ listingId: l.id, pkgId: l.packages[0].id, count: 1, requirements: 'Send as CSV with headers please' }], method: 'Card' });
  assert.equal(co.status, 200, JSON.stringify(co.body));
  const order = (await req('/api/state', { token: mira })).body.view.orders.find(o => o.purchaseRef === co.body.result.purchaseId);
  assert.equal(order.status, 'paid');
  assert.equal((await act(mira, 'submitDelivery', { orderId: order.id, note: 'x', file: { name: 'a.csv', size: 1 }, qty: 1 })).status, 403); // buyer cannot deliver
  assert.equal((await act(rafi, 'startPreparation', { orderId: order.id })).status, 200);
  const del = await act(rafi, 'submitDelivery', { orderId: order.id, note: 'Full file attached', file: { name: 'leads.csv', size: 2048 }, qty: order.totalQty });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await act(mira, 'confirmReceived', { orderId: order.id })).status, 200);
  assert.equal((await req('/api/state', { token: mira })).body.view.orders.find(o => o.id === order.id).status, 'completed');
  const kase = await act(mira, 'openCase', { orderId: 'ORD-1004', reason: 'Not delivered on time', description: 'Nothing has arrived after the due date.', outcome: 'Full refund' });
  assert.equal(kase.status, 200, JSON.stringify(kase.body));
  assert.ok((await req('/api/state', { token: mira })).body.view.cases.some(c => c.id === kase.body.result.caseId));
  const pay = await act(rafi, 'requestPayout', { methodId: 'pm1', amountC: 2000 });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  const v = (await req('/api/state', { token: rafi })).body.view; assert.equal(v.payouts.find(p => p.id === pay.body.result.payoutId).amountC, 2000);
  assert.equal((await act(rafi, 'cancelPayout', { payoutId: pay.body.result.payoutId })).status, 200);
});

test('messages accept attachments and notify the other side', async () => {
  const mira = await login('mira@example.com');
  const conv = (await req('/api/state', { token: mira })).body.view.conversations.find(c => c.storeId === 'st_atlas');
  const act = args => req('/api/actions/sendMessage', { method: 'POST', token: mira, body: { args } });
  assert.equal((await act({ conversationId: conv.id, text: '  ' })).status, 422);
  assert.equal((await act({ conversationId: conv.id, text: '', files: [{ name: 'brief.pdf', size: 900 }] })).status, 200);
  const seller = await login('rafi@atlas.example'); const v = (await req('/api/state', { token: seller })).body.view;
  assert.ok(v.notifications.some(n => n.text.startsWith('New message from Mira')));
});

test('an approval decision is refused when the payout changed after the reviewer opened it', async () => {
  const fin = await login('felix.fin-01@staff.example.com', true); const v = (await req('/api/state', { token: fin })).body.view;
  const p = v.payouts.find(x => x.id === 'PAY-1001'); const apr = v.approvals.find(a => a.id === p.approvalId);
  const r = await req('/api/actions/decideApproval', { method: 'POST', token: fin, body: { args: { approvalId: apr.id, decision: 'approve', reason: 'Destination verified', version: apr.version, refVersion: p.version + 1 } } });
  assert.equal(r.status, 409); assert.match(r.body.error, /payout changed/);
});

test('staff work queue, notes, access records and role switch run on the server', async () => {
  const ops = await login('omar.ops-01@staff.example.com', true); const fin = await login('felix.fin-01@staff.example.com', true); const priya = await login('priya.fin-02@staff.example.com', true);
  const act = (token, name, args) => req('/api/actions/' + name, { method: 'POST', token, body: { args } });
  const key = 'case:CASE-3001';
  assert.equal((await act(ops, 'setPriority', { key, priority: 'High', reason: 'Buyer waiting' })).status, 200);
  assert.equal((await act(ops, 'setPriority', { key, priority: 'Whenever', reason: 'x' })).status, 422);
  assert.equal((await act(ops, 'escalateWork', { key, reason: 'Past due' })).status, 200);
  assert.equal((await act(ops, 'assignMany', { keys: [key], staffId: 'DSP-01' })).status, 200);
  assert.equal((await act(fin, 'assignMany', { keys: [key], staffId: 'FIN-01' })).status, 403); // Finance cannot assign work
  assert.equal((await act(ops, 'internalNote', { key, text: 'Called the seller' })).status, 200);
  const v = (await req('/api/state', { token: ops })).body.view;
  assert.equal(v.assign[key].priority, 'Urgent'); assert.equal(v.assign[key].assigneeId, 'DSP-01'); assert.ok(v.notes[key].some(n => n.text === 'Called the seller'));
  assert.equal((await act(fin, 'markStaffNotesRead', {})).status, 200);
  assert.ok((await req('/api/state', { token: fin })).body.view.staffNotes.every(n => n.read));
  assert.equal((await act(fin, 'logEvidenceView', { key: 'order:ORD-1003', reason: '' })).status, 422);
  assert.equal((await act(fin, 'logExport', { name: 'Refunds', rows: 3, columns: ['Refund', 'Amount'] })).status, 200);
  assert.equal((await act(priya, 'switchRole', { role: 'superadmin' })).status, 403);
  assert.equal((await act(priya, 'switchRole', { role: 'dispute' })).status, 200);
  assert.equal((await req('/api/state', { token: priya })).body.view.me.activeRole, 'dispute');
});

test('staff catalog, content, order, ticket and reconciliation actions run on the server', async () => {
  const sa = await login('sofia.sa-01@staff.example.com', true); const fin = await login('felix.fin-01@staff.example.com', true); const sup = await login('sam.sup-01@staff.example.com', true);
  const act = (token, name, args) => req('/api/actions/' + name, { method: 'POST', token, body: { args } });
  const ok = async (token, name, args) => { const r = await act(token, name, args); assert.equal(r.status, 200, name + ': ' + JSON.stringify(r.body)); return r; };
  // catalog and content
  await ok(sa, 'reorderSubcategory', { categoryId: 'server', subId: 'rdp' });
  assert.equal((await act(sa, 'reorderSubcategory', { categoryId: 'server', subId: 'rdp' })).status, 400); // already first
  await ok(sa, 'addSubcategory', { categoryId: 'server', name: 'Dedicated servers', reason: 'New demand' });
  await ok(sa, 'editCategory', { categoryId: 'server', subId: 'dedicated-servers', name: 'Bare metal', reason: 'Clearer name' });
  assert.equal((await act(sa, 'editCategory', { categoryId: 'nope', name: 'x', reason: 'y' })).status, 404);
  await ok(sa, 'setFeatured', { listingId: 'l_vps', on: false });
  assert.equal((await act(sa, 'setFeatured', { listingId: 'l_vps', on: false })).status, 400);
  await ok(sa, 'saveBanner', { banner: { id: 'BN-2', title: 'Spring offers', sub: '', link: 'search:vps', order: 2, start: Date.now(), end: Date.now() + 864e5, state: 'Active', publishedBy: 'Mallory' }, reason: 'Copy update' });
  let v = (await req('/api/state', { token: sa })).body.view;
  const bn = v.content.banners.find(b => b.id === 'BN-2'); assert.equal(bn.state, 'Draft'); assert.equal(bn.publishedBy, undefined); // client cannot set state
  assert.ok(!v.content.featured.includes('l_vps')); assert.ok(v.categories.find(c => c.id === 'server').subs.some(s => s.name === 'Bare metal'));
  await ok(sa, 'resolveReport', { reportId: 'RP-1', outcome: 'No violation found', reason: 'Checked listing' });
  // orders and tickets
  await ok(sa, 'staffContact', { orderId: 'ORD-1003', party: 'seller', text: 'Please respond to the case.', reason: 'Case deadline' });
  assert.equal((await act(sup, 'staffCancelOrder', { orderId: 'ORD-1003', basis: 'x', reason: 'y' })).status, 403); // support cannot cancel orders
  await ok(sup, 'ticketLink', { ticketId: 'TK-501', ref: 'ORD-1001' });
  await ok(sup, 'ticketEscalate', { ticketId: 'TK-501', reason: 'Needs finance' });
  // reconciliation and provider queries
  await ok(fin, 'queryPaymentStatus', { paymentId: v.payments[0].id });
  await ok(fin, 'reconIgnoreDuplicate', { reconId: 'RC-1', reason: 'First event processed' });
  assert.equal((await act(sup, 'reconEscalate', { reconId: 'RC-2', reason: 'x' })).status, 403);
  await ok(sa, 'sendRecovery', { userId: 'u_mira', reason: 'User asked by phone' });
  assert.equal((await act(sa, 'sendRecovery', { userId: 'u_nobody', reason: 'x' })).status, 404);
});

test('Super Admin staff, integration, security and policy actions run on the server', async () => {
  const sa = await login('sofia.sa-01@staff.example.com', true); const fin = await login('felix.fin-01@staff.example.com', true);
  const act = (token, name, args) => req('/api/actions/' + name, { method: 'POST', token, body: { args } });
  const ok = async (token, name, args) => { const r = await act(token, name, args); assert.equal(r.status, 200, name + ': ' + JSON.stringify(r.body)); return r; };
  await ok(sa, 'inviteStaff', { email: 'new.hire@staff.example.com', role: 'support' });
  assert.equal((await act(sa, 'inviteStaff', { email: 'someone@gmail.com', role: 'support' })).status, 422);
  await ok(sa, 'revokeInvite', { inviteId: 'INV-1' });
  assert.equal((await act(fin, 'inviteStaff', { email: 'x.y@staff.example.com', role: 'support' })).status, 403);
  assert.equal((await act(sa, 'proposeStaffRoles', { staffId: 'SUP-01', roles: ['support', 'catalog'], reason: 'Covers catalog' })).body.result, 'applied');
  assert.equal((await act(sa, 'proposeStaffRoles', { staffId: 'SUP-01', roles: ['support', 'finance'], reason: 'Covers refunds' })).body.result, 'approval'); // raises money authority
  await ok(sa, 'testConnection', { integrationId: 'INT-card', outcome: 'timeout' });
  await ok(sa, 'saveProvider', { integrationId: 'INT-card', markets: 'United States, United Kingdom', callback: 'https://api.example.com/hooks/card', reason: 'New callback' });
  assert.equal((await act(sa, 'saveProvider', { integrationId: 'INT-card', markets: 'US', callback: 'http://insecure', reason: 'x' })).status, 422);
  await ok(sa, 'proposeIntegrationMode', { integrationId: 'INT-card', reason: 'Go live' });
  await ok(sa, 'togglePayoutMethod', { type: 'PayPal' });
  await ok(sa, 'resolveSecurityEvent', { eventId: 'SE-2' });
  await ok(sa, 'retryTask', { taskId: 'TSK-1' });
  assert.equal((await act(sa, 'publishPolicy', { policyId: 'POL-terms', reason: 'Approved text' })).status, 400); // draft not submitted for review
  const v = (await req('/api/state', { token: sa })).body.view;
  assert.equal(v.integrations.find(i => i.id === 'INT-card').health, 'Timeout'); assert.equal(v.payoutConfig.find(p => p.type === 'PayPal').enabled, true);
  assert.equal(v.securityEvents.find(e => e.id === 'SE-2').status, 'Resolved'); assert.ok(v.approvals.some(a => a.type === 'integration'));
});

test('revoking all sessions ends existing staff sign-ins; a new sign-in works', async () => {
  const sa = await login('sofia.sa-01@staff.example.com', true); const old = await login('omar.ops-01@staff.example.com', true);
  assert.equal((await req('/api/state', { token: old })).status, 200);
  const r = await req('/api/actions/revokeSessions', { method: 'POST', token: sa, body: { args: { staffId: 'OPS-01', reason: 'Lost laptop' } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = await req('/api/state', { token: old }); assert.equal(after.status, 401); assert.match(after.body.error, /session was ended/);
  assert.equal((await req('/api/actions/escalateWork', { method: 'POST', token: old, body: { args: { key: 'case:CASE-3001', reason: 'x' } } })).status, 401);
  const fresh = await login('omar.ops-01@staff.example.com', true);
  assert.equal((await req('/api/state', { token: fresh })).status, 200);
});

test('buyer and seller responses: cancellation, case proposal and custom offers', async () => {
  const mira = await login('mira@example.com'); const rafi = await login('rafi@atlas.example');
  const act = (token, name, args) => req('/api/actions/' + name, { method: 'POST', token, body: { args } });
  const ok = async (token, name, args) => { const r = await act(token, name, args); assert.equal(r.status, 200, name + ': ' + JSON.stringify(r.body)); return r.body.result; };
  // cancellation: buyer asks, buyer cannot answer own request, seller accepts, a refund request appears
  const l = (await req('/api/catalog')).body.listings.find(x => x.storeId === 'st_atlas' && !x.requiresInfo);
  const co = await ok(mira, 'checkout', { items: [{ listingId: l.id, pkgId: l.packages[0].id, count: 1 }], method: 'Card' });
  const oid = (await req('/api/state', { token: mira })).body.view.orders.find(o => o.purchaseRef === co.purchaseId).id;
  await ok(mira, 'requestCancel', { orderId: oid, reason: 'Ordered the wrong package' });
  assert.equal((await act(mira, 'respondCancel', { orderId: oid, accept: true })).status, 403);
  await ok(rafi, 'respondCancel', { orderId: oid, accept: true });
  const mv = (await req('/api/state', { token: mira })).body.view;
  assert.equal(mv.orders.find(o => o.id === oid).status, 'cancelled'); assert.ok(mv.refunds.some(r => r.orderId === oid && r.status === 'Requested'));
  // case proposal: buyer opens a case, seller proposes a partial refund, buyer accepts
  assert.equal((await act(rafi, 'caseProposal', { caseId: 'CASE-3001', type: 'Replacement' })).status, 400); // already has a decided remedy
  const { caseId } = await ok(mira, 'openCase', { orderId: 'ORD-1001', reason: 'Items not working', description: 'About 30 of the records bounce on delivery.', outcome: 'Partial refund' });
  assert.equal((await act(rafi, 'caseProposal', { caseId, type: 'Partial refund', amount: 9999 })).status, 422);
  await ok(rafi, 'caseProposal', { caseId, type: 'Partial refund', amount: 20 });
  assert.equal((await act(rafi, 'caseDecide', { caseId, accept: true })).status, 403);
  await ok(mira, 'caseDecide', { caseId, accept: true });
  assert.ok((await req('/api/state', { token: mira })).body.view.refunds.some(r => r.caseId === caseId));
  // custom offer: seller sends in Mira's conversation, buyer accepts and pays at the offer price
  const conv = (await req('/api/state', { token: rafi })).body.view.conversations.find(c => c.buyerId === 'u_mira');
  const { offerId } = await ok(rafi, 'sendOffer', { conversationId: conv.id, listingId: l.id, qty: 500, scope: 'Custom export with phone numbers verified', price: 42.5, days: 2, replacement: '7 days', expiry: 3 });
  assert.equal((await act(rafi, 'acceptOffer', { offerId })).status, 403);
  await ok(mira, 'acceptOffer', { offerId });
  const paid = await ok(mira, 'checkout', { items: [{ offerId }], method: 'Card' });
  const p = (await req('/api/state', { token: mira })).body.view.purchases.find(x => x.id === paid.purchaseId); assert.equal(p.total, 42.5);
  assert.equal((await act(rafi, 'withdrawOffer', { offerId })).status, 400); // already paid
});

test('cart, follows, conversations, notifications, reviews and offer requests run on the server', async () => {
  const mira = await login('mira@example.com'); const lina = await login('linao@example.com');
  const act = (token, name, args) => req('/api/actions/' + name, { method: 'POST', token, body: { args } });
  const ok = async (token, name, args) => { const r = await act(token, name, args); assert.equal(r.status, 200, name + ': ' + JSON.stringify(r.body)); return r.body.result; };
  const state = async t => (await req('/api/state', { token: t })).body.view;
  const l = (await req('/api/catalog')).body.listings.find(x => x.storeId === 'st_nova');
  await ok(mira, 'addToCart', { listingId: l.id, pkgId: l.packages[0].id, count: 2 });
  let cart = (await state(mira)).cart; const item = cart.find(c => c.listingId === l.id);
  await ok(mira, 'setCartCount', { itemId: item.id, count: 3 });
  assert.equal((await act(mira, 'setCartCount', { itemId: item.id, count: 11 })).status, 422);
  await ok(mira, 'removeCartItem', { itemId: item.id });
  assert.ok(!(await state(mira)).cart.some(c => c.id === item.id));
  await ok(mira, 'setFollow', { storeId: 'st_nova', on: true }); assert.ok((await state(mira)).me.following.includes('st_nova'));
  await ok(mira, 'setFollow', { storeId: 'st_nova', on: false });
  const { conversationId } = await ok(mira, 'startConversation', { storeId: 'st_nova', listingId: l.id });
  await ok(mira, 'markConversationRead', { conversationId });
  await ok(mira, 'setConversationBlocked', { conversationId });
  assert.equal((await act(lina, 'clearConversation', { conversationId })).status, 403);
  await ok(mira, 'setConversationBlocked', { conversationId });
  await ok(mira, 'markNotificationsRead', { panel: 'buyer' });
  assert.ok((await state(mira)).notifications.filter(n => n.panel === 'buyer').every(n => n.read));
  const req1 = await ok(mira, 'requestOffer', { listingId: l.id, qty: 50, requirements: 'Need Frankfurt location with daily backups', budget: 30 });
  assert.ok((await state(mira)).offers.some(o => o.id === req1.id && o.kind === 'request'));
  // review: only the buyer of a completed order, once
  const done = (await state(mira)).orders.find(o => o.status === 'completed' && !o.review);
  if (done) {
    await ok(mira, 'submitReview', { orderId: done.id, rating: 5, text: 'Clean file, fast delivery.' });
    assert.equal((await act(mira, 'submitReview', { orderId: done.id, rating: 5, text: 'Again please' })).status, 400);
  }
  assert.equal((await act(lina, 'submitReview', { orderId: 'ORD-1001', rating: 5, text: 'Not my order' })).status, 403);
});

test('account settings: profile, preferences, deletion; email changes are refused', async () => {
  const t = await login('mira@example.com');
  const act = (name, args) => req('/api/actions/' + name, { method: 'POST', token: t, body: { args } });
  assert.equal((await act('updateProfile', { name: 'Mira Patel', username: 'mira.p', email: 'new@example.com' })).status, 422);
  assert.equal((await act('updateProfile', { name: 'Mira Patel', username: 'sami.r' })).status, 422); // taken
  assert.equal((await act('updateProfile', { name: 'Mira P. Patel', username: 'mira.p', phone: '+44 7700 900111', telegram: '@mirap', hue: 212 })).status, 200);
  assert.equal((await act('setPreference', { key: 'marketing', value: true })).status, 200);
  assert.equal((await act('setPreference', { key: 'nonsense', value: true })).status, 422);
  assert.equal((await act('requestDeletion', {})).status, 200);
  const v = (await req('/api/state', { token: t })).body.view;
  assert.equal(v.me.name, 'Mira P. Patel'); assert.equal(v.me.prefs.marketing, true); assert.ok(v.me.deletion);
  assert.equal((await act('withdrawDeletion', {})).status, 200);
});

test('support requests from guests and customers; password change ends other sessions', async () => {
  const g = await req('/api/support', { method: 'POST', body: { name: 'Guest', email: 'guest@example.com', subject: 'Question', desc: 'How do refunds work for partial deliveries?' } });
  assert.equal(g.status, 201); assert.match(g.body.ticketId, /^TK-/);
  assert.equal((await req('/api/support', { method: 'POST', body: { name: 'Guest', email: 'bad', desc: 'too short' } })).status, 422);
  const t = await login('samir@example.com');
  const s = await req('/api/support', { method: 'POST', token: t, body: { name: 'Samir', email: 'samir@example.com', desc: 'My delivery file will not open on Windows.' } });
  const sv = await req('/api/state', { token: t }); assert.equal(sv.status, 200, JSON.stringify(sv.body) + ' support:' + JSON.stringify(s.body)); assert.ok(sv.body.view.tickets.some(x => x.id === s.body.ticketId));
  const other = await login('samir@example.com');
  const bad = await req('/api/auth/password', { method: 'POST', token: t, body: { current: 'wrong', next: 'newpass123' } });
  assert.equal(bad.status, 422); assert.equal(bad.body.field, 'current');
  const okp = await req('/api/auth/password', { method: 'POST', token: t, body: { current: 'test-pass-123', next: 'newpass123' } });
  assert.equal(okp.status, 200);
  assert.equal((await req('/api/state', { token: other })).status, 401); // other session ended
  assert.equal((await req('/api/state', { token: okp.body.token })).status, 200); // fresh token works
  assert.equal((await req('/api/auth/login', { method: 'POST', body: { email: 'samir@example.com', password: 'test-pass-123' } })).status, 401);
  assert.equal((await req('/api/auth/login', { method: 'POST', body: { email: 'samir@example.com', password: 'newpass123' } })).status, 200);
});

test('seller tools: application, listings, store settings, payout methods and archiving', async () => {
  const reg = await req('/api/auth/register', { method: 'POST', body: { name: 'Tariq Hasan', username: 'tariq_h', email: 'tariq@example.com', password: 'sellpass1', acceptTerms: true } });
  const t = reg.body.token; const rafi = await login('rafi@atlas.example');
  const act = (token, name, args) => req('/api/actions/' + name, { method: 'POST', token, body: { args } });
  const ok = async (token, name, args) => { const r = await act(token, name, args); assert.equal(r.status, 200, name + ': ' + JSON.stringify(r.body)); return r.body.result; };
  const app = { name: 'Tariq Hasan', dob: '1990-04-02', store: 'Delta Leads', cat: 'data', types: ['bulk-database'], desc: 'Verified Bangladeshi SME contact lists, refreshed monthly.', country: 'Bangladesh', city: 'Dhaka', addr: '12 Road 7', doc: 'National ID card', docs: [{ name: 'nid.pdf', size: 1000 }] };
  assert.equal((await act(t, 'applyAsSeller', { ...app, store: 'Atlas Data Co.' })).status, 422); // taken
  assert.equal((await act(t, 'applyAsSeller', { ...app, dob: '2015-01-01' })).status, 422); // under 18
  const { storeId } = await ok(t, 'applyAsSeller', app);
  let v = (await req('/api/state', { token: t })).body.view;
  assert.equal(v.myStore.status, 'Verification pending'); assert.equal(v.verification.checks.email, false); // email not verified
  const listing = { title: 'SME owners list, Dhaka division', sub: 'bulk-database', unit: 'contacts', summary: 'Owner name, phone and email for 5,000 SMEs in Dhaka.', deliveryDays: 2, replacement: 'Replace bounced records within 7 days.', features: ['Validated monthly'], art: 1, packages: [{ name: 'Starter', desc: '1,000 contacts', qty: 1000, price: 40, days: 2 }], state: 'Active', storeId: 'st_atlas', sold: 999 };
  assert.equal((await act(t, 'saveListing', { listing, publish: true })).status, 400); // store not verified yet
  const saved = await ok(t, 'saveListing', { listing });
  v = (await req('/api/state', { token: t })).body.view; const mine = v.myListings.find(l => l.id === saved.listingId);
  assert.equal(mine.availability, 'Draft'); assert.equal(mine.storeId, storeId); assert.equal(mine.sold, 0); // client cannot set store, sales or status
  assert.equal((await act(t, 'saveListing', { listing: { ...listing, packages: [] } })).status, 422);
  const { listingId: copyId } = await ok(t, 'duplicateListing', { listingId: saved.listingId });
  await ok(t, 'deleteDraftListing', { listingId: copyId });
  assert.equal((await act(rafi, 'deleteDraftListing', { listingId: saved.listingId })).status, 404); // another store's listing
  const res = await ok(t, 'setListingAvailability', { ids: [saved.listingId], availability: 'Active' });
  assert.deepEqual(res.skipped, [saved.listingId]); // store not verified
  await ok(t, 'updateStore', { name: 'Delta Leads BD', tagline: 'SME data', description: 'Verified lists.', cat: 'data', hue: 30, replacementTerms: '7 days' });
  assert.equal((await act(t, 'updateStore', { name: 'Nova Cloud', cat: 'data' })).status, 422);
  await ok(t, 'setStorePaused', { paused: true });
  // payout destination: password is re-checked on the server
  const bad = await req('/api/payout-methods', { method: 'POST', token: t, body: { type: 'Bank', holder: 'Tariq Hasan', acct: '00112233', password: 'wrong' } });
  assert.equal(bad.status, 422); assert.equal(bad.body.field, 'password');
  assert.equal((await req('/api/payout-methods', { method: 'POST', token: t, body: { type: 'Bank', holder: 'Tariq Hasan', acct: '00112233', bank: 'City Bank', password: 'sellpass1' } })).status, 201);
  v = (await req('/api/state', { token: t })).body.view;
  assert.equal(v.payoutMethods.length, 1); assert.equal(v.payoutMethods[0].verified, false); assert.equal(v.myStore.paused, true); assert.equal(v.myStore.name, 'Delta Leads BD');
  // archiving: only finished orders of your own store
  const rv = (await req('/api/state', { token: rafi })).body.view;
  const done = rv.orders.find(o => o.storeId === 'st_atlas' && o.status === 'completed'); const open = rv.orders.find(o => o.storeId === 'st_atlas' && o.status === 'delivered');
  await ok(rafi, 'setOrderArchived', { orderId: done.id, archived: true });
  if (open) assert.equal((await act(rafi, 'setOrderArchived', { orderId: open.id, archived: true })).status, 400);
  assert.equal((await act(t, 'setOrderArchived', { orderId: done.id, archived: false })).status, 403);
});

test('staff without catalog access still see the public marketplace, not hidden listings', async () => {
  const sup = await login('sam.sup-01@staff.example.com', true); const v = (await req('/api/state', { token: sup })).body.view;
  assert.ok(v.listings.length > 3); assert.ok(v.listings.every(l => l.availability === 'Active')); assert.equal(v.reports, undefined);
  assert.ok(Array.isArray(v.content.banners));
});

test('validation errors name their field; stale versions return 409', async () => {
  const fin = await login('felix.fin-01@staff.example.com', true);
  const r = await req('/api/actions/cancelPayout', { method: 'POST', token: fin, body: { args: { payoutId: 'PAY-1001', reason: '' } } });
  assert.equal(r.status, 422); assert.equal(r.body.field, 'reason');
  const sa = await login('sofia.sa-01@staff.example.com', true); const v = (await req('/api/state', { token: sa })).body.view;
  const apr = v.approvals.find(a => a.status === 'Pending');
  const stale = await req('/api/actions/decideApproval', { method: 'POST', token: sa, body: { args: { approvalId: apr.id, decision: 'reject', reason: 'Old view', version: apr.version - 1 } } });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'stale');
});

test('demo controls: Super Admin only, refused when disabled, outcomes validated, reset restores fixtures', async () => {
  const { config } = await import('../src/config.js');
  const sa = await login('sofia.sa-01@staff.example.com', true); const fin = await login('felix.fin-01@staff.example.com', true);
  const post = (path, token, body) => req(path, { method: 'POST', token, body });
  assert.equal((await post('/api/demo/advance', fin, { ms: 864e5 })).status, 403);
  const before = (await req('/api/state', { token: sa })).body.view.clockOffset;
  assert.equal((await post('/api/demo/advance', sa, { ms: 864e5 })).status, 200);
  assert.equal((await req('/api/state', { token: sa })).body.view.clockOffset, before + 864e5);
  assert.equal((await post('/api/demo/scenario', sa, { provider: 'explode' })).status, 422);
  assert.equal((await post('/api/demo/scenario', sa, { provider: 'unknown', testConn: 'timeout' })).status, 200);
  assert.deepEqual((await req('/api/state', { token: fin })).body.view.scenario, { provider: 'unknown', testConn: 'timeout' });
  config.allowDemoControls = false;
  try { assert.equal((await post('/api/demo/advance', sa, { ms: 1 })).status, 403); assert.equal((await post('/api/demo/reset', sa)).status, 403); }
  finally { config.allowDemoControls = true; }
  assert.equal((await post('/api/demo/reset', sa)).status, 200);
  const after = (await req('/api/state', { token: (await login('sofia.sa-01@staff.example.com', true)) })).body.view;
  assert.equal(after.clockOffset, 0); assert.equal(after.scenario.provider, 'success');
});

test('long lists are capped in /api/state and paged through /api/list with the same permissions', async () => {
  const mira = await login('mira@example.com');
  const act = (name, args) => req('/api/actions/' + name, { method: 'POST', token: mira, body: { args } });
  const l = (await req('/api/catalog')).body.listings.find(x => x.storeId === 'st_nova');
  for (let i = 0; i < 110; i++) await act('setFollow', { storeId: 'st_nova', on: i % 2 === 0 }); // no notifications
  // create notifications: each failed checkout notifies the buyer
  for (let i = 0; i < 105; i++) await act('checkout', { items: [{ listingId: l.id, pkgId: l.packages[0].id, count: 1 }], method: 'Card', outcome: 'failure' });
  const st = (await req('/api/state', { token: mira })).body;
  assert.equal(st.view.notifications.length, 100); assert.equal(st.more.notifications, true);
  const p1 = (await req('/api/list/notifications?limit=60', { token: mira })).body; assert.equal(p1.items.length, 60); assert.ok(p1.next);
  const p2 = (await req('/api/list/notifications?limit=60&after=' + p1.next, { token: mira })).body;
  assert.ok(p2.items.length > 40); assert.ok(p2.items.every(n => n.userId === 'u_mira'));
  assert.equal(new Set([...p1.items, ...p2.items].map(n => n.id)).size, p1.items.length + p2.items.length); // no overlap
  assert.equal((await req('/api/list/audit', { token: mira })).status, 403); // customers have no audit view
  assert.equal((await req('/api/list/orders', { token: mira })).status, 404);
});

test('a Super Admin changes a staff sign-in email with their own password; others cannot', async () => {
  const sa = await login('kwame.sa-02@staff.example.com', true); const fin = await login('priya.fin-02@staff.example.com', true);
  const dana = (await req('/api/state', { token: sa })).body.view.staff; const id = Object.values(dana).find(s => s.email === 'dana.dsp-01@staff.example.com').id;
  const change = (token, body) => req(`/api/staff/${id}/email`, { method: 'POST', token, body });
  assert.equal((await change(fin, { email: 'new.dana@example.org', password: 'test-pass-123' })).status, 403);
  assert.equal((await change(sa, { email: 'new.dana@example.org', password: 'wrong' })).status, 422);
  assert.equal((await change(sa, { email: 'mira@example.com', password: 'test-pass-123' })).status, 422); // in use
  const old = await login('dana.dsp-01@staff.example.com', true);
  assert.equal((await change(sa, { email: 'New.Dana@Example.org', password: 'test-pass-123' })).status, 200);
  // The old address no longer signs in, the old session has ended, and the new address works.
  assert.equal(await login('dana.dsp-01@staff.example.com', true), undefined);
  assert.equal((await req('/api/state', { token: old })).status, 401);
  const fresh = await login('new.dana@example.org', true); assert.equal((await req('/api/state', { token: fresh })).body.view.me.email, 'new.dana@example.org');
  assert.ok((await req('/api/state', { token: sa })).body.view.audit.some(a => a.action === 'Staff email changed' && a.object === id));
});

test('a Super Admin adds a staff member, who sets a password from the emailed link and signs in', async () => {
  const { memoryTransport, processOutbox } = await import('../src/email.js'); const { config } = await import('../src/config.js');
  const was = config.emailTransport; const sa = await login('kwame.sa-02@staff.example.com', true); const fin = await login('priya.fin-02@staff.example.com', true);
  const add = (token, body) => req('/api/staff', { method: 'POST', token, body }); const body = { name: 'Tara Finch', email: 'Tara@Corp.example.org', role: 'finance', reason: 'New finance hire', password: 'test-pass-123' };
  config.emailTransport = 'off'; assert.equal((await add(sa, body)).status, 400); // no way to send the link
  config.emailTransport = 'log';
  try {
    assert.equal((await add(fin, body)).status, 403);
    assert.equal((await add(sa, { ...body, password: 'wrong' })).status, 422);
    assert.equal((await add(sa, { ...body, email: 'mira@example.com' })).status, 422); // a customer's address
    assert.equal((await add(sa, { ...body, role: 'nope' })).status, 422);
    const r = await add(sa, body); assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await add(sa, body)).status, 422); // already added
    const rec = (await req('/api/state', { token: sa })).body.view.staff[r.body.staffId];
    assert.equal(rec.name, 'Tara Finch'); assert.equal(rec.email, 'tara@corp.example.org'); assert.deepEqual(rec.roles, ['finance']); assert.equal(rec.lastSignIn, null);
    // Nobody can sign in as them yet.
    assert.equal((await req('/api/auth/staff/login', { method: 'POST', body: { email: 'tara@corp.example.org', password: 'test-pass-123' } })).status, 401);
    // The emailed link sets the password; then the sign-in works with the new role.
    const t = memoryTransport(); for (let i = 0; i < 20 && (await processOutbox(store, t)).sent; i++); const mail = t.sent.find(m => m.template === 'staffInvite' && m.to === 'tara@corp.example.org');
    assert.match(mail.text, /added you to the Crateline admin panel as Finance Admin/);
    const token = decodeURIComponent(mail.text.match(/[?]reset=([^\s&]+)/)[1]);
    assert.equal((await req('/api/auth/password/reset', { method: 'POST', body: { token, password: 'her-own-pass-9' } })).status, 200);
    const me = await req('/api/auth/staff/login', { method: 'POST', body: { email: 'tara@corp.example.org', password: 'her-own-pass-9' } }); assert.equal(me.status, 200);
    assert.ok((await req('/api/state', { token: me.body.token })).body.view.payouts);
    // Once they have signed in, the set-up link is not sent again.
    assert.equal((await req(`/api/staff/${r.body.staffId}/invite`, { method: 'POST', token: sa, body: { password: 'test-pass-123' } })).status, 400);
  } finally { config.emailTransport = was; }
});
