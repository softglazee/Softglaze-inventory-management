import { useMemo, useState } from "react";
import { Scale } from "lucide-react";
import type { WeightCalc } from "../lib/types";
import { computeWeight, validateWeightInput, qtyForUnit, STEEL_DENSITY, type WeightCalcType } from "../lib/weight";
import { fmtQty } from "../lib/format";

// C1 — the rod/sheet weight calculator body. Reused by the standalone Weight
// Calculator page and by the POS line calculator. Pure math on the client; when
// `onApply` is given it can hand a computed qty back to the caller (e.g. a sale line).

export type WeightProfile = {
  weightCalc?: WeightCalc | null;
  diameterMm?: string | number | null;
  thicknessMm?: string | number | null;
  sheetWidthFt?: string | number | null;
  pieceLengthFt?: string | number | null;
  densityKgM3?: string | number | null;
};

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const n = (v: string) => (v.trim() === "" ? null : Number(v));

export default function WeightCalcPanel({
  profile,
  applyUnit,
  onApply,
}: {
  profile?: WeightProfile;
  applyUnit?: string | null; // product's unit shortName — drives the "Apply" qty basis
  onApply?: (qty: number) => void;
}) {
  const initialType: WeightCalcType = profile?.weightCalc === "SHEET" ? "SHEET" : "ROD";
  const [calcType, setCalcType] = useState<WeightCalcType>(initialType);
  const [diameterMm, setDiameterMm] = useState(s(profile?.diameterMm));
  const [thicknessMm, setThicknessMm] = useState(s(profile?.thicknessMm));
  const [widthFt, setWidthFt] = useState(s(profile?.sheetWidthFt));
  const [pieces, setPieces] = useState("1");
  const [pieceLengthFt, setPieceLengthFt] = useState(s(profile?.pieceLengthFt));
  const [lengthFt, setLengthFt] = useState("");
  const [density, setDensity] = useState(s(profile?.densityKgM3));
  const [showDensity, setShowDensity] = useState(false);

  const input = {
    calcType,
    diameterMm: n(diameterMm),
    thicknessMm: n(thicknessMm),
    widthFt: n(widthFt),
    densityKgM3: n(density),
    pieces: n(pieces),
    pieceLengthFt: n(pieceLengthFt),
    lengthFt: n(lengthFt),
  };
  const error = useMemo(() => validateWeightInput(input), [calcType, diameterMm, thicknessMm, widthFt, density, pieces, pieceLengthFt, lengthFt]);
  const result = useMemo(() => (error ? null : computeWeight(input)), [error, calcType, diameterMm, thicknessMm, widthFt, density, pieces, pieceLengthFt, lengthFt]);
  const apply = result && applyUnit !== undefined ? qtyForUnit(result, applyUnit) : null;

  return (
    <div className="space-y-4">
      {/* Rod / Sheet toggle */}
      <div className="flex gap-2">
        {(["ROD", "SHEET"] as WeightCalcType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setCalcType(t)}
            className={`btn flex-1 ${calcType === t ? "btn-primary" : "btn-secondary"}`}
          >
            {t === "ROD" ? "Round bar / rod" : "Sheet / plate"}
          </button>
        ))}
      </div>

      {/* Dimensions */}
      <div className="grid grid-cols-2 gap-3">
        {calcType === "ROD" ? (
          <label className="label">Diameter (mm)
            <input className="input mono mt-0.5" type="number" step="any" min="0" value={diameterMm} onChange={(e) => setDiameterMm(e.target.value)} placeholder="12" autoFocus />
          </label>
        ) : (
          <>
            <label className="label">Thickness (mm)
              <input className="input mono mt-0.5" type="number" step="any" min="0" value={thicknessMm} onChange={(e) => setThicknessMm(e.target.value)} placeholder="3" autoFocus />
            </label>
            <label className="label">Width (ft)
              <input className="input mono mt-0.5" type="number" step="any" min="0" value={widthFt} onChange={(e) => setWidthFt(e.target.value)} placeholder="4" />
            </label>
          </>
        )}
      </div>

      {/* Length: pieces × each, or total */}
      <div className="grid grid-cols-2 gap-3">
        <label className="label">Pieces
          <input className="input mono mt-0.5" type="number" step="any" min="0" value={pieces} onChange={(e) => setPieces(e.target.value)} placeholder="10" />
        </label>
        <label className="label">Length each (ft)
          <input className="input mono mt-0.5" type="number" step="any" min="0" value={pieceLengthFt} onChange={(e) => setPieceLengthFt(e.target.value)} placeholder="40" />
        </label>
      </div>
      <label className="label block">Or total length (ft) <span className="text-muted font-normal">— overrides pieces × length</span>
        <input className="input mono mt-0.5" type="number" step="any" min="0" value={lengthFt} onChange={(e) => setLengthFt(e.target.value)} placeholder="leave blank to use pieces" />
      </label>

      {/* Density (advanced) */}
      <div className="text-xs">
        {showDensity ? (
          <label className="label">Density (kg/m³) <span className="text-muted font-normal">— steel {STEEL_DENSITY}</span>
            <input className="input mono mt-0.5" type="number" step="any" min="0" value={density} onChange={(e) => setDensity(e.target.value)} placeholder={String(STEEL_DENSITY)} />
          </label>
        ) : (
          <button type="button" className="text-accent" onClick={() => setShowDensity(true)}>Different metal? set density</button>
        )}
      </div>

      {/* Result */}
      <div className="card bg-surface-2 p-3">
        {error ? (
          <p className="text-muted text-sm flex items-center gap-2"><Scale size={15} /> {error}</p>
        ) : result ? (
          <div className="space-y-1.5 text-sm">
            <Row label="Total length" value={`${fmtQty(result.totalLengthFt)} ft  (${fmtQty(result.totalLengthM)} m)`} />
            <Row label="Weight / foot" value={`${fmtQty(result.weightPerFtKg)} kg`} />
            {result.weightPerPieceKg > 0 && <Row label="Weight / piece" value={`${fmtQty(result.weightPerPieceKg)} kg`} />}
            {calcType === "SHEET" && result.areaSqft > 0 && <Row label="Area" value={`${fmtQty(result.areaSqft)} sq-ft`} />}
            <div className="border-t border-edge my-1.5" />
            <div className="flex items-center justify-between">
              <span className="font-semibold">Total weight</span>
              <span className="money text-accent text-lg font-bold">{fmtQty(result.weightKg)} kg</span>
            </div>
            <Row label="In tons" value={`${fmtQty(result.weightTon)} t`} />
          </div>
        ) : null}
      </div>

      {/* Apply to sale line (POS mode) */}
      {onApply && (
        <div className="space-y-1">
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={!apply}
            onClick={() => apply && onApply(apply.qty)}
          >
            {apply ? `Set line qty to ${fmtQty(apply.qty)} ${apply.basis}` : "Enter dimensions"}
          </button>
          {apply?.assumedKg && (
            <p className="text-xs text-muted text-center">This product's unit isn't kg/ton/ft — applying the weight in kg.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}
