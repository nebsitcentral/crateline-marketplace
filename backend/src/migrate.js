// Creates the database tables. Safe to run on every deploy.
import pg from 'pg';
import { config } from './config.js';
import { tableMigrations } from './tables.js';

export const MIGRATIONS = [
  `create table if not exists app_state (
     id integer primary key,
     version integer not null,
     doc jsonb not null,
     updated_at timestamptz not null default now()
   )`,
  `create table if not exists accounts (
     email text primary key,
     kind text not null check (kind in ('user', 'staff')),
     ref_id text not null,
     password_hash text not null,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists accounts_ref on accounts (kind, ref_id)`,
  // Marketplace collections, one table each (tables.js).
  ...tableMigrations(),
  // Email outbox: queued with the change that causes it, delivered by the worker with retries.
  `create table if not exists email_outbox (
     id bigserial primary key, to_email text not null, template text not null, subject text not null, html text not null, text text not null,
     dedupe_key text unique, status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
     attempts integer not null default 0, next_attempt_at bigint not null default 0, locked_at bigint, last_error text, provider_id text,
     created_at bigint not null, sent_at bigint
   )`,
  `create index if not exists email_outbox_due on email_outbox (status, next_attempt_at)`,
  // Single-use tokens for email verification, email change and password reset. Only the SHA-256
  // hash is stored; the token itself exists only in the email.
  `create table if not exists auth_tokens (
     hash text primary key, kind text not null check (kind in ('verify', 'reset', 'email')), email text not null, account_kind text not null,
     ref_id text not null, new_email text, expires_at bigint not null, used_at bigint, created_at bigint not null
   )`,
  `create index if not exists auth_tokens_ref on auth_tokens (account_kind, ref_id)`,
];

export async function migrate(url = config.databaseUrl) {
  if (!url) { console.log('No DATABASE_URL set; nothing to migrate (in-memory store).'); return; }
  const pool = new pg.Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try { for (const sql of MIGRATIONS) await pool.query(sql); console.log(`Applied ${MIGRATIONS.length} migration statements.`); }
  finally { await pool.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) migrate().catch(e => { console.error(e); process.exit(1); });
