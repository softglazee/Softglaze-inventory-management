import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { nextNumber } from "../utils/counter";
import { applyMovement, weightedAvg, InsufficientStockError } from "../lib/stock";
import { postPayment } from "../lib/accounts";
import { logPriceChange } from "../lib/price-history";

const router = Router();
router.use(requireAuth);

const money = (v: number) => new Prisma.Decimal(v).toDecimalPlaces(2);
const round2 = (v: number) => Math.round(v * 100) / 100;

const lineSchema = z.object({
  productId: z.string().min(1),
  qty: z.coerce.number().positive("Quantity must be more than 0"),
  unitCost: z.coerce.number().min(0, "Cost cannot be negative"),
  discount: z.coerce.number().min(0).default(0),
});
const paymentSchema = z.object({
  methodId: z.string().min(1),
  amount: z.coerce.number().positive(),
});
const createSchema = z.object({
  vendorId: z.string().min(1, "Pick a vendor"),
  refInvoiceNo: z.string().trim().max(60).nullable().optional(),
  date: z.coerce.date().optional(),
  items: z.array(lineSchema).min(1, "Add at least one item"),
  discount: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).default(0),
  otherCharges: z.coerce.number().min(0).default(0),
  // C2 — spread otherCharges (freight/duty/loading) into each item's landed cost.
  // NONE = expense it (old behaviour); VALUE = by line value; QTY = by quantity.
  landedBasis: z.enum(["NONE", "VALUE", "QTY"]).default("NONE"),
  currency: z.string().trim().max(8).optional(),          // H4 — bill currency (default PKR)
  fxRate: z.coerce.number().positive().optional(),        // H4 — 1 foreign unit = fxRate PKR
  notes: z.string().trim().max(1000).nullable().optional(),
  payments: z.array(paymentSchema).optional(),
});

const purchaseInclude = {
  vendor: { select: { id: true, code: true, name: true, phone: true } },
  user: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, name: true, sku: true, unit: { select: { shortName: true } } } } } },
  payments: { include: { method: { select: { name: true } } } },
} satisfies Prisma.PurchaseInclude;

/** GET /purchases?page&limit&search&vendorId&from&to&status */
router.get("/", requirePermission("purchases.view"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search ?? "").trim();
    const vendorId = String(req.query.vendorId ?? "");
    const status = String(req.query.status ?? "");
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    const where: Prisma.PurchaseWhereInput = {};
    if (search) where.OR = [{ invoiceNo: { contains: search, mode: "insensitive" } }, { refInvoiceNo: { contains: search, mode: "insensitive" } }];
    if (vendorId) where.vendorId = vendorId;
    if (status === "RECEIVED" || status === "RETURNED" || status === "CANCELLED" || status === "DRAFT") where.status = status;
    if (from || to) where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const [purchases, total, sums] = await Promise.all([
      prisma.purchase.findMany({ where, include: purchaseInclude, orderBy: { date: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.purchase.count({ where }),
      prisma.purchase.aggregate({ _sum: { grandTotal: true, dueAmount: true }, where }),
    ]);
    res.json({
      ok: true,
      data: { purchases, total, page, pages: Math.max(1, Math.ceil(total / limit)), totalValue: sums._sum.grandTotal ?? 0, totalDue: sums._sum.dueAmount ?? 0 },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /purchases/:id */
router.get("/:id", requirePermission("purchases.view"), async (req, res, next) => {
  try {
    const purchase = await prisma.purchase.findUnique({ where: { id: req.params.id }, include: purchaseInclude });
    if (!purchase) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Purchase not found" } });
    res.json({ ok: true, data: { purchase } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /purchases — receive stock from a vendor.
 * One transaction: Purchase + PurchaseItems + StockMovements(PURCHASE) +
 * weighted-avg cost update + stockQty update + Vendor.balance += due +
 * Payment(s) + Counters + AuditLog.
 */
router.post("/", requirePermission("purchases.create"), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);

    // H4 — import-purchase FX: costs are entered in `currency` at `fxRate`; convert
    // everything to PKR up front so all downstream math + the ledgers stay in PKR.
    const currency = (body.currency || "PKR").toUpperCase();
    const fxRate = currency !== "PKR" && body.fxRate && body.fxRate > 0 ? body.fxRate : 1;
    if (fxRate !== 1) {
      body.items = body.items.map((l) => ({ ...l, unitCost: round2(l.unitCost * fxRate), discount: round2(l.discount * fxRate) }));
      body.discount = round2(body.discount * fxRate);
      body.tax = round2(body.tax * fxRate);
      body.otherCharges = round2(body.otherCharges * fxRate);
    }

    const vendor = await prisma.vendor.findUnique({ where: { id: body.vendorId } });
    if (!vendor) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Vendor not found" } });

    const ids = [...new Set(body.items.map((i) => i.productId))];
    const products = await prisma.product.findMany({ where: { id: { in: ids } } });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const line of body.items) {
      const p = byId.get(line.productId);
      if (!p) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "One of the products was not found" } });
      if (p.type !== "STANDARD") return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: `${p.name} is a ${p.type.toLowerCase()} item and cannot be stocked via purchase` } });
    }
    if (body.payments && body.payments.length) {
      const methodIds = [...new Set(body.payments.map((p) => p.methodId))];
      const methods = await prisma.paymentMethod.count({ where: { id: { in: methodIds } } });
      if (methods !== methodIds.length) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Unknown payment method" } });
    }

    // Money math (2dp)
    let subTotal = 0;
    const lineTotals = body.items.map((l) => {
      const total = round2(l.qty * l.unitCost - l.discount);
      subTotal = round2(subTotal + total);
      return total;
    });
    const grandTotal = round2(subTotal - body.discount + body.tax + body.otherCharges);
    if (grandTotal < 0) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Bill discount is larger than the total" } });
    const paidAmount = round2((body.payments ?? []).reduce((s, p) => s + p.amount, 0));
    if (paidAmount > grandTotal) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Paid amount is more than the purchase total" } });
    const dueAmount = round2(grandTotal - paidAmount);

    // C2 — landed-cost allocation. Spread otherCharges (freight/duty/loading) across the
    // items so each carries its share in `landedUnitCost` — that's the cost capitalised
    // into stock (weighted-avg + StockMovement), so inventory value and COGS reflect the
    // TRUE landed cost. The document math (subTotal/grandTotal) is untouched, and the last
    // line absorbs any rounding so Σ allocated == otherCharges exactly. Basis NONE keeps
    // the old behaviour (freight expensed via the balance sheet's purchaseGap term).
    const freightPool = round2(body.otherCharges);
    const allocate = body.landedBasis !== "NONE" && freightPool > 0;
    const grossVals = body.items.map((l) => round2(l.qty * l.unitCost));
    const totalGross = round2(grossVals.reduce((s, v) => s + v, 0));
    const totalQty = body.items.reduce((s, l) => s + l.qty, 0);
    const n = body.items.length;
    const allocated = new Array(n).fill(0);
    if (allocate) {
      let acc = 0;
      for (let i = 0; i < n; i++) {
        if (i === n - 1) {
          allocated[i] = round2(freightPool - acc); // last line takes the remainder → exact
        } else {
          const w =
            body.landedBasis === "QTY"
              ? (totalQty > 0 ? body.items[i].qty / totalQty : 1 / n)
              : (totalGross > 0 ? grossVals[i] / totalGross : 1 / n);
          allocated[i] = round2(freightPool * w);
          acc = round2(acc + allocated[i]);
        }
      }
    }
    // per-unit landed cost = billed unit cost + this line's freight share ÷ qty
    const landedUnit = body.items.map((l, i) => (l.qty > 0 ? round2(l.unitCost + allocated[i] / l.qty) : round2(l.unitCost)));
    const landedBasisStored = allocate ? body.landedBasis : "NONE";

    const purchase = await prisma.$transaction(async (tx) => {
      const invoiceNo = await nextNumber(tx, "purchase", "PUR");
      const created = await tx.purchase.create({
        data: {
          invoiceNo,
          vendorId: vendor.id,
          userId: req.user!.id,
          refInvoiceNo: body.refInvoiceNo || null,
          ...(body.date ? { date: body.date } : {}),
          status: "RECEIVED",
          subTotal: money(subTotal),
          discount: money(body.discount),
          tax: money(body.tax),
          otherCharges: money(body.otherCharges),
          landedBasis: landedBasisStored,
          currency,
          fxRate: new Prisma.Decimal(fxRate),
          grandTotal: money(grandTotal),
          paidAmount: money(paidAmount),
          dueAmount: money(dueAmount),
          notes: body.notes || null,
        },
      });

      for (const [i, line] of body.items.entries()) {
        // C2 — cost capitalised into stock = the LANDED unit cost (billed + freight share).
        const capitalisedCost = landedUnit[i];
        await tx.purchaseItem.create({
          data: {
            purchaseId: created.id,
            productId: line.productId,
            qty: new Prisma.Decimal(line.qty),
            unitCost: money(line.unitCost),
            landedUnitCost: allocate ? money(capitalisedCost) : null,
            discount: money(line.discount),
            total: money(lineTotals[i]),
          },
        });
        // weighted-average cost (read fresh in-tx so repeated products chain correctly)
        const cur = await tx.product.findUnique({ where: { id: line.productId }, select: { stockQty: true, costPrice: true, salePrice: true } });
        const newAvg = weightedAvg(cur!.stockQty, cur!.costPrice, line.qty, capitalisedCost);
        await tx.product.update({ where: { id: line.productId }, data: { costPrice: newAvg } });
        await applyMovement(tx, { productId: line.productId, type: "PURCHASE", qty: line.qty, unitCost: money(capitalisedCost), refType: "PURCHASE", refId: created.id, notes: `Purchase ${invoiceNo}` });
        // D1 — record the new weighted-avg cost if it moved
        if (!newAvg.equals(cur!.costPrice)) await logPriceChange(tx, { productId: line.productId, costPrice: newAvg, salePrice: cur!.salePrice, source: "PURCHASE", userId: req.user!.id, note: invoiceNo });
      }

      // Vendor payable increases by the unpaid portion
      if (dueAmount !== 0) await tx.vendor.update({ where: { id: vendor.id }, data: { balance: { increment: money(dueAmount) } } });

      for (const p of body.payments ?? []) {
        await postPayment(tx, { type: "PURCHASE_PAYMENT", methodId: p.methodId, amount: p.amount, vendorId: vendor.id, purchaseId: created.id, userId: req.user!.id, notes: `Payment for ${invoiceNo}` });
      }

      await tx.auditLog.create({ data: { userId: req.user!.id, action: "CREATE_PURCHASE", entity: "Purchase", entityId: created.id, details: `${invoiceNo} · ${vendor.name} · ₨${grandTotal}` } });
      return created;
    });

    const full = await prisma.purchase.findUnique({ where: { id: purchase.id }, include: purchaseInclude });
    res.status(201).json({ ok: true, data: { purchase: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err instanceof InsufficientStockError) return res.status(409).json({ ok: false, error: { code: err.code, message: err.message } });
    next(err);
  }
});

const returnSchema = z.object({
  items: z.array(z.object({ purchaseItemId: z.string().min(1), qty: z.coerce.number().positive() })).min(1, "Choose items to return"),
  notes: z.string().trim().max(1000).nullable().optional(),
});

/**
 * POST /purchases/:id/return — send items back to the vendor.
 * Stock out at the ORIGINAL line cost, vendor payable reduced by the return value.
 * Weighted-average cost is unchanged (removals don't move the average).
 */
router.post("/:id/return", requirePermission("purchases.return"), async (req, res, next) => {
  try {
    const body = returnSchema.parse(req.body);
    const original = await prisma.purchase.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!original || original.isReturn) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Purchase not found" } });

    const itemById = new Map(original.items.map((it) => [it.id, it]));
    for (const r of body.items) {
      const it = itemById.get(r.purchaseItemId);
      if (!it) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Return item is not part of this purchase" } });
      if (r.qty > Number(it.qty)) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Cannot return more than was purchased" } });
    }

    let returnValue = 0;
    for (const r of body.items) {
      const it = itemById.get(r.purchaseItemId)!;
      returnValue = round2(returnValue + r.qty * Number(it.unitCost));
    }

    const ret = await prisma.$transaction(async (tx) => {
      const invoiceNo = await nextNumber(tx, "purchase_return", "PRET");
      const doc = await tx.purchase.create({
        data: {
          invoiceNo,
          vendorId: original.vendorId,
          userId: req.user!.id,
          status: "RETURNED",
          isReturn: true,
          returnOfId: original.id,
          subTotal: money(returnValue),
          grandTotal: money(returnValue),
          paidAmount: money(0),
          dueAmount: money(0),
          notes: body.notes || `Return of ${original.invoiceNo}`,
        },
      });
      for (const r of body.items) {
        const it = itemById.get(r.purchaseItemId)!;
        await tx.purchaseItem.create({ data: { purchaseId: doc.id, productId: it.productId, qty: new Prisma.Decimal(r.qty), unitCost: it.unitCost, discount: money(0), total: money(round2(r.qty * Number(it.unitCost))) } });
        await applyMovement(tx, { productId: it.productId, type: "PURCHASE_RETURN", qty: -r.qty, unitCost: it.unitCost, refType: "PURCHASE_RETURN", refId: doc.id, notes: `Return ${invoiceNo}` });
      }
      // Payable reduced by the value returned (may push vendor into credit if already paid)
      await tx.vendor.update({ where: { id: original.vendorId }, data: { balance: { decrement: money(returnValue) } } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "PURCHASE_RETURN", entity: "Purchase", entityId: doc.id, details: `${invoiceNo} of ${original.invoiceNo} · ₨${returnValue}` } });
      return doc;
    });

    const full = await prisma.purchase.findUnique({ where: { id: ret.id }, include: purchaseInclude });
    res.status(201).json({ ok: true, data: { purchase: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err instanceof InsufficientStockError) return res.status(409).json({ ok: false, error: { code: err.code, message: err.message } });
    next(err);
  }
});

export default router;
