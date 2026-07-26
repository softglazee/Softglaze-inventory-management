import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, X, PackageCheck, Send, Ban, Truck, Package } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { PurchaseOrder, PurchaseOrderStatus, Vendor, Product } from "../lib/types";
import { num, fmtMoney } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, Badge, FormSection, Pagination, useClientPagination, useToast } from "../components/ui";

const d = (s: string) => new Date(s).toLocaleDateString("en-GB");
const STATUS_TONE: Record<PurchaseOrderStatus, "muted" | "warn" | "success" | "danger"> = { DRAFT: "muted", SENT: "warn", PARTIAL: "warn", RECEIVED: "success", CLOSED: "muted", CANCELLED: "danger" };
type PickProduct = { id: string; name: string; sku: string; costPrice: string; unit?: { shortName: string } };

export default function PurchaseOrders() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canManage = can("purchases.create");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["purchase-orders"], queryFn: () => api<{ orders: PurchaseOrder[] }>("/purchase-orders") });
  const orders = data?.orders ?? [];
  const { page, pages, setPage, pageRows, total, perPage } = useClientPagination(orders, 12);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["purchase-orders"] }); qc.invalidateQueries({ queryKey: ["purchases"] }); qc.invalidateQueries({ queryKey: ["vendors"] }); };

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        sub="Raise an order to a vendor, then receive the goods against it (fully or in parts). Receiving books a normal purchase — stock comes in and the vendor payable goes up — so your books stay exact."
        actions={canManage ? <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New order</button> : undefined}
      />

      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={6} />
        ) : orders.length === 0 ? (
          <EmptyState title="No purchase orders yet" hint={canManage ? "Raise a PO to a vendor and receive against it when the goods arrive." : "Ask an admin to raise purchase orders."} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs">
                    <th className="px-4 py-2.5 font-semibold">PO</th>
                    <th className="px-4 py-2.5 font-semibold">Date</th>
                    <th className="px-4 py-2.5 font-semibold">Vendor</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Lines</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Ordered value</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((o) => {
                    const value = o.items.reduce((s, i) => s + num(i.qty) * num(i.unitCost), 0);
                    const recv = o.items.filter((i) => num(i.qtyReceived) >= num(i.qty) - 0.0001).length;
                    return (
                      <tr key={o.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50 cursor-pointer" onClick={() => setOpenId(o.id)}>
                        <td className="px-4 py-2 mono text-xs font-semibold text-accent">{o.poNo}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{d(o.date)}</td>
                        <td className="px-4 py-2">{o.vendor?.name ?? "—"}</td>
                        <td className="px-4 py-2"><Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge></td>
                        <td className="px-4 py-2 text-right mono">{recv}/{o.items.length}</td>
                        <td className="px-4 py-2 text-right money">{fmtMoney(value)}</td>
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

      {creating && <POEditor onClose={() => setCreating(false)} onDone={() => { toast("Purchase order raised"); refresh(); setCreating(false); }} />}
      {openId && <PODetail id={openId} canManage={canManage} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </div>
  );
}

function ProductPicker({ onPick }: { onPick: (p: PickProduct) => void }) {
  const [q, setQ] = useState("");
  const { data } = useQuery({ queryKey: ["po-prod", q], queryFn: () => api<{ products: Product[] }>(`/products/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length > 0 });
  const results = (data?.products ?? []).filter((p) => p.type === "STANDARD");
  return (
    <div className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input className="input !pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product to add…" />
      {q.trim() && results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full card max-h-52 overflow-y-auto p-1 shadow-xl">
          {results.map((p) => (
            <button key={p.id} type="button" className="w-full text-left px-3 py-1.5 rounded hover:bg-surface-2 text-sm" onClick={() => { onPick({ id: p.id, name: p.name, sku: p.sku, costPrice: p.costPrice, unit: p.unit }); setQ(""); }}>
              {p.name} <span className="mono text-muted text-xs">{p.sku} · ₨{num(p.costPrice)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type POLine = { key: string; product: PickProduct; qty: string; unitCost: string };
let seq = 0;

function POEditor({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [vendorId, setVendorId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<POLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data: vData } = useQuery({ queryKey: ["vendors", "all"], queryFn: () => api<{ vendors: Vendor[] }>("/vendors?limit=300") });
  const vendors = (vData?.vendors ?? []).filter((v) => v.isActive);
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);

  const save = useMutation({
    mutationFn: () => api<{ order: PurchaseOrder }>("/purchase-orders", { method: "POST", body: { vendorId, expectedDate: expectedDate || null, notes: notes || null, items: lines.map((l) => ({ productId: l.product.id, qty: Number(l.qty) || 0, unitCost: Number(l.unitCost) || 0 })) } }),
    onSuccess: () => onDone(),
    onError: (e: ApiError) => setError(e.message),
  });

  function submit() {
    setError(null);
    if (!vendorId) return setError("Pick a vendor");
    if (lines.length === 0 || lines.some((l) => (Number(l.qty) || 0) <= 0)) return setError("Add at least one line with a quantity");
    save.mutate();
  }
  const set = (key: string, patch: Partial<POLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <Modal open onClose={onClose} title="New purchase order" wide>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
        <FormSection title="Order details" icon={Truck} color="var(--accent)">
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="label">Vendor</label><select className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}><option value="">Choose vendor…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
            <div><label className="label">Expected date (optional)</label><input className="input" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="label">Notes (optional)</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. urgent — deliver to site" /></div>
          </div>
        </FormSection>

        <FormSection title="Items" icon={Package} color="var(--info)">
          <div className="space-y-2">
            <ProductPicker onPick={(p) => setLines((ls) => [...ls, { key: `l${++seq}`, product: p, qty: "", unitCost: String(num(p.costPrice) || "") }])} />
            {lines.length === 0 ? (
              <div className="rounded-lg border border-dashed border-edge py-6 text-center">
                <Package size={20} className="mx-auto text-faint mb-1" />
                <p className="text-xs text-muted">No lines yet — search above to add products.</p>
              </div>
            ) : (
              <>
                {lines.map((l) => (
                  <div key={l.key} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-6 text-sm truncate">{l.product.name} <span className="mono text-muted text-xs">{l.product.unit?.shortName ?? ""}</span></div>
                    <div className="col-span-2"><input className="input !py-1.5 mono" type="number" step="0.001" min="0" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} placeholder="Qty" /></div>
                    <div className="col-span-3"><input className="input !py-1.5 mono" type="number" step="0.01" min="0" value={l.unitCost} onChange={(e) => set(l.key, { unitCost: e.target.value })} placeholder="Cost" /></div>
                    <div className="col-span-1 text-right"><button type="button" className="text-muted hover:text-danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove line"><X size={14} /></button></div>
                  </div>
                ))}
                <div className="flex justify-end text-sm pt-2 border-t border-edge"><span className="text-muted mr-2">Order value</span><span className="money font-semibold">{fmtMoney(total)}</span></div>
              </>
            )}
          </div>
        </FormSection>

        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Raise order"}</button></div>
      </form>
    </Modal>
  );
}

function PODetail({ id, canManage, onClose, onChanged }: { id: string; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const { data, refetch } = useQuery({ queryKey: ["purchase-order", id], queryFn: () => api<{ order: PurchaseOrder }>(`/purchase-orders/${id}`) });
  const order = data?.order;
  const [recv, setRecv] = useState<Record<string, string>>({});
  const [refInvoiceNo, setRefInvoiceNo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const receive = useMutation({
    mutationFn: () => {
      const lines = Object.entries(recv).filter(([, q]) => (Number(q) || 0) > 0).map(([poItemId, q]) => ({ poItemId, qty: Number(q) }));
      return api(`/purchase-orders/${id}/receive`, { method: "POST", body: { refInvoiceNo: refInvoiceNo || null, lines } });
    },
    onSuccess: () => { toast("Goods received — purchase booked"); setRecv({}); setRefInvoiceNo(""); refetch(); onChanged(); },
    onError: (e: ApiError) => setError(e.message),
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => api(`/purchase-orders/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: () => { refetch(); onChanged(); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  const canReceive = order && order.status !== "CANCELLED" && order.items.some((i) => num(i.qty) - num(i.qtyReceived) > 0.0001);

  return (
    <Modal open onClose={onClose} title={order ? `${order.poNo} — ${order.vendor?.name ?? ""}` : "Purchase order"} wide>
      {!order ? <TableSkeleton cols={4} /> : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Badge tone={STATUS_TONE[order.status]}>{order.status}</Badge>
            {canManage && order.status === "DRAFT" && <button className="btn btn-secondary !py-1 !px-2 text-xs" onClick={() => setStatus.mutate("SENT")}><Send size={12} /> Mark sent</button>}
            {canManage && (order.status === "DRAFT" || order.status === "SENT") && <button className="btn btn-secondary !py-1 !px-2 text-xs hover:!text-danger" onClick={() => { if (confirm("Cancel this PO?")) setStatus.mutate("CANCELLED"); }}><Ban size={12} /> Cancel</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs"><th className="px-2 py-2 font-semibold">Product</th><th className="px-2 py-2 font-semibold text-right">Ordered</th><th className="px-2 py-2 font-semibold text-right">Received</th><th className="px-2 py-2 font-semibold text-right">Cost</th>{canReceive && canManage && <th className="px-2 py-2 font-semibold text-right">Receive now</th>}</tr></thead>
              <tbody>
                {order.items.map((i) => {
                  const remaining = num(i.qty) - num(i.qtyReceived);
                  return (
                    <tr key={i.id} className="border-b border-edge last:border-0">
                      <td className="px-2 py-2">{i.product?.name} <span className="mono text-muted text-xs">{i.product?.unit?.shortName ?? ""}</span></td>
                      <td className="px-2 py-2 text-right mono">{num(i.qty)}</td>
                      <td className="px-2 py-2 text-right mono">{num(i.qtyReceived)}</td>
                      <td className="px-2 py-2 text-right money">{fmtMoney(i.unitCost)}</td>
                      {canReceive && canManage && (
                        <td className="px-2 py-2 text-right">
                          {remaining > 0.0001 ? <input className="input !py-1 !w-24 mono text-right" type="number" step="0.001" min="0" max={remaining} value={recv[i.id] ?? ""} onChange={(e) => setRecv((r) => ({ ...r, [i.id]: e.target.value }))} placeholder={`≤ ${num(remaining)}`} /> : <span className="text-success text-xs">done</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {order.purchases.length > 0 && (
            <div className="text-xs text-muted">Received on: {order.purchases.map((p) => `${p.invoiceNo} (${fmtMoney(p.grandTotal)})`).join(", ")}</div>
          )}

          {canReceive && canManage && (
            <div className="rounded-lg border border-edge p-3 space-y-2">
              <div className="flex items-end gap-2">
                <div className="flex-1"><label className="label">Vendor bill no. (optional)</label><input className="input mono" value={refInvoiceNo} onChange={(e) => setRefInvoiceNo(e.target.value)} placeholder="vendor's invoice #" /></div>
                <button className="btn btn-primary" disabled={receive.isPending || !Object.values(recv).some((q) => (Number(q) || 0) > 0)} onClick={() => { setError(null); receive.mutate(); }}><PackageCheck size={15} /> {receive.isPending ? "Receiving…" : "Receive goods"}</button>
              </div>
              {error && <p className="text-danger text-sm">{error}</p>}
              <p className="text-xs text-muted">Receiving books a purchase for the quantities above; the vendor payable rises by their value.</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
