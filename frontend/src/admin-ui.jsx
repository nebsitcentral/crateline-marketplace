import React from 'react';
// Shared management-panel components: shell, permission gate, lists, detail layout,
// assignment side panel, reason dialogs, evidence access, exports and customer previews.
import { now, DAY } from '@crateline/domain/clock.js';
import { fmtMoney, can, roleOf, isSuper, assignment, setAssignee, key, audit, nid, storeBuckets, staffWith, setPriority, addNote, switchRole, markStaffNotesRead, logEvidenceView, logExport } from '@crateline/domain/fin.js';
import { fmtDT, fmtDate, rel, tzName, STATUS_LABEL, STATUS_TONE, openCase } from '@crateline/domain/logic.js';
import { Icon, Btn, Badge, Avatar, Modal, Field, Notice, Empty, ErrorState, Table, KV, Section, Sim, Timeline, useApp } from './ui.jsx';
import { Logo } from './shell.jsx';
import { TwoFactorPanel } from './shared.jsx';
import { apiEnabled, api } from './api.js';
const { useState, useEffect, useRef, useMemo } = React;

// ---------- routes and navigation (the same map drives sidebar, direct navigation and breadcrumbs)
export const ROUTES = {
  'a-overview': ['Overview', 'queue.view', 'Work'], 'a-queue': ['Work queue', 'queue.view', 'Work'],
  'a-users': ['Users', 'users.view', 'People'], 'a-user': ['User', 'users.view', 'People', 'a-users'],
  'a-sellers': ['Sellers', 'sellers.view', 'People'], 'a-seller': ['Seller', 'sellers.view', 'People', 'a-sellers'],
  'a-products': ['Products', 'catalog.view', 'Catalog'], 'a-product': ['Product', 'catalog.view', 'Catalog', 'a-products'],
  'a-categories': ['Categories', 'catalog.view', 'Catalog'], 'a-content': ['Content', 'content.draft', 'Catalog'],
  'a-orders': ['Orders', 'orders.view', 'Transactions'], 'a-order': ['Order', 'orders.view', 'Transactions', 'a-orders'],
  'a-cases': ['Resolution Center', 'cases.view', 'Transactions'], 'a-case': ['Case', 'cases.view', 'Transactions', 'a-cases'],
  'a-payments': ['Payments', 'payments.view', 'Money'], 'a-payment': ['Payment', 'payments.view', 'Money', 'a-payments'], 'a-recon': ['Reconciliation', 'payments.view', 'Money', 'a-payments'],
  'a-refunds': ['Refunds', 'refunds.view', 'Money'], 'a-refund': ['Refund', 'refunds.view', 'Money', 'a-refunds'],
  'a-payouts': ['Payouts', 'payouts.view', 'Money'], 'a-payout': ['Payout', 'payouts.view', 'Money', 'a-payouts'],
  'sa-approvals': ['Approvals', 'approvals.view', 'Money'], 'sa-approval': ['Approval', 'approvals.view', 'Money', 'sa-approvals'],
  'a-support': ['Support', 'support.view', 'Service'], 'a-ticket': ['Ticket', 'support.view', 'Service', 'a-support'],
  'a-reports': ['Reports', 'reports.view', 'Insight'], 'a-activity': ['Activity', 'activity.view', 'Insight'],
  'sa-overview': ['Business overview', 'sa.overview', 'Super Admin'], 'sa-staff': ['Staff and roles', 'staff.view', 'Super Admin'], 'sa-staffer': ['Staff member', 'staff.view', 'Super Admin', 'sa-staff'],
  'sa-settings': ['Marketplace settings', 'settings.view', 'Super Admin'], 'sa-commissions': ['Commissions and fees', 'settings.view', 'Super Admin'],
  'sa-integrations': ['Payment integrations', 'settings.view', 'Super Admin'], 'sa-payout-settings': ['Payout and settlement', 'settings.view', 'Super Admin'],
  'sa-order-policies': ['Order and dispute policies', 'settings.view', 'Super Admin'], 'sa-security': ['Security and audit', 'audit.view', 'Super Admin'],
  'sa-health': ['System health', 'health.view', 'Super Admin'], 'sa-bizreports': ['Business reports', 'bizreports.view', 'Super Admin'], 'sa-policies': ['Policies', 'settings.view', 'Super Admin'],
};
const NAV_ICON = { 'a-overview': 'grid', 'a-queue': 'inbox', 'a-users': 'users', 'a-sellers': 'store', 'a-products': 'box', 'a-categories': 'layers', 'a-content': 'edit', 'a-orders': 'receipt', 'a-cases': 'scale', 'a-payments': 'wallet', 'a-refunds': 'refresh', 'a-payouts': 'bank', 'sa-approvals': 'check', 'a-support': 'headset', 'a-reports': 'activity', 'a-activity': 'clock',
  'sa-overview': 'grid', 'sa-staff': 'shield', 'sa-settings': 'settings', 'sa-commissions': 'sliders', 'sa-integrations': 'layers', 'sa-payout-settings': 'bank', 'sa-order-policies': 'list', 'sa-security': 'lock', 'sa-health': 'activity', 'sa-bizreports': 'receipt', 'sa-policies': 'file' };
const ADMIN_GROUPS = ['Work', 'People', 'Catalog', 'Transactions', 'Money', 'Service', 'Insight'];
const SUPER_NAV = ['sa-overview', 'sa-approvals', 'sa-staff', 'sa-settings', 'sa-commissions', 'sa-integrations', 'sa-payout-settings', 'sa-order-policies', 'sa-security', 'sa-health', 'sa-bizreports', 'sa-policies'];
export const canRoute = (d, s, page) => !!ROUTES[page] && can(d, s, ROUTES[page][1]);
export const homeFor = (d, s) => isSuper(d, s) ? 'sa-overview' : 'a-overview';

export const M = ({ c, cur = 'USD', strong }) => strong ? <b className="num-i">{fmtMoney(c, cur)}</b> : <span className="num-i">{fmtMoney(c, cur)}</span>;
export const TS = ({ t }) => <span title={fmtDT(t)}>{fmtDT(t)}</span>;

function GlobalSearch() {
  const { db, staff, nav } = useApp(); const [q, setQ] = useState(''); const [open, setOpen] = useState(false); const ref = useRef();
  useEffect(() => { const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const res = useMemo(() => {
    const t = q.trim().toLowerCase(); if (t.length < 2) return [];
    const out = []; const has = s => s.toLowerCase().includes(t);
    if (can(db, staff, 'orders.view')) db.orders.filter(o => has(o.id + ' ' + o.purchaseRef + ' ' + o.snap.title)).slice(0, 4).forEach(o => out.push(['Order', o.id, o.snap.title, { page: 'a-order', id: o.id }]));
    if (can(db, staff, 'cases.view')) db.cases.filter(c => has(c.id + ' ' + c.orderId)).slice(0, 3).forEach(c => out.push(['Case', c.id, c.reason, { page: 'a-case', id: c.id }]));
    if (can(db, staff, 'users.view')) Object.values(db.users).filter(u => has(u.acct + ' ' + u.username + ' ' + u.name)).slice(0, 4).forEach(u => out.push(['User', u.acct, u.name, { page: 'a-user', id: u.id }]));
    if (can(db, staff, 'sellers.view')) Object.values(db.stores).filter(s => has(s.id + ' ' + s.name)).slice(0, 3).forEach(s => out.push(['Seller', s.name, s.status, { page: 'a-seller', id: s.id }]));
    if (can(db, staff, 'catalog.view')) db.listings.filter(l => has(l.id + ' ' + l.title)).slice(0, 3).forEach(l => out.push(['Listing', l.id, l.title, { page: 'a-product', id: l.id }]));
    if (can(db, staff, 'refunds.view')) db.refunds.filter(r => has(r.id + ' ' + r.orderId)).forEach(r => out.push(['Refund', r.id, r.status, { page: 'a-refund', id: r.id }]));
    if (can(db, staff, 'payouts.view')) db.payouts.filter(p => has(p.id)).forEach(p => out.push(['Payout', p.id, p.status, { page: 'a-payout', id: p.id }]));
    if (can(db, staff, 'support.view')) db.tickets.filter(x => has(x.id + ' ' + x.subject)).slice(0, 3).forEach(x => out.push(['Ticket', x.id, x.subject, { page: 'a-ticket', id: x.id }]));
    return out.slice(0, 12);
  }, [q, db, staff]);
  return <div className="gsearch" ref={ref}><div className="searchbox"><Icon n="search" s={16} /><input aria-label="Search records you can access" placeholder="Search orders, cases, users, sellers, refunds…" value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} /></div>
    {open && q.trim().length >= 2 && <div className="dropdown gs-dd">{res.length ? res.map(([t, id, sub, r]) => <button key={t + id} onClick={() => { setOpen(false); setQ(''); nav(r); }}><Badge tone="muted">{t}</Badge><b className="small">{id}</b><span className="xs muted trunc">{sub}</span></button>) : <p className="muted small pad-s">No records you can access match “{q}”.</p>}</div>}</div>;
}

function NotesDrawer({ onClose }) {
  const { db, staff, nav, perform, more, loadMore } = useApp(); const [type, setType] = useState('');
  const mine = db.staffNotes.filter(n => n.staffId === staff.id); const types = [...new Set(mine.map(n => n.type))];
  const rows = mine.filter(n => !type || n.type === type);
  return <div className="drawer-bg" onClick={onClose}><aside className="drawer right notes-drawer" onClick={e => e.stopPropagation()} aria-label="Staff notifications">
    <div className="drawer-h"><b>Notifications</b><button className="iconbtn" aria-label="Close" onClick={onClose}><Icon n="x" /></button></div>
    <div className="row-gap"><select aria-label="Filter by type" value={type} onChange={e => setType(e.target.value)}><option value="">All types</option>{types.map(t => <option key={t}>{t}</option>)}</select>
      <button className="linkbtn small" onClick={() => perform('markStaffNotesRead', {}, d => markStaffNotesRead(d, d.staff[staff.id]))}>Mark all as read</button></div>
    {rows.length ? <ul className="nlist">{rows.map(n => <li key={n.id} className={n.read ? '' : 'unread'}><button onClick={() => { perform('markStaffNotesRead', { id: n.id }, d => markStaffNotesRead(d, d.staff[staff.id], n.id)); onClose(); nav(n.route); }}><span className="n-dot" /><span className="n-text"><Badge tone="muted">{n.type}</Badge> {n.text}</span><span className="muted xs">{rel(n.at)}</span></button></li>)}</ul>
      : <Empty icon="bell" title="No notifications">Assignments, approvals and provider failures for your role appear here.</Empty>}
    {more.staffNotes && <div className="row-gap center" style={{ padding: '12px 0' }}><Btn size="sm" onClick={() => loadMore('staffNotes')}>Load older</Btn></div>}
  </aside></div>;
}

export function AdminShell({ children }) {
  const { db, staff, route, nav, update, toast, openPreview, perform, signOut, demoEnv } = useApp(); const [drawer, setDrawer] = useState(false); const [notes, setNotes] = useState(false); const [pm, setPm] = useState(false); const [security, setSecurity] = useState(false);
  const role = roleOf(db, staff); const sup = isSuper(db, staff);
  const cur = ROUTES[route.page]; const active = cur?.[3] || route.page;
  const unread = db.staffNotes.filter(n => n.staffId === staff.id && !n.read).length;
  const counts = {
    'sa-approvals': db.approvals.filter(a => a.status === 'Pending').length, 'a-cases': db.cases.filter(c => !['Resolved', 'Closed'].includes(c.status)).length,
    'a-refunds': db.refunds.filter(r => ['Requested', 'Approved', 'Failed', 'Reconciliation required'].includes(r.status)).length, 'a-payouts': db.payouts.filter(p => ['Awaiting approval', 'Approved', 'Reconciliation required'].includes(p.status)).length,
    'a-support': db.tickets.filter(t => !['Resolved', 'Closed'].includes(t.status)).length, 'a-sellers': db.verifications.filter(v => v.state === 'Verification pending').length, 'a-products': db.listings.filter(l => l.availability === 'Pending review').length,
  };
  const link = id => can(db, staff, ROUTES[id][1]) && <button key={id} className={'side-link' + (active === id ? ' on' : '')} aria-current={active === id ? 'page' : undefined} onClick={() => { setDrawer(false); nav({ page: id }); }}><Icon n={NAV_ICON[id] || 'box'} s={17} /><span>{ROUTES[id][0]}</span>{counts[id] > 0 && <span className="side-n">{counts[id]}</span>}</button>;
  const adminIds = Object.keys(ROUTES).filter(id => id.startsWith('a-') && !ROUTES[id][3] && id !== 'a-recon').concat(['sa-approvals']);
  const side = <nav className="side-nav" aria-label="Management navigation">
    <div className="side-mode"><span className="xs muted">{sup ? 'Super Admin' : 'Admin'} panel</span><b className="small">{staff.name}</b><span className="xs muted">{staff.id} · {role.name}</span></div>
    {sup && <><div className="side-group">Super Admin</div>{SUPER_NAV.map(link)}<div className="side-group">Operations</div>{adminIds.filter(id => id !== 'sa-approvals').map(link)}</>}
    {!sup && ADMIN_GROUPS.map(g => { const ids = adminIds.filter(id => ROUTES[id][2] === g && can(db, staff, ROUTES[id][1])); return ids.length ? <div key={g}><div className="side-group">{g}</div>{ids.map(link)}</div> : null; })}
    <div className="side-sep" />
    <button className="side-link" onClick={() => openPreview('buyer')}><Icon n="eye" s={17} /><span>Buyer preview</span></button>
    <button className="side-link" onClick={() => openPreview('seller')}><Icon n="eye" s={17} /><span>Seller preview</span></button>
    <button className="side-link" onClick={() => openPreview('site')}><Icon n="home" s={17} /><span>Website preview</span></button>
  </nav>;
  const crumbs = [cur?.[2], cur?.[3] && ROUTES[cur[3]]?.[0], cur ? (route.id ? `${cur[0]} ${route.id}` : cur[0]) : 'Not found'].filter(Boolean);
  return <div className="panel admin">
    <header className="topbar"><div className="tb-row">
      <button className="iconbtn only-m" aria-label="Open navigation" onClick={() => setDrawer(true)}><Icon n="menu" /></button>
      <Logo onClick={() => nav({ page: homeFor(db, staff) })} />
      {demoEnv && <span className="demo-env" title="Every provider, identity, email and money action here is simulated">Demo environment</span>}
      <div className="tb-search only-d"><GlobalSearch /></div>
      <nav className="ph-actions" aria-label="Staff">
        <button className="iconbtn" aria-label={`Notifications, ${unread} unread`} onClick={() => setNotes(true)}><Icon n="bell" />{unread > 0 && <span className="count">{unread}</span>}</button>
        <div className="menu-wrap"><button className="profile-btn" aria-expanded={pm} onClick={() => setPm(!pm)} aria-label="Staff profile"><Avatar name={staff.name} hue={(staff.id.charCodeAt(0) * 41) % 360} size={30} /><Icon n="down" s={14} /></button>
          {pm && <div className="dropdown" role="menu"><div className="dd-user"><Avatar name={staff.name} hue={(staff.id.charCodeAt(0) * 41) % 360} size={38} /><div><b>{staff.name}</b><span className="muted xs block">{staff.id} · {staff.email}</span><span className="xs">{role.name}</span></div></div>
            {staff.roles.length > 1 && <><span className="xs muted pad-s">Active role (same account)</span>{staff.roles.map(r => <button key={r} role="menuitem" className={r === staff.activeRole ? 'accent' : ''} onClick={() => { setPm(false); perform('switchRole', { role: r }, d => switchRole(d, d.staff[staff.id], r), 'Active role: ' + db.roles[r].name).then(x => x.ok && nav({ page: homeFor({ ...db, staff: { ...db.staff } }, { ...staff, activeRole: r }) })); }}><Icon n="swap" s={16} />{db.roles[r].name}</button>)}</>}
            <button role="menuitem" onClick={() => { setPm(false); nav({ page: 'home' }); }}><Icon n="home" s={16} />View marketplace</button>{apiEnabled && <button role="menuitem" onClick={() => { setPm(false); setSecurity(true); }}><Icon n="lock" s={16} />Sign-in security</button>}<button role="menuitem" onClick={() => { setPm(false); signOut(); }}><Icon n="logout" s={16} />Log out</button></div>}</div>
      </nav>
    </div></header>
    <div className="panel-body">
      <aside className="sidebar only-d">{side}</aside>
      <main className="panel-main" id="main"><nav className="crumbs" aria-label="Breadcrumb">{crumbs.map((c, i) => <span key={i} className="row-gap">{i > 0 && <Icon n="right" s={12} />}{i === crumbs.length - 1 ? <b>{c}</b> : c}</span>)}</nav>{children}</main>
    </div>
    {drawer && <div className="drawer-bg" onClick={() => setDrawer(false)}><aside className="drawer" onClick={e => e.stopPropagation()}><div className="drawer-h"><Logo onClick={() => nav({ page: homeFor(db, staff) })} /><button className="iconbtn" aria-label="Close navigation" onClick={() => setDrawer(false)}><Icon n="x" /></button></div><GlobalSearch />{side}</aside></div>}
    {notes && <NotesDrawer onClose={() => setNotes(false)} />}
    {security && <StaffSecurity onClose={() => setSecurity(false)} />}
  </div>;
}

// API mode: a staff member's own sign-in settings (password and two-factor sign-in).
function StaffSecurity({ onClose }) {
  const { staff, refresh, toast } = useApp(); const [pw, setPw] = useState({ cur: '', a: '', b: '' }); const [err, setErr] = useState('');
  async function changePassword() {
    if (!pw.cur) return setErr('Enter your current password.'); if (pw.a.length < 8 || !/\d/.test(pw.a)) return setErr('New password needs 8 characters including a number.'); if (pw.a !== pw.b) return setErr('New passwords do not match.');
    setErr(''); try { await api.changePassword(pw.cur, pw.a); setPw({ cur: '', a: '', b: '' }); toast('Password changed. Other sessions were signed out'); } catch (x) { setErr(x.message); }
  }
  return <Modal wide title="Sign-in security" onClose={onClose}>
    <h3 className="sub-h" style={{ marginTop: 0 }}>Two-factor sign-in <Badge tone={staff.twoFA ? 'ok' : 'muted'}>{staff.twoFA ? 'On' : 'Off'}</Badge></h3>
    <TwoFactorPanel on={staff.twoFA} onChanged={refresh} />
    <h3 className="sub-h">Password</h3>
    <div className="form-grid"><Field label="Current password"><input type="password" autoComplete="current-password" value={pw.cur} onChange={e => setPw({ ...pw, cur: e.target.value })} /></Field><span />
      <Field label="New password" hint="At least 8 characters including a number"><input type="password" autoComplete="new-password" value={pw.a} onChange={e => setPw({ ...pw, a: e.target.value })} /></Field>
      <Field label="Confirm new password"><input type="password" autoComplete="new-password" value={pw.b} onChange={e => setPw({ ...pw, b: e.target.value })} /></Field></div>
    {err && <p className="ferr">{err}</p>}
    <div><Btn onClick={changePassword}>Change password</Btn></div>
  </Modal>;
}

export function Denied({ page }) {
  const { db, staff, nav } = useApp();
  return <ErrorState title="Access denied" onRetry={null}>{roleOf(db, staff)?.name} does not have access to {ROUTES[page]?.[0] || 'this page'}. No record data was loaded. <button className="linkbtn" onClick={() => nav({ page: homeFor(db, staff) })}>Go to your overview</button></ErrorState>;
}
// loading and simulated failure states for every management page
export function useGate(deps) {
  const { db, update } = useApp(); const [loading, setLoading] = useState(true);
  useEffect(() => { setLoading(true); const t = setTimeout(() => setLoading(false), 220); return () => clearTimeout(t); }, deps);
  if (loading) return <div className="skel-page" aria-busy="true" aria-label="Loading"><div className="sk sk-line w40" /><div className="sk sk-block" /><div className="sk sk-block" /></div>;
  if (db.scenario.pageError) return <ErrorState title="This page could not load" onRetry={() => update(d => { d.scenario.pageError = false; })}>Simulated server error from the demo toolbar. Your data is unchanged. Retry to load it again.</ErrorState>;
  return null;
}

export function PageTitle({ title, sub, actions }) {
  return <div className="page-head"><div className="ph-line"><div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>{actions && <div className="ph-acts">{actions}</div>}</div></div>;
}

// ---------- generic list with search, filters, sort, pagination and preserved state
export function AList({ id, rows, cols, search, filters = [], sorts = [], onOpen, empty, bulk, pageSize = 8, toolbar }) {
  const { listState } = useApp();
  const st = listState.current[id] || (listState.current[id] = { q: '', f: {}, sort: sorts[0]?.id || '', page: 0, sel: [] });
  const [, force] = useState(0); const set = p => { Object.assign(st, p); force(x => x + 1); };
  let r = rows.filter(x => (!st.q || search(x).toLowerCase().includes(st.q.toLowerCase())) && filters.every(f => !st.f[f.k] || f.test(x, st.f[f.k])));
  const s = sorts.find(x => x.id === st.sort); if (s) r = r.slice().sort(s.fn);
  const pages = Math.max(1, Math.ceil(r.length / pageSize)); const page = Math.min(st.page, pages - 1);
  const shown = r.slice(page * pageSize, page * pageSize + pageSize);
  const active = st.q || Object.values(st.f).some(Boolean);
  const selCol = bulk ? [{ k: '_sel', label: '', cls: 'chk', render: x => <input type="checkbox" aria-label={'Select ' + x.id} checked={st.sel.includes(x.id)} onChange={e => set({ sel: e.target.checked ? [...st.sel, x.id] : st.sel.filter(y => y !== x.id) })} /> }] : [];
  const openCol = onOpen ? [{ k: '_open', label: '', render: x => <Btn size="sm" onClick={() => onOpen(x)}>Open</Btn> }] : [];
  return <div className="alist">
    <div className="toolbar"><div className="searchbox"><Icon n="search" s={16} /><input aria-label="Search this list" placeholder="Search" value={st.q} onChange={e => set({ q: e.target.value, page: 0 })} /></div>
      {filters.map(f => <select key={f.k} aria-label={f.label} value={st.f[f.k] || ''} onChange={e => set({ f: { ...st.f, [f.k]: e.target.value }, page: 0 })}><option value="">{f.label}: all</option>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>)}
      {sorts.length > 1 && <select aria-label="Sort" value={st.sort} onChange={e => set({ sort: e.target.value })}>{sorts.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select>}
      {toolbar}
      <span className="muted small rc">{r.length} result{r.length === 1 ? '' : 's'}</span></div>
    {bulk && st.sel.length > 0 && <div className="bulkbar"><b>{st.sel.length} selected</b>{bulk.map(b => <Btn key={b.label} size="sm" onClick={() => { b.run(st.sel); set({ sel: [] }); }}>{b.label}</Btn>)}<button className="linkbtn" onClick={() => set({ sel: [] })}>Clear</button></div>}
    {!rows.length ? (empty || <Empty title="No records yet" />) : !r.length ? <Empty icon="search" title="No records match these filters" action={<Btn onClick={() => set({ q: '', f: {}, page: 0 })}>Clear filters</Btn>}>Change the search or filters.</Empty> :
      <Table rows={shown} cols={[...selCol, ...cols, ...openCol]} onRow={onOpen} />}
    {pages > 1 && <div className="pager"><Btn size="sm" disabled={page === 0} onClick={() => set({ page: page - 1 })}>Previous</Btn><span className="small">Page {page + 1} of {pages}</span><Btn size="sm" disabled={page >= pages - 1} onClick={() => set({ page: page + 1 })}>Next</Btn></div>}
    {active && <p className="xs muted">Filters are kept when you open a record and come back.</p>}
  </div>;
}

// ---------- detail layout
export function DetailHead({ refId, title, badges, amounts, actions, back }) {
  const { nav } = useApp();
  return <div className="dhead">{back && <button className="back" onClick={() => nav(back.route)}><Icon n="left" s={15} />{back.label}</button>}
    <div className="ph-line"><div><span className="xs muted mono">{refId}</span><h1 className="row-gap wrap-gap">{title}</h1><div className="badges">{badges}</div></div>
      {amounts && <dl className="d-amounts">{amounts.filter(Boolean).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}</div>
    {actions && <div className="d-actions">{actions}</div>}</div>;
}
export function DTabs({ tabs }) {
  const [t, setT] = useState(tabs[0].id);
  return <><div className="tabs" role="tablist">{tabs.map(x => <button key={x.id} role="tab" aria-selected={t === x.id} className={t === x.id ? 'on' : ''} onClick={() => setT(x.id)}>{x.label}{x.count != null && <span className="tab-n">{x.count}</span>}</button>)}</div>
    <div role="tabpanel">{tabs.find(x => x.id === t).body}</div></>;
}
export function DetailGrid({ main, side }) { return <div className="dgrid"><div className="stack">{main}</div><aside className="stack">{side}</aside></div>; }

// assignment, priority, deadline and internal notes (never shown to customers)
export function SidePanel({ k, label, deadline, eligiblePerm }) {
  const { db, staff, perform } = useApp(); const a = assignment(db, k); const notes = db.notes[k] || [];
  const [note, setNote] = useState(''); const [pri, setPri] = useState(null); const [why, setWhy] = useState('');
  const canAssign = can(db, staff, 'queue.assign'); const eligible = Object.values(db.staff).filter(s => s.active && (!eligiblePerm || s.roles.some(r => db.roles[r].perms.includes(eligiblePerm))));
  const mayClaim = !a.assigneeId && (!eligiblePerm || can(db, staff, eligiblePerm));
  return <Section title="Work">
    <KV items={[['Assigned', a.assigneeId ? db.staff[a.assigneeId]?.name + (db.staff[a.assigneeId]?.active ? '' : ' (inactive)') : <span className="muted">Unassigned</span>], ['Priority', <Badge tone={{ Urgent: 'bad', High: 'warn', Normal: 'muted', Low: 'muted' }[a.priority]}>{a.priority}</Badge>], deadline && ['Deadline', <span className={deadline < now() ? 'bad-t' : ''}>{fmtDT(deadline)} ({rel(deadline)})</span>]]} />
    <div className="row-gap">
      {mayClaim && <Btn size="sm" onClick={() => perform('claim', { key: k }, d => setAssignee(d, d.staff[staff.id], k, staff.id, 'Claimed', label), 'Assigned to you')}>Claim</Btn>}
      {canAssign && <select aria-label="Reassign" value="" onChange={e => { if (e.target.value) perform('assign', { key: k, staffId: e.target.value === '-' ? null : e.target.value, reason: 'Reassigned' }, d => setAssignee(d, d.staff[staff.id], k, e.target.value === '-' ? null : e.target.value, 'Reassigned', label), 'Assignment updated'); }}><option value="">Reassign…</option><option value="-">Unassigned</option>{eligible.map(s => <option key={s.id} value={s.id}>{s.name} ({db.roles[s.activeRole].name})</option>)}</select>}
      {!canAssign && !mayClaim && <span className="xs muted">Reassignment needs the Assign permission.</span>}
    </div>
    <div className="inline-form"><select aria-label="Priority" value={pri || a.priority} onChange={e => setPri(e.target.value)}>{['Low', 'Normal', 'High', 'Urgent'].map(p => <option key={p}>{p}</option>)}</select>
      {pri && pri !== a.priority && <><input aria-label="Reason for priority change" placeholder="Reason (required)" value={why} onChange={e => setWhy(e.target.value)} /><Btn size="sm" disabled={!why.trim() || !can(db, staff, 'queue.view')} onClick={async () => { const r = await perform('setPriority', { key: k, priority: pri, reason: why, label }, d => setPriority(d, d.staff[staff.id], k, pri, why, label), 'Priority updated'); if (r.ok) { setPri(null); setWhy(''); } }}>Save</Btn></>}</div>
    <div className="internal"><span className="int-label"><Icon n="lock" s={13} /> Internal notes · staff only</span>
      {notes.map((n, i) => <div key={i} className="int-note"><b className="xs">{n.by}</b> <span className="xs muted">{fmtDT(n.at)}</span><p className="small">{n.text}</p></div>)}
      <textarea rows="2" aria-label="Internal note" placeholder="Visible to staff only" value={note} onChange={e => setNote(e.target.value)} />
      <Btn size="sm" disabled={!note.trim()} onClick={async () => { const r = await perform('internalNote', { key: k, text: note.trim(), label }, d => addNote(d, d.staff[staff.id], k, note.trim(), label), 'Note added'); if (r.ok) setNote(''); }}>Add internal note</Btn></div>
  </Section>;
}

// a dialog that requires a reason, keeps values after validation failure and only closes on success
export function ReasonDialog({ title, intro, fields = [], confirm = 'Confirm', danger, reasonLabel = 'Reason', onSubmit, onClose, children }) {
  const { withInline } = useApp();
  const [v, setV] = useState(Object.fromEntries(fields.map(f => [f.k, f.initial ?? '']).concat([['reason', '']]))); const [err, setErr] = useState(''); const [ferr, setFerr] = useState({}); const [busy, setBusy] = useState(false);
  async function go() {
    for (const f of fields) if (f.required && !String(v[f.k]).trim()) return setFerr({ [f.k]: `${f.label} is required.` });
    if (!v.reason.trim()) return setFerr({ reason: 'Enter a reason. It is recorded in the audit history.' });
    setErr(''); setFerr({}); setBusy(true);
    // Refusals are shown here rather than as a toast; a field error goes under its field.
    const r = await withInline(() => onSubmit(v)); setBusy(false);
    if (r && r.ok === false) { const f = r.error.field; if (f && (f === 'reason' || fields.some(x => x.k === f))) setFerr({ [f]: r.error.message }); else setErr(r.error.message); }
    else onClose();
  }
  return <Modal title={title} onClose={onClose} footer={<><Btn v="ghost" onClick={onClose}>Cancel</Btn><Btn v={danger ? 'danger' : 'primary'} disabled={busy} onClick={go}>{busy ? 'Saving…' : confirm}</Btn></>}>
    {intro && <p className="small">{intro}</p>}{children}
    {fields.map(f => <Field key={f.k} label={f.label} required={f.required} hint={f.hint} error={ferr[f.k]}>{f.type === 'select' ? <select value={v[f.k]} onChange={e => setV({ ...v, [f.k]: e.target.value })}>{f.options.map(o => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o}>{o}</option>)}</select> : f.type === 'textarea' ? <textarea rows="3" value={v[f.k]} onChange={e => setV({ ...v, [f.k]: e.target.value })} /> : <input type={f.type || 'text'} value={v[f.k]} onChange={e => setV({ ...v, [f.k]: e.target.value })} />}</Field>)}
    <Field label={reasonLabel} required hint="Recorded in the audit history" error={ferr.reason}><textarea rows="2" value={v.reason} onChange={e => setV({ ...v, reason: e.target.value })} /></Field>
    {err && <p className="ferr" role="alert">{err}</p>}
  </Modal>;
}

// sensitive evidence opens only with permission and a recorded reason
export function Evidence({ perm, label, k, children }) {
  const { db, staff, perform, evidenceOpen } = useApp(); const [ask, setAsk] = useState(false);
  const open = evidenceOpen.current.has(k);
  if (!can(db, staff, perm)) return <div className="ev-locked"><Icon n="lock" s={16} /><span className="small">{label}: your role cannot open this evidence. Summaries only.</span></div>;
  if (open) return <div className="ev-open"><span className="int-label"><Icon n="eye" s={13} /> Access recorded in audit history</span>{children}</div>;
  return <div className="ev-locked"><Icon n="lock" s={16} /><span className="small">{label} is hidden by default.</span><Btn size="sm" onClick={() => setAsk(true)}>Open with reason</Btn>
    {ask && <ReasonDialog title={`Open ${label}`} intro="Viewing sensitive evidence creates an audit entry with your reason." confirm="Open evidence" onClose={() => setAsk(false)} onSubmit={async v => { const r = await perform('logEvidenceView', { key: k, reason: v.reason }, d => logEvidenceView(d, d.staff[staff.id], k, v.reason)); if (r.ok) evidenceOpen.current.add(k); return r; }} />}</div>;
}

export function AuditTrail({ objects }) {
  const { db, staff } = useApp();
  const rows = db.audit.filter(a => objects.includes(a.object));
  if (!rows.length) return <p className="muted small">No administrative actions recorded yet.</p>;
  return <ol className="timeline">{rows.map(a => <li key={a.id} className={'tl-' + (a.outcome === 'Success' ? 'info' : 'warn')}><span className="tl-dot" /><div><div className="tl-text"><b>{a.action}</b>{a.reason && <> · {a.reason}</>}</div>
    <div className="muted xs">{a.actor} ({a.role}) · {fmtDT(a.at)}{a.before || a.after ? ` · ${a.before || '—'} → ${a.after || '—'}` : ''}{a.approval ? ` · ${a.approval}` : ''}{a.outcome !== 'Success' ? ` · ${a.outcome}` : ''}</div></div></li>)}</ol>;
}

// export preview: the artifact cannot start downloads, so the CSV is shown as copyable text
export function ExportButton({ name, rows, cols, sensitive }) {
  const { db, staff, perform, toast } = useApp(); const [open, setOpen] = useState(false); const [csv, setCsv] = useState('');
  if (!can(db, staff, 'reports.export')) return <Btn size="sm" icon="download" disabled title="Your role cannot export">Export</Btn>;
  const esc = s => { s = String(s ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const build = () => [cols.map(c => esc(c[0])).join(','), ...rows.map(r => cols.map(c => esc(c[1](r))).join(','))].join('\n');
  return <><Btn size="sm" icon="download" onClick={() => setOpen(true)}>Export</Btn>
    {open && <Modal wide title={`Export ${name}`} onClose={() => { setOpen(false); setCsv(''); }} footer={<><Btn v="ghost" onClick={() => { setOpen(false); setCsv(''); }}>Close</Btn>{!csv && <Btn v="primary" onClick={async () => { const r = await perform('logExport', { name, rows: rows.length, columns: cols.map(c => c[0]), sensitive: !!sensitive }, d => logExport(d, d.staff[staff.id], name, rows.length, cols.map(c => c[0]), sensitive)); if (r.ok) setCsv(build()); }}>Generate CSV</Btn>}</>}>
      <KV items={[['Rows', rows.length], ['Columns', cols.map(c => c[0]).join(', ')], ['Scope', 'Current filters, records your role can view'], ['Excluded', 'Secrets, full payout credentials, identity documents, private messages']]} />
      {csv ? <><Notice tone="info">This sandbox cannot start file downloads. Copy the CSV below; it contains exactly the previewed rows.</Notice><textarea className="csv" readOnly rows="10" value={csv} aria-label="CSV export" /><Btn size="sm" icon="copy" onClick={() => { navigator.clipboard?.writeText(csv).then(() => toast('CSV copied'), () => toast('Select the text and copy it manually', 'warn')); }}>Copy CSV</Btn></> : <p className="small muted">Generating records an audit entry.</p>}
    </Modal>}</>;
}

// ---------- read-only customer impact previews
export function PreviewDrawer({ kind, onClose }) {
  const { db } = useApp();
  const buyers = Object.values(db.users).filter(u => !u.storeId); const stores = Object.values(db.stores);
  const [sel, setSel] = useState(kind === 'buyer' ? 'u_mira' : kind === 'seller' ? 'st_atlas' : null);
  return <div className="drawer-bg" onClick={onClose}><aside className="drawer right preview" onClick={e => e.stopPropagation()} aria-label="Customer preview">
    <div className="drawer-h"><b>{kind === 'buyer' ? 'Buyer preview' : kind === 'seller' ? 'Seller preview' : 'Website preview'}</b><button className="iconbtn" aria-label="Close preview" onClick={onClose}><Icon n="x" /></button></div>
    <Notice tone="info">Read-only. Shows what the customer sees from the same records. Staff cannot act as the customer here.</Notice>
    {kind === 'buyer' && <><select aria-label="Buyer" value={sel} onChange={e => setSel(e.target.value)}>{buyers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.acct})</option>)}</select><BuyerView uid={sel} /></>}
    {kind === 'seller' && <><select aria-label="Seller" value={sel} onChange={e => setSel(e.target.value)}>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><SellerView sid={sel} /></>}
    {kind === 'site' && <SiteView />}
  </aside></div>;
}
function BuyerView({ uid }) {
  const { db } = useApp(); const u = db.users[uid];
  const orders = db.orders.filter(o => o.buyerId === uid); const cases = db.cases.filter(c => c.buyerId === uid); const notes = db.notifications.filter(n => n.userId === uid && n.panel === 'buyer').slice(0, 6);
  const rs = (u.restrictions || []).filter(r => r.active);
  return <div className="pv">
    {rs.map(r => <Notice key={r.id} tone="warn" title={`Restriction: ${r.scope}`}>{r.notice}</Notice>)}
    <h3>Orders</h3>{orders.length ? orders.map(o => <div key={o.id} className="pv-row"><b className="small">{o.id}</b><Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>{o.refund && <Badge tone="info">Refund {o.refund.state}</Badge>}<span className="xs muted">{o.snap.title}</span></div>) : <p className="muted small">No orders.</p>}
    <h3>Cases</h3>{cases.length ? cases.map(c => <div key={c.id} className="pv-row"><b className="small">{c.id}</b><Badge tone="muted">{c.status}</Badge>{c.remedy && <span className="xs">Remedy: {c.remedy.type} · {c.remedy.state}</span>}{(c.staffMsgs || []).slice(-1).map((m, i) => <span key={i} className="xs muted block">Support: {m.text}</span>)}</div>) : <p className="muted small">No cases.</p>}
    <h3>Notifications</h3>{notes.map(n => <div key={n.id} className="pv-row"><span className="small">{n.text}</span><span className="xs muted">{rel(n.at)} · email {n.delivery || 'Delivered'}</span></div>)}
  </div>;
}
function SellerView({ sid }) {
  const { db } = useApp(); const st = db.stores[sid]; const b = storeBuckets(db, sid);
  const ls = db.listings.filter(l => l.storeId === sid); const pays = db.payouts.filter(p => p.storeId === sid); const notes = db.notifications.filter(n => n.userId === st.ownerId && n.panel === 'seller').slice(0, 6);
  const v = db.verifications.find(x => x.storeId === sid);
  return <div className="pv">
    <div className="pv-row"><b>{st.name}</b><Badge tone={st.status === 'Active' ? 'ok' : 'warn'}>{st.status}</Badge>{st.paused && <Badge tone="warn">Sales paused</Badge>}</div>
    {v && v.state !== 'Approved' && <Notice tone="warn" title={`Verification: ${v.state}`}>{v.missing?.length ? 'Requested: ' + v.missing.join(', ') : 'Under review.'}</Notice>}
    <h3>Balance</h3><div className="pv-bal">{[['Pending', b.pending], ['On hold', b.held], ['Available', b.available], ['Payout reserved', b.reserved], ['Paid out', b.paidOut]].map(([k, c]) => <div key={k}><span className="xs muted">{k}</span><b>{fmtMoney(c)}</b></div>)}</div>
    <h3>Listings</h3>{ls.map(l => <div key={l.id} className="pv-row"><span className="small trunc">{l.title}</span><Badge tone="muted">{l.availability}</Badge>{l.reviewNote && ['Changes requested', 'Rejected'].includes(l.availability) && <span className="xs muted block">{l.reviewNote}</span>}</div>)}
    <h3>Payouts</h3>{pays.length ? pays.map(p => <div key={p.id} className="pv-row"><b className="small">{p.id}</b><span className="small">{fmtMoney(p.amountC)}</span><Badge tone="muted">{p.status}</Badge></div>) : <p className="muted small">No payouts.</p>}
    <h3>Notifications</h3>{notes.map(n => <div key={n.id} className="pv-row"><span className="small">{n.text}</span><span className="xs muted">{rel(n.at)}</span></div>)}
  </div>;
}
function SiteView() {
  const { db } = useApp(); const s = db.settings.current;
  const banners = db.content.banners.filter(b => b.state === 'Active' && b.start <= now() && b.end >= now()).sort((a, b) => a.order - b.order);
  const terms = db.policies.find(p => p.id === 'POL-terms').versions.find(v => v.state === 'Published');
  return <div className="pv"><h3>Homepage banners</h3>{banners.length ? banners.map(b => <div key={b.id} className="banner-pv" style={{ '--h': b.hue }}><b>{b.title}</b><span className="small">{b.sub}</span></div>) : <p className="muted small">No active banners.</p>}
    <h3>Published Terms</h3><p className="small">v{terms?.v} · {terms?.content}</p>
    <h3>Features</h3><KV items={Object.entries(s.features).map(([k, v]) => [k, v ? 'On' : 'Off'])} /></div>;
}
