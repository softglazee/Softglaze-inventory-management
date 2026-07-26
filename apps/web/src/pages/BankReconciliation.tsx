import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, Circle, Landmark, Upload } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Account } from "../lib/types";
import { num, fmtMoney } from "../lib/format";
import { PageHeader, EmptyState, TableSkeleton, useToast } from "../components/ui";

type Entry = { id: string; date: string; type: string; amount: string; notes: string | null; reconciledAt: string | null };
const d = (s: string) => new Date(s).toLocaleDateString("en-GB");

export default function BankReconciliation() {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState(new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const importRef = useRef<HTMLInputElement>(null);

  const { data: accData } = useQuery({ queryKey: ["accounts"], queryFn: () => api<{ accounts: Account[] }>("/accounts") });
  const accounts = (accData?.accounts ?? []).filter((a) => a.isActive);

  const qs = `from=${from}&to=${to}T23:59:59`;
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["reconcile", accountId, qs],
    queryFn: () => api<{ account: { name: string; currentBalance: string }; entries: Entry[]; clearedSum: number }>(`/accounts/${accountId}/reconcile?${qs}`),
    enabled: !!accountId,
  });
  const entries = data?.entries ?? [];

  // toggle map defaults to each entry's persisted reconciled status
  const checked = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const e of entries) m[e.id] = e.id in sel ? sel[e.id] : !!e.reconciledAt;
    return m;
  }, [entries, sel]);
  const clearedNow = entries.filter((e) => checked[e.id]).reduce((s, e) => s + num(e.amount), 0);

  const save = useMutation({
    mutationFn: async () => {
      const toReconcile = entries.filter((e) => checked[e.id] && !e.reconciledAt).map((e) => e.id);
      const toClear = entries.filter((e) => !checked[e.id] && e.reconciledAt).map((e) => e.id);
      if (toReconcile.length) await api("/accounts/reconcile", { method: "POST", body: { entryIds: toReconcile, reconciled: true } });
      if (toClear.length) await api("/accounts/reconcile", { method: "POST", body: { entryIds: toClear, reconciled: false } });
    },
    onSuccess: () => { toast("Reconciliation saved"); setSel({}); refetch(); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  // Import a bank CSV → auto-tick entries whose amount matches a statement line.
  function importCsv(text: string) {
    const amounts = text.split(/\r?\n/).slice(1).map((l) => l.split(",")).flatMap((c) => c.map((x) => Math.abs(Number(String(x).replace(/[^0-9.-]/g, ""))))).filter((n) => n > 0);
    const bag = new Set(amounts.map((a) => Math.round(a * 100)));
    const next: Record<string, boolean> = { ...checked };
    let hits = 0;
    for (const e of entries) if (bag.has(Math.round(Math.abs(num(e.amount)) * 100))) { next[e.id] = true; hits++; }
    setSel(next);
    toast(hits ? `Matched ${hits} entr${hits > 1 ? "ies" : "y"} to the statement` : "No matching amounts found", hits ? "success" : "error");
  }

  return (
    <div>
      <PageHeader title="Bank Reconciliation" sub="Tick off the account entries that appear on your bank statement (or import the statement CSV to auto-match by amount). This is a check only — it moves no money." />
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <div><label className="label">Account</label><select className="input !w-52" value={accountId} onChange={(e) => { setAccountId(e.target.value); setSel({}); }}><option value="">Choose account…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div><label className="label">From</label><input className="input !w-40" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input className="input !w-40" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="flex-1" />
        {accountId && (
          <>
            <input ref={importRef} type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) importCsv(await f.text()); e.target.value = ""; }} />
            <button className="btn btn-secondary" onClick={() => importRef.current?.click()}><Upload size={15} /> Import statement</button>
            <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</button>
          </>
        )}
      </div>

      {accountId && data && (
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="card p-3"><p className="text-xs text-muted">Account balance</p><p className="money text-lg font-semibold">{fmtMoney(data.account.currentBalance)}</p></div>
          <div className="card p-3"><p className="text-xs text-muted">Cleared (ticked)</p><p className="money text-lg font-semibold text-success">{fmtMoney(clearedNow)}</p></div>
          <div className="card p-3"><p className="text-xs text-muted">Uncleared</p><p className="money text-lg font-semibold">{fmtMoney(num(data.account.currentBalance) - clearedNow)}</p></div>
        </div>
      )}

      <div className="card overflow-hidden">
        {!accountId ? <EmptyState title="Pick an account" hint="Choose a bank/cash account to start reconciling." /> : isLoading ? <TableSkeleton cols={4} /> : entries.length === 0 ? <EmptyState title="No entries in this range" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted border-b border-edge"><th className="px-4 py-2.5 w-10" /><th className="px-4 py-2.5 font-medium">Date</th><th className="px-4 py-2.5 font-medium">Detail</th><th className="px-4 py-2.5 font-medium text-right">Amount</th></tr></thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className={`border-b border-edge last:border-0 cursor-pointer hover:bg-surface-2/50 ${checked[e.id] ? "bg-success/5" : ""}`} onClick={() => setSel((s) => ({ ...s, [e.id]: !checked[e.id] }))}>
                    <td className="px-4 py-2">{checked[e.id] ? <CheckCircle2 size={16} className="text-success" /> : <Circle size={16} className="text-muted" />}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{d(e.date)}</td>
                    <td className="px-4 py-2 text-muted">{e.notes || e.type.replace("_", " ")}</td>
                    <td className={`px-4 py-2 text-right money ${num(e.amount) < 0 ? "text-danger" : ""}`}>{fmtMoney(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
