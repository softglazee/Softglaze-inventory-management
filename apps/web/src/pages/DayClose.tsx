import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Calculator as CalcIcon, Printer, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { DayClose as DayCloseT, DayClosePreview } from "../lib/types";
import { fmtMoney } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, useToast } from "../components/ui";

// PKR notes & coins, high → low
const DENOMS = [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];

export default function DayClose() {
  const { toast } = useToast();
  const { can } = useAuth();
  const canDo = can("accounts.view");
  const [creating, setCreating] = useState(false);
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api<{ settings: Record<string, string> }>("/settings") });
  const { data, isLoading } = useQuery({ queryKey: ["day-closes"], queryFn: () => api<{ closes: DayCloseT[] }>("/day-close") });
  const closes = data?.closes ?? [];

  return (
    <div>
      <PageHeader
        title="Day close"
        sub="Count the cash drawer at day end and reconcile it against what the system expects. A difference is flagged for you to investigate — it doesn't change the books."
        actions={canDo && <button className="btn btn-secondary !border-accent !text-accent" onClick={() => setCreating(true)}><Plus size={16} /> New day close</button>}
      />

      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={6} />
        ) : closes.length === 0 ? (
          <EmptyState title="No day closes yet" hint="At the end of a day, count the drawer and record it here." />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted border-b border-edge"><th className="px-4 py-2.5 font-medium">Ref</th><th className="px-4 py-2.5 font-medium">Date</th><th className="px-4 py-2.5 font-medium text-right">Expected</th><th className="px-4 py-2.5 font-medium text-right">Counted</th><th className="px-4 py-2.5 font-medium text-right">Variance</th><th className="px-4 py-2.5 font-medium">By</th><th className="px-4 py-2.5 w-16" /></tr></thead>
            <tbody>
              {closes.map((c) => {
                const v = Number(c.variance);
                return (
                  <tr key={c.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                    <td className="px-4 py-2 mono text-xs">{c.refNo}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{new Date(c.businessDate).toLocaleDateString("en-GB")}</td>
                    <td className="px-4 py-2 text-right money">{fmtMoney(c.expectedCash)}</td>
                    <td className="px-4 py-2 text-right money">{fmtMoney(c.countedCash)}</td>
                    <td className={`px-4 py-2 text-right money ${v === 0 ? "text-success" : "text-danger"}`}>{v > 0 ? "+" : ""}{fmtMoney(v)}</td>
                    <td className="px-4 py-2 text-muted">{c.user?.name}</td>
                    <td className="px-4 py-2 text-right"><button className="btn btn-secondary !p-1.5" title="Print Z-report" onClick={() => printZReport(c, settings?.settings ?? {})}><Printer size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {creating && <NewClose settings={settings?.settings ?? {}} onClose={() => setCreating(false)} onDone={() => { toast("Day close saved"); setCreating(false); }} />}
    </div>
  );
}

function NewClose({ settings, onClose, onDone }: { settings: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [openingFloat, setOpeningFloat] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<DayCloseT | null>(null);

  const { data: preview } = useQuery({ queryKey: ["day-close-preview", date], queryFn: () => api<{ expectedCash: number; cashIn: number; cashOut: number; suggestedFloat: number } & DayClosePreview>(`/day-close/preview?date=${date}`) });
  const expected = preview?.expectedCash ?? 0;
  const counted = useMemo(() => DENOMS.reduce((s, d) => s + d * (Number(counts[d]) || 0), 0), [counts]);
  const variance = Math.round((counted - expected) * 100) / 100;

  const save = useMutation({
    mutationFn: () => api<{ close: DayCloseT }>("/day-close", { method: "POST", body: { businessDate: date, openingFloat: Number(openingFloat) || 0, denominations: Object.fromEntries(DENOMS.map((d) => [String(d), Number(counts[d]) || 0]).filter(([, n]) => n)), notes: notes || null } }),
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ["day-closes"] }); setSaved(d.close); },
    onError: (e: ApiError) => setError(e.message),
  });

  if (saved) {
    return (
      <Modal open onClose={onDone} title={`Day close ${saved.refNo}`}>
        <div className="space-y-4 text-center">
          <CheckCircle2 size={40} className="mx-auto text-success" />
          <div className="text-sm">Counted <b>{fmtMoney(saved.countedCash)}</b> vs expected <b>{fmtMoney(saved.expectedCash)}</b></div>
          <div className={`text-lg font-semibold ${Number(saved.variance) === 0 ? "text-success" : "text-danger"}`}>{Number(saved.variance) === 0 ? "Balanced — no difference" : `${Number(saved.variance) > 0 ? "Over" : "Short"} by ${fmtMoney(Math.abs(Number(saved.variance)))}`}</div>
          <div className="flex justify-center gap-2">
            <button className="btn btn-secondary" onClick={() => printZReport(saved, settings)}><Printer size={15} /> Print Z-report</button>
            <button className="btn btn-secondary !border-accent !text-accent" onClick={onDone}>Done</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Close the day">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Business date</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="label">Opening float <span className="text-muted">(optional)</span></label><input className="input mono" type="number" step="0.01" min="0" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} placeholder={preview ? String(preview.suggestedFloat) : "0"} /></div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="card p-2.5"><div className="text-xs text-muted">Cash in today</div><div className="money font-medium text-success">{fmtMoney(preview?.cashIn ?? 0)}</div></div>
          <div className="card p-2.5"><div className="text-xs text-muted">Cash out today</div><div className="money font-medium text-danger">{fmtMoney(preview?.cashOut ?? 0)}</div></div>
          <div className="card p-2.5"><div className="text-xs text-muted">Expected in drawer</div><div className="money font-semibold">{fmtMoney(expected)}</div></div>
        </div>

        <div>
          <label className="label flex items-center gap-1.5"><CalcIcon size={14} /> Count the drawer</label>
          <div className="card divide-y divide-edge">
            {DENOMS.map((d) => {
              const n = Number(counts[d]) || 0;
              return (
                <div key={d} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                  <span className="w-16 mono text-muted">₨{d.toLocaleString()}</span>
                  <span className="text-muted">×</span>
                  <input className="input mono !py-1 !w-24 text-right" type="number" min="0" step="1" value={counts[d] ?? ""} onChange={(e) => setCounts({ ...counts, [d]: e.target.value })} placeholder="0" />
                  <span className="flex-1 text-right money text-muted">{fmtMoney(d * n)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">Counted total</span>
          <span className="money text-lg font-bold">{fmtMoney(counted)}</span>
        </div>
        <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${variance === 0 ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
          <span className="text-sm font-medium">{variance === 0 ? "Balanced" : variance > 0 ? "Over (extra cash)" : "Short (missing cash)"}</span>
          <span className="money font-bold">{variance > 0 ? "+" : ""}{fmtMoney(variance)}</span>
        </div>

        <div><label className="label">Notes <span className="text-muted">(optional)</span></label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. ₨50 short — checked with cashier" /></div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-secondary !border-accent !text-accent" disabled={save.isPending} onClick={() => { setError(null); save.mutate(); }}>{save.isPending ? "Saving…" : "Save day close"}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Print an 80mm Z-report for a saved day close. */
function printZReport(c: DayCloseT, settings: Record<string, string>) {
  const sym = settings.currency_symbol || "₨";
  const m = (v: string | number) => `${sym} ${Number(v).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const denoms: Record<string, number> = c.denominations ? JSON.parse(c.denominations) : {};
  const denomRows = DENOMS.filter((d) => denoms[d]).map((d) => `<tr><td>${sym}${d.toLocaleString()} × ${denoms[d]}</td><td class="r">${m(d * denoms[d])}</td></tr>`).join("");
  const v = Number(c.variance);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${c.refNo}</title><style>
    @page { size: 80mm auto; margin: 0; }
    body { font-family: 'Courier New', monospace; font-size: 11px; width: 80mm; margin: 0 auto; padding: 4mm; color: #000; }
    .c { text-align: center; } .r { text-align: right; } h1 { font-size: 15px; margin: 0 0 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; } td { padding: 2px 0; }
    .hd { border-top: 1px dashed #999; margin-top: 6px; padding-top: 4px; font-weight: bold; }
    .grand { border-top: 1px solid #000; font-weight: bold; font-size: 13px; }
  </style></head><body>
    <div class="c"><h1>${(settings.shop_name || "SoftGlaze").replace(/[<>&]/g, "")}</h1>
    <div>DAY CLOSE / Z-REPORT</div><div>${c.refNo}</div>
    <div>${new Date(c.businessDate).toLocaleDateString("en-GB")}</div></div>
    <table>
      <tr><td>Cash in today</td><td class="r">${m(c.cashIn)}</td></tr>
      <tr><td>Cash out today</td><td class="r">- ${m(c.cashOut)}</td></tr>
      <tr class="grand"><td>Expected in drawer</td><td class="r">${m(c.expectedCash)}</td></tr>
    </table>
    <div class="hd">Cash counted</div>
    <table>${denomRows}<tr class="grand"><td>Counted total</td><td class="r">${m(c.countedCash)}</td></tr></table>
    <table><tr class="grand"><td>${v === 0 ? "Balanced" : v > 0 ? "Over" : "Short"}</td><td class="r">${v > 0 ? "+" : ""}${m(v)}</td></tr></table>
    ${c.notes ? `<div style="margin-top:6px">${c.notes.replace(/[<>&]/g, "")}</div>` : ""}
    <div class="c" style="margin-top:8px">Closed by ${(c.user?.name || "").replace(/[<>&]/g, "")}<br>${new Date(c.createdAt).toLocaleString()}</div>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
  </body></html>`;
  const w = window.open("", "_blank", "width=380,height=640");
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}
