import React from 'react';
import { now } from '@crateline/domain/clock.js';
import { Icon, Btn, Field, Notice, Sim, Modal, Avatar, useApp } from './ui.jsx';
import { apiEnabled, api } from './api.js';
const { useState, useEffect } = React;

function AuthShell({ title, sub, children, foot }) {
  const { pendingIntent, db } = useApp();
  const l = pendingIntent?.listingId && db.listings.find(x => x.id === pendingIntent.listingId);
  const pkg = l && l.packages.find(p => p.id === pendingIntent.pkgId);
  return <div className="auth-wrap"><div className="auth-card card">
    <h1>{title}</h1>{sub && <p className="muted">{sub}</p>}
    {l && <div className="intent"><Icon n="info" s={16} /><span>After signing in you return to <b>{l.title}</b>{pkg ? <> with <b>{pkg.name}</b> × {pendingIntent.count || 1} selected</> : ''}.</span></div>}
    {!l && pendingIntent && <div className="intent"><Icon n="info" s={16} /><span>Sign in to continue. Your action will resume afterwards.</span></div>}
    {children}</div>{foot && <p className="auth-foot">{foot}</p>}</div>;
}

// Simulated: signs in as a demo identity without credentials, so it is not offered in API mode.
function GoogleBtn() {
  const { signIn, db } = useApp(); const [pick, setPick] = useState(false);
  if (apiEnabled) return null;
  return <>
    <button type="button" className="btn btn-secondary block google" onClick={() => setPick(true)}><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" /><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" /><path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-4V7.4H3.1a10 10 0 0 0 0 9.2z" /><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z" /></svg>Continue with Google <Sim /></button>
    {pick && <Modal title="Choose an account (simulated Google sign-in)" onClose={() => setPick(false)}>
      <p className="muted small">No connection to Google is made. Pick a demo identity.</p>
      <div className="acct-pick">{['u_mira', 'u_rafi'].map(id => { const u = db.users[id]; return <button key={id} onClick={() => { setPick(false); signIn(id); }}><Avatar name={u.name} hue={u.hue} size={34} /><div><b>{u.name}</b><span className="muted xs block">{u.email}</span></div></button>; })}</div>
    </Modal>}
  </>;
}

export function SignIn() {
  const { db, nav, signIn, apiSignIn } = useApp();
  const [id, setId] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (apiEnabled) {
      if (!id.trim() || !pw) return setErr('Enter your email or username and password.');
      setBusy(true); setErr('');
      try { await apiSignIn(() => api.login(id.trim(), pw)); }
      catch (x) { setBusy(false); setErr(x.status === 401 ? 'Email, username or password is incorrect. Check the details or reset your password.' : x.message); }
      return;
    }
    const u = Object.values(db.users).find(u => u.email.toLowerCase() === id.trim().toLowerCase() || u.username.toLowerCase() === id.trim().toLowerCase());
    if (!id.trim() || !pw) return setErr('Enter your email or username and password.');
    if (!u || pw === 'wrong') return setErr('Email, username or password is incorrect. Check the details or reset your password.');
    if (!u.emailVerified) return nav({ page: 'verify', userId: u.id });
    signIn(u.id);
  }
  return <AuthShell title="Sign in" sub="Welcome back to Crateline." foot={<>New here? <a href="#" onClick={e => { e.preventDefault(); nav({ page: 'signup' }); }}>Create an account</a></>}>
    {!apiEnabled && <><GoogleBtn /><div className="or"><span>or</span></div></>}
    <form onSubmit={submit} noValidate>
      {err && <Notice tone="bad">{err}</Notice>}
      <Field label="Email or username" required><input autoComplete="username" value={id} onChange={e => setId(e.target.value)} /></Field>
      <Field label="Password" required><input type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} /></Field>
      <div className="row-between"><span /><a href="#" className="small" onClick={e => { e.preventDefault(); nav({ page: 'forgot' }); }}>Forgot password?</a></div>
      <Btn v="primary" type="submit" className="block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Btn>
    </form>
    {!apiEnabled && <div className="demo-creds"><span className="xs muted">Demo accounts (any password):</span>
      <button className="chip sm" onClick={() => signIn('u_mira')}>mira@example.com · Buyer</button>
      <button className="chip sm" onClick={() => signIn('u_rafi')}>rafi@atlas.example · Seller</button></div>}
  </AuthShell>;
}

export function SignUp() {
  const { db, nav, update, apiSignIn, toast, emailMode } = useApp();
  const [v, setV] = useState({ name: '', username: '', email: '', password: '', phone: '', telegram: '', consent: false }); const [err, setErr] = useState({}); const [busy, setBusy] = useState(false);
  const s = k => e => setV({ ...v, [k]: k === 'consent' ? e.target.checked : e.target.value });
  async function submit(e) {
    // In API mode the browser does not hold other accounts; the server checks that the username and email are free.
    e.preventDefault(); const er = {}; const us = apiEnabled ? [] : Object.values(db.users);
    if (v.name.trim().length < 2) er.name = 'Enter your full name.';
    if (!/^[a-z0-9._]{3,20}$/i.test(v.username)) er.username = 'Use 3 to 20 letters, numbers, dots or underscores.';
    else if (us.some(u => u.username.toLowerCase() === v.username.toLowerCase())) er.username = 'This username is taken. Try another.';
    if (!/^\S+@\S+\.\S+$/.test(v.email)) er.email = 'Enter a valid email address.';
    else if (us.some(u => u.email.toLowerCase() === v.email.toLowerCase())) er.email = 'An account already uses this email. Sign in or reset your password.';
    if (v.password.length < 8 || !/\d/.test(v.password)) er.password = 'Use at least 8 characters including a number.';
    if (v.telegram && !/^@\w{3,}$/.test(v.telegram)) er.telegram = 'Telegram handles start with @.';
    if (!v.consent) er.consent = 'Accept the Terms and Privacy Policy to continue.';
    setErr(er); if (Object.keys(er).length) return;
    if (apiEnabled) {
      setBusy(true);
      try { await apiSignIn(() => api.register({ name: v.name.trim(), username: v.username, email: v.email.trim(), password: v.password, phone: v.phone.trim(), telegram: v.telegram.trim(), acceptTerms: v.consent })); if (emailMode && emailMode !== 'off') toast('Account created. We sent a link to ' + v.email.trim() + ' to confirm your address.', 'info'); }
      catch (x) { setBusy(false); setErr(x.field ? { [x.field]: x.message } : { form: x.message }); }
      return;
    }
    const id = update(d => { const id = 'u_new' + now(); d.users[id] = { id, name: v.name.trim(), username: v.username, email: v.email, phone: v.phone, telegram: v.telegram, hue: Math.floor(Math.random() * 360), acct: 'AC-' + (101000 + Object.keys(d.users).length), joined: now(), storeId: null, emailVerified: false, twoFA: false, prefs: { orders: true, messages: true, offers: true, marketing: false, email: true }, deletion: null, following: [] }; return id; });
    nav({ page: 'verify', userId: id });
  }
  return <AuthShell title="Create your account" sub="Buy from verified sellers. You can open a store later from the same account." foot={<>Already registered? <a href="#" onClick={e => { e.preventDefault(); nav({ page: 'signin' }); }}>Sign in</a></>}>
    {!apiEnabled && <><GoogleBtn /><div className="or"><span>or</span></div></>}
    <form onSubmit={submit} noValidate>
      {err.form && <Notice tone="bad">{err.form}</Notice>}
      <div className="form-grid">
        <Field label="Full name" required error={err.name}><input autoComplete="name" value={v.name} onChange={s('name')} /></Field>
        <Field label="Username" required error={err.username} hint="3 to 20 letters, numbers, dots or underscores"><input value={v.username} onChange={s('username')} /></Field>
        <Field label="Email" required error={err.email}><input type="email" autoComplete="email" value={v.email} onChange={s('email')} /></Field>
        <Field label="Password" required error={err.password} hint="At least 8 characters including a number"><input type="password" autoComplete="new-password" value={v.password} onChange={s('password')} /></Field>
        <Field label="Phone" hint="Optional"><input type="tel" value={v.phone} onChange={s('phone')} placeholder="+44 7700 900000" /></Field>
        <Field label="Telegram contact" hint="Optional" error={err.telegram}><input value={v.telegram} onChange={s('telegram')} placeholder="@handle" /></Field>
      </div>
      <label className={'checkline' + (err.consent ? ' has-err' : '')}><input type="checkbox" checked={v.consent} onChange={s('consent')} /><span>I accept the <a href="#" onClick={e => { e.preventDefault(); nav({ page: 'terms' }); }}>Terms and Conditions</a> and <a href="#" onClick={e => { e.preventDefault(); nav({ page: 'privacy' }); }}>Privacy Policy</a>.</span></label>
      {err.consent && <span className="ferr">{err.consent}</span>}
      <Btn v="primary" type="submit" className="block" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</Btn>
    </form></AuthShell>;
}

export function Verify() {
  const { db, route, nav, signIn, update } = useApp(); const u = db.users[route.userId];
  const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [wait, setWait] = useState(0); const [editing, setEditing] = useState(false); const [email, setEmail] = useState(u?.email || '');
  useEffect(() => { if (!wait) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);
  if (apiEnabled) return <ApiVerify />;
  if (!u) return <AuthShell title="Verification link expired"><p className="muted">Request a new code by signing in.</p><Btn onClick={() => nav({ page: 'signin' })}>Go to sign in</Btn></AuthShell>;
  return <AuthShell title="Verify your email" sub={<>We sent a 6-digit code to <b>{u.email}</b>.</>}>
    <Notice tone="accent" title="Demo code: 482913"><Sim>Simulated email</Sim> No email is sent in this prototype.</Notice>
    {err && <Notice tone="bad">{err}</Notice>}
    <Field label="Verification code" required><input inputMode="numeric" maxLength="6" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
    <Btn v="primary" className="block" onClick={() => { if (code !== '482913') return setErr('That code is not valid or has expired. Check the code or request a new one.'); update(d => { d.users[u.id].emailVerified = true; }); signIn(u.id); }}>Verify and continue</Btn>
    <div className="row-between small"><button className="linkbtn" disabled={wait > 0} onClick={() => { setWait(30); setErr(''); }}>{wait ? `Resend available in ${wait}s` : 'Resend code'}</button><button className="linkbtn" onClick={() => setEditing(!editing)}>Change email</button></div>
    {editing && <div className="inline-form"><Field label="New email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field><Btn size="sm" onClick={() => { update(d => { d.users[u.id].email = email; }); setEditing(false); setWait(30); }}>Update and resend</Btn></div>}
  </AuthShell>;
}

// ---------- API mode: links from real emails
// Development servers write emails to the API log instead of sending them; say so.
function DevMailNote() {
  const { emailMode } = useApp();
  return emailMode === 'log' ? <Notice tone="info"><Sim>Development</Sim> This server writes emails to the API log instead of sending them.</Notice> : null;
}
// Confirms a token from an email link once, on opening the page.
function useLinkConfirm(confirm) {
  const { route } = useApp(); const [state, setState] = useState(route.token ? 'working' : 'none'); const [msg, setMsg] = useState('');
  useEffect(() => { if (!route.token) return; let live = true; confirm(route.token).then(() => live && setState('ok'), e => { if (live) { setState('bad'); setMsg(e.message); } }); return () => { live = false; }; }, [route.token]);
  return [state, msg];
}
function ApiVerify() {
  const { me, nav, refresh, toast, emailMode } = useApp(); const [state, msg] = useLinkConfirm(t => api.verifyConfirm(t)); const [wait, setWait] = useState(0);
  useEffect(() => { if (state === 'ok' && me) refresh(); }, [state]);
  useEffect(() => { if (!wait) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);
  if (emailMode === 'off') return <EmailUnavailable title="Verify your email" what="Email verification" />;
  if (state === 'working') return <AuthShell title="Confirming your email"><p className="muted">One moment…</p></AuthShell>;
  if (state === 'ok') return <AuthShell title="Email confirmed"><Notice tone="ok">Your email address is verified.</Notice><Btn v="primary" className="block" onClick={() => nav(me ? { page: 'u-overview' } : { page: 'signin' })}>{me ? 'Continue' : 'Sign in'}</Btn></AuthShell>;
  const resend = async () => { try { await api.verifyRequest(); setWait(30); toast('Verification email sent'); } catch (e) { toast(e.message, 'bad'); } };
  return <AuthShell title={state === 'bad' ? 'This link did not work' : 'Check your inbox'} sub={state === 'bad' ? msg : me ? <>We sent a confirmation link to <b>{me.email}</b>. It expires in 24 hours.</> : 'Open the confirmation link from your email.'}>
    <DevMailNote />
    {me && !me.emailVerified ? <Btn v="primary" className="block" disabled={wait > 0} onClick={resend}>{wait ? `Send again in ${wait}s` : 'Send a new link'}</Btn>
      : <Btn className="block" onClick={() => nav({ page: me ? 'u-overview' : 'signin' })}>{me ? 'Back to your account' : 'Go to sign in'}</Btn>}
  </AuthShell>;
}
export function EmailConfirm() {
  const { me, nav, refresh } = useApp(); const [state, msg] = useLinkConfirm(t => api.confirmEmail(t));
  useEffect(() => { if (state === 'ok' && me) refresh(); }, [state]);
  if (state === 'working') return <AuthShell title="Confirming your new email"><p className="muted">One moment…</p></AuthShell>;
  if (state === 'ok') return <AuthShell title="Email address changed"><Notice tone="ok">Your account now uses the new address. Sign in with it from now on.</Notice><Btn v="primary" className="block" onClick={() => nav(me ? { page: 'account' } : { page: 'signin' })}>{me ? 'Back to account settings' : 'Sign in'}</Btn></AuthShell>;
  return <AuthShell title="This link did not work" sub={state === 'bad' ? msg : 'Open the confirmation link from the email sent to your new address.'}><Btn className="block" onClick={() => nav({ page: me ? 'account' : 'signin' })}>{me ? 'Back to account settings' : 'Go to sign in'}</Btn></AuthShell>;
}
function ApiForgot() {
  const { nav, emailMode } = useApp(); const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (emailMode === 'off') return <EmailUnavailable title="Reset your password" what="Password reset" />;
  const submit = async e => { e.preventDefault(); if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email address.'); setBusy(true); setErr(''); try { await api.forgotPassword(email.trim()); setSent(true); } catch (x) { setErr(x.message); } setBusy(false); };
  return <AuthShell title="Reset your password" sub="Enter your account email. We send a link that works once and expires in 30 minutes.">
    <DevMailNote />
    {sent ? <Notice tone="ok" title="Check your inbox">If an account uses {email}, a reset link is on its way. It can take a few minutes; check spam too.</Notice> :
      <form onSubmit={submit} noValidate><Field label="Email" required error={err}><input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Btn v="primary" type="submit" className="block" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</Btn></form>}
    <p className="small"><a href="#" onClick={e => { e.preventDefault(); nav({ page: 'signin' }); }}>Back to sign in</a></p>
  </AuthShell>;
}
function ApiReset() {
  const { route, nav, toast, emailMode } = useApp(); const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState({}); const [busy, setBusy] = useState(false);
  if (emailMode === 'off') return <EmailUnavailable title="Choose a new password" what="Password reset" />;
  if (!route.token) return <AuthShell title="Choose a new password" sub="Open the reset link from your email to choose a new password."><Btn className="block" onClick={() => nav({ page: 'forgot' })}>Send a reset link</Btn></AuthShell>;
  const submit = async e => {
    e.preventDefault(); const er = {}; if (a.length < 8 || !/\d/.test(a)) er.a = 'Use at least 8 characters including a number.'; if (a !== b) er.b = 'Passwords do not match.'; setErr(er); if (Object.keys(er).length) return;
    setBusy(true);
    try { const r = await api.resetPassword(route.token, a); api.logout(); toast('Password updated. Sign in with your new password. Other sessions were signed out'); nav({ page: r.kind === 'staff' ? 'staff-signin' : 'signin' }); }
    catch (x) { setBusy(false); setErr(x.field === 'password' ? { a: x.message } : { form: x.message }); }
  };
  return <AuthShell title="Choose a new password">
    <form onSubmit={submit} noValidate>
      {err.form && <Notice tone="bad" title="This link did not work">{err.form} <a href="#" onClick={e => { e.preventDefault(); nav({ page: 'forgot' }); }}>Send a new link</a></Notice>}
      <Field label="New password" required error={err.a} hint="At least 8 characters including a number"><input type="password" autoComplete="new-password" value={a} onChange={e => setA(e.target.value)} /></Field>
      <Field label="Confirm password" required error={err.b}><input type="password" autoComplete="new-password" value={b} onChange={e => setB(e.target.value)} /></Field>
      <Btn v="primary" type="submit" className="block" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</Btn></form></AuthShell>;
}

// Shown in API mode when the server has no email set up.
function EmailUnavailable({ title, what }) {
  const { nav } = useApp();
  return <AuthShell title={title}>
    <Notice tone="info" title={`${what} is not available yet`}>This server does not send email yet, so this cannot be done online. Ask the marketplace team to help with your account.</Notice>
    <Btn v="primary" onClick={() => nav({ page: 'signin' })}>Back to sign in</Btn>
  </AuthShell>;
}

export function Forgot() {
  const { nav } = useApp(); const [email, setEmail] = useState(''); const [sent, setSent] = useState(false);
  if (apiEnabled) return <ApiForgot />;
  return <AuthShell title="Reset your password" sub="Enter your account email and we will send a single-use link that expires in 30 minutes.">
    {sent ? <><Notice tone="ok">If an account exists for {email}, a reset link has been sent.</Notice><Btn className="block" onClick={() => nav({ page: 'reset' })}>Open the reset link <Sim /></Btn></> :
      <form onSubmit={e => { e.preventDefault(); if (/^\S+@\S+\.\S+$/.test(email)) setSent(true); }} noValidate>
        <Field label="Email" required error={email && !/^\S+@\S+\.\S+$/.test(email) ? 'Enter a valid email address.' : ''}><input type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Btn v="primary" type="submit" className="block">Send reset link</Btn></form>}
    <p className="small"><a href="#" onClick={e => { e.preventDefault(); nav({ page: 'signin' }); }}>Back to sign in</a></p>
  </AuthShell>;
}
export function Reset() {
  const { nav, toast } = useApp(); const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState({});
  if (apiEnabled) return <ApiReset />;
  return <AuthShell title="Choose a new password">
    <form onSubmit={e => { e.preventDefault(); const er = {}; if (a.length < 8 || !/\d/.test(a)) er.a = 'Use at least 8 characters including a number.'; if (a !== b) er.b = 'Passwords do not match.'; setErr(er); if (!Object.keys(er).length) { toast('Password updated. Sign in with your new password.'); nav({ page: 'signin' }); } }} noValidate>
      <Field label="New password" required error={err.a} hint="At least 8 characters including a number"><input type="password" value={a} onChange={e => setA(e.target.value)} /></Field>
      <Field label="Confirm password" required error={err.b}><input type="password" value={b} onChange={e => setB(e.target.value)} /></Field>
      <Btn v="primary" type="submit" className="block">Update password</Btn></form></AuthShell>;
}
