import React from 'react';
import { now } from '@crateline/domain/clock.js';
import { D } from '@crateline/domain/data.js';
import { activeRestriction, money, fmtN, fmtDate, fmtDT, fmtTime, rel, days, storeStats, refreshOfferExpiry, pushMsg, notify, STATUS_LABEL, openCase, isPublic } from '@crateline/domain/logic.js';
import { Icon, Btn, Badge, Avatar, Stars, ProductArt, Modal, Confirm, Empty, ErrorState, Field, Notice, Sim, Seg, Tabs, Timeline, FileChip, FilePicker, NotificationList, Table, Section, KV, StatusBadge, Toggle, CASE_TONE, OFFER_TONE, useApp } from './ui.jsx';
import { PageHead } from './shell.jsx';
import * as A from '@crateline/domain/actions.js';
import { fmtMoney } from '@crateline/domain/fin.js';
import { apiEnabled, api } from './api.js';
import QRCode from 'qrcode';
import * as AX from '@crateline/domain/actions.js';
const { useState, useEffect, useRef } = React;

function Rich({ text }) {
  const lines = (text || '').split('\n'); const out = []; let list = [];
  const fmt = s => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p);
  lines.forEach((l, i) => { if (/^[•\-] /.test(l)) list.push(<li key={i}>{fmt(l.slice(2))}</li>); else { if (list.length) { out.push(<ul key={'u' + i}>{list}</ul>); list = []; } if (l) out.push(<p key={i}>{fmt(l)}</p>); } });
  if (list.length) out.push(<ul key="ul">{list}</ul>);
  return <>{out}</>;
}

export function Inbox() {
  const { db, me, mode, route, nav, update, toast, perform } = useApp();
  const side = mode === 'selling' ? 'seller' : 'buyer';
  useEffect(() => { if (!apiEnabled) update(d => refreshOfferExpiry(d)); }, []);
  const convs = db.conversations.filter(c => (side === 'seller' ? c.storeId === me.storeId : c.buyerId === me.id) && !c.hidden[side]);
  const [sel, setSel] = useState(route.id || null);
  const [q, setQ] = useState('');
  useEffect(() => { if (route.id) setSel(route.id); }, [route.id]);
  const c = convs.find(x => x.id === sel);
  useEffect(() => { if (c && c.unread[side]) perform('markConversationRead', { conversationId: c.id }, d => AX.markConversationRead(d, d.users[me.id], d.conversations.find(x => x.id === c.id))); }, [sel, c?.messages.length]);
  const other = cv => side === 'seller' ? { name: db.users[cv.buyerId].name, hue: db.users[cv.buyerId].hue, sq: false } : { name: db.stores[cv.storeId].name, hue: db.stores[cv.storeId].hue, sq: true };
  const shown = convs.filter(cv => !q || (other(cv).name + ' ' + cv.messages.map(m => m.text).join(' ')).toLowerCase().includes(q.toLowerCase()));
  return <>
    <PageHead title="Inbox" sub={side === 'seller' ? 'Conversations with buyers, including custom offer requests.' : 'Conversations with sellers, offers and order updates.'} />
    <div className={'inbox' + (c ? ' has-sel' : '')}>
      <aside className="conv-list" aria-label="Conversations">
        <div className="searchbox sm"><Icon n="search" s={15} /><input aria-label="Search conversations" placeholder="Search conversations" value={q} onChange={e => setQ(e.target.value)} /></div>
        {!shown.length ? <Empty icon="chat" title="No conversations">{side === 'buyer' ? 'Message a seller from any product or store page.' : 'Buyer messages and offer requests appear here.'}</Empty> :
          <ul>{shown.map(cv => { const o = other(cv); const last = cv.messages[cv.messages.length - 1]; const lastOffer = [...cv.messages].reverse().find(m => m.offerId); const of = lastOffer && db.offers.find(x => x.id === lastOffer.offerId); const un = cv.unread[side];
            return <li key={cv.id}><button className={(cv.id === sel ? 'on ' : '') + (un ? 'unread' : '')} onClick={() => { setSel(cv.id); nav({ page: 'inbox', id: cv.id }, true); }}>
              <Avatar name={o.name} hue={o.hue} size={36} square={o.sq} /><div className="cl-mid"><div className="row-between"><b className="trunc">{o.name}</b><span className="xs muted">{last ? rel(last.at) : ''}</span></div>
                <span className="xs trunc block">{last ? (last.offerId ? (db.offers.find(x => x.id === last.offerId)?.kind === 'request' ? 'Offer request: ' : 'Offer: ') + last.offerId : last.text) : 'No messages'}</span>
                {of && ['Requested', 'Sent', 'Accepted awaiting payment'].includes(of.status) && <Badge tone={OFFER_TONE[of.status]}>{of.kind === 'request' ? 'Offer request' : 'Offer'} · {of.status}</Badge>}</div>
              {un > 0 && <span className="side-n" aria-label={un + ' unread'}>{un}</span>}</button></li>; })}</ul>}
      </aside>
      {c ? <Conversation c={c} side={side} onBack={() => setSel(null)} /> : <div className="conv-empty only-d"><Empty icon="chat" title="Select a conversation">Messages, offers and order events between buyer and seller are kept together.</Empty></div>}
    </div></>;
}

function Conversation({ c, side, onBack }) {
  const { db, me, nav, update, toast, perform } = useApp();
  const [text, setText] = useState(''); const [files, setFiles] = useState([]); const [menu, setMenu] = useState(false); const [modal, setModal] = useState(null); const [showInfo, setShowInfo] = useState(true);
  const ta = useRef(); const end = useRef();
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [c.id, c.messages.length]);
  const buyer = db.users[c.buyerId], st = db.stores[c.storeId];
  const name = side === 'seller' ? buyer.name : st.name;
  const order = c.orderId && db.orders.find(o => o.id === c.orderId);
  const listing = c.listingId && db.listings.find(l => l.id === c.listingId);
  function wrap(pre, post = pre) { const el = ta.current; const s = el.selectionStart, e = el.selectionEnd; const v = text.slice(0, s) + pre + (text.slice(s, e) || 'text') + post + text.slice(e); setText(v); setTimeout(() => el.focus(), 0); }
  function bullet() { setText(t => (t && !t.endsWith('\n') ? t + '\n' : t) + '• '); ta.current.focus(); }
  async function send() {
    if (!text.trim() && !files.length) return;
    const rs = activeRestriction(me, 'messages'); if (rs) { toast('Messaging is restricted on your account: ' + rs.notice, 'bad'); return; }
    const r = await perform('sendMessage', { conversationId: c.id, text: text.trim(), files }, d => { const cv = d.conversations.find(x => x.id === c.id); pushMsg(d, cv, side, text.trim(), files.length ? { files } : {}); const to = side === 'buyer' ? d.stores[cv.storeId].ownerId : cv.buyerId; notify(d, to, side === 'buyer' ? 'seller' : 'buyer', `New message from ${side === 'buyer' ? me.name : st.name}.`, { page: 'inbox', id: cv.id }); });
    if (r.ok) { setText(''); setFiles([]); }
  }
  return <section className="conv" aria-label={'Conversation with ' + name}>
    <header className="conv-h"><button className="iconbtn only-m" onClick={onBack} aria-label="Back to conversations"><Icon n="left" /></button>
      <Avatar name={name} hue={side === 'seller' ? buyer.hue : st.hue} size={34} square={side === 'buyer'} /><div className="conv-title"><b>{name}</b><span className="xs muted">{side === 'seller' ? 'Buyer' : 'Seller'}{c.blocked ? ' · Blocked' : ''}</span></div>
      <div className="menu-wrap"><button className="iconbtn" aria-label="Conversation menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon n="menu" /></button>
        {menu && <div className="dropdown" role="menu" onClick={() => setMenu(false)}>
          <button role="menuitem" onClick={() => side === 'buyer' ? nav({ page: 'store', id: st.id }) : setShowInfo(true)}><Icon n="user" s={16} />View profile</button>
          {order && <button role="menuitem" onClick={() => setShowInfo(true)}><Icon n="receipt" s={16} />Show order summary</button>}
          <button role="menuitem" onClick={() => setShowInfo(!showInfo)}><Icon n="info" s={16} />{showInfo ? 'Hide' : 'Show'} details panel</button>
          <button role="menuitem" onClick={() => setModal('block')}><Icon n="lock" s={16} />{c.blocked ? 'Unblock profile' : 'Block profile'}</button>
          <button role="menuitem" onClick={() => setModal('clear')}><Icon n="refresh" s={16} />Clear chat</button>
          <button role="menuitem" className="danger" onClick={() => setModal('delete')}><Icon n="trash" s={16} />Delete chat</button></div>}</div>
    </header>
    <div className="conv-body">
      <div className="msgs" aria-live="polite">
        {c.clearedAt?.[side] && <p className="xs muted center">Chat cleared on your side {fmtDT(c.clearedAt[side])}. Order and case records are unaffected.</p>}
        {c.messages.filter(m => !(c.clearedAt?.[side] && m.at <= c.clearedAt[side] && !m.offerId && m.from !== 'system')).map(m => {
          if (m.offerId) { const of = db.offers.find(x => x.id === m.offerId); return of ? <OfferCard key={m.id} of={of} side={side} conv={c} at={m.at} /> : null; }
          if (m.from === 'system') return <div key={m.id} className="sysmsg"><Icon n="info" s={13} />{m.text}{m.orderId && <button className="linkbtn" onClick={() => nav({ page: side === 'seller' ? 's-order' : 'u-order', id: m.orderId })}>View order</button>}<span className="xs muted">{fmtTime(m.at)}</span></div>;
          const mine = m.from === side;
          return <div key={m.id} className={'msg ' + (mine ? 'me' : 'them')}><div className="bubble"><Rich text={m.text} />{m.files && <div className="msg-files">{m.files.map((f, i) => <FileChip key={i} f={f} />)}</div>}</div><span className="xs muted">{fmtTime(m.at)}{mine ? ' · Sent' : ''}</span></div>;
        })}<div ref={end} /></div>
      {showInfo && <aside className="conv-info">
        <div className="ci-h"><Avatar name={name} hue={side === 'seller' ? buyer.hue : st.hue} size={48} square={side === 'buyer'} /><b>{name}</b>
          {side === 'buyer' ? <><Stars value={storeStats(db, st).rating} count={storeStats(db, st).count} small /><button className="linkbtn" onClick={() => nav({ page: 'store', id: st.id })}>View store</button></>
            : <span className="xs muted">Member since {fmtDate(buyer.joined)} · {db.orders.filter(o => o.buyerId === buyer.id && o.storeId === st.id).length} orders with you</span>}</div>
        {order && <div className="ci-block"><span className="xs muted">Linked order</span><b className="small">{order.id}</b><span className="xs">{order.snap.pkgName} · {money(order.total)}</span><StatusBadge o={order} /><Btn size="sm" onClick={() => nav({ page: side === 'seller' ? 's-order' : 'u-order', id: order.id })}>View order</Btn></div>}
        {listing && <div className="ci-block"><span className="xs muted">About</span><button className="linkbtn small" onClick={() => nav({ page: 'product', id: listing.id })}>{listing.title}</button></div>}
        <button className="linkbtn xs only-m" onClick={() => setShowInfo(false)}>Hide details</button>
      </aside>}
    </div>
    {c.blocked ? <div className="composer blocked"><Notice tone="warn">You blocked this profile. New messages and offers are stopped; order, delivery and case actions stay available in their own pages.</Notice></div> :
      <div className="composer">
        <div className="comp-tools"><button className="iconbtn sm" aria-label="Bold" onClick={() => wrap('**')}><Icon n="bold" s={16} /></button><button className="iconbtn sm" aria-label="Bulleted list" onClick={bullet}><Icon n="list" s={16} /></button>
          <FilePicker compact files={files} setFiles={setFiles} label="Attach" />
          {side === 'seller' ? <Btn size="sm" v="ghost" icon="sparkle" onClick={() => setModal('offer')}>Create offer</Btn> : listing && <Btn size="sm" v="ghost" icon="sparkle" onClick={() => nav({ page: 'product', id: listing.id, openOffer: true })}>Request custom offer</Btn>}</div>
        <div className="comp-row"><textarea ref={ta} rows="2" aria-label="Message" placeholder="Write a message. **bold** and • bullets supported" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
          <Btn v="primary" icon="send" onClick={send} disabled={!text.trim() && !files.length}>Send</Btn></div>
      </div>}
    {modal === 'offer' && <OfferForm conv={c} onClose={() => setModal(null)} />}
    {modal === 'block' && <Confirm title={c.blocked ? 'Unblock this profile?' : 'Block this profile?'} body={c.blocked ? 'Messages and offers will be allowed again.' : 'New general messages and offers will stop. Order, delivery and case communication stays available.'} confirmLabel={c.blocked ? 'Unblock' : 'Block'} danger={!c.blocked} onClose={() => setModal(null)} onConfirm={() => perform('setConversationBlocked', { conversationId: c.id }, d => AX.setConversationBlocked(d, d.users[me.id], d.conversations.find(y => y.id === c.id)), c.blocked ? 'Profile unblocked' : 'Profile blocked')} />}
    {modal === 'clear' && <Confirm title="Clear this chat?" body="Messages are hidden from your view only. The other participant keeps their copy, and offers, order events and case evidence remain." confirmLabel="Clear chat" onClose={() => setModal(null)} onConfirm={() => perform('clearConversation', { conversationId: c.id }, d => AX.clearConversation(d, d.users[me.id], d.conversations.find(y => y.id === c.id)), 'Chat cleared')} />}
    {modal === 'delete' && <Confirm title="Delete this chat?" danger body="The conversation is removed from your inbox. The other participant’s copy, order evidence and financial records are not erased." confirmLabel="Delete chat" onClose={() => setModal(null)} onConfirm={async () => { const r = await perform('hideConversation', { conversationId: c.id }, d => AX.hideConversation(d, d.users[me.id], d.conversations.find(y => y.id === c.id)), 'Chat deleted from your inbox'); if (r.ok) onBack(); }} />}
  </section>;
}

function OfferCard({ of, side, conv, at }) {
  const { db, nav, update, toast, perform } = useApp(); const [modal, setModal] = useState(null);
  const l = db.listings.find(x => x.id === of.listingId);
  const expired = of.kind === 'offer' && ['Sent', 'Accepted awaiting payment'].includes(of.status) && of.expiresAt < now();
  const status = expired ? 'Expired' : of.status;
  const live = !expired && !conv.blocked;
  if (of.kind === 'request') return <div className={'offer-card oc-req ' + (side === 'buyer' ? 'me' : 'them')}>
    <div className="oc-h"><Icon n="sparkle" s={16} /><b>Custom offer request</b><span className="xs muted">{of.id}</span><Badge tone={OFFER_TONE[status]}>{status === 'Answered' ? 'Answered' : status}</Badge></div>
    <KV items={[['Product', l?.title], ['Quantity', `${fmtN(of.qty)} ${l?.unit || ''}`], ['Budget', of.budget ? money(of.budget) + ' USD' : 'Not stated'], ['Requirements', of.requirements]]} />
    <div className="oc-f"><span className="xs muted">{fmtDT(at)} · Not a paid order</span>
      {side === 'seller' && status === 'Requested' && live && <div className="row-gap"><Btn size="sm" v="primary" onClick={() => setModal('send')}>Send offer</Btn>{of.budget && <Btn size="sm" onClick={() => setModal('accept')}>Accept at {money(of.budget)}</Btn>}<Btn size="sm" v="ghost" onClick={() => setModal('decline')}>Decline</Btn></div>}</div>
    {(modal === 'send' || modal === 'accept') && <OfferForm conv={conv} req={of} acceptBudget={modal === 'accept'} onClose={() => setModal(null)} />}
    {modal === 'decline' && <DeclineModal onClose={() => setModal(null)} onDone={r => perform('declineRequest', { conversationId: conv.id, requestId: of.id, reason: r }, d => A.declineRequest(d, d.conversations.find(x => x.id === conv.id), d.offers.find(x => x.id === of.id), r), 'Request declined')} />}
  </div>;
  return <div className={'offer-card ' + (side === 'seller' ? 'me' : 'them') + (['Superseded', 'Expired', 'Rejected', 'Withdrawn'].includes(status) ? ' dim' : '')}>
    <div className="oc-h"><Icon n="sparkle" s={16} /><b>Custom offer{of.version > 1 ? ` · version ${of.version}` : ''}</b><span className="xs muted">{of.id}</span><Badge tone={OFFER_TONE[status]}>{status}</Badge></div>
    <div className="oc-price"><span className="price">{money(of.price)}</span><span className="muted small">USD for {fmtN(of.qty)} {l?.unit}</span></div>
    <KV items={[['Scope', of.scope], ['Delivery time', days(of.days)], ['Replacement', of.replacement], ['Expires', <span className={expired ? 'bad-t' : ''}>{fmtDT(of.expiresAt)} ({rel(of.expiresAt)})</span>]]} />
    <div className="oc-f"><span className="xs muted">Sent {fmtDT(at)}</span>
      {side === 'buyer' && status === 'Sent' && live && <div className="row-gap"><Btn size="sm" v="primary" onClick={async () => { const r = await perform('acceptOffer', { offerId: of.id }, d => A.acceptOffer(d, d.offers.find(x => x.id === of.id))); if (r.ok) nav({ page: 'checkout', offerId: of.id }); }}>Accept and pay</Btn><Btn size="sm" v="ghost" onClick={() => perform('rejectOffer', { offerId: of.id }, d => A.rejectOffer(d, d.offers.find(x => x.id === of.id)), 'Offer rejected')}>Reject</Btn></div>}
      {side === 'buyer' && status === 'Accepted awaiting payment' && <Btn size="sm" v="primary" onClick={() => nav({ page: 'checkout', offerId: of.id })}>Proceed to checkout</Btn>}
      {side === 'seller' && status === 'Sent' && live && <div className="row-gap"><Btn size="sm" onClick={() => setModal('revise')}>Revise</Btn><Btn size="sm" v="ghost" onClick={() => perform('withdrawOffer', { offerId: of.id }, d => A.withdrawOffer(d, d.offers.find(x => x.id === of.id)), 'Offer withdrawn')}>Withdraw</Btn></div>}
      {status === 'Paid' && of.orderId && <Btn size="sm" onClick={() => nav({ page: side === 'seller' ? 's-order' : 'u-order', id: of.orderId })}>View order {of.orderId}</Btn>}
      {['Superseded', 'Expired', 'Rejected', 'Withdrawn'].includes(status) && <span className="xs muted">This version cannot be purchased.</span>}</div>
    {modal === 'revise' && <OfferForm conv={conv} req={db.offers.find(x => x.id === of.requestId)} base={of} onClose={() => setModal(null)} />}
  </div>;
}

function DeclineModal({ onClose, onDone }) {
  const [r, setR] = useState('');
  return <Modal title="Decline request" onClose={onClose} footer={<><Btn v="ghost" onClick={onClose}>Cancel</Btn><Btn v="danger" onClick={() => { onDone(r.trim()); onClose(); }}>Decline request</Btn></>}><Field label="Reason for the buyer" hint="Optional"><textarea rows="3" value={r} onChange={e => setR(e.target.value)} /></Field></Modal>;
}

export function OfferForm({ conv, req, base, acceptBudget, onClose }) {
  const { db, update, toast, perform } = useApp(); const st = db.stores[conv.storeId];
  const ls = db.listings.filter(l => l.storeId === st.id && l.availability !== 'Archived');
  const l0 = db.listings.find(l => l.id === (base?.listingId || req?.listingId || conv.listingId)) || ls[0];
  const [v, setV] = useState({ listingId: l0?.id, qty: String(base?.qty || req?.qty || ''), scope: base?.scope || (req ? `${fmtN(req.qty)} ${l0?.unit || 'units'} as requested: ${req.requirements}` : ''), price: String(base?.price || (acceptBudget ? req?.budget : '') || ''), days: String(base?.days || l0?.deliveryDays || 3), replacement: base?.replacement || st.replacementTerms, expiry: 3 });
  const [err, setErr] = useState({}); const s = k => e => setV({ ...v, [k]: e.target.value });
  async function submit() {
    const e = {}; if (!(+v.qty > 0)) e.qty = 'Enter a quantity.'; if (v.scope.trim().length < 10) e.scope = 'Describe the scope and deliverables.'; if (!(+v.price > 0)) e.price = 'Every offer needs a definite price.'; if (!(+v.days > 0)) e.days = 'Enter delivery time in days.'; if (!v.replacement.trim()) e.replacement = 'State the replacement terms.';
    setErr(e); if (Object.keys(e).length) return;
    const r = await perform('sendOffer', { conversationId: conv.id, requestId: req?.id || null, listingId: v.listingId, qty: +v.qty, scope: v.scope, price: +v.price, days: +v.days, replacement: v.replacement, expiry: +v.expiry },
      d => ({ offerId: A.sendOffer(d, d.conversations.find(x => x.id === conv.id), req ? d.offers.find(x => x.id === req.id) : null, { ...v, expiry: +v.expiry }) }), undefined, { inline: true });
    if (r.ok) { toast(`Offer ${r.value.offerId} sent`); onClose(); }
    else setErr(r.error.field && ['qty', 'scope', 'price', 'days', 'replacement'].includes(r.error.field) ? { [r.error.field]: r.error.message } : { form: r.error.message });
  }
  return <Modal title={base ? `Revise offer ${base.id}` : acceptBudget ? 'Accept requested terms' : 'Create custom offer'} onClose={onClose} footer={<><Btn v="ghost" onClick={onClose}>Cancel</Btn><Btn v="primary" onClick={submit}>{base ? 'Send revised offer' : 'Send offer'}</Btn></>}>
    {err.form && <Notice tone="bad">{err.form}</Notice>}
    {base && <Notice tone="info">Sending a revision supersedes {base.id}. Earlier versions stay in the conversation and cannot be purchased.</Notice>}
    {acceptBudget && <Notice tone="info">The buyer’s budget becomes the price. Confirm the remaining terms so the offer is fully specified.</Notice>}
    <Field label="Listing"><select value={v.listingId} onChange={s('listingId')}>{ls.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}</select></Field>
    <Field label="Scope and deliverables" required error={err.scope}><textarea rows="3" value={v.scope} onChange={s('scope')} /></Field>
    <div className="form-grid"><Field label="Quantity" required error={err.qty}><input type="number" value={v.qty} onChange={s('qty')} /></Field><Field label="Price (USD)" required error={err.price}><input type="number" value={v.price} onChange={s('price')} /></Field>
      <Field label="Delivery time (days)" required error={err.days}><input type="number" value={v.days} onChange={s('days')} /></Field><Field label="Offer expires in"><select value={v.expiry} onChange={s('expiry')}>{[1, 3, 7].map(x => <option key={x} value={x}>{days(x)}</option>)}</select></Field></div>
    <Field label="Replacement terms" required error={err.replacement}><textarea rows="2" value={v.replacement} onChange={s('replacement')} /></Field></Modal>;
}

// ---------- Resolution Center
export function Cases() {
  const { db, me, mode, nav } = useApp(); const side = mode === 'selling' ? 'seller' : 'buyer';
  const [status, setStatus] = useState('');
  const all = db.cases.filter(c => side === 'seller' ? c.storeId === me.storeId : c.buyerId === me.id);
  const rows = all.filter(c => !status || c.status === status).sort((a, b) => lastUpd(b) - lastUpd(a));
  return <><PageHead title="Resolution Center" sub={side === 'seller' ? 'Cases buyers opened on your orders. Respond with evidence or propose a remedy.' : 'Cases you opened on orders. Track responses and agree a remedy with the seller.'} />
    <div className="toolbar"><select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{Object.keys(CASE_TONE).map(s => <option key={s}>{s}</option>)}</select>
      {side === 'buyer' && <span className="muted small">To open a case, use Report order on the order page.</span>}</div>
    <Table rows={rows} onRow={c => nav({ page: 'case', id: c.id })} empty={<Empty icon="scale" title="No cases">{side === 'buyer' ? 'If an order has a problem, open it and choose Report order.' : 'Cases opened on your orders will appear here.'}</Empty>}
      cols={[{ k: 'id', label: 'Case', render: c => <b>{c.id}</b> }, { k: 'o', label: 'Order', render: c => c.orderId },
        { k: 'p', label: 'Product and quantity', render: c => { const o = db.orders.find(x => x.id === c.orderId); return <><span className="trunc2">{o.snap.title}</span><span className="muted xs block">{fmtN(o.totalQty)} {o.snap.unit}</span></>; } },
        { k: 'a', label: 'Amount', cls: 'num', render: c => money(db.orders.find(x => x.id === c.orderId).total) },
        { k: 'r', label: 'Report', render: c => <span className="trunc2 small">{c.description}</span> }, { k: 'u', label: 'Last update', render: c => rel(lastUpd(c)) },
        { k: 's', label: 'Status', render: c => <Badge tone={CASE_TONE[c.status]} dot>{c.status}</Badge> }]} /></>;
}
const lastUpd = c => Math.max(...c.timeline.map(t => t.at), c.openedAt);

export function CaseDetail() {
  const { db, me, mode, route, nav, update, toast, perform } = useApp(); const side = mode === 'selling' ? 'seller' : 'buyer';
  const c = db.cases.find(x => x.id === route.id);
  const [text, setText] = useState(''); const [files, setFiles] = useState([]); const [modal, setModal] = useState(null);
  if (!c || (side === 'seller' ? c.storeId !== me.storeId : c.buyerId !== me.id)) return <ErrorState title="Case not available">This case belongs to another account.</ErrorState>;
  const o = db.orders.find(x => x.id === c.orderId); const st = db.stores[c.storeId]; const buyer = db.users[c.buyerId];
  const closed = ['Resolved', 'Closed'].includes(c.status);
  // Case transition: server action `name` in API mode, `fn(d, case)` in demo mode.
  const act = (name, args, fn, msg) => perform(name, { caseId: c.id, ...args }, d => fn(d, d.cases.find(x => x.id === c.id)), msg);
  return <>
    <PageHead back={{ label: 'Resolution Center', route: { page: 'cases' } }} title={<span className="row-gap">{c.id}<Badge tone={CASE_TONE[c.status]} dot>{c.status}</Badge></span>} sub={`Opened ${fmtDT(c.openedAt)} by ${buyer.name} on ${o.id}`}
      actions={<Btn onClick={() => nav({ page: side === 'seller' ? 's-order' : 'u-order', id: o.id })}>View order</Btn>} />
    {c.status === 'Escalated' && <Notice tone="bad" title="Escalated to marketplace support">An assigned support process decides escalated cases. That process is outside this prototype; buyer and seller cannot make administrative decisions. Both sides can still add evidence.</Notice>}
    {c.proposal?.state === 'Proposed' && side === 'buyer' && <Notice tone="accent" title={`Seller proposes: ${c.proposal.type}${c.proposal.amount ? ' of ' + money(c.proposal.amount) : ''}`} action={<div className="row-gap"><Btn size="sm" v="primary" onClick={() => act('caseDecide', { accept: true }, (d, x) => A.caseDecide(d, x, true), 'Proposal accepted')}>Accept</Btn><Btn size="sm" onClick={() => act('caseDecide', { accept: false }, (d, x) => A.caseDecide(d, x, false), 'Proposal rejected')}>Reject</Btn></div>}>{c.proposal.note}</Notice>}
    {c.proposal?.state === 'Proposed' && side === 'seller' && <Notice tone="info" title="Waiting for the buyer to respond to your proposal">{c.proposal.type}{c.proposal.amount ? ' · ' + money(c.proposal.amount) : ''}</Notice>}
    {c.remedy && <Notice tone={c.remedy.state === 'Implemented' ? 'ok' : 'info'} title={`Agreed remedy: ${c.remedy.type}${c.remedy.amountC ? ' of ' + fmtMoney(c.remedy.amountC) : ''}`}>{c.remedy.state}{c.remedy.refundId ? ` · Refund ${c.remedy.refundId}: ${db.refunds.find(r => r.id === c.remedy.refundId)?.status}` : ''}. {c.remedy.state === 'Implemented' ? '' : 'The case stays open until the remedy is complete. Approval alone does not mean money has moved.'}</Notice>}
    {c.deadline && !['Resolved', 'Closed', 'Escalated'].includes(c.status) && <p className="xs muted">Response deadline {fmtDT(c.deadline)} ({rel(c.deadline)}). Missing it escalates the case; it does not decide it.</p>}
    <div className="order-grid">
      <div className="stack">
        <Section title="Report"><KV items={[['Reason', c.reason], ['Requested outcome', c.outcome]]} /><p>{c.description}</p></Section>
        <Section title="Responses"><ul className="responses">{(c.staffMsgs || []).map((r, i) => <li key={'s' + i} className="staff"><div className="row-gap"><span className="staff-tag">Marketplace support</span><span className="xs muted">{fmtDT(r.at)}</span></div><p className="small">{r.text}</p></li>)}{c.responses.map((r, i) => <li key={i} className={r.from === side ? 'me' : ''}><div className="row-gap"><Avatar name={r.from === 'buyer' ? buyer.name : st.name} hue={r.from === 'buyer' ? buyer.hue : st.hue} size={26} square={r.from === 'seller'} /><b className="small">{r.from === 'buyer' ? buyer.name : st.name}</b><span className="xs muted">{fmtDT(r.at)}</span></div><p className="small">{r.text}</p>{r.files?.length > 0 && <div className="msg-files">{r.files.map((f, j) => <FileChip key={j} f={f} />)}</div>}</li>)}</ul>
          {c.status !== 'Closed' && <div className="case-reply"><Field label="Add a response"><textarea rows="3" value={text} onChange={e => setText(e.target.value)} /></Field><FilePicker files={files} setFiles={setFiles} label="Attach evidence" />
            <div className="row-gap"><Btn v="primary" disabled={!text.trim()} onClick={async () => { const r = await perform('caseRespond', { caseId: c.id, text: text.trim(), files }, d => A.caseRespond(d, d.cases.find(x => x.id === c.id), side, text.trim(), files), 'Response added'); if (r.ok) { setText(''); setFiles([]); } }}>Send response</Btn>
              {side === 'seller' && !closed && !c.remedy && <Btn onClick={() => setModal('propose')}>Propose remedy</Btn>}
              {!closed && c.status !== 'Escalated' && <Btn v="ghost" onClick={() => setModal('escalate')}>Escalate</Btn>}
              {side === 'buyer' && c.status !== 'Closed' && <Btn v="ghost" onClick={() => setModal('close')}>Close case</Btn>}</div></div>}
        </Section>
        <Section title="Timeline"><Timeline events={c.timeline} /></Section>
      </div>
      <div className="stack">
        <Section title="Order"><div className="row-gap"><ProductArt sub={o.snap.sub} art={o.snap.art} size="thumb" /><div><b className="small">{o.snap.title}</b><span className="muted xs block">{o.id} · {o.snap.pkgName}</span></div></div>
          <KV items={[['Quantity', `${fmtN(o.totalQty)} ${o.snap.unit}`], ['Amount', money(o.total) + ' USD'], ['Status', <StatusBadge o={o} />], ['Buyer', buyer.name], ['Seller', st.name], ['Placed', fmtDT(o.placedAt)]]} /></Section>
        <Section title="Purchased terms"><KV items={[['Package', o.snap.pkgDesc], ['Delivery method', o.snap.deliveryMethod], ['Replacement terms', o.snap.replacement]]} /></Section>
        <Section title={`Evidence (${c.evidence.length})`}>{c.evidence.length ? <div className="msg-files">{c.evidence.map((f, i) => <div key={i}><FileChip f={f} /><span className="xs muted">{f.by} · {fmtDate(f.at)}</span></div>)}</div> : <p className="muted small">No files yet.</p>}</Section>
        <Section title="Proposed resolution">{c.proposal ? <KV items={[['Remedy', c.proposal.type], c.proposal.amount && ['Amount', money(c.proposal.amount)], ['Note', c.proposal.note], ['State', <Badge tone={c.proposal.state === 'Accepted' ? 'ok' : c.proposal.state === 'Rejected' ? 'bad' : 'info'}>{c.proposal.state}</Badge>]]} /> : <p className="muted small">No remedy proposed yet.</p>}
          {o.refund && <KV items={[['Refund', `${money(o.refund.amount)} · ${o.refund.state}`]]} />}</Section>
      </div>
    </div>
    {modal === 'propose' && <ProposeModal o={o} onClose={() => setModal(null)} onDone={p => act('caseProposal', { type: p.type, amount: p.amount, note: p.note }, (d, x) => A.caseProposal(d, x, p), 'Proposal sent to buyer')} />}
    {modal === 'escalate' && <Confirm title="Escalate this case?" body="Marketplace support will review the evidence from both sides. This prototype does not include that support process." confirmLabel="Escalate" onClose={() => setModal(null)} onConfirm={() => act('caseEscalate', {}, (d, x) => A.caseEscalate(d, x, side), 'Case escalated')} />}
    {modal === 'close' && <Confirm title="Close this case?" body="Close only if the problem is settled. Order history and evidence are kept." confirmLabel="Close case" onClose={() => setModal(null)} onConfirm={() => act('caseCloseByBuyer', {}, (d, x) => A.caseClose(d, x, side), 'Case closed')} />}
  </>;
}
function ProposeModal({ o, onClose, onDone }) {
  const [type, setType] = useState('Replacement'); const [amount, setAmount] = useState(''); const [note, setNote] = useState(''); const [err, setErr] = useState('');
  const max = o.subtotal - (o.refund && o.refund.state !== 'Failed' ? o.refund.amount : 0);
  return <Modal title="Propose a remedy" onClose={onClose} footer={<><Btn v="ghost" onClick={onClose}>Cancel</Btn><Btn v="primary" onClick={() => {
    const amt = type === 'Full refund' ? max : type === 'Partial refund' ? +amount : null;
    if (type === 'Partial refund' && !(amt > 0 && amt < max)) return setErr(`Enter an amount between $0.01 and ${money(max - 0.01)}. Refunds cannot exceed the refundable amount.`);
    if (note.trim().length < 5) return setErr('Explain the remedy to the buyer.');
    onDone({ type, amount: amt, note: note.trim() }); onClose(); }}>Send proposal</Btn></>}>
    <Seg label="Remedy" value={type} onChange={setType} options={['Replacement', 'Partial refund', 'Full refund', 'Cancel order'].map(x => ({ id: x, label: x }))} />
    {type === 'Partial refund' && <Field label="Refund amount (USD)" hint={`Refundable: ${money(max)}`}><input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></Field>}
    {type === 'Full refund' && <p className="small">Refund {money(max)}, the order subtotal less any earlier refunds.</p>}
    <Field label="Note to buyer" required><textarea rows="3" value={note} onChange={e => setNote(e.target.value)} placeholder={type === 'Replacement' ? 'e.g. We will replace the 170 affected records within 24 hours.' : ''} /></Field>
    {err && <p className="ferr">{err}</p>}</Modal>;
}

export function Notifications() {
  const { db, me, mode, nav, update, perform, more, loadMore } = useApp(); const panel = mode === 'selling' ? 'seller' : 'buyer'; const [tab, setTab] = useState('all');
  const all = db.notifications.filter(n => n.userId === me.id && n.panel === panel);
  const items = tab === 'unread' ? all.filter(n => !n.read) : all;
  return <><PageHead title="Notifications" actions={<Btn size="sm" icon="check" onClick={() => perform('markNotificationsRead', { panel }, d => AX.markNotificationsRead(d, d.users[me.id], panel))}>Mark all as read</Btn>} />
    <Tabs tabs={[{ id: 'all', label: 'All', count: all.length }, { id: 'unread', label: 'Unread', count: all.filter(n => !n.read).length }]} value={tab} onChange={setTab} />
    <div className="card"><NotificationList items={items} onOpen={n => { perform('markNotificationsRead', { id: n.id }, d => AX.markNotificationsRead(d, d.users[me.id], panel, n.id)); nav(n.route); }} />{more.notifications && <div className="row-gap center" style={{ padding: '12px 0' }}><Btn size="sm" onClick={() => loadMore('notifications')}>Load older</Btn></div>}</div>
    <p className="xs muted">Notifications describe events without private files, codes or full payment details. Email delivery is simulated.</p></>;
}

export function AccountSettings() {
  const { db, me, update, toast, nav, perform, emailMode, refresh } = useApp();
  const [p, setP] = useState({ name: me.name, username: me.username, email: me.email, phone: me.phone, telegram: me.telegram, hue: me.hue });
  const [pendingEmail, setPendingEmail] = useState(null); const [err, setErr] = useState({});
  // API mode email change: the new address is confirmed from a link; the password is asked first.
  const [emailPw, setEmailPw] = useState(null); const [verifyWait, setVerifyWait] = useState(false);
  const realEmail = apiEnabled && emailMode && emailMode !== 'off';
  async function sendEmailChange() {
    try { await api.changeEmail(p.email.trim(), emailPw); setEmailPw(null); setPendingEmail(p.email.trim()); setP(x => ({ ...x, email: me.email })); toast('Confirmation link sent to ' + p.email.trim()); }
    catch (x) { setErr({ [x.field === 'password' ? 'emailPw' : 'email']: x.message }); }
  }
  async function resendVerify() { try { await api.verifyRequest(); setVerifyWait(true); toast('Verification email sent to ' + me.email); } catch (x) { toast(x.message, 'bad'); } }
  const [pw, setPw] = useState({ cur: '', a: '', b: '' }); const [pwErr, setPwErr] = useState('');
  const [tfa, setTfa] = useState(null); const [code, setCode] = useState('');
  const [del, setDel] = useState(false); const [avatarFiles, setAvatarFiles] = useState([]);
  const outstanding = [
    ...db.orders.filter(o => o.buyerId === me.id && !['completed', 'cancelled', 'refunded'].includes(o.status)).map(o => `Order ${o.id} (${STATUS_LABEL[o.status]})`),
    ...db.cases.filter(c => c.buyerId === me.id && !['Resolved', 'Closed'].includes(c.status)).map(c => `Case ${c.id}`),
    ...(me.storeId ? db.payouts.filter(x => x.storeId === me.storeId && ['Requested', 'Processing'].includes(x.status)).map(x => `Payout ${x.id}`) : []),
  ];
  function saveProfile() {
    const e = {}; if (p.name.trim().length < 2) e.name = 'Enter your full name.'; if (!/^[a-z0-9._]{3,20}$/i.test(p.username)) e.username = 'Use 3 to 20 letters, numbers, dots or underscores.';
    if (!/^\S+@\S+\.\S+$/.test(p.email)) e.email = 'Enter a valid email address.'; if (p.telegram && !/^@\w{3,}$/.test(p.telegram)) e.telegram = 'Telegram handles start with @.';
    setErr(e); if (Object.keys(e).length) return;
    const emailChanged = p.email !== me.email;
    // Email changes need a verification email, which the server cannot send yet.
    if (apiEnabled && emailChanged) {
      if (!realEmail) return setErr({ email: 'Changing your email needs email verification, which is not available on this server yet.' });
      setErr({}); setEmailPw(''); // ask for the password, then send the confirmation link
    }
    if (apiEnabled && emailChanged && p.name.trim() === me.name && p.username === me.username && p.phone === me.phone && p.telegram === me.telegram && p.hue === me.hue) return; // only the email changed
    perform('updateProfile', { name: p.name.trim(), username: p.username, phone: p.phone, telegram: p.telegram, hue: p.hue }, d => { const u = d.users[me.id]; Object.assign(u, { name: p.name.trim(), username: p.username, phone: p.phone, telegram: p.telegram, hue: p.hue }); if (emailChanged) notify(d, me.id, 'buyer', 'Security: an email change was requested on your account.', { page: 'account' }); },
      emailChanged && !apiEnabled ? 'Profile saved. Verify the new email to finish the change.' : 'Profile saved').then(r => { if (r.ok && emailChanged && !apiEnabled) setPendingEmail(p.email); else if (!r.ok && r.error.field) setErr({ [r.error.field]: r.error.message }); });
  }
  async function changePassword() {
    if (!pw.cur) return setPwErr('Enter your current password.'); if (pw.a.length < 8 || !/\d/.test(pw.a)) return setPwErr('New password needs 8 characters including a number.'); if (pw.a !== pw.b) return setPwErr('New passwords do not match.');
    setPwErr('');
    if (apiEnabled) { try { await api.changePassword(pw.cur, pw.a); } catch (x) { return setPwErr(x.message); } }
    setPw({ cur: '', a: '', b: '' }); toast(apiEnabled ? 'Password changed. Other sessions were signed out' : 'Password changed. Other sessions signed out (simulated)');
  }
  return <><PageHead title="Account settings" sub={`Account ${me.acct}. Shared by your buying and selling modes.`} />
    <div className="settings">
      {apiEnabled && !me.emailVerified && realEmail && <Notice tone="warn" title="Confirm your email address" action={<Btn size="sm" disabled={verifyWait} onClick={resendVerify}>{verifyWait ? 'Link sent' : 'Send a new link'}</Btn>}>We sent a confirmation link to {me.email} when you registered. Notification emails start once it is confirmed.</Notice>}
      <Section title="Profile">
        <div className="avatar-edit"><Avatar name={p.name} hue={p.hue} size={64} /><div><span className="small">Profile image colour</span><div className="hues">{[16, 48, 96, 172, 212, 262, 300, 340].map(h => <button key={h} aria-label={'Colour ' + h} className={p.hue === h ? 'on' : ''} style={{ '--h': h }} onClick={() => setP({ ...p, hue: h })} />)}</div>
          <FilePicker compact files={avatarFiles} setFiles={setAvatarFiles} multiple={false} label="Upload image" />{avatarFiles.length > 0 && <span className="xs muted">Image validation pending. Initials shown until approved (simulated).</span>}</div></div>
        <div className="form-grid">
          <Field label="Full name" required error={err.name}><input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} /></Field>
          <Field label="Username" required error={err.username}><input value={p.username} onChange={e => setP({ ...p, username: e.target.value })} /></Field>
          <Field label="Email" required error={err.email} hint={pendingEmail ? `Verification sent to ${pendingEmail}. Current email stays active until confirmed.` : 'Changing email requires verifying the new address.'}><input type="email" value={p.email} onChange={e => setP({ ...p, email: e.target.value })} /></Field>
          <Field label="Phone"><input type="tel" value={p.phone} onChange={e => setP({ ...p, phone: e.target.value })} /></Field>
          <Field label="Telegram" error={err.telegram}><input value={p.telegram} onChange={e => setP({ ...p, telegram: e.target.value })} /></Field>
        </div>
        {emailPw !== null && <div className="inline-form"><Field label={`Password to confirm the change to ${p.email.trim()}`} error={err.emailPw}><input type="password" autoComplete="current-password" value={emailPw} onChange={e => setEmailPw(e.target.value)} /></Field>
          <Btn size="sm" v="primary" disabled={!emailPw} onClick={sendEmailChange}>Send confirmation link</Btn><Btn size="sm" v="ghost" onClick={() => { setEmailPw(null); setP(x => ({ ...x, email: me.email })); }}>Cancel</Btn></div>}
        {apiEnabled && pendingEmail && <Notice tone="info" title={`Confirm ${pendingEmail}`}>Open the link we sent to {pendingEmail}. Until then, sign-in and notifications use {me.email}.</Notice>}
        {!apiEnabled && pendingEmail && <Notice tone="accent" title="Demo: confirm new email" action={<Btn size="sm" onClick={() => { update(d => { d.users[me.id].email = pendingEmail; }); setPendingEmail(null); toast('Email updated'); }}>Simulate verification link</Btn>}>Until confirmed, sign-in and notifications use {me.email}.</Notice>}
        <Btn v="primary" onClick={saveProfile}>Save profile</Btn>
      </Section>
      <Section title="Password">
        <div className="form-grid"><Field label="Current password"><input type="password" value={pw.cur} onChange={e => setPw({ ...pw, cur: e.target.value })} /></Field><span />
          <Field label="New password" hint="At least 8 characters including a number"><input type="password" value={pw.a} onChange={e => setPw({ ...pw, a: e.target.value })} /></Field><Field label="Confirm new password"><input type="password" value={pw.b} onChange={e => setPw({ ...pw, b: e.target.value })} /></Field></div>
        {pwErr && <p className="ferr">{pwErr}</p>}
        <div className="row-gap"><Btn onClick={changePassword}>Change password</Btn><button className="linkbtn small" onClick={() => nav({ page: 'forgot' })}>Forgot current password?</button></div>
      </Section>
      <Section title="Two-factor authentication" action={<Badge tone={me.twoFA ? 'ok' : 'muted'}>{me.twoFA ? 'On' : 'Off'}</Badge>}>
        {apiEnabled ? <TwoFactorPanel on={me.twoFA} onChanged={refresh} />
          : me.twoFA ? <div className="row-between"><p className="small">Authenticator app is required at sign-in. <Sim /></p><Btn v="ghost" onClick={() => { update(d => { d.users[me.id].twoFA = false; }); toast('Two-factor authentication turned off'); }}>Turn off</Btn></div>
          : tfa ? <div className="tfa"><div className="qr" aria-label="Sample QR code">{Array.from({ length: 64 }, (_, i) => <i key={i} className={(i * 37 + i % 7) % 3 ? '' : 'on'} />)}</div>
            <div><p className="small">Scan with an authenticator app, then enter the 6-digit code. <b>Demo code: 123456</b></p><Field label="Code"><input inputMode="numeric" maxLength="6" value={code} onChange={e => setCode(e.target.value)} /></Field>
              <Btn v="primary" onClick={() => { if (code !== '123456') return toast('That code does not match. Try 123456 in this demo.', 'bad'); update(d => { d.users[me.id].twoFA = true; notify(d, me.id, 'buyer', 'Security: two-factor authentication turned on.', { page: 'account' }); }); setTfa(null); setCode(''); toast('Two-factor authentication on. Save your recovery codes'); }}>Verify and turn on</Btn>
              <p className="xs muted">Recovery codes: 4F7K-2Q9D · 8M3X-1B6R · 5T2W-7N4P (sample)</p></div></div>
            : <div className="row-between"><p className="small muted">Add a second step at sign-in with an authenticator app.</p><Btn onClick={() => setTfa(true)}>Set up</Btn></div>}
      </Section>
      <Section title="Notification preferences">
        {[['orders', 'Order and delivery updates', 'Essential records always stay in-app'], ['messages', 'New messages'], ['offers', 'Custom offers and expiry reminders'], ['email', 'Also send by email', 'Transactional email (simulated)'], ['marketing', 'Promotions and newsletters', 'Optional']].map(([k, label, desc]) =>
          <Toggle key={k} checked={me.prefs[k]} onChange={v => perform('setPreference', { key: k, value: v }, d => AX.setPreference(d, d.users[me.id], k, v))} label={label} desc={desc} />)}
      </Section>
      <Section title="Delete account">
        {me.deletion ? <Notice tone="warn" title="Deletion requested" action={<Btn size="sm" onClick={() => perform('withdrawDeletion', {}, d => AX.withdrawDeletion(d, d.users[me.id]), 'Deletion request withdrawn')}>Withdraw request</Btn>}>Requested {fmtDT(me.deletion.at)}. {me.deletion.blockers.length ? `Pending until these are resolved: ${me.deletion.blockers.join(', ')}.` : 'Will be processed under the retention policy.'} Financial and dispute records are kept as required.</Notice>
          : <div className="row-between"><p className="small muted">Request closure of your account. Public profile data is removed; required financial records are retained.</p><Btn v="danger" onClick={() => setDel(true)}>Request deletion</Btn></div>}
      </Section>
    </div>
    {del && <Confirm danger title="Request account deletion?" confirmLabel="Request deletion" body={outstanding.length ? 'Your request stays pending until these items are resolved:' : 'No outstanding orders, cases or payouts were found.'} onClose={() => setDel(false)} onConfirm={() => perform('requestDeletion', {}, d => AX.requestDeletion(d, d.users[me.id], outstanding), 'Deletion request recorded')}>
      {outstanding.length > 0 && <ul className="small">{outstanding.map(x => <li key={x}>{x}</li>)}</ul>}</Confirm>}
  </>;
}

// ---------- two-factor sign-in (API mode), used in account settings and the staff security dialog
function RecoveryCodes({ codes, onDone }) {
  const { toast } = useApp(); const text = 'Crateline recovery codes. Each works once.\n\n' + codes.join('\n') + '\n';
  const copy = async () => { try { await navigator.clipboard.writeText(codes.join('\n')); toast('Recovery codes copied'); } catch { toast('Copy failed. Select the codes and copy them yourself.', 'bad'); } };
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'crateline-recovery-codes.txt'; a.click(); URL.revokeObjectURL(a.href); };
  return <div className="stack" style={{ gap: 12 }}>
    <Notice tone="warn" title="Save these recovery codes now">Each code signs you in once if you lose your phone. They are not shown again.</Notice>
    <ul className="recovery-codes" aria-label="Recovery codes">{codes.map(c => <li key={c}><code>{c}</code></li>)}</ul>
    <div className="row-gap"><Btn size="sm" icon="copy" onClick={copy}>Copy</Btn><Btn size="sm" icon="download" onClick={download}>Download as text</Btn><Btn size="sm" v="primary" onClick={onDone}>I have saved them</Btn></div>
  </div>;
}
export function TwoFactorPanel({ on, onChanged }) {
  const { toast } = useApp();
  const [stage, setStage] = useState('idle'); const [setup, setSetup] = useState(null); const [qr, setQr] = useState(''); const [code, setCode] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState({}); const [codes, setCodes] = useState(null); const [busy, setBusy] = useState(false);
  const fail = x => { setBusy(false); setErr({ [x.field || 'form']: x.message }); };
  async function start() { setBusy(true); setErr({}); try { const r = await api.twoFactorSetup(); setSetup(r); setQr(await QRCode.toDataURL(r.uri, { margin: 1, width: 176 })); setStage('setup'); } catch (x) { fail(x); } setBusy(false); }
  async function enable() { setBusy(true); setErr({}); try { const r = await api.twoFactorEnable(code.trim()); await onChanged(); setCodes(r.recoveryCodes); setStage('codes'); setCode(''); } catch (x) { fail(x); } setBusy(false); }
  async function disable() { setBusy(true); setErr({}); try { await api.twoFactorDisable(pw, code.trim()); setStage('idle'); setPw(''); setCode(''); toast('Two-factor sign-in turned off'); await onChanged(); } catch (x) { fail(x); } setBusy(false); }
  async function regen() { setBusy(true); setErr({}); try { const r = await api.twoFactorRecovery(code.trim()); setCodes(r.recoveryCodes); setStage('codes'); setCode(''); } catch (x) { fail(x); } setBusy(false); }
  if (stage === 'codes') return <RecoveryCodes codes={codes} onDone={() => { setCodes(null); setStage('idle'); toast(on ? 'Two-factor sign-in is on' : 'Recovery codes saved'); }} />;
  if (stage === 'setup') return <div className="tfa">
    <img className="tfa-qr" src={qr} width="176" height="176" alt="QR code for your authenticator app" />
    <div className="stack" style={{ gap: 10, flex: 1, minWidth: 220 }}>
      <p className="small">Scan the code with an authenticator app (Google Authenticator, 1Password, Authy or similar), or enter this key yourself:</p>
      <code className="tfa-key">{setup.secret.match(/.{1,4}/g).join(' ')}</code>
      <Field label="6-digit code from the app" error={err.code}><input inputMode="numeric" autoComplete="one-time-code" maxLength="6" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
      {err.form && <p className="ferr">{err.form}</p>}
      <div className="row-gap"><Btn v="primary" disabled={busy || code.length !== 6} onClick={enable}>{busy ? 'Checking…' : 'Turn on'}</Btn><Btn v="ghost" onClick={() => setStage('idle')}>Cancel</Btn></div>
    </div></div>;
  if (stage === 'off' || stage === 'regen') return <div className="stack" style={{ gap: 4 }}>
    {stage === 'off' && <Field label="Password" error={err.password}><input type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} /></Field>}
    <Field label="Authenticator or recovery code" error={err.code}><input autoComplete="one-time-code" maxLength="12" value={code} onChange={e => setCode(e.target.value)} /></Field>
    {err.form && <p className="ferr">{err.form}</p>}
    <div className="row-gap">{stage === 'off' ? <Btn v="danger" disabled={busy || !pw || !code.trim()} onClick={disable}>Turn off two-factor sign-in</Btn> : <Btn v="primary" disabled={busy || !code.trim()} onClick={regen}>Create new recovery codes</Btn>}<Btn v="ghost" onClick={() => { setStage('idle'); setErr({}); }}>Cancel</Btn></div>
  </div>;
  return on ? <div className="row-between"><p className="small">Signing in needs a code from your authenticator app.</p><div className="row-gap"><Btn size="sm" onClick={() => setStage('regen')}>New recovery codes</Btn><Btn size="sm" v="ghost" onClick={() => setStage('off')}>Turn off</Btn></div></div>
    : <div className="row-between"><p className="small muted">Add a second step at sign-in with an authenticator app.</p><Btn disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Set up'}</Btn>{err.form && <p className="ferr">{err.form}</p>}</div>;
}
