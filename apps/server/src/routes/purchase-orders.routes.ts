import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { nextNumber } from "../utils/counter";
import { applyMovement, weightedAvg, InsufficientStockError } from "../lib/stock";
import { logPriceChange } from "../lib/price-history";

/**
 * D5 — Purchase Orders → GRN.
 *
 * A PurchaseOrder is a NON-financial planning document — creating/sending it moves no
 * stock and no money. Receiving against it (POST /:id/receive) creates a normal RECEIVED
 * Purchase for the received quantities, which runs the proven purchase posting (stock in
 * via the ledger + weighted-avg cost + vendor payable). Partial receipts are supported;
 * the PO advances to PARTIAL, then RECEIVED once every line is fully received. Because a
 * receipt is just a Purchase, no new balance-sheet term is needed — integrity is untouched.
 */

const router = Router();
router.use(requireAuth);

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const money = (v: number) => new Prisma.Decimal(Math.round(v * 100) / 100);
const r2 = (v: number) => Math.round(v * 100) / 100;

const poInclude = {
  vendor: { select: { id: true, code: true, name: true } },
  user: { select: { name: true } },
  items: { include: { product: { select: { id: true, name: true, sku: true, unit: { select: { shortName: true } } } } } },
  purchases: { select: { id: true, invoiceNo: true, date: true, grandTotal: true } },
} satisfies Prisma.PurchaseOrderInclude;

/** Recompute status from item progress (unless CANCELLED/CLOSED). */
function progressStatus(items: { qty: Prisma.Decimal; qtyReceived: Prisma.Decimal }[]): "DRAFT" | "PARTIAL" | "RECEIVED" {
  const anyRecv = items.some((i) => num(i.qtyReceived) > 0);
  const allRecv = items.every((i) => num(i.qtyReceived) >= num(i.qty) - 0.0001);
  return allRecv ? "RECEIVED" : anyRecv ? "PARTIAL" : "DRAFT";
}

/** GET /purchase-orders?status&vendorId&page&limit */
router.get("/", requirePermission("purchases.view"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const status = String(req.query.status ?? "");
    const vendorId = String(req.query.vendorId ?? "");
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (status) where.status = status as Prisma.PurchaseOrderWhereInput["status"];
    if (vendorId) where.vendorId = vendorId;
    const [orders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({ where, include: poInclude, orderBy: { date: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.purchaseOrder.count({ where }),
    ]);
    res.json({ ok: true, data: { orders, total, page, pages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) {
    next(err);
  }
});

/** GET /purchase-orders/:id */
router.get("/:id", requirePermission("purchases.view"), async (req, res, next) => {
  try {
    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, include: poInclude });
    if (!order) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Purchase order not found" } });
    res.json({ ok: true, data: { order } });
  } catch (err) {
    next(err);
  }
});

const itemSchema = z.object({ productId: z.string().min(1), qty: z.coerce.number().positive(), unitCost: z.coerce.number().min(0) });
const createSchema = z.object({
  vendorId: z.string().min(1),
  expectedDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  items: z.array(itemSchema).min(1, "Add at least one product"),
});

/** POST /purchase-orders — raise a PO (DRAFT). No stock/money. */
router.post("/", requirePermission("purchases.create"), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const vendor = await prisma.vendor.findUnique({ where: { id: body.vendorId }, select: { id: true, name: true } });
    if (!vendor) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Vendor not found" } });
    const ids = [...new Set(body.items.map((i) => i.productId))];
    const prods = await prisma.product.count({ where: { id: { in: ids }, type: "STANDARD" } });
    if (prods !== ids.length) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "All order lines must be stock products" } });

    const order = await prisma.$transaction(async (tx) => {
      const poNo = await nextNumber(tx, "purchase_order", "PO");
      return tx.purchaseOrder.create({
        data: {
          poNo, vendorId: vendor.id, userId: req.user!.id, status: "DRAFT",
          expectedDate: body.expectedDate ?? null, notes: body.notes ?? null,
          items: { create: body.items.map((i) => ({ productId: i.productId, qty: money(i.qty), unitCost: money(i.unitCost) })) },
        },
      });
    });
    const full = await prisma.purchaseOrder.findUnique({ where: { id: order.id }, include: poInclude });
    res.status(201).json({ ok: true, data: { order: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** PATCH /purchase-orders/:id — change status (SENT / CANCELLED / CLOSED). */
router.patch("/:id", requirePermission("purchases.create"), async (req, res, next) => {
  try {
    const status = String(req.body?.status ?? "");
    if (!["SENT", "CANCELLED", "CLOSED", "DRAFT"].includes(status)) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Invalid status" } });
    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Purchase order not found" } });
    if (order.status === "RECEIVED" || order.status === "PARTIAL") return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Can't change status once goods have been received" } });
    await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: status as Prisma.PurchaseOrderUpdateInput["status"] } });
    const full = await prisma.purchaseOrder.findUnique({ where: { id: order.id }, include: poInclude });
    res.json({ ok: true, data: { order: full } });
  } catch (err) {
    next(err);
  }
});

const receiveSchema = z.object({
  refInvoiceNo: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(z.object({ poItemId: z.string().min(1), qty: z.coerce.number().positive(), unitCost: z.coerce.number().min(0).optional() })).min(1, "Receive at least one line"),
});

/** POST /purchase-orders/:id/receive — book a GRN: creates a RECEIVED Purchase for the
 *  received lines (stock in + weighted-avg + payable), advances the PO's received qty. */
router.post("/:id/receive", requirePermission("purchases.create"), async (req, res, next) => {
  try {
    const body = receiveSchema.parse(req.body);
    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!order) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Purchase order not found" } });
    if (order.status === "CANCELLED") return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "This PO is cancelled" } });

    const byId = new Map(order.items.map((i) => [i.id, i]));
    for (const l of body.lines) {
      const it = byId.get(l.poItemId);
      if (!it) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Unknown PO line" } });
      const remaining = num(it.qty) - num(it.qtyReceived);
      if (l.qty > remaining + 0.0001) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: `Receiving more than ordered on one line (max ${r2(remaining)})` } });
    }

    const purchase = await prisma.$transaction(async (tx) => {
      const invoiceNo = await nextNumber(tx, "purchase", "PUR");
      let subTotal = 0;
      const lineData = body.lines.map((l) => {
        const it = byId.get(l.poItemId)!;
        const unitCost = l.unitCost != null ? l.unitCost : num(it.unitCost);
        const total = r2(l.qty * unitCost);
        subTotal = r2(subTotal + total);
        return { productId: it.productId, qty: l.qty, unitCost, total, poItemId: it.id };
      });
      const grandTotal = subTotal;

      const created = await tx.purchase.create({
        data: {
          invoiceNo, vendorId: order.vendorId, userId: req.user!.id, status: "RECEIVED", purchaseOrderId: order.id,
          refInvoiceNo: body.refInvoiceNo ?? null, subTotal: money(subTotal), grandTotal: money(grandTotal),
          paidAmount: money(0), dueAmount: money(grandTotal), notes: body.notes ?? `Against ${order.poNo}`,
        },
      });

      for (const l of lineData) {
        await tx.purchaseItem.create({ data: { purchaseId: created.id, productId: l.productId, qty: money(l.qty), unitCost: money(l.unitCost), total: money(l.total) } });
        const cur = await tx.product.findUnique({ where: { id: l.productId }, select: { stockQty: true, costPrice: true, salePrice: true } });
        const newAvg = weightedAvg(cur!.stockQty, cur!.costPrice, l.qty, l.unitCost);
        await tx.product.update({ where: { id: l.productId }, data: { costPrice: newAvg } });
        await applyMovement(tx, { productId: l.productId, type: "PURCHASE", qty: l.qty, unitCost: money(l.unitCost), refType: "PURCHASE", refId: created.id, notes: `GRN ${invoiceNo} (${order.poNo})` });
        if (!newAvg.equals(cur!.costPrice)) await logPriceChange(tx, { productId: l.productId, costPrice: newAvg, salePrice: cur!.salePrice, source: "PURCHASE", userId: req.user!.id, note: invoiceNo });
        await tx.purchaseOrderItem.update({ where: { id: l.poItemId }, data: { qtyReceived: { increment: money(l.qty) } } });
      }

      // Vendor payable increases by the whole received value (unpaid — bill/pay later).
      await tx.vendor.update({ where: { id: order.vendorId }, data: { balance: { increment: money(grandTotal) } } });

      // Advance the PO status from the fresh item progress.
      const fresh = await tx.purchaseOrderItem.findMany({ where: { poId: order.id }, select: { qty: true, qtyReceived: true } });
      await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: progressStatus(fresh) } });

      await tx.auditLog.create({ data: { userId: req.user!.id, action: "PO_RECEIVE", entity: "PurchaseOrder", entityId: order.id, details: `${order.poNo} → ${invoiceNo} · ₨${grandTotal}` } });
      return created;
    });

    const full = await prisma.purchaseOrder.findUnique({ where: { id: order.id }, include: poInclude });
    res.status(201).json({ ok: true, data: { order: full, purchaseId: purchase.id } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err instanceof InsufficientStockError) return res.status(409).json({ ok: false, error: { code: err.code, message: err.message } });
    next(err);
  }
});

export default router;
