# 💎 SoftGlaze Stock Manager — Inventory + POS

![version](https://img.shields.io/badge/version-1.0.1-FF9F43) ![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Web-2C7BE5) ![stack](https://img.shields.io/badge/stack-React%20%7C%20Node%20%7C%20Prisma%20%7C%20PostgreSQL-334155) ![license](https://img.shields.io/badge/license-Commercial-6f42c1)

A premium, production‑ready **Stock Management + Point‑of‑Sale** system for retail and
wholesale shops. One codebase ships to **both** the browser (VPS / self‑host) and the
**Windows desktop** (Electron installer). Built for markets where **pay‑later (udhaar)
credit** on sales *and* purchases is a first‑class flow.

**Repo:** https://github.com/softglazee/Softglaze-inventory-management

> Business‑agnostic: pick a **Business Type** preset (Building Materials, General / Kiryana
> Store, Electronics, Clothing, Pharmacy, Hardware, or Custom) and the app seeds the right
> categories, units and sample products for you.

One codebase, two targets:
- 🖥 **Desktop app** for the shop PC (Electron, Windows installer)
- 🌐 **Browser app** on your own server (access from anywhere)

📚 **Full documentation:** online at
**[softglaze.com/docs/stock-manager](https://softglaze.com/docs/stock-manager/)**, or open the
offline copy [`docs/documentation.html`](docs/documentation.html) in any browser — it is a single
self‑contained file with its screenshots embedded.

> Regenerate it after changing screenshots or content with `node docs/build-docs.cjs`
> (edit `docs/documentation.src.html`, replace images in `docs/assets/`).

---

## ✨ Highlights

- **Full‑screen, keyboard‑first POS** — image tiles, category sidebar, favourites, held
  bills, quotations, split payments, cash / udhaar, on‑the‑fly customer add, receipt print
  (80mm thermal + A4 / PDF).
- **Accurate double‑entry accounting** — every sale / purchase / payment is one atomic
  transaction; stock and money **ledgers are the source of truth**; a built‑in
  `GET /reports/integrity` check proves the books always balance.
- **Inventory** — products (standard / service / combo), weighted‑average cost, barcodes,
  multi‑image, low‑stock alerts, stock adjustments with reasons, purchase orders → GRN.
- **Receivables & payables** — customer & vendor ledgers, credit limits, promises‑to‑pay,
  post‑dated cheques, customer sites / projects, price groups & contract rates.
- **Money** — multiple cash / bank / wallet accounts, transfers, capital & drawings, day
  close, expenses (incl. recurring), employee salaries & advances.
- **Reports** — dashboard, accrual P&L, balance sheet, stock valuation, sales / purchase
  registers, comparative (MoM / YoY) — each with on‑screen table + **PDF** + **Excel**.
- **Premium UI** — warm‑orange design system, light / dark, responsive, animated charts,
  skeleton loading, designed empty states.
- **Extras** — 2FA (TOTP), WhatsApp (wa.me) + SMTP messaging, loyalty points, bulk
  import / export wizard, full JSON backup & restore, optional nightly offsite backup.

## 🧩 Business types

Onboarding — and **Settings → Business Type** — lets the owner apply a preset that seeds
categories, units and sample products for that trade:

| Preset | Typical use |
| --- | --- |
| Building Materials | Iron / steel (sariya, girders), cement, sand, pipes, hardware |
| General / Kiryana Store | Grocery & everyday retail |
| Electronics | Devices & accessories |
| Clothing | Apparel |
| Pharmacy | Medicines (batch / expiry) |
| Hardware | Tools & fittings |
| Custom | Start empty and build your own |

## 🏗️ Tech stack

| Layer | Tech |
| --- | --- |
| Web app | React 18, Vite 6, TypeScript, Tailwind CSS v4, TanStack Query, React Router, Recharts |
| API | Node.js, Express, TypeScript, Prisma ORM, Zod, JWT (access + refresh), bcrypt, sharp |
| Database | PostgreSQL 14+ |
| Desktop | Electron (spawns the built API + serves the built web; uploads under %APPDATA%) |
| Money | Prisma `Decimal` / decimal.js — **never** JS floats |

## ✅ Requirements

- **Node.js 18+** (20 / 22 recommended) and npm — for development / building
- **PostgreSQL 14+** — for the **browser / self-host** path (local install, Docker, or a
  managed instance). The **Windows desktop app bundles PostgreSQL 16**, so end users need
  nothing installed.
- ~500 MB disk for dependencies

## 🚀 Quick start (development)

```bash
# 1) Install all workspaces
npm install

# 2) Configure the API environment
cp apps/server/.env.example apps/server/.env
#    then edit apps/server/.env — set DATABASE_URL + strong JWT secrets

# 3) Create the schema and seed units/categories/payment methods/settings
npm run db:migrate
npm run db:seed

# 4) Run web (5173) + API (4000) together
npm run dev
```

Open **http://localhost:5173**. A fresh install detects that no owner exists yet and lets
you **Register** the first account — it becomes the **Super Admin / owner**. Registration
then closes; further staff are added under **Users & Roles**. On first sign‑in the owner is
guided through onboarding to pick a business type.

- API health check → http://localhost:4000/api/v1/health

### Environment variables (`apps/server/.env`)

| Key | Example | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/softglaze?schema=public` | PostgreSQL connection |
| `PORT` | `4000` | API port |
| `NODE_ENV` | `development` / `production` | |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | *(random 32‑byte hex)* | `openssl rand -hex 32` |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | `15m` / `7d` | |
| `CORS_ORIGIN` | `http://localhost:5173` | Web origin allowed to call the API |
| `UPLOAD_DIR` | `uploads` | Product / branding image storage |

> **Never commit `.env` or the `uploads/` folder.**

## 📦 Scripts (repo root)

| Script | What it does |
| --- | --- |
| `npm run dev` | Run API + web together (hot reload) |
| `npm run dev:server` / `npm run dev:web` | Run one side only |
| `npm run build` | Type‑check + build API and web for production |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Seed units / categories / payment methods / settings |
| `npm run db:studio` | Open Prisma Studio (DB browser) |
| `npm run desktop` | Launch the Electron desktop shell |

## 🗂️ Project structure

```
softglaze/
├─ apps/
│  ├─ server/     Express + Prisma API (routes, services, prisma/schema.prisma, scripts/)
│  ├─ web/        React + Vite front‑end (pages/, components/, context/, lib/)
│  └─ desktop/    Electron wrapper (production packaging)
├─ docs/          Product & design docs — start with docs/documentation.html
└─ package.json   npm workspaces + root scripts
```

## 🏭 Production build & deploy

```bash
npm run build          # builds apps/server/dist and apps/web/dist
```

Single‑origin server mode: set `SERVE_WEB=1` and `NODE_ENV=production` and the API also
serves the built web app (SPA fallback; `/api` and `/uploads` untouched). A full VPS
walkthrough (Nginx + PM2 + Postgres) is in `docs/07-DEPLOYMENT.md`.

## 🖥️ Windows desktop app (fully offline)

`apps/desktop` wraps the built API + web **and a bundled PostgreSQL** into one installable
Windows app — the shop PC needs **no separate database and no internet**. On first run it
creates a private database under `%APPDATA%/SoftGlaze/pgdata`, applies all migrations, seeds
defaults, then serves the app in a normal window. Uploads live under
`%APPDATA%/SoftGlaze/uploads`; an editable `softglaze.config.json` can point at an external
PostgreSQL instead (`"embeddedDb": false`).

```bash
cd apps/desktop
npm run dist     # → release/SoftGlaze-Stock-Manager-Setup-x.x.x.exe (bundles Postgres)
```

`predist` builds the server + web, generates the Prisma client, and stages a minimal
PostgreSQL runtime (~120 MB) from `../pg/pgsql` (or `SOFTGLAZE_PG_DIR`). Full details in
[`apps/desktop/README.md`](apps/desktop/README.md) and **docs/documentation.html → Desktop
build**.

## 🔒 Accounting integrity (why the books never drift)

- Money is a Prisma `Decimal` everywhere; quantities to 3dp, money to 2dp, rounded only at
  the edges.
- Every financial write is **one** `prisma.$transaction`.
- `StockMovement` and `AccountEntry` ledgers are the source of truth; `Product.stockQty`
  and `PaymentMethod.currentBalance` are caches updated in the same transaction.
- Financial documents are never hard‑deleted (status `CANCELLED` / returns).
- **`GET /reports/integrity`** verifies stock caches, account caches, per‑document totals,
  customer/vendor reconciliation and that **Assets = Liabilities + Equity**.

## 💾 Backup & restore

**Settings → Backup** downloads a full portable JSON snapshot and restores it (wipe +
reload in FK order, one transaction). Optional nightly offsite upload to a pre‑signed
S3 / GCS URL.

## 🆘 Support & license

Commercial product — licensed, not sold. See [`LICENSE`](LICENSE) and the terms
included with your purchase. For setup, open [`docs/documentation.html`](docs/documentation.html);
for anything else, contact support through your purchase channel.
