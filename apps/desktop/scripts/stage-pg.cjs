/**
 * Stage a MINIMAL PostgreSQL runtime into apps/desktop/vendor/pgsql so
 * electron-builder can bundle it into the offline installer.
 *
 * We copy only bin + lib + share (~120 MB) — the full portable distribution is
 * ~800 MB because of pgAdmin/StackBuilder/docs, none of which the app needs.
 *
 * Source: SOFTGLAZE_PG_DIR, or the repo's portable pg at ../../../../pg/pgsql.
 * (A PostgreSQL 16 for Windows install works too — point SOFTGLAZE_PG_DIR at it.)
 */
const fs = require("fs");
const path = require("path");

const PG_SRC = process.env.SOFTGLAZE_PG_DIR || path.join(__dirname, "..", "..", "..", "..", "pg", "pgsql");
const DEST = path.join(__dirname, "..", "vendor", "pgsql");
const PARTS = ["bin", "lib", "share"];

if (!fs.existsSync(path.join(PG_SRC, "bin", "postgres.exe"))) {
  console.error(`\n[stage-pg] PostgreSQL not found at:\n  ${PG_SRC}\nSet SOFTGLAZE_PG_DIR to a PostgreSQL 16 (Windows) folder that contains bin/postgres.exe.\n`);
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
for (const part of PARTS) {
  const from = path.join(PG_SRC, part);
  if (!fs.existsSync(from)) { console.error(`[stage-pg] missing ${from}`); process.exit(1); }
  fs.cpSync(from, path.join(DEST, part), { recursive: true });
  console.log(`[stage-pg] staged ${part}`);
}
console.log(`[stage-pg] PostgreSQL runtime staged at ${DEST}`);
