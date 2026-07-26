# SoftGlaze — Architecture

## One codebase, two targets

```
                    ┌─────────────────────────────┐
                    │      React Web App (Vite)    │
                    │  POS · Inventory · Reports   │
                    └──────────────┬──────────────┘
                                   │ REST /api (JSON, JWT)
                    ┌──────────────▼──────────────┐
                    │   Node.js + Express API      │
                    │  Auth · Business logic ·     │
                    │  PDF (pdfmake) · Excel       │
                    └──────────────┬──────────────┘
                                   │ Prisma ORM
                    ┌──────────────▼──────────────┐
                    │        PostgreSQL            │
                    └─────────────────────────────┘

DESKTOP TARGET                        SERVER TARGET
Electron shell starts the API         Nginx → PM2 runs the API
locally + opens the UI window.        Serves built web app + HTTPS.
DB on the shop PC.                    DB on the VPS. Access from anywhere.
```

The desktop app is not a separate program — Electron boots the same Express server
on `localhost` and shows the same React UI in a window. Whatever we build once
works in both places. This is why maintenance stays cheap.

## Monorepo layout

```
softglaze/
├── package.json            # npm workspaces root, shared scripts
├── docker-compose.yml      # Postgres for local dev
├── docs/                   # all planning & guides (read 01 → 08)
├── apps/
│   ├── server/             # Express + TypeScript + Prisma
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # FULL schema (source of truth)
│   │   │   └── seed.ts         # admin user + demo data
│   │   └── src/
│   │       ├── index.ts        # entry (starts http server)
│   │       ├── app.ts          # express app, middleware, route mounting
│   │       ├── lib/prisma.ts   # prisma client singleton
│   │       ├── middleware/auth.ts  # JWT verify + role guard
│   │       ├── routes/         # one file per module
│   │       └── utils/          # counters (INV-0001), money helpers
│   ├── web/                # React + Vite + TS + Tailwind v4
│   │   └── src/
│   │       ├── main.tsx / App.tsx / router
│   │       ├── index.css       # design tokens: dark & light themes
│   │       ├── context/        # AuthContext, ThemeContext
│   │       ├── lib/api.ts      # fetch wrapper with auto token refresh
│   │       ├── components/     # layout shell, sidebar, theme toggle...
│   │       └── pages/          # Login, Register, Dashboard, then modules
│   └── desktop/            # Electron shell + electron-builder config
│       ├── main.cjs            # spawns server, opens window
│       └── package.json
```

## Key design decisions (don't fight these later)

1. **StockMovement ledger is the source of truth for stock.** `Product.stockQty`
   is just a cached number updated in the same transaction. If they ever disagree,
   the ledger wins and a "recalculate stock" admin tool fixes the cache.
2. **Money is `Decimal`, never JS `number` in the DB.** On the API we send strings
   and parse carefully. Rounding rules: 2dp money, 3dp quantity.
3. **COGS snapshot on every SaleItem** (`unitCost` at sale time) → profit per invoice
   is exact even if costs change later. Weighted-average cost updates on purchase:
   `newAvg = (oldQty*oldAvg + inQty*inCost) / (oldQty + inQty)`.
4. **Every financial write is one Prisma `$transaction`**: e.g. completing a sale =
   create Sale + SaleItems + StockMovements + Payment + update Product.stockQty +
   update Customer.balance + increment Counter + AuditLog — all or nothing.
5. **Document numbers** come from the `Counter` table inside the transaction
   (INV-000123, PUR-000045, PAY-000789…) — no gaps from race conditions.
6. **RBAC in one place**: `requireRole(...roles)` middleware on routes + the same
   permission map exported to the frontend to hide UI the user can't use.
7. **PDF & Excel are generated server-side** (pdfmake / exceljs) and streamed as
   downloads → identical output in browser and desktop, printable anywhere.
8. **Images** land in `apps/server/uploads/` (git-ignored), served at `/uploads/*`,
   resized to max 1200px + a 200px thumbnail (sharp).

## API conventions
- Base: `/api/v1`
- Auth: `Authorization: Bearer <accessToken>`; refresh via `POST /auth/refresh`
- Responses: `{ ok: true, data }` or `{ ok: false, error: { code, message } }`
- Pagination: `?page=1&limit=25&search=&sort=`  → `{ items, total, page, pages }`
- Dates in ISO 8601; the client formats for display

## Environment
- `apps/server/.env` → `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PORT=4000`
- `apps/web/.env` → `VITE_API_URL=http://localhost:4000/api/v1`
- Never commit `.env` (already git-ignored); `.env.example` documents every key
