/**
 * Advance bookings with rate lock (F3).
 * A customer books goods at TODAY's price with an advance and takes delivery over the
 * coming weeks. The advance is a LIABILITY, never revenue: receiving it is a normal
 * CUSTOMER_RECEIPT that pushes the customer's balance negative (a credit / advance held,
 * already a liability line on the balance sheet). Revenue is recognised ONLY when the
 * booking is fulfilled — that generates a real Sale (invoice) at the LOCKED unitPrice,
 * deducts stock, snapshots COGS, and the new receivable nets against the held advance in
 * the customer's single running balance. Cancelling can refund the unused advance.
 * Every write is one prisma.$transaction and stays integrity-safe.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { nextNumber } from "../utils/counter";
import { applyMovement, InsufficientStockError } from "../lib/stock";
import { postPayment } from "../lib/accounts";
import { notifyLowStock } from "../lib/notify";

const router = Router();
router.use(requireAuth);

const round2 = (v: number) => Math.round(v * 100) / 100;
const money = (v: number) => new Prisma.Decimal(v).toDecimalPlaces(2);
const numOf = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));

const productForSale = { comboItems: { include: { componentProduct: { select: { id: true, name: true, type: true, costPrice: true } } } } } satisfies Prisma.ProductInclude;

const bookingInclude = {
  customer: { select: { id: true, code: true, name: true, phone: true } },
  user: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, name: true, sku: true, type: true, salePrice: true, unit: { select: { shortName: true } } } } } },
  sales: { select: { id: true, invoiceNo: true, date: true, grandTotal: true, status: true, isReturn: true }, orderBy: { date: "asc" } },
} satisfies Prisma.BookingInclude;

type BookingRow = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

/** Attach the derived money figures (value delivered, advance still held, value still owed). */
function decorate(b: BookingRow) {
  const valueFulfilled = round2(b.items.reduce((s, it) => s + numOf(it.qtyFulfilled) * numOf(it.unitPrice), 0));
  const advanceRemaining = round2(Math.max(0, numOf(b.advanceReceived) - valueFulfilled));
  const outstanding = round2(numOf(b.bookedValue) - valueFulfilled); // value still to deliver at the locked rate
  return { ...b, valueFulfilled, advanceRemaining, outstanding };
}

const viewPerm = ["sales.view_all", "sales.view_own", "reports.view"] as const;

/** GET /bookings?status&customerId&from&to */
router.get("/", requirePermission(...viewPerm), async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "");
    const customerId = String(req.query.customerId ?? "");
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const where: Prisma.BookingWhereInput = {};
    if (status) where.status = status as Prisma.BookingWhereInput["status"];
    if (customerId) where.customerId = customerId;
    if (from || to) where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    const bookings = await prisma.booking.findMany({ where, include: bookingInclude, orderBy: { date: "desc" } });
    res.json({ ok: true, data: { bookings: bookings.map(decorate) } });
  } catch (err) {
    next(err);
  }
});

/** GET /bookings/summary — cards for the register (open count, booked value, advances held). */
router.get("/summary", requirePermission(...viewPerm), async (_req, res, next) => {
  try {
    const live = await prisma.booking.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, include: bookingInclude });
    const rows = live.map(decorate);
    const advancesHeld = round2(rows.reduce((s, r) => s + r.advanceRemaining, 0));
    const outstandingValue = round2(rows.reduce((s, r) => s + r.outstanding, 0));
    res.json({ ok: true, data: { openCount: rows.length, advancesHeld, outstandingValue } });
  } catch (err) {
    next(err);
  }
});

/** GET /bookings/:id */
router.get("/:id", requirePermission(...viewPerm), async (req, res, next) => {
  try {
    const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: bookingInclude });
    if (!booking) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Booking not found" } });
    res.json({ ok: true, data: { booking: decorate(booking) } });
  } catch (err) {
    next(err);
  }
});

const lineSchema = z.object({
  productId: z.string().min(1),
  qty: z.coerce.number().positive("Quantity must be more than 0"),
  unitPrice: z.coerce.number().min(0, "Price cannot be negative"),
});
const createSchema = z.object({
  customerId: z.string().min(1, "Pick a customer"),
  date: z.coerce.date().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  items: z.array(lineSchema).min(1, "Add at least one item"),
  advance: z.coerce.number().min(0).default(0),
  advanceMethodId: z.string().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

/** POST /bookings — create a booking at locked prices and (optionally) take an advance. */
router.post("/", requirePermission("sales.create"), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const customer = await prisma.customer.findUnique({ where: { id: body.customerId }, select: { id: true, name: true } });
    if (!customer) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Customer not found" } });

    const ids = [...new Set(body.items.map((i) => i.productId))];
    const products = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isActive: true } });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const l of body.items) {
      const p = byId.get(l.productId);
      if (!p) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "One of the products was not found" } });
      if (!p.isActive) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: `${p.name} is inactive` } });
    }

    const bookedValue = round2(body.items.reduce((s, l) => s + l.qty * l.unitPrice, 0));
    const advance = round2(body.advance);
    if (advance > 0) {
      if (!body.advanceMethodId) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Choose which account the advance came into" } });
      const method = await prisma.paymentMethod.findUnique({ where: { id: body.advanceMethodId }, select: { id: true } });
      if (!method) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Unknown payment method" } });
      if (advance > bookedValue + 0.01) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Advance cannot be more than the booking value" } });
    }

    const booking = await prisma.$transaction(async (tx) => {
      const refNo = await nextNumber(tx, "booking", "BKG");
      const created = await tx.booking.create({
        data: {
          refNo, customerId: customer.id, userId: req.user!.id, status: "OPEN",
          ...(body.date ? { date: body.date } : {}), validUntil: body.validUntil ?? null,
          bookedValue: money(bookedValue), advanceReceived: money(advance), notes: body.notes || null,
        },
      });
      for (const l of body.items) {
        await tx.bookingItem.create({ data: { bookingId: created.id, productId: l.productId, qty: new Prisma.Decimal(l.qty), unitPrice: money(l.unitPrice), qtyFulfilled: new Prisma.Decimal(0) } });
      }
      // Advance = a customer receipt into the chosen account; the customer's balance goes
      // negative (a credit / advance held) — a liability, not revenue.
      if (advance > 0) {
        await postPayment(tx, { type: "CUSTOMER_RECEIPT", methodId: body.advanceMethodId!, amount: advance, customerId: customer.id, userId: req.user!.id, notes: `Advance for booking ${refNo}` });
        await tx.customer.update({ where: { id: customer.id }, data: { balance: { decrement: money(advance) } } });
      }
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "CREATE_BOOKING", entity: "Booking", entityId: created.id, details: `${refNo} · ${customer.name} · ₨${bookedValue}${advance > 0 ? ` · advance ₨${advance}` : ""}` } });
      return created;
    });

    const full = await prisma.booking.findUnique({ where: { id: booking.id }, include: bookingInclude });
    res.status(201).json({ ok: true, data: { booking: decorate(full!) } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

const fulfillSchema = z.object({
  date: z.coerce.date().optional(),
  items: z.array(z.object({ bookingItemId: z.string().min(1), qty: z.coerce.number().positive() })).min(1, "Choose quantities to deliver"),
  payments: z.array(z.object({ methodId: z.string().min(1), amount: z.coerce.number().positive() })).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

/**
 * POST /bookings/:id/fulfill — deliver some/all of a booking.
 * Generates a real Sale (invoice) at the LOCKED unitPrice: stock deducts, COGS snapshots
 * at the CURRENT cost, revenue is recognised now. The held advance covers it via the
 * customer's running balance (dueAmount increments the balance, netting the advance
 * credit). Credit-limit gating is skipped here — a booking is a pre-agreed, advance-backed
 * commitment. Σ delivered per line can never exceed the booked qty.
 */
router.post("/:id/fulfill", requirePermission("sales.create"), async (req, res, next) => {
  try {
    const body = fulfillSchema.parse(req.body);
    const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { items: true, customer: { select: { id: true, name: true } } } });
    if (!booking) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Booking not found" } });
    if (booking.status === "CANCELLED" || booking.status === "COMPLETED") {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: `This booking is already ${booking.status.toLowerCase()}` } });
    }

    const itemById = new Map(booking.items.map((it) => [it.id, it]));
    const deliver = body.items.filter((l) => l.qty > 0);
    if (!deliver.length) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Enter a quantity to deliver" } });
    for (const l of deliver) {
      const it = itemById.get(l.bookingItemId);
      if (!it) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "That item is not part of this booking" } });
      const remaining = round2(numOf(it.qty) - numOf(it.qtyFulfilled));
      if (l.qty > remaining + 0.001) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: `Cannot deliver more than the ${remaining} remaining` } });
    }

    // Products (+ combo components) for COGS snapshot & stock movement (mirrors sales).
    const prodIds = [...new Set(deliver.map((l) => itemById.get(l.bookingItemId)!.productId))];
    const products = await prisma.product.findMany({ where: { id: { in: prodIds } }, include: productForSale });
    const prodById = new Map(products.map((p) => [p.id, p]));
    const unitCostOf = (p: (typeof products)[number]) =>
      p.type === "COMBO" ? p.comboItems.reduce((s, ci) => s + numOf(ci.qty) * numOf(ci.componentProduct.costPrice), 0) : numOf(p.costPrice);

    let subTotal = 0;
    let totalCost = 0;
    const computed = deliver.map((l) => {
      const it = itemById.get(l.bookingItemId)!;
      const p = prodById.get(it.productId)!;
      const unitPrice = numOf(it.unitPrice); // LOCKED
      const total = round2(l.qty * unitPrice);
      subTotal = round2(subTotal + total);
      const unitCost = round2(unitCostOf(p));
      totalCost = round2(totalCost + l.qty * unitCost);
      return { bookingItem: it, product: p, qty: l.qty, unitPrice, unitCost, total };
    });
    const grandTotal = subTotal;
    const profit = round2(grandTotal - totalCost);

    if (body.payments && body.payments.length) {
      const methodIds = [...new Set(body.payments.map((p) => p.methodId))];
      const count = await prisma.paymentMethod.count({ where: { id: { in: methodIds } } });
      if (count !== methodIds.length) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Unknown payment method" } });
    }
    const paidAmount = round2((body.payments ?? []).reduce((s, p) => s + p.amount, 0));
    if (paidAmount > grandTotal + 0.01) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Payments exceed the invoice total" } });
    const dueAmount = round2(grandTotal - paidAmount);

    const result = await prisma.$transaction(async (tx) => {
      const invoiceNo = await nextNumber(tx, "sale", "INV");
      const sale = await tx.sale.create({
        data: {
          invoiceNo, customerId: booking.customerId, userId: req.user!.id, status: "COMPLETED", bookingId: booking.id, ...(body.date ? { date: body.date } : {}),
          subTotal: money(subTotal), discount: money(0), tax: money(0), otherCharges: money(0),
          grandTotal: money(grandTotal), paidAmount: money(paidAmount), dueAmount: money(dueAmount), totalCost: money(totalCost), profit: money(profit),
          notes: body.notes || `From booking ${booking.refNo}`,
        },
      });
      for (const c of computed) {
        await tx.saleItem.create({ data: { saleId: sale.id, productId: c.product.id, qty: new Prisma.Decimal(c.qty), unitPrice: money(c.unitPrice), unitCost: money(c.unitCost), discount: money(0), taxAmount: money(0), total: money(c.total) } });
        if (c.product.type === "STANDARD") {
          await applyMovement(tx, { productId: c.product.id, type: "SALE", qty: -c.qty, unitCost: money(c.unitCost), refType: "SALE", refId: sale.id, notes: `Sale ${invoiceNo} (booking ${booking.refNo})`, productName: c.product.name });
        } else if (c.product.type === "COMBO") {
          for (const ci of c.product.comboItems) {
            if (ci.componentProduct.type !== "STANDARD") continue;
            await applyMovement(tx, { productId: ci.componentProductId, type: "SALE", qty: -(numOf(ci.qty) * c.qty), unitCost: money(numOf(ci.componentProduct.costPrice)), refType: "SALE", refId: sale.id, notes: `Sale ${invoiceNo} (combo ${c.product.name})`, productName: ci.componentProduct.name });
          }
        }
        await tx.bookingItem.update({ where: { id: c.bookingItem.id }, data: { qtyFulfilled: { increment: new Prisma.Decimal(c.qty) } } });
      }
      // Receivable for the unpaid part; the held advance (a negative balance) nets it off.
      if (dueAmount > 0) await tx.customer.update({ where: { id: booking.customerId }, data: { balance: { increment: money(dueAmount) } } });
      for (const p of body.payments ?? []) {
        await postPayment(tx, { type: "SALE_RECEIPT", methodId: p.methodId, amount: p.amount, customerId: booking.customerId, saleId: sale.id, userId: req.user!.id, notes: `Sale ${invoiceNo}` });
      }

      // Recompute booking status from the (now-updated) lines.
      const after = await tx.bookingItem.findMany({ where: { bookingId: booking.id }, select: { qty: true, qtyFulfilled: true } });
      const done = after.every((it) => numOf(it.qtyFulfilled) >= numOf(it.qty) - 0.001);
      const newStatus = done ? "COMPLETED" : "PARTIAL";
      await tx.booking.update({ where: { id: booking.id }, data: { status: newStatus } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "FULFILL_BOOKING", entity: "Booking", entityId: booking.id, details: `${booking.refNo} → ${invoiceNo} · ₨${grandTotal}` } });
      return { saleId: sale.id };
    });

    const [sale, full] = await Promise.all([
      prisma.sale.findUnique({ where: { id: result.saleId }, include: { items: { include: { product: { select: { name: true, sku: true, unit: { select: { shortName: true } } } } } }, customer: { select: { name: true } } } }),
      prisma.booking.findUnique({ where: { id: booking.id }, include: bookingInclude }),
    ]);
    res.status(201).json({ ok: true, data: { sale, booking: decorate(full!) } });

    // Best-effort low-stock alerts (never blocks the invoice).
    const affected = computed.flatMap((c) =>
      c.product.type === "STANDARD" ? [c.product.id] : c.product.type === "COMBO" ? c.product.comboItems.filter((ci) => ci.componentProduct.type === "STANDARD").map((ci) => ci.componentProductId) : []
    );
    notifyLowStock(affected).catch(() => {});
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err instanceof InsufficientStockError) return res.status(409).json({ ok: false, error: { code: err.code, message: err.message } });
    next(err);
  }
});

const cancelSchema = z.object({
  refundMethodId: z.string().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

/**
 * POST /bookings/:id/cancel — call off the remaining booking.
 * Any already-delivered invoices stand. The unused advance (advanceReceived − value
 * delivered) is refunded out of a chosen account if refundMethodId is given (REFUND_OUT
 * + balance restored); otherwise it stays as the customer's credit for future use.
 */
router.post("/:id/cancel", requirePermission("sales.create"), async (req, res, next) => {
  try {
    const body = cancelSchema.parse(req.body);
    const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!booking) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Booking not found" } });
    if (booking.status === "CANCELLED" || booking.status === "COMPLETED") {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: `This booking is already ${booking.status.toLowerCase()}` } });
    }

    const valueFulfilled = round2(booking.items.reduce((s, it) => s + numOf(it.qtyFulfilled) * numOf(it.unitPrice), 0));
    const advanceRemaining = round2(Math.max(0, numOf(booking.advanceReceived) - valueFulfilled));
    const doRefund = !!body.refundMethodId && advanceRemaining > 0.001;
    if (doRefund) {
      const method = await prisma.paymentMethod.findUnique({ where: { id: body.refundMethodId! }, select: { id: true } });
      if (!method) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Unknown refund account" } });
    }

    await prisma.$transaction(async (tx) => {
      if (doRefund) {
        await postPayment(tx, { type: "REFUND_OUT", methodId: body.refundMethodId!, amount: advanceRemaining, customerId: booking.customerId, userId: req.user!.id, notes: `Refund unused advance · booking ${booking.refNo}` });
        await tx.customer.update({ where: { id: booking.customerId }, data: { balance: { increment: money(advanceRemaining) } } });
      }
      await tx.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED", notes: body.notes ?? booking.notes } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "CANCEL_BOOKING", entity: "Booking", entityId: booking.id, details: `${booking.refNo}${doRefund ? ` · refunded ₨${advanceRemaining}` : advanceRemaining > 0.001 ? ` · ₨${advanceRemaining} left as credit` : ""}` } });
    });

    const full = await prisma.booking.findUnique({ where: { id: booking.id }, include: bookingInclude });
    res.json({ ok: true, data: { booking: decorate(full!), refunded: doRefund ? advanceRemaining : 0, creditLeft: doRefund ? 0 : advanceRemaining } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

export default router;
