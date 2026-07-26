/**
 * Backup & restore (Phase 6). A portable, environment-independent JSON snapshot of the
 * whole database (works on desktop and VPS alike; pg_dump paths differ per machine).
 * Export is gated by backup.manage; restore is SUPER_ADMIN-only and WIPES then reloads
 * everything in FK order inside one transaction.
 */
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { uploadSnapshot } from "../lib/cloud-backup";

const router = Router();
router.use(requireAuth);

/** POST /backup/cloud-now — H1: upload a snapshot to the configured cloud URL now. */
router.post("/cloud-now", requirePermission("backup.manage"), async (_req, res, next) => {
  try {
    const { bytes } = await uploadSnapshot();
    res.json({ ok: true, data: { message: `Backup uploaded (${Math.round(bytes / 1024)} KB)` } });
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message } });
    next(err);
  }
});

// Parents → children (create order; delete runs in reverse).
const ORDER = [
  "setting", "counter", "permission", "user", "rolePermission",
  "unit", "category", "brand", "expenseCategory", "paymentMethod", "department", "shift", "holiday",
  "product", "productImage", "comboItem",
  "customer", "vendor", "employee",
  "purchase", "purchaseItem", "sale", "saleItem",
  "expense", "payment", "accountEntry", "fundTransfer", "capitalEntry", "salaryPayment", "leaveRequest",
  "stockMovement", "stockAdjustment", "stockAdjustmentItem",
  "auditLog", "notification", "messageLog",
] as const;

/** GET /backup/export — download a full JSON snapshot */
router.get("/export", requirePermission("backup.manage"), async (_req, res, next) => {
  try {
    const data: Record<string, unknown[]> = {};
    for (const model of ORDER) data[model] = await (prisma as any)[model].findMany();
    const snapshot = { app: "SoftGlaze", version: 1, exportedAt: new Date().toISOString(), data };
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="softglaze-backup-${stamp}.json"`);
    res.send(JSON.stringify(snapshot));
  } catch (err) {
    next(err);
  }
});

/** GET /backup/summary — row counts (for the Settings → Backup panel) */
router.get("/summary", requirePermission("backup.manage"), async (_req, res, next) => {
  try {
    const counts: Record<string, number> = {};
    for (const m of ["sale", "purchase", "product", "customer", "vendor", "payment", "expense", "user"]) counts[m] = await (prisma as any)[m].count();
    res.json({ ok: true, data: { counts } });
  } catch (err) {
    next(err);
  }
});

/** POST /backup/restore — DANGER: wipe everything and reload from an exported snapshot */
router.post("/restore", requireRole("SUPER_ADMIN"), async (req, res, next) => {
  try {
    const snapshot = req.body;
    if (!snapshot || snapshot.app !== "SoftGlaze" || !snapshot.data) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "This file isn't a SoftGlaze backup" } });
    }
    const data = snapshot.data as Record<string, unknown[]>;

    await prisma.$transaction(async (tx) => {
      for (const model of [...ORDER].reverse()) await (tx as any)[model].deleteMany({});
      for (const model of ORDER) {
        const rows = data[model];
        if (Array.isArray(rows) && rows.length) await (tx as any)[model].createMany({ data: rows, skipDuplicates: true });
      }
    }, { timeout: 120000 });

    res.json({ ok: true, data: { message: "Backup restored. Please refresh." } });
  } catch (err: any) {
    next(Object.assign(err, { status: err.status ?? 400, code: err.code ?? "RESTORE_FAILED" }));
  }
});

export default router;
