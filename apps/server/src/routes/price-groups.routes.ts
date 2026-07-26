/**
 * Customer price groups (F6). A group is a pricing tier (Retail / Contractor / Dealer /
 * custom): a blanket % off the list sale price plus optional per-product absolute
 * overrides. The POS auto-applies the assigned customer's group price. This only
 * pre-fills the POS — the sale still stores the posted unitPrice snapshot, so past
 * bills never change when a group's rates are edited.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

const WRITE_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;
const money = (v: number) => new Prisma.Decimal(v).toDecimalPlaces(2);

const groupInclude = {
  items: { include: { product: { select: { id: true, name: true, sku: true, salePrice: true } } } },
  _count: { select: { customers: true } },
} satisfies Prisma.PriceGroupInclude;

/** GET /price-groups — pricing tiers with their overrides + customer counts. */
router.get("/", async (_req, res, next) => {
  try {
    const groups = await prisma.priceGroup.findMany({ where: { isActive: true }, include: groupInclude, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    res.json({ ok: true, data: { groups } });
  } catch (err) {
    next(err);
  }
});

/** GET /price-groups/:id — one group with its product overrides (used by the POS). */
router.get("/:id", async (req, res, next) => {
  try {
    const group = await prisma.priceGroup.findUnique({ where: { id: req.params.id }, include: groupInclude });
    if (!group) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Price group not found" } });
    res.json({ ok: true, data: { group } });
  } catch (err) {
    next(err);
  }
});

const itemSchema = z.object({ productId: z.string().min(1), price: z.coerce.number().min(0, "Price cannot be negative") });
const groupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  discountPercent: z.coerce.number().min(0).max(100, "Discount is a percent (0–100)").default(0),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
  items: z.array(itemSchema).default([]),
});

async function assertProductsExist(ids: string[], res: any): Promise<boolean> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return true;
  const count = await prisma.product.count({ where: { id: { in: uniq } } });
  if (count !== uniq.length) {
    res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "One of the products was not found" } });
    return false;
  }
  return true;
}

/** POST /price-groups — create a pricing tier. */
router.post("/", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = groupSchema.parse(req.body);
    if (!(await assertProductsExist(body.items.map((i) => i.productId), res))) return;
    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.priceGroup.create({
        data: {
          name: body.name, discountPercent: money(body.discountPercent), sortOrder: body.sortOrder, isActive: body.isActive,
          items: { create: body.items.map((it) => ({ productId: it.productId, price: money(it.price) })) },
        },
        include: groupInclude,
      });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "CREATE_PRICE_GROUP", entity: "PriceGroup", entityId: created.id, details: `${created.name} · ${body.discountPercent}% · ${body.items.length} overrides` } });
      return created;
    });
    res.status(201).json({ ok: true, data: { group } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err?.code === "P2002") return res.status(409).json({ ok: false, error: { code: "CONFLICT", message: "A group with that name already exists" } });
    next(err);
  }
});

/** PATCH /price-groups/:id — update the tier and replace its overrides. */
router.patch("/:id", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = groupSchema.parse(req.body);
    const existing = await prisma.priceGroup.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Price group not found" } });
    if (!(await assertProductsExist(body.items.map((i) => i.productId), res))) return;
    const group = await prisma.$transaction(async (tx) => {
      await tx.priceGroupItem.deleteMany({ where: { priceGroupId: req.params.id } });
      const updated = await tx.priceGroup.update({
        where: { id: req.params.id },
        data: {
          name: body.name, discountPercent: money(body.discountPercent), sortOrder: body.sortOrder, isActive: body.isActive,
          items: { create: body.items.map((it) => ({ productId: it.productId, price: money(it.price) })) },
        },
        include: groupInclude,
      });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "UPDATE_PRICE_GROUP", entity: "PriceGroup", entityId: updated.id, details: `${updated.name} · ${body.discountPercent}% · ${body.items.length} overrides` } });
      return updated;
    });
    res.json({ ok: true, data: { group } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err?.code === "P2002") return res.status(409).json({ ok: false, error: { code: "CONFLICT", message: "A group with that name already exists" } });
    next(err);
  }
});

/** DELETE /price-groups/:id — remove a tier (assigned customers fall back to list price). */
router.delete("/:id", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const existing = await prisma.priceGroup.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Price group not found" } });
    await prisma.priceGroup.delete({ where: { id: req.params.id } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "DELETE_PRICE_GROUP", entity: "PriceGroup", entityId: existing.id, details: existing.name } });
    res.json({ ok: true, data: { message: "Deleted" } });
  } catch (err) {
    next(err);
  }
});

export default router;
