# SoftGlaze Stock Manager — Desktop (Windows)

A fully **offline, self-contained** Windows app. It's a thin **Electron** shell around
the exact same server + web app, plus a **bundled PostgreSQL** — so the shop PC needs
**no separate database install and no internet**.

On launch the app:
1. **(first run)** creates a private PostgreSQL data directory under `%APPDATA%`, creates
   the `softglaze` database, applies all migrations, and seeds the shop defaults;
2. starts the bundled PostgreSQL (listening on `127.0.0.1` only, on a private port);
3. starts the built API server (using Electron's own Node — no separate Node needed),
   which serves the API **and** the web app on `http://localhost:4000`;
4. opens the window there.

To the shop owner it's one normal Windows program — double-click and use it.

## Where data lives (`%APPDATA%/SoftGlaze`)
- `pgdata/` — the PostgreSQL database (all shop data).
- `uploads/` — product / branding images.
- `softglaze.config.json` — editable config (DB port + password + auto-generated JWT
  secrets). To use an **external** PostgreSQL instead of the bundled one, set
  `"embeddedDb": false` and a `"databaseUrl"` here.
- `desktop.log` — a diagnostic log of the last launch (handy for support).

> **Back up the whole `%APPDATA%/SoftGlaze` folder** (or use the app's Settings → Backup
> JSON export) to move a shop to a new PC.

## Try it without building an installer
From the repo root, with the portable PostgreSQL present at `../pg` (or `SOFTGLAZE_PG_DIR`
pointing at a PostgreSQL 16 Windows folder):
```bash
npm install                       # once — installs Electron for the desktop workspace
npm run build                     # build server (dist) + web (static)
npm run desktop                   # opens the app; bundled DB is created on first run
```
For live-reload development instead: run `npm run dev` in one terminal and, in another,
`set SOFTGLAZE_DEV=1 && npm run desktop` (loads the Vite dev server, skips DB management).

## Build the Windows installer
```bash
cd apps/desktop
npm run dist          # → release/SoftGlaze-Stock-Manager-Setup-x.x.x.exe
```
`predist` automatically: generates the Prisma client, builds the server + web, and stages
a **minimal PostgreSQL runtime** (bin + lib + share, ~120 MB) into `vendor/pgsql` via
`scripts/stage-pg.cjs`. electron-builder then bundles the server, the web app, the Node
dependencies (incl. the Prisma engines), and that PostgreSQL runtime into one installer.

- The PostgreSQL source is `SOFTGLAZE_PG_DIR` (default: the repo's `../pg/pgsql`). Point it
  at any PostgreSQL 16 for Windows folder that has `bin/postgres.exe`.
- Stop the dev API server before building — Windows locks the Prisma engine DLL while it
  runs, which blocks `prisma generate`.
- Optional: drop a `build/icon.ico` (256×256) before building to brand the app + installer.
- `npm run pack` produces an **unpacked** app under `release/win-unpacked` (no installer) —
  useful for a quick smoke test.

## Test on the shop PC / a clean PC
1. Run the `Setup.exe` and install (per-user; can change the folder).
2. Launch **SoftGlaze Stock Manager**. First run takes ~a minute (it's building the
   database) — a splash screen shows while it works.
3. Register the owner account on the first screen, pick a business type in onboarding,
   then do a full shop-day test (sale on cash + on udhaar, a purchase, a payment, then
   check Reports → Integrity is all-green).

> **Note (offline DB):** `initdb` refuses to run as Administrator — install and run the app
> as a normal user (the default). No admin rights are required.
