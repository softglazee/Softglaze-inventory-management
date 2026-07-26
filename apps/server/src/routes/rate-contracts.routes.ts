/**
 * Contractor rate contracts (C3). A customer negotiates fixed per-item rates that hold
 * for a date range; when they're on the POS, their contract rate auto-fills the sale line
 * for the covered products. Like price groups this ONLY pre-fills the POS — the sale still
 * stores the posted unitPrice snapshot, so editing/expiring a contract never changes past
 * bills. No money moves here, so it carries no accounting effect.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { nextNumber } from "../utils/counter";

const router = Router();
router.use(requireAuth);

const WRITE_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;
const money = (v: number) => new Prisma.Decimal(v).toDecimalPlaces(2);
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

const contractInclude = {
  customer: { select: { id: true, code: true, name: true, phone: true } },
  items: { include: { product: { select: { id: true, name: true, sku: true, salePrice: true, unit: { select: { shortName: true } } } } } },
} satisfies Prisma.RateContractInclude;

/** Add a computed `status` (upcoming | active | expired | inactive) for the UI. */
function withStatus<T extends { isActive: boolean; validFrom: Date; validUntil: Date }>(c: T) {
  const now = new Date();
  const status = !c.isActive ? "inactive" : now < startOfDay(c.validFrom) ? "upcoming" : now > endOfDay(c.validUntil) ? "expired" : "active";
  return { ...c, status };
}

const itemSchema = z.object({ productId: z.string().min(1), price: z.coerce.number().min(0, "Rate cannot be negative") });
const contractSchema = z
  .object({
    customerId: z.string().min(1, "Pick a customer"),
    name: z.string().trim().min(1, "Name is required").max(80),
    validFrom: z.coerce.date(),
    validUntil: z.coerce.date(),
    isActive: z.boolean().default(true),
    notes: z.string().trim().max(1000).nullable().optional(),
    items: z.array(itemSchema).min(1, "Add at least one product rate"),
  })
  .refine((b) => b.validUntil >= b.validFrom, { message: "Valid-until must be on or after valid-from", path: ["validUntil"] })
  .refine((b) => new Set(b.items.map((i) => i.productId)).size === b.items.length, { message: "The same product is listed twice", path: ["items"] });

async function assertRefs(customerId: string, productIds: string[], res: any): Promise<boolean> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) { res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Customer not found" } }); return false; }
  const uniq = [...new Set(productIds)];
  const count = await prisma.product.count({ where: { id: { in: uniq } } });
  if (count !== uniq.length) { res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "One of the products was not found" } }); return false; }
  return true;
}

/** GET /rate-contracts?customerId= — list contracts (newest first) with computed status. */
router.get("/", async (req, res, next) => {
  try {
    const customerId = String(req.query.customerId ?? "");
    const where: Prisma.RateContractWhereInput = customerId ? { customerId } : {};
    const contracts = await prisma.rateContract.findMany({ where, include: contractInclude, orderBy: { createdAt: "desc" } });
    res.json({ ok: true, data: { contracts: contracts.map(withStatus) } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /rate-contracts/rates/:customerId — resolve the rates in force TODAY for a customer.
 * Returns a product→price list plus the covering contract(s). Used by the POS to auto-fill
 * the sale line. When two active contracts cover the same product, the later-starting one wins.
 */
router.get("/rates/:customerId", async (req, res, next) => {
  try {
    const now = new Date();
    const active = await prisma.rateContract.findMany({
      where: { customerId: req.params.customerId, isActive: true, validFrom: { lte: now }, validUntil: { gte: now } },
      include: { items: true },
      orderBy: { validFrom: "asc" }, // later contracts overwrite earlier ones in the map below
    });
    const rateMap = new Map<string, number>();
    for (const c of active) for (const it of c.items) rateMap.set(it.productId, Number(it.price));
    const rates = [...rateMap.entries()].map(([productId, price]) => ({ productId, price }));
    const primary = active.length ? active[active.length - 1] : null;
    res.json({
      ok: true,
      data: {
        rates,
        count: active.length,
        primary: primary ? { id: primary.id, refNo: primary.refNo, name: primary.name, validFrom: primary.validFrom, validUntil: primary.validUntil } : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /rate-contracts/:id */
router.get("/:id", async (req, res, next) => {
  try {
    const contract = await prisma.rateContract.findUnique({ where: { id: req.params.id }, include: contractInclude });
    if (!contract) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Rate contract not found" } });
    res.json({ ok: true, data: { contract: withStatus(contract) } });
  } catch (err) {
    next(err);
  }
});

/** POST /rate-contracts — create a contract with its product rates. */
router.post("/", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = contractSchema.parse(req.body);
    if (!(await assertRefs(body.customerId, body.items.map((i) => i.productId), res))) return;
    const contract = await prisma.$transaction(async (tx) => {
      const refNo = await nextNumber(tx, "rate_contract", "RC");
      const created = await tx.rateContract.create({
        data: {
          refNo,
          customerId: body.customerId,
          name: body.name,
          validFrom: startOfDay(body.validFrom),
          validUntil: endOfDay(body.validUntil),
          isActive: body.isActive,
          notes: body.notes || null,
          items: { create: body.items.map((it) => ({ productId: it.productId, price: money(it.price) })) },
        },
        include: contractInclude,
      });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "CREATE_RATE_CONTRACT", entity: "RateContract", entityId: created.id, details: `${refNo} · ${created.customer.name} · ${body.items.length} rates` } });
      return created;
    });
    res.status(201).json({ ok: true, data: { contract: withStatus(contract) } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** PATCH /rate-contracts/:id — update the contract and replace its rate lines. */
router.patch("/:id", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = contractSchema.parse(req.body);
    const existing = await prisma.rateContract.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Rate contract not found" } });
    if (!(await assertRefs(body.customerId, body.items.map((i) => i.productId), res))) return;
    const contract = await prisma.$transaction(async (tx) => {
      await tx.rateContractItem.deleteMany({ where: { contractId: req.params.id } });
      const updated = await tx.rateContract.update({
        where: { id: req.params.id },
        data: {
          customerId: body.customerId,
          name: body.name,
          validFrom: startOfDay(body.validFrom),
          validUntil: endOfDay(body.validUntil),
          isActive: body.isActive,
          notes: body.notes || null,
          items: { create: body.items.map((it) => ({ productId: it.productId, price: money(it.price) })) },
        },
        include: contractInclude,
      });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "UPDATE_RATE_CONTRACT", entity: "RateContract", entityId: updated.id, details: `${updated.refNo} · ${body.items.length} rates` } });
      return updated;
    });
    res.json({ ok: true, data: { contract: withStatus(contract) } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** DELETE /rate-contracts/:id — remove a contract (its rates cascade). */
router.delete("/:id", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const existing = await prisma.rateContract.findUnique({ where: { id: req.params.id }, select: { id: true, refNo: true } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Rate contract not found" } });
    await prisma.rateContract.delete({ where: { id: req.params.id } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "DELETE_RATE_CONTRACT", entity: "RateContract", entityId: existing.id, details: existing.refNo } });
    res.json({ ok: true, data: { message: "Deleted" } });
  } catch (err) {
    next(err);
  }
});

export default router;
