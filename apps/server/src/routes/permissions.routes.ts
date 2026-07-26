import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { getPermissionsForRole, invalidatePermissionCache } from "../lib/permissions";
import { PERMISSIONS, ALL_PERMISSION_KEYS, EDITABLE_ROLES, defaultKeysForRole } from "../data/permissions";

const router = Router();
router.use(requireAuth);

const KEY_SET = new Set(ALL_PERMISSION_KEYS);

/** GET /permissions — the catalog (grouped) for the matrix UI */
router.get("/", async (_req, res, next) => {
  try {
    res.json({ ok: true, data: { permissions: PERMISSIONS, roles: EDITABLE_ROLES } });
  } catch (err) {
    next(err);
  }
});

/** GET /permissions/me — the current user's permission keys */
router.get("/me", async (req, res, next) => {
  try {
    const keys = await getPermissionsForRole(req.user!.role);
    res.json({ ok: true, data: { permissions: keys } });
  } catch (err) {
    next(err);
  }
});

/** GET /permissions/matrix — full editable matrix [SUPER_ADMIN] */
router.get("/matrix", requireRole("SUPER_ADMIN"), async (_req, res, next) => {
  try {
    const rows = await prisma.rolePermission.findMany();
    const matrix: Record<string, string[]> = {};
    for (const role of EDITABLE_ROLES) matrix[role] = [];
    for (const r of rows) {
      if (matrix[r.role]) matrix[r.role].push(r.permissionKey);
    }
    res.json({ ok: true, data: { permissions: PERMISSIONS, roles: EDITABLE_ROLES, matrix } });
  } catch (err) {
    next(err);
  }
});

const matrixSchema = z.object({
  matrix: z.record(z.array(z.string())),
});

/**
 * PUT /permissions/matrix [SUPER_ADMIN] — replace the permission set for the
 * supplied roles. SUPER_ADMIN can never be edited (implicitly all). Unknown keys
 * and non-editable roles are rejected. Cache invalidated so it takes effect at once.
 */
router.put("/matrix", requireRole("SUPER_ADMIN"), async (req, res, next) => {
  try {
    const { matrix } = matrixSchema.parse(req.body);
    const editable = new Set<string>(EDITABLE_ROLES as string[]);
    const roles = Object.keys(matrix);
    for (const role of roles) {
      if (!editable.has(role)) {
        return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: `Role "${role}" cannot be edited` } });
      }
      for (const key of matrix[role]) {
        if (!KEY_SET.has(key)) {
          return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: `Unknown permission "${key}"` } });
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const role of roles) {
        await tx.rolePermission.deleteMany({ where: { role: role as Role } });
        const unique = [...new Set(matrix[role])];
        if (unique.length > 0) {
          await tx.rolePermission.createMany({
            data: unique.map((permissionKey) => ({ role: role as Role, permissionKey })),
            skipDuplicates: true,
          });
        }
      }
      await tx.auditLog.create({
        data: { userId: req.user!.id, action: "UPDATE_PERMISSIONS", entity: "RolePermission", details: roles.join(",") },
      });
    });
    invalidatePermissionCache();
    res.json({ ok: true, data: { message: "Permissions updated" } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    next(err);
  }
});

const resetSchema = z.object({ role: z.enum(["ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"]) });

/** POST /permissions/reset [SUPER_ADMIN] — reset one role to catalog defaults */
router.post("/reset", requireRole("SUPER_ADMIN"), async (req, res, next) => {
  try {
    const { role } = resetSchema.parse(req.body);
    const keys = defaultKeysForRole(role as Role);
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { role: role as Role } });
      if (keys.length > 0) {
        await tx.rolePermission.createMany({
          data: keys.map((permissionKey) => ({ role: role as Role, permissionKey })),
        });
      }
      await tx.auditLog.create({
        data: { userId: req.user!.id, action: "RESET_PERMISSIONS", entity: "RolePermission", details: role },
      });
    });
    invalidatePermissionCache();
    res.json({ ok: true, data: { message: `${role} permissions reset to defaults` } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    next(err);
  }
});

export default router;
