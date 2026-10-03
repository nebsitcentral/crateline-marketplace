// Thin client for the Crateline API (backend/). The current screens still run on the
// in-browser demo store; this client is the starting point for wiring them to the API.
// See CLAUDE.md, "Phase 2: connect the frontend to the API".
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const apiEnabled = !!BASE;
let token = null;
try { token = sessionStorage.getItem('crateline-token'); } catch { }

async function call(path, { method = 'GET', body } = {}) {
  if (!BASE) throw new Error('VITE_API_URL is not set; the app is running in demo mode.');
  let res;
  try { res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw Object.assign(new Error('Could not reach the server. Check your connection and try again.'), { status: 0 }); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) throw Object.assign(new Error('Too many attempts. Wait 15 minutes and try again.'), { status: 429 });
  if (!res.ok) { const e = new Error(data.error || res.statusText); e.status = res.status; e.code = data.code; e.field = data.field; throw e; }
  return data;
}
export const api = {
  health: () => call('/health'),
  // With two-factor sign-in on, these return { mfa: 'required', ticket } and no session yet.
  login: async (email, password) => { const r = await call('/api/auth/login', { method: 'POST', body: { email, password } }); if (r.token) setToken(r.token); return r; },
  staffLogin: async (email, password) => { const r = await call('/api/auth/staff/login', { method: 'POST', body: { email, password } }); if (r.token) setToken(r.token); return r; },
  mfa: async (ticket, code) => { const r = await call('/api/auth/mfa', { method: 'POST', body: { ticket, code } }); setToken(r.token); return r; },
  twoFactorSetup: () => call('/api/auth/2fa/setup', { method: 'POST' }),
  twoFactorEnable: code => call('/api/auth/2fa/enable', { method: 'POST', body: { code } }),
  twoFactorDisable: (password, code) => call('/api/auth/2fa/disable', { method: 'POST', body: { password, code } }),
  twoFactorRecovery: code => call('/api/auth/2fa/recovery', { method: 'POST', body: { code } }),
  register: async body => { const r = await call('/api/auth/register', { method: 'POST', body }); setToken(r.token); return r; },
  logout: () => setToken(null),
  hasToken: () => !!token,
  catalog: () => call('/api/catalog'),
  state: () => call('/api/state'),
  action: (name, args) => call('/api/actions/' + name, { method: 'POST', body: { args } }),
  support: body => call('/api/support', { method: 'POST', body }),
  // Email links (verification, password reset, email change). These need email set up on the server.
  verifyRequest: () => call('/api/auth/verify/request', { method: 'POST' }),
  verifyConfirm: token => call('/api/auth/verify/confirm', { method: 'POST', body: { token } }),
  forgotPassword: email => call('/api/auth/password/forgot', { method: 'POST', body: { email } }),
  resetPassword: (token, password) => call('/api/auth/password/reset', { method: 'POST', body: { token, password } }),
  changeEmail: (newEmail, password) => call('/api/auth/email/change', { method: 'POST', body: { newEmail, password } }),
  confirmEmail: token => call('/api/auth/email/confirm', { method: 'POST', body: { token } }),
  list: (resource, after, limit = 50) => call(`/api/list/${resource}?limit=${limit}${after ? '&after=' + encodeURIComponent(after) : ''}`),
  addPayoutMethod: body => call('/api/payout-methods', { method: 'POST', body }),
  // Demo controls: Super Admin only, and only while the server allows them (ALLOW_DEMO_CONTROLS).
  demoAdvance: ms => call('/api/demo/advance', { method: 'POST', body: { ms } }),
  demoReset: () => call('/api/demo/reset', { method: 'POST' }),
  demoScenario: patch => call('/api/demo/scenario', { method: 'POST', body: patch }),
  changePassword: async (current, next) => { const r = await call('/api/auth/password', { method: 'POST', body: { current, next } }); setToken(r.token); return r; },
};
function setToken(t) { token = t; try { t ? sessionStorage.setItem('crateline-token', t) : sessionStorage.removeItem('crateline-token'); } catch { } }

// ---------- map an API response into the `db` shape the screens read
// Every collection a screen may touch exists (empty when the caller cannot see it), so screens
// written for the full demo store keep working. Kind is 'guest', 'user' or 'staff'.
const byId = list => Object.fromEntries((list || []).map(x => [x.id, x]));
function emptyDb() {
  return {
    schema: 'api', clockOffset: 0, seq: {}, users: {}, stores: {}, listings: [], reviews: [], roles: {}, staff: {}, categories: [], carts: {},
    purchases: [], payments: [], orders: [], conversations: [], offers: [], cases: [], notifications: [], payouts: [], refunds: [], tickets: [],
    ledger: [], platform: [], approvals: [], audit: [], staffNotes: [], events: [], processedOps: [], blocked: [], assign: {}, notes: {}, recon: [],
    tasks: [], invites: [], securityEvents: [], exports: [], holds: {}, reports: [], verifications: [], settings: { current: { features: {} } },
    integrations: [], payoutConfig: [], payoutMethods: {}, payoutSettings: {}, content: { banners: [], featured: [], faqs: [] }, policies: [], scenario: {},
  };
}
const person = p => ({ following: [], restrictions: [], ...p });

export function toDb(kind, view) {
  const d = emptyDb(); if (!view) return d;
  if (kind === 'staff') {
    const { me, role, users, staff, ...rest } = view;
    Object.assign(d, rest);
    d.users = byId((users || []).map(person));
    d.staff = { ...(staff || {}), [me.id]: { sessions: [], ...staff?.[me.id], ...me } };
    if (!d.roles[me.activeRole]) d.roles[me.activeRole] = role;
    return d;
  }
  // Guests and customers: catalog fields, plus the signed-in customer's own records.
  d.clockOffset = view.clockOffset || 0; d.categories = view.categories; d.reviews = view.reviews; d.policies = view.policies || [];
  d.content = { banners: view.banners, featured: view.featured, faqs: view.faqs };
  d.users = byId((view.people || []).map(person));
  d.stores = byId(view.stores);
  d.listings = view.listings;
  d.settings = { current: { features: view.features, ...(view.settings || {}) } };
  if (kind !== 'user') return d;
  const me = view.me; d.users[me.id] = person(me);
  if (view.myStore) d.stores[view.myStore.id] = view.myStore;
  // The seller's own listings include drafts and paused ones; they replace any public copy.
  const own = new Set((view.myListings || []).map(l => l.id));
  d.listings = [...view.myListings || [], ...view.listings.filter(l => !own.has(l.id))];
  d.carts = { [me.id]: view.cart || [] };
  for (const k of ['purchases', 'orders', 'conversations', 'offers', 'cases', 'refunds', 'notifications', 'tickets', 'payouts', 'ledger', 'platform']) d[k] = view[k] || [];
  if (me.storeId) d.payoutMethods = { [me.storeId]: view.payoutMethods || [] };
  if (view.verification) d.verifications = [view.verification];
  return d;
}
