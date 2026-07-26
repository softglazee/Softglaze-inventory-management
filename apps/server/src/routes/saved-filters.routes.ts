import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

/** H2 — per-user saved report filter presets. Pure UI convenience; no accounting effect. */
const router = Router();
router.use(requireAuth);

/** GET /saved-filters?reportKey — the current user's presets (optionally for one report). */
router.get("/", async (req, res, next) => {
  try {
    const reportKey = String(req.query.reportKey ?? "");
    const filters = await prisma.savedFilter.findMany({
      where: { userId: req.user!.id, ...(reportKey ? { reportKey } : {}) },
      orderBy: { createdAt: "asc" },
    });
    res.json({ ok: true, data: { filters } });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  reportKey: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1, "Name the preset").max(60),
  params: z.string().max(4000), // JSON blob of the filter state
});

/** POST /saved-filters — save the current filter state as a named preset. */
router.post("/", async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const filter = await prisma.savedFilter.create({ data: { userId: req.user!.id, reportKey: body.reportKey, name: body.name, params: body.params } });
    res.status(201).json({ ok: true, data: { filter } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** DELETE /saved-filters/:id — remove one of your presets. */
router.delete("/:id", async (req, res, next) => {
  try {
    const existing = await prisma.savedFilter.findUnique({ where: { id: req.params.id }, select: { userId: true } });
    if (!existing || existing.userId !== req.user!.id) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Preset not found" } });
    await prisma.savedFilter.delete({ where: { id: req.params.id } });
    res.json({ ok: true, data: { message: "Deleted" } });
  } catch (err) {
    next(err);
  }
});

export default router;
