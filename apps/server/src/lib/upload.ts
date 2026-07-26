import multer from "multer";
import sharp from "sharp";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";

// path.resolve (not join) so an absolute UPLOAD_DIR — e.g. the desktop app's
// %APPDATA%/SoftGlaze/uploads — is honoured as-is; a relative value still joins to cwd.
const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "uploads");

/** Multer instance for image uploads (memory → sharp → webp on disk) */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files (jpg, png, webp) are allowed"));
  },
});

/**
 * Persists an uploaded image as webp (max 1200px) + 300px thumbnail.
 * Returns web paths like /uploads/products/ab12cd34.webp
 */
export async function saveImage(buffer: Buffer, folder: string) {
  const dir = path.join(UPLOAD_ROOT, folder);
  await fs.mkdir(dir, { recursive: true });
  const name = crypto.randomBytes(8).toString("hex");

  await sharp(buffer)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(path.join(dir, `${name}.webp`));

  await sharp(buffer)
    .rotate()
    .resize({ width: 300, height: 300, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 75 })
    .toFile(path.join(dir, `${name}.thumb.webp`));

  return {
    path: `/uploads/${folder}/${name}.webp`,
    thumbPath: `/uploads/${folder}/${name}.thumb.webp`,
  };
}

/** Saves a 64×64 transparent PNG favicon; returns its web path. */
export async function saveFavicon(buffer: Buffer) {
  const dir = path.join(UPLOAD_ROOT, "branding");
  await fs.mkdir(dir, { recursive: true });
  const name = crypto.randomBytes(6).toString("hex");
  await sharp(buffer)
    .resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(dir, `${name}.png`));
  return `/uploads/branding/${name}.png`;
}

/** Best-effort removal of stored image files (never throws) */
export async function deleteImageFiles(...relPaths: (string | null | undefined)[]) {
  for (const rel of relPaths) {
    if (!rel) continue;
    const abs = path.join(process.cwd(), rel.replace(/^\//, ""));
    await fs.unlink(abs).catch(() => {});
  }
}
