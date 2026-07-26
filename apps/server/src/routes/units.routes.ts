import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

const WRITE_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;

const unitSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(50),
  shortName: z.string().trim().min(1, "Short name is required").max(12),
  baseUnitId: z.string().nullable().optional(),
  factor: z.coerce.number().positive("Factor must be greater than 0").default(1),
});

/** GET /units — all units with conversion info */
router.get("/", async (_req, res, next) => {
  try {
    const units = await prisma.unit.findMany({
      include: { baseUnit: { select: { id: true, name: true, shortName: true } }, _count: { select: { products: true } } },
      orderBy: { name: "asc" },
    });
    res.json({ ok: true, data: { units } });
  } catch (err) {
    next(err);
  }
});

/** POST /units */
router.post("/", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = unitSchema.parse(req.body);
    if (body.baseUnitId) {
      const base = await prisma.unit.findUnique({ where: { id: body.baseUnitId } });
      if (!base) {
        return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Base unit not found" } });
      }
      if (base.baseUnitId) {
        return res.status(409).json({
          ok: false,
          error: { code: "CONFLICT", message: `${base.name} is itself a converted unit — convert to a base unit instead` },
        });
      }
    }
    const unit = await prisma.unit.create({
      data: { name: body.name, shortName: body.shortName, baseUnitId: body.baseUnitId ?? null, factor: body.factor },
    });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "CREATE_UNIT", entity: "Unit", entityId: unit.id, details: unit.name },
    });
    res.status(201).json({ ok: true, data: { unit } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    if (err?.code === "P2002") {
      return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: "A unit with this name or short name already exists" } });
    }
    next(err);
  }
});

/** PATCH /units/:id */
router.patch("/:id", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = unitSchema.partial().parse(req.body);
    const existing = await prisma.unit.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Unit not found" } });
    }
    if (body.baseUnitId) {
      if (body.baseUnitId === existing.id) {
        return res.status(409).json({ ok: false, error: { code: "CONFLICT", message: "A unit cannot convert to itself" } });
      }
      const base = await prisma.unit.findUnique({ where: { id: body.baseUnitId } });
      if (!base) {
        return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Base unit not found" } });
      }
      if (base.baseUnitId) {
        return res.status(409).json({
          ok: false,
          error: { code: "CONFLICT", message: `${base.name} is itself a converted unit — convert to a base unit instead` },
        });
      }
    }
    const unit = await prisma.unit.update({ where: { id: existing.id }, data: body });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "UPDATE_UNIT", entity: "Unit", entityId: unit.id, details: unit.name },
    });
    res.json({ ok: true, data: { unit } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    if (err?.code === "P2002") {
      return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: "A unit with this name or short name already exists" } });
    }
    next(err);
  }
});

/** DELETE /units/:id — refuses if products or derived units use it */
router.delete("/:id", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const unit = await prisma.unit.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { products: true, derived: true } } },
    });
    if (!unit) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Unit not found" } });
    }
    if (unit._count.products > 0) {
      return res.status(409).json({
        ok: false,
        error: { code: "CONFLICT", message: `${unit.name} is used by ${unit._count.products} product(s) — move them to another unit first` },
      });
    }
    if (unit._count.derived > 0) {
      return res.status(409).json({
        ok: false,
        error: { code: "CONFLICT", message: `${unit.name} is the base of other unit conversions — remove those first` },
      });
    }
    await prisma.unit.delete({ where: { id: unit.id } });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "DELETE_UNIT", entity: "Unit", entityId: unit.id, details: unit.name },
    });
    res.json({ ok: true, data: { message: `Unit ${unit.name} deleted` } });
  } catch (err) {
    next(err);
  }
});

export default router;
