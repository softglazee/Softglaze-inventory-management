import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Verifies the Bearer access token and attaches req.user */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Login required" } });
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as AuthUser;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Session expired, please login again" } });
  }
}

/**
 * Role guard. Usage:
 *   router.post("/", requireAuth, requireRole("ADMIN", "MANAGER"), handler)
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Login required" } });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "You don't have permission for this action" } });
    }
    next();
  };
}

type Ttl = jwt.SignOptions["expiresIn"];

export function signAccessToken(user: AuthUser) {
  const expiresIn = (process.env.ACCESS_TOKEN_TTL ?? "15m") as Ttl;
  return jwt.sign(user, process.env.JWT_SECRET!, { expiresIn });
}

export function signRefreshToken(userId: string) {
  const expiresIn = (process.env.REFRESH_TOKEN_TTL ?? "7d") as Ttl;
  return jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET!, { expiresIn });
}
