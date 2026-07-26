/**
 * Construction material estimator (F4) — the "sales weapon".
 * A template is a structure type (RCC slab, brick wall, grey structure per marla…) whose
 * rows are engineering coefficients mapped to REAL catalog products. Estimating multiplies
 * coefficient × (area × floors) and prices each line at the product's CURRENT sale price,
 * so numbers are always live. Nothing here touches money or stock — it only reads prices.
 * The quotation button on the client turns the result into a normal QUOTATION Sale.
 * Templates are edited by admins (rates differ by region/engineer).
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { ESTIMATOR_PRESETS } from "../data/estimator-presets";

const router = Router();
router.use(requireAuth);

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));

const WRITE_ROLES = ["SUPER_ADMIN", "ADMIN"] as const; // config-level: only admins tune the rates

const templateInclude = {
  items: {
    orderBy: { sortOrder: "asc" },
    include: { product: { select: { id: true, name: true, sku: true, salePrice: true, isActive: true, unit: { select: { shortName: true } } } } },
  },
} satisfies Prisma.EstimatorTemplateInclude;

/** GET /estimator/templates — active structure templates with their material rows + live prices. */
router.get("/templates", async (_req, res, next) => {
  try {
    const templates = await prisma.estimatorTemplate.findMany({ where: { isActive: true }, include: templateInclude, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    res.json({ ok: true, data: { templates } });
  } catch (err) {
    next(err);
  }
});

/** GET /estimator/presets — starter coefficient sets for the "New template" form. */
router.get("/presets", async (_req, res, next) => {
  try {
    res.json({ ok: true, data: { presets: ESTIMATOR_PRESETS } });
  } catch (err) {
    next(err);
  }
});

/** GET /estimator/templates/:id */
router.get("/templates/:id", async (req, res, next) => {
  try {
    const template = await prisma.estimatorTemplate.findUnique({ where: { id: req.params.id }, include: templateInclude });
    if (!template) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Template not found" } });
    res.json({ ok: true, data: { template } });
  } catch (err) {
    next(err);
  }
});

const itemSchema = z.object({
  productId: z.string().min(1, "Pick a product for each row"),
  qtyPerUnit: z.coerce.number().positive("Coefficient must be more than 0"),
  note: z.string().trim().max(120).nullable().optional(),
});
const templateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).nullable().optional(),
  areaLabel: z.string().trim().min(1).max(60).default("Area (sq ft)"),
  multiplyByFloors: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
  items: z.array(itemSchema).min(1, "Add at least one material row"),
});

async function assertProductsExist(ids: string[], res: any): Promise<boolean> {
  const uniq = [...new Set(ids)];
  const count = await prisma.product.count({ where: { id: { in: uniq } } });
  if (count !== uniq.length) {
    res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "One of the products was not found" } });
    return false;
  }
  return true;
}

/** POST /estimator/templates — create a structure template (admins only). */
router.post("/templates", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = templateSchema.parse(req.body);
    if (!(await assertProductsExist(body.items.map((i) => i.productId), res))) return;
    const template = await prisma.$transaction(async (tx) => {
      const created = await tx.estimatorTemplate.create({
        data: {
          name: body.name, description: body.description || null, areaLabel: body.areaLabel,
          multiplyByFloors: body.multiplyByFloors, sortOrder: body.sortOrder, isActive: body.isActive,
          items: { create: body.items.map((it, i) => ({ productId: it.productId, qtyPerUnit: new Prisma.Decimal(it.qtyPerUnit), note: it.note || null, sortOrder: i })) },
        },
        include: templateInclude,
      });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "CREATE_ESTIMATOR_TEMPLATE", entity: "EstimatorTemplate", entityId: created.id, details: `${created.name} · ${body.items.length} rows` } });
      return created;
    });
    res.status(201).json({ ok: true, data: { template } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err?.code === "P2002") return res.status(409).json({ ok: false, error: { code: "CONFLICT", message: "A template with that name already exists" } });
    next(err);
  }
});

/** PATCH /estimator/templates/:id — update meta and replace the material rows (admins only). */
router.patch("/templates/:id", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = templateSchema.parse(req.body);
    const existing = await prisma.estimatorTemplate.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Template not found" } });
    if (!(await assertProductsExist(body.items.map((i) => i.productId), res))) return;
    const template = await prisma.$transaction(async (tx) => {
      await tx.estimatorItem.deleteMany({ where: { templateId: req.params.id } });
      const updated = await tx.estimatorTemplate.update({
        where: { id: req.params.id },
        data: {
          name: body.name, description: body.description || null, areaLabel: body.areaLabel,
          multiplyByFloors: body.multiplyByFloors, sortOrder: body.sortOrder, isActive: body.isActive,
          items: { create: body.items.map((it, i) => ({ productId: it.productId, qtyPerUnit: new Prisma.Decimal(it.qtyPerUnit), note: it.note || null, sortOrder: i })) },
        },
        include: templateInclude,
      });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "UPDATE_ESTIMATOR_TEMPLATE", entity: "EstimatorTemplate", entityId: updated.id, details: `${updated.name} · ${body.items.length} rows` } });
      return updated;
    });
    res.json({ ok: true, data: { template } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err?.code === "P2002") return res.status(409).json({ ok: false, error: { code: "CONFLICT", message: "A template with that name already exists" } });
    next(err);
  }
});

/** DELETE /estimator/templates/:id — remove a template and its rows (admins only). */
router.delete("/templates/:id", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const existing = await prisma.estimatorTemplate.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Template not found" } });
    await prisma.estimatorTemplate.delete({ where: { id: req.params.id } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "DELETE_ESTIMATOR_TEMPLATE", entity: "EstimatorTemplate", entityId: existing.id, details: existing.name } });
    res.json({ ok: true, data: { message: "Deleted" } });
  } catch (err) {
    next(err);
  }
});

const estimateSchema = z.object({
  area: z.coerce.number().positive("Enter an area more than 0"),
  floors: z.coerce.number().int().positive().default(1),
});

/** POST /estimator/templates/:id/estimate — compute the live material list for an area × floors. */
router.post("/templates/:id/estimate", async (req, res, next) => {
  try {
    const body = estimateSchema.parse(req.body);
    const template = await prisma.estimatorTemplate.findUnique({ where: { id: req.params.id }, include: templateInclude });
    if (!template) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Template not found" } });
    const totalUnits = template.multiplyByFloors ? body.area * body.floors : body.area;
    const lines = template.items.map((it) => {
      const qty = round3(num(it.qtyPerUnit) * totalUnits);
      const unitPrice = round2(num(it.product.salePrice));
      const lineTotal = round2(qty * unitPrice);
      return {
        productId: it.productId,
        name: it.product.name,
        sku: it.product.sku,
        unit: it.product.unit?.shortName ?? "",
        active: it.product.isActive,
        note: it.note,
        qtyPerUnit: num(it.qtyPerUnit),
        qty,
        unitPrice,
        lineTotal,
      };
    });
    const grandTotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    res.json({
      ok: true,
      data: {
        template: { id: template.id, name: template.name, areaLabel: template.areaLabel, multiplyByFloors: template.multiplyByFloors },
        area: body.area, floors: body.floors, totalUnits: round3(totalUnits), lines, grandTotal,
      },
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

export default router;
