/**
 * Messaging log (Phase 6, docs/09 §5). WhatsApp v1 is wa.me deep links opened by the
 * browser — the client posts here so every message (and its status) is on record.
 * Email is sent server-side via the mailer and also logged.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

/** GET /messages?channel&status */
router.get("/", async (req, res, next) => {
  try {
    const channel = String(req.query.channel ?? "");
    const status = String(req.query.status ?? "");
    const where: Prisma.MessageLogWhereInput = {};
    if (channel === "WHATSAPP" || channel === "EMAIL") where.channel = channel;
    if (status) where.status = status as Prisma.MessageLogWhereInput["status"];
    const messages = await prisma.messageLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
    res.json({ ok: true, data: { messages } });
  } catch (err) {
    next(err);
  }
});

const logSchema = z.object({
  channel: z.enum(["WHATSAPP", "EMAIL"]),
  recipient: z.string().trim().min(1),
  template: z.string().trim().max(40),
  refType: z.string().trim().max(20).nullable().optional(),
  refId: z.string().trim().max(40).nullable().optional(),
  status: z.enum(["QUEUED", "SENT", "FAILED", "CLICKED"]).default("CLICKED"),
});

/** POST /messages/log — record a client-initiated send (e.g. wa.me opened) */
router.post("/log", async (req, res, next) => {
  try {
    const body = logSchema.parse(req.body);
    const message = await prisma.messageLog.create({ data: { channel: body.channel, recipient: body.recipient, template: body.template, refType: body.refType || null, refId: body.refId || null, status: body.status } });
    res.status(201).json({ ok: true, data: { message } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

export default router;
