import "dotenv/config";
import cron from "node-cron";
import app from "./app";
import { prisma } from "./lib/prisma";
import { runSweep } from "./lib/notify";
import { runRecurringExpenses } from "./lib/recurring";
import { runUdhaarEscalation } from "./lib/reminders";
import { runMonthlyStatementsIfDue } from "./lib/statements";
import { runCloudBackupIfDue } from "./lib/cloud-backup";

const PORT = Number(process.env.PORT ?? 4000);

app.listen(PORT, () => {
  console.log(`💎 SoftGlaze Stock Manager API running on http://localhost:${PORT}`);
  // Post any due recurring expenses on boot (safe: deduped by month) so a shop that opens
  // the app each morning gets its rent/electricity/etc. without waiting for the sweep time.
  runRecurringExpenses()
    .then((p) => p.length && console.log(`🔁 Posted ${p.length} recurring expense(s) on boot`))
    .catch((e) => console.error("Recurring expense post (boot) failed:", e));
});

/**
 * Daily notification sweep (low stock, debt/payable reminders). The time comes from
 * the `low_stock_sweep_time` setting (HH:MM, default 09:00). Runs in both desktop and
 * VPS modes; the sweep dedupes so re-running is safe.
 */
let scheduled: cron.ScheduledTask | null = null;
async function scheduleSweep() {
  try {
    const row = await prisma.setting.findUnique({ where: { key: "low_stock_sweep_time" } });
    const [hh, mm] = (row?.value || "09:00").split(":").map((n) => Number(n));
    const expr = `${Number.isFinite(mm) ? mm : 0} ${Number.isFinite(hh) ? hh : 9} * * *`;
    if (!cron.validate(expr)) return;
    scheduled?.stop();
    scheduled = cron.schedule(expr, () => {
      runSweep().catch((e) => console.error("Notification sweep failed:", e));
      runRecurringExpenses()
        .then((p) => p.length && console.log(`🔁 Posted ${p.length} recurring expense(s)`))
        .catch((e) => console.error("Recurring expense post failed:", e));
      // E4 — udhaar reminder escalation (self-deduping via tier + cooldown)
      runUdhaarEscalation()
        .then((r) => r.sent && console.log(`📣 Sent ${r.sent} udhaar reminder(s)`))
        .catch((e) => console.error("Reminder escalation failed:", e));
      // E1 — monthly customer statements (runs once per month)
      runMonthlyStatementsIfDue()
        .then((r) => r?.sent && console.log(`📧 Emailed ${r.sent} monthly statement(s)`))
        .catch((e) => console.error("Monthly statements failed:", e));
      // H1 — offsite cloud backup (once/day if configured)
      runCloudBackupIfDue()
        .then((r) => r && console.log(`☁️  Uploaded cloud backup (${Math.round(r.bytes / 1024)} KB)`))
        .catch((e) => console.error("Cloud backup failed:", e));
    });
    console.log(`⏰ Daily reminder sweep scheduled at ${row?.value || "09:00"}`);
  } catch (e) {
    console.error("Could not schedule sweep:", e);
  }
}
scheduleSweep();
