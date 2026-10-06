import React from 'react';
import { now } from '@crateline/domain/clock.js';
import { CATEGORIES, SUBS, COMMISSION, RELEASE_DAYS, MIN_PAYOUT, D, round2 } from '@crateline/domain/data.js';
import { activeRestriction, money, fmtN, fmtDate, fmtDT, rel, days, storeStats, listingStats, startPrice, isOverdue, openCase, sellerGroup, deliveredQty, earnings, notify, newId, STATUS_LABEL, convFor } from '@crateline/domain/logic.js';
import { Icon, Btn, Badge, Avatar, Stars, ProductArt, Modal, Confirm, Empty, ErrorState, Field, Notice, Sim, Seg, Tabs, Progress, Timeline, FileChip, FilePicker, Table, Stat, Section, KV, StatusBadge, Toggle, CASE_TONE, useApp } from './ui.jsx';
import { PageHead } from './shell.jsx';
import { Deliveries, ReasonModal } from './buyer.jsx';
import { apiEnabled, api } from './api.js';
import * as SL from '@crateline/domain/seller.js';
import * as A from '@crateline/domain/actions.js';
import { fmtMoney, toC, pct, orderBuckets, requestPayout, cancelPayout, DomainError } from '@crateline/domain/fin.js';
const { useState, useEffect, useMemo } = React;

// ---------- Onboarding
const STEPS = ['Personal details', 'Store', 'Identity', 'Review', 'Status'];
export function Onboarding() {
  const { db, me, update, nav, switchMode, toast, perform } = useApp();
  const st = me.storeId && db.stores[me.storeId];
  // Draft progress: on the server in demo mode; in API mode only in this browser (it holds identity details).
  const DRAFT = 'crateline-onboarding-' + me.id;
  const saved = apiEnabled ? (() => { try { return JSON.parse(localStorage.getItem(DRAFT)); } catch { return null; } })() : db.onboarding?.[me.id];
  const [step, setStep] = useState(st ? 4 : saved?.step || 0);
  const [v, setV] = useState(saved?.v || { name: me.name, email: me.email, dob: '', code: '', codeSent: false, verified: false, store: '', cat: 'data', types: [], desc: '', country: 'Bangladesh', city: '', addr: '', doc: 'National ID card', docs: [] });
  const [err, setErr] = useState({});
  const s = k => e => setV({ ...v, [k]: e.target.value });
  const persist = (nv, ns) => { if (apiEnabled) { try { localStorage.setItem(DRAFT, JSON.stringify({ v: { ...nv, docs: [] }, step: ns })); } catch { } return; } update(d => { d.onboarding = d.onboarding || {}; d.onboarding[me.id] = { v: nv, step: ns }; }); };
  function next() {
    const e = {};
    if (step === 0) { if (v.name.trim().length < 2) e.name = 'Enter your full legal name.'; if (!apiEnabled && !v.verified) e.code = 'Verify your email to continue.'; if (!v.dob) e.dob = 'Enter your date of birth.'; else if ((now() - new Date(v.dob)) / (365.25 * D) < 18) e.dob = 'Sellers must be 18 or older (placeholder rule, to be confirmed).'; }
    if (step === 1) { if (v.store.trim().length < 3) e.store = 'Store name needs at least 3 characters.'; else if (Object.values(db.stores).some(x => x.name.toLowerCase() === v.store.trim().toLowerCase())) e.store = 'That store name is taken.'; if (!v.types.length) e.types = 'Choose at least one product type.'; if (v.desc.trim().length < 20) e.desc = 'Describe your store in at least 20 characters.'; if (!v.city.trim() || !v.addr.trim()) e.addr = 'Enter your business address.'; }
    if (step === 2) { if (v.docs.length < 1) e.docs = 'Add your identity document.'; }
    setErr(e); if (Object.keys(e).length) return;
    setStep(step + 1); persist(v, step + 1);
  }
  async function submit() {
    const r = await perform('applyAsSeller', v, d => ({ storeId: SL.applyAsSeller(d, d.users[me.id], v) }), 'Seller application submitted');
    if (!r.ok) return;
    try { localStorage.removeItem(DRAFT); } catch { }
    setStep(4);
  }
  const store = me.storeId && db.stores[me.storeId];
  return <div className="onb">
    <PageHead title={store ? 'Seller verification' : 'Become a seller'} sub="One account for buying and selling. Your purchase history stays where it is." />
    <ol className="stepper-bar">{STEPS.map((x, i) => <li key={x} className={i < step ? 'done' : i === step ? 'cur' : ''}><span>{i < step ? <Icon n="check" s={13} /> : i + 1}</span>{x}</li>)}</ol>
    <div className="card pad onb-card">
      {step === 0 && <><h2>Personal details</h2>
        <div className="form-grid"><Field label="Full legal name" required error={err.name}><input value={v.name} onChange={s('name')} /></Field><Field label="Date of birth" required error={err.dob}><input type="date" value={v.dob} onChange={s('dob')} /></Field></div>
        <Field label="Email" required hint="We send a code to confirm you own this address."><input type="email" value={v.email} disabled={v.verified} onChange={s('email')} /></Field>
        {apiEnabled ? <Notice tone={me.emailVerified ? 'ok' : 'info'}>{me.emailVerified ? 'Your account email is verified.' : 'Email verification is not available yet. The marketplace team sees that your email is unverified when reviewing the application.'}</Notice>
          : v.verified ? <Notice tone="ok">Email verified.</Notice> : <div className="inline-form">
          <Btn size="sm" onClick={() => setV({ ...v, codeSent: true })}>{v.codeSent ? 'Resend code' : 'Send code'}</Btn>
          {v.codeSent && <><Field label="Verification code" error={err.code}><input inputMode="numeric" maxLength="6" value={v.code} onChange={s('code')} /></Field><span className="xs">Demo code: <b>482913</b> <Sim /></span>
            <Btn size="sm" v="primary" onClick={() => v.code === '482913' ? setV({ ...v, verified: true }) : setErr({ code: 'Incorrect code. Check it or resend.' })}>Verify</Btn></>}
          {!v.codeSent && err.code && <span className="ferr">{err.code}</span>}</div>}
      </>}
      {step === 1 && <><h2>Store details</h2>
        <div className="form-grid"><Field label="Store name" required error={err.store} hint="Shown publicly and used in your store URL"><input value={v.store} onChange={s('store')} /></Field>
          <Field label="Main category" required><select value={v.cat} onChange={s('cat')}>{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field></div>
        <fieldset className={'types' + (err.types ? ' has-err' : '')}><legend>Product types <span className="req">*</span></legend>{CATEGORIES.find(c => c.id === v.cat).subs.map(x => <label key={x.id} className="radio"><input type="checkbox" checked={v.types.includes(x.id)} onChange={e => setV({ ...v, types: e.target.checked ? [...v.types, x.id] : v.types.filter(t => t !== x.id) })} />{x.name}</label>)}{err.types && <span className="ferr">{err.types}</span>}</fieldset>
        <Field label="Store description" required error={err.desc}><textarea rows="3" value={v.desc} onChange={s('desc')} /></Field>
        <div className="form-grid"><Field label="Country"><select value={v.country} onChange={s('country')}>{['Bangladesh', 'United States', 'United Kingdom', 'United Arab Emirates', 'Saudi Arabia', 'India'].map(x => <option key={x}>{x}</option>)}</select></Field>
          <Field label="City" required><input value={v.city} onChange={s('city')} /></Field></div>
        <Field label="Business address" required error={err.addr} hint="Private. Not shown on your public store."><input value={v.addr} onChange={s('addr')} /></Field></>}
      {step === 2 && <><h2>Identity verification</h2>
        <Notice tone="warn" title="Simulated verification">No documents are uploaded or checked. Document types, provider and criteria are open decisions.</Notice>
        <Field label="Document type"><select value={v.doc} onChange={s('doc')}>{['National ID card', 'Passport', 'Driving licence'].map(x => <option key={x}>{x}</option>)}</select></Field>
        <FilePicker files={v.docs} setFiles={fn => setV(x => ({ ...x, docs: typeof fn === 'function' ? fn(x.docs) : fn }))} label="Add document image" />
        {err.docs && <p className="ferr">{err.docs}</p>}
        <p className="xs muted">Identity documents are stored privately, separate from product images, and only the verification process can access them.</p></>}
      {step === 3 && <><h2>Review and submit</h2>
        <KV items={[['Name', v.name], ['Email', v.email + ' (verified)'], ['Date of birth', v.dob], ['Store', v.store], ['Category', CATEGORIES.find(c => c.id === v.cat).name], ['Product types', v.types.map(t => SUBS[t].name).join(', ')], ['Address', `${v.addr}, ${v.city}, ${v.country}`], ['Identity document', `${v.doc} · ${v.docs.length} file(s)`]]} />
        <Notice tone="info">Submitting does not activate your store. A separate verification process approves sellers; you cannot approve yourself.</Notice></>}
      {step === 4 && store && <StatusPanel store={store} />}
      {step < 4 && <div className="onb-foot"><Btn v="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Btn><span className="xs muted">Progress saves when you continue.</span>{step < 3 ? <Btn v="primary" onClick={next}>Continue</Btn> : <Btn v="primary" onClick={submit}>Submit application</Btn>}</div>}
      {step === 4 && store && <div className="onb-foot"><span /><Btn v="primary" onClick={() => switchMode('selling')}>Go to seller panel</Btn></div>}
    </div></div>;
}
function StatusPanel({ store }) {
  const states = ['Draft', 'Email verification pending', 'Verification pending', 'More information required', 'Active'];
  return <><h2>Verification status</h2>
    <div className="vstatus"><Badge tone={store.status === 'Active' ? 'ok' : 'warn'} dot>{store.status}</Badge><span className="muted small">{store.name}</span></div>
    {store.status === 'Active' ? <Notice tone="ok" title="Your store is active">You can publish listings and receive orders.</Notice> :
      <Notice tone="warn" title="Review in progress (simulated)">You can finish setting up your store and prepare draft listings. Listings cannot go live and you cannot receive orders until a separate verification process activates the store. Sellers cannot approve their own verification.</Notice>}
    <ol className="vlist">{states.map((x, i) => { const cur = states.indexOf(store.status); return <li key={x} className={i < cur ? 'done' : i === cur ? 'cur' : ''}><span>{i < cur ? <Icon n="check" s={12} /> : ''}</span>{x}</li>; })}</ol></>;
}

// ---------- Overview
export function SOverview() {
  const { db, me, nav } = useApp(); const st = db.stores[me.storeId];
  const orders = db.orders.filter(o => o.storeId === st.id);
  const needs = orders.filter(o => ['paid', 'awaiting_info'].includes(o.status) || o.replacement?.state === 'Requested' || o.cancelRequest?.state === 'Requested' && o.cancelRequest.by === 'buyer');
  const upcoming = orders.filter(o => ['paid', 'preparing', 'partial'].includes(o.status) && !isOverdue(o) && o.dueAt - now() < 3 * D);
  const overdue = orders.filter(isOverdue);
  const cases = db.cases.filter(c => c.storeId === st.id && !['Resolved', 'Closed'].includes(c.status));
  const unread = db.conversations.filter(c => c.storeId === st.id).reduce((a, c) => a + c.unread.seller, 0);
  const e = earnings(db, st.id);
  const activity = orders.flatMap(o => o.events.map(ev => ({ ...ev, o }))).sort((a, b) => b.at - a.at).slice(0, 8);
  const pendingStore = st.status !== 'Active';
  const ss = storeStats(db, st);
  return <>
    <PageHead title={st.name} sub={pendingStore ? 'Your store is awaiting verification.' : `Seller overview · ${ss.active} active listings · ${fmtN(ss.completed)} completed orders`} actions={<><Btn icon="eye" onClick={() => nav({ page: 'store', id: st.id })}>View store</Btn><Btn v="primary" icon="plus" onClick={() => nav({ page: 's-product-edit', id: 'new' })}>Add product</Btn></>} />
    {pendingStore && <Notice tone="warn" title={`Status: ${st.status}`} action={<Btn size="sm" onClick={() => nav({ page: 's-onboarding' })}>View verification</Btn>}>Prepare draft listings and store settings now. Publishing and orders unlock once verification is approved by the marketplace (not by you).</Notice>}
    {st.paused && <Notice tone="warn" title="New sales are paused" action={<Btn size="sm" onClick={() => nav({ page: 's-store' })}>Store settings</Btn>}>Your listings are hidden from search. Existing orders, messages and cases continue.</Notice>}
    <div className="stats">
      <Stat icon="alert" label="Orders requiring action" value={needs.length} tone={needs.length ? 'accent' : ''} onClick={() => nav({ page: 's-orders', tab: 'pending' })} />
      <Stat icon="clock" label="Due in 3 days" value={upcoming.length} onClick={() => nav({ page: 's-orders', tab: 'progress' })} />
      <Stat icon="flag" label="Overdue" value={overdue.length} tone={overdue.length ? 'bad' : ''} onClick={() => nav({ page: 's-orders', tab: 'progress', overdue: true })} />
      <Stat icon="scale" label="Open cases" value={cases.length} tone={cases.length ? 'warn' : ''} onClick={() => nav({ page: 'cases' })} />
      <Stat icon="chat" label="Unread messages" value={unread} onClick={() => nav({ page: 'inbox' })} />
      <Stat icon="clock" label="Pending earnings" value={fmtMoney(e.pending)} sub="In fulfilment or within the release period" onClick={() => nav({ page: 's-earnings' })} />
      <Stat icon="shield" label="Dispute holds" value={fmtMoney(e.held)} onClick={() => nav({ page: 's-earnings' })} />
      <Stat icon="wallet" label="Available balance" value={fmtMoney(e.available)} sub={e.reserved ? fmtMoney(e.reserved) + ' reserved for payouts' : 'Ready to withdraw'} tone="ok" onClick={() => nav({ page: 's-payouts' })} />
    </div>
    {!orders.length && !pendingStore ? <Empty icon="box" title="No orders yet" action={<Btn v="primary" onClick={() => nav({ page: 's-product-edit', id: 'new' })}>Add your first product</Btn>}>Publish a listing to start receiving orders.</Empty> :
      <div className="two-col">
        <Section title="Needs your action" action={<button className="linkbtn" onClick={() => nav({ page: 's-orders' })}>All orders</button>}>
          {needs.length || overdue.length ? <ul className="mini-orders">{[...new Set([...overdue, ...needs])].map(o => <li key={o.id}><button onClick={() => nav({ page: 's-order', id: o.id })}>
            <ProductArt sub={o.snap.sub} art={o.snap.art} size="thumb" /><div className="mo-main"><b>{o.id} · {db.users[o.buyerId].name}</b><span className="muted xs">{o.snap.pkgName} · due {fmtDate(o.dueAt)}</span></div>
            <div className="mo-side">{isOverdue(o) ? <Badge tone="bad">Overdue</Badge> : o.replacement?.state === 'Requested' ? <Badge tone="info">Replacement requested</Badge> : <StatusBadge o={o} />}</div></button></li>)}</ul> : <p className="muted small">Nothing waiting on you.</p>}
        </Section>
        <Section title="Recent activity"><ul className="activity">{activity.map(a => <li key={a.id + a.o.id}><button onClick={() => nav({ page: 's-order', id: a.o.id })}><span className="small"><b>{a.o.id}</b> {a.text}</span><span className="muted xs">{a.actor} · {rel(a.at)}</span></button></li>)}</ul></Section>
      </div>}
  </>;
}

// ---------- Products
export function SProducts() {
  const { db, me, nav, update, toast, perform } = useApp(); const st = db.stores[me.storeId];
  const [q, setQ] = useState(''); const [stat, setStat] = useState(''); const [cat, setCat] = useState(''); const [sel, setSel] = useState([]); const [confirm, setConfirm] = useState(null);
  const all = db.listings.filter(l => l.storeId === st.id);
  const rows = all.filter(l => (!q || l.title.toLowerCase().includes(q.toLowerCase())) && (!stat ? l.availability !== 'Archived' : l.availability === stat) && (!cat || l.sub === cat));
  const hasOrders = l => db.orders.some(o => o.snap.listingId === l.id);
  // Status changes run through the shared rule (server in API mode); the result says what was skipped.
  const setAvail = async (ids, a, msg) => {
    const r = await perform('setListingAvailability', { ids, availability: a }, d => SL.setListingAvailability(d, d.users[me.id], ids, a));
    if (r.ok) { const { ok, skipped } = r.value; toast(skipped.length ? `${ok.length} updated, ${skipped.length} skipped (not allowed in their current status)` : msg || `${ok.length} updated`, skipped.length ? 'warn' : 'ok'); }
    return r;
  };
  function bulk(a) { const ids = sel; setSel([]); setAvail(ids, a); }
  async function duplicate(l) {
    const r = await perform('duplicateListing', { listingId: l.id }, d => ({ listingId: SL.duplicateListing(d, d.users[me.id], l.id) }), 'Draft copy created. Ratings and order history are not copied');
    if (r.ok) nav({ page: 's-product-edit', id: r.value.listingId });
  }
  const statuses = ['Active', 'Pending review', 'Changes requested', 'Paused', 'Draft', 'Rejected', 'Archived'];
  return <>
    <PageHead title="Products" sub={`${all.filter(l => l.availability === 'Active').length} active · ${all.filter(l => l.availability === 'Draft').length} drafts`} actions={<Btn v="primary" icon="plus" onClick={() => nav({ page: 's-product-edit', id: 'new' })}>Add product</Btn>} />
    <div className="toolbar"><div className="searchbox"><Icon n="search" s={16} /><input aria-label="Search products" placeholder="Search your products" value={q} onChange={e => setQ(e.target.value)} /></div>
      <select aria-label="Filter by status" value={stat} onChange={e => setStat(e.target.value)}><option value="">All except archived</option>{statuses.map(s => <option key={s}>{s}</option>)}</select>
      <select aria-label="Filter by category" value={cat} onChange={e => setCat(e.target.value)}><option value="">All product types</option>{[...new Set(all.map(l => l.sub))].map(s => <option key={s} value={s}>{SUBS[s].name}</option>)}</select></div>
    {sel.length > 0 && <div className="bulkbar"><b>{sel.length} selected</b><Btn size="sm" icon="play" onClick={() => bulk('Active')}>Activate</Btn><Btn size="sm" icon="pause" onClick={() => bulk('Paused')}>Pause</Btn><Btn size="sm" icon="archive" onClick={() => setConfirm({ ids: sel })}>Archive</Btn><button className="linkbtn" onClick={() => setSel([])}>Clear selection</button></div>}
    <Table rows={rows} empty={<Empty icon="box" title={all.length ? 'No products match' : 'No products yet'} action={<Btn v="primary" onClick={() => nav({ page: 's-product-edit', id: 'new' })}>Add product</Btn>}>{all.length ? 'Change the filters.' : 'Create your first listing with 1 to 10 packages.'}</Empty>}
      cols={[{ k: 'sel', label: '', cls: 'chk', render: l => <input type="checkbox" aria-label={'Select ' + l.title} checked={sel.includes(l.id)} onChange={e => setSel(e.target.checked ? [...sel, l.id] : sel.filter(x => x !== l.id))} /> },
        { k: 'p', label: 'Product', render: l => <div className="row-gap"><ProductArt sub={l.sub} art={l.art} size="thumb" /><div><b className="trunc2 small">{l.title}</b><span className="muted xs block">{SUBS[l.sub].name}</span></div></div> },
        { k: 'pr', label: 'Price range', render: l => `${money(startPrice(l))} – ${money(Math.max(...l.packages.map(p => p.price)))}` },
        { k: 'pk', label: 'Packages', cls: 'num', render: l => l.packages.length }, { k: 's', label: 'Sold', cls: 'num', render: l => fmtN(l.sold) },
        { k: 'a', label: 'Availability', render: l => <Badge tone={{ Active: 'ok', Paused: 'warn', Draft: 'info', Archived: 'muted', 'Pending review': 'accent', 'Changes requested': 'warn', Rejected: 'bad' }[l.availability]} dot>{l.availability}</Badge> },
        { k: 'u', label: 'Updated', render: l => rel(l.updatedAt || l.createdAt) },
        { k: 'x', label: 'Actions', render: l => <div className="row-acts">
          <button className="iconbtn sm" title="Edit" aria-label={'Edit ' + l.title} onClick={() => nav({ page: 's-product-edit', id: l.id })}><Icon n="edit" s={16} /></button>
          <button className="iconbtn sm" title="Preview" aria-label={'Preview ' + l.title} onClick={() => nav({ page: 'product', id: l.id, preview: true })}><Icon n="eye" s={16} /></button>
          <button className="iconbtn sm" title="Duplicate as draft" aria-label={'Duplicate ' + l.title} onClick={() => duplicate(l)}><Icon n="copy" s={16} /></button>
          {l.availability === 'Active' ? <button className="iconbtn sm" title="Pause" aria-label={'Pause ' + l.title} onClick={() => setAvail([l.id], 'Paused', 'Listing paused')}><Icon n="pause" s={16} /></button>
            : l.availability !== 'Archived' && <button className="iconbtn sm" title={st.status === 'Active' ? 'Activate' : 'Store not verified'} disabled={st.status !== 'Active'} aria-label={'Activate ' + l.title} onClick={() => setAvail([l.id], 'Active', st.status === 'Active' && !l.approvedAt && db.settings.current.listingApproval ? 'Sent for marketplace review' : 'Listing active')}><Icon n="play" s={16} /></button>}
          {l.availability === 'Archived' ? <button className="iconbtn sm" title="Restore as paused" aria-label={'Restore ' + l.title} onClick={() => setAvail([l.id], 'Paused', 'Restored as paused')}><Icon n="refresh" s={16} /></button>
            : <button className="iconbtn sm" title={l.availability === 'Draft' && !hasOrders(l) ? 'Delete draft' : 'Archive'} aria-label={'Archive ' + l.title} onClick={() => setConfirm({ ids: [l.id], del: l.availability === 'Draft' && !hasOrders(l) })}><Icon n={l.availability === 'Draft' && !hasOrders(l) ? 'trash' : 'archive'} s={16} /></button>}
        </div> }]} />
    {confirm && <Confirm danger title={confirm.del ? 'Delete this draft?' : `Archive ${confirm.ids.length} product${confirm.ids.length > 1 ? 's' : ''}?`} confirmLabel={confirm.del ? 'Delete draft' : 'Archive'}
      body={confirm.del ? 'This draft has no orders and will be permanently removed.' : 'Archived products disappear from the marketplace. Orders, reviews and delivery evidence linked to them are kept, and you can restore them later.'}
      onClose={() => setConfirm(null)} onConfirm={() => { if (confirm.del) perform('deleteDraftListing', { listingId: confirm.ids[0] }, d => SL.deleteDraftListing(d, d.users[me.id], confirm.ids[0]), 'Draft deleted'); else setAvail(confirm.ids, 'Archived', 'Archived'); setSel([]); }} />}
  </>;
}

const blankPkg = i => ({ id: 'pk' + now() + i, name: '', desc: '', qty: '', price: '', days: 2 });
export function ProductEditor() {
  const { db, me, route, nav, update, toast, perform } = useApp(); const st = db.stores[me.storeId];
  const src = route.id !== 'new' && db.listings.find(l => l.id === route.id && l.storeId === st.id);
  const [v, setV] = useState(() => src ? JSON.parse(JSON.stringify(src)) : { title: '', sub: st.types?.[0] || 'bulk-database', unit: 'units', summary: '', description: '', features: [''], why: '', deliveryMethod: 'Manual file delivery', deliveryDays: 2, replacement: st.replacementTerms, requirements: '', usage: 'Buyer is responsible for lawful use, including consent and anti-spam rules where they apply.', stock: 'In stock', art: 0, packages: [blankPkg(0)], availability: 'Draft' });
  const [err, setErr] = useState({}); const [imgs, setImgs] = useState([]);
  if (route.id !== 'new' && !src) return <ErrorState title="Product not found">It may have been deleted, or it belongs to another store.</ErrorState>;
  const s = k => e => setV({ ...v, [k]: e.target.value });
  const setPkg = (i, k, val) => setV({ ...v, packages: v.packages.map((p, j) => j === i ? { ...p, [k]: val } : p) });
  const orderCount = src ? db.orders.filter(o => o.snap.listingId === src.id).length : 0;
  function validate() {
    const e = {};
    if (v.title.trim().length < 10) e.title = 'Use a descriptive name of at least 10 characters.';
    if (v.summary.trim().length < 20) e.summary = 'Summarise what the buyer receives (20+ characters).';
    if (!v.unit.trim()) e.unit = 'Name the unit, e.g. contacts, months, calls.';
    if (!(+v.deliveryDays > 0)) e.deliveryDays = 'Enter delivery time in days.';
    if (!v.replacement.trim()) e.replacement = 'State the replacement policy.';
    v.packages.forEach((p, i) => { if (!p.name.trim() || !(+p.qty > 0) || !(+p.price > 0) || !(+p.days > 0)) e['pkg' + i] = 'Each package needs a name, positive quantity, price and delivery days.'; });
    setErr(e); return !Object.keys(e).length;
  }
  async function save(publish, preview) {
    if (!validate()) { toast('Check the highlighted fields', 'bad'); return; }
    if (publish && st.status !== 'Active') { toast('Publishing unlocks after store verification. Saved as draft.', 'warn'); publish = false; }
    const rs = activeRestriction(me, 'selling'); if (publish && rs) { toast('Selling is restricted on your account: ' + rs.notice, 'bad'); publish = false; }
    const r = await perform('saveListing', { listingId: src ? src.id : null, listing: v, publish }, d => SL.saveListing(d, d.users[me.id], src ? src.id : null, v, publish));
    if (!r.ok) return;
    const { listingId: id, availability } = r.value;
    toast(availability === 'Pending review' ? 'Submitted for marketplace review. It goes live once approved' : publish ? 'Published' : 'Saved'); nav(preview ? { page: 'product', id, preview: true } : { page: 's-products' });
  }
  return <>
    <PageHead back={{ label: 'Products', route: { page: 's-products' } }} title={src ? 'Edit product' : 'Add product'} sub={src ? <>Status: {src.availability}</> : 'Listings need 1 to 10 fixed packages.'}
      actions={<><Btn icon="eye" onClick={() => save(false, true)}>Save and preview</Btn><Btn onClick={() => save(false)}>Save{src && src.availability === 'Active' ? '' : ' draft'}</Btn>{(!src || src.availability !== 'Active') && <Btn v="primary" onClick={() => save(true)} disabled={st.status !== 'Active'} title={st.status !== 'Active' ? 'Available after verification' : ''}>Publish</Btn>}</>} />
    {src && orderCount > 0 && <Notice tone="info">Changes apply to future purchases only. The {orderCount} existing order{orderCount > 1 ? 's' : ''} keep the package, price and terms that were bought.</Notice>}
    {src && src.reviewNote && ['Changes requested', 'Rejected', 'Pending review'].includes(src.availability) && <Notice tone={src.availability === 'Pending review' ? 'info' : 'warn'} title={`Marketplace review: ${src.availability}`}>{src.reviewNote}</Notice>}
    {st.status !== 'Active' && <Notice tone="warn">Your store is {st.status.toLowerCase()}. You can save drafts; publishing is disabled until verification is approved.</Notice>}
    <div className="editor">
      <Section title="Basics">
        <Field label="Product name" required error={err.title}><input value={v.title} onChange={s('title')} /></Field>
        <div className="form-grid"><Field label="Category and product type" required><select value={v.sub} onChange={s('sub')}>{CATEGORIES.map(c => <optgroup key={c.id} label={c.name}>{c.subs.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}</select></Field>
          <Field label="Unit" required error={err.unit} hint="What one quantity means"><input value={v.unit} onChange={s('unit')} /></Field></div>
        <Field label="Summary" required error={err.summary} hint="One sentence shown on cards and search"><input value={v.summary} onChange={s('summary')} /></Field>
        <Field label="Description"><textarea rows="4" value={v.description} onChange={s('description')} /></Field>
      </Section>
      <Section title="Images">
        <div className="img-pick">{[0, 1, 2].map(a => <button key={a} className={v.art === a ? 'on' : ''} onClick={() => setV({ ...v, art: a })} aria-label={'Cover style ' + (a + 1)}><ProductArt sub={v.sub} art={a} size="card" /></button>)}</div>
        <p className="xs muted">Choose a generated cover, or add your own images. Uploads are validated before they appear publicly.</p>
        <FilePicker files={imgs} setFiles={setImgs} label="Add images" />
      </Section>
      <Section title="Features and seller explanation">
        {v.features.map((f, i) => <div key={i} className="inline-form"><input aria-label={'Feature ' + (i + 1)} value={f} onChange={e => setV({ ...v, features: v.features.map((x, j) => j === i ? e.target.value : x) })} placeholder="e.g. Validated within 30 days" /><button className="iconbtn sm" aria-label="Remove feature" onClick={() => setV({ ...v, features: v.features.filter((_, j) => j !== i) })}><Icon n="x" s={15} /></button></div>)}
        <Btn size="sm" v="ghost" icon="plus" onClick={() => setV({ ...v, features: [...v.features, ''] })}>Add feature</Btn>
        <Field label="Why choose this seller"><textarea rows="2" value={v.why} onChange={s('why')} /></Field>
      </Section>
      <Section title="Delivery and terms">
        <div className="form-grid"><Field label="Delivery method"><select value={v.deliveryMethod} onChange={s('deliveryMethod')}>{['Manual file delivery', 'Secure access information', 'Service delivery'].map(x => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Default delivery time (days)" required error={err.deliveryDays}><input type="number" value={v.deliveryDays} onChange={s('deliveryDays')} /></Field>
          <Field label="Availability"><select value={v.stock} onChange={s('stock')}>{['In stock', 'Limited stock', 'Made to order'].map(x => <option key={x}>{x}</option>)}</select></Field></div>
        <Field label="Replacement policy" required error={err.replacement}><textarea rows="2" value={v.replacement} onChange={s('replacement')} /></Field>
        <Field label="Buyer requirements" hint="What the buyer must provide at checkout. Leave blank if nothing is needed."><textarea rows="2" value={v.requirements} onChange={s('requirements')} /></Field>
        <Field label="Usage conditions"><textarea rows="2" value={v.usage} onChange={s('usage')} /></Field>
      </Section>
      <Section title={`Packages (${v.packages.length} of 10)`} action={<Btn size="sm" icon="plus" disabled={v.packages.length >= 10} onClick={() => setV({ ...v, packages: [...v.packages, blankPkg(v.packages.length)] })}>Add package</Btn>}>
        <div className="pkg-builder">{v.packages.map((p, i) => <div key={p.id} className={'pb-row' + (err['pkg' + i] ? ' has-err' : '')}>
          <span className="pb-n">{i + 1}</span>
          <div className="pb-fields">
            <Field label="Name"><input value={p.name} onChange={e => setPkg(i, 'name', e.target.value)} /></Field>
            <Field label="Short description"><input value={p.desc} onChange={e => setPkg(i, 'desc', e.target.value)} /></Field>
            <Field label={`Quantity (${v.unit})`}><input type="number" value={p.qty} onChange={e => setPkg(i, 'qty', e.target.value)} /></Field>
            <Field label="Price (USD)"><input type="number" value={p.price} onChange={e => setPkg(i, 'price', e.target.value)} /></Field>
            <Field label="Delivery days"><input type="number" value={p.days} onChange={e => setPkg(i, 'days', e.target.value)} /></Field>
          </div>
          <div className="pb-acts"><button className="iconbtn sm" aria-label="Move up" disabled={!i} onClick={() => { const a = [...v.packages];[a[i - 1], a[i]] = [a[i], a[i - 1]]; setV({ ...v, packages: a }); }}><Icon n="down" s={15} className="flip" /></button>
            <button className="iconbtn sm" aria-label="Remove package" disabled={v.packages.length === 1} onClick={() => setV({ ...v, packages: v.packages.filter((_, j) => j !== i) })}><Icon n="trash" s={15} /></button></div>
          {err['pkg' + i] && <span className="ferr pb-err">{err['pkg' + i]}</span>}</div>)}</div>
        <p className="xs muted">Buyers choose one package and how many of it (up to 10). Total units = package quantity × count. Other quantities go through custom offers.</p>
      </Section>
    </div></>;
}

// ---------- Orders
const STABS = [['pending', 'Pending'], ['progress', 'In progress'], ['delivered', 'Delivered'], ['completed', 'Completed'], ['resolution', 'Resolution'], ['cancelled', 'Cancelled']];
export function SOrders() {
  const { db, me, route, nav, update, toast, perform } = useApp(); const st = db.stores[me.storeId];
  const [tab, setTab] = useState(route.tab || 'pending'); const [q, setQ] = useState(''); const [prod, setProd] = useState(''); const [sort, setSort] = useState('deadline'); const [archived, setArchived] = useState(false); const [sel, setSel] = useState([]); const [onlyOverdue, setOnlyOverdue] = useState(!!route.overdue);
  const mine = db.orders.filter(o => o.storeId === st.id);
  const visible = mine.filter(o => !!o.archivedBySeller === archived);
  const rows = visible.filter(o => sellerGroup(db, o) === tab && (!q || (o.id + o.snap.title + db.users[o.buyerId].name).toLowerCase().includes(q.toLowerCase())) && (!prod || o.snap.listingId === prod) && (!onlyOverdue || isOverdue(o)))
    .sort((a, b) => sort === 'deadline' ? a.dueAt - b.dueAt : b.placedAt - a.placedAt);
  async function bulk(kind) {
    if (kind === 'export') { toast(`Exported ${sel.length} orders (simulated CSV, without private buyer contact data)`); setSel([]); return; }
    // Each order goes through its own transition so one refusal does not block the rest.
    const ids = sel; setSel([]); let ok = 0; const bad = [];
    for (const id of ids) {
      const r = kind === 'archive' ? await perform('setOrderArchived', { orderId: id, archived: !archived }, d => SL.setOrderArchived(d, d.users[me.id], d.orders.find(x => x.id === id), !archived))
        : await perform('startPreparation', { orderId: id }, d => { const o = d.orders.find(x => x.id === id); if (o.status !== 'paid') throw new DomainError('Only a paid order can be started.'); A.startPrep(d, o); });
      if (r.ok) ok++; else bad.push(id);
    }
    toast(`${ok} updated${bad.length ? ` · ${bad.length} rejected (incompatible status): ${bad.join(', ')}` : ''}`, bad.length ? 'warn' : 'ok');
  }
  return <>
    <PageHead title="Orders" sub="Paid orders from your store. Records are archived, never deleted." />
    <Tabs tabs={STABS.map(([id, label]) => ({ id, label, count: visible.filter(o => sellerGroup(db, o) === id).length }))} value={tab} onChange={t => { setTab(t); setSel([]); setOnlyOverdue(false); }} />
    <div className="toolbar"><div className="searchbox"><Icon n="search" s={16} /><input aria-label="Search orders" placeholder="Order number, product or buyer" value={q} onChange={e => setQ(e.target.value)} /></div>
      <select aria-label="Filter by product" value={prod} onChange={e => setProd(e.target.value)}><option value="">All products</option>{[...new Set(mine.map(o => o.snap.listingId))].map(id => <option key={id} value={id}>{mine.find(o => o.snap.listingId === id).snap.title.slice(0, 40)}</option>)}</select>
      <select aria-label="Sort" value={sort} onChange={e => setSort(e.target.value)}><option value="deadline">Deadline soonest</option><option value="new">Newest first</option></select>
      <label className="checkline sm"><input type="checkbox" checked={onlyOverdue} onChange={e => setOnlyOverdue(e.target.checked)} />Overdue only</label>
      <label className="checkline sm"><input type="checkbox" checked={archived} onChange={e => { setArchived(e.target.checked); setSel([]); }} />Show archived</label></div>
    {sel.length > 0 && <div className="bulkbar"><b>{sel.length} selected</b><Btn size="sm" icon="download" onClick={() => bulk('export')}>Export list</Btn><Btn size="sm" icon="play" onClick={() => bulk('start')}>Start preparation</Btn><Btn size="sm" icon="archive" onClick={() => bulk('archive')}>{archived ? 'Unarchive' : 'Archive'}</Btn><button className="linkbtn" onClick={() => setSel([])}>Clear</button></div>}
    <Table rows={rows} onRow={o => nav({ page: 's-order', id: o.id })} empty={<Empty icon="receipt" title="No orders in this view">{archived ? 'Archived orders appear here.' : 'Orders move between tabs as their status changes.'}</Empty>}
      cols={[{ k: 'c', label: '', cls: 'chk', render: o => <input type="checkbox" aria-label={'Select ' + o.id} checked={sel.includes(o.id)} onChange={e => setSel(e.target.checked ? [...sel, o.id] : sel.filter(x => x !== o.id))} /> },
        { k: 'id', label: 'Order', render: o => <><b>{o.id}</b><span className="muted xs block">{fmtDate(o.placedAt)}</span></> },
        { k: 'p', label: 'Product', render: o => <><span className="trunc2 small">{o.snap.title}</span><span className="muted xs block">{o.snap.pkgName}</span></> },
        { k: 'b', label: 'Client', render: o => db.users[o.buyerId].name }, { k: 'q', label: 'Quantity', cls: 'num', render: o => fmtN(o.totalQty) },
        { k: 't', label: 'Total', cls: 'num', render: o => money(o.subtotal) }, { k: 'pay', label: 'Payment', render: o => <Badge tone="ok">{o.payment.status}</Badge> },
        { k: 'd', label: 'Deadline', render: o => ['completed', 'cancelled', 'refunded'].includes(o.status) ? '—' : <span className={isOverdue(o) ? 'bad-t' : ''}>{fmtDate(o.dueAt)}{isOverdue(o) ? ' · overdue' : ''}</span> },
        { k: 's', label: 'Status', render: o => <div className="badges"><StatusBadge o={o} />{o.replacement?.state === 'Requested' && <Badge tone="info">Replacement</Badge>}</div> },
        { k: 'a', label: '', render: o => <div className="row-acts"><button className="iconbtn sm" aria-label={'Message buyer of ' + o.id} onClick={async () => { const r = await perform('orderConversation', { orderId: o.id }, d => ({ conversationId: A.orderConversation(d, d.users[me.id], d.orders.find(x => x.id === o.id)) })); if (r.ok) nav({ page: 'inbox', id: r.value.conversationId }); }}><Icon n="chat" s={16} /></button><Btn size="sm" onClick={() => nav({ page: 's-order', id: o.id })}>View</Btn></div> }]} />
  </>;
}

export function SOrder() {
  const { db, me, route, nav, update, toast, perform } = useApp();
  const o = db.orders.find(x => x.id === route.id);
  const [modal, setModal] = useState(null);
  if (!o || o.storeId !== me.storeId) return <ErrorState title="Order not available">This order does not belong to your store.</ErrorState>;
  const buyer = db.users[o.buyerId]; const kase = o.caseId && db.cases.find(c => c.id === o.caseId); const caseOpen = openCase(db, o);
  // Order transition: server action `name` in API mode, `fn(d, order)` in demo mode.
  const act = (name, args, fn, msg) => perform(name, { orderId: o.id, ...args }, d => fn(d, d.orders.find(x => x.id === o.id)), msg);
  const ob = orderBuckets(db, o.id); const commC = pct(toC(o.subtotal), o.commissionRate);
  const repl = o.replacement?.state === 'Requested';
  const canDeliver = ['preparing', 'partial'].includes(o.status) || repl;
  const remaining = o.totalQty - deliveredQty(o);
  return <>
    <PageHead back={{ label: 'Orders', route: { page: 's-orders' } }} title={<span className="row-gap wrap-gap">{o.id}<StatusBadge o={o} />{isOverdue(o) && <Badge tone="bad">Overdue</Badge>}{kase && <Badge tone={CASE_TONE[kase.status]}>Case {kase.status}</Badge>}{o.archivedBySeller && <Badge>Archived</Badge>}</span>}
      sub={`${buyer.name} · ${o.snap.title} · placed ${fmtDT(o.placedAt)}`}
      actions={<><Btn icon="chat" onClick={async () => { const r = await perform('orderConversation', { orderId: o.id }, d => ({ conversationId: A.orderConversation(d, d.users[me.id], d.orders.find(x => x.id === o.id)) })); if (r.ok) nav({ page: 'inbox', id: r.value.conversationId }); }}>Message buyer</Btn></>} />
    <Section><Progress o={o} /></Section>
    {o.status === 'awaiting_info' && <Notice tone="warn" title="Waiting for buyer information">{o.infoRequest?.text} The delivery clock starts when the buyer replies.</Notice>}
    {o.status === 'paid' && <Notice tone="accent" title="New paid order" action={<div className="row-gap"><Btn v="primary" size="sm" onClick={() => perform('startPreparation', { orderId: o.id }, d => A.startPrep(d, d.orders.find(x => x.id === o.id)), 'Preparation started')}>Start preparation</Btn><Btn size="sm" onClick={() => setModal('info')}>Request missing information</Btn></div>}>Review the buyer’s requirements below, then start preparation or ask for anything missing.</Notice>}
    {repl && <Notice tone="info" title="Buyer requested a replacement" action={<Btn v="primary" size="sm" onClick={() => setModal('deliver')}>Submit replacement delivery</Btn>}>{o.replacement.reason}. The earlier delivery stays in the history.</Notice>}
    {o.cancelRequest?.state === 'Requested' && o.cancelRequest.by === 'buyer' && <Notice tone="warn" title="Buyer requested cancellation" action={<div className="row-gap"><Btn size="sm" v="primary" onClick={() => act('respondCancel', { accept: true }, (d, x) => A.respondCancel(d, x, true, 'Seller'), 'Cancellation accepted. Refund requested for the buyer')}>Accept and refund</Btn><Btn size="sm" onClick={() => act('respondCancel', { accept: false }, (d, x) => A.respondCancel(d, x, false, 'Seller'), 'Cancellation contested')}>Contest</Btn></div>}>{o.cancelRequest.reason}</Notice>}
    {o.extension?.state === 'Requested' && <Notice tone="info">Extension of {o.extension.days} days requested. Waiting for the buyer.</Notice>}
    {o.status === 'delivered' && !caseOpen && <Notice tone="info" title="Delivered, awaiting buyer confirmation">You cannot confirm receipt on the buyer’s behalf. Funds stay pending until the buyer confirms.</Notice>}
    {caseOpen && <Notice tone="warn" title={`Case ${caseOpen.id}: ${caseOpen.status}`} action={<Btn size="sm" v="primary" onClick={() => nav({ page: 'case', id: caseOpen.id })}>Respond to case</Btn>}>Earnings from this order are reserved while the case is open.</Notice>}
    <div className="order-grid">
      <div className="stack">
        <Section title="Buyer requirements"><p className="pre">{o.requirements || <span className="muted">None provided</span>}</p></Section>
        <Section title="Deliveries" action={canDeliver && <Btn size="sm" v="primary" icon="upload" onClick={() => setModal('deliver')}>{repl ? 'Submit replacement' : 'Submit delivery'}</Btn>}><Deliveries o={o} />
          {o.deliveries.length > 0 && remaining > 0 && !repl && <p className="small">{fmtN(remaining)} {o.snap.unit} remaining.</p>}</Section>
        <Section title="Activity"><Timeline events={o.events} /></Section>
      </div>
      <div className="stack">
        <Section title="Purchased package"><KV items={[['Package', o.snap.pkgName], ['Description', o.snap.pkgDesc], ['Quantity', `${o.count} × ${fmtN(o.snap.qty)} = ${fmtN(o.totalQty)} ${o.snap.unit}`], ['Deadline', <span className={isOverdue(o) ? 'bad-t' : ''}>{fmtDT(o.dueAt)}</span>], ['Delivery method', o.snap.deliveryMethod], ['Replacement terms', o.snap.replacement], o.fromOfferId && ['From offer', o.fromOfferId]]} />
          <p className="xs muted">Snapshot at purchase. Editing the listing does not change it.</p></Section>
        <Section title="Client"><div className="row-gap"><Avatar name={buyer.name} hue={buyer.hue} size={34} /><div><b className="small">{buyer.name}</b><span className="muted xs block">Contact details are limited to what fulfilment needs.</span></div></div></Section>
        <Section title="Payment and earnings"><KV items={[['Payment', <><Badge tone="ok">{o.payment.status}</Badge> {o.payment.method} <Sim /></>], ['Order subtotal', money(o.subtotal)], [`Commission (${o.commissionRate * 100}%, ${o.commissionRule})`, '−' + fmtMoney(commC)], o.refund && ['Refund', `${money(o.refund.amount)} · ${o.refund.state}`], ['Pending', fmtMoney(ob.pending)], ['On dispute hold', fmtMoney(ob.held)], ['Released to available', fmtMoney(ob.available)], ob.refunded > 0 && ['Reversed by refunds', '−' + fmtMoney(ob.refunded)]]} />
          <p className="xs muted">Commission rate is fixed at purchase. Later rule changes do not alter this order.</p></Section>
        <Section title="Actions"><div className="action-list">
          <Btn icon="play" disabled={o.status !== 'paid'} onClick={() => perform('startPreparation', { orderId: o.id }, d => A.startPrep(d, d.orders.find(x => x.id === o.id)), 'Preparation started')}>Start preparation</Btn>
          <Btn icon="info" disabled={!['paid', 'preparing'].includes(o.status) || !!o.deliveries.length} onClick={() => setModal('info')}>Request missing information</Btn>
          <Btn icon="upload" v="primary" disabled={!canDeliver} onClick={() => setModal('deliver')}>{repl ? 'Submit replacement delivery' : 'Submit delivery'}</Btn>
          <Btn icon="calendar" disabled={!['paid', 'preparing', 'partial', 'awaiting_info'].includes(o.status) || o.extension?.state === 'Requested'} onClick={() => setModal('ext')}>Request extension</Btn>
          <Btn icon="x" v="ghost" disabled={!['paid', 'preparing', 'awaiting_info'].includes(o.status) || o.deliveries.length > 0 || o.cancelRequest?.state === 'Requested'} onClick={() => setModal('cancel')}>Request cancellation</Btn>
          <Btn icon="archive" v="ghost" disabled={!['completed', 'cancelled', 'refunded'].includes(o.status) || !!caseOpen} onClick={() => act('setOrderArchived', { archived: !o.archivedBySeller }, (d, x) => SL.setOrderArchived(d, d.users[me.id], x, !x.archivedBySeller), o.archivedBySeller ? 'Unarchived' : 'Archived. The buyer’s record is unchanged')}>{o.archivedBySeller ? 'Unarchive' : 'Archive order'}</Btn>
          <p className="xs muted">Only actions valid for the current status are enabled. You cannot deliver against unpaid or cancelled orders.</p></div></Section>
      </div>
    </div>
    {modal === 'deliver' && <DeliverModal o={o} repl={repl} remaining={repl ? o.totalQty : remaining} onClose={() => setModal(null)} onDone={x => perform('submitDelivery', { orderId: o.id, note: x.note, file: x.file, qty: x.qty }, d => A.submitDelivery(d, d.orders.find(y => y.id === o.id), x), repl ? 'Replacement delivered' : 'Delivery submitted')} />}
    {modal === 'info' && <ReasonModal title="Request missing information" label="What do you need from the buyer?" cta="Send request" hint="The order moves to Awaiting buyer information and the delivery clock pauses." onClose={() => setModal(null)} onDone={r => perform('requestBuyerInfo', { orderId: o.id, text: r }, d => A.requestInfo(d, d.orders.find(x => x.id === o.id), r), 'Request sent to buyer')} />}
    {modal === 'cancel' && <ReasonModal title="Request cancellation" label="Reason" cta="Send request" hint="The buyer can accept (full refund) or decline." onClose={() => setModal(null)} onDone={r => act('requestCancel', { reason: r }, (d, x) => A.requestCancel(d, x, 'seller', r), 'Cancellation requested')} />}
    {modal === 'ext' && <ExtModal o={o} onClose={() => setModal(null)} onDone={(n, r) => perform('requestExtension', { orderId: o.id, days: n, reason: r }, d => A.requestExtension(d, d.orders.find(x => x.id === o.id), n, r), 'Extension requested')} />}
  </>;
}
function DeliverModal({ o, repl, remaining, onClose, onDone }) {
  const { fileMode } = useApp();
  const [note, setNote] = useState(''); const [files, setFiles] = useState([]); const [qty, setQty] = useState(String(remaining)); const [err, setErr] = useState(''); const [step, setStep] = useState('form');
  function check() { if (!files.length) return setErr('Attach the delivery file or service evidence.'); if (!(+qty > 0) || +qty > remaining) return setErr(`Quantity must be between 1 and ${fmtN(remaining)}.`); if (note.trim().length < 5) return setErr('Add a delivery note for the buyer.'); setErr(''); setStep('preview'); }
  return <Modal title={repl ? 'Submit replacement delivery' : 'Submit delivery'} onClose={onClose} footer={step === 'form' ? <><Btn v="ghost" onClick={onClose}>Cancel</Btn><Btn v="primary" onClick={check}>Preview submission</Btn></> : <><Btn v="ghost" onClick={() => setStep('form')}>Edit</Btn><Btn v="primary" onClick={() => { onDone({ note: note.trim(), file: files[0], qty: +qty }); onClose(); }}>Confirm delivery</Btn></>}>
    {step === 'form' ? <>
      <Notice tone="info">{fileMode === 'r2' ? 'The file is stored privately; only you, the buyer and authorised marketplace staff can download it.' : <><Sim>Simulated upload</Sim> Files are not uploaded.</>} Delivery appears in the buyer’s order as a new version; earlier versions are kept.</Notice>
      <FilePicker upload files={files} setFiles={setFiles} multiple={false} label="Attach delivery file" />
      <Field label={`Quantity delivered (${o.snap.unit})`} hint={`${fmtN(remaining)} ${repl ? 'in replacement scope' : 'remaining'}. Less than this records a partial delivery.`}><input type="number" value={qty} onChange={e => setQty(e.target.value)} /></Field>
      <Field label="Delivery note" required><textarea rows="3" value={note} onChange={e => setNote(e.target.value)} placeholder="What is included, how to use it, validation results" /></Field>
      {err && <p className="ferr" role="alert">{err}</p>}</> :
      <><p className="small">The buyer will see:</p><div className="card pad"><b className="small">Version {o.deliveries.length + 1} · {repl ? 'Replacement' : +qty < remaining ? 'Partial delivery' : 'Delivery'}</b><p className="small">{note}</p><span className="xs">Quantity: {fmtN(+qty)} {o.snap.unit}</span><FileChip f={files[0]} /></div></>}
  </Modal>;
}
function ExtModal({ o, onClose, onDone }) {
  const [n, setN] = useState(2); const [r, setR] = useState('');
  return <Modal title="Request a deadline extension" onClose={onClose} footer={<><Btn v="ghost" onClick={onClose}>Cancel</Btn><Btn v="primary" disabled={r.trim().length < 5} onClick={() => { onDone(+n, r.trim()); onClose(); }}>Send request</Btn></>}>
    <p className="small">Current deadline: {fmtDT(o.dueAt)}. The buyer can accept or reject; the original deadline stays in the history.</p>
    <Field label="Extra days"><select value={n} onChange={e => setN(e.target.value)}>{[1, 2, 3, 5, 7].map(x => <option key={x} value={x}>{days(x)}</option>)}</select></Field>
    <Field label="Reason" required><textarea rows="3" value={r} onChange={e => setR(e.target.value)} /></Field></Modal>;
}

// ---------- Earnings and payouts (read from the shared ledger)
export function Earnings() {
  const { db, me, nav, toast } = useApp(); const e = earnings(db, me.storeId); const [type, setType] = useState('');
  const types = [...new Set(e.tx.map(t => t.type))]; const rows = e.tx.filter(t => !type || t.type === type);
  const sset = db.settings.current;
  return <>
    <PageHead title="Earnings" sub="All figures in USD, derived from the same ledger entries Finance uses." actions={<Btn icon="download" onClick={() => toast('Statement downloads are not available in this prototype. Use the table below.', 'info')}>Statement</Btn>} />
    <div className="stats">
      <Stat label="Gross sales" value={fmtMoney(e.grossC)} sub="Paid order subtotals" />
      <Stat label="Commission" value={'−' + fmtMoney(e.commissionC)} sub="Net of reversals on refunds" />
      <Stat label="Refunds" value={'−' + fmtMoney(e.refundsC)} />
      <Stat label="Net earnings" value={fmtMoney(e.netC)} sub="Gross − refunds − commission" tone="accent" />
    </div>
    <div className="balance-row five">
      <div className="bal"><span className="xs muted">Pending</span><b>{fmtMoney(e.pending)}</b><span className="xs">Released {sset.releaseDays} days after completion</span></div>
      <div className="bal warn"><span className="xs muted">Dispute holds</span><b>{fmtMoney(e.held)}</b><span className="xs">Not withdrawable while a case is open</span></div>
      <div className="bal ok"><span className="xs muted">Available</span><b>{fmtMoney(e.available)}</b><button className="linkbtn xs" onClick={() => nav({ page: 's-payouts' })}>Request payout</button></div>
      <div className="bal"><span className="xs muted">Payout reserved</span><b>{fmtMoney(e.reserved)}</b><span className="xs">Awaiting approval or transfer</span></div>
      <div className="bal"><span className="xs muted">Paid out</span><b>{fmtMoney(e.paidOut)}</b><span className="xs">History, not part of balance</span></div>
    </div>
    <p className="xs muted recon">Check: pending {fmtMoney(e.pending)} + held {fmtMoney(e.held)} + available {fmtMoney(e.available)} + reserved {fmtMoney(e.reserved)} + paid out {fmtMoney(e.paidOut)} = net earnings {fmtMoney(e.pending + e.held + e.available + e.reserved + e.paidOut)}.</p>
    <Section title="Ledger entries" action={<select aria-label="Filter by type" value={type} onChange={ev => setType(ev.target.value)}><option value="">All types</option>{types.map(t => <option key={t}>{t}</option>)}</select>}>
      <Table rows={rows} cols={[{ k: 'id', label: 'Entry', render: t => <code className="xs">{t.id}</code> }, { k: 'at', label: 'Date', render: t => fmtDT(t.at) }, { k: 'type', label: 'Type', render: t => <>{t.type}{t.platform && <span className="muted xs block">Platform record</span>}</> }, { k: 'mv', label: 'Movement', render: t => t.from ? <span className="small">{t.from === 'ext' ? 'New' : t.from} → {t.to}</span> : '—' }, { k: 'ref', label: 'Related', render: t => t.ref?.startsWith('ORD') ? <button className="linkbtn" onClick={() => nav({ page: 's-order', id: t.ref })}>{t.ref}</button> : t.ref }, { k: 'amount', label: 'Amount', cls: 'num', render: t => <span className={t.amountC < 0 ? 'neg' : ''}>{fmtMoney(t.amountC)}</span> }]} />
    </Section></>;
}

const PM_TYPES = ['Bank', 'Crypto', 'PayPal', 'Payoneer', 'bKash', 'Nagad', 'UPI'];
const PO_TONE = { 'Awaiting approval': 'info', Approved: 'accent', Processing: 'warn', Paid: 'ok', Failed: 'bad', Cancelled: 'muted', Rejected: 'bad', 'Reconciliation required': 'warn', 'Changes requested': 'warn' };
export function Payouts() {
  const { db, me, update, toast, perform } = useApp(); const sid = me.storeId; const st = db.stores[sid];
  const e = earnings(db, sid); const methods = db.payoutMethods[sid] || []; const sset = db.settings.current;
  const verified = methods.filter(m => m.verified);
  const [mid, setMid] = useState(verified.find(m => m.primary)?.id || verified[0]?.id || ''); const [amt, setAmt] = useState(''); const [err, setErr] = useState(''); const [add, setAdd] = useState(false); const [conf, setConf] = useState(false); const [cancel, setCancel] = useState(null);
  const a = +amt; const aC = Math.round(a * 100);
  function request() {
    if (!mid) return setErr('Add and verify a payout method first.');
    if (!(aC >= sset.payoutMinC)) return setErr(`The minimum payout is ${fmtMoney(sset.payoutMinC)}.`);
    if (aC > e.available) return setErr(`You can withdraw up to ${fmtMoney(e.available)}, your available balance.`);
    setErr(''); setConf(true);
  }
  const pays = db.payouts.filter(p => p.storeId === sid).sort((x, y) => y.requestedAt - x.requestedAt);
  return <>
    <PageHead title="Payouts" sub="Requests reserve funds immediately. Marketplace Finance approves and sends each transfer (simulated)." />
    {st.status !== 'Active' && <Notice tone="warn">Payouts are available once your store is active.</Notice>}
    <div className="two-col">
      <Section title="Request payout">
        <div className="avail"><span className="xs muted">Available balance</span><b>{fmtMoney(e.available)}</b><span className="xs muted">{fmtMoney(e.reserved)} reserved · {fmtMoney(e.held)} on dispute hold · {fmtMoney(e.pending)} pending</span></div>
        <Field label="Payout method"><select value={mid} onChange={ev => setMid(ev.target.value)}>{verified.length ? verified.map(m => <option key={m.id} value={m.id}>{m.label}</option>) : <option value="">No verified methods</option>}</select></Field>
        <Field label="Amount (USD)" hint={`Minimum ${fmtMoney(sset.payoutMinC)}. Payout fee ${fmtMoney(sset.payoutFeeC)} (demo default).`}><input type="number" value={amt} onChange={ev => setAmt(ev.target.value)} /></Field>
        {a > 0 && <p className="small">You receive <b>{fmtMoney(Math.max(0, aC - sset.payoutFeeC))}</b>.</p>}
        {err && <p className="ferr" role="alert">{err}</p>}
        <div className="row-gap"><Btn v="primary" disabled={st.status !== 'Active'} onClick={request}>Request payout</Btn><button className="linkbtn small" onClick={() => setAmt(String(Math.max(0, e.available) / 100))}>Use full balance</button></div>
      </Section>
      <Section title="Payout methods" action={<Btn size="sm" icon="plus" onClick={() => setAdd(true)}>Add method</Btn>}>
        <ul className="methods">{methods.map(m => <li key={m.id}><Icon n={m.type === 'Bank' ? 'bank' : m.type === 'Crypto' ? 'layers' : 'wallet'} s={18} /><div><b className="small">{m.label}</b><span className="xs muted block">{m.type} · {m.holder}</span></div>
          <div className="badges">{m.primary && <Badge tone="accent">Primary</Badge>}<Badge tone={m.verified ? 'ok' : 'warn'}>{m.verified ? 'Verified' : 'Verification pending'}</Badge></div></li>)}</ul>
        <p className="xs muted">Demo methods. No provider is connected.</p>
      </Section>
    </div>
    <Section title="Payout history">
      <Table rows={pays} empty={<Empty icon="wallet" title="No payouts yet" />} cols={[{ k: 'id', label: 'Reference', render: p => <b>{p.id}</b> }, { k: 'at', label: 'Requested', render: p => fmtDT(p.requestedAt) }, { k: 'dest', label: 'Destination', render: p => <span className="small">{p.dest}</span> },
        { k: 'amount', label: 'Amount', cls: 'num', render: p => fmtMoney(p.amountC) },
        { k: 'status', label: 'Status', render: p => <Badge tone={PO_TONE[p.status]} dot>{p.status}</Badge> },
        { k: 'x', label: '', render: p => ['Awaiting approval', 'Approved', 'Changes requested'].includes(p.status) ? <Btn size="sm" v="ghost" onClick={() => setCancel(p)}>Cancel</Btn> : <span className="xs muted">{p.status === 'Reconciliation required' ? 'Funds stay reserved until the transfer is confirmed' : rel(p.paidAt || p.requestedAt)}</span> }]} />
    </Section>
    {conf && <Confirm title="Confirm payout request" confirmLabel={`Request ${fmtMoney(aC)}`} body={`${fmtMoney(aC)} will be reserved now and sent after independent approval by marketplace Finance.`} onClose={() => setConf(false)} onConfirm={async () => { const r = await perform('requestPayout', { methodId: mid, amountC: aC }, d => ({ payoutId: requestPayout(d, me, sid, mid, aC).id }), 'Payout requested. Funds reserved'); if (r.ok) setAmt(''); }} />}
    {cancel && <Confirm title={`Cancel ${cancel.id}?`} confirmLabel="Cancel payout" danger body="The reserved amount returns to your available balance." onClose={() => setCancel(null)} onConfirm={() => perform('cancelPayout', { payoutId: cancel.id }, d => cancelPayout(d, me, cancel.id, 'Cancelled by seller'), 'Payout cancelled. Funds released')} />}
    {add && <AddMethod sid={sid} onClose={() => setAdd(false)} />}
  </>;
}
function AddMethod({ sid, onClose }) {
  const { me, update, toast, refresh } = useApp(); const [type, setType] = useState('Bank'); const [busy, setBusy] = useState(false); const [v, setV] = useState({ holder: me.name, acct: '', bank: '', net: 'USDT TRC-20', pw: '' }); const [err, setErr] = useState('');
  const s = k => e => setV({ ...v, [k]: e.target.value });
  async function save() {
    if (!v.holder.trim() || v.acct.trim().length < 6) return setErr('Enter the account holder and a valid account, wallet or email.');
    if (!v.pw) return setErr('Re-enter your password to confirm this change.');
    const method = { type, holder: v.holder, acct: v.acct, bank: v.bank, net: v.net };
    if (apiEnabled) {
      // The server checks the password before adding a destination.
      setBusy(true); setErr('');
      try { await api.addPayoutMethod({ ...method, password: v.pw }); await refresh(); } catch (x) { setBusy(false); return setErr(x.message); }
    } else if (!update(d => { SL.addPayoutMethod(d, d.users[me.id], method); return true; })) return;
    toast('Method added. Verification pending (simulated)'); onClose();
  }
  return <Modal title="Add payout method" onClose={onClose} footer={<><Btn v="ghost" onClick={onClose}>Cancel</Btn><Btn v="primary" onClick={save} disabled={busy}>Add method</Btn></>}>
    <Field label="Method"><select value={type} onChange={e => setType(e.target.value)}>{PM_TYPES.map(x => <option key={x}>{x}</option>)}</select></Field>
    <Field label="Account holder"><input value={v.holder} onChange={s('holder')} /></Field>
    {type === 'Bank' && <Field label="Bank name"><input value={v.bank} onChange={s('bank')} /></Field>}
    {type === 'Crypto' && <Field label="Network"><select value={v.net} onChange={s('net')}>{['USDT TRC-20', 'USDT ERC-20', 'USDC Base'].map(x => <option key={x}>{x}</option>)}</select></Field>}
    <Field label={type === 'Bank' ? 'Account number or IBAN' : type === 'Crypto' ? 'Wallet address' : type === 'PayPal' || type === 'Payoneer' ? 'Account email' : type === 'UPI' ? 'UPI ID' : 'Wallet number'} hint="Masked after saving"><input value={v.acct} onChange={s('acct')} /></Field>
    <Field label="Confirm with your password" hint="Recent authentication is required for payout changes"><input type="password" value={v.pw} onChange={s('pw')} /></Field>
    {err && <p className="ferr">{err}</p>}</Modal>;
}

export function StoreSettings() {
  const { db, me, update, toast, nav, perform } = useApp(); const st = db.stores[me.storeId];
  const [v, setV] = useState({ name: st.name, tagline: st.tagline, description: st.description, cat: st.cat, hue: st.hue, replacementTerms: st.replacementTerms }); const [pauseConf, setPauseConf] = useState(false); const [imgs, setImgs] = useState([]);
  const s = k => e => setV({ ...v, [k]: e.target.value });
  const ss = storeStats(db, st);
  return <>
    <PageHead title="Store settings" sub="What buyers see on your public store. Contact and identity details stay private." actions={<Btn icon="eye" onClick={() => nav({ page: 'store', id: st.id })}>View public store</Btn>} />
    <div className="two-col wide-l">
      <div className="stack">
        <Section title="Store profile">
          <div className="form-grid"><Field label="Store name"><input value={v.name} onChange={s('name')} /></Field><Field label="Category"><select value={v.cat} onChange={s('cat')}>{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field></div>
          <Field label="Tagline"><input value={v.tagline} onChange={s('tagline')} /></Field>
          <Field label="Description"><textarea rows="4" value={v.description} onChange={s('description')} /></Field>
          <div><span className="small">Store image and banner colour</span><div className="hues">{[22, 45, 96, 172, 200, 252, 285, 330].map(h => <button key={h} aria-label={'Colour ' + h} className={v.hue === h ? 'on' : ''} style={{ '--h': h }} onClick={() => setV({ ...v, hue: h })} />)}</div></div>
          <FilePicker files={imgs} setFiles={setImgs} label="Upload store image or banner" />
          <Field label="Published replacement terms" hint="Default for new listings; each order keeps the terms it was bought with"><textarea rows="2" value={v.replacementTerms} onChange={s('replacementTerms')} /></Field>
          <Btn v="primary" onClick={() => { if (v.name.trim().length < 3) return toast('Store name needs 3+ characters', 'bad'); perform('updateStore', v, d => SL.updateStore(d, d.users[me.id], v), 'Store settings saved'); }}>Save store settings</Btn>
        </Section>
        <Section title="Availability">
          <Toggle checked={st.paused} onChange={val => val ? setPauseConf(true) : perform('setStorePaused', { paused: false }, d => SL.setStorePaused(d, d.users[me.id], false), 'New sales resumed')} label="Pause new sales" desc="Hides your listings from search and product pages. Existing orders, deliveries, refunds, messages and cases continue." />
        </Section>
      </div>
      <Section title="Public profile preview"><div className="store-preview">
        <div className="sp-banner" style={{ '--h': v.hue }} /><div className="sp-body"><Avatar name={v.name} hue={v.hue} size={56} square /><b>{v.name}</b><span className="small muted">{v.tagline}</span><Stars value={ss.rating} count={ss.count} small /><span className="xs">{fmtN(ss.completed)} completed orders · {ss.active} active products</span><p className="small">{v.description}</p></div></div></Section>
    </div>
    {pauseConf && <Confirm title="Pause new sales?" body="Buyers will not be able to purchase from your store until you resume. Nothing already paid is affected." confirmLabel="Pause sales" onClose={() => setPauseConf(false)} onConfirm={() => perform('setStorePaused', { paused: true }, d => SL.setStorePaused(d, d.users[me.id], true), 'New sales paused')} />}
  </>;
}
