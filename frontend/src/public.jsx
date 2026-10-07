import React from 'react';
import { now } from '@crateline/domain/clock.js';
import { CATEGORIES, SUBS, SERVICE_FEE } from '@crateline/domain/data.js';
import { money, fmtN, fmtDate, days, listingStats, storeStats, startPrice, minDays, isPublic, convFor, pushMsg, notify, newId, rel } from '@crateline/domain/logic.js';
import { Icon, Btn, Badge, Avatar, Stars, ProductArt, ProductCard, PackageSelector, Modal, Empty, SkeletonGrid, Field, Notice, Sim, useApp, Seg } from './ui.jsx';
import { SearchBox } from './shell.jsx';
import { apiEnabled, api } from './api.js';
import { MfaCodeStep } from './auth.jsx';
import * as AX from '@crateline/domain/actions.js';
const { useState, useEffect, useMemo } = React;

const TRENDING = ['B2B database', 'VPS', 'PPC calls', 'Toll free numbers', 'Targeted leads', 'Remote desktop'];

export function Home() {
  const { db, nav } = useApp();
  const pub = db.listings.filter(l => isPublic(db, l));
  const trending = [...pub].sort((a, b) => b.sold - a.sold).slice(0, 8);
  const fresh = [...pub].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  const banners = db.content.banners.filter(b => b.state === 'Active' && b.start <= now() && b.end >= now()).sort((a, b) => a.order - b.order);
  return <>
    <section className="hero"><div className="wrap"><div className="hero-grid">
      <div className="hero-copy">
        <span className="eyebrow">Digital products and services marketplace</span>
        <h1>Data, infrastructure and outreach services from verified sellers</h1>
        <p className="lead">Compare packages, buy with protected checkout, and get deliveries inside your order with a Resolution Center if something is wrong.</p>
        <SearchBox big />
        <div className="suggest"><span className="muted small">Popular:</span>{TRENDING.map(t => <button key={t} className="chip" onClick={() => nav({ page: 'search', q: t })}>{t}</button>)}</div>
      </div>
      <div className="hero-board" aria-label="Marketplace activity sample">
        {trending.slice(0, 3).map((l, i) => { const st = db.stores[l.storeId]; return <button key={l.id} className={'hb-card hb-' + i} onClick={() => nav({ page: 'product', id: l.id })}>
          <ProductArt sub={l.sub} art={l.art} size="thumb" /><div><b>{l.title}</b><span className="muted xs">{st.name} · from {money(startPrice(l))}</span></div></button>; })}
        <div className="hb-stat"><b>{fmtN(db.orders.length + 9411)}</b><span className="xs">orders delivered through Crateline (sample)</span></div>
      </div>
    </div></div></section>

    {banners.length > 0 && <section className="wrap blk banners">{banners.map(b => <button key={b.id} className="banner-pv" style={{ '--h': b.hue }} onClick={() => { const [t, v] = b.link.split(':'); if (t === 'search') nav({ page: 'search', cat: v }); else if (t === 'product') nav({ page: 'product', id: v }); else if (t === 'store') nav({ page: 'store', id: v }); else if (t === 'page') nav({ page: v }); }}><b>{b.title}</b><span className="small">{b.sub}</span></button>)}</section>}
    <section className="wrap blk">
      <div className="block-h"><h2>Explore categories</h2></div>
      <div className="cat-grid">{CATEGORIES.filter(c => c.active).map(c => {
        const n = pub.filter(l => l.cat === c.id).length;
        return <div key={c.id} className="cat-card" style={{ '--h': { data: 172, accounts: 212, server: 262, services: 28 }[c.id] }}>
          <button className="cat-head" onClick={() => nav({ page: 'search', cat: c.id })}><span className="cat-ic"><Icon n={c.icon} s={22} /></span><div><b>{c.name}</b><span className="muted xs block">{n} offers · {c.blurb}</span></div></button>
          <div className="cat-subs">{c.subs.filter(s => s.active).map(s => <button key={s.id} className="chip sm" onClick={() => nav({ page: 'search', cat: c.id, sub: s.id })}>{s.name}</button>)}</div>
        </div>; })}</div>
    </section>

    <section className="wrap blk">
      <div className="block-h"><h2>Trending digital products</h2><button className="linkbtn" onClick={() => nav({ page: 'search', sort: 'popular' })}>View all <Icon n="right" s={14} /></button></div>
      <p className="muted small block-sub">Ranked by recent completed orders. Cancelled and refunded orders are excluded.</p>
      <div className="grid-cards">{trending.map(l => <ProductCard key={l.id} l={l} />)}</div>
    </section>

    <section className="wrap blk trust">
      {[['shield', 'Payment held until delivery', 'Sellers are paid after you confirm receipt or the release period ends.'], ['file', 'Private delivery inside each order', 'Files and access details stay in your order, visible only to you and the seller.'], ['scale', 'Resolution Center', 'Report an order, attach evidence, and agree a replacement or refund with the seller.']].map(([i, t, d]) =>
        <div key={t} className="trust-i"><Icon n={i} s={22} /><div><b>{t}</b><p className="muted small">{d}</p></div></div>)}
    </section>

    <section className="wrap blk">
      <div className="block-h"><h2>Newly listed</h2></div>
      <div className="grid-cards">{fresh.map(l => <ProductCard key={l.id} l={l} />)}</div>
    </section>

    <section className="wrap blk sell-cta"><div><h2>Sell digital products on Crateline</h2><p className="muted">Open a store, publish packages, and fulfil orders with built-in messaging, custom offers and payouts.</p></div>
      <Btn v="primary" onClick={() => nav({ page: 's-onboarding' })}>Become a seller</Btn></section>
  </>;
}

const SORTS = [{ id: 'relevance', label: 'Relevance' }, { id: 'price-asc', label: 'Lowest starting price' }, { id: 'price-desc', label: 'Highest starting price' }, { id: 'rating', label: 'Highest rated' }, { id: 'newest', label: 'Newest' }, { id: 'popular', label: 'Most ordered' }];

export function Search() {
  const { db, route, nav } = useApp();
  const q = (route.q || '').trim();
  const [f, setF] = useState({ cat: route.cat || '', sub: route.sub || '', min: '', max: '', rating: 0, days: 0 });
  const [sort, setSort] = useState(route.sort || (q ? 'relevance' : 'popular'));
  const [shown, setShown] = useState(8); const [loading, setLoading] = useState(true); const [drawer, setDrawer] = useState(false);
  useEffect(() => { setF(x => ({ ...x, cat: route.cat || '', sub: route.sub || '' })); setShown(8); }, [route.cat, route.sub, route.q]);
  useEffect(() => { setLoading(true); const t = setTimeout(() => setLoading(false), 380); return () => clearTimeout(t); }, [route.q, route.cat, route.sub]);
  const set = (k, v) => { setF(x => ({ ...x, [k]: v, ...(k === 'cat' ? { sub: '' } : {}) })); setShown(8); };

  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let r = db.listings.filter(l => isPublic(db, l)).map(l => {
      const st = db.stores[l.storeId];
      const hay = (l.title + ' ' + l.summary + ' ' + l.description + ' ' + SUBS[l.sub].name + ' ' + SUBS[l.sub].catName + ' ' + st.name).toLowerCase();
      const score = words.reduce((a, w) => a + (hay.includes(w) ? 1 : 0) + (l.title.toLowerCase().includes(w) ? 1 : 0), 0);
      return { l, score, ok: !words.length || words.some(w => hay.includes(w.replace(/s$/, ''))) };
    }).filter(x => x.ok);
    r = r.filter(({ l }) => (!f.cat || l.cat === f.cat) && (!f.sub || l.sub === f.sub) && (!f.min || startPrice(l) >= +f.min) && (!f.max || startPrice(l) <= +f.max)
      && (!f.rating || (listingStats(db, l).rating || 0) >= f.rating) && (!f.days || minDays(l) <= f.days));
    const cmp = { relevance: (a, b) => b.score - a.score || b.l.sold - a.l.sold, 'price-asc': (a, b) => startPrice(a.l) - startPrice(b.l), 'price-desc': (a, b) => startPrice(b.l) - startPrice(a.l),
      rating: (a, b) => (listingStats(db, b.l).rating || 0) - (listingStats(db, a.l).rating || 0), newest: (a, b) => b.l.createdAt - a.l.createdAt, popular: (a, b) => b.l.sold - a.l.sold }[sort];
    return r.sort(cmp).map(x => x.l);
  }, [db, q, f, sort]);
  const sellers = new Set(results.map(l => l.storeId)).size;
  const cat = CATEGORIES.find(c => c.id === f.cat); const sub = f.sub && SUBS[f.sub];
  const heading = q ? `Results for “${q}”` : sub ? sub.name : cat ? cat.name : 'All digital products';
  const chips = [cat && ['cat', cat.name], sub && ['sub', sub.name], f.min && ['min', 'From ' + money(+f.min)], f.max && ['max', 'Up to ' + money(+f.max)], f.rating && ['rating', f.rating + '+ stars'], f.days && ['days', 'Delivery ≤ ' + days(f.days)]].filter(Boolean);

  const filters = <div className="filters">
    <fieldset><legend>Category</legend>
      <label className="radio"><input type="radio" name="cat" checked={!f.cat} onChange={() => set('cat', '')} />All categories</label>
      {CATEGORIES.filter(c => c.active).map(c => <div key={c.id}><label className="radio"><input type="radio" name="cat" checked={f.cat === c.id} onChange={() => set('cat', c.id)} />{c.name}</label>
        {f.cat === c.id && <div className="subradios">{c.subs.filter(s => s.active).map(s => <label key={s.id} className="radio sm"><input type="checkbox" checked={f.sub === s.id} onChange={e => set('sub', e.target.checked ? s.id : '')} />{s.name}</label>)}</div>}</div>)}
    </fieldset>
    <fieldset><legend>Starting price (USD)</legend><div className="row2"><input type="number" min="0" placeholder="Min" aria-label="Minimum price" value={f.min} onChange={e => set('min', e.target.value)} /><input type="number" min="0" placeholder="Max" aria-label="Maximum price" value={f.max} onChange={e => set('max', e.target.value)} /></div></fieldset>
    <fieldset><legend>Rating</legend>{[0, 4, 4.5].map(r => <label key={r} className="radio"><input type="radio" name="rating" checked={f.rating === r} onChange={() => set('rating', r)} />{r ? <>{r}+ <Icon n="star" s={13} fill="currentColor" className="star-c" /></> : 'Any rating'}</label>)}</fieldset>
    <fieldset><legend>Delivery time</legend>{[0, 1, 3, 7].map(d => <label key={d} className="radio"><input type="radio" name="days" checked={f.days === d} onChange={() => set('days', d)} />{d ? 'Up to ' + days(d) : 'Any time'}</label>)}</fieldset>
  </div>;

  return <div className="wrap page">
    <div className="results-hero">
      <div className="crumbs"><a href="#" onClick={e => { e.preventDefault(); nav({ page: 'home' }); }}>Home</a><Icon n="right" s={12} />{cat ? <><a href="#" onClick={e => { e.preventDefault(); nav({ page: 'search', cat: cat.id }); }}>{cat.name}</a>{sub && <><Icon n="right" s={12} /><span>{sub.name}</span></>}</> : <span>Search</span>}</div>
      <h1>{heading}</h1>
      <p className="muted">{cat && !q ? cat.blurb + '. ' : ''}<b className="fg">{results.length}</b> offers from <b className="fg">{sellers}</b> sellers</p>
      <div className="rh-search"><SearchBox initial={q} /></div>
      <div className="suggest"><span className="muted small">Trending:</span>{TRENDING.slice(0, 5).map(t => <button key={t} className="chip sm" onClick={() => nav({ page: 'search', q: t })}>{t}</button>)}</div>
    </div>
    <div className="results-layout">
      <aside className="only-d"><h2 className="side-title">Filters</h2>{filters}</aside>
      <div className="results-main">
        <div className="results-bar">
          <Btn className="only-m" icon="filter" onClick={() => setDrawer(true)}>Filters{chips.length ? ` (${chips.length})` : ''}</Btn>
          <div className="chips-active">{chips.map(([k, label]) => <span key={k} className="chip on">{label}<button aria-label={'Remove filter ' + label} onClick={() => set(k, k === 'rating' || k === 'days' ? 0 : '')}><Icon n="x" s={12} /></button></span>)}
            {chips.length > 0 && <button className="linkbtn" onClick={() => { setF({ cat: '', sub: '', min: '', max: '', rating: 0, days: 0 }); }}>Clear all</button>}</div>
          <label className="sortsel"><span className="muted small">Sort by</span><select value={sort} onChange={e => setSort(e.target.value)}>{SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        </div>
        {loading ? <SkeletonGrid n={6} /> : results.length === 0 ? <Empty icon="search" title={q ? `No offers match “${q}”` : 'No offers match these filters'} action={<div className="row-gap"><Btn onClick={() => setF({ cat: '', sub: '', min: '', max: '', rating: 0, days: 0 })}>Clear filters</Btn>{q && <Btn v="ghost" onClick={() => nav({ page: 'search', cat: f.cat })}>Search all of {cat ? cat.name : 'the marketplace'}</Btn>}</div>}>Try a shorter search, remove a filter, or browse a category.</Empty>
          : <><div className="grid-cards">{results.slice(0, shown).map(l => <ProductCard key={l.id} l={l} />)}</div>
            <div className="loadmore"><span className="muted small">Showing {Math.min(shown, results.length)} of {results.length}</span>{shown < results.length && <Btn onClick={() => setShown(shown + 8)}>Load more</Btn>}</div></>}
      </div>
    </div>
    {drawer && <div className="drawer-bg" onClick={() => setDrawer(false)}><aside className="drawer right" onClick={e => e.stopPropagation()} aria-label="Filters"><div className="drawer-h"><b>Filters</b><button className="iconbtn" aria-label="Close filters" onClick={() => setDrawer(false)}><Icon n="x" /></button></div>{filters}<Btn v="primary" onClick={() => setDrawer(false)}>Show {results.length} offers</Btn></aside></div>}
  </div>;
}

export function Product() {
  const { db, route, nav, me, requireAuth, update, toast, mode, perform } = useApp();
  const l = db.listings.find(x => x.id === route.id);
  const [pkgId, setPkgId] = useState(route.pkgId || l?.packages[0].id);
  const [count, setCount] = useState(route.count || 1);
  const [img, setImg] = useState(0);
  const [offerOpen, setOfferOpen] = useState(!!route.openOffer);
  useEffect(() => { if (l) { setPkgId(route.pkgId || l.packages[0].id); setCount(route.count || 1); setImg(0); setOfferOpen(!!route.openOffer); } }, [route.id, route.pkgId, route.openOffer]);
  if (!l) return <NotFound />;
  const st = db.stores[l.storeId]; const ss = storeStats(db, st); const ls = listingStats(db, l);
  const own = me && st.ownerId === me.id;
  if (!isPublic(db, l) && !own) return <div className="wrap page"><Empty icon="alert" title="This listing is unavailable" action={<Btn onClick={() => nav({ page: 'search', cat: l.cat })}>Browse {SUBS[l.sub].catName}</Btn>}>The seller has paused or removed this offer. Your previous orders remain available in your account.</Empty></div>;
  const pkg = l.packages.find(p => p.id === pkgId) || l.packages[0];
  const subtotal = pkg.price * count;
  const reviews = db.reviews.filter(r => r.listingId === l.id).sort((a, b) => b.at - a.at);
  const others = db.listings.filter(x => x.storeId !== l.storeId && isPublic(db, x) && (x.sub === l.sub || x.cat === l.cat)).sort((a, b) => (b.sub === l.sub) - (a.sub === l.sub)).slice(0, 4);
  const following = me && me.following.includes(st.id);
  const intentBase = { listingId: l.id, pkgId: pkg.id, count };
  const buy = () => requireAuth({ type: 'buy', ...intentBase });
  const addCart = () => requireAuth({ type: 'cart', ...intentBase });
  const follow = () => requireAuth({ type: 'follow', storeId: st.id, back: { page: 'product', id: l.id } });
  const message = () => requireAuth({ type: 'message', storeId: st.id, listingId: l.id });
  const askOffer = () => me ? setOfferOpen(true) : requireAuth({ type: 'nav', route: { page: 'product', id: l.id, pkgId: pkg.id, count, openOffer: true } });

  return <div className="wrap page">
    {route.preview && <Notice tone="accent" title="Seller preview" action={<Btn size="sm" onClick={() => nav({ page: 's-products' })}>Back to products</Btn>}>This is how buyers see the listing{l.availability !== 'Active' ? ` once it is published (currently ${l.availability})` : ''}.</Notice>}
    <div className="crumbs"><a href="#" onClick={e => { e.preventDefault(); nav({ page: 'home' }); }}>Home</a><Icon n="right" s={12} /><a href="#" onClick={e => { e.preventDefault(); nav({ page: 'search', cat: l.cat }); }}>{SUBS[l.sub].catName}</a><Icon n="right" s={12} /><a href="#" onClick={e => { e.preventDefault(); nav({ page: 'search', cat: l.cat, sub: l.sub }); }}>{SUBS[l.sub].name}</a></div>
    <div className="product-layout">
      <div className="product-main">
        <div className="gallery"><ProductArt sub={l.sub} art={l.art} variant={img} size="hero" label={`${l.title}, image ${img + 1} of 3`} />
          <div className="thumbs">{[0, 1, 2].map(i => <button key={i} className={img === i ? 'on' : ''} onClick={() => setImg(i)} aria-label={'Show image ' + (i + 1)}><ProductArt sub={l.sub} art={l.art} variant={i} size="thumb" /></button>)}</div></div>
        <h1 className="ptitle">{l.title}</h1>
        <div className="pmeta"><button className="seller-inline" onClick={() => nav({ page: 'store', id: st.id })}><Avatar name={st.name} hue={st.hue} size={22} square />{st.name}</button><Stars value={ls.rating} count={ls.count} /><span className="muted small">{fmtN(l.sold)} sold</span><Badge tone="muted">{SUBS[l.sub].name}</Badge></div>
        <p className="lead-sm">{l.summary}</p>

        <section className="psec"><h2>Description</h2><p>{l.description || l.summary}</p>
          {l.features.length > 0 && <><h3>Features</h3><ul className="checks">{l.features.map(x => <li key={x}><Icon n="check" s={15} />{x}</li>)}</ul></>}</section>
        {l.why && <section className="psec why"><h2>Why choose this seller</h2><p>{l.why}</p></section>}
        <section className="psec"><h2>Delivery and terms</h2>
          <dl className="terms-grid">
            <div><dt><Icon n="truck" s={16} />Delivery method</dt><dd>{l.deliveryMethod}{l.deliveryMethod === 'Secure access information' ? '. Revealed only inside your order.' : ''}</dd></div>
            <div><dt><Icon n="clock" s={16} />Delivery time</dt><dd>{days(pkg.days)} for the selected package. The clock starts after verified payment and any required details.</dd></div>
            <div><dt><Icon n="refresh" s={16} />Replacement policy</dt><dd>{l.replacement}</dd></div>
            <div><dt><Icon n="shield" s={16} />Usage conditions</dt><dd>{l.usage}</dd></div>
            {l.requirements && <div><dt><Icon n="list" s={16} />Buyer requirements</dt><dd>{l.requirements}</dd></div>}
            <div><dt><Icon n="box" s={16} />Availability</dt><dd>{l.stock}</dd></div>
          </dl></section>
        <section className="psec"><h2>Reviews <span className="muted">({reviews.length})</span></h2>
          {reviews.length === 0 ? <p className="muted">No reviews yet. Reviews come only from completed, verified purchases.</p> :
            <ul className="reviews">{reviews.map(r => <li key={r.id}><div className="rv-h"><Stars value={r.rating} small /><b>{r.alias}</b><span className="muted xs">Purchased {r.pkg} · {fmtDate(r.at)}</span></div><p>{r.text}</p>{r.reply && <p className="rv-reply"><b>Seller response:</b> {r.reply}</p>}</li>)}</ul>}</section>
      </div>

      <aside className="buybox-col">
        <div className="buybox card">
          <h2 className="bb-title">Choose a package</h2>
          <PackageSelector listing={l} pkgId={pkg.id} setPkgId={setPkgId} count={count} setCount={setCount} />
          <dl className="summary">
            <div><dt>Package</dt><dd>{pkg.name}</dd></div>
            <div><dt>Package count</dt><dd>{count}</dd></div>
            <div><dt>Total quantity</dt><dd>{fmtN(pkg.qty * count)} {l.unit}</dd></div>
            <div><dt>Delivery</dt><dd>{days(pkg.days)}</dd></div>
            <div className="sum-total"><dt>Subtotal</dt><dd>{money(subtotal)} USD</dd></div>
          </dl>
          <p className="xs muted">No buyer service fee (demo default). Taxes are not configured.</p>
          {own ? <Notice tone="info">This is your listing. Sellers cannot buy or review their own offers.</Notice> : <div className="bb-actions">
            <Btn v="primary" className="block" onClick={buy}>Buy now · {money(subtotal)}</Btn>
            <Btn className="block" icon="cart" onClick={addCart}>Add to cart</Btn>
            {db.settings.current.features.customOffers && <Btn v="ghost" className="block" icon="sparkle" onClick={askOffer}>Request custom offer</Btn>}</div>}
        </div>
        <div className="card seller-card">
          <div className="sc-h"><Avatar name={st.name} hue={st.hue} size={44} square /><div><button className="linkbtn b" onClick={() => nav({ page: 'store', id: st.id })}>{st.name}</button><span className="muted xs block">{st.tagline}</span></div></div>
          <dl className="sc-stats"><div><dt>Rating</dt><dd><Stars value={ss.rating} count={ss.count} small /></dd></div><div><dt>Completed orders</dt><dd>{fmtN(ss.completed)}</dd></div><div><dt>Member since</dt><dd>{fmtDate(st.joined)}</dd></div></dl>
          {!own && <div className="row-gap">{db.settings.current.features.follows && <Btn size="sm" icon="heart" v={following ? 'primary' : 'secondary'} onClick={() => following ? perform('setFollow', { storeId: st.id, on: false }, d => AX.setFollow(d, d.users[me.id], st.id, false), 'Unfollowed ' + st.name) : follow()}>{following ? 'Following' : 'Follow'}</Btn>}<Btn size="sm" icon="chat" onClick={message}>Message</Btn></div>}
        </div>
      </aside>
    </div>
    {others.length > 0 && <section className="blk"><div className="block-h"><h2>Related offers from other sellers</h2></div><p className="muted small block-sub">Similar category. Quantities, delivery and terms differ between sellers; check each listing.</p>
      <div className="grid-cards">{others.map(x => <ProductCard key={x.id} l={x} />)}</div></section>}
    {offerOpen && <OfferRequestModal l={l} pkg={pkg} onClose={() => setOfferOpen(false)} />}
  </div>;
}

export function OfferRequestModal({ l, pkg, onClose }) {
  const { update, me, toast, nav, perform } = useApp();
  const [qty, setQty] = useState(String(pkg ? pkg.qty * 2 : '')); const [req, setReq] = useState(''); const [budget, setBudget] = useState(''); const [date, setDate] = useState('');
  const [err, setErr] = useState({}); const [done, setDone] = useState(null);
  async function submit() {
    const e = {}; if (!(+qty > 0)) e.qty = 'Enter a quantity greater than zero.'; if (req.trim().length < 10) e.req = 'Describe what you need in at least 10 characters.'; if (budget && !(+budget > 0)) e.budget = 'Budget must be a positive amount.';
    setErr(e); if (Object.keys(e).length) return;
    const args = { listingId: l.id, qty: +qty, requirements: req.trim(), budget: budget ? +budget : null, date };
    const r = await perform('requestOffer', args, d => AX.requestOffer(d, d.users[me.id], l.id, args), 'Custom offer request sent');
    if (r.ok) setDone(r.value);
  }
  if (done) return <Modal title="Request sent" onClose={onClose} footer={<><Btn v="ghost" onClick={onClose}>Keep browsing</Btn><Btn v="primary" onClick={() => { onClose(); nav({ page: 'inbox', id: done.convId }); }}>Open conversation</Btn></>}>
    <Notice tone="ok" title={`Request ${done.id} sent to the seller`}>This is not a paid order. The seller can accept, send a revised offer with a fixed price, or decline. You will be notified in your inbox.</Notice></Modal>;
  return <Modal title="Request a custom offer" onClose={onClose} footer={<><Btn v="ghost" onClick={onClose}>Cancel</Btn><Btn v="primary" onClick={submit}>Send request</Btn></>}>
    <p className="muted small">For {l.title}. Quantities outside the fixed packages are quoted by the seller.</p>
    <div className="form-grid">
      <Field label={`Quantity (${l.unit})`} required error={err.qty}><input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} /></Field>
      <Field label="Budget (USD)" hint="Optional" error={err.budget}><input type="number" min="0" value={budget} onChange={e => setBudget(e.target.value)} placeholder="e.g. 400" /></Field>
      <Field label="Requested delivery date" hint="Optional"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
    </div>
    <Field label="Requirements" required error={err.req} hint="Targeting, format, timing and anything the seller needs to quote accurately."><textarea rows="4" value={req} onChange={e => setReq(e.target.value)} placeholder="e.g. 20,000 contacts in Texas and Florida, IT Director and above, CSV" /></Field>
  </Modal>;
}

export function StorePage() {
  const { db, route, nav, me, update, requireAuth, perform } = useApp();
  const st = db.stores[route.id]; const [q, setQ] = useState(''); const [sub, setSub] = useState('');
  if (!st) return <NotFound />;
  const ss = storeStats(db, st); const own = me && st.ownerId === me.id;
  if (st.status !== 'Active' && !own) return <div className="wrap page"><Empty icon="store" title="This store is not open yet">The seller has not completed verification.</Empty></div>;
  const ls = db.listings.filter(l => l.storeId === st.id && (isPublic(db, l)));
  const subs = [...new Set(ls.map(l => l.sub))];
  const shown = ls.filter(l => (!sub || l.sub === sub) && (!q || (l.title + l.summary).toLowerCase().includes(q.toLowerCase())));
  const following = me && me.following.includes(st.id);
  return <div className="page">
    <div className="store-banner" style={{ '--h': st.hue }}><svg viewBox="0 0 400 80" preserveAspectRatio="none" aria-hidden="true">{Array.from({ length: 20 }, (_, i) => <path key={i} d={`M${i * 24 - 40} 80 L${i * 24 + 20} 0`} stroke="currentColor" strokeWidth="6" />)}</svg></div>
    <div className="wrap">
      <div className="store-head"><Avatar name={st.name} hue={st.hue} size={88} square />
        <div className="sh-main"><h1>{st.name}</h1><p className="muted">{st.tagline}</p>
          <div className="pmeta"><Stars value={ss.rating} count={ss.count} /><span className="small"><b>{fmtN(ss.completed)}</b> completed orders</span><span className="small"><b>{ss.active}</b> active products</span><span className="small muted">Joined {fmtDate(st.joined)} · {st.country}</span><Badge tone="ok"><Icon n="shield" s={13} />Verified seller (simulated)</Badge></div></div>
        {!own && <div className="row-gap"><Btn icon="heart" v={following ? 'primary' : 'secondary'} onClick={() => following ? perform('setFollow', { storeId: st.id, on: false }, d => AX.setFollow(d, d.users[me.id], st.id, false), 'Unfollowed ' + st.name) : requireAuth({ type: 'follow', storeId: st.id, back: { page: 'store', id: st.id } })}>{following ? 'Following' : 'Follow'}</Btn><Btn icon="chat" onClick={() => requireAuth({ type: 'message', storeId: st.id })}>Message</Btn></div>}
        {own && <Notice tone="info">You are viewing your public store.</Notice>}
      </div>
      <p className="store-desc">{st.description}</p>
      <div className="store-tools"><div className="searchbox"><Icon n="search" s={17} /><input aria-label="Search this store" placeholder={`Search ${st.name}`} value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="chips-row"><button className={'chip' + (!sub ? ' on' : '')} onClick={() => setSub('')}>All</button>{subs.map(s => <button key={s} className={'chip' + (sub === s ? ' on' : '')} onClick={() => setSub(s)}>{SUBS[s].name}</button>)}</div></div>
      {shown.length ? <div className="grid-cards">{shown.map(l => <ProductCard key={l.id} l={l} />)}</div> : <Empty icon="search" title="No products match" action={<Btn onClick={() => { setQ(''); setSub(''); }}>Clear search</Btn>} />}
    </div></div>;
}

const FAQ = [
  ['When is the seller paid?', 'Funds stay pending until you confirm receipt or the order otherwise completes, then a release period applies. Funds on orders with an open case are reserved.'],
  ['What if a delivery is wrong?', 'Use Request replacement on the order within the listing’s replacement window, or Report order to open a Resolution Center case.'],
  ['How do custom offers work?', 'Request an offer from a listing. The seller replies with a fixed price, quantity, delivery time and expiry. Accepting opens checkout; only the latest unexpired offer can be paid.'],
  ['Which payment methods are available?', 'Card, crypto, bKash and Nagad are shown in this prototype. All payments here are simulated and no money moves.'],
];
export function Help() {
  const { me, update, route, toast } = useApp(); const [open, setOpen] = useState(0);
  return <div className="wrap page narrow">
    <h1>Help Center</h1><p className="muted">Answers about buying, delivery and the Resolution Center, plus a form to contact support.</p>
    <div className="faq">{FAQ.map(([q, a], i) => <div key={q} className={'faq-i' + (open === i ? ' open' : '')}><button aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>{q}<Icon n="down" s={16} /></button>{open === i && <p>{a}</p>}</div>)}</div>
    <SupportForm focus={route.form} />
  </div>;
}
export function SupportForm({ focus }) {
  const { me, update, toast, db } = useApp();
  const [v, setV] = useState({ name: me?.name || '', email: me?.email || '', subject: '', cat: 'Order issue', order: '', desc: '' }); const [err, setErr] = useState({}); const [sent, setSent] = useState(null);
  const s = k => e => setV({ ...v, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault(); const er = {};
    if (!v.name.trim()) er.name = 'Enter your name.'; if (!/^\S+@\S+\.\S+$/.test(v.email)) er.email = 'Enter a valid email address.'; if (v.desc.trim().length < 15) er.desc = 'Describe the problem in at least 15 characters.';
    setErr(er); if (Object.keys(er).length) return;
    let id;
    if (apiEnabled) { try { id = (await api.support(v)).ticketId; } catch (x) { return setErr(x.field ? { [x.field]: x.message } : { desc: x.message }); } }
    else id = update(d => AX.createTicket(d, me?.id || null, v));
    setSent(id); toast('Support request ' + id + ' submitted');
  }
  if (sent) return <div className="card pad"><Notice tone="ok" title={`Request ${sent} received`}>A placeholder confirmation. Response times are not promised in this prototype because no support process is assigned yet.</Notice><Btn onClick={() => { setSent(null); setV({ ...v, subject: '', desc: '', order: '' }); }}>Send another request</Btn></div>;
  return <form className="card pad" onSubmit={submit} noValidate><h2>Contact support</h2>
    {!me && <p className="muted small">Guests can contact support. Sign in to link a request to your orders.</p>}
    <div className="form-grid"><Field label="Name" required error={err.name}><input value={v.name} onChange={s('name')} autoFocus={focus} /></Field><Field label="Account email" required error={err.email}><input type="email" value={v.email} onChange={s('email')} /></Field>
      <Field label="Issue category"><select value={v.cat} onChange={s('cat')}>{['Order issue', 'Payment', 'Account and security', 'Selling', 'Other'].map(x => <option key={x}>{x}</option>)}</select></Field>
      {me ? <Field label="Related order" hint="Optional"><select value={v.order} onChange={s('order')}><option value="">None</option>{db.orders.filter(o => o.buyerId === me.id).map(o => <option key={o.id} value={o.id}>{o.id} · {o.snap.title.slice(0, 40)}</option>)}</select></Field>
        : <Field label="Order number" hint="Optional"><input value={v.order} onChange={s('order')} /></Field>}</div>
    <Field label="Subject"><input value={v.subject} onChange={s('subject')} /></Field>
    <Field label="Describe the problem" required error={err.desc}><textarea rows="4" value={v.desc} onChange={s('desc')} /></Field>
    <Btn v="primary" type="submit">Submit request</Btn></form>;
}

function Placeholder({ title, sections, pid }) {
  const { db } = useApp(); const pol = db.policies.find(x => x.id === pid); const pv = pol?.versions.find(v => v.state === 'Published');
  return <div className="wrap page narrow legal"><h1>{title}</h1>{pv && <p className="muted small">Published version {pv.v}{pv.publishedAt ? ' · ' + fmtDate(pv.publishedAt) : ''}. {pv.content}</p>}<Notice tone="warn" title="Placeholder content">Legal wording is a separate deliverable. These headings show where final, approved text will appear and how accepted versions are recorded .</Notice>
    {sections.map(([h, p]) => <section key={h}><h2>{h}</h2><p>{p}</p></section>)}</div>;
}
export const Terms = () => <Placeholder pid="POL-terms" title="Terms and Conditions" sections={[['1. Accounts', '[Placeholder] Eligibility, account security and one store per seller account.'], ['2. Buying', '[Placeholder] Package pricing, service fees and order formation on verified payment.'], ['3. Selling', '[Placeholder] Listing standards, fulfilment obligations and prohibited items.'], ['4. Acceptable use', '[Placeholder] Buyers must use data and services lawfully, including consent and anti-spam rules.'], ['5. Disputes', '[Placeholder] Resolution Center process and escalation.']]} />;
export const Privacy = () => <Placeholder pid="POL-privacy" title="Privacy Policy" sections={[['What we collect', '[Placeholder] Account, contact, order and verification information.'], ['How it is used', '[Placeholder] To provide the marketplace, process payments, prevent fraud and meet legal duties.'], ['Retention', '[Placeholder] Retention periods to be agreed before launch.'], ['Your rights', '[Placeholder] Access, correction and deletion requests.']]} />;
export const Policies = () => <Placeholder pid="POL-refunds" title="Purchase, delivery, replacement and refunds" sections={[['Purchasing', '[Placeholder] One checkout can contain several sellers; each seller gets a separate order under one purchase reference.'], ['Delivery', '[Placeholder] The delivery clock starts after verified payment and receipt of required buyer details.'], ['Replacement', '[Placeholder] Each listing states its replacement window and eligibility, stored with your order.'], ['Refunds', '[Placeholder] Full or partial refunds follow an agreed case outcome and are marked refunded only after payment confirmation.']]} />;
export function NotFound() { const { nav } = useApp(); return <div className="wrap page"><Empty icon="alert" title="Page not found" action={<Btn v="primary" onClick={() => nav({ page: 'home' })}>Go to homepage</Btn>}>The page may have moved, or you may not have access to it.</Empty></div>; }

export function StaffSignIn() {
  const { db, setAccount } = useApp();
  if (apiEnabled) return <StaffSignInForm />;
  const groups = [['Super Admin', s => s.roles.includes('superadmin')], ['Admin', s => !s.roles.includes('superadmin')]];
  return <div className="wrap page narrow"><h1>Staff sign-in</h1>
    <p className="muted">Admin and Super Admin panels for marketplace staff. <Sim>Simulated sign-in</Sim> No password is asked for; pick a fictional staff account.</p>
    {groups.map(([g, f]) => <section key={g} className="blk"><h2>{g}</h2><div className="staff-pick">{Object.values(db.staff).filter(f).map(s => <button key={s.id} disabled={!s.active} onClick={() => setAccount({ staffId: s.id })}><b>{s.name}</b><span className="xs muted">{s.id} · {s.roles.map(r => db.roles[r].name).join(' + ')}{s.active ? '' : ' · inactive'}</span></button>)}</div></section>)}
  </div>;
}

// API mode: staff sign in with their own email and password; the server checks the account is active.
function StaffSignInForm() {
  const { apiSignIn, nav } = useApp();
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [ticket, setTicket] = useState(null);
  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || !pw) return setErr('Enter your staff email and password.');
    setBusy(true); setErr('');
    try { const r = await apiSignIn(() => api.staffLogin(email.trim(), pw)); if (r?.mfa) { setBusy(false); setTicket(r.ticket); } }
    catch (x) { setBusy(false); setErr(x.status === 401 ? 'Email or password is incorrect. Check the details and try again.' : x.message); }
  }
  // Same centred card as the customer sign-in page.
  if (ticket) return <div className="auth-wrap"><div className="auth-card card"><h1>Enter your sign-in code</h1><MfaCodeStep ticket={ticket} onBack={m => { setTicket(null); setPw(''); setErr(m || ''); }} /></div></div>;
  return <div className="auth-wrap"><div className="auth-card card"><h1>Staff sign-in</h1>
    <p className="muted">Admin and Super Admin panels for marketplace staff. Customers sign in from the main sign-in page.</p>
    <form onSubmit={submit} noValidate>
      {err && <Notice tone="bad">{err}</Notice>}
      <Field label="Staff email" required><input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></Field>
      <Field label="Password" required><input type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} /></Field>
      <div className="row-between"><span /><a href="#" className="small" onClick={e => { e.preventDefault(); nav({ page: 'forgot' }); }}>Forgot password?</a></div>
      <Btn v="primary" type="submit" className="block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Btn>
    </form>
  </div></div>;
}
