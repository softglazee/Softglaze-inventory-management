import { useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Plus, Search, X, Eye, Undo2, MessageCircle, Truck, Package, Wallet } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Purchase, Vendor, Product, PaymentMethod, Paged, LandedBasis } from "../lib/types";
import { num, fmtMoney, fmtQty } from "../lib/format";
import { waLink } from "../lib/phone";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, SearchBox, Badge, Pagination, FormSection, useToast } from "../components/ui";

type Line = { productId: string; name: string; sku: string; unitShort: string; qty: string; unitCost: string };

function statusBadge(p: Purchase) {
  if (p.isReturn) return <Badge tone="warn">Return</Badge>;
  if (p.status === "RECEIVED") return <Badge tone="success">Received</Badge>;
  if (p.status === "RETURNED") return <Badge tone="warn">Returned</Badge>;
  if (p.status === "CANCELLED") return <Badge tone="danger">Cancelled</Badge>;
  return <Badge tone="muted">{p.status}</Badge>;
}

export default function Purchases() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Purchase | null>(null);

  const params = new URLSearchParams({ page: String(page), limit: "20", ...(search.trim() && { search: search.trim() }), ...(status && { status }) });
  const { data, isLoading } = useQuery({
    queryKey: ["purchases", page, search, status],
    queryFn: () => api<Paged<"purchases", Purchase> & { totalValue: string; totalDue: string }>(`/purchases?${params}`),
    placeholderData: keepPreviousData,
  });
  const purchases = data?.purchases ?? [];

  return (
    <div>
      <PageHeader
        title="Purchases"
        sub={`Receive stock from vendors — cash or udhaar. Total due to vendors: ${fmtMoney(data?.totalDue ?? 0)}`}
        actions={can("purchases.create") && (
          <button className="btn btn-secondary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New purchase
          </button>
        )}
      />

      <div className="flex flex-wrap gap-2 mb-3">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search invoice / vendor bill…" />
        <select className="input !w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
          <option value="">All</option>
          <option value="RECEIVED">Received</option>
          <option value="RETURNED">Returns</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={7} />
        ) : purchases.length === 0 ? (
          <EmptyState
            title={search ? "No purchases match" : "No purchases yet"}
            hint={search ? "Try a different search." : "Record your first stock purchase — pick a vendor and add items."}
            action={!search && can("purchases.create") && (
              <button className="btn btn-secondary" onClick={() => setCreating(true)}><Plus size={16} /> New purchase</button>
            )}
          />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-edge">
                  <th className="px-4 py-2.5 font-medium">Invoice</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Vendor</th>
                  <th className="px-4 py-2.5 font-medium text-right">Total</th>
                  <th className="px-4 py-2.5 font-medium text-right">Due</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 w-16" />
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                    <td className="px-4 py-2 mono">{p.invoiceNo}</td>
                    <td className="px-4 py-2 text-muted">{new Date(p.date).toLocaleDateString()}</td>
                    <td className="px-4 py-2">{p.vendor?.name}</td>
                    <td className="px-4 py-2 text-right money">{fmtMoney(p.grandTotal)}</td>
                    <td className={`px-4 py-2 text-right money ${num(p.dueAmount) > 0 ? "text-danger" : ""}`}>{fmtMoney(p.dueAmount)}</td>
                    <td className="px-4 py-2">{statusBadge(p)}</td>
                    <td className="px-4 py-2">
                      <button className="btn btn-secondary !p-1.5" onClick={() => setViewing(p)} title="View"><Eye size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} />
          </>
        )}
      </div>

      {creating && <NewPurchase onClose={() => setCreating(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ["purchases"] }); setCreating(false); }} />}
      {viewing && <ViewPurchase purchase={viewing} onClose={() => setViewing(null)} onReturned={() => { qc.invalidateQueries({ queryKey: ["purchases"] }); setViewing(null); }} />}
    </div>
  );
}

/* ─────────────── New purchase ─────────────── */
function NewPurchase({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [vendorId, setVendorId] = useState("");
  const [refInvoiceNo, setRefInvoiceNo] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([]);
  const [prodSearch, setProdSearch] = useState("");
  const [discount, setDiscount] = useState("0");
  const [tax, setTax] = useState("0");
  const [otherCharges, setOtherCharges] = useState("0");
  const [landedBasis, setLandedBasis] = useState<LandedBasis>("VALUE"); // C2 — default: capitalise freight by line value
  const [currency, setCurrency] = useState("PKR"); // H4 — import-purchase FX
  const [fxRate, setFxRate] = useState("1");
  const [methodId, setMethodId] = useState("");
  const [paidAmount, setPaidAmount] = useState("0");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: vendorData } = useQuery({ queryKey: ["vendors-active"], queryFn: () => api<{ vendors: Vendor[] }>("/vendors?status=active&limit=100") });
  const { data: methodData } = useQuery({ queryKey: ["payment-methods"], queryFn: () => api<{ methods: PaymentMethod[] }>("/payment-methods") });
  const { data: prodResults } = useQuery({
    queryKey: ["purchase-prod-search", prodSearch],
    queryFn: () => api<{ products: Product[] }>(`/products/search?q=${encodeURIComponent(prodSearch)}`),
    enabled: prodSearch.trim().length > 0,
  });

  const subTotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);
  const grand = Math.max(0, subTotal - (Number(discount) || 0) + (Number(tax) || 0) + (Number(otherCharges) || 0));
  const paid = Number(paidAmount) || 0;
  const due = grand - paid;

  // C2 — live landed-cost preview (mirrors the server allocation of freight into item cost)
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const freightPool = r2(Number(otherCharges) || 0);
  const allocateOn = landedBasis !== "NONE" && freightPool > 0 && lines.length > 0;
  const grossVals = lines.map((l) => r2((Number(l.qty) || 0) * (Number(l.unitCost) || 0)));
  const totalGross = r2(grossVals.reduce((s, v) => s + v, 0));
  const totalQty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const allocated = lines.map(() => 0);
  if (allocateOn) {
    let acc = 0;
    for (let i = 0; i < lines.length; i++) {
      if (i === lines.length - 1) { allocated[i] = r2(freightPool - acc); }
      else {
        const w = landedBasis === "QTY"
          ? (totalQty > 0 ? (Number(lines[i].qty) || 0) / totalQty : 1 / lines.length)
          : (totalGross > 0 ? grossVals[i] / totalGross : 1 / lines.length);
        allocated[i] = r2(freightPool * w); acc = r2(acc + allocated[i]);
      }
    }
  }
  const landedUnits = lines.map((l, i) => {
    const qtyN = Number(l.qty) || 0, costN = Number(l.unitCost) || 0;
    return allocateOn && qtyN > 0 ? r2(costN + allocated[i] / qtyN) : costN;
  });

  function addLine(p: Product) {
    if (p.type !== "STANDARD") { toast(`${p.name} is a ${p.type.toLowerCase()} item — not stockable`, "error"); return; }
    if (lines.some((l) => l.productId === p.id)) { setProdSearch(""); return; }
    setLines([...lines, { productId: p.id, name: p.name, sku: p.sku, unitShort: p.unit?.shortName ?? "", qty: "1", unitCost: String(num(p.costPrice)) }]);
    setProdSearch("");
  }

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        vendorId,
        refInvoiceNo: refInvoiceNo || null,
        date: date ? new Date(date).toISOString() : undefined,
        items: lines.map((l) => ({ productId: l.productId, qty: Number(l.qty) || 0, unitCost: Number(l.unitCost) || 0 })),
        discount: Number(discount) || 0,
        tax: Number(tax) || 0,
        otherCharges: Number(otherCharges) || 0,
        landedBasis,
        currency: currency || "PKR",
        fxRate: Number(fxRate) || 1,
        notes: notes || null,
        payments: paid > 0 && methodId ? [{ methodId, amount: paid }] : [],
      };
      return api<{ purchase: Purchase }>("/purchases", { method: "POST", body });
    },
    onSuccess: (d) => { toast(`Purchase ${d.purchase.invoiceNo} saved`); onSaved(); },
    onError: (e: ApiError) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!vendorId) return setError("Pick a vendor.");
    if (lines.length === 0) return setError("Add at least one item.");
    if (paid > 0 && !methodId) return setError("Choose how you paid.");
    if (paid > grand) return setError("Paid amount is more than the total.");
    save.mutate();
  }

  return (
    <Modal open onClose={onClose} title="New purchase" wide>
      <form onSubmit={submit} className="space-y-4">
        <FormSection title="Purchase details" icon={Truck} color="var(--accent)">
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Vendor</label>
              <select className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
                <option value="">Pick a vendor…</option>
                {(vendorData?.vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Vendor bill no (optional)</label>
              <input className="input mono" value={refInvoiceNo} onChange={(e) => setRefInvoiceNo(e.target.value)} />
            </div>
            <div>
              <label className="label">Date</label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="sm:col-span-3">
              <label className="label">Notes (optional)</label>
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. delivered by truck, half load…" />
            </div>
          </div>
        </FormSection>

        <FormSection title="Items" icon={Package} color="var(--info)">
          <div className="relative mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input !pl-9" value={prodSearch} onChange={(e) => setProdSearch(e.target.value)} placeholder="Search a product to add…" />
            {prodSearch.trim() && (prodResults?.products.length ?? 0) > 0 && (
              <div className="absolute z-10 mt-1 w-full card max-h-52 overflow-y-auto">
                {prodResults!.products.map((r) => (
                  <button type="button" key={r.id} className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 flex justify-between" onClick={() => addLine(r)}>
                    <span>{r.name} {r.type !== "STANDARD" && <span className="text-muted">({r.type.toLowerCase()})</span>}</span>
                    <span className="money text-muted">{fmtMoney(r.costPrice)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {lines.length === 0 ? (
            <div className="rounded-lg border border-dashed border-edge py-8 text-center">
              <Package size={22} className="mx-auto text-faint mb-1.5" />
              <p className="text-sm text-muted">No items yet — search above to add products.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-edge overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs">
                    <th className="px-3 py-2 font-semibold">Product</th>
                    <th className="px-3 py-2 font-semibold w-28 text-right">Qty</th>
                    <th className="px-3 py-2 font-semibold w-32 text-right">Cost</th>
                    <th className="px-3 py-2 font-semibold w-28 text-right">Total</th>
                    <th className="px-3 py-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.productId} className="border-b border-edge last:border-0">
                      <td className="px-3 py-1.5">{l.name} <span className="mono text-muted text-xs">{l.sku}</span></td>
                      <td className="px-3 py-1.5">
                        <input className="input mono !py-1 text-right" type="number" step="any" min="0" value={l.qty}
                          onChange={(e) => setLines(lines.map((x, idx) => idx === i ? { ...x, qty: e.target.value } : x))} />
                      </td>
                      <td className="px-3 py-1.5">
                        <input className="input mono !py-1 text-right" type="number" step="0.01" min="0" value={l.unitCost}
                          onChange={(e) => setLines(lines.map((x, idx) => idx === i ? { ...x, unitCost: e.target.value } : x))} />
                        {allocateOn && landedUnits[i] !== (Number(l.unitCost) || 0) && (
                          <div className="text-[10px] text-accent money text-right mt-0.5" title="Cost including its freight share (goes into stock value & profit)">landed {fmtMoney(landedUnits[i])}</div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right money">{fmtMoney((Number(l.qty) || 0) * (Number(l.unitCost) || 0))}</td>
                      <td className="px-3 py-1.5">
                        <button type="button" className="text-muted hover:text-danger" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} aria-label={`Remove ${l.name}`}><X size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </FormSection>

        <FormSection title="Charges & payment" icon={Wallet} color="var(--success)">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted">Bill discount</span>
                <input className="input mono !w-32 !py-1 text-right" type="number" step="0.01" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted" title="Enter costs in this currency; they convert to PKR at the rate below">Currency</span>
                <select className="input !w-32 !py-1 text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {["PKR", "USD", "AED", "SAR", "CNY", "EUR", "GBP"].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {currency !== "PKR" && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted">1 {currency} = ₨</span>
                  <input className="input mono !w-32 !py-1 text-right" type="number" step="0.0001" min="0" value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted">Tax</span>
                <input className="input mono !w-32 !py-1 text-right" type="number" step="0.01" min="0" value={tax} onChange={(e) => setTax(e.target.value)} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted">Freight / loading</span>
                <input className="input mono !w-32 !py-1 text-right" type="number" step="0.01" min="0" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} />
              </div>
              {freightPool > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted" title="Spread freight into each item's cost so stock value & profit are accurate (landed cost)">Add freight to cost</span>
                  <select className="input !w-32 !py-1 text-sm" value={landedBasis} onChange={(e) => setLandedBasis(e.target.value as LandedBasis)}>
                    <option value="VALUE">By value</option>
                    <option value="QTY">By quantity</option>
                    <option value="NONE">No (expense)</option>
                  </select>
                </div>
              )}
              {allocateOn && (
                <p className="text-[11px] text-muted">Freight {fmtMoney(freightPool)} is spread into each item's cost — stock value & profit use the landed cost. Turn off to book it as a straight expense.</p>
              )}
            </div>
            <div className="rounded-lg bg-surface-2 border border-edge p-3 space-y-2 self-start">
              <div className="flex items-center justify-between"><span className="text-sm text-muted">Sub-total</span><span className="money">{fmtMoney(subTotal)}</span></div>
              <div className="flex items-center justify-between rounded-md px-2.5 py-2 text-base font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent-hover)" }}>
                <span>Grand total</span><span className="money">{fmtMoney(grand)}</span>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <select className="input !py-1 text-sm" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                  <option value="">Pay now via…</option>
                  {(methodData?.methods ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <input className="input mono !w-32 !py-1 text-right" type="number" step="0.01" min="0" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} aria-label="Paid amount" />
              </div>
              <div className="flex items-center justify-between text-sm"><span className="text-muted">Due (udhaar)</span><span className={`money font-semibold ${due > 0 ? "text-danger" : "text-success"}`}>{fmtMoney(due)}</span></div>
            </div>
          </div>
        </FormSection>

        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save purchase"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ─────────────── View + return ─────────────── */
function ViewPurchase({ purchase, onClose, onReturned }: { purchase: Purchase; onClose: () => void; onReturned: () => void }) {
  const { toast } = useToast();
  const { can } = useAuth();
  const { data } = useQuery({ queryKey: ["purchase", purchase.id], queryFn: () => api<{ purchase: Purchase }>(`/purchases/${purchase.id}`) });
  const { data: setg } = useQuery({ queryKey: ["settings-public"], queryFn: () => api<{ settings: Record<string, string> }>("/settings/public") });
  const p = data?.purchase ?? purchase;
  const shopName = setg?.settings?.shop_name || "SoftGlaze";
  const waHref = p.isReturn ? "" : waLink(p.vendor?.phone, `${shopName}\nBill ${p.invoiceNo}\nTotal ${fmtMoney(p.grandTotal)} · Paid ${fmtMoney(p.paidAmount)} · Balance ${fmtMoney(p.dueAmount)}\nThank you.`);
  const [returnMode, setReturnMode] = useState(false);
  const [retQty, setRetQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const doReturn = useMutation({
    mutationFn: () => {
      const items = Object.entries(retQty).map(([purchaseItemId, q]) => ({ purchaseItemId, qty: Number(q) || 0 })).filter((i) => i.qty > 0);
      return api<{ purchase: Purchase }>(`/purchases/${p.id}/return`, { method: "POST", body: { items } });
    },
    onSuccess: (d) => { toast(`Return ${d.purchase.invoiceNo} saved`); onReturned(); },
    onError: (e: ApiError) => setError(e.message),
  });

  const canReturn = can("purchases.return") && !p.isReturn && p.status === "RECEIVED";
  const anyRet = Object.values(retQty).some((q) => (Number(q) || 0) > 0);

  return (
    <Modal open onClose={onClose} title={`${p.isReturn ? "Return " : "Purchase "}${p.invoiceNo}`} wide>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <div><span className="text-muted">Vendor:</span> {p.vendor?.name}</div>
          <div><span className="text-muted">Date:</span> {new Date(p.date).toLocaleString()}</div>
          {p.refInvoiceNo && <div><span className="text-muted">Vendor bill:</span> <span className="mono">{p.refInvoiceNo}</span></div>}
          <div><span className="text-muted">By:</span> {p.user?.name}</div>
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-edge text-xs">
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-3 py-2 font-medium text-right">Cost</th>
                <th className="px-3 py-2 font-medium text-right">Total</th>
                {returnMode && <th className="px-3 py-2 font-medium text-right w-28">Return qty</th>}
              </tr>
            </thead>
            <tbody>
              {p.items.map((it) => (
                <tr key={it.id} className="border-b border-edge last:border-0">
                  <td className="px-3 py-1.5">{it.product?.name} <span className="mono text-muted text-xs">{it.product?.sku}</span></td>
                  <td className="px-3 py-1.5 text-right mono">{fmtQty(it.qty)} {it.product?.unit?.shortName}</td>
                  <td className="px-3 py-1.5 text-right money">
                    {fmtMoney(it.unitCost)}
                    {it.landedUnitCost && num(it.landedUnitCost) !== num(it.unitCost) && (
                      <div className="text-[10px] text-accent mono" title="Cost including freight share (used for stock value & profit)">landed {fmtMoney(it.landedUnitCost)}</div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right money">{fmtMoney(it.total)}</td>
                  {returnMode && (
                    <td className="px-3 py-1.5">
                      <input className="input mono !py-1 text-right" type="number" step="any" min="0" max={num(it.qty)} value={retQty[it.id] ?? ""}
                        onChange={(e) => setRetQty({ ...retQty, [it.id]: e.target.value })} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div><span className="text-muted">Sub-total</span><div className="money">{fmtMoney(p.subTotal)}</div></div>
          <div><span className="text-muted">Grand total</span><div className="money font-semibold">{fmtMoney(p.grandTotal)}</div></div>
          <div><span className="text-muted">Paid</span><div className="money">{fmtMoney(p.paidAmount)}</div></div>
          <div><span className="text-muted">Due</span><div className={`money ${num(p.dueAmount) > 0 ? "text-danger" : ""}`}>{fmtMoney(p.dueAmount)}</div></div>
        </div>
        {num(p.otherCharges) > 0 && (
          <p className="text-xs text-muted">
            Freight/loading {fmtMoney(p.otherCharges)}
            {p.landedBasis && p.landedBasis !== "NONE"
              ? ` — added to item cost (landed, by ${p.landedBasis === "QTY" ? "quantity" : "value"}).`
              : " — booked as an expense (not in item cost)."}
          </p>
        )}

        {error && <p className="text-danger text-sm">{error}</p>}

        <div className="flex justify-end gap-2">
          {canReturn && !returnMode && (
            <button className="btn btn-secondary" onClick={() => setReturnMode(true)}><Undo2 size={15} /> Return items</button>
          )}
          {returnMode && (
            <>
              <button className="btn btn-secondary" onClick={() => { setReturnMode(false); setRetQty({}); }}>Cancel return</button>
              <button className="btn btn-danger" disabled={!anyRet || doReturn.isPending} onClick={() => doReturn.mutate()}>
                {doReturn.isPending ? "Saving…" : "Confirm return"}
              </button>
            </>
          )}
          {!returnMode && waHref && <a className="btn btn-secondary" href={waHref} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp vendor</a>}
          {!returnMode && <button className="btn btn-secondary" onClick={onClose}>Close</button>}
        </div>
      </div>
    </Modal>
  );
}
