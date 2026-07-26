import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X, Printer, Plus } from "lucide-react";
import { api } from "../lib/api";
import { Product } from "../lib/types";
import { num, fmtMoney } from "../lib/format";
import { PageHeader, EmptyState } from "../components/ui";
import { code128Bars } from "../lib/barcode";

type LabelProduct = { id: string; name: string; sku: string; barcode: string | null; salePrice: string; copies: number };

function Barcode({ value }: { value: string }) {
  const { bars, width } = code128Bars(value);
  if (!width) return null;
  return (
    <svg viewBox={`0 0 ${width} 28`} width="100%" height="28" preserveAspectRatio="none" style={{ display: "block" }}>
      {bars.map((b, i) => <rect key={i} x={b.x} y={0} width={b.w} height={28} fill="#000" />)}
    </svg>
  );
}

export default function Labels() {
  const [items, setItems] = useState<LabelProduct[]>([]);
  const [cols, setCols] = useState(3);
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showSku, setShowSku] = useState(true);
  const [showBarcode, setShowBarcode] = useState(true);
  const [q, setQ] = useState("");

  const { data } = useQuery({ queryKey: ["label-prod", q], queryFn: () => api<{ products: Product[] }>(`/products/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length > 0 });
  const results = (data?.products ?? []).filter((p) => p.type === "STANDARD");

  const add = (p: Product) => { setItems((it) => it.some((x) => x.id === p.id) ? it : [...it, { id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, salePrice: p.salePrice, copies: 1 }]); setQ(""); };
  const setCopies = (id: string, n: number) => setItems((it) => it.map((x) => (x.id === id ? { ...x, copies: Math.max(1, n) } : x)));
  const remove = (id: string) => setItems((it) => it.filter((x) => x.id !== id));

  const labels = items.flatMap((p) => Array.from({ length: p.copies }, () => p));

  return (
    <div>
      <style>{`@media print { body * { visibility: hidden; } #label-sheet, #label-sheet * { visibility: visible; } #label-sheet { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } }`}</style>

      <div className="no-print">
        <PageHeader
          title="Shelf & Price Labels"
          sub="Print price + barcode labels for your shelves. Pick products, set how many of each, choose the layout, and print onto label sheets."
          actions={labels.length > 0 ? <button className="btn btn-primary" onClick={() => window.print()}><Printer size={16} /> Print {labels.length} labels</button> : undefined}
        />

        <div className="card p-4 mb-4 space-y-3">
          <div className="relative max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input !pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a product to add…" />
            {q.trim() && results.length > 0 && (
              <div className="absolute z-30 mt-1 w-full card max-h-52 overflow-y-auto p-1 shadow-xl">
                {results.map((p) => <button key={p.id} type="button" className="w-full text-left px-3 py-1.5 rounded hover:bg-surface-2 text-sm" onClick={() => add(p)}><Plus size={12} className="inline mr-1" />{p.name} <span className="mono text-muted text-xs">{p.sku}</span></button>)}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {items.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-lg border border-edge px-2 py-1 text-sm">
                  <span className="truncate max-w-[160px]">{p.name}</span>
                  <input className="input !py-0.5 !w-14 mono text-center" type="number" min={1} value={p.copies} onChange={(e) => setCopies(p.id, Number(e.target.value) || 1)} />
                  <button className="text-muted hover:text-danger" onClick={() => remove(p.id)}><X size={14} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4 text-sm pt-1 border-t border-edge">
            <label className="flex items-center gap-1.5">Columns <select className="input !py-1 !w-16" value={cols} onChange={(e) => setCols(Number(e.target.value))}>{[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} /> Name</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} /> Price</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={showSku} onChange={(e) => setShowSku(e.target.checked)} /> SKU</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={showBarcode} onChange={(e) => setShowBarcode(e.target.checked)} /> Barcode</label>
          </div>
        </div>
      </div>

      {labels.length === 0 ? (
        <div className="no-print"><EmptyState title="No labels yet" hint="Add one or more products above to build a label sheet." /></div>
      ) : (
        <div id="label-sheet" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {labels.map((p, i) => (
            <div key={i} className="border border-edge rounded p-2 text-center bg-white text-black break-inside-avoid" style={{ minHeight: 92 }}>
              {showName && <div className="text-xs font-semibold leading-tight line-clamp-2">{p.name}</div>}
              {showPrice && <div className="font-bold text-base leading-tight my-0.5">{fmtMoney(num(p.salePrice))}</div>}
              {showBarcode && (p.barcode || p.sku) && <Barcode value={p.barcode || p.sku} />}
              {showSku && <div className="mono text-[10px] leading-tight">{p.barcode || p.sku}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
