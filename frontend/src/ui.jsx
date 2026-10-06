import React from 'react';
import { CAT_HUE, SUBS } from '@crateline/domain/data.js';
import { fmtDT, fmtSize, rel, money, fmtN, PROGRESS, STATUS_LABEL, STATUS_TONE, listingStats, storeStats, startPrice, minQty, minDays, days } from '@crateline/domain/logic.js';
import { api, apiEnabled } from './api.js';
const { useState, useEffect, useRef, createContext, useContext } = React;

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const P = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.4 11.2a2 2 0 0 0 2 1.6h8a2 2 0 0 0 2-1.5l1.6-7.3H6.2"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15.5 6 9"/><path d="M10.2 20.5a2 2 0 0 0 3.6 0"/>',
  chat: '<path d="M20.5 11.6a8.4 8.4 0 0 1-12.3 7.4L3.5 20.5l1.5-4.6a8.4 8.4 0 1 1 15.5-4.3z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="m4.5 12.5 5 5 10-11"/>',
  down: '<path d="m6 9 6 6 6-6"/>', right: '<path d="m9 6 6 6-6 6"/>', left: '<path d="m15 6-6 6 6 6"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  phone: '<path d="M5 3.5h3.2l1.6 4.2-2.1 1.4a11 11 0 0 0 7.2 7.2l1.4-2.1 4.2 1.6V19a2 2 0 0 1-2 2A16.5 16.5 0 0 1 3 5.5a2 2 0 0 1 2-2z"/>',
  phoneCall: '<path d="M5 3.5h3.2l1.6 4.2-2.1 1.4a11 11 0 0 0 7.2 7.2l1.4-2.1 4.2 1.6V19a2 2 0 0 1-2 2A16.5 16.5 0 0 1 3 5.5a2 2 0 0 1 2-2z"/><path d="M14.5 3.5a6 6 0 0 1 6 6M14.5 7a2.5 2.5 0 0 1 2.5 2.5"/>',
  server: '<rect x="3.5" y="3.5" width="17" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="17" height="7" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
  monitor: '<rect x="2.5" y="4" width="19" height="12.5" rx="1.5"/><path d="M8 20.5h8M12 16.5v4"/>',
  send: '<path d="m21 3-9.5 9.5M21 3l-6.5 18-3-8.5L3 9.5z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13.5" width="4" height="6" rx="1.5"/><rect x="17" y="13.5" width="4" height="6" rx="1.5"/><path d="M19 19.5c0 1.5-2 2-5 2"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>', layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  megaphone: '<path d="M3.5 10v4a1 1 0 0 0 1 1h2.5l7 4.5v-15L7 9H4.5a1 1 0 0 0-1 1z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
  box: '<path d="m12 2.8 8.5 4.6v9.2L12 21.2l-8.5-4.6V7.4z"/><path d="m3.7 7.5 8.3 4.6 8.3-4.6M12 12v9"/>',
  file: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/>',
  clip: '<path d="m20 11.5-8.1 8.1a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
  bold: '<path d="M7 4.5h6a3.8 3.8 0 0 1 0 7.5H7zM7 12h7a3.8 3.8 0 0 1 0 7.5H7z"/>', list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  shield: '<path d="M12 21s-7.5-3-7.5-9.5V5.5L12 3l7.5 2.5v6C19.5 18 12 21 12 21z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
  alert: '<path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', wallet: '<path d="M19.5 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14.5a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 19.5 8H5"/><path d="M16.5 14h.01"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5M4.5 10v8M9.5 10v8M14.5 10v8M19.5 10v8M3 20.5h18"/>', refresh: '<path d="M20 11a8 8 0 0 0-14.4-4.6L3.5 9M4 13a8 8 0 0 0 14.4 4.6l2.1-2.6M3.5 4v5h5M20.5 20v-5h-5"/>',
  eye: '<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3"/>', copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="1.5"/><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>', play: '<path d="M7 4.5v15l12-7.5z"/>',
  archive: '<rect x="3" y="4" width="18" height="4.5" rx="1"/><path d="M4.5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V8.5M10 12.5h4"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>', trash: '<path d="M4 6.5h16M9.5 6.5V4h5v2.5M6 6.5l1 13.5h10l1-13.5"/>',
  filter: '<path d="M3.5 5h17l-6.5 8v5.5l-4 2V13z"/>', home: '<path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z"/>',
  inbox: '<path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/><path d="M5.8 5.5h12.4l2.3 8V19a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 19v-5.5z"/>',
  scale: '<path d="M12 3.5v17M5 20.5h14M6.5 7.5h11M6.5 7.5 3.5 14a3 3 0 0 0 6 0zM17.5 7.5l-3 6.5a3 3 0 0 0 6 0z"/>',
  store: '<path d="M3.5 9.5 5 4h14l1.5 5.5M3.5 9.5a2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.8 0M5 12v8.5h14V12M10 20.5v-5h4v5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.1a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z"/>',
  logout: '<path d="M15 4.5h3.5A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5H15M10 16.5 14.5 12 10 7.5M14.5 12H4"/>',
  upload: '<path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>', download: '<path d="M12 4v11.5M7.5 11 12 15.5l4.5-4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.5h.01"/>', receipt: '<path d="M5.5 3h13v18l-2.2-1.5-2.1 1.5-2.2-1.5-2.2 1.5-2.1-1.5-2.2 1.5z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  flag: '<path d="M5 21V4.5M5 4.5h11.5l-2 4 2 4H5"/>', calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="1.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>', arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>', lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="1.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  sparkle: '<path d="M12 3.5 13.8 10l6.7 2-6.7 2L12 20.5 10.2 14l-6.7-2 6.7-2z"/>', truck: '<path d="M3 6.5h11v9H3zM14 9.5h4l3 3.5v2.5h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  play2: '<circle cx="12" cy="12" r="8.5"/><path d="m10 8.5 5 3.5-5 3.5z"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};
export function Icon({ n, s = 18, className = '', fill }) {
  return <svg className={'ic ' + className} width={s} height={s} viewBox="0 0 24 24" fill={fill || 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: P[n] || P.box }} />;
}

export function Btn({ v = 'secondary', size, icon, iconR, children, className = '', ...p }) {
  return <button type="button" className={`btn btn-${v} ${size ? 'btn-' + size : ''} ${className}`} {...p}>{icon && <Icon n={icon} s={size === 'sm' ? 15 : 17} />}{children}{iconR && <Icon n={iconR} s={15} />}</button>;
}
export function Badge({ tone = 'muted', children, dot }) { return <span className={'badge tone-' + tone}>{dot && <i className="dot" />}{children}</span>; }
export const Sim = ({ children = 'Simulated' }) => <span className="sim" title="This prototype does not connect to a real provider">{children}</span>;
export function StatusBadge({ o }) { return <Badge tone={STATUS_TONE[o.status]} dot>{STATUS_LABEL[o.status]}</Badge>; }
export const CASE_TONE = { Open: 'warn', 'Awaiting seller': 'warn', 'Awaiting buyer': 'info', Escalated: 'bad', Resolved: 'ok', Closed: 'muted' };
export const OFFER_TONE = { Requested: 'warn', Sent: 'info', 'Accepted awaiting payment': 'accent', Paid: 'ok', Rejected: 'bad', Declined: 'bad', Withdrawn: 'muted', Expired: 'muted', Superseded: 'muted', Answered: 'muted' };

export function Avatar({ name = '?', hue = 200, size = 32, square }) {
  const ini = name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return <span className={'avatar' + (square ? ' sq' : '')} style={{ width: size, height: size, fontSize: size * 0.38, '--h': hue }} aria-hidden="true">{ini}</span>;
}
export function Stars({ value, count, small }) {
  if (value == null) return <span className="muted small">No reviews yet</span>;
  return <span className={'stars' + (small ? ' sm' : '')}><Icon n="star" s={small ? 13 : 15} fill="currentColor" /><b>{value.toFixed(1)}</b>{count != null && <span className="muted">({count})</span>}</span>;
}
export function StarInput({ value, onChange }) {
  return <div className="star-input" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map(i =>
    <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={i + ' stars'} className={i <= value ? 'on' : ''} onClick={() => onChange(i)}><Icon n="star" s={24} fill={i <= value ? 'currentColor' : 'none'} /></button>)}</div>;
}

// Generated product artwork: pattern + category glyph. Never an external image.
export function ProductArt({ sub, art = 0, variant = 0, label, size = 'card' }) {
  const s = SUBS[sub]; const h = CAT_HUE[s.cat] + (art * 14) - 14 + variant * 9;
  const pat = (art + variant) % 3;
  return <div className={'art art-' + size} style={{ '--h': h }} role="img" aria-label={label || s.name + ' product image'}>
    <svg className="art-pat" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {pat === 0 && Array.from({ length: 9 }, (_, r) => Array.from({ length: 15 }, (_, c) => <circle key={r + '-' + c} cx={c * 14 + 4} cy={r * 14 + 4} r={((r + c) % 4 === 0) ? 2.2 : 1} fill="currentColor" />))}
      {pat === 1 && Array.from({ length: 14 }, (_, i) => <path key={i} d={`M${-40 + i * 18} 120 L${40 + i * 18} 0`} stroke="currentColor" strokeWidth="1" fill="none" />)}
      {pat === 2 && Array.from({ length: 7 }, (_, i) => <circle key={i} cx="170" cy="100" r={18 + i * 18} stroke="currentColor" strokeWidth="1" fill="none" />)}
    </svg>
    <span className="art-glyph"><Icon n={s.icon} s={size === 'hero' ? 64 : size === 'thumb' ? 22 : 40} /></span>
    {size !== 'thumb' && <span className="art-tag">{s.name}</span>}
  </div>;
}

export function ProductCard({ l }) {
  const { db, nav, me } = useApp();
  const st = db.stores[l.storeId]; const owner = db.users[st.ownerId]; const ls = listingStats(db, l);
  return <article className="pcard">
    <button className="pcard-media" onClick={() => nav({ page: 'product', id: l.id })} aria-label={'View ' + l.title}><ProductArt sub={l.sub} art={l.art} /></button>
    <div className="pcard-body">
      <button className="pcard-seller" onClick={() => nav({ page: 'store', id: st.id })}><Avatar name={st.name} hue={st.hue} size={20} square /><span>{st.name}</span></button>
      <h3 className="pcard-title"><a href="#" onClick={e => { e.preventDefault(); nav({ page: 'product', id: l.id }); }}>{l.title}</a></h3>
      <Stars value={ls.rating} count={ls.count} small />
      <dl className="pcard-meta"><div><dt>Min. order</dt><dd>{fmtN(minQty(l))} {l.unit}</dd></div><div><dt>Delivery</dt><dd>from {days(minDays(l))}</dd></div></dl>
      <div className="pcard-foot"><div><span className="muted xs">Starting at</span><div className="price">{money(startPrice(l))} <span className="cur">USD</span></div></div>
        <Btn v="primary" size="sm" onClick={() => nav({ page: 'product', id: l.id })}>{me && st.ownerId === me.id ? 'View' : 'Buy now'}</Btn></div>
    </div>
  </article>;
}

export function PackageSelector({ listing, pkgId, setPkgId, count, setCount }) {
  return <div className="pkgsel">
    <div className="pkg-list" role="radiogroup" aria-label="Packages">{listing.packages.map(p =>
      <label key={p.id} className={'pkg' + (p.id === pkgId ? ' on' : '')}>
        <input type="radio" name="pkg" checked={p.id === pkgId} onChange={() => setPkgId(p.id)} />
        <div className="pkg-main"><b>{p.name}</b><span className="muted small">{p.desc}</span></div>
        <div className="pkg-side"><span className="price">{money(p.price)}</span><span className="muted xs">{fmtN(p.qty)} {listing.unit} · {days(p.days)}</span></div>
      </label>)}</div>
    {setCount && <div className="qty-row"><span>Number of packages</span><Stepper value={count} min={1} max={10} onChange={setCount} label="Number of packages" /></div>}
  </div>;
}
export function Stepper({ value, min = 1, max = 99, onChange, label }) {
  return <div className="stepper" role="group" aria-label={label}>
    <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Decrease"><Icon n="minus" s={14} /></button>
    <span aria-live="polite">{value}</span>
    <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Increase"><Icon n="plus" s={14} /></button></div>;
}

export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef();
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); document.addEventListener('keydown', k); ref.current?.querySelector('input,textarea,select,button')?.focus(); return () => document.removeEventListener('keydown', k); }, []);
  return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
      <header className="modal-h"><h2>{title}</h2><button className="iconbtn" onClick={onClose} aria-label="Close"><Icon n="x" /></button></header>
      <div className="modal-b">{children}</div>
      {footer && <footer className="modal-f">{footer}</footer>}
    </div></div>;
}
export function Confirm({ title, body, confirmLabel = 'Confirm', danger, onConfirm, onClose, children }) {
  return <Modal title={title} onClose={onClose} footer={<><Btn v="ghost" onClick={onClose}>Cancel</Btn><Btn v={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Btn></>}>
    <p>{body}</p>{children}</Modal>;
}

export function Empty({ icon = 'box', title, children, action }) {
  return <div className="empty"><span className="empty-ic"><Icon n={icon} s={26} /></span><h3>{title}</h3>{children && <p className="muted">{children}</p>}{action}</div>;
}
export function ErrorState({ title = 'Something went wrong', children, onRetry }) {
  return <div className="empty err"><span className="empty-ic"><Icon n="alert" s={26} /></span><h3>{title}</h3><p className="muted">{children}</p>{onRetry && <Btn icon="refresh" onClick={onRetry}>Try again</Btn>}</div>;
}
export function SkeletonGrid({ n = 6 }) { return <div className="grid-cards" aria-busy="true" aria-label="Loading">{Array.from({ length: n }, (_, i) => <div key={i} className="pcard skel"><div className="sk sk-media" /><div className="pcard-body"><div className="sk sk-line w60" /><div className="sk sk-line" /><div className="sk sk-line w40" /></div></div>)}</div>; }

let fid = 0;
export function Field({ label, hint, error, required, children, id }) {
  const fidr = useRef(id || 'f' + (++fid));
  const child = React.Children.only(children);
  return <div className={'field' + (error ? ' has-err' : '')}>
    <label htmlFor={fidr.current}>{label}{required && <span className="req" aria-hidden="true"> *</span>}</label>
    {React.cloneElement(child, { id: fidr.current, 'aria-invalid': !!error, 'aria-required': required || undefined })}
    {error ? <span className="ferr" role="alert">{error}</span> : hint ? <span className="fhint">{hint}</span> : null}</div>;
}
export function Toggle({ checked, onChange, label, desc }) {
  return <label className="toggle"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span className="tg" aria-hidden="true" /><span><b>{label}</b>{desc && <span className="muted small block">{desc}</span>}</span></label>;
}
export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs" role="tablist">{tabs.map(t => <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>{t.label}{t.count != null && <span className="tab-n">{t.count}</span>}</button>)}</div>;
}
export function Seg({ options, value, onChange, label }) {
  return <div className="seg" role="radiogroup" aria-label={label}>{options.map(o => <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'on ' + (o.tone || '') : ''} onClick={() => onChange(o.id)}>{o.label}</button>)}</div>;
}

export function Progress({ o }) {
  const idx = { awaiting_info: 1, paid: 1, preparing: 2, partial: 2, delivered: 3, completed: 4 }[o.status];
  if (idx == null) return <div className="progress-off"><Icon n="info" s={16} /> Order {o.status}. Fulfilment progress stopped; history is kept below.</div>;
  return <ol className="progress">{PROGRESS.map((s, i) => <li key={s} className={i < idx ? 'done' : i === idx ? (o.status === 'completed' ? 'done' : 'cur') : ''}>
    <span className="pdot">{i < idx || o.status === 'completed' ? <Icon n="check" s={13} /> : i + 1}</span><span className="plabel">{s}</span></li>)}</ol>;
}
export function Timeline({ events }) {
  const list = [...events].sort((a, b) => b.at - a.at);
  return <ol className="timeline">{list.map(e => <li key={e.id} className={'tl-' + (e.kind || 'info')}><span className="tl-dot" /><div><div className="tl-text">{e.text}</div><div className="muted xs">{e.actor} · {fmtDT(e.at)}</div></div></li>)}</ol>;
}

export function FileChip({ f, onRemove, locked }) {
  const { toast } = useApp(); const [busy, setBusy] = useState(false);
  const ext = (f.name.split('.').pop() || '').toUpperCase();
  // Stored files open through a short-lived link the server gives only to people allowed to see them.
  const download = async () => { setBusy(true); try { const r = await api.fileUrl(f.id); window.location.assign(r.url); } catch (e) { toast(e.message || 'The file could not be opened.', 'bad'); } setBusy(false); };
  return <div className="filechip"><span className="fc-ext">{ext.slice(0, 4)}</span><div className="fc-main"><b>{f.name}</b><span className="muted xs">{fmtSize(f.size)}{locked ? ' · Private to order participants' : ''}</span></div>
    {onRemove ? <button className="iconbtn sm" onClick={onRemove} aria-label={'Remove ' + f.name}><Icon n="x" s={15} /></button> : f.id && apiEnabled ? <Btn size="sm" v="ghost" disabled={busy} onClick={download}>{busy ? 'Opening…' : 'Download'}</Btn> : <span className="sim">Preview only</span>}</div>;
}
// With `upload` and file storage on the server, files are uploaded privately and the list holds
// { id, name, size }. Otherwise the attachment is simulated: name and size only, nothing uploaded.
export const LIMIT = 60 * 1048576;
export function FilePicker({ files, setFiles, multiple = true, label = 'Attach file', compact, upload = false }) {
  const { fileMode } = useApp(); const real = upload && fileMode === 'r2';
  const [busy, setBusy] = useState(null); const [err, setErr] = useState('');
  const inp = useRef();
  async function add(list) {
    setErr('');
    for (const f of list) {
      if (f.size > LIMIT) { setErr(`${f.name} is ${fmtSize(f.size)}. The limit is 60 MB per file.`); continue; }
      if (/\.(exe|bat|cmd|scr|js|msi)$/i.test(f.name)) { setErr(`${f.name} was blocked. Executable files are not allowed.`); continue; }
      if (!real) { start({ name: f.name, size: f.size }); continue; }
      setBusy({ name: f.name, p: 0 });
      try { const done = await api.upload(f, p => setBusy({ name: f.name, p })); setFiles(prev => multiple ? [...prev, done] : [done]); }
      catch (e) { setErr(e.message || `${f.name} could not be uploaded. Try again.`); }
      setBusy(null);
    }
  }
  function start(f) {
    setBusy({ name: f.name, p: 0 });
    let p = 0; const t = setInterval(() => { p += 25; setBusy({ name: f.name, p }); if (p >= 100) { clearInterval(t); setBusy(null); setFiles(prev => multiple ? [...prev, f] : [f]); } }, 120);
  }
  return <div className={'filepick' + (compact ? ' compact' : '')}>
    <input ref={inp} type="file" hidden multiple={multiple} onChange={e => { add([...e.target.files]); e.target.value = ''; }} />
    <div className="fp-row">
      <Btn size="sm" icon="clip" disabled={!!busy} onClick={() => inp.current.click()}>{label}</Btn>
      {!compact && !real && <Btn size="sm" v="ghost" onClick={() => start({ name: 'sample_evidence_' + (files.length + 1) + '.pdf', size: 845000 + files.length * 120000 })}>Use sample file</Btn>}
      <span className="muted xs">Max 60 MB per file · {real ? 'Stored privately' : <Sim>Not uploaded</Sim>}</span>
    </div>
    {busy && <div className="fp-progress"><span className="xs">{busy.name}</span><div className="bar"><i style={{ width: busy.p + '%' }} /></div></div>}
    {err && <div className="ferr" role="alert">{err} <button className="linkbtn" onClick={() => setErr('')}>Dismiss</button></div>}
    {files.length > 0 && <div className="fp-files">{files.map((f, i) => <FileChip key={i} f={f} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />)}</div>}
  </div>;
}

export function NotificationList({ items, onOpen, compact }) {
  if (!items.length) return <Empty icon="bell" title="No notifications">Order, message and account updates will appear here.</Empty>;
  return <ul className={'nlist' + (compact ? ' compact' : '')}>{items.map(n => <li key={n.id} className={n.read ? '' : 'unread'}>
    <button onClick={() => onOpen(n)}><span className="n-dot" aria-label={n.read ? '' : 'Unread'} /><span className="n-text">{n.text}</span><span className="muted xs">{rel(n.at)}</span></button></li>)}</ul>;
}

export function Table({ cols, rows, empty, onRow }) {
  if (!rows.length) return empty || <Empty title="Nothing here yet" />;
  return <div className="table-wrap"><table className="tbl"><thead><tr>{cols.map(c => <th key={c.k} className={c.cls}>{c.label}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={r.id || i} className={onRow ? 'clickable' : ''} onClick={onRow ? e => { if (!e.target.closest('button,a,input,label')) onRow(r); } : undefined}>
      {cols.map(c => <td key={c.k} data-label={c.label} className={c.cls}>{c.render ? c.render(r) : r[c.k]}</td>)}</tr>)}</tbody></table></div>;
}
export function Stat({ label, value, sub, tone, onClick, icon }) {
  const Tag = onClick ? 'button' : 'div';
  return <Tag className={'stat' + (tone ? ' tone-' + tone : '') + (onClick ? ' clickable' : '')} onClick={onClick}>
    <span className="stat-l">{icon && <Icon n={icon} s={15} />}{label}</span><span className="stat-v">{value}</span>{sub && <span className="muted xs">{sub}</span>}</Tag>;
}
export function Section({ title, action, children, className = '' }) {
  return <section className={'card ' + className}>{(title || action) && <header className="card-h"><h2>{title}</h2>{action}</header>}{children}</section>;
}
export function KV({ items }) { return <dl className="kv">{items.filter(Boolean).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>; }
export function Notice({ tone = 'info', icon, title, children, action }) {
  return <div className={'notice tone-' + tone} role={tone === 'bad' ? 'alert' : 'status'}><Icon n={icon || (tone === 'ok' ? 'check' : tone === 'info' || tone === 'accent' ? 'info' : 'alert')} s={18} /><div className="notice-b">{title && <b>{title}</b>}{children && <div>{children}</div>}</div>{action}</div>;
}
