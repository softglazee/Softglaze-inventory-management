import { useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { FileText, Sheet, BarChart3, TrendingUp, Truck, Boxes, Users, Receipt, CreditCard, Activity, IdCard, CalendarClock, CalendarCheck, Tags, PackageMinus, LineChart, PackageX, Percent, Landmark, Save } from "lucide-react";
import { api, download, ApiError } from "../lib/api";
import { ReportTable } from "../lib/types";
import { fmtMoney } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, TableSkeleton, EmptyState, useToast } from "../components/ui";

type Cfg = { key: string; label: string; path: string; icon: typeof FileText; period?: boolean; basis?: boolean; filters?: boolean; month?: boolean; product?: boolean; perm?: string };

const REPORTS: Cfg[] = [
  { key: "profit-loss", label: "Profit & Loss", path: "/reports/profit-loss", icon: TrendingUp, period: true, perm: "reports.profit" },
  { key: "comparison", label: "Period Comparison", path: "/reports/comparison", icon: BarChart3, period: true, perm: "reports.profit" },
  { key: "sales", label: "Sales Register", path: "/reports/sales", icon: Receipt, period: true, filters: true },
  { key: "top-customers", label: "Top Customers", path: "/reports/top-customers", icon: Users, period: true },
  { key: "margins-by-group", label: "Margins by Price Group", path: "/reports/margins-by-group", icon: Tags, period: true, perm: "reports.profit" },
  { key: "purchases", label: "Purchase Register", path: "/reports/purchases", icon: Truck, period: true },
  { key: "stock-valuation", label: "Stock Valuation", path: "/reports/stock-valuation", icon: Boxes, basis: true },
  { key: "price-history", label: "Cost / Price History", path: "/reports/price-history", icon: LineChart, period: true, product: true },
  { key: "backorders", label: "Backorders (oversold)", path: "/reports/backorders", icon: PackageX },
  { key: "receivables", label: "Receivables Aging", path: "/reports/receivables", icon: Users },
  { key: "payables", label: "Payables Aging", path: "/reports/payables", icon: Truck },
  { key: "expenses", label: "Expenses by Category", path: "/reports/expenses", icon: Receipt, period: true },
  { key: "salaries", label: "Salary Register", path: "/reports/salaries", icon: IdCard, period: true },
  { key: "commission", label: "Salesman Commission", path: "/reports/commission", icon: Percent, period: true, perm: "reports.view" },
  { key: "attendance-sheet", label: "Attendance Sheet", path: "/reports/attendance-sheet", icon: CalendarCheck, month: true },
  { key: "sales-by-payment-method", label: "Sales by Payment Method", path: "/reports/sales-by-payment-method", icon: CreditCard, period: true },
  { key: "tax-register", label: "Sales-Tax / GST Register", path: "/reports/tax-register", icon: Landmark, period: true },
  { key: "stock-movements", label: "Stock Movements", path: "/reports/stock-movements", icon: Activity, period: true },
  { key: "adjustments-by-reason", label: "Adjustments by Reason", path: "/reports/adjustments-by-reason", icon: PackageMinus, period: true, perm: "stock.adjust" },
  { key: "pending-deliveries", label: "Pending Deliveries", path: "/reports/pending-deliveries", icon: Truck },
  { key: "open-bookings", label: "Open Bookings", path: "/reports/open-bookings", icon: CalendarClock },
];

export default function Reports() {
  const { can } = useAuth();
  const list = REPORTS.filter((r) => !r.perm || can(r.perm));
  const [active, setActive] = useState<Cfg>(list[0]);

  return (
    <div>
      <PageHeader title="Reports" sub="Every report on-screen, with PDF and Excel download. Numbers are rebuilt from the ledgers — they always reconcile." />
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        <nav className="card p-2 h-max lg:sticky lg:top-4">
          {list.map((r) => (
            <button
              key={r.key}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${active.key === r.key ? "bg-surface-2 text-ink font-semibold border border-edge" : "text-muted hover:text-ink hover:bg-surface-2"}`}
              onClick={() => setActive(r)}
            >
              <r.icon size={16} /> {r.label}
            </button>
          ))}
        </nav>
        <ReportView key={active.key} cfg={active} />
      </div>
    </div>
  );
}

function ReportView({ cfg }: { cfg: Cfg }) {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [basis, setBasis] = useState<"cost" | "sale">("cost");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [customerId, setCustomerId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [productId, setProductId] = useState("");

  const { data: custs } = useQuery({ queryKey: ["rep-custs"], queryFn: () => api<{ customers: { id: string; name: string }[] }>("/customers?limit=300&status=active"), enabled: !!cfg.filters });
  const { data: cats } = useQuery({ queryKey: ["rep-cats"], queryFn: () => api<{ categories: { id: string; name: string }[] }>("/categories"), enabled: !!cfg.filters });
  const { data: prods } = useQuery({ queryKey: ["rep-prods"], queryFn: () => api<{ products: { id: string; name: string }[] }>("/products?limit=300"), enabled: !!cfg.filters || !!cfg.product });

  const qs = new URLSearchParams({
    ...(cfg.period ? { from, to: `${to}T23:59:59` } : {}),
    ...(cfg.month ? { month } : {}),
    ...(cfg.basis ? { basis } : {}),
    ...(cfg.filters && customerId ? { customerId } : {}),
    ...(cfg.filters && categoryId ? { categoryId } : {}),
    ...((cfg.filters || cfg.product) && productId ? { productId } : {}),
  }).toString();

  const needsProduct = !!cfg.product && !productId;
  const { data, isLoading, error } = useQuery({
    queryKey: ["report", cfg.key, qs],
    queryFn: () => api<{ report: ReportTable }>(`${cfg.path}?${qs}`),
    placeholderData: keepPreviousData,
    enabled: !needsProduct,
  });
  const report = data?.report;

  // H2 — saved filter presets (per user, per report).
  const qcR = useQueryClient();
  const hasFilters = !!(cfg.period || cfg.filters || cfg.basis || cfg.month || cfg.product);
  const { data: presets } = useQuery({ queryKey: ["saved-filters", cfg.key], queryFn: () => api<{ filters: { id: string; name: string; params: string }[] }>(`/saved-filters?reportKey=${cfg.key}`), enabled: hasFilters });
  const savePreset = useMutation({ mutationFn: (name: string) => api("/saved-filters", { method: "POST", body: { reportKey: cfg.key, name, params: JSON.stringify({ from, to, basis, month, customerId, categoryId, productId }) } }), onSuccess: () => qcR.invalidateQueries({ queryKey: ["saved-filters", cfg.key] }) });
  const delPreset = useMutation({ mutationFn: (id: string) => api(`/saved-filters/${id}`, { method: "DELETE" }), onSuccess: () => qcR.invalidateQueries({ queryKey: ["saved-filters", cfg.key] }) });
  function loadPreset(params: string) {
    try { const p = JSON.parse(params); if (p.from) setFrom(p.from); if (p.to) setTo(p.to); if (p.basis) setBasis(p.basis); if (p.month) setMonth(p.month); setCustomerId(p.customerId ?? ""); setCategoryId(p.categoryId ?? ""); setProductId(p.productId ?? ""); } catch { toast("Couldn't load that preset", "error"); }
  }

  async function dl(format: "pdf" | "xlsx") {
    try {
      const ext = format === "pdf" ? "pdf" : "xlsx";
      await download(`${cfg.path}?${qs}${qs ? "&" : ""}format=${format}`, `${cfg.key}.${ext}`);
    } catch (e) {
      toast((e as ApiError).message || "Download failed", "error");
    }
  }

  const cell = (row: Record<string, string | number | null>, col: ReportTable["columns"][number]) => {
    const v = row[col.key];
    if (col.money) return fmtMoney(v ?? 0);
    return v ?? "";
  };

  return (
    <div>
      {/* Filters + downloads */}
      <div className="flex flex-wrap items-end gap-2 mb-3">
        {cfg.period && (
          <>
            <div><label className="label">From</label><input type="date" className="input !w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label className="label">To</label><input type="date" className="input !w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </>
        )}
        {cfg.month && (
          <div><label className="label">Month</label><input type="month" className="input !w-44" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
        )}
        {cfg.basis && (
          <div>
            <label className="label">Value at</label>
            <select className="input !w-40" value={basis} onChange={(e) => setBasis(e.target.value as "cost" | "sale")}>
              <option value="cost">Cost price</option>
              <option value="sale">Sale price</option>
            </select>
          </div>
        )}
        {cfg.filters && (
          <>
            <div><label className="label">Customer</label><select className="input !w-44" value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">All customers</option>{(custs?.customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="label">Category</label><select className="input !w-40" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setProductId(""); }}><option value="">All categories</option>{(cats?.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="label">Product</label><select className="input !w-44" value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">All products</option>{(prods?.products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          </>
        )}
        {cfg.product && (
          <div><label className="label">Product</label><select className="input !w-56" value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Choose a product…</option>{(prods?.products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        )}
        <div className="flex-1" />
        {hasFilters && (
          <>
            {(presets?.filters.length ?? 0) > 0 && (
              <div className="flex items-center gap-1">
                <select className="input !w-40 !py-1.5 text-sm" defaultValue="" onChange={(e) => { const p = presets!.filters.find((f) => f.id === e.target.value); if (p) loadPreset(p.params); e.target.value = ""; }}>
                  <option value="">Load preset…</option>
                  {presets!.filters.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {presets!.filters.length > 0 && <button className="btn btn-secondary !px-2" title="Delete last preset" onClick={() => { const last = presets!.filters[presets!.filters.length - 1]; if (last && confirm(`Delete preset "${last.name}"?`)) delPreset.mutate(last.id); }}>×</button>}
              </div>
            )}
            <button className="btn btn-secondary" onClick={() => { const name = prompt("Name this filter preset:"); if (name?.trim()) savePreset.mutate(name.trim()); }}><Save size={15} /> Save filter</button>
          </>
        )}
        <button className="btn btn-secondary" onClick={() => dl("pdf")} disabled={!report}><FileText size={15} /> PDF</button>
        <button className="btn btn-secondary" onClick={() => dl("xlsx")} disabled={!report}><Sheet size={15} /> Excel</button>
      </div>

      <div className="card overflow-hidden">
        {needsProduct ? (
          <EmptyState title="Choose a product" hint="Pick a product above to see how its cost and sale price changed over time." />
        ) : isLoading && !report ? (
          <TableSkeleton cols={5} />
        ) : error ? (
          <EmptyState title="Can't load this report" hint={(error as { message?: string }).message ?? "Please try again"} />
        ) : !report ? (
          <EmptyState title="No data" />
        ) : (
          <>
            <div className="px-4 pt-4">
              <h2 className="font-semibold display flex items-center gap-2"><BarChart3 size={16} /> {report.title}</h2>
              {report.meta?.length ? <p className="text-muted text-xs mt-0.5">{report.meta.map((m) => `${m.label}: ${m.value}`).join("  ·  ")}</p> : null}
            </div>
            {report.rows.length === 0 ? (
              <EmptyState title="Nothing in this period" hint="Try a wider date range." />
            ) : (
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted border-b border-edge">
                      {report.columns.map((c) => <th key={c.key} className={`px-4 py-2.5 font-medium ${c.align === "right" ? "text-right" : ""}`}>{c.header}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row, i) => (
                      <tr key={i} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                        {report.columns.map((c) => <td key={c.key} className={`px-4 py-2 ${c.align === "right" ? "text-right money" : ""}`}>{cell(row, c)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                  {report.totals && (
                    <tfoot>
                      <tr className="border-t-2 border-edge font-bold bg-surface-2/40">
                        {report.columns.map((c, i) => (
                          <td key={c.key} className={`px-4 py-2.5 ${c.align === "right" ? "text-right money" : ""}`}>
                            {report.totals![c.key] != null ? cell(report.totals!, c) : i === 0 ? "Total" : ""}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
