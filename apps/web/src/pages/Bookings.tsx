import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus, Trash2, PackageCheck, Ban, Printer, Lock } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Booking, BookingSummary, Account, Customer, Product, Paged } from "../lib/types";
import { num, fmtMoney, fmtQty } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, Badge, Pagination, useClientPagination, useToast } from "../components/ui";

const statusTone: Record<string, "warn" | "success" | "danger" | "muted"> = { OPEN: "warn", PARTIAL: "warn", COMPLETED: "success", CANCELLED: "muted" };

export default function Bookings() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Booking | null>(null);

  const qs = new URLSearchParams({ ...(status && { status }) }).toString();
  const { data, isLoading } = useQuery({ queryKey: ["bookings", qs], queryFn: () => api<{ bookings: Booking[] }>(`/bookings?${qs}`) });
  const { data: sum } = useQuery({ queryKey: ["booking-summary"], queryFn: () => api<BookingSummary>("/bookings/summary") });
  const bookings = data?.bookings ?? [];
  const { page, pages, setPage, pageRows, total, perPage } = useClientPagination(bookings, 12);

  const refresh = () => {
    ["bookings", "booking-summary", "accounts", "customers", "sales", "dashboard", "products"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  return (
    <div>
      <PageHeader
        title="Bookings"
        sub="Advance bookings with a locked rate — the customer's price is fixed today; the advance is held (not profit) until you deliver."
        actions={can("sales.create") ? <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New booking</button> : undefined}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <div className="card p-4"><p className="text-muted text-sm">Open bookings</p><p className="text-xl font-bold mt-1">{sum?.openCount ?? 0}</p></div>
        <div className="card p-4"><p className="text-muted text-sm">Advances held (liability)</p><p className="money text-xl font-bold mt-1 text-accent">{fmtMoney(sum?.advancesHeld ?? 0)}</p></div>
        <div className="card p-4"><p className="text-muted text-sm">Value still to deliver</p><p className="money text-xl font-bold mt-1">{fmtMoney(sum?.outstandingValue ?? 0)}</p></div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <select className="input !w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All bookings</option>
          <option value="OPEN">Open</option>
          <option value="PARTIAL">Partly delivered</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? <TableSkeleton cols={6} /> : bookings.length === 0 ? (
          <EmptyState title="No bookings here" hint="Create a booking to lock a customer's price and take an advance." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs">
                <th className="px-4 py-2.5 font-semibold">Date</th><th className="px-4 py-2.5 font-semibold">Booking</th><th className="px-4 py-2.5 font-semibold">Customer</th>
                <th className="px-4 py-2.5 font-semibold text-right">Booked value</th><th className="px-4 py-2.5 font-semibold text-right">Advance held</th>
                <th className="px-4 py-2.5 font-semibold text-right">To deliver</th><th className="px-4 py-2.5 font-semibold">Status</th><th className="px-4 py-2.5 w-16" />
              </tr></thead>
              <tbody>
                {pageRows.map((b) => (
                  <tr key={b.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50 cursor-pointer" onClick={() => setViewing(b)}>
                    <td className="px-4 py-2 whitespace-nowrap">{new Date(b.date).toLocaleDateString("en-GB")}</td>
                    <td className="px-4 py-2 mono text-xs">{b.refNo}</td>
                    <td className="px-4 py-2">{b.customer?.name ?? "—"}</td>
                    <td className="px-4 py-2 text-right money">{fmtMoney(b.bookedValue)}</td>
                    <td className="px-4 py-2 text-right money text-accent">{fmtMoney(b.advanceRemaining)}</td>
                    <td className="px-4 py-2 text-right money">{fmtMoney(b.outstanding)}</td>
                    <td className="px-4 py-2"><Badge tone={statusTone[b.status]}>{b.status.toLowerCase()}</Badge></td>
                    <td className="px-4 py-2 text-right text-muted text-xs">View</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={pages} onPage={setPage} total={total} perPage={perPage} />
          </>
        )}
      </div>

      {creating && <BookingForm onClose={() => setCreating(false)} onDone={() => { refresh(); setCreating(false); }} />}
      {viewing && <ViewBooking id={viewing.id} onClose={() => setViewing(null)} onChanged={refresh} />}
    </div>
  );
}

/* ─────────── Customer picker (search) ─────────── */
function CustomerPicker({ onChange }: { onChange: (p: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const { data } = useQuery({
    queryKey: ["cust-pick-bkg", q],
    queryFn: () => api<Paged<"customers", Customer>>(`/customers?limit=8&status=active${q ? `&search=${encodeURIComponent(q)}` : ""}`),
    enabled: open,
  });
  const list = data?.customers ?? [];
  return (
    <div className="relative">
      <input className="input" value={picked ? picked.name : q} onChange={(e) => { setPicked(null); onChange(null); setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search customer…" />
      {open && !picked && list.length > 0 && (
        <div className="absolute z-10 mt-1 w-full card max-h-56 overflow-y-auto p-1 shadow-xl">
          {list.map((c) => (
            <button key={c.id} type="button" className="w-full text-left px-3 py-1.5 rounded hover:bg-surface-2 text-sm flex justify-between" onClick={() => { const v = { id: c.id, name: c.name }; setPicked(v); onChange(v); setOpen(false); }}>
              <span>{c.name} <span className="mono text-muted text-xs">{c.code}</span></span>
              <span className="money text-muted text-xs">{fmtMoney(c.balance)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── Product picker (search, adds a booking line) ─────────── */
function ProductPicker({ onPick }: { onPick: (p: Product) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["prod-pick-bkg", q],
    queryFn: () => api<Paged<"products", Product>>(`/products?limit=8${q ? `&search=${encodeURIComponent(q)}` : ""}`),
    enabled: open,
  });
  const list = (data?.products ?? []).filter((p) => p.isActive);
  return (
    <div className="relative">
      <input className="input" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search a product to add…" />
      {open && list.length > 0 && (
        <div className="absolute z-20 mt-1 w-full card max-h-56 overflow-y-auto p-1 shadow-xl">
          {list.map((p) => (
            <button key={p.id} type="button" className="w-full text-left px-3 py-1.5 rounded hover:bg-surface-2 text-sm flex justify-between" onClick={() => { onPick(p); setQ(""); setOpen(false); }}>
              <span>{p.name} <span className="mono text-muted text-xs">{p.sku}</span></span>
              <span className="money text-muted text-xs">{fmtMoney(p.salePrice)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type DraftLine = { productId: string; name: string; sku: string; unit: string; qty: string; unitPrice: string };

function BookingForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [validUntil, setValidUntil] = useState("");
  const [advance, setAdvance] = useState("");
  const [advanceMethodId, setAdvanceMethodId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: acc } = useQuery({ queryKey: ["accounts"], queryFn: () => api<{ accounts: Account[] }>("/accounts") });
  const accounts = (acc?.accounts ?? []).filter((a) => a.isActive);
  const methodId = advanceMethodId || accounts.find((a) => a.isCash)?.id || accounts[0]?.id || "";

  const addProduct = (p: Product) => {
    if (lines.some((l) => l.productId === p.id)) return;
    setLines([...lines, { productId: p.id, name: p.name, sku: p.sku, unit: p.unit?.shortName ?? "", qty: "1", unitPrice: String(num(p.salePrice)) }]);
  };
  const setLine = (i: number, patch: Partial<DraftLine>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));

  const bookedValue = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);

  const save = useMutation({
    mutationFn: () => {
      const adv = Number(advance) || 0;
      return api<{ booking: { refNo: string } }>("/bookings", {
        method: "POST",
        body: {
          customerId: customer!.id,
          validUntil: validUntil || null,
          items: lines.map((l) => ({ productId: l.productId, qty: Number(l.qty), unitPrice: Number(l.unitPrice) })),
          advance: adv,
          advanceMethodId: adv > 0 ? methodId : null,
          notes: notes || null,
        },
      });
    },
    onSuccess: (d) => { toast(`Booking ${d.booking.refNo} created`); onDone(); },
    onError: (e: ApiError) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!customer) return setError("Pick a customer");
    if (!lines.length) return setError("Add at least one item");
    if (lines.some((l) => !(Number(l.qty) > 0))) return setError("Every line needs a quantity");
    if ((Number(advance) || 0) > bookedValue + 0.01) return setError("Advance cannot be more than the booking value");
    if ((Number(advance) || 0) > 0 && !methodId) return setError("Add a cash/bank account for the advance");
    save.mutate();
  }

  return (
    <Modal open onClose={onClose} title="New advance booking" wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="label">Customer</label><CustomerPicker onChange={setCustomer} /></div>
          <div><label className="label">Rate valid until <span className="text-muted">(optional)</span></label><input className="input" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
        </div>

        <div>
          <label className="label flex items-center gap-1"><Lock size={12} /> Items at today's locked price</label>
          <ProductPicker onPick={addProduct} />
          {lines.length > 0 && (
            <div className="card overflow-hidden mt-2">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted border-b border-edge text-xs">
                  <th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 font-medium text-right w-24">Qty</th>
                  <th className="px-3 py-2 font-medium text-right w-32">Locked price</th><th className="px-3 py-2 font-medium text-right w-28">Line total</th><th className="w-8" />
                </tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.productId} className="border-b border-edge last:border-0">
                      <td className="px-3 py-1.5">{l.name} <span className="mono text-muted text-xs">{l.sku}</span></td>
                      <td className="px-3 py-1.5"><input className="input mono !py-1 text-right" type="number" step="any" min="0" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                      <td className="px-3 py-1.5"><input className="input mono !py-1 text-right" type="number" step="0.01" min="0" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} /></td>
                      <td className="px-3 py-1.5 text-right money">{fmtMoney((Number(l.qty) || 0) * (Number(l.unitPrice) || 0))}</td>
                      <td className="px-3 py-1.5 text-right"><button type="button" className="text-muted hover:text-danger" onClick={() => removeLine(i)} aria-label="Remove"><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div><label className="label">Advance received <span className="text-muted">(optional)</span></label><input className="input mono" type="number" step="0.01" min="0" value={advance} onChange={(e) => setAdvance(e.target.value)} placeholder="0" /></div>
          <div><label className="label">Into account</label><select className="input" value={methodId} onChange={(e) => setAdvanceMethodId(e.target.value)} disabled={!(Number(advance) > 0)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div className="text-right"><p className="text-muted text-xs">Booking value</p><p className="money text-lg font-bold">{fmtMoney(bookedValue)}</p></div>
        </div>

        <div><label className="label">Note <span className="text-muted">(optional)</span></label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <p className="text-xs text-muted">The advance is held as the customer's credit (a liability) — it becomes sales only when you deliver, and each delivery is invoiced at the locked price.</p>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Create booking"}</button></div>
      </form>
    </Modal>
  );
}

function ViewBooking({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ["booking", id], queryFn: () => api<{ booking: Booking }>(`/bookings/${id}`) });
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: () => api<{ settings: Record<string, string> }>("/settings") });
  const b = data?.booking;
  const [fulfilling, setFulfilling] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const canAct = can("sales.create");
  const live = b && (b.status === "OPEN" || b.status === "PARTIAL");

  return (
    <Modal open onClose={onClose} title={b ? `Booking ${b.refNo}` : "Booking"} wide>
      {isLoading || !b ? <p className="text-muted text-sm">Loading…</p> : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
            <div><span className="text-muted">Customer:</span> {b.customer?.name}</div>
            <div><span className="text-muted">Date:</span> {new Date(b.date).toLocaleDateString("en-GB")}</div>
            {b.validUntil && <div><span className="text-muted">Rate valid till:</span> {new Date(b.validUntil).toLocaleDateString("en-GB")}</div>}
            <div><span className="text-muted">Status:</span> <Badge tone={statusTone[b.status]}>{b.status.toLowerCase()}</Badge></div>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted border-b border-edge text-xs">
                <th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 font-medium text-right">Booked</th>
                <th className="px-3 py-2 font-medium text-right">Delivered</th><th className="px-3 py-2 font-medium text-right">Remaining</th><th className="px-3 py-2 font-medium text-right">Locked price</th>
              </tr></thead>
              <tbody>
                {b.items.map((it) => {
                  const remaining = num(it.qty) - num(it.qtyFulfilled);
                  return (
                    <tr key={it.id} className="border-b border-edge last:border-0">
                      <td className="px-3 py-1.5">{it.product?.name} <span className="mono text-muted text-xs">{it.product?.sku}</span></td>
                      <td className="px-3 py-1.5 text-right mono">{fmtQty(it.qty)} {it.product?.unit?.shortName}</td>
                      <td className="px-3 py-1.5 text-right mono text-muted">{fmtQty(it.qtyFulfilled)}</td>
                      <td className={`px-3 py-1.5 text-right mono ${remaining > 0.001 ? "text-accent" : "text-success"}`}>{fmtQty(remaining)}</td>
                      <td className="px-3 py-1.5 text-right money">{fmtMoney(it.unitPrice)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <div><span className="text-muted">Booking value</span><div className="money font-semibold">{fmtMoney(b.bookedValue)}</div></div>
            <div><span className="text-muted">Advance taken</span><div className="money">{fmtMoney(b.advanceReceived)}</div></div>
            <div><span className="text-muted">Advance still held</span><div className="money text-accent">{fmtMoney(b.advanceRemaining)}</div></div>
            <div><span className="text-muted">Still to deliver</span><div className="money">{fmtMoney(b.outstanding)}</div></div>
          </div>

          {(b.sales?.length ?? 0) > 0 && (
            <div>
              <p className="text-sm font-medium mb-1">Invoices from this booking</p>
              <div className="card divide-y divide-edge">
                {b.sales!.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="mono">{s.invoiceNo}</span>
                    <span className="text-muted">{new Date(s.date).toLocaleDateString("en-GB")}</span>
                    <span className="money">{fmtMoney(s.grandTotal)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => printBooking(b, settingsData?.settings ?? {})}><Printer size={15} /> Print slip</button>
            {live && canAct && <button className="btn btn-secondary text-muted" onClick={() => setCancelling(true)}><Ban size={15} /> Cancel booking</button>}
            {live && canAct && <button className="btn btn-primary" onClick={() => setFulfilling(true)}><PackageCheck size={15} /> Deliver / Invoice</button>}
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      )}
      {b && fulfilling && <FulfillForm booking={b} onClose={() => setFulfilling(false)} onDone={() => { setFulfilling(false); onChanged(); }} />}
      {b && cancelling && <CancelForm booking={b} onClose={() => setCancelling(false)} onDone={() => { setCancelling(false); onChanged(); onClose(); }} />}
    </Modal>
  );
}

function FulfillForm({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [payAmount, setPayAmount] = useState("");
  const [payMethodId, setPayMethodId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: acc } = useQuery({ queryKey: ["accounts"], queryFn: () => api<{ accounts: Account[] }>("/accounts") });
  const accounts = (acc?.accounts ?? []).filter((a) => a.isActive);
  const methodId = payMethodId || accounts.find((a) => a.isCash)?.id || accounts[0]?.id || "";

  const remainingOf = (bi: Booking["items"][number]) => num(bi.qty) - num(bi.qtyFulfilled);
  const deliverValue = booking.items.reduce((s, it) => s + (Number(qty[it.id]) || 0) * num(it.unitPrice), 0);

  const save = useMutation({
    mutationFn: () => {
      const items = booking.items.map((it) => ({ bookingItemId: it.id, qty: Number(qty[it.id]) || 0 })).filter((i) => i.qty > 0);
      if (!items.length) throw new Error("Enter a quantity to deliver");
      const amt = Number(payAmount) || 0;
      return api<{ sale: { invoiceNo: string } }>(`/bookings/${booking.id}/fulfill`, {
        method: "POST",
        body: { items, payments: amt > 0 ? [{ methodId, amount: amt }] : [] },
      });
    },
    onSuccess: (d) => { toast(`Invoice ${d.sale.invoiceNo} created`); qc.invalidateQueries({ queryKey: ["booking", booking.id] }); onDone(); },
    onError: (e: ApiError) => setError(e.message),
  });

  const anyRemaining = booking.items.some((it) => remainingOf(it) > 0.001);

  return (
    <Modal open onClose={onClose} title={`Deliver — ${booking.refNo}`} wide>
      <div className="space-y-4">
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted border-b border-edge text-xs">
              <th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 font-medium text-right">Remaining</th>
              <th className="px-3 py-2 font-medium text-right">Locked price</th><th className="px-3 py-2 font-medium text-right w-28">Deliver now</th>
            </tr></thead>
            <tbody>
              {booking.items.map((it) => {
                const rem = remainingOf(it);
                return (
                  <tr key={it.id} className="border-b border-edge last:border-0">
                    <td className="px-3 py-1.5">{it.product?.name} <span className="mono text-muted text-xs">{it.product?.sku}</span></td>
                    <td className={`px-3 py-1.5 text-right mono ${rem > 0.001 ? "text-accent" : "text-success"}`}>{fmtQty(rem)} {it.product?.unit?.shortName}</td>
                    <td className="px-3 py-1.5 text-right money">{fmtMoney(it.unitPrice)}</td>
                    <td className="px-3 py-1.5">{rem > 0.001 ? <input className="input mono !py-1 text-right" type="number" step="any" min="0" max={rem} value={qty[it.id] ?? ""} onChange={(e) => setQty({ ...qty, [it.id]: e.target.value })} placeholder={String(rem)} /> : <span className="text-success text-xs">done</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div className="sm:col-span-2 text-sm">
            <p className="text-muted text-xs">Invoice total at locked price</p>
            <p className="money text-lg font-bold">{fmtMoney(deliverValue)}</p>
            <p className="text-xs text-muted mt-1">Advance still held: <span className="money text-accent">{fmtMoney(booking.advanceRemaining)}</span> — it covers this invoice; only the extra becomes udhaar.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
          <div><label className="label">Extra cash paid now <span className="text-muted">(optional)</span></label><input className="input mono" type="number" step="0.01" min="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0" /></div>
          <div><label className="label">Into account</label><select className="input" value={methodId} onChange={(e) => setPayMethodId(e.target.value)} disabled={!(Number(payAmount) > 0)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!anyRemaining || save.isPending} onClick={() => { setError(null); save.mutate(); }}><PackageCheck size={15} /> {save.isPending ? "Saving…" : "Create invoice"}</button>
        </div>
      </div>
    </Modal>
  );
}

function CancelForm({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [refund, setRefund] = useState(false);
  const [refundMethodId, setRefundMethodId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data: acc } = useQuery({ queryKey: ["accounts"], queryFn: () => api<{ accounts: Account[] }>("/accounts") });
  const accounts = (acc?.accounts ?? []).filter((a) => a.isActive);
  const methodId = refundMethodId || accounts.find((a) => a.isCash)?.id || accounts[0]?.id || "";
  const canRefund = booking.advanceRemaining > 0.001;

  const save = useMutation({
    mutationFn: () => api(`/bookings/${booking.id}/cancel`, { method: "POST", body: { refundMethodId: refund && canRefund ? methodId : null } }),
    onSuccess: () => { toast("Booking cancelled"); onDone(); },
    onError: (e: ApiError) => setError(e.message),
  });

  return (
    <Modal open onClose={onClose} title={`Cancel booking ${booking.refNo}?`}>
      <div className="space-y-3">
        <p className="text-sm">Any invoices already delivered stay as they are. Only the undelivered part is cancelled.</p>
        {canRefund ? (
          <div className="space-y-2">
            <p className="text-sm">Advance still held: <span className="money text-accent font-semibold">{fmtMoney(booking.advanceRemaining)}</span></p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} /> Refund it to the customer now</label>
            {refund && <div><label className="label">Refund from account</label><select className="input" value={methodId} onChange={(e) => setRefundMethodId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}
            {!refund && <p className="text-xs text-muted">If you don't refund, it stays as the customer's credit for future purchases.</p>}
          </div>
        ) : <p className="text-xs text-muted">No advance is held on this booking.</p>}
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Keep booking</button>
          <button className="btn btn-danger" disabled={save.isPending} onClick={() => { setError(null); save.mutate(); }}>{save.isPending ? "Cancelling…" : "Cancel booking"}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Print a rate-lock confirmation slip (A4) the customer can keep. */
function printBooking(b: Booking, shop: Record<string, string>) {
  const rows = b.items
    .map((it) => `<tr><td>${it.product?.name ?? ""} <small>${it.product?.sku ?? ""}</small></td><td class=r>${Number(it.qty)} ${it.product?.unit?.shortName ?? ""}</td><td class=r>${Number(it.unitPrice).toLocaleString("en-PK")}</td><td class=r>${(Number(it.qty) * Number(it.unitPrice)).toLocaleString("en-PK")}</td></tr>`)
    .join("");
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>${b.refNo}</title><style>
    *{font-family:Arial,sans-serif;color:#111} body{padding:28px;font-size:13px}
    h1{font-size:18px;margin:0} .muted{color:#666;font-size:12px}
    table{width:100%;border-collapse:collapse;margin-top:14px} th,td{border:1px solid #bbb;padding:7px;text-align:left} th{background:#f2f2f2}
    .r{text-align:right} .row{display:flex;justify-content:space-between;margin-top:6px}
    .tot{margin-top:10px;font-size:13px} .tot b{font-size:15px}
    .sign{margin-top:48px;display:flex;justify-content:space-between} .sign div{border-top:1px solid #999;padding-top:4px;width:44%;text-align:center;font-size:12px}
  </style></head><body>
    <h1>${shop.shop_name || "SoftGlaze"}</h1>
    <div class="muted">${[shop.shop_address, shop.shop_city].filter(Boolean).join(", ")}${shop.shop_phone ? " · " + shop.shop_phone : ""}</div>
    <h2 style="margin:14px 0 0">Advance Booking — ${b.refNo}</h2>
    <div class="row"><span>Customer: <b>${b.customer?.name ?? ""}</b></span><span>Date: ${new Date(b.date).toLocaleDateString("en-GB")}</span></div>
    ${b.validUntil ? `<div class="row"><span>Prices locked until: <b>${new Date(b.validUntil).toLocaleDateString("en-GB")}</b></span><span></span></div>` : ""}
    <table><thead><tr><th>Item (price locked)</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="tot row"><span>Booking value</span><b>Rs ${Number(b.bookedValue).toLocaleString("en-PK")}</b></div>
    <div class="tot row"><span>Advance received</span><span>Rs ${Number(b.advanceReceived).toLocaleString("en-PK")}</span></div>
    <div class="tot row"><span>Balance on delivery</span><b>Rs ${(Number(b.bookedValue) - Number(b.advanceReceived)).toLocaleString("en-PK")}</b></div>
    <p class="muted" style="margin-top:10px">Prices above are locked. Goods delivered against this booking are billed at these rates regardless of market changes.</p>
    <div class="sign"><div>Customer signature</div><div>For ${shop.shop_name || "SoftGlaze"}</div></div>
    <script>window.onload=function(){window.print()}</script>
  </body></html>`);
  w.document.close();
}
