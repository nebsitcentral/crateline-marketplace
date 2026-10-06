// Seller tools: the seller application, listings, store settings, payout destinations and
// order archiving. Callers pass the signed-in user; every function checks that the record
// belongs to that user's store. Fields are copied one by one, never merged from the input.
import { now } from './clock.js';
import { DomainError, S, PAYOUT_NETS } from './fin.js';
import { notify, openCase, activeRestriction } from './logic.js';
import { SUBS, round2, D } from './data.js';

const fail = (m, c) => { throw new DomainError(m, c); };
const str = (v, max) => String(v ?? '').trim().slice(0, max);
function ownStore(d, u) {
  const st = u.storeId && d.stores[u.storeId];
  if (!st) fail('Only sellers can do this.', 'denied');
  return st;
}
function ownListing(d, u, id) {
  const st = ownStore(d, u);
  const l = d.listings.find(x => x.id === id);
  if (!l || l.storeId !== st.id) fail('Listing not found.', 'not_found');
  return l;
}

// ---------- seller application
// `kyc` names the identity verification provider when one is connected: the seller then verifies
// with the provider after applying, and no documents are attached here.
export function applyAsSeller(d, u, v, { kyc = null } = {}) {
  if (u.storeId) fail('You already have a store.');
  if (activeRestriction(u, 'selling')) fail('Selling is restricted on your account.', 'denied');
  const name = str(v.name, 100), store = str(v.store, 60), desc = str(v.desc, 2000);
  if (name.length < 2) fail('Enter your full legal name.', 'validation');
  if (!v.dob || isNaN(new Date(v.dob)) || (now() - new Date(v.dob)) / (365.25 * D) < 18) fail('Sellers must be 18 or older (placeholder rule, to be confirmed).', 'validation');
  if (store.length < 3) fail('Store name needs at least 3 characters.', 'validation');
  if (Object.values(d.stores).some(x => x.name.toLowerCase() === store.toLowerCase())) fail('That store name is taken.', 'validation');
  const types = (Array.isArray(v.types) ? v.types : []).filter(t => SUBS[t]);
  if (!types.length) fail('Choose at least one product type.', 'validation');
  if (desc.length < 20) fail('Describe your store in at least 20 characters.', 'validation');
  if (!str(v.city, 80) || !str(v.addr, 200)) fail('Enter your business address.', 'validation');
  const docs = (Array.isArray(v.docs) ? v.docs : []).slice(0, 5).map(f => ({ name: str(f?.name, 200) + ' (PLACEHOLDER)', size: Math.max(0, Number(f?.size) || 0) }));
  if (!docs.length && !kyc) fail('Add your identity document.', 'validation');
  const cat = d.categories.some(c => c.id === v.cat) ? v.cat : SUBS[types[0]].cat;
  const id = 'st_' + store.toLowerCase().replace(/\W+/g, '').slice(0, 12) + (now() % 1000);
  d.stores[id] = { id, ownerId: u.id, name: store, tagline: desc.slice(0, 60), cat, hue: 200, status: 'Verification pending', paused: false, joined: now(), completedBase: 0, country: str(v.country, 60), description: desc, replacementTerms: 'Replacement within 7 days for items that fail the stated checks.', image: null, types };
  u.storeId = id;
  d.seq.VR = d.seq.VR || 1;
  d.verifications.unshift({ id: 'VR-' + d.seq.VR++, storeId: id, version: 1, submittedAt: now(), state: 'Verification pending',
    identity: { name, dob: v.dob, country: str(v.country, 60), document: kyc ? `Checked by ${kyc}` : str(v.doc, 60) + ' (placeholder, not uploaded)' },
    business: { name: store, address: `${str(v.addr, 200)}, ${str(v.city, 80)}, ${str(v.country, 60)}`, registration: '' },
    // The email check reflects whether the account's email is verified; it is not taken from the form.
    checks: { email: !!u.emailVerified, identity: !kyc, address: true, sanctions: false }, evidence: kyc ? [] : docs, decisions: [], missing: [],
    ...(kyc ? { kyc: { provider: kyc, status: 'Not started', sessionId: null, url: null, at: now(), result: null } } : {}) });
  d.payoutMethods[id] = []; d.payoutSettings[id] = { threshold: 50, schedule: 'Manual' };
  notify(d, u.id, 'seller', kyc ? `Application submitted. Verify your identity with ${kyc} to continue.` : 'Identity verification submitted. You can prepare draft listings while it is reviewed.', { page: kyc ? 's-onboarding' : 's-overview' });
  if (d.onboarding) delete d.onboarding[u.id];
  return id;
}

// ---------- listings
const LISTING_TEXT = { title: 160, unit: 40, summary: 300, description: 5000, why: 2000, deliveryMethod: 80, replacement: 1000, requirements: 1000, usage: 1000, stock: 40 };
// Validates and cleans listing input from the editor. Returns the fields to store.
export function cleanListing(input, keepIds = []) {
  const v = {}; for (const [k, max] of Object.entries(LISTING_TEXT)) v[k] = str(input[k], max);
  if (v.title.length < 10) fail('Use a descriptive name of at least 10 characters.', 'validation');
  if (v.summary.length < 20) fail('Summarise what the buyer receives (20+ characters).', 'validation');
  if (!v.unit) fail('Name the unit, e.g. contacts, months, calls.', 'validation');
  if (!v.replacement) fail('State the replacement policy.', 'validation');
  if (!SUBS[input.sub]) fail('Choose a category and product type.', 'validation');
  const deliveryDays = Number(input.deliveryDays); if (!(deliveryDays > 0 && deliveryDays <= 365)) fail('Enter delivery time in days.', 'validation');
  const pk = Array.isArray(input.packages) ? input.packages : [];
  if (pk.length < 1 || pk.length > 10) fail('Listings need 1 to 10 fixed packages.', 'validation');
  const packages = pk.map((p, i) => {
    const qty = Number(p.qty), price = Number(p.price), days = Number(p.days);
    if (!str(p.name, 80) || !(qty > 0) || !(price > 0) || !(days > 0)) fail('Each package needs a name, positive quantity, price and delivery days.', 'validation');
    // Existing package ids are kept so orders and carts still point at them.
    const id = keepIds.includes(p.id) ? p.id : 'pk' + now() + i;
    return { id, name: str(p.name, 80), desc: str(p.desc, 300), qty: Math.round(qty), price: round2(price), days: Math.round(days) };
  });
  const features = (Array.isArray(input.features) ? input.features : []).map(f => str(f, 200)).filter(Boolean).slice(0, 12);
  const art = [0, 1, 2].includes(Number(input.art)) ? Number(input.art) : 0;
  return { ...v, sub: input.sub, deliveryDays: Math.round(deliveryDays), packages, features, art, requiresInfo: !!v.requirements };
}
// Creates or updates a listing. publish asks for it to go live (or into review).
export function saveListing(d, u, id, input, publish) {
  const st = ownStore(d, u);
  const src = id ? ownListing(d, u, id) : null;
  if (publish && st.status !== 'Active') fail('Publishing unlocks after store verification. Save it as a draft for now.');
  if (publish && activeRestriction(u, 'selling')) fail('Selling is restricted on your account.', 'denied');
  const clean = cleanListing(input, src ? src.packages.map(p => p.id) : []);
  const needsReview = S(d).listingApproval;
  const commercialChange = src && src.availability === 'Active' && (JSON.stringify(src.packages) !== JSON.stringify(clean.packages) || src.replacement !== clean.replacement);
  let availability = src ? src.availability : 'Draft';
  if (publish) availability = needsReview ? 'Pending review' : 'Active';
  else if (commercialChange && needsReview) availability = 'Pending review';
  const ver = { at: now(), by: 'Seller', packages: JSON.parse(JSON.stringify(clean.packages)), replacement: clean.replacement, title: clean.title };
  const extra = { availability, updatedAt: now(), cat: SUBS[clean.sub].cat, ...(availability === 'Pending review' && (!src || src.availability !== 'Pending review') ? { submittedAt: now() } : {}) };
  if (src) { Object.assign(src, clean, extra); src.versions = [...(src.versions || []), { v: (src.versions || []).length + 1, ...ver }]; return { listingId: src.id, availability }; }
  const nid = 'l_' + now() + Math.floor(Math.random() * 1000);
  d.listings.push({ ...clean, ...extra, id: nid, storeId: st.id, sold: 0, createdAt: now(), versions: [{ v: 1, ...ver }] });
  return { listingId: nid, availability };
}
// Bulk or single status change from the products list. Returns the ids changed and skipped.
export function setListingAvailability(d, u, ids, target) {
  const st = ownStore(d, u);
  if (!['Active', 'Paused', 'Archived'].includes(target)) fail('Unknown status.', 'validation');
  if (!Array.isArray(ids) || !ids.length || ids.length > 100) fail('Select between 1 and 100 listings.', 'validation');
  const ok = [], skipped = [];
  for (const id of ids) {
    const l = ownListing(d, u, id);
    const allowed = target === 'Active' ? st.status === 'Active' && l.availability !== 'Archived' && !activeRestriction(u, 'selling')
      : target === 'Paused' ? ['Active', 'Archived'].includes(l.availability)
        : l.availability !== 'Archived';
    if (!allowed) { skipped.push(id); continue; }
    l.availability = target === 'Active' && !l.approvedAt && S(d).listingApproval ? 'Pending review' : target;
    if (l.availability === 'Pending review') l.submittedAt = now();
    l.updatedAt = now(); ok.push(id);
  }
  return { ok, skipped };
}
export function deleteDraftListing(d, u, id) {
  const l = ownListing(d, u, id);
  if (l.availability !== 'Draft' || d.orders.some(o => o.snap.listingId === id)) fail('Only drafts without orders can be deleted. Archive it instead.');
  d.listings = d.listings.filter(x => x.id !== id);
}
export function duplicateListing(d, u, id) {
  const src = ownListing(d, u, id);
  const nid = 'l_' + now() + Math.floor(Math.random() * 1000);
  const copy = JSON.parse(JSON.stringify(src));
  delete copy.approvedAt; delete copy.reviewNote; delete copy.submittedAt;
  d.listings.push({ ...copy, id: nid, title: 'Copy of ' + src.title, availability: 'Draft', sold: 0, createdAt: now(), updatedAt: now(), versions: [], packages: src.packages.map((p, i) => ({ ...p, id: 'pk' + now() + i })) });
  return nid;
}

// ---------- store
export function updateStore(d, u, v) {
  const st = ownStore(d, u);
  const name = str(v.name, 60); if (name.length < 3) fail('Store name needs 3+ characters.', 'validation');
  if (Object.values(d.stores).some(x => x.id !== st.id && x.name.toLowerCase() === name.toLowerCase())) fail('That store name is taken.', 'validation');
  if (!d.categories.some(c => c.id === v.cat)) fail('Choose a category.', 'validation');
  const hue = Number(v.hue);
  Object.assign(st, { name, tagline: str(v.tagline, 120), description: str(v.description, 2000), cat: v.cat, hue: Number.isFinite(hue) ? Math.round(hue) % 360 : st.hue, replacementTerms: str(v.replacementTerms, 1000) });
}
export function setStorePaused(d, u, paused) { const st = ownStore(d, u); st.paused = !!paused; }
// Adding a destination is security-sensitive: the caller must have re-checked the password.
const hasAddress = (d, sid, address) => (d.payoutMethods[sid] || []).some(m => m.address === address);
export function addPayoutMethod(d, u, { type, holder, acct, bank, net }) {
  const st = ownStore(d, u);
  if (!['Bank', 'Crypto', 'PayPal', 'Payoneer', 'bKash', 'Nagad', 'UPI'].includes(type)) fail('Choose a method type.', 'validation');
  const a = str(acct, 80); if (!str(holder, 100) || a.length < 6) fail('Enter the account holder and a valid account, wallet or email.', 'validation');
  // Crypto destinations keep the full address (the transfer needs it) and must match the network.
  const chain = type === 'Crypto' ? PAYOUT_NETS[net] || fail('Choose a network.', 'validation') : null;
  if (chain && !chain.address.test(a)) fail(`That is not a valid ${net} wallet address. Check it and paste it again.`, 'validation');
  if (chain && hasAddress(d, st.id, a)) fail('This wallet address is already one of your payout methods.', 'validation');
  const list = d.payoutMethods[st.id] = d.payoutMethods[st.id] || [];
  if (list.length >= 10) fail('You can keep up to 10 payout methods.');
  list.push({ id: 'pm' + now(), type, label: `${type === 'Bank' ? (str(bank, 60) || 'Bank') : type === 'Crypto' ? str(net, 40) : type} •••• ${a.slice(-4)}`, holder: str(holder, 100), verified: false, ...(chain ? { net, address: a } : {}) });
  notify(d, u.id, 'seller', `Security: payout destination added (${type}). If this was not you, contact support.`, { page: 's-payouts' });
}

// ---------- orders
export function setOrderArchived(d, u, o, archived) {
  const st = ownStore(d, u); if (o.storeId !== st.id) fail('This order does not belong to your store.', 'denied');
  if (!['completed', 'cancelled', 'refunded'].includes(o.status) || openCase(d, o)) fail('Only finished orders without an open case can be archived.');
  o.archivedBySeller = !!archived;
}
