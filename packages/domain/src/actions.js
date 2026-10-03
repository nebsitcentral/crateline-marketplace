// Order, case and offer state transitions. Each runs on a draft copy of the data and records history.
import { D, round2 } from './data.js';
import { orderEv, notify, convFor, pushMsg, newId, money, fmtN, deliveredQty, isPublic } from './logic.js';
import { ev } from './data.js';
import { now, holdOrder, requestRefund, resolveCase, S, fmtMoney, toC, audit, DomainError } from './fin.js';
const fail = (m, c) => { throw new DomainError(m, c); };

const owner = (d, o) => d.stores[o.storeId].ownerId;
const sysMsg = (d, o, text) => { const c = convFor(d, o.buyerId, o.storeId, { orderId: o.id }); pushMsg(d, c, 'system', text, { kind: 'event', orderId: o.id }); };

export function submitInfo(d, o, text) {
  o.requirements = (o.requirements ? o.requirements + '\n' : '') + text; o.infoRequest = null; o.status = 'paid'; o.dueAt = now() + o.snap.days * D;
  orderEv(o, 'Buyer', 'Submitted requested information. Delivery clock started', 'ok');
  notify(d, owner(d, o), 'seller', `${o.id}: buyer submitted the missing information.`, { page: 's-order', id: o.id });
}
export function requestInfo(d, o, text) {
  o.infoRequest = { at: now(), text }; o.status = 'awaiting_info';
  orderEv(o, 'Seller', 'Requested missing information: ' + text, 'warn');
  notify(d, o.buyerId, 'buyer', `${o.id}: the seller needs more information.`, { page: 'u-order', id: o.id });
  sysMsg(d, o, `Seller requested missing information on ${o.id}.`);
}
export function startPrep(d, o) {
  o.status = 'preparing'; orderEv(o, 'Seller', 'Started preparation');
  notify(d, o.buyerId, 'buyer', `${o.id}: the seller started preparing your order.`, { page: 'u-order', id: o.id });
}
export function submitDelivery(d, o, { note, file, qty }) {
  const isRep = !!(o.replacement && o.replacement.state === 'Requested');
  o.deliveries.push({ v: o.deliveries.length + 1, at: now(), note, file, qty, kind: isRep ? 'Replacement' : 'Delivery' });
  if (isRep) { o.replacement.state = 'Delivered'; o.status = 'delivered'; orderEv(o, 'Seller', `Submitted replacement delivery (version ${o.deliveries.length})`, 'ok'); }
  else {
    const done = deliveredQty(o) >= o.totalQty;
    o.status = done ? 'delivered' : 'partial';
    orderEv(o, 'Seller', done ? `Delivered ${fmtN(qty)} ${o.snap.unit}. Awaiting buyer confirmation` : `Partial delivery: ${fmtN(qty)} ${o.snap.unit}, ${fmtN(o.totalQty - deliveredQty(o))} remaining`, 'ok');
  }
  notify(d, o.buyerId, 'buyer', `${o.id}: ${isRep ? 'replacement delivered' : o.status === 'partial' ? 'partial delivery received' : 'delivered. Review and confirm receipt'}.`, { page: 'u-order', id: o.id });
  sysMsg(d, o, `${isRep ? 'Replacement' : 'Delivery'} submitted on ${o.id} (version ${o.deliveries.length}).`);
}
export function requestExtension(d, o, days, reason) {
  o.extension = { state: 'Requested', newDue: o.dueAt + days * D, days, reason, at: now() };
  orderEv(o, 'Seller', `Requested ${days}-day extension: ${reason}`, 'warn');
  notify(d, o.buyerId, 'buyer', `${o.id}: seller requested a delivery extension.`, { page: 'u-order', id: o.id });
}
export function respondExtension(d, o, accept) {
  o.extension.state = accept ? 'Accepted' : 'Rejected';
  if (accept) { orderEv(o, 'Buyer', `Accepted extension. Original deadline kept in history; new deadline set`, 'ok'); o.dueAt = o.extension.newDue; }
  else orderEv(o, 'Buyer', 'Rejected extension request', 'warn');
  notify(d, owner(d, o), 'seller', `${o.id}: extension ${accept ? 'accepted' : 'rejected'} by buyer.`, { page: 's-order', id: o.id });
}
export function confirmReceived(d, o) {
  o.status = 'completed'; o.completedAt = now(); if (o.replacement) o.replacement.state = 'Closed';
  orderEv(o, 'Buyer', 'Confirmed order received. Order completed', 'ok');
  notify(d, owner(d, o), 'seller', `${o.id} completed. Funds move to pending release.`, { page: 's-order', id: o.id });
  sysMsg(d, o, `Buyer confirmed receipt. ${o.id} completed.`);
  const c = o.caseId && d.cases.find(x => x.id === o.caseId);
  if (c && c.remedy?.type === 'Replacement' && !['Resolved', 'Closed'].includes(c.status)) { c.remedy.state = 'Implemented'; resolveCase(d, { name: 'System' }, c, 'Replacement delivered and confirmed by buyer'); }
}
export function requestReplacement(d, o, reason, files) {
  o.replacement = { state: 'Requested', reason, files, at: now() }; o.status = 'preparing';
  orderEv(o, 'Buyer', 'Requested replacement: ' + reason, 'warn');
  notify(d, owner(d, o), 'seller', `${o.id}: buyer requested a replacement.`, { page: 's-order', id: o.id });
  sysMsg(d, o, `Replacement requested on ${o.id}.`);
}
export function requestCancel(d, o, by, reason) {
  o.cancelRequest = { by, reason, at: now(), state: 'Requested' };
  orderEv(o, by === 'buyer' ? 'Buyer' : 'Seller', 'Requested cancellation: ' + reason, 'warn');
  if (by === 'buyer') notify(d, owner(d, o), 'seller', `${o.id}: buyer requested cancellation.`, { page: 's-order', id: o.id });
  else notify(d, o.buyerId, 'buyer', `${o.id}: seller requested cancellation.`, { page: 'u-order', id: o.id });
}
export function respondCancel(d, o, accept, actor) {
  o.cancelRequest.state = accept ? 'Accepted' : 'Declined';
  if (accept) {
    o.status = 'cancelled';
    orderEv(o, actor, 'Accepted cancellation', 'ok');
    const r = requestRefund(d, { name: d.users[actor === 'Seller' ? o.buyerId : o.buyerId].name }, { orderId: o.id, amountC: toC(o.total), reason: 'Cancelled before delivery by agreement: ' + o.cancelRequest.reason, kind: 'cancellation agreement' });
    orderEv(o, 'System', `Refund ${r.id} of ${money(o.total)} requested. Awaiting marketplace approval`, 'info');
  } else orderEv(o, actor, 'Declined cancellation. Fulfilment continues', 'warn');
  const target = actor === 'Seller' ? o.buyerId : owner(d, o);
  notify(d, target, actor === 'Seller' ? 'buyer' : 'seller', `${o.id}: cancellation ${accept ? 'accepted' : 'declined'}.`, { page: actor === 'Seller' ? 'u-order' : 's-order', id: o.id });
}

// ---------- cases
export function createCase(d, o, { reason, description, outcome, files }) {
  const id = newId(d, 'CASE');
  d.cases.unshift({ id, orderId: o.id, buyerId: o.buyerId, storeId: o.storeId, status: 'Awaiting seller', openedAt: now(), deadline: now() + S(d).disputeResponseHours * 36e5, escalation: 0, version: 1, holdActive: true, internal: [], staffMsgs: [], remedy: null, reason, outcome, description,
    evidence: files.map(f => ({ ...f, by: 'Buyer', at: now() })), responses: [{ from: 'buyer', at: now(), text: description }], proposal: null,
    timeline: [ev(now(), 'Buyer', 'Case opened'), ev(now(), 'System', 'Seller notified. Seller earnings for this order placed on hold', 'warn')] });
  holdOrder(d, o, id);
  o.caseId = id; orderEv(o, 'Buyer', `Opened case ${id}: ${reason}`, 'warn');
  notify(d, owner(d, o), 'seller', `Case ${id} opened on ${o.id}. Response needed.`, { page: 'case', id });
  notify(d, o.buyerId, 'buyer', `Case ${id} opened. The seller has been notified.`, { page: 'case', id });
  sysMsg(d, o, `Case ${id} opened on ${o.id}.`);
  return id;
}
export function caseRespond(d, c, side, text, files) {
  c.responses.push({ from: side, at: now(), text, files });
  for (const f of files || []) c.evidence.push({ ...f, by: side === 'buyer' ? 'Buyer' : 'Seller', at: now() });
  c.timeline.push(ev(now(), side === 'buyer' ? 'Buyer' : 'Seller', 'Added a response' + (files?.length ? ` with ${files.length} file(s)` : '')));
  if (!['Escalated'].includes(c.status)) { c.status = side === 'buyer' ? 'Awaiting seller' : 'Awaiting buyer'; c.deadline = now() + S(d).disputeResponseHours * 36e5; }
  c.version = (c.version || 1) + 1;
  const o = d.orders.find(o => o.id === c.orderId);
  if (side === 'buyer') notify(d, d.stores[c.storeId].ownerId, 'seller', `${c.id}: buyer responded.`, { page: 'case', id: c.id });
  else notify(d, c.buyerId, 'buyer', `${c.id}: seller responded.`, { page: 'case', id: c.id });
}
export function caseProposal(d, c, p) {
  c.proposal = { ...p, state: 'Proposed', at: now() }; c.status = 'Awaiting buyer';
  c.timeline.push(ev(now(), 'Seller', `Proposed remedy: ${p.type}${p.amount ? ' (' + money(p.amount) + ')' : ''}`));
  notify(d, c.buyerId, 'buyer', `${c.id}: seller proposed ${p.type.toLowerCase()}.`, { page: 'case', id: c.id });
}
export function caseDecide(d, c, accept) {
  const o = d.orders.find(o => o.id === c.orderId);
  c.proposal.state = accept ? 'Accepted' : 'Rejected';
  c.timeline.push(ev(now(), 'Buyer', accept ? 'Accepted proposal' : 'Rejected proposal', accept ? 'ok' : 'warn'));
  notify(d, d.stores[c.storeId].ownerId, 'seller', `${c.id}: buyer ${accept ? 'accepted' : 'rejected'} your proposal.`, { page: 'case', id: c.id });
  if (!accept) { c.status = 'Awaiting seller'; return; }
  const t = c.proposal.type;
  if (t === 'Full refund' || t === 'Partial refund') {
    const r = requestRefund(d, { name: d.users[c.buyerId].name }, { orderId: o.id, amountC: toC(c.proposal.amount), reason: `${t} agreed in ${c.id}`, caseId: c.id, kind: 'agreed in case' });
    c.remedy = { type: t, amountC: r.amountC, state: 'Awaiting refund', refundId: r.id, closeOnRefund: true, decidedBy: 'Buyer and seller agreement' };
    c.status = 'Open'; c.timeline.push(ev(now(), 'System', `Refund ${r.id} of ${money(c.proposal.amount)} requested. It needs marketplace approval and provider confirmation before the case resolves`, 'info'));
    orderEv(o, 'System', `Refund ${r.id} requested (${c.id})`);
  } else if (t === 'Replacement') {
    o.replacement = { state: 'Requested', reason: 'Agreed in ' + c.id, files: [], at: now() }; o.status = 'preparing';
    c.remedy = { type: 'Replacement', state: 'Awaiting replacement', decidedBy: 'Buyer and seller agreement' };
    c.status = 'Open'; c.timeline.push(ev(now(), 'System', 'Replacement agreed. Case stays open until the replacement is delivered and confirmed', 'ok'));
    orderEv(o, 'System', `Replacement agreed in ${c.id}. Order returned to fulfilment`);
  } else if (t === 'Cancel order') {
    o.status = 'cancelled';
    const r = requestRefund(d, { name: d.users[c.buyerId].name }, { orderId: o.id, amountC: toC(o.total), reason: `Cancelled by agreement in ${c.id}`, caseId: c.id, kind: 'agreed in case' });
    c.remedy = { type: 'Cancel order', amountC: r.amountC, state: 'Awaiting refund', refundId: r.id, closeOnRefund: true };
    c.status = 'Open'; c.timeline.push(ev(now(), 'System', `Order cancelled. Refund ${r.id} requested`, 'ok')); orderEv(o, 'System', `Cancelled by agreement in ${c.id}. Refund ${r.id} requested`);
  }
}
export function confirmRefund(d, c) {
  const o = d.orders.find(o => o.id === c.orderId);
  const full = o.refund.amount >= o.subtotal;
  o.refund.state = full ? 'Refunded' : 'Partially refunded'; o.refund.at = now();
  if (full && o.status !== 'cancelled') o.status = 'refunded';
  orderEv(o, 'System', `Refund of ${money(o.refund.amount)} confirmed (simulated provider response)`, 'ok');
  c.timeline.push(ev(now(), 'System', `Refund confirmed: ${o.refund.state}`, 'ok'));
  notify(d, o.buyerId, 'buyer', `Refund of ${money(o.refund.amount)} for ${o.id} confirmed.`, { page: 'u-order', id: o.id });
  notify(d, d.stores[o.storeId].ownerId, 'seller', `Refund of ${money(o.refund.amount)} on ${o.id} recorded in earnings.`, { page: 's-earnings' });
}
export function caseEscalate(d, c, side) {
  c.status = 'Escalated'; c.timeline.push(ev(now(), side === 'buyer' ? 'Buyer' : 'Seller', 'Escalated to marketplace support', 'bad'));
  notify(d, side === 'buyer' ? d.stores[c.storeId].ownerId : c.buyerId, side === 'buyer' ? 'seller' : 'buyer', `${c.id} escalated to marketplace support.`, { page: 'case', id: c.id });
}
export function caseClose(d, c, side) {
  if (c.holdActive) { const o = d.orders.find(x => x.id === c.orderId); resolveCase(d, { name: side === 'buyer' ? 'Buyer' : 'System' }, c, 'Closed by buyer'); }
  c.status = 'Closed'; c.timeline.push(ev(now(), side === 'buyer' ? 'Buyer' : 'System', 'Case closed'));
  notify(d, d.stores[c.storeId].ownerId, 'seller', `${c.id} closed.`, { page: 'case', id: c.id });
}

// ---------- offers
export function sendOffer(d, conv, req, f, prevId) {
  for (const o of d.offers) if (o.convId === conv.id && o.kind === 'offer' && ['Sent'].includes(o.status) && (o.requestId === (req?.id || null))) o.status = 'Superseded';
  const id = newId(d, 'OF');
  const version = d.offers.filter(o => o.requestId && o.requestId === req?.id).length + 1;
  d.offers.push({ id, convId: conv.id, kind: 'offer', requestId: req?.id || null, listingId: f.listingId, storeId: conv.storeId, buyerId: conv.buyerId,
    qty: +f.qty, scope: f.scope, price: round2(+f.price), days: +f.days, replacement: f.replacement, expiresAt: now() + f.expiry * D, status: 'Sent', at: now(), version, requirements: req?.requirements || '' });
  if (req) req.status = 'Answered';
  pushMsg(d, conv, 'seller', version > 1 ? `Revised offer (version ${version})` : 'Custom offer', { offerId: id });
  notify(d, conv.buyerId, 'buyer', `New custom offer ${id} from ${d.stores[conv.storeId].name}.`, { page: 'inbox', id: conv.id });
  return id;
}
export function declineRequest(d, conv, req, reason) {
  req.status = 'Declined'; pushMsg(d, conv, 'seller', 'Declined the custom offer request' + (reason ? ': ' + reason : '.'));
  notify(d, conv.buyerId, 'buyer', `${d.stores[conv.storeId].name} declined request ${req.id}.`, { page: 'inbox', id: conv.id });
}
export function acceptOffer(d, offer) {
  offer.status = 'Accepted awaiting payment'; offer.acceptedAt = now();
  const conv = d.conversations.find(c => c.id === offer.convId);
  pushMsg(d, conv, 'system', `Buyer accepted offer ${offer.id}. Awaiting payment.`, { kind: 'event' });
  notify(d, d.stores[offer.storeId].ownerId, 'seller', `Offer ${offer.id} accepted. Awaiting payment.`, { page: 'inbox', id: conv.id });
}
export function rejectOffer(d, offer) {
  offer.status = 'Rejected';
  const conv = d.conversations.find(c => c.id === offer.convId);
  pushMsg(d, conv, 'system', `Buyer rejected offer ${offer.id}.`, { kind: 'event' });
  notify(d, d.stores[offer.storeId].ownerId, 'seller', `Offer ${offer.id} rejected.`, { page: 'inbox', id: conv.id });
}
export function withdrawOffer(d, offer) {
  offer.status = 'Withdrawn';
  const conv = d.conversations.find(c => c.id === offer.convId);
  pushMsg(d, conv, 'system', `Seller withdrew offer ${offer.id}.`, { kind: 'event' });
}

// ---------- account, cart and inbox (customer records; callers pass the signed-in user)
export function addToCart(d, u, listingId, pkgId, count) {
  const l = d.listings.find(x => x.id === listingId); if (!l || !isPublic(d, l)) fail('This item is no longer available.');
  if (l.storeId === u.storeId) fail('You cannot buy your own listing.', 'denied');
  if (!l.packages.some(p => p.id === pkgId)) fail('Package not found.', 'validation');
  const n = Number(count); if (!Number.isInteger(n) || n < 1 || n > 10) fail('Package count must be 1 to 10.', 'validation');
  const c = d.carts[u.id] = d.carts[u.id] || []; const ex = c.find(x => x.listingId === listingId && x.pkgId === pkgId);
  if (ex) ex.count = Math.min(10, ex.count + n); else c.push({ id: 'ci' + now() + Math.floor(Math.random() * 1000), listingId, pkgId, count: n });
}
export function setCartCount(d, u, itemId, count) {
  const it = (d.carts[u.id] || []).find(x => x.id === itemId) || fail('Cart item not found.', 'not_found');
  const n = Number(count); if (!Number.isInteger(n) || n < 1 || n > 10) fail('Package count must be 1 to 10.', 'validation'); it.count = n;
}
export function removeCartItem(d, u, itemId) {
  const c = d.carts[u.id] || []; if (!c.some(x => x.id === itemId)) fail('Cart item not found.', 'not_found');
  d.carts[u.id] = c.filter(x => x.id !== itemId);
}
export function setFollow(d, u, storeId, on) {
  if (!d.stores[storeId]) fail('Store not found.', 'not_found'); if (on && u.storeId === storeId) fail('This is your own store.');
  if (on) { if (!u.following.includes(storeId)) u.following.push(storeId); } else u.following = u.following.filter(x => x !== storeId);
}
// Opens (or reopens) the buyer's conversation with a store.
export function startConversation(d, u, storeId, listingId) {
  const st = d.stores[storeId]; if (!st || st.status !== 'Active') fail('Store not found.', 'not_found'); if (u.storeId === storeId) fail('This is your own store.');
  if (listingId && !d.listings.some(l => l.id === listingId && l.storeId === storeId)) fail('Listing not found.', 'not_found');
  return convFor(d, u.id, storeId, { listingId: listingId || undefined }).id;
}
// Opens the conversation linked to an order; either the buyer or the seller may do this.
export function orderConversation(d, u, o) {
  if (o.buyerId !== u.id && !(u.storeId && o.storeId === u.storeId)) fail('This order is not yours.', 'denied');
  return convFor(d, o.buyerId, o.storeId, { orderId: o.id }).id;
}
export function markNotificationsRead(d, u, panel, id = null) {
  for (const n of d.notifications) if (n.userId === u.id && (id ? n.id === id : n.panel === panel)) n.read = true;
}
export function submitReview(d, u, o, rating, text) {
  if (o.buyerId !== u.id) fail('Only the buyer can review this order.', 'denied');
  if (!S(d).features.reviews) fail('Reviews are turned off.');
  if (o.status !== 'completed' || o.review) fail(o.review ? 'You already reviewed this order.' : 'Reviews open after the order is completed.');
  const r = Number(rating); if (!Number.isInteger(r) || r < 1 || r > 5) fail('Choose 1 to 5 stars.', 'validation');
  const t = String(text || '').trim(); if (t.length < 5) fail('Write at least 5 characters.', 'validation');
  o.review = { rating: r, text: t.slice(0, 2000), at: now() };
  d.reviews.push({ id: 'rv' + now(), listingId: o.snap.listingId, rating: r, text: t.slice(0, 2000), alias: u.name[0] + '***' + u.name.split(' ')[0].slice(-1), pkg: o.snap.pkgName, at: now(), reply: null });
  notify(d, owner(d, o), 'seller', `New ${r}-star review on ${o.id}.`, { page: 's-order', id: o.id });
}
export function requestOffer(d, u, listingId, { qty, requirements, budget, date }) {
  if (!S(d).features.customOffers) fail('Custom offers are turned off.');
  const l = d.listings.find(x => x.id === listingId); if (!l || !isPublic(d, l)) fail('This item is no longer available.'); if (l.storeId === u.storeId) fail('This is your own listing.');
  const q = Number(qty); if (!(q > 0)) fail('Enter a quantity greater than zero.', 'validation');
  const req = String(requirements || '').trim(); if (req.length < 10) fail('Describe what you need in at least 10 characters.', 'validation');
  const b = budget === '' || budget == null ? null : Number(budget); if (b !== null && !(b > 0)) fail('Budget must be a positive amount.', 'validation');
  const c = convFor(d, u.id, l.storeId, { listingId: l.id }); if (c.blocked) fail('This conversation is blocked.');
  const id = newId(d, 'OF');
  d.offers.push({ id, convId: c.id, kind: 'request', listingId: l.id, storeId: l.storeId, buyerId: u.id, qty: q, requirements: req.slice(0, 2000) + (date ? ` Requested delivery by ${String(date).slice(0, 10)}.` : ''), budget: b, status: 'Requested', at: now(), version: 0 });
  pushMsg(d, c, 'buyer', `Custom offer request for ${l.title}`, { offerId: id });
  notify(d, d.stores[l.storeId].ownerId, 'seller', `New custom offer request ${id} from ${u.name}.`, { page: 'inbox', id: c.id });
  return { id, convId: c.id };
}
// Conversation controls apply to the caller's side only (block applies to both, as before).
const convSide = (u, c) => c.buyerId === u.id ? 'buyer' : u.storeId && c.storeId === u.storeId ? 'seller' : fail('Not your conversation.', 'denied');
export function setConversationBlocked(d, u, c) { convSide(u, c); c.blocked = !c.blocked; }
export function clearConversation(d, u, c) { const side = convSide(u, c); c.clearedAt = { ...(c.clearedAt || {}), [side]: now() }; }
export function hideConversation(d, u, c) { const side = convSide(u, c); c.hidden = { ...(c.hidden || {}), [side]: true }; }
export function markConversationRead(d, u, c) { const side = convSide(u, c); c.unread = { ...c.unread, [side]: 0 }; }
export function updateProfile(d, u, { name, username, phone = '', telegram = '', hue }) {
  if (typeof name !== 'string' || name.trim().length < 2) fail('Enter your full name.', 'validation');
  if (typeof username !== 'string' || !/^[a-z0-9._]{3,20}$/i.test(username)) fail('Use 3 to 20 letters, numbers, dots or underscores.', 'validation');
  if (Object.values(d.users).some(x => x.id !== u.id && x.username.toLowerCase() === username.toLowerCase())) fail('This username is taken. Try another.', 'validation');
  if (telegram && !/^@\w{3,32}$/.test(telegram)) fail('Telegram handles start with @.', 'validation');
  const h = Number(hue); Object.assign(u, { name: name.trim().slice(0, 100), username, phone: String(phone).slice(0, 40), telegram, hue: Number.isFinite(h) ? Math.round(h) % 360 : u.hue });
}
export function setPreference(d, u, k, v) { if (!['orders', 'messages', 'offers', 'email', 'marketing'].includes(k)) fail('Unknown preference.', 'validation'); u.prefs = { ...u.prefs, [k]: !!v }; }
export function requestDeletion(d, u, blockers) { if (u.deletion) fail('A deletion request is already recorded.'); u.deletion = { at: now(), blockers }; }
export function withdrawDeletion(d, u) { if (!u.deletion) fail('There is no deletion request.'); if (u.deletion.state) fail('This request is already being processed.'); u.deletion = null; }
// Support requests from signed-in users or guests (userId null).
export function createTicket(d, userId, v) {
  const name = String(v.name || '').trim(); const email = String(v.email || '').trim(); const desc = String(v.desc || '').trim();
  if (!name) fail('Enter your name.', 'validation'); if (!/^\S+@\S+\.\S+$/.test(email)) fail('Enter a valid email address.', 'validation'); if (desc.length < 15) fail('Describe the problem in at least 15 characters.', 'validation');
  const id = newId(d, 'TK');
  const at = now(); const text = desc.slice(0, 5000);
  // Same shape as staff-handled tickets: the request is the first message in the thread.
  d.tickets.unshift({ id, userId, name: name.slice(0, 100), email: email.slice(0, 200), subject: String(v.subject || '').slice(0, 200) || 'Support request', cat: String(v.cat || 'Other').slice(0, 60), priority: 'Normal', status: 'Open', at,
    order: String(v.order || '').slice(0, 40), link: null, deadline: at + 8 * 36e5, desc: text, thread: [{ kind: 'public', from: 'customer', by: name.slice(0, 100), at, text }], lastResponse: at });
  return id;
}
