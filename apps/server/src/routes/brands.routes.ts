import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { imageUpload, saveImage, deleteImageFiles } from "../lib/upload";

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(1, "Brand name is required").max(80),
  isActive: z.boolean().optional(),
});
const updateSchema = createSchema.partial();

const brandInclude = { _count: { select: { products: true } } } satisfies Prisma.BrandInclude;

/** GET /brands?search=&status=active|inactive */
router.get("/", async (req, res, next) => {
  try {
    const search = String(req.query.search ?? "").trim();
    const status = String(req.query.status ?? "");
    const where: Prisma.BrandWhereInput = {};
    if (search) where.name = { contains: search, mode: "insensitive" };
    if (status === "active") where.isActive = true;
    if (status === "inactive") where.isActive = false;
    const brands = await prisma.brand.findMany({ where, include: brandInclude, orderBy: { name: "asc" } });
    res.json({ ok: true, data: { brands } });
  } catch (err) {
    next(err);
  }
});

/** POST /brands */
router.post("/", requirePermission("products.create"), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const brand = await prisma.brand.create({ data: { name: body.name, isActive: body.isActive ?? true }, include: brandInclude });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "CREATE_BRAND", entity: "Brand", entityId: brand.id, details: brand.name } });
    res.status(201).json({ ok: true, data: { brand } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    if (err?.code === "P2002") {
      return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: "A brand with this name already exists" } });
    }
    next(err);
  }
});

/** PATCH /brands/:id */
router.patch("/:id", requirePermission("products.edit"), async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    const brand = await prisma.brand.update({
      where: { id: req.params.id },
      data: { name: body.name, isActive: body.isActive },
      include: brandInclude,
    });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "UPDATE_BRAND", entity: "Brand", entityId: brand.id, details: brand.name } });
    res.json({ ok: true, data: { brand } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    if (err?.code === "P2025") {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Brand not found" } });
    }
    if (err?.code === "P2002") {
      return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: "A brand with this name already exists" } });
    }
    next(err);
  }
});

/** DELETE /brands/:id — deactivate when products use it, else hard delete */
router.delete("/:id", requirePermission("products.delete"), async (req, res, next) => {
  try {
    const brand = await prisma.brand.findUnique({ where: { id: req.params.id }, include: brandInclude });
    if (!brand) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Brand not found" } });
    }
    if (brand._count.products > 0) {
      await prisma.brand.update({ where: { id: brand.id }, data: { isActive: false } });
      await prisma.auditLog.create({ data: { userId: req.user!.id, action: "DEACTIVATE_BRAND", entity: "Brand", entityId: brand.id, details: brand.name } });
      return res.json({ ok: true, data: { message: `${brand.name} is used by products, so it was deactivated`, deactivated: true } });
    }
    await prisma.brand.delete({ where: { id: brand.id } });
    await deleteImageFiles(brand.image);
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "DELETE_BRAND", entity: "Brand", entityId: brand.id, details: brand.name } });
    res.json({ ok: true, data: { message: `${brand.name} deleted`, deactivated: false } });
  } catch (err) {
    next(err);
  }
});

/** POST /brands/:id/image — single logo image (replaces the old one) */
router.post("/:id/image", requirePermission("products.edit"), imageUpload.single("image"), async (req, res, next) => {
  try {
    const brand = await prisma.brand.findUnique({ where: { id: req.params.id } });
    if (!brand) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Brand not found" } });
    }
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "No image file received" } });
    }
    const saved = await saveImage(file.buffer, "brands");
    const old = brand.image;
    const updated = await prisma.brand.update({ where: { id: brand.id }, data: { image: saved.path }, include: brandInclude });
    await deleteImageFiles(old);
    res.json({ ok: true, data: { brand: updated } });
  } catch (err) {
    next(err);
  }
});

export default router;
