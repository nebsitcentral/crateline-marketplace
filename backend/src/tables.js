// Normalised storage layout. Each large collection of the marketplace document is stored in its
// own table: one row per record, the full record in `data`, and the fields other tables point at
// as real columns with foreign keys and indexes. Everything not listed here (settings, roles,
// categories and other small configuration) stays in the single `app_state` document.
//
// group: the collection is an object of lists keyed by an owner id (carts by user, payout methods
// by store); each list item is a row and the owner id is stored in the `group` column.
// values: the collection is a list of plain strings (processed provider operations); each string
// is the row id, so Postgres enforces that an operation is recorded once.
// order: how the domain keeps the in-memory list. 'newest' lists insert at the front (unshift),
// 'oldest' lists append (push), 'map' collections are objects keyed by id. Rows carry `ins`, a
// global insertion number, so the original order is rebuilt exactly when loading.
// cols: column -> function reading the value from the record. fk: column -> referenced table.

const at = r => r.at ?? null;
export const TABLES = [
  { name: 'users', key: 'users', order: 'map', cols: {} },
  { name: 'staff', key: 'staff', order: 'map', cols: {} },
  { name: 'stores', key: 'stores', order: 'map', cols: { owner_id: r => r.ownerId }, fk: { owner_id: 'users' } },
  { name: 'listings', key: 'listings', order: 'oldest', cols: { store_id: r => r.storeId }, fk: { store_id: 'stores' } },
  { name: 'reviews', key: 'reviews', order: 'oldest', cols: { listing_id: r => r.listingId, at }, fk: { listing_id: 'listings' } },
  { name: 'reports', key: 'reports', order: 'oldest', cols: { listing_id: r => r.listingId, at }, fk: { listing_id: 'listings' } },
  { name: 'verifications', key: 'verifications', order: 'newest', cols: { store_id: r => r.storeId }, fk: { store_id: 'stores' } },
  { name: 'purchases', key: 'purchases', order: 'newest', cols: { buyer_id: r => r.buyerId, at }, fk: { buyer_id: 'users' } },
  { name: 'payments', key: 'payments', order: 'newest', cols: { purchase_id: r => r.purchaseId, buyer_id: r => r.buyerId }, fk: { purchase_id: 'purchases', buyer_id: 'users' } },
  { name: 'orders', key: 'orders', order: 'newest', cols: { purchase_ref: r => r.purchaseRef, buyer_id: r => r.buyerId, store_id: r => r.storeId, at: r => r.placedAt ?? null }, fk: { purchase_ref: 'purchases', buyer_id: 'users', store_id: 'stores' } },
  { name: 'conversations', key: 'conversations', order: 'newest', cols: { buyer_id: r => r.buyerId, store_id: r => r.storeId }, fk: { buyer_id: 'users', store_id: 'stores' },
    // Messages live in their own table; the conversation row is stored without them.
    child: { name: 'messages', field: 'messages', parentCol: 'conversation_id' } },
  { name: 'messages', key: null, order: 'oldest', cols: { conversation_id: null, at }, fk: { conversation_id: 'conversations' }, cascade: true },
  { name: 'offers', key: 'offers', order: 'oldest', cols: { conv_id: r => r.convId, buyer_id: r => r.buyerId, store_id: r => r.storeId, at }, fk: { conv_id: 'conversations', buyer_id: 'users', store_id: 'stores' } },
  { name: 'cases', key: 'cases', order: 'newest', cols: { order_id: r => r.orderId, buyer_id: r => r.buyerId, store_id: r => r.storeId }, fk: { order_id: 'orders', buyer_id: 'users', store_id: 'stores' } },
  { name: 'refunds', key: 'refunds', order: 'newest', cols: { order_id: r => r.orderId, store_id: r => r.storeId }, fk: { order_id: 'orders', store_id: 'stores' } },
  { name: 'payouts', key: 'payouts', order: 'newest', cols: { store_id: r => r.storeId }, fk: { store_id: 'stores' } },
  { name: 'approvals', key: 'approvals', order: 'newest', cols: { ref: r => r.ref ?? null } },
  { name: 'ledger_entries', key: 'ledger', order: 'oldest', cols: { store_id: r => r.store ?? null, order_id: r => r.order ?? null, at }, fk: { store_id: 'stores', order_id: 'orders' } },
  { name: 'platform_entries', key: 'platform', order: 'oldest', cols: { store_id: r => r.store ?? null, order_id: r => r.order ?? null, at }, fk: { store_id: 'stores', order_id: 'orders' } },
  { name: 'audit_log', key: 'audit', order: 'newest', cols: { actor_id: r => r.actorId ?? null, object: r => r.object ?? null, at } },
  { name: 'notifications', key: 'notifications', order: 'newest', cols: { user_id: r => r.userId, at }, fk: { user_id: 'users' } },
  { name: 'staff_notes', key: 'staffNotes', order: 'newest', cols: { staff_id: r => r.staffId, at }, fk: { staff_id: 'staff' } },
  { name: 'tickets', key: 'tickets', order: 'newest', cols: { user_id: r => r.userId ?? null, at }, fk: { user_id: 'users' } },
  { name: 'security_events', key: 'securityEvents', order: 'newest', cols: { at } },
  { name: 'cart_items', key: 'carts', order: 'oldest', group: 'user_id', cols: { user_id: null }, fk: { user_id: 'users' } },
  { name: 'payout_methods', key: 'payoutMethods', order: 'oldest', group: 'store_id', cols: { store_id: null }, fk: { store_id: 'stores' } },
  { name: 'reconciliation_items', key: 'recon', order: 'oldest', cols: { payment_id: r => r.paymentId ?? null, at } },
  { name: 'tasks', key: 'tasks', order: 'newest', cols: { at } },
  { name: 'staff_invites', key: 'invites', order: 'newest', cols: { at } },
  { name: 'exports', key: 'exports', order: 'newest', cols: { at } },
  { name: 'provider_events', key: 'events', order: 'newest', cols: { at } },
  // Uploaded files (deliveries, evidence, attachments): the record only; the bytes are in R2.
  { name: 'files', key: 'files', order: 'map', cols: { owner_id: r => r.ownerId, at }, fk: { owner_id: 'users' } },
  { name: 'processed_ops', key: 'processedOps', order: 'oldest', values: true, cols: {} },
];
export const TABLE_KEYS = new Set(TABLES.filter(t => t.key).map(t => t.key));
const byName = Object.fromEntries(TABLES.map(t => [t.name, t]));

// SQL that creates the tables, foreign keys (checked at commit) and indexes. Safe to re-run.
export function tableMigrations() {
  const out = ['create sequence if not exists crateline_ins'];
  for (const t of TABLES) {
    const cols = Object.keys(t.cols).filter(c => c !== 'at').map(c => `${c} text`);
    out.push(`create table if not exists ${t.name} (id text primary key, ins bigint not null, at bigint, ${cols.length ? cols.join(', ') + ', ' : ''}data jsonb not null)`);
    out.push(`create index if not exists ${t.name}_ins on ${t.name} (ins)`);
    if ('at' in t.cols) out.push(`create index if not exists ${t.name}_at on ${t.name} (at desc)`);
    for (const c of Object.keys(t.cols).filter(c => c !== 'at')) out.push(`create index if not exists ${t.name}_${c} on ${t.name} (${c})`);
  }
  for (const t of TABLES) for (const [col, ref] of Object.entries(t.fk || {})) {
    const name = `${t.name}_${col}_fk`;
    out.push(`do $$ begin if not exists (select 1 from pg_constraint where conname = '${name}') then
      alter table ${t.name} add constraint ${name} foreign key (${col}) references ${ref} (id)${t.cascade ? ' on delete cascade' : ''} deferrable initially deferred; end if; end $$`);
  }
  return out;
}

// ---------- document <-> rows
const recordsOf = (doc, t) => t.order === 'map' ? Object.values(doc[t.key] || {}) : (doc[t.key] || []);
const groupRows = (doc, t) => Object.entries(doc[t.key] || {}).flatMap(([owner, list]) => (list || []).map(r => ({ id: r.id, cols: { [t.group]: owner }, data: r })));
// Rows for one table from the document: [{ id, cols, data }]. Child records (messages) are taken
// from their parent and the parent row is stored without them.
export function rowsFor(doc, t) {
  if (t.name === 'messages') {
    return (doc.conversations || []).flatMap(c => (c.messages || []).map(m => ({ id: m.id, cols: { conversation_id: c.id, at: m.at ?? null }, data: m })));
  }
  if (t.group) return groupRows(doc, t);
  if (t.values) return (doc[t.key] || []).map(v => ({ id: String(v), cols: {}, data: v }));
  return recordsOf(doc, t).map(r => {
    const data = t.child ? (({ [t.child.field]: _, ...rest }) => rest)(r) : r;
    return { id: r.id, cols: Object.fromEntries(Object.entries(t.cols).map(([c, f]) => [c, f(r) ?? null])), data };
  });
}
// The settings document: everything except the tabled collections.
export const settingsOf = doc => Object.fromEntries(Object.entries(doc).filter(([k]) => !TABLE_KEYS.has(k)));
// Builds the full document from the settings document and table rows ({ table: [{ id, data, cols }] }, by ins asc).
export function assemble(settings, rows) {
  const doc = { ...settings };
  for (const t of TABLES) {
    if (!t.key) continue;
    const list = rows[t.name] || []; const ordered = t.order === 'newest' ? list.slice().reverse() : list;
    if (t.group) { const g = {}; for (const r of ordered) (g[r.cols[t.group]] = g[r.cols[t.group]] || []).push(r.data); doc[t.key] = g; continue; }
    doc[t.key] = t.order === 'map' ? Object.fromEntries(ordered.map(r => [r.id, r.data])) : ordered.map(r => r.data);
  }
  const msgs = {}; for (const r of rows.messages || []) (msgs[r.cols.conversation_id] = msgs[r.cols.conversation_id] || []).push(r.data);
  for (const c of doc.conversations) c.messages = msgs[c.id] || [];
  return doc;
}
// Insert order for a full write: the oldest record first, so `ins` grows with age.
export function insertOrder(t, rows) { return t.order === 'newest' ? rows.slice().reverse() : rows; }
export { byName };
