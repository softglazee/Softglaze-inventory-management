/**
 * Accounts & Fund Transfers (Phase 4, G1). PaymentMethod IS a money account:
 * Cash drawer, bank accounts, mobile wallets, card. currentBalance is a cache kept
 * in sync by the AccountEntry ledger (lib/accounts.ts). Transfers move money between
 * accounts (paired ledger entries); capital/drawings move owner money in/out (equity,
 * never P&L). Every write is one prisma.$transaction.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { nextNumber } from "../utils/counter";
import { postToAccount } from "../lib/accounts";

const router = Router();
router.use(requireAuth);

const money = (v: number) => new Prisma.Decimal(v).toDecimalPlaces(2);

const accountSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  isCash: z.boolean().optional(),
  accountNo: z.string().trim().max(60).nullable().optional(),
  bankName: z.string().trim().max(80).nullable().optional(),
  openingBalance: z.coerce.number().default(0),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().optional(),
});

/** GET /accounts — all money accounts with live balances + grand total */
router.get("/", requirePermission("accounts.view"), async (_req, res, next) => {
  try {
    const accounts = await prisma.paymentMethod.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    const totalCash = accounts.filter((a) => a.isActive).reduce((s, a) => s + Number(a.currentBalance), 0);
    res.json({ ok: true, data: { accounts, totalCash: money(totalCash) } });
  } catch (err) {
    next(err);
  }
});

/** GET /accounts/:id/statement?from&to — per-account ledger with running balance */
router.get("/:id/statement", requirePermission("accounts.view"), async (req, res, next) => {
  try {
    const account = await prisma.paymentMethod.findUnique({ where: { id: req.params.id } });
    if (!account) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Account not found" } });
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    // Opening = account opening balance + everything before the period start
    const prior = from
      ? await prisma.accountEntry.aggregate({ _sum: { amount: true }, where: { accountId: account.id, date: { lt: from } } })
      : { _sum: { amount: null as Prisma.Decimal | null } };
    let running = Number(account.openingBalance) + Number(prior._sum.amount ?? 0);
    const opening = running;

    const entries = await prisma.accountEntry.findMany({
      where: { accountId: account.id, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
    const rows = entries.map((e) => {
      running = Math.round((running + Number(e.amount)) * 100) / 100;
      return { ...e, running: money(running) };
    });
    const totalIn = money(rows.filter((r) => Number(r.amount) > 0).reduce((s, r) => s + Number(r.amount), 0));
    const totalOut = money(rows.filter((r) => Number(r.amount) < 0).reduce((s, r) => s - Number(r.amount), 0));
    res.json({ ok: true, data: { account, opening: money(opening), closing: money(running), totalIn, totalOut, entries: rows } });
  } catch (err) {
    next(err);
  }
});

/** POST /accounts — create a money account (openingBalance seeds currentBalance) */
router.post("/", requirePermission("accounts.manage"), async (req, res, next) => {
  try {
    const body = accountSchema.parse(req.body);
    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.paymentMethod.create({
        data: {
          name: body.name,
          isCash: body.isCash ?? false,
          accountNo: body.accountNo || null,
          bankName: body.bankName || null,
          openingBalance: money(body.openingBalance),
          currentBalance: money(body.openingBalance),
          sortOrder: body.sortOrder,
        },
      });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "CREATE_ACCOUNT", entity: "PaymentMethod", entityId: created.id, details: `${created.name} · opening ₨${body.openingBalance}` } });
      return created;
    });
    res.status(201).json({ ok: true, data: { account } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err?.code === "P2002") return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: "An account with that name already exists" } });
    next(err);
  }
});

/** PATCH /accounts/:id — editing openingBalance shifts currentBalance by the same delta */
router.patch("/:id", requirePermission("accounts.manage"), async (req, res, next) => {
  try {
    const body = accountSchema.partial().parse(req.body);
    const existing = await prisma.paymentMethod.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Account not found" } });

    const account = await prisma.$transaction(async (tx) => {
      const delta = body.openingBalance !== undefined ? body.openingBalance - Number(existing.openingBalance) : 0;
      const updated = await tx.paymentMethod.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          isCash: body.isCash,
          accountNo: body.accountNo === undefined ? undefined : body.accountNo || null,
          bankName: body.bankName === undefined ? undefined : body.bankName || null,
          openingBalance: body.openingBalance === undefined ? undefined : money(body.openingBalance),
          currentBalance: delta !== 0 ? { increment: money(delta) } : undefined,
          sortOrder: body.sortOrder,
          isActive: body.isActive,
        },
      });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "UPDATE_ACCOUNT", entity: "PaymentMethod", entityId: updated.id, details: updated.name } });
      return updated;
    });
    res.json({ ok: true, data: { account } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err?.code === "P2002") return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: "An account with that name already exists" } });
    next(err);
  }
});

/** DELETE /accounts/:id — deactivate when used, delete when clean, block if balance ≠ 0 */
router.delete("/:id", requirePermission("accounts.manage"), async (req, res, next) => {
  try {
    const account = await prisma.paymentMethod.findUnique({ where: { id: req.params.id }, include: { _count: { select: { payments: true, entries: true, transfersIn: true, transfersOut: true, capitalEntries: true } } } });
    if (!account) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Account not found" } });
    if (Number(account.currentBalance) !== 0) {
      return res.status(409).json({ ok: false, error: { code: "CONFLICT", message: `${account.name} still holds ₨${account.currentBalance} — transfer it out first` } });
    }
    const used = account._count.payments + account._count.entries + account._count.transfersIn + account._count.transfersOut + account._count.capitalEntries;
    if (used > 0) {
      await prisma.paymentMethod.update({ where: { id: account.id }, data: { isActive: false } });
      await prisma.auditLog.create({ data: { userId: req.user!.id, action: "DEACTIVATE_ACCOUNT", entity: "PaymentMethod", entityId: account.id, details: account.name } });
      return res.json({ ok: true, data: { message: `${account.name} has history, so it was deactivated`, deactivated: true } });
    }
    await prisma.paymentMethod.delete({ where: { id: account.id } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "DELETE_ACCOUNT", entity: "PaymentMethod", entityId: account.id, details: account.name } });
    res.json({ ok: true, data: { message: `${account.name} deleted`, deactivated: false } });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────── FUND TRANSFERS ───────────────────────────

const transferSchema = z.object({
  fromAccountId: z.string().min(1, "Pick the source account"),
  toAccountId: z.string().min(1, "Pick the destination account"),
  amount: z.coerce.number().positive("Amount must be more than 0"),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});

/** GET /accounts/transfers/list — recent fund transfers */
router.get("/transfers/list", requirePermission("accounts.view"), async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const transfers = await prisma.fundTransfer.findMany({
      include: { fromAccount: { select: { name: true } }, toAccount: { select: { name: true } }, user: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: limit,
    });
    res.json({ ok: true, data: { transfers } });
  } catch (err) {
    next(err);
  }
});

/** POST /accounts/transfer — move money between two accounts (no P&L effect) */
router.post("/transfer", requirePermission("accounts.manage"), async (req, res, next) => {
  try {
    const body = transferSchema.parse(req.body);
    if (body.fromAccountId === body.toAccountId) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Choose two different accounts" } });
    const both = await prisma.paymentMethod.findMany({ where: { id: { in: [body.fromAccountId, body.toAccountId] } } });
    if (both.length !== 2) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "One of the accounts was not found" } });
    const fromName = both.find((a) => a.id === body.fromAccountId)!.name;
    const toName = both.find((a) => a.id === body.toAccountId)!.name;

    const transfer = await prisma.$transaction(async (tx) => {
      const refNo = await nextNumber(tx, "transfer", "TRN");
      const created = await tx.fundTransfer.create({
        data: { refNo, fromAccountId: body.fromAccountId, toAccountId: body.toAccountId, amount: money(body.amount), userId: req.user!.id, notes: body.notes || null, ...(body.date ? { date: body.date } : {}) },
      });
      await postToAccount(tx, { accountId: body.fromAccountId, amount: -body.amount, type: "TRANSFER_OUT", refType: "FundTransfer", refId: created.id, date: body.date, notes: `Transfer ${refNo} → ${toName}` });
      await postToAccount(tx, { accountId: body.toAccountId, amount: body.amount, type: "TRANSFER_IN", refType: "FundTransfer", refId: created.id, date: body.date, notes: `Transfer ${refNo} ← ${fromName}` });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "FUND_TRANSFER", entity: "FundTransfer", entityId: created.id, details: `${refNo} · ${fromName} → ${toName} · ₨${body.amount}` } });
      return created;
    });
    res.status(201).json({ ok: true, data: { transfer } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

// ─────────────────────────── CAPITAL & DRAWINGS ───────────────────────────

const capitalSchema = z.object({
  direction: z.enum(["CAPITAL_IN", "DRAWING"]),
  accountId: z.string().min(1, "Pick an account"),
  amount: z.coerce.number().positive("Amount must be more than 0"),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});

/** GET /accounts/capital/list — owner deposits & drawings */
router.get("/capital/list", requirePermission("accounts.view"), async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const entries = await prisma.capitalEntry.findMany({
      include: { account: { select: { name: true } }, user: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: limit,
    });
    res.json({ ok: true, data: { entries } });
  } catch (err) {
    next(err);
  }
});

/** POST /accounts/capital — owner capital in / drawing out (affects equity, not P&L) */
router.post("/capital", requirePermission("accounts.manage"), async (req, res, next) => {
  try {
    const body = capitalSchema.parse(req.body);
    const account = await prisma.paymentMethod.findUnique({ where: { id: body.accountId } });
    if (!account) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Account not found" } });
    const isIn = body.direction === "CAPITAL_IN";

    const entry = await prisma.$transaction(async (tx) => {
      const refNo = await nextNumber(tx, isIn ? "capital" : "drawing", isIn ? "CAP" : "DRW");
      const created = await tx.capitalEntry.create({
        data: { refNo, direction: body.direction, accountId: body.accountId, amount: money(body.amount), userId: req.user!.id, notes: body.notes || null, ...(body.date ? { date: body.date } : {}) },
      });
      await postToAccount(tx, { accountId: body.accountId, amount: isIn ? body.amount : -body.amount, type: isIn ? "CAPITAL_IN" : "DRAWING", refType: "CapitalEntry", refId: created.id, date: body.date, notes: `${isIn ? "Capital" : "Drawing"} ${refNo}` });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: isIn ? "CAPITAL_IN" : "DRAWING", entity: "CapitalEntry", entityId: created.id, details: `${refNo} · ${account.name} · ₨${body.amount}` } });
      return created;
    });
    res.status(201).json({ ok: true, data: { entry } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

// ─────────────────────────── H6 · BANK RECONCILIATION ───────────────────────────
// Reconciliation is a memo status only (reconciledAt on an AccountEntry) — it moves no
// money and changes no balance, so the ledgers/balance sheet are untouched.

/** GET /accounts/:id/reconcile?from&to — this account's ledger entries with cleared status. */
router.get("/:id/reconcile", requirePermission("accounts.view"), async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const account = await prisma.paymentMethod.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, currentBalance: true } });
    if (!account) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Account not found" } });
    const entries = await prisma.accountEntry.findMany({
      where: { accountId: account.id, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
      orderBy: { date: "desc" }, take: 1000,
      select: { id: true, date: true, type: true, amount: true, notes: true, reconciledAt: true },
    });
    const clearedSum = Math.round(entries.filter((e) => e.reconciledAt).reduce((s, e) => s + Number(e.amount), 0) * 100) / 100;
    res.json({ ok: true, data: { account, entries, clearedSum } });
  } catch (err) {
    next(err);
  }
});

const reconcileSchema = z.object({ entryIds: z.array(z.string().min(1)).min(1), reconciled: z.boolean() });

/** POST /accounts/reconcile — tick/untick entries as matched to the bank statement. */
router.post("/reconcile", requirePermission("accounts.manage"), async (req, res, next) => {
  try {
    const body = reconcileSchema.parse(req.body);
    const result = await prisma.accountEntry.updateMany({ where: { id: { in: body.entryIds } }, data: { reconciledAt: body.reconciled ? new Date() : null } });
    res.json({ ok: true, data: { updated: result.count } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

export default router;
