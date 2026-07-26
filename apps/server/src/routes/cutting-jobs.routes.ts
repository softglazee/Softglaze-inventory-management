import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { nextNumber } from "../utils/counter";
import { applyMovement, weightedAvg, InsufficientStockError } from "../lib/stock";
import { notifyLowStock } from "../lib/notify";

/**
 * C6 — Rod/pipe cutting & offcut tracking.
 *
 * A cutting job cuts a full bar/pipe/sheet into the piece the customer needs plus
 * leftover offcuts. It is a VALUE-CONSERVING stock conversion — no money moves:
 *   • the source stock leaves          → CUT_OUT  (−(sourceQty − wastage) at avg cost)
 *   • optional saw/scrap wastage leaves → DAMAGE   (−wastage, a recognised P&L loss)
 *   • each piece / offcut comes back    → CUT_IN   (+qty at an allocated cost)
 * The source's weighted-avg cost is split across the outputs by length (fallback qty),
 * so total inventory value is unchanged and every offcut re-enters stock at a fair
 * cost. A later sale of a piece/offcut therefore carries the correct COGS, and the
 * balance sheet stays exact (any 2dp rounding is absorbed by the existing revaluation
 * term — same as landed cost). No new integrity invariant is introduced.
 */

const router = Router();
router.use(requireAuth);

const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));

const jobInclude = {
  user: { select: { name: true } },
  sourceProduct: { select: { id: true, name: true, sku: true, unit: { select: { shortName: true } } } },
  outputs: {
    include: { product: { select: { id: true, name: true, sku: true, unit: { select: { shortName: true } } } } },
  },
} satisfies Prisma.CuttingJobInclude;

/** GET /cutting-jobs?page&limit — cutting history, newest first. */
router.get("/", requirePermission("products.view"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const [jobs, total] = await Promise.all([
      prisma.cuttingJob.findMany({ include: jobInclude, orderBy: { date: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.cuttingJob.count(),
    ]);
    res.json({ ok: true, data: { jobs, total, page, pages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) {
    next(err);
  }
});

/** GET /cutting-jobs/:id — one job with its outputs. */
router.get("/:id", requirePermission("products.view"), async (req, res, next) => {
  try {
    const job = await prisma.cuttingJob.findUnique({ where: { id: req.params.id }, include: jobInclude });
    if (!job) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Cutting job not found" } });
    res.json({ ok: true, data: { job } });
  } catch (err) {
    next(err);
  }
});

const outputSchema = z.object({
  productId: z.string().min(1),
  kind: z.enum(["PIECE", "OFFCUT"]).default("PIECE"),
  qty: z.coerce.number().positive("Quantity must be greater than zero"),
  lengthFt: z.coerce.number().positive().nullable().optional(),
});

const createSchema = z.object({
  sourceProductId: z.string().min(1),
  sourceQty: z.coerce.number().positive("Cut quantity must be greater than zero"),
  wastageQty: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(1000).nullable().optional(),
  outputs: z.array(outputSchema).min(1, "Add at least one cut piece or offcut"),
});

/**
 * POST /cutting-jobs — cut a bar into pieces + offcuts (value-conserving).
 * One transaction: CuttingJob + outputs + StockMovements (CUT_OUT / DAMAGE / CUT_IN)
 * + cached stockQty updates + Counter + AuditLog.
 */
router.post("/", requirePermission("stock.adjust"), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);

    // Source must be a stock-tracking product.
    const source = await prisma.product.findUnique({
      where: { id: body.sourceProductId },
      select: { id: true, name: true, type: true, costPrice: true, stockQty: true },
    });
    if (!source) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Source product not found" } });
    if (source.type !== "STANDARD") return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: `${source.name} does not track stock` } });

    if (body.wastageQty >= body.sourceQty) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Wastage can't be the whole bar — use a stock adjustment for a full write-off" } });
    }
    if (num(source.stockQty) < body.sourceQty) {
      return res.status(409).json({ ok: false, error: { code: "INSUFFICIENT_STOCK", message: `${source.name} has only ${num(source.stockQty)} in stock` } });
    }

    // Output products must exist and track stock.
    const outIds = [...new Set(body.outputs.map((o) => o.productId))];
    const outProducts = await prisma.product.findMany({ where: { id: { in: outIds } }, select: { id: true, name: true, type: true } });
    const outById = new Map(outProducts.map((p) => [p.id, p]));
    for (const o of body.outputs) {
      const p = outById.get(o.productId);
      if (!p) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "One of the output products was not found" } });
      if (p.type !== "STANDARD") return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: `${p.name} does not track stock` } });
    }

    // ── Cost split ────────────────────────────────────────────────────────────
    // The bar's weighted-avg cost is the snapshot. The portion that becomes usable
    // output (sourceQty − wastage) carries its full value; wastage is a loss. Split
    // that value across outputs by length×qty (fallback qty), last line takes the
    // rounding remainder so the pieces exactly re-absorb the consumed value.
    const unitCost = r2(num(source.costPrice));
    const totalCost = r2(body.sourceQty * unitCost);
    const convertedQty = r2(body.sourceQty - body.wastageQty);
    const valueToOutputs = r2(convertedQty * unitCost);

    const weights = body.outputs.map((o) => o.qty * (o.lengthFt && o.lengthFt > 0 ? o.lengthFt : 1));
    const weightSum = weights.reduce((a, w) => a + w, 0) || 1;
    let allocated = 0;
    const outLines = body.outputs.map((o, i) => {
      const isLast = i === body.outputs.length - 1;
      const value = isLast ? r2(valueToOutputs - allocated) : r2((valueToOutputs * weights[i]) / weightSum);
      allocated = r2(allocated + value);
      const uc = r2(value / o.qty); // per-unit allocated cost (2dp; residue absorbed by revaluation)
      return { ...o, value, unitCost: uc };
    });

    const job = await prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, "cutting", "CUT");
      const created = await tx.cuttingJob.create({
        data: {
          number,
          sourceProductId: source.id,
          sourceQty: new Prisma.Decimal(body.sourceQty),
          sourceUnitCost: new Prisma.Decimal(unitCost),
          wastageQty: new Prisma.Decimal(body.wastageQty),
          totalCost: new Prisma.Decimal(totalCost),
          notes: body.notes ?? null,
          userId: req.user!.id,
          outputs: {
            create: outLines.map((o) => ({
              productId: o.productId,
              kind: o.kind,
              qty: new Prisma.Decimal(o.qty),
              lengthFt: o.lengthFt != null ? new Prisma.Decimal(o.lengthFt) : null,
              unitCost: new Prisma.Decimal(o.unitCost),
            })),
          },
        },
      });

      // Source out: the converted portion leaves as a cut, wastage leaves as a loss.
      await applyMovement(tx, {
        productId: source.id,
        type: "CUT_OUT",
        qty: -convertedQty,
        unitCost,
        refType: "CUTTING_JOB",
        refId: created.id,
        notes: `${number}: cut ${convertedQty}`,
        productName: source.name,
      });
      if (body.wastageQty > 0) {
        await applyMovement(tx, {
          productId: source.id,
          type: "DAMAGE",
          qty: -body.wastageQty,
          unitCost,
          refType: "CUTTING_JOB",
          refId: created.id,
          notes: `${number}: cutting waste`,
          productName: source.name,
        });
      }

      // Pieces / offcuts back into stock at their allocated cost. Fold that cost into
      // the product's weighted-avg costPrice (same as a purchase) BEFORE the movement,
      // so the offcut is valued on the books and a later sale carries the right COGS.
      for (const o of outLines) {
        const cur = await tx.product.findUnique({ where: { id: o.productId }, select: { stockQty: true, costPrice: true } });
        const newAvg = weightedAvg(cur!.stockQty, cur!.costPrice, o.qty, o.unitCost);
        await tx.product.update({ where: { id: o.productId }, data: { costPrice: newAvg } });
        await applyMovement(tx, {
          productId: o.productId,
          type: "CUT_IN",
          qty: o.qty,
          unitCost: o.unitCost,
          refType: "CUTTING_JOB",
          refId: created.id,
          notes: `${number}: ${o.kind.toLowerCase()}`,
          productName: outById.get(o.productId)!.name,
        });
      }

      await tx.auditLog.create({ data: { userId: req.user!.id, action: "CUTTING_JOB", entity: "CuttingJob", entityId: created.id, details: `${number}: ${source.name} → ${outLines.length} piece(s)` } });
      return created;
    });

    const full = await prisma.cuttingJob.findUnique({ where: { id: job.id }, include: jobInclude });
    res.status(201).json({ ok: true, data: { job: full } });

    // Source stock dropped — best-effort low-stock bell.
    notifyLowStock([source.id]).catch(() => {});
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    if (err instanceof InsufficientStockError) return res.status(409).json({ ok: false, error: { code: err.code, message: err.message } });
    next(err);
  }
});

export default router;
