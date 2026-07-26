import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

// Read-only list for now (Cash, Bank, JazzCash…). Full CRUD lands in Phase 4.
const router = Router();
router.use(requireAuth);

router.get("/", async (_req, res, next) => {
  try {
    const methods = await prisma.paymentMethod.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    res.json({ ok: true, data: { methods } });
  } catch (err) {
    next(err);
  }
});

export default router;
