import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { nextNumber } from "../utils/counter";

const router = Router();
router.use(requireAuth);

const WRITE_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;

const money = z.coerce.number();

const vendorSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().max(25).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  taxNumber: z.string().trim().max(30).nullable().optional(),
  bankDetails: z.string().trim().max(500).nullable().optional(),
  openingBalance: money.default(0), // +ve = we owe vendor from before
  isActive: z.boolean().optional(),
});

/** GET /vendors?page&limit&search&status=active|inactive */
router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search ?? "").trim();
    const status = String(req.query.status ?? "");

    const where: Prisma.VendorWhereInput = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
        { code: { contains: search, mode: "insensitive" } },
      ];
    }
    if (status === "active") where.isActive = true;
    if (status === "inactive") where.isActive = false;

    const [vendors, total, totals] = await Promise.all([
      prisma.vendor.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * limit, take: limit }),
      prisma.vendor.count({ where }),
      prisma.vendor.aggregate({ _sum: { balance: true }, where: { isActive: true } }),
    ]);

    res.json({
      ok: true,
      data: { vendors, total, page, pages: Math.max(1, Math.ceil(total / limit)), totalPayable: totals._sum.balance ?? 0 },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /vendors/:id */
router.get("/:id", async (req, res, next) => {
  try {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    if (!vendor) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Vendor not found" } });
    }
    res.json({ ok: true, data: { vendor } });
  } catch (err) {
    next(err);
  }
});

/** POST /vendors — code auto VEN-0001; balance starts at openingBalance */
router.post("/", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = vendorSchema.parse(req.body);
    const vendor = await prisma.$transaction(async (tx) => {
      const code = await nextNumber(tx, "vendor", "VEN", 4);
      const created = await tx.vendor.create({
        data: {
          code,
          name: body.name,
          phone: body.phone || null,
          address: body.address || null,
          taxNumber: body.taxNumber || null,
          bankDetails: body.bankDetails || null,
          openingBalance: body.openingBalance,
          balance: body.openingBalance,
        },
      });
      await tx.auditLog.create({
        data: { userId: req.user!.id, action: "CREATE_VENDOR", entity: "Vendor", entityId: created.id, details: `${code} ${created.name}` },
      });
      return created;
    });
    res.status(201).json({ ok: true, data: { vendor } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    next(err);
  }
});

/** PATCH /vendors/:id — opening-balance edits shift the live balance by the same amount */
router.patch("/:id", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = vendorSchema.partial().parse(req.body);
    const existing = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Vendor not found" } });
    }

    const vendor = await prisma.$transaction(async (tx) => {
      let balanceDelta = 0;
      if (body.openingBalance !== undefined) {
        balanceDelta = body.openingBalance - Number(existing.openingBalance);
      }
      const updated = await tx.vendor.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          phone: body.phone === undefined ? undefined : body.phone || null,
          address: body.address === undefined ? undefined : body.address || null,
          taxNumber: body.taxNumber === undefined ? undefined : body.taxNumber || null,
          bankDetails: body.bankDetails === undefined ? undefined : body.bankDetails || null,
          openingBalance: body.openingBalance,
          balance: balanceDelta !== 0 ? { increment: balanceDelta } : undefined,
          isActive: body.isActive,
        },
      });
      await tx.auditLog.create({
        data: { userId: req.user!.id, action: "UPDATE_VENDOR", entity: "Vendor", entityId: updated.id, details: `${updated.code} ${updated.name}` },
      });
      return updated;
    });
    res.json({ ok: true, data: { vendor } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    next(err);
  }
});

/** DELETE /vendors/:id — deactivate when they have history, delete when clean */
router.delete("/:id", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { purchases: true, payments: true } } },
    });
    if (!vendor) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Vendor not found" } });
    }
    if (Number(vendor.balance) !== 0) {
      return res.status(409).json({
        ok: false,
        error: { code: "CONFLICT", message: `${vendor.name} still has a balance of ${vendor.balance} — settle it first` },
      });
    }
    if (vendor._count.purchases > 0 || vendor._count.payments > 0) {
      await prisma.vendor.update({ where: { id: vendor.id }, data: { isActive: false } });
      await prisma.auditLog.create({
        data: { userId: req.user!.id, action: "DEACTIVATE_VENDOR", entity: "Vendor", entityId: vendor.id, details: vendor.name },
      });
      return res.json({
        ok: true,
        data: { message: `${vendor.name} has purchase history, so the account was deactivated`, deactivated: true },
      });
    }
    await prisma.vendor.delete({ where: { id: vendor.id } });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "DELETE_VENDOR", entity: "Vendor", entityId: vendor.id, details: vendor.name },
    });
    res.json({ ok: true, data: { message: `${vendor.name} deleted`, deactivated: false } });
  } catch (err) {
    next(err);
  }
});

export default router;
