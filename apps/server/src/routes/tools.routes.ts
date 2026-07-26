import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { computeWeight, validateWeightInput, qtyForUnit } from "../lib/weight";

// C1 — stateless helper endpoints for shop-floor calculators. These read/compute
// only; they write nothing to the database, so they carry no accounting effect.
const router = Router();
router.use(requireAuth);

const numOpt = z.coerce.number().min(0).nullable().optional();

const weightSchema = z.object({
  calcType: z.enum(["ROD", "SHEET"]),
  diameterMm: numOpt,
  thicknessMm: numOpt,
  widthFt: numOpt,
  densityKgM3: numOpt,
  pieces: numOpt,
  pieceLengthFt: numOpt,
  lengthFt: numOpt,
  unitShort: z.string().trim().max(20).nullable().optional(), // to suggest the sale-line qty
});

/**
 * POST /tools/weight-calc — turn rod/sheet dimensions into weight/length totals.
 * Returns the full breakdown plus a `suggestedQty` mapped onto the product's unit.
 */
router.post("/weight-calc", (req, res) => {
  const parsed = weightSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.errors[0].message } });
  }
  const body = parsed.data;
  const err = validateWeightInput(body);
  if (err) {
    return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err } });
  }
  const result = computeWeight(body);
  const suggested = qtyForUnit(result, body.unitShort);
  res.json({ ok: true, data: { result, suggestedQty: suggested.qty, suggestedBasis: suggested.basis, assumedKg: suggested.assumedKg } });
});

export default router;
