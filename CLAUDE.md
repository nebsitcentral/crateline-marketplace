# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Crateline is a multivendor marketplace for digital products and services (data and leads,
accounts, servers and software, services). Five areas share one data model: public website,
User (buyer) panel, Seller panel, Admin panel, Super Admin panel. There is no Agent panel.

## Layout

```
packages/domain/src/   Business rules shared by frontend and backend (pure JS, no React, no I/O)
  clock.js             Demo clock (CLOCK.offset) used by every rule through now()
  data.js              Seed fixtures (Section 18 of the spec), categories, snapshot helpers
  fin.js               Money (integer cents), ledger buckets, roles and permissions, approvals,
                       refunds, payouts, settings versions, audit, tick() scheduler, reports
  logic.js             Formatting, order and listing helpers, checkout and order creation
  actions.js           Buyer and seller order, case and offer transitions
  ops.js               Admin transitions: users, sellers, catalog, content, orders, cases,
                       support, reconciliation, tasks
frontend/src/          React UI (Vite). app.jsx is the router and in-browser store.
  ui.jsx shell.jsx     Shared components, public header, customer panel layout, demo toolbar
  public.jsx auth.jsx buyer.jsx seller.jsx shared.jsx   Customer-facing screens
  admin-ui.jsx         Management shell, route permission map (ROUTES), lists, dialogs, previews
  admin-ops.jsx admin-fin.jsx super.jsx                 Admin and Super Admin screens
  api.js               Client for the backend (used when VITE_API_URL is set)
backend/src/           Express API
  app.js               Routes: /health, /api/catalog, /api/auth/*, /api/state, /api/actions/:name
  actions.js           Whitelist of named actions for customers and staff
  views.js             What each caller may read (server-side filtering)
  files.js             File storage on Cloudflare R2: signed upload and download URLs
  store.js             Memory store (dev, tests) or Postgres store (one versioned JSON document)
  migrate.js seed.js   Tables and demo fixtures
backend/test/          node:test suites (domain rules and HTTP API)
```

## Commands

```bash
npm install          # all workspaces
npm run dev          # frontend, http://localhost:5173
npm run dev:api      # API, http://localhost:4000 (copy backend/.env.example to backend/.env first)
npm test             # backend tests (domain + API). Run before every commit.
# Same tests on Postgres (store tests run too), e.g. a local Docker database:
# docker run -d --name crateline-pg -e POSTGRES_PASSWORD=crateline -e POSTGRES_DB=crateline -p 55432:5432 postgres:16-alpine
# TEST_DATABASE_URL=postgres://postgres:crateline@localhost:55432/crateline npm test
npm run build        # frontend production build
npm run seed -w backend -- --force   # reset the API data to the fixtures
```

## Rules that must not be broken

* **Money is integer cents** in the ledger, refunds, payouts and approvals (`amountC`, `fmtMoney`).
  Listing prices and order totals are still dollars and are converted with `toC` at the ledger
  boundary. Convert any new money field to cents rather than adding more dollar values.
* **Balances are derived, never stored.** Seller funds move between buckets
  (pending, held, available, reserved) and sinks (paidOut, refunded) through `mv()`. Reports call
  `storeBuckets`, `platformTotals`, `sellerFundsAll`. Never write a balance number directly.
* **Use named transitions.** State changes go through functions in `packages/domain`. Each checks
  permission (`need`/`can`), record state and, where relevant, record `version`, then writes audit
  and notifications. Do not add status dropdowns or direct field edits for money or workflow state.
* **Separate approval from execution.** Refunds and payouts need a requester and a different
  approver; Finance limits are in settings (`financeRefundLimitC`, `financePayoutLimitC`).
  Approval never moves money. Provider events are idempotent via `processedOps`.
* **Never rewrite history.** Order snapshots (`order.snap`, `commissionRate`, `termsVersion`) are
  frozen at purchase. Audit entries are append-only. Archive instead of delete for transactions.
* **Server is the authority.** Anything the browser receives from the API must come from
  `backend/src/views.js`. Hiding a button is not access control. New API actions take the actor
  from the JWT, never from the request body.
* **Simulations stay labelled.** Payment, payout, KYC and health are simulated; email is real when
  `BREVO_API_KEY` is set and labelled "Development" when written to the server log. Keep the
  "Simulated" and "Demo environment" labels until a real provider replaces each one. Provider
  simulation endpoints are disabled when `SIMULATE_PROVIDERS=false`.
* **Domain module state:** `CLOCK.offset` and the category list (`syncCats`) are module-level.
  The backend sets both from the document before every transaction (`store.prepare`). Keep new
  domain code free of other globals.

## Phase 2: connect the frontend to the API

Work in small steps; keep demo mode working when `VITE_API_URL` is empty.

1. In `app.jsx`, when `apiEnabled` (from `api.js`) is true, load `/api/catalog` for guests and
   `/api/state` after sign-in instead of `seed()`. Map the returned `view` into the shape the
   screens read (`db`). Customer views and staff views have different keys; see `views.js`.
2. Replace the demo sign-in buttons with `api.login` / `api.staffLogin` / `api.register`.
3. Move each screen action from `update(d => ...)` to `api.action(name, args)` followed by a state
   refresh. Start with checkout, confirm received, open case, submit delivery, request payout; then
   the staff actions in `backend/src/actions.js`. Add any missing action there first, with a test.
4. Handle `409` (stale version) by reloading the record and showing the existing "changed since you
   opened it" notice; `403` as Access denied; `422` as field errors.
5. Hide the demo toolbar's account switcher in API mode; keep time travel and reset behind
   `/api/demo/*` for Super Admins only while `ALLOW_DEMO_CONTROLS=true`.

Progress: all five steps are done. `toDb()` in `api.js` maps views into `db`; `apiSignIn` signs in;
every screen change goes through `perform(name, args, local, msg)` in `app.jsx`, which calls the
server action in API mode and the same domain function locally in demo mode. Seller tools live in
`packages/domain/src/seller.js`. Payout destinations (`POST /api/payout-methods`) and password
changes (`POST /api/auth/password`) re-check the password; support requests use `POST /api/support`
(guests allowed). Staff and customer tokens carry `tokenVersion`, so revoking sessions or changing
the password ends existing sign-ins. Not available in API mode until Phase 3 email exists: email
verification, email change, password reset, two-factor sign-in. Errors (step 4): `perform` reloads on 409 and the detail pages' "changed since you opened it"
notice appears (data also refreshes every 30 s and on window focus); 403 shows Access denied;
400/422 show in the form when the caller uses `{ inline: true }` or `withInline()` (dialogs), and
validation errors carry `field`. Demo controls (step 5): `ApiDemoControls` in `shell.jsx` gives
Super Admins time travel, provider outcomes (`/api/demo/scenario`) and reset while the server has
`ALLOW_DEMO_CONTROLS=true`; the demo account switcher exists only in demo mode.

## Phase 3: production readiness (in this order)

1. Normalise storage. **Done:** `backend/src/tables.js` maps 24 collections (users, staff, stores,
   listings, orders, ledger, platform entries, audit, notifications, messages and more) to their own
   tables with foreign keys (checked at commit) and indexes; `app_state` keeps settings and small
   configuration only. Old single-document databases are split automatically on start.
   `/api/state` caps audit, notifications and staff notifications; older entries come from
   `GET /api/list/:resource?after=<id>`. Carts and payout methods (grouped by owner),
   reconciliation items, tasks, invites, exports, provider events and processed provider
   operations (`processed_ops`, one row per operation) have tables too; the start-up split moves
   only collections still found in the document. A transaction that repeats a record id is refused.
   Still to do: each write locks one row and loads the (cached) document, and reads are built from
   that document rather than per-table queries.
2. Real email. **Done:** Brevo (`backend/src/email.js`). Emails are queued in `email_outbox` in the
   same transaction as the change that causes them and sent by a worker (every 15 s, plus right
   after a request) with backoff retries; Postgres claims rows with `FOR UPDATE SKIP LOCKED`.
   Verification (on registration, resend), password reset (30-minute single-use link, ends all
   sessions), email change (confirmed from the new address) and notification emails (verified
   customers with "Also send by email"). Tokens are stored hashed in `auth_tokens`. Without
   `BREVO_API_KEY`, development servers write emails to the API log; production keeps email off.
   Two-factor sign-in is done too (`backend/src/totp.js`, RFC 6238): secrets are encrypted in the
   `accounts` table (`DATA_ENCRYPTION_KEY`, else derived from `JWT_SECRET`), sign-in returns a
   5-minute `mfa` ticket that only `/api/auth/mfa` accepts, codes cannot be reused, and recovery
   codes are stored hashed. Customers set it up in account settings, staff under Sign-in security.
   Requiring it for staff with money permissions is a business decision not yet made.
3. File storage for deliveries and evidence. **Done:** Cloudflare R2 (`backend/src/files.js`,
   hand-written Signature V4 signed URLs, no SDK). `POST /api/files` records the file (`files`
   table) and returns a 15-minute upload link; `POST /api/files/:id/complete` checks the stored
   size; actions then accept `{ id }` as an attachment (owner only, once) for deliveries,
   replacement requests, case evidence and messages. `GET /api/files/:id/url` gives a 5-minute
   download link if the file appears in the caller's view; staff also need `orders.evidence` /
   `cases.evidence` and each staff download is audited. Without the `R2_*` variables file storage
   is off and attachments stay simulated. Still to do: delete unattached and expired files
   (retention period is a business decision), virus scanning, listing/store images and avatars
   (still simulated), seller verification documents (go to the KYC provider, Didit).
4. Payment providers with verified webhooks feeding the same idempotent `processedOps` logic.
   Chosen: NOWPayments (crypto). No card provider chosen yet.
5. Payout provider and reconciliation jobs (NOWPayments mass payouts). KYC provider for seller
   verification (Didit).
6. Approved legal text for policies; confirm the Section 20 business decisions.

## Testing expectations

* Add or update a test in `backend/test/` for every rule or action you change.
* Financial changes must keep these true: seed totals (USD 460 gross, 46 commission);
  USD 20 refund reverses exactly USD 2 commission and USD 18 seller funds; payout success /
  failure / unknown leave Atlas at 130 / 180 / 130 available with 0 / 0 / 50 reserved.

## Style

* Plain, direct interface copy. Buttons say exactly what happens; errors say what went wrong and
  how to fix it. Status always shown as text, not colour alone.
* Keep components in the existing files and reuse shared components from `ui.jsx` and
  `admin-ui.jsx` (`AList`, `DetailHead`, `ReasonDialog`, `Evidence`, `ExportButton`).
