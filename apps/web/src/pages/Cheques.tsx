import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, XCircle, Ban, Landmark } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Cheque, ChequeSummary, Account, Customer, Vendor, Paged } from "../lib/types";
import { num, fmtMoney } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, Badge, ConfirmDialog, Pagination, useClientPagination, useToast } from "../components/ui";

const HOLDING_NAMES = ["Cheques in Hand", "Post-dated Cheques"];
const statusTone: Record<string, "warn" | "success" | "danger" | "muted"> = { PENDING: "warn", CLEARED: "success", BOUNCED: "danger", CANCELLED: "muted" };

export default function Cheques() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState("PENDING");
  const [modal, setModal] = useState<false | "receive" | "issue">(false);
  const [clearing, setClearing] = useState<Cheque | null>(null);
  const [confirm, setConfirm] = useState<{ cheque: Cheque; action: "bounce" | "cancel" } | null>(null);

  const qs = new URLSearchParams({ ...(direction && { direction }), ...(status && { status }) }).toString();
  const { data, isLoading } = useQuery({ queryKey: ["cheques", qs], queryFn: () => api<{ cheques: Cheque[] }>(`/cheques?${qs}`) });
  const { data: sum } = useQuery({ queryKey: ["cheque-summary"], queryFn: () => api<ChequeSummary>("/cheques/summary") });
  const cheques = data?.cheques ?? [];
  const { page, pages, setPage, pageRows, total, perPage } = useClientPagination(cheques, 12);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["cheques"] }); qc.invalidateQueries({ queryKey: ["cheque-summary"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: ["customers"] }); qc.invalidateQueries({ queryKey: ["vendors"] }); };
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "bounce" | "cancel" }) => api(`/cheques/${id}/${action}`, { method: "POST" }),
    onSuccess: (_d, v) => { toast(`Cheque ${v.action === "bounce" ? "marked bounced" : "cancelled"}`); refresh(); setConfirm(null); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  const sumOf = (dir: string, st: string) => num(sum?.groups.find((g) => g.direction === dir && g.status === st)?.amount ?? 0);
  const inHand = sumOf("RECEIVED", "PENDING");
  const payable = sumOf("ISSUED", "PENDING");

  return (
    <div>
      <PageHeader title="Cheques" sub="Post-dated cheque register — track every cheque until it clears or bounces." actions={
        <>
          {can("payments.receive") && <button className="btn btn-secondary !border-accent !text-accent" onClick={() => setModal("receive")}><ArrowDownLeft size={16} /> Receive cheque</button>}
          {can("payments.pay_vendor") && <button className="btn btn-secondary" onClick={() => setModal("issue")}><ArrowUpRight size={16} /> Issue cheque</button>}
        </>
      } />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <div className="card p-4"><p className="text-muted text-sm">Cheques in hand (pending)</p><p className="money text-xl font-bold mt-1 text-success">{fmtMoney(inHand)}</p></div>
        <div className="card p-4"><p className="text-muted text-sm">Cheques we issued (pending)</p><p className="money text-xl font-bold mt-1 text-danger">{fmtMoney(payable)}</p></div>
        <div className="card p-4"><p className="text-muted text-sm">Due within 3 days</p><p className="text-xl font-bold mt-1">{sum?.dueSoon ?? 0}</p></div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <select className="input !w-40" value={direction} onChange={(e) => setDirection(e.target.value)}><option value="">All cheques</option><option value="RECEIVED">Received</option><option value="ISSUED">Issued</option></select>
        <select className="input !w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="PENDING">Pending</option><option value="CLEARED">Cleared</option><option value="BOUNCED">Bounced</option><option value="CANCELLED">Cancelled</option></select>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? <TableSkeleton cols={6} /> : cheques.length === 0 ? (
          <EmptyState title="No cheques here" hint="Record a customer or vendor cheque to start tracking it." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs">
                <th className="px-4 py-2.5 font-semibold">Cheque date</th><th className="px-4 py-2.5 font-semibold">Ref</th><th className="px-4 py-2.5 font-semibold">Type</th>
                <th className="px-4 py-2.5 font-semibold">Party</th><th className="px-4 py-2.5 font-semibold">Bank / No.</th><th className="px-4 py-2.5 font-semibold text-right">Amount</th>
                <th className="px-4 py-2.5 font-semibold">Status</th><th className="px-4 py-2.5 font-semibold text-right">Action</th>
              </tr></thead>
              <tbody>
                {pageRows.map((c) => (
                  <tr key={c.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                    <td className="px-4 py-2 whitespace-nowrap">{new Date(c.chequeDate).toLocaleDateString("en-GB")}</td>
                    <td className="px-4 py-2 mono text-xs">{c.refNo}</td>
                    <td className="px-4 py-2">{c.direction === "RECEIVED" ? <span className="text-success">Received</span> : <span className="text-danger">Issued</span>}</td>
                    <td className="px-4 py-2">{c.customer?.name ?? c.vendor?.name ?? "—"}</td>
                    <td className="px-4 py-2 text-muted">{c.bankName} <span className="mono text-xs">#{c.chequeNo}</span></td>
                    <td className="px-4 py-2 text-right money font-medium">{fmtMoney(c.amount)}</td>
                    <td className="px-4 py-2"><Badge tone={statusTone[c.status]}>{c.status.toLowerCase()}</Badge></td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {c.status === "PENDING" && (
                        <div className="inline-flex gap-1">
                          <button className="btn btn-secondary !p-1.5 !text-success" title="Cleared" onClick={() => setClearing(c)}><CheckCircle2 size={14} /></button>
                          <button className="btn btn-secondary !p-1.5 !text-danger" title="Bounced" onClick={() => setConfirm({ cheque: c, action: "bounce" })}><XCircle size={14} /></button>
                          <button className="btn btn-secondary !p-1.5 text-muted" title="Cancel" onClick={() => setConfirm({ cheque: c, action: "cancel" })}><Ban size={14} /></button>
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

      {modal && <ChequeForm mode={modal} onClose={() => setModal(false)} onDone={(m) => { toast(m); refresh(); setModal(false); }} />}
      {clearing && <ClearForm cheque={clearing} onClose={() => setClearing(null)} onDone={(m) => { toast(m); refresh(); setClearing(null); }} />}
      {confirm && (
        <ConfirmDialog
          open title={confirm.action === "bounce" ? "Mark cheque bounced?" : "Cancel this cheque?"}
          message={confirm.action === "bounce"
            ? `This reverses the cheque — ${confirm.cheque.direction === "RECEIVED" ? "the customer will owe this amount again" : "you will owe the vendor again"}.`
            : "This reverses the cheque as if it was never given."}
          confirmLabel={confirm.action === "bounce" ? "Yes, bounced" : "Yes, cancel"}
          busy={act.isPending} onConfirm={() => act.mutate({ id: confirm.cheque.id, action: confirm.action })} onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

/* ─────────── Party picker (customer/vendor) ─────────── */
function PartyPicker({ kind, onChange }: { kind: "customer" | "vendor"; onChange: (p: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const { data } = useQuery({
    queryKey: [kind + "-pick-chq", q],
    queryFn: () => api<Paged<"customers", Customer> & Paged<"vendors", Vendor>>(`/${kind}s?limit=8&status=active${q ? `&search=${encodeURIComponent(q)}` : ""}`),
    enabled: open,
  });
  const list = (kind === "customer" ? data?.customers : data?.vendors) ?? [];
  return (
    <div className="relative">
      <input className="input" value={picked ? picked.name : q} onChange={(e) => { setPicked(null); onChange(null); setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={`Search ${kind}…`} />
      {open && !picked && list.length > 0 && (
        <div className="absolute z-10 mt-1 w-full card max-h-56 overflow-y-auto p-1 shadow-xl">
          {list.map((p) => (
            <button key={p.id} type="button" className="w-full text-left px-3 py-1.5 rounded hover:bg-surface-2 text-sm flex justify-between" onClick={() => { const v = { id: p.id, name: p.name }; setPicked(v); onChange(v); setOpen(false); }}>
              <span>{p.name} <span className="mono text-muted text-xs">{p.code}</span></span>
              <span className="money text-muted text-xs">{fmtMoney(p.balance)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChequeForm({ mode, onClose, onDone }: { mode: "receive" | "issue"; onClose: () => void; onDone: (m: string) => void }) {
  const isReceive = mode === "receive";
  const [party, setParty] = useState<{ id: string; name: string } | null>(null);
  const [bankName, setBankName] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [amount, setAmount] = useState("");
  const [chequeDate, setChequeDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { bankName, chequeNo, amount: Number(amount), chequeDate, notes: notes || null, [isReceive ? "customerId" : "vendorId"]: party!.id };
      return api<{ cheque: { refNo: string } }>(`/cheques/${isReceive ? "receive" : "issue"}`, { method: "POST", body });
    },
    onSuccess: (d) => onDone(`Cheque ${d.cheque.refNo} recorded`),
    onError: (e: ApiError) => setError(e.message),
  });

  return (
    <Modal open onClose={onClose} title={isReceive ? "Receive a customer cheque" : "Issue a cheque to a vendor"}>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); if (!party) return setError(`Pick a ${isReceive ? "customer" : "vendor"}`); save.mutate(); }} className="space-y-3">
        <div><label className="label">{isReceive ? "Customer" : "Vendor"}</label><PartyPicker kind={isReceive ? "customer" : "vendor"} onChange={setParty} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Bank on the cheque</label><input className="input" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Meezan, HBL…" required /></div>
          <div><label className="label">Cheque number</label><input className="input mono" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} required /></div>
          <div><label className="label">Amount</label><input className="input mono" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
          <div><label className="label">Cheque date (due)</label><input className="input" type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} required /></div>
        </div>
        <div><label className="label">Note (optional)</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <p className="text-xs text-muted">{isReceive ? "The customer's udhaar reduces now; the amount sits in “Cheques in Hand” until it clears." : "The vendor payable reduces now; it sits in “Post-dated Cheques” until it clears."}</p>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Record cheque"}</button></div>
      </form>
    </Modal>
  );
}

function ClearForm({ cheque, onClose, onDone }: { cheque: Cheque; onClose: () => void; onDone: (m: string) => void }) {
  const { data } = useQuery({ queryKey: ["accounts"], queryFn: () => api<{ accounts: Account[] }>("/accounts") });
  const banks = (data?.accounts ?? []).filter((a) => a.isActive && !HOLDING_NAMES.includes(a.name));
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const def = accountId || banks.find((b) => !b.isCash)?.id || banks[0]?.id || "";
  const save = useMutation({
    mutationFn: () => api(`/cheques/${cheque.id}/clear`, { method: "POST", body: { settledAccountId: def } }),
    onSuccess: () => onDone(`Cheque ${cheque.refNo} cleared`),
    onError: (e: ApiError) => setError(e.message),
  });
  return (
    <Modal open onClose={onClose} title="Cheque cleared">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); if (!def) return setError("Add a bank account first"); save.mutate(); }} className="space-y-3">
        <p className="text-sm">{cheque.direction === "RECEIVED" ? "Which account did the money come into?" : "Which account did the money leave from?"}</p>
        <div><label className="label"><Landmark size={13} className="inline mr-1" />Account</label><select className="input" value={def} onChange={(e) => setAccountId(e.target.value)}>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div className="text-sm text-muted">{cheque.refNo} · {fmtMoney(cheque.amount)}</div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Confirm cleared"}</button></div>
      </form>
    </Modal>
  );
}
