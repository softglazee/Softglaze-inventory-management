/**
 * A4 — Promise-to-pay. Soft collections tracking on a customer's receivable. NO money
 * moves here (the udhaar already lives on the customer ledger); this only records the
 * commitment (₨ + date + note) and its outcome (OPEN/KEPT/BROKEN/CANCELLED). The daily
 * sweep (lib/notify) raises a PROMISE_DUE bell once the date passes and it's still OPEN.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";

const router = Router();
router.use(requireAuth);

const money = (v: number) => new Prisma.Decimal(v).toDecimalPlaces(2);

const include = {
  customer: { select: { id: true, code: true, name: true, phone: true, balance: true } },
  user: { select: { name: true } },
} satisfies Prisma.PaymentPromiseInclude;

/** GET /promises?status=&customerId= — list. status "overdue" = OPEN with a past date. */
router.get("/", requirePermission("customers.view"), async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "");
    const customerId = String(req.query.customerId ?? "");
    const where: Prisma.PaymentPromiseWhereInput = {};
    if (customerId) where.customerId = customerId;
    if (status === "overdue") {
      where.status = "OPEN";
      where.promiseDate = { lt: new Date() };
    } else if (status) {
      where.status = status as Prisma.PaymentPromiseWhereInput["status"];
    }
    const promises = await prisma.paymentPromise.findMany({ where, include, orderBy: [{ status: "asc" }, { promiseDate: "asc" }] });
    res.json({ ok: true, data: { promises } });
  } catch (err) {
    next(err);
  }
});

/** GET /promises/summary — header counts */
router.get("/summary", requirePermission("customers.view"), async (_req, res, next) => {
  try {
    const now = new Date();
    const [open, overdue, openAgg] = await Promise.all([
      prisma.paymentPromise.count({ where: { status: "OPEN" } }),
      prisma.paymentPromise.count({ where: { status: "OPEN", promiseDate: { lt: now } } }),
      prisma.paymentPromise.aggregate({ _sum: { amount: true }, where: { status: "OPEN" } }),
    ]);
    res.json({ ok: true, data: { summary: { open, overdue, openAmount: openAgg._sum.amount ?? 0 } } });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  customerId: z.string().min(1, "Pick a customer"),
  amount: z.coerce.number().positive("Amount must be more than 0"),
  promiseDate: z.coerce.date(),
  note: z.string().trim().max(300).nullable().optional(),
});

/** POST /promises — log a new promise */
router.post("/", requirePermission("payments.receive"), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const customer = await prisma.customer.findUnique({ where: { id: body.customerId }, select: { id: true, name: true } });
    if (!customer) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Customer not found" } });
    const created = await prisma.paymentPromise.create({
      data: { customerId: body.customerId, amount: money(body.amount), promiseDate: body.promiseDate, note: body.note || null, userId: req.user!.id },
      include,
    });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "CREATE_PROMISE", entity: "PaymentPromise", entityId: created.id, details: `${customer.name} · ₨${body.amount} by ${body.promiseDate.toLocaleDateString("en-GB")}` } });
    res.status(201).json({ ok: true, data: { promise: created } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

const patchSchema = z.object({
  status: z.enum(["OPEN", "KEPT", "BROKEN", "CANCELLED"]).optional(),
  amount: z.coerce.number().positive().optional(),
  promiseDate: z.coerce.date().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

/** PATCH /promises/:id — change outcome or edit details */
router.patch("/:id", requirePermission("payments.receive"), async (req, res, next) => {
  try {
    const body = patchSchema.parse(req.body);
    const existing = await prisma.paymentPromise.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Promise not found" } });
    const updated = await prisma.paymentPromise.update({
      where: { id: existing.id },
      data: {
        status: body.status,
        amount: body.amount === undefined ? undefined : money(body.amount),
        promiseDate: body.promiseDate,
        note: body.note === undefined ? undefined : body.note || null,
      },
      include,
    });
    // Resolving a promise clears any outstanding bell for it.
    if (body.status && body.status !== "OPEN") {
      await prisma.notification.updateMany({ where: { type: "PROMISE_DUE", entityId: existing.id, isRead: false }, data: { isRead: true } });
    }
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "UPDATE_PROMISE", entity: "PaymentPromise", entityId: updated.id, details: body.status ?? "edited" } });
    res.json({ ok: true, data: { promise: updated } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** DELETE /promises/:id */
router.delete("/:id", requirePermission("payments.receive"), async (req, res, next) => {
  try {
    const p = await prisma.paymentPromise.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!p) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Promise not found" } });
    await prisma.paymentPromise.delete({ where: { id: p.id } });
    await prisma.notification.updateMany({ where: { type: "PROMISE_DUE", entityId: p.id, isRead: false }, data: { isRead: true } });
    res.json({ ok: true, data: { message: "Promise removed" } });
  } catch (err) {
    next(err);
  }
});

export default router;
