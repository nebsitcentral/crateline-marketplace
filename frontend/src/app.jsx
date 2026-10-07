import React from 'react';
import { now, CLOCK } from '@crateline/domain/clock.js';
import { seed, syncCats, SCHEMA } from '@crateline/domain/data.js';
import { convFor, activeRestriction } from '@crateline/domain/logic.js';
import { addToCart, setFollow, startConversation } from '@crateline/domain/actions.js';
import { audit, tick, DomainError } from '@crateline/domain/fin.js';
import { AppCtx, Icon, SkeletonGrid, ErrorState } from './ui.jsx';
import { apiEnabled, api, toDb } from './api.js';
import { PublicHeader, Footer, PanelLayout, DemoSwitcher, ApiDemoControls } from './shell.jsx';
import { Home, Search, Product, StorePage, Help, Terms, Privacy, Policies, NotFound, StaffSignIn } from './public.jsx';
import { SignIn, SignUp, Verify, Forgot, Reset, EmailConfirm } from './auth.jsx';
import { UOverview, Cart, Checkout, PayResult, UOrders, UOrder, Following, SupportPage } from './buyer.jsx';
import { Inbox, Cases, CaseDetail, Notifications, AccountSettings } from './shared.jsx';
import { Onboarding, SOverview, SProducts, ProductEditor, SOrders, SOrder, Earnings, Payouts, StoreSettings } from './seller.jsx';
import { AdminShell, Denied, ROUTES, canRoute, homeFor, PreviewDrawer } from './admin-ui.jsx';
import { AOverview, AQueue, AUsers, AUser, ASellers, ASeller, AProducts, AProduct, ACategories, AContent, AOrders, AOrder, ACases, ACase, ASupport, ATicket } from './admin-ops.jsx';
import { APayments, APayment, ARecon, ARefunds, ARefund, APayouts, APayout, AApprovals, AApproval, AReports, AActivity } from './admin-fin.jsx';
import { SAOverview, SAStaff, SAStaffer, SASettings, SACommissions, SAIntegrations, SAPayoutSettings, SAOrderPolicies, SASecurity, SAHealth, SABizReports, SAPolicies } from './super.jsx';
const { useState, useRef, useEffect, useCallback } = React;

const PUBLIC = { 'staff-signin': StaffSignIn, home: Home, search: Search, product: Product, store: StorePage, help: Help, terms: Terms, privacy: Privacy, policies: Policies };
const AUTH = { signin: SignIn, signup: SignUp, verify: Verify, forgot: Forgot, reset: Reset, 'email-confirm': EmailConfirm };
const BUYER = { 'u-overview': UOverview, cart: Cart, checkout: Checkout, 'pay-result': PayResult, 'u-orders': UOrders, 'u-order': UOrder, following: Following, support: SupportPage };
const SHARED = { inbox: Inbox, cases: Cases, case: CaseDetail, notifications: Notifications, account: AccountSettings, 's-onboarding': Onboarding };
const SELLER = { 's-overview': SOverview, 's-products': SProducts, 's-product-edit': ProductEditor, 's-orders': SOrders, 's-order': SOrder, 's-earnings': Earnings, 's-payouts': Payouts, 's-store': StoreSettings };
const ADMIN = { 'a-overview': AOverview, 'a-queue': AQueue, 'a-users': AUsers, 'a-user': AUser, 'a-sellers': ASellers, 'a-seller': ASeller, 'a-products': AProducts, 'a-product': AProduct, 'a-categories': ACategories, 'a-content': AContent,
  'a-orders': AOrders, 'a-order': AOrder, 'a-cases': ACases, 'a-case': ACase, 'a-payments': APayments, 'a-payment': APayment, 'a-recon': ARecon, 'a-refunds': ARefunds, 'a-refund': ARefund, 'a-payouts': APayouts, 'a-payout': APayout,
  'sa-approvals': AApprovals, 'sa-approval': AApproval, 'a-support': ASupport, 'a-ticket': ATicket, 'a-reports': AReports, 'a-activity': AActivity,
  'sa-overview': SAOverview, 'sa-staff': SAStaff, 'sa-staffer': SAStaffer, 'sa-settings': SASettings, 'sa-commissions': SACommissions, 'sa-integrations': SAIntegrations, 'sa-payout-settings': SAPayoutSettings, 'sa-order-policies': SAOrderPolicies, 'sa-security': SASecurity, 'sa-health': SAHealth, 'sa-bizreports': SABizReports, 'sa-policies': SAPolicies };
const TITLES = { home: 'Crateline', search: 'Search', product: 'Product', store: 'Store', inbox: 'Inbox', cases: 'Resolution Center' };
const LS_KEY = 'crateline-demo-state';

function load() {
  try { const s = localStorage.getItem(LS_KEY); if (s) { const d = JSON.parse(s); if (d.schema === SCHEMA) return d; } } catch { }
  return seed();
}
function save(d) { if (apiEnabled) return; try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch { } }

function App() {
  const dbRef = useRef(null); if (!dbRef.current) { dbRef.current = apiEnabled ? toDb('guest', null) : load(); CLOCK.offset = dbRef.current.clockOffset || 0; syncCats(dbRef.current.categories); }
  const [, setVer] = useState(0);
  const [userId, _setUserId] = useState(null); const userRef = useRef(null);
  const [staffId, _setStaffId] = useState(null); const staffRef = useRef(null);
  const [mode, _setMode] = useState('buying'); const modeRef = useRef('buying');
  const [route, _setRoute] = useState({ page: 'home' }); const routeRef = useRef(route);
  const [toasts, setToasts] = useState([]); const [preview, setPreview] = useState(null);
  // API mode: 'loading' until the first response, then 'ready'; an error message if it failed.
  const [apiStatus, setApiStatus] = useState(apiEnabled ? 'loading' : 'ready');
  const [pendingIntent, setPendingIntent] = useState(null); const intentRef = useRef(null);
  const listState = useRef({}); const evidenceOpen = useRef(new Set());
  const setUser = id => { userRef.current = id; _setUserId(id); };
  const setStaff = id => { staffRef.current = id; _setStaffId(id); evidenceOpen.current = new Set(); };
  const setMode = m => { modeRef.current = m; _setMode(m); };
  const setRoute = r => { routeRef.current = r; _setRoute(r); };
  const setIntent = i => { intentRef.current = i; setPendingIntent(i); };

  const toast = useCallback((text, tone = 'ok') => { const id = Math.random(); setToasts(t => [...t.slice(-2), { id, text, tone }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5200); }, []);
  const commit = d => { dbRef.current = d; CLOCK.offset = d.clockOffset || 0; syncCats(d.categories); save(d); setVer(v => v + 1); };
  // Every change runs on a copy. A rejected transition leaves the data untouched,
  // except that a staff member's rejected attempt is recorded in the audit history.
  const run = useCallback((fn, inline = false) => {
    // Safety net: in API mode every change goes through perform() to the server, and the only
    // remaining local updates are demo-only. Anything that reaches here is refused, not applied.
    if (apiEnabled) { toast('This action is not connected to the server yet. Nothing was changed.', 'warn'); return { ok: false, error: new DomainError('Not connected to the API yet.') }; }
    const d = structuredClone(dbRef.current);
    try { const value = fn(d); commit(d); return { ok: true, value }; }
    catch (e) {
      if (!(e instanceof DomainError)) console.error(e);
      if (staffRef.current) { const d2 = structuredClone(dbRef.current); audit(d2, d2.staff[staffRef.current], 'Action rejected', routeRef.current.id || routeRef.current.page, { reason: e.message, outcome: e.code === 'stale' ? 'Stale view refused' : e.code === 'denied' ? 'Blocked' : 'Rejected' }); commit(d2); }
      if (!inline || e.code === 'stale' || e.code === 'denied' || !(e instanceof DomainError)) toast(e.message || 'Something went wrong. Nothing was changed.', 'bad');
      return { ok: false, error: e };
    }
  }, []);
  const update = useCallback(fn => run(fn).value, []);
  const act = useCallback((fn, msg) => { const r = run(fn); if (r.ok && msg) toast(msg); return r; }, []);

  const nav = useCallback((r, replace) => {
    const db = dbRef.current; const p = r.page;
    if (ADMIN[p]) { if (!staffRef.current) { toast('Management pages need a staff account. Use the demo toolbar.', 'warn'); return; } setRoute(r); if (!replace) window.scrollTo(0, 0); return; }
    const uid = userRef.current; const u = uid && db.users[uid];
    const priv = BUYER[p] || SHARED[p] || SELLER[p];
    if (priv && !u) { setIntent({ type: 'nav', route: r }); setRoute({ page: 'signin' }); window.scrollTo(0, 0); return; }
    if (SELLER[p]) { if (!u.storeId) { r = { page: 's-onboarding' }; } else if (modeRef.current !== 'selling') setMode('selling'); }
    if (BUYER[p] && modeRef.current !== 'buying') setMode('buying');
    if (!PUBLIC[p] && !AUTH[p] && !priv) r = { page: 'notfound' };
    setRoute(r); if (!replace) window.scrollTo(0, 0);
  }, []);

  async function runIntent(intent, uid) {
    const db = dbRef.current; const u = db.users[uid];
    const l = intent.listingId && db.listings.find(x => x.id === intent.listingId);
    if (l && u.storeId === l.storeId && (intent.type === 'buy' || intent.type === 'cart')) { toast('You cannot buy your own listing', 'warn'); nav({ page: 'product', id: l.id }); return; }
    const rs = activeRestriction(u, 'purchases'); if (rs && (intent.type === 'buy' || intent.type === 'cart')) { toast('Your account cannot place new orders: ' + rs.notice, 'bad'); return; }
    if (intent.type === 'buy') nav({ page: 'checkout', items: [{ listingId: intent.listingId, pkgId: intent.pkgId, count: intent.count }] });
    else if (intent.type === 'cart') {
      const r = await perform('addToCart', { listingId: intent.listingId, pkgId: intent.pkgId, count: intent.count }, d => addToCart(d, d.users[uid], intent.listingId, intent.pkgId, intent.count), 'Added to cart');
      if (r.ok && routeRef.current.page !== 'product') nav({ page: 'product', id: intent.listingId, pkgId: intent.pkgId, count: intent.count });
    } else if (intent.type === 'follow') {
      const r = await perform('setFollow', { storeId: intent.storeId, on: true }, d => setFollow(d, d.users[uid], intent.storeId, true), 'Following ' + db.stores[intent.storeId].name);
      if (r.ok && intent.back && routeRef.current.page !== intent.back.page) nav(intent.back);
    } else if (intent.type === 'message') {
      if (u.storeId === intent.storeId) { toast('This is your own store', 'warn'); return; }
      const r = await perform('startConversation', { storeId: intent.storeId, listingId: intent.listingId || null }, d => ({ conversationId: startConversation(d, d.users[uid], intent.storeId, intent.listingId || null) })); if (!r.ok) return; const cid = r.value.conversationId;
      if (modeRef.current !== 'buying') setMode('buying');
      nav({ page: 'inbox', id: cid });
    } else if (intent.type === 'nav') nav(intent.route);
  }
  const requireAuth = intent => { if (userRef.current) { runIntent(intent, userRef.current); return true; } setIntent(intent); setRoute({ page: 'signin' }); window.scrollTo(0, 0); return false; };
  const signIn = uid => { setStaff(null); setUser(uid); setMode('buying'); const i = intentRef.current; setIntent(null); toast('Signed in as ' + dbRef.current.users[uid].name); if (i) runIntent(i, uid); else nav({ page: 'u-overview' }); };
  // Load what this caller may see: the catalog for guests, /api/state with a session token.
  // Lists the server capped (audit, notifications, staff notifications): which have older pages.
  const [more, setMore] = useState({}); const endRef = useRef({}); // endRef: lists already read to the end
  const PAGED = ['audit', 'notifications', 'staffNotes'];
  const loadState = async () => {
    const r = await api.state(); const d = toDb(r.kind, r.view); const prev = dbRef.current;
    // Keep older pages already loaded, so a refresh does not shorten a list someone is reading.
    for (const k of PAGED) if (r.more?.[k] && prev[k]?.length > d[k].length) { const ids = new Set(d[k].map(x => x.id)); d[k] = [...d[k], ...prev[k].filter(x => !ids.has(x.id))]; }
    commit(d); setMore(Object.fromEntries(PAGED.map(k => [k, !!r.more?.[k] && !endRef.current[k]])));
    if (r.kind === 'staff') { setUser(null); setStaff(r.view.me.id); } else { setStaff(null); setUser(r.view.me.id); }
    return r;
  };
  const refresh = useCallback(async () => {
    try {
      if (api.hasToken()) {
        try { await loadState(); setApiStatus('ready'); return; } catch (e) { if (e.status !== 401 && e.status !== 403) throw e; api.logout(); setUser(null); setStaff(null); toast('Your session has ended. Sign in again.', 'warn'); }
      }
      commit(toDb('guest', await api.catalog())); setApiStatus('ready');
    } catch (e) { setApiStatus(e.message || 'The server could not be reached.'); }
  }, []);
  useEffect(() => { if (apiEnabled) refresh(); }, []);
  // API mode: how the server sends email ('resend' or 'brevo', 'log' for development, or 'off').
  const [emailMode, setEmailMode] = useState(apiEnabled ? null : 'demo');
  // API mode: 'r2' when the server stores files; otherwise attachments stay simulated.
  const [fileMode, setFileMode] = useState(apiEnabled ? 'off' : 'demo');
  // API mode: 'nowpayments' (or 'nowpayments-sandbox') when crypto checkouts are real payments.
  const [payMode, setPayMode] = useState('simulated');
  // API mode: 'didit' when sellers verify their identity with the provider.
  const [kycMode, setKycMode] = useState('simulated');
  // API mode: 'nowpayments' when crypto payouts are real transfers.
  const [payoutMode, setPayoutMode] = useState('simulated');
  // True while the server still simulates providers or allows demo controls (always in demo mode).
  const [demoEnv, setDemoEnv] = useState(true);
  useEffect(() => { if (apiEnabled) api.health().then(h => { setEmailMode(h.email || 'off'); setFileMode(h.files || 'off'); setPayMode(h.payments || 'simulated'); setKycMode(h.kyc || 'simulated'); setPayoutMode(h.payouts || 'simulated'); setDemoEnv(!!(h.simulateProviders || h.demoControls)); }).catch(() => setEmailMode('off')); }, []);
  // Links from emails arrive as ?verify=, ?reset= or ?email=. Open the matching page and remove
  // the token from the address bar so it is not kept in history or shared by accident.
  useEffect(() => {
    if (!apiEnabled) return;
    const q = new URLSearchParams(window.location.search);
    const hit = [['verify', 'verify'], ['reset', 'reset'], ['email', 'email-confirm']].find(([k]) => q.get(k));
    if (!hit) return;
    setRoute({ page: hit[1], token: q.get(hit[0]) });
    q.delete(hit[0]); window.history.replaceState(null, '', window.location.pathname + (q.toString() ? '?' + q : '') + window.location.hash);
  }, []);

  // Returning from the payment provider (?paid=<purchase>): show that payment's status once the
  // session has loaded. The address itself proves nothing; the status comes from the server.
  const paidRef = useRef(apiEnabled ? new URLSearchParams(window.location.search).get('paid') : null);
  useEffect(() => {
    if (!paidRef.current || apiStatus !== 'ready') return;
    const id = paidRef.current; paidRef.current = null;
    const q = new URLSearchParams(window.location.search); q.delete('paid'); window.history.replaceState(null, '', window.location.pathname + (q.toString() ? '?' + q : '') + window.location.hash);
    nav({ page: 'pay-result', id });
  }, [apiStatus]);

  // Returning from identity verification (?kyc=1): read the result and show the seller's status.
  const kycRef = useRef(apiEnabled && new URLSearchParams(window.location.search).has('kyc'));
  useEffect(() => {
    if (!kycRef.current || apiStatus !== 'ready') return;
    kycRef.current = false;
    const q = new URLSearchParams(window.location.search); q.delete('kyc'); window.history.replaceState(null, '', window.location.pathname + (q.toString() ? '?' + q : '') + window.location.hash);
    nav({ page: 's-onboarding' });
    if (api.hasToken()) api.kycRefresh().then(() => loadState()).catch(() => { });
  }, [apiStatus]);

  // A named transition. API mode: the server runs action `name` with `args`, then the data is
  // reloaded. Demo mode: `local(d)` runs on a copy of the in-browser store. The success message
  // shows only if the change was made. Resolves to { ok, value } or { ok: false, error }.
  // Errors: 401 ends the session; 409 reloads the data and says the record changed; 403 is shown
  // as Access denied. Other refusals (400, 422) are shown as a toast, unless the caller displays
  // them in its own form (opts.inline, or inside withInline, which dialogs use).
  const inlineRef = useRef(0);
  const withInline = useCallback(async fn => { inlineRef.current++; try { return await fn(); } finally { inlineRef.current--; } }, []);
  const perform = useCallback(async (name, args, local, msg, opts = {}) => {
    const inline = opts.inline || inlineRef.current > 0;
    if (!apiEnabled) { const r = run(local, inline); if (r.ok && msg) toast(msg); return r; }
    try {
      const r = await api.action(name, args);
      await loadState(); if (msg) toast(msg);
      return { ok: true, value: r.result };
    } catch (e) {
      if (e.status === 401) { api.logout(); setUser(null); setStaff(null); setRoute({ page: 'signin' }); toast('Your session has ended. Sign in again.', 'warn'); }
      else if (e.status === 409) { await loadState().catch(() => { }); toast(e.message || 'This record changed since you opened it. The latest version is now shown.', 'warn'); }
      else if (e.status === 403) toast(/^Access denied/.test(e.message) ? e.message : 'Access denied. ' + e.message, 'bad');
      else if (!inline || e.status === 0 || e.status >= 500) toast(e.message || 'Something went wrong. Nothing was changed.', 'bad');
      return { ok: false, error: e };
    }
  }, []);

  // API mode: keep the data current while someone is signed in, so detail pages can show that a
  // record changed since it was opened. Quietly ends the session if the server says it expired.
  useEffect(() => {
    if (!apiEnabled || (!userId && !staffId)) return;
    const quiet = () => { if (document.visibilityState === 'visible' && api.hasToken()) loadState().catch(e => { if (e.status === 401) { api.logout(); setUser(null); setStaff(null); setRoute({ page: 'signin' }); toast('Your session has ended. Sign in again.', 'warn'); } }); };
    const t = setInterval(quiet, 30e3); window.addEventListener('focus', quiet); document.addEventListener('visibilitychange', quiet);
    return () => { clearInterval(t); window.removeEventListener('focus', quiet); document.removeEventListener('visibilitychange', quiet); };
  }, [userId, staffId]);

  // API sign-in: `login` calls api.login, api.staffLogin or api.register with the form values.
  // Errors are thrown back to the form so it can show them in place.
  // If the account uses two-factor sign-in, login() returns { mfa, ticket }: hand it back to the
  // form, which asks for the code and calls apiSignIn again with api.mfa.
  const apiSignIn = async login => {
    const first = await login(); if (first?.mfa) return first;
    let r; try { r = await loadState(); } catch (e) { api.logout(); throw e; }
    if (r.kind === 'user') { signIn(r.view.me.id); return; }
    const d = dbRef.current; const s = d.staff[r.view.me.id]; setIntent(null);
    setRoute({ page: homeFor(d, s) }); window.scrollTo(0, 0); toast(`Signed in as ${s.name}, ${d.roles[s.activeRole].name}`, 'info');
  };

  const loadMore = useCallback(async resource => {
    const d = dbRef.current; const list = d[resource] || [];
    try {
      const r = await api.list(resource, list.at(-1)?.id);
      const ids = new Set(list.map(x => x.id)); commit({ ...d, [resource]: [...list, ...r.items.filter(x => !ids.has(x.id))] });
      endRef.current[resource] = !r.next; setMore(m => ({ ...m, [resource]: !!r.next }));
    } catch (e) { toast(e.message || 'Could not load older entries.', 'bad'); }
  }, []);

  const signOut = () => { if (apiEnabled) { api.logout(); refresh(); } setUser(null); setStaff(null); setMode('buying'); setIntent(null); setRoute({ page: 'home' }); toast('Signed out'); };
  const switchMode = m => { setMode(m); toast(m === 'selling' ? 'Switched to selling mode' : 'Switched to buying mode', 'info'); nav({ page: m === 'selling' ? 's-overview' : 'u-overview' }); };
  const setAccount = (a, r) => {
    setIntent(null);
    if (a.staffId) {
      setUser(null); setStaff(a.staffId);
      const d = structuredClone(dbRef.current); const s = d.staff[a.staffId];
      if (!s.active) { toast(`${s.name} is deactivated and cannot sign in.`, 'bad'); setStaff(null); setRoute({ page: 'home' }); return; }
      s.lastSignIn = now(); s.sessions = s.sessions.length ? s.sessions : [{ id: 'SS-' + s.id + now(), device: 'Demo browser (simulated)', at: now() }];
      d.securityEvents.unshift({ id: 'SE-' + now(), at: now(), type: 'Sign-in', who: s.name, detail: 'Demo account switch (simulated sign-in, no credentials)', status: 'Normal' }); commit(d);
      const target = r || { page: homeFor(d, s) }; setRoute(target); window.scrollTo(0, 0);
      toast(`Staff: ${s.name}, ${d.roles[s.activeRole].name}`, 'info'); return;
    }
    setStaff(null); setUser(a.userId); setMode(a.mode || 'buying');
    const cur = routeRef.current.page; const isPriv = !PUBLIC[cur];
    if (r) nav(r);
    else if (!a.userId) { if (isPriv) setRoute({ page: 'home' }); }
    else if (a.mode === 'selling') nav({ page: 's-overview' });
    else if (isPriv || AUTH[cur]) nav({ page: 'u-overview' });
    toast('Demo account: ' + (a.userId ? dbRef.current.users[a.userId].name : 'Guest'), 'info');
  };
  const resetDemo = () => { const d = seed(); CLOCK.offset = 0; listState.current = {}; commit(d); toast('Demo data reset to the seed state', 'info'); setRoute(staffRef.current ? { page: homeFor(d, d.staff[staffRef.current]) } : { page: 'home' }); };
  const advance = ms => { const d = structuredClone(dbRef.current); d.clockOffset = (d.clockOffset || 0) + ms; CLOCK.offset = d.clockOffset; tick(d); commit(d); toast('Demo time advanced. Releases, deadlines and expiries were re-evaluated', 'info'); };
  const setScenario = patch => { const d = structuredClone(dbRef.current); d.scenario = { ...d.scenario, ...patch }; commit(d); };

  useEffect(() => { document.title = 'Crateline' + (route.page !== 'home' ? ' · ' + (ROUTES[route.page]?.[0] || TITLES[route.page] || route.page.replace(/^[us]-/, '').replace(/-/g, ' ')) : ''); }, [route]);

  if (import.meta.env.DEV) window.__crateline = { db: () => dbRef.current }; // dev-only inspection hook
  const db = dbRef.current; const me = userId ? db.users[userId] : null; const staff = staffId ? db.staff[staffId] : null;
  const ctx = { db, me, staff, mode, route, nav, update, act, toast, refresh, apiSignIn, perform, withInline, more, loadMore, emailMode, fileMode, payMode, kycMode, payoutMode, demoEnv, requireAuth, signIn, signOut, switchMode, setAccount, resetDemo, advance, setScenario, pendingIntent, listState, evidenceOpen, openPreview: setPreview };
  const p = route.page;
  let body;
  if (apiStatus !== 'ready') {
    body = <div className="site"><main id="main" className="wrap page">{apiStatus === 'loading' ? <SkeletonGrid n={6} /> : <ErrorState title="Could not load the marketplace" onRetry={() => { setApiStatus('loading'); refresh(); }}>{apiStatus} Check your connection and try again.</ErrorState>}</main></div>;
  } else if (ADMIN[p] && staff) {
    const C = ADMIN[p];
    body = <AdminShell>{!staff.active ? <Denied page={p} /> : canRoute(db, staff, p) ? <C key={p + (route.id || '') + staff.activeRole + staff.id} /> : <Denied page={p} />}</AdminShell>;
  } else if (PUBLIC[p] || AUTH[p] || p === 'notfound' || !me) {
    const C = PUBLIC[p] || AUTH[p] || NotFound;
    body = <div className="site"><a className="skip" href="#main">Skip to content</a><PublicHeader /><main id="main" className={AUTH[p] ? 'auth-main' : ''}><C key={p + (route.id || '')} /></main><Footer /></div>;
  } else {
    const C = BUYER[p] || SHARED[p] || SELLER[p];
    body = <PanelLayout><C key={p + (p === 'inbox' ? '' : route.id || '') + mode} /></PanelLayout>;
  }
  return <AppCtx.Provider value={ctx}>
    {body}
    {preview && <PreviewDrawer kind={preview} onClose={() => setPreview(null)} />}
    <div className="toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={'toast tone-' + t.tone}><Icon n={t.tone === 'bad' ? 'alert' : t.tone === 'warn' ? 'alert' : t.tone === 'info' ? 'info' : 'check'} s={16} />{t.text}</div>)}</div>
    {apiEnabled ? <ApiDemoControls /> : <DemoSwitcher />}
  </AppCtx.Provider>;
}

export default App;
