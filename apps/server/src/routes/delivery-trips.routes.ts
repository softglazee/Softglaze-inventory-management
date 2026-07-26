/**
 * Delivery trips / freight billing (C5). A vehicle run: driver + vehicle deliver one or
 * more challans (F2). `freightPaid` (the cost paid to the transporter) OPTIONALLY posts a
 * real Expense — money out + P&L — reusing the proven expense path (postPayment EXPENSE),
 * and is fully reversed if the trip is deleted. `freightCharged` is RECORD-ONLY (the real
 * recovery already sits on the sale invoices as otherCharges, so re-posting it would
 * double-count) and only drives the delivery-margin view. So the only accounting effect is
 * the optional freight expense, and integrity is untouched.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { nextNumber } from "../utils/counter";
import { postPayment } from "../lib/accounts";

const router = Router();
router.use(requireAuth);

const money = (v: number) => new Prisma.Decimal(v).toDecimalPlaces(2);
const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const FREIGHT_CATEGORY = "Transport & Loading";

const tripInclude = {
  customer: { select: { id: true, code: true, name: true, phone: true } },
  user: { select: { name: true } },
  expense: { select: { id: true, refNo: true } },
  challans: { select: { id: true, refNo: true, sale: { select: { invoiceNo: true, customer: { select: { name: true } } } } } },
} satisfies Prisma.DeliveryTripInclude;

/** Attach the derived delivery margin (recovered − paid). */
const withMargin = (t: any) => ({ ...t, margin: Math.round((num(t.freightCharged) - num(t.freightPaid)) * 100) / 100 });

/** GET /delivery-trips?from&to&customerId */
router.get("/", requirePermission("sales.view_all", "sales.view_own"), async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const customerId = String(req.query.customerId ?? "");
    const where: Prisma.DeliveryTripWhereInput = {};
    if (customerId) where.customerId = customerId;
    if (from || to) where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    const [trips, sums] = await Promise.all([
      prisma.deliveryTrip.findMany({ where, include: tripInclude, orderBy: { date: "desc" }, take: 200 }),
      prisma.deliveryTrip.aggregate({ _sum: { freightCharged: true, freightPaid: true }, where }),
    ]);
    res.json({
      ok: true,
      data: {
        trips: trips.map(withMargin),
        totals: { charged: num(sums._sum.freightCharged), paid: num(sums._sum.freightPaid), margin: Math.round((num(sums._sum.freightCharged) - num(sums._sum.freightPaid)) * 100) / 100 },
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /delivery-trips/:id */
router.get("/:id", requirePermission("sales.view_all", "sales.view_own"), async (req, res, next) => {
  try {
    const trip = await prisma.deliveryTrip.findUnique({ where: { id: req.params.id }, include: tripInclude });
    if (!trip) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Trip not found" } });
    res.json({ ok: true, data: { trip: withMargin(trip) } });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  date: z.coerce.date().optional(),
  vehicleNo: z.string().trim().max(40).nullable().optional(),
  driverName: z.string().trim().max(80).nullable().optional(),
  driverPhone: z.string().trim().max(40).nullable().optional(),
  customerId: z.string().min(1).nullable().optional(),
  freightCharged: z.coerce.number().min(0).default(0),
  freightPaid: z.coerce.number().min(0).default(0),
  paidMethodId: z.string().min(1).nullable().optional(), // if set (and freightPaid>0) → book the freight as an Expense
  challanIds: z.array(z.string().min(1)).max(200).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

/** POST /delivery-trips — log a trip; optionally book freight paid as an expense; attach challans. */
router.post("/", requirePermission("expenses.create"), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    if (body.customerId) {
      const c = await prisma.customer.findUnique({ where: { id: body.customerId }, select: { id: true } });
      if (!c) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Customer not found" } });
    }
    const bookFreight = body.freightPaid > 0 && !!body.paidMethodId;
    if (bookFreight) {
      const method = await prisma.paymentMethod.findUnique({ where: { id: body.paidMethodId! }, select: { id: true } });
      if (!method) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Unknown account for the freight payment" } });
    }
    if (body.challanIds?.length) {
      const found = await prisma.deliveryNote.count({ where: { id: { in: body.challanIds } } });
      if (found !== new Set(body.challanIds).size) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "One of the challans was not found" } });
    }

    const trip = await prisma.$transaction(async (tx) => {
      const refNo = await nextNumber(tx, "delivery_trip", "TRP");
      // Optional freight-paid expense (money out + P&L), same path as a manual expense.
      let expenseId: string | null = null;
      if (bookFreight) {
        const category = await tx.expenseCategory.upsert({ where: { name: FREIGHT_CATEGORY }, create: { name: FREIGHT_CATEGORY }, update: {} });
        const expRef = await nextNumber(tx, "expense", "EXP");
        const expense = await tx.expense.create({ data: { refNo: expRef, categoryId: category.id, amount: money(body.freightPaid), notes: `Freight for trip ${refNo}`, userId: req.user!.id, ...(body.date ? { date: body.date } : {}) } });
        await postPayment(tx, { type: "EXPENSE", methodId: body.paidMethodId!, amount: body.freightPaid, expenseId: expense.id, userId: req.user!.id, notes: `Freight for trip ${refNo}`, date: body.date });
        expenseId = expense.id;
      }
      const created = await tx.deliveryTrip.create({
        data: {
          refNo,
          ...(body.date ? { date: body.date } : {}),
          vehicleNo: body.vehicleNo || null,
          driverName: body.driverName || null,
          driverPhone: body.driverPhone || null,
          customerId: body.customerId || null,
          freightCharged: money(body.freightCharged),
          freightPaid: money(body.freightPaid),
          expenseId,
          notes: body.notes || null,
          userId: req.user!.id,
        },
      });
      if (body.challanIds?.length) await tx.deliveryNote.updateMany({ where: { id: { in: body.challanIds } }, data: { tripId: created.id } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "CREATE_DELIVERY_TRIP", entity: "DeliveryTrip", entityId: created.id, details: `${refNo}${body.vehicleNo ? ` · ${body.vehicleNo}` : ""} · paid ₨${body.freightPaid}` } });
      return created;
    });

    const full = await prisma.deliveryTrip.findUnique({ where: { id: trip.id }, include: tripInclude });
    res.status(201).json({ ok: true, data: { trip: withMargin(full) } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** DELETE /delivery-trips/:id — remove a trip; reverses its freight expense and detaches challans. */
router.delete("/:id", requirePermission("expenses.create"), async (req, res, next) => {
  try {
    const trip = await prisma.deliveryTrip.findUnique({ where: { id: req.params.id }, select: { id: true, refNo: true, expenseId: true } });
    if (!trip) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Trip not found" } });

    await prisma.$transaction(async (tx) => {
      await tx.deliveryNote.updateMany({ where: { tripId: trip.id }, data: { tripId: null } });
      if (trip.expenseId) {
        const exp = await tx.expense.findUnique({ where: { id: trip.expenseId }, include: { payment: true } });
        await tx.deliveryTrip.update({ where: { id: trip.id }, data: { expenseId: null } }); // unlink so the expense can be removed
        if (exp?.payment) {
          const entries = await tx.accountEntry.findMany({ where: { refType: "Payment", refId: exp.payment.id } });
          for (const e of entries) {
            await tx.paymentMethod.update({ where: { id: e.accountId }, data: { currentBalance: { decrement: e.amount } } });
            await tx.accountEntry.delete({ where: { id: e.id } });
          }
          await tx.payment.delete({ where: { id: exp.payment.id } });
        }
        if (exp) await tx.expense.delete({ where: { id: exp.id } });
      }
      await tx.deliveryTrip.delete({ where: { id: trip.id } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "DELETE_DELIVERY_TRIP", entity: "DeliveryTrip", entityId: trip.id, details: trip.refNo } });
    });
    res.json({ ok: true, data: { message: `${trip.refNo} deleted` } });
  } catch (err) {
    next(err);
  }
});

export default router;
