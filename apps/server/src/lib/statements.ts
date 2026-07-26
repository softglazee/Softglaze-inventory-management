/**
 * E1 — Customer statement PDF + email. Rebuilds the running-balance statement from the
 * source documents (sales, returns, receipts) exactly like the ledger route, renders it
 * to a PDF via the shared report exporter, and emails it. Reused by the "email statements
 * now" endpoint and the monthly cron. Reads nothing new — no ledger writes.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { sendMail } from "./mailer";
import { buildPdf, ReportDoc } from "./report-export";

const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));

type Row = { date: Date; refNo: string; description: string; debit: number; credit: number };

async function statementRows(customerId: string) {
  const [sales, payments] = await Promise.all([
    prisma.sale.findMany({ where: { customerId, status: { in: ["COMPLETED", "RETURNED"] } }, select: { invoiceNo: true, date: true, grandTotal: true, isReturn: true } }),
    prisma.payment.findMany({ where: { customerId }, select: { refNo: true, date: true, amount: true, type: true } }),
  ]);
  const rows: Row[] = [];
  for (const s of sales) {
    if (s.isReturn) rows.push({ date: s.date, refNo: s.invoiceNo, description: "Sales return", debit: 0, credit: num(s.grandTotal) });
    else rows.push({ date: s.date, refNo: s.invoiceNo, description: "Sale invoice", debit: num(s.grandTotal), credit: 0 });
  }
  for (const p of payments) {
    if (p.type === "SALE_RECEIPT" || p.type === "CUSTOMER_RECEIPT") rows.push({ date: p.date, refNo: p.refNo, description: "Payment received", debit: 0, credit: num(p.amount) });
    else if (p.type === "REFUND_OUT") rows.push({ date: p.date, refNo: p.refNo, description: "Cash refund paid", debit: num(p.amount), credit: 0 });
  }
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  return rows;
}

/** Build a statement ReportDoc for a customer over the whole history (running balance). */
export async function buildStatementDoc(customerId: string): Promise<{ customer: { id: string; name: string; email: string | null; balance: Prisma.Decimal }; doc: ReportDoc } | null> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, email: true, openingBalance: true, balance: true } });
  if (!customer) return null;
  const rows = await statementRows(customerId);
  let running = num(customer.openingBalance);
  const body = rows.map((row) => { running = r2(running + row.debit - row.credit); return { date: row.date.toLocaleDateString("en-GB"), ref: row.refNo, description: row.description, debit: row.debit || "", credit: row.credit || "", balance: running }; });
  const doc: ReportDoc = {
    title: `Statement of Account — ${customer.name}`,
    meta: [{ label: "As of", value: new Date().toLocaleDateString("en-GB") }, { label: "Balance due", value: `₨${num(customer.balance)}` }],
    columns: [
      { header: "Date", key: "date" },
      { header: "Ref", key: "ref" },
      { header: "Detail", key: "description" },
      { header: "Debit", key: "debit", align: "right", money: true },
      { header: "Credit", key: "credit", align: "right", money: true },
      { header: "Balance", key: "balance", align: "right", money: true },
    ],
    rows: body,
    totals: { date: "Closing balance", balance: num(customer.balance) },
  };
  return { customer, doc };
}

/** Monthly auto-statements: once per calendar month (deduped via a setting), email every
 *  active customer who has an email and an outstanding balance. Safe to call daily. */
export async function runMonthlyStatementsIfDue(): Promise<{ sent: number } | null> {
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const last = await prisma.setting.findUnique({ where: { key: "statements_last_period" } });
  if (last?.value === period) return null; // already sent this month
  const settings = Object.fromEntries((await prisma.setting.findMany()).map((r) => [r.key, r.value]));
  if (!settings.smtp_host) return null; // no SMTP → nothing to do
  const customers = await prisma.customer.findMany({ where: { isActive: true, balance: { gt: 0 }, email: { not: null } }, select: { id: true, email: true } });
  let sent = 0;
  for (const c of customers) {
    try { const to = await emailCustomerStatement(c.id, settings); await prisma.messageLog.create({ data: { channel: "EMAIL", recipient: to, template: "STATEMENT", refType: "Customer", refId: c.id, status: "SENT" } }); sent++; }
    catch (e: any) { await prisma.messageLog.create({ data: { channel: "EMAIL", recipient: c.email ?? "—", template: "STATEMENT", refType: "Customer", refId: c.id, status: "FAILED", error: e.message?.slice(0, 200) } }); }
  }
  await prisma.setting.upsert({ where: { key: "statements_last_period" }, create: { key: "statements_last_period", value: period }, update: { value: period } });
  return { sent };
}

/** Email a customer their statement PDF. Returns the recipient, throws if no email/SMTP. */
export async function emailCustomerStatement(customerId: string, settings: Record<string, string>): Promise<string> {
  const built = await buildStatementDoc(customerId);
  if (!built) throw Object.assign(new Error("Customer not found"), { status: 404, code: "NOT_FOUND" });
  const to = built.customer.email;
  if (!to) throw Object.assign(new Error(`${built.customer.name} has no email address`), { status: 400, code: "VALIDATION" });
  const pdf = await buildPdf(built.doc, settings);
  const shop = settings.shop_name || "SoftGlaze";
  await sendMail({
    to,
    subject: `Statement of account — ${shop}`,
    text: `Dear ${built.customer.name},\n\nPlease find your statement of account attached. Your current balance is ₨${num(built.customer.balance)}.\n\nThank you,\n${shop}`,
    attachments: [{ filename: `statement-${built.customer.name}.pdf`, content: pdf }],
  });
  return to;
}
