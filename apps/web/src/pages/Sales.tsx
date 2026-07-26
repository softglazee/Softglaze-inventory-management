import { useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Eye, Undo2, Printer, Truck, User, FileText, CreditCard, Package, ShoppingBag, TrendingUp, Wallet, ArrowDownLeft, Banknote, Receipt, BarChart3 } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { api, ApiError } from "../lib/api";
import { Sale, Paged, DashboardData } from "../lib/types";
import { num, fmtMoney, fmtQty } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, SearchBox, Badge, Pagination, useToast } from "../components/ui";
import { printReceipt } from "../lib/receipt";
import DispatchModal from "../components/DispatchModal";

const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(1)}cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(v);
};

/** Colored KPI card. */
function SaleStat({ label, value, sub, icon: Icon, grad, loading }: { label: string; value: string; sub: string; icon: typeof TrendingUp; grad: string; loading?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-[10px] p-4 text-white card-hover" style={{ background: grad }}>
      <div className="absolute -bottom-8 -right-6 w-24 h-24 rounded-full bg-white/10 pointer-events-none" />
      <div className="relative flex items-center gap-3">
        <div className="w-11 h-11 shrink-0 rounded-lg bg-white/25 grid place-items-center"><Icon size={20} /></div>
        <div className="min-w-0">
          <p className="text-white/85 text-[12px] font-semibold truncate">{label}</p>
          <p className="money text-[19px] font-extrabold leading-tight mt-0.5">{loading ? <span className="inline-block h-5 w-16 rounded bg-white/25 animate-pulse" /> : value}</p>
          <p className="text-white/70 text-[11px] mt-0.5 truncate">{sub}</p>
        </div>
      </div>
    </div>
  );
}

function TrendTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card px-3 py-2 !shadow-[var(--shadow-md)] text-xs">
      <p className="text-muted mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} /><span className="capitalize">{p.name}:</span><span className="mono font-semibold">{fmtMoney(p.value)}</span></p>
      ))}
    </div>
  );
}

function statusBadge(s: Sale) {
  if (s.isReturn) return <Badge tone="warn">Return</Badge>;
  if (s.status === "COMPLETED") return <Badge tone="success">Completed</Badge>;
  if (s.status === "RETURNED") return <Badge tone="warn">Returned</Badge>;
  return <Badge tone="muted">{s.status}</Badge>;
}

/** Paid / Partial / Unpaid pill derived from paid vs due (client-side; no ledger change). */
function paymentBadge(s: Sale) {
  if (s.isReturn) return <Badge tone="muted">—</Badge>;
  const due = num(s.dueAmount);
  if (due <= 0) return <Badge tone="success">Paid</Badge>;
  if (num(s.paidAmount) > 0) return <Badge tone="warn">Partial</Badge>;
  return <Badge tone="danger">Unpaid</Badge>;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

/** Customer cell with an initials avatar (walk-in gets a muted icon). */
function CustomerCell({ s }: { s: Sale }) {
  const name = s.customer?.name;
  return (
    <span className="inline-flex items-center gap-2.5 min-w-0">
      <span
        className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold shrink-0 border border-edge"
        style={name ? { background: "var(--accent-soft)", color: "var(--accent-hover)" } : { background: "var(--surface-2)" }}
      >
        {name ? initials(name) : <User size={13} className="text-muted" />}
      </span>
      <span className="min-w-0">
        {name ? <span className="font-medium block truncate">{name}</span> : <span className="text-muted">Walk-in</span>}
        {s.customer?.phone && <span className="block mono text-[11px] text-faint">{s.customer.phone}</span>}
      </span>
    </span>
  );
}

export default function Sales() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<Sale | null>(null);
  const canProfit = can("reports.profit");

  const params = new URLSearchParams({ page: String(page), limit: "20", ...(search.trim() && { search: search.trim() }), ...(status && { status }) });
  const { data, isLoading } = useQuery({
    queryKey: ["sales", page, search, status],
    queryFn: () => api<Paged<"sales", Sale> & { totalSales: string; totalDue: string; totalProfit?: string }>(`/sales?${params}`),
    placeholderData: keepPreviousData,
  });
  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardData>("/reports/dashboard"), staleTime: 60_000 });
  const sales = data?.sales ?? [];
  const received = Math.max(0, num(data?.totalSales ?? 0) - num(data?.totalDue ?? 0));
  const series = dash?.salesSeries ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title="Sales" sub="Every invoice and return, with live totals and a 30-day trend." />

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <SaleStat label="Total Sales" value={fmtMoney(data?.totalSales ?? 0)} sub={`${data?.total ?? 0} invoice${(data?.total ?? 0) === 1 ? "" : "s"}`} icon={TrendingUp} grad="linear-gradient(135deg,#ffb570,#ff9f43)" loading={isLoading} />
        <SaleStat label="Amount Received" value={fmtMoney(received)} sub="paid to date" icon={Wallet} grad="linear-gradient(135deg,#14b8a6,#0e9384)" loading={isLoading} />
        <SaleStat label="Amount Due" value={fmtMoney(data?.totalDue ?? 0)} sub="receivable (udhaar)" icon={ArrowDownLeft} grad="linear-gradient(135deg,#f97362,#f62d51)" loading={isLoading} />
        {canProfit
          ? <SaleStat label="Total Profit" value={fmtMoney(data?.totalProfit ?? 0)} sub="on these sales" icon={Banknote} grad="linear-gradient(135deg,#1e4a72,#092c4c)" loading={isLoading} />
          : <SaleStat label="Invoices" value={String(data?.total ?? 0)} sub="in this view" icon={Receipt} grad="linear-gradient(135deg,#1e4a72,#092c4c)" loading={isLoading} />}
      </div>

      {/* 30-day sales trend */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="font-bold display text-[15px] flex items-center gap-2 min-w-0"><span className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: "var(--accent-soft)", color: "var(--accent-hover)" }}><BarChart3 size={16} /></span>Sales trend</h2>
          <span className="chip shrink-0">Last 30 days</span>
        </div>
        <div className="h-44">
          {!dash ? <div className="w-full h-full rounded-lg bg-surface-2 animate-pulse" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} barCategoryGap="26%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fill: "var(--text-muted)", fontSize: 11 }} stroke="var(--border)" minTickGap={20} />
                <YAxis tickFormatter={compact} tick={{ fill: "var(--text-muted)", fontSize: 11 }} stroke="var(--border)" width={40} />
                <Tooltip content={<TrendTip />} cursor={{ fill: "var(--surface-2)" }} />
                <Bar dataKey="sales" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={16} animationDuration={600} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search invoice no…" />
        <select className="input !w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter">
          <option value="">All</option>
          <option value="COMPLETED">Completed</option>
          <option value="RETURNED">Returns</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={canProfit ? 9 : 8} />
        ) : sales.length === 0 ? (
          <EmptyState title={search ? "No sales match" : "No sales yet"} hint={search ? "Try a different search." : "Make your first sale from the POS screen."} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs">
                    <th className="px-4 py-2.5 font-semibold">Invoice</th>
                    <th className="px-4 py-2.5 font-semibold">Date</th>
                    <th className="px-4 py-2.5 font-semibold">Customer</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Total</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Due</th>
                    <th className="px-4 py-2.5 font-semibold">Payment</th>
                    {canProfit && <th className="px-4 py-2.5 font-semibold text-right">Profit</th>}
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                      <td className="px-4 py-2">
                        <button className="mono text-xs font-semibold text-accent hover:underline" onClick={() => setViewing(s)}>{s.invoiceNo}</button>
                      </td>
                      <td className="px-4 py-2 text-muted whitespace-nowrap">{new Date(s.date).toLocaleDateString()}</td>
                      <td className="px-4 py-2"><CustomerCell s={s} /></td>
                      <td className="px-4 py-2 text-right money">{fmtMoney(s.grandTotal)}</td>
                      <td className={`px-4 py-2 text-right money ${num(s.dueAmount) > 0 ? "text-danger" : ""}`}>{fmtMoney(s.dueAmount)}</td>
                      <td className="px-4 py-2">{paymentBadge(s)}</td>
                      {canProfit && <td className="px-4 py-2 text-right money text-muted">{s.profit != null ? fmtMoney(s.profit) : "—"}</td>}
                      <td className="px-4 py-2">{statusBadge(s)}</td>
                      <td className="px-4 py-2"><button className="btn btn-secondary !p-1.5" onClick={() => setViewing(s)} title="View invoice"><Eye size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} />
          </>
        )}
      </div>

      {viewing && <ViewSale sale={viewing} onClose={() => setViewing(null)} onReturned={() => { qc.invalidateQueries({ queryKey: ["sales"] }); setViewing(null); }} />}
    </div>
  );
}
// (helper components below)

/** Small titled info block used in the invoice detail header. */
function InfoCard({ icon: Icon, title, children }: { icon: typeof User; title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-edge p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">
        <Icon size={13} className="text-accent" /> {title}
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function ViewSale({ sale, onClose, onReturned }: { sale: Sale; onClose: () => void; onReturned: () => void }) {
  const { toast } = useToast();
  const { can } = useAuth();
  const { data } = useQuery({ queryKey: ["sale", sale.id], queryFn: () => api<{ sale: Sale }>(`/sales/${sale.id}`) });
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: () => api<{ settings: Record<string, string> }>("/settings") });
  const s = data?.sale ?? sale;
  const [returnMode, setReturnMode] = useState(false);
  const [retQty, setRetQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [dispatch, setDispatch] = useState(false);

  const doReturn = useMutation({
    mutationFn: () => {
      const items = Object.entries(retQty).map(([saleItemId, q]) => ({ saleItemId, qty: Number(q) || 0 })).filter((i) => i.qty > 0);
      return api<{ sale: Sale }>(`/sales/${s.id}/return`, { method: "POST", body: { items } });
    },
    onSuccess: (d) => { toast(`Return ${d.sale.invoiceNo} saved`); onReturned(); },
    onError: (e: ApiError) => setError(e.message),
  });

  const canReturn = can("sales.return") && !s.isReturn && s.status === "COMPLETED";
  const anyRet = Object.values(retQty).some((q) => (Number(q) || 0) > 0);
  const showProfit = s.profit != null;

  return (
    <Modal open onClose={onClose} title={`${s.isReturn ? "Return " : "Invoice "}${s.invoiceNo}`} wide>
      <div className="space-y-4">
        {/* Invoice header — customer / invoice / payment */}
        <div className="grid sm:grid-cols-3 gap-3">
          <InfoCard icon={User} title="Customer">
            <div className="font-semibold">{s.customer?.name ?? "Walk-in"}</div>
            {s.customer?.phone && <div className="mono text-xs text-muted">{s.customer.phone}</div>}
            {s.customer?.code && <div className="mono text-xs text-faint">{s.customer.code}</div>}
          </InfoCard>
          <InfoCard icon={FileText} title="Invoice">
            <div className="mono font-semibold">{s.invoiceNo}</div>
            <div className="text-xs text-muted">{new Date(s.date).toLocaleString()}</div>
            {s.user?.name && <div className="text-xs text-muted">By {s.user.name}</div>}
          </InfoCard>
          <InfoCard icon={CreditCard} title="Payment">
            <div className="flex flex-wrap items-center gap-1.5">{statusBadge(s)} {paymentBadge(s)}</div>
            <div className="text-xs text-muted mt-1.5">Paid <span className="money">{fmtMoney(s.paidAmount)}</span> · Due <span className={`money ${num(s.dueAmount) > 0 ? "text-danger" : ""}`}>{fmtMoney(s.dueAmount)}</span></div>
          </InfoCard>
        </div>

        {/* Order summary */}
        <div>
          <h3 className="flex items-center gap-2 font-bold text-[13px] mb-2">
            <span className="w-6 h-6 rounded-md grid place-items-center" style={{ background: "var(--accent-soft)", color: "var(--accent-hover)" }}><ShoppingBag size={13} /></span>
            Order summary
          </h3>
          <div className="rounded-lg border border-edge overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs">
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 font-semibold text-right">Qty</th>
                  <th className="px-3 py-2 font-semibold text-right">Price</th>
                  <th className="px-3 py-2 font-semibold text-right">Total</th>
                  {returnMode && <th className="px-3 py-2 font-semibold text-right w-28">Return qty</th>}
                </tr>
              </thead>
              <tbody>
                {s.items.map((it) => (
                  <tr key={it.id} className="border-b border-edge last:border-0">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-8 h-8 rounded-md bg-surface-2 border border-edge grid place-items-center shrink-0 text-muted"><Package size={14} /></span>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{it.product?.name}</div>
                          {it.product?.sku && <div className="mono text-[11px] text-faint">{it.product.sku}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right mono whitespace-nowrap">{fmtQty(it.qty)} {it.product?.unit?.shortName}</td>
                    <td className="px-3 py-2 text-right money">{fmtMoney(it.unitPrice)}</td>
                    <td className="px-3 py-2 text-right money">{fmtMoney(it.total)}</td>
                    {returnMode && (
                      <td className="px-3 py-2"><input className="input mono !py-1 text-right" type="number" step="any" min="0" max={num(it.qty)} value={retQty[it.id] ?? ""} onChange={(e) => setRetQty({ ...retQty, [it.id]: e.target.value })} /></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-full sm:w-72 rounded-lg bg-surface-2 border border-edge p-3 space-y-1.5 text-sm">
            <div className="flex items-center justify-between"><span className="text-muted">Sub-total</span><span className="money">{fmtMoney(s.subTotal)}</span></div>
            {num(s.discount) > 0 && <div className="flex items-center justify-between"><span className="text-muted">Discount</span><span className="money text-success">− {fmtMoney(s.discount)}</span></div>}
            {num(s.tax) > 0 && <div className="flex items-center justify-between"><span className="text-muted">Tax</span><span className="money">{fmtMoney(s.tax)}</span></div>}
            {num(s.otherCharges) > 0 && <div className="flex items-center justify-between"><span className="text-muted">Other charges</span><span className="money">{fmtMoney(s.otherCharges)}</span></div>}
            {s.roundOff != null && num(s.roundOff) !== 0 && <div className="flex items-center justify-between"><span className="text-muted">Round off</span><span className="money">{fmtMoney(s.roundOff)}</span></div>}
            <div className="flex items-center justify-between rounded-md px-2.5 py-2 font-bold text-[15px]" style={{ background: "var(--accent-soft)", color: "var(--accent-hover)" }}>
              <span>Grand total</span><span className="money">{fmtMoney(s.grandTotal)}</span>
            </div>
            <div className="flex items-center justify-between"><span className="text-muted">Paid</span><span className="money">{fmtMoney(s.paidAmount)}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted">Due</span><span className={`money font-semibold ${num(s.dueAmount) > 0 ? "text-danger" : "text-success"}`}>{fmtMoney(s.dueAmount)}</span></div>
            {showProfit && <div className="flex items-center justify-between border-t border-edge pt-1.5 mt-1"><span className="text-muted">Profit</span><span className="money">{fmtMoney(s.profit!)}</span></div>}
          </div>
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2 border-t border-edge pt-3">
          {!returnMode && <button className="btn btn-secondary" onClick={() => printReceipt(s, "80mm", settingsData?.settings ?? {})}><Printer size={15} /> 80mm</button>}
          {!returnMode && <button className="btn btn-secondary" onClick={() => printReceipt(s, "a4", settingsData?.settings ?? {})}><Printer size={15} /> A4 / PDF</button>}
          {!returnMode && !s.isReturn && s.status === "COMPLETED" && can("sales.create") && <button className="btn btn-secondary" onClick={() => setDispatch(true)}><Truck size={15} /> Dispatch / Challan</button>}
          {canReturn && !returnMode && <button className="btn btn-secondary" onClick={() => setReturnMode(true)}><Undo2 size={15} /> Return items</button>}
          {returnMode && (
            <>
              <button className="btn btn-secondary" onClick={() => { setReturnMode(false); setRetQty({}); }}>Cancel return</button>
              <button className="btn btn-danger" disabled={!anyRet || doReturn.isPending} onClick={() => doReturn.mutate()}>{doReturn.isPending ? "Saving…" : "Confirm return"}</button>
            </>
          )}
          {!returnMode && <button className="btn btn-secondary" onClick={onClose}>Close</button>}
        </div>
      </div>
      {dispatch && <DispatchModal sale={s} onClose={() => setDispatch(false)} />}
    </Modal>
  );
}
