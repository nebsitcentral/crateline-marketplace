import React from 'react';
import { CATEGORIES } from '@crateline/domain/data.js';
import * as AX from '@crateline/domain/actions.js';
import { Icon, Btn, Avatar, useApp, NotificationList, Badge, Sim, Confirm } from './ui.jsx';
import { api } from './api.js';
import { LOGO_C, LOGO_REST } from './logo-paths.js';
const { useState, useEffect, useRef } = React;

// The wordmark: an orange "C" and the rest of the name in a gradient that follows the theme
// (dark lettering on light backgrounds, light on dark; --logo-a and --logo-b in styles.css).
// Narrow top bars show the "C" alone.
export function Logo({ onClick }) {
  const id = React.useId();
  return <button className="logo" onClick={onClick} aria-label="Crateline home">
    <svg className="logo-full" height="24" viewBox="64 29 217 36" aria-hidden="true"><defs><linearGradient id={id} x1="64" y1="43.5" x2="282" y2="43.5" gradientUnits="userSpaceOnUse"><stop stopColor="var(--logo-a)" /><stop offset="1" stopColor="var(--logo-b)" /></linearGradient></defs><path d={LOGO_C} fill="#FF6505" /><path d={LOGO_REST} fill={`url(#${id})`} /></svg>
    <svg className="logo-mark" height="24" viewBox="64 29 27 29" aria-hidden="true"><path d={LOGO_C} fill="#FF6505" /></svg></button>;
}

function useOutside(ref, fn) { useEffect(() => { const h = e => { if (ref.current && !ref.current.contains(e.target)) fn(); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []); }

function NotifMenu() {
  const { db, me, mode, nav, update, perform } = useApp(); const [open, setOpen] = useState(false); const ref = useRef(); useOutside(ref, () => setOpen(false));
  const panel = mode === 'selling' ? 'seller' : 'buyer';
  const items = db.notifications.filter(n => n.userId === me.id && n.panel === panel);
  const unread = items.filter(n => !n.read).length;
  return <div className="menu-wrap" ref={ref}>
    <button className="iconbtn" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={() => setOpen(!open)}><Icon n="bell" />{unread > 0 && <span className="count">{unread}</span>}</button>
    {open && <div className="dropdown wide-dd"><div className="dd-h"><b>Notifications</b><button className="linkbtn" onClick={() => perform('markNotificationsRead', { panel }, d => AX.markNotificationsRead(d, d.users[me.id], panel))}>Mark all as read</button></div>
      <NotificationList compact items={items.slice(0, 6)} onOpen={n => { perform('markNotificationsRead', { id: n.id }, d => AX.markNotificationsRead(d, d.users[me.id], panel, n.id)); setOpen(false); nav(n.route); }} />
      <button className="dd-foot" onClick={() => { setOpen(false); nav({ page: 'notifications' }); }}>View all notifications</button></div>}
  </div>;
}

function ProfileMenu() {
  const { db, me, mode, nav, switchMode, signOut } = useApp(); const [open, setOpen] = useState(false); const ref = useRef(); useOutside(ref, () => setOpen(false));
  const st = me.storeId && db.stores[me.storeId];
  const go = r => { setOpen(false); nav(r); };
  return <div className="menu-wrap" ref={ref}>
    <button className="profile-btn" aria-expanded={open} onClick={() => setOpen(!open)} aria-label="Account menu"><Avatar name={me.name} hue={me.hue} size={30} /><Icon n="down" s={14} /></button>
    {open && <div className="dropdown" role="menu">
      <div className="dd-user"><Avatar name={me.name} hue={me.hue} size={38} /><div><b>{me.name}</b><span className="muted xs block">Account {me.acct}</span><span className="xs">{mode === 'selling' ? 'Selling mode' : 'Buying mode'}</span></div></div>
      {mode === 'selling' ? <>
        <button role="menuitem" onClick={() => go({ page: 's-overview' })}><Icon n="grid" s={16} />Seller overview</button>
        <button role="menuitem" onClick={() => go({ page: 's-store' })}><Icon n="store" s={16} />Store settings</button>
        <button role="menuitem" onClick={() => go({ page: 'account' })}><Icon n="settings" s={16} />Account settings</button>
        <button role="menuitem" className="accent" onClick={() => { setOpen(false); switchMode('buying'); }}><Icon n="swap" s={16} />Switch to buying</button>
      </> : <>
        <button role="menuitem" onClick={() => go({ page: 'u-overview' })}><Icon n="grid" s={16} />Dashboard</button>
        <button role="menuitem" onClick={() => go({ page: 'account' })}><Icon n="settings" s={16} />Profile settings</button>
        <button role="menuitem" onClick={() => go({ page: 'u-orders' })}><Icon n="receipt" s={16} />Purchase orders</button>
        <button role="menuitem" onClick={() => go({ page: 'cases' })}><Icon n="scale" s={16} />Resolution Center</button>
        {st ? <button role="menuitem" className="accent" onClick={() => { setOpen(false); switchMode('selling'); }}><Icon n="swap" s={16} />Switch to selling</button>
          : <button role="menuitem" className="accent" onClick={() => go({ page: 's-onboarding' })}><Icon n="store" s={16} />Become a seller</button>}
      </>}
      <button role="menuitem" onClick={() => { setOpen(false); signOut(); }}><Icon n="logout" s={16} />Log out</button>
    </div>}
  </div>;
}

function CategoryMenu() {
  const { nav } = useApp(); const [open, setOpen] = useState(false); const ref = useRef(); useOutside(ref, () => setOpen(false));
  return <div className="menu-wrap" ref={ref}>
    <button className="btn btn-ghost cat-btn" aria-expanded={open} onClick={() => setOpen(!open)}><Icon n="grid" s={17} />Categories<Icon n="down" s={14} /></button>
    {open && <div className="dropdown mega">{CATEGORIES.filter(c => c.active).map(c => <div key={c.id}>
      <button className="mega-h" onClick={() => { setOpen(false); nav({ page: 'search', cat: c.id }); }}><Icon n={c.icon} s={16} />{c.name}</button>
      {c.subs.filter(s => s.active).map(s => <button key={s.id} className="mega-s" onClick={() => { setOpen(false); nav({ page: 'search', cat: c.id, sub: s.id }); }}>{s.name}</button>)}</div>)}</div>}
  </div>;
}

export function SearchBox({ big, initial = '' }) {
  const { nav } = useApp(); const [q, setQ] = useState(initial);
  useEffect(() => setQ(initial), [initial]);
  return <form className={'searchbox' + (big ? ' big' : '')} role="search" onSubmit={e => { e.preventDefault(); nav({ page: 'search', q: q.trim() }); }}>
    <Icon n="search" s={big ? 20 : 17} /><input aria-label="Search products and sellers" placeholder="Search databases, VPS, PPC calls, sellers…" value={q} onChange={e => setQ(e.target.value)} />
    <button className="btn btn-primary" type="submit">{big ? 'Search' : <Icon n="arrow" s={16} />}</button></form>;
}

export function PublicHeader() {
  const { db, me, mode, nav, route, requireAuth } = useApp(); const [drawer, setDrawer] = useState(false);
  const cartN = me ? (db.carts[me.id] || []).length : 0;
  const unreadMsgs = me ? db.conversations.filter(c => c.buyerId === me.id).reduce((a, c) => a + c.unread.buyer, 0) : 0;
  return <header className="pub-header"><div className="wrap ph-row">
    <button className="iconbtn only-m" aria-label="Open menu" onClick={() => setDrawer(true)}><Icon n="menu" /></button>
    <Logo onClick={() => nav({ page: 'home' })} />
    <div className="only-d"><CategoryMenu /></div>
    <div className="ph-search only-d">{route.page !== 'home' && <SearchBox initial={route.q || ''} />}</div>
    <nav className="ph-actions" aria-label="Account">
      <button className="iconbtn" aria-label={`Cart, ${cartN} items`} onClick={() => requireAuth({ type: 'nav', route: { page: 'cart' } })}><Icon n="cart" />{cartN > 0 && <span className="count">{cartN}</span>}</button>
      {me ? <>
        <button className="iconbtn" aria-label={`Inbox, ${unreadMsgs} unread`} onClick={() => nav({ page: 'inbox' })}><Icon n="chat" />{unreadMsgs > 0 && <span className="count">{unreadMsgs}</span>}</button>
        <NotifMenu /><ProfileMenu />
      </> : <>
        <Btn v="ghost" onClick={() => nav({ page: 'signin' })}>Sign in</Btn>
        <Btn v="primary" className="only-d" onClick={() => nav({ page: 'signup' })}>Register</Btn>
      </>}
    </nav>
  </div>
    {route.page !== 'home' && <div className="wrap only-m m-search"><SearchBox initial={route.q || ''} /></div>}
    {drawer && <div className="drawer-bg" onClick={() => setDrawer(false)}><aside className="drawer" onClick={e => e.stopPropagation()} aria-label="Menu">
      <div className="drawer-h"><Logo onClick={() => { setDrawer(false); nav({ page: 'home' }); }} /><button className="iconbtn" aria-label="Close menu" onClick={() => setDrawer(false)}><Icon n="x" /></button></div>
      {!me && <div className="drawer-auth"><Btn v="primary" onClick={() => { setDrawer(false); nav({ page: 'signup' }); }}>Register</Btn><Btn onClick={() => { setDrawer(false); nav({ page: 'signin' }); }}>Sign in</Btn></div>}
      {me && <button className="drawer-link" onClick={() => { setDrawer(false); nav({ page: mode === 'selling' ? 's-overview' : 'u-overview' }); }}><Icon n="grid" s={17} />My dashboard</button>}
      {CATEGORIES.filter(c => c.active).map(c => <div key={c.id} className="drawer-group"><button className="drawer-link b" onClick={() => { setDrawer(false); nav({ page: 'search', cat: c.id }); }}><Icon n={c.icon} s={17} />{c.name}</button>
        {c.subs.filter(s => s.active).map(s => <button key={s.id} className="drawer-sub" onClick={() => { setDrawer(false); nav({ page: 'search', cat: c.id, sub: s.id }); }}>{s.name}</button>)}</div>)}
      <button className="drawer-link" onClick={() => { setDrawer(false); nav({ page: 'help' }); }}><Icon n="info" s={17} />Help Center</button>
    </aside></div>}
  </header>;
}

export function Footer() {
  const { nav } = useApp();
  const L = (label, r) => <li><a href="#" onClick={e => { e.preventDefault(); nav(r); }}>{label}</a></li>;
  return <footer className="footer"><div className="wrap foot-grid">
    <div className="foot-brand"><Logo onClick={() => nav({ page: 'home' })} /><p className="muted small">A marketplace for digital products and services, connecting buyers with verified sellers of data, accounts, infrastructure and managed services.</p>
      <p className="muted xs">Crateline Marketplace Ltd. (placeholder company details) · Registered office address to be confirmed</p></div>
    <div><h4>Marketplace</h4><ul>{CATEGORIES.filter(c => c.active).map(c => L(c.name, { page: 'search', cat: c.id }))}</ul></div>
    <div><h4>Policies</h4><ul>{L('Terms and Conditions', { page: 'terms' })}{L('Privacy Policy', { page: 'privacy' })}{L('Purchase, delivery and refunds', { page: 'policies' })}</ul></div>
    <div><h4>Support</h4><ul>{L('Help Center', { page: 'help' })}{L('Contact support', { page: 'help', form: true })}{L('Become a seller', { page: 's-onboarding' })}{L('Staff sign-in (Admin panels)', { page: 'staff-signin' })}</ul></div>
  </div><div className="wrap foot-base muted xs">Interactive prototype. Payments, verification, uploads and payouts are simulated. © 2026 Crateline (fictional brand).</div></footer>;
}

// Top navigation. `items` are { id, label, icon, count, group }. The first `primary` links always
// show in the bar, the next `wide` only on wide screens, and every other link sits in More.
export function TopNav({ label, items, active, onGo, primary = 4, wide = 2 }) {
  const [open, setOpen] = useState(false); const ref = useRef(); useOutside(ref, () => setOpen(false));
  useEffect(() => { if (!open) return; const k = e => { if (e.key === 'Escape') setOpen(false); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [open]);
  const bar = items.slice(0, primary + wide); const more = items.slice(primary);
  const go = id => { setOpen(false); onGo(id); };
  const link = (it, i) => <button key={it.id} className={'tn-link' + (active === it.id ? ' on' : '') + (i >= primary ? ' tn-wide' : '')} aria-current={active === it.id ? 'page' : undefined} onClick={() => go(it.id)}>
    {it.label}{it.count > 0 && <span className="tn-n">{it.count}</span>}</button>;
  const moreActive = more.some((it, i) => it.id === active && i >= wide);
  return <nav className="topnav" aria-label={label}>
    {bar.map(link)}
    {more.length > 0 && <div className="menu-wrap tn-more" ref={ref}>
      <button className={'tn-link' + (moreActive ? ' on' : '')} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>More<Icon n="down" s={13} /></button>
      {open && <div className="dropdown" role="menu">{more.map((it, i) => <React.Fragment key={it.id}>
        {it.group && it.group !== more[i - 1]?.group && <span className={'tn-group' + (i < wide ? ' tn-wide-item' : '')}>{it.group}</span>}
        <button role="menuitem" className={(active === it.id ? 'on' : '') + (i < wide ? ' tn-wide-item' : '')} onClick={() => go(it.id)}><Icon n={it.icon || 'box'} s={16} />{it.label}{it.count > 0 && <span className="tn-n">{it.count}</span>}</button>
      </React.Fragment>)}</div>}
    </div>}
  </nav>;
}

const BUYER_NAV = [
  ['u-overview', 'Overview', 'grid'], ['u-orders', 'Purchase orders', 'receipt'], ['inbox', 'Inbox', 'chat'], ['cases', 'Resolution Center', 'scale'],
  ['following', 'Followed sellers', 'heart'], ['notifications', 'Notifications', 'bell'], ['support', 'Support', 'info'], ['account', 'Account settings', 'settings'],
];
const SELLER_NAV = [
  ['s-overview', 'Overview', 'grid'], ['s-products', 'Products', 'box'], ['s-orders', 'Orders', 'receipt'], ['inbox', 'Inbox', 'chat'], ['cases', 'Resolution Center', 'scale'],
  ['s-earnings', 'Earnings', 'activity'], ['s-payouts', 'Payouts', 'wallet'], ['notifications', 'Notifications', 'bell'], ['s-store', 'Store settings', 'store'], ['account', 'Account settings', 'settings'],
];
const ACTIVE_MAP = { 'u-order': 'u-orders', case: 'cases', 's-order': 's-orders', 's-product-edit': 's-products', cart: 'u-overview', checkout: 'u-overview', 'pay-result': 'u-orders' };

export function PanelLayout({ children }) {
  const { db, me, mode, route, nav, switchMode } = useApp(); const [drawer, setDrawer] = useState(false);
  const selling = mode === 'selling'; const st = me.storeId && db.stores[me.storeId];
  const navItems = selling ? SELLER_NAV : BUYER_NAV;
  const active = ACTIVE_MAP[route.page] || route.page;
  const unreadMsgs = db.conversations.filter(c => selling ? c.storeId === me.storeId : c.buyerId === me.id).reduce((a, c) => a + (selling ? c.unread.seller : c.unread.buyer), 0);
  const unreadN = db.notifications.filter(n => n.userId === me.id && n.panel === (selling ? 'seller' : 'buyer') && !n.read).length;
  const counts = { inbox: unreadMsgs, notifications: unreadN, cases: db.cases.filter(c => (selling ? c.storeId === me.storeId : c.buyerId === me.id) && !['Resolved', 'Closed'].includes(c.status)).length };
  const side = <nav className="side-nav" aria-label={selling ? 'Seller panel' : 'User panel'}>
    <div className="side-mode"><span className="xs muted">{selling ? 'Seller panel' : 'User panel'}</span>{selling && st && <b className="small">{st.name}</b>}{selling && st && st.status !== 'Active' && <Badge tone="warn">{st.status}</Badge>}</div>
    {navItems.map(([id, label, icon]) => <button key={id} className={'side-link' + (active === id ? ' on' : '')} aria-current={active === id ? 'page' : undefined} onClick={() => { setDrawer(false); nav({ page: id }); }}>
      <Icon n={icon} s={17} /><span>{label}</span>{counts[id] > 0 && <span className="side-n">{counts[id]}</span>}</button>)}
    <div className="side-sep" />
    {selling ? <button className="side-link switch" onClick={() => { setDrawer(false); switchMode('buying'); }}><Icon n="swap" s={17} /><span>Switch to buying</span></button>
      : st ? <button className="side-link switch" onClick={() => { setDrawer(false); switchMode('selling'); }}><Icon n="swap" s={17} /><span>Switch to selling</span></button>
        : <button className={'side-link switch' + (active === 's-onboarding' ? ' on' : '')} onClick={() => { setDrawer(false); nav({ page: 's-onboarding' }); }}><Icon n="store" s={17} /><span>Become a seller</span></button>}
    <button className="side-link" onClick={() => { setDrawer(false); nav({ page: 'home' }); }}><Icon n="home" s={17} /><span>Marketplace home</span></button>
  </nav>;
  return <div className="panel">
    <header className="topbar"><div className="tb-row">
      <button className="iconbtn only-m" aria-label="Open navigation" onClick={() => setDrawer(true)}><Icon n="menu" /></button>
      <Logo onClick={() => nav({ page: 'home' })} />
      <span className={'mode-chip ' + (selling ? 'sell' : 'buy')}>{selling ? 'Selling' : 'Buying'}</span>
      <TopNav label={selling ? 'Seller panel' : 'User panel'} active={active} onGo={id => nav({ page: id })} items={navItems.map(([id, label, icon]) => ({ id, label, icon, count: counts[id] }))} />
      <div className="tb-search only-d"><SearchBox /></div>
      <nav className="ph-actions" aria-label="Account">
        {!selling && <button className="iconbtn" aria-label="Cart" onClick={() => nav({ page: 'cart' })}><Icon n="cart" />{(db.carts[me.id] || []).length > 0 && <span className="count">{(db.carts[me.id] || []).length}</span>}</button>}
        <button className="iconbtn" aria-label={`Inbox, ${unreadMsgs} unread`} onClick={() => nav({ page: 'inbox' })}><Icon n="chat" />{unreadMsgs > 0 && <span className="count">{unreadMsgs}</span>}</button>
        <NotifMenu /><ProfileMenu /></nav>
    </div></header>
    <div className="panel-body">
      <main className="panel-main" id="main">{children}</main>
    </div>
    {drawer && <div className="drawer-bg" onClick={() => setDrawer(false)}><aside className="drawer" onClick={e => e.stopPropagation()}><div className="drawer-h"><Logo onClick={() => nav({ page: 'home' })} /><button className="iconbtn" aria-label="Close navigation" onClick={() => setDrawer(false)}><Icon n="x" /></button></div>{side}</aside></div>}
  </div>;
}

export function PageHead({ title, sub, actions, back }) {
  const { nav } = useApp();
  return <div className="page-head">{back && <button className="back" onClick={() => nav(back.route)}><Icon n="left" s={15} />{back.label}</button>}
    <div className="ph-line"><div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>{actions && <div className="ph-acts">{actions}</div>}</div></div>;
}

const JOURNEYS = [
  { id: 'j1', title: 'Browse to purchase', as: 'guest', route: { page: 'product', id: 'l_b2b_saas' }, hint: 'As a guest, pick a package and press Buy now. Sign in as Mira (demo button) and you return to checkout with the package kept. Pay with any method and choose an outcome.' },
  { id: 'j2', title: 'Seller fulfilment to buyer acceptance', as: 'nova', route: { page: 's-order', id: 'ORD-1004' }, hint: 'As Noor (Nova Cloud), submit a delivery on the overdue ORD-1004. Then switch to Buyer (Mira) and confirm receipt on the same order.' },
  { id: 'j3', title: 'Custom offer to checkout', as: 'buyer', route: { page: 'product', id: 'l_b2b_saas', openOffer: true }, hint: 'As Mira, request a custom offer. Switch to Seller (Rafi) and send an offer from the inbox. Switch back, accept and pay. One order appears in both panels.' },
  { id: 'j4', title: 'Order dispute, both sides', as: 'buyer', route: { page: 'u-order', id: 'ORD-1001' }, hint: 'As Mira, report ORD-1001. Switch to Seller to respond, or to a Dispute Admin to decide. A refund decision needs Finance approval before money moves.' },
];
const CHECKS = [
  ['AC01', 'Support vs Finance access', 'SUP-01', { page: 'a-refunds' }, 'As Sam (Support), Refunds is denied. Switch to Felix (Finance) and the same page, exports and actions are available.'],
  ['AC02', 'Seller verification', 'VER-01', { page: 'a-seller', id: 'st_kestrel' }, 'Simulate the resubmission, complete the outstanding check, then approve. Open the seller preview to see the outcome.'],
  ['AC03', 'Listing review', 'CAT-01', { page: 'a-product', id: 'l_atlas_health' }, 'Request changes (replacement terms). As Rafi, edit and resubmit; as Chen, approve, then pause. Existing orders keep their snapshot.'],
  ['AC04', 'Multi-seller purchase', 'OPS-01', { page: 'a-order', id: 'ORD-1001' }, 'PG-5001 charged once ($160) with $100 to Atlas (ORD-1001) and $60 to Nova (ORD-1004).'],
  ['AC05', 'Dispute hold and decision', 'FIN-02', { page: 'a-case', id: 'CASE-3001' }, '$90 of ORD-1003 is held. The $20 partial refund awaits approval; the case stays open until the remedy is implemented.'],
  ['AC06', 'Self-approval blocked', 'FIN-02', { page: 'a-refund', id: 'RF-3001' }, 'Priya requested RF-3001 as Dispute Admin. Switch her active role to Finance (profile menu) and try Approve: blocked and audited. Felix can approve.'],
  ['AC07', '$20 refund reversal', 'FIN-01', { page: 'a-refund', id: 'RF-3001' }, 'Approve, execute, deliver the provider result. Commission −$2, seller −$18, $72 stays held. Replay the event: totals unchanged.'],
  ['AC08', 'Payout outcomes', 'FIN-01', { page: 'a-payout', id: 'PAY-1001' }, 'Approve and execute PAY-1001. Set the provider outcome to success, failure or unknown in Scenario outcomes, then deliver the result.'],
  ['AC09', 'Invalidation and stale views', 'FIN-01', { page: 'a-payout', id: 'PAY-1001' }, 'Approve, then Simulate destination change: the approval is invalidated. Use Simulate concurrent edit on any record to see a stale action refused.'],
  ['AC10', 'Prospective commission', 'SA-01', { page: 'sa-approval', id: 'APR-3' }, 'Sofia approves Kwame’s 12% change (effective in 7 days). Advance time; new orders use 12%, existing orders keep 10%.'],
  ['AC11', 'Deactivate staff', 'SA-01', { page: 'sa-staffer', id: 'FIN-02' }, 'Deactivate Priya: her case moves to unassigned and she can no longer sign in. Try deactivating the last Super Admin to see the block.'],
  ['AC12', 'Reports and exports', 'SA-02', { page: 'sa-bizreports' }, 'Totals derive from ledger entries and reconcile. Export shows the exact CSV rows for your permissions.'],
  ['AC13', 'Audit and private notes', 'SA-01', { page: 'sa-security' }, 'Every privileged action is listed. Internal case notes never appear in the buyer or seller preview.'],
];
export const ACCOUNTS = [
  { id: 'guest', label: 'Guest', desc: 'Browse without signing in', userId: null },
  { id: 'buyer', label: 'Buyer', desc: 'Mira Patel', userId: 'u_mira', mode: 'buying' },
  { id: 'seller', label: 'Seller', desc: 'Rafi Ahmed, Atlas Data Co.', userId: 'u_rafi', mode: 'selling' },
  { id: 'nova', label: 'Seller (Nova)', desc: 'Noor Haddad, Nova Cloud', userId: 'u_noor', mode: 'selling' },
  { id: 'pending', label: 'Pending seller', desc: 'Hasan Chowdhury, awaiting verification', userId: 'u_hasan', mode: 'selling' },
];
// API mode: demo time travel, reset and simulated provider outcomes for Super Admins, shown only
// when the server reports demo controls enabled. The server enforces both conditions.
export function ApiDemoControls() {
  const { db, staff, refresh, toast } = useApp(); const [enabled, setEnabled] = useState(false); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false);
  useEffect(() => { api.health().then(h => setEnabled(!!h.demoControls)).catch(() => setEnabled(false)); }, []);
  if (!enabled || !staff || !staff.roles.includes('superadmin')) return null;
  const sc = db.scenario || {}; const clock = new Date(now()).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const go = async (fn, msg) => { setBusy(true); try { await fn(); await refresh(); toast(msg, 'info'); } catch (e) { toast(e.message, 'bad'); } setBusy(false); };
  return <div className="demo">
    {open && <div className="demo-panel" role="dialog" aria-label="Demo controls">
      <div className="demo-h"><b>Demo controls</b><button className="iconbtn sm" aria-label="Close demo controls" onClick={() => setOpen(false)}><Icon n="x" s={16} /></button></div>
      <p className="xs muted">Super Admin only. These change the shared demo server for everyone using it.</p>
      <DemoSection title={`Demo time · ${clock}`} open><div className="row-gap">{[['+1 hour', 36e5], ['+1 day', 864e5], ['+3 days', 3 * 864e5], ['+8 days', 8 * 864e5]].map(([l, ms]) =>
        <button key={l} className="demo-btn" disabled={busy} onClick={() => go(() => api.demoAdvance(ms), 'Demo time advanced. Releases, deadlines and expiries were re-evaluated')}>{l}</button>)}</div></DemoSection>
      <DemoSection title="Simulated provider outcomes" open>
        <label className="demo-row">Refunds, payouts, reconciliation<select value={sc.provider || 'success'} disabled={busy} onChange={e => go(() => api.demoScenario({ provider: e.target.value }), 'Provider outcome set to ' + e.target.value)}>{['success', 'failure', 'unknown'].map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="demo-row">Connection tests<select value={sc.testConn || 'success'} disabled={busy} onChange={e => go(() => api.demoScenario({ testConn: e.target.value }), 'Connection test outcome set to ' + e.target.value)}>{['success', 'failure', 'timeout'].map(x => <option key={x}>{x}</option>)}</select></label>
      </DemoSection>
      <button className="demo-btn" disabled={busy} onClick={() => setConfirm(true)}>Reset all demo data…</button>
    </div>}
    <button className="demo-pill" aria-expanded={open} onClick={() => setOpen(!open)}><span className="demo-dot" />Demo controls <Sim>Demo environment</Sim></button>
    {confirm && <Confirm danger title="Reset all demo data?" body="Every order, case, payout, setting and account on this demo server returns to the original fixtures, including passwords. Everyone signed in sees the reset." confirmLabel="Reset demo data" onClose={() => setConfirm(false)} onConfirm={() => go(() => api.demoReset(), 'Demo data reset to the original fixtures')} />}
  </div>;
}

function DemoSection({ title, children, open }) { return <details className="demo-sec" open={open}><summary>{title}</summary><div className="demo-sec-b">{children}</div></details>; }
export function DemoSwitcher() {
  const { db, me, staff, mode, route, setAccount, resetDemo, advance, setScenario, update } = useApp(); const [open, setOpen] = useState(false); const [hint, setHint] = useState(null); const [confirmReset, setConfirmReset] = useState(false); const ref = useRef(); useOutside(ref, () => setOpen(false));
  const cur = staff ? { id: staff.id, label: staff.name.split(' ')[0] + ' · ' + db.roles[staff.activeRole].name } : ACCOUNTS.find(a => (a.userId || null) === (me?.id || null)) || { label: me ? me.name.split(' ')[0] : 'Guest' };
  const sc = db.scenario; const clock = new Date(now()).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const COLL = { 'a-case': 'cases', 'a-refund': 'refunds', 'a-payout': 'payouts', 'sa-approval': 'approvals' };
  const editable = COLL[route.page] || route.page === 'a-seller';
  function concurrent() {
    update(d => { const rec = route.page === 'a-seller' ? d.verifications.find(v => v.storeId === route.id) : d[COLL[route.page]].find(x => x.id === route.id); if (!rec) return; rec.version = (rec.version || 1) + 1; d.audit.unshift({ id: 'AU-sim' + now(), at: now(), actorId: 'SA-02', actor: 'Kwame Mensah', role: 'Super Admin', action: 'Edited record (simulated concurrent edit)', object: route.id, reason: 'Demo toolbar', before: null, after: 'Version ' + rec.version, approval: null, outcome: 'Success' }); });
  }
  return <div className="demo" ref={ref}>
    {hint && <div className="demo-hint" role="status"><b>{hint.title}</b><p>{hint.hint}</p><button className="linkbtn" onClick={() => setHint(null)}>Hide guide</button></div>}
    {open && <div className="demo-panel" role="dialog" aria-label="Demo controls">
      <div className="demo-h"><b>Demo toolbar</b><Sim>Not part of the product</Sim></div>
      <DemoSection title="Admin and Super Admin panels (staff accounts)" open={true}><div className="demo-accts">{Object.values(db.staff).map(s => <button key={s.id} disabled={!s.active} className={staff?.id === s.id ? 'on' : ''} onClick={() => { setAccount({ staffId: s.id }); setOpen(false); }}><b>{s.name}</b><span>{s.id} · {s.roles.map(r => db.roles[r].name).join(' + ')}{s.active ? '' : ' · inactive'}</span></button>)}</div></DemoSection>
      <DemoSection title="Customer accounts" open={!staff}><div className="demo-accts">{ACCOUNTS.map(a => <button key={a.id} className={(!staff && cur.id === a.id ? 'on' : '')} onClick={() => { setAccount(a); setOpen(false); }}><b>{a.label}</b><span>{a.desc}</span></button>)}</div></DemoSection>
      <DemoSection title="Scenario outcomes">
        <label className="demo-row">Provider result<select value={sc.provider} onChange={e => setScenario({ provider: e.target.value })}><option value="success">Success</option><option value="failure">Confirmed failure</option><option value="unknown">Unknown (no response)</option></select></label>
        <label className="demo-row">Customer email delivery<select value={sc.notifyFail ? 'fail' : 'ok'} onChange={e => setScenario({ notifyFail: e.target.value === 'fail' })}><option value="ok">Delivered</option><option value="fail">Fails (event still succeeds)</option></select></label>
        <label className="demo-row">Integration test<select value={sc.testConn} onChange={e => setScenario({ testConn: e.target.value })}><option value="success">Success</option><option value="failure">Failure</option><option value="timeout">Timeout</option></select></label>
        <button className="demo-btn" onClick={() => setScenario({ pageError: true })}>Fail the next management page load</button>
        {db.orders.find(o => o.id === 'ORD-1004') && <label className="demo-row">ORD-1004 state<select value="" onChange={e => e.target.value && update(d => import_orderScenario(d, e.target.value))}><option value="">Move to…</option><option value="awaiting_info">Awaiting buyer information</option><option value="preparing">Preparing</option><option value="partial">Partially delivered</option></select></label>}
        {staff && editable && <button className="demo-btn" onClick={concurrent}>Simulate concurrent edit of {route.id}</button>}
      </DemoSection>
      <DemoSection title={`Demo time · ${clock}`}><div className="row-gap">{[['+1 hour', 36e5], ['+1 day', 864e5], ['+3 days', 3 * 864e5], ['+8 days', 8 * 864e5]].map(([l, ms]) => <button key={l} className="demo-btn" onClick={() => advance(ms)}>{l}</button>)}</div><p className="xs muted">Advancing releases earnings, escalates overdue cases, applies scheduled settings and expires approvals.</p></DemoSection>
      <DemoSection title="Customer journeys"><div className="demo-j">{JOURNEYS.map((j, i) => <button key={j.id} onClick={() => { setAccount(ACCOUNTS.find(a => a.id === j.as), j.route); setHint(j); setOpen(false); }}><span className="jn">{i + 1}</span>{j.title}</button>)}</div></DemoSection>
      <DemoSection title="Acceptance checks (Section 19)"><div className="demo-j">{CHECKS.map(([id, t, sid, r, h]) => <button key={id} onClick={() => { setAccount({ staffId: sid }, r); setHint({ title: `${id}: ${t}`, hint: h }); setOpen(false); }}><span className="jn">{id.slice(2)}</span>{t}</button>)}</div></DemoSection>
      <p className="xs muted">Access is enforced in the browser for this demo. Real security needs the same checks on a backend. State is kept in this browser only.</p>
      {confirmReset ? <div className="row-gap"><span className="xs">Reset all demo data?</span><Btn size="sm" v="danger" onClick={() => { resetDemo(); setOpen(false); setHint(null); setConfirmReset(false); }}>Reset</Btn><Btn size="sm" v="ghost" onClick={() => setConfirmReset(false)}>Keep</Btn></div>
        : <Btn size="sm" v="ghost" icon="refresh" onClick={() => setConfirmReset(true)}>Reset demo data</Btn>}
    </div>}
    <button className="demo-pill" aria-expanded={open} onClick={() => setOpen(!open)}><span className="demo-dot" />Demo: <b>{cur.label}</b>{me && me.storeId && !staff && <span className="xs">· {mode === 'selling' ? 'selling' : 'buying'}</span>}<Icon n="down" s={14} /></button>
  </div>;
}
import { orderScenario } from '@crateline/domain/ops.js';
import { now } from '@crateline/domain/clock.js';
function import_orderScenario(d, st) { orderScenario(d, { name: 'Demo toolbar' }, 'ORD-1004', st); }
