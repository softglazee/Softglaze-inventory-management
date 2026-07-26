/**
 * Delivery challans (F2) — dispatch notes against a sale. One invoice can be delivered
 * in several truck loads, so each challan records what physically went out. Stock already
 * moved at invoice time, so a challan has NO money/stock effect — it only tracks delivered
 * vs pending quantities. Rule: Σ delivered per line ≤ sold qty.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { nextNumber } from "../utils/counter";

const router = Router();
router.use(requireAuth);

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));

const noteInclude = {
  sale: { select: { id: true, invoiceNo: true, date: true, customer: { select: { name: true, phone: true } } } },
  user: { select: { name: true } },
  items: { include: { saleItem: { include: { product: { select: { name: true, sku: true, unit: { select: { shortName: true } } } } } } } },
} satisfies Prisma.DeliveryNoteInclude;

/** Delivered qty per saleItem for a sale (only DELIVERED challans count). */
async function deliveredMap(saleId: string): Promise<Map<string, number>> {
  const rows = await prisma.deliveryNoteItem.groupBy({ by: ["saleItemId"], where: { deliveryNote: { saleId, status: "DELIVERED" } }, _sum: { qty: true } });
  return new Map(rows.map((r) => [r.saleItemId, num(r._sum.qty)]));
}

/** GET /deliveries?saleId&from&to — challan list */
router.get("/", requirePermission("sales.view_all", "sales.view_own"), async (req, res, next) => {
  try {
    const saleId = String(req.query.saleId ?? "");
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const where: Prisma.DeliveryNoteWhereInput = {};
    if (saleId) where.saleId = saleId;
    if (from || to) where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    const deliveries = await prisma.deliveryNote.findMany({ where, include: noteInclude, orderBy: { date: "desc" }, take: saleId ? undefined : 100 });
    res.json({ ok: true, data: { deliveries } });
  } catch (err) {
    next(err);
  }
});

/** GET /deliveries/pending/:saleId — per-line sold/delivered/remaining for the dispatch UI */
router.get("/pending/:saleId", requirePermission("sales.view_all", "sales.view_own"), async (req, res, next) => {
  try {
    const sale = await prisma.sale.findUnique({ where: { id: req.params.saleId }, include: { items: { include: { product: { select: { name: true, sku: true, type: true, unit: { select: { shortName: true } } } } } }, customer: { select: { name: true } } } });
    if (!sale) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Sale not found" } });
    if (sale.isReturn || sale.status !== "COMPLETED") return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Only completed sales can be dispatched" } });
    const delivered = await deliveredMap(sale.id);
    const lines = sale.items
      .filter((it) => it.product.type !== "SERVICE") // services aren't physically delivered
      .map((it) => { const sold = num(it.qty); const done = delivered.get(it.id) ?? 0; return { saleItemId: it.id, product: it.product.name, sku: it.product.sku, unit: it.product.unit?.shortName ?? "", sold, delivered: done, remaining: Math.round((sold - done) * 1000) / 1000 }; });
    res.json({ ok: true, data: { sale: { id: sale.id, invoiceNo: sale.invoiceNo, customer: sale.customer?.name ?? "Walk-in" }, lines } });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  saleId: z.string().min(1, "Pick the sale"),
  date: z.coerce.date().optional(),
  driverName: z.string().trim().max(120).nullable().optional(),
  vehicleNo: z.string().trim().max(60).nullable().optional(),
  receiverName: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  items: z.array(z.object({ saleItemId: z.string().min(1), qty: z.coerce.number().positive() })).min(1, "Add at least one item to deliver"),
});

/** POST /deliveries — create a challan (Σ delivered per line ≤ sold). */
router.post("/", requirePermission("sales.create"), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const sale = await prisma.sale.findUnique({ where: { id: body.saleId }, include: { items: true } });
    if (!sale || sale.isReturn || sale.status !== "COMPLETED") return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Only completed sales can be dispatched" } });
    const itemById = new Map(sale.items.map((it) => [it.id, it]));
    const delivered = await deliveredMap(sale.id);
    for (const line of body.items) {
      const it = itemById.get(line.saleItemId);
      if (!it) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "An item is not part of this sale" } });
      const already = delivered.get(line.saleItemId) ?? 0;
      if (already + line.qty > num(it.qty) + 0.001) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: `Cannot deliver more than sold (already ${already} of ${num(it.qty)})` } });
    }
    const note = await prisma.$transaction(async (tx) => {
      const refNo = await nextNumber(tx, "delivery", "CHL");
      const created = await tx.deliveryNote.create({ data: { refNo, saleId: sale.id, driverName: body.driverName || null, vehicleNo: body.vehicleNo || null, receiverName: body.receiverName || null, notes: body.notes || null, userId: req.user!.id, ...(body.date ? { date: body.date } : {}) } });
      for (const line of body.items) await tx.deliveryNoteItem.create({ data: { deliveryNoteId: created.id, saleItemId: line.saleItemId, qty: new Prisma.Decimal(line.qty) } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "DELIVERY_NOTE", entity: "DeliveryNote", entityId: created.id, details: `${refNo} for ${sale.invoiceNo}` } });
      return created;
    });
    const full = await prisma.deliveryNote.findUnique({ where: { id: note.id }, include: noteInclude });
    res.status(201).json({ ok: true, data: { delivery: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** POST /deliveries/:id/cancel — void a challan (frees its delivered qty). */
router.post("/:id/cancel", requirePermission("sales.create"), async (req, res, next) => {
  try {
    const note = await prisma.deliveryNote.findUnique({ where: { id: req.params.id } });
    if (!note) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Challan not found" } });
    if (note.status === "CANCELLED") return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Already cancelled" } });
    await prisma.deliveryNote.update({ where: { id: note.id }, data: { status: "CANCELLED" } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "DELIVERY_CANCEL", entity: "DeliveryNote", entityId: note.id, details: note.refNo } });
    res.json({ ok: true, data: { message: "Challan cancelled" } });
  } catch (err) {
    next(err);
  }
});

export default router;
