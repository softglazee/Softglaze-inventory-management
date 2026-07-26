/**
 * HR extensions (Phase 4, G6 — lightweight, not a full HRIS). Departments, shifts,
 * holidays and leave requests. Approved UNPAID leave surfaces a suggested salary
 * deduction (days) on the pay screen; nothing here posts money on its own.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";

const router = Router();
router.use(requireAuth);

const VIEW = "employees.view";
const MANAGE = "employees.manage";

// ─────────────────────────── DEPARTMENTS ───────────────────────────

router.get("/departments", requirePermission(VIEW), async (_req, res, next) => {
  try {
    const departments = await prisma.department.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { employees: true } } } });
    res.json({ ok: true, data: { departments } });
  } catch (err) {
    next(err);
  }
});

router.post("/departments", requirePermission(MANAGE), async (req, res, next) => {
  try {
    const name = z.string().trim().min(1, "Name is required").max(60).parse(req.body?.name);
    const department = await prisma.department.create({ data: { name } });
    res.status(201).json({ ok: true, data: { department } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err?.code === "P2002") return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: "That department already exists" } });
    next(err);
  }
});

router.delete("/departments/:id", requirePermission(MANAGE), async (req, res, next) => {
  try {
    const dep = await prisma.department.findUnique({ where: { id: req.params.id }, include: { _count: { select: { employees: true } } } });
    if (!dep) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Department not found" } });
    if (dep._count.employees > 0) return res.status(409).json({ ok: false, error: { code: "CONFLICT", message: `${dep.name} still has ${dep._count.employees} staff` } });
    await prisma.department.delete({ where: { id: dep.id } });
    res.json({ ok: true, data: { message: `${dep.name} deleted` } });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────── SHIFTS ───────────────────────────

const shiftSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40),
  startTime: z.string().trim().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  endTime: z.string().trim().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
});

router.get("/shifts", requirePermission(VIEW), async (_req, res, next) => {
  try {
    const shifts = await prisma.shift.findMany({ orderBy: { startTime: "asc" }, include: { _count: { select: { employees: true } } } });
    res.json({ ok: true, data: { shifts } });
  } catch (err) {
    next(err);
  }
});

router.post("/shifts", requirePermission(MANAGE), async (req, res, next) => {
  try {
    const body = shiftSchema.parse(req.body);
    const shift = await prisma.shift.create({ data: body });
    res.status(201).json({ ok: true, data: { shift } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err?.code === "P2002") return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: "That shift already exists" } });
    next(err);
  }
});

router.delete("/shifts/:id", requirePermission(MANAGE), async (req, res, next) => {
  try {
    const shift = await prisma.shift.findUnique({ where: { id: req.params.id }, include: { _count: { select: { employees: true } } } });
    if (!shift) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Shift not found" } });
    if (shift._count.employees > 0) return res.status(409).json({ ok: false, error: { code: "CONFLICT", message: `${shift.name} still has ${shift._count.employees} staff` } });
    await prisma.shift.delete({ where: { id: shift.id } });
    res.json({ ok: true, data: { message: `${shift.name} deleted` } });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────── HOLIDAYS ───────────────────────────

router.get("/holidays", requirePermission(VIEW), async (_req, res, next) => {
  try {
    const holidays = await prisma.holiday.findMany({ orderBy: { date: "desc" } });
    res.json({ ok: true, data: { holidays } });
  } catch (err) {
    next(err);
  }
});

router.post("/holidays", requirePermission(MANAGE), async (req, res, next) => {
  try {
    const body = z.object({ date: z.coerce.date(), name: z.string().trim().min(1, "Name is required").max(80) }).parse(req.body);
    const holiday = await prisma.holiday.create({ data: { date: body.date, name: body.name } });
    res.status(201).json({ ok: true, data: { holiday } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err?.code === "P2002") return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: "That date is already a holiday" } });
    next(err);
  }
});

router.delete("/holidays/:id", requirePermission(MANAGE), async (req, res, next) => {
  try {
    const holiday = await prisma.holiday.findUnique({ where: { id: req.params.id } });
    if (!holiday) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Holiday not found" } });
    await prisma.holiday.delete({ where: { id: holiday.id } });
    res.json({ ok: true, data: { message: "Holiday removed" } });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────── LEAVE REQUESTS ───────────────────────────

const leaveSchema = z.object({
  employeeId: z.string().min(1, "Pick an employee"),
  fromDate: z.coerce.date(),
  toDate: z.coerce.date(),
  type: z.enum(["PAID", "UNPAID", "SICK"]).default("UNPAID"),
  reason: z.string().trim().max(300).nullable().optional(),
});

const DAY_MS = 24 * 60 * 60 * 1000;

router.get("/leaves", requirePermission(VIEW), async (req, res, next) => {
  try {
    const employeeId = String(req.query.employeeId ?? "");
    const status = String(req.query.status ?? "");
    const where: Prisma.LeaveRequestWhereInput = {};
    if (employeeId) where.employeeId = employeeId;
    if (status === "PENDING" || status === "APPROVED" || status === "REJECTED") where.status = status;
    const leaves = await prisma.leaveRequest.findMany({ where, include: { employee: { select: { id: true, code: true, name: true } }, approver: { select: { name: true } } }, orderBy: { fromDate: "desc" } });
    res.json({ ok: true, data: { leaves } });
  } catch (err) {
    next(err);
  }
});

router.post("/leaves", requirePermission(MANAGE), async (req, res, next) => {
  try {
    const body = leaveSchema.parse(req.body);
    if (body.toDate < body.fromDate) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "End date is before the start date" } });
    const days = Math.max(1, Math.round((body.toDate.getTime() - body.fromDate.getTime()) / DAY_MS) + 1);
    const leave = await prisma.leaveRequest.create({
      data: { employeeId: body.employeeId, fromDate: body.fromDate, toDate: body.toDate, days, type: body.type, reason: body.reason || null },
      include: { employee: { select: { id: true, code: true, name: true } } },
    });
    res.status(201).json({ ok: true, data: { leave } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** PATCH /hr/leaves/:id — approve or reject */
router.patch("/leaves/:id", requirePermission(MANAGE), async (req, res, next) => {
  try {
    const status = z.enum(["PENDING", "APPROVED", "REJECTED"]).parse(req.body?.status);
    const existing = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Leave request not found" } });
    const leave = await prisma.leaveRequest.update({
      where: { id: existing.id },
      data: { status, approverId: status === "PENDING" ? null : req.user!.id },
      include: { employee: { select: { id: true, code: true, name: true } }, approver: { select: { name: true } } },
    });
    res.json({ ok: true, data: { leave } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

router.delete("/leaves/:id", requirePermission(MANAGE), async (req, res, next) => {
  try {
    const existing = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Leave request not found" } });
    await prisma.leaveRequest.delete({ where: { id: existing.id } });
    res.json({ ok: true, data: { message: "Leave request removed" } });
  } catch (err) {
    next(err);
  }
});

export default router;
