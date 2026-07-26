/**
 * Party ledgers / statements (Phase 4). Reconstructs a running-balance statement for
 * a customer (receivable) or vendor (payable) from the underlying documents — sales,
 * purchases, returns and payments — so it ALWAYS reconciles to the cached balance.
 * `from`/`to` window the displayed rows; the opening balance rolls everything before
 * `from` into a single figure. Client turns this into a printable PDF statement.
 */
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";

const router = Router();
router.use(requireAuth);

const r2 = (v: number) => Math.round(v * 100) / 100;

type Row = { date: Date; refNo: string; type: string; description: string; debit: number; credit: number };

/** Build a windowed statement from raw rows. `signed` maps a row to its balance delta. */
function buildStatement(base: number, rows: Row[], signed: (r: Row) => number, from: Date | null, to: Date | null) {
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  let opening = base;
  const inWindow: (Row & { balance: number })[] = [];
  let running = base;
  for (const row of rows) {
    if (from && row.date < from) {
      opening = r2(opening + signed(row));
      running = opening;
      continue;
    }
    if (to && row.date > to) continue;
    running = r2(running + signed(row));
    inWindow.push({ ...row, balance: running });
  }
  const totalDebit = r2(inWindow.reduce((s, r) => s + r.debit, 0));
  const totalCredit = r2(inWindow.reduce((s, r) => s + r.credit, 0));
  return { opening: r2(opening), closing: r2(running), totalDebit, totalCredit, entries: inWindow };
}

/** GET /ledger/customer/:id?from&to — receivable statement (debit raises what they owe) */
router.get("/customer/:id", requirePermission("customers.view"), async (req, res, next) => {
  try {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!customer) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Customer not found" } });
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    const [sales, payments] = await Promise.all([
      prisma.sale.findMany({ where: { customerId: customer.id, status: { in: ["COMPLETED", "RETURNED"] } }, select: { invoiceNo: true, date: true, grandTotal: true, isReturn: true } }),
      prisma.payment.findMany({ where: { customerId: customer.id }, select: { refNo: true, date: true, amount: true, type: true } }),
    ]);

    const rows: Row[] = [];
    for (const s of sales) {
      if (s.isReturn) rows.push({ date: s.date, refNo: s.invoiceNo, type: "RETURN", description: "Sales return (credit note)", debit: 0, credit: Number(s.grandTotal) });
      else rows.push({ date: s.date, refNo: s.invoiceNo, type: "SALE", description: "Sale invoice", debit: Number(s.grandTotal), credit: 0 });
    }
    for (const p of payments) {
      if (p.type === "SALE_RECEIPT") rows.push({ date: p.date, refNo: p.refNo, type: "RECEIPT", description: "Paid at sale", debit: 0, credit: Number(p.amount) });
      else if (p.type === "CUSTOMER_RECEIPT") rows.push({ date: p.date, refNo: p.refNo, type: "RECEIPT", description: "Payment received", debit: 0, credit: Number(p.amount) });
      else if (p.type === "REFUND_OUT") rows.push({ date: p.date, refNo: p.refNo, type: "REFUND", description: "Cash refund paid", debit: Number(p.amount), credit: 0 });
    }

    const stmt = buildStatement(Number(customer.openingBalance), rows, (r) => r.debit - r.credit, from, to);
    res.json({ ok: true, data: { customer, balance: customer.balance, ...stmt } });
  } catch (err) {
    next(err);
  }
});

/** GET /ledger/vendor/:id?from&to — payable statement (credit raises what we owe) */
router.get("/vendor/:id", requirePermission("vendors.view"), async (req, res, next) => {
  try {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    if (!vendor) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Vendor not found" } });
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    const [purchases, payments] = await Promise.all([
      prisma.purchase.findMany({ where: { vendorId: vendor.id, status: { in: ["RECEIVED", "RETURNED"] } }, select: { invoiceNo: true, date: true, grandTotal: true, isReturn: true } }),
      prisma.payment.findMany({ where: { vendorId: vendor.id }, select: { refNo: true, date: true, amount: true, type: true } }),
    ]);

    // For a payable, `credit` raises what we owe (purchase), `debit` lowers it (payment / return).
    const rows: Row[] = [];
    for (const p of purchases) {
      if (p.isReturn) rows.push({ date: p.date, refNo: p.invoiceNo, type: "RETURN", description: "Purchase return", debit: Number(p.grandTotal), credit: 0 });
      else rows.push({ date: p.date, refNo: p.invoiceNo, type: "PURCHASE", description: "Purchase bill", debit: 0, credit: Number(p.grandTotal) });
    }
    for (const p of payments) {
      if (p.type === "PURCHASE_PAYMENT") rows.push({ date: p.date, refNo: p.refNo, type: "PAYMENT", description: "Paid at purchase", debit: Number(p.amount), credit: 0 });
      else if (p.type === "VENDOR_PAYMENT") rows.push({ date: p.date, refNo: p.refNo, type: "PAYMENT", description: "Payment made", debit: Number(p.amount), credit: 0 });
      else if (p.type === "REFUND_IN") rows.push({ date: p.date, refNo: p.refNo, type: "REFUND", description: "Refund received", debit: 0, credit: Number(p.amount) });
    }

    const stmt = buildStatement(Number(vendor.openingBalance), rows, (r) => r.credit - r.debit, from, to);
    res.json({ ok: true, data: { vendor, balance: vendor.balance, ...stmt } });
  } catch (err) {
    next(err);
  }
});

export default router;
