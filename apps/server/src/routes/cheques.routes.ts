/**
 * Cheques (F1) — post-dated cheque register.
 * RECEIVED: a customer cheque settles their udhaar into "Cheques in Hand" (pending),
 * then CLEARS into a bank account or BOUNCES (receipt reversed, they owe again).
 * ISSUED: mirror for cheques we write to vendors. Every write is one transaction and
 * keeps the account ledger + party balances + balance sheet consistent (integrity-safe).
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { postPayment, postToAccount } from "../lib/accounts";
import { nextNumber } from "../utils/counter";
import { ensureHoldingAccount } from "../lib/cheques";
import { createNotification } from "../lib/notify";

const router = Router();
router.use(requireAuth);

const money = (v: number) => new Prisma.Decimal(v).toDecimalPlaces(2);

const chequeInclude = {
  customer: { select: { id: true, code: true, name: true, phone: true } },
  vendor: { select: { id: true, code: true, name: true, phone: true } },
} satisfies Prisma.ChequeInclude;

const viewPerm = ["payments.receive", "payments.pay_vendor", "reports.view"] as const;

/** GET /cheques?direction&status&from&to */
router.get("/", requirePermission(...viewPerm), async (req, res, next) => {
  try {
    const direction = String(req.query.direction ?? "");
    const status = String(req.query.status ?? "");
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const where: Prisma.ChequeWhereInput = {};
    if (direction === "RECEIVED" || direction === "ISSUED") where.direction = direction;
    if (status) where.status = status as Prisma.ChequeWhereInput["status"];
    if (from || to) where.chequeDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    const cheques = await prisma.cheque.findMany({ where, include: chequeInclude, orderBy: { chequeDate: "asc" } });
    res.json({ ok: true, data: { cheques } });
  } catch (err) {
    next(err);
  }
});

/** GET /cheques/summary — totals for the register cards (in-hand, payable, due soon). */
router.get("/summary", requirePermission(...viewPerm), async (_req, res, next) => {
  try {
    const grp = await prisma.cheque.groupBy({ by: ["direction", "status"], _sum: { amount: true }, _count: { _all: true } });
    const soon = new Date(); soon.setDate(soon.getDate() + 3); soon.setHours(23, 59, 59, 999);
    const dueSoon = await prisma.cheque.count({ where: { status: "PENDING", chequeDate: { lte: soon } } });
    res.json({ ok: true, data: { groups: grp.map((g) => ({ direction: g.direction, status: g.status, count: g._count._all, amount: g._sum.amount ?? "0" })), dueSoon } });
  } catch (err) {
    next(err);
  }
});

const partySchema = {
  bankName: z.string().trim().min(1, "Bank name on the cheque"),
  chequeNo: z.string().trim().min(1, "Cheque number"),
  amount: z.coerce.number().positive("Amount must be more than 0"),
  chequeDate: z.coerce.date(),
  notes: z.string().trim().max(300).nullable().optional(),
};
const receiveSchema = z.object({ customerId: z.string().min(1, "Pick a customer"), ...partySchema });
const issueSchema = z.object({ vendorId: z.string().min(1, "Pick a vendor"), ...partySchema });

/** POST /cheques/receive — a customer hands us a cheque (settles udhaar into Cheques in Hand). */
router.post("/receive", requirePermission("payments.receive"), async (req, res, next) => {
  try {
    const body = receiveSchema.parse(req.body);
    const customer = await prisma.customer.findUnique({ where: { id: body.customerId }, select: { id: true, name: true } });
    if (!customer) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Customer not found" } });
    const cheque = await prisma.$transaction(async (tx) => {
      const holdingId = await ensureHoldingAccount(tx, "RECEIVED");
      const refNo = await nextNumber(tx, "cheque", "CHQ");
      const payment = await postPayment(tx, { type: "CUSTOMER_RECEIPT", methodId: holdingId, amount: body.amount, customerId: customer.id, userId: req.user!.id, notes: `Cheque ${body.chequeNo} from ${customer.name}`, date: body.chequeDate });
      await tx.customer.update({ where: { id: customer.id }, data: { balance: { decrement: money(body.amount) } } });
      const created = await tx.cheque.create({ data: { refNo, direction: "RECEIVED", customerId: customer.id, bankName: body.bankName, chequeNo: body.chequeNo, amount: money(body.amount), chequeDate: body.chequeDate, status: "PENDING", holdingAccountId: holdingId, receiptPaymentId: payment.id, notes: body.notes || null, userId: req.user!.id } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "CHEQUE_RECEIVE", entity: "Cheque", entityId: created.id, details: `${refNo} · ${customer.name} · ₨${body.amount}` } });
      return created;
    });
    const full = await prisma.cheque.findUnique({ where: { id: cheque.id }, include: chequeInclude });
    res.status(201).json({ ok: true, data: { cheque: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** POST /cheques/issue — we write a cheque to a vendor (settles payable into Post-dated Cheques). */
router.post("/issue", requirePermission("payments.pay_vendor"), async (req, res, next) => {
  try {
    const body = issueSchema.parse(req.body);
    const vendor = await prisma.vendor.findUnique({ where: { id: body.vendorId }, select: { id: true, name: true } });
    if (!vendor) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Vendor not found" } });
    const cheque = await prisma.$transaction(async (tx) => {
      const holdingId = await ensureHoldingAccount(tx, "ISSUED");
      const refNo = await nextNumber(tx, "cheque", "CHQ");
      const payment = await postPayment(tx, { type: "VENDOR_PAYMENT", methodId: holdingId, amount: body.amount, vendorId: vendor.id, userId: req.user!.id, notes: `Cheque ${body.chequeNo} to ${vendor.name}`, date: body.chequeDate });
      await tx.vendor.update({ where: { id: vendor.id }, data: { balance: { decrement: money(body.amount) } } });
      const created = await tx.cheque.create({ data: { refNo, direction: "ISSUED", vendorId: vendor.id, bankName: body.bankName, chequeNo: body.chequeNo, amount: money(body.amount), chequeDate: body.chequeDate, status: "PENDING", holdingAccountId: holdingId, receiptPaymentId: payment.id, notes: body.notes || null, userId: req.user!.id } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "CHEQUE_ISSUE", entity: "Cheque", entityId: created.id, details: `${refNo} · ${vendor.name} · ₨${body.amount}` } });
      return created;
    });
    const full = await prisma.cheque.findUnique({ where: { id: cheque.id }, include: chequeInclude });
    res.status(201).json({ ok: true, data: { cheque: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

const clearSchema = z.object({ settledAccountId: z.string().min(1, "Pick the bank account") });

/** POST /cheques/:id/clear — the cheque cleared; move the money to/from a real bank account. */
router.post("/:id/clear", requirePermission("payments.receive", "payments.pay_vendor"), async (req, res, next) => {
  try {
    const body = clearSchema.parse(req.body);
    const cheque = await prisma.cheque.findUnique({ where: { id: req.params.id } });
    if (!cheque) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Cheque not found" } });
    if (cheque.status !== "PENDING") return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Only a pending cheque can be cleared" } });
    const bank = await prisma.paymentMethod.findUnique({ where: { id: body.settledAccountId }, select: { id: true } });
    if (!bank) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Unknown account" } });
    const amt = Number(cheque.amount);
    await prisma.$transaction(async (tx) => {
      if (cheque.direction === "RECEIVED") {
        await postToAccount(tx, { accountId: cheque.holdingAccountId, amount: -amt, type: "TRANSFER_OUT", refType: "Cheque", refId: cheque.id, notes: `Cheque ${cheque.chequeNo} cleared` });
        await postToAccount(tx, { accountId: body.settledAccountId, amount: amt, type: "TRANSFER_IN", refType: "Cheque", refId: cheque.id, notes: `Cheque ${cheque.chequeNo} cleared` });
      } else {
        await postToAccount(tx, { accountId: body.settledAccountId, amount: -amt, type: "TRANSFER_OUT", refType: "Cheque", refId: cheque.id, notes: `Cheque ${cheque.chequeNo} cleared` });
        await postToAccount(tx, { accountId: cheque.holdingAccountId, amount: amt, type: "TRANSFER_IN", refType: "Cheque", refId: cheque.id, notes: `Cheque ${cheque.chequeNo} cleared` });
      }
      await tx.cheque.update({ where: { id: cheque.id }, data: { status: "CLEARED", settledAccountId: body.settledAccountId, clearedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "CHEQUE_CLEAR", entity: "Cheque", entityId: cheque.id, details: `${cheque.refNo} · ₨${amt}` } });
    });
    const full = await prisma.cheque.findUnique({ where: { id: cheque.id }, include: chequeInclude });
    res.json({ ok: true, data: { cheque: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** Reverse a pending cheque's receipt/issue (shared by bounce + cancel). */
async function reverseCheque(tx: Prisma.TransactionClient, cheque: Prisma.ChequeGetPayload<{}>, userId: string, status: "BOUNCED" | "CANCELLED") {
  const amt = Number(cheque.amount);
  if (cheque.direction === "RECEIVED") {
    await postPayment(tx, { type: "CUSTOMER_RECEIPT", methodId: cheque.holdingAccountId, amount: -amt, customerId: cheque.customerId, userId, notes: `Cheque ${cheque.chequeNo} ${status.toLowerCase()}` });
    if (cheque.customerId) await tx.customer.update({ where: { id: cheque.customerId }, data: { balance: { increment: money(amt) } } });
  } else {
    await postPayment(tx, { type: "VENDOR_PAYMENT", methodId: cheque.holdingAccountId, amount: -amt, vendorId: cheque.vendorId, userId, notes: `Cheque ${cheque.chequeNo} ${status.toLowerCase()}` });
    if (cheque.vendorId) await tx.vendor.update({ where: { id: cheque.vendorId }, data: { balance: { increment: money(amt) } } });
  }
  await tx.cheque.update({ where: { id: cheque.id }, data: { status } });
  await tx.auditLog.create({ data: { userId, action: `CHEQUE_${status}`, entity: "Cheque", entityId: cheque.id, details: `${cheque.refNo} · ₨${amt}` } });
}

/** POST /cheques/:id/bounce — the cheque bounced; reverse it (party owes again) + alert. */
router.post("/:id/bounce", requirePermission("payments.receive", "payments.pay_vendor"), async (req, res, next) => {
  try {
    const cheque = await prisma.cheque.findUnique({ where: { id: req.params.id }, include: chequeInclude });
    if (!cheque) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Cheque not found" } });
    if (cheque.status !== "PENDING") return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Only a pending cheque can bounce" } });
    await prisma.$transaction((tx) => reverseCheque(tx, cheque, req.user!.id, "BOUNCED"));
    const party = cheque.customer?.name ?? cheque.vendor?.name ?? "";
    createNotification({ type: "CHEQUE_DUE", title: "Cheque bounced", message: `Cheque ${cheque.chequeNo} from/to ${party} for ₨${cheque.amount} bounced — ${cheque.direction === "RECEIVED" ? "customer owes again" : "we owe the vendor again"}`, entity: "Cheque", entityId: cheque.id }).catch(() => {});
    const full = await prisma.cheque.findUnique({ where: { id: cheque.id }, include: chequeInclude });
    res.json({ ok: true, data: { cheque: full } });
  } catch (err) {
    next(err);
  }
});

/** POST /cheques/:id/cancel — cheque torn up / replaced before clearing; reverse it quietly. */
router.post("/:id/cancel", requirePermission("payments.receive", "payments.pay_vendor"), async (req, res, next) => {
  try {
    const cheque = await prisma.cheque.findUnique({ where: { id: req.params.id } });
    if (!cheque) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Cheque not found" } });
    if (cheque.status !== "PENDING") return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Only a pending cheque can be cancelled" } });
    await prisma.$transaction((tx) => reverseCheque(tx, cheque, req.user!.id, "CANCELLED"));
    const full = await prisma.cheque.findUnique({ where: { id: cheque.id }, include: chequeInclude });
    res.json({ ok: true, data: { cheque: full } });
  } catch (err) {
    next(err);
  }
});

export default router;
