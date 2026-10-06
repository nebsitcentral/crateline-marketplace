// Named transitions the API accepts. Every handler receives the actor from the verified
// token, never from the request body. Staff handlers rely on the domain's permission checks
// (need/can); customer handlers check ownership here before calling the domain.
import * as F from '@crateline/domain/fin.js';
import * as L from '@crateline/domain/logic.js';
import * as A from '@crateline/domain/actions.js';
import * as O from '@crateline/domain/ops.js';
import * as SL from '@crateline/domain/seller.js';
import { config } from './config.js';
import { filesEnabled, MAX_FILE_BYTES } from './files.js';

const { DomainError } = F;
const fail = (m, code = 'rejected') => { throw new DomainError(m, code); };
const orderOf = (d, id) => d.orders.find(o => o.id === id) || fail('Order not found.', 'not_found');
// A live offer ('Sent', not expired) that belongs to the caller on the given side.
const offerFor = (d, u, id, side) => {
  const of = d.offers.find(x => x.id === id && x.kind === 'offer') || fail('Offer not found.', 'not_found');
  if (side === 'buyer' ? of.buyerId !== u.id : !(u.storeId && of.storeId === u.storeId)) fail('This offer is not yours.', 'denied');
  if (of.status !== 'Sent' || of.expiresAt <= F.now()) fail(`Offer ${of.id} is ${of.expiresAt <= F.now() ? 'expired' : of.status.toLowerCase()}.`);
  return of;
};
const conv = (d, id) => d.conversations.find(x => x.id === id) || fail('Conversation not found.', 'not_found');
const found = (list, id, what) => list.find(x => x.id === id) || fail(`${what} not found.`, 'not_found');
const user = (d, id) => d.users[id] || fail('User not found.', 'not_found');
const caseOf = (d, id) => d.cases.find(c => c.id === id) || fail('Case not found.', 'not_found');
const asBuyer = (d, user, oid) => { const o = orderOf(d, oid); if (o.buyerId !== user.id) fail('This order belongs to another account.', 'denied'); return o; };
const asSeller = (d, user, oid) => { const o = orderOf(d, oid); if (!user.storeId || o.storeId !== user.storeId) fail('This order does not belong to your store.', 'denied'); return o; };
// Validation errors name the request field they belong to, so forms can show them in place.
const FIELD = { Reason: 'reason', Message: 'message', Request: 'text', Response: 'text', Note: 'text', Information: 'text', 'Delivery note': 'note', Description: 'description', 'Requested outcome': 'outcome', 'Policy text': 'content', Name: 'name', Scope: 'scope', 'Replacement terms': 'replacement', Quantity: 'qty', Price: 'price', 'Delivery time': 'days', Amount: 'amountC', Days: 'days', Reference: 'ref', Basis: 'basis', 'Receipt reference': 'receiptRef' };
const invalid = (msg, name) => { throw Object.assign(new DomainError(msg, 'validation'), { field: FIELD[name] }); };
const str = (v, name, min = 1) => { if (typeof v !== 'string' || !v.trim()) invalid(`${name} is required.`, name); if (v.trim().length < min) invalid(`${name} needs at least ${min} characters.`, name); return v.trim(); };
const int = (v, name) => { if (!Number.isInteger(v) || v <= 0) invalid(`${name} must be a positive whole number.`, name); return v; };
const sim = () => { if (!config.simulateProviders) fail('Simulated provider events are disabled on this server.', 'denied'); };
const CRYPTO_NETS = ['USDT on Tron (TRC-20)', 'USDT on Ethereum (ERC-20)', 'USDC on Base'];
// An attachment. With file storage on, it must be a file this customer uploaded (POST /api/files)
// and has not attached before; `kind` records where it went, which decides who may download it.
// Without file storage, attachments are simulated: name and size only.
const file = (d, u, f, kind) => {
  if (!f || typeof f !== 'object') return null;
  if (typeof f.id === 'string') {
    const rec = d.files?.[f.id]; if (!rec || rec.ownerId !== u.id) fail('An attached file was not found. Attach it again.', 'validation');
    if (rec.status !== 'ready') fail(`${rec.name} has not finished uploading. Attach it again.`, 'validation');
    if (rec.attached) fail(`${rec.name} is already attached elsewhere. Upload it again.`, 'validation');
    rec.attached = kind; return { id: rec.id, name: rec.name, size: rec.size };
  }
  if (filesEnabled()) fail('An attached file was not uploaded. Attach it again.', 'validation');
  return typeof f.name === 'string' ? { name: f.name.slice(0, 200), size: Math.max(0, Math.min(Number(f.size) || 0, MAX_FILE_BYTES)) } : null;
};
const fileList = (d, u, files, kind) => (Array.isArray(files) ? files : []).slice(0, 10).map(f => file(d, u, f, kind)).filter(Boolean);

// ---------- customer actions: actor is a user record
export const customer = {
  // Items are listing packages, or a single accepted custom offer. Prices always come from the
  // server's records, never from the request.
  checkout(d, u, { items, method, outcome = 'success', net = null, cartIds = [], retryOf = null }) {
    if (L.activeRestriction(u, 'purchases')) fail('Your account cannot place new orders right now.', 'denied');
    if (!Array.isArray(items) || !items.length || items.length > 20) fail('Add between 1 and 20 items.', 'validation');
    if (!['Card', 'Crypto', 'bKash', 'Nagad'].includes(method)) fail('Choose a payment method.', 'validation');
    // With NOWPayments set up, crypto is a real payment: the purchase waits for the provider's
    // verified notification and the requested outcome is ignored. Other methods are simulated only.
    const real = method === 'Crypto' && config.payments === 'nowpayments';
    if (!real && !config.simulateProviders) fail(method === 'Crypto' ? 'Crypto payments are not set up on this server yet.' : `${method} payments are not available yet. Choose Crypto.`, 'validation');
    if (method === 'Crypto' && !real && !CRYPTO_NETS.includes(net)) fail('Choose a network and asset.', 'validation');
    L.refreshOfferExpiry(d);
    const lines = items.map(it => {
      if (it.offerId) {
        if (items.length > 1) fail('Pay for a custom offer on its own.', 'validation');
        const of = d.offers.find(x => x.id === it.offerId && x.buyerId === u.id) || fail('Offer not found.', 'not_found');
        if (of.status !== 'Accepted awaiting payment' || of.expiresAt <= F.now()) fail(`Offer ${of.id} cannot be purchased (${of.expiresAt <= F.now() ? 'expired' : of.status}). Ask the seller for a new offer.`);
        const l = d.listings.find(x => x.id === of.listingId) || fail('The listing for this offer no longer exists.');
        return { listingId: l.id, pkgId: l.packages[0].id, count: 1, requirements: '', offerId: of.id, price: of.price, title: l.title, storeId: l.storeId };
      }
      const l = d.listings.find(x => x.id === it.listingId); if (!l || !L.isPublic(d, l)) fail('An item is no longer available.', 'validation');
      if (l.storeId === u.storeId) fail('You cannot buy your own listing.', 'denied');
      const pkg = l.packages.find(p => p.id === it.pkgId) || fail('Package not found.', 'validation');
      const count = Number(it.count); if (!Number.isInteger(count) || count < 1 || count > 10) fail('Package count must be 1 to 10.', 'validation');
      return { listingId: l.id, pkgId: pkg.id, count, requirements: String(it.requirements || '').slice(0, 2000), price: pkg.price, title: l.title, storeId: l.storeId };
    });
    const cart = d.carts[u.id] || [];
    if (!Array.isArray(cartIds) || cartIds.some(id => !cart.some(ci => ci.id === id))) fail('Your cart changed. Review it and try again.', 'stale');
    if (retryOf && !d.purchases.some(p => p.id === retryOf && p.buyerId === u.id)) fail('Purchase not found.', 'not_found');
    const sub = Math.round(lines.reduce((a, x) => a + x.price * x.count, 0) * 100) / 100; const fee = Math.round(sub * F.S(d).buyerFeeRate * 100) / 100;
    const status = real ? 'Pending' : ({ success: 'Processing', pending: 'Pending', failure: 'Failed', cancel: 'Cancelled' }[outcome] || 'Pending');
    const id = L.newId(d, 'PG');
    d.purchases.unshift({ id, buyerId: u.id, at: F.now(), method, net: method === 'Crypto' && !real ? net : null, provider: real ? 'NOWPayments' : null, subtotal: sub, fee, total: Math.round((sub + fee) * 100) / 100, status, termsVersion: L.currentTerms(d), items: lines, fromCart: cartIds.length > 0, cartIds, retryOf, ordersCreated: false });
    L.startPayment(d, d.purchases[0]);
    if (status === 'Processing') L.completePurchase(d, id);
    if (status === 'Failed') L.notify(d, u.id, 'buyer', `Payment ${id} failed (simulated). No charge was made.`, { page: 'pay-result', id });
    return { purchaseId: id, status: d.purchases.find(p => p.id === id).status };
  },
  expirePayment(d, u, { purchaseId }) { sim(); const p = d.purchases.find(x => x.id === purchaseId && x.buyerId === u.id) || fail('Purchase not found.', 'not_found'); if (p.status !== 'Pending') fail(`Purchase is ${p.status}.`); if (p.provider) fail(`Only ${p.provider} can confirm or expire this payment.`, 'denied'); p.status = 'Expired'; },
  confirmPayment(d, u, { purchaseId }) { sim(); const p = d.purchases.find(x => x.id === purchaseId && x.buyerId === u.id) || fail('Purchase not found.', 'not_found'); if (p.status !== 'Pending') fail(`Purchase is ${p.status}.`); if (p.provider) fail(`Only ${p.provider} can confirm or expire this payment.`, 'denied'); L.completePurchase(d, p.id); return { status: 'Paid' }; },
  submitInfo(d, u, { orderId, text }) { const o = asBuyer(d, u, orderId); if (o.status !== 'awaiting_info') fail('This order is not waiting for information.'); A.submitInfo(d, o, str(text, 'Information', 3)); },
  confirmReceived(d, u, { orderId }) { const o = asBuyer(d, u, orderId); if (o.status !== 'delivered') fail('Only a delivered order can be confirmed.'); if (L.openCase(d, o)) fail('Resolve the open case first.'); A.confirmReceived(d, o); },
  requestReplacement(d, u, { orderId, reason, files = [] }) { const o = asBuyer(d, u, orderId); if (o.status !== 'delivered') fail('Replacements can be requested on delivered orders.'); A.requestReplacement(d, o, str(reason, 'Reason', 5), fileList(d, u, files, 'order')); },
  openCase(d, u, { orderId, reason, description, outcome, files = [] }) { const o = asBuyer(d, u, orderId); if (L.openCase(d, o)) fail('A case is already open on this order.'); if (['cancelled', 'refunded', 'unpaid', 'awaiting_info'].includes(o.status)) fail('This order cannot be reported in its current state.'); return { caseId: A.createCase(d, o, { reason: str(reason, 'Reason'), description: str(description, 'Description', 15), outcome: str(outcome, 'Requested outcome'), files: fileList(d, u, files, 'case') }) }; },
  caseRespond(d, u, { caseId, text, files = [] }) { const c = caseOf(d, caseId); const side = c.buyerId === u.id ? 'buyer' : u.storeId === c.storeId ? 'seller' : fail('Not your case.', 'denied'); if (c.status === 'Closed') fail('The case is closed.'); A.caseRespond(d, c, side, str(text, 'Response'), fileList(d, u, files, 'case')); },
  sendMessage(d, u, { conversationId, text, files = [] }) { const c = d.conversations.find(x => x.id === conversationId) || fail('Conversation not found.', 'not_found'); const side = c.buyerId === u.id ? 'buyer' : u.storeId === c.storeId ? 'seller' : fail('Not your conversation.', 'denied'); if (c.blocked) fail('This conversation is blocked.'); if (L.activeRestriction(u, 'messages')) fail('Messaging is restricted on your account.', 'denied');
    const fs = fileList(d, u, files, 'conversation'); const body = typeof text === 'string' ? text.trim().slice(0, 5000) : '';
    if (!body && !fs.length) fail('Write a message or attach a file.', 'validation');
    L.pushMsg(d, c, side, body, fs.length ? { files: fs } : {});
    L.notify(d, side === 'buyer' ? d.stores[c.storeId].ownerId : c.buyerId, side === 'buyer' ? 'seller' : 'buyer', `New message from ${side === 'buyer' ? u.name : d.stores[c.storeId].name}.`, { page: 'inbox', id: c.id }); },
  startPreparation(d, u, { orderId }) { const o = asSeller(d, u, orderId); if (o.status !== 'paid') fail('Only a paid order can be started.'); A.startPrep(d, o); },
  submitDelivery(d, u, { orderId, note, file: f, qty }) { const o = asSeller(d, u, orderId); const repl = o.replacement?.state === 'Requested'; if (!['preparing', 'partial'].includes(o.status) && !repl) fail('Start preparation before delivering.'); const remaining = repl ? o.totalQty : o.totalQty - L.deliveredQty(o); int(qty, 'Quantity'); if (qty > remaining) fail(`Quantity cannot exceed ${remaining}.`, 'validation'); A.submitDelivery(d, o, { note: str(note, 'Delivery note', 5), file: file(d, u, f, 'order') || fail('Attach the delivery file.', 'validation'), qty }); },
  requestBuyerInfo(d, u, { orderId, text }) { const o = asSeller(d, u, orderId); if (!['paid', 'preparing'].includes(o.status) || o.deliveries.length) fail('Information can be requested before delivery only.'); A.requestInfo(d, o, str(text, 'Request', 5)); },
  requestExtension(d, u, { orderId, days, reason }) { const o = asSeller(d, u, orderId); if (![1, 2, 3, 5, 7].includes(days)) fail('Choose 1, 2, 3, 5 or 7 days.', 'validation'); A.requestExtension(d, o, days, str(reason, 'Reason', 5)); },
  // Order responses between buyer and seller
  respondExtension(d, u, { orderId, accept }) { const o = asBuyer(d, u, orderId); if (o.extension?.state !== 'Requested') fail('There is no extension request to answer.'); A.respondExtension(d, o, !!accept); },
  requestCancel(d, u, { orderId, reason }) {
    const o = orderOf(d, orderId); const by = o.buyerId === u.id ? 'buyer' : u.storeId && o.storeId === u.storeId ? 'seller' : fail('This order is not yours.', 'denied');
    if (!['paid', 'preparing', 'awaiting_info'].includes(o.status) || o.deliveries.length) fail('Cancellation can be requested before delivery only.');
    if (o.cancelRequest?.state === 'Requested') fail('A cancellation request is already open.');
    A.requestCancel(d, o, by, str(reason, 'Reason', 5));
  },
  respondCancel(d, u, { orderId, accept }) {
    const o = orderOf(d, orderId); const r = o.cancelRequest;
    if (r?.state !== 'Requested') fail('There is no cancellation request to answer.');
    // Only the other party answers: the seller answers a buyer's request and vice versa.
    if (r.by === 'buyer' ? !(u.storeId && o.storeId === u.storeId) : o.buyerId !== u.id) fail('Only the other party can answer this request.', 'denied');
    A.respondCancel(d, o, !!accept, r.by === 'buyer' ? 'Seller' : 'Buyer');
  },
  // Case steps between buyer and seller
  caseProposal(d, u, { caseId, type, amount, note = '' }) {
    const c = caseOf(d, caseId); if (!(u.storeId && c.storeId === u.storeId)) fail('Only the seller can propose a remedy.', 'denied');
    if (['Resolved', 'Closed'].includes(c.status) || c.remedy) fail('This case no longer accepts proposals.');
    if (!['Replacement', 'Partial refund', 'Full refund', 'Cancel order'].includes(type)) fail('Choose a remedy.', 'validation');
    const o = orderOf(d, c.orderId);
    const amt = type === 'Full refund' ? o.total : type === 'Partial refund' ? Number(amount) : null;
    if (type === 'Partial refund' && !(amt > 0 && amt <= o.total)) fail(`Enter an amount between 0.01 and ${o.total}.`, 'validation');
    A.caseProposal(d, c, { type, amount: amt, note: String(note).slice(0, 2000) });
  },
  caseDecide(d, u, { caseId, accept }) {
    const c = caseOf(d, caseId); if (c.buyerId !== u.id) fail('Only the buyer can answer the proposal.', 'denied');
    if (c.proposal?.state !== 'Proposed') fail('There is no proposal to answer.');
    A.caseDecide(d, c, !!accept);
  },
  caseEscalate(d, u, { caseId }) {
    const c = caseOf(d, caseId); const side = c.buyerId === u.id ? 'buyer' : u.storeId === c.storeId ? 'seller' : fail('Not your case.', 'denied');
    if (['Resolved', 'Closed', 'Escalated'].includes(c.status)) fail(`This case is ${c.status.toLowerCase()}.`);
    A.caseEscalate(d, c, side);
  },
  caseCloseByBuyer(d, u, { caseId }) { const c = caseOf(d, caseId); if (c.buyerId !== u.id) fail('Only the buyer can close this case.', 'denied'); if (c.status === 'Closed') fail('The case is already closed.'); A.caseClose(d, c, 'buyer'); },
  // Custom offers
  sendOffer(d, u, { conversationId, requestId = null, listingId, qty, scope, price, days, replacement, expiry }) {
    const c = d.conversations.find(x => x.id === conversationId) || fail('Conversation not found.', 'not_found');
    if (!(u.storeId && c.storeId === u.storeId)) fail('Only the seller can send offers.', 'denied'); if (c.blocked) fail('This conversation is blocked.');
    const l = d.listings.find(x => x.id === listingId && x.storeId === u.storeId && x.availability !== 'Archived') || fail('Choose one of your listings.', 'validation');
    const req = requestId ? d.offers.find(x => x.id === requestId && x.kind === 'request' && x.convId === c.id) || fail('Request not found.', 'not_found') : null;
    if (req && req.status !== 'Requested' && req.status !== 'Answered') fail('This request is closed.');
    const n = (v, name) => { const x = Number(v); if (!(x > 0) || x > 1e9) invalid(`${name} must be greater than zero.`, name); return x; };
    if (![1, 3, 7].includes(Number(expiry))) fail('Choose 1, 3 or 7 days.', 'validation');
    return { offerId: A.sendOffer(d, c, req, { listingId: l.id, qty: Math.round(n(qty, 'Quantity')), scope: str(scope, 'Scope', 10).slice(0, 2000), price: n(price, 'Price'), days: Math.round(n(days, 'Delivery time')), replacement: str(replacement, 'Replacement terms').slice(0, 500), expiry: Number(expiry) }) };
  },
  declineRequest(d, u, { conversationId, requestId, reason = '' }) {
    const c = d.conversations.find(x => x.id === conversationId) || fail('Conversation not found.', 'not_found'); if (!(u.storeId && c.storeId === u.storeId)) fail('Only the seller can decline.', 'denied');
    const req = d.offers.find(x => x.id === requestId && x.kind === 'request' && x.convId === c.id) || fail('Request not found.', 'not_found'); if (req.status !== 'Requested') fail('This request is closed.');
    A.declineRequest(d, c, req, String(reason).trim().slice(0, 1000));
  },
  acceptOffer(d, u, { offerId }) { const of = offerFor(d, u, offerId, 'buyer'); A.acceptOffer(d, of); },
  rejectOffer(d, u, { offerId }) { const of = offerFor(d, u, offerId, 'buyer'); A.rejectOffer(d, of); },
  withdrawOffer(d, u, { offerId }) { const of = offerFor(d, u, offerId, 'seller'); A.withdrawOffer(d, of); },
  // Cart, follows, conversations, notifications, reviews
  addToCart: (d, u, a) => { if (L.activeRestriction(u, 'purchases')) fail('Your account cannot place new orders right now.', 'denied'); A.addToCart(d, u, a.listingId, a.pkgId, a.count); },
  setCartCount: (d, u, a) => A.setCartCount(d, u, a.itemId, a.count),
  removeCartItem: (d, u, a) => A.removeCartItem(d, u, a.itemId),
  setFollow: (d, u, a) => A.setFollow(d, u, a.storeId, !!a.on),
  startConversation: (d, u, a) => ({ conversationId: A.startConversation(d, u, a.storeId, a.listingId || null) }),
  orderConversation: (d, u, a) => ({ conversationId: A.orderConversation(d, u, orderOf(d, a.orderId)) }),
  markNotificationsRead: (d, u, a) => { if (!['buyer', 'seller'].includes(a.panel) && !a.id) fail('Choose a panel.', 'validation'); A.markNotificationsRead(d, u, a.panel, a.id || null); },
  submitReview: (d, u, a) => A.submitReview(d, u, orderOf(d, a.orderId), a.rating, a.text),
  requestOffer: (d, u, a) => { if (L.activeRestriction(u, 'messages')) fail('Messaging is restricted on your account.', 'denied'); return A.requestOffer(d, u, a.listingId, a); },
  setConversationBlocked: (d, u, a) => A.setConversationBlocked(d, u, conv(d, a.conversationId)),
  clearConversation: (d, u, a) => A.clearConversation(d, u, conv(d, a.conversationId)),
  hideConversation: (d, u, a) => A.hideConversation(d, u, conv(d, a.conversationId)),
  markConversationRead: (d, u, a) => A.markConversationRead(d, u, conv(d, a.conversationId)),
  // Account. Email changes and two-factor need real email and sign-in support, so they are refused here.
  updateProfile(d, u, a) { if (a.email != null && String(a.email).toLowerCase() !== u.email) fail('Changing your email needs email verification, which is not available yet.', 'validation'); A.updateProfile(d, u, a); },
  setPreference: (d, u, a) => A.setPreference(d, u, a.key, a.value),
  requestDeletion: (d, u) => A.requestDeletion(d, u, O.closureBlockers(d, u.id)),
  withdrawDeletion: (d, u) => A.withdrawDeletion(d, u),
  // Seller tools (payout destinations use POST /api/payout-methods, which re-checks the password)
  applyAsSeller: (d, u, a) => ({ storeId: SL.applyAsSeller(d, u, a, { kyc: config.kyc === 'didit' ? 'Didit' : null }) }),
  saveListing: (d, u, a) => SL.saveListing(d, u, a.listingId || null, a.listing || {}, !!a.publish),
  setListingAvailability: (d, u, a) => SL.setListingAvailability(d, u, a.ids, a.availability),
  deleteDraftListing: (d, u, a) => SL.deleteDraftListing(d, u, a.listingId),
  duplicateListing: (d, u, a) => ({ listingId: SL.duplicateListing(d, u, a.listingId) }),
  updateStore: (d, u, a) => SL.updateStore(d, u, a),
  setStorePaused: (d, u, a) => SL.setStorePaused(d, u, !!a.paused),
  setOrderArchived: (d, u, a) => SL.setOrderArchived(d, u, orderOf(d, a.orderId), !!a.archived),
  requestPayout(d, u, { methodId, amountC }) { if (!u.storeId) fail('Only sellers can request payouts.', 'denied'); int(amountC, 'Amount'); return { payoutId: F.requestPayout(d, u, u.storeId, methodId, amountC).id }; },
  cancelPayout(d, u, { payoutId }) { const p = d.payouts.find(x => x.id === payoutId) || fail('Payout not found.', 'not_found'); if (p.storeId !== u.storeId) fail('Not your payout.', 'denied'); F.cancelPayout(d, u, p.id, 'Cancelled by seller', false); },
};

// ---------- staff actions: actor is a staff record; the domain checks permissions
export const staff = {
  claim(d, s, { key }) { const a = F.assignment(d, key); if (a.assigneeId) fail('Already assigned.'); F.setAssignee(d, s, key, s.id, 'Claimed', key.split(':')[1]); },
  assign(d, s, { key, staffId, reason }) { F.need(d, s, 'queue.assign', 'assign work'); if (staffId && !d.staff[staffId]?.active) fail('That staff account is not active.'); F.setAssignee(d, s, key, staffId || null, str(reason, 'Reason'), key.split(':')[1]); },
  requestRefund: (d, s, a) => ({ refundId: F.requestRefund(d, s, { orderId: a.orderId, amountC: a.amountC, reason: a.reason, caseId: a.caseId }).id }),
  editRefundAmount: (d, s, a) => F.editRefundAmount(d, s, a.refundId, a.amountC, a.reason, a.version),
  // refVersion: the version of the refund or payout the reviewer saw, so a change made after they
  // opened it (for example a new destination) refuses the decision.
  decideApproval: (d, s, a) => {
    if (!['approve', 'reject', 'changes'].includes(a.decision)) fail('Unknown decision.', 'validation');
    const apr = d.approvals.find(x => x.id === a.approvalId) || fail('Approval not found.', 'not_found');
    const rec = apr.type === 'refund' ? d.refunds.find(x => x.id === apr.ref) : apr.type === 'payout' ? d.payouts.find(x => x.id === apr.ref) : null;
    if (a.refVersion != null && rec && rec.version !== a.refVersion) fail(`This ${apr.type} changed since you opened it. The latest version is now shown; review it before deciding.`, 'stale');
    F.decideApproval(d, s, a.approvalId, a.decision, a.reason, a.version);
  },
  executeRefund: (d, s, a) => F.executeRefund(d, s, a.refundId, a.version),
  executePayout: (d, s, a) => F.executePayout(d, s, a.payoutId, a.version),
  cancelPayout: (d, s, a) => F.cancelPayout(d, s, a.payoutId, str(a.reason, 'Reason'), true),
  refundProviderEvent: (d, s, a) => { sim(); return F.refundProviderEvent(d, s, a.refundId, a.outcome); },
  payoutProviderEvent: (d, s, a) => { sim(); return F.payoutProviderEvent(d, s, a.payoutId, a.outcome); },
  restrictUser: (d, s, a) => O.restrictUser(d, s, a.userId, { scope: a.scope, reason: str(a.reason, 'Reason'), days: a.days, notice: a.notice }),
  restoreUser: (d, s, a) => O.restoreUser(d, s, a.userId, a.restrictionId, str(a.reason, 'Reason')),
  sellerRequestInfo: (d, s, a) => O.sellerRequestInfo(d, s, a.storeId, a.fields || [], str(a.message, 'Message'), str(a.reason, 'Reason'), a.version),
  sellerMarkCheck: (d, s, a) => O.markCheck(d, s, a.storeId, a.check),
  sellerApprove: (d, s, a) => O.sellerApprove(d, s, a.storeId, str(a.reason, 'Reason'), str(a.message, 'Message'), a.version),
  sellerReject: (d, s, a) => O.sellerReject(d, s, a.storeId, str(a.reason, 'Reason'), str(a.message, 'Message'), !!a.resubmitAllowed, a.version),
  storeControl: (d, s, a) => O.storeControl(d, s, a.storeId, a.action, str(a.reason, 'Reason'), str(a.message, 'Message'), a.days),
  moderateListing: (d, s, a) => O.moderateListing(d, s, a.listingId, a.action, str(a.reason, 'Reason'), a.message || ''),
  caseRequestInfo: (d, s, a) => O.caseRequestInfo(d, s, a.caseId, a.party, str(a.text, 'Request'), str(a.reason, 'Reason'), a.version),
  casePublicMessage: (d, s, a) => O.casePublicMessage(d, s, a.caseId, a.text, a.version),
  caseDecision: (d, s, a) => O.caseDecision(d, s, a.caseId, { type: a.type, amountC: a.amountC, days: a.days, rationale: a.rationale, evidence: a.evidence }, a.version),
  caseVerifyRemedy: (d, s, a) => O.caseVerifyRemedy(d, s, a.caseId, str(a.reason, 'Reason'), a.version),
  caseClose: (d, s, a) => O.caseClose(d, s, a.caseId, str(a.reason, 'Reason'), a.version),
  caseAppeal: (d, s, a) => { if (!['buyer', 'seller'].includes(a.party)) fail('Choose who asked for the review.', 'validation'); O.caseAppeal(d, s, a.caseId, a.party, str(a.reason, 'Reason'), a.version); },
  // Users, catalog and content
  sendRecovery: (d, s, a) => O.sendRecovery(d, s, user(d, a.userId).id, str(a.reason, 'Reason')),
  progressClosure: (d, s, a) => O.progressClosure(d, s, user(d, a.userId).id, str(a.reason, 'Reason')),
  resolveReport: (d, s, a) => { if (!['Action taken', 'No violation found'].includes(a.outcome)) fail('Choose an outcome.', 'validation'); found(d.reports, a.reportId, 'Report'); O.resolveReport(d, s, a.reportId, a.outcome, str(a.reason, 'Reason')); },
  editCategory: (d, s, a) => {
    const c = found(d.categories, a.categoryId, 'Category'); if (a.subId) found(c.subs, a.subId, 'Subcategory');
    const patch = {}; if (typeof a.name === 'string') patch.name = a.name.trim().slice(0, 60); if (typeof a.active === 'boolean') patch.active = a.active;
    if (!Object.keys(patch).length) fail('Nothing to change.', 'validation');
    const dec = a.decision == null ? null : a.decision.type === 'pause' ? { type: 'pause' } : a.decision.type === 'move' && d.categories.some(x => x.subs.some(y => y.id === a.decision.to && y.active)) ? { type: 'move', to: a.decision.to } : fail('Choose where to move the listings.', 'validation');
    O.editCategory(d, s, c.id, a.subId || null, patch, str(a.reason, 'Reason'), dec);
  },
  addSubcategory: (d, s, a) => O.addSubcategory(d, s, found(d.categories, a.categoryId, 'Category').id, str(a.name, 'Name').slice(0, 60), str(a.reason, 'Reason')),
  reorderSubcategory: (d, s, a) => O.reorderSubcategory(d, s, a.categoryId, a.subId),
  setFeatured: (d, s, a) => O.setFeatured(d, s, a.listingId, !!a.on),
  saveBanner(d, s, { banner: b = {}, reason }) {
    if (b.id) found(d.content.banners, b.id, 'Banner');
    const num = v => Number.isFinite(v) ? v : fail('Enter valid dates and order.', 'validation');
    // Only these fields come from the request; state and publication details stay server-side.
    const clean = { ...(b.id ? { id: b.id } : {}), title: String(b.title || '').slice(0, 120), sub: String(b.sub || '').slice(0, 240), link: String(b.link || '').trim().slice(0, 300), order: num(b.order), start: num(b.start), end: num(b.end), ...(b.id ? {} : { art: b.art || 'data' }) };
    O.saveBanner(d, s, clean, str(reason, 'Reason'));
  },
  publishBanner: (d, s, a) => O.publishBanner(d, s, found(d.content.banners, a.bannerId, 'Banner').id, str(a.reason, 'Reason')),
  archiveBanner: (d, s, a) => O.archiveBanner(d, s, found(d.content.banners, a.bannerId, 'Banner').id, str(a.reason, 'Reason')),
  draftPolicy: (d, s, a) => O.draftPolicy(d, s, found(d.policies, a.policyId, 'Policy').id, str(a.content, 'Policy text').slice(0, 50000), str(a.reason, 'Reason')),
  submitPolicy: (d, s, a) => O.submitPolicy(d, s, found(d.policies, a.policyId, 'Policy').id),
  // Order interventions
  staffRequestInfo: (d, s, a) => O.staffRequestInfo(d, s, orderOf(d, a.orderId).id, str(a.text, 'Request'), str(a.reason, 'Reason')),
  staffContact: (d, s, a) => { if (!['buyer', 'seller'].includes(a.party)) fail('Choose who to contact.', 'validation'); O.staffContact(d, s, orderOf(d, a.orderId).id, a.party, str(a.text, 'Message'), str(a.reason, 'Reason')); },
  documentExtension: (d, s, a) => O.documentExtension(d, s, orderOf(d, a.orderId).id, int(a.days, 'Days'), str(a.reason, 'Reason')),
  staffCancelOrder: (d, s, a) => O.staffCancelOrder(d, s, orderOf(d, a.orderId).id, str(a.basis, 'Basis'), str(a.reason, 'Reason')),
  escalateOrder: (d, s, a) => O.escalateOrder(d, s, orderOf(d, a.orderId).id, str(a.reason, 'Reason')),
  // Tickets and reconciliation
  ticketLink: (d, s, a) => O.ticketLink(d, s, found(d.tickets, a.ticketId, 'Ticket').id, str(a.ref, 'Reference').slice(0, 40)),
  ticketEscalate: (d, s, a) => O.ticketEscalate(d, s, found(d.tickets, a.ticketId, 'Ticket').id, str(a.reason, 'Reason')),
  queryPaymentStatus: (d, s, a) => O.queryPaymentStatus(d, s, a.paymentId),
  reconRetry: (d, s, a) => { sim(); if (!['success', 'failure', 'unknown'].includes(a.outcome)) fail('Unknown provider outcome.', 'validation'); O.reconRetry(d, s, found(d.recon, a.reconId, 'Item').id, a.outcome); },
  reconIgnoreDuplicate: (d, s, a) => O.reconIgnoreDuplicate(d, s, found(d.recon, a.reconId, 'Item').id, str(a.reason, 'Reason')),
  reconMatch: (d, s, a) => O.reconMatch(d, s, found(d.recon, a.reconId, 'Item').id, found(d.purchases, a.purchaseId, 'Purchase').id, str(a.receiptRef, 'Receipt reference'), str(a.reason, 'Reason')),
  reconEscalate: (d, s, a) => O.reconEscalate(d, s, found(d.recon, a.reconId, 'Item').id, str(a.reason, 'Reason')),
  // Super Admin
  inviteStaff: (d, s, a) => O.inviteStaff(d, s, String(a.email || '').trim().toLowerCase(), a.role),
  revokeInvite: (d, s, a) => O.inviteAction(d, s, a.inviteId, 'revoke'),
  proposeStaffRoles: (d, s, a) => O.proposeStaffRoles(d, s, a.staffId, a.roles, str(a.reason, 'Reason')),
  reactivateStaff: (d, s, a) => O.reactivateStaff(d, s, a.staffId, str(a.reason, 'Reason')),
  revokeSessions: (d, s, a) => O.revokeSessions(d, s, a.staffId, str(a.reason, 'Reason'), a.sessionId || null),
  testConnection: (d, s, a) => { sim(); if (!['success', 'failure', 'timeout'].includes(a.outcome)) fail('Unknown test outcome.', 'validation'); return O.testConnection(d, s, a.integrationId, a.outcome); },
  toggleProvider: (d, s, a) => O.toggleProvider(d, s, a.integrationId, str(a.reason, 'Reason')),
  proposeIntegrationMode: (d, s, a) => O.proposeIntegrationMode(d, s, a.integrationId, str(a.reason, 'Reason')),
  saveProvider: (d, s, a) => O.saveProvider(d, s, a.integrationId, { markets: String(a.markets || '').slice(0, 500), callback: String(a.callback || '').trim().slice(0, 300) }, str(a.reason, 'Reason')),
  togglePayoutMethod: (d, s, a) => O.togglePayoutMethod(d, s, String(a.type || '')),
  resolveSecurityEvent: (d, s, a) => O.resolveSecurityEvent(d, s, a.eventId),
  publishPolicy: (d, s, a) => O.publishPolicyDraft(d, s, a.policyId, str(a.reason, 'Reason')),
  retryTask: (d, s, a) => { sim(); O.retryTask(d, s, found(d.tasks, a.taskId, 'Task').id); },
  ticketReply: (d, s, a) => O.ticketReply(d, s, a.ticketId, a.text, a.kind === 'internal' ? 'internal' : 'public'),
  ticketStatus: (d, s, a) => O.ticketStatus(d, s, a.ticketId, a.status, str(a.reason, 'Reason')),
  assignMany(d, s, { keys, staffId }) {
    F.need(d, s, 'queue.assign', 'assign work');
    if (!Array.isArray(keys) || !keys.length || keys.length > 100 || keys.some(k => typeof k !== 'string' || !k.includes(':'))) fail('Select between 1 and 100 items.', 'validation');
    if (staffId && !d.staff[staffId]?.active) fail('That staff account is not active.');
    for (const k of keys) F.setAssignee(d, s, k, staffId || null, staffId ? 'Bulk assignment' : 'Bulk unassign', k.split(':')[1]);
  },
  escalateWork: (d, s, a) => F.escalateWork(d, s, String(a.key || ''), a.reason),
  internalNote: (d, s, a) => F.addNote(d, s, a.key, a.text, a.label),
  setPriority: (d, s, a) => F.setPriority(d, s, a.key, a.priority, a.reason, a.label),
  markStaffNotesRead: (d, s, a) => F.markStaffNotesRead(d, s, a.id ?? null),
  logEvidenceView: (d, s, a) => F.logEvidenceView(d, s, String(a.key || ''), a.reason),
  logExport: (d, s, a) => { if (!Number.isInteger(a.rows) || a.rows < 0 || !Array.isArray(a.columns)) fail('Export details are missing.', 'validation'); F.logExport(d, s, String(a.name || 'Export').slice(0, 100), a.rows, a.columns.map(String).slice(0, 50), a.sensitive); },
  proposeSetting: (d, s, a) => F.proposeSetting(d, s, a.key, a.value, a.reason, a.effectiveAt),
  proposeRoleChange: (d, s, a) => F.proposeRoleChange(d, s, a.roleId, a.perms, a.reason),
  deactivateStaff: (d, s, a) => F.deactivateStaff(d, s, a.staffId, a.reason),
  switchRole: (d, s, a) => F.switchRole(d, s, a.role),
};

export const STAFF_ACTIONS = Object.keys(staff);
export const CUSTOMER_ACTIONS = Object.keys(customer);
