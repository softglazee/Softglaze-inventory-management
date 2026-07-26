import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Trash, FileSignature, Search } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { RateContract, RateContractStatus, Product, Customer, Paged } from "../lib/types";
import { num, fmtMoney } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, Badge, Pagination, useClientPagination, useToast } from "../components/ui";

const STATUS: Record<RateContractStatus, { tone: "success" | "warn" | "muted" | "danger"; label: string }> = {
  active: { tone: "success", label: "Active" },
  upcoming: { tone: "warn", label: "Upcoming" },
  expired: { tone: "muted", label: "Expired" },
  inactive: { tone: "danger", label: "Off" },
};
const d = (s: string) => new Date(s).toLocaleDateString("en-GB");

export default function RateContracts() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const canManage = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user?.role ?? "");
  const { data, isLoading } = useQuery({ queryKey: ["rate-contracts"], queryFn: () => api<{ contracts: RateContract[] }>("/rate-contracts") });
  const contracts = data?.contracts ?? [];
  const { page, pages, setPage, pageRows, total, perPage } = useClientPagination(contracts, 12);
  const [editing, setEditing] = useState<RateContract | "new" | null>(null);

  const del = useMutation({
    mutationFn: (id: string) => api(`/rate-contracts/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast("Contract deleted"); qc.invalidateQueries({ queryKey: ["rate-contracts"] }); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  return (
    <div>
      <PageHeader
        title="Rate Contracts"
        sub="Fixed per-item rates a customer gets for a set period. When they're on the POS, their contract rate auto-fills the line for those products. It only pre-fills — the bill still stores the price used, so old bills never change."
        actions={canManage ? <button className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={16} /> New contract</button> : undefined}
      />

      {isLoading ? <TableSkeleton cols={5} /> : contracts.length === 0 ? (
        <EmptyState title="No rate contracts yet" hint={canManage ? "Lock in a contractor's agreed rates for a date range, e.g. 12mm sariya at ₨290/kg for this quarter." : "Ask an admin to set up rate contracts."} />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs"><th className="px-4 py-2.5 font-semibold">Ref</th><th className="px-4 py-2.5 font-semibold">Customer</th><th className="px-4 py-2.5 font-semibold">Name</th><th className="px-4 py-2.5 font-semibold">Valid</th><th className="px-4 py-2.5 font-semibold text-right">Rates</th><th className="px-4 py-2.5 font-semibold">Status</th><th className="px-4 py-2.5 w-20" /></tr></thead>
            <tbody>
              {pageRows.map((c) => (
                <tr key={c.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                  <td className="px-4 py-2 mono text-xs">{c.refNo}</td>
                  <td className="px-4 py-2">{c.customer?.name}</td>
                  <td className="px-4 py-2 text-muted">{c.name}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-xs">{d(c.validFrom)} – {d(c.validUntil)}</td>
                  <td className="px-4 py-2 text-right mono">{c.items.length}</td>
                  <td className="px-4 py-2"><Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge></td>
                  <td className="px-4 py-2 text-right">
                    {canManage && (
                      <div className="flex gap-1 justify-end">
                        <button className="btn btn-secondary !p-1.5" title="Edit" onClick={() => setEditing(c)}><Pencil size={13} /></button>
                        <button className="btn btn-secondary !p-1.5 hover:!text-danger" title="Delete" onClick={() => { if (confirm(`Delete ${c.refNo}? The customer falls back to list price.`)) del.mutate(c.id); }}><Trash2 size={13} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pagination page={page} pages={pages} onPage={setPage} total={total} perPage={perPage} />
        </div>
      )}

      {editing && <ContractEditor contract={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { qc.invalidateQueries({ queryKey: ["rate-contracts"] }); setEditing(null); }} />}
    </div>
  );
}

function ProductPicker({ onPick }: { onPick: (p: Product) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["prod-pick-rc", q], queryFn: () => api<Paged<"products", Product>>(`/products?limit=8${q ? `&search=${encodeURIComponent(q)}` : ""}`), enabled: open });
  const list = (data?.products ?? []).filter((p) => p.isActive);
  return (
    <div className="relative">
      <input className="input !py-1" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Add a product to the contract…" />
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

function CustomerPicker({ value, onPick }: { value: { id: string; name: string } | null; onPick: (c: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState("");
  const { data } = useQuery({ queryKey: ["cust-pick-rc", q], queryFn: () => api<{ customers: Customer[] }>(`/customers?search=${encodeURIComponent(q)}&limit=8`), enabled: q.trim().length > 0 });
  if (value) {
    return <div className="flex items-center justify-between gap-2 input"><span>{value.name}</span><button type="button" className="text-muted hover:text-danger text-xs" onClick={() => onPick(null)}>change</button></div>;
  }
  return (
    <div className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input className="input !pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer by name / phone" />
      {q.trim() && (data?.customers.length ?? 0) > 0 && (
        <div className="absolute z-30 mt-1 w-full card max-h-52 overflow-y-auto p-1 shadow-xl">
          {data!.customers.map((c) => (
            <button key={c.id} type="button" className="w-full text-left px-3 py-1.5 rounded hover:bg-surface-2 text-sm" onClick={() => { onPick({ id: c.id, name: c.name }); setQ(""); }}>
              {c.name} <span className="mono text-muted text-xs">{c.phone}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Row = { productId: string; name: string; sku: string; list: string; unit: string; price: string };

function ContractEditor({ contract, onClose, onDone }: { contract: RateContract | null; onClose: () => void; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(contract ? { id: contract.customerId, name: contract.customer?.name ?? "" } : null);
  const [name, setName] = useState(contract?.name ?? "");
  const [validFrom, setValidFrom] = useState(contract ? contract.validFrom.slice(0, 10) : today);
  const [validUntil, setValidUntil] = useState(contract ? contract.validUntil.slice(0, 10) : today);
  const [isActive, setIsActive] = useState(contract?.isActive ?? true);
  const [notes, setNotes] = useState(contract?.notes ?? "");
  const [rows, setRows] = useState<Row[]>((contract?.items ?? []).map((it) => ({ productId: it.productId, name: it.product?.name ?? "", sku: it.product?.sku ?? "", list: String(num(it.product?.salePrice)), unit: it.product?.unit?.shortName ?? "", price: String(num(it.price)) })));
  const [error, setError] = useState<string | null>(null);

  const addProduct = (p: Product) => {
    if (rows.some((r) => r.productId === p.id)) return;
    setRows([...rows, { productId: p.id, name: p.name, sku: p.sku, list: String(num(p.salePrice)), unit: p.unit?.shortName ?? "", price: String(num(p.salePrice)) }]);
  };
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  const save = useMutation({
    mutationFn: () => {
      const body = { customerId: customer!.id, name, validFrom, validUntil, isActive, notes: notes || null, items: rows.map((r) => ({ productId: r.productId, price: Number(r.price) })) };
      return contract ? api(`/rate-contracts/${contract.id}`, { method: "PATCH", body }) : api("/rate-contracts", { method: "POST", body });
    },
    onSuccess: () => { onDone(); },
    onError: (e: ApiError) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!customer) return setError("Pick a customer");
    if (!name.trim()) return setError("Name is required");
    if (rows.length === 0) return setError("Add at least one product rate");
    if (new Date(validUntil) < new Date(validFrom)) return setError("Valid-until must be on or after valid-from");
    if (rows.some((r) => !(Number(r.price) >= 0))) return setError("Every rate needs a price");
    save.mutate();
  }

  return (
    <Modal open onClose={onClose} title={contract ? `Edit ${contract.refNo}` : "New rate contract"} wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="label">Customer</label><CustomerPicker value={customer} onPick={setCustomer} /></div>
          <div><label className="label">Contract name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Q1 2026 rates" required /></div>
          <div><label className="label">Valid from</label><input className="input" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} required /></div>
          <div><label className="label">Valid until</label><input className="input" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} required /></div>
        </div>

        <div>
          <label className="label">Agreed product rates</label>
          <ProductPicker onPick={addProduct} />
          {rows.length > 0 && (
            <div className="card overflow-hidden mt-2">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted border-b border-edge text-xs"><th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 font-medium text-right">List</th><th className="px-3 py-2 font-medium text-right w-36">Contract rate</th><th className="w-8" /></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.productId} className="border-b border-edge last:border-0">
                      <td className="px-3 py-1.5">{r.name} <span className="mono text-muted text-xs">{r.sku}</span></td>
                      <td className="px-3 py-1.5 text-right money text-muted">{fmtMoney(r.list)}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1 justify-end">
                          <input className="input mono !py-1 text-right" type="number" step="0.01" min="0" value={r.price} onChange={(e) => setRow(i, { price: e.target.value })} />
                          {r.unit && <span className="text-muted text-xs">/{r.unit}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right"><button type="button" className="text-muted hover:text-danger" onClick={() => removeRow(i)} aria-label="Remove"><Trash size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active</label>
          <input className="input flex-1" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
        </div>

        <p className="text-xs text-muted">On the POS, when this customer is selected the covered products auto-fill at their contract rate (a <span className="text-accent">contract</span> tag shows on the line). Cashiers can still adjust a line.</p>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : contract ? "Save changes" : "Create contract"}</button></div>
      </form>
    </Modal>
  );
}
