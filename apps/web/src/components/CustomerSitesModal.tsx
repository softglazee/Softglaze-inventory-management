import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, FileText, MapPin, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { CustomerSiteBalance, SiteBalancesView, SiteLedger } from "../lib/types";
import { fmtMoney } from "../lib/format";
import { Modal, Badge, useToast } from "./ui";

// C4 — manage a customer's sites and see the per-site udhaar. Balances are derived on the
// server (Σ sites + unassigned == the customer's single balance), so this reconciles exactly.
export default function CustomerSitesModal({ customer, onClose }: { customer: { id: string; name: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<CustomerSiteBalance | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [statementFor, setStatementFor] = useState<CustomerSiteBalance | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["customer-sites", customer.id], queryFn: () => api<SiteBalancesView>(`/customer-sites?customerId=${customer.id}`) });
  const sites = data?.sites ?? [];

  const reset = () => { setEditing(null); setName(""); setAddress(""); };
  const refresh = () => { qc.invalidateQueries({ queryKey: ["customer-sites", customer.id] }); qc.invalidateQueries({ queryKey: ["customers"] }); };

  const save = useMutation({
    mutationFn: () => {
      const body = { customerId: customer.id, name, address: address || null };
      return editing ? api(`/customer-sites/${editing.id}`, { method: "PATCH", body }) : api("/customer-sites", { method: "POST", body });
    },
    onSuccess: () => { toast(editing ? "Site updated" : "Site added"); reset(); refresh(); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const del = useMutation({
    mutationFn: (id: string) => api<{ deactivated: boolean }>(`/customer-sites/${id}`, { method: "DELETE" }),
    onSuccess: (r) => { toast(r.deactivated ? "Site deactivated (kept for history)" : "Site deleted"); refresh(); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  return (
    <Modal open onClose={onClose} title={`Sites — ${customer.name}`} wide>
      <div className="space-y-4">
        {/* Add / edit form */}
        <form
          onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; save.mutate(); }}
          className="flex flex-wrap items-end gap-2"
        >
          <div className="flex-1 min-w-[180px]"><label className="label">Site / project name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="DHA Phase 5 – House 12" /></div>
          <div className="flex-1 min-w-[160px]"><label className="label">Address (optional)</label><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
          <button className="btn btn-primary" disabled={save.isPending || !name.trim()}>{editing ? <><Pencil size={15} /> Save</> : <><Plus size={15} /> Add</>}</button>
          {editing && <button type="button" className="btn btn-secondary" onClick={reset}>Cancel</button>}
        </form>

        {/* Sites + balances */}
        {isLoading ? (
          <p className="text-muted text-sm py-4">Loading…</p>
        ) : sites.length === 0 ? (
          <p className="text-muted text-sm py-4 text-center">No sites yet — add one above, then tag sales/receipts to it in the POS and payments.</p>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted border-b border-edge text-xs"><th className="px-3 py-2 font-medium">Site</th><th className="px-3 py-2 font-medium text-right">Owes (udhaar)</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 w-28" /></tr></thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id} className="border-b border-edge last:border-0">
                    <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><MapPin size={13} className="text-muted" /> {s.name}</span>{s.address && <span className="block text-xs text-muted ml-5">{s.address}</span>}</td>
                    <td className={`px-3 py-2 text-right money ${s.balance > 0 ? "text-danger" : s.balance < 0 ? "text-success" : ""}`}>{fmtMoney(s.balance)}</td>
                    <td className="px-3 py-2">{s.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Off</Badge>}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button className="btn btn-secondary !p-1.5" title="Statement" onClick={() => setStatementFor(s)}><FileText size={13} /></button>
                        <button className="btn btn-secondary !p-1.5" title="Edit" onClick={() => { setEditing(s); setName(s.name); setAddress(s.address ?? ""); }}><Pencil size={13} /></button>
                        <button className="btn btn-secondary !p-1.5 hover:!text-danger" title="Delete" onClick={() => { if (confirm(`Delete site “${s.name}”?`)) del.mutate(s.id); }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-edge text-muted"><td className="px-3 py-2">Unassigned (opening + untagged)</td><td className="px-3 py-2 text-right money">{fmtMoney(data!.unassigned)}</td><td colSpan={2} /></tr>
                <tr className="border-t border-edge font-semibold"><td className="px-3 py-2">Total = customer balance</td><td className="px-3 py-2 text-right money">{fmtMoney(data!.total)}</td><td colSpan={2} className="px-3 py-2 text-xs">{data!.reconciles ? <span className="text-success">✓ reconciles</span> : <span className="text-danger">mismatch</span>}</td></tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">Tag sales to a site in the POS and receipts to a site when receiving payment. Per-site balances always add up to the customer's single balance.</p>
        <div className="flex justify-end"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
      </div>

      {statementFor && <SiteStatement site={statementFor} onClose={() => setStatementFor(null)} />}
    </Modal>
  );
}

function SiteStatement({ site, onClose }: { site: CustomerSiteBalance; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["site-ledger", site.id], queryFn: () => api<SiteLedger>(`/customer-sites/${site.id}/ledger`) });
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 h-13 py-3.5 border-b border-edge shrink-0">
          <h2 className="font-semibold display text-[15px]">Statement — {site.name}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button>
        </div>
        <div className="p-4 overflow-y-auto">
          {isLoading ? <p className="text-muted text-sm">Loading…</p> : !data ? null : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted border-b border-edge text-xs"><th className="px-2 py-2 font-medium">Date</th><th className="px-2 py-2 font-medium">Ref</th><th className="px-2 py-2 font-medium">Detail</th><th className="px-2 py-2 font-medium text-right">Debit</th><th className="px-2 py-2 font-medium text-right">Credit</th><th className="px-2 py-2 font-medium text-right">Balance</th></tr></thead>
              <tbody>
                {data.entries.length === 0 ? (
                  <tr><td colSpan={6} className="px-2 py-6 text-center text-muted">No activity tagged to this site yet.</td></tr>
                ) : data.entries.map((e, i) => (
                  <tr key={i} className="border-b border-edge last:border-0">
                    <td className="px-2 py-1.5 whitespace-nowrap text-xs">{new Date(e.date).toLocaleDateString("en-GB")}</td>
                    <td className="px-2 py-1.5 mono text-xs">{e.refNo}</td>
                    <td className="px-2 py-1.5">{e.description}</td>
                    <td className="px-2 py-1.5 text-right money">{e.debit ? fmtMoney(e.debit) : "—"}</td>
                    <td className="px-2 py-1.5 text-right money">{e.credit ? fmtMoney(e.credit) : "—"}</td>
                    <td className="px-2 py-1.5 text-right money font-medium">{fmtMoney(e.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-edge font-semibold"><td colSpan={3} className="px-2 py-2">Closing (owes)</td><td className="px-2 py-2 text-right money">{fmtMoney(data.totalDebit)}</td><td className="px-2 py-2 text-right money">{fmtMoney(data.totalCredit)}</td><td className="px-2 py-2 text-right money text-accent">{fmtMoney(data.closing)}</td></tr></tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
