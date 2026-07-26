/**
 * E4 — Tiered udhaar (credit) reminder escalation.
 *
 * As a customer's oldest unpaid bill ages, an escalating reminder ladder fires:
 *   Tier 1 (gentle) → Tier 2 (firm) → Tier 3 (final) at configurable day thresholds.
 * Each customer tracks the highest tier already sent (`reminderTier`) + when
 * (`lastReminderAt`), so we escalate on age but never spam: a higher tier sends
 * immediately, the same tier only re-sends after a cooldown. Paying off resets the tier.
 * Sends via SMS (if configured) or email (if configured); otherwise it records a QUEUED
 * WhatsApp entry so the shop can follow up by hand. Posts NOTHING to the ledgers.
 */
import { prisma } from "./prisma";
import { sendSms, smsConfigured } from "./sms";
import { sendMail, smtpConfigured } from "./mailer";

const num = (v: any) => (v == null ? 0 : Number(v));
const DAY = 86400000;

type Tiers = { days: number[]; texts: string[]; cooldownDays: number };

export async function reminderConfig(): Promise<Tiers> {
  const rows = await prisma.setting.findMany({ where: { key: { in: ["reminder_t1_days", "reminder_t2_days", "reminder_t3_days", "reminder_t1_text", "reminder_t2_text", "reminder_t3_text", "reminder_cooldown_days"] } } });
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    days: [Number(s.reminder_t1_days || 15), Number(s.reminder_t2_days || 30), Number(s.reminder_t3_days || 60)],
    texts: [
      s.reminder_t1_text || "Dear {name}, a gentle reminder: your balance of Rs {balance} at {shop} is due. Please clear it at your convenience. Thank you.",
      s.reminder_t2_text || "Dear {name}, your balance of Rs {balance} at {shop} is now overdue. Kindly settle it soon. Thank you.",
      s.reminder_t3_text || "Dear {name}, FINAL reminder: your overdue balance of Rs {balance} at {shop} needs to be cleared immediately. Please contact us. {shop}.",
    ],
    cooldownDays: Number(s.reminder_cooldown_days || 7),
  };
}

/** Age (days) of a customer's oldest still-unpaid charge. */
async function oldestDueAge(customerId: string, openingBalance: number, createdAt: Date): Promise<number> {
  const oldestSale = await prisma.sale.findFirst({ where: { customerId, status: "COMPLETED", isReturn: false, dueAmount: { gt: 0 } }, orderBy: { date: "asc" }, select: { date: true } });
  const anchor = oldestSale?.date ?? (openingBalance > 0 ? createdAt : null);
  if (!anchor) return 0;
  return Math.floor((Date.now() - anchor.getTime()) / DAY);
}

function tierFor(ageDays: number, days: number[]): number {
  if (ageDays >= days[2]) return 3;
  if (ageDays >= days[1]) return 2;
  if (ageDays >= days[0]) return 1;
  return 0;
}

export type ReminderPlan = { customerId: string; name: string; balance: number; ageDays: number; tier: number; already: number; willSend: boolean; reason: string };

/** Work out, per customer, which tier applies and whether we'd send now. */
export async function planReminders(): Promise<ReminderPlan[]> {
  const cfg = await reminderConfig();
  const customers = await prisma.customer.findMany({ where: { isActive: true, balance: { gt: 0 } }, select: { id: true, name: true, balance: true, openingBalance: true, createdAt: true, reminderTier: true, lastReminderAt: true } });
  const plans: ReminderPlan[] = [];
  for (const c of customers) {
    const ageDays = await oldestDueAge(c.id, num(c.openingBalance), c.createdAt);
    const tier = tierFor(ageDays, cfg.days);
    let willSend = false;
    let reason = "";
    if (tier === 0) reason = "not old enough yet";
    else if (tier > c.reminderTier) { willSend = true; reason = `escalate to tier ${tier}`; }
    else {
      const sinceLast = c.lastReminderAt ? (Date.now() - c.lastReminderAt.getTime()) / DAY : Infinity;
      if (sinceLast >= cfg.cooldownDays) { willSend = true; reason = `re-send tier ${tier} (cooldown passed)`; }
      else reason = `tier ${tier} sent ${Math.floor(sinceLast)}d ago (cooldown ${cfg.cooldownDays}d)`;
    }
    plans.push({ customerId: c.id, name: c.name, balance: num(c.balance), ageDays, tier, already: c.reminderTier, willSend, reason });
  }
  return plans;
}

/** Run the escalation: send due reminders, update tier/lastReminderAt, reset paid-off customers. */
export async function runUdhaarEscalation(): Promise<{ sent: number; byChannel: Record<string, number>; reset: number }> {
  const cfg = await reminderConfig();
  const settings = Object.fromEntries((await prisma.setting.findMany({ where: { key: { in: ["shop_name"] } } })).map((r) => [r.key, r.value]));
  const shop = settings.shop_name || "SoftGlaze";
  const [smsOk, mailOk] = [await smsConfigured(), await smtpConfigured()];

  // Reset customers who have cleared their balance.
  const reset = await prisma.customer.updateMany({ where: { balance: { lte: 0 }, reminderTier: { gt: 0 } }, data: { reminderTier: 0, lastReminderAt: null } });

  const plans = await planReminders();
  const byChannel: Record<string, number> = {};
  let sent = 0;
  for (const p of plans.filter((x) => x.willSend)) {
    const c = await prisma.customer.findUnique({ where: { id: p.customerId }, select: { phone: true, email: true } });
    const text = cfg.texts[p.tier - 1].replaceAll("{name}", p.name).replaceAll("{balance}", String(p.balance)).replaceAll("{shop}", shop);
    let channel: "SMS" | "EMAIL" | "WHATSAPP" = "WHATSAPP";
    let status: "SENT" | "QUEUED" | "FAILED" = "QUEUED";
    let recipient = c?.phone ?? "";
    try {
      if (smsOk && c?.phone) { await sendSms({ to: c.phone, text }); channel = "SMS"; status = "SENT"; recipient = c.phone; }
      else if (mailOk && c?.email) { await sendMail({ to: c.email, subject: `Payment reminder — ${shop}`, text }); channel = "EMAIL"; status = "SENT"; recipient = c.email; }
      else { channel = "WHATSAPP"; status = "QUEUED"; recipient = c?.phone ?? c?.email ?? ""; } // no auto channel → leave for manual follow-up
    } catch {
      status = "FAILED";
    }
    await prisma.messageLog.create({ data: { channel, recipient: recipient || "—", template: `DEBT_REMINDER_T${p.tier}`, refType: "Customer", refId: p.customerId, status } });
    if (status !== "FAILED") {
      await prisma.customer.update({ where: { id: p.customerId }, data: { reminderTier: p.tier, lastReminderAt: new Date() } });
      byChannel[channel] = (byChannel[channel] ?? 0) + 1;
      sent++;
    }
  }
  return { sent, byChannel, reset: reset.count };
}
