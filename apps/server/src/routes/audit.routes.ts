/**
 * Audit log viewer (Phase 6). Read-only trail of every meaningful action. Written
 * throughout the app inside the same transactions as the changes they describe.
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";

const router = Router();
router.use(requireAuth);

/** GET /audit?page&limit&action&entity&search&from&to */
router.get("/", requirePermission("audit.view"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const action = String(req.query.action ?? "");
    const entity = String(req.query.entity ?? "");
    const search = String(req.query.search ?? "").trim();
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    const where: Prisma.AuditLogWhereInput = {};
    if (action) where.action = action;
    if (entity) where.entity = entity;
    if (search) where.details = { contains: search, mode: "insensitive" };
    if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const [logs, total, actions] = await Promise.all([
      prisma.auditLog.findMany({ where, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    ]);
    res.json({ ok: true, data: { logs, total, page, pages: Math.max(1, Math.ceil(total / limit)), actions: actions.map((a) => a.action) } });
  } catch (err) {
    next(err);
  }
});

export default router;
