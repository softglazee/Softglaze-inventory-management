import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Trash, Tags, Users } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { PriceGroup, Product, Paged } from "../lib/types";
import { num, fmtMoney } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, useToast } from "../components/ui";

export default function PriceGroups() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const canManage = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user?.role ?? "");
  const { data, isLoading } = useQuery({ queryKey: ["price-groups"], queryFn: () => api<{ groups: PriceGroup[] }>("/price-groups") });
  const groups = data?.groups ?? [];
  const [editing, setEditing] = useState<PriceGroup | "new" | null>(null);

  const del = useMutation({
    mutationFn: (id: string) => api(`/price-groups/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast("Group deleted"); qc.invalidateQueries({ queryKey: ["price-groups"] }); qc.invalidateQueries({ queryKey: ["customers"] }); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  return (
    <div>
      <PageHeader title="Price Groups" sub="Pricing tiers like Retail / Contractor / Dealer — a % off list price plus optional per-product rates. The POS applies a customer's group automatically." actions={canManage ? <button className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={16} /> New group</button> : undefined} />

      {isLoading ? <TableSkeleton cols={4} /> : groups.length === 0 ? (
        <EmptyState title="No price groups yet" hint={canManage ? "Create tiers like Contractor (5% off) or Dealer (10% off), then assign customers to them." : "Ask an admin to set up price groups."} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <div key={g.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold flex items-center gap-1.5"><Tags size={15} /> {g.name}</p>
                  <p className="text-sm text-muted mt-0.5">{num(g.discountPercent) > 0 ? `${num(g.discountPercent)}% off list` : "List price"}{g.items.length > 0 ? ` · ${g.items.length} fixed rate${g.items.length > 1 ? "s" : ""}` : ""}</p>
                  <p className="text-xs text-muted mt-1 flex items-center gap-1"><Users size={12} /> {g._count?.customers ?? 0} customer{(g._count?.customers ?? 0) === 1 ? "" : "s"}</p>
                </div>
                {canManage && (
                  <div className="flex gap-1">
                    <button className="btn btn-secondary !p-1.5" title="Edit" onClick={() => setEditing(g)}><Pencil size={13} /></button>
                    <button className="btn btn-secondary !p-1.5 hover:!text-danger" title="Delete" onClick={() => { if (confirm(`Delete “${g.name}”? Customers on it fall back to list price.`)) del.mutate(g.id); }}><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <GroupEditor group={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { qc.invalidateQueries({ queryKey: ["price-groups"] }); setEditing(null); }} />}
    </div>
  );
}

function ProductPicker({ onPick }: { onPick: (p: Product) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["prod-pick-pg", q], queryFn: () => api<Paged<"products", Product>>(`/products?limit=8${q ? `&search=${encodeURIComponent(q)}` : ""}`), enabled: open });
  const list = (data?.products ?? []).filter((p) => p.isActive);
  return (
    <div className="relative">
      <input className="input !py-1" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Add a fixed-rate product…" />
      {open && list.length > 0 && (
        <div className="absolute z-30 mt-1 w-full card max-h-52 overflow-y-auto p-1 shadow-xl">
          {list.map((p) => (
            <button key={p.id} type="button" className="w-full text-left px-3 py-1.5 rounded hover:bg-surface-2 text-sm flex justify-between" onClick={() => { onPick(p); setQ(""); setOpen(false); }}>
              <span>{p.name} <span className="mono text-muted text-xs">{p.sku}</span></span><span className="money text-muted text-xs">list {fmtMoney(p.salePrice)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Row = { productId: string; name: string; sku: string; list: string; price: string };

function GroupEditor({ group, onClose, onDone }: { group: PriceGroup | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(group?.name ?? "");
  const [discount, setDiscount] = useState(String(num(group?.discountPercent)));
  const [rows, setRows] = useState<Row[]>((group?.items ?? []).map((it) => ({ productId: it.productId, name: it.product?.name ?? "", sku: it.product?.sku ?? "", list: String(num(it.product?.salePrice)), price: String(num(it.price)) })));
  const [error, setError] = useState<string | null>(null);

  const addProduct = (p: Product) => {
    if (rows.some((r) => r.productId === p.id)) return;
    const disc = Number(discount) || 0;
    const suggested = Math.round(num(p.salePrice) * (1 - disc / 100) * 100) / 100;
    setRows([...rows, { productId: p.id, name: p.name, sku: p.sku, list: String(num(p.salePrice)), price: String(suggested) }]);
  };
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  const save = useMutation({
    mutationFn: () => {
      const body = { name, discountPercent: Number(discount) || 0, isActive: true, items: rows.map((r) => ({ productId: r.productId, price: Number(r.price) })) };
      return group ? api(`/price-groups/${group.id}`, { method: "PATCH", body }) : api("/price-groups", { method: "POST", body });
    },
    onSuccess: () => { toast(group ? "Group updated" : "Group created"); onDone(); },
    onError: (e: ApiError) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Name is required");
    if (rows.some((r) => !(Number(r.price) >= 0))) return setError("Every fixed rate needs a price");
    save.mutate();
  }

  return (
    <Modal open onClose={onClose} title={group ? `Edit ${group.name}` : "New price group"} wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Retail / Contractor / Dealer" list="pg-presets" required /><datalist id="pg-presets"><option value="Retail" /><option value="Contractor" /><option value="Dealer" /><option value="Wholesale" /></datalist></div>
          <div><label className="label">Discount off list price (%)</label><input className="input mono" type="number" step="0.01" min="0" max="100" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
        </div>

        <div>
          <label className="label">Fixed product rates <span className="text-muted">(optional — override the % for specific items)</span></label>
          <ProductPicker onPick={addProduct} />
          {rows.length > 0 && (
            <div className="card overflow-hidden mt-2">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted border-b border-edge text-xs"><th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 font-medium text-right">List</th><th className="px-3 py-2 font-medium text-right w-32">Group price</th><th className="w-8" /></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.productId} className="border-b border-edge last:border-0">
                      <td className="px-3 py-1.5">{r.name} <span className="mono text-muted text-xs">{r.sku}</span></td>
                      <td className="px-3 py-1.5 text-right money text-muted">{fmtMoney(r.list)}</td>
                      <td className="px-3 py-1.5"><input className="input mono !py-1 text-right" type="number" step="0.01" min="0" value={r.price} onChange={(e) => setRow(i, { price: e.target.value })} /></td>
                      <td className="px-3 py-1.5 text-right"><button type="button" className="text-muted hover:text-danger" onClick={() => removeRow(i)} aria-label="Remove"><Trash size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-xs text-muted">On the bill, a product's price = its fixed group rate if set, otherwise list price minus the group %. Cashiers can still adjust a line.</p>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : group ? "Save changes" : "Create group"}</button></div>
      </form>
    </Modal>
  );
}
