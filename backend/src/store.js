// Persistence. The domain works on one marketplace document (the same shape the frontend demo
// uses). In memory (dev, tests) that document is kept as is. In Postgres, large collections live
// in their own tables (see tables.js) and only settings stay in the versioned `app_state` row;
// each transaction locks that row, so transitions stay atomic and serialised. Login credentials
// live in the `accounts` table, never in the document.
import pg from 'pg';
import { TABLES, rowsFor, settingsOf, assemble, insertOrder, TABLE_KEYS } from './tables.js';
import { notificationEmails } from './email.js';
import { CLOCK } from '@crateline/domain/clock.js';
import { syncCats } from '@crateline/domain/data.js';
import { tick } from '@crateline/domain/fin.js';
import { config } from './config.js';

const clone = o => structuredClone(o);
// The domain reads the demo clock and category list from module state; set both from the document.
export function prepare(doc) { CLOCK.offset = doc.clockOffset || 0; syncCats(doc.categories); }

// Shared by both stores: queued email, single-use tokens and account changes are staged during a
// transaction and applied only if it succeeds.
const TOKEN_FIELDS = ['hash', 'kind', 'email', 'accountKind', 'refId', 'newEmail', 'expiresAt'];

class MemoryStore {
  kind = 'memory';
  doc = null; version = 0; accounts = []; outbox = []; tokens = []; seq = 0;
  async init() { }
  async hasState() { return !!this.doc; }
  async read() { if (!this.doc) throw new Error('Store is empty. Run the seed.'); prepare(this.doc); return { doc: this.doc, version: this.version }; }
  async replace(doc, accounts) { this.doc = clone(doc); this.version = 1; this.accounts = accounts.map(a => ({ ...a })); this.tokens = []; }
  async transact(fn) {
    const base = this.doc; const d = clone(base); prepare(d); tick(d);
    const pendingAccounts = [], pendingHashes = {}, emails = [], newTokens = [], usedTokens = [], emailMoves = [];
    const tx = {
      findAccount: e => this.findAccount(e),
      createAccount: async a => { if (await this.findAccount(a.email) || pendingAccounts.some(p => p.email === a.email.toLowerCase())) throw Object.assign(new Error('An account already uses this email. Sign in or reset your password.'), { status: 409, field: 'email' }); pendingAccounts.push({ ...a, email: a.email.toLowerCase() }); },
      setPassword: async (email, hash) => { pendingHashes[email.toLowerCase()] = hash; },
      changeAccountEmail: async (from, to) => { if (await this.findAccount(to)) throw Object.assign(new Error('An account already uses this email.'), { status: 409, field: 'email' }); emailMoves.push([from.toLowerCase(), to.toLowerCase()]); },
      queueEmail: async m => { emails.push(m); },
      saveToken: async t => { newTokens.push(Object.fromEntries(TOKEN_FIELDS.map(k => [k, t[k] ?? null]))); },
      // Returns the token if it exists, has this kind, is unused and not expired; marks it used.
      useToken: async (hash, kind, at) => { const t = this.tokens.find(x => x.hash === hash && x.kind === kind && !x.usedAt && x.expiresAt > at); if (t) usedTokens.push([t, at]); return t ? { ...t } : null; },
    };
    const value = await fn(d, tx);
    emails.push(...notificationEmails(base, d));
    this.doc = d; this.version++; this.accounts.push(...pendingAccounts);
    for (const a of this.accounts) if (pendingHashes[a.email]) a.hash = pendingHashes[a.email];
    for (const [from, to] of emailMoves) { const a = this.accounts.find(x => x.email === from); if (a) a.email = to; }
    this.tokens.push(...newTokens); for (const [t, at] of usedTokens) t.usedAt = at;
    for (const m of emails) if (!m.dedupeKey || !this.outbox.some(o => o.dedupeKey === m.dedupeKey)) this.outbox.push({ ...m, id: ++this.seq, status: 'pending', attempts: 0, nextAttemptAt: 0, createdAt: Date.now() });
    return { value, version: this.version };
  }
  async findAccount(email) { const a = this.accounts.find(a => a.email === email.toLowerCase()); return a ? { recoveryHashes: [], ...a } : null; }
  async createAccount(a) { this.accounts.push({ ...a, email: a.email.toLowerCase() }); }
  // Two-factor fields live on the account, outside the marketplace document.
  async setMfa(email, patch) { Object.assign(this.accounts.find(a => a.email === email.toLowerCase()), patch); }
  async useMfaStep(email, step) { const a = this.accounts.find(x => x.email === email.toLowerCase()); if (!a || (a.totpLastStep != null && a.totpLastStep >= step)) return false; a.totpLastStep = step; return true; }
  async useRecovery(email, hash) { const a = this.accounts.find(x => x.email === email.toLowerCase()); const list = a?.recoveryHashes || []; if (!list.includes(hash)) return false; a.recoveryHashes = list.filter(h => h !== hash); return true; }
  async claimEmails(limit, now) { const batch = this.outbox.filter(m => m.status === 'pending' && m.nextAttemptAt <= now).slice(0, limit); for (const m of batch) m.status = 'sending'; return batch.map(m => ({ ...m })); }
  async markEmailSent(id, providerId, at) { Object.assign(this.outbox.find(m => m.id === id), { status: 'sent', providerId, sentAt: at }); }
  async markEmailFailed(id, attempts, nextAt, error) { Object.assign(this.outbox.find(m => m.id === id), { status: nextAt ? 'pending' : 'failed', attempts, nextAttemptAt: nextAt || 0, lastError: error }); }
  async close() { }
}

class PgStore {
  kind = 'postgres';
  // The last loaded document and its version. Every write raises the version, so a cached copy
  // with the current version is exactly what the tables hold (also across several API instances).
  cache = null;
  constructor(url) { this.pool = new pg.Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } }); }
  async init() {
    await this.pool.query('select 1');
    await this.splitLegacyDocument();
  }
  async hasState() { const r = await this.pool.query('select 1 from app_state where id = 1'); return r.rowCount > 0; }

  async loadDoc(c, settings) {
    const rows = {};
    for (const t of TABLES) {
      const extra = t.name === 'messages' ? ', conversation_id' : t.group ? `, ${t.group}` : '';
      const r = await c.query(`select id, data${extra} from ${t.name} order by ins`);
      rows[t.name] = r.rows.map(x => ({ id: x.id, data: x.data, cols: { conversation_id: x.conversation_id, ...(t.group ? { [t.group]: x[t.group] } : {}) } }));
    }
    return assemble(settings, rows);
  }
  async read() {
    const r = await this.pool.query('select doc, version from app_state where id = 1');
    if (!r.rowCount) throw new Error('Store is empty. Run npm run seed -w backend.');
    const { version } = r.rows[0];
    if (this.cache?.version !== version) this.cache = { version, doc: await this.loadDoc(this.pool, r.rows[0].doc) };
    prepare(this.cache.doc); return { doc: this.cache.doc, version };
  }

  async insertRows(c, t, rows) {
    for (const row of rows) {
      const cols = Object.keys(row.cols); const vals = [row.id, JSON.stringify(row.data), ...cols.map(k => row.cols[k])];
      await c.query(`insert into ${t.name} (id, ins, data${cols.map(k => ', ' + k).join('')}) values ($1, nextval('crateline_ins'), $2${cols.map((_, i) => `, $${i + 3}`).join('')})`, vals);
    }
  }
  // Writes the difference between two documents: new rows, changed rows and removed rows.
  async writeDiff(c, before, after) {
    for (const t of TABLES) {
      const old = new Map(rowsFor(before, t).map(r => [r.id, JSON.stringify(r.data) + JSON.stringify(r.cols)]));
      const now = rowsFor(after, t); const seen = new Set();
      const added = [];
      for (const r of now) {
        // A repeated id would be saved once while the cached document kept both; refuse instead.
        if (seen.has(r.id)) throw new Error(`Duplicate record ${r.id} in ${t.name}. Nothing was saved.`);
        seen.add(r.id); const prev = old.get(r.id);
        if (prev === undefined) { added.push(r); continue; }
        if (prev === JSON.stringify(r.data) + JSON.stringify(r.cols)) continue;
        const cols = Object.keys(r.cols);
        await c.query(`update ${t.name} set data = $2${cols.map((k, i) => `, ${k} = $${i + 3}`).join('')} where id = $1`, [r.id, JSON.stringify(r.data), ...cols.map(k => r.cols[k])]);
      }
      // New rows of a 'newest' list were unshifted: insert them oldest first so `ins` keeps the order.
      await this.insertRows(c, t, insertOrder(t, added));
      const removed = [...old.keys()].filter(id => !seen.has(id));
      if (removed.length) await c.query(`delete from ${t.name} where id = any($1)`, [removed]);
    }
  }
  async writeAll(c, doc) {
    for (const t of TABLES.slice().reverse()) await c.query(`delete from ${t.name}`);
    for (const t of TABLES) await this.insertRows(c, t, insertOrder(t, rowsFor(doc, t)));
  }

  async replace(doc, accounts) {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      await c.query('delete from accounts');
      await this.writeAll(c, doc);
      await c.query('insert into app_state (id, version, doc, updated_at) values (1, 1, $1, now()) on conflict (id) do update set version = app_state.version + 1, doc = excluded.doc, updated_at = now()', [settingsOf(doc)]);
      for (const a of accounts) await c.query('insert into accounts (email, kind, ref_id, password_hash) values ($1, $2, $3, $4)', [a.email.toLowerCase(), a.kind, a.refId, a.hash]);
      await c.query('commit'); this.cache = null;
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  }
  async transact(fn) {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const r = await c.query('select doc, version from app_state where id = 1 for update');
      const { version } = r.rows[0];
      const base = this.cache?.version === version ? this.cache.doc : await this.loadDoc(c, r.rows[0].doc);
      const d = clone(base); prepare(d); tick(d);
      const queue = async m => { await c.query('insert into email_outbox (to_email, template, subject, html, text, dedupe_key, created_at, next_attempt_at) values ($1, $2, $3, $4, $5, $6, $7, 0) on conflict (dedupe_key) do nothing', [m.to, m.template, m.subject, m.html, m.text, m.dedupeKey || null, Date.now()]); };
      const tx = {
        findAccount: async e => (await c.query('select email, kind, ref_id as "refId", password_hash as hash from accounts where email = $1', [e.toLowerCase()])).rows[0] || null,
        setPassword: async (email, hash) => { await c.query('update accounts set password_hash = $1 where email = $2', [hash, email.toLowerCase()]); },
        changeAccountEmail: async (from, to) => { try { await c.query('update accounts set email = $2 where email = $1', [from.toLowerCase(), to.toLowerCase()]); } catch (e) { if (e.code === '23505') throw Object.assign(new Error('An account already uses this email.'), { status: 409, field: 'email' }); throw e; } },
        queueEmail: queue,
        saveToken: async t => { await c.query('insert into auth_tokens (hash, kind, email, account_kind, ref_id, new_email, expires_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)', [t.hash, t.kind, t.email, t.accountKind, t.refId, t.newEmail || null, t.expiresAt, Date.now()]); },
        useToken: async (hash, kind, at) => { const r = await c.query('update auth_tokens set used_at = $3 where hash = $1 and kind = $2 and used_at is null and expires_at > $3 returning hash, kind, email, account_kind as "accountKind", ref_id as "refId", new_email as "newEmail", expires_at as "expiresAt"', [hash, kind, at]); return r.rows[0] ? { ...r.rows[0], expiresAt: Number(r.rows[0].expiresAt) } : null; },
        createAccount: async a => { try { await c.query('insert into accounts (email, kind, ref_id, password_hash) values ($1, $2, $3, $4)', [a.email.toLowerCase(), a.kind, a.refId, a.hash]); } catch (e) { if (e.code === '23505') throw Object.assign(new Error('An account already uses this email. Sign in or reset your password.'), { status: 409, field: 'email' }); throw e; } },
      };
      const value = await fn(d, tx);
      for (const m of notificationEmails(base, d)) await queue(m);
      await this.writeDiff(c, base, d);
      const next = version + 1;
      await c.query('update app_state set doc = $1, version = $2, updated_at = now() where id = 1', [settingsOf(d), next]);
      await c.query('commit');
      this.cache = { version: next, doc: d };
      return { value, version: next };
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  }
  async findAccount(email) { const r = await this.pool.query(`select email, kind, ref_id as "refId", password_hash as hash, totp_secret as "totpSecret", totp_pending as "totpPending", totp_last_step as "totpLastStep", recovery_hashes as "recoveryHashes" from accounts where email = $1`, [email.toLowerCase()]); const a = r.rows[0]; return a ? { ...a, totpLastStep: a.totpLastStep == null ? null : Number(a.totpLastStep) } : null; }
  async setMfa(email, patch) {
    const cols = { totpSecret: 'totp_secret', totpPending: 'totp_pending', totpLastStep: 'totp_last_step', recoveryHashes: 'recovery_hashes' };
    const keys = Object.keys(patch).filter(k => cols[k]);
    await this.pool.query(`update accounts set ${keys.map((k, i) => `${cols[k]} = $${i + 2}`).join(', ')} where email = $1`, [email.toLowerCase(), ...keys.map(k => k === 'recoveryHashes' ? JSON.stringify(patch[k]) : patch[k])]);
  }
  // Atomic: the update only succeeds for a step later than the last one used.
  async useMfaStep(email, step) { const r = await this.pool.query('update accounts set totp_last_step = $2 where email = $1 and (totp_last_step is null or totp_last_step < $2)', [email.toLowerCase(), step]); return r.rowCount === 1; }
  async useRecovery(email, hash) { const r = await this.pool.query('update accounts set recovery_hashes = recovery_hashes - $2::text where email = $1 and recovery_hashes ? $2::text', [email.toLowerCase(), hash]); return r.rowCount === 1; }

  // Outbox. SKIP LOCKED lets several API instances work the queue without sending twice; an email
  // stuck in 'sending' for 10 minutes (a worker stopped mid-send) is picked up again.
  async claimEmails(limit, now) {
    const r = await this.pool.query(`update email_outbox set status = 'sending', locked_at = $2 where id in (
      select id from email_outbox where (status = 'pending' and next_attempt_at <= $2) or (status = 'sending' and locked_at < $2 - 600000)
      order by id limit $1 for update skip locked) returning id, to_email as "to", template, subject, html, text, attempts`, [limit, now]);
    return r.rows;
  }
  async markEmailSent(id, providerId, at) { await this.pool.query("update email_outbox set status = 'sent', provider_id = $2, sent_at = $3, locked_at = null where id = $1", [id, providerId, at]); }
  async markEmailFailed(id, attempts, nextAt, error) { await this.pool.query('update email_outbox set status = $2, attempts = $3, next_attempt_at = $4, last_error = $5, locked_at = null where id = $1', [id, nextAt ? 'pending' : 'failed', attempts, nextAt || 0, error]); }

  // Older databases keep some collections inside app_state.doc (all of them before tables existed;
  // carts, payout methods and a few lists before they got tables). Move only the collections found
  // in the document into their tables, once, in one transaction; tables not in it are untouched.
  async splitLegacyDocument() {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const r = await c.query('select doc, version from app_state where id = 1 for update');
      const doc = r.rows[0]?.doc;
      const moving = doc ? TABLES.filter(t => t.key ? t.key in doc : 'conversations' in doc) : [];
      if (!moving.length) { await c.query('rollback'); return false; }
      for (const t of moving.slice().reverse()) await c.query(`delete from ${t.name}`);
      for (const t of moving) await this.insertRows(c, t, insertOrder(t, rowsFor(doc, t)));
      await c.query('update app_state set doc = $1, version = version + 1, updated_at = now() where id = 1', [settingsOf(doc)]);
      await c.query('commit'); this.cache = null;
      console.log('Moved into their own tables: ' + moving.map(t => t.name).join(', ') + '.');
      return true;
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  }
  async close() { await this.pool.end(); }
}

export function createStore() { return config.databaseUrl ? new PgStore(config.databaseUrl) : new MemoryStore(); }
