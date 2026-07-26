import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, X, Undo2, Plus } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Product, PaymentMethod } from "../lib/types";
import { num, fmtMoney } from "../lib/format";
import { PageHeader, EmptyState, useToast } from "../components/ui";

type Pick = { id: string; name: string; sku: string; salePrice: string; unit?: { shortName: string } };
type Line = { key: string; product: Pick; qty: string; unitPrice: string };
let seq = 0;

export default function WalkInReturn() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [refundMethodId, setRefundMethodId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: prod } = useQuery({ queryKey: ["wir-prod", q], queryFn: () => api<{ products: Product[] }>(`/products/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length > 0 });
  const results = (prod?.products ?? []).filter((p) => p.type === "STANDARD");
  const { data: acc } = useQuery({ queryKey: ["payment-methods"], queryFn: () => api<{ methods: PaymentMethod[] }>("/payment-methods") });
  const methods = (acc?.methods ?? []).filter((m) => m.isActive);

  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = useMutation({
    mutationFn: () => api<{ sale: { invoiceNo: string } }>("/sales/blank-return", { method: "POST", body: { refundMethodId, notes: notes || null, items: lines.map((l) => ({ productId: l.product.id, qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice) || 0 })) } }),
    onSuccess: (d) => { toast(`Refund ${d.sale.invoiceNo} done`); setLines([]); setNotes(""); setError(null); qc.invalidateQueries({ queryKey: ["accounts"] }); },
    onError: (e: ApiError) => setError(e.message),
  });

  function submit() {
    setError(null);
    if (lines.length === 0 || lines.some((l) => (Number(l.qty) || 0) <= 0)) return setError("Add at least one item with a quantity");
    if (!refundMethodId) return setError("Pick which account refunds the cash");
    save.mutate();
  }

  return (
    <div>
      <PageHeader title="Walk-in Return" sub="Refund a customer who has no original bill. The items go back into stock and the refund goes out in cash — booked as a return so your books stay exact." />
      <div className="grid lg:grid-cols-[1fr_360px] gap-4">
        <div className="card p-4 space-y-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input !pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a product to refund…" />
            {q.trim() && results.length > 0 && (
              <div className="absolute z-30 mt-1 w-full card max-h-52 overflow-y-auto p-1 shadow-xl">
                {results.map((p) => <button key={p.id} type="button" className="w-full text-left px-3 py-1.5 rounded hover:bg-surface-2 text-sm" onClick={() => { setLines((ls) => ls.some((x) => x.product.id === p.id) ? ls : [...ls, { key: `l${++seq}`, product: { id: p.id, name: p.name, sku: p.sku, salePrice: p.salePrice, unit: p.unit }, qty: "1", unitPrice: String(num(p.salePrice)) }]); setQ(""); }}><Plus size={12} className="inline mr-1" />{p.name} <span className="mono text-muted text-xs">{p.sku} · {fmtMoney(p.salePrice)}</span></button>)}
              </div>
            )}
          </div>

          {lines.length === 0 ? <EmptyState title="No items yet" hint="Search and add the products the customer is returning." /> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted border-b border-edge"><th className="py-2 font-medium">Product</th><th className="py-2 font-medium text-right">Qty</th><th className="py-2 font-medium text-right">Refund price</th><th className="py-2 font-medium text-right">Total</th><th /></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className="border-b border-edge last:border-0">
                    <td className="py-1.5">{l.product.name} <span className="mono text-muted text-xs">{l.product.unit?.shortName ?? ""}</span></td>
                    <td className="py-1.5"><input className="input !py-1 !w-20 mono text-right" type="number" step="0.001" min="0" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} /></td>
                    <td className="py-1.5"><input className="input !py-1 !w-24 mono text-right" type="number" step="0.01" min="0" value={l.unitPrice} onChange={(e) => set(l.key, { unitPrice: e.target.value })} /></td>
                    <td className="py-1.5 text-right money">{fmtMoney((Number(l.qty) || 0) * (Number(l.unitPrice) || 0))}</td>
                    <td className="py-1.5 text-right"><button className="text-muted hover:text-danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><X size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card p-4 space-y-3 h-max">
          <div className="flex items-center justify-between text-lg font-bold"><span>Refund</span><span className="money text-accent">{fmtMoney(total)}</span></div>
          <div><label className="label">Refund from account</label><select className="input" value={refundMethodId} onChange={(e) => setRefundMethodId(e.target.value)}><option value="">Choose account…</option>{methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <div><label className="label">Notes (optional)</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="reason for return" /></div>
          {error && <p className="text-danger text-sm">{error}</p>}
          <button className="btn btn-money w-full" disabled={save.isPending || lines.length === 0} onClick={submit}><Undo2 size={16} /> {save.isPending ? "Refunding…" : "Refund & return to stock"}</button>
        </div>
      </div>
    </div>
  );
}
