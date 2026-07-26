import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { imageUpload, saveImage, deleteImageFiles } from "../lib/upload";

const router = Router();
router.use(requireAuth);

const WRITE_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;

const categorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  parentId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

/** Walks up the parent chain to block cycles (A → B → A) */
async function createsCycle(categoryId: string, newParentId: string): Promise<boolean> {
  let current: string | null = newParentId;
  for (let depth = 0; current && depth < 20; depth++) {
    if (current === categoryId) return true;
    const parent: { parentId: string | null } | null = await prisma.category.findUnique({
      where: { id: current },
      select: { parentId: true },
    });
    current = parent?.parentId ?? null;
  }
  return false;
}

/** GET /categories — full tree (parents with children), product counts */
router.get("/", async (_req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { products: true, children: true } },
      },
      orderBy: { name: "asc" },
    });
    res.json({ ok: true, data: { categories } });
  } catch (err) {
    next(err);
  }
});

/** POST /categories */
router.post("/", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = categorySchema.parse(req.body);
    if (body.parentId) {
      const parent = await prisma.category.findUnique({ where: { id: body.parentId } });
      if (!parent) {
        return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Parent category not found" } });
      }
    }
    const category = await prisma.category.create({
      data: { name: body.name, parentId: body.parentId ?? null },
    });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "CREATE_CATEGORY", entity: "Category", entityId: category.id, details: category.name },
    });
    res.status(201).json({ ok: true, data: { category } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    if (err?.code === "P2002") {
      return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: "A category with this name already exists" } });
    }
    next(err);
  }
});

/** PATCH /categories/:id */
router.patch("/:id", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const body = categorySchema.partial().parse(req.body);
    const existing = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Category not found" } });
    }
    if (body.parentId) {
      if (body.parentId === existing.id || (await createsCycle(existing.id, body.parentId))) {
        return res.status(409).json({ ok: false, error: { code: "CONFLICT", message: "A category cannot be inside itself" } });
      }
      const parent = await prisma.category.findUnique({ where: { id: body.parentId } });
      if (!parent) {
        return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Parent category not found" } });
      }
    }
    const category = await prisma.category.update({
      where: { id: existing.id },
      data: { name: body.name, parentId: body.parentId === undefined ? undefined : body.parentId, isActive: body.isActive },
    });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "UPDATE_CATEGORY", entity: "Category", entityId: category.id, details: category.name },
    });
    res.json({ ok: true, data: { category } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    if (err?.code === "P2002") {
      return res.status(409).json({ ok: false, error: { code: "DUPLICATE", message: "A category with this name already exists" } });
    }
    next(err);
  }
});

/** POST /categories/:id/image — upload/replace the category image */
router.post("/:id/image", requireRole(...WRITE_ROLES), imageUpload.single("image"), async (req, res, next) => {
  try {
    const existing = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Category not found" } });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "No image file received" } });
    }
    const saved = await saveImage(req.file.buffer, "categories");
    await deleteImageFiles(existing.image, existing.image?.replace(/\.webp$/, ".thumb.webp"));
    const category = await prisma.category.update({ where: { id: existing.id }, data: { image: saved.path } });
    res.json({ ok: true, data: { category } });
  } catch (err) {
    next(err);
  }
});

/** DELETE /categories/:id — refuses when products/children exist */
router.delete("/:id", requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    const category = await prisma.category.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { products: true, children: true } } },
    });
    if (!category) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Category not found" } });
    }
    if (category._count.products > 0) {
      return res.status(409).json({
        ok: false,
        error: { code: "CONFLICT", message: `${category.name} has ${category._count.products} product(s) — move them first` },
      });
    }
    if (category._count.children > 0) {
      return res.status(409).json({
        ok: false,
        error: { code: "CONFLICT", message: `${category.name} has sub-categories — delete or move them first` },
      });
    }
    await prisma.category.delete({ where: { id: category.id } });
    await deleteImageFiles(category.image, category.image?.replace(/\.webp$/, ".thumb.webp"));
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "DELETE_CATEGORY", entity: "Category", entityId: category.id, details: category.name },
    });
    res.json({ ok: true, data: { message: `Category ${category.name} deleted` } });
  } catch (err) {
    next(err);
  }
});

export default router;
