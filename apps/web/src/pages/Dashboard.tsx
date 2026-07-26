import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp, Wallet, Users, Truck, PackageX, Banknote, ShoppingBag, AlertTriangle,
  ArrowUpRight, Boxes, CalendarClock, RotateCcw, Undo2, ShoppingCart, Receipt,
  Package, Building2, Layers, ClipboardList, ArrowDownLeft, Info, ChevronDown, Check,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from "recharts";
import { api } from "../lib/api";
import { DashboardData } from "../lib/types";
import { fmtMoney, num } from "../lib/format";
import { useAuth } from "../context/AuthContext";

const CAT_COLORS = ["var(--accent)", "var(--navy)", "var(--teal)", "var(--info)", "var(--purple)", "var(--pink)"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(1)}cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(v);
};

function ChartTip({ active, payload, label, money = true }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card px-3 py-2 !shadow-[var(--shadow-md)] text-xs">
      {label != null && <p className="text-muted mb-1">{label}</p>}
      {payload.map((p: any) => (
        <p key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="capitalize">{p.name}:</span>
          <span className="mono font-semibold">{money ? fmtMoney(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

function BoldStat({ label, value, icon: Icon, color, loading }: { label: string; value?: string | number; icon: any; color: string; loading?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-[10px] p-4 text-white card-hover" style={{ background: color }}>
      <div className="absolute -bottom-8 -right-6 w-28 h-28 rounded-full bg-white/10 pointer-events-none" />
      <div className="relative flex items-center gap-3.5">
        <div className="w-12 h-12 shrink-0 rounded-lg bg-white/25 grid place-items-center"><Icon size={22} /></div>
        <div className="min-w-0">
          <p className="text-white/85 text-[12.5px] font-semibold truncate">{label}</p>
          <p className="money text-[21px] font-extrabold leading-tight mt-0.5">
            {loading ? <span className="inline-block h-5 w-20 rounded bg-white/25 animate-pulse" /> : (value ?? "—")}
          </p>
        </div>
      </div>
    </div>
  );
}

function SoftStat({ label, value, icon: Icon, color, caption, to, loading }: { label: string; value?: string | number; icon: any; color: string; caption: string; to: string; loading?: boolean }) {
  return (
    <div className="card p-4 card-hover">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="money text-[20px] font-extrabold leading-none">
            {loading ? <span className="inline-block h-5 w-20 rounded bg-surface-2 animate-pulse" /> : (value ?? "—")}
          </p>
          <p className="text-muted text-[12.5px] font-semibold truncate mt-1.5">{label}</p>
        </div>
        <div className="w-11 h-11 shrink-0 rounded-lg grid place-items-center" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
          <Icon size={20} />
        </div>
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-edge">
        <span className="text-xs text-faint">{caption}</span>
        <Link to={to} className="text-xs font-semibold text-accent inline-flex items-center gap-0.5 hover:underline">View <ArrowUpRight size={12} /></Link>
      </div>
    </div>
  );
}

function CardHead({ icon: Icon, title, color, right }: { icon: any; title: string; color: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4 gap-2">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}><Icon size={16} /></span>
        <h2 className="font-bold display text-[15px] truncate">{title}</h2>
      </div>
      {right}
    </div>
  );
}

function Thumb({ src, fallback: Fallback = Package }: { src: string | null; fallback?: any }) {
  return src
    ? <img src={src} alt="" className="w-10 h-10 rounded-lg object-cover border border-edge shrink-0" />
    : <span className="w-10 h-10 rounded-lg grid place-items-center bg-surface-2 border border-edge shrink-0"><Fallback size={17} className="text-muted" /></span>;
}

const RANGE_PRESETS = [
  { days: 1, label: "Today" },
  { days: 7, label: "Last 7 days" },
  { days: 14, label: "Last 14 days" },
  { days: 30, label: "Last 30 days" },
];

/** Date-range picker for the dashboard trend (drives the Sales & Purchase chart + its totals). */
function RangeMenu({ range, onChange, span }: { range: number; onChange: (d: number) => void; span: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const current = RANGE_PRESETS.find((p) => p.days === range) ?? RANGE_PRESETS[3];
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="panel px-3.5 py-2 flex items-center gap-2 text-sm hover:border-accent transition-colors">
        <CalendarClock size={15} className="text-accent shrink-0" />
        <span className="font-semibold">{current.label}</span>
        <span className="text-faint hidden sm:inline">· {span}</span>
        <ChevronDown size={14} className={`text-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full mt-2 right-0 w-48 card shadow-2xl z-40 p-1.5 animate-[fadeUp_.14s_ease]">
          {RANGE_PRESETS.map((p) => (
            <button key={p.days} onClick={() => { onChange(p.days); setOpen(false); }} className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${p.days === range ? "text-accent font-semibold bg-[var(--accent-soft)]" : "text-muted hover:text-ink hover:bg-surface-2"}`}>
              {p.label}
              {p.days === range && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user, can } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardData>("/reports/dashboard") });
  const [range, setRange] = useState(30);

  const c = data?.cards;
  const canProfit = data?.canProfit ?? false;
  const series = (data?.salesSeries ?? []).slice(-range);
  const salesTotal = series.reduce((s, d) => s + (d.sales || 0), 0);
  const purchaseTotal = series.reduce((s, d) => s + (d.purchase || 0), 0);
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const rangeFrom = new Date(); rangeFrom.setDate(rangeFrom.getDate() - (range - 1));
  const spanText = range === 1 ? today : `${rangeFrom.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${today}`;
  const ov = data?.customersOverview;
  const ovData = ov ? [{ name: "First-time", value: ov.firstTime }, { name: "Returning", value: ov.returning }] : [];
  const heat = data?.heatmap ?? [];
  const heatMax = Math.max(1, ...heat.flat());

  return (
    <div className="animate-[fadeUp_.3s_ease]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[24px] font-extrabold display">Welcome, {user?.name?.split(" ")[0]} 👋</h1>
          <p className="text-muted text-sm mt-0.5">You have <span className="text-accent font-bold">{c?.todayOrders ?? 0}</span> order{(c?.todayOrders ?? 0) === 1 ? "" : "s"} today.</p>
        </div>
        <RangeMenu range={range} onChange={setRange} span={spanText} />
      </div>

      {/* Alert banner */}
      {c && c.lowStock > 0 && (
        <div className="mb-4 rounded-[8px] px-4 py-3 flex items-center gap-3 border" style={{ background: "var(--accent-soft)", borderColor: "color-mix(in srgb, var(--accent) 25%, transparent)" }}>
          <AlertTriangle size={18} className="text-accent shrink-0" />
          <p className="text-sm text-ink flex-1"><span className="font-bold">{c.lowStock} product{c.lowStock > 1 ? "s" : ""}</span> running low on stock. <Link to="/stock" className="text-accent font-bold underline underline-offset-2">Review &amp; restock</Link></p>
        </div>
      )}

      {/* Row 1 — 4 bold color stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <BoldStat label="Total Sales (month)" value={fmtMoney(c?.monthSales ?? 0)} icon={TrendingUp} color="linear-gradient(135deg,#ffb570,#ff9f43)" loading={isLoading} />
        <BoldStat label="Sales Return (month)" value={fmtMoney(c?.salesReturn ?? 0)} icon={RotateCcw} color="linear-gradient(135deg,#1e4a72,#092c4c)" loading={isLoading} />
        <BoldStat label="Total Purchase (month)" value={fmtMoney(c?.totalPurchase ?? 0)} icon={ShoppingCart} color="linear-gradient(135deg,#14b8a6,#0e9384)" loading={isLoading} />
        <BoldStat label="Purchase Return (month)" value={fmtMoney(c?.purchaseReturn ?? 0)} icon={Undo2} color="linear-gradient(135deg,#33b0fb,#009efb)" loading={isLoading} />
      </div>

      {/* Row 2 — 4 white stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
        {canProfit
          ? <SoftStat label="Profit (month)" value={fmtMoney(c?.monthProfit ?? 0)} icon={Banknote} color="var(--success)" caption="This month" to="/reports" loading={isLoading} />
          : <SoftStat label="Today's Sales" value={fmtMoney(c?.todaySales ?? 0)} icon={TrendingUp} color="var(--accent)" caption="Today" to="/sales" loading={isLoading} />}
        <SoftStat label="Invoice Due (receivable)" value={fmtMoney(c?.receivables ?? 0)} icon={ArrowDownLeft} color="var(--info)" caption="Owed to you" to="/customers" loading={isLoading} />
        <SoftStat label="Total Expenses (month)" value={fmtMoney(c?.expenses ?? 0)} icon={Wallet} color="var(--danger)" caption="This month" to="/expenses" loading={isLoading} />
        <SoftStat label="Payables to Vendors" value={fmtMoney(c?.payables ?? 0)} icon={Truck} color="var(--warn)" caption="You owe" to="/vendors" loading={isLoading} />
      </div>

      {/* Row 3 — Sales & Purchase + Overall/Customers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="card p-5 lg:col-span-2">
          <CardHead icon={ShoppingBag} title="Sales & Purchase" color="var(--accent)" right={<span className="chip">{RANGE_PRESETS.find((p) => p.days === range)?.label ?? `${range}D`}</span>} />
          <div className="flex items-center gap-6 mb-3">
            <div><span className="chip flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#ffd0a3" }} />Total Purchase</span><p className="money font-extrabold text-base mt-0.5">{fmtMoney(purchaseTotal)}</p></div>
            <div><span className="chip flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "var(--accent)" }} />Total Sales</span><p className="money font-extrabold text-base mt-0.5">{fmtMoney(salesTotal)}</p></div>
          </div>
          <div className="h-56">
            {isLoading ? <Skeleton /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="26%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fill: "var(--text-muted)", fontSize: 11 }} stroke="var(--border)" minTickGap={20} />
                  <YAxis tickFormatter={compact} tick={{ fill: "var(--text-muted)", fontSize: 11 }} stroke="var(--border)" width={40} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: "var(--surface-2)" }} />
                  <Bar dataKey="purchase" fill="#ffd0a3" radius={[4, 4, 0, 0]} maxBarSize={14} animationDuration={600} />
                  <Bar dataKey="sales" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={14} animationDuration={600} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {/* Overall information */}
          <div className="card p-5">
            <CardHead icon={Info} title="Overall Information" color="var(--purple)" />
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Suppliers", value: data?.counts.suppliers, icon: Building2, color: "var(--info)" },
                { label: "Customers", value: data?.counts.customers, icon: Users, color: "var(--accent)" },
                { label: "Orders", value: data?.counts.orders, icon: ClipboardList, color: "var(--success)" },
              ].map((m) => (
                <div key={m.label} className="panel p-3 text-center">
                  <span className="w-8 h-8 mx-auto rounded-lg grid place-items-center mb-1.5" style={{ background: `color-mix(in srgb, ${m.color} 14%, transparent)`, color: m.color }}><m.icon size={15} /></span>
                  <p className="text-lg font-extrabold display leading-none">{m.value ?? "—"}</p>
                  <p className="text-[11px] text-muted mt-0.5">{m.label}</p>
                </div>
              ))}
            </div>
          </div>
          {/* Customers overview */}
          <div className="card p-5">
            <CardHead icon={Users} title="Customers Overview" color="var(--accent)" />
            <div className="flex items-center gap-4">
              <div className="w-24 h-24 shrink-0 relative">
                {ovData.some((d) => d.value > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart><Pie data={ovData} dataKey="value" innerRadius={30} outerRadius={46} paddingAngle={2} stroke="none">{ovData.map((_, i) => <Cell key={i} fill={i === 0 ? "var(--accent)" : "var(--navy)"} />)}</Pie></PieChart>
                  </ResponsiveContainer>
                ) : <div className="w-full h-full rounded-full border-4 border-edge" />}
              </div>
              <div className="space-y-2 text-sm flex-1">
                <div><p className="font-extrabold display text-lg leading-none">{ov?.firstTime ?? 0}</p><p className="text-xs text-muted flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-accent" />First-time</p></div>
                <div><p className="font-extrabold display text-lg leading-none">{ov?.returning ?? 0}</p><p className="text-xs text-muted flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: "var(--navy)" }} />Returning</p></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 4 — Top selling / Low stock / Recent sales */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="card p-5">
          <CardHead icon={ShoppingBag} title="Top Selling Products" color="var(--pink)" right={<span className="chip">30 days</span>} />
          {isLoading ? <ListSkeleton /> : (data?.topProducts.length ? (
            <div className="space-y-3">
              {data.topProducts.map((p) => (
                <div key={p.name} className="flex items-center gap-3">
                  <Thumb src={p.image} />
                  <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{p.name}</p><p className="text-xs text-faint"><span className="money">{fmtMoney(p.value)}</span> · {num(p.qty)} sold</p></div>
                  <ArrowUpRight size={15} className="text-success shrink-0" />
                </div>
              ))}
            </div>
          ) : <Empty label="No sales yet." />)}
        </div>

        <div className="card p-5">
          <CardHead icon={PackageX} title="Low Stock Products" color="var(--danger)" right={<Link to="/stock" className="chip hover:text-accent">View all</Link>} />
          {isLoading ? <ListSkeleton /> : (data?.lowStockItems.length ? (
            <div className="divide-y divide-edge -my-1">
              {data.lowStockItems.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2.5">
                  <Thumb src={p.image} fallback={Boxes} />
                  <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{p.name}</p><p className="text-xs text-faint mono">{p.sku}</p></div>
                  <div className="text-right shrink-0"><span className="pill" style={{ background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)" }}>{p.stockQty} {p.unit}</span><p className="text-[10px] text-faint mt-0.5">min {p.minStockLevel}</p></div>
                </div>
              ))}
            </div>
          ) : <Empty label="All items above minimum 👍" />)}
        </div>

        <div className="card p-5">
          <CardHead icon={Receipt} title="Recent Sales" color="var(--info)" right={<Link to="/sales" className="chip hover:text-accent">View all</Link>} />
          {isLoading ? <ListSkeleton /> : (data?.recentSales.length ? (
            <div className="divide-y divide-edge -my-1">
              {data.recentSales.slice(0, 5).map((s) => {
                const paid = num(s.dueAmount) <= 0;
                return (
                  <div key={s.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1"><p className="text-sm font-semibold mono truncate">{s.invoiceNo}</p><p className="text-xs text-faint truncate">{s.customer}</p></div>
                    <div className="text-right shrink-0"><p className="money text-sm font-semibold">{fmtMoney(s.grandTotal)}</p><span className="pill mt-0.5" style={paid ? { background: "color-mix(in srgb, var(--success) 14%, transparent)", color: "var(--success)" } : { background: "color-mix(in srgb, var(--accent) 16%, transparent)", color: "var(--accent-hover)" }}>{paid ? "Paid" : "Udhaar"}</span></div>
                  </div>
                );
              })}
            </div>
          ) : <Empty label="No sales yet." />)}
        </div>
      </div>

      {/* Row 5 — Sales statics + Recent transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <div className="card p-5">
          <CardHead icon={Layers} title="Sales Statistics (12 months)" color="var(--teal)" />
          <div className="flex items-center gap-6 mb-2 text-sm">
            <div><span className="chip flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "var(--emerald)" }} />Revenue</span></div>
            <div><span className="chip flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "var(--accent)" }} />Expense</span></div>
          </div>
          <div className="h-56">
            {isLoading ? <Skeleton /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.revenueExpense ?? []} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: "var(--text-muted)", fontSize: 11 }} stroke="var(--border)" />
                  <YAxis tickFormatter={compact} tick={{ fill: "var(--text-muted)", fontSize: 11 }} stroke="var(--border)" width={40} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: "var(--surface-2)" }} />
                  <Bar dataKey="revenue" fill="var(--emerald)" radius={[3, 3, 0, 0]} maxBarSize={13} animationDuration={600} />
                  <Bar dataKey="expense" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={13} animationDuration={600} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card p-5">
          <CardHead icon={ClipboardList} title="Recent Transactions" color="var(--info)" right={<Link to="/sales" className="chip hover:text-accent">View all</Link>} />
          {isLoading ? <ListSkeleton /> : (data?.recentSales.length ? (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-[360px]">
                <thead><tr className="text-left border-b border-edge"><th className="px-1 py-2">Invoice</th><th className="px-1 py-2">Customer</th><th className="px-1 py-2 text-right">Total</th><th className="px-1 py-2 text-right">Status</th></tr></thead>
                <tbody>
                  {data.recentSales.slice(0, 6).map((s) => {
                    const paid = num(s.dueAmount) <= 0;
                    return (
                      <tr key={s.id} className="border-b border-edge last:border-0 hover:bg-surface-2/60">
                        <td className="px-1 py-2 mono font-semibold">{s.invoiceNo}</td>
                        <td className="px-1 py-2 truncate max-w-[120px]">{s.customer}</td>
                        <td className="px-1 py-2 text-right money font-semibold">{fmtMoney(s.grandTotal)}</td>
                        <td className="px-1 py-2 text-right"><span className="pill" style={paid ? { background: "color-mix(in srgb, var(--success) 14%, transparent)", color: "var(--success)" } : { background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)" }}>{paid ? "Paid" : "Due"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <Empty label="No transactions yet." />)}
        </div>
      </div>

      {/* Row 6 — Top customers / Top categories / Order statistics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="card p-5">
          <CardHead icon={Users} title="Top Customers" color="var(--accent)" right={<Link to="/customers" className="chip hover:text-accent">View all</Link>} />
          {isLoading ? <ListSkeleton /> : (data?.topCustomers.length ? (
            <div className="divide-y divide-edge -my-1">
              {data.topCustomers.map((cu, i) => (
                <div key={cu.name + i} className="flex items-center gap-3 py-2.5">
                  <span className="w-9 h-9 rounded-lg grid place-items-center text-xs font-extrabold shrink-0" style={{ background: `color-mix(in srgb, ${CAT_COLORS[i % CAT_COLORS.length]} 14%, transparent)`, color: CAT_COLORS[i % CAT_COLORS.length] }}>{cu.name.slice(0, 2).toUpperCase()}</span>
                  <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{cu.name}</p><p className="text-xs text-faint">{cu.bills} order{cu.bills > 1 ? "s" : ""}</p></div>
                  <span className="money text-sm font-semibold shrink-0">{fmtMoney(cu.sales)}</span>
                </div>
              ))}
            </div>
          ) : <Empty label="No customer sales yet." />)}
        </div>

        <div className="card p-5">
          <CardHead icon={Boxes} title="Top Categories" color="var(--purple)" />
          <div className="flex items-center gap-4">
            <div className="w-28 h-28 shrink-0">
              {data?.categoryShare.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={data.categoryShare} dataKey="value" innerRadius={34} outerRadius={54} paddingAngle={data.categoryShare.length > 1 ? 2 : 0} stroke="var(--surface)" strokeWidth={3}>{data.categoryShare.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}</Pie><Tooltip content={<ChartTip />} /></PieChart>
                </ResponsiveContainer>
              ) : <div className="w-full h-full rounded-full border-4 border-edge" />}
            </div>
            <div className="space-y-1.5 flex-1 min-w-0">
              {(data?.categoryShare ?? []).slice(0, 4).map((cat, i) => (
                <div key={cat.name} className="flex items-center justify-between text-sm gap-2"><span className="flex items-center gap-1.5 text-muted min-w-0"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} /><span className="truncate">{cat.name}</span></span><span className="money text-xs font-semibold shrink-0">{fmtMoney(cat.value)}</span></div>
              ))}
              {!data?.categoryShare.length && <p className="text-muted text-sm">No data yet.</p>}
            </div>
          </div>
          {data && (
            <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-edge">
              <div className="panel p-2.5 text-center"><p className="text-lg font-extrabold display leading-none">{data.counts.categories}</p><p className="text-[11px] text-muted mt-0.5">Categories</p></div>
              <div className="panel p-2.5 text-center"><p className="text-lg font-extrabold display leading-none">{data.counts.products}</p><p className="text-[11px] text-muted mt-0.5">Products</p></div>
            </div>
          )}
        </div>

        <div className="card p-5">
          <CardHead icon={CalendarClock} title="Order Statistics" color="var(--info)" right={<span className="chip">90 days · by hour</span>} />
          {isLoading ? <Skeleton /> : (heat.length ? (
            <div className="overflow-x-auto">
              <div className="min-w-[320px]">
                {heat.map((row, d) => (
                  <div key={d} className="flex items-center gap-1 mb-1">
                    <span className="w-8 text-[10px] text-faint shrink-0">{DAYS[d]}</span>
                    <div className="flex gap-[2px] flex-1">
                      {row.map((count, h) => (
                        <span key={h} title={`${DAYS[d]} ${h}:00 — ${count} order${count === 1 ? "" : "s"}`} className="h-4 flex-1 rounded-[2px]" style={{ background: count > 0 ? `color-mix(in srgb, var(--accent) ${Math.round((count / heatMax) * 100)}%, var(--surface-2))` : "var(--surface-2)" }} />
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-1 mt-1.5"><span className="w-8 shrink-0" /><span className="text-[10px] text-faint flex-1">12am</span><span className="text-[10px] text-faint">6am</span><span className="text-[10px] text-faint flex-1 text-center">12pm</span><span className="text-[10px] text-faint">6pm</span><span className="text-[10px] text-faint">11pm</span></div>
              </div>
            </div>
          ) : <Empty label="No orders yet." />)}
        </div>
      </div>
    </div>
  );
}

const Skeleton = () => <div className="w-full h-full rounded-lg bg-surface-2 animate-pulse" />;
const ListSkeleton = () => <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-11 rounded-lg bg-surface-2 animate-pulse" />)}</div>;
const Empty = ({ label = "No data yet" }: { label?: string }) => <div className="w-full py-10 flex items-center justify-center text-muted text-sm">{label}</div>;
