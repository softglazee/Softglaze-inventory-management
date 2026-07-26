/**
 * B1+B2 — Day close / shift Z-report. Reconciles the counted cash drawer against the
 * system's cash-account balance for a business day. It POSTS NOTHING to the ledgers —
 * expectedCash is read from the cash accounts' current balance, countedCash comes from a
 * denomination count, and the variance (over/short) is stored as a finding. So day-close
 * never touches integrity. Cash in/out for the day are captured for the Z-report.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma, PaymentType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { nextNumber } from "../utils/counter";

const router = Router();
router.use(requireAuth);

const r2 = (v: number) => Math.round(v * 100) / 100;
const money = (v: number) => new Prisma.Decimal(r2(v)).toDecimalPlaces(2);
const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const CASH_IN: PaymentType[] = ["SALE_RECEIPT", "CUSTOMER_RECEIPT", "REFUND_IN"];

async function cashAccounts() {
  return prisma.paymentMethod.findMany({ where: { isCash: true }, select: { id: true, name: true, currentBalance: true } });
}

/** Day window [00:00, 23:59:59.999] for a given date (local). */
function dayWindow(d: Date) {
  const from = new Date(d); from.setHours(0, 0, 0, 0);
  const to = new Date(d); to.setHours(23, 59, 59, 999);
  return { from, to };
}

/** Cash received / paid out on cash accounts during the day (informational for the Z-report). */
async function dayCashFlow(cashIds: string[], date: Date) {
  const { from, to } = dayWindow(date);
  const rows = await prisma.payment.groupBy({ by: ["type"], _sum: { amount: true }, where: { methodId: { in: cashIds }, date: { gte: from, lte: to } } });
  let cashIn = 0, cashOut = 0;
  for (const r of rows) {
    const amt = num(r._sum.amount);
    if (CASH_IN.includes(r.type)) cashIn = r2(cashIn + amt);
    else cashOut = r2(cashOut + amt);
  }
  return { cashIn, cashOut };
}

/** GET /day-close — history */
router.get("/", requirePermission("accounts.view"), async (_req, res, next) => {
  try {
    const closes = await prisma.dayClose.findMany({ include: { user: { select: { name: true } } }, orderBy: { businessDate: "desc" }, take: 100 });
    res.json({ ok: true, data: { closes } });
  } catch (err) {
    next(err);
  }
});

/** GET /day-close/preview?date=YYYY-MM-DD — expected cash + day flow, without saving */
router.get("/preview", requirePermission("accounts.view"), async (req, res, next) => {
  try {
    const date = req.query.date ? new Date(String(req.query.date)) : new Date();
    const accts = await cashAccounts();
    const expectedCash = r2(accts.reduce((s, a) => s + num(a.currentBalance), 0));
    const { cashIn, cashOut } = await dayCashFlow(accts.map((a) => a.id), date);
    const lastClose = await prisma.dayClose.findFirst({ orderBy: { businessDate: "desc" }, select: { countedCash: true, businessDate: true } });
    res.json({ ok: true, data: { expectedCash, cashIn, cashOut, cashAccounts: accts, suggestedFloat: num(lastClose?.countedCash) } });
  } catch (err) {
    next(err);
  }
});

/** GET /day-close/:id */
router.get("/:id", requirePermission("accounts.view"), async (req, res, next) => {
  try {
    const close = await prisma.dayClose.findUnique({ where: { id: req.params.id }, include: { user: { select: { name: true } } } });
    if (!close) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Day close not found" } });
    res.json({ ok: true, data: { close } });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  businessDate: z.coerce.date().optional(),
  openingFloat: z.coerce.number().min(0).default(0),
  denominations: z.record(z.string(), z.coerce.number().int().min(0)).default({}),
  notes: z.string().trim().max(500).nullable().optional(),
});

/** POST /day-close — reconcile & record the drawer for a day */
router.post("/", requirePermission("accounts.view"), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const date = body.businessDate ?? new Date();
    const accts = await cashAccounts();
    const expectedCash = r2(accts.reduce((s, a) => s + num(a.currentBalance), 0));
    const countedCash = r2(Object.entries(body.denominations).reduce((s, [denom, count]) => s + Number(denom) * Number(count), 0));
    const variance = r2(countedCash - expectedCash);
    const { cashIn, cashOut } = await dayCashFlow(accts.map((a) => a.id), date);

    const close = await prisma.$transaction(async (tx) => {
      const refNo = await nextNumber(tx, "dayclose", "DCL");
      const created = await tx.dayClose.create({
        data: {
          refNo, businessDate: date, userId: req.user!.id,
          openingFloat: money(body.openingFloat), expectedCash: money(expectedCash), countedCash: money(countedCash),
          variance: money(variance), cashIn: money(cashIn), cashOut: money(cashOut),
          denominations: JSON.stringify(body.denominations), notes: body.notes || null,
        },
      });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "DAY_CLOSE", entity: "DayClose", entityId: created.id, details: `${refNo} · counted ₨${countedCash} vs expected ₨${expectedCash} · variance ₨${variance}` } });
      return created;
    });
    const full = await prisma.dayClose.findUnique({ where: { id: close.id }, include: { user: { select: { name: true } } } });
    res.status(201).json({ ok: true, data: { close: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

export default router;
