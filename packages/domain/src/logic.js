import { D, CATEGORIES, SUBS, snapshotOf, round2, ev } from './data.js';
import { now, fmtMoney, toC, recordSale, commissionFor, storeBuckets, cnotify, snotify, staffWith, nid, S, DomainError } from './fin.js';
export { now };

export const money = d => fmtMoney(Math.round(d * 100));
export const fmtN = n => Number(n).toLocaleString('en-US');
export const tzName = (() => { try { return new Intl.DateTimeFormat('en-GB', { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName').value; } catch { return ''; } })();
export const fmtDate = ts => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDT = ts => ts ? new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' ' + tzName : '—';
export const fmtTime = ts => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export function rel(ts) {
  const d = now() - ts, a = Math.abs(d), fut = d < 0;
  if (a < 6e4) return 'just now';
  const s = a < 36e5 ? Math.round(a / 6e4) + ' min' : a < D ? Math.round(a / 36e5) + ' h' : Math.round(a / D) + ' d';
  return fut ? 'in ' + s : s + ' ago';
}
export const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
export const days = n => n + (n === 1 ? ' day' : ' days');
export const catOf = id => CATEGORIES.find(c => c.id === id);
export const subOf = id => SUBS[id];

export function newId(d, p) { if (p === 'MSG') return 'm' + nid(d, 'MSG'); if (p === 'N') return nid(d, 'N'); return nid(d, p); }

// ---------- derived data
export function listingStats(db, l) {
  const rs = db.reviews.filter(r => r.listingId === l.id);
  return { rating: rs.length ? rs.reduce((a, r) => a + r.rating, 0) / rs.length : null, count: rs.length };
}
export function storeStats(db, st) {
  const ids = new Set(db.listings.filter(l => l.storeId === st.id).map(l => l.id));
  const rs = db.reviews.filter(r => ids.has(r.listingId));
  return { rating: rs.length ? rs.reduce((a, r) => a + r.rating, 0) / rs.length : null, count: rs.length,
    // In API mode the browser holds only its own orders and users, so the server sends these counts.
    completed: st.stats?.completed ?? db.orders.filter(o => o.storeId === st.id && o.status === 'completed').length,
    active: db.listings.filter(l => l.storeId === st.id && isPublic(db, l)).length,
    followers: st.stats?.followers ?? Object.values(db.users).filter(u => u.following.includes(st.id)).length };
}
export const startPrice = l => Math.min(...l.packages.map(p => p.price));
export const minQty = l => Math.min(...l.packages.map(p => p.qty));
export const minDays = l => Math.min(...l.packages.map(p => p.days));
export function isPublic(db, l) { const st = db.stores[l.storeId]; return l.availability === 'Active' && st.status === 'Active' && !st.paused && SUBS[l.sub]?.active !== false && SUBS[l.sub]?.catActive !== false; }
export const activeRestriction = (u, scope) => (u?.restrictions || []).find(r => r.active && r.scope === scope && (!r.expiresAt || r.expiresAt > now()));

// ---------- order groupings
export const PROGRESS = ['Placed', 'Payment verified', 'Preparing', 'Delivered', 'Completed'];
export const STATUS_LABEL = {
  unpaid: 'Placed, awaiting payment', awaiting_info: 'Awaiting buyer information', paid: 'Payment verified', preparing: 'Preparing', partial: 'Partially delivered',
  delivered: 'Delivered, awaiting confirmation', completed: 'Completed', cancelled: 'Cancelled', refunded: 'Refunded',
};
export const STATUS_TONE = { unpaid: 'muted', awaiting_info: 'warn', paid: 'info', preparing: 'info', partial: 'info', delivered: 'accent', completed: 'ok', cancelled: 'muted', refunded: 'muted' };
export const isOverdue = o => ['paid', 'preparing', 'partial', 'awaiting_info'].includes(o.status) && o.dueAt < now();
export const deliveredQty = o => o.deliveries.filter(x => x.kind === 'Delivery').reduce((a, x) => a + x.qty, 0);
export function openCase(db, o) { const c = o.caseId && db.cases.find(c => c.id === o.caseId); return c && !['Resolved', 'Closed'].includes(c.status) ? c : null; }
export function buyerGroup(o) { return o.status === 'completed' ? 'completed' : ['cancelled', 'refunded', 'unpaid'].includes(o.status) ? 'cancelled' : 'running'; }
export function sellerGroup(db, o) {
  if (o.status === 'unpaid') return null;
  if (openCase(db, o)) return 'resolution';
  return { awaiting_info: 'pending', paid: 'pending', preparing: 'progress', partial: 'progress', delivered: 'delivered', completed: 'completed', cancelled: 'cancelled', refunded: 'cancelled' }[o.status];
}

// ---------- seller earnings, read from the same ledger the management panels use
export function earnings(db, storeId) {
  const b = storeBuckets(db, storeId);
  const pe = db.platform.filter(e => e.store === storeId); const sum = k => pe.filter(e => e.kind === k).reduce((a, e) => a + e.amt, 0);
  const gross = sum('Sale'), refunds = -sum('Sale reversal'), commission = sum('Commission') + sum('Commission reversal');
  const tx = db.ledger.filter(e => e.store === storeId).map(e => ({ id: e.id, at: e.at, type: e.kind, ref: e.order || e.payout || e.ref || '', amountC: e.amt, from: e.from, to: e.to }))
    .concat(pe.map(e => ({ id: e.id, at: e.at, type: e.kind, ref: e.order, amountC: e.kind.startsWith('Commission') ? -e.amt : e.amt, platform: true })))
    .sort((a, b) => b.at - a.at);
  return { grossC: gross, commissionC: commission, refundsC: refunds, netC: gross - refunds - commission, ...b, tx };
}

// ---------- mutations used by customer flows
export function notify(d, userId, panel, text, route) { return cnotify(d, userId, panel, text, route); }
export function ownerOf(d, storeId) { return d.stores[storeId].ownerId; }
export function convFor(d, buyerId, storeId, ctx = {}) {
  let c = d.conversations.find(c => c.buyerId === buyerId && c.storeId === storeId);
  if (!c) { c = { id: 'c' + (d.conversations.length + 10) + Math.floor(Math.random() * 99), buyerId, storeId, listingId: ctx.listingId || null, orderId: null, unread: { buyer: 0, seller: 0 }, hidden: {}, blocked: false, messages: [] }; d.conversations.unshift(c); }
  if (ctx.listingId) c.listingId = ctx.listingId;
  if (ctx.orderId) c.orderId = ctx.orderId;
  c.hidden = {};
  return c;
}
export function pushMsg(d, c, from, text, x = {}) {
  c.messages.push({ id: newId(d, 'MSG'), from, at: now(), text, ...x });
  if (from === 'buyer') c.unread.seller++;
  else if (from === 'seller') c.unread.buyer++;
  else { c.unread.buyer++; c.unread.seller++; }
  const i = d.conversations.indexOf(c); d.conversations.splice(i, 1); d.conversations.unshift(c);
}
export function orderEv(o, actor, text, kind) { o.events.push(ev(now(), actor, text, kind)); o.version = (o.version || 1) + 1; }

export function createOrder(d, { buyerId, listing, pkg, count, requirements, purchaseRef, method, offer, payRef, via = null }) {
  const st = d.stores[listing.storeId];
  const snap = snapshotOf(listing, pkg, st);
  if (offer) Object.assign(snap, { pkgName: 'Custom offer ' + offer.id, pkgDesc: offer.scope, qty: offer.qty, price: offer.price, days: offer.days, replacement: offer.replacement, offerId: offer.id });
  const subtotal = round2(snap.price * count), fee = round2(subtotal * S(d).buyerFeeRate);
  const id = newId(d, 'ORD');
  const needInfo = listing.requiresInfo && !(requirements || '').trim() && !offer;
  const cm = commissionFor(d, listing.storeId, listing.cat);
  const o = {
    id, purchaseRef, buyerId, storeId: listing.storeId, snap, count, totalQty: snap.qty * count, subtotal, fee, total: round2(subtotal + fee),
    payment: { method, status: 'Paid', ref: payRef }, status: needInfo ? 'awaiting_info' : 'paid', placedAt: now(),
    dueAt: now() + snap.days * D, requirements: offer ? offer.requirements || offer.scope : requirements || '',
    infoRequest: needInfo ? { at: now(), text: 'Required details were not provided at checkout: ' + listing.requirements, system: true } : null,
    deliveries: [], events: [], caseId: null, extension: null, replacement: null, cancelRequest: null, refund: null, completedAt: null,
    archivedBySeller: false, review: null, fromOfferId: offer?.id || null, termsVersion: currentTerms(d), commissionRate: cm.rate, commissionRule: cm.rule, version: 1,
  };
  orderEv(o, 'Buyer', 'Order placed' + (offer ? ` from accepted offer ${offer.id}` : ''));
  orderEv(o, 'System', `Payment verified (${method}, ${via ? 'by ' + via : 'simulated'})`, 'ok');
  if (needInfo) orderEv(o, 'System', 'Awaiting buyer information. Delivery clock paused', 'warn');
  d.orders.unshift(o);
  recordSale(d, o);
  listing.sold = (listing.sold || 0) + count;
  notify(d, ownerOf(d, listing.storeId), 'seller', `New paid order ${id} from ${d.users[buyerId].name}.`, { page: 's-order', id });
  const c = convFor(d, buyerId, listing.storeId, { listingId: listing.id });
  pushMsg(d, c, 'system', `Order ${id} placed for ${snap.pkgName} (${fmtN(o.totalQty)} ${snap.unit}).`, { kind: 'event', orderId: id });
  if (!c.orderId) c.orderId = id;
  return o;
}
export const currentTerms = d => { const p = d.policies.find(x => x.id === 'POL-terms'); const v = p?.versions.find(x => x.state === 'Published'); return v ? `Terms v${v.v}` : 'Terms (unpublished)'; };

export function startPayment(d, p) {
  const id = newId(d, 'PMT');
  d.payments.unshift({ id, purchaseId: p.id, buyerId: p.buyerId, method: p.method, net: p.net, amountC: toC(p.total), cur: 'USD', providerRef: 'demo_' + id.slice(4), state: p.status === 'Processing' ? 'Processing' : p.status === 'Pending' ? 'Processing' : p.status, initiatedAt: now(), lastEventAt: now(),
    events: [{ op: 'EVT-' + id.slice(4) + 'i', at: now(), type: 'payment.initiated', status: 'Processed' }].concat(p.status === 'Failed' ? [{ op: 'EVT-' + id.slice(4) + 'f', at: now(), type: 'payment.failed (simulated)', status: 'Processed' }] : p.status === 'Cancelled' ? [{ op: 'EVT-' + id.slice(4) + 'c', at: now(), type: 'payment.cancelled_by_buyer', status: 'Processed' }] : []), orderIds: [] });
  p.paymentId = id; return id;
}
// verified payment event: idempotent, so repeated confirmations never duplicate orders or earnings.
// `via` names the real provider that verified the payment; without it the payment is simulated.
export function completePurchase(d, purchaseId, via = null) {
  const p = d.purchases.find(p => p.id === purchaseId);
  if (!p) return p;
  const pay = d.payments.find(x => x.purchaseId === p.id);
  if (p.ordersCreated) { if (pay) pay.events.push({ op: 'EVT-' + pay.id.slice(4) + 's', at: now(), type: 'payment.succeeded (repeat)', status: 'Duplicate ignored' }); return p; }
  p.status = 'Paid'; p.ordersCreated = true; p.orderIds = [];
  if (pay) { pay.state = 'Paid'; pay.lastEventAt = now(); pay.events.push({ op: 'EVT-' + pay.id.slice(4) + 's', at: now(), type: via ? 'payment.succeeded' : 'payment.succeeded (simulated)', status: 'Processed' }); }
  for (const it of p.items) {
    const listing = d.listings.find(l => l.id === it.listingId);
    const offer = it.offerId ? d.offers.find(o => o.id === it.offerId) : null;
    const pkg = offer ? listing.packages[0] : listing.packages.find(x => x.id === it.pkgId);
    const o = createOrder(d, { buyerId: p.buyerId, listing, pkg, count: it.count, requirements: it.requirements, purchaseRef: p.id, method: p.method, offer, payRef: pay?.id, via });
    p.orderIds.push(o.id);
    if (offer) {
      offer.status = 'Paid'; offer.orderId = o.id;
      const c = d.conversations.find(c => c.id === offer.convId);
      if (c) { c.orderId = o.id; pushMsg(d, c, 'system', `Offer ${offer.id} paid. Order ${o.id} created with the accepted terms.`, { kind: 'event', orderId: o.id }); }
    }
  }
  if (pay) pay.orderIds = p.orderIds;
  if (p.fromCart) d.carts[p.buyerId] = (d.carts[p.buyerId] || []).filter(ci => !p.cartIds.includes(ci.id));
  notify(d, p.buyerId, 'buyer', `Payment confirmed for ${p.id}${via ? '' : ' (simulated)'}. ${p.orderIds.length} order${p.orderIds.length > 1 ? 's' : ''} created.`, { page: 'u-orders' });
  return p;
}

// A verified event from a real payment provider (the API has already checked its signature).
// status: 'processing' | 'paid' | 'partial' | 'failed' | 'expired' | 'refunded'. Each provider
// payment and status is processed once. Orders are created only for a pending purchase paid in
// full at its exact USD amount; every other receipt goes to reconciliation for Finance.
export function paymentProviderEvent(d, { provider, purchaseId, ref, status, priceC, cur, paid = '' }) {
  const p = d.purchases.find(x => x.id === purchaseId); const pay = p && d.payments.find(x => x.purchaseId === p.id);
  if (!p || !pay || p.provider !== provider) return 'unknown';
  const key = `${provider}:${ref}:${status}`;
  const event = (type, result = 'Processed') => { pay.events.push({ op: key, at: now(), type, status: result }); pay.lastEventAt = now(); };
  if (d.processedOps.includes(key)) { event(`payment.${status} (repeat)`, 'Duplicate ignored'); return 'duplicate'; }
  d.processedOps.push(key);
  const recon = (type, detail) => {
    d.recon.push({ id: nid(d, 'RC'), type, paymentId: pay.id, ref: String(ref), amountC: priceC, status: 'Open', at: now(), detail, receipt: { ref: String(ref), amount: paid, network: provider, verified: true } });
    snotify(d, staffWith(d, 'payments.reconcile'), 'Reconciliation', `${type} on ${p.id}: ${detail}`, { page: 'a-recon' });
    event(`payment.${status}`, 'Sent to reconciliation'); return 'reconciliation';
  };
  if (status === 'paid') {
    if (p.status === 'Paid') return recon('Duplicate payment', `${provider} confirmed a second payment (${paid}) for ${p.id}, which is already paid. No order was created for it.`);
    if (cur !== 'USD' || priceC !== toC(p.total)) return recon('Amount mismatch', `${provider} confirmed ${fmtMoney(priceC)} ${cur} for ${p.id}; the purchase total is ${fmtMoney(toC(p.total))}. No order was created.`);
    if (p.status !== 'Pending') return recon('Late confirmation', `${provider} confirmed ${paid} for ${p.id} after the purchase was ${p.status.toLowerCase()}. No order was created.`);
    pay.providerPaymentRef = String(ref); completePurchase(d, p.id, provider); return 'paid';
  }
  if (status === 'partial') {
    cnotify(d, p.buyerId, 'buyer', `We received less than the full amount for ${p.id}. No order was created. Contact support to complete or return the payment.`, { page: 'pay-result', id: p.id });
    return recon('Crypto underpayment', `${paid} received for ${p.id} (expected ${fmtMoney(toC(p.total))}). No order was created.`);
  }
  if (status === 'processing') { if (p.status === 'Pending') pay.state = 'Processing'; event('payment.confirming'); return 'processing'; }
  if (status === 'failed' || status === 'expired') {
    if (p.status === 'Pending') { p.status = pay.state = status === 'failed' ? 'Failed' : 'Expired'; cnotify(d, p.buyerId, 'buyer', `Payment ${p.id} ${status === 'failed' ? 'failed' : 'expired'}. No order was created.`, { page: 'pay-result', id: p.id }); }
    event(`payment.${status}`); return status;
  }
  if (status === 'refunded') return recon('Provider refund', `${provider} reports ${paid} for ${p.id} was returned to the payer. Check the purchase and its orders.`);
  return 'ignored';
}

export function refreshOfferExpiry(d) {
  for (const o of d.offers) if (o.kind === 'offer' && ['Sent', 'Accepted awaiting payment'].includes(o.status) && o.expiresAt < now()) o.status = 'Expired';
}
export { DomainError };
