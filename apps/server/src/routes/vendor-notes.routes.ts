import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { nextNumber } from "../utils/counter";

/**
 * D4 — Vendor debit/credit notes.
 *
 * A formal adjustment to a vendor's balance that is NOT a purchase or a cash payment
 * (rate correction, allowance, goods returned without a stock document):
 *   • CREDIT note → the vendor credits us → our payable goes DOWN  → recognised as income
 *   • DEBIT  note → we owe the vendor more → our payable goes UP    → recognised as cost
 * The only ledger touched is the vendor balance; the double-entry counterpart flows to
 * retained earnings in the balance sheet (see reports.computeBalanceSheet), and the
 * vendor-reconciliation integrity check includes these notes — so the books stay exact.
 */

const router = Router();
router.use(requireAuth);

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const money = (v: number) => new Prisma.Decimal(Math.round(v * 100) / 100);

const noteInclude = { vendor: { select: { id: true, code: true, name: true } }, user: { select: { name: true } } } satisfies Prisma.VendorNoteInclude;

/** GET /vendor-notes?vendorId&page&limit */
router.get("/", requirePermission("vendors.view"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const vendorId = String(req.query.vendorId ?? "");
    const where: Prisma.VendorNoteWhereInput = vendorId ? { vendorId } : {};
    const [notes, total] = await Promise.all([
      prisma.vendorNote.findMany({ where, include: noteInclude, orderBy: { date: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.vendorNote.count({ where }),
    ]);
    res.json({ ok: true, data: { notes, total, page, pages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  vendorId: z.string().min(1),
  type: z.enum(["CREDIT", "DEBIT"]),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  reason: z.string().trim().min(1, "Give a reason").max(300),
  date: z.coerce.date().optional(),
});

/** POST /vendor-notes — issue a debit/credit note (adjusts the vendor balance). */
router.post("/", requirePermission("vendors.edit"), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const vendor = await prisma.vendor.findUnique({ where: { id: body.vendorId }, select: { id: true, name: true } });
    if (!vendor) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Vendor not found" } });

    const delta = body.type === "DEBIT" ? body.amount : -body.amount; // DEBIT raises payable, CREDIT lowers it

    const note = await prisma.$transaction(async (tx) => {
      const refNo = await nextNumber(tx, "vendor_note", "VDN");
      const created = await tx.vendorNote.create({
        data: { refNo, vendorId: vendor.id, type: body.type, amount: money(body.amount), reason: body.reason, userId: req.user!.id, ...(body.date ? { date: body.date } : {}) },
      });
      await tx.vendor.update({ where: { id: vendor.id }, data: { balance: { increment: money(delta) } } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "VENDOR_NOTE", entity: "VendorNote", entityId: created.id, details: `${refNo} · ${body.type} ₨${body.amount} · ${vendor.name}` } });
      return created;
    });

    const full = await prisma.vendorNote.findUnique({ where: { id: note.id }, include: noteInclude });
    res.status(201).json({ ok: true, data: { note: full } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** DELETE /vendor-notes/:id — reverse a note (rolls the vendor balance back). */
router.delete("/:id", requirePermission("vendors.edit"), async (req, res, next) => {
  try {
    const note = await prisma.vendorNote.findUnique({ where: { id: req.params.id } });
    if (!note) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Note not found" } });
    const delta = note.type === "DEBIT" ? -num(note.amount) : num(note.amount); // undo the original effect
    await prisma.$transaction(async (tx) => {
      await tx.vendor.update({ where: { id: note.vendorId }, data: { balance: { increment: money(delta) } } });
      await tx.vendorNote.delete({ where: { id: note.id } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "VENDOR_NOTE_DELETE", entity: "VendorNote", entityId: note.id, details: `${note.refNo} reversed` } });
    });
    res.json({ ok: true, data: { message: "Note reversed" } });
  } catch (err) {
    next(err);
  }
});

export default router;
