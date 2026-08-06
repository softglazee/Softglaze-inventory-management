/**
 * Prepares a customer's pg_dump for use as a data-preloaded build's initial-data.sql.
 *
 *   node scripts/prepare-client-data.cjs <input.sql> <output.sql> [options]
 *
 *     --keep-images              keep image references (only when you have ALSO staged
 *                                the matching files in apps/server/uploads/)
 *     --shop-name "Name"         set the shop name the snapshot ships with
 *     --owner-password "secret"  set the SUPER_ADMIN's password (bcrypt, 12 rounds)
 *
 * By default it removes every image reference. That is deliberate: the database stores
 * image PATHS, and unless the matching files are staged too, the shop opens with a
 * broken-image icon on every tile. Clearing them gives clean placeholder icons, and the
 * owner uploads real photos from inside the app whenever they like.
 */
const fs = require("fs");

const argv = process.argv.slice(2);
const input = argv[0];
const output = argv[1];
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
if (!input || !output || input.startsWith("--") || output.startsWith("--")) {
  console.error('usage: node scripts/prepare-client-data.cjs <input.sql> <output.sql> [--keep-images] [--shop-name "Name"] [--owner-password "secret"]');
  process.exit(1);
}
const keepImages = argv.includes("--keep-images");
const shopName = flag("--shop-name");
const ownerPassword = flag("--owner-password");

let ownerHash = null;
if (ownerPassword) {
  if (ownerPassword.length < 8) {
    console.error("[client-data] owner password must be at least 8 characters — the app enforces that too");
    process.exit(1);
  }
  // same cost factor the application uses when it hashes a password itself
  ownerHash = require("bcryptjs").hashSync(ownerPassword, 12);
}

const lines = fs.readFileSync(input, "utf8").split(/\r?\n/);
const out = [];

// Images live in FOUR places, not just on products. Missing any one of them leaves
// broken-image icons somewhere in the shop.
const DROP_SETTING_KEYS = new Set(["shop_logo", "shop_logo_thumb"]);
// User is handled by its own branch below (it also needs password / session edits)
const NULL_COLUMN_TABLES = { Category: "image", Brand: "image" };

let mode = null;        // 'rows' (drop every row) | 'setting' | {table, colIndex} | 'user'
let droppedImages = 0;
let droppedSettings = 0;
let shopNameSet = 0;
let passwordsSet = 0;
let sessionsCleared = 0;
const nulled = {};
let userCols = null;    // column order of the User COPY block, when we need to edit it

for (const line of lines) {
  if (mode === null) {
    let m;
    if (!keepImages && /^COPY public\."ProductImage" .*FROM stdin;$/.test(line)) {
      mode = "rows"; out.push(line); continue;
    }
    if (/^COPY public\."Setting" .*FROM stdin;$/.test(line)) {
      mode = "setting"; out.push(line); continue;
    }
    // User rows always need a pass: stale refresh tokens go, avatar and password may change
    if ((m = line.match(/^COPY public\."User" \(([^)]*)\) FROM stdin;$/))) {
      userCols = m[1].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      mode = "user"; out.push(line); continue;
    }
    if (!keepImages && (m = line.match(/^COPY public\."(\w+)" \(([^)]*)\) FROM stdin;$/))) {
      const table = m[1];
      const col = NULL_COLUMN_TABLES[table];
      if (col) {
        // column list is comma-separated, names may be quoted
        const cols = m[2].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        const idx = cols.indexOf(col);
        if (idx >= 0) { mode = { table, idx }; nulled[table] = 0; out.push(line); continue; }
      }
    }
    out.push(line);
    continue;
  }

  // inside a COPY block: "\." on its own line ends it
  if (line === "\\.") { mode = null; out.push(line); continue; }

  if (mode === "rows") { droppedImages++; continue; }
  if (mode === "setting") {
    const parts = line.split("\t");
    const key = parts[0];
    if (!keepImages && DROP_SETTING_KEYS.has(key)) { droppedSettings++; continue; }
    if (shopName && key === "shop_name") { parts[1] = shopName; shopNameSet++; out.push(parts.join("\t")); continue; }
    out.push(line);
    continue;
  }
  if (mode === "user") {
    const parts = line.split("\t");
    const at = (name) => userCols.indexOf(name);
    // A stale refresh token from the machine the dump came from is useless to the new
    // install and is a credential — always clear it.
    if (at("refreshToken") >= 0 && parts[at("refreshToken")] !== "\\N") { parts[at("refreshToken")] = "\\N"; sessionsCleared++; }
    if (!keepImages && at("avatar") >= 0 && parts[at("avatar")] !== "\\N") {
      parts[at("avatar")] = "\\N"; nulled.User = (nulled.User || 0) + 1;
    }
    if (ownerHash && at("role") >= 0 && parts[at("role")] === "SUPER_ADMIN" && at("passwordHash") >= 0) {
      parts[at("passwordHash")] = ownerHash; passwordsSet++;
    }
    out.push(parts.join("\t"));
    continue;
  }
  // null out one column, preserving every other field exactly
  const fields = line.split("\t");
  if (fields[mode.idx] && fields[mode.idx] !== "\\N") { fields[mode.idx] = "\\N"; nulled[mode.table]++; }
  out.push(fields.join("\t"));
}

if (mode !== null) throw new Error(`Unterminated COPY block (${mode}) — refusing to write a corrupt dump`);

fs.writeFileSync(output, out.join("\n"), "utf8");

const remaining = (out.join("\n").match(/\/uploads\//g) || []).length;
console.log(`[client-data] ${input}`);
console.log(`[client-data]   product image rows removed : ${droppedImages}`);
console.log(`[client-data]   logo settings removed      : ${droppedSettings}`);
for (const [t, n] of Object.entries(nulled)) console.log(`[client-data]   ${t} image/avatar cleared     : ${n}`);
console.log(`[client-data]   stale sessions cleared     : ${sessionsCleared}`);
if (shopName)     console.log(`[client-data]   shop name set              : "${shopName}" (${shopNameSet} row)`);
if (ownerHash)    console.log(`[client-data]   owner password set         : ${passwordsSet} SUPER_ADMIN account(s)`);
console.log(`[client-data]   /uploads/ references left  : ${remaining}${remaining ? "  <-- CHECK THESE" : "  (clean)"}`);
console.log(`[client-data] wrote ${output}`);

let failed = false;
if (!keepImages && remaining) {
  console.error("[client-data] FAILED: image references survived — the shop would show broken images");
  failed = true;
}
if (shopName && shopNameSet !== 1) {
  console.error(`[client-data] FAILED: expected to set shop_name once, set it ${shopNameSet} times`);
  failed = true;
}
if (ownerHash && passwordsSet < 1) {
  console.error("[client-data] FAILED: no SUPER_ADMIN row found to set the password on");
  failed = true;
}
if (failed) process.exit(1);
