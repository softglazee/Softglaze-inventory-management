import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, signAccessToken, signRefreshToken } from "../middleware/auth";
import { getPermissionsForRole } from "../lib/permissions";
import { generateSecret, verifyTotp, otpauthUri } from "../lib/totp";
import { sendMail, smtpConfigured } from "../lib/mailer";

const router = Router();

const registerSchema = z.object({
  name: z.string().min(2, "Name is too short"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().trim().optional(), // H3 — 2FA code when the account has it enabled
});

function publicUser(u: { id: string; name: string; email: string; role: any; phone?: string | null; totpEnabled?: boolean; avatar?: string | null }) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone ?? null, totpEnabled: !!u.totpEnabled, avatar: u.avatar ?? null };
}

async function issueTokens(user: { id: string; name: string; email: string; role: any }) {
  const accessToken = signAccessToken({ id: user.id, name: user.name, email: user.email, role: user.role });
  const refreshToken = signRefreshToken(user.id);
  const refreshHash = await bcrypt.hash(refreshToken, 8);
  await prisma.user.update({ where: { id: user.id }, data: { refreshToken: refreshHash } });
  return { accessToken, refreshToken };
}

/**
 * POST /auth/register
 * The FIRST user ever created becomes SUPER_ADMIN (shop owner).
 * After that, registration is closed — Admin creates staff from the Users screen.
 */
router.post("/register", async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return res.status(403).json({
        ok: false,
        error: { code: "FORBIDDEN", message: "Registration is closed. Ask your admin to create your account." },
      });
    }
    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await prisma.user.create({
      data: { name: body.name, email: body.email.toLowerCase(), phone: body.phone, passwordHash, role: "SUPER_ADMIN" },
    });
    const tokens = await issueTokens(user);
    await prisma.auditLog.create({ data: { userId: user.id, action: "REGISTER", details: "Owner (SUPER_ADMIN) created" } });
    const permissions = await getPermissionsForRole(user.role);
    res.status(201).json({ ok: true, data: { user: publicUser(user), permissions, ...tokens } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    next(err);
  }
});

/** GET /auth/setup-status — tells the login page whether to show "create first account" */
router.get("/setup-status", async (_req, res, next) => {
  try {
    const userCount = await prisma.user.count();
    res.json({ ok: true, data: { needsSetup: userCount === 0 } });
  } catch (err) {
    next(err);
  }
});

/** POST /auth/login */
router.post("/login", async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    const badCreds = () =>
      res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Wrong email or password" } });

    if (!user) return badCreds();
    if (!user.isActive) {
      return res
        .status(403)
        .json({ ok: false, error: { code: "FORBIDDEN", message: "This account is disabled. Contact your admin." } });
    }
    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) return badCreds();

    // H3 — second factor when enabled for this account.
    if (user.totpEnabled && user.totpSecret) {
      if (!body.totpCode) return res.status(401).json({ ok: false, error: { code: "TOTP_REQUIRED", message: "Enter your 6-digit authenticator code" } });
      if (!verifyTotp(user.totpSecret, body.totpCode)) return res.status(401).json({ ok: false, error: { code: "TOTP_INVALID", message: "That authenticator code is wrong or expired" } });
    }

    const tokens = await issueTokens(user);
    await prisma.auditLog.create({ data: { userId: user.id, action: "LOGIN", ip: req.ip } });
    const permissions = await getPermissionsForRole(user.role);
    res.json({ ok: true, data: { user: publicUser(user), permissions, ...tokens } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    next(err);
  }
});

/** POST /auth/refresh  { refreshToken } — rotates the refresh token */
router.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "refreshToken required" } });
    }
    let payload: { id: string };
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as { id: string };
    } catch {
      return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Session expired" } });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user || !user.isActive || !user.refreshToken) {
      return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Session expired" } });
    }
    const matches = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!matches) {
      return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Session expired" } });
    }
    const tokens = await issueTokens(user);
    const permissions = await getPermissionsForRole(user.role);
    res.json({ ok: true, data: { user: publicUser(user), permissions, ...tokens } });
  } catch (err) {
    next(err);
  }
});

/** GET /auth/me */
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "User not found" } });
    const permissions = await getPermissionsForRole(user.role);
    res.json({ ok: true, data: { user: publicUser(user), permissions } });
  } catch (err) {
    next(err);
  }
});

/** POST /auth/logout */
router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await prisma.user.update({ where: { id: req.user!.id }, data: { refreshToken: null } });
    res.json({ ok: true, data: { message: "Logged out" } });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────── H5 · SELF-SERVICE PASSWORD RESET ────────────────────
//
// A shop must never be locked out. Two independent routes back to a password:
//   1. this emailed reset link (needs SMTP configured in Settings → Integrations);
//   2. an administrator resetting it from Users & Roles — always available, and the
//      only option on an offline desktop install.
//
// The emailed token is 32 random bytes; only its SHA-256 is stored, so a database
// leak cannot be replayed. It expires in one hour and is destroyed once used.

const RESET_TTL_MS = 60 * 60 * 1000;
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Where the web app lives, for building the link we email out. */
function appOrigin(req: import("express").Request) {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) return origin.replace(/\/$/, "");
  const configured = process.env.CORS_ORIGIN?.split(",")[0]?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

/**
 * POST /auth/forgot-password { email }
 *
 * Always answers the same way for a valid request, whether or not that address has
 * an account — otherwise this endpoint becomes a way to discover who works here.
 * The one thing it does report is whether email is configured at all, which is a
 * property of the installation, not of any user.
 */
router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().email("Enter a valid email") }).parse(req.body);

    if (!(await smtpConfigured())) {
      return res.json({
        ok: true,
        data: {
          delivered: false,
          reason: "EMAIL_NOT_CONFIGURED",
          message: "Email isn't set up on this system. Ask an administrator to reset your password from Users & Roles.",
        },
      });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user && user.isActive) {
      const token = crypto.randomBytes(32).toString("hex");
      await prisma.user.update({
        where: { id: user.id },
        data: { resetTokenHash: sha256(token), resetTokenExpiry: new Date(Date.now() + RESET_TTL_MS) },
      });
      const shop = (await prisma.setting.findUnique({ where: { key: "shop_name" } }))?.value || "SoftGlaze";
      const link = `${appOrigin(req)}/reset-password?token=${token}`;
      try {
        await sendMail({
          to: user.email,
          subject: `${shop} — reset your password`,
          html:
            `<p>Hello ${user.name},</p>` +
            `<p>Someone asked to reset the password for your <b>${shop}</b> account. ` +
            `Click below within the next hour to choose a new one:</p>` +
            `<p><a href="${link}">Reset my password</a></p>` +
            `<p>If that wasn't you, ignore this email — your password stays as it is.</p>`,
          text: `Hello ${user.name},\n\nReset your ${shop} password within the next hour:\n${link}\n\nIf that wasn't you, ignore this email.`,
        });
        await prisma.auditLog.create({ data: { userId: user.id, action: "PASSWORD_RESET_REQUESTED", entity: "User", entityId: user.id } });
      } catch (err) {
        // Never leak a delivery failure back to the caller — it would confirm the
        // address exists. It is logged for the administrator instead.
        console.error("[forgot-password] send failed:", err);
      }
    }

    res.json({
      ok: true,
      data: { delivered: true, message: "If that email belongs to an account, a reset link is on its way. It expires in one hour." },
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    next(err);
  }
});

/**
 * POST /auth/reset-password { token, password }
 * Consumes the token, sets the new password, and signs every other session out.
 */
router.post("/reset-password", async (req, res, next) => {
  try {
    const body = z
      .object({ token: z.string().min(1, "Reset link is incomplete"), password: z.string().min(8, "Password must be at least 8 characters") })
      .parse(req.body);

    const user = await prisma.user.findFirst({
      where: { resetTokenHash: sha256(body.token), resetTokenExpiry: { gt: new Date() } },
    });
    if (!user || !user.isActive) {
      return res.status(400).json({
        ok: false,
        error: { code: "RESET_TOKEN_INVALID", message: "This reset link has expired or has already been used. Request a new one." },
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(body.password, 12),
        resetTokenHash: null,
        resetTokenExpiry: null,
        refreshToken: null, // sign out everywhere else
      },
    });
    await prisma.auditLog.create({ data: { userId: user.id, action: "PASSWORD_RESET", entity: "User", entityId: user.id, details: "via emailed link" } });

    res.json({ ok: true, data: { message: "Password updated. You can sign in with it now." } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    next(err);
  }
});

/** GET /auth/password-reset-available — lets the login page show the right wording. */
router.get("/password-reset-available", async (_req, res, next) => {
  try {
    res.json({ ok: true, data: { available: await smtpConfigured() } });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────── H3 · TWO-FACTOR (TOTP) ───────────────────────────

/** POST /auth/2fa/setup — generate a secret + otpauth URI (not yet enabled). */
router.post("/2fa/setup", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { email: true } });
    if (!user) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "User not found" } });
    const shop = (await prisma.setting.findUnique({ where: { key: "shop_name" } }))?.value || "SoftGlaze";
    const secret = generateSecret();
    await prisma.user.update({ where: { id: req.user!.id }, data: { totpSecret: secret, totpEnabled: false } });
    res.json({ ok: true, data: { secret, otpauth: otpauthUri(secret, user.email, shop) } });
  } catch (err) {
    next(err);
  }
});

/** POST /auth/2fa/enable { code } — verify a code against the pending secret and turn 2FA on. */
router.post("/2fa/enable", requireAuth, async (req, res, next) => {
  try {
    const code = String(req.body?.code ?? "");
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { totpSecret: true } });
    if (!user?.totpSecret) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Start setup first" } });
    if (!verifyTotp(user.totpSecret, code)) return res.status(400).json({ ok: false, error: { code: "TOTP_INVALID", message: "That code is wrong — try the current one" } });
    await prisma.user.update({ where: { id: req.user!.id }, data: { totpEnabled: true } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "2FA_ENABLED", entity: "User", entityId: req.user!.id, details: "2FA turned on" } });
    res.json({ ok: true, data: { totpEnabled: true } });
  } catch (err) {
    next(err);
  }
});

/** POST /auth/2fa/disable { password } — turn 2FA off (re-auth with the password). */
router.post("/2fa/disable", requireAuth, async (req, res, next) => {
  try {
    const password = String(req.body?.password ?? "");
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { passwordHash: true } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Password is wrong" } });
    await prisma.user.update({ where: { id: req.user!.id }, data: { totpEnabled: false, totpSecret: null } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "2FA_DISABLED", entity: "User", entityId: req.user!.id, details: "2FA turned off" } });
    res.json({ ok: true, data: { totpEnabled: false } });
  } catch (err) {
    next(err);
  }
});

export default router;
