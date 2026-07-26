/**
 * Attendance (F5). A daily present/absent/half/leave mark per employee (one per day).
 * No money effect — it only drives the OPTIONAL per-day salary deduction the salary
 * screen suggests. Marks are upserted so re-marking a day just corrects it.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";

const router = Router();
router.use(requireAuth);

/** Normalise any date to UTC midnight so one mark == one calendar day. */
function dayOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
/** Parse "YYYY-MM" into a UTC [from, to] range + the number of days in the month. */
function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to, days };
}

const MONTH_RE = /^\d{4}-\d{2}$/;

/** GET /attendance?month=YYYY-MM&employeeId? — marks in the month (for the register/sheet). */
router.get("/", requirePermission("employees.view"), async (req, res, next) => {
  try {
    const month = String(req.query.month ?? "");
    const employeeId = String(req.query.employeeId ?? "");
    if (!MONTH_RE.test(month)) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "month must look like 2026-07" } });
    const { from, to } = monthRange(month);
    const where: Prisma.AttendanceWhereInput = { date: { gte: from, lte: to } };
    if (employeeId) where.employeeId = employeeId;
    const records = await prisma.attendance.findMany({ where, include: { employee: { select: { id: true, code: true, name: true } } }, orderBy: [{ date: "asc" }] });
    res.json({ ok: true, data: { records } });
  } catch (err) {
    next(err);
  }
});

/** GET /attendance/summary?month=YYYY-MM — per-employee P/A/H/L counts for active staff. */
router.get("/summary", requirePermission("employees.view"), async (req, res, next) => {
  try {
    const month = String(req.query.month ?? "");
    if (!MONTH_RE.test(month)) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "month must look like 2026-07" } });
    const { from, to, days } = monthRange(month);
    const [employees, grouped] = await Promise.all([
      prisma.employee.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
      prisma.attendance.groupBy({ by: ["employeeId", "status"], where: { date: { gte: from, lte: to } }, _count: { _all: true } }),
    ]);
    const map = new Map<string, { present: number; absent: number; half: number; leave: number }>();
    for (const e of employees) map.set(e.id, { present: 0, absent: 0, half: 0, leave: 0 });
    for (const g of grouped) {
      const row = map.get(g.employeeId);
      if (!row) continue;
      if (g.status === "PRESENT") row.present = g._count._all;
      else if (g.status === "ABSENT") row.absent = g._count._all;
      else if (g.status === "HALF_DAY") row.half = g._count._all;
      else if (g.status === "LEAVE") row.leave = g._count._all;
    }
    const rows = employees.map((e) => ({ employeeId: e.id, code: e.code, name: e.name, ...map.get(e.id)! }));
    res.json({ ok: true, data: { month, daysInMonth: days, rows } });
  } catch (err) {
    next(err);
  }
});

const statusEnum = z.enum(["PRESENT", "ABSENT", "HALF_DAY", "LEAVE"]);
const markSchema = z.object({ employeeId: z.string().min(1), date: z.coerce.date(), status: statusEnum, note: z.string().trim().max(120).nullable().optional() });

/** POST /attendance — mark (or correct) one employee's day. */
router.post("/", requirePermission("employees.manage"), async (req, res, next) => {
  try {
    const body = markSchema.parse(req.body);
    const day = dayOf(body.date);
    const record = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: body.employeeId, date: day } },
      create: { employeeId: body.employeeId, date: day, status: body.status, note: body.note || null },
      update: { status: body.status, note: body.note || null },
    });
    res.json({ ok: true, data: { record } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

const bulkSchema = z.object({
  date: z.coerce.date(),
  entries: z.array(z.object({ employeeId: z.string().min(1), status: statusEnum, note: z.string().trim().max(120).nullable().optional() })).min(1, "Mark at least one employee"),
});

/** POST /attendance/bulk — mark a whole day's register in one go. */
router.post("/bulk", requirePermission("employees.manage"), async (req, res, next) => {
  try {
    const body = bulkSchema.parse(req.body);
    const day = dayOf(body.date);
    await prisma.$transaction(
      body.entries.map((e) =>
        prisma.attendance.upsert({
          where: { employeeId_date: { employeeId: e.employeeId, date: day } },
          create: { employeeId: e.employeeId, date: day, status: e.status, note: e.note || null },
          update: { status: e.status, note: e.note || null },
        })
      )
    );
    res.json({ ok: true, data: { count: body.entries.length } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/**
 * POST /attendance/import — F2: import a CSV exported from a biometric/fingerprint
 * machine. Flexible columns (case-insensitive headers): an employee `code` (matches
 * Employee.code), a `date`, and either a `status` (P/A/H/L or the full word) or punch
 * times (`in`/`out` → PRESENT, HALF_DAY if only one punch). Rows upsert one mark per
 * employee-day; unknown codes/bad dates are skipped and reported. No money effect.
 */
const importSchema = z.object({ csv: z.string().min(1, "Paste or upload a CSV") });

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const split = (l: string) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const headers = split(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((l) => { const cells = split(l); return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""])); });
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) if (row[k]) return row[k];
  return "";
}

function statusFrom(row: Record<string, string>): "PRESENT" | "ABSENT" | "HALF_DAY" | "LEAVE" | null {
  const raw = pick(row, ["status", "attendance", "state"]).toUpperCase();
  if (raw) {
    if (raw.startsWith("P")) return "PRESENT";
    if (raw.startsWith("A")) return "ABSENT";
    if (raw.startsWith("H")) return "HALF_DAY";
    if (raw.startsWith("L")) return "LEAVE";
  }
  const cin = pick(row, ["in", "checkin", "check-in", "timein", "time in", "punchin"]);
  const cout = pick(row, ["out", "checkout", "check-out", "timeout", "time out", "punchout"]);
  if (cin || cout) return cin && cout ? "PRESENT" : "HALF_DAY";
  return null;
}

router.post("/import", requirePermission("employees.manage"), async (req, res, next) => {
  try {
    const body = importSchema.parse(req.body);
    const rows = parseCsv(body.csv);
    if (rows.length === 0) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "No rows found — needs a header line + data" } });

    const employees = await prisma.employee.findMany({ select: { id: true, code: true } });
    const byCode = new Map(employees.map((e) => [e.code.toLowerCase(), e.id]));

    let imported = 0;
    const errors: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const code = pick(row, ["code", "employeecode", "employee code", "empcode", "emp code", "id", "employeeid"]).toLowerCase();
      const employeeId = byCode.get(code);
      if (!employeeId) { errors.push(`Row ${i + 2}: unknown employee "${code || "(blank)"}"`); continue; }
      const dateStr = pick(row, ["date", "day", "attendancedate"]);
      const parsed = new Date(dateStr);
      if (!dateStr || isNaN(parsed.getTime())) { errors.push(`Row ${i + 2}: bad date "${dateStr}"`); continue; }
      const status = statusFrom(row);
      if (!status) { errors.push(`Row ${i + 2}: no status/punch`); continue; }
      const day = dayOf(parsed);
      await prisma.attendance.upsert({
        where: { employeeId_date: { employeeId, date: day } },
        create: { employeeId, date: day, status, note: "Imported" },
        update: { status },
      });
      imported++;
    }
    res.json({ ok: true, data: { imported, skipped: errors.length, errors: errors.slice(0, 20) } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** DELETE /attendance/:id — remove a mark. */
router.delete("/:id", requirePermission("employees.manage"), async (req, res, next) => {
  try {
    const existing = await prisma.attendance.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Mark not found" } });
    await prisma.attendance.delete({ where: { id: req.params.id } });
    res.json({ ok: true, data: { message: "Removed" } });
  } catch (err) {
    next(err);
  }
});

export default router;
