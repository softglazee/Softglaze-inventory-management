/**
 * SMTP mailer (Phase 6). Reads the SMTP settings saved by SUPER_ADMIN in
 * Settings → Integrations and sends via nodemailer. Every send is logged in
 * MessageLog by the caller. If SMTP isn't configured, sending throws a clear error.
 */
import nodemailer from "nodemailer";
import { prisma } from "./prisma";

export async function smtpConfig() {
  const rows = await prisma.setting.findMany({ where: { key: { in: ["smtp_host", "smtp_port", "smtp_secure", "smtp_user", "smtp_pass", "smtp_from_name", "shop_email", "shop_name"] } } });
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    host: s.smtp_host || "",
    port: Number(s.smtp_port || 587),
    secure: s.smtp_secure === "1" || s.smtp_secure === "true",
    user: s.smtp_user || "",
    pass: s.smtp_pass || "",
    fromName: s.smtp_from_name || s.shop_name || "SoftGlaze",
    fromEmail: s.shop_email || s.smtp_user || "",
  };
}

export async function sendMail(opts: { to: string; subject: string; html?: string; text?: string; attachments?: { filename: string; content: Buffer }[] }) {
  const cfg = await smtpConfig();
  if (!cfg.host) throw Object.assign(new Error("SMTP is not configured yet — set it in Settings → Integrations"), { status: 400, code: "VALIDATION" });
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
  });
  const from = cfg.fromEmail ? `"${cfg.fromName}" <${cfg.fromEmail}>` : cfg.fromName;
  return transport.sendMail({ from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text, attachments: opts.attachments });
}

export async function smtpConfigured(): Promise<boolean> {
  return !!(await smtpConfig()).host;
}
