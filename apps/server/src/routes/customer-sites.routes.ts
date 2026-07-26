/**
 * Customer sites / site-wise sub-ledgers (C4). A contractor buys for several sites; each
 * sale and receipt can be tagged with a site. Per-site balances are DERIVED from the same
 * customer-ledger math filtered by the site tag — there is no cached per-site balance, so
 * Σ(site balances) + an "unassigned" residual always equals the customer's single balance
 * by construction. This adds no accounting invariant and cannot drift.
 */
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";

const router = Router();
router.use(requireAuth);

const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: any) => (v == null ? 0 : Number(v));

type Row = { date: Date; refNo: string; type: string; description: string; debit: number; credit: number; siteId: string | null };

/** All customer-ledger rows carrying their site tag. `debit − credit` = receivable delta. */
async function ledgerRows(customerId: string): Promise<Row[]> {
  const [sales, payments] = await Promise.all([
    prisma.sale.findMany({ where: { customerId, status: { in: ["COMPLETED", "RETURNED"] } }, select: { invoiceNo: true, date: true, grandTotal: true, isReturn: true, siteId: true } }),
    prisma.payment.findMany({ where: { customerId }, select: { refNo: true, date: true, amount: true, type: true, siteId: true } }),
  ]);
  const rows: Row[] = [];
  for (const s of sales) {
    if (s.isReturn) rows.push({ date: s.date, refNo: s.invoiceNo, type: "RETURN", description: "Sales return (credit note)", debit: 0, credit: num(s.grandTotal), siteId: s.siteId });
    else rows.push({ date: s.date, refNo: s.invoiceNo, type: "SALE", description: "Sale invoice", debit: num(s.grandTotal), credit: 0, siteId: s.siteId });
  }
  for (const p of payments) {
    if (p.type === "SALE_RECEIPT") rows.push({ date: p.date, refNo: p.refNo, type: "RECEIPT", description: "Paid at sale", debit: 0, credit: num(p.amount), siteId: p.siteId });
    else if (p.type === "CUSTOMER_RECEIPT") rows.push({ date: p.date, refNo: p.refNo, type: "RECEIPT", description: "Payment received", debit: 0, credit: num(p.amount), siteId: p.siteId });
    else if (p.type === "REFUND_OUT") rows.push({ date: p.date, refNo: p.refNo, type: "REFUND", description: "Cash refund paid", debit: num(p.amount), credit: 0, siteId: p.siteId });
  }
  return rows;
}

/**
 * GET /customer-sites?customerId= — the customer's sites, each with its DERIVED balance,
 * plus the "unassigned" residual (opening balance + untagged activity) and the total that
 * must equal the customer's balance.
 */
router.get("/", requirePermission("customers.view"), async (req, res, next) => {
  try {
    const customerId = String(req.query.customerId ?? "");
    if (!customerId) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "customerId is required" } });
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, balance: true, openingBalance: true } });
    if (!customer) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Customer not found" } });

    const [sites, rows] = await Promise.all([
      prisma.customerSite.findMany({ where: { customerId }, orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
      ledgerRows(customerId),
    ]);

    // Sum receivable delta per site tag; opening balance seeds the unassigned bucket.
    const bySite = new Map<string, number>();
    let unassigned = num(customer.openingBalance);
    for (const row of rows) {
      const delta = r2(row.debit - row.credit);
      if (row.siteId) bySite.set(row.siteId, r2((bySite.get(row.siteId) ?? 0) + delta));
      else unassigned = r2(unassigned + delta);
    }
    const siteViews = sites.map((s) => ({ ...s, balance: r2(bySite.get(s.id) ?? 0) }));
    const total = r2(siteViews.reduce((sum, s) => sum + s.balance, 0) + unassigned);

    res.json({
      ok: true,
      data: {
        sites: siteViews,
        unassigned,
        total,
        customerBalance: num(customer.balance),
        reconciles: Math.abs(total - num(customer.balance)) < 0.01,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /customer-sites/:id/ledger?from&to — running statement for one site. */
router.get("/:id/ledger", requirePermission("customers.view"), async (req, res, next) => {
  try {
    const site = await prisma.customerSite.findUnique({ where: { id: req.params.id }, include: { customer: { select: { id: true, code: true, name: true, phone: true } } } });
    if (!site) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Site not found" } });
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    const rows = (await ledgerRows(site.customerId)).filter((r) => r.siteId === site.id);
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());
    let opening = 0;
    let running = 0;
    const entries: (Row & { balance: number })[] = [];
    for (const row of rows) {
      const delta = r2(row.debit - row.credit);
      if (from && row.date < from) { opening = r2(opening + delta); running = opening; continue; }
      if (to && row.date > to) continue;
      running = r2(running + delta);
      entries.push({ ...row, balance: running });
    }
    const totalDebit = r2(entries.reduce((s, r) => s + r.debit, 0));
    const totalCredit = r2(entries.reduce((s, r) => s + r.credit, 0));
    res.json({ ok: true, data: { site, customer: site.customer, opening: r2(opening), closing: r2(running), totalDebit, totalCredit, entries } });
  } catch (err) {
    next(err);
  }
});

const siteSchema = z.object({
  customerId: z.string().min(1, "Pick a customer"),
  name: z.string().trim().min(1, "Site name is required").max(120),
  address: z.string().trim().max(300).nullable().optional(),
  isActive: z.boolean().default(true),
});

/** POST /customer-sites — add a site to a customer. */
router.post("/", requirePermission("customers.create"), async (req, res, next) => {
  try {
    const body = siteSchema.parse(req.body);
    const customer = await prisma.customer.findUnique({ where: { id: body.customerId }, select: { id: true } });
    if (!customer) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Customer not found" } });
    const site = await prisma.customerSite.create({ data: { customerId: body.customerId, name: body.name, address: body.address || null, isActive: body.isActive } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "CREATE_CUSTOMER_SITE", entity: "CustomerSite", entityId: site.id, details: site.name } });
    res.status(201).json({ ok: true, data: { site } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** PATCH /customer-sites/:id — rename / re-address / activate a site. */
router.patch("/:id", requirePermission("customers.edit"), async (req, res, next) => {
  try {
    const body = siteSchema.partial().parse(req.body);
    const existing = await prisma.customerSite.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Site not found" } });
    const site = await prisma.customerSite.update({
      where: { id: req.params.id },
      data: { name: body.name, address: body.address === undefined ? undefined : body.address || null, isActive: body.isActive },
    });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "UPDATE_CUSTOMER_SITE", entity: "CustomerSite", entityId: site.id, details: site.name } });
    res.json({ ok: true, data: { site } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** DELETE /customer-sites/:id — delete if unused, else deactivate (keeps tagged history). */
router.delete("/:id", requirePermission("customers.delete"), async (req, res, next) => {
  try {
    const site = await prisma.customerSite.findUnique({ where: { id: req.params.id }, include: { _count: { select: { sales: true, payments: true } } } });
    if (!site) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Site not found" } });
    if (site._count.sales > 0 || site._count.payments > 0) {
      await prisma.customerSite.update({ where: { id: site.id }, data: { isActive: false } });
      await prisma.auditLog.create({ data: { userId: req.user!.id, action: "DEACTIVATE_CUSTOMER_SITE", entity: "CustomerSite", entityId: site.id, details: site.name } });
      return res.json({ ok: true, data: { message: `${site.name} has history, so it was deactivated`, deactivated: true } });
    }
    await prisma.customerSite.delete({ where: { id: site.id } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "DELETE_CUSTOMER_SITE", entity: "CustomerSite", entityId: site.id, details: site.name } });
    res.json({ ok: true, data: { message: `${site.name} deleted`, deactivated: false } });
  } catch (err) {
    next(err);
  }
});

export default router;
