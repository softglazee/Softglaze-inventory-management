/**
 * Prepares a customer's pg_dump for use as a data-preloaded build's initial-data.sql.
 *
 *   node scripts/prepare-client-data.cjs <input.sql> <output.sql> [--keep-images]
 *
 * By default it removes every product-image row and the shop-logo settings. That is
 * deliberate: the database stores image PATHS, and unless the matching files are also
 * staged in apps/server/uploads/ the shop opens with a broken-image icon on every
 * product. Stripping the references instead gives clean placeholder icons, and the
 * owner can upload real photos from Products → edit → images whenever they like.
 *
 * Pass --keep-images when you HAVE staged the matching files and want them preserved.
 */
const fs = require("fs");

const [, , input, output, ...flags] = process.argv;
if (!input || !output) {
  console.error("usage: node scripts/prepare-client-data.cjs <input.sql> <output.sql> [--keep-images]");
  process.exit(1);
}
const keepImages = flags.includes("--keep-images");

const lines = fs.readFileSync(input, "utf8").split(/\r?\n/);
const out = [];

// Images live in FOUR places, not just on products. Missing any one of them leaves
// broken-image icons somewhere in the shop.
const DROP_SETTING_KEYS = new Set(["shop_logo", "shop_logo_thumb"]);
const NULL_COLUMN_TABLES = { Category: "image", Brand: "image", User: "avatar" };

let mode = null;        // 'rows' (drop every row) | 'setting' | {table, colIndex}
let droppedImages = 0;
let droppedSettings = 0;
const nulled = {};

for (const line of lines) {
  if (mode === null) {
    let m;
    if (!keepImages && /^COPY public\."ProductImage" .*FROM stdin;$/.test(line)) {
      mode = "rows"; out.push(line); continue;
    }
    if (!keepImages && /^COPY public\."Setting" .*FROM stdin;$/.test(line)) {
      mode = "setting"; out.push(line); continue;
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
    const key = line.split("\t")[0];
    if (DROP_SETTING_KEYS.has(key)) { droppedSettings++; continue; }
    out.push(line);
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
for (const [t, n] of Object.entries(nulled)) console.log(`[client-data]   ${t}.image/avatar cleared    : ${n}`);
console.log(`[client-data]   /uploads/ references left  : ${remaining}${remaining ? "  <-- CHECK THESE" : "  (clean)"}`);
console.log(`[client-data] wrote ${output}`);
if (!keepImages && remaining) {
  console.error("[client-data] FAILED: image references survived — the shop would show broken images");
  process.exit(1);
}
