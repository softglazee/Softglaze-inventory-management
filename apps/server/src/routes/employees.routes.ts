/**
 * Employees & Salaries (Phase 4, docs/09 §2). Paying a salary is ONE transaction:
 * SalaryPayment + Expense (category "Salaries") + Payment(EXPENSE) (via postPayment,
 * which moves the account) — so P&L and the cash book stay correct automatically.
 * One salary per employee per month is enforced by a DB unique constraint.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { nextNumber } from "../utils/counter";
import { postPayment } from "../lib/accounts";
import { imageUpload, saveImage, deleteImageFiles } from "../lib/upload";

const router = Router();
router.use(requireAuth);

const money = (v: number) => new Prisma.Decimal(v).toDecimalPlaces(2);
const round2 = (v: number) => Math.round(v * 100) / 100;

const employeeInclude = {
  department: { select: { id: true, name: true } },
  shift: { select: { id: true, name: true } },
} satisfies Prisma.EmployeeInclude;

const employeeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().max(25).nullable().optional(),
  cnic: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  designation: z.string().trim().max(60).nullable().optional(),
  departmentId: z.string().nullable().optional(),
  shiftId: z.string().nullable().optional(),
  joinDate: z.coerce.date().optional(),
  baseSalary: z.coerce.number().min(0, "Salary cannot be negative").default(0),
  notes: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
});

/** GET /employees?search&status */
router.get("/", requirePermission("employees.view"), async (req, res, next) => {
  try {
    const search = String(req.query.search ?? "").trim();
    const status = String(req.query.status ?? "");
    const where: Prisma.EmployeeWhereInput = {};
    if (search) where.OR = [{ name: { contains: search, mode: "insensitive" } }, { code: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }];
    if (status === "active") where.isActive = true;
    if (status === "inactive") where.isActive = false;
    const employees = await prisma.employee.findMany({ where, include: employeeInclude, orderBy: { name: "asc" } });
    res.json({ ok: true, data: { employees } });
  } catch (err) {
    next(err);
  }
});

/** GET /employees/salaries?month&employeeId — salary history across staff */
router.get("/salaries", requirePermission("employees.view"), async (req, res, next) => {
  try {
    const month = String(req.query.month ?? "");
    const employeeId = String(req.query.employeeId ?? "");
    const where: Prisma.SalaryPaymentWhereInput = {};
    if (month) where.month = month;
    if (employeeId) where.employeeId = employeeId;
    const [salaries, sums] = await Promise.all([
      prisma.salaryPayment.findMany({ where, include: { employee: { select: { id: true, code: true, name: true } }, user: { select: { name: true } } }, orderBy: { date: "desc" } }),
      prisma.salaryPayment.aggregate({ _sum: { netPaid: true }, where }),
    ]);
    res.json({ ok: true, data: { salaries, totalPaid: sums._sum.netPaid ?? 0 } });
  } catch (err) {
    next(err);
  }
});

/** GET /employees/:id — profile + salary history */
router.get("/:id", requirePermission("employees.view"), async (req, res, next) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id }, include: { ...employeeInclude, salaries: { orderBy: { month: "desc" } } } });
    if (!employee) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
    res.json({ ok: true, data: { employee } });
  } catch (err) {
    next(err);
  }
});

/** POST /employees — code auto EMP-0001 */
router.post("/", requirePermission("employees.manage"), async (req, res, next) => {
  try {
    const body = employeeSchema.parse(req.body);
    const employee = await prisma.$transaction(async (tx) => {
      const code = await nextNumber(tx, "employee", "EMP", 4);
      const created = await tx.employee.create({
        data: {
          code, name: body.name, phone: body.phone || null, cnic: body.cnic || null, address: body.address || null,
          designation: body.designation || null, departmentId: body.departmentId || null, shiftId: body.shiftId || null,
          baseSalary: money(body.baseSalary), notes: body.notes || null, ...(body.joinDate ? { joinDate: body.joinDate } : {}),
        },
      });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "CREATE_EMPLOYEE", entity: "Employee", entityId: created.id, details: `${code} ${created.name}` } });
      return created;
    });
    const full = await prisma.employee.findUnique({ where: { id: employee.id }, include: employeeInclude });
    res.status(201).json({ ok: true, data: { employee: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** PATCH /employees/:id */
router.patch("/:id", requirePermission("employees.manage"), async (req, res, next) => {
  try {
    const body = employeeSchema.partial().parse(req.body);
    const existing = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
    const employee = await prisma.employee.update({
      where: { id: existing.id },
      data: {
        name: body.name,
        phone: body.phone === undefined ? undefined : body.phone || null,
        cnic: body.cnic === undefined ? undefined : body.cnic || null,
        address: body.address === undefined ? undefined : body.address || null,
        designation: body.designation === undefined ? undefined : body.designation || null,
        departmentId: body.departmentId === undefined ? undefined : body.departmentId || null,
        shiftId: body.shiftId === undefined ? undefined : body.shiftId || null,
        baseSalary: body.baseSalary === undefined ? undefined : money(body.baseSalary),
        joinDate: body.joinDate,
        notes: body.notes === undefined ? undefined : body.notes || null,
        isActive: body.isActive,
      },
      include: employeeInclude,
    });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "UPDATE_EMPLOYEE", entity: "Employee", entityId: employee.id, details: `${employee.code} ${employee.name}` } });
    res.json({ ok: true, data: { employee } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** POST /employees/:id/photo — upload/replace the staff photo */
router.post("/:id/photo", requirePermission("employees.manage"), imageUpload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "No image uploaded" } });
    const existing = await prisma.employee.findUnique({ where: { id: req.params.id }, select: { id: true, photo: true } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
    const { path } = await saveImage(req.file.buffer, "employees");
    await deleteImageFiles(existing.photo);
    const employee = await prisma.employee.update({ where: { id: existing.id }, data: { photo: path }, include: employeeInclude });
    res.json({ ok: true, data: { employee } });
  } catch (err) {
    next(err);
  }
});

/** DELETE /employees/:id — deactivate when they have salary history, delete when clean */
router.delete("/:id", requirePermission("employees.manage"), async (req, res, next) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id }, include: { _count: { select: { salaries: true } } } });
    if (!employee) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
    if (employee._count.salaries > 0) {
      await prisma.employee.update({ where: { id: employee.id }, data: { isActive: false } });
      await prisma.auditLog.create({ data: { userId: req.user!.id, action: "DEACTIVATE_EMPLOYEE", entity: "Employee", entityId: employee.id, details: employee.name } });
      return res.json({ ok: true, data: { message: `${employee.name} has salary history, so the record was deactivated`, deactivated: true } });
    }
    await deleteImageFiles(employee.photo);
    await prisma.employee.delete({ where: { id: employee.id } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "DELETE_EMPLOYEE", entity: "Employee", entityId: employee.id, details: employee.name } });
    res.json({ ok: true, data: { message: `${employee.name} deleted`, deactivated: false } });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────── STAFF ADVANCES (F5) ───────────────────────────

/** GET /employees/:id/advances?status=open — advances given to an employee. */
router.get("/:id/advances", requirePermission("employees.view"), async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "");
    const where: Prisma.EmployeeAdvanceWhereInput = { employeeId: req.params.id };
    if (status === "open") where.recoveredInId = null;
    const advances = await prisma.employeeAdvance.findMany({ where, include: { method: { select: { name: true } }, recoveredIn: { select: { refNo: true, month: true } } }, orderBy: { date: "desc" } });
    const openTotal = round2(advances.filter((a) => !a.recoveredInId).reduce((s, a) => s + Number(a.amount), 0));
    res.json({ ok: true, data: { advances, openTotal } });
  } catch (err) {
    next(err);
  }
});

const advanceSchema = z.object({
  amount: z.coerce.number().positive("Amount must be more than 0"),
  methodId: z.string().min(1, "Pick which account paid"),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});

/** POST /employees/:id/advance — give a salary advance (cash out; a receivable, not an expense). */
router.post("/:id/advance", requirePermission("salary.pay"), async (req, res, next) => {
  try {
    const body = advanceSchema.parse(req.body);
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
    if (!employee) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
    const method = await prisma.paymentMethod.findUnique({ where: { id: body.methodId }, select: { id: true } });
    if (!method) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Unknown account" } });

    const advance = await prisma.$transaction(async (tx) => {
      const refNo = await nextNumber(tx, "advance", "ADV");
      const payment = await postPayment(tx, { type: "EMPLOYEE_ADVANCE", methodId: body.methodId, amount: body.amount, userId: req.user!.id, notes: `Advance to ${employee.name} (${refNo})`, date: body.date });
      const created = await tx.employeeAdvance.create({ data: { refNo, employeeId: employee.id, amount: money(body.amount), methodId: body.methodId, paymentId: payment.id, userId: req.user!.id, notes: body.notes || null, ...(body.date ? { date: body.date } : {}) } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "GIVE_ADVANCE", entity: "EmployeeAdvance", entityId: created.id, details: `${refNo} · ${employee.name} · ₨${body.amount}` } });
      return created;
    });
    const full = await prisma.employeeAdvance.findUnique({ where: { id: advance.id }, include: { method: { select: { name: true } } } });
    res.status(201).json({ ok: true, data: { advance: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** DELETE /employees/advances/:id — reverse an OPEN advance (returns the cash). */
router.delete("/advances/:id", requirePermission("salary.pay"), async (req, res, next) => {
  try {
    const advance = await prisma.employeeAdvance.findUnique({ where: { id: req.params.id }, select: { id: true, refNo: true, paymentId: true, recoveredInId: true } });
    if (!advance) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Advance not found" } });
    if (advance.recoveredInId) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "This advance was already recovered in a salary — reverse that salary first" } });
    await prisma.$transaction(async (tx) => {
      if (advance.paymentId) {
        const entries = await tx.accountEntry.findMany({ where: { refType: "Payment", refId: advance.paymentId } });
        for (const e of entries) {
          await tx.paymentMethod.update({ where: { id: e.accountId }, data: { currentBalance: { decrement: e.amount } } });
          await tx.accountEntry.delete({ where: { id: e.id } });
        }
        await tx.employeeAdvance.update({ where: { id: advance.id }, data: { paymentId: null } });
        await tx.payment.delete({ where: { id: advance.paymentId } });
      }
      await tx.employeeAdvance.delete({ where: { id: advance.id } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "DELETE_ADVANCE", entity: "EmployeeAdvance", entityId: advance.id, details: advance.refNo } });
    });
    res.json({ ok: true, data: { message: `${advance.refNo} reversed` } });
  } catch (err) {
    next(err);
  }
});

/** GET /employees/:id/salary-preview?month=YYYY-MM — attendance + open advances to prefill the salary form. */
router.get("/:id/salary-preview", requirePermission("salary.pay"), async (req, res, next) => {
  try {
    const month = String(req.query.month ?? "");
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "month must look like 2026-07" } });
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id }, select: { id: true, baseSalary: true } });
    if (!employee) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
    const [y, m] = month.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const [grouped, already, openAdvances] = await Promise.all([
      prisma.attendance.groupBy({ by: ["status"], where: { employeeId: employee.id, date: { gte: from, lte: to } }, _count: { _all: true } }),
      prisma.salaryPayment.findUnique({ where: { employeeId_month: { employeeId: employee.id, month } }, select: { refNo: true } }),
      prisma.employeeAdvance.findMany({ where: { employeeId: employee.id, recoveredInId: null }, select: { id: true, refNo: true, amount: true, date: true }, orderBy: { date: "asc" } }),
    ]);
    const c = { present: 0, absent: 0, half: 0, leave: 0 };
    for (const g of grouped) {
      if (g.status === "PRESENT") c.present = g._count._all;
      else if (g.status === "ABSENT") c.absent = g._count._all;
      else if (g.status === "HALF_DAY") c.half = g._count._all;
      else if (g.status === "LEAVE") c.leave = g._count._all;
    }
    const base = Number(employee.baseSalary);
    const perDay = days > 0 ? base / days : 0;
    const suggestedAbsentDeduction = round2((c.absent + 0.5 * c.half) * perDay);
    const openAdvanceTotal = round2(openAdvances.reduce((s, a) => s + Number(a.amount), 0));
    res.json({ ok: true, data: { month, base: round2(base), daysInMonth: days, perDay: round2(perDay), attendance: c, suggestedAbsentDeduction, openAdvances, openAdvanceTotal, alreadyPaid: already?.refNo ?? null } });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────── SALARY PAYMENTS ───────────────────────────

const salarySchema = z.object({
  month: z.string().trim().regex(/^\d{4}-\d{2}$/, "Month must look like 2026-07"),
  methodId: z.string().min(1, "Pick which account paid"),
  bonus: z.coerce.number().min(0).default(0),
  deduction: z.coerce.number().min(0).default(0),       // other/penalty deduction (reduces the wage)
  absentDeduction: z.coerce.number().min(0).default(0), // docked for absent/half days (reduces the wage)
  advanceIds: z.array(z.string().min(1)).default([]),   // open advances to recover with this salary
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

/**
 * POST /employees/:id/salary — pay one month's salary.
 * Wage expense = base + bonus − other deduction − absent deduction (the earned pay).
 * Recovered advances are NOT an expense (they were cash out already) — they only reduce
 * the cash paid now: netPaid = earned − advancesRecovered, and each recovered advance is
 * marked cleared. One transaction: Expense(earned) + Payment(EXPENSE, netPaid) + salary row.
 */
router.post("/:id/salary", requirePermission("salary.pay"), async (req, res, next) => {
  try {
    const body = salarySchema.parse(req.body);
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, baseSalary: true, isActive: true } });
    if (!employee) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
    const method = await prisma.paymentMethod.findUnique({ where: { id: body.methodId }, select: { id: true } });
    if (!method) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Unknown account" } });

    const already = await prisma.salaryPayment.findUnique({ where: { employeeId_month: { employeeId: employee.id, month: body.month } }, select: { refNo: true } });
    if (already) return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: `${employee.name} was already paid for ${body.month} (${already.refNo})` } });

    const base = Number(employee.baseSalary);
    const earned = round2(base + body.bonus - body.deduction - body.absentDeduction); // wage expense
    if (earned <= 0) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Earned pay must be more than 0 (deductions are too large)" } });

    // Resolve the advances to recover (must be this employee's still-open advances).
    let advanceRecovered = 0;
    let advances: { id: string; amount: Prisma.Decimal }[] = [];
    if (body.advanceIds.length) {
      advances = await prisma.employeeAdvance.findMany({ where: { id: { in: body.advanceIds }, employeeId: employee.id, recoveredInId: null }, select: { id: true, amount: true } });
      if (advances.length !== body.advanceIds.length) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "One of the advances is not open for this employee" } });
      advanceRecovered = round2(advances.reduce((s, a) => s + Number(a.amount), 0));
    }
    if (advanceRecovered > earned + 0.01) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Advances to recover exceed this month's earned pay — recover fewer" } });
    const netPaid = round2(earned - advanceRecovered);

    const salary = await prisma.$transaction(async (tx) => {
      const salariesCat = await tx.expenseCategory.upsert({ where: { name: "Salaries" }, create: { name: "Salaries" }, update: {} });
      const expRefNo = await nextNumber(tx, "expense", "EXP");
      const expense = await tx.expense.create({ data: { refNo: expRefNo, categoryId: salariesCat.id, amount: money(earned), notes: `Salary ${body.month} — ${employee.name}`, userId: req.user!.id, ...(body.date ? { date: body.date } : {}) } });
      // Only move cash for the net amount; a fully-recovered salary pays no cash.
      if (netPaid > 0) await postPayment(tx, { type: "EXPENSE", methodId: body.methodId, amount: netPaid, expenseId: expense.id, userId: req.user!.id, notes: `Salary ${body.month} — ${employee.name}`, date: body.date });
      const salRefNo = await nextNumber(tx, "salary", "SAL");
      const created = await tx.salaryPayment.create({
        data: { refNo: salRefNo, employeeId: employee.id, month: body.month, baseAmount: money(base), bonus: money(body.bonus), deduction: money(body.deduction), absentDeduction: money(body.absentDeduction), advanceRecovered: money(advanceRecovered), netPaid: money(netPaid), expenseId: expense.id, userId: req.user!.id, notes: body.notes || null, ...(body.date ? { date: body.date } : {}) },
      });
      if (advances.length) await tx.employeeAdvance.updateMany({ where: { id: { in: advances.map((a) => a.id) } }, data: { recoveredInId: created.id } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "PAY_SALARY", entity: "SalaryPayment", entityId: created.id, details: `${salRefNo} · ${employee.name} · ${body.month} · earned ₨${earned} · paid ₨${netPaid}${advanceRecovered > 0 ? ` · advance ₨${advanceRecovered}` : ""}` } });
      return created;
    });
    const full = await prisma.salaryPayment.findUnique({ where: { id: salary.id }, include: { employee: { select: { id: true, code: true, name: true } } } });
    res.status(201).json({ ok: true, data: { salary: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err?.code === "P2002") return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: "That employee is already paid for this month" } });
    next(err);
  }
});

/** DELETE /employees/salaries/:id — reverse a salary (removes its Expense + cash movement) */
router.delete("/salaries/:id", requirePermission("salary.pay"), async (req, res, next) => {
  try {
    const salary = await prisma.salaryPayment.findUnique({ where: { id: req.params.id }, select: { id: true, refNo: true, expenseId: true } });
    if (!salary) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Salary record not found" } });

    await prisma.$transaction(async (tx) => {
      // Reopen any advances this salary had recovered — they were never un-given.
      await tx.employeeAdvance.updateMany({ where: { recoveredInId: salary.id }, data: { recoveredInId: null } });
      if (salary.expenseId) {
        const payment = await tx.payment.findFirst({ where: { expenseId: salary.expenseId }, select: { id: true } });
        if (payment) {
          const entries = await tx.accountEntry.findMany({ where: { refType: "Payment", refId: payment.id } });
          for (const e of entries) {
            await tx.paymentMethod.update({ where: { id: e.accountId }, data: { currentBalance: { decrement: e.amount } } });
            await tx.accountEntry.delete({ where: { id: e.id } });
          }
          // Unlink then remove so the expense's unique FK is free
          await tx.salaryPayment.update({ where: { id: salary.id }, data: { expenseId: null } });
          await tx.payment.delete({ where: { id: payment.id } });
        }
        await tx.expense.delete({ where: { id: salary.expenseId } });
      }
      await tx.salaryPayment.delete({ where: { id: salary.id } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "DELETE_SALARY", entity: "SalaryPayment", entityId: salary.id, details: salary.refNo } });
    });
    res.json({ ok: true, data: { message: `${salary.refNo} reversed` } });
  } catch (err) {
    next(err);
  }
});

export default router;
