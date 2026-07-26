import { useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Plus, Search, X, Boxes, SlidersHorizontal } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { StockMovement, StockAdjustment, Product, Paged } from "../lib/types";
import { num, fmtQty } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, Badge, Pagination, useToast } from "../components/ui";

const MOVE_LABEL: Record<string, string> = {
  PURCHASE: "Purchase", PURCHASE_RETURN: "Purchase return", SALE: "Sale", SALE_RETURN: "Sale return",
  ADJUSTMENT_IN: "Adjust +", ADJUSTMENT_OUT: "Adjust −", DAMAGE: "Damage", OPENING: "Opening",
};

export default function Stock() {
  const { can } = useAuth();
  const [tab, setTab] = useState<"ledger" | "adjustments">("ledger");

  return (
    <div>
      <PageHeader title="Stock" sub="The stock ledger — every movement in and out — plus manual adjustments." />
      <div className="flex gap-1 mb-4 border-b border-edge">
        <TabBtn active={tab === "ledger"} onClick={() => setTab("ledger")} icon={<Boxes size={15} />} label="Ledger" />
        {can("stock.adjust") && <TabBtn active={tab === "adjustments"} onClick={() => setTab("adjustments")} icon={<SlidersHorizontal size={15} />} label="Adjustments" />}
      </div>
      {tab === "ledger" ? <Ledger /> : <Adjustments />}
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-3 py-2 text-sm border-b-2 -mb-px ${active ? "border-accent text-ink font-semibold" : "border-transparent text-muted hover:text-ink"}`}>
      {icon} {label}
    </button>
  );
}

/* ─────────────── Ledger ─────────────── */
function Ledger() {
  const [productId, setProductId] = useState("");
  const [productLabel, setProductLabel] = useState("");
  const [prodSearch, setProdSearch] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);

  const { data: prodResults } = useQuery({
    queryKey: ["ledger-prod-search", prodSearch],
    queryFn: () => api<{ products: Product[] }>(`/products/search?q=${encodeURIComponent(prodSearch)}`),
    enabled: prodSearch.trim().length > 0,
  });

  const params = new URLSearchParams({ page: String(page), limit: "50", ...(productId && { productId }), ...(type && { type }) });
  const { data, isLoading } = useQuery({
    queryKey: ["movements", page, productId, type],
    queryFn: () => api<Paged<"movements", StockMovement>>(`/stock/movements?${params}`),
    placeholderData: keepPreviousData,
  });
  const movements = data?.movements ?? [];

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input !pl-9 w-64" value={productId ? productLabel : prodSearch} onChange={(e) => { setProductId(""); setProductLabel(""); setProdSearch(e.target.value); setPage(1); }} placeholder="Filter by product…" />
          {!productId && prodSearch.trim() && (prodResults?.products.length ?? 0) > 0 && (
            <div className="absolute z-10 mt-1 w-64 card max-h-52 overflow-y-auto">
              {prodResults!.products.map((r) => (
                <button type="button" key={r.id} className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2" onClick={() => { setProductId(r.id); setProductLabel(`${r.name} (${r.sku})`); setProdSearch(""); setPage(1); }}>
                  {r.name} <span className="mono text-muted text-xs">{r.sku}</span>
                </button>
              ))}
            </div>
          )}
          {productId && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-danger" onClick={() => { setProductId(""); setProductLabel(""); setPage(1); }} aria-label="Clear product filter"><X size={14} /></button>
          )}
        </div>
        <select className="input !w-40" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Filter by type">
          <option value="">All types</option>
          {Object.keys(MOVE_LABEL).map((k) => <option key={k} value={k}>{MOVE_LABEL[k]}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={6} />
        ) : movements.length === 0 ? (
          <EmptyState title="No stock movements" hint="Movements appear here as you receive stock, sell, or adjust." />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-edge">
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Product</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium text-right">Change</th>
                  <th className="px-4 py-2.5 font-medium text-right">Balance</th>
                  <th className="px-4 py-2.5 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => {
                  const q = num(m.qty);
                  return (
                    <tr key={m.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                      <td className="px-4 py-2 text-muted whitespace-nowrap">{new Date(m.date).toLocaleDateString()}</td>
                      <td className="px-4 py-2">{m.product?.name} <span className="mono text-muted text-xs">{m.product?.sku}</span></td>
                      <td className="px-4 py-2"><Badge tone={q >= 0 ? "success" : "warn"}>{MOVE_LABEL[m.type] ?? m.type}</Badge></td>
                      <td className={`px-4 py-2 text-right mono ${q >= 0 ? "text-success" : "text-danger"}`}>{q >= 0 ? "+" : ""}{fmtQty(m.qty)} {m.product?.unit?.shortName}</td>
                      <td className="px-4 py-2 text-right mono">{fmtQty(m.balance)}</td>
                      <td className="px-4 py-2 text-muted text-xs">{m.notes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Adjustments ─────────────── */
type AdjLine = { productId: string; name: string; sku: string; unitShort: string; qtyChange: string };

// A2 — categorised reasons (must match the server enum). Loss reasons are written off at cost.
const ADJ_REASONS: { code: string; label: string }[] = [
  { code: "COUNT_CORRECTION", label: "Count correction" },
  { code: "BREAKAGE", label: "Breakage / damaged" },
  { code: "THEFT", label: "Theft / shrinkage" },
  { code: "SAMPLE", label: "Sample / giveaway" },
  { code: "WASTAGE", label: "Wastage" },
  { code: "EXPIRY", label: "Expired" },
  { code: "FOUND", label: "Found extra" },
  { code: "OTHER", label: "Other" },
];

function Adjustments() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["adjustments", page],
    queryFn: () => api<Paged<"adjustments", StockAdjustment>>(`/stock/adjustments?page=${page}&limit=20`),
    placeholderData: keepPreviousData,
  });
  const adjustments = data?.adjustments ?? [];

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button className="btn btn-secondary !border-accent !text-accent" onClick={() => setCreating(true)}><Plus size={16} /> New adjustment</button>
      </div>
      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={4} />
        ) : adjustments.length === 0 ? (
          <EmptyState title="No adjustments yet" hint="Use adjustments to fix counts, or write off damaged / expired stock." action={<button className="btn btn-secondary" onClick={() => setCreating(true)}><Plus size={16} /> New adjustment</button>} />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-edge">
                  <th className="px-4 py-2.5 font-medium">Ref</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Reason</th>
                  <th className="px-4 py-2.5 font-medium">Items</th>
                  <th className="px-4 py-2.5 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((a) => (
                  <tr key={a.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50 align-top">
                    <td className="px-4 py-2 mono">{a.refNo}</td>
                    <td className="px-4 py-2 text-muted whitespace-nowrap">{new Date(a.date).toLocaleDateString()}</td>
                    <td className="px-4 py-2">{a.reason}</td>
                    <td className="px-4 py-2 text-xs">
                      {a.items.map((it) => {
                        const c = num(it.qtyChange);
                        return <div key={it.id}>{it.product?.name} <span className={`mono ${c >= 0 ? "text-success" : "text-danger"}`}>{c >= 0 ? "+" : ""}{fmtQty(it.qtyChange)} {it.product?.unit?.shortName}</span></div>;
                      })}
                    </td>
                    <td className="px-4 py-2 text-muted">{a.user?.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} />
          </>
        )}
      </div>
      {creating && <NewAdjustment onClose={() => setCreating(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ["adjustments"] }); qc.invalidateQueries({ queryKey: ["movements"] }); qc.invalidateQueries({ queryKey: ["products"] }); setCreating(false); }} />}
    </div>
  );
}

function NewAdjustment({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [reasonCode, setReasonCode] = useState("COUNT_CORRECTION");
  const [detail, setDetail] = useState("");
  const [lines, setLines] = useState<AdjLine[]>([]);
  const [prodSearch, setProdSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: prodResults } = useQuery({
    queryKey: ["adj-prod-search", prodSearch],
    queryFn: () => api<{ products: Product[] }>(`/products/search?q=${encodeURIComponent(prodSearch)}`),
    enabled: prodSearch.trim().length > 0,
  });

  function addLine(p: Product) {
    if (p.type !== "STANDARD") { toast(`${p.name} does not track stock`, "error"); return; }
    if (lines.some((l) => l.productId === p.id)) { setProdSearch(""); return; }
    setLines([...lines, { productId: p.id, name: p.name, sku: p.sku, unitShort: p.unit?.shortName ?? "", qtyChange: "-1" }]);
    setProdSearch("");
  }

  const save = useMutation({
    mutationFn: () => api<{ adjustment: StockAdjustment }>("/stock/adjustments", {
      method: "POST",
      body: { reasonCode, reason: detail.trim() || null, items: lines.map((l) => ({ productId: l.productId, qtyChange: Number(l.qtyChange) || 0 })) },
    }),
    onSuccess: (d) => { toast(`Adjustment ${d.adjustment.refNo} saved`); onSaved(); },
    onError: (e: ApiError) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (lines.length === 0) return setError("Add at least one product.");
    if (lines.some((l) => (Number(l.qtyChange) || 0) === 0)) return setError("Each line needs a non-zero change.");
    save.mutate();
  }

  return (
    <Modal open onClose={onClose} title="New stock adjustment" wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Reason</label>
            <select className="input" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} autoFocus>
              {ADJ_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Detail <span className="text-muted">(optional)</span></label>
            <input className="input" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="e.g. rain-damaged in yard" />
          </div>
        </div>
        <div>
          <label className="label">Products</label>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input !pl-9" value={prodSearch} onChange={(e) => setProdSearch(e.target.value)} placeholder="Search a product to adjust…" />
            {prodSearch.trim() && (prodResults?.products.length ?? 0) > 0 && (
              <div className="absolute z-10 mt-1 w-full card max-h-52 overflow-y-auto">
                {prodResults!.products.map((r) => (
                  <button type="button" key={r.id} className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 flex justify-between" onClick={() => addLine(r)}>
                    <span>{r.name}</span><span className="mono text-muted">{fmtQty(r.stockQty)} {r.unit?.shortName}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {lines.length === 0 ? (
            <p className="text-xs text-muted">No products yet — search above. Use a minus for stock going out.</p>
          ) : (
            <div className="space-y-1.5">
              {lines.map((l, i) => (
                <div key={l.productId} className="flex items-center gap-2">
                  <span className="flex-1 text-sm">{l.name} <span className="mono text-muted text-xs">{l.sku}</span></span>
                  <input className="input mono !w-28 !py-1 text-right" type="number" step="any" value={l.qtyChange} onChange={(e) => setLines(lines.map((x, idx) => idx === i ? { ...x, qtyChange: e.target.value } : x))} aria-label={`Change for ${l.name}`} />
                  <button type="button" className="text-muted hover:text-danger" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}><X size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-secondary !border-accent !text-accent" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save adjustment"}</button>
        </div>
      </form>
    </Modal>
  );
}
