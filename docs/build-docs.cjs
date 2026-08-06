/**
 * Builds docs/documentation.html — a SINGLE self-contained file.
 *
 *   docs/documentation.src.html   template with {{IMG:name}} placeholders
 *   docs/assets/<name>.png        source screenshots
 *          ↓
 *   docs/documentation.html       screenshots inlined as WebP data URIs
 *
 * Why inline: the built file is handed to buyers and copied into the CodeCanyon
 * bundle as Documentation/index.html. A single file can be moved, emailed or
 * opened from anywhere without breaking its images.
 *
 * Usage:  node docs/build-docs.cjs
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DOCS = __dirname;
const ASSETS = path.join(DOCS, "assets");
const SRC = path.join(DOCS, "documentation.src.html");
const OUT = path.join(DOCS, "documentation.html");

const MAX_WIDTH = 1500; // plenty for a 1440-wide capture on a HiDPI screen
const QUALITY = 78;

(async () => {
  if (!fs.existsSync(SRC)) throw new Error(`Missing template: ${SRC}`);
  let html = fs.readFileSync(SRC, "utf8");

  const names = [...html.matchAll(/\{\{IMG:([a-z0-9-]+)\}\}/gi)].map((m) => m[1]);
  const unique = [...new Set(names)];
  if (!unique.length) console.warn("[docs] no {{IMG:…}} placeholders found");

  let totalBytes = 0;
  for (const name of unique) {
    const file = path.join(ASSETS, `${name}.png`);
    if (!fs.existsSync(file)) throw new Error(`Missing screenshot: ${file}`);

    const webp = await sharp(file)
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();

    totalBytes += webp.length;
    const uri = `data:image/webp;base64,${webp.toString("base64")}`;
    html = html.split(`{{IMG:${name}}}`).join(uri);

    const before = fs.statSync(file).size;
    console.log(
      `[img] ${name.padEnd(22)} ${(before / 1024).toFixed(0).padStart(5)} KB png → ` +
        `${(webp.length / 1024).toFixed(0).padStart(5)} KB webp`
    );
  }

  // Single source of truth for the version — the docs can never drift from the build.
  const version = JSON.parse(fs.readFileSync(path.join(DOCS, "..", "package.json"), "utf8")).version;
  html = html.replace(/\{\{VERSION\}\}/g, version);
  html = html.replace(/\{\{BUILD_DATE\}\}/g, new Date().toISOString().slice(0, 10));
  console.log(`[docs] version ${version}`);

  fs.writeFileSync(OUT, html, "utf8");
  console.log(
    `\n[docs] ${path.relative(process.cwd(), OUT)} — ` +
      `${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB ` +
      `(${unique.length} images, ${(totalBytes / 1024 / 1024).toFixed(2)} MB of them)`
  );
})().catch((e) => {
  console.error("[docs] FAILED:", e.message);
  process.exit(1);
});
