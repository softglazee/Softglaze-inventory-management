/**
 * A1 — Recurring expenses sweep. Auto-posts each active rule once per month, on/after
 * its `dayOfMonth`, as a REAL Expense (money out of its account + P&L hit) through the
 * same `postPayment` path as a manual expense — so accounting is identical and integrity
 * stays green. `lastPostedPeriod` ("YYYY-MM") dedupes, so running the sweep repeatedly
 * within a month never double-posts (mirrors the notification sweep in lib/notify.ts).
 */
import { prisma } from "./prisma";
import { nextNumber } from "../utils/counter";
import { postPayment } from "./accounts";

/** "YYYY-MM" for a date, in LOCAL time (P&L buckets are local — see reports.routes). */
function periodKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type PostedRecurring = { refNo: string; category: string; amount: string };

/**
 * Post all due recurring-expense rules. `actorUserId` attributes the created
 * Expense/Payment/AuditLog; when omitted (cron/boot) the oldest active SUPER_ADMIN — else
 * any active user — is used. Each rule posts in its OWN transaction, so one failure can't
 * block the rest. Returns the list of what was posted (empty if nothing was due).
 */
export async function runRecurringExpenses(actorUserId?: string): Promise<PostedRecurring[]> {
  const now = new Date();
  const period = periodKey(now);
  const today = now.getDate();

  // Resolve an actor for unattended (cron/boot) runs.
  let actor = actorUserId ?? null;
  if (!actor) {
    const owner =
      (await prisma.user.findFirst({ where: { role: "SUPER_ADMIN", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } })) ??
      (await prisma.user.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } }));
    actor = owner?.id ?? null;
  }
  if (!actor) return []; // no users yet — nothing to attribute to
  const actorId = actor;

  const due = await prisma.recurringExpense.findMany({
    where: {
      isActive: true,
      dayOfMonth: { lte: today },
      OR: [{ lastPostedPeriod: null }, { lastPostedPeriod: { not: period } }],
    },
    include: { category: { select: { name: true } } },
  });

  const posted: PostedRecurring[] = [];
  for (const rule of due) {
    try {
      // Date the expense to its intended day this month (noon, to dodge TZ edge cases).
      const date = new Date(now.getFullYear(), now.getMonth(), rule.dayOfMonth, 12, 0, 0);
      const refNo = await prisma.$transaction(async (tx) => {
        const ref = await nextNumber(tx, "expense", "EXP");
        const created = await tx.expense.create({
          data: { refNo: ref, categoryId: rule.categoryId, amount: rule.amount, notes: rule.notes, userId: actorId, date, recurringId: rule.id },
        });
        await postPayment(tx, { type: "EXPENSE", methodId: rule.methodId, amount: rule.amount, expenseId: created.id, userId: actorId, notes: rule.notes || `${rule.category.name} (recurring)`, date });
        await tx.recurringExpense.update({ where: { id: rule.id }, data: { lastPostedPeriod: period } });
        await tx.auditLog.create({ data: { userId: actorId, action: "RECURRING_EXPENSE_POST", entity: "Expense", entityId: created.id, details: `${ref} · ${rule.category.name} · ₨${rule.amount} (auto)` } });
        return ref;
      });
      posted.push({ refNo, category: rule.category.name, amount: String(rule.amount) });
    } catch (e) {
      console.error(`Recurring expense ${rule.id} failed:`, e);
    }
  }
  return posted;
}
