import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X, Plus, Trash2, UserPlus, ArrowLeft, Pause, FileText, CheckCircle2, Printer, Package, Scale, FileSignature, MapPin, Star, ShoppingCart } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Product, Customer, Category, PaymentMethod, Sale, WeightCalc, RateResolution, SiteBalancesView } from "../lib/types";
import { num, fmtMoney, fmtQty } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { useToast, Modal } from "../components/ui";
import ThemeToggle from "../components/ThemeToggle";
import Calculator from "../components/Calculator";
import WeightCalcPanel, { type WeightProfile } from "../components/WeightCalcPanel";
import { printReceipt } from "../lib/receipt";
import { waLink as buildWaLink } from "../lib/phone";

type Line = { productId: string; name: string; sku: string; type: Product["type"]; unitShort: string; qty: string; unitPrice: string; listPrice: string; contractPriced: boolean; priceEdited: boolean; discount: string; stock: number; calc: (WeightProfile & { weightCalc: WeightCalc }) | null };
type PayRow = { methodId: string; amount: string };
type SelCustomer = { id: string; name: string; phone: string | null; balance: string; creditLimit: string; loyaltyPoints?: number } | null;

export default function POS() {
  const { can } = useAuth();
  const { toast } = useToast();
  const canEditPrice = can("sales.discount_over_limit");

  const [cart, setCart] = useState<Line[]>([]);
  const [customer, setCustomer] = useState<SelCustomer>(null);
  const [billDiscount, setBillDiscount] = useState("0");
  const [redeemPoints, setRedeemPoints] = useState("0");
  const [tax, setTax] = useState("0");
  const [otherCharges, setOtherCharges] = useState("0");
  const [payments, setPayments] = useState<PayRow[]>([]);
  const [payTouched, setPayTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [prodSearch, setProdSearch] = useState("");
  const [catFilter, setCatFilter] = useState(""); // "" = All categories
  const [success, setSuccess] = useState<Sale | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  const [showQuotes, setShowQuotes] = useState(false);
  const [quickAdd, setQuickAdd] = useState<{ name: string; phone: string } | null>(null);
  const [calcLine, setCalcLine] = useState<number | null>(null); // C1 — which cart line has the weight calculator open
  const [siteId, setSiteId] = useState(""); // C4 — customer site this sale is for
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api<{ settings: Record<string, string> }>("/settings") });
  const { data: methodData } = useQuery({ queryKey: ["payment-methods"], queryFn: () => api<{ methods: PaymentMethod[] }>("/payment-methods") });
  const { data: prodResults } = useQuery({
    queryKey: ["pos-prod", prodSearch],
    queryFn: () => api<{ products: Product[] }>(`/products/search?q=${encodeURIComponent(prodSearch)}`),
    enabled: prodSearch.trim().length > 0,
  });
  // Default catalog shown before searching — click any tile to add it.
  const { data: allProducts } = useQuery({ queryKey: ["pos-all-products"], queryFn: () => api<{ products: Product[] }>("/products?limit=100&status=active") });
  // Category sidebar images/names come from the categories endpoint (products only carry id+name).
  const { data: catData } = useQuery({ queryKey: ["categories"], queryFn: () => api<{ categories: Category[] }>("/categories") });
  // C3 — the selected customer's contract rates in force today (auto-fill the sale line).
  const { data: rateData } = useQuery({
    queryKey: ["pos-rates", customer?.id],
    queryFn: () => api<RateResolution>(`/rate-contracts/rates/${customer!.id}`),
    enabled: !!customer?.id,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const rateMap = useMemo(() => new Map((rateData?.rates ?? []).map((r) => [r.productId, r.price])), [rateData]);
  const activeContract = customer && rateData?.primary ? rateData.primary : null;
  // C4 — the selected customer's sites, to tag this sale to a site/project.
  const { data: siteData } = useQuery({
    queryKey: ["pos-sites", customer?.id],
    queryFn: () => api<SiteBalancesView>(`/customer-sites?customerId=${customer!.id}`),
    enabled: !!customer?.id,
    staleTime: 60_000,
  });
  const customerSites = (siteData?.sites ?? []).filter((s) => s.isActive);
  const methods = methodData?.methods ?? [];
  // G1 — quick-sale favourites (product IDs saved in the pos_favourites setting).
  const qc = useQueryClient();
  const favIds = useMemo(() => new Set((settings?.settings.pos_favourites || "").split(",").map((s) => s.trim()).filter(Boolean)), [settings]);
  const favProducts = (allProducts?.products ?? []).filter((p) => favIds.has(p.id));
  async function toggleFav(id: string) {
    const next = favIds.has(id) ? [...favIds].filter((x) => x !== id) : [...favIds, id];
    try { await api("/settings", { method: "PATCH", body: { pos_favourites: next.join(",") } }); qc.invalidateQueries({ queryKey: ["settings"] }); }
    catch (e) { toast((e as ApiError).message || "Couldn't update favourites", "error"); }
  }
  const cashMethodId = methods.find((m) => m.isCash)?.id ?? methods[0]?.id ?? "";

  const subTotal = cart.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0) - (Number(l.discount) || 0), 0);
  // G4 — loyalty redemption folds into the bill discount (server recomputes the same way).
  const loyaltyOn = settings?.settings.loyalty_enabled === "1";
  const redeemValue = Number(settings?.settings.loyalty_redeem_value || 1);
  const maxRedeem = Math.min(customer?.loyaltyPoints ?? 0, redeemValue > 0 ? Math.floor(subTotal / redeemValue) : 0);
  const pointsDiscount = customer && loyaltyOn ? Math.round(Math.min((Number(redeemPoints) || 0) * redeemValue, subTotal) * 100) / 100 : 0;
  const grand = Math.max(0, subTotal - (Number(billDiscount) || 0) - pointsDiscount + (Number(tax) || 0) + (Number(otherCharges) || 0));
  // A5 round-off: round the payable to the nearest N (setting) — server recomputes the same way.
  const roundTo = Number(settings?.settings.round_off_to || 0);
  const payable = roundTo > 0 ? Math.round(grand / roundTo) * roundTo : grand;
  const roundOff = Math.round((payable - grand) * 100) / 100;
  const paidSum = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const due = Math.max(0, payable - paidSum);
  const change = Math.max(0, paidSum - payable);
  // Category sidebar — real categories (with images) that actually have products in the catalog.
  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of allProducts?.products ?? []) if (p.category) m.set(p.category.id, (m.get(p.category.id) ?? 0) + 1);
    return m;
  }, [allProducts]);
  const categories = useMemo(
    () => (catData?.categories ?? []).filter((c) => catCounts.has(c.id)),
    [catData, catCounts]
  );
  // Grid shows search hits while typing, otherwise the whole active catalog (optionally filtered by category).
  const shownProducts = prodSearch.trim()
    ? (prodResults?.products ?? [])
    : (allProducts?.products ?? []).filter((p) => !catFilter || p.category?.id === catFilter);

  // One default cash row that tracks the grand total until the cashier edits payments
  useEffect(() => {
    if (!cashMethodId) return;
    if (payments.length === 0) { setPayments([{ methodId: cashMethodId, amount: payable ? payable.toFixed(2) : "" }]); return; }
    if (!payTouched && payments.length === 1) setPayments([{ methodId: payments[0].methodId, amount: payable ? payable.toFixed(2) : "" }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payable, cashMethodId]);

  // C3 — when the customer (and their contract rates) change, re-price every cart line the
  // cashier hasn't manually edited: contract rate if the product is covered, else list price.
  useEffect(() => {
    setCart((c) => c.map((l) => {
      if (l.priceEdited) return l;
      const cr = rateMap.get(l.productId);
      return cr != null ? { ...l, unitPrice: String(cr), contractPriced: true } : { ...l, unitPrice: l.listPrice, contractPriced: false };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id, rateData]);

  // C4 — clear the site tag whenever the customer changes.
  useEffect(() => { setSiteId(""); }, [customer?.id]);

  function addProduct(p: Product) {
    setProdSearch("");
    setCart((c) => {
      const found = c.find((l) => l.productId === p.id);
      if (found) return c.map((l) => (l.productId === p.id ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l));
      const calc = p.weightCalc && p.weightCalc !== "NONE"
        ? { weightCalc: p.weightCalc, diameterMm: p.diameterMm, thicknessMm: p.thicknessMm, sheetWidthFt: p.sheetWidthFt, pieceLengthFt: p.pieceLengthFt, densityKgM3: p.densityKgM3 }
        : null;
      const list = num(p.salePrice);
      const contractRate = rateMap.get(p.id); // C3 — this customer's agreed rate, if any
      const priced = contractRate != null ? contractRate : list;
      return [...c, { productId: p.id, name: p.name, sku: p.sku, type: p.type, unitShort: p.unit?.shortName ?? "", qty: "1", unitPrice: String(priced), listPrice: String(list), contractPriced: contractRate != null, priceEdited: false, discount: "0", stock: num(p.stockQty), calc }];
    });
    searchRef.current?.focus();
  }
  function setLine(i: number, patch: Partial<Line>) { setCart((c) => c.map((l, idx) => (idx === i ? { ...l, ...patch } : l))); }
  function removeLine(i: number) { setCart((c) => c.filter((_, idx) => idx !== i)); }
  function resetSale() {
    setCart([]); setCustomer(null); setBillDiscount("0"); setRedeemPoints("0"); setTax("0"); setOtherCharges("0");
    setPayments([]); setPayTouched(false); setNotes(""); setError(null); setSuccess(null); setSiteId("");
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  async function submit(status: "COMPLETED" | "DRAFT" | "QUOTATION", overrideCredit = false, overrideDiscount = false) {
    if (cart.length === 0) { setError("Cart is empty."); return; }
    setBusy(true); setError(null);
    // applied payments capped to the rounded payable (extra cash is change, not applied)
    let remaining = payable;
    const applied = status === "COMPLETED"
      ? payments.filter((p) => (Number(p.amount) || 0) > 0 && p.methodId).map((p) => {
          const amt = Math.min(Number(p.amount) || 0, remaining); remaining = Math.round((remaining - amt) * 100) / 100; return { methodId: p.methodId, amount: amt };
        }).filter((p) => p.amount > 0)
      : [];
    const body: Record<string, unknown> = {
      customerId: customer?.id ?? null,
      siteId: customer && siteId ? siteId : null,
      items: cart.map((l) => ({ productId: l.productId, qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice) || 0, discount: Number(l.discount) || 0 })),
      discount: Number(billDiscount) || 0, tax: Number(tax) || 0, otherCharges: Number(otherCharges) || 0,
      notes: notes || null, status, payments: applied, overrideCredit, overrideDiscount,
      redeemPoints: customer && Number(redeemPoints) > 0 ? Math.floor(Number(redeemPoints)) : 0,
      clientRef: crypto.randomUUID?.() ?? `off-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    };
    // H7 — offline mode: if there's no connection, queue a COMPLETED sale locally and sync later.
    if (status === "COMPLETED" && typeof navigator !== "undefined" && navigator.onLine === false) {
      const queue = JSON.parse(localStorage.getItem("pos-offline-queue") || "[]");
      queue.push(body); localStorage.setItem("pos-offline-queue", JSON.stringify(queue));
      toast("Saved offline — it will sync when the connection returns");
      setBusy(false); resetSale(); return;
    }
    try {
      const { sale } = await api<{ sale: Sale }>("/sales", { method: "POST", body });
      if (status === "COMPLETED") { setSuccess(sale); }
      else { toast(status === "DRAFT" ? `Held as ${sale.invoiceNo}` : `Quotation ${sale.invoiceNo} saved`); resetSale(); }
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "CREDIT_LIMIT_EXCEEDED" && can("sales.discount_over_limit")) {
        if (window.confirm(`${err.message}\n\nProceed anyway (you have override permission)?`)) { setBusy(false); return submit(status, true, overrideDiscount); }
      } else if (err.code === "DISCOUNT_APPROVAL" && can("sales.discount_over_limit")) {
        if (window.confirm(`${err.message}\n\nApprove this discount (you have override permission)?`)) { setBusy(false); return submit(status, overrideCredit, true); }
      } else if (err.code === "DISCOUNT_APPROVAL") {
        setError(`${err.message}. A manager must approve.`);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  // Keyboard: F2 search · F6 hold · F9 focus pay · F10 complete · Esc close overlays
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "F10") { e.preventDefault(); if (!busy && cart.length && !success) submit("COMPLETED"); }
      else if (e.key === "F6") { e.preventDefault(); if (!busy && cart.length && !success) submit("DRAFT"); }
      else if (e.key === "Enter" && success) { e.preventDefault(); resetSale(); }
      else if (e.key === "Escape") { setShowHeld(false); setShowQuotes(false); setQuickAdd(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, cart, success, customer, payments, billDiscount, tax, otherCharges, notes]);

  useEffect(() => { searchRef.current?.focus(); }, []);

  // H7 — flush any offline-queued sales on load + whenever the connection returns.
  // The server dedupes by clientRef, so re-sending a synced sale is harmless.
  useEffect(() => {
    async function flush() {
      const queue = JSON.parse(localStorage.getItem("pos-offline-queue") || "[]");
      if (!queue.length) return;
      const remaining: unknown[] = [];
      for (const b of queue) { try { await api("/sales", { method: "POST", body: b }); } catch { remaining.push(b); } }
      localStorage.setItem("pos-offline-queue", JSON.stringify(remaining));
      const synced = queue.length - remaining.length;
      if (synced > 0) { toast(`Synced ${synced} offline sale${synced > 1 ? "s" : ""}`); qc.invalidateQueries({ queryKey: ["pos-all-products"] }); }
    }
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // G5 — mirror the live cart to a customer-facing 2nd screen (open /pos/display in another window).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel("pos-display");
    bc.postMessage({
      shop: settings?.settings.shop_name || "SoftGlaze",
      symbol: settings?.settings.currency_symbol || "₨",
      items: cart.map((l) => ({ name: l.name, qty: Number(l.qty) || 0, price: Number(l.unitPrice) || 0, total: Math.round(((Number(l.qty) || 0) * (Number(l.unitPrice) || 0) - (Number(l.discount) || 0)) * 100) / 100 })),
      payable,
      done: success ? { invoiceNo: success.invoiceNo, total: num(success.grandTotal), change } : null,
    });
    bc.close();
  }, [cart, payable, success, settings, change]);

  return (
    <div className="h-screen flex flex-col bg-app">
      <div className="w-full max-w-[1560px] mx-auto flex-1 flex flex-col min-h-0 bg-surface lg:border-x border-edge">
      {/* Top bar */}
      <header className="h-12 shrink-0 border-b border-edge flex items-center gap-3 px-3 bg-surface">
        <Link to="/" className="btn btn-secondary !p-2" title="Back to dashboard"><ArrowLeft size={16} /></Link>
        <span className="font-bold display">{settings?.settings.shop_name || "SoftGlaze"} · POS</span>
        <div className="flex-1" />
        <button className="btn btn-secondary !py-1.5" onClick={() => setShowHeld(true)}><Pause size={15} /> Held</button>
        <button className="btn btn-secondary !py-1.5" onClick={() => setShowQuotes(true)}><FileText size={15} /> Quotes</button>
        <ThemeToggle />
      </header>

      <div className={`flex-1 grid min-h-0 ${categories.length > 0 ? "lg:grid-cols-[214px_1fr_420px]" : "lg:grid-cols-[1fr_420px]"}`}>
        {/* Category sidebar (with images) */}
        {categories.length > 0 && (
          <aside className="border-b lg:border-b-0 lg:border-r border-edge bg-surface-2/40 flex lg:flex-col gap-1.5 p-2 overflow-x-auto lg:overflow-y-auto shrink-0">
            <CatButton active={catFilter === ""} onClick={() => { setCatFilter(""); setProdSearch(""); }} name="All items" count={allProducts?.products?.length ?? 0} img={null} />
            {categories.map((c) => (
              <CatButton key={c.id} active={catFilter === c.id} onClick={() => { setCatFilter(c.id); setProdSearch(""); }} name={c.name} count={catCounts.get(c.id) ?? 0} img={c.image ?? null} />
            ))}
          </aside>
        )}

        {/* Products */}
        <div className="flex flex-col min-h-0 border-r border-edge">
          <div className="p-3 border-b border-edge">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                ref={searchRef}
                className="input !pl-9"
                value={prodSearch}
                onChange={(e) => setProdSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && prodResults?.products.length) { e.preventDefault(); addProduct(prodResults.products[0]); } }}
                placeholder="Search product by name / SKU / barcode  (F2)"
              />
            </div>
          </div>
          {favProducts.length > 0 && !prodSearch.trim() && (
            <div className="px-3 pt-2 border-b border-edge">
              <div className="text-[11px] text-muted mb-1 flex items-center gap-1"><Star size={11} className="text-accent" /> Favourites</div>
              <div className="flex flex-wrap gap-1.5 pb-2">
                {favProducts.map((p) => (
                  <button key={p.id} onClick={() => addProduct(p)} className="px-2.5 py-1 rounded-lg border border-edge bg-surface-2 text-xs hover:border-accent flex items-center gap-1.5">
                    {p.name} <span className="money text-muted">{fmtMoney(p.salePrice)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2.5 content-start">
            {shownProducts.length === 0 ? (
              <div className="col-span-full text-center text-muted py-16">
                <Package size={28} className="mx-auto mb-2 opacity-60" />
                {prodSearch.trim() ? `No products match "${prodSearch}".` : "No products in this category yet."}
              </div>
            ) : (
              shownProducts.map((p) => {
                const out = p.type === "STANDARD" && num(p.stockQty) <= 0;
                return (
                  <button key={p.id} onClick={() => addProduct(p)} className="card p-0 text-left overflow-hidden hover:border-accent hover:shadow-[var(--shadow-md)] transition-all flex flex-col relative group h-52">
                    <div className="relative w-full flex-1 min-h-0 bg-surface-2 grid place-items-center overflow-hidden">
                      {p.images?.[0] ? <img src={p.images[0].thumbPath ?? p.images[0].path} alt={p.name} className="w-full h-full object-cover" loading="lazy" /> : <Package size={34} className="text-faint" />}
                      <span role="button" tabIndex={-1} title={favIds.has(p.id) ? "Remove from favourites" : "Add to favourites"} onClick={(e) => { e.stopPropagation(); toggleFav(p.id); }} className={`absolute top-1.5 right-1.5 ${favIds.has(p.id) ? "text-accent" : "text-faint opacity-0 group-hover:opacity-100"}`}><Star size={14} fill={favIds.has(p.id) ? "currentColor" : "none"} /></span>
                      {p.type === "STANDARD"
                        ? (out
                            ? <span className="absolute bottom-1.5 left-1.5 pill text-white" style={{ background: "var(--danger)" }}>Out</span>
                            : <span className="absolute bottom-1.5 left-1.5 pill glass text-muted border border-edge">{fmtQty(p.stockQty)} {p.unit?.shortName}</span>)
                        : <span className="absolute bottom-1.5 left-1.5 pill glass text-muted border border-edge">{p.type === "SERVICE" ? "Service" : "Combo"}</span>}
                    </div>
                    <div className="p-2 shrink-0 flex items-center justify-between gap-1.5 border-t border-edge">
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-semibold leading-tight line-clamp-1">{p.name}</p>
                        <p className="money text-sm font-bold text-success mt-0.5">{fmtMoney(p.salePrice)}</p>
                      </div>
                      <span className="w-7 h-7 shrink-0 rounded-lg bg-success/15 text-success grid place-items-center group-hover:bg-success group-hover:text-white transition-colors"><Plus size={15} /></span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Cart / checkout */}
        <div className="flex flex-col min-h-0 bg-surface">
          {/* Customer */}
          <div className="p-3 border-b border-edge">
            <CustomerBar customer={customer} onPick={setCustomer} onQuickAdd={() => setQuickAdd({ name: "", phone: "" })} />
            {activeContract && (
              <div className="mt-2 text-xs text-accent bg-accent/10 border border-accent/30 rounded px-2 py-1 flex items-center gap-1.5">
                <FileSignature size={12} /> Contract {activeContract.refNo} — agreed rates apply (until {new Date(activeContract.validUntil).toLocaleDateString("en-GB")})
              </div>
            )}
            {customer && customerSites.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <MapPin size={14} className="text-muted shrink-0" />
                <select className="input !py-1 text-sm" value={siteId} onChange={(e) => setSiteId(e.target.value)} title="Tag this sale to a site/project">
                  <option value="">No specific site</option>
                  {customerSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Order details header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-edge shrink-0">
            <h3 className="font-bold display text-sm flex items-center gap-1.5"><ShoppingCart size={15} className="text-accent" /> Order Details</h3>
            <span className="pill bg-surface-2 text-muted">{cart.length} item{cart.length === 1 ? "" : "s"}</span>
          </div>

          {/* Lines */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="text-center py-16 px-4">
                <div className="w-16 h-16 mx-auto rounded-[10px] bg-surface-2 grid place-items-center mb-3"><ShoppingCart size={28} className="text-faint" /></div>
                <p className="font-semibold text-sm">No products selected</p>
                <p className="text-muted text-xs mt-1">Search on the left and tap a product to add it.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {cart.map((l, i) => (
                    <tr key={l.productId} className="border-b border-edge align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium leading-tight">{l.name}</div>
                        <div className="mono text-muted text-xs">{l.sku}{l.type !== "STANDARD" && ` · ${l.type.toLowerCase()}`}{l.contractPriced && <span className="text-accent"> · contract</span>}{l.type === "STANDARD" && num(l.qty) > l.stock && <span className="text-danger"> · only {l.stock} in stock</span>}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <input className="input mono !py-1 !w-16 text-right" type="number" step="any" min="0" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} aria-label="Qty" />
                          {l.calc && (
                            <button type="button" className="text-accent hover:text-accent/80 shrink-0" onClick={() => setCalcLine(i)} title="Weight calculator — fill qty from size">
                              <Scale size={15} />
                            </button>
                          )}
                          <span className="text-muted text-xs">{l.unitShort} ×</span>
                          <input className="input mono !py-1 !w-24 text-right" type="number" step="0.01" min="0" value={l.unitPrice} readOnly={!canEditPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value, priceEdited: true, contractPriced: false })} aria-label="Unit price" title={canEditPrice ? "" : "Price editing needs permission"} />
                          <span className="text-muted text-xs" title="Discount on this item">− </span>
                          <input className="input mono !py-1 !w-20 text-right" type="number" step="0.01" min="0" value={l.discount} onChange={(e) => setLine(i, { discount: e.target.value })} aria-label="Item discount" title="Discount on this item (Rs)" />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="money font-medium">{fmtMoney((Number(l.qty) || 0) * (Number(l.unitPrice) || 0) - (Number(l.discount) || 0))}</div>
                        <button className="text-muted hover:text-danger mt-1" onClick={() => removeLine(i)} aria-label="Remove line"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Totals + payment (sticky footer) */}
          <div className="shrink-0 border-t border-edge p-3 space-y-2 bg-surface">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <label className="text-muted">Discount<input className="input mono !py-1 text-right mt-0.5" type="number" step="0.01" min="0" value={billDiscount} onChange={(e) => setBillDiscount(e.target.value)} /></label>
              <label className="text-muted">Tax<input className="input mono !py-1 text-right mt-0.5" type="number" step="0.01" min="0" value={tax} onChange={(e) => setTax(e.target.value)} /></label>
              <label className="text-muted">Delivery<input className="input mono !py-1 text-right mt-0.5" type="number" step="0.01" min="0" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} /></label>
            </div>
            {customer && loyaltyOn && (customer.loyaltyPoints ?? 0) > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Redeem points <span className="text-accent">({customer.loyaltyPoints} available)</span></span>
                <span className="flex items-center gap-1">
                  <input className="input mono !py-0.5 !w-20 text-right" type="number" min="0" max={maxRedeem} value={redeemPoints} onChange={(e) => setRedeemPoints(e.target.value)} />
                  {pointsDiscount > 0 && <span className="money text-success text-xs">−{fmtMoney(pointsDiscount)}</span>}
                </span>
              </div>
            )}
            {roundOff !== 0 && (
              <div className="flex items-center justify-between text-sm text-muted">
                <span>Round off</span><span className="money">{roundOff > 0 ? "+" : ""}{fmtMoney(roundOff)}</span>
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg px-3 py-2.5 text-lg font-extrabold" style={{ background: "var(--accent-soft)", color: "var(--accent-hover)" }}>
              <span>Grand total</span><span className="money">{fmtMoney(payable)}</span>
            </div>

            {/* Payments */}
            <div className="space-y-1.5">
              {payments.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select className="input !py-1 text-sm" value={p.methodId} onChange={(e) => { setPayTouched(true); setPayments(payments.map((x, idx) => idx === i ? { ...x, methodId: e.target.value } : x)); }}>
                    {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input className="input mono !py-1 !w-28 text-right" type="number" step="0.01" min="0" value={p.amount} onChange={(e) => { setPayTouched(true); setPayments(payments.map((x, idx) => idx === i ? { ...x, amount: e.target.value } : x)); }} aria-label="Amount" />
                  {payments.length > 1 && <button className="text-muted hover:text-danger" onClick={() => { setPayTouched(true); setPayments(payments.filter((_, idx) => idx !== i)); }}><X size={14} /></button>}
                </div>
              ))}
              <div className="flex items-center gap-2 text-xs">
                <button className="text-accent" onClick={() => { setPayTouched(true); setPayments([...payments, { methodId: cashMethodId, amount: "" }]); }}>+ split payment</button>
                <button className="text-muted hover:text-ink" onClick={() => { setPayTouched(true); setPayments([{ methodId: cashMethodId, amount: "0" }]); }}>udhaar (pay later)</button>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm">
              {change > 0 ? <><span className="text-muted">Change to return</span><span className="money text-success">{fmtMoney(change)}</span></>
                : <><span className="text-muted">Balance (udhaar)</span><span className={`money ${due > 0 ? "text-danger" : ""}`}>{fmtMoney(due)}</span></>}
            </div>

            {error && <p className="text-danger text-sm">{error}</p>}

            <div className="grid grid-cols-3 gap-2 pt-1">
              <button className="btn btn-secondary" disabled={busy || !cart.length} onClick={() => submit("DRAFT")} title="Hold (F6)"><Pause size={15} /> Hold</button>
              <button className="btn btn-secondary" disabled={busy || !cart.length} onClick={() => submit("QUOTATION")}><FileText size={15} /> Quote</button>
              <button className="btn btn-money" disabled={busy || !cart.length} onClick={() => submit("COMPLETED")} title="Complete (F10)"><CheckCircle2 size={15} /> {busy ? "…" : "Complete"}</button>
            </div>
          </div>
        </div>
      </div>
      </div>

      {success && <SuccessOverlay sale={success} settings={settings?.settings ?? {}} onNew={resetSale} />}
      {showHeld && <ParkedTray kind="held" onClose={() => setShowHeld(false)} onResume={(s) => { loadSale(s); setShowHeld(false); }} />}
      {showQuotes && <ParkedTray kind="quotations" onClose={() => setShowQuotes(false)} onResume={(s) => { loadSale(s); setShowQuotes(false); }} />}
      {quickAdd && <QuickAddCustomer form={quickAdd} onClose={() => setQuickAdd(null)} onCreated={(c) => { setCustomer(c); setQuickAdd(null); }} />}
      {calcLine !== null && cart[calcLine]?.calc && (
        <Modal open onClose={() => setCalcLine(null)} title={`Weight calculator — ${cart[calcLine].name}`}>
          <WeightCalcPanel
            profile={cart[calcLine].calc!}
            applyUnit={cart[calcLine].unitShort}
            onApply={(qty) => { setLine(calcLine, { qty: String(qty) }); setCalcLine(null); toast(`Qty set to ${fmtQty(qty)} ${cart[calcLine!].unitShort}`); }}
          />
        </Modal>
      )}
      <Calculator />
    </div>
  );

  function loadSale(s: Sale) {
    setCart(s.items.map((it) => ({ productId: it.productId, name: it.product?.name ?? "", sku: it.product?.sku ?? "", type: it.product?.type ?? "STANDARD", unitShort: it.product?.unit?.shortName ?? "", qty: String(num(it.qty)), unitPrice: String(num(it.unitPrice)), listPrice: String(num(it.unitPrice)), contractPriced: false, priceEdited: true, discount: String(num(it.discount)), stock: 0, calc: null })));
    setCustomer(s.customer ? { id: s.customer.id, name: s.customer.name, phone: s.customer.phone, balance: "0", creditLimit: "0" } : null);
    setBillDiscount(String(num(s.discount))); setTax(String(num(s.tax))); setOtherCharges(String(num(s.otherCharges)));
    setPayTouched(false); setPayments([]); setError(null);
    // remove the parked doc so it isn't double-counted
    api(`/sales/${s.id}`, { method: "DELETE" }).catch(() => {});
    toast(`Loaded ${s.invoiceNo}`);
  }
}

/* ─────────── Category sidebar button ─────────── */
function CatButton({ active, onClick, name, count, img }: { active: boolean; onClick: () => void; name: string; count: number; img: string | null }) {
  return (
    <button
      onClick={onClick}
      title={name}
      className={`shrink-0 lg:w-full flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${active ? "border-accent bg-[var(--accent-soft)] text-accent" : "border-edge bg-surface text-ink hover:border-accent"}`}
    >
      <span className="w-9 h-9 rounded-md overflow-hidden bg-surface-2 border border-edge grid place-items-center shrink-0">
        {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <Package size={16} className="text-faint" />}
      </span>
      <span className="min-w-0 hidden lg:block">
        <span className="block text-[13px] font-semibold truncate">{name}</span>
        <span className="block text-[11px] text-muted">{count} item{count === 1 ? "" : "s"}</span>
      </span>
      <span className="lg:hidden text-[12px] font-semibold whitespace-nowrap pr-1">{name}</span>
    </button>
  );
}

/* ─────────── Customer bar ─────────── */
function CustomerBar({ customer, onPick, onQuickAdd }: { customer: SelCustomer; onPick: (c: SelCustomer) => void; onQuickAdd: () => void }) {
  const [q, setQ] = useState("");
  const { data } = useQuery({ queryKey: ["pos-cust", q], queryFn: () => api<{ customers: Customer[] }>(`/customers?search=${encodeURIComponent(q)}&limit=8`), enabled: q.trim().length > 0 });

  if (customer) {
    const bal = num(customer.balance); const limit = num(customer.creditLimit);
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold truncate">{customer.name}</div>
          <div className="text-xs text-muted">
            {customer.phone && <span className="mono">{customer.phone}</span>}
            {bal !== 0 && <span className={bal > 0 ? "text-danger ml-2" : "text-success ml-2"}>bal {fmtMoney(customer.balance)}</span>}
            {limit > 0 && <span className="ml-2">limit {fmtMoney(customer.creditLimit)}</span>}
            {(customer.loyaltyPoints ?? 0) > 0 && <span className="ml-2 text-accent">{customer.loyaltyPoints} pts</span>}
          </div>
        </div>
        <button className="btn btn-secondary !p-2" onClick={() => onPick(null)} title="Walk-in"><X size={15} /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <div className="flex gap-2">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Walk-in — search customer by name / phone" />
        <button className="btn btn-secondary !p-2 shrink-0" onClick={onQuickAdd} title="Add new customer"><UserPlus size={16} /></button>
      </div>
      {q.trim() && (data?.customers.length ?? 0) > 0 && (
        <div className="absolute z-20 mt-1 w-full card max-h-56 overflow-y-auto">
          {data!.customers.map((c) => (
            <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 flex justify-between" onClick={() => { onPick({ id: c.id, name: c.name, phone: c.phone, balance: c.balance, creditLimit: c.creditLimit, loyaltyPoints: c.loyaltyPoints }); setQ(""); }}>
              <span>{c.name} <span className="mono text-muted text-xs">{c.phone}</span></span>
              {num(c.balance) > 0 && <span className="text-danger text-xs">{fmtMoney(c.balance)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── Quick-add customer ─────────── */
function QuickAddCustomer({ form, onClose, onCreated }: { form: { name: string; phone: string }; onClose: () => void; onCreated: (c: SelCustomer) => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(form.name);
  const [phone, setPhone] = useState(form.phone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const { customer } = await api<{ customer: Customer }>("/customers", { method: "POST", body: { name, phone: phone || null } });
      toast(`${customer.name} added (${customer.code})`);
      onCreated({ id: customer.id, name: customer.name, phone: customer.phone, balance: customer.balance, creditLimit: customer.creditLimit });
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New customer">
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></div>
        <div><label className="label">Phone</label><input className="input mono" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0300 1234567" /></div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Add & select"}</button></div>
      </form>
    </Modal>
  );
}

/* ─────────── Held / quotations tray ─────────── */
function ParkedTray({ kind, onClose, onResume }: { kind: "held" | "quotations"; onClose: () => void; onResume: (s: Sale) => void }) {
  const key = kind === "held" ? "held" : "quotations";
  const { data, isLoading } = useQuery({ queryKey: [`sales-${key}`], queryFn: () => api<Record<string, Sale[]>>(`/sales/${key}`) });
  const list = data?.[key] ?? [];
  return (
    <Modal open onClose={onClose} title={kind === "held" ? "Held bills" : "Quotations"} wide>
      {isLoading ? <p className="text-muted text-sm">Loading…</p> : list.length === 0 ? <p className="text-muted text-sm py-6 text-center">Nothing here yet.</p> : (
        <div className="space-y-2">
          {list.map((s) => (
            <button key={s.id} className="w-full card p-3 text-left hover:border-accent flex items-center justify-between" onClick={() => onResume(s)}>
              <div>
                <div className="font-medium mono">{s.invoiceNo}</div>
                <div className="text-xs text-muted">{s.customer?.name ?? "Walk-in"} · {s.items.length} items · {new Date(s.date).toLocaleString()}</div>
              </div>
              <span className="money font-semibold">{fmtMoney(s.grandTotal)}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ─────────── Success overlay ─────────── */
function SuccessOverlay({ sale, settings, onNew }: { sale: Sale; settings: Record<string, string>; onNew: () => void }) {
  const waLink = buildWaLink(
    sale.customer?.phone,
    `${settings.shop_name || "SoftGlaze"}\nInvoice ${sale.invoiceNo}\nTotal ${fmtMoney(sale.grandTotal)} · Paid ${fmtMoney(sale.paidAmount)} · Balance ${fmtMoney(sale.dueAmount)}\nThank you!`
  ) || null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-[popIn_.12s_ease]">
      <div className="card w-full max-w-sm p-6 text-center !rounded-2xl !shadow-[var(--shadow-lg)] animate-[popIn_.18s_cubic-bezier(.2,.8,.2,1)]">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-success/12 text-success grid place-items-center mb-3"><CheckCircle2 size={30} /></div>
        <h2 className="text-lg font-bold display">Sale complete</h2>
        <p className="text-muted text-sm mono">{sale.invoiceNo}</p>
        <div className="my-4 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted">Grand total</span><span className="money font-semibold">{fmtMoney(sale.grandTotal)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Paid</span><span className="money">{fmtMoney(sale.paidAmount)}</span></div>
          {num(sale.dueAmount) > 0 && <div className="flex justify-between"><span className="text-muted">Balance (udhaar)</span><span className="money text-danger">{fmtMoney(sale.dueAmount)}</span></div>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn btn-secondary" onClick={() => printReceipt(sale, "80mm", settings)}><Printer size={15} /> 80mm</button>
          <button className="btn btn-secondary" onClick={() => printReceipt(sale, "a4", settings)}><Printer size={15} /> A4 / PDF</button>
          {waLink && <a className="btn btn-secondary col-span-2" href={waLink} target="_blank" rel="noreferrer">Send WhatsApp</a>}
          <button className="btn btn-primary col-span-2" onClick={onNew}><Plus size={15} /> New sale (Enter)</button>
        </div>
      </div>
    </div>
  );
}
