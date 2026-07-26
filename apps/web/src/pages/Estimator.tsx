import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Trash2, FileText, Printer, Settings2, Pencil, Wand2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { EstimatorTemplate, EstimatorPreset, Product, Customer, Paged } from "../lib/types";
import { num, fmtMoney, fmtQty } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, useToast } from "../components/ui";

type Line = { productId: string; name: string; sku: string; unit: string; active: boolean; note: string | null; qtyPerUnit: number; qty: number; unitPrice: number; lineTotal: number };

/** Compute the live material list client-side from a template's product prices. */
function computeLines(t: EstimatorTemplate, area: number, floors: number): { lines: Line[]; grandTotal: number; totalUnits: number } {
  const totalUnits = t.multiplyByFloors ? area * floors : area;
  const lines = t.items.map((it) => {
    const qty = Math.round(num(it.qtyPerUnit) * totalUnits * 1000) / 1000;
    const unitPrice = num(it.product?.salePrice);
    const lineTotal = Math.round(qty * unitPrice * 100) / 100;
    return { productId: it.productId, name: it.product?.name ?? "", sku: it.product?.sku ?? "", unit: it.product?.unit?.shortName ?? "", active: it.product?.isActive ?? true, note: it.note, qtyPerUnit: num(it.qtyPerUnit), qty, unitPrice, lineTotal };
  });
  const grandTotal = Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
  return { lines, grandTotal, totalUnits };
}

export default function Estimator() {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";

  const { data, isLoading } = useQuery({ queryKey: ["estimator-templates"], queryFn: () => api<{ templates: EstimatorTemplate[] }>("/estimator/templates") });
  const templates = data?.templates ?? [];

  const [selId, setSelId] = useState<string>("");
  const [area, setArea] = useState("");
  const [floors, setFloors] = useState("1");
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [managing, setManaging] = useState(false);

  const selected = templates.find((t) => t.id === selId) ?? templates[0];
  const areaN = Number(area) || 0;
  const floorsN = Math.max(1, Number(floors) || 1);
  const calc = useMemo(() => (selected && areaN > 0 ? computeLines(selected, areaN, floorsN) : null), [selected, areaN, floorsN]);

  const saveQuote = useMutation({
    mutationFn: () => {
      const items = (calc?.lines ?? []).filter((l) => l.active && l.qty > 0).map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice }));
      if (!items.length) throw new Error("Nothing to quote — add an area first");
      return api<{ sale: { invoiceNo: string } }>("/sales", { method: "POST", body: { status: "QUOTATION", customerId: customer?.id ?? null, items, notes: `Estimate: ${selected?.name}` } });
    },
    onSuccess: (d) => { toast(`Quotation ${d.sale.invoiceNo} saved`); qc.invalidateQueries({ queryKey: ["quotations"] }); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  return (
    <div>
      <PageHeader
        title="Estimator"
        sub="Turn “I'm building X” into an instant materials list at live prices — one click to a quotation."
        actions={isAdmin ? <button className="btn btn-secondary" onClick={() => setManaging(true)}><Settings2 size={16} /> Manage templates</button> : undefined}
      />

      {isLoading ? <TableSkeleton cols={5} /> : templates.length === 0 ? (
        <EmptyState title="No structure templates yet" hint={isAdmin ? "Add a template (e.g. RCC slab, grey structure) and link your products to its material rows." : "Ask an admin to set up estimator templates."} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          {/* Template picker + inputs */}
          <div className="space-y-3">
            <div className="card p-2 space-y-0.5">
              {templates.map((t) => (
                <button key={t.id} className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selected?.id === t.id ? "bg-surface-2 text-ink font-semibold border border-edge" : "text-muted hover:text-ink hover:bg-surface-2"}`} onClick={() => setSelId(t.id)}>
                  <Building2 size={14} className="inline mr-2" />{t.name}
                </button>
              ))}
            </div>
            {selected && (
              <div className="card p-4 space-y-3">
                <div><label className="label">{selected.areaLabel}</label><input className="input mono" type="number" step="any" min="0" value={area} onChange={(e) => setArea(e.target.value)} placeholder="0" autoFocus /></div>
                {selected.multiplyByFloors && <div><label className="label">Floors / storeys</label><input className="input mono" type="number" step="1" min="1" value={floors} onChange={(e) => setFloors(e.target.value)} /></div>}
                {selected.description && <p className="text-xs text-muted">{selected.description}</p>}
              </div>
            )}
          </div>

          {/* Result */}
          <div>
            {!calc ? (
              <div className="card"><EmptyState title="Enter an area to estimate" hint={`Type the ${selected?.areaLabel?.toLowerCase() ?? "area"} on the left.`} /></div>
            ) : (
              <div className="space-y-3">
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-muted border-b border-edge text-xs">
                        <th className="px-4 py-2.5 font-medium">Material</th><th className="px-4 py-2.5 font-medium text-right">Per unit</th>
                        <th className="px-4 py-2.5 font-medium text-right">Quantity</th><th className="px-4 py-2.5 font-medium text-right">Rate</th><th className="px-4 py-2.5 font-medium text-right">Amount</th>
                      </tr></thead>
                      <tbody>
                        {calc.lines.map((l) => (
                          <tr key={l.productId} className="border-b border-edge last:border-0">
                            <td className="px-4 py-2">{l.name} <span className="mono text-muted text-xs">{l.sku}</span>{!l.active && <span className="text-danger text-xs ml-1">(inactive)</span>}{l.note && <div className="text-xs text-muted">{l.note}</div>}</td>
                            <td className="px-4 py-2 text-right mono text-muted text-xs">{fmtQty(l.qtyPerUnit)}</td>
                            <td className="px-4 py-2 text-right mono font-medium">{fmtQty(l.qty)} {l.unit}</td>
                            <td className="px-4 py-2 text-right money">{fmtMoney(l.unitPrice)}</td>
                            <td className="px-4 py-2 text-right money font-medium">{fmtMoney(l.lineTotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr className="border-t-2 border-edge font-bold bg-surface-2/40">
                        <td className="px-4 py-2.5" colSpan={4}>Estimated total ({fmtQty(calc.totalUnits)} {selected?.multiplyByFloors ? "unit×floors" : "units"})</td>
                        <td className="px-4 py-2.5 text-right money">{fmtMoney(calc.grandTotal)}</td>
                      </tr></tfoot>
                    </table>
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-52"><label className="label">Customer <span className="text-muted">(optional)</span></label><CustomerPicker onChange={setCustomer} /></div>
                  <div className="flex-1" />
                  <button className="btn btn-secondary" onClick={() => printEstimate(selected!, calc.lines, calc.grandTotal, customer?.name)}><Printer size={15} /> Print</button>
                  {can("sales.create") && <button className="btn btn-primary" disabled={saveQuote.isPending} onClick={() => saveQuote.mutate()}><FileText size={15} /> {saveQuote.isPending ? "Saving…" : "Save as quotation"}</button>}
                </div>
                <p className="text-xs text-muted">Quantities are rule-of-thumb estimates for quoting. Prices are live from your catalog. A quotation carries no stock or money effect until you turn it into a sale.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {managing && <ManageTemplates onClose={() => setManaging(false)} />}
    </div>
  );
}

/* ─────────── Customer picker ─────────── */
function CustomerPicker({ onChange }: { onChange: (p: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const { data } = useQuery({ queryKey: ["cust-pick-est", q], queryFn: () => api<Paged<"customers", Customer>>(`/customers?limit=8&status=active${q ? `&search=${encodeURIComponent(q)}` : ""}`), enabled: open });
  const list = data?.customers ?? [];
  return (
    <div className="relative">
      <input className="input" value={picked ? picked.name : q} onChange={(e) => { setPicked(null); onChange(null); setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Walk-in / search…" />
      {open && !picked && list.length > 0 && (
        <div className="absolute z-10 mt-1 w-full card max-h-56 overflow-y-auto p-1 shadow-xl">
          {list.map((c) => (
            <button key={c.id} type="button" className="w-full text-left px-3 py-1.5 rounded hover:bg-surface-2 text-sm" onClick={() => { const v = { id: c.id, name: c.name }; setPicked(v); onChange(v); setOpen(false); }}>{c.name} <span className="mono text-muted text-xs">{c.code}</span></button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── Product picker ─────────── */
function ProductPicker({ onPick }: { onPick: (p: Product) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["prod-pick-est", q], queryFn: () => api<Paged<"products", Product>>(`/products?limit=8${q ? `&search=${encodeURIComponent(q)}` : ""}`), enabled: open });
  const list = (data?.products ?? []).filter((p) => p.isActive);
  return (
    <div className="relative">
      <input className="input !py-1" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Link a product…" />
      {open && list.length > 0 && (
        <div className="absolute z-30 mt-1 w-full card max-h-52 overflow-y-auto p-1 shadow-xl">
          {list.map((p) => (
            <button key={p.id} type="button" className="w-full text-left px-3 py-1.5 rounded hover:bg-surface-2 text-sm flex justify-between" onClick={() => { onPick(p); setQ(""); setOpen(false); }}>
              <span>{p.name} <span className="mono text-muted text-xs">{p.sku}</span></span><span className="money text-muted text-xs">{fmtMoney(p.salePrice)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── Template management ─────────── */
function ManageTemplates({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: ["estimator-templates"], queryFn: () => api<{ templates: EstimatorTemplate[] }>("/estimator/templates") });
  const templates = data?.templates ?? [];
  const [editing, setEditing] = useState<EstimatorTemplate | "new" | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["estimator-templates"] });
  const del = useMutation({ mutationFn: (id: string) => api(`/estimator/templates/${id}`, { method: "DELETE" }), onSuccess: () => { toast("Template deleted"); refresh(); } });

  if (editing) return <TemplateEditor template={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { refresh(); setEditing(null); }} />;

  return (
    <Modal open onClose={onClose} title="Estimator templates" wide>
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted">Structure types and their material coefficients.</p>
          <button className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={15} /> New template</button>
        </div>
        {templates.length === 0 ? <EmptyState title="No templates" hint="Create your first structure template." /> : (
          <div className="card divide-y divide-edge">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-3 py-2.5 text-sm">
                <div><span className="font-medium">{t.name}</span> <span className="text-muted text-xs">· {t.items.length} materials · {t.areaLabel}{t.multiplyByFloors ? " × floors" : ""}</span></div>
                <div className="flex gap-1">
                  <button className="btn btn-secondary !p-1.5" title="Edit" onClick={() => setEditing(t)}><Pencil size={14} /></button>
                  <button className="btn btn-secondary !p-1.5 text-muted" title="Delete" onClick={() => { if (confirm(`Delete “${t.name}”?`)) del.mutate(t.id); }}><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  );
}

type Row = { productId: string; name: string; sku: string; unit: string; qtyPerUnit: string; note: string };

function TemplateEditor({ template, onClose, onDone }: { template: EstimatorTemplate | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [areaLabel, setAreaLabel] = useState(template?.areaLabel ?? "Area (sq ft)");
  const [multiplyByFloors, setMultiplyByFloors] = useState(template?.multiplyByFloors ?? true);
  const [rows, setRows] = useState<Row[]>(
    (template?.items ?? []).map((it) => ({ productId: it.productId, name: it.product?.name ?? "", sku: it.product?.sku ?? "", unit: it.product?.unit?.shortName ?? "", qtyPerUnit: String(num(it.qtyPerUnit)), note: it.note ?? "" }))
  );
  const [error, setError] = useState<string | null>(null);

  const { data: presetData } = useQuery({ queryKey: ["estimator-presets"], queryFn: () => api<{ presets: EstimatorPreset[] }>("/estimator/presets") });
  const presets = presetData?.presets ?? [];

  const addProduct = (p: Product) => setRows([...rows, { productId: p.id, name: p.name, sku: p.sku, unit: p.unit?.shortName ?? "", qtyPerUnit: "", note: "" }]);
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  function applyPreset(key: string) {
    const p = presets.find((x) => x.key === key);
    if (!p) return;
    setAreaLabel(p.areaLabel);
    setMultiplyByFloors(p.multiplyByFloors);
    if (!name) setName(p.name);
    if (!description) setDescription(p.description);
    // Pre-fill rows with coefficients + a hint note; the admin picks the matching product.
    setRows(p.rows.map((r) => ({ productId: "", name: "", sku: "", unit: "", qtyPerUnit: String(r.qtyPerUnit), note: `${r.label} (${r.unitHint})` })));
    toast("Preset loaded — now link a product to each row");
  }

  const save = useMutation({
    mutationFn: () => {
      const items = rows.map((r) => ({ productId: r.productId, qtyPerUnit: Number(r.qtyPerUnit), note: r.note || null }));
      const body = { name, description: description || null, areaLabel, multiplyByFloors, isActive: true, items };
      return template ? api(`/estimator/templates/${template.id}`, { method: "PATCH", body }) : api("/estimator/templates", { method: "POST", body });
    },
    onSuccess: () => { toast(template ? "Template updated" : "Template created"); onDone(); },
    onError: (e: ApiError) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Name is required");
    if (!rows.length) return setError("Add at least one material row");
    if (rows.some((r) => !r.productId)) return setError("Every row needs a linked product");
    if (rows.some((r) => !(Number(r.qtyPerUnit) > 0))) return setError("Every row needs a coefficient more than 0");
    save.mutate();
  }

  return (
    <Modal open onClose={onClose} title={template ? `Edit ${template.name}` : "New estimator template"} wide>
      <form onSubmit={submit} className="space-y-3">
        {!template && presets.length > 0 && (
          <div className="flex items-end gap-2">
            <div className="flex-1"><label className="label"><Wand2 size={12} className="inline mr-1" />Start from a preset <span className="text-muted">(optional)</span></label>
              <select className="input" defaultValue="" onChange={(e) => { if (e.target.value) applyPreset(e.target.value); e.target.value = ""; }}>
                <option value="">Choose a starter…</option>
                {presets.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="RCC slab, Grey structure…" required /></div>
          <div><label className="label">Area input label</label><input className="input" value={areaLabel} onChange={(e) => setAreaLabel(e.target.value)} /></div>
        </div>
        <div><label className="label">Description <span className="text-muted">(optional)</span></label><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={multiplyByFloors} onChange={(e) => setMultiplyByFloors(e.target.checked)} /> Multiply the area by number of floors</label>

        <div>
          <label className="label">Material rows (coefficient = qty per unit of area{multiplyByFloors ? " × floors" : ""})</label>
          <ProductPicker onPick={addProduct} />
          {rows.length > 0 && (
            <div className="card overflow-hidden mt-2">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted border-b border-edge text-xs">
                  <th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 font-medium text-right w-28">Coefficient</th><th className="px-3 py-2 font-medium">Note</th><th className="w-8" />
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-edge last:border-0">
                      <td className="px-3 py-1.5">{r.productId ? <>{r.name} <span className="mono text-muted text-xs">{r.sku} · per {r.unit || "unit"}</span></> : <ProductPicker onPick={(p) => setRow(i, { productId: p.id, name: p.name, sku: p.sku, unit: p.unit?.shortName ?? "" })} />}</td>
                      <td className="px-3 py-1.5"><input className="input mono !py-1 text-right" type="number" step="any" min="0" value={r.qtyPerUnit} onChange={(e) => setRow(i, { qtyPerUnit: e.target.value })} /></td>
                      <td className="px-3 py-1.5"><input className="input !py-1" value={r.note} onChange={(e) => setRow(i, { note: e.target.value })} placeholder="optional" /></td>
                      <td className="px-3 py-1.5 text-right"><button type="button" className="text-muted hover:text-danger" onClick={() => removeRow(i)} aria-label="Remove"><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : template ? "Save changes" : "Create template"}</button></div>
      </form>
    </Modal>
  );
}

/** Print an A4 estimate the customer can keep. */
function printEstimate(t: EstimatorTemplate, lines: Line[], grandTotal: number, customerName?: string) {
  const rows = lines.map((l) => `<tr><td>${l.name} <small>${l.sku}</small></td><td class=r>${l.qty.toLocaleString("en-PK")} ${l.unit}</td><td class=r>${l.unitPrice.toLocaleString("en-PK")}</td><td class=r>${l.lineTotal.toLocaleString("en-PK")}</td></tr>`).join("");
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Estimate</title><style>
    *{font-family:Arial,sans-serif;color:#111} body{padding:28px;font-size:13px}
    h1{font-size:18px;margin:0} .muted{color:#666;font-size:12px}
    table{width:100%;border-collapse:collapse;margin-top:14px} th,td{border:1px solid #bbb;padding:7px;text-align:left} th{background:#f2f2f2}
    .r{text-align:right} .tot{margin-top:10px;text-align:right}
  </style></head><body>
    <h1>Material Estimate</h1>
    <div class="muted">${t.name}${customerName ? " · " + customerName : ""} · ${new Date().toLocaleDateString("en-GB")}</div>
    <table><thead><tr><th>Material</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="tot"><b>Estimated total: Rs ${grandTotal.toLocaleString("en-PK")}</b></div>
    <p class="muted" style="margin-top:8px">Estimate only — quantities are approximate and prices may change. Not a final bill.</p>
    <script>window.onload=function(){window.print()}</script>
  </body></html>`);
  w.document.close();
}
