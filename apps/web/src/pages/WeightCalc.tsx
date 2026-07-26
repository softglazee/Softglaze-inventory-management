import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X, Scale, Package } from "lucide-react";
import { api } from "../lib/api";
import type { Product } from "../lib/types";
import { fmtMoney } from "../lib/format";
import { PageHeader } from "../components/ui";
import WeightCalcPanel, { type WeightProfile } from "../components/WeightCalcPanel";

// C1 — standalone rod/sheet weight calculator. Staff can compute weight from
// dimensions on the fly, or pick a product to pre-fill its stored profile.
export default function WeightCalc() {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Product | null>(null);

  const { data } = useQuery({
    queryKey: ["weightcalc-search", q],
    queryFn: () => api<{ products: Product[] }>(`/products/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
  });
  const results = data?.products ?? [];

  const profile: WeightProfile | undefined = picked
    ? {
        weightCalc: picked.weightCalc ?? "ROD",
        diameterMm: picked.diameterMm,
        thicknessMm: picked.thicknessMm,
        sheetWidthFt: picked.sheetWidthFt,
        pieceLengthFt: picked.pieceLengthFt,
        densityKgM3: picked.densityKgM3,
      }
    : undefined;

  return (
    <div>
      <PageHeader
        title="Weight calculator"
        sub="Work out steel weight from size — diameter or thickness × length. Sell sariya by the piece and know the kg/ton instantly. Pick a product to load its profile, or just type."
      />

      <div className="grid lg:grid-cols-[1fr_minmax(320px,420px)] gap-4 items-start">
        {/* Left: product picker */}
        <div className="card p-4 space-y-3">
          <p className="text-sm text-muted">Load a product's saved profile (optional)</p>
          {picked ? (
            <div className="flex items-center justify-between gap-2 card bg-surface-2 p-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{picked.name}</div>
                <div className="text-xs text-muted mono">
                  {picked.sku} · {picked.weightCalc === "SHEET" ? "sheet" : "rod"}
                  {picked.diameterMm ? ` · ⌀${picked.diameterMm}mm` : ""}
                  {picked.thicknessMm ? ` · ${picked.thicknessMm}mm thick` : ""}
                  {picked.pieceLengthFt ? ` · ${picked.pieceLengthFt}ft/pc` : ""}
                  {" · "}{fmtMoney(picked.salePrice)}/{picked.unit?.shortName}
                </div>
              </div>
              <button className="btn btn-secondary !p-2 shrink-0" onClick={() => setPicked(null)} title="Clear"><X size={15} /></button>
            </div>
          ) : (
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input className="input !pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product by name / SKU / barcode" />
              {q.trim() && (
                <div className="mt-2 space-y-1 max-h-72 overflow-y-auto">
                  {results.length === 0 ? (
                    <p className="text-muted text-sm px-1 py-2">No products match.</p>
                  ) : (
                    results.map((p) => (
                      <button key={p.id} className="w-full text-left card p-2.5 hover:border-accent flex items-center gap-2" onClick={() => { setPicked(p); setQ(""); }}>
                        <Package size={15} className="text-muted shrink-0" />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium truncate">{p.name}</span>
                          <span className="block text-xs text-muted mono">
                            {p.sku}
                            {p.weightCalc && p.weightCalc !== "NONE" ? ` · ${p.weightCalc.toLowerCase()} profile ✓` : " · no profile (enter manually)"}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
          <p className="text-xs text-muted flex items-start gap-1.5"><Scale size={13} className="mt-0.5 shrink-0" /> Set a product's diameter/thickness under Products → edit → “Weight profile”, then it auto-fills here and in the POS.</p>
        </div>

        {/* Right: the calculator */}
        <div className="card p-4">
          <WeightCalcPanel key={picked?.id ?? "manual"} profile={profile} />
        </div>
      </div>
    </div>
  );
}
