import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Truck, Printer, Ban } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { DeliveryNote, DeliveryPending, Sale } from "../lib/types";
import { fmtQty } from "../lib/format";
import { Modal, Badge, useToast } from "./ui";

/** Open a print window with an A4 challan (delivery note). */
function printChallan(note: DeliveryNote, shop: Record<string, string>) {
  const rows = note.items
    .map((it) => `<tr><td>${it.saleItem?.product?.name ?? ""} <small>${it.saleItem?.product?.sku ?? ""}</small></td><td class=r>${Number(it.qty)} ${it.saleItem?.product?.unit?.shortName ?? ""}</td></tr>`)
    .join("");
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>${note.refNo}</title><style>
    *{font-family:Arial,sans-serif;color:#111} body{padding:28px;font-size:13px}
    h1{font-size:18px;margin:0} .muted{color:#666;font-size:12px}
    table{width:100%;border-collapse:collapse;margin-top:14px} th,td{border:1px solid #bbb;padding:7px;text-align:left} th{background:#f2f2f2}
    .r{text-align:right} .row{display:flex;justify-content:space-between;margin-top:6px}
    .sign{margin-top:48px;display:flex;justify-content:space-between} .sign div{border-top:1px solid #999;padding-top:4px;width:44%;text-align:center;font-size:12px}
  </style></head><body>
    <h1>${shop.shop_name || "SoftGlaze"}</h1>
    <div class="muted">${[shop.shop_address, shop.shop_city].filter(Boolean).join(", ")}${shop.shop_phone ? " · " + shop.shop_phone : ""}</div>
    <h2 style="margin:14px 0 0">Delivery Challan — ${note.refNo}</h2>
    <div class="row"><span>Invoice: <b>${note.sale?.invoiceNo ?? ""}</b></span><span>Date: ${new Date(note.date).toLocaleDateString("en-GB")}</span></div>
    <div class="row"><span>Customer: <b>${note.sale?.customer?.name ?? "Walk-in"}</b></span><span>Vehicle: ${note.vehicleNo || "—"}</span></div>
    <div class="row"><span>Driver: ${note.driverName || "—"}</span><span>Received by: ${note.receiverName || "—"}</span></div>
    <table><thead><tr><th>Item delivered</th><th class="r">Qty</th></tr></thead><tbody>${rows}</tbody></table>
    ${note.notes ? `<p class="muted">${note.notes}</p>` : ""}
    <div class="sign"><div>Driver signature</div><div>Receiver signature</div></div>
    <script>window.onload=function(){window.print()}</script>
  </body></html>`);
  w.document.close();
}

export default function DispatchModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: pending, isLoading } = useQuery({ queryKey: ["pending-del", sale.id], queryFn: () => api<DeliveryPending>(`/deliveries/pending/${sale.id}`) });
  const { data: existing } = useQuery({ queryKey: ["challans", sale.id], queryFn: () => api<{ deliveries: DeliveryNote[] }>(`/deliveries?saleId=${sale.id}`) });
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: () => api<{ settings: Record<string, string> }>("/settings") });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [driverName, setDriverName] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["pending-del", sale.id] }); qc.invalidateQueries({ queryKey: ["challans", sale.id] }); };
  const create = useMutation({
    mutationFn: () => {
      const items = Object.entries(qty).map(([saleItemId, q]) => ({ saleItemId, qty: Number(q) || 0 })).filter((i) => i.qty > 0);
      if (!items.length) throw new Error("Enter a quantity to deliver");
      return api<{ delivery: DeliveryNote }>("/deliveries", { method: "POST", body: { saleId: sale.id, driverName: driverName || null, vehicleNo: vehicleNo || null, receiverName: receiverName || null, items } });
    },
    onSuccess: (d) => { toast(`Challan ${d.delivery.refNo} created`); setQty({}); refresh(); printChallan(d.delivery, settingsData?.settings ?? {}); },
    onError: (e: ApiError) => setError(e.message),
  });
  const cancel = useMutation({ mutationFn: (id: string) => api(`/deliveries/${id}/cancel`, { method: "POST" }), onSuccess: () => { toast("Challan cancelled"); refresh(); } });

  const lines = pending?.lines ?? [];
  const anyPending = lines.some((l) => l.remaining > 0.001);

  return (
    <Modal open onClose={onClose} title={`Dispatch — ${sale.invoiceNo}`} wide>
      <div className="space-y-4">
        {isLoading ? <p className="text-muted text-sm">Loading…</p> : (
          <>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted border-b border-edge text-xs">
                  <th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 font-medium text-right">Sold</th>
                  <th className="px-3 py-2 font-medium text-right">Delivered</th><th className="px-3 py-2 font-medium text-right">Pending</th>
                  <th className="px-3 py-2 font-medium text-right w-28">Deliver now</th>
                </tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.saleItemId} className="border-b border-edge last:border-0">
                      <td className="px-3 py-1.5">{l.product} <span className="mono text-muted text-xs">{l.sku}</span></td>
                      <td className="px-3 py-1.5 text-right mono">{fmtQty(l.sold)} {l.unit}</td>
                      <td className="px-3 py-1.5 text-right mono text-muted">{fmtQty(l.delivered)}</td>
                      <td className={`px-3 py-1.5 text-right mono ${l.remaining > 0 ? "text-accent" : "text-success"}`}>{fmtQty(l.remaining)}</td>
                      <td className="px-3 py-1.5">
                        {l.remaining > 0.001 ? <input className="input mono !py-1 text-right" type="number" step="any" min="0" max={l.remaining} value={qty[l.saleItemId] ?? ""} onChange={(e) => setQty({ ...qty, [l.saleItemId]: e.target.value })} placeholder={String(l.remaining)} /> : <span className="text-success text-xs">done</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {anyPending && (
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">Driver</label><input className="input" value={driverName} onChange={(e) => setDriverName(e.target.value)} /></div>
                <div><label className="label">Vehicle no.</label><input className="input mono" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} /></div>
                <div><label className="label">Received by</label><input className="input" value={receiverName} onChange={(e) => setReceiverName(e.target.value)} /></div>
              </div>
            )}
            {error && <p className="text-danger text-sm">{error}</p>}

            {(existing?.deliveries?.length ?? 0) > 0 && (
              <div>
                <p className="text-sm font-medium mb-1">Challans for this invoice</p>
                <div className="card divide-y divide-edge">
                  {existing!.deliveries.map((d) => (
                    <div key={d.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div><span className="mono">{d.refNo}</span> <span className="text-muted">· {new Date(d.date).toLocaleDateString("en-GB")} · {d.items.length} item(s){d.vehicleNo ? ` · ${d.vehicleNo}` : ""}</span> {d.status === "CANCELLED" && <Badge tone="muted">cancelled</Badge>}</div>
                      <div className="flex gap-1">
                        <button className="btn btn-secondary !p-1.5" title="Print" onClick={() => printChallan(d, settingsData?.settings ?? {})}><Printer size={13} /></button>
                        {d.status === "DELIVERED" && <button className="btn btn-secondary !p-1.5 text-muted" title="Cancel challan" onClick={() => cancel.mutate(d.id)}><Ban size={13} /></button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={onClose}>Close</button>
              <button className="btn btn-primary" disabled={!anyPending || create.isPending} onClick={() => { setError(null); create.mutate(); }}><Truck size={15} /> {create.isPending ? "Saving…" : "Create challan"}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
