// Addresses for every page. A route is { page, id?, ...options }; its address is the page's path,
// the id as one more segment, and the other options as query parameters, so a reload, a shared
// link and the browser's back button all land on the same screen.
const PATHS = {
  home: '/', search: '/search', product: '/product', store: '/store', help: '/help', terms: '/terms', privacy: '/privacy', policies: '/policies',
  'staff-signin': '/staff', signin: '/sign-in', signup: '/register', verify: '/verify-email', forgot: '/forgot-password', reset: '/reset-password', 'email-confirm': '/confirm-email',
  'u-overview': '/account', cart: '/cart', checkout: '/checkout', 'pay-result': '/payment', 'u-orders': '/orders', 'u-order': '/order', following: '/following', support: '/support',
  inbox: '/inbox', cases: '/cases', case: '/case', notifications: '/notifications', account: '/settings', 's-onboarding': '/sell/apply',
  's-overview': '/sell', 's-products': '/sell/products', 's-product-edit': '/sell/product', 's-orders': '/sell/orders', 's-order': '/sell/order', 's-earnings': '/sell/earnings', 's-payouts': '/sell/payouts', 's-store': '/sell/store',
};
const BY_PATH = Object.entries(PATHS).sort((a, b) => b[1].length - a[1].length);
// Admin pages are 'a-<name>' at /admin/<name> and Super Admin pages 'sa-<name>' at /super/<name>.
const staffPath = page => page.startsWith('sa-') ? '/super/' + page.slice(3) : page.startsWith('a-') ? '/admin/' + page.slice(2) : null;
// Never put in an address: single-use tokens from email links. Never read back as page options:
// the one-time parameters of email, payment and verification return links (handled in app.jsx).
const PRIVATE = new Set(['page', 'id', 'token']); const TRANSIENT = new Set(['verify', 'reset', 'email', 'paid', 'kyc']);
const JSONISH = /^(true|false|null|-?\d+(\.\d+)?|[[{"].*)$/;
const encode = v => typeof v === 'string' ? (JSONISH.test(v) ? JSON.stringify(v) : v) : JSON.stringify(v);
const decode = s => { if (!JSONISH.test(s)) return s; try { return JSON.parse(s); } catch { return s; } };

// The address of a route under `base` (the site's base path), or null for a page without one.
export function toUrl(route, base = '/') {
  const path = PATHS[route.page] ?? staffPath(route.page); if (path == null) return null;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(route)) if (!PRIVATE.has(k) && v != null && v !== '' && v !== false) q.set(k, encode(v));
  const full = (path === '/' ? '' : path) + (route.id != null && route.id !== '' ? '/' + encodeURIComponent(route.id) : '');
  return base.replace(/\/$/, '') + (full || '/') + (q.toString() ? '?' + q : '');
}
// The route an address stands for. Unknown addresses give { page: 'notfound' }.
export function fromUrl(loc, base = '/') {
  let path = decodeURI(loc.pathname); const b = base.replace(/\/$/, '');
  if (b && path.startsWith(b)) path = path.slice(b.length);
  path = path.replace(/\/+$/, '') || '/';
  const opts = {}; for (const [k, v] of new URLSearchParams(loc.search)) if (!PRIVATE.has(k) && !TRANSIENT.has(k)) opts[k] = decode(v);
  const withId = (page, rest) => { const id = rest ? decodeURIComponent(rest) : null; return id ? { ...opts, page, id } : { ...opts, page }; };
  const staff = path.match(/^\/(admin|super)\/([a-z-]+)(?:\/([^/]+))?$/);
  if (staff) return withId((staff[1] === 'super' ? 'sa-' : 'a-') + staff[2], staff[3]);
  if (path === '/admin' || path === '/super') return { page: path === '/super' ? 'sa-overview' : 'a-overview' };
  for (const [page, p] of BY_PATH) {
    if (path === p) return { ...opts, page };
    if (p !== '/' && path.startsWith(p + '/') && !path.slice(p.length + 1).includes('/')) return withId(page, path.slice(p.length + 1));
  }
  return { page: 'notfound' };
}
