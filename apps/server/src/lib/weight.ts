// C1 — Rod/sheet weight & length calculator (pure math, no DB).
//
// Building-materials shops sell steel by piece/length but price by weight (kg/ton).
// A 12mm × 40ft sariya rod weighs ~10.8 kg; staff currently work this out by hand.
// This turns a physical entry (diameter/thickness + length or pieces) into a weight
// so the POS/quotation can fill the sale-line qty. It writes nothing — the sale still
// stores qty × unitPrice in the product's own unit, so it has zero accounting effect.
//
// Round bar:  weight = π/4 · (d_m)² · length_m · density   (d in mm)
//   For steel (7850 kg/m³) this is the familiar kg/m ≈ d²/162.28.
// Flat sheet: weight = length_m · width_m · thickness_m · density

export const STEEL_DENSITY = 7850; // kg/m³ — mild steel; overridable for other metals
export const FT_TO_M = 0.3048;

export type WeightCalcType = "ROD" | "SHEET";

export interface WeightCalcInput {
  calcType: WeightCalcType;
  diameterMm?: number | null; // ROD nominal diameter
  thicknessMm?: number | null; // SHEET thickness
  widthFt?: number | null; // SHEET width (feet)
  densityKgM3?: number | null; // default steel 7850
  pieces?: number | null; // how many rods/sheets (default 1)
  pieceLengthFt?: number | null; // length of one piece (feet)
  lengthFt?: number | null; // OR total length directly (overrides pieces × pieceLengthFt)
}

export interface WeightCalcResult {
  calcType: WeightCalcType;
  density: number;
  pieces: number;
  totalLengthFt: number;
  totalLengthM: number;
  weightPerFtKg: number; // weight of 1 running foot
  weightPerPieceKg: number; // weight of one standard piece (0 if no piece length)
  weightKg: number;
  weightTon: number;
  areaSqft: number; // SHEET plate area (0 for ROD)
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Validate the physical inputs. Returns an error message, or null when usable. */
export function validateWeightInput(i: WeightCalcInput): string | null {
  if (i.calcType === "ROD") {
    if (!i.diameterMm || i.diameterMm <= 0) return "Enter the rod diameter in mm (e.g. 12).";
  } else if (i.calcType === "SHEET") {
    if (!i.thicknessMm || i.thicknessMm <= 0) return "Enter the sheet thickness in mm (e.g. 3).";
    if (!i.widthFt || i.widthFt <= 0) return "Enter the sheet width in feet (e.g. 4).";
  } else {
    return "Unknown calculator type.";
  }
  const hasTotal = i.lengthFt != null && i.lengthFt > 0;
  const hasPieces = (i.pieces ?? 0) > 0 && (i.pieceLengthFt ?? 0) > 0;
  if (!hasTotal && !hasPieces) return "Enter a total length, or a number of pieces and the length of each.";
  return null;
}

/**
 * Compute the weight/length breakdown. Assumes inputs already validated
 * (validateWeightInput). `weightPerFtKg` is the reusable unit weight.
 */
export function computeWeight(i: WeightCalcInput): WeightCalcResult {
  const density = i.densityKgM3 && i.densityKgM3 > 0 ? i.densityKgM3 : STEEL_DENSITY;
  const pieces = i.pieces && i.pieces > 0 ? i.pieces : 1;
  const pieceLengthFt = i.pieceLengthFt && i.pieceLengthFt > 0 ? i.pieceLengthFt : 0;
  // A directly-entered total length wins; otherwise pieces × piece length.
  const totalLengthFt = i.lengthFt != null && i.lengthFt > 0 ? i.lengthFt : pieces * pieceLengthFt;

  // Weight of one running metre, then one running foot.
  let weightPerM: number;
  let areaSqft = 0;
  if (i.calcType === "ROD") {
    const dM = (i.diameterMm ?? 0) / 1000;
    const areaM2 = (Math.PI / 4) * dM * dM;
    weightPerM = areaM2 * density;
  } else {
    const widthM = (i.widthFt ?? 0) * FT_TO_M;
    const thickM = (i.thicknessMm ?? 0) / 1000;
    weightPerM = widthM * thickM * density; // per metre of length
    areaSqft = totalLengthFt * (i.widthFt ?? 0);
  }
  const weightPerFtKg = weightPerM * FT_TO_M;
  const weightKg = weightPerFtKg * totalLengthFt;
  const weightPerPieceKg = pieceLengthFt > 0 ? weightPerFtKg * pieceLengthFt : 0;

  return {
    calcType: i.calcType,
    density,
    pieces,
    totalLengthFt: r3(totalLengthFt),
    totalLengthM: r3(totalLengthFt * FT_TO_M),
    weightPerFtKg: r4(weightPerFtKg),
    weightPerPieceKg: r3(weightPerPieceKg),
    weightKg: r3(weightKg),
    weightTon: r4(weightKg / 1000),
    areaSqft: r3(areaSqft),
  };
}

/**
 * Map a computed result onto a sale-line quantity for a product whose stock is
 * measured in `unitShort`. Weight-priced units get kg/ton; length units get feet;
 * piece units get the piece count; sheets sold by area get sqft. Anything else
 * falls back to kg (with `assumedKg` true so the UI can flag it).
 */
export function qtyForUnit(result: WeightCalcResult, unitShort: string | null | undefined): { qty: number; basis: string; assumedKg: boolean } {
  const u = (unitShort ?? "").trim().toLowerCase();
  if (u === "kg" || u === "kgs" || u === "kilogram") return { qty: r3(result.weightKg), basis: "kg", assumedKg: false };
  if (u === "t" || u === "ton" || u === "tonne" || u === "tons") return { qty: r4(result.weightTon), basis: "ton", assumedKg: false };
  if (u === "ft" || u === "foot" || u === "feet" || u === "rft" || u === "rft.") return { qty: r3(result.totalLengthFt), basis: "ft", assumedKg: false };
  if (u === "pc" || u === "pcs" || u === "piece" || u === "pieces" || u === "nos" || u === "no") return { qty: result.pieces, basis: "pcs", assumedKg: false };
  if (u === "sqft" || u === "sq-ft" || u === "sft") return { qty: r3(result.areaSqft), basis: "sqft", assumedKg: false };
  return { qty: r3(result.weightKg), basis: "kg", assumedKg: true };
}
