import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { DomainError, tick, audit } from '@crateline/domain/fin.js';
import { createTicket } from '@crateline/domain/actions.js';
import { addPayoutMethod } from '@crateline/domain/seller.js';
import { compose, emailEnabled, processOutbox } from './email.js';
import { newSecret, verifyCode, otpauthUri, newRecoveryCodes, hashRecovery, encrypt, decrypt } from './totp.js';
import { config } from './config.js';
import { currentTerms, paymentProviderEvent } from '@crateline/domain/logic.js';
import { STATUS as PAY_STATUS, PAYOUT_STATUS } from './payments.js';
import { executePayout, payoutNotSent, payoutSent, payoutProviderEvent, need, PAYOUT_NETS } from '@crateline/domain/fin.js';
import { realPayout } from './actions.js';
import { kycSessionStarted, kycProviderEvent, addStaff } from '@crateline/domain/ops.js';
import { catalogView, customerView, staffView } from './views.js';
import { customer as CUSTOMER, staff as STAFF } from './actions.js';
import { seedStore } from './seed.js';
import { launchDocument } from './launch.js';
import { filesEnabled, fileIdsIn, MAX_FILE_BYTES, BLOCKED_EXT, DOWNLOAD_TTL_S } from './files.js';
import { can } from '@crateline/domain/fin.js';

const STATUS = { unauthenticated: 401, denied: 403, not_found: 404, stale: 409, validation: 422, 'needs-decision': 422, rejected: 400 };

// Single-use tokens: the random token goes into the email link; only its SHA-256 hash is stored.
const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const HOUR_MS = 3600e3;

export function createApp(store, { transport = null, storage = null, payments = null, kyc = null } = {}) {
  // Deliver queued email soon after a request queues it; the interval worker in index.js retries.
  let sending = null;
  const kick = () => { if (transport && !sending) sending = processOutbox(store, transport).catch(e => console.error('email send failed', e)).finally(() => { sending = null; }); };
  // Queues an email with a fresh single-use token, inside a transaction.
  const queueTokenEmail = async (tx, { kind, template, to, name, accountKind, refId, newEmail = null, hours, data = {} }) => {
    const token = newToken();
    // `to` is the account's current address; for an email change the link goes to newEmail.
    await tx.saveToken({ hash: hashToken(token), kind, email: to, accountKind, refId, newEmail, expiresAt: Date.now() + hours * HOUR_MS });
    await tx.queueEmail(compose(template, newEmail || to, { ...data, name, token }));
  };
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || config.origins.includes(origin)), credentials: false }));
  app.use(express.json({ limit: '200kb' }));

  const authLimiter = rateLimit({ windowMs: 15 * 60e3, limit: config.authRateLimit, standardHeaders: true, legacyHeaders: false });
  // Staff tokens carry the account's tokenVersion; revoking all sessions raises it.
  const sign = (kind, id, tv = 0) => jwt.sign({ kind, id, tv }, config.jwtSecret, { expiresIn: config.jwtTtl });
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => {
    if (e instanceof DomainError) return res.status(STATUS[e.code] || 400).json({ error: e.message, code: e.code, field: e.field });
    if (e.status) return res.status(e.status).json({ error: e.message, field: e.field });
    console.error(e); res.status(500).json({ error: 'Something went wrong. Nothing was changed.' });
  });
  // Resolve the caller from the token on every request; inactive staff are refused.
  const auth = (required = true) => wrap(async (req, res, next) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) { if (required) return res.status(401).json({ error: 'Sign in required.' }); return next(); }
    try { req.auth = jwt.verify(h.slice(7), config.jwtSecret); } catch { return res.status(401).json({ error: 'Your session has expired. Sign in again.' }); }
    // Only session tokens open the API; a two-factor ticket ('mfa') is accepted by /api/auth/mfa alone.
    if (req.auth.kind !== 'user' && req.auth.kind !== 'staff') return res.status(401).json({ error: 'Sign in required.' });
    next();
  });
  const actorFrom = (d, a) => {
    const rec = a.kind === 'staff' ? d.staff[a.id] : d.users[a.id];
    if (!rec) throw new DomainError('Account not found.', 'denied');
    if (a.kind === 'staff' && !rec.active) throw new DomainError('This staff account is inactive.', 'denied');
    // tokenVersion rises when all sessions are revoked or the password changes.
    if ((rec.tokenVersion || 0) !== (a.tv || 0)) throw new DomainError('Your session was ended. Sign in again.', 'unauthenticated');
    return rec;
  };

  app.get('/health', wrap(async (req, res) => res.json({ ok: true, store: store.kind, simulateProviders: config.simulateProviders, demoControls: config.allowDemoControls, launchReset: config.allowLaunchReset, email: config.emailTransport, files: storage ? config.fileStorage : 'off', payments: payments ? (payments.sandbox ? 'nowpayments-sandbox' : 'nowpayments') : 'simulated', payouts: payments?.canPayOut && config.payouts === 'nowpayments' ? 'nowpayments' : 'simulated', kyc: kyc ? 'didit' : 'simulated', version: (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || 'local' })));

  app.get('/api/catalog', wrap(async (req, res) => { const { doc } = await store.read(); res.json(catalogView(doc)); }));

  app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
    const { name, username, email, password, phone = '', telegram = '', acceptTerms } = req.body || {};
    // Each error names its form field so the sign-up form can show it in place.
    const invalid = (msg, field) => { throw Object.assign(new DomainError(msg, 'validation'), { field }); };
    if (typeof name !== 'string' || name.trim().length < 2 || name.length > 100) invalid('Enter your full name.', 'name');
    if (typeof username !== 'string' || !/^[a-z0-9._]{3,20}$/i.test(username)) invalid('Use 3 to 20 letters, numbers, dots or underscores.', 'username');
    if (typeof email !== 'string' || email.length > 200 || !/^\S+@\S+\.\S+$/.test(email)) invalid('Enter a valid email address.', 'email');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200 || !/\d/.test(password)) invalid('Use at least 8 characters including a number.', 'password');
    if (typeof phone !== 'string' || phone.length > 40) invalid('Enter a phone number of up to 40 characters.', 'phone');
    if (typeof telegram !== 'string' || (telegram && !/^@\w{3,32}$/.test(telegram))) invalid('Telegram handles start with @.', 'telegram');
    if (acceptTerms !== true) invalid('Accept the Terms and Privacy Policy to continue.', 'consent');
    const hash = await bcrypt.hash(password, 10);
    const { value: id } = await store.transact(async (d, tx) => {
      if (Object.values(d.users).some(u => u.username.toLowerCase() === username.toLowerCase())) invalid('This username is taken. Try another.', 'username');
      const id = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await tx.createAccount({ email, kind: 'user', refId: id, hash });
      d.users[id] = { id, name: String(name).trim(), username, email: email.toLowerCase(), phone, telegram, hue: Math.floor(Math.random() * 360), acct: 'AC-' + (101000 + Object.keys(d.users).length), joined: Date.now(), storeId: null, emailVerified: false, twoFA: false, prefs: { orders: true, messages: true, offers: true, marketing: false, email: true }, deletion: null, following: [], restrictions: [], lastActive: Date.now(), termsAccepted: { version: currentTerms(d), at: Date.now() } };
      if (emailEnabled()) await queueTokenEmail(tx, { kind: 'verify', template: 'verify', to: email.toLowerCase(), name: String(name).trim().split(' ')[0], accountKind: 'user', refId: id, hours: 24 });
      return id;
    });
    kick();
    res.status(201).json({ token: sign('user', id), kind: 'user', id });
  }));

  const login = kind => wrap(async (req, res) => {
    const { email, password } = req.body || {};
    // Customers may sign in with their username; staff always use their email.
    let address = typeof email === 'string' ? email.trim() : '';
    if (kind === 'user' && address && !address.includes('@')) { const { doc } = await store.read(); address = Object.values(doc.users).find(u => u.username.toLowerCase() === address.toLowerCase())?.email || ''; }
    const acc = address && await store.findAccount(address);
    // Same message for unknown email and wrong password, so responses do not reveal accounts.
    if (!acc || acc.kind !== kind || !(await bcrypt.compare(String(password || ''), acc.hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    if (kind === 'staff') { const { doc } = await store.read(); if (!doc.staff[acc.refId]?.active) return res.status(403).json({ error: 'This staff account is inactive.' }); }
    // With two-factor sign-in on, the password only earns a 5-minute ticket for the code step.
    if (acc.totpSecret) return res.json({ mfa: 'required', ticket: jwt.sign({ kind: 'mfa', account: kind, id: acc.refId, email: acc.email }, config.jwtSecret, { expiresIn: '5m' }) });
    res.json(await finishSignIn(kind, acc, 'Password sign-in via API'));
  });
  const finishSignIn = async (kind, acc, detail) => {
    if (kind === 'staff') await store.transact(d => { const s = d.staff[acc.refId]; s.lastSignIn = Date.now(); d.securityEvents.unshift({ id: 'SE-' + Date.now(), at: Date.now(), type: 'Sign-in', who: s.name, detail, status: 'Normal' }); });
    const { doc: cur } = await store.read(); const tv = (kind === 'staff' ? cur.staff : cur.users)[acc.refId]?.tokenVersion || 0;
    return { token: sign(kind, acc.refId, tv), kind, id: acc.refId };
  };
  // Checks a six-digit authenticator code (once per step) or an unused recovery code.
  const checkSecondFactor = async (acc, code) => {
    const c = String(code || '').trim();
    if (/^\d{6}$/.test(c.replace(/\s/g, ''))) { const step = verifyCode(decrypt(acc.totpSecret), c, { lastStep: acc.totpLastStep ?? -1 }); return step != null && await store.useMfaStep(acc.email, step) ? 'code' : null; }
    return c && await store.useRecovery(acc.email, hashRecovery(c)) ? 'recovery' : null;
  };
  const badCode = () => { throw Object.assign(new DomainError('That code is not valid. Check the time on your phone, wait for a new code, or use a recovery code.', 'validation'), { field: 'code' }); };
  app.post('/api/auth/mfa', authLimiter, wrap(async (req, res) => {
    const { ticket, code } = req.body || {};
    let t; try { t = jwt.verify(String(ticket || ''), config.jwtSecret); } catch { t = null; }
    if (!t || t.kind !== 'mfa') return res.status(401).json({ error: 'The sign-in step has expired. Enter your email and password again.' });
    const acc = await store.findAccount(t.email);
    if (!acc || acc.refId !== t.id || acc.kind !== t.account || !acc.totpSecret) return res.status(401).json({ error: 'The sign-in step has expired. Enter your email and password again.' });
    const used = await checkSecondFactor(acc, code); if (!used) badCode();
    res.json(await finishSignIn(t.account, acc, used === 'recovery' ? 'Password and recovery code sign-in' : 'Password and authenticator code sign-in'));
  }));

  // ---------- setting up and turning off two-factor sign-in
  const meAccount = async auth => { const { doc } = await store.read(); const rec = actorFrom(doc, auth); return { rec, acc: await store.findAccount(rec.email) }; };
  const recordTwoFactor = (auth, on) => store.transact(async (d, tx) => {
    const rec = actorFrom(d, auth); rec.twoFA = on;
    if (auth.kind === 'staff') audit(d, rec, on ? 'Two-factor sign-in turned on' : 'Two-factor sign-in turned off', rec.id);
    if (emailEnabled()) await tx.queueEmail(compose(on ? 'twoFactorOn' : 'twoFactorOff', rec.email, { name: rec.name.split(' ')[0] }));
  });
  app.post('/api/auth/2fa/setup', authLimiter, auth(), wrap(async (req, res) => {
    const { rec, acc } = await meAccount(req.auth);
    if (acc.totpSecret) throw new DomainError('Two-factor sign-in is already on.');
    const secret = newSecret(); await store.setMfa(acc.email, { totpPending: encrypt(secret) });
    res.json({ secret, uri: otpauthUri(secret, rec.email) });
  }));
  app.post('/api/auth/2fa/enable', authLimiter, auth(), wrap(async (req, res) => {
    const { acc } = await meAccount(req.auth);
    if (acc.totpSecret) throw new DomainError('Two-factor sign-in is already on.');
    if (!acc.totpPending) throw new DomainError('Start the set-up again to get a new key.');
    const secret = decrypt(acc.totpPending); const step = verifyCode(secret, req.body?.code); if (step == null) badCode();
    const codes = newRecoveryCodes();
    await store.setMfa(acc.email, { totpSecret: encrypt(secret), totpPending: null, totpLastStep: step, recoveryHashes: codes.map(hashRecovery) });
    await recordTwoFactor(req.auth, true); kick();
    res.json({ ok: true, recoveryCodes: codes });
  }));
  app.post('/api/auth/2fa/disable', authLimiter, auth(), wrap(async (req, res) => {
    const { acc } = await meAccount(req.auth);
    if (!acc.totpSecret) throw new DomainError('Two-factor sign-in is not on.');
    if (!(await bcrypt.compare(String(req.body?.password || ''), acc.hash))) throw Object.assign(new DomainError('Your password is incorrect.', 'validation'), { field: 'password' });
    if (!(await checkSecondFactor(acc, req.body?.code))) badCode();
    await store.setMfa(acc.email, { totpSecret: null, totpPending: null, totpLastStep: null, recoveryHashes: [] });
    await recordTwoFactor(req.auth, false); kick();
    res.json({ ok: true });
  }));
  app.post('/api/auth/2fa/recovery', authLimiter, auth(), wrap(async (req, res) => {
    const { acc } = await meAccount(req.auth);
    if (!acc.totpSecret) throw new DomainError('Two-factor sign-in is not on.');
    if (!(await checkSecondFactor(acc, req.body?.code))) badCode();
    const codes = newRecoveryCodes(); await store.setMfa(acc.email, { recoveryHashes: codes.map(hashRecovery) });
    res.json({ ok: true, recoveryCodes: codes });
  }));
  app.post('/api/auth/login', authLimiter, login('user'));
  app.post('/api/auth/staff/login', authLimiter, login('staff'));

  // Support requests: guests may send one; a signed-in customer's request is linked to their account.
  app.post('/api/support', authLimiter, auth(false), wrap(async (req, res) => {
    const { value: id } = await store.transact(d => {
      const u = req.auth?.kind === 'user' ? actorFrom(d, req.auth) : null;
      return createTicket(d, u ? u.id : null, req.body || {});
    });
    res.status(201).json({ ok: true, ticketId: id });
  }));

  // Changing the password ends every other session (tokenVersion) and returns a fresh token.
  app.post('/api/auth/password', authLimiter, auth(), wrap(async (req, res) => {
    const { current, next } = req.body || {};
    if (typeof next !== 'string' || next.length < 8 || next.length > 200 || !/\d/.test(next)) throw Object.assign(new DomainError('New password needs 8 characters including a number.', 'validation'), { field: 'next' });
    const { doc } = await store.read(); const actor = actorFrom(doc, req.auth);
    const acc = await store.findAccount(actor.email);
    if (!acc || !(await bcrypt.compare(String(current || ''), acc.hash))) throw Object.assign(new DomainError('Your current password is incorrect.', 'validation'), { field: 'current' });
    const hash = await bcrypt.hash(next, 10);
    const { value: tv } = await store.transact(async (d, tx) => {
      const rec = req.auth.kind === 'staff' ? d.staff[req.auth.id] : d.users[req.auth.id];
      await tx.setPassword(acc.email, hash); rec.tokenVersion = (rec.tokenVersion || 0) + 1;
      if (req.auth.kind === 'staff') audit(d, rec, 'Password changed', rec.id);
      if (emailEnabled()) await tx.queueEmail(compose('passwordChanged', acc.email, { name: rec.name.split(' ')[0] }));
      return rec.tokenVersion;
    });
    kick();
    res.json({ ok: true, token: sign(req.auth.kind, req.auth.id, tv) });
  }));

  // Adding a staff member: a Super Admin (confirming with their own password) creates the record
  // and a sign-in that nobody knows the password of; the new member gets an emailed link, valid
  // 72 hours, to choose their password. Needs working email.
  const inviteLink = (tx, d, t, by) => queueTokenEmail(tx, { kind: 'reset', template: 'staffInvite', to: t.email, name: t.name.split(' ')[0], accountKind: 'staff', refId: t.id, hours: 72, data: { by, role: d.roles[t.activeRole].name } });
  const staffManager = async (req) => {
    const { doc } = await store.read(); const actor = req.auth.kind === 'staff' && actorFrom(doc, req.auth);
    if (!actor) throw new DomainError('Staff only.', 'denied');
    need(doc, actor, 'staff.manage', 'manage staff');
    const mine = await store.findAccount(actor.email);
    if (!mine || !(await bcrypt.compare(String(req.body?.password || ''), mine.hash))) throw Object.assign(new DomainError('Your password is incorrect.', 'validation'), { field: 'password' });
    return doc;
  };
  app.post('/api/staff', authLimiter, auth(), wrap(async (req, res) => {
    if (!emailEnabled()) throw new DomainError('Email is not set up on this server, so the new staff member could not be sent a link to choose a password.', 'rejected');
    await staffManager(req);
    const { name, email, role, reason } = req.body || {}; const to = String(email || '').trim().toLowerCase();
    if (to && await store.findAccount(to)) throw Object.assign(new DomainError('An account already uses this email. Staff need an address that is not a customer account.', 'validation'), { field: 'email' });
    // A random password nobody is told: the account cannot be used until the link sets a real one.
    const hash = await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 10);
    const { value: id } = await store.transact(async (d, tx) => {
      const a = actorFrom(d, req.auth); const sid = addStaff(d, a, { name, email: to, role, reason });
      await tx.createAccount({ email: to, kind: 'staff', refId: sid, hash });
      await inviteLink(tx, d, d.staff[sid], a.name);
      return sid;
    });
    kick(); res.status(201).json({ ok: true, staffId: id });
  }));
  // Sends the set-your-password link again (for a member who has not signed in yet).
  app.post('/api/staff/:id/invite', authLimiter, auth(), wrap(async (req, res) => {
    if (!emailEnabled()) throw new DomainError('Email is not set up on this server.', 'rejected');
    const doc = await staffManager(req); const t = doc.staff[req.params.id];
    if (!t) throw new DomainError('Staff member not found.', 'not_found');
    if (!t.active) throw new DomainError('This staff account is inactive.', 'rejected');
    if (t.lastSignIn) throw new DomainError('This staff member has already signed in. They can use "Forgot password?" on the staff sign-in page.', 'rejected');
    await store.transact(async (d, tx) => { const a = actorFrom(d, req.auth); await inviteLink(tx, d, d.staff[t.id], a.name); audit(d, a, 'Staff set-up link sent again', t.id); });
    kick(); res.json({ ok: true });
  }));

  // A staff member's sign-in email is changed by a Super Admin (their own included), who confirms
  // with their own password. The staff member's sessions end and both addresses are told.
  app.post('/api/staff/:id/email', authLimiter, auth(), wrap(async (req, res) => {
    const to = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { doc } = await store.read(); const actor = req.auth.kind === 'staff' && actorFrom(doc, req.auth);
    if (!actor) throw new DomainError('Staff only.', 'denied');
    need(doc, actor, 'staff.manage', 'change staff email addresses');
    const target = doc.staff[req.params.id]; if (!target) throw new DomainError('Staff member not found.', 'not_found');
    if (!/^\S+@\S+\.\S+$/.test(to) || to.length > 200) throw Object.assign(new DomainError('Enter a valid email address.', 'validation'), { field: 'email' });
    const mine = await store.findAccount(actor.email);
    if (!mine || !(await bcrypt.compare(String(req.body?.password || ''), mine.hash))) throw Object.assign(new DomainError('Your password is incorrect.', 'validation'), { field: 'password' });
    if (to === target.email) throw Object.assign(new DomainError('That is already the email address.', 'validation'), { field: 'email' });
    if (await store.findAccount(to)) throw Object.assign(new DomainError('An account already uses this email.', 'validation'), { field: 'email' });
    const { value: tv } = await store.transact(async (d, tx) => {
      const a = actorFrom(d, req.auth); need(d, a, 'staff.manage', 'change staff email addresses'); const t = d.staff[req.params.id]; const from = t.email;
      await tx.changeAccountEmail(from, to); t.email = to; t.tokenVersion = (t.tokenVersion || 0) + 1;
      audit(d, a, 'Staff email changed', t.id, { before: from, after: to, sensitive: true });
      if (emailEnabled()) { await tx.queueEmail(compose('emailChanged', from, { name: t.name.split(' ')[0], newEmail: to })); await tx.queueEmail(compose('emailChanged', to, { name: t.name.split(' ')[0], newEmail: to })); }
      return t.tokenVersion;
    });
    kick();
    // Changing your own address keeps you signed in with a fresh token.
    res.json({ ok: true, ...(target.id === actor.id ? { token: sign('staff', actor.id, tv) } : {}) });
  }));

  // ---------- email verification, password reset and email change (need a working email transport)
  const needEmail = () => { if (!emailEnabled()) throw new DomainError('Email is not set up on this server yet.', 'rejected'); };
  const badLink = () => { throw new DomainError('This link is invalid, already used or expired. Request a new one.', 'rejected'); };
  const passwordOk = p => typeof p === 'string' && p.length >= 8 && p.length <= 200 && /\d/.test(p);

  app.post('/api/auth/verify/request', authLimiter, auth(), wrap(async (req, res) => {
    needEmail(); if (req.auth.kind !== 'user') throw new DomainError('Only customer accounts verify their email here.', 'denied');
    await store.transact(async (d, tx) => {
      const u = actorFrom(d, req.auth); if (u.emailVerified) throw new DomainError('Your email address is already verified.');
      await queueTokenEmail(tx, { kind: 'verify', template: 'verify', to: u.email, name: u.name.split(' ')[0], accountKind: 'user', refId: u.id, hours: 24 });
    });
    kick(); res.json({ ok: true });
  }));
  app.post('/api/auth/verify/confirm', authLimiter, wrap(async (req, res) => {
    needEmail();
    await store.transact(async (d, tx) => {
      const t = await tx.useToken(hashToken(req.body?.token), 'verify', Date.now()); if (!t) badLink();
      const u = d.users[t.refId]; if (!u || u.email !== t.email) badLink(); // the address changed since the link was sent
      u.emailVerified = true;
    });
    res.json({ ok: true });
  }));

  // Same answer whether or not the account exists, so the form cannot be used to find accounts.
  app.post('/api/auth/password/forgot', authLimiter, wrap(async (req, res) => {
    needEmail();
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new DomainError('Enter a valid email address.', 'validation'), { field: 'email' });
    const acc = await store.findAccount(email);
    if (acc) {
      await store.transact(async (d, tx) => {
        const rec = acc.kind === 'staff' ? d.staff[acc.refId] : d.users[acc.refId]; if (!rec || (acc.kind === 'staff' && !rec.active)) return;
        await queueTokenEmail(tx, { kind: 'reset', template: 'reset', to: acc.email, name: rec.name.split(' ')[0], accountKind: acc.kind, refId: acc.refId, hours: 0.5 });
      });
      kick();
    }
    res.json({ ok: true });
  }));
  app.post('/api/auth/password/reset', authLimiter, wrap(async (req, res) => {
    needEmail();
    const { token, password } = req.body || {};
    if (!passwordOk(password)) throw Object.assign(new DomainError('Use at least 8 characters including a number.', 'validation'), { field: 'password' });
    const hash = await bcrypt.hash(password, 10);
    const { value } = await store.transact(async (d, tx) => {
      const t = await tx.useToken(hashToken(token), 'reset', Date.now()); if (!t) badLink();
      const rec = t.accountKind === 'staff' ? d.staff[t.refId] : d.users[t.refId]; if (!rec) badLink();
      await tx.setPassword(t.email, hash); rec.tokenVersion = (rec.tokenVersion || 0) + 1; // every session ends
      if (t.accountKind === 'staff') audit(d, rec, 'Password reset by email', rec.id);
      await tx.queueEmail(compose('passwordChanged', t.email, { name: rec.name.split(' ')[0] }));
      return { kind: t.accountKind };
    });
    kick(); res.json({ ok: true, kind: value.kind });
  }));

  // Changing the address: confirmed from the new address; the old one is told when it happens.
  app.post('/api/auth/email/change', authLimiter, auth(), wrap(async (req, res) => {
    needEmail(); if (req.auth.kind !== 'user') throw new DomainError('Staff email addresses are changed by a Super Admin.', 'denied');
    const { newEmail, password } = req.body || {};
    const to = typeof newEmail === 'string' ? newEmail.trim().toLowerCase() : '';
    if (!/^\S+@\S+\.\S+$/.test(to) || to.length > 200) throw Object.assign(new DomainError('Enter a valid email address.', 'validation'), { field: 'email' });
    const { doc } = await store.read(); const u = actorFrom(doc, req.auth);
    const acc = await store.findAccount(u.email);
    if (!acc || !(await bcrypt.compare(String(password || ''), acc.hash))) throw Object.assign(new DomainError('Your password is incorrect.', 'validation'), { field: 'password' });
    if (to === u.email) throw Object.assign(new DomainError('That is already your email address.', 'validation'), { field: 'email' });
    if (await store.findAccount(to)) throw Object.assign(new DomainError('An account already uses this email.', 'validation'), { field: 'email' });
    await store.transact(async (d, tx) => { const me = actorFrom(d, req.auth); await queueTokenEmail(tx, { kind: 'email', template: 'emailChange', to: me.email, name: me.name.split(' ')[0], accountKind: 'user', refId: me.id, newEmail: to, hours: 24 }); });
    kick(); res.json({ ok: true });
  }));
  app.post('/api/auth/email/confirm', authLimiter, wrap(async (req, res) => {
    needEmail();
    await store.transact(async (d, tx) => {
      const t = await tx.useToken(hashToken(req.body?.token), 'email', Date.now()); if (!t) badLink();
      const u = d.users[t.refId]; if (!u || u.email !== t.email) badLink();
      await tx.changeAccountEmail(t.email, t.newEmail);
      u.email = t.newEmail; u.emailVerified = true;
      await tx.queueEmail(compose('emailChanged', t.email, { name: u.name.split(' ')[0], newEmail: t.newEmail }));
    });
    kick(); res.json({ ok: true });
  }));

  // New payout destinations need the account password again, checked here before the change.
  app.post('/api/payout-methods', authLimiter, auth(), wrap(async (req, res) => {
    if (req.auth.kind !== 'user') throw new DomainError('Only sellers can add payout methods.', 'denied');
    const { password, ...method } = req.body || {};
    const { doc } = await store.read(); const actor = actorFrom(doc, req.auth);
    const acc = await store.findAccount(actor.email);
    if (!acc || !(await bcrypt.compare(String(password || ''), acc.hash))) throw Object.assign(new DomainError('Your password is incorrect.', 'validation'), { field: 'password' });
    const { version } = await store.transact(d => addPayoutMethod(d, actorFrom(d, req.auth), method));
    res.status(201).json({ ok: true, version });
  }));

  // ---------- crypto payments (NOWPayments)
  // The buyer checks out (action `checkout`, purchase Pending), then asks for the hosted invoice
  // page here. Asking again returns the same invoice.
  app.post('/api/payments/:purchaseId/start', auth(), wrap(async (req, res) => {
    if (!payments) throw new DomainError('Crypto payments are not set up on this server yet.', 'rejected');
    const { doc } = await store.read(); const u = req.auth.kind === 'user' && actorFrom(doc, req.auth);
    const p = u && doc.purchases.find(x => x.id === req.params.purchaseId && x.buyerId === u.id); const pay = p && doc.payments.find(x => x.purchaseId === p.id);
    if (!pay || p.provider !== payments.name) throw new DomainError('Payment not found.', 'not_found');
    if (p.status !== 'Pending') throw new DomainError(`This payment is ${p.status.toLowerCase()}. Start a new one from checkout.`, 'rejected');
    if (pay.payUrl) return res.json({ url: pay.payUrl });
    const inv = await payments.createInvoice({ purchaseId: p.id, amount: p.total, description: `Crateline purchase ${p.id}`, callbackUrl: config.apiUrl + '/api/webhooks/nowpayments', returnUrl: `${config.appUrl}/?paid=${p.id}` });
    await store.transact(d => { const x = d.payments.find(y => y.id === pay.id); x.provider = payments.name; x.providerRef = inv.id; x.payUrl = inv.url; x.lastEventAt = Date.now(); x.events.push({ op: `${payments.name}:invoice:${inv.id}`, at: Date.now(), type: 'invoice.created', status: 'Processed' }); });
    res.json({ url: inv.url });
  }));
  // Signed notifications from NOWPayments. An unsigned or wrongly signed request changes nothing.
  // Known events answer 200 even when ignored, so the provider stops retrying.
  app.post('/api/webhooks/nowpayments', wrap(async (req, res) => {
    if (!payments) return res.status(404).json({ error: 'Not found.' });
    const b = req.body;
    if (!payments.verify(b, req.headers['x-nowpayments-sig'])) return res.status(401).json({ error: 'Invalid signature.' });
    // A payout notification: applies to the payout that created this transfer, and only if it
    // went to the approved address.
    if (b.batch_withdrawal_id != null) {
      const outcome = PAYOUT_STATUS[String(b.status || '').toLowerCase()];
      if (!outcome) return res.json({ ok: true, result: 'ignored' });
      const { value } = await store.transact(d => {
        const p = d.payouts.find(x => x.providerBatch === String(b.batch_withdrawal_id)); if (!p) return 'unknown';
        try { return payoutProviderEvent(d, { name: payments.name, kind: 'Provider' }, p.id, b.address && b.address !== p.destAddress ? 'unknown' : outcome, b.hash || null); }
        catch (e) { if (e instanceof DomainError) return 'ignored'; throw e; }
      });
      return res.json({ ok: true, result: value });
    }
    const status = PAY_STATUS[b.payment_status];
    if (!status || b.payment_id == null || typeof b.order_id !== 'string') return res.json({ ok: true, result: 'ignored' });
    const { value } = await store.transact(d => paymentProviderEvent(d, { provider: payments.name, purchaseId: b.order_id, ref: b.payment_id, status,
      priceC: Math.round(Number(b.price_amount) * 100), cur: String(b.price_currency || '').toUpperCase(), paid: `${b.actually_paid ?? b.pay_amount ?? '?'} ${String(b.pay_currency || '').toUpperCase()}` }));
    res.json({ ok: true, result: value });
  }));

  // ---------- crypto payouts (NOWPayments)
  // Sending is three steps, each saved before the next: mark the payout Processing (so it can never
  // be sent twice), create the transfer at the provider, confirm it with the two-factor code.
  const payoutFor = (d, auth, id) => { const s = auth.kind === 'staff' && actorFrom(d, auth); if (!s) throw new DomainError('Staff only.', 'denied'); need(d, s, 'payouts.execute', 'execute payouts'); const p = d.payouts.find(x => x.id === id); if (!p) throw new DomainError('Payout not found.', 'not_found'); if (!payments?.canPayOut || !realPayout(p)) throw new DomainError('This payout is not sent through NOWPayments.', 'rejected'); return { s, p }; };
  const codeOf = body => { const c = String(body?.code || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(c)) throw Object.assign(new DomainError('Enter the 6-digit code from the NOWPayments authenticator.', 'validation'), { field: 'code' }); return c; };
  const settle = (id, auth, outcome) => store.transact(d => payoutProviderEvent(d, actorFrom(d, auth), id, outcome));
  const confirmCode = async (id, batchId, code, res) => {
    let ok; try { ok = await payments.verifyPayout(batchId, code); } catch { return res.status(502).json({ error: 'NOWPayments did not answer while checking the code. The transfer exists but may not be confirmed. Enter a new code to try again.' }); }
    if (!ok) return res.status(422).json({ error: 'NOWPayments did not accept that code. Wait for a new code and enter it. Without a valid code the transfer is rejected after one hour and the funds return to the seller.', field: 'code' });
    await store.transact(d => payoutSent(d, id, { verified: true }));
    res.json({ ok: true, status: 'Processing' });
  };
  app.post('/api/payouts/:id/execute', auth(), wrap(async (req, res) => {
    const code = codeOf(req.body); const id = req.params.id;
    const { value: p } = await store.transact(d => { const { s, p } = payoutFor(d, req.auth, id); if (!PAYOUT_NETS[p.destNet]) throw new DomainError('This payout has no supported network.', 'rejected'); executePayout(d, s, p.id, req.body?.version, payments.name); return structuredClone(p); });
    let sent;
    try { sent = await payments.createPayout({ address: p.destAddress, currency: PAYOUT_NETS[p.destNet].ticker, usd: (p.amountC - p.feeC) / 100, ref: p.opRef, description: `Crateline payout ${p.id}`, callbackUrl: config.apiUrl + '/api/webhooks/nowpayments' }); }
    catch (e) {
      if (e.refused) { await store.transact(d => payoutNotSent(d, id, e.message)); return res.status(400).json({ error: `NOWPayments refused the transfer: ${e.message} Nothing was sent; the payout is Approved again.` }); }
      await settle(id, req.auth, 'unknown');
      return res.status(502).json({ error: 'NOWPayments did not answer, so it is not known whether the transfer was created. The payout now needs reconciliation: check the NOWPayments dashboard before doing anything else. The funds stay reserved.' });
    }
    await store.transact(d => payoutSent(d, id, { batchId: sent.batchId, verified: false }));
    await confirmCode(id, sent.batchId, code, res);
  }));
  // A new two-factor code for a transfer that was created but not confirmed.
  app.post('/api/payouts/:id/verify', auth(), wrap(async (req, res) => {
    const code = codeOf(req.body); const { doc } = await store.read(); const { p } = payoutFor(doc, req.auth, req.params.id);
    if (p.status !== 'Processing' || !p.awaitingCode || !p.providerBatch) throw new DomainError('This payout is not waiting for a code.', 'rejected');
    await confirmCode(p.id, p.providerBatch, code, res);
  }));
  // Asks NOWPayments for the transfer's state (for a missed notification) and applies a final one.
  app.post('/api/payouts/:id/status', auth(), wrap(async (req, res) => {
    const { doc } = await store.read(); const { p } = payoutFor(doc, req.auth, req.params.id);
    if (!p.providerBatch) throw new DomainError('NOWPayments never confirmed creating this transfer, so there is nothing to look up here. Check the NOWPayments dashboard for a payout described "Crateline payout ' + p.id + '", then reconcile it by hand.', 'rejected');
    let st; try { st = await payments.payoutStatus(p.providerBatch); } catch (e) { return res.status(502).json({ error: e.refused ? e.message : 'NOWPayments did not answer. Try again in a minute.' }); }
    const outcome = PAYOUT_STATUS[st.status];
    if (outcome && ['Processing', 'Reconciliation required'].includes(p.status) && !(outcome === 'unknown' && p.status === 'Reconciliation required')) await store.transact(d => payoutProviderEvent(d, { name: payments.name, kind: 'Provider' }, p.id, st.address && st.address !== p.destAddress ? 'unknown' : outcome, st.hash));
    res.json({ ok: true, providerStatus: st.status });
  }));

  // ---------- seller identity verification (Didit)
  const myVerification = (doc, auth) => { const u = auth.kind === 'user' && actorFrom(doc, auth); const vr = u?.storeId && doc.verifications.find(v => v.storeId === u.storeId); if (!kyc || !vr?.kyc) throw new DomainError('Identity verification is not available for this account.', 'rejected'); return vr; };
  const applyDecision = async (storeId, sessionId) => { const dec = await kyc.decision(sessionId); const { value } = await store.transact(d => kycProviderEvent(d, { provider: kyc.name, storeId, sessionId, status: dec.status, result: dec.result })); return value; };
  // Opens (or reopens) the seller's verification page at the provider.
  app.post('/api/kyc/start', authLimiter, auth(), wrap(async (req, res) => {
    const { doc } = await store.read(); const vr = myVerification(doc, req.auth);
    if (vr.kyc.status === 'Approved') throw new DomainError('Your identity is already verified.', 'rejected');
    if (vr.kyc.status === 'In Review') throw new DomainError('Your identity check is being reviewed. You will be notified of the result.', 'rejected');
    if (!['Verification pending', 'More information required'].includes(vr.state)) throw new DomainError(`This application is ${vr.state.toLowerCase()}.`, 'rejected');
    if (vr.kyc.url && ['Not Started', 'In Progress', 'Awaiting User'].includes(vr.kyc.status)) return res.json({ url: vr.kyc.url });
    const s = await kyc.createSession({ storeId: vr.storeId, returnUrl: `${config.appUrl}/?kyc=1` });
    await store.transact(d => kycSessionStarted(d, vr.storeId, { provider: kyc.name, sessionId: s.id, url: s.url }));
    res.json({ url: s.url });
  }));
  // The seller is back from the provider: read the result now instead of waiting for the webhook.
  app.post('/api/kyc/refresh', authLimiter, auth(), wrap(async (req, res) => {
    const { doc } = await store.read(); const vr = myVerification(doc, req.auth);
    if (!vr.kyc.sessionId) return res.json({ status: vr.kyc.status });
    await applyDecision(vr.storeId, vr.kyc.sessionId);
    res.json({ status: (await store.read()).doc.verifications.find(v => v.id === vr.id).kyc.status });
  }));
  // Signed notifications from Didit. The webhook only says which session changed; the outcome is
  // read from Didit's API, and applies only to the store that session was opened for.
  app.post('/api/webhooks/didit', wrap(async (req, res) => {
    if (!kyc) return res.status(404).json({ error: 'Not found.' });
    const b = req.body;
    if (!kyc.verify(b, req.headers)) return res.status(401).json({ error: 'Invalid signature.' });
    if (typeof b.session_id !== 'string' || typeof b.vendor_data !== 'string' || !['status.updated', 'data.updated'].includes(b.webhook_type)) return res.json({ ok: true, result: 'ignored' });
    res.json({ ok: true, result: await applyDecision(b.vendor_data, b.session_id) });
  }));

  // ---------- files (deliveries, evidence, message attachments)
  // 1. POST /api/files records the file and returns a signed URL; the browser uploads to it.
  // 2. POST /api/files/:id/complete checks the stored size, after which an action can attach it.
  // 3. GET /api/files/:id/url returns a short-lived download link to callers who may see the file.
  const needFiles = () => { if (!storage || !filesEnabled()) throw new DomainError('File storage is not set up on this server yet.', 'rejected'); };
  const MAX_UNATTACHED = 20; // per customer per hour: uploads not yet attached to anything
  app.post('/api/files', auth(), wrap(async (req, res) => {
    needFiles(); if (req.auth.kind !== 'user') throw new DomainError('Only customer accounts upload files.', 'denied');
    const { name, size, type = '' } = req.body || {};
    const invalid = msg => { throw Object.assign(new DomainError(msg, 'validation'), { field: 'file' }); };
    if (typeof name !== 'string' || !name.trim() || name.length > 200) invalid('The file needs a name of up to 200 characters.');
    if (BLOCKED_EXT.test(name)) invalid(`${name} was blocked. Executable files are not allowed.`);
    if (!Number.isInteger(size) || size <= 0) invalid(`${name} is empty.`);
    if (size > MAX_FILE_BYTES) invalid(`${name} is too large. The limit is 60 MB per file.`);
    const id = 'FL-' + crypto.randomBytes(12).toString('base64url');
    const key = `files/${id}/${name.trim().replace(/[^\w.-]/g, '_')}`;
    await store.transact(d => {
      const u = actorFrom(d, req.auth); d.files = d.files || {};
      if (Object.values(d.files).filter(f => f.ownerId === u.id && !f.attached && f.at > Date.now() - HOUR_MS).length >= MAX_UNATTACHED) invalid('You have uploaded many files without sending them. Wait an hour and try again.');
      d.files[id] = { id, ownerId: u.id, name: name.trim(), size, type: String(type).slice(0, 100), key, status: 'pending', attached: null, at: Date.now() };
    });
    res.status(201).json({ id, name: name.trim(), size, upload: { method: 'PUT', url: storage.putUrl(key), headers: type ? { 'Content-Type': String(type).slice(0, 100) } : {} } });
  }));
  app.post('/api/files/:id/complete', auth(), wrap(async (req, res) => {
    needFiles();
    const { doc } = await store.read(); const rec = doc.files?.[req.params.id];
    if (!rec || req.auth.kind !== 'user' || rec.ownerId !== actorFrom(doc, req.auth).id) throw new DomainError('File not found.', 'not_found');
    if (rec.status !== 'ready') {
      const stored = await storage.head(rec.key);
      if (!stored) throw new DomainError(`${rec.name} did not finish uploading. Attach it again.`, 'rejected');
      // The stored file must be the one that was announced; anything else is removed.
      if (stored.size !== rec.size) { await storage.remove(rec.key); await store.transact(d => { delete d.files[rec.id]; }); throw new DomainError(`${rec.name} did not upload correctly. Attach it again.`, 'rejected'); }
      await store.transact(d => { d.files[rec.id].status = 'ready'; });
    }
    res.json({ ok: true, file: { id: rec.id, name: rec.name, size: rec.size } });
  }));
  // Staff need the evidence permission for where the file is attached; each staff download is audited.
  const STAFF_FILE_PERMS = { order: ['orders.evidence'], case: ['cases.evidence'], conversation: ['orders.evidence', 'cases.evidence'] };
  app.get('/api/files/:id/url', auth(), wrap(async (req, res) => {
    needFiles();
    const { doc } = await store.read(); const actor = actorFrom(doc, req.auth); const rec = doc.files?.[req.params.id];
    const denied = () => { throw new DomainError('File not found, or your account cannot open it.', 'not_found'); };
    if (!rec || rec.status !== 'ready') denied();
    const mine = req.auth.kind === 'user' && rec.ownerId === actor.id;
    if (!mine && !fileIdsIn(viewFor(doc, req.auth)).has(rec.id)) denied();
    if (req.auth.kind === 'staff') {
      if (!(STAFF_FILE_PERMS[rec.attached] || []).some(p => can(doc, actor, p))) throw new DomainError('Access denied. Your role cannot open evidence files.', 'denied');
      await store.transact(d => { audit(d, d.staff[actor.id], 'File downloaded', rec.id, { reason: rec.name, sensitive: true }); });
    }
    res.json({ url: storage.getUrl(rec.key, rec.name), name: rec.name, expiresIn: DOWNLOAD_TTL_S });
  }));

  // Lists that grow without limit are capped in /api/state (newest first); older entries come
  // from GET /api/list/:resource, using the same view, so permissions are identical.
  const PAGED = { audit: 300, notifications: 100, staffNotes: 100 };
  const viewFor = (doc, auth) => { const actor = actorFrom(doc, auth); return auth.kind === 'staff' ? staffView(doc, actor) : customerView(doc, actor); };
  app.get('/api/state', auth(), wrap(async (req, res) => {
    const { doc, version } = await store.read(); const view = viewFor(doc, req.auth);
    const more = {};
    for (const [k, cap] of Object.entries(PAGED)) if (Array.isArray(view[k]) && view[k].length > cap) { view[k] = view[k].slice(0, cap); more[k] = true; }
    res.json({ version, kind: req.auth.kind, view, more });
  }));
  app.get('/api/list/:resource', auth(), wrap(async (req, res) => {
    const name = req.params.resource;
    if (!Object.hasOwn(PAGED, name)) return res.status(404).json({ error: `Unknown list "${name}".` });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const { doc, version } = await store.read(); const list = viewFor(doc, req.auth)[name];
    if (!Array.isArray(list)) throw new DomainError('Access denied. Your role cannot view this list.', 'denied');
    // Cursor: the id of the last item already shown; the page starts after it.
    const start = req.query.after ? list.findIndex(x => x.id === req.query.after) + 1 : 0;
    if (req.query.after && start === 0) throw new DomainError('That position in the list no longer exists. Reload the list.', 'stale');
    const items = list.slice(start, start + limit);
    res.json({ version, items, next: start + limit < list.length ? items.at(-1).id : null });
  }));

  app.post('/api/actions/:name', auth(), wrap(async (req, res) => {
    const table = req.auth.kind === 'staff' ? STAFF : CUSTOMER; const fn = Object.hasOwn(table, req.params.name) && table[req.params.name];
    if (!fn) return res.status(404).json({ error: `Unknown action "${req.params.name}" for ${req.auth.kind} accounts.` });
    try {
      const { value, version } = await store.transact(d => fn(d, actorFrom(d, req.auth), req.body?.args || {}));
      res.json({ ok: true, result: value ?? null, version });
    } catch (e) {
      // Record refused staff attempts (for example self-approval) in the audit history.
      if (e instanceof DomainError && e.code !== 'unauthenticated' && req.auth.kind === 'staff') await store.transact(d => { audit(d, d.staff[req.auth.id], 'Action rejected: ' + req.params.name, req.body?.args?.approvalId || req.body?.args?.refundId || req.body?.args?.payoutId || '-', { reason: e.message, outcome: e.code === 'denied' ? 'Blocked' : e.code === 'stale' ? 'Stale view refused' : 'Rejected' }); }).catch(() => { });
      throw e;
    }
  }));

  // Demo-only controls. Disabled when ALLOW_DEMO_CONTROLS=false.
  const demoOnly = wrap(async (req, res, next) => { if (!config.allowDemoControls) return res.status(403).json({ error: 'Demo controls are disabled on this server.' }); next(); });
  const superOnly = wrap(async (req, res, next) => { const { doc } = await store.read(); const s = req.auth.kind === 'staff' && doc.staff[req.auth.id]; if (!s?.active || !s.roles.includes('superadmin')) return res.status(403).json({ error: 'Super Admin only.' }); next(); });
  app.post('/api/demo/advance', auth(), demoOnly, superOnly, wrap(async (req, res) => {
    const ms = Math.min(Math.max(Number(req.body?.ms) || 0, 0), 30 * 864e5);
    const { version } = await store.transact(d => { d.clockOffset = (d.clockOffset || 0) + ms; tick(d); });
    res.json({ ok: true, version });
  }));
  // Simulated provider outcomes used by staff screens (refund, payout, reconciliation, connection tests).
  app.post('/api/demo/scenario', auth(), demoOnly, superOnly, wrap(async (req, res) => {
    const { provider, testConn } = req.body || {};
    if (provider != null && !['success', 'failure', 'unknown'].includes(provider)) throw new DomainError('Provider outcome must be success, failure or unknown.', 'validation');
    if (testConn != null && !['success', 'failure', 'timeout'].includes(testConn)) throw new DomainError('Connection test outcome must be success, failure or timeout.', 'validation');
    const { version } = await store.transact(d => { d.scenario = { ...d.scenario, ...(provider ? { provider } : {}), ...(testConn ? { testConn } : {}) }; });
    res.json({ ok: true, version });
  }));
  app.post('/api/demo/reset', auth(), demoOnly, superOnly, wrap(async (req, res) => { await seedStore(store, { force: true }); res.json({ ok: true }); }));

  // One-time launch reset: removes all demo data and every staff member except the Super Admin
  // who runs it. Needs ALLOW_LAUNCH_RESET=true on the server, that admin's password and the word
  // LAUNCH. Sessions of the kept admin stay valid; everyone else's accounts are gone.
  app.post('/api/admin/launch', authLimiter, auth(), wrap(async (req, res) => {
    if (!config.allowLaunchReset) return res.status(403).json({ error: 'The launch reset is switched off on this server.' });
    const { doc } = await store.read(); const actor = req.auth.kind === 'staff' && actorFrom(doc, req.auth);
    if (!actor || !actor.roles.includes('superadmin')) return res.status(403).json({ error: 'Super Admin only.' });
    const acc = await store.findAccount(actor.email);
    if (!acc || !(await bcrypt.compare(String(req.body?.password || ''), acc.hash))) throw Object.assign(new DomainError('Your password is incorrect.', 'validation'), { field: 'password' });
    if (req.body?.confirm !== 'LAUNCH') throw Object.assign(new DomainError('Type LAUNCH to confirm. This removes all marketplace data.', 'validation'), { field: 'confirm' });
    const name = typeof req.body?.name === 'string' && req.body.name.trim().length >= 2 ? req.body.name.trim().slice(0, 100) : null;
    await store.replace(launchDocument(doc, actor.id, { name }), [{ email: acc.email, kind: 'staff', refId: actor.id, hash: acc.hash }]);
    res.json({ ok: true });
  }));

  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  return app;
}
