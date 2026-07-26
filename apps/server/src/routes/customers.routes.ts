import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { nextNumber } from "../utils/counter";

const router = Router();
router.use(requireAuth);

// Cashiers can add walk-in credit customers at POS; deactivation is manager+
const WRITE_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"] as const;
const DELETE_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;

const money = z.coerce.number();

const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().max(25).nullable().optional(),
  email: z.string().trim().email("Enter a valid email").max(120).or(z.literal("")).nullable().optional(), // E1 — for emailed statements
  address: z.string().trim().max(300).nullable().optional(),
  taxNumber: z.string().trim().max(30).nullable().optional(), // CNIC / NTN
  openingBalance: money.default(0), // +ve = customer owes us from before
  creditLimit: money.min(0, "Credit limit cannot be negative").default(0),
  priceGroupId: z.string().nullable().optional(), // F6 pricing tier
  isActive: z.boolean().optional(),
});

const customerInclude = { priceGroup: { select: { id: true, name: true, discountPercent: true } } } satisfies Prisma.CustomerInclude;

/** GET /customers?page&limit&search&status=active|inactive */
router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search ?? "").trim();
    const status = String(req.query.status ?? "");

    const where: Prisma.CustomerWhereInput = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
        { code: { contains: search, mode: "insensitive" } },
      ];
    }
    if (status === "active") where.isActive = true;
    if (status === "inactive") where.isActive = false;

    const [customers, total, totals] = await Promise.all([
      prisma.customer.findMany({ where, include: customerInclude, orderBy: { name: "asc" }, skip: (page - 1) * limit, take: limit }),
      prisma.customer.count({ where }),
      prisma.customer.aggregate({ _sum: { balance: true }, where: { isActive: true } }),
    ]);

    res.json({
      ok: true,
      data: { customers, total, page, pages: Math.max(1, Math.ceil(total / limit)), totalReceivable: totals._sum.balance ?? 0 },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /customers/:id */
router.get("/:id", async (req, res, next) => {
  try {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id }, include: customerInclude });
    if (!customer) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Customer not found" } });
    }
    res.json({ ok: true, data: { customer } });
  } catch (err) {
    next(err);
  }
});

/** POST /customers — code auto CUS-0001; balance starts at openingBalance */
router.post("/", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = customerSchema.parse(req.body);
    const customer = await prisma.$transaction(async (tx) => {
      const code = await nextNumber(tx, "customer", "CUS", 4);
      const created = await tx.customer.create({
        data: {
          code,
          name: body.name,
          phone: body.phone || null,
          email: body.email || null,
          address: body.address || null,
          taxNumber: body.taxNumber || null,
          openingBalance: body.openingBalance,
          balance: body.openingBalance,
          creditLimit: body.creditLimit,
          priceGroupId: body.priceGroupId || null,
        },
      });
      await tx.auditLog.create({
        data: { userId: req.user!.id, action: "CREATE_CUSTOMER", entity: "Customer", entityId: created.id, details: `${code} ${created.name}` },
      });
      return created;
    });
    const full = await prisma.customer.findUnique({ where: { id: customer.id }, include: customerInclude });
    res.status(201).json({ ok: true, data: { customer: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    next(err);
  }
});

/** PATCH /customers/:id — opening-balance edits shift the live balance by the same amount */
router.patch("/:id", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = customerSchema.partial().parse(req.body);
    const existing = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Customer not found" } });
    }

    const customer = await prisma.$transaction(async (tx) => {
      let balanceDelta = 0;
      if (body.openingBalance !== undefined) {
        balanceDelta = body.openingBalance - Number(existing.openingBalance);
      }
      const updated = await tx.customer.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          phone: body.phone === undefined ? undefined : body.phone || null,
          email: body.email === undefined ? undefined : body.email || null,
          address: body.address === undefined ? undefined : body.address || null,
          taxNumber: body.taxNumber === undefined ? undefined : body.taxNumber || null,
          openingBalance: body.openingBalance,
          balance: balanceDelta !== 0 ? { increment: balanceDelta } : undefined,
          creditLimit: body.creditLimit,
          priceGroupId: body.priceGroupId === undefined ? undefined : body.priceGroupId || null,
          isActive: body.isActive,
        },
      });
      await tx.auditLog.create({
        data: { userId: req.user!.id, action: "UPDATE_CUSTOMER", entity: "Customer", entityId: updated.id, details: `${updated.code} ${updated.name}` },
      });
      return updated;
    });
    const full = await prisma.customer.findUnique({ where: { id: customer.id }, include: customerInclude });
    res.json({ ok: true, data: { customer: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    next(err);
  }
});

/** DELETE /customers/:id — deactivate when they have history, delete when clean */
router.delete("/:id", requireRole(...DELETE_ROLES), async (req, res, next) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { sales: true, payments: true } } },
    });
    if (!customer) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Customer not found" } });
    }
    if (Number(customer.balance) !== 0) {
      return res.status(409).json({
        ok: false,
        error: { code: "CONFLICT", message: `${customer.name} still has a balance of ${customer.balance} — settle it first` },
      });
    }
    if (customer._count.sales > 0 || customer._count.payments > 0) {
      await prisma.customer.update({ where: { id: customer.id }, data: { isActive: false } });
      await prisma.auditLog.create({
        data: { userId: req.user!.id, action: "DEACTIVATE_CUSTOMER", entity: "Customer", entityId: customer.id, details: customer.name },
      });
      return res.json({
        ok: true,
        data: { message: `${customer.name} has sales history, so the account was deactivated`, deactivated: true },
      });
    }
    await prisma.customer.delete({ where: { id: customer.id } });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "DELETE_CUSTOMER", entity: "Customer", entityId: customer.id, details: customer.name },
    });
    res.json({ ok: true, data: { message: `${customer.name} deleted`, deactivated: false } });
  } catch (err) {
    next(err);
  }
});

export default router;
