// Named operational transitions for the Admin panel. Each checks permission, state and version.
import { now, DAY, HOUR } from './clock.js';
import { recordSale, DomainError, need, can, audit, cnotify, snotify, staffWith, nid, requestRefund, resolveCase, releaseHold, holdOrder, fmtMoney, toC, S, refundableC, key, setAssignee, createApproval, requiredAuthority, activeSupers, publishPolicy } from './fin.js';
import { convFor, pushMsg, orderEv, STATUS_LABEL } from './logic.js';
const fail = (m, c) => { throw new DomainError(m, c); };
const me = (d, s) => d.staff[s.id];
const ver = (rec, v, what) => { if (v != null && (rec.version || 1) !== v) fail(`${what} changed since you opened it (another staff member or the customer updated it). The latest version is now shown; review it before acting again.`, 'stale'); };
const bump = rec => { rec.version = (rec.version || 1) + 1; };

// ---------- users
export function restrictUser(d, s, uid, { scope, reason, days, notice }) {
  need(d, s, 'users.restrict', 'restrict accounts');
  const u = d.users[uid]; if (!notice?.trim()) fail('Enter the notification text the user will see.', 'validation');
  if ((u.restrictions || []).some(r => r.active && r.scope === scope)) fail(`A ${scope} restriction is already active. Restore it first or edit its expiry.`);
  const r = { id: nid(d, 'RS'), scope, reason, notice, by: s.name, at: now(), expiresAt: days ? now() + days * DAY : null, active: true };
  u.restrictions = [...(u.restrictions || []), r];
  if (scope === 'selling' && u.storeId) cnotify(d, uid, 'seller', 'Selling restricted: ' + notice, { page: 's-overview' }); else cnotify(d, uid, 'buyer', 'Account restriction: ' + notice, { page: 'account' });
  audit(d, me(d, s), `Restricted ${scope}`, u.acct, { reason, after: days ? `Until ${new Date(r.expiresAt).toLocaleDateString('en-GB')}` : 'No expiry' });
}
export function restoreUser(d, s, uid, rid, reason) {
  need(d, s, 'users.restrict', 'restore accounts');
  const r = d.users[uid].restrictions.find(x => x.id === rid); if (!r.active) fail('This restriction is no longer active.');
  r.active = false; r.endedAt = now(); r.endReason = reason;
  cnotify(d, uid, d.users[uid].storeId && r.scope === 'selling' ? 'seller' : 'buyer', `Your ${r.scope} restriction was lifted.`, { page: 'account' });
  audit(d, me(d, s), `Restored ${r.scope}`, d.users[uid].acct, { reason, before: 'Restricted', after: 'Restored' });
}
export function sendRecovery(d, s, uid, reason) {
  need(d, s, 'users.contact', 'send recovery links');
  cnotify(d, uid, 'buyer', 'A password recovery link was sent to your email (simulated). Staff never set or see passwords.', { page: 'account' });
  audit(d, me(d, s), 'Password recovery sent (simulated)', d.users[uid].acct, { reason });
}
export function closureBlockers(d, uid) {
  const u = d.users[uid]; const out = [];
  d.orders.filter(o => o.buyerId === uid && !['completed', 'cancelled', 'refunded', 'unpaid'].includes(o.status)).forEach(o => out.push(`Order ${o.id} (${STATUS_LABEL[o.status]})`));
  d.cases.filter(c => c.buyerId === uid && !['Resolved', 'Closed'].includes(c.status)).forEach(c => out.push(`Case ${c.id}`));
  if (u.storeId) { d.payouts.filter(p => p.storeId === u.storeId && ['Awaiting approval', 'Approved', 'Processing', 'Reconciliation required'].includes(p.status)).forEach(p => out.push(`Payout ${p.id}`)); }
  return out;
}
export function progressClosure(d, s, uid, reason) {
  need(d, s, 'users.restrict', 'progress closures');
  const u = d.users[uid]; const b = closureBlockers(d, uid);
  if (!u.deletion) fail('This user has not requested closure.');
  if (b.length) { u.deletion.blockers = b; u.deletion.note = reason; cnotify(d, uid, 'buyer', 'Your closure request is on hold until: ' + b.join(', '), { page: 'account' }); audit(d, me(d, s), 'Closure blockers explained', u.acct, { reason, after: b.join(', ') }); return 'blocked'; }
  u.deletion.state = 'Approved: anonymisation scheduled under retention policy (demo; no data is purged)'; u.deletion.by = s.name;
  audit(d, me(d, s), 'Closure progressed', u.acct, { reason, after: u.deletion.state }); return 'ok';
}

// ---------- sellers and verification
const vOf = (d, sid) => d.verifications.find(v => v.storeId === sid);
export function sellerRequestInfo(d, s, sid, fields, message, reason, v) {
  need(d, s, 'sellers.decide', 'make verification decisions');
  const st = d.stores[sid]; const vr = vOf(d, sid); ver(vr, v, 'This application');
  if (vr.state !== 'Verification pending') fail(`The application is ${vr.state}. Only a pending submission can be returned for information.`);
  if (!fields.length) fail('Select the exact fields that are missing or inconsistent.', 'validation');
  vr.state = 'More information required'; vr.missing = fields; vr.decisions.push({ at: now(), by: s.name, decision: 'Request information', reason, fields, message, version: vr.version }); bump(vr);
  st.status = 'More information required';
  cnotify(d, st.ownerId, 'seller', `Verification: more information needed (${fields.join(', ')}). ${message}`, { page: 's-onboarding' });
  audit(d, me(d, s), 'Requested seller information', sid, { reason, before: 'Verification pending', after: 'More information required' });
}
export function sellerResubmit(d, sid) {
  const st = d.stores[sid]; const vr = vOf(d, sid);
  if (vr.state !== 'More information required') fail('Resubmission is only possible after a request for information.');
  vr.history = [...(vr.history || []), { version: vr.version, state: vr.state, missing: vr.missing, business: { ...vr.business } }];
  if (vr.missing.includes('Business address')) vr.business.address = '41 Example Street, Leeds LS1 4AP (fictional)';
  if (vr.missing.includes('Company registration number')) vr.business.registration = '12345678 (fictional)';
  if (vr.missing.includes('Proof of address')) vr.evidence.push({ name: 'utility_bill_PLACEHOLDER.pdf', size: 380000 });
  vr.checks.address = true; vr.state = 'Verification pending'; vr.missing = []; vr.version++; vr.submittedAt = now(); st.status = 'Verification pending';
  vr.decisions.push({ at: now(), by: d.users[st.ownerId].name + ' (seller)', decision: 'Resubmitted', reason: `Version ${vr.version} submitted with the requested fields`, version: vr.version });
  audit(d, { name: d.users[st.ownerId].name, kind: 'Seller' }, 'Verification resubmitted (demo)', sid, { after: 'Version ' + vr.version });
  snotify(d, staffWith(d, 'sellers.decide'), 'New assignment', `${st.name} resubmitted verification (version ${vr.version}).`, { page: 'a-seller', id: sid });
}
export function markCheck(d, s, sid, check) {
  need(d, s, 'sellers.decide', 'record verification checks');
  const vr = vOf(d, sid); if (vr.checks[check]) fail('This check is already complete.'); vr.checks[check] = true; bump(vr);
  audit(d, me(d, s), `Demo check completed: ${check}`, sid, { reason: 'Simulated check. No external provider was contacted.' });
}
export function sellerApprove(d, s, sid, reason, message, v) {
  need(d, s, 'sellers.decide', 'approve sellers');
  const st = d.stores[sid]; const vr = vOf(d, sid); ver(vr, v, 'This application');
  if (vr.state !== 'Verification pending') fail(`Only a pending submission can be approved (current: ${vr.state}).`);
  const open = Object.entries(vr.checks).filter(([, x]) => !x).map(([k]) => k);
  if (open.length) fail(`Approval needs every demo check complete. Outstanding: ${open.join(', ')}.`);
  if (!vr.business.address || !vr.identity.name) fail('Required fields are missing from the submission.');
  vr.state = 'Approved'; vr.decisions.push({ at: now(), by: s.name, decision: 'Approve', reason, message, version: vr.version }); bump(vr);
  st.status = 'Active';
  cnotify(d, st.ownerId, 'seller', `Your store is approved. ${message}`, { page: 's-overview' });
  audit(d, me(d, s), 'Seller approved', sid, { reason, before: 'Verification pending', after: 'Active' });
}
export function sellerReject(d, s, sid, reason, message, resubmit, v) {
  need(d, s, 'sellers.decide', 'reject sellers');
  const st = d.stores[sid]; const vr = vOf(d, sid); ver(vr, v, 'This application');
  if (!['Verification pending', 'More information required'].includes(vr.state)) fail(`An application that is ${vr.state} cannot be rejected.`);
  vr.state = 'Rejected'; vr.resubmitAllowed = resubmit; vr.decisions.push({ at: now(), by: s.name, decision: 'Reject', reason, message, version: vr.version }); bump(vr);
  st.status = 'Rejected';
  cnotify(d, st.ownerId, 'seller', `Verification rejected. ${message} ${resubmit ? 'You may resubmit.' : 'Resubmission is not permitted.'}`, { page: 's-onboarding' });
  audit(d, me(d, s), 'Seller rejected', sid, { reason, after: 'Rejected' + (resubmit ? ' (resubmission allowed)' : '') });
}
export function storeControl(d, s, sid, action, reason, message, days) {
  need(d, s, 'stores.control', 'control stores');
  const st = d.stores[sid]; const before = st.status + (st.paused ? ' (sales paused)' : '');
  if (action === 'pause') { if (st.paused) fail('New sales are already paused.'); st.paused = true; st.pauseUntil = days ? now() + days * DAY : null; }
  if (action === 'suspend') { if (st.status === 'Suspended') fail('The store is already suspended.'); if (st.status !== 'Active') fail('Only an active store can be suspended.'); st.status = 'Suspended'; st.suspension = { reason, at: now(), by: s.name, until: days ? now() + days * DAY : null }; }
  if (action === 'restore') { if (st.status !== 'Suspended' && !st.paused) fail('The store is not paused or suspended.'); st.status = st.status === 'Suspended' ? 'Active' : st.status; st.paused = false; st.suspension = null; }
  if (action === 'corrections') st.corrections = { reason, message, at: now() };
  const after = st.status + (st.paused ? ' (sales paused)' : '');
  cnotify(d, st.ownerId, 'seller', `${{ pause: 'New sales paused', suspend: 'Store suspended', restore: 'Store restored', corrections: 'Store corrections requested' }[action]}: ${message} Existing paid orders stay visible for fulfilment and resolution.`, { page: 's-overview' });
  audit(d, me(d, s), { pause: 'Store sales paused', suspend: 'Store suspended', restore: 'Store restored', corrections: 'Store corrections requested' }[action], sid, { reason, before, after: after + (days ? ` for ${days} days` : '') });
}

// ---------- catalog
export function moderateListing(d, s, lid, action, reason, message) {
  need(d, s, 'catalog.moderate', 'moderate listings');
  const l = d.listings.find(x => x.id === lid); const st = d.stores[l.storeId]; const before = l.availability;
  const allowed = { approve: ['Pending review'], changes: ['Pending review', 'Active', 'Paused'], reject: ['Pending review', 'Changes requested'], pause: ['Active'], restore: ['Paused'], archive: ['Active', 'Paused', 'Rejected', 'Changes requested', 'Draft'] }[action];
  if (!allowed.includes(l.availability)) fail(`A listing that is ${l.availability} cannot be ${{ approve: 'approved', changes: 'sent back for changes', reject: 'rejected', pause: 'paused', restore: 'restored', archive: 'archived' }[action]}.`);
  if ((action === 'approve' || action === 'restore') && st.status !== 'Active') fail(`The store is ${st.status}. Listings from inactive stores cannot be published.`);
  l.availability = { approve: 'Active', changes: 'Changes requested', reject: 'Rejected', pause: 'Paused', restore: 'Active', archive: 'Archived' }[action];
  if (action === 'approve') { l.approvedAt = now(); l.reviewNote = ''; }
  if (action === 'changes' || action === 'reject') l.reviewNote = message;
  l.moderation = [...(l.moderation || []), { at: now(), by: s.name, action, reason, message }];
  cnotify(d, st.ownerId, 'seller', `Listing “${l.title.slice(0, 40)}”: ${l.availability}. ${message}`, { page: 's-product-edit', id: l.id });
  audit(d, me(d, s), 'Listing ' + action, lid, { reason, before, after: l.availability });
}
export function resolveReport(d, s, rid, outcome, reason) {
  need(d, s, 'catalog.moderate', 'review reports');
  const r = d.reports.find(x => x.id === rid); if (r.status !== 'Open') fail('This report is already reviewed.');
  r.status = outcome; r.reviewedBy = s.name; r.reviewedAt = now();
  audit(d, me(d, s), 'Product report reviewed', rid, { reason, after: outcome });
}
export function editCategory(d, s, cid, sid, patch, reason, decision) {
  need(d, s, 'categories.edit', 'edit categories');
  const c = d.categories.find(x => x.id === cid); const t = sid ? c.subs.find(x => x.id === sid) : c;
  if (patch.name != null) {
    if (!patch.name.trim()) fail('Enter a display name.', 'validation');
    const all = d.categories.flatMap(x => [x, ...x.subs]); if (all.some(x => x !== t && x.name.toLowerCase() === patch.name.trim().toLowerCase())) fail('Another category already uses that name.', 'validation');
  }
  if (patch.active === false) {
    const affected = d.listings.filter(l => (sid ? l.sub === sid : l.cat === cid) && ['Active', 'Pending review'].includes(l.availability));
    if (affected.length && !decision) fail(`${affected.length} active listings use this category. Choose to pause them or move them first.`, 'needs-decision');
    if (decision?.type === 'pause') affected.forEach(l => { l.availability = 'Paused'; cnotify(d, d.stores[l.storeId].ownerId, 'seller', `Listing paused: its category was disabled.`, { page: 's-products' }); });
    if (decision?.type === 'move') affected.forEach(l => { l.sub = decision.to; l.cat = d.categories.find(x => x.subs.some(y => y.id === decision.to)).id; });
  }
  const before = JSON.stringify({ name: t.name, active: t.active, order: t.order }); Object.assign(t, patch);
  audit(d, me(d, s), 'Category updated', sid || cid, { reason, before, after: JSON.stringify({ name: t.name, active: t.active, order: t.order }) });
}
// Swaps a subcategory with the one above it.
export function reorderSubcategory(d, s, cid, sid) {
  need(d, s, 'categories.edit', 'reorder categories');
  const c = d.categories.find(x => x.id === cid); const a = c?.subs.find(x => x.id === sid); if (!a) fail('Category not found.', 'not_found');
  const b = c.subs.find(x => x.order === a.order - 1); if (!b) fail('This subcategory is already first.');
  b.order++; a.order--; audit(d, me(d, s), 'Category reordered', sid);
}
export function addSubcategory(d, s, cid, name, reason) {
  need(d, s, 'categories.edit', 'add categories');
  const c = d.categories.find(x => x.id === cid); const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (!slug) fail('Enter a name.', 'validation');
  if (d.categories.flatMap(x => [x, ...x.subs]).some(x => x.id === slug || x.name.toLowerCase() === name.trim().toLowerCase())) fail('A category with that name or slug exists.', 'validation');
  c.subs.push({ id: slug, name: name.trim(), icon: 'box', active: true, order: c.subs.length });
  audit(d, me(d, s), 'Subcategory added', slug, { reason, after: `${c.name} › ${name}` });
}

// ---------- content
const validLink = l => /^(search:|product:|store:|page:)[\w-]+$/.test(l) || /^https?:\/\/\S+\.\S+/.test(l);
export function setFeatured(d, s, listingId, on) {
  need(d, s, 'content.publish', 'change featured products');
  const f = d.content.featured;
  if (on) { const l = d.listings.find(x => x.id === listingId); if (!l || l.availability !== 'Active') fail('Only active listings can be featured.'); if (f.includes(listingId)) fail('This product is already featured.'); f.push(listingId); }
  else { if (!f.includes(listingId)) fail('This product is not featured.'); d.content.featured = f.filter(x => x !== listingId); }
  audit(d, me(d, s), on ? 'Featured product added' : 'Featured product removed', listingId);
}
export function saveBanner(d, s, b, reason) {
  need(d, s, 'content.draft', 'edit content');
  if (!b.title?.trim()) fail('Banner title is required.', 'validation');
  if (!validLink(b.link || '')) fail('Destination link is missing or invalid. Use search:category, product:ID, store:ID, page:help or a full https:// address.', 'validation');
  if (b.end <= b.start) fail('End date must be after the start date.', 'validation');
  const ex = d.content.banners.find(x => x.id === b.id);
  if (ex) Object.assign(ex, { ...b, state: ex.state === 'Active' ? 'Draft (edited)' : 'Draft' }); else d.content.banners.push({ ...b, id: nid(d, 'BN'), state: 'Draft' });
  audit(d, me(d, s), 'Banner draft saved', b.id || 'new banner', { reason });
}
export function publishBanner(d, s, id, reason) {
  need(d, s, 'content.publish', 'publish content');
  const b = d.content.banners.find(x => x.id === id);
  if (!validLink(b.link || '')) fail('Fix the destination link before publishing.', 'validation');
  b.state = 'Active'; b.publishedBy = s.name; b.publishedAt = now();
  audit(d, me(d, s), 'Banner published', id, { reason, after: 'Active' });
}
export function archiveBanner(d, s, id, reason) { need(d, s, 'content.publish', 'archive content'); const b = d.content.banners.find(x => x.id === id); b.state = 'Archived'; audit(d, me(d, s), 'Banner archived', id, { reason }); }
export function draftPolicy(d, s, pid, content, reason) {
  need(d, s, 'content.draft', 'draft policies');
  const p = d.policies.find(x => x.id === pid); if (!content.trim()) fail('Policy text is empty.', 'validation');
  const pub = p.versions.filter(v => v.state === 'Published').map(v => parseFloat(v.v)); const next = (Math.max(0.9, ...p.versions.map(v => parseFloat(v.v))) + 0.1).toFixed(1);
  const dr = p.versions.find(v => v.state === 'Draft' || v.state === 'In review');
  if (dr) { dr.content = content; dr.state = 'Draft'; dr.author = s.name; } else p.versions.push({ v: next, state: 'Draft', content, author: s.name });
  audit(d, me(d, s), 'Policy draft saved', p.title, { reason });
}
export function submitPolicy(d, s, pid) { need(d, s, 'content.draft', 'submit policies'); const p = d.policies.find(x => x.id === pid); const dr = p.versions.find(v => v.state === 'Draft'); if (!dr) fail('There is no draft to submit.'); dr.state = 'In review'; dr.submittedBy = s.name; audit(d, me(d, s), 'Policy submitted for review', `${p.title} v${dr.v}`); snotify(d, staffWith(d, 'policies.publish'), 'Policy change', `${p.title} v${dr.v} is ready to publish.`, { page: 'sa-policies' }); }

// ---------- orders
export function staffContact(d, s, oid, party, text, reason) {
  need(d, s, 'orders.act', 'contact parties');
  const o = d.orders.find(x => x.id === oid); if (!text.trim()) fail('Write the message.', 'validation');
  const c = convFor(d, o.buyerId, o.storeId, { orderId: o.id });
  pushMsg(d, c, 'system', `Marketplace support to ${party}: ${text}`, { kind: 'event', orderId: o.id, staff: true });
  orderEv(o, 'Marketplace', `Contacted ${party}: ${text}`);
  cnotify(d, party === 'buyer' ? o.buyerId : d.stores[o.storeId].ownerId, party === 'buyer' ? 'buyer' : 'seller', `Marketplace support about ${o.id}: ${text}`, { page: party === 'buyer' ? 'u-order' : 's-order', id: o.id });
  audit(d, me(d, s), `Contacted ${party}`, oid, { reason });
}
export function staffRequestInfo(d, s, oid, text, reason) {
  need(d, s, 'orders.act', 'request information');
  const o = d.orders.find(x => x.id === oid);
  if (!['paid', 'preparing', 'awaiting_info'].includes(o.status)) fail(`Information can be requested before delivery only (current: ${STATUS_LABEL[o.status]}).`);
  o.status = 'awaiting_info'; o.infoRequest = { at: now(), text, staff: true }; orderEv(o, 'Marketplace', 'Requested missing buyer information: ' + text, 'warn');
  cnotify(d, o.buyerId, 'buyer', `${o.id}: marketplace support needs information: ${text}`, { page: 'u-order', id: o.id });
  audit(d, me(d, s), 'Requested buyer information', oid, { reason, after: 'Awaiting buyer information' });
}
export function documentExtension(d, s, oid, days, reason) {
  need(d, s, 'orders.act', 'record extensions');
  const o = d.orders.find(x => x.id === oid);
  if (!['paid', 'preparing', 'partial', 'awaiting_info'].includes(o.status)) fail(`Extensions apply before delivery only (current: ${STATUS_LABEL[o.status]}).`);
  const before = o.dueAt; o.dueAt = Math.max(o.dueAt, now()) + days * DAY;
  orderEv(o, 'Marketplace', `Agreed extension recorded (${days} days). Original deadline kept in history`, 'info');
  cnotify(d, o.buyerId, 'buyer', `${o.id}: new agreed delivery deadline recorded.`, { page: 'u-order', id: o.id });
  cnotify(d, d.stores[o.storeId].ownerId, 'seller', `${o.id}: new agreed deadline recorded by marketplace support.`, { page: 's-order', id: o.id });
  audit(d, me(d, s), 'Agreed extension documented', oid, { reason, before: new Date(before).toISOString().slice(0, 16), after: new Date(o.dueAt).toISOString().slice(0, 16) });
}
export function escalateOrder(d, s, oid, reason) {
  need(d, s, 'orders.view', 'escalate'); const k = key('order', oid);
  d.assign[k] = { ...(d.assign[k] || { assigneeId: null, history: [] }), priority: 'Urgent' };
  snotify(d, staffWith(d, 'queue.assign'), 'Overdue work', `${oid} escalated by ${s.name}: ${reason}`, { page: 'a-order', id: oid });
  audit(d, me(d, s), 'Order escalated', oid, { reason, after: 'Urgent' });
}
export function staffCancelOrder(d, s, oid, basis, reason) {
  need(d, s, 'orders.act', 'cancel orders');
  const o = d.orders.find(x => x.id === oid);
  if (o.status === 'unpaid') { o.status = 'cancelled'; o.payment.status = o.payment.status; orderEv(o, 'Marketplace', 'Unpaid workflow stopped. A late payment would go to reconciliation', 'warn'); audit(d, me(d, s), 'Unpaid order cancelled', oid, { reason, after: 'Cancelled' }); return; }
  if (['delivered', 'completed', 'cancelled', 'refunded'].includes(o.status)) fail(`A ${STATUS_LABEL[o.status].toLowerCase()} order cannot be cancelled here. Use the Resolution Center.`);
  if (!basis?.trim()) fail('Record the agreement or decision reference that authorises cancellation after payment.', 'validation');
  o.status = 'cancelled'; orderEv(o, 'Marketplace', `Cancelled under ${basis}`, 'warn');
  let msg = '';
  if (can(d, s, 'refunds.request') && refundableC(d, o) > 0) { const r = requestRefund(d, me(d, s), { orderId: oid, amountC: refundableC(d, o), reason: `Cancellation: ${basis}` }); msg = ` Refund ${r.id} requested separately.`; }
  else snotify(d, staffWith(d, 'refunds.request'), 'Approval request', `${oid} was cancelled after payment (${basis}). A refund request is needed.`, { page: 'a-order', id: oid });
  cnotify(d, o.buyerId, 'buyer', `${o.id} was cancelled.${msg ? ' A refund is being arranged.' : ''}`, { page: 'u-order', id: o.id });
  cnotify(d, d.stores[o.storeId].ownerId, 'seller', `${o.id} was cancelled by the marketplace (${basis}).`, { page: 's-order', id: o.id });
  audit(d, me(d, s), 'Paid order cancelled', oid, { reason: `${reason} · basis: ${basis}${msg}`, after: 'Cancelled' });
}
// demo scenario control: moves ORD-1004 between fulfilment states without touching paid totals
export function orderScenario(d, actor, oid, state) {
  const o = d.orders.find(x => x.id === oid);
  if (state === 'awaiting_info') { o.status = 'awaiting_info'; o.infoRequest = { at: now(), text: 'Please confirm the operating system image (demo scenario).' }; }
  if (state === 'preparing') { o.status = 'preparing'; o.infoRequest = null; }
  if (state === 'partial') { o.status = 'partial'; o.deliveries.push({ v: o.deliveries.length + 1, at: now(), note: 'First server provisioned; second month credit pending (demo scenario).', file: { name: 'server-1-access.txt', size: 2100 }, qty: 1, kind: 'Delivery' }); }
  orderEv(o, 'Demo scenario', `Moved to ${STATUS_LABEL[o.status]}`);
  audit(d, actor, 'Demo scenario applied', oid, { after: STATUS_LABEL[o.status], reason: 'Demo toolbar' });
}

// ---------- cases
export function caseRequestInfo(d, s, cid, party, text, reason, v) {
  need(d, s, 'cases.decide', 'manage cases'); const c = d.cases.find(x => x.id === cid); ver(c, v, 'This case');
  if (['Resolved', 'Closed'].includes(c.status)) fail(`The case is ${c.status.toLowerCase()}.`);
  c.status = party === 'buyer' ? 'Awaiting buyer' : 'Awaiting seller'; c.deadline = now() + S(d).disputeResponseHours * HOUR; bump(c);
  c.staffMsgs = [...(c.staffMsgs || []), { by: 'Marketplace support', at: now(), text: `Request to ${party}: ${text}` }];
  c.timeline.push({ id: nid(d, 'EV'), at: now(), actor: s.name, text: `Requested information from ${party}. Deadline ${S(d).disputeResponseHours}h`, kind: 'info' });
  cnotify(d, party === 'buyer' ? c.buyerId : d.stores[c.storeId].ownerId, party === 'buyer' ? 'buyer' : 'seller', `${c.id}: marketplace support needs information: ${text}`, { page: 'case', id: c.id });
  audit(d, me(d, s), `Requested information from ${party}`, cid, { reason });
}
export function casePublicMessage(d, s, cid, text, v) {
  need(d, s, 'cases.decide', 'message case parties'); const c = d.cases.find(x => x.id === cid); ver(c, v, 'This case');
  if (!text.trim()) fail('Write the message.', 'validation');
  c.staffMsgs = [...(c.staffMsgs || []), { by: 'Marketplace support', at: now(), text }]; bump(c);
  cnotify(d, c.buyerId, 'buyer', `${c.id}: new message from marketplace support.`, { page: 'case', id: c.id });
  cnotify(d, d.stores[c.storeId].ownerId, 'seller', `${c.id}: new message from marketplace support.`, { page: 'case', id: c.id });
  audit(d, me(d, s), 'Public case message', cid);
}
export function caseDecision(d, s, cid, { type, amountC, days, rationale, evidence }, v) {
  need(d, s, 'cases.decide', 'decide cases'); const c = d.cases.find(x => x.id === cid); ver(c, v, 'This case');
  if (['Resolved', 'Closed'].includes(c.status)) fail(`The case is ${c.status.toLowerCase()}.`);
  if (c.remedy && !['Implemented', 'Superseded'].includes(c.remedy.state)) fail(`A remedy (${c.remedy.type}) is already in progress. Complete it or record a review first.`);
  if (!rationale?.trim()) fail('Record the rationale for the decision.', 'validation');
  if (!evidence?.length && c.evidence.length) fail('Select the evidence the decision relies on.', 'validation');
  const o = d.orders.find(x => x.id === c.orderId);
  c.decisions = [...(c.decisions || []), { at: now(), by: s.name, type, amountC, days, rationale, evidence, version: c.version }];
  c.timeline.push({ id: nid(d, 'EV'), at: now(), actor: s.name, text: `Decision: ${type}${amountC ? ' ' + fmtMoney(amountC) : ''}${days ? ` (+${days} days)` : ''}. ${rationale}`, kind: 'info' });
  if (type === 'Partial refund' || type === 'Full refund') {
    const r = requestRefund(d, me(d, s), { orderId: o.id, amountC, reason: `${type} decided in ${c.id}`, caseId: c.id });
    c.remedy = { type, amountC, state: 'Awaiting refund', refundId: r.id, closeOnRefund: type === 'Full refund', decidedBy: s.name, rationale, evidence }; c.status = 'Open';
  } else if (type === 'Replacement') {
    o.replacement = { state: 'Requested', reason: 'Decided in ' + c.id, files: [], at: now() }; o.status = 'preparing'; orderEv(o, 'Marketplace', `Replacement decided in ${c.id}`, 'warn');
    c.remedy = { type, state: 'Awaiting replacement', decidedBy: s.name, rationale, evidence }; c.status = 'Awaiting seller'; c.deadline = now() + S(d).disputeResponseHours * HOUR;
  } else if (type === 'New agreed deadline') {
    o.dueAt = now() + days * DAY; orderEv(o, 'Marketplace', `New deadline agreed in ${c.id}`, 'info');
    c.remedy = { type, state: 'Awaiting delivery', decidedBy: s.name, rationale, evidence }; c.status = 'Awaiting seller';
  } else if (type === 'Cancellation') {
    o.status = 'cancelled'; orderEv(o, 'Marketplace', `Cancelled by decision in ${c.id}`, 'warn');
    const r = requestRefund(d, me(d, s), { orderId: o.id, amountC: refundableC(d, o), reason: `Cancellation decided in ${c.id}`, caseId: c.id });
    c.remedy = { type, amountC: r.amountC, state: 'Awaiting refund', refundId: r.id, closeOnRefund: true, decidedBy: s.name, rationale, evidence }; c.status = 'Open';
  } else if (type === 'No refund') {
    c.remedy = { type, state: 'Implemented', decidedBy: s.name, rationale, evidence };
    resolveCase(d, me(d, s), c, 'No refund: ' + rationale);
  }
  bump(c);
  cnotify(d, c.buyerId, 'buyer', `${c.id}: decision recorded (${type}).`, { page: 'case', id: c.id });
  cnotify(d, d.stores[c.storeId].ownerId, 'seller', `${c.id}: decision recorded (${type}).`, { page: 'case', id: c.id });
  audit(d, me(d, s), 'Case decision recorded', cid, { reason: rationale, after: type + (amountC ? ' ' + fmtMoney(amountC) : '') });
}
export function caseVerifyRemedy(d, s, cid, reason, v) {
  need(d, s, 'cases.decide', 'verify remedies'); const c = d.cases.find(x => x.id === cid); ver(c, v, 'This case');
  if (!c.remedy || c.remedy.state === 'Implemented') fail('There is no outstanding remedy to verify.');
  if (c.remedy.refundId) { const r = d.refunds.find(x => x.id === c.remedy.refundId); if (!['Refunded', 'Partially refunded'].includes(r.status)) fail(`Refund ${r.id} is ${r.status}. The case cannot resolve until the provider confirms the refund.`); }
  if (c.remedy.type === 'Replacement') { const o = d.orders.find(x => x.id === c.orderId); if (o.replacement?.state === 'Requested') fail('The seller has not delivered the replacement yet.'); }
  c.remedy.state = 'Implemented'; resolveCase(d, me(d, s), c, `${c.remedy.type} verified: ${reason}`); bump(c);
}
export function caseClose(d, s, cid, reason, v) {
  need(d, s, 'cases.decide', 'close cases'); const c = d.cases.find(x => x.id === cid); ver(c, v, 'This case');
  if (c.status !== 'Resolved') fail('Only a resolved case can be closed. Implement and verify the remedy first.');
  c.status = 'Closed'; bump(c); c.timeline.push({ id: nid(d, 'EV'), at: now(), actor: s.name, text: 'Case closed: ' + reason, kind: 'info' });
  audit(d, me(d, s), 'Case closed', cid, { reason, before: 'Resolved', after: 'Closed' });
}
export function caseAppeal(d, s, cid, party, reason, v) {
  need(d, s, 'cases.decide', 'record appeals'); const c = d.cases.find(x => x.id === cid); ver(c, v, 'This case');
  if (!['Resolved', 'Closed'].includes(c.status)) fail('Appeals apply to decided cases only.');
  if (!c.appealUntil || c.appealUntil < now()) fail(`The ${S(d).appealDays}-day appeal window has ended.`);
  const prev = d.assign[key('case', cid)]?.assigneeId; const other = Object.values(d.staff).find(x => x.active && x.id !== prev && x.id !== s.id && x.roles.includes('dispute'));
  c.status = 'Open'; c.appeals = [...(c.appeals || []), { at: now(), party, reason, priorDecision: (c.decisions || []).slice(-1)[0] || null }]; if (c.remedy) c.remedy.state = c.remedy.state === 'Implemented' ? 'Implemented' : 'Superseded'; bump(c);
  c.deadline = now() + S(d).disputeResponseHours * HOUR;
  c.timeline.push({ id: nid(d, 'EV'), at: now(), actor: party === 'buyer' ? 'Buyer' : 'Seller', text: `Requested review of decision: ${reason}. Reopened and linked to the prior decision`, kind: 'warn' });
  if (other) setAssignee(d, me(d, s), key('case', cid), other.id, 'Appeal: assigned to a different reviewer', cid);
  audit(d, me(d, s), 'Appeal recorded; case reopened', cid, { reason, after: other ? 'Assigned to ' + other.name : 'No other reviewer available' });
}

// ---------- support
export function ticketReply(d, s, tid, text, kind) {
  need(d, s, 'support.reply', 'reply to tickets'); const t = d.tickets.find(x => x.id === tid);
  if (!text.trim()) fail('Write the reply.', 'validation');
  if (kind === 'public' && /\b(will|guarantee|promise)\b.*\b(refund|payout|paid)\b|\b(refund|payout)\b.*\b(today|tomorrow|within \d+)/i.test(text) && !t.allowPromise) fail('Replies cannot promise a refund, payout or date that the linked workflow has not authorised. Describe the current status instead.', 'validation');
  t.thread.push({ kind, from: 'staff', by: s.name, at: now(), text: text.trim() });
  if (kind === 'public') { t.lastResponse = now(); if (t.status === 'Open' || t.status === 'Assigned') t.status = 'Awaiting customer'; if (t.userId) cnotify(d, t.userId, d.users[t.userId].storeId ? 'seller' : 'buyer', `Support replied to ${t.id}.`, { page: 'support' }); }
  audit(d, me(d, s), kind === 'public' ? 'Public ticket reply' : 'Internal ticket note', tid);
}
export function ticketStatus(d, s, tid, status, reason) {
  need(d, s, 'support.reply', 'update tickets'); const t = d.tickets.find(x => x.id === tid); const before = t.status; t.status = status;
  audit(d, me(d, s), 'Ticket status changed', tid, { reason, before, after: status + '. Linked order, payment and case states unchanged' });
}
export function ticketLink(d, s, tid, ref) { need(d, s, 'support.reply', 'link records'); const t = d.tickets.find(x => x.id === tid); t.link = ref; audit(d, me(d, s), 'Linked record', tid, { after: ref }); }
export function ticketEscalate(d, s, tid, reason) {
  need(d, s, 'support.reply', 'escalate'); const t = d.tickets.find(x => x.id === tid); t.status = 'Awaiting internal action'; t.escalated = true;
  const target = /CASE/.test(t.link || '') ? 'cases.decide' : /PAY|RF/.test(t.link || '') ? 'payouts.approve' : 'queue.assign';
  snotify(d, staffWith(d, target), 'Escalation', `${t.id} escalated by ${s.name}: ${reason}`, { page: 'a-ticket', id: t.id });
  audit(d, me(d, s), 'Ticket escalated', tid, { reason });
}

// ---------- reconciliation
// Re-checks a payment with the (simulated) provider. Records the query only; no money moves.
export function queryPaymentStatus(d, s, pid) {
  need(d, s, 'payments.reconcile', 'query providers'); const p = d.payments.find(x => x.id === pid); if (!p) fail('Payment not found.', 'not_found');
  audit(d, me(d, s), 'Provider status query (simulated)', p.id, { after: `Provider reports ${p.state}. No financial entry created.` });
  return p.state;
}
export function reconRetry(d, s, id, outcome) {
  need(d, s, 'payments.reconcile', 'reconcile payments'); const r = d.recon.find(x => x.id === id);
  r.queries = [...(r.queries || []), { at: now(), by: s.name, result: outcome === 'success' ? 'Provider confirms the receipt as recorded' : outcome === 'failure' ? 'Provider reports no matching payment' : 'Provider did not respond' }];
  audit(d, me(d, s), 'Provider status query (simulated)', id, { after: r.queries.slice(-1)[0].result });
}
export function reconIgnoreDuplicate(d, s, id, reason) {
  need(d, s, 'payments.reconcile', 'reconcile payments'); const r = d.recon.find(x => x.id === id);
  if (r.type !== 'Duplicate notification') fail('Only duplicate notifications can be marked as ignored.');
  r.status = 'Ignored: already processed'; r.by = s.name; audit(d, me(d, s), 'Duplicate event confirmed ignored', id, { reason, after: 'No funds credited again' });
}
export function reconMatch(d, s, id, purchaseId, receiptRef, reason) {
  need(d, s, 'payments.reconcile', 'match receipts'); const r = d.recon.find(x => x.id === id);
  if (r.status !== 'Open') fail('This item is already resolved.');
  if (!r.receipt?.verified) fail('The receipt is not verified by a provider event. Staff cannot mark it paid.');
  if (receiptRef !== r.receipt.ref) fail(`The receipt reference must match the verified receipt (${r.receipt.ref}).`, 'validation');
  const p = d.purchases.find(x => x.id === purchaseId); if (!p) fail('Purchase not found.');
  if (p.status === 'Paid') fail(`${p.id} is already paid. One receipt cannot fund a purchase twice.`);
  if (d.recon.some(x => x !== r && x.matchedTo === purchaseId)) fail('Another receipt is already matched to this purchase.');
  if (toC(p.total) !== r.amountC) fail(`Amount mismatch: receipt ${fmtMoney(r.amountC)} vs purchase ${fmtMoney(toC(p.total))}. Escalate instead of matching.`);
  r.status = 'Matched'; r.matchedTo = purchaseId; r.by = s.name;
  const pay = d.payments.find(x => x.purchaseId === p.id); if (pay) { pay.events.push({ op: r.receipt.ref, at: now(), type: 'late receipt matched by reconciliation', status: 'Processed' }); }
  p.status = 'Paid'; if (pay) pay.state = 'Paid';
  for (const oid of p.orderIds) { const o = d.orders.find(x => x.id === oid); if (o.payment.status === 'Paid') continue; o.payment.status = 'Paid'; o.status = 'paid'; o.placedAt = o.placedAt; o.dueAt = now() + o.snap.days * DAY; orderEv(o, 'System', `Payment verified by reconciliation of ${r.receipt.ref}`, 'ok'); recordSale(d, o); cnotify(d, d.stores[o.storeId].ownerId, 'seller', `New paid order ${o.id} (late payment reconciled).`, { page: 's-order', id: o.id }); }
  cnotify(d, p.buyerId, 'buyer', `Your late payment for ${p.id} was matched. Your order is now paid.`, { page: 'u-orders' });
  audit(d, me(d, s), 'Late receipt matched', id, { reason, after: `${p.id} paid; orders ${p.orderIds.join(', ')}` });
}
export function reconEscalate(d, s, id, reason) { need(d, s, 'payments.reconcile', 'escalate'); const r = d.recon.find(x => x.id === id); r.status = 'Escalated'; r.by = s.name; snotify(d, staffWith(d, 'approvals.decide'), 'Provider failure', `${id} escalated: ${reason}`, { page: 'a-recon' }); audit(d, me(d, s), 'Reconciliation escalated', id, { reason }); }
export function retryTask(d, s, id) {
  need(d, s, 'health.retry', 'retry tasks'); const t = d.tasks.find(x => x.id === id);
  if (t.status !== 'Failed') fail('Only failed tasks can be retried.');
  t.attempts++; t.status = d.scenario.provider === 'failure' ? 'Failed' : 'Succeeded'; t.lastRun = now();
  if (t.status === 'Failed') t.lastError = 'Still failing (simulated)';
  else if (t.type === 'Notification email') { const n = d.notifications.find(x => x.id === t.ref); if (n) n.delivery = 'Delivered on retry'; }
  audit(d, me(d, s), 'Task retried', id, { after: t.status + (t.type === 'Payment status query' ? ' (status re-checked; no financial entry created)' : '') });
}

// ---------- Super Admin: staff, integrations, payout methods, security, policies
const staffOf = (d, sid) => d.staff[sid] || fail('Staff member not found.', 'not_found');
export function inviteStaff(d, s, email, role) {
  need(d, s, 'staff.manage', 'invite staff');
  if (!/^\S+@\S+\.\S+$/.test(email || '')) fail('Enter a valid email address.', 'validation');
  if (!email.endsWith('.example.com')) fail('Use a reserved example address in this demo (ends with .example.com).', 'validation');
  if (!d.roles[role]) fail('Choose a role.', 'validation');
  d.invites.unshift({ id: nid(d, 'INV'), email, role, by: s.name, at: now(), expiresAt: now() + 7 * DAY, status: 'Pending' });
  audit(d, me(d, s), 'Staff invited (simulated, no email sent)', email, { after: d.roles[role].name });
}
// 'accept' simulates the invitee accepting; it creates a staff record without sign-in details,
// so only the in-browser demo offers it.
export function inviteAction(d, s, id, act) {
  need(d, s, 'staff.manage', 'manage invites'); const i = d.invites.find(x => x.id === id) || fail('Invite not found.', 'not_found');
  if (i.status !== 'Pending') fail(`This invite is ${i.status.toLowerCase()}.`);
  if (act === 'revoke') { i.status = 'Revoked'; audit(d, me(d, s), 'Invite revoked', i.email); return; }
  i.status = 'Accepted'; const sid = 'ST-' + String(Object.keys(d.staff).length + 1).padStart(2, '0'); const nm = i.email.split('@')[0].split('.').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  d.staff[sid] = { id: sid, name: nm, email: i.email, roles: [i.role], activeRole: i.role, team: d.roles[i.role].name.replace(' Admin', ''), active: true, twoFA: false, lastSignIn: now(), sessions: [] };
  audit(d, me(d, s), 'Invite accepted (simulated)', sid, { after: d.roles[i.role].name });
}
export function proposeStaffRoles(d, s, sid, roles, reason) {
  need(d, s, 'staff.manage', 'change staff roles'); if (!reason || !reason.trim()) fail('Enter a reason.', 'validation');
  const t = staffOf(d, sid); if (!Array.isArray(roles) || !roles.length) fail('Staff need at least one role.', 'validation');
  if (roles.some(r => !d.roles[r])) fail('Unknown role.', 'validation');
  if (t.roles.includes('superadmin') && !roles.includes('superadmin') && activeSupers(d).length <= 1) fail('This is the last active Super Admin. Their Super Admin role cannot be removed.');
  const before = t.roles.slice(); const added = roles.filter(r => !before.includes(r));
  const raises = added.some(r => d.roles[r].perms.some(p => ['refunds.approve', 'refunds.execute', 'payouts.approve', 'payouts.execute', 'staff.manage', 'settings.edit', 'approvals.decide', 'sellers.evidence'].includes(p)));
  if (raises || sid === s.id) { const a = createApproval(d, { type: 'staffRole', ref: sid, requesterId: s.id, requester: s.name, title: `Role assignment: ${t.name}`, reason, before: before.map(r => d.roles[r].name).join(', '), after: roles.map(r => d.roles[r].name).join(', '), requiredAuthority: 'Super Admin who is not the requester or the person affected', payload: { staffId: sid, roles }, beneficiaries: [sid] }); audit(d, me(d, s), 'Role assignment proposed', sid, { reason, after: a.after, approval: a.id }); return 'approval'; }
  t.roles = roles; if (!roles.includes(t.activeRole)) t.activeRole = roles[0];
  audit(d, me(d, s), 'Staff roles changed', sid, { reason, before: before.join(', '), after: roles.join(', ') }); return 'applied';
}
export function reactivateStaff(d, s, sid, reason) { need(d, s, 'staff.manage', 'reactivate staff'); const t = staffOf(d, sid); if (t.active) fail('Already active.'); t.active = true; audit(d, me(d, s), 'Staff reactivated', sid, { reason }); }
// Revoking all sessions also raises tokenVersion, which the API checks on every request, so
// existing sign-ins really end. A single listed session is a demo record only.
export function revokeSessions(d, s, sid, reason, one) {
  need(d, s, 'staff.manage', 'revoke sessions'); const t = staffOf(d, sid);
  const n = one ? 1 : Math.max(t.sessions.length, 1);
  if (one && !t.sessions.some(x => x.id === one)) fail('Session not found.', 'not_found');
  t.sessions = one ? t.sessions.filter(x => x.id !== one) : [];
  if (!one) t.tokenVersion = (t.tokenVersion || 0) + 1;
  d.securityEvents.unshift({ id: nid(d, 'SE'), at: now(), type: 'Session revoked', who: t.name, detail: `${one ? 1 : 'All'} session(s) revoked by ${s.name}: ${reason}`, status: 'Resolved' });
  audit(d, me(d, s), 'Sessions revoked', sid, { reason, after: one ? '1 ended' : 'All ended' });
}
const integrationOf = (d, id) => d.integrations.find(x => x.id === id) || fail('Integration not found.', 'not_found');
export function testConnection(d, s, id, outcome) {
  need(d, s, 'integrations.edit', 'test integrations'); const p = integrationOf(d, id);
  p.lastCheck = now(); p.health = outcome === 'success' ? 'Operational' : outcome === 'failure' ? 'Failing' : 'Timeout'; if (outcome !== 'success') p.failures++;
  audit(d, me(d, s), 'Test connection (simulated)', id, { after: p.health }); return p.health;
}
export function toggleProvider(d, s, id, reason) {
  need(d, s, 'integrations.edit', 'edit integrations'); const p = integrationOf(d, id); p.enabled = !p.enabled;
  audit(d, me(d, s), p.enabled ? 'Provider enabled' : 'Provider disabled for new payments', id, { reason, after: p.enabled ? 'Enabled' : 'Disabled; pending transactions, callbacks, reconciliation and refunds continue' });
}
export function proposeIntegrationMode(d, s, id, reason) {
  need(d, s, 'integrations.edit', 'change environments'); const p = integrationOf(d, id); const to = p.mode === 'Test' ? 'Live' : 'Test';
  const a = createApproval(d, { type: 'integration', ref: id, requesterId: s.id, requester: s.name, title: `Environment change: ${p.name} to ${to}`, reason, before: p.mode, after: to, requiredAuthority: requiredAuthority(d, 'integration'), payload: { id, mode: to } });
  audit(d, me(d, s), 'Environment change proposed', id, { reason, approval: a.id });
}
export function saveProvider(d, s, id, v, reason) {
  need(d, s, 'integrations.edit', 'edit integrations');
  if (!String(v.markets || '').trim()) fail('Configured markets are required.', 'validation');
  if (!/^https:\/\/\S+/.test(v.callback || '')) fail('Callback URL must start with https://', 'validation');
  const p = integrationOf(d, id); const before = JSON.stringify({ markets: p.markets, callbackUrl: p.callbackUrl });
  p.markets = v.markets.split(',').map(x => x.trim()).filter(Boolean); p.callbackUrl = v.callback; p.callback = 'Configured (simulated)';
  audit(d, me(d, s), 'Provider settings saved', id, { reason, before, after: JSON.stringify({ markets: p.markets, callbackUrl: p.callbackUrl }) });
}
export function togglePayoutMethod(d, s, type) {
  need(d, s, 'settings.edit', 'change payout methods'); const x = d.payoutConfig.find(y => y.type === type) || fail('Payout method not found.', 'not_found');
  x.enabled = !x.enabled; x.notes = x.enabled ? 'Manual processing in demo' : 'Not enabled in demo';
  audit(d, me(d, s), `Payout method ${x.enabled ? 'enabled' : 'disabled'}`, type, { reason: 'Configuration change; existing requests unaffected' });
}
export function resolveSecurityEvent(d, s, id) {
  need(d, s, 'audit.view', 'resolve security events'); const e = d.securityEvents.find(x => x.id === id) || fail('Event not found.', 'not_found');
  e.status = 'Resolved'; audit(d, me(d, s), 'Security event resolved', id);
}
export function publishPolicyDraft(d, s, pid, reason) {
  need(d, s, 'policies.publish', 'publish policies'); const p = d.policies.find(x => x.id === pid) || fail('Policy not found.', 'not_found');
  const v = p.versions.find(x => ['In review', 'Draft'].includes(x.state)); if (!v) fail('There is no draft to publish.');
  if (v.state !== 'In review') fail('Submit the draft for review before publishing.');
  v.reviewer = s.name; publishPolicy(d, me(d, s), pid, v.v, null); audit(d, me(d, s), 'Policy publication reason', p.title, { reason });
}
