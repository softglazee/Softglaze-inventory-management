import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Scissors, Search, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { CuttingJob, CutOutputKind, Product } from "../lib/types";
import { num, fmtMoney } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, Badge, Pagination, useClientPagination, useToast } from "../components/ui";

const d = (s: string) => new Date(s).toLocaleDateString("en-GB");
const r2 = (v: number) => Math.round(v * 100) / 100;

type PickProduct = { id: string; name: string; sku: string; costPrice: string; stockQty: string; unit?: { shortName: string } };

export default function Cutting() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canCut = can("stock.adjust");
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ["cutting-jobs"], queryFn: () => api<{ jobs: CuttingJob[] }>("/cutting-jobs") });
  const jobs = data?.jobs ?? [];
  const { page, pages, setPage, pageRows, total, perPage } = useClientPagination(jobs, 12);

  return (
    <div>
      <PageHeader
        title="Cutting & Offcuts"
        sub="Cut a full bar, pipe or sheet into the piece a customer needs plus the leftover offcut. The bar leaves stock and each piece / offcut comes back in at its share of the cost — nothing is lost, and offcuts stay on the shelf to sell later."
        actions={canCut ? <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New cut</button> : undefined}
      />

      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={6} />
        ) : jobs.length === 0 ? (
          <EmptyState title="No cuts recorded yet" hint={canCut ? "Cut a bar into a piece + offcut. Pick the full bar, enter how much you cut, and list the pieces / offcuts that go back into stock." : "Ask an admin to record cutting jobs."} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs">
                    <th className="px-4 py-2.5 font-semibold">Ref</th>
                    <th className="px-4 py-2.5 font-semibold">Date</th>
                    <th className="px-4 py-2.5 font-semibold">Cut from</th>
                    <th className="px-4 py-2.5 font-semibold">Pieces &amp; offcuts back in</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Wastage</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((j) => {
                    const su = j.sourceProduct?.unit?.shortName ?? "";
                    return (
                      <tr key={j.id} className="border-b border-edge last:border-0 align-top hover:bg-surface-2/50">
                        <td className="px-4 py-2 mono text-xs whitespace-nowrap">{j.number}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{d(j.date)}</td>
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center gap-1.5"><Scissors size={13} className="text-muted" /> {j.sourceProduct?.name ?? "—"}</span>
                          <span className="block text-xs text-muted ml-5 mono">−{num(j.sourceQty)} {su}</span>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {j.outputs.map((o) => (
                              <Badge key={o.id} tone={o.kind === "OFFCUT" ? "warn" : "muted"}>
                                {o.kind === "OFFCUT" ? "offcut" : "piece"} · {num(o.qty)} {o.product?.unit?.shortName ?? ""}{o.lengthFt ? ` · ${num(o.lengthFt)}ft` : ""} — {o.product?.name}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right mono">{num(j.wastageQty) > 0 ? `${num(j.wastageQty)} ${su}` : "—"}</td>
                        <td className="px-4 py-2 text-right money">{fmtMoney(j.totalCost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pages={pages} onPage={setPage} total={total} perPage={perPage} />
          </>
        )}
      </div>

      {creating && <CutEditor onClose={() => setCreating(false)} onDone={() => {
        toast("Cut recorded — offcuts are back in stock");
        qc.invalidateQueries({ queryKey: ["cutting-jobs"] });
        qc.invalidateQueries({ queryKey: ["products"] });
        setCreating(false);
      }} />}
    </div>
  );
}

function ProductPicker({ value, placeholder, onPick }: { value: PickProduct | null; placeholder: string; onPick: (p: PickProduct | null) => void }) {
  const [q, setQ] = useState("");
  const { data } = useQuery({
    queryKey: ["prod-pick-cut", q],
    queryFn: () => api<{ products: Product[] }>(`/products/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
  });
  const results = (data?.products ?? []).filter((p) => p.type === "STANDARD");
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 input">
        <span className="truncate">{value.name} <span className="mono text-muted text-xs">· {num(value.stockQty)} {value.unit?.shortName ?? ""} in stock</span></span>
        <button type="button" className="text-muted hover:text-danger" onClick={() => onPick(null)}><X size={14} /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input className="input !pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {q.trim() && results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full card max-h-52 overflow-y-auto p-1 shadow-xl">
          {results.map((p) => (
            <button key={p.id} type="button" className="w-full text-left px-3 py-1.5 rounded hover:bg-surface-2 text-sm"
              onClick={() => { onPick({ id: p.id, name: p.name, sku: p.sku, costPrice: p.costPrice, stockQty: p.stockQty, unit: p.unit }); setQ(""); }}>
              {p.name} <span className="mono text-muted text-xs">{p.sku} · {num(p.stockQty)} {p.unit?.shortName ?? ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type OutLine = { key: string; product: PickProduct | null; kind: CutOutputKind; qty: string; lengthFt: string };
let lineSeq = 0;
const newLine = (kind: CutOutputKind): OutLine => ({ key: `l${++lineSeq}`, product: null, kind, qty: "", lengthFt: "" });

function CutEditor({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [source, setSource] = useState<PickProduct | null>(null);
  const [sourceQty, setSourceQty] = useState("");
  const [wastageQty, setWastageQty] = useState("0");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<OutLine[]>([newLine("PIECE"), newLine("OFFCUT")]);
  const [error, setError] = useState<string | null>(null);

  const unitCost = source ? num(source.costPrice) : 0;
  const su = source?.unit?.shortName ?? "";
  const sq = Number(sourceQty) || 0;
  const wq = Number(wastageQty) || 0;
  const convertedQty = r2(Math.max(0, sq - wq));
  const valueToOutputs = r2(convertedQty * unitCost);
  const totalCost = r2(sq * unitCost);

  // Live cost split — mirrors the server exactly (by qty × length, last line takes the remainder).
  const weights = lines.map((l) => (Number(l.qty) || 0) * ((Number(l.lengthFt) || 0) > 0 ? Number(l.lengthFt) : 1));
  const weightSum = weights.reduce((a, w) => a + w, 0) || 1;
  let allocated = 0;
  const preview = lines.map((l, i) => {
    const isLast = i === lines.length - 1;
    const value = isLast ? r2(valueToOutputs - allocated) : r2((valueToOutputs * weights[i]) / weightSum);
    allocated = r2(allocated + value);
    const q = Number(l.qty) || 0;
    return { value, unitCost: q > 0 ? r2(value / q) : 0 };
  });

  const set = (key: string, patch: Partial<OutLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = useMutation({
    mutationFn: () => api<{ job: CuttingJob }>("/cutting-jobs", {
      method: "POST",
      body: {
        date,
        sourceProductId: source!.id,
        sourceQty: sq,
        wastageQty: wq,
        notes: notes || null,
        outputs: lines.map((l) => ({ productId: l.product!.id, kind: l.kind, qty: Number(l.qty) || 0, lengthFt: Number(l.lengthFt) > 0 ? Number(l.lengthFt) : null })),
      },
    }),
    onSuccess: () => onDone(),
    onError: (e: ApiError) => setError(e.message),
  });

  function submit() {
    setError(null);
    if (!source) return setError("Pick the bar you are cutting from");
    if (sq <= 0) return setError("Enter how much you cut from the bar");
    if (wq < 0) return setError("Wastage cannot be negative");
    if (wq >= sq) return setError("Wastage cannot be the whole cut — use a stock adjustment for a full write-off");
    if (sq > num(source.stockQty)) return setError(`Only ${num(source.stockQty)} ${su} of ${source.name} in stock`);
    if (lines.length === 0 || lines.some((l) => !l.product || (Number(l.qty) || 0) <= 0)) return setError("Every piece/offcut needs a product and a quantity");
    save.mutate();
  }

  return (
    <Modal open onClose={onClose} title="New cutting job" wide>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className="label">Date</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="sm:col-span-3"><label className="label">Cut from (full bar / pipe / sheet)</label><ProductPicker value={source} placeholder="Search the bar to cut…" onPick={setSource} /></div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className="label">Qty cut{su ? ` (${su})` : ""}</label><input className="input mono" type="number" step="0.001" min="0" value={sourceQty} onChange={(e) => setSourceQty(e.target.value)} placeholder="1" /></div>
          <div><label className="label">Wastage / kerf</label><input className="input mono" type="number" step="0.001" min="0" value={wastageQty} onChange={(e) => setWastageQty(e.target.value)} /></div>
          <div className="sm:col-span-2 text-xs text-muted self-end pb-2">
            {source ? <>Bar cost <span className="money">{fmtMoney(unitCost)}</span>/{su || "unit"} · consuming <span className="money">{fmtMoney(totalCost)}</span>{wq > 0 && <> · wastage <span className="money">{fmtMoney(r2(wq * unitCost))}</span> booked as a loss</>}</> : "Pick a bar to see the cost split."}
          </div>
        </div>

        <div className="rounded-lg border border-edge">
          <div className="flex items-center justify-between px-3 py-2 border-b border-edge">
            <span className="text-sm font-medium">Pieces &amp; offcuts back into stock</span>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary !py-1 !px-2 text-xs" onClick={() => setLines((ls) => [...ls, newLine("PIECE")])}><Plus size={13} /> Piece</button>
              <button type="button" className="btn btn-secondary !py-1 !px-2 text-xs" onClick={() => setLines((ls) => [...ls, newLine("OFFCUT")])}><Plus size={13} /> Offcut</button>
            </div>
          </div>
          <div className="p-2 space-y-2">
            {lines.map((l, i) => (
              <div key={l.key} className="grid grid-cols-12 gap-2 items-start">
                <div className="col-span-2">
                  <select className="input !py-1.5 text-sm" value={l.kind} onChange={(e) => set(l.key, { kind: e.target.value as CutOutputKind })}>
                    <option value="PIECE">Piece</option>
                    <option value="OFFCUT">Offcut</option>
                  </select>
                </div>
                <div className="col-span-5"><ProductPicker value={l.product} placeholder="Search product…" onPick={(p) => set(l.key, { product: p })} /></div>
                <div className="col-span-2"><input className="input !py-1.5 mono" type="number" step="0.001" min="0" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} placeholder="Qty" /></div>
                <div className="col-span-2"><input className="input !py-1.5 mono" type="number" step="0.01" min="0" value={l.lengthFt} onChange={(e) => set(l.key, { lengthFt: e.target.value })} placeholder="Len ft" /></div>
                <div className="col-span-1 flex items-center justify-end gap-1 pt-1.5">
                  <span className="money text-xs text-muted whitespace-nowrap" title="Allocated cost">{fmtMoney(preview[i].value)}</span>
                  {lines.length > 1 && <button type="button" className="text-muted hover:text-danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><X size={14} /></button>}
                </div>
              </div>
            ))}
            <div className="flex justify-between px-1 pt-1 text-xs text-muted border-t border-edge">
              <span>Value returned to stock</span>
              <span className={`money ${Math.abs(r2(allocated - valueToOutputs)) < 0.01 ? "" : "text-danger"}`}>{fmtMoney(allocated)} of {fmtMoney(valueToOutputs)}</span>
            </div>
          </div>
        </div>

        <div><label className="label">Notes (optional)</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. cut for site delivery" /></div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Record cut"}</button>
        </div>
      </form>
    </Modal>
  );
}
