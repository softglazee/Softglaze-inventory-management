/**
 * Notifications (Phase 6, docs/09 §4). Generates in-app bell items:
 *  - LOW_STOCK: product at/below its minimum
 *  - DEBT_REMINDER: customer receivable older than `debt_reminder_days`
 *  - PAYABLE_REMINDER: vendor payable older than the same window
 * The sweep dedupes against existing UNREAD notifications so it can run daily
 * (node-cron) and on demand without spamming.
 */
import { NotificationType } from "@prisma/client";
import { prisma } from "./prisma";

export async function createNotification(args: { type: NotificationType; title: string; message: string; entity?: string; entityId?: string; userId?: string | null }) {
  // Skip if an identical unread notification already exists for this entity.
  if (args.entityId) {
    const existing = await prisma.notification.findFirst({ where: { type: args.type, entityId: args.entityId, isRead: false } });
    if (existing) return existing;
  }
  return prisma.notification.create({
    data: { type: args.type, title: args.title, message: args.message, entity: args.entity ?? null, entityId: args.entityId ?? null, userId: args.userId ?? null },
  });
}

/**
 * Raise LOW_STOCK for any of the given products that are now at/below their minimum.
 * Call this (fire-and-forget) right after a stock-lowering write — sale, adjustment,
 * purchase return — so the bell reacts immediately instead of waiting for the daily
 * sweep. Dedupes against unread notifications, so repeated sales won't spam.
 */
export async function notifyLowStock(productIds: string[]): Promise<void> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (!ids.length) return;
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, isActive: true, type: "STANDARD", minStockLevel: { gt: 0 }, stockQty: { lte: prisma.product.fields.minStockLevel } },
    select: { id: true, name: true, stockQty: true, minStockLevel: true, unit: { select: { shortName: true } } },
  });
  for (const p of products) {
    await createNotification({ type: "LOW_STOCK", title: "Low stock", message: `${p.name} is down to ${p.stockQty} ${p.unit?.shortName ?? ""} (min ${p.minStockLevel})`, entity: "Product", entityId: p.id });
  }
}

const DAY = 86400000;

/** Scan the shop and raise notifications. Returns how many of each were created. */
export async function runSweep(): Promise<{ lowStock: number; debt: number; payable: number }> {
  let lowStock = 0, debt = 0, payable = 0;

  // Low stock (STANDARD products at/below their min, min>0)
  const products = await prisma.product.findMany({
    where: { isActive: true, type: "STANDARD", minStockLevel: { gt: 0 }, stockQty: { lte: prisma.product.fields.minStockLevel } },
    select: { id: true, name: true, stockQty: true, minStockLevel: true, unit: { select: { shortName: true } } },
  });
  for (const p of products) {
    await createNotification({ type: "LOW_STOCK", title: "Low stock", message: `${p.name} is down to ${p.stockQty} ${p.unit?.shortName ?? ""} (min ${p.minStockLevel})`, entity: "Product", entityId: p.id });
    lowStock++;
  }

  // Debt & payable reminders
  const daysRow = await prisma.setting.findUnique({ where: { key: "debt_reminder_days" } });
  const days = Math.max(1, Number(daysRow?.value || 30));
  const cutoff = new Date(Date.now() - days * DAY);

  const debtors = await prisma.customer.findMany({ where: { balance: { gt: 0 } }, select: { id: true, name: true, balance: true } });
  for (const c of debtors) {
    const oldest = await prisma.sale.findFirst({ where: { customerId: c.id, status: "COMPLETED", isReturn: false, dueAmount: { gt: 0 }, date: { lt: cutoff } }, orderBy: { date: "asc" }, select: { date: true } });
    if (!oldest) continue;
    await createNotification({ type: "DEBT_REMINDER", title: "Udhaar pending", message: `${c.name} owes ₨${c.balance} — oldest bill from ${oldest.date.toLocaleDateString("en-GB")}`, entity: "Customer", entityId: c.id });
    debt++;
  }

  const creditors = await prisma.vendor.findMany({ where: { balance: { gt: 0 } }, select: { id: true, name: true, balance: true } });
  for (const v of creditors) {
    const oldest = await prisma.purchase.findFirst({ where: { vendorId: v.id, status: "RECEIVED", isReturn: false, dueAmount: { gt: 0 }, date: { lt: cutoff } }, orderBy: { date: "asc" }, select: { date: true } });
    if (!oldest) continue;
    await createNotification({ type: "PAYABLE_REMINDER", title: "Vendor payment due", message: `You owe ${v.name} ₨${v.balance} — oldest bill from ${oldest.date.toLocaleDateString("en-GB")}`, entity: "Vendor", entityId: v.id });
    payable++;
  }

  // Cheques due to clear on/before today that are still PENDING
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const dueCheques = await prisma.cheque.findMany({ where: { status: "PENDING", chequeDate: { lte: today } }, select: { id: true, chequeNo: true, amount: true, direction: true, customer: { select: { name: true } }, vendor: { select: { name: true } } } });
  for (const c of dueCheques) {
    const party = c.customer?.name ?? c.vendor?.name ?? "";
    await createNotification({ type: "CHEQUE_DUE", title: c.direction === "RECEIVED" ? "Cheque to deposit" : "Cheque will be presented", message: `Cheque ${c.chequeNo} (${party}) for ₨${c.amount} is due — mark it cleared or bounced`, entity: "Cheque", entityId: c.id });
  }

  // Promise-to-pay dates that have arrived and are still OPEN (A4)
  const duePromises = await prisma.paymentPromise.findMany({ where: { status: "OPEN", promiseDate: { lte: today } }, select: { id: true, amount: true, promiseDate: true, customer: { select: { name: true } } } });
  for (const pr of duePromises) {
    await createNotification({ type: "PROMISE_DUE", title: "Promise to pay due", message: `${pr.customer.name} promised ₨${pr.amount} by ${pr.promiseDate.toLocaleDateString("en-GB")} — follow up`, entity: "PaymentPromise", entityId: pr.id });
  }

  return { lowStock, debt, payable };
}
