/**
 * SoftGlaze Stock Manager — Windows desktop shell.
 *
 * Fully offline, self-contained. On launch it:
 *   1. (first run) initialises a private PostgreSQL data dir under %APPDATA%,
 *      creates the `softglaze` database, runs migrations and seeds defaults;
 *   2. starts the bundled PostgreSQL (listening on 127.0.0.1 only, private port);
 *   3. spawns the BUILT Express server using Electron's own Node runtime
 *      (ELECTRON_RUN_AS_NODE — no separate Node install needed), which serves the
 *      API + the built web app on http://localhost:4000;
 *   4. opens a window there.
 *
 * Uploads live under %APPDATA%/SoftGlaze/uploads. Config (DB port + password +
 * JWT secrets) is an editable file at %APPDATA%/SoftGlaze/softglaze.config.json —
 * set `"embeddedDb": false` and a `databaseUrl` there to point at an external
 * PostgreSQL instead of the bundled one.
 *
 * Live-dev: run with SOFTGLAZE_DEV=1 (with `npm run dev` already running) to load
 * the Vite dev server and skip all server/DB management.
 */
const { app, BrowserWindow, dialog, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const http = require("http");
const net = require("net");

// Preferred port; the real one is chosen at startup by findFreePort() below.
let PORT = Number(process.env.SOFTGLAZE_PORT || 4000);
let BASE = `http://localhost:${PORT}`;
const DEV = process.env.SOFTGLAZE_DEV === "1";
const isPackaged = app.isPackaged;

// Bundled resource locations (packaged vs. running from source)
const RES = isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const SERVER_ENTRY = path.join(RES, "server", "dist", "index.js");
const SEED_ENTRY = path.join(RES, "server", "dist", "seed.js");
// Optional data snapshot — present only in a data-preloaded (client-specific) build;
// absent in the generic product, which seeds an empty shop instead.
const INITIAL_DATA = path.join(RES, "server", "dist", "initial-data.sql");
// Product/branding images shipped with the build (empty in the generic product;
// populated in a data-preloaded client build). Restored into userData on launch.
const BUNDLED_UPLOADS = path.join(RES, "server", "uploads");
const SCHEMA_PATH = path.join(RES, "server", "prisma", "schema.prisma");
const WEB_DIST = path.join(RES, "web", "dist");
const NODE_MODULES = isPackaged ? path.join(RES, "node_modules") : path.join(__dirname, "..", "..", "node_modules");

// Prisma CLI + engine binaries (bundled inside node_modules)
const PRISMA_CLI = path.join(NODE_MODULES, "prisma", "build", "index.js");
const SCHEMA_ENGINE = path.join(NODE_MODULES, "@prisma", "engines", "schema-engine-windows.exe");
const QUERY_ENGINE = path.join(NODE_MODULES, ".prisma", "client", "query_engine-windows.dll.node");

// Bundled PostgreSQL (packaged → resources/pgsql; dev → the repo's portable pg,
// overridable with SOFTGLAZE_PG_DIR)
const PG_ROOT = isPackaged
  ? path.join(process.resourcesPath, "pgsql")
  : (process.env.SOFTGLAZE_PG_DIR || path.join(__dirname, "..", "..", "..", "pg", "pgsql"));
const PG_BIN = path.join(PG_ROOT, "bin");
const PG_DATA = path.join(app.getPath("userData"), "pgdata");
const PG_LOG = path.join(app.getPath("userData"), "pg.log");
const SEED_MARKER = path.join(app.getPath("userData"), ".seeded");

let serverProc = null;
let win = null;
let splash = null;
let pgStarted = false;
const logs = [];
// Persistent diagnostic log — survives a crash, so the owner (or support) can see
// exactly what happened on a shop PC. Lives next to the config in %APPDATA%.
const LOG_FILE = path.join(app.getPath("userData"), "desktop.log");
try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); fs.writeFileSync(LOG_FILE, `\n===== SoftGlaze desktop start ${new Date().toISOString()} (packaged=${isPackaged}) =====\n`); } catch { /* best effort */ }
// A packaged GUI app has no console. Writes to a closed stdout pipe raise an
// ASYNC 'error' (EPIPE) that would otherwise become an uncaughtException — so we
// swallow stream errors and stop writing to stdout once it breaks. All logging
// still goes to the file. The crash handlers write to the FILE only (never back
// through stdout) so a broken pipe can never spiral into a write loop.
let stdoutOk = true;
try { process.stdout.on("error", () => { stdoutOk = false; }); } catch { /* ignore */ }
try { process.stderr.on("error", () => {}); } catch { /* ignore */ }
const fileLog = (s) => { try { fs.appendFileSync(LOG_FILE, String(s)); } catch { /* best effort */ } };
const log = (s) => {
  const str = String(s);
  logs.push(str); if (logs.length > 400) logs.shift();
  if (stdoutOk) { try { process.stdout.write(str); } catch { stdoutOk = false; } }
  fileLog(str);
};
process.on("uncaughtException", (e) => { if (e && e.code === "EPIPE") return; fileLog(`\n[uncaughtException] ${(e && e.stack) || e}\n`); });
process.on("unhandledRejection", (e) => { fileLog(`\n[unhandledRejection] ${(e && e.stack) || e}\n`); });

/**
 * Pick a port we can actually bind, starting at the preferred one.
 *
 * The port used to be hard-coded. If anything else already held it (a dev server,
 * another copy of the app, an unrelated tool) our server died with EADDRINUSE —
 * but waitForHealth then got a perfectly good 200 from the STRANGER on that port,
 * so the window opened on someone else's server and rendered its raw JSON instead
 * of the shop. Probing first makes startup immune to whatever else is running.
 *
 * The probe calls listen(port) with NO host — byte-for-byte the same call shape the
 * server makes (app.listen(PORT)), so it resolves to the same dual-stack `::` bind.
 * Probing a different address family could report a port free that the server then
 * fails to claim.
 */
function findFreePort(start, tries = 25) {
  return new Promise((resolve, reject) => {
    let port = start;
    let left = tries;
    const attempt = () => {
      const probe = net.createServer();
      probe.once("error", () => {
        probe.close(() => {});
        if (--left <= 0) return reject(new Error(`No free port between ${start} and ${start + tries - 1}.`));
        port++;
        attempt();
      });
      probe.listen(port, () => probe.close(() => resolve(port)));
    };
    attempt();
  });
}

/**
 * First run: copy any bundled product/branding images into the writable uploads
 * dir. A data-preloaded (client) build ships the images that its initial-data.sql
 * references — without this the shop opens with every photo broken. Only fills in
 * files that aren't already there, so it's safe on every launch and never clobbers
 * anything the shop uploaded itself.
 */
function restoreBundledUploads() {
  const dest = path.join(app.getPath("userData"), "uploads");
  fs.mkdirSync(dest, { recursive: true });
  if (!fs.existsSync(BUNDLED_UPLOADS)) return;
  let copied = 0;
  const walk = (from, to) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); walk(src, dst); }
      else if (!fs.existsSync(dst)) { fs.copyFileSync(src, dst); copied++; }
    }
  };
  try {
    walk(BUNDLED_UPLOADS, dest);
    if (copied) log(`[uploads] restored ${copied} bundled file(s)\n`);
  } catch (e) {
    log(`[uploads] restore failed: ${e.message}\n`); // non-fatal — the shop still opens
  }
}

/** Editable config in %APPDATA%/SoftGlaze/softglaze.config.json */
function loadConfig() {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "softglaze.config.json");
  let cfg = {};
  if (fs.existsSync(file)) { try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* keep defaults */ } }
  let changed = false;
  if (cfg.embeddedDb === undefined) { cfg.embeddedDb = true; changed = true; }
  if (!cfg.jwtSecret) { cfg.jwtSecret = crypto.randomBytes(32).toString("hex"); changed = true; }
  if (!cfg.jwtRefreshSecret) { cfg.jwtRefreshSecret = crypto.randomBytes(32).toString("hex"); changed = true; }
  if (cfg.embeddedDb) {
    // Private, offline PostgreSQL bundled with the app.
    if (!cfg.dbPort) { cfg.dbPort = 55432; changed = true; }
    if (!cfg.dbPassword) { cfg.dbPassword = crypto.randomBytes(12).toString("hex"); changed = true; }
    const url = `postgresql://softglaze:${cfg.dbPassword}@127.0.0.1:${cfg.dbPort}/softglaze?schema=public`;
    if (cfg.databaseUrl !== url) { cfg.databaseUrl = url; changed = true; }
  } else if (!cfg.databaseUrl) {
    cfg.databaseUrl = process.env.DATABASE_URL || "postgresql://softglaze:softglaze_dev@localhost:5432/softglaze?schema=public";
    changed = true;
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return cfg;
}

/** env for Prisma CLI / seed / server (drops undefined keys so spawn stays clean). */
function nodeEnv(cfg, extra) {
  const e = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    NODE_PATH: NODE_MODULES,
    DATABASE_URL: cfg.databaseUrl,
    PRISMA_QUERY_ENGINE_LIBRARY: fs.existsSync(QUERY_ENGINE) ? QUERY_ENGINE : undefined,
    PRISMA_SCHEMA_ENGINE_BINARY: fs.existsSync(SCHEMA_ENGINE) ? SCHEMA_ENGINE : undefined,
    ...extra,
  };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}

/**
 * Run a bundled tool synchronously, capturing output into the log ring.
 * `capture=false` uses NUL stdio instead of pipes — REQUIRED for `pg_ctl start`,
 * whose `postgres` grandchild inherits and holds the stdout pipe open for its
 * whole lifetime, which would otherwise block spawnSync forever (its own output
 * still goes to the `-l` logfile).
 */
function runTool(label, exe, args, env, capture = true) {
  log(`\n[${label}] ${path.basename(exe)} ${args.join(" ")}\n`);
  const opts = { env, windowsHide: true };
  if (capture) opts.encoding = "utf8"; else opts.stdio = "ignore";
  const r = spawnSync(exe, args, opts);
  if (capture) { if (r.stdout) log(r.stdout); if (r.stderr) log(r.stderr); }
  if (r.error) log(`[${label} error] ${r.error.message}\n`);
  return r;
}

/**
 * First-run + every-run database bootstrap for the bundled PostgreSQL.
 * Idempotent: initdb/createdb/seed run once (guarded), migrate deploy runs every
 * launch (a no-op when already up to date). Throws on any hard failure.
 */
function ensureDatabase(cfg) {
  if (!cfg.embeddedDb) return; // external DB — the shop manages it, nothing to do here.

  fs.mkdirSync(path.dirname(PG_DATA), { recursive: true });
  const initialized = fs.existsSync(path.join(PG_DATA, "PG_VERSION"));

  // 1) initdb (first run)
  if (!initialized) {
    const pwfile = path.join(app.getPath("userData"), "pg_init_pw.txt");
    fs.writeFileSync(pwfile, cfg.dbPassword, "utf8");
    const r = runTool("initdb", path.join(PG_BIN, "initdb.exe"),
      ["-D", PG_DATA, "-U", "softglaze", "-E", "UTF8", "--locale=C",
        "--auth-host=scram-sha-256", "--auth-local=trust", `--pwfile=${pwfile}`], process.env);
    try { fs.unlinkSync(pwfile); } catch { /* best effort */ }
    if (r.status !== 0) throw new Error("Could not create the local database (initdb failed).");
  }

  // 2) start (skip if already running)
  const status = runTool("pg-status", path.join(PG_BIN, "pg_ctl.exe"), ["-D", PG_DATA, "status"], process.env);
  if (status.status !== 0) {
    // capture=false: postgres would otherwise inherit + hold the stdout pipe → spawnSync never returns.
    const r = runTool("pg-start", path.join(PG_BIN, "pg_ctl.exe"),
      ["-D", PG_DATA, "-l", PG_LOG, "-o", `-p ${cfg.dbPort} -c listen_addresses=127.0.0.1`, "-w", "start"], process.env, false);
    if (r.status !== 0) { try { log(fs.readFileSync(PG_LOG, "utf8").slice(-2000)); } catch {} throw new Error("Could not start the local database service."); }
    log("[pg-start] started\n");
  }
  pgStarted = true;

  // 3) createdb (first run) — ignore "already exists"
  if (!initialized) {
    runTool("createdb", path.join(PG_BIN, "createdb.exe"),
      ["-h", "127.0.0.1", "-p", String(cfg.dbPort), "-U", "softglaze", "softglaze"],
      { ...process.env, PGPASSWORD: cfg.dbPassword });
  }

  // 3b) first run only: if this build ships a data snapshot (a client-specific
  //     installer), load it instead of seeding an empty shop. The snapshot is a full
  //     pg_dump (schema + data + migration history), so the migrate-deploy below is a
  //     no-op and the generic seed is skipped.
  if (!initialized && fs.existsSync(INITIAL_DATA)) {
    const r = runTool("initial-data", path.join(PG_BIN, "psql.exe"),
      ["-h", "127.0.0.1", "-p", String(cfg.dbPort), "-U", "softglaze", "-d", "softglaze",
        "-v", "ON_ERROR_STOP=1", "-q", "-f", INITIAL_DATA],
      { ...process.env, PGPASSWORD: cfg.dbPassword });
    if (r.status !== 0) throw new Error("Could not load the initial data snapshot.");
    try { fs.writeFileSync(SEED_MARKER, new Date().toISOString()); } catch { /* best effort */ }
    log("[initial-data] loaded bundled data snapshot\n");
  }

  // 4) migrate deploy (always; idempotent)
  const env = nodeEnv(cfg);
  const mig = runTool("migrate", process.execPath, [PRISMA_CLI, "migrate", "deploy", "--schema", SCHEMA_PATH], env);
  if (mig.status !== 0) throw new Error("Database migration failed.");

  // 5) seed defaults (first run only)
  if (!fs.existsSync(SEED_MARKER)) {
    const sd = runTool("seed", process.execPath, [SEED_ENTRY], env);
    if (sd.status !== 0) throw new Error("Database seeding failed.");
    try { fs.writeFileSync(SEED_MARKER, new Date().toISOString()); } catch { /* best effort */ }
  }
}

function stopDatabase() {
  if (!pgStarted) return;
  try { spawnSync(path.join(PG_BIN, "pg_ctl.exe"), ["-D", PG_DATA, "-m", "fast", "stop"], { windowsHide: true, timeout: 15000 }); } catch { /* ignore */ }
}

function startServer(cfg) {
  const uploadsDir = path.join(app.getPath("userData"), "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });

  serverProc = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: path.dirname(SERVER_ENTRY),
    env: nodeEnv(cfg, {
      PORT: String(PORT),
      SERVE_WEB: "1",
      WEB_DIST,
      UPLOAD_DIR: uploadsDir,
      JWT_SECRET: cfg.jwtSecret,
      JWT_REFRESH_SECRET: cfg.jwtRefreshSecret,
      CORS_ORIGIN: BASE,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stdout.on("data", log);
  serverProc.stderr.on("data", log);
  serverProc.on("exit", (code) => {
    log(`\n[server exited: ${code}]`);
    if (!app.isQuitting && code !== 0) {
      dialog.showErrorBox("SoftGlaze — server stopped", `The background service stopped.\n\nLast messages:\n${logs.slice(-15).join("")}`);
    }
  });
}

function waitForHealth(cb, deadline = Date.now() + 45000) {
  const req = http.get(`${BASE}/api/v1/health`, (res) => {
    res.resume();
    if (res.statusCode === 200) return cb();
    retry();
  });
  req.on("error", retry);
  req.setTimeout(1500, () => req.destroy());
  function retry() {
    if (Date.now() > deadline) {
      dialog.showErrorBox("SoftGlaze — couldn't start", `The app service didn't come up in time.\n\nLast messages:\n${logs.slice(-15).join("")}`);
      return app.quit();
    }
    setTimeout(() => waitForHealth(cb, deadline), 500);
  }
}

/** Tiny frameless splash while the first-run DB setup / server boot happens. */
function showSplash() {
  splash = new BrowserWindow({
    width: 420, height: 240, frame: false, resizable: false, center: true,
    backgroundColor: "#101418", show: true, alwaysOnTop: true,
    webPreferences: { contextIsolation: true },
  });
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;font-family:Segoe UI,system-ui,sans-serif;background:#101418;color:#e8eef4;overflow:hidden}
    .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
    .logo{width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#f97316,#ea580c);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px;color:#fff}
    .t{font-weight:700;font-size:17px}.s{font-size:12.5px;color:#9fb0c0}
    .bar{width:180px;height:4px;border-radius:4px;background:#233;overflow:hidden;margin-top:4px}
    .bar i{display:block;height:100%;width:40%;background:#f97316;animation:m 1.1s ease-in-out infinite}
    @keyframes m{0%{margin-left:-40%}100%{margin-left:100%}}
  </style><div class="wrap"><div class="logo">S</div><div class="t">SoftGlaze Stock Manager</div>
    <div class="s">Starting up… first run may take a minute</div><div class="bar"><i></i></div></div>`;
  splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
}
function closeSplash() { if (splash) { try { splash.close(); } catch {} splash = null; } }

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#101418",
    title: "SoftGlaze Stock Manager",
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, "preload.cjs") },
  });
  Menu.setApplicationMenu(null);
  win.once("ready-to-show", () => { closeSplash(); win.show(); });

  // wa.me / http links open in the real browser; blank print windows stay in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: "deny" }; }
    return { action: "allow" };
  });

  win.loadURL(DEV ? "http://localhost:5173" : BASE);
}

// Single instance — focus the existing window instead of opening a second app
if (!app.requestSingleInstanceLock()) {
  log("[single-instance] another instance holds the lock — exiting\n");
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(async () => {
    log("app ready\n");
    if (DEV) { createWindow(); return; }
    showSplash();
    try {
      // Claim a port BEFORE anything else, so the window can never end up pointed
      // at a foreign server that happens to be sitting on our preferred one.
      PORT = await findFreePort(PORT);
      BASE = `http://localhost:${PORT}`;
      log(`[port] serving on ${PORT}\n`);
      const cfg = loadConfig();
      ensureDatabase(cfg);
      restoreBundledUploads();
      startServer(cfg);
    } catch (e) {
      closeSplash();
      dialog.showErrorBox("SoftGlaze — setup failed", `${e.message}\n\nConfig / logs:\n${path.join(app.getPath("userData"), "softglaze.config.json")}\n\nLast messages:\n${logs.slice(-20).join("")}`);
      return app.quit();
    }
    waitForHealth(createWindow);
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on("before-quit", () => { app.isQuitting = true; });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("quit", () => {
  try { serverProc && serverProc.kill(); } catch { /* ignore */ }
  if (!DEV) stopDatabase();
});
