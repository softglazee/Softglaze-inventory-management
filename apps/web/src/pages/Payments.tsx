import { useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { HandCoins, Banknote, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Payment, PaymentType, Account, Customer, Vendor, Paged, SiteBalancesView } from "../lib/types";
import { fmtMoney, num } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, SearchBox, Badge, Pagination, FormSection, useToast } from "../components/ui";

const TYPE_META: Record<PaymentType, { label: string; in: boolean }> = {
  SALE_RECEIPT: { label: "Sale receipt", in: true },
  CUSTOMER_RECEIPT: { label: "Customer receipt", in: true },
  REFUND_IN: { label: "Refund in", in: true },
  PURCHASE_PAYMENT: { label: "Purchase payment", in: false },
  VENDOR_PAYMENT: { label: "Vendor payment", in: false },
  EXPENSE: { label: "Expense", in: false },
  REFUND_OUT: { label: "Refund out", in: false },
};

/** Searchable customer/vendor picker */
function PartyPicker({ kind, value, onChange }: { kind: "customer" | "vendor"; value: { id: string; name: string } | null; onChange: (p: { id: string; name: string; balance: string } | null) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: [kind + "-pick", q],
    queryFn: () => api<Paged<"customers", Customer> & Paged<"vendors", Vendor>>(`/${kind}s?limit=8&status=active${q ? `&search=${encodeURIComponent(q)}` : ""}`),
    enabled: open,
  });
  const list = (kind === "customer" ? data?.customers : data?.vendors) ?? [];
  return (
    <div className="relative">
      <input
        className="input"
        value={value ? value.name : q}
        onChange={(e) => { onChange(null); setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={`Search ${kind}…`}
      />
      {open && !value && list.length > 0 && (
        <div className="absolute z-10 mt-1 w-full card max-h-56 overflow-y-auto p-1 shadow-xl">
          {list.map((p) => (
            <button key={p.id} type="button" className="w-full text-left px-3 py-1.5 rounded hover:bg-surface-2 text-sm flex justify-between" onClick={() => { onChange({ id: p.id, name: p.name, balance: p.balance }); setOpen(false); }}>
              <span>{p.name} <span className="mono text-muted text-xs">{p.code}</span></span>
              <span className="money text-muted text-xs">{fmtMoney(p.balance)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Payments() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<false | "receive" | "pay">(false);

  const params = new URLSearchParams({ page: String(page), limit: "20", ...(search.trim() && { search: search.trim() }), ...(type && { type }) });
  const { data, isLoading } = useQuery({ queryKey: ["payments", page, search, type], queryFn: () => api<Paged<"payments", Payment>>(`/payments?${params}`), placeholderData: keepPreviousData });
  const payments = data?.payments ?? [];

  return (
    <div>
      <PageHeader
        title="Payments"
        sub="Money received from customers and paid to vendors."
        actions={
          <>
            {can("payments.receive") && <button className="btn btn-secondary" onClick={() => setModal("receive")}><ArrowDownLeft size={16} /> Receive from customer</button>}
            {can("payments.pay_vendor") && <button className="btn btn-secondary" onClick={() => setModal("pay")}><ArrowUpRight size={16} /> Pay vendor</button>}
          </>
        }
      />

      <div className="flex flex-wrap gap-2 mb-3">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search ref no…" />
        <select className="input !w-52" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Filter type">
          <option value="">All types</option>
          {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={6} />
        ) : payments.length === 0 ? (
          <EmptyState title={search ? "No payments match" : "No payments yet"} hint={search ? "Try a different search." : "Receive a customer payment or pay a vendor to get started."} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs"><th className="px-4 py-2.5 font-semibold">Ref</th><th className="px-4 py-2.5 font-semibold">Date</th><th className="px-4 py-2.5 font-semibold">Type</th><th className="px-4 py-2.5 font-semibold">Party</th><th className="px-4 py-2.5 font-semibold">Account</th><th className="px-4 py-2.5 font-semibold text-right">Amount</th></tr></thead>
                <tbody>
                  {payments.map((p) => {
                    const meta = TYPE_META[p.type];
                    return (
                      <tr key={p.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                        <td className="px-4 py-2 mono text-xs">{p.refNo}</td>
                        <td className="px-4 py-2 text-muted whitespace-nowrap">{new Date(p.date).toLocaleDateString()}</td>
                        <td className="px-4 py-2"><Badge tone={meta.in ? "success" : "muted"}>{meta.label}</Badge></td>
                        <td className="px-4 py-2">{p.customer?.name ?? p.vendor?.name ?? <span className="text-muted">—</span>}</td>
                        <td className="px-4 py-2 text-muted">{p.method?.name ?? "—"}</td>
                        <td className={`px-4 py-2 text-right money ${meta.in ? "text-success" : "text-danger"}`}>{meta.in ? "+" : "−"} {fmtMoney(p.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} total={data?.total} perPage={20} />
          </>
        )}
      </div>

      {modal && (
        <PaymentModal
          mode={modal}
          onClose={() => setModal(false)}
          onDone={(m) => { toast(m); qc.invalidateQueries({ queryKey: ["payments"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: [modal === "receive" ? "customers" : "vendors"] }); setModal(false); }}
        />
      )}
    </div>
  );
}

export function PaymentModal({ mode, fixedParty, onClose, onDone }: { mode: "receive" | "pay"; fixedParty?: { id: string; name: string; balance: string }; onClose: () => void; onDone: (m: string) => void }) {
  const isReceive = mode === "receive";
  const kind = isReceive ? "customer" : "vendor";
  const { data: accData } = useQuery({ queryKey: ["accounts"], queryFn: () => api<{ accounts: Account[] }>("/accounts") });
  const accounts = (accData?.accounts ?? []).filter((a) => a.isActive);
  const [party, setParty] = useState<{ id: string; name: string; balance: string } | null>(fixedParty ?? null);
  const [methodId, setMethodId] = useState("");
  const [amount, setAmount] = useState("");
  const [billId, setBillId] = useState("");
  const [siteId, setSiteId] = useState(""); // C4 — allocate a receipt to a customer site
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const methodDefault = methodId || accounts.find((a) => a.isCash)?.id || accounts[0]?.id || "";

  type OpenBill = { id: string; invoiceNo: string; date: string; grandTotal: string; dueAmount: string };
  const { data: billsData } = useQuery({
    queryKey: [kind + "-bills", party?.id],
    queryFn: () => api<{ bills: OpenBill[] }>(`/payments/${kind}-bills/${party!.id}`),
    enabled: !!party,
  });
  const bills = billsData?.bills ?? [];
  // C4 — the customer's sites (receive mode only), so a receipt can be allocated to one.
  const { data: siteData } = useQuery({
    queryKey: ["customer-sites", party?.id],
    queryFn: () => api<SiteBalancesView>(`/customer-sites?customerId=${party!.id}`),
    enabled: isReceive && !!party,
  });
  const sites = (siteData?.sites ?? []).filter((s) => s.isActive);

  const save = useMutation({
    mutationFn: () => {
      const alloc = billId ? (isReceive ? { saleId: billId } : { purchaseId: billId }) : {};
      const body = isReceive
        ? { customerId: party!.id, methodId: methodDefault, amount: Number(amount), notes: notes || null, ...(siteId && !billId ? { siteId } : {}), ...alloc }
        : { vendorId: party!.id, methodId: methodDefault, amount: Number(amount), notes: notes || null, ...alloc };
      return api<{ payment: { refNo: string } }>(`/payments/${isReceive ? "customer-receipt" : "vendor-payment"}`, { method: "POST", body });
    },
    onSuccess: (d) => onDone(`${isReceive ? "Receipt" : "Payment"} ${d.payment.refNo} saved`),
    onError: (e: ApiError) => setError(e.message),
  });

  return (
    <Modal open onClose={onClose} title={isReceive ? "Receive customer payment" : "Pay a vendor"}>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); if (!party) { setError(`Pick a ${kind}`); return; } save.mutate(); }} className="space-y-4">
        <FormSection title="Payment details" icon={isReceive ? HandCoins : Banknote} color="var(--success)">
          <div className="space-y-4">
        <div>
          <label className="label">{isReceive ? "Customer" : "Vendor"}</label>
          {fixedParty ? <input className="input" value={fixedParty.name} disabled /> : <PartyPicker kind={kind} value={party} onChange={(p) => { setParty(p); setBillId(""); }} />}
          {party && <p className="text-xs text-muted mt-1">Current balance: <span className="money">{fmtMoney(party.balance)}</span> {isReceive ? "(owes you)" : "(you owe)"}</p>}
        </div>
        {party && bills.length > 0 && (
          <div>
            <label className="label">Apply to {isReceive ? "invoice" : "bill"} (optional)</label>
            <select className="input" value={billId} onChange={(e) => { setBillId(e.target.value); const b = bills.find((x) => x.id === e.target.value); if (b) setAmount(String(num(b.dueAmount))); }}>
              <option value="">Whole balance (oldest first)</option>
              {bills.map((b) => <option key={b.id} value={b.id}>{b.invoiceNo} — due {fmtMoney(b.dueAmount)} · {new Date(b.date).toLocaleDateString()}</option>)}
            </select>
          </div>
        )}
        {isReceive && sites.length > 0 && !billId && (
          <div>
            <label className="label">Allocate to site (optional)</label>
            <select className="input" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">No specific site</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name} — owes {fmtMoney(s.balance)}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Amount</label><input className="input mono" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus /></div>
          <div><label className="label">{isReceive ? "Received into" : "Paid from"}</label><select className="input" value={methodDefault} onChange={(e) => setMethodId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        </div>
        {party && Number(amount) > 0 && (
          <p className="text-xs text-muted">New balance after this: <span className="money">{fmtMoney(Number(party.balance) - Number(amount))}</span></p>
        )}
        <div><label className="label">Note (optional)</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Cash against old udhaar" /></div>
          </div>
        </FormSection>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-money" disabled={save.isPending}>{save.isPending ? "Saving…" : isReceive ? <><HandCoins size={15} /> Receive</> : <><Banknote size={15} /> Pay</>}</button></div>
      </form>
    </Modal>
  );
}
