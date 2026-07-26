/**
 * Attach relevant free stock photos to products + categories that have none.
 *   npx tsx scripts/attach-images.ts          # only items missing an image
 *   npx tsx scripts/attach-images.ts --all     # re-image everything
 *
 * Pulls keyword-relevant Creative-Commons photos from LoremFlickr (picsum fallback),
 * runs them through the app's own image pipeline (saveImage → webp 1200px + 300px
 * thumbnail), then creates a primary ProductImage / sets Category.image. Non-destructive.
 */
import { PrismaClient } from "@prisma/client";
import { saveImage } from "../src/lib/upload";

const prisma = new PrismaClient();

/** Map a product/category name to a relevant image search keyword (building-materials shop). */
function keywordFor(text: string): string {
  const t = text.toLowerCase();
  if (/cement|concrete/.test(t)) return "cement,construction";
  if (/pipe|tube/.test(t)) return "steel,pipe,metal";
  if (/gard|gird|beam|joist|angle|channel/.test(t)) return "steel,beam,girder";
  if (/sheet|plate|coil/.test(t)) return "steel,sheet,metal";
  if (/tear|tor|sar|rod|bar|rebar|reinforce/.test(t)) return "steel,rebar,rod";
  if (/nut|bolt|nail|screw|washer|hardware|clamp|hinge/.test(t)) return "hardware,bolts,tools";
  if (/wire|mesh|net/.test(t)) return "steel,wire";
  if (/paint|primer/.test(t)) return "paint,cans";
  if (/brick|block/.test(t)) return "bricks,construction";
  if (/sand|gravel|aggregate|crush/.test(t)) return "sand,gravel";
  return "steel,metal,construction";
}

async function fetchImage(keywords: string, lock: number): Promise<Buffer | null> {
  const urls = [
    `https://loremflickr.com/640/640/${encodeURIComponent(keywords)}?lock=${lock}`,
    `https://picsum.photos/seed/mi${lock}/640/640`,
  ];
  for (const u of urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
        if (!r.ok) continue;
        if (!(r.headers.get("content-type") || "").startsWith("image/")) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 2000) return buf; // guard against tiny error pages
      } catch { /* retry, then fall through to the next url */ }
    }
  }
  return null;
}

async function main() {
  const reImageAll = process.argv.includes("--all");
  let lock = 100;
  let catDone = 0, catSkip = 0, prodDone = 0, prodSkip = 0;

  const cats = await prisma.category.findMany({ select: { id: true, name: true, image: true } });
  for (const c of cats) {
    if (!reImageAll && c.image) { catSkip++; continue; }
    const buf = await fetchImage(keywordFor(c.name), lock++);
    if (!buf) { console.log(`  cat  SKIP (no image) ${c.name}`); catSkip++; continue; }
    const saved = await saveImage(buf, "categories");
    await prisma.category.update({ where: { id: c.id }, data: { image: saved.thumbPath } });
    catDone++;
    console.log(`  cat  ok  ${c.name}`);
  }

  const prods = await prisma.product.findMany({ select: { id: true, name: true, category: { select: { name: true } }, images: { select: { id: true } } } });
  for (const p of prods) {
    if (!reImageAll && p.images.length > 0) { prodSkip++; continue; }
    const kw = keywordFor(`${p.name} ${p.category?.name ?? ""}`);
    const buf = await fetchImage(kw, lock++);
    if (!buf) { console.log(`  prod SKIP (no image) ${p.name}`); prodSkip++; continue; }
    const saved = await saveImage(buf, "products");
    await prisma.productImage.create({ data: { productId: p.id, path: saved.path, thumbPath: saved.thumbPath, isPrimary: true, sortOrder: 0 } });
    prodDone++;
    console.log(`  prod ok  ${p.name}  [${kw}]`);
  }

  console.log(`\nDone: categories ${catDone} imaged / ${catSkip} skipped · products ${prodDone} imaged / ${prodSkip} skipped.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
