import { Request, Response, NextFunction } from "express";
import { roleHasPermission } from "../lib/permissions";

/**
 * Data-driven permission guard (A2). Allows the request if the user's role holds
 * ANY of the listed keys (SUPER_ADMIN always passes). Use after requireAuth:
 *   router.post("/", requirePermission("products.create"), handler)
 */
export function requirePermission(...keys: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Login required" } });
    }
    try {
      for (const key of keys) {
        if (await roleHasPermission(req.user.role, key)) return next();
      }
      return res
        .status(403)
        .json({ ok: false, error: { code: "FORBIDDEN", message: "You don't have permission for this action" } });
    } catch (err) {
      next(err);
    }
  };
}
