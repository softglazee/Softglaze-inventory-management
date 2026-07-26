import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { emailCustomerStatement } from "../lib/statements";
import { sendSms, smsConfigured } from "../lib/sms";
import { sendMail, smtpConfigured } from "../lib/mailer";
import { planReminders, runUdhaarEscalation } from "../lib/reminders";

/**
 * Batch E — customer outreach: monthly statements (E1), bulk greetings (E3), and the
 * udhaar reminder ladder (E4). None of these touch the ledgers — they only send messages
 * and write MessageLog rows — so integrity/balance sheet are inherently unaffected.
 */
const router = Router();
router.use(requireAuth);

async function loadSettings() {
  return Object.fromEntries((await prisma.setting.findMany()).map((r) => [r.key, r.value]));
}

// ── E1 — email statements ──
const stmtSchema = z.object({ customerId: z.string().optional() });
router.post("/statements/email", requirePermission("customers.edit"), async (req, res, next) => {
  try {
    const body = stmtSchema.parse(req.body ?? {});
    const settings = await loadSettings();
    const targets = body.customerId
      ? await prisma.customer.findMany({ where: { id: body.customerId } , select: { id: true, name: true, email: true } })
      : await prisma.customer.findMany({ where: { isActive: true, balance: { gt: 0 }, email: { not: null } }, select: { id: true, name: true, email: true } });
    const results: { name: string; ok: boolean; detail: string }[] = [];
    for (const c of targets) {
      try {
        const to = await emailCustomerStatement(c.id, settings);
        await prisma.messageLog.create({ data: { channel: "EMAIL", recipient: to, template: "STATEMENT", refType: "Customer", refId: c.id, status: "SENT" } });
        results.push({ name: c.name, ok: true, detail: to });
      } catch (e: any) {
        await prisma.messageLog.create({ data: { channel: "EMAIL", recipient: c.email ?? "—", template: "STATEMENT", refType: "Customer", refId: c.id, status: "FAILED", error: e.message?.slice(0, 200) } });
        results.push({ name: c.name, ok: false, detail: e.message });
      }
    }
    res.json({ ok: true, data: { attempted: results.length, sent: results.filter((r) => r.ok).length, results } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

// ── E3 — bulk greetings / campaign ──
const campaignSchema = z.object({
  channel: z.enum(["SMS", "EMAIL", "WHATSAPP"]),
  message: z.string().trim().min(1, "Write a message").max(1000),
  subject: z.string().trim().max(160).optional(),
  customerIds: z.array(z.string()).optional(), // omit → all active customers with a contact
});

/** POST /outreach/campaign — blast a message to selected (or all) customers.
 *  SMS/EMAIL are sent server-side; WHATSAPP returns wa.me links for the client to open. */
router.post("/campaign", requirePermission("customers.edit"), async (req, res, next) => {
  try {
    const body = campaignSchema.parse(req.body);
    const settings = await loadSettings();
    const shop = settings.shop_name || "SoftGlaze";
    const where = body.customerIds?.length ? { id: { in: body.customerIds } } : { isActive: true };
    const customers = await prisma.customer.findMany({ where, select: { id: true, name: true, phone: true, email: true } });

    if (body.channel === "SMS" && !(await smsConfigured())) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "SMS gateway isn't configured (Settings → Integrations)" } });
    if (body.channel === "EMAIL" && !(await smtpConfigured())) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Email (SMTP) isn't configured (Settings → Integrations)" } });

    const links: { name: string; url: string }[] = [];
    let sent = 0, failed = 0, skipped = 0;
    for (const c of customers) {
      const text = body.message.replaceAll("{name}", c.name).replaceAll("{shop}", shop);
      try {
        if (body.channel === "SMS") {
          if (!c.phone) { skipped++; continue; }
          await sendSms({ to: c.phone, text });
          await prisma.messageLog.create({ data: { channel: "SMS", recipient: c.phone, template: "CAMPAIGN", refType: "Customer", refId: c.id, status: "SENT" } });
          sent++;
        } else if (body.channel === "EMAIL") {
          if (!c.email) { skipped++; continue; }
          await sendMail({ to: c.email, subject: body.subject || `A message from ${shop}`, text });
          await prisma.messageLog.create({ data: { channel: "EMAIL", recipient: c.email, template: "CAMPAIGN", refType: "Customer", refId: c.id, status: "SENT" } });
          sent++;
        } else {
          if (!c.phone) { skipped++; continue; }
          const url = `https://wa.me/${c.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(text)}`;
          links.push({ name: c.name, url });
          await prisma.messageLog.create({ data: { channel: "WHATSAPP", recipient: c.phone, template: "CAMPAIGN", refType: "Customer", refId: c.id, status: "QUEUED" } });
          sent++;
        }
      } catch (e: any) {
        failed++;
        await prisma.messageLog.create({ data: { channel: body.channel, recipient: c.phone ?? c.email ?? "—", template: "CAMPAIGN", refType: "Customer", refId: c.id, status: "FAILED", error: e.message?.slice(0, 200) } });
      }
    }
    res.json({ ok: true, data: { total: customers.length, sent, failed, skipped, links } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

// ── E4 — udhaar reminder escalation ──
router.get("/reminders/preview", requirePermission("customers.view"), async (_req, res, next) => {
  try {
    res.json({ ok: true, data: { plans: await planReminders() } });
  } catch (err) {
    next(err);
  }
});

router.post("/reminders/run", requirePermission("customers.edit"), async (_req, res, next) => {
  try {
    res.json({ ok: true, data: await runUdhaarEscalation() });
  } catch (err) {
    next(err);
  }
});

export default router;
