import { useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Truck, Upload, FileText, Banknote } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Vendor, Paged } from "../lib/types";
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
import { PaymentModal } from "./Payments";

type FormState = {
  name: string;
  phone: string;
  address: string;
  taxNumber: string;
  bankDetails: string;
  openingBalance: string;
};
const emptyForm: FormState = { name: "", phone: "", address: "", taxNumber: "", bankDetails: "", openingBalance: "0" };

export default function Vendors() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Vendor | "new" | null>(null);
  const [deleting, setDeleting] = useState<Vendor | null>(null);
  const [importing, setImporting] = useState(false);
  const [ledgerFor, setLedgerFor] = useState<Vendor | null>(null);
  const [payFor, setPayFor] = useState<Vendor | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams({
    page: String(page),
    limit: "20",
    ...(search.trim() && { search: search.trim() }),
    ...(status && { status }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["vendors", page, search, status],
    queryFn: () => api<Paged<"vendors", Vendor> & { totalPayable: string | number }>(`/vendors?${params}`),
    placeholderData: keepPreviousData,
  });
  const vendors = data?.vendors ?? [];

  const save = useMutation({
    mutationFn: (payload: { id?: string; body: Record<string, unknown> }) =>
      payload.id
        ? api<{ vendor: Vendor }>(`/vendors/${payload.id}`, { method: "PATCH", body: payload.body })
        : api<{ vendor: Vendor }>("/vendors", { method: "POST", body: payload.body }),
    onSuccess: (d, payload) => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      toast(payload.id ? `${d.vendor.name} updated` : `${d.vendor.name} added (${d.vendor.code})`);
      setEditing(null);
    },
    onError: (e: ApiError) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<{ message: string }>(`/vendors/${id}`, { method: "DELETE" }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
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
  function openEdit(v: Vendor) {
    setForm({
      name: v.name,
      phone: v.phone ?? "",
      address: v.address ?? "",
      taxNumber: v.taxNumber ?? "",
      bankDetails: v.bankDetails ?? "",
      openingBalance: String(num(v.openingBalance)),
    });
    setError(null);
    setEditing(v);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate({
      id: editing === "new" ? undefined : (editing as Vendor).id,
      body: {
        name: form.name,
        phone: form.phone || null,
        address: form.address || null,
        taxNumber: form.taxNumber || null,
        bankDetails: form.bankDetails || null,
        openingBalance: Number(form.openingBalance) || 0,
      },
    });
  }

  return (
    <div>
      <PageHeader
        title="Vendors"
        sub={`Suppliers you buy from — including on udhaar. Total payable: ${fmtMoney(data?.totalPayable ?? 0)}`}
        actions={
          <>
            {can("vendors.create") && (
              <button className="btn btn-secondary" onClick={() => setImporting(true)}>
                <Upload size={16} /> Import
              </button>
            )}
            <button className="btn btn-secondary" onClick={openNew}>
              <Plus size={16} /> Add vendor
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
        ) : vendors.length === 0 ? (
          <EmptyState
            title={search ? "No vendors match" : "No vendors yet"}
            hint={search ? "Try a different search." : "Add your suppliers — cement dealer, steel mill…"}
            action={
              !search && (
                <button className="btn btn-secondary" onClick={openNew}>
                  <Plus size={16} /> Add vendor
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
                  <th className="px-4 py-2.5 font-medium text-right">Balance (you owe)</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 w-40" />
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => {
                  const bal = num(v.balance);
                  return (
                    <tr key={v.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                      <td className="px-4 py-2 mono text-muted">{v.code}</td>
                      <td className="px-4 py-2 font-medium">
                        <span className="inline-flex items-center gap-2">
                          <Truck size={14} className="text-muted" /> {v.name}
                        </span>
                      </td>
                      <td className="px-4 py-2 mono text-muted">{v.phone ?? "—"}</td>
                      <td className={`px-4 py-2 text-right money ${bal > 0 ? "text-danger" : bal < 0 ? "text-success" : ""}`}>
                        {fmtMoney(v.balance)}
                      </td>
                      <td className="px-4 py-2">
                        {v.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive</Badge>}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1">
                          <button className="btn btn-secondary !p-1.5" onClick={() => setLedgerFor(v)} title={`Statement for ${v.name}`}>
                            <FileText size={14} />
                          </button>
                          {can("payments.pay_vendor") && (
                            <button className="btn btn-secondary !p-1.5 hover:!text-accent" onClick={() => setPayFor(v)} title={`Pay ${v.name}`}>
                              <Banknote size={14} />
                            </button>
                          )}
                          <button
                            className="btn btn-secondary !p-1.5"
                            onClick={() => openEdit(v)}
                            title={`Edit ${v.name}`}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="btn btn-secondary !p-1.5 hover:!text-danger"
                            onClick={() => setDeleting(v)}
                            title={`Delete ${v.name}`}
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
        title={editing === "new" ? "Add vendor" : `Edit ${(editing as Vendor)?.name ?? ""}`}
      >
        <form onSubmit={submit} className="space-y-4">
          <FormSection title="Vendor details" icon={Truck} color="var(--accent)">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="label">Name</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Pak Steel Traders" required autoFocus />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input mono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0300 1234567" />
              </div>
              <div>
                <label className="label">NTN / tax no (optional)</label>
                <input className="input mono" value={form.taxNumber} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Address (optional)</label>
                <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
            </div>
          </FormSection>

          <FormSection title="Bank & balance" icon={Banknote} color="var(--success)">
            <div className="space-y-3">
              <div>
                <label className="label">Bank details (optional)</label>
                <textarea className="input mono" rows={2} value={form.bankDetails} onChange={(e) => setForm({ ...form, bankDetails: e.target.value })} placeholder="Meezan Bank — 0123 4567890" />
              </div>
              <div>
                <label className="label">Opening balance (you owe them)</label>
                <input className="input mono" type="number" step="0.01" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} />
              </div>
            </div>
          </FormSection>

          {error && <p className="text-danger text-sm">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? "Saving…" : editing === "new" ? "Create vendor" : "Save changes"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ""}?`}
        message={`"${deleting?.name}" will be removed. Vendors with purchase history are deactivated instead so old bills stay on record.`}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />

      <ImportWizard entity="vendors" open={importing} onClose={() => setImporting(false)} onDone={() => qc.invalidateQueries({ queryKey: ["vendors"] })} />

      {ledgerFor && <LedgerModal kind="vendor" id={ledgerFor.id} name={ledgerFor.name} onClose={() => setLedgerFor(null)} />}
      {payFor && (
        <PaymentModal
          mode="pay"
          fixedParty={{ id: payFor.id, name: payFor.name, balance: payFor.balance }}
          onClose={() => setPayFor(null)}
          onDone={(m) => { toast(m); qc.invalidateQueries({ queryKey: ["vendors"] }); setPayFor(null); }}
        />
      )}
    </div>
  );
}
