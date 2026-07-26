/**
 * Expenses (Phase 4). Every expense is money out of an account AND a hit to Net Profit
 * for its date. Recording one is ONE transaction: Expense + Payment(EXPENSE) (via
 * postPayment, which also moves the account balance) + AuditLog. Salary-driven expenses
 * are created by the salaries module and can only be removed by deleting the salary.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { nextNumber } from "../utils/counter";
import { postPayment } from "../lib/accounts";
import { runRecurringExpenses } from "../lib/recurring";

const router = Router();
router.use(requireAuth);

const money = (v: number) => new Prisma.Decimal(v).toDecimalPlaces(2);

// ─────────────────────────── EXPENSE CATEGORIES ───────────────────────────

/** GET /expenses/categories */
router.get("/categories", requirePermission("expenses.view"), async (_req, res, next) => {
  try {
    const categories = await prisma.expenseCategory.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { expenses: true } } } });
    res.json({ ok: true, data: { categories } });
  } catch (err) {
    next(err);
  }
});

/** POST /expenses/categories */
router.post("/categories", requirePermission("expenses.edit"), async (req, res, next) => {
  try {
    const name = z.string().trim().min(1, "Name is required").max(60).parse(req.body?.name);
    const category = await prisma.expenseCategory.create({ data: { name } });
    res.status(201).json({ ok: true, data: { category } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err?.code === "P2002") return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: "That category already exists" } });
    next(err);
  }
});

/** DELETE /expenses/categories/:id — blocked if it still has expenses */
router.delete("/categories/:id", requirePermission("expenses.edit"), async (req, res, next) => {
  try {
    const cat = await prisma.expenseCategory.findUnique({ where: { id: req.params.id }, include: { _count: { select: { expenses: true } } } });
    if (!cat) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Category not found" } });
    if (cat.name === "Salaries") return res.status(409).json({ ok: false, error: { code: "CONFLICT", message: "The Salaries category is used by payroll and can't be removed" } });
    if (cat._count.expenses > 0) return res.status(409).json({ ok: false, error: { code: "CONFLICT", message: `${cat.name} still has ${cat._count.expenses} expenses` } });
    await prisma.expenseCategory.delete({ where: { id: cat.id } });
    res.json({ ok: true, data: { message: `${cat.name} deleted` } });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────── RECURRING EXPENSES (A1) ───────────────────────────
// Rules that a daily/boot sweep turns into real Expenses once a month. Defined before
// the generic /:id expense routes so "recurring" is never captured as an expense id.

const recurringInclude = {
  category: { select: { id: true, name: true } },
  method: { select: { id: true, name: true } },
  _count: { select: { generated: true } },
} satisfies Prisma.RecurringExpenseInclude;

const recurringSchema = z.object({
  categoryId: z.string().min(1, "Pick a category"),
  methodId: z.string().min(1, "Pick which account pays"),
  amount: z.coerce.number().positive("Amount must be more than 0"),
  dayOfMonth: z.coerce.number().int().min(1).max(28).default(1), // cap at 28 → valid every month
  notes: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

/** GET /expenses/recurring — list rules */
router.get("/recurring", requirePermission("expenses.view"), async (_req, res, next) => {
  try {
    const rules = await prisma.recurringExpense.findMany({ include: recurringInclude, orderBy: [{ isActive: "desc" }, { dayOfMonth: "asc" }] });
    res.json({ ok: true, data: { rules } });
  } catch (err) {
    next(err);
  }
});

/** POST /expenses/recurring — create a rule */
router.post("/recurring", requirePermission("expenses.edit"), async (req, res, next) => {
  try {
    const body = recurringSchema.parse(req.body);
    const [category, method] = await Promise.all([
      prisma.expenseCategory.findUnique({ where: { id: body.categoryId }, select: { id: true } }),
      prisma.paymentMethod.findUnique({ where: { id: body.methodId }, select: { id: true } }),
    ]);
    if (!category) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Unknown category" } });
    if (!method) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Unknown account" } });
    const created = await prisma.recurringExpense.create({
      data: { categoryId: body.categoryId, methodId: body.methodId, amount: money(body.amount), dayOfMonth: body.dayOfMonth, notes: body.notes || null, isActive: body.isActive ?? true },
      include: recurringInclude,
    });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "CREATE_RECURRING_EXPENSE", entity: "RecurringExpense", entityId: created.id, details: `${created.category.name} · ₨${body.amount} · day ${body.dayOfMonth}` } });
    res.status(201).json({ ok: true, data: { rule: created } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** PATCH /expenses/recurring/:id — edit rule (amount/day/category/account/notes/active) */
router.patch("/recurring/:id", requirePermission("expenses.edit"), async (req, res, next) => {
  try {
    const body = recurringSchema.partial().parse(req.body);
    const existing = await prisma.recurringExpense.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Rule not found" } });
    const updated = await prisma.recurringExpense.update({
      where: { id: existing.id },
      data: {
        categoryId: body.categoryId,
        methodId: body.methodId,
        amount: body.amount === undefined ? undefined : money(body.amount),
        dayOfMonth: body.dayOfMonth,
        notes: body.notes === undefined ? undefined : body.notes || null,
        isActive: body.isActive,
      },
      include: recurringInclude,
    });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "UPDATE_RECURRING_EXPENSE", entity: "RecurringExpense", entityId: updated.id, details: updated.category.name } });
    res.json({ ok: true, data: { rule: updated } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** DELETE /expenses/recurring/:id — removes the rule; already-posted expenses are kept (recurringId → null). */
router.delete("/recurring/:id", requirePermission("expenses.edit"), async (req, res, next) => {
  try {
    const rule = await prisma.recurringExpense.findUnique({ where: { id: req.params.id }, select: { id: true, category: { select: { name: true } } } });
    if (!rule) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Rule not found" } });
    await prisma.recurringExpense.delete({ where: { id: rule.id } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "DELETE_RECURRING_EXPENSE", entity: "RecurringExpense", entityId: rule.id, details: rule.category.name } });
    res.json({ ok: true, data: { message: "Recurring rule removed" } });
  } catch (err) {
    next(err);
  }
});

/** POST /expenses/recurring/run — post everything due right now ("Run due now"). Safe to click any time. */
router.post("/recurring/run", requirePermission("expenses.create"), async (req, res, next) => {
  try {
    const posted = await runRecurringExpenses(req.user!.id);
    res.json({ ok: true, data: { posted, count: posted.length } });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────── EXPENSES ───────────────────────────

const expenseInclude = {
  category: { select: { id: true, name: true } },
  user: { select: { name: true } },
  payment: { select: { id: true, method: { select: { name: true } } } },
} satisfies Prisma.ExpenseInclude;

/** GET /expenses?page&limit&categoryId&from&to&search */
router.get("/", requirePermission("expenses.view"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const categoryId = String(req.query.categoryId ?? "");
    const search = String(req.query.search ?? "").trim();
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    const where: Prisma.ExpenseWhereInput = {};
    if (categoryId) where.categoryId = categoryId;
    if (search) where.OR = [{ refNo: { contains: search, mode: "insensitive" } }, { notes: { contains: search, mode: "insensitive" } }];
    if (from || to) where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const [expenses, total, sums] = await Promise.all([
      prisma.expense.findMany({ where, include: expenseInclude, orderBy: { date: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.expense.count({ where }),
      prisma.expense.aggregate({ _sum: { amount: true }, where }),
    ]);
    res.json({ ok: true, data: { expenses, total, page, pages: Math.max(1, Math.ceil(total / limit)), totalAmount: sums._sum.amount ?? 0 } });
  } catch (err) {
    next(err);
  }
});

const expenseSchema = z.object({
  categoryId: z.string().min(1, "Pick a category"),
  methodId: z.string().min(1, "Pick which account paid"),
  amount: z.coerce.number().positive("Amount must be more than 0"),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

/** POST /expenses — record an expense (money out + P&L hit) */
router.post("/", requirePermission("expenses.create"), async (req, res, next) => {
  try {
    const body = expenseSchema.parse(req.body);
    const [category, method] = await Promise.all([
      prisma.expenseCategory.findUnique({ where: { id: body.categoryId }, select: { id: true, name: true } }),
      prisma.paymentMethod.findUnique({ where: { id: body.methodId }, select: { id: true } }),
    ]);
    if (!category) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Unknown category" } });
    if (!method) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Unknown account" } });

    const expense = await prisma.$transaction(async (tx) => {
      const refNo = await nextNumber(tx, "expense", "EXP");
      const created = await tx.expense.create({ data: { refNo, categoryId: body.categoryId, amount: money(body.amount), notes: body.notes || null, userId: req.user!.id, ...(body.date ? { date: body.date } : {}) } });
      await postPayment(tx, { type: "EXPENSE", methodId: body.methodId, amount: body.amount, expenseId: created.id, userId: req.user!.id, notes: body.notes || `${category.name} expense`, date: body.date });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "CREATE_EXPENSE", entity: "Expense", entityId: created.id, details: `${refNo} · ${category.name} · ₨${body.amount}` } });
      return created;
    });
    const full = await prisma.expense.findUnique({ where: { id: expense.id }, include: expenseInclude });
    res.status(201).json({ ok: true, data: { expense: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

const editSchema = z.object({
  categoryId: z.string().min(1).optional(),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

/** PATCH /expenses/:id — fix category/date/notes (amount & account are immutable; delete + re-add to change them) */
router.patch("/:id", requirePermission("expenses.edit"), async (req, res, next) => {
  try {
    const body = editSchema.parse(req.body);
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id }, include: { payment: true } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Expense not found" } });

    const expense = await prisma.$transaction(async (tx) => {
      const updated = await tx.expense.update({
        where: { id: existing.id },
        data: { categoryId: body.categoryId, date: body.date, notes: body.notes === undefined ? undefined : body.notes || null },
      });
      // Keep the linked cash movement's date in step with the expense date.
      if (body.date && existing.payment) {
        await tx.payment.update({ where: { id: existing.payment.id }, data: { date: body.date } });
        await tx.accountEntry.updateMany({ where: { refType: "Payment", refId: existing.payment.id }, data: { date: body.date } });
      }
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "UPDATE_EXPENSE", entity: "Expense", entityId: updated.id, details: updated.refNo } });
      return updated;
    });
    const full = await prisma.expense.findUnique({ where: { id: expense.id }, include: expenseInclude });
    res.json({ ok: true, data: { expense: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/**
 * DELETE /expenses/:id — a correction tool. Reverses the account movement and removes
 * the expense + its payment (audit-logged). Salary expenses must be removed via the
 * salary record, so they're blocked here.
 */
router.delete("/:id", requirePermission("expenses.edit"), async (req, res, next) => {
  try {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id }, include: { payment: true } });
    if (!expense) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Expense not found" } });
    const salary = await prisma.salaryPayment.findFirst({ where: { expenseId: expense.id }, select: { refNo: true } });
    if (salary) return res.status(409).json({ ok: false, error: { code: "CONFLICT", message: `This is salary ${salary.refNo} — delete it from the employee's salary history instead` } });

    await prisma.$transaction(async (tx) => {
      if (expense.payment) {
        // Roll the money back onto the account, then remove the ledger row + payment.
        const entries = await tx.accountEntry.findMany({ where: { refType: "Payment", refId: expense.payment.id } });
        for (const e of entries) {
          await tx.paymentMethod.update({ where: { id: e.accountId }, data: { currentBalance: { decrement: e.amount } } });
          await tx.accountEntry.delete({ where: { id: e.id } });
        }
        await tx.payment.delete({ where: { id: expense.payment.id } });
      }
      await tx.expense.delete({ where: { id: expense.id } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "DELETE_EXPENSE", entity: "Expense", entityId: expense.id, details: `${expense.refNo} · ₨${expense.amount}` } });
    });
    res.json({ ok: true, data: { message: `${expense.refNo} deleted` } });
  } catch (err) {
    next(err);
  }
});

export default router;
