import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { imageUpload, saveImage, deleteImageFiles } from "../lib/upload";
import { nextSku } from "../utils/sku";
import { logPriceChange } from "../lib/price-history";

const router = Router();
router.use(requireAuth);

const WRITE_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;

const money = z.coerce.number().min(0, "Cannot be negative");
const qty = z.coerce.number().min(0, "Cannot be negative");
const dim = z.coerce.number().min(0).nullable().optional(); // dimensions/weight (G10)

const comboItemSchema = z.object({
  componentProductId: z.string().min(1),
  qty: z.coerce.number().positive("Combo quantities must be greater than 0"),
});

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  sku: z.string().trim().max(30).optional(), // omitted → auto CEM-0001
  barcode: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  type: z.enum(["STANDARD", "SERVICE", "COMBO"]).default("STANDARD"), // G3
  categoryId: z.string().min(1, "Category is required"),
  unitId: z.string().min(1, "Unit is required"),
  brandId: z.string().nullable().optional(), // G2
  costPrice: money.default(0),
  salePrice: money.default(0),
  wholesalePrice: money.nullable().optional(),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  minStockLevel: qty.default(0),
  // Dimensions (G10)
  length: dim,
  width: dim,
  height: dim,
  weight: dim,
  // Weight calculator profile (C1) — rods/sheets sold by weight
  weightCalc: z.enum(["NONE", "ROD", "SHEET"]).optional(),
  diameterMm: dim,
  thicknessMm: dim,
  sheetWidthFt: dim,
  pieceLengthFt: dim,
  densityKgM3: dim,
  openingStock: qty.default(0), // creates an OPENING stock movement (STANDARD only)
  comboItems: z.array(comboItemSchema).max(50).optional(), // G3 combo components
});

const updateSchema = createSchema.omit({ openingStock: true }).partial().extend({
  isActive: z.boolean().optional(),
});

const productInclude = {
  category: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true, shortName: true } },
  brand: { select: { id: true, name: true } },
  images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] },
  comboItems: {
    include: {
      componentProduct: { select: { id: true, name: true, sku: true, unit: { select: { shortName: true } } } },
    },
  },
} satisfies Prisma.ProductInclude;

/**
 * Validates combo component references (exist, no duplicates, no nested combos,
 * not self). Returns a ready error response payload or null when valid.
 */
async function validateComboItems(
  items: { componentProductId: string; qty: number }[],
  selfId?: string
): Promise<{ status: number; code: string; message: string } | null> {
  if (items.length === 0) return { status: 400, code: "VALIDATION", message: "A combo needs at least one component product" };
  const ids = items.map((c) => c.componentProductId);
  if (new Set(ids).size !== ids.length) return { status: 400, code: "VALIDATION", message: "A combo cannot list the same product twice" };
  if (selfId && ids.includes(selfId)) return { status: 400, code: "VALIDATION", message: "A combo cannot contain itself" };
  const comps = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, type: true } });
  if (comps.length !== ids.length) return { status: 404, code: "NOT_FOUND", message: "One of the combo components was not found" };
  if (comps.some((c) => c.type === "COMBO")) return { status: 400, code: "VALIDATION", message: "A combo cannot contain another combo" };
  return null;
}

/** GET /products?page&limit&search&categoryId&status=active|inactive|low|out */
router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search ?? "").trim();
    const categoryId = String(req.query.categoryId ?? "");
    const brandId = String(req.query.brandId ?? "");
    const type = String(req.query.type ?? "");
    const status = String(req.query.status ?? "");

    const where: Prisma.ProductWhereInput = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;
    if (type === "STANDARD" || type === "SERVICE" || type === "COMBO") where.type = type;
    if (status === "active") where.isActive = true;
    if (status === "inactive") where.isActive = false;
    if (status === "out") where.stockQty = { lte: 0 };
    if (status === "low") {
      where.isActive = true;
      where.minStockLevel = { gt: 0 };
      // stockQty <= minStockLevel — column comparison needs raw filter below
    }

    let products;
    let total;
    if (status === "low") {
      // Prisma cannot compare two columns in a plain where — fetch ids via raw SQL
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Product"
        WHERE "isActive" = true AND "minStockLevel" > 0 AND "stockQty" <= "minStockLevel"`;
      const ids = rows.map((r) => r.id);
      where.id = { in: ids };
      delete where.minStockLevel;
      [products, total] = await Promise.all([
        prisma.product.findMany({ where, include: productInclude, orderBy: { name: "asc" }, skip: (page - 1) * limit, take: limit }),
        prisma.product.count({ where }),
      ]);
    } else {
      [products, total] = await Promise.all([
        prisma.product.findMany({ where, include: productInclude, orderBy: { name: "asc" }, skip: (page - 1) * limit, take: limit }),
        prisma.product.count({ where }),
      ]);
    }

    res.json({ ok: true, data: { products, total, page, pages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) {
    next(err);
  }
});

/** GET /products/low-stock — active products at/below their minimum */
router.get("/low-stock", async (_req, res, next) => {
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Product"
      WHERE "isActive" = true AND "minStockLevel" > 0 AND "stockQty" <= "minStockLevel"`;
    const products = await prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: productInclude,
      orderBy: { name: "asc" },
    });
    res.json({ ok: true, data: { products } });
  } catch (err) {
    next(err);
  }
});

/** GET /products/search?q= — fast POS search (name / SKU / barcode) */
router.get("/search", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json({ ok: true, data: { products: [] } });
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { barcode: q },
        ],
      },
      include: productInclude,
      take: 20,
      orderBy: { name: "asc" },
    });
    res.json({ ok: true, data: { products } });
  } catch (err) {
    next(err);
  }
});

/** GET /products/:id */
router.get("/:id", async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id }, include: productInclude });
    if (!product) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Product not found" } });
    }
    res.json({ ok: true, data: { product } });
  } catch (err) {
    next(err);
  }
});

/** POST /products — create (+ optional opening stock, atomically via the ledger) */
router.post("/", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const category = await prisma.category.findUnique({ where: { id: body.categoryId } });
    if (!category) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Category not found" } });
    }
    const unit = await prisma.unit.findUnique({ where: { id: body.unitId } });
    if (!unit) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Unit not found" } });
    }
    if (body.brandId) {
      const brand = await prisma.brand.findUnique({ where: { id: body.brandId } });
      if (!brand) {
        return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Brand not found" } });
      }
    }

    // SERVICE + COMBO products don't track their own stock (rule 4 / G3).
    const isCombo = body.type === "COMBO";
    const isService = body.type === "SERVICE";
    const comboItems = isCombo ? body.comboItems ?? [] : [];
    if (isCombo) {
      const err = await validateComboItems(comboItems);
      if (err) return res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message } });
    }
    const openingStock = isService || isCombo ? 0 : body.openingStock;

    const product = await prisma.$transaction(async (tx) => {
      const sku = body.sku || (await nextSku(tx, category.name));
      const created = await tx.product.create({
        data: {
          sku,
          name: body.name,
          barcode: body.barcode || null,
          description: body.description || null,
          type: body.type,
          categoryId: body.categoryId,
          unitId: body.unitId,
          brandId: body.brandId ?? null,
          costPrice: body.costPrice,
          salePrice: body.salePrice,
          wholesalePrice: body.wholesalePrice ?? null,
          taxPercent: body.taxPercent,
          minStockLevel: body.minStockLevel,
          length: body.length ?? null,
          width: body.width ?? null,
          height: body.height ?? null,
          weight: body.weight ?? null,
          weightCalc: body.weightCalc ?? "NONE",
          diameterMm: body.diameterMm ?? null,
          thicknessMm: body.thicknessMm ?? null,
          sheetWidthFt: body.sheetWidthFt ?? null,
          pieceLengthFt: body.pieceLengthFt ?? null,
          densityKgM3: body.densityKgM3 ?? null,
          stockQty: openingStock,
        },
      });
      if (openingStock > 0) {
        await tx.stockMovement.create({
          data: {
            productId: created.id,
            type: "OPENING",
            qty: openingStock,
            unitCost: body.costPrice,
            refType: "OPENING",
            balance: openingStock,
            notes: "Opening stock at product creation",
          },
        });
      }
      if (isCombo && comboItems.length > 0) {
        await tx.comboItem.createMany({
          data: comboItems.map((c) => ({ comboProductId: created.id, componentProductId: c.componentProductId, qty: c.qty })),
        });
      }
      await logPriceChange(tx, { productId: created.id, costPrice: body.costPrice, salePrice: body.salePrice, source: "CREATE", userId: req.user!.id });
      await tx.auditLog.create({
        data: { userId: req.user!.id, action: "CREATE_PRODUCT", entity: "Product", entityId: created.id, details: `${sku} ${created.name}` },
      });
      return created;
    });

    const withRelations = await prisma.product.findUnique({ where: { id: product.id }, include: productInclude });
    res.status(201).json({ ok: true, data: { product: withRelations } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    if (err?.code === "P2002") {
      return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: "A product with this SKU or barcode already exists" } });
    }
    next(err);
  }
});

/** PATCH /products/:id — stockQty is NEVER editable here (ledger owns it) */
router.patch("/:id", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Product not found" } });
    }
    if (body.categoryId) {
      const category = await prisma.category.findUnique({ where: { id: body.categoryId } });
      if (!category) {
        return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Category not found" } });
      }
    }
    if (body.unitId) {
      const unit = await prisma.unit.findUnique({ where: { id: body.unitId } });
      if (!unit) {
        return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Unit not found" } });
      }
    }
    if (body.brandId) {
      const brand = await prisma.brand.findUnique({ where: { id: body.brandId } });
      if (!brand) {
        return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Brand not found" } });
      }
    }
    const finalType = body.type ?? existing.type;
    let replaceCombo = false;
    if (finalType === "COMBO" && body.comboItems !== undefined) {
      const cErr = await validateComboItems(body.comboItems, existing.id);
      if (cErr) return res.status(cErr.status).json({ ok: false, error: { code: cErr.code, message: cErr.message } });
      replaceCombo = true;
    }

    const product = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          sku: body.sku,
          barcode: body.barcode === undefined ? undefined : body.barcode || null,
          description: body.description === undefined ? undefined : body.description || null,
          type: body.type,
          categoryId: body.categoryId,
          unitId: body.unitId,
          brandId: body.brandId === undefined ? undefined : body.brandId || null,
          costPrice: body.costPrice,
          salePrice: body.salePrice,
          wholesalePrice: body.wholesalePrice === undefined ? undefined : body.wholesalePrice,
          taxPercent: body.taxPercent,
          minStockLevel: body.minStockLevel,
          length: body.length === undefined ? undefined : body.length,
          width: body.width === undefined ? undefined : body.width,
          height: body.height === undefined ? undefined : body.height,
          weight: body.weight === undefined ? undefined : body.weight,
          weightCalc: body.weightCalc === undefined ? undefined : body.weightCalc,
          diameterMm: body.diameterMm === undefined ? undefined : body.diameterMm,
          thicknessMm: body.thicknessMm === undefined ? undefined : body.thicknessMm,
          sheetWidthFt: body.sheetWidthFt === undefined ? undefined : body.sheetWidthFt,
          pieceLengthFt: body.pieceLengthFt === undefined ? undefined : body.pieceLengthFt,
          densityKgM3: body.densityKgM3 === undefined ? undefined : body.densityKgM3,
          isActive: body.isActive,
        },
      });
      // Combo membership: clear when no longer a combo, replace when new list given
      if (finalType !== "COMBO") {
        await tx.comboItem.deleteMany({ where: { comboProductId: existing.id } });
      } else if (replaceCombo) {
        await tx.comboItem.deleteMany({ where: { comboProductId: existing.id } });
        await tx.comboItem.createMany({
          data: body.comboItems!.map((c) => ({ comboProductId: existing.id, componentProductId: c.componentProductId, qty: c.qty })),
        });
      }
      // D1 — log the price snapshot only when cost or sale price actually changed.
      if (!new Prisma.Decimal(updated.costPrice).equals(existing.costPrice) || !new Prisma.Decimal(updated.salePrice).equals(existing.salePrice)) {
        await logPriceChange(tx, { productId: updated.id, costPrice: updated.costPrice, salePrice: updated.salePrice, source: "UPDATE", userId: req.user!.id });
      }
      await tx.auditLog.create({
        data: { userId: req.user!.id, action: "UPDATE_PRODUCT", entity: "Product", entityId: updated.id, details: `${updated.sku} ${updated.name}` },
      });
      return tx.product.findUnique({ where: { id: updated.id }, include: productInclude });
    });
    res.json({ ok: true, data: { product } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    if (err?.code === "P2002") {
      return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: "A product with this SKU or barcode already exists" } });
    }
    next(err);
  }
});

/** DELETE /products/:id — soft-deactivate when referenced, else hard delete */
router.delete("/:id", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        images: true,
        _count: { select: { saleItems: true, purchaseItems: true, stockMoves: true, adjustmentItems: true, usedInCombos: true } },
      },
    });
    if (!product) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Product not found" } });
    }
    const referenced =
      product._count.saleItems > 0 ||
      product._count.purchaseItems > 0 ||
      product._count.stockMoves > 0 ||
      product._count.adjustmentItems > 0 ||
      product._count.usedInCombos > 0;

    if (referenced) {
      await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });
      await prisma.auditLog.create({
        data: { userId: req.user!.id, action: "DEACTIVATE_PRODUCT", entity: "Product", entityId: product.id, details: product.name },
      });
      return res.json({
        ok: true,
        data: { message: `${product.name} has history, so it was deactivated (kept for old invoices)`, deactivated: true },
      });
    }

    await prisma.product.delete({ where: { id: product.id } });
    for (const img of product.images) await deleteImageFiles(img.path, img.thumbPath);
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "DELETE_PRODUCT", entity: "Product", entityId: product.id, details: product.name },
    });
    res.json({ ok: true, data: { message: `${product.name} deleted`, deactivated: false } });
  } catch (err) {
    next(err);
  }
});

/** POST /products/:id/images — multipart, up to 5 files, field "images" */
router.post("/:id/images", requireRole(...WRITE_ROLES), imageUpload.array("images", 5), async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { images: true } } },
    });
    if (!product) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Product not found" } });
    }
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "No image files received" } });
    }
    let hasPrimary = product._count.images > 0
      ? (await prisma.productImage.count({ where: { productId: product.id, isPrimary: true } })) > 0
      : false;
    const images = [];
    for (const [index, file] of files.entries()) {
      const saved = await saveImage(file.buffer, "products");
      const image = await prisma.productImage.create({
        data: {
          productId: product.id,
          path: saved.path,
          thumbPath: saved.thumbPath,
          isPrimary: !hasPrimary && index === 0,
          sortOrder: product._count.images + index,
        },
      });
      if (image.isPrimary) hasPrimary = true;
      images.push(image);
    }
    res.status(201).json({ ok: true, data: { images } });
  } catch (err) {
    next(err);
  }
});

/** PATCH /products/:id/images/:imageId/primary */
router.patch("/:id/images/:imageId/primary", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const image = await prisma.productImage.findFirst({ where: { id: req.params.imageId, productId: req.params.id } });
    if (!image) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Image not found" } });
    }
    await prisma.$transaction([
      prisma.productImage.updateMany({ where: { productId: image.productId }, data: { isPrimary: false } }),
      prisma.productImage.update({ where: { id: image.id }, data: { isPrimary: true } }),
    ]);
    res.json({ ok: true, data: { message: "Primary image updated" } });
  } catch (err) {
    next(err);
  }
});

/** DELETE /products/:id/images/:imageId */
router.delete("/:id/images/:imageId", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const image = await prisma.productImage.findFirst({ where: { id: req.params.imageId, productId: req.params.id } });
    if (!image) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Image not found" } });
    }
    await prisma.productImage.delete({ where: { id: image.id } });
    await deleteImageFiles(image.path, image.thumbPath);
    if (image.isPrimary) {
      const nextImage = await prisma.productImage.findFirst({
        where: { productId: image.productId },
        orderBy: { sortOrder: "asc" },
      });
      if (nextImage) await prisma.productImage.update({ where: { id: nextImage.id }, data: { isPrimary: true } });
    }
    res.json({ ok: true, data: { message: "Image deleted" } });
  } catch (err) {
    next(err);
  }
});

export default router;
