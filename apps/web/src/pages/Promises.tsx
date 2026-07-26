import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, HandCoins, Check, XCircle, Ban, Trash2, Search } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { PaymentPromise, PromiseSummary, Customer } from "../lib/types";
import { fmtMoney } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, Pagination, useClientPagination, useToast } from "../components/ui";

const FILTERS = [
  { key: "", label: "All" },
  { key: "OPEN", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "KEPT", label: "Kept" },
  { key: "BROKEN", label: "Broken" },
];

const isOverdue = (p: PaymentPromise) => p.status === "OPEN" && new Date(p.promiseDate) < new Date();

function StatusBadge({ p }: { p: PaymentPromise }) {
  const cls =
    p.status === "KEPT" ? "bg-success/15 text-success"
    : p.status === "BROKEN" ? "bg-danger/15 text-danger"
    : p.status === "CANCELLED" ? "bg-surface-2 text-muted"
    : isOverdue(p) ? "bg-danger/15 text-danger"
    : "bg-accent/15 text-accent";
  const label = p.status === "OPEN" && isOverdue(p) ? "Overdue" : p.status[0] + p.status.slice(1).toLowerCase();
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}

export default function Promises() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canEdit = can("payments.receive");
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);

  const { data: sum } = useQuery({ queryKey: ["promise-summary"], queryFn: () => api<{ summary: PromiseSummary }>("/promises/summary") });
  const { data, isLoading } = useQuery({ queryKey: ["promises", filter], queryFn: () => api<{ promises: PaymentPromise[] }>(`/promises${filter ? `?status=${filter}` : ""}`) });
  const promises = data?.promises ?? [];
  const { page, pages, setPage, pageRows, total, perPage } = useClientPagination(promises, 12);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["promises"] }); qc.invalidateQueries({ queryKey: ["promise-summary"] }); };
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api(`/promises/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: () => { invalidate(); }, onError: (e: ApiError) => toast(e.message, "error"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/promises/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast("Promise removed"); invalidate(); }, onError: (e: ApiError) => toast(e.message, "error"),
  });

  return (
    <div>
      <PageHeader
        title="Promises to pay"
        sub="When a customer promises to clear their udhaar by a date — log it, then follow up. Overdue promises raise a bell."
        actions={canEdit && <button className="btn btn-secondary !border-accent !text-accent" onClick={() => setAdding(true)}><Plus size={16} /> Log promise</button>}
      />

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="card p-3"><div className="text-xs text-muted">Open promises</div><div className="text-xl font-semibold">{sum?.summary.open ?? 0}</div></div>
        <div className="card p-3"><div className="text-xs text-muted">Overdue</div><div className="text-xl font-semibold text-danger">{sum?.summary.overdue ?? 0}</div></div>
        <div className="card p-3"><div className="text-xs text-muted">Open amount</div><div className="text-xl font-semibold money">{fmtMoney(sum?.summary.openAmount ?? 0)}</div></div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {FILTERS.map((f) => (
          <button key={f.key} className={`btn btn-secondary !py-1 ${filter === f.key ? "!border-accent !text-accent" : ""}`} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={6} />
        ) : promises.length === 0 ? (
          <EmptyState title="No promises here" hint="Log a promise when a customer commits to a payment date." />
        ) : (
          <>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs"><th className="px-4 py-2.5 font-semibold">Customer</th><th className="px-4 py-2.5 font-semibold text-right">Amount</th><th className="px-4 py-2.5 font-semibold">By date</th><th className="px-4 py-2.5 font-semibold">Note</th><th className="px-4 py-2.5 font-semibold">Status</th><th className="px-4 py-2.5 w-40" /></tr></thead>
            <tbody>
              {pageRows.map((p) => (
                <tr key={p.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                  <td className="px-4 py-2"><div>{p.customer?.name}</div><div className="text-xs text-muted mono">{p.customer?.code} · owes {fmtMoney(p.customer?.balance ?? 0)}</div></td>
                  <td className="px-4 py-2 text-right money">{fmtMoney(p.amount)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{new Date(p.promiseDate).toLocaleDateString("en-GB")}</td>
                  <td className="px-4 py-2 text-muted truncate max-w-[14rem]">{p.note ?? "—"}</td>
                  <td className="px-4 py-2"><StatusBadge p={p} /></td>
                  <td className="px-4 py-2">
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        {p.status === "OPEN" && <>
                          <button className="btn btn-secondary !p-1.5 hover:!text-success" title="Mark kept (paid)" onClick={() => setStatus.mutate({ id: p.id, status: "KEPT" })}><Check size={14} /></button>
                          <button className="btn btn-secondary !p-1.5 hover:!text-danger" title="Mark broken" onClick={() => setStatus.mutate({ id: p.id, status: "BROKEN" })}><XCircle size={14} /></button>
                          <button className="btn btn-secondary !p-1.5" title="Cancel" onClick={() => setStatus.mutate({ id: p.id, status: "CANCELLED" })}><Ban size={14} /></button>
                        </>}
                        <button className="btn btn-secondary !p-1.5 hover:!text-danger" title="Delete" onClick={() => remove.mutate(p.id)}><Trash2 size={14} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pagination page={page} pages={pages} onPage={setPage} total={total} perPage={perPage} />
          </>
        )}
      </div>

      {adding && <PromiseForm onClose={() => setAdding(false)} onDone={() => { toast("Promise logged"); invalidate(); setAdding(false); }} />}
    </div>
  );
}

function PromiseForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [customer, setCustomer] = useState<{ id: string; name: string; code: string } | null>(null);
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: results } = useQuery({
    queryKey: ["promise-cust-search", search],
    queryFn: () => api<{ customers: Customer[] }>(`/customers?search=${encodeURIComponent(search)}&limit=8`),
    enabled: search.trim().length > 0 && !customer,
  });

  const save = useMutation({
    mutationFn: () => api("/promises", { method: "POST", body: { customerId: customer!.id, amount: Number(amount), promiseDate: date, note: note || null } }),
    onSuccess: onDone, onError: (e: ApiError) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!customer) return setError("Pick a customer.");
    if (!(Number(amount) > 0)) return setError("Enter an amount.");
    save.mutate();
  }

  return (
    <Modal open onClose={onClose} title="Log a promise to pay">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Customer</label>
          {customer ? (
            <div className="flex items-center justify-between input">
              <span>{customer.name} <span className="mono text-muted text-xs">{customer.code}</span></span>
              <button type="button" className="text-muted hover:text-danger text-xs" onClick={() => setCustomer(null)}>change</button>
            </div>
          ) : (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input className="input !pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer by name / phone…" autoFocus />
              {search.trim() && (results?.customers.length ?? 0) > 0 && (
                <div className="absolute z-10 mt-1 w-full card max-h-52 overflow-y-auto">
                  {results!.customers.map((c) => (
                    <button type="button" key={c.id} className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 flex justify-between" onClick={() => { setCustomer({ id: c.id, name: c.name, code: c.code }); setSearch(""); }}>
                      <span>{c.name}</span><span className="mono text-muted">{fmtMoney(c.balance)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Amount promised</label><input className="input mono" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
          <div><label className="label">By date</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
        </div>
        <div><label className="label">Note <span className="text-muted">(optional)</span></label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Said he'll pay after the truck delivers" /></div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-secondary !border-accent !text-accent" disabled={save.isPending}><HandCoins size={15} /> {save.isPending ? "Saving…" : "Log promise"}</button></div>
      </form>
    </Modal>
  );
}
