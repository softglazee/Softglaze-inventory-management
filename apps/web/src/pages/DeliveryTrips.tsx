import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Truck, Search, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { DeliveryTrip, DeliveryTripTotals, Account, Customer, DeliveryNote } from "../lib/types";
import { num, fmtMoney } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, Badge, Pagination, useClientPagination, useToast } from "../components/ui";

const d = (s: string) => new Date(s).toLocaleDateString("en-GB");

export default function DeliveryTrips() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canManage = can("expenses.create");
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["delivery-trips"], queryFn: () => api<{ trips: DeliveryTrip[]; totals: DeliveryTripTotals }>("/delivery-trips") });
  const trips = data?.trips ?? [];
  const totals = data?.totals;
  const { page, pages, setPage, pageRows, total, perPage } = useClientPagination(trips, 12);

  const del = useMutation({
    mutationFn: (id: string) => api(`/delivery-trips/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast("Trip deleted (freight reversed if booked)"); qc.invalidateQueries({ queryKey: ["delivery-trips"] }); qc.invalidateQueries({ queryKey: ["expenses"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  return (
    <div>
      <PageHeader
        title="Delivery Trips"
        sub="Log a vehicle run — driver, vehicle, the challans it carried, freight charged to the customer and freight paid to the transporter. Freight paid can post as a real expense; freight charged is a record for the delivery margin."
        actions={canManage ? <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New trip</button> : undefined}
      />

      {totals && trips.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="card p-3"><p className="text-xs text-muted">Freight charged</p><p className="money text-lg font-semibold">{fmtMoney(totals.charged)}</p></div>
          <div className="card p-3"><p className="text-xs text-muted">Freight paid</p><p className="money text-lg font-semibold">{fmtMoney(totals.paid)}</p></div>
          <div className="card p-3"><p className="text-xs text-muted">Delivery margin</p><p className={`money text-lg font-semibold ${totals.margin >= 0 ? "text-success" : "text-danger"}`}>{fmtMoney(totals.margin)}</p></div>
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={7} />
        ) : trips.length === 0 ? (
          <EmptyState title="No delivery trips yet" hint={canManage ? "Log a vehicle run: driver, vehicle, the challans it delivered, and freight charged vs paid." : "Ask an admin to log delivery trips."} />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs"><th className="px-4 py-2.5 font-semibold">Ref</th><th className="px-4 py-2.5 font-semibold">Date</th><th className="px-4 py-2.5 font-semibold">Vehicle / driver</th><th className="px-4 py-2.5 font-semibold">For</th><th className="px-4 py-2.5 font-semibold text-right">Challans</th><th className="px-4 py-2.5 font-semibold text-right">Charged</th><th className="px-4 py-2.5 font-semibold text-right">Paid</th><th className="px-4 py-2.5 font-semibold text-right">Margin</th><th className="px-4 py-2.5 w-10" /></tr></thead>
              <tbody>
                {pageRows.map((t) => (
                  <tr key={t.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                    <td className="px-4 py-2 mono text-xs">{t.refNo}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{d(t.date)}</td>
                    <td className="px-4 py-2"><span className="inline-flex items-center gap-1.5"><Truck size={13} className="text-muted" /> {t.vehicleNo || "—"}</span>{t.driverName && <span className="block text-xs text-muted ml-5">{t.driverName}{t.driverPhone ? ` · ${t.driverPhone}` : ""}</span>}</td>
                    <td className="px-4 py-2 text-muted">{t.customer?.name ?? (t.challans[0]?.sale?.customer?.name ?? "—")}</td>
                    <td className="px-4 py-2 text-right mono">{t.challans.length}</td>
                    <td className="px-4 py-2 text-right money">{fmtMoney(t.freightCharged)}</td>
                    <td className="px-4 py-2 text-right money">{fmtMoney(t.freightPaid)}{t.expense && <span className="block text-[10px] text-accent">booked {t.expense.refNo}</span>}</td>
                    <td className={`px-4 py-2 text-right money ${num(t.margin) >= 0 ? "text-success" : "text-danger"}`}>{fmtMoney(t.margin)}</td>
                    <td className="px-4 py-2 text-right">{canManage && <button className="btn btn-secondary !p-1.5 hover:!text-danger" title="Delete trip" onClick={() => { if (confirm(`Delete ${t.refNo}?${t.expense ? " Its freight expense will be reversed." : ""}`)) del.mutate(t.id); }}><Trash2 size={13} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={pages} onPage={setPage} total={total} perPage={perPage} />
          </>
        )}
      </div>

      {creating && <TripEditor onClose={() => setCreating(false)} onDone={() => { qc.invalidateQueries({ queryKey: ["delivery-trips"] }); qc.invalidateQueries({ queryKey: ["expenses"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); setCreating(false); }} />}
    </div>
  );
}

function CustomerPicker({ value, onPick }: { value: { id: string; name: string } | null; onPick: (c: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState("");
  const { data } = useQuery({ queryKey: ["cust-pick-trip", q], queryFn: () => api<{ customers: Customer[] }>(`/customers?search=${encodeURIComponent(q)}&limit=8`), enabled: q.trim().length > 0 });
  if (value) return <div className="flex items-center justify-between gap-2 input"><span>{value.name}</span><button type="button" className="text-muted hover:text-danger text-xs" onClick={() => onPick(null)}>change</button></div>;
  return (
    <div className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input className="input !pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer (optional)" />
      {q.trim() && (data?.customers.length ?? 0) > 0 && (
        <div className="absolute z-30 mt-1 w-full card max-h-52 overflow-y-auto p-1 shadow-xl">
          {data!.customers.map((c) => <button key={c.id} type="button" className="w-full text-left px-3 py-1.5 rounded hover:bg-surface-2 text-sm" onClick={() => { onPick({ id: c.id, name: c.name }); setQ(""); }}>{c.name} <span className="mono text-muted text-xs">{c.phone}</span></button>)}
        </div>
      )}
    </div>
  );
}

function TripEditor({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [vehicleNo, setVehicleNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [freightCharged, setFreightCharged] = useState("0");
  const [freightPaid, setFreightPaid] = useState("0");
  const [paidMethodId, setPaidMethodId] = useState("");
  const [challanIds, setChallanIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: accData } = useQuery({ queryKey: ["accounts"], queryFn: () => api<{ accounts: Account[] }>("/accounts") });
  const accounts = (accData?.accounts ?? []).filter((a) => a.isActive);
  const { data: chData } = useQuery({ queryKey: ["deliveries-unassigned"], queryFn: () => api<{ deliveries: DeliveryNote[] }>("/deliveries") });
  const freeChallans = (chData?.deliveries ?? []).filter((c) => c.status === "DELIVERED" && !c.tripId);

  const margin = (Number(freightCharged) || 0) - (Number(freightPaid) || 0);
  const willBook = (Number(freightPaid) || 0) > 0 && !!paidMethodId;

  const save = useMutation({
    mutationFn: () => api<{ trip: DeliveryTrip }>("/delivery-trips", {
      method: "POST",
      body: {
        date, vehicleNo: vehicleNo || null, driverName: driverName || null, driverPhone: driverPhone || null,
        customerId: customer?.id ?? null, freightCharged: Number(freightCharged) || 0, freightPaid: Number(freightPaid) || 0,
        paidMethodId: paidMethodId || null, challanIds, notes: notes || null,
      },
    }),
    onSuccess: () => onDone(),
    onError: (e: ApiError) => setError(e.message),
  });

  return (
    <Modal open onClose={onClose} title="New delivery trip" wide>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className="label">Date</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="label">Vehicle no.</label><input className="input mono" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="LEB-1234" /></div>
          <div><label className="label">Driver</label><input className="input" value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Akram" /></div>
          <div><label className="label">Driver phone</label><input className="input mono" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} /></div>
        </div>
        <div><label className="label">Customer (optional)</label><CustomerPicker value={customer} onPick={setCustomer} /></div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Freight charged (recovered)</label><input className="input mono" type="number" step="0.01" min="0" value={freightCharged} onChange={(e) => setFreightCharged(e.target.value)} /></div>
          <div><label className="label">Freight paid (to transporter)</label><input className="input mono" type="number" step="0.01" min="0" value={freightPaid} onChange={(e) => setFreightPaid(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <label className="label">Book freight paid from</label>
            <select className="input" value={paidMethodId} onChange={(e) => setPaidMethodId(e.target.value)}>
              <option value="">Just record (no expense)</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="text-sm pb-1">
            <span className="text-muted">Margin: </span><span className={`money font-semibold ${margin >= 0 ? "text-success" : "text-danger"}`}>{fmtMoney(margin)}</span>
            {willBook && <span className="block text-xs text-accent">Freight paid posts as an expense (money out + profit hit).</span>}
          </div>
        </div>

        {freeChallans.length > 0 && (
          <details className="rounded-lg border border-edge px-3 py-2">
            <summary className="text-sm text-muted cursor-pointer">Attach challans ({challanIds.length} selected)</summary>
            <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
              {freeChallans.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm px-1 py-0.5">
                  <input type="checkbox" checked={challanIds.includes(c.id)} onChange={(e) => setChallanIds(e.target.checked ? [...challanIds, c.id] : challanIds.filter((x) => x !== c.id))} />
                  <span className="mono text-xs">{c.refNo}</span>
                  <span className="text-muted text-xs">{c.sale?.invoiceNo} · {c.sale?.customer?.name ?? "Walk-in"} · {d(c.date)}</span>
                </label>
              ))}
            </div>
          </details>
        )}

        <div><label className="label">Notes (optional)</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save trip"}</button></div>
      </form>
    </Modal>
  );
}
