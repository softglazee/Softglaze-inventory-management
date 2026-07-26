import { useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Users, Upload, FileText, HandCoins, MapPin } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Customer, Paged, PriceGroup } from "../lib/types";
import { num, fmtMoney } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import {
  PageHeader,
  Modal,
  ConfirmDialog,
  EmptyState,
  TableSkeleton,
  SearchBox,
  Badge,
  Pagination,
  FormSection,
  useToast,
} from "../components/ui";
import ImportWizard from "../components/ImportWizard";
import LedgerModal from "../components/LedgerModal";
import CustomerSitesModal from "../components/CustomerSitesModal";
import { PaymentModal } from "./Payments";

type FormState = {
  name: string;
  phone: string;
  email: string;
  address: string;
  taxNumber: string;
  openingBalance: string;
  creditLimit: string;
  priceGroupId: string;
};
const emptyForm: FormState = { name: "", phone: "", email: "", address: "", taxNumber: "", openingBalance: "0", creditLimit: "0", priceGroupId: "" };

export default function Customers() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [importing, setImporting] = useState(false);
  const [ledgerFor, setLedgerFor] = useState<Customer | null>(null);
  const [receiveFor, setReceiveFor] = useState<Customer | null>(null);
  const [sitesFor, setSitesFor] = useState<Customer | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams({
    page: String(page),
    limit: "20",
    ...(search.trim() && { search: search.trim() }),
    ...(status && { status }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["customers", page, search, status],
    queryFn: () => api<Paged<"customers", Customer> & { totalReceivable: string | number }>(`/customers?${params}`),
    placeholderData: keepPreviousData,
  });
  const customers = data?.customers ?? [];
  const { data: priceGroups } = useQuery({ queryKey: ["price-groups"], queryFn: () => api<{ groups: PriceGroup[] }>("/price-groups") });

  const save = useMutation({
    mutationFn: (payload: { id?: string; body: Record<string, unknown> }) =>
      payload.id
        ? api<{ customer: Customer }>(`/customers/${payload.id}`, { method: "PATCH", body: payload.body })
        : api<{ customer: Customer }>("/customers", { method: "POST", body: payload.body }),
    onSuccess: (d, payload) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast(payload.id ? `${d.customer.name} updated` : `${d.customer.name} added (${d.customer.code})`);
      setEditing(null);
    },
    onError: (e: ApiError) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<{ message: string }>(`/customers/${id}`, { method: "DELETE" }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast(d.message);
      setDeleting(null);
    },
    onError: (e: ApiError) => {
      toast(e.message, "error");
      setDeleting(null);
    },
  });

  function openNew() {
    setForm(emptyForm);
    setError(null);
    setEditing("new");
  }
  function openEdit(c: Customer) {
    setForm({
      name: c.name,
      phone: c.phone ?? "",
      email: c.email ?? "",
      address: c.address ?? "",
      taxNumber: c.taxNumber ?? "",
      openingBalance: String(num(c.openingBalance)),
      creditLimit: String(num(c.creditLimit)),
      priceGroupId: c.priceGroupId ?? "",
    });
    setError(null);
    setEditing(c);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate({
      id: editing === "new" ? undefined : (editing as Customer).id,
      body: {
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        taxNumber: form.taxNumber || null,
        openingBalance: Number(form.openingBalance) || 0,
        creditLimit: Number(form.creditLimit) || 0,
        priceGroupId: form.priceGroupId || null,
      },
    });
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        sub={`Khata (udhaar) accounts and walk-ins. Total receivable: ${fmtMoney(data?.totalReceivable ?? 0)}`}
        actions={
          <>
            {can("customers.create") && (
              <button className="btn btn-secondary" onClick={() => setImporting(true)}>
                <Upload size={16} /> Import
              </button>
            )}
            <button className="btn btn-secondary" onClick={openNew}>
              <Plus size={16} /> Add customer
            </button>
          </>
        }
      />

      <div className="flex flex-wrap gap-2 mb-3">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search name, phone, code…"
        />
        <select
          className="input !w-36"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="">All</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={6} />
        ) : customers.length === 0 ? (
          <EmptyState
            title={search ? "No customers match" : "No customers yet"}
            hint={search ? "Try a different search." : "Add your regular khata customers here."}
            action={
              !search && (
                <button className="btn btn-secondary" onClick={openNew}>
                  <Plus size={16} /> Add customer
                </button>
              )
            }
          />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-edge">
                  <th className="px-4 py-2.5 font-medium">Code</th>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Phone</th>
                  <th className="px-4 py-2.5 font-medium text-right">Balance (owes you)</th>
                  <th className="px-4 py-2.5 font-medium text-right">Credit limit</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 w-40" />
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => {
                  const bal = num(c.balance);
                  return (
                    <tr key={c.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                      <td className="px-4 py-2 mono text-muted">{c.code}</td>
                      <td className="px-4 py-2 font-medium">
                        <span className="inline-flex items-center gap-2">
                          <Users size={14} className="text-muted" /> {c.name}
                        </span>
                      </td>
                      <td className="px-4 py-2 mono text-muted">{c.phone ?? "—"}</td>
                      <td className={`px-4 py-2 text-right money ${bal > 0 ? "text-danger" : bal < 0 ? "text-success" : ""}`}>
                        {fmtMoney(c.balance)}
                      </td>
                      <td className="px-4 py-2 text-right money text-muted">
                        {num(c.creditLimit) > 0 ? fmtMoney(c.creditLimit) : "—"}
                      </td>
                      <td className="px-4 py-2">
                        {c.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive</Badge>}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1">
                          <button className="btn btn-secondary !p-1.5" onClick={() => setLedgerFor(c)} title={`Statement for ${c.name}`}>
                            <FileText size={14} />
                          </button>
                          <button className="btn btn-secondary !p-1.5" onClick={() => setSitesFor(c)} title={`Sites for ${c.name}`}>
                            <MapPin size={14} />
                          </button>
                          {can("payments.receive") && (
                            <button className="btn btn-secondary !p-1.5 hover:!text-accent" onClick={() => setReceiveFor(c)} title={`Receive payment from ${c.name}`}>
                              <HandCoins size={14} />
                            </button>
                          )}
                          <button
                            className="btn btn-secondary !p-1.5"
                            onClick={() => openEdit(c)}
                            title={`Edit ${c.name}`}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="btn btn-secondary !p-1.5 hover:!text-danger"
                            onClick={() => setDeleting(c)}
                            title={`Delete ${c.name}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} />
          </>
        )}
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add customer" : `Edit ${(editing as Customer)?.name ?? ""}`}
      >
        <form onSubmit={submit} className="space-y-4">
          <FormSection title="Customer details" icon={Users} color="var(--accent)">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="label">Name</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Karim Bhai" required autoFocus />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input mono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0300 1234567" />
              </div>
              <div>
                <label className="label">CNIC / NTN (optional)</label>
                <input className="input mono" value={form.taxNumber} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })} />
              </div>
              <div>
                <label className="label">Email (for statements)</label>
                <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
              </div>
              <div>
                <label className="label">Address (optional)</label>
                <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
            </div>
          </FormSection>

          <FormSection title="Credit & pricing" icon={HandCoins} color="var(--success)">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Opening balance (owes you)</label>
                <input className="input mono" type="number" step="0.01" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} />
              </div>
              <div>
                <label className="label">Credit limit (0 = no limit)</label>
                <input className="input mono" type="number" step="0.01" min="0" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Price group <span className="text-muted">(POS uses these rates)</span></label>
                <select className="input" value={form.priceGroupId} onChange={(e) => setForm({ ...form, priceGroupId: e.target.value })}>
                  <option value="">List price (default)</option>
                  {(priceGroups?.groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}{num(g.discountPercent) > 0 ? ` (${num(g.discountPercent)}% off)` : ""}</option>)}
                </select>
              </div>
            </div>
          </FormSection>

          {error && <p className="text-danger text-sm">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? "Saving…" : editing === "new" ? "Create customer" : "Save changes"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ""}?`}
        message={`"${deleting?.name}" will be removed. Customers with sales history are deactivated instead so their khata stays on record.`}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />

      <ImportWizard entity="customers" open={importing} onClose={() => setImporting(false)} onDone={() => qc.invalidateQueries({ queryKey: ["customers"] })} />

      {ledgerFor && <LedgerModal kind="customer" id={ledgerFor.id} name={ledgerFor.name} onClose={() => setLedgerFor(null)} />}
      {sitesFor && <CustomerSitesModal customer={{ id: sitesFor.id, name: sitesFor.name }} onClose={() => setSitesFor(null)} />}
      {receiveFor && (
        <PaymentModal
          mode="receive"
          fixedParty={{ id: receiveFor.id, name: receiveFor.name, balance: receiveFor.balance }}
          onClose={() => setReceiveFor(null)}
          onDone={(m) => { toast(m); qc.invalidateQueries({ queryKey: ["customers"] }); setReceiveFor(null); }}
        />
      )}
    </div>
  );
}
