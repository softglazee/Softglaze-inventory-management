// C1 — client mirror of the server rod/sheet weight math (apps/server/src/lib/weight.ts).
// Kept in lock-step so the POS/quotation calculator updates instantly while typing; the
// server recomputes the same way on submit. Writes nothing — pure math.
import type { WeightCalcResult } from "./types";

export const STEEL_DENSITY = 7850; // kg/m³
export const FT_TO_M = 0.3048;

export type WeightCalcType = "ROD" | "SHEET";

export interface WeightCalcInput {
  calcType: WeightCalcType;
  diameterMm?: number | null;
  thicknessMm?: number | null;
  widthFt?: number | null;
  densityKgM3?: number | null;
  pieces?: number | null;
  pieceLengthFt?: number | null;
  lengthFt?: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

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

export function computeWeight(i: WeightCalcInput): WeightCalcResult {
  const density = i.densityKgM3 && i.densityKgM3 > 0 ? i.densityKgM3 : STEEL_DENSITY;
  const pieces = i.pieces && i.pieces > 0 ? i.pieces : 1;
  const pieceLengthFt = i.pieceLengthFt && i.pieceLengthFt > 0 ? i.pieceLengthFt : 0;
  const totalLengthFt = i.lengthFt != null && i.lengthFt > 0 ? i.lengthFt : pieces * pieceLengthFt;

  let weightPerM: number;
  let areaSqft = 0;
  if (i.calcType === "ROD") {
    const dM = (i.diameterMm ?? 0) / 1000;
    weightPerM = (Math.PI / 4) * dM * dM * density;
  } else {
    const widthM = (i.widthFt ?? 0) * FT_TO_M;
    const thickM = (i.thicknessMm ?? 0) / 1000;
    weightPerM = widthM * thickM * density;
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

/** Map a computed result onto a sale-line qty for a product measured in `unitShort`. */
export function qtyForUnit(result: WeightCalcResult, unitShort: string | null | undefined): { qty: number; basis: string; assumedKg: boolean } {
  const u = (unitShort ?? "").trim().toLowerCase();
  if (u === "kg" || u === "kgs" || u === "kilogram") return { qty: r3(result.weightKg), basis: "kg", assumedKg: false };
  if (u === "t" || u === "ton" || u === "tonne" || u === "tons") return { qty: r4(result.weightTon), basis: "ton", assumedKg: false };
  if (u === "ft" || u === "foot" || u === "feet" || u === "rft" || u === "rft.") return { qty: r3(result.totalLengthFt), basis: "ft", assumedKg: false };
  if (u === "pc" || u === "pcs" || u === "piece" || u === "pieces" || u === "nos" || u === "no") return { qty: result.pieces, basis: "pcs", assumedKg: false };
  if (u === "sqft" || u === "sq-ft" || u === "sft") return { qty: r3(result.areaSqft), basis: "sqft", assumedKg: false };
  return { qty: r3(result.weightKg), basis: "kg", assumedKg: true };
}

export { r2 };
