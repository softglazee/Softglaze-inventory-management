import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, FileText } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { VendorNote, VendorNoteType, Vendor } from "../lib/types";
import { num, fmtMoney } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, Badge, Pagination, useClientPagination, useToast } from "../components/ui";

const d = (s: string) => new Date(s).toLocaleDateString("en-GB");

export default function VendorNotes() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canManage = can("vendors.edit");
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ["vendor-notes"], queryFn: () => api<{ notes: VendorNote[] }>("/vendor-notes") });
  const notes = data?.notes ?? [];
  const { page, pages, setPage, pageRows, total, perPage } = useClientPagination(notes, 12);

  const del = useMutation({
    mutationFn: (id: string) => api(`/vendor-notes/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast("Note reversed"); qc.invalidateQueries({ queryKey: ["vendor-notes"] }); qc.invalidateQueries({ queryKey: ["vendors"] }); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  return (
    <div>
      <PageHeader
        title="Vendor Debit / Credit Notes"
        sub="Adjust what you owe a vendor without a purchase or a cash payment — a rate correction, an allowance, or goods returned without a stock document. A credit note lowers your payable; a debit note raises it."
        actions={canManage ? <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New note</button> : undefined}
      />

      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={6} />
        ) : notes.length === 0 ? (
          <EmptyState title="No vendor notes yet" hint={canManage ? "Issue a credit note (vendor reduced your bill) or a debit note (you owe more)." : "Ask an admin to issue vendor notes."} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs">
                    <th className="px-4 py-2.5 font-semibold">Ref</th>
                    <th className="px-4 py-2.5 font-semibold">Date</th>
                    <th className="px-4 py-2.5 font-semibold">Vendor</th>
                    <th className="px-4 py-2.5 font-semibold">Type</th>
                    <th className="px-4 py-2.5 font-semibold">Reason</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Amount</th>
                    <th className="px-4 py-2.5 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((n) => (
                    <tr key={n.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                      <td className="px-4 py-2 mono text-xs">{n.refNo}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{d(n.date)}</td>
                      <td className="px-4 py-2">{n.vendor?.name ?? "—"}</td>
                      <td className="px-4 py-2"><Badge tone={n.type === "CREDIT" ? "success" : "warn"}>{n.type === "CREDIT" ? "Credit (payable ↓)" : "Debit (payable ↑)"}</Badge></td>
                      <td className="px-4 py-2 text-muted max-w-xs truncate">{n.reason}</td>
                      <td className="px-4 py-2 text-right money">{fmtMoney(n.amount)}</td>
                      <td className="px-4 py-2 text-right">{canManage && <button className="btn btn-secondary !p-1.5 hover:!text-danger" title="Reverse note" onClick={() => { if (confirm(`Reverse ${n.refNo}? The vendor balance rolls back.`)) del.mutate(n.id); }}><Trash2 size={13} /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pages={pages} onPage={setPage} total={total} perPage={perPage} />
          </>
        )}
      </div>

      {creating && <NoteEditor onClose={() => setCreating(false)} onDone={() => { toast("Vendor note saved"); qc.invalidateQueries({ queryKey: ["vendor-notes"] }); qc.invalidateQueries({ queryKey: ["vendors"] }); setCreating(false); }} />}
    </div>
  );
}

function NoteEditor({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [vendorId, setVendorId] = useState("");
  const [type, setType] = useState<VendorNoteType>("CREDIT");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: vData } = useQuery({ queryKey: ["vendors", "all"], queryFn: () => api<{ vendors: Vendor[] }>("/vendors?limit=300") });
  const vendors = (vData?.vendors ?? []).filter((v) => v.isActive);
  const vendor = vendors.find((v) => v.id === vendorId);

  const save = useMutation({
    mutationFn: () => api<{ note: VendorNote }>("/vendor-notes", { method: "POST", body: { date, vendorId, type, amount: Number(amount) || 0, reason } }),
    onSuccess: () => onDone(),
    onError: (e: ApiError) => setError(e.message),
  });

  function submit() {
    setError(null);
    if (!vendorId) return setError("Pick a vendor");
    if ((Number(amount) || 0) <= 0) return setError("Enter an amount");
    if (!reason.trim()) return setError("Give a reason");
    save.mutate();
  }

  return (
    <Modal open onClose={onClose} title="New vendor note" wide>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Date</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="label">Vendor</label><select className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}><option value="">Choose vendor…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{num(v.balance) ? ` (owe ₨${num(v.balance)})` : ""}</option>)}</select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Type</label><select className="input" value={type} onChange={(e) => setType(e.target.value as VendorNoteType)}><option value="CREDIT">Credit note — lowers what you owe</option><option value="DEBIT">Debit note — raises what you owe</option></select></div>
          <div><label className="label">Amount</label><input className="input mono" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        </div>
        <div><label className="label">Reason</label><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. rate correction on last bill" /></div>
        {vendor && (Number(amount) || 0) > 0 && (
          <p className="text-xs text-muted flex items-center gap-1.5"><FileText size={13} /> {vendor.name}'s balance {fmtMoney(vendor.balance)} → <span className="money">{fmtMoney(num(vendor.balance) + (type === "DEBIT" ? 1 : -1) * (Number(amount) || 0))}</span></p>
        )}
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save note"}</button></div>
      </form>
    </Modal>
  );
}
