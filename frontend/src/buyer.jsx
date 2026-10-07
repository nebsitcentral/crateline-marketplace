import React from 'react';
import { now } from '@crateline/domain/clock.js';
import { SERVICE_FEE, TERMS_VERSION, round2, D, activeCats } from '@crateline/domain/data.js';
import { currentTerms, startPayment, activeRestriction, money, fmtN, fmtDate, fmtDT, rel, days, isPublic, buyerGroup, isOverdue, openCase, deliveredQty, STATUS_LABEL, newId, completePurchase, notify, refreshOfferExpiry, storeStats } from '@crateline/domain/logic.js';
import { Icon, Btn, Badge, Avatar, Stars, StarInput, ProductArt, Modal, Confirm, Empty, ErrorState, Field, Notice, Sim, Seg, Tabs, Progress, Timeline, FileChip, FilePicker, NotificationList, Table, Stat, Section, KV, StatusBadge, Stepper, CASE_TONE, useApp } from './ui.jsx';
import { PageHead, SearchBox } from './shell.jsx';
import * as A from '@crateline/domain/actions.js';
import { SupportForm } from './public.jsx';
import { api, apiEnabled } from './api.js';
const { useState, useEffect, useMemo } = React;

export function UOverview() {
  const { db, me, nav } = useApp();
  const mine = db.orders.filter(o => o.buyerId === me.id);
  const active = mine.filter(o => buyerGroup(o) === 'running');
  const awaiting = mine.filter(o => o.status === 'delivered');
  const cases = db.cases.filter(c => c.buyerId === me.id && !['Resolved', 'Closed'].includes(c.status));
  const unread = db.conversations.filter(c => c.buyerId === me.id).reduce((a, c) => a + c.unread.buyer, 0);
  const pending = db.purchases.filter(p => p.buyerId === me.id && p.status === 'Pending');
  const notes = db.notifications.filter(n => n.userId === me.id && n.panel === 'buyer').slice(0, 5);
  const fresh = db.listings.filter(l => isPublic(db, l)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  // Active stores with something to buy, busiest first; the buyer's own store is left out.
  const stores = Object.values(db.stores).filter(s => s.status === 'Active' && s.id !== me.storeId).map(s => ({ s, ss: storeStats(db, s) })).filter(x => x.ss.active > 0).sort((a, b) => b.ss.completed - a.ss.completed || a.s.name.localeCompare(b.s.name));
  return <>
    <div className="dash-top">
      <section className="discover" aria-labelledby="dash-h">
        <span className="eyebrow">Hello, {me.name.split(' ')[0]}</span>
        <h1 id="dash-h">Verified data, servers and services, ready for your next job.</h1>
        <p className="lead">Search every active listing, or pick up where your orders left off.</p>
        <SearchBox big />
        <div className="quick-pills">{activeCats().map(c => <button key={c.id} className="chip" onClick={() => nav({ page: 'search', cat: c.id })}>{c.name}</button>)}</div>
        <div className="dash-figs">
          <button className="dash-fig" onClick={() => nav({ page: 'u-orders', tab: 'running' })}><b>{active.length}</b><span>Active orders</span></button>
          <button className="dash-fig" onClick={() => nav({ page: 'u-orders', tab: 'running', status: 'delivered' })}><b>{awaiting.length}</b><span>Awaiting your confirmation</span></button>
          <button className="dash-fig" onClick={() => nav({ page: 'cases' })}><b>{cases.length}</b><span>Open cases</span></button>
          <button className="dash-fig" onClick={() => nav({ page: 'inbox' })}><b>{unread}</b><span>Unread messages</span></button>
        </div>
      </section>
      <section className="dash-side" aria-labelledby="new-h">
        <div className="row-between"><h2 id="new-h">New on Crateline</h2><button className="linkbtn" onClick={() => nav({ page: 'search' })}>Browse all</button></div>
        {fresh.length ? <ul className="rlist">{fresh.slice(0, 5).map(l => <li key={l.id}><button onClick={() => nav({ page: 'product', id: l.id })}>
          <ProductArt sub={l.sub} art={l.art} size="thumb" /><div className="rl-main"><span className="rl-t">{l.title}</span><span className="muted xs">{db.stores[l.storeId]?.name} · from {money(Math.min(...l.packages.map(p => p.price)))}</span></div><span className="rl-go" aria-hidden="true"><Icon n="right" s={14} /></span></button></li>)}</ul>
          : <p className="muted small">No listings yet.</p>}
      </section>
    </div>
    {pending.map(p => <Notice key={p.id} tone="warn" title={`Payment ${p.id} is pending`} action={<Btn size="sm" onClick={() => nav({ page: 'pay-result', id: p.id })}>View status</Btn>}>Orders are created once the provider confirms payment.</Notice>)}
    {awaiting.map(o => <Notice key={o.id} tone="accent" title={`${o.id} was delivered`} action={<Btn size="sm" v="primary" onClick={() => nav({ page: 'u-order', id: o.id })}>Review delivery</Btn>}>{o.snap.title}. Confirm receipt, request a replacement, or report a problem.</Notice>)}
    {stores.length > 0 && <Section title="Stores" action={<button className="linkbtn" onClick={() => nav({ page: 'search' })}>Browse all products</button>}>
      <div className="follow-grid">{stores.slice(0, 8).map(({ s, ss }) => <button key={s.id} className="store-tile" onClick={() => nav({ page: 'store', id: s.id })}>
        <span className="row-gap"><Avatar name={s.name} hue={s.hue} size={44} square /><span className="st-main"><b>{s.name}</b><span className="muted xs">{s.tagline}</span></span></span>
        <span className="row-gap small"><Stars value={ss.rating} count={ss.count} small /><span className="muted">· {ss.active} product{ss.active === 1 ? '' : 's'} · {fmtN(ss.completed)} completed order{ss.completed === 1 ? '' : 's'}</span></span>
        {me.following.includes(s.id) && <Badge tone="muted">Following</Badge>}</button>)}</div>
    </Section>}
    {!mine.length ? <Empty icon="cart" title="No purchases yet" action={<Btn v="primary" onClick={() => nav({ page: 'home' })}>Browse products</Btn>}>Orders you place appear here with delivery status and files.</Empty> :
      <div className="two-col">
        <Section title="Recent purchases" action={<button className="linkbtn" onClick={() => nav({ page: 'u-orders' })}>All orders</button>}>
          <ul className="mini-orders">{mine.slice().sort((a, b) => b.placedAt - a.placedAt).slice(0, 5).map(o => <li key={o.id}><button onClick={() => nav({ page: 'u-order', id: o.id })}>
            <ProductArt sub={o.snap.sub} art={o.snap.art} size="thumb" /><div className="mo-main"><b>{o.snap.title}</b><span className="muted xs">{o.id} · {o.snap.storeName} · {fmtDate(o.placedAt)}</span></div><div className="mo-side"><StatusBadge o={o} /><span className="small">{money(o.total)}</span></div></button></li>)}</ul>
        </Section>
        <Section title="Recent notifications" action={<button className="linkbtn" onClick={() => nav({ page: 'notifications' })}>View all</button>}>
          <NotificationList compact items={notes} onOpen={n => nav(n.route)} />
        </Section>
      </div>}
  </>;
}

export function Cart() {
  const { db, me, nav, update, toast, perform } = useApp();
  const items = (db.carts[me.id] || []).map(ci => { const l = db.listings.find(x => x.id === ci.listingId); const pkg = l?.packages.find(p => p.id === ci.pkgId); return { ci, l, pkg, ok: l && pkg && isPublic(db, l) }; });
  const bySeller = {}; items.forEach(x => { const k = x.l?.storeId || 'gone'; (bySeller[k] = bySeller[k] || []).push(x); });
  const subtotal = items.filter(x => x.ok).reduce((a, x) => a + x.pkg.price * x.ci.count, 0);
  const setCount = (id, n) => perform('setCartCount', { itemId: id, count: n }, d => A.setCartCount(d, d.users[me.id], id, n));
  const remove = id => perform('removeCartItem', { itemId: id }, d => A.removeCartItem(d, d.users[me.id], id), 'Removed from cart');
  return <>
    <PageHead title="Cart" sub="Items from several sellers become separate orders under one purchase reference." back={{ label: 'Continue shopping', route: { page: 'home' } }} />
    {!items.length ? <Empty icon="cart" title="Your cart is empty" action={<Btn v="primary" onClick={() => nav({ page: 'home' })}>Browse products</Btn>}>Add packages from any listing and check out once.</Empty> :
      <div className="checkout-layout"><div className="stack">
        {Object.entries(bySeller).map(([sid, xs]) => { const st = db.stores[sid]; return <Section key={sid} title={<span className="row-gap"><Avatar name={st?.name || '?'} hue={st?.hue} size={24} square />{st?.name || 'Unavailable seller'}</span>}>
          <ul className="cart-list">{xs.map(({ ci, l, pkg, ok }) => <li key={ci.id} className={ok ? '' : 'unavail'}>
            {l && <ProductArt sub={l.sub} art={l.art} size="thumb" />}
            <div className="cl-main"><button className="linkbtn b" onClick={() => nav({ page: 'product', id: l.id, pkgId: pkg?.id, count: ci.count })}>{l?.title}</button>
              <span className="small">{pkg?.name} · {fmtN(pkg?.qty)} {l?.unit} per package</span>
              <span className="muted xs">Total {fmtN((pkg?.qty || 0) * ci.count)} {l?.unit} · Delivery {days(pkg?.days || 0)}</span>
              {!ok && <Badge tone="bad">Unavailable. Remove before checkout</Badge>}</div>
            <div className="cl-side"><Stepper value={ci.count} min={1} max={10} onChange={n => setCount(ci.id, n)} label="Package count" /><b>{money((pkg?.price || 0) * ci.count)}</b>
              <button className="linkbtn danger" onClick={() => remove(ci.id)}>Remove</button></div></li>)}</ul></Section>; })}
      </div>
        <aside><div className="card pad sticky">
          <h2>Summary</h2>
          <dl className="summary"><div><dt>Sellers</dt><dd>{Object.keys(bySeller).length}</dd></div><div><dt>Items</dt><dd>{items.length}</dd></div><div><dt>Subtotal</dt><dd>{money(subtotal)}</dd></div><div className="sum-total"><dt>Estimated total</dt><dd>{money(subtotal)} USD</dd></div></dl>
          <Btn v="primary" className="block" disabled={items.some(x => !x.ok)} onClick={() => nav({ page: 'checkout', fromCart: true })}>Proceed to checkout</Btn>
          {items.some(x => !x.ok) && <p className="ferr">Remove unavailable items to continue.</p>}
        </div></aside></div>}
  </>;
}

const OUTCOMES = [{ id: 'success', label: 'Success', tone: 'ok' }, { id: 'pending', label: 'Pending', tone: 'warn' }, { id: 'failure', label: 'Failure', tone: 'bad' }, { id: 'cancel', label: 'Cancelled' }];
export function Checkout() {
  const { db, me, route, nav, update, toast, perform, payMode, demoEnv } = useApp();
  useEffect(() => { if (!apiEnabled) update(d => refreshOfferExpiry(d)); }, []);
  // Outside the demo, only methods with a real provider behind them are offered.
  const METHODS = [['Card', 'wallet'], ['Crypto', 'layers'], ['bKash', 'phone'], ['Nagad', 'phone']].filter(([m]) => !apiEnabled || demoEnv || (m === 'Crypto' && payMode.startsWith('nowpayments')));
  useEffect(() => { if (METHODS.length && !METHODS.some(([m]) => m === method)) setMethod(METHODS[0][0]); });
  const lines = useMemo(() => {
    if (route.offerId) {
      const of = db.offers.find(o => o.id === route.offerId); if (!of) return [];
      const l = db.listings.find(x => x.id === of.listingId);
      return [{ key: of.id, l, offer: of, pkg: { name: 'Custom offer ' + of.id, desc: of.scope, qty: of.qty, price: of.price, days: of.days }, count: 1, ok: of.status === 'Accepted awaiting payment' && of.expiresAt > now() }];
    }
    const src = route.fromCart ? (db.carts[me.id] || []) : (route.items || []);
    return src.map((it, i) => { const l = db.listings.find(x => x.id === it.listingId); const pkg = l?.packages.find(p => p.id === it.pkgId); return { key: it.id || 'i' + i, cartId: it.id, l, pkg, count: it.count, ok: l && pkg && isPublic(db, l) && l.storeId !== me.storeId }; });
  }, [route, db]);
  const [reqs, setReqs] = useState({}); const [method, setMethod] = useState('Card'); const [outcome, setOutcome] = useState('success');
  const [terms, setTerms] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [card, setCard] = useState({ name: me.name, num: '4242 4242 4242 4242', exp: '12/28', cvc: '123' }); const [wallet, setWallet] = useState('+8801711000000'); const [net, setNet] = useState('USDT on Tron (TRC-20)');
  if (!lines.length) return <><PageHead title="Checkout" /><Empty icon="cart" title="Nothing to check out" action={<Btn onClick={() => nav({ page: 'home' })}>Browse products</Btn>} /></>;
  const sub = round2(lines.reduce((a, x) => a + x.pkg.price * x.count, 0)); const feeRate = db.settings.current.buyerFeeRate; const fee = round2(sub * feeRate); const total = round2(sub + fee);
  const sellers = new Set(lines.map(x => x.l.storeId)).size;
  const blocked = lines.some(x => !x.ok);
  // A real payment: the buyer pays on the provider's page and the order waits for its confirmation.
  const live = apiEnabled && payMode.startsWith('nowpayments') && method === 'Crypto';
  function pay() {
    if (!terms) return setErr('Accept the Terms and the delivery, replacement and refund terms to continue.');
    if (method === 'Card' && card.num.replace(/\s/g, '').length < 15) return setErr('Enter a valid card number.');
    if ((method === 'bKash' || method === 'Nagad') && wallet.replace(/\D/g, '').length < 10) return setErr('Enter the wallet number registered with ' + method + '.');
    const rs = activeRestriction(me, 'purchases'); if (rs) return setErr('Your account cannot place new orders right now: ' + rs.notice);
    setErr(''); setBusy(true);
    const args = { method, outcome, net: method === 'Crypto' ? net : null, cartIds: route.fromCart ? lines.map(x => x.cartId).filter(Boolean) : [], retryOf: route.retryOf || null,
      items: lines.map(x => x.offer ? { offerId: x.offer.id } : { listingId: x.l.id, pkgId: x.pkg.id, count: x.count, requirements: reqs[x.key] || '' }) };
    setTimeout(async () => {
      const r = await perform('checkout', args, d => {
        const id = newId(d, 'PG');
        const status = { success: 'Processing', pending: 'Pending', failure: 'Failed', cancel: 'Cancelled' }[outcome];
        d.purchases.unshift({ id, buyerId: me.id, at: now(), method, net: method === 'Crypto' ? net : null, subtotal: sub, fee, total, status,
          items: lines.map(x => ({ listingId: x.l.id, pkgId: x.pkg.id, count: x.count, requirements: reqs[x.key] || '', offerId: x.offer?.id, price: x.pkg.price, title: x.l.title, storeId: x.l.storeId })),
          fromCart: !!route.fromCart, cartIds: lines.map(x => x.cartId).filter(Boolean), ordersCreated: false, retryOf: route.retryOf || null, termsVersion: currentTerms(d) });
        startPayment(d, d.purchases[0]);
        if (outcome === 'success') completePurchase(d, id);
        if (outcome === 'failure') notify(d, me.id, 'buyer', `Payment ${id} failed (simulated). No charge was made.`, { page: 'pay-result', id });
        return { purchaseId: id };
      }, undefined, { inline: true });
      if (r.ok && live) {
        try { window.location.assign((await api.startPayment(r.value.purchaseId)).url); return; }
        catch (e) { toast(e.message || 'The payment page could not be opened. Try again from this page.', 'bad'); }
      }
      setBusy(false);
      if (r.ok) nav({ page: 'pay-result', id: r.value.purchaseId }); else setErr(r.error.message);
    }, apiEnabled ? 0 : 1100);
  }
  return <>
    <PageHead title="Checkout" sub={sellers > 1 ? `${sellers} sellers in this purchase. Each gets its own order and delivery.` : 'Review your purchase and pay.'} back={{ label: route.offerId ? 'Back to inbox' : route.fromCart ? 'Back to cart' : 'Back to product', route: route.offerId ? { page: 'inbox' } : route.fromCart ? { page: 'cart' } : { page: 'product', id: lines[0].l.id, pkgId: lines[0].pkg.id, count: lines[0].count } }} />
    <div className="checkout-layout"><div className="stack">
      <Section title="1. Items and requirements">
        <ul className="co-lines">{lines.map(x => { const st = db.stores[x.l.storeId]; return <li key={x.key}>
          <div className="co-h"><ProductArt sub={x.l.sub} art={x.l.art} size="thumb" /><div className="co-main"><b>{x.l.title}</b><span className="small">{x.pkg.name}{x.offer ? '' : ` × ${x.count}`} · {fmtN(x.pkg.qty * x.count)} {x.l.unit} · Delivery {days(x.pkg.days)}</span><span className="muted xs">Seller: {st.name}</span>
            {x.offer && <span className="small">{x.offer.scope}<br />Replacement: {x.offer.replacement}</span>}</div><b className="co-price">{money(x.pkg.price * x.count)}</b></div>
          {!x.ok && <Notice tone="bad" title={x.offer ? `Offer ${x.offer.id} cannot be purchased (${x.offer.expiresAt < now() ? 'expired' : x.offer.status})` : 'This item is no longer available'}>{x.offer ? 'Ask the seller for a new offer.' : 'Remove it from your cart to continue. Packages are never substituted silently.'}</Notice>}
          {x.l.requiresInfo && !x.offer && <Field label="Buyer requirements" hint={x.l.requirements + ' If left blank, the delivery clock waits until you provide it.'}><textarea rows="2" value={reqs[x.key] || ''} onChange={e => setReqs({ ...reqs, [x.key]: e.target.value })} /></Field>}
        </li>; })}</ul>
      </Section>
      <Section title="2. Payment method">
        <div className="pay-methods" role="radiogroup" aria-label="Payment method">{METHODS.map(([m, ic]) =>
          <label key={m} className={'pay-m' + (method === m ? ' on' : '')}><input type="radio" name="pm" checked={method === m} onChange={() => setMethod(m)} /><Icon n={ic} s={18} /><b>{m}</b></label>)}</div>
        {!METHODS.length && <Notice tone="warn" title="Payments are not available yet">No payment method is connected at the moment. Try again later or contact support.</Notice>}
        <div className="pay-detail">
          {method === 'Card' && <div className="form-grid"><Field label="Name on card"><input value={card.name} onChange={e => setCard({ ...card, name: e.target.value })} /></Field><Field label="Card number" hint="Demo number prefilled"><input inputMode="numeric" value={card.num} onChange={e => setCard({ ...card, num: e.target.value })} /></Field><Field label="Expiry"><input value={card.exp} onChange={e => setCard({ ...card, exp: e.target.value })} /></Field><Field label="CVC"><input value={card.cvc} onChange={e => setCard({ ...card, cvc: e.target.value })} /></Field></div>}
          {method === 'Crypto' && live && <div><p className="small">You pay on the NOWPayments page, where you choose the coin and network and get the exact amount and address. Your order is created when the network confirms the full payment, usually within a few minutes.</p>
            <p className="xs muted">Send the exact amount shown there. Underpayments and late payments are reviewed by our finance team instead of completing the order.</p></div>}
          {method === 'Crypto' && !live && <div><Field label="Network and asset"><select value={net} onChange={e => setNet(e.target.value)}>{['USDT on Tron (TRC-20)', 'USDT on Ethereum (ERC-20)', 'USDC on Base'].map(n => <option key={n}>{n}</option>)}</select></Field>
            <KV items={[['Exact amount', <b>{total.toFixed(2)} {net.split(' ')[0]}</b>], ['Deposit address', <code className="addr">TQ7f…demo…9xKp (not a real address)</code>], ['Memo', 'Not required'], ['Quote expires', '30 minutes after you press Pay']]} />
            <p className="xs muted">Underpayment, overpayment or the wrong network go to a manual exception process instead of completing the order.</p></div>}
          {(method === 'bKash' || method === 'Nagad') && <Field label={`${method} wallet number`} hint={`You would approve the payment in the ${method} app. Nothing is sent in this prototype.`}><input type="tel" value={wallet} onChange={e => setWallet(e.target.value)} /></Field>}
        </div>
        {!live && <div className="sim-box"><div><b>Demo outcome</b> <Sim>Simulated provider response</Sim><p className="xs muted">Choose what the payment provider returns.</p></div><Seg label="Payment outcome" options={OUTCOMES} value={outcome} onChange={setOutcome} /></div>}
      </Section>
    </div>
      <aside><div className="card pad sticky">
        <h2>3. Purchase summary</h2>
        <dl className="summary">{lines.map(x => <div key={x.key}><dt className="trunc">{x.pkg.name}{x.count > 1 ? ' × ' + x.count : ''} <span className="muted xs block">{db.stores[x.l.storeId].name}</span></dt><dd>{money(x.pkg.price * x.count)}</dd></div>)}
          <div><dt>Subtotal</dt><dd>{money(sub)}</dd></div>{feeRate > 0 && <div><dt>Service fee ({feeRate * 100}%)</dt><dd>{money(fee)}</dd></div>}<div><dt>Taxes</dt><dd className="muted">Not configured</dd></div>
          <div className="sum-total"><dt>Total</dt><dd>{money(total)} USD</dd></div></dl>
        <label className="checkline"><input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)} /><span>I accept the <a href="#" onClick={e => { e.preventDefault(); nav({ page: 'terms' }); }}>Terms</a> and the <a href="#" onClick={e => { e.preventDefault(); nav({ page: 'policies' }); }}>delivery, replacement and refund terms</a> ({TERMS_VERSION}).</span></label>
        {err && <p className="ferr" role="alert">{err}</p>}
        <Btn v="primary" className="block lg" disabled={busy || blocked || !METHODS.length} onClick={pay}>{busy ? <><span className="spin" />{live ? 'Opening payment page…' : 'Processing payment…'}</> : live ? `Continue to pay ${money(total)}` : `Pay ${money(total)} (simulated)`}</Btn>
        <p className="xs muted center">{live ? `This is a real payment${payMode.endsWith('sandbox') ? ' in the provider’s test environment' : ''}. ` : 'No real payment is taken. '}A browser redirect alone never marks an order paid.</p>
      </div></aside></div>
  </>;
}

export function PayResult() {
  const { db, route, nav, me, perform, toast } = useApp(); const [opening, setOpening] = useState(false);
  const p = db.purchases.find(x => x.id === route.id && x.buyerId === me.id);
  const openProvider = async () => { setOpening(true); try { window.location.assign((await api.startPayment(p.id)).url); } catch (e) { toast(e.message || 'The payment page could not be opened.', 'bad'); setOpening(false); } };
  if (!p) return <ErrorState title="Payment not found">This payment reference does not belong to your account.</ErrorState>;
  const retry = () => { const it = p.items; nav(it[0].offerId ? { page: 'checkout', offerId: it[0].offerId } : p.fromCart ? { page: 'checkout', fromCart: true } : { page: 'checkout', items: it.map(i => ({ listingId: i.listingId, pkgId: i.pkgId, count: i.count })), retryOf: p.id }); };
  const orders = (p.orderIds || []).map(id => db.orders.find(o => o.id === id));
  return <div className="result-page">
    {p.status === 'Paid' && <><div className="result-ic ok"><Icon n="check" s={34} /></div><h1>Payment confirmed</h1><p className="muted">Reference <code>{p.id}</code> · {p.method} · {fmtDT(p.at)} {p.provider ? '· verified by ' + p.provider : <Sim />}</p>
      <Section title={`${orders.length} order${orders.length > 1 ? 's' : ''} created`}>
        <Table cols={[{ k: 'id', label: 'Order', render: o => <b>{o.id}</b> }, { k: 's', label: 'Seller', render: o => o.snap.storeName }, { k: 'p', label: 'Package', render: o => o.snap.pkgName }, { k: 'a', label: 'Allocation', cls: 'num', render: o => money(o.total) }, { k: 'st', label: 'Status', render: o => <StatusBadge o={o} /> }]} rows={orders} onRow={o => nav({ page: 'u-order', id: o.id })} />
        <p className="xs muted">Total charged {money(p.total)}. Each order shows only its own allocation; no seller charged the full amount.</p></Section>
      <div className="row-gap center"><Btn v="primary" onClick={() => nav(orders.length === 1 ? { page: 'u-order', id: orders[0].id } : { page: 'u-orders' })}>View {orders.length === 1 ? 'order' : 'orders'}</Btn><Btn onClick={() => nav({ page: 'home' })}>Continue shopping</Btn></div></>}
    {p.status === 'Pending' && p.provider && <><div className="result-ic warn"><Icon n="clock" s={34} /></div><h1>Waiting for your payment</h1><p className="muted">Reference <code>{p.id}</code>. {p.provider} has not confirmed this payment yet. No order exists until it does.</p>
      <Notice tone="info" title="What happens next">If you have already sent the payment, keep this page open: it updates by itself once the network confirms it, usually within a few minutes. If you have not paid yet, continue to the payment page.</Notice>
      <div className="row-gap center"><Btn v="primary" disabled={opening} onClick={openProvider}>{opening ? 'Opening payment page…' : 'Continue to payment page'}</Btn><Btn onClick={() => nav({ page: 'help', form: true })}>Contact support</Btn></div></>}
    {p.status === 'Pending' && !p.provider && <><div className="result-ic warn"><Icon n="clock" s={34} /></div><h1>Payment pending</h1><p className="muted">Reference <code>{p.id}</code>. The provider has not confirmed this payment yet. No order exists until it does.</p>
      <Notice tone="info" title="Demo controls">Simulate what the provider sends next. Confirming twice never creates duplicate orders.</Notice>
      <div className="row-gap center"><Btn v="primary" onClick={() => perform('confirmPayment', { purchaseId: p.id }, d => completePurchase(d, p.id))}>Simulate provider confirmation</Btn><Btn onClick={() => perform('expirePayment', { purchaseId: p.id }, d => { d.purchases.find(x => x.id === p.id).status = 'Expired'; })}>Simulate expiry</Btn></div></>}
    {p.status === 'Failed' && <><div className="result-ic bad"><Icon n="x" s={34} /></div><h1>Payment failed</h1><p className="muted">Reference <code>{p.id}</code>. The provider declined the payment. You were not charged and no order was created.</p>
      <div className="row-gap center"><Btn v="primary" icon="refresh" onClick={retry}>Try again</Btn><Btn onClick={() => nav({ page: 'help', form: true })}>Contact support</Btn></div></>}
    {p.status === 'Cancelled' && <><div className="result-ic"><Icon n="x" s={34} /></div><h1>Payment cancelled</h1><p className="muted">You cancelled at the provider. Reference <code>{p.id}</code>. Nothing was charged; your selection is kept.</p>
      <div className="row-gap center"><Btn v="primary" onClick={retry}>Return to checkout</Btn><Btn onClick={() => nav({ page: 'cart' })}>View cart</Btn></div></>}
    {p.status === 'Expired' && <><div className="result-ic"><Icon n="clock" s={34} /></div><h1>Payment expired</h1><p className="muted">Reference <code>{p.id}</code> expired before confirmation. A late payment would go to reconciliation, not straight to an order.</p>
      <div className="row-gap center"><Btn v="primary" onClick={retry}>Start a new payment</Btn></div></>}
  </div>;
}

const BTABS = [{ id: 'running', label: 'Running' }, { id: 'completed', label: 'Completed' }, { id: 'cancelled', label: 'Cancelled or refunded' }];
export function UOrders() {
  const { db, me, route, nav } = useApp();
  const [tab, setTab] = useState(route.tab || 'running'); const [q, setQ] = useState(''); const [status, setStatus] = useState(route.status || ''); const [sort, setSort] = useState('new');
  const mine = db.orders.filter(o => o.buyerId === me.id);
  const rows = mine.filter(o => buyerGroup(o) === tab && (!status || o.status === status) && (!q || (o.id + o.snap.title + o.snap.storeName).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => sort === 'new' ? b.placedAt - a.placedAt : a.placedAt - b.placedAt);
  const statuses = [...new Set(mine.filter(o => buyerGroup(o) === tab).map(o => o.status))];
  return <>
    <PageHead title="Purchase orders" sub="Every order keeps the package and terms you bought, even if the listing changes later." />
    <Tabs tabs={BTABS.map(t => ({ ...t, count: mine.filter(o => buyerGroup(o) === t.id).length }))} value={tab} onChange={t => { setTab(t); setStatus(''); }} />
    <div className="toolbar"><div className="searchbox"><Icon n="search" s={16} /><input aria-label="Search orders" placeholder="Order number, product or seller" value={q} onChange={e => setQ(e.target.value)} /></div>
      <select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
      <select aria-label="Sort by date" value={sort} onChange={e => setSort(e.target.value)}><option value="new">Newest first</option><option value="old">Oldest first</option></select></div>
    <Table rows={rows} onRow={o => nav({ page: 'u-order', id: o.id })} empty={<Empty icon="receipt" title={q || status ? 'No orders match' : 'No orders in this view'}>{q || status ? 'Clear the search or status filter.' : 'Orders move here as their status changes.'}</Empty>}
      cols={[{ k: 'id', label: 'Order', render: o => <><b>{o.id}</b><span className="muted xs block">{fmtDate(o.placedAt)}</span></> },
        { k: 'p', label: 'Product', render: o => <><span className="trunc2">{o.snap.title}</span><span className="muted xs block">{o.snap.pkgName} · {fmtN(o.totalQty)} {o.snap.unit}</span></> },
        { k: 's', label: 'Seller', render: o => o.snap.storeName }, { k: 'a', label: 'Amount', cls: 'num', render: o => money(o.total) },
        { k: 'd', label: 'Due', render: o => ['completed', 'cancelled', 'refunded'].includes(o.status) ? '—' : <span className={isOverdue(o) ? 'bad-t' : ''}>{fmtDate(o.dueAt)}{isOverdue(o) ? ' · overdue' : ''}</span> },
        { k: 'st', label: 'Status', render: o => <div className="badges"><StatusBadge o={o} />{openCase(db, o) && <Badge tone="warn">Case open</Badge>}</div> },
        { k: 'v', label: '', render: o => <Btn size="sm" onClick={() => nav({ page: 'u-order', id: o.id })}>View order</Btn> }]} />
  </>;
}

export function Invoice({ o, onClose }) {
  const { db, toast } = useApp(); const buyer = db.users[o.buyerId]; const st = db.stores[o.storeId];
  const p = db.purchases.find(p => p.id === o.purchaseRef); const siblings = p ? p.orderIds.map(id => db.orders.find(x => x.id === id)) : [o];
  return <Modal wide title={`Invoice preview INV-${o.id.slice(4)}`} onClose={onClose} footer={<><Btn v="ghost" onClick={onClose}>Close</Btn><Btn icon="download" onClick={() => toast('PDF download is not available in this prototype', 'info')}>Download PDF</Btn></>}>
    <div className="invoice">
      <div className="inv-h"><div><b className="inv-brand">Crateline</b><span className="muted xs block">Issuer and tax details: commercial decision pending</span></div><div className="right"><b>INV-{o.id.slice(4)}</b><span className="xs block">Issued {fmtDT(o.placedAt)}</span><Badge tone={o.payment.status === 'Paid' ? 'ok' : 'warn'}>{o.payment.status}</Badge></div></div>
      <div className="inv-parties"><div><span className="muted xs">Billed to</span><b className="block">{buyer.name}</b><span className="small">{buyer.email}</span></div><div><span className="muted xs">Seller</span><b className="block">{st.name}</b><span className="small">{st.country}</span></div><div><span className="muted xs">References</span><span className="small block">Order {o.id}</span><span className="small block">Purchase {o.purchaseRef}</span><span className="small block">Payment {o.payment.ref} · {o.payment.method}</span></div></div>
      <table className="inv-t"><thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead><tbody>
        <tr><td>{o.snap.title}<span className="muted xs block">{o.snap.pkgName}: {o.snap.pkgDesc} ({fmtN(o.snap.qty)} {o.snap.unit})</span></td><td className="num">{o.count}</td><td className="num">{money(o.snap.price)}</td><td className="num">{money(o.subtotal)}</td></tr>
        {o.fee > 0 && <tr><td>Service fee</td><td /><td /><td className="num">{money(o.fee)}</td></tr>}
        {o.refund && <tr><td>Refund ({o.refund.state})</td><td /><td /><td className="num">−{money(o.refund.amount)}</td></tr>}
      </tbody><tfoot><tr><td colSpan="3">Paid for this order (USD)</td><td className="num"><b>{money(o.total)}</b></td></tr></tfoot></table>
      {siblings.length > 1 && <p className="small">This order is one allocation of purchase {o.purchaseRef}, total charge {money(p.total)} across {siblings.length} orders ({siblings.map(s => s.id + ' ' + money(s.total)).join(', ')}).</p>}
      <p className="xs muted">Simulated document for demonstration. Accepted terms: {o.termsVersion}.</p>
    </div></Modal>;
}

function SecureAccess() {
  const [show, setShow] = useState(false);
  return <div className="secure"><div className="row-between"><b className="small"><Icon n="lock" s={14} /> Secure access details</b><button className="linkbtn" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Reveal'}</button></div>
    <code>{show ? 'host: demo-access.example  ·  user: buyer_ord  ·  pass: Demo-Only-7731' : '••••••••••••••••••••••••••••••'}</code><span className="xs muted">Sample credentials. Visible only inside this order.</span></div>;
}
export function Deliveries({ o }) {
  if (!o.deliveries.length) return <p className="muted small">No delivery yet. Files and access details will appear here, visible only to you and the seller.</p>;
  return <ol className="deliveries">{[...o.deliveries].reverse().map((dl, i) => <li key={dl.v} className={i ? 'old' : ''}>
    <div className="dl-h"><b>Version {dl.v}</b><Badge tone={dl.kind === 'Replacement' ? 'info' : 'accent'}>{dl.kind}</Badge>{i > 0 && <Badge tone="muted">Previous version</Badge>}<span className="muted xs">{fmtDT(dl.at)}</span></div>
    <p className="small">{dl.note}</p><span className="xs">Quantity delivered: <b>{fmtN(dl.qty)} {o.snap.unit}</b></span>
    {dl.file && <FileChip f={dl.file} locked />}
    {o.snap.deliveryMethod === 'Secure access information' && i === 0 && <SecureAccess />}</li>)}</ol>;
}

export function UOrder() {
  const { db, route, me, nav, update, toast, perform } = useApp();
  const o = db.orders.find(x => x.id === route.id);
  const [modal, setModal] = useState(null); const [info, setInfo] = useState(''); const [rv, setRv] = useState({ rating: 5, text: '' });
  if (!o || o.buyerId !== me.id) return <ErrorState title="Order not available">This order does not exist or belongs to another account. Private records are only shown to their buyer and seller.</ErrorState>;
  const st = db.stores[o.storeId]; const kase = o.caseId && db.cases.find(c => c.id === o.caseId); const caseOpen = openCase(db, o);
  // Order transition: server action `name` in API mode, `fn(d, order)` in demo mode.
  const act = (name, args, fn, msg) => perform(name, { orderId: o.id, ...args }, d => fn(d, d.orders.find(x => x.id === o.id)), msg);
  const canCancel = ['paid', 'preparing', 'awaiting_info'].includes(o.status) && !o.deliveries.length && !(o.cancelRequest?.state === 'Requested');
  const canReport = !caseOpen && !['cancelled', 'refunded'].includes(o.status) && o.status !== 'awaiting_info';
  const canReplace = (o.status === 'delivered') && !caseOpen;
  return <>
    <PageHead back={{ label: 'Purchase orders', route: { page: 'u-orders' } }} title={<span className="row-gap wrap-gap">{o.id}<StatusBadge o={o} />{isOverdue(o) && <Badge tone="bad">Overdue</Badge>}{kase && <Badge tone={CASE_TONE[kase.status]}>Case {kase.status}</Badge>}{o.refund && <Badge tone={o.refund.state === 'Processing' ? 'warn' : 'muted'}>Refund {o.refund.state.toLowerCase()}</Badge>}</span>}
      sub={`${o.snap.title} · placed ${fmtDT(o.placedAt)}`}
      actions={<><Btn icon="chat" onClick={async () => { const r = await perform('orderConversation', { orderId: o.id }, d => ({ conversationId: A.orderConversation(d, d.users[me.id], d.orders.find(x => x.id === o.id)) })); if (r.ok) nav({ page: 'inbox', id: r.value.conversationId }); }}>Message seller</Btn><Btn icon="receipt" onClick={() => setModal('invoice')}>Preview invoice</Btn></>} />
    <Section><Progress o={o} /></Section>

    {o.status === 'awaiting_info' && o.infoRequest && <Notice tone="warn" title="The seller needs information before starting">{o.infoRequest.text}
      <div className="inline-form"><textarea rows="2" aria-label="Your answer" value={info} onChange={e => setInfo(e.target.value)} placeholder="Add the requested details" /><Btn v="primary" size="sm" disabled={!info.trim()} onClick={async () => { const r = await perform('submitInfo', { orderId: o.id, text: info.trim() }, d => A.submitInfo(d, d.orders.find(x => x.id === o.id), info), 'Information sent. Delivery clock started'); if (r.ok) setInfo(''); }}>Submit information</Btn></div></Notice>}
    {o.extension?.state === 'Requested' && <Notice tone="warn" title={`Seller requests ${o.extension.days} more days`} action={<div className="row-gap"><Btn size="sm" v="primary" onClick={() => act('respondExtension', { accept: true }, (d, x) => A.respondExtension(d, x, true), 'Extension accepted')}>Accept</Btn><Btn size="sm" onClick={() => act('respondExtension', { accept: false }, (d, x) => A.respondExtension(d, x, false), 'Extension rejected')}>Reject</Btn></div>}>Reason: {o.extension.reason}. New deadline would be {fmtDT(o.extension.newDue)}.</Notice>}
    {o.cancelRequest?.state === 'Requested' && o.cancelRequest.by === 'seller' && <Notice tone="warn" title="Seller requested cancellation" action={<div className="row-gap"><Btn size="sm" v="primary" onClick={() => act('respondCancel', { accept: true }, (d, x) => A.respondCancel(d, x, true, 'Buyer'), 'Cancellation accepted. Refund requested')}>Accept and refund</Btn><Btn size="sm" onClick={() => act('respondCancel', { accept: false }, (d, x) => A.respondCancel(d, x, false, 'Buyer'), 'Cancellation declined')}>Decline</Btn></div>}>{o.cancelRequest.reason}</Notice>}
    {o.cancelRequest?.state === 'Requested' && o.cancelRequest.by === 'buyer' && <Notice tone="info" title="Cancellation requested">Waiting for the seller to accept or contest. Reason: {o.cancelRequest.reason}</Notice>}
    {o.status === 'delivered' && !caseOpen && <Notice tone="accent" title="Delivery awaiting your confirmation" action={<div className="row-gap"><Btn v="primary" size="sm" onClick={() => setModal('confirm')}>Confirm order received</Btn><Btn size="sm" onClick={() => setModal('replace')}>Request replacement</Btn></div>}>Check the files below. Automatic completion is off in this prototype, so the order stays open until you confirm or report a problem.</Notice>}
    {o.replacement?.state === 'Requested' && <Notice tone="info" title="Replacement requested">The seller is preparing a new delivery version. Earlier versions stay visible. Reason: {o.replacement.reason}</Notice>}
    {caseOpen && <Notice tone="warn" title={`Case ${caseOpen.id}: ${caseOpen.status}`} action={<Btn size="sm" onClick={() => nav({ page: 'case', id: caseOpen.id })}>Open case</Btn>}>Order actions continue in the Resolution Center.</Notice>}
    {o.status === 'completed' && !o.review && db.settings.current.features.reviews && <Section title="Rate this purchase"><StarInput value={rv.rating} onChange={r => setRv({ ...rv, rating: r })} /><Field label="Written feedback" hint="Shown on the listing without your full name"><textarea rows="2" value={rv.text} onChange={e => setRv({ ...rv, text: e.target.value })} /></Field>
      <Btn v="primary" size="sm" disabled={rv.text.trim().length < 5} onClick={() => perform('submitReview', { orderId: o.id, rating: rv.rating, text: rv.text }, d => A.submitReview(d, d.users[me.id], d.orders.find(y => y.id === o.id), rv.rating, rv.text), 'Review published')}>Publish review</Btn></Section>}
    {o.review && <Notice tone="ok" title="Your review"><Stars value={o.review.rating} small /> {o.review.text}</Notice>}

    <div className="order-grid">
      <div className="stack">
        <Section title="Delivery"><Deliveries o={o} />{o.deliveries.length > 0 && o.totalQty > deliveredQty(o) && o.status !== 'cancelled' && <p className="small">Delivered {fmtN(deliveredQty(o))} of {fmtN(o.totalQty)} {o.snap.unit}. {fmtN(o.totalQty - deliveredQty(o))} remaining.</p>}</Section>
        <Section title="Activity"><Timeline events={o.events} /></Section>
      </div>
      <div className="stack">
        <Section title="Purchased package"><div className="row-gap"><ProductArt sub={o.snap.sub} art={o.snap.art} size="thumb" /><div><b className="small">{o.snap.pkgName}</b><span className="muted xs block">{o.snap.pkgDesc}</span></div></div>
          <KV items={[['Quantity', `${o.count} × ${fmtN(o.snap.qty)} = ${fmtN(o.totalQty)} ${o.snap.unit}`], ['Delivery method', o.snap.deliveryMethod], ['Delivery deadline', <span className={isOverdue(o) ? 'bad-t' : ''}>{fmtDT(o.dueAt)}</span>], ['Replacement terms', o.snap.replacement], ['Your requirements', o.requirements || <span className="muted">None provided</span>], o.fromOfferId && ['Custom offer', o.fromOfferId]]} />
          <p className="xs muted">Terms frozen at purchase. Later listing edits do not change this order.</p></Section>
        <Section title="Seller"><div className="row-gap"><Avatar name={st.name} hue={st.hue} size={36} square /><div><button className="linkbtn b" onClick={() => nav({ page: 'store', id: st.id })}>{st.name}</button><span className="muted xs block">{st.tagline}</span></div></div></Section>
        <Section title="Payment"><KV items={[['Method', <>{o.payment.method} <Sim /></>], ['Status', <Badge tone={o.payment.status === 'Paid' ? 'ok' : 'bad'}>{o.payment.status}</Badge>], ['Subtotal', money(o.subtotal)], o.fee > 0 && ['Service fee', money(o.fee)], o.refund && ['Refund', `${money(o.refund.amount)} · ${o.refund.state}`], ['Paid', <b>{money(o.total)} USD</b>], ['Purchase ref', o.purchaseRef]]} /></Section>
        <Section title="Actions"><div className="action-list">
          <Btn icon="check" v="primary" disabled={o.status !== 'delivered' || !!caseOpen} onClick={() => setModal('confirm')}>Confirm order received</Btn>
          <Btn icon="refresh" disabled={!canReplace} onClick={() => setModal('replace')}>Request replacement</Btn>
          <Btn icon="flag" disabled={!canReport} onClick={() => setModal('report')}>Report order</Btn>
          <Btn icon="x" v="ghost" disabled={!canCancel} onClick={() => setModal('cancel')}>Request cancellation</Btn>
          <p className="xs muted">Only actions valid for the current status are enabled.</p></div></Section>
      </div>
    </div>
    {modal === 'invoice' && <Invoice o={o} onClose={() => setModal(null)} />}
    {modal === 'confirm' && <ConfirmReceived onClose={() => setModal(null)} onDone={() => perform('confirmReceived', { orderId: o.id }, d => A.confirmReceived(d, d.orders.find(x => x.id === o.id)), 'Order completed. Thanks for confirming')} />}
    {modal === 'replace' && <ReasonModal title="Request a replacement" label="What is wrong with the delivery?" files cta="Send request" hint={`Policy: ${o.snap.replacement}`} onClose={() => setModal(null)} onDone={(r, f) => perform('requestReplacement', { orderId: o.id, reason: r, files: f }, d => A.requestReplacement(d, d.orders.find(x => x.id === o.id), r, f), 'Replacement requested')} />}
    {modal === 'cancel' && <ReasonModal title="Request cancellation" label="Reason for cancelling" cta="Send request" hint="The seller can accept or contest. If accepted, the full amount is refunded." onClose={() => setModal(null)} onDone={r => act('requestCancel', { reason: r }, (d, x) => A.requestCancel(d, x, 'buyer', r), 'Cancellation requested')} />}
    {modal === 'report' && <ReportModal o={o} onClose={() => setModal(null)} />}
  </>;
}
function A_conv(d, o) { const c = d.conversations.find(c => c.buyerId === o.buyerId && c.storeId === o.storeId); if (c) { c.orderId = c.orderId || o.id; return c; } const nc = { id: 'c' + (d.conversations.length + 10), buyerId: o.buyerId, storeId: o.storeId, listingId: o.snap.listingId, orderId: o.id, unread: { buyer: 0, seller: 0 }, hidden: {}, blocked: false, messages: [] }; d.conversations.unshift(nc); return nc; }

function ConfirmReceived({ onClose, onDone }) {
  const [ok, setOk] = useState(false);
  return <Modal title="Confirm order received" onClose={onClose} footer={<><Btn v="ghost" onClick={onClose}>Cancel</Btn><Btn v="primary" disabled={!ok} onClick={() => { onDone(); onClose(); }}>Confirm and complete</Btn></>}>
    <p>Confirming completes the order and starts the release of funds to the seller.</p>
    <label className="checkline"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /><span>I have reviewed the delivery and it matches the purchased package.</span></label></Modal>;
}
export function ReasonModal({ title, label, hint, cta, files: withFiles, onClose, onDone }) {
  const [r, setR] = useState(''); const [files, setFiles] = useState([]);
  return <Modal title={title} onClose={onClose} footer={<><Btn v="ghost" onClick={onClose}>Cancel</Btn><Btn v="primary" disabled={r.trim().length < 5} onClick={() => { onDone(r.trim(), files); onClose(); }}>{cta}</Btn></>}>
    {hint && <p className="muted small">{hint}</p>}
    <Field label={label} required hint="At least 5 characters"><textarea rows="3" value={r} onChange={e => setR(e.target.value)} /></Field>
    {withFiles && <FilePicker upload files={files} setFiles={setFiles} label="Attach evidence" />}</Modal>;
}
function ReportModal({ o, onClose }) {
  const { nav, perform } = useApp(); const [busy, setBusy] = useState(false);
  const [v, setV] = useState({ reason: 'Delivery does not match description', outcome: 'Replacement', description: '' }); const [files, setFiles] = useState([]);
  return <Modal title={`Report ${o.id}`} onClose={onClose} footer={<><Btn v="ghost" onClick={onClose}>Cancel</Btn><Btn v="primary" disabled={busy || v.description.trim().length < 15} onClick={async () => { setBusy(true); const r = await perform('openCase', { orderId: o.id, ...v, files }, d => ({ caseId: A.createCase(d, d.orders.find(x => x.id === o.id), { ...v, files }) })); setBusy(false); if (!r.ok) return; onClose(); nav({ page: 'case', id: r.value.caseId }); }}>{busy ? 'Opening case…' : 'Open case'}</Btn></>}>
    <p className="muted small">A case is shared with the seller. Funds for this order are reserved until it is resolved.</p>
    <div className="form-grid"><Field label="Reason"><select value={v.reason} onChange={e => setV({ ...v, reason: e.target.value })}>{['Delivery does not match description', 'Items not working', 'Not delivered on time', 'Partial delivery', 'Other'].map(x => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Requested outcome"><select value={v.outcome} onChange={e => setV({ ...v, outcome: e.target.value })}>{['Replacement', 'Partial refund', 'Full refund', 'Revised delivery'].map(x => <option key={x}>{x}</option>)}</select></Field></div>
    <Field label="Describe the problem" required hint="At least 15 characters. Be specific: which records or items, and how you checked."><textarea rows="4" value={v.description} onChange={e => setV({ ...v, description: e.target.value })} /></Field>
    <FilePicker upload files={files} setFiles={setFiles} label="Attach evidence" /></Modal>;
}

export function Following() {
  const { db, me, nav, update, toast, perform } = useApp();
  const stores = me.following.map(id => db.stores[id]).filter(Boolean);
  return <><PageHead title="Followed sellers" sub="Stores you follow. New listings from them appear in your notifications." />
    {!stores.length ? <Empty icon="heart" title="You are not following any sellers" action={<Btn onClick={() => nav({ page: 'home' })}>Browse sellers</Btn>}>Follow a seller from their store or a product page.</Empty> :
      <div className="follow-grid">{stores.map(st => { const n = db.listings.filter(l => l.storeId === st.id && isPublic(db, l)).length; return <div key={st.id} className="card pad follow-card">
        <div className="row-gap"><Avatar name={st.name} hue={st.hue} size={44} square /><div><b>{st.name}</b><span className="muted xs block">{st.tagline}</span></div></div>
        <span className="small">{n} active products</span>
        <div className="row-gap"><Btn size="sm" v="primary" onClick={() => nav({ page: 'store', id: st.id })}>Visit store</Btn><Btn size="sm" v="ghost" onClick={() => { perform('setFollow', { storeId: st.id, on: false }, d => A.setFollow(d, d.users[me.id], st.id, false), 'Unfollowed ' + st.name); }}>Unfollow</Btn></div></div>; })}</div>}</>;
}

export function SupportPage() {
  const { db, me } = useApp(); const mine = db.tickets.filter(t => t.userId === me.id);
  return <><PageHead title="Support" sub="Contact marketplace support and see your request history." />
    <div className="two-col"><SupportForm /><Section title="Request history">{mine.length ? <ul className="tickets">{mine.map(t => <li key={t.id}><b>{t.id}</b> <Badge tone="info">{t.status}</Badge><span className="small block">{t.subject || t.cat}</span><span className="muted xs">{fmtDT(t.at)}</span></li>)}</ul> : <p className="muted small">No support requests yet.</p>}</Section></div></>;
}
