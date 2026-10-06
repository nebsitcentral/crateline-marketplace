# Crateline Marketplace

A multivendor digital products and services marketplace: public website, User panel,
Seller panel, and Admin and Super Admin management panels.

| Part | Folder | Runs on |
|---|---|---|
| Frontend (React + Vite) | `frontend/` | GitHub Pages |
| API (Node.js + Express) | `backend/` | Railway, with Railway Postgres |
| Business rules shared by both | `packages/domain/` | imported by frontend and backend |

## Current status

* **Frontend:** complete interactive prototype. By default it runs in **demo mode**: all data is
  fictional and kept in the visitor's browser. Payments, verification, uploads and payouts are simulated.
* **Backend:** working API with accounts (bcrypt + JWT), Postgres persistence, server-side
  permission checks, role-filtered data, and the money, refund, payout, dispute and moderation
  transitions. Covered by tests (`npm test`).
* **Connected:** with `VITE_API_URL` set, every screen reads and writes through the API. Email
  (Brevo), two-factor sign-in and file storage (Cloudflare R2) are real once their keys are set.
* **Not yet done:** payment, payout and KYC providers are simulated. `CLAUDE.md` lists the
  remaining work (Phase 3).

## Requirements

* Node.js 20 or newer (`node -v`)
* Git, VS Code, and a GitHub and Railway account for deployment

## Run locally

```bash
npm install                     # installs all three workspaces
cp backend/.env.example backend/.env
npm run dev:api                 # API on http://localhost:4000 (in-memory store unless DATABASE_URL is set)
npm run dev                     # frontend on http://localhost:5173 (second terminal)
npm test                        # domain and API tests
```

Demo logins seeded in the API all use the password in `SEED_DEMO_PASSWORD`, for example
`mira@example.com` (buyer), `rafi@atlas.example` (seller), `sofia.sa-01@staff.example.com`
(Super Admin), `felix.fin-01@staff.example.com` (Finance Admin).

## Live demo

* Website (GitHub Pages): https://nebsitcentral.github.io/crateline-marketplace/
* API (Railway, project "Crateline marketplace", service `backend` + Postgres):
  https://backend-production-2489.up.railway.app/health
* Pushing to `main` redeploys both: GitHub Actions publishes the website, and Railway rebuilds the
  `backend` service from the repository root. The website reads the API address from the
  repository variable `VITE_API_URL`.
* The demo accounts' password is the `SEED_DEMO_PASSWORD` variable of the Railway `backend` service.

## Deploy the API to Railway

1. Push this repository to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo** and pick this repository. Keep the root
   directory as the repository root (the API needs the shared `packages/domain` workspace).
   `railway.json` sets the start command and health check.
3. Add a **PostgreSQL** database to the project. Railway exposes `DATABASE_URL` to the service.
4. Set service variables:
   * `NODE_ENV=production`
   * `JWT_SECRET` = a random string of 32+ characters
   * `SEED_DEMO_PASSWORD` = the password for the seeded demo accounts
   * `FRONTEND_ORIGIN` = your GitHub Pages origin, e.g. `https://yourname.github.io`
   * `SIMULATE_PROVIDERS=true` and `ALLOW_DEMO_CONTROLS=true` while this is a demo
   * Email through Brevo: `BREVO_API_KEY` (Brevo > SMTP & API > API keys), `EMAIL_FROM` (a sender
     or domain verified in Brevo), optional `EMAIL_FROM_NAME`, and `APP_URL` = the website address
     used in email links, e.g. `https://yourname.github.io/<repo-name>`. Without a key, production
     keeps verification, password reset and email change switched off.
   * `DATA_ENCRYPTION_KEY` = a long random string that encrypts two-factor secrets. Keep it
     stable: changing it breaks existing two-factor set-ups. If unset, one is derived from
     `JWT_SECRET`, so rotating `JWT_SECRET` would have the same effect.
   * File storage on Cloudflare R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
     `R2_BUCKET` (see "File storage" below). Without them, attachments stay simulated.
5. **Settings → Networking → Generate Domain**. Check `https://<your-domain>/health`.

On first start the API creates its tables and loads the demo fixtures.

## File storage (Cloudflare R2)

Delivery files, case evidence and message attachments are uploaded by the browser straight to a
private R2 bucket with a 15-minute signed link, and downloaded with a 5-minute link that the API
gives only to people who may see the file. Files are limited to 60 MB; executables are refused.

1. Cloudflare dashboard → **R2 → Create bucket** (for example `crateline-files`). Keep public
   access off.
2. **R2 → Manage API tokens → Create API token**: permission **Object Read & Write**, limited to
   that bucket. Copy the Access Key ID and Secret Access Key. The Account ID is on the R2 overview.
3. Bucket → **Settings → CORS policy**, with your website origin:

   ```json
   [{ "AllowedOrigins": ["https://yourname.github.io", "http://localhost:5173"],
      "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
   ```
4. Set the four `R2_*` variables on the Railway `backend` service (and in `backend/.env` locally).
   `/health` then reports `"files": "r2"`.

## Deploy the frontend to GitHub Pages

1. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Optional, once Phase 2 is done: **Settings → Secrets and variables → Actions → Variables**, add
   `VITE_API_URL` = your Railway URL.
3. Push to `main`. The workflow in `.github/workflows/deploy-frontend.yml` runs the tests, builds
   and publishes to `https://yourname.github.io/<repo-name>/`.

## Before real customers use it

The prototype must not take real money or identity data until these are in place: real payment and
payout providers with webhook verification and reconciliation, a KYC provider, transactional email,
file storage for deliveries and evidence, approved legal policies, and the business decisions listed
in Section 20 of the specification. See `CLAUDE.md` for the order of work.
