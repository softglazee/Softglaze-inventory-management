import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, FileText, ArrowLeftRight, Landmark, Wallet, Banknote, ShieldCheck, CheckCircle2, XCircle, Printer, Sheet } from "lucide-react";
import { api, download, ApiError } from "../lib/api";
import { Account, AccountStatement, Cashbook, BalanceSheet, IntegrityReport } from "../lib/types";
import { num, fmtMoney } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, EmptyState, TableSkeleton, useToast } from "../components/ui";
import { printAccountStatement } from "../lib/statement";

type Tab = "accounts" | "cashbook" | "balancesheet" | "integrity";

export default function Accounts() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("accounts");
  const manage = can("accounts.manage");

  return (
    <div>
      <PageHeader title="Accounts & Cash" sub="Your cash drawer, bank accounts and wallets — plus the day-close cash book and balance sheet." />
      <div className="flex gap-1 mb-4 border-b border-edge">
        {([
          ["accounts", "Accounts", Wallet],
          ["cashbook", "Cash Book", Banknote],
          ["balancesheet", "Balance Sheet", Landmark],
          ["integrity", "Integrity", ShieldCheck],
        ] as [Tab, string, typeof Wallet][]).map(([key, label, Icon]) => (
          <button
            key={key}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${tab === key ? "border-accent text-ink font-semibold" : "border-transparent text-muted hover:text-ink"}`}
            onClick={() => setTab(key)}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === "accounts" && <AccountsTab manage={manage} />}
      {tab === "cashbook" && <CashbookTab />}
      {tab === "balancesheet" && <BalanceSheetTab />}
      {tab === "integrity" && <IntegrityTab />}
    </div>
  );
}

/* ───────────── Accounts tab ───────────── */

function AccountsTab({ manage }: { manage: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [capital, setCapital] = useState<false | "CAPITAL_IN" | "DRAWING">(false);
  const [statementOf, setStatementOf] = useState<Account | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["accounts"], queryFn: () => api<{ accounts: Account[]; totalCash: string }>("/accounts") });
  const accounts = data?.accounts ?? [];

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {manage && <button className="btn btn-secondary" onClick={() => setEditing("new")}><Plus size={16} /> New account</button>}
        {manage && <button className="btn btn-secondary" onClick={() => setTransfer(true)}><ArrowLeftRight size={16} /> Transfer</button>}
        {manage && <button className="btn btn-secondary" onClick={() => setCapital("CAPITAL_IN")}><Plus size={16} /> Add capital</button>}
        {manage && <button className="btn btn-secondary" onClick={() => setCapital("DRAWING")}><Banknote size={16} /> Withdraw (drawing)</button>}
        <div className="flex-1" />
        <div className="card px-4 py-2 flex items-center gap-3">
          <span className="text-muted text-sm">Total money on hand</span>
          <span className="text-lg font-bold money text-accent">{fmtMoney(data?.totalCash ?? 0)}</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          <div className="col-span-full card"><TableSkeleton cols={2} /></div>
        ) : accounts.length === 0 ? (
          <div className="col-span-full card"><EmptyState title="No accounts" hint="Add your cash drawer and bank accounts." /></div>
        ) : (
          accounts.map((a) => {
            const bal = num(a.currentBalance);
            return (
              <div key={a.id} className={`card p-4 ${!a.isActive ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-lg bg-surface-2 border border-edge flex items-center justify-center">
                      {a.isCash ? <Wallet size={17} className="text-muted" /> : <Landmark size={17} className="text-muted" />}
                    </div>
                    <div>
                      <p className="font-semibold">{a.name}</p>
                      <p className="text-xs text-muted">{a.bankName || (a.isCash ? "Cash" : "Account")}{a.accountNo ? ` · ${a.accountNo}` : ""}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button className="btn btn-secondary !p-1.5" title="Statement" onClick={() => setStatementOf(a)}><FileText size={14} /></button>
                    {manage && <button className="btn btn-secondary !p-1.5" title="Edit" onClick={() => setEditing(a)}><Pencil size={14} /></button>}
                  </div>
                </div>
                <div className={`mt-3 text-2xl font-bold money ${bal < 0 ? "text-danger" : ""}`}>{fmtMoney(a.currentBalance)}</div>
              </div>
            );
          })
        )}
      </div>

      {editing !== null && <AccountForm account={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ["accounts"] }); setEditing(null); }} />}
      {transfer && <TransferForm accounts={accounts} onClose={() => setTransfer(false)} onDone={(m) => { toast(m); qc.invalidateQueries({ queryKey: ["accounts"] }); setTransfer(false); }} />}
      {capital && <CapitalForm direction={capital} accounts={accounts} onClose={() => setCapital(false)} onDone={(m) => { toast(m); qc.invalidateQueries({ queryKey: ["accounts"] }); setCapital(false); }} />}
      {statementOf && <AccountStatementModal account={statementOf} onClose={() => setStatementOf(null)} />}
    </div>
  );
}

function AccountForm({ account, onClose, onSaved }: { account: Account | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: account?.name ?? "",
    isCash: account?.isCash ?? false,
    bankName: account?.bankName ?? "",
    accountNo: account?.accountNo ?? "",
    openingBalance: String(num(account?.openingBalance)),
    isActive: account?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, isCash: form.isCash, bankName: form.bankName || null, accountNo: form.accountNo || null, openingBalance: Number(form.openingBalance) || 0, isActive: form.isActive };
      return account ? api(`/accounts/${account.id}`, { method: "PATCH", body }) : api("/accounts", { method: "POST", body });
    },
    onSuccess: onSaved,
    onError: (e: ApiError) => setError(e.message),
  });
  return (
    <Modal open onClose={onClose} title={account ? `Edit ${account.name}` : "New account"}>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} className="space-y-4">
        <div><label className="label">Account name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Meezan Bank" required autoFocus /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isCash} onChange={(e) => setForm({ ...form, isCash: e.target.checked })} /> This is a cash account (drawer / hand cash)</label>
        {!form.isCash && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Bank / wallet</label><input className="input" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} placeholder="Meezan / JazzCash" /></div>
            <div><label className="label">Account number</label><input className="input mono" value={form.accountNo} onChange={(e) => setForm({ ...form, accountNo: e.target.value })} /></div>
          </div>
        )}
        <div><label className="label">Opening balance</label><input className="input mono" type="number" step="0.01" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} /></div>
        {account && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>}
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-secondary !border-accent !text-accent" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</button></div>
      </form>
    </Modal>
  );
}

function TransferForm({ accounts, onClose, onDone }: { accounts: Account[]; onClose: () => void; onDone: (m: string) => void }) {
  const active = accounts.filter((a) => a.isActive);
  const [form, setForm] = useState({ fromAccountId: active[0]?.id ?? "", toAccountId: active[1]?.id ?? "", amount: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api<{ transfer: { refNo: string } }>("/accounts/transfer", { method: "POST", body: { fromAccountId: form.fromAccountId, toAccountId: form.toAccountId, amount: Number(form.amount), notes: form.notes || null } }),
    onSuccess: (d) => onDone(`Transfer ${d.transfer.refNo} saved`),
    onError: (e: ApiError) => setError(e.message),
  });
  return (
    <Modal open onClose={onClose} title="Transfer money between accounts">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">From</label><select className="input" value={form.fromAccountId} onChange={(e) => setForm({ ...form, fromAccountId: e.target.value })}>{active.map((a) => <option key={a.id} value={a.id}>{a.name} ({fmtMoney(a.currentBalance)})</option>)}</select></div>
          <div><label className="label">To</label><select className="input" value={form.toAccountId} onChange={(e) => setForm({ ...form, toAccountId: e.target.value })}>{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        </div>
        <div><label className="label">Amount</label><input className="input mono" type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" required autoFocus /></div>
        <div><label className="label">Note (optional)</label><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Cash deposited to bank" /></div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-secondary !border-accent !text-accent" disabled={save.isPending}>{save.isPending ? "Saving…" : "Transfer"}</button></div>
      </form>
    </Modal>
  );
}

function CapitalForm({ direction, accounts, onClose, onDone }: { direction: "CAPITAL_IN" | "DRAWING"; accounts: Account[]; onClose: () => void; onDone: (m: string) => void }) {
  const active = accounts.filter((a) => a.isActive);
  const isIn = direction === "CAPITAL_IN";
  const [form, setForm] = useState({ accountId: active.find((a) => a.isCash)?.id ?? active[0]?.id ?? "", amount: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api<{ entry: { refNo: string } }>("/accounts/capital", { method: "POST", body: { direction, accountId: form.accountId, amount: Number(form.amount), notes: form.notes || null } }),
    onSuccess: (d) => onDone(`${isIn ? "Capital" : "Drawing"} ${d.entry.refNo} saved`),
    onError: (e: ApiError) => setError(e.message),
  });
  return (
    <Modal open onClose={onClose} title={isIn ? "Add owner capital" : "Owner withdrawal (drawing)"}>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} className="space-y-4">
        <p className="text-sm text-muted">{isIn ? "Money you put into the business. Increases equity — it is not income." : "Money you take out for personal use. Reduces equity — it is not an expense."}</p>
        <div><label className="label">{isIn ? "Into account" : "From account"}</label><select className="input" value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>{active.map((a) => <option key={a.id} value={a.id}>{a.name} ({fmtMoney(a.currentBalance)})</option>)}</select></div>
        <div><label className="label">Amount</label><input className="input mono" type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required autoFocus /></div>
        <div><label className="label">Note (optional)</label><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-secondary !border-accent !text-accent" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</button></div>
      </form>
    </Modal>
  );
}

function AccountStatementModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const params = new URLSearchParams({ ...(from && { from }), ...(to && { to: `${to}T23:59:59` }) });
  const { data, isLoading } = useQuery({ queryKey: ["account-statement", account.id, from, to], queryFn: () => api<AccountStatement>(`/accounts/${account.id}/statement?${params}`) });
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: () => api<{ settings: Record<string, string> }>("/settings") });

  return (
    <Modal open onClose={onClose} title={`Statement — ${account.name}`} wide>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="label">From</label><input type="date" className="input !w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="label">To</label><input type="date" className="input !w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="flex-1" />
          <button className="btn btn-secondary" disabled={!data} onClick={() => data && printAccountStatement(data, settingsData?.settings ?? {})}><Printer size={15} /> Print / PDF</button>
        </div>
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <div><span className="text-muted">Opening</span><div className="money font-semibold">{fmtMoney(data.opening)}</div></div>
            <div><span className="text-muted">Money in</span><div className="money text-success">{fmtMoney(data.totalIn)}</div></div>
            <div><span className="text-muted">Money out</span><div className="money text-danger">{fmtMoney(data.totalOut)}</div></div>
            <div><span className="text-muted">Closing</span><div className="money font-semibold">{fmtMoney(data.closing)}</div></div>
          </div>
        )}
        <div className="card overflow-hidden">
          {isLoading ? (
            <TableSkeleton cols={5} />
          ) : !data || data.entries.length === 0 ? (
            <EmptyState title="No movements" hint="Nothing recorded in this period." />
          ) : (
            <div className="max-h-[45vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface"><tr className="text-left text-muted border-b border-edge text-xs"><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Detail</th><th className="px-3 py-2 font-medium text-right">In</th><th className="px-3 py-2 font-medium text-right">Out</th><th className="px-3 py-2 font-medium text-right">Balance</th></tr></thead>
                <tbody>
                  {data.entries.map((e) => {
                    const amt = num(e.amount);
                    return (
                      <tr key={e.id} className="border-b border-edge last:border-0">
                        <td className="px-3 py-1.5 text-muted whitespace-nowrap">{new Date(e.date).toLocaleDateString()}</td>
                        <td className="px-3 py-1.5 text-xs">{e.type.replace("_", " ")}</td>
                        <td className="px-3 py-1.5">{e.notes ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right money text-success">{amt > 0 ? fmtMoney(amt) : "—"}</td>
                        <td className="px-3 py-1.5 text-right money text-danger">{amt < 0 ? fmtMoney(-amt) : "—"}</td>
                        <td className="px-3 py-1.5 text-right money">{fmtMoney(e.running ?? e.balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ───────────── Cash book tab ───────────── */

function CashbookTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const params = new URLSearchParams({ from, to: `${to}T23:59:59` });
  const { data, isLoading } = useQuery({ queryKey: ["cashbook", from, to], queryFn: () => api<Cashbook>(`/reports/cashbook?${params}`) });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="label">From</label><input type="date" className="input !w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input !w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <button className="btn btn-secondary" onClick={() => { setFrom(today); setTo(today); }}>Today</button>
        <div className="flex-1" />
        <button className="btn btn-secondary" onClick={() => download(`/reports/cashbook?${params}&format=pdf`, "cash-book.pdf")} disabled={!data}><Printer size={15} /> PDF</button>
        <button className="btn btn-secondary" onClick={() => download(`/reports/cashbook?${params}&format=xlsx`, "cash-book.xlsx")} disabled={!data}><Sheet size={15} /> Excel</button>
      </div>
      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={5} />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted border-b border-edge"><th className="px-4 py-2.5 font-medium">Account</th><th className="px-4 py-2.5 font-medium text-right">Opening</th><th className="px-4 py-2.5 font-medium text-right">Money in</th><th className="px-4 py-2.5 font-medium text-right">Money out</th><th className="px-4 py-2.5 font-medium text-right">Closing</th></tr></thead>
            <tbody>
              {(data?.rows ?? []).map((r) => (
                <tr key={r.accountId} className="border-b border-edge last:border-0">
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="px-4 py-2 text-right money">{fmtMoney(r.opening)}</td>
                  <td className="px-4 py-2 text-right money text-success">{fmtMoney(r.moneyIn)}</td>
                  <td className="px-4 py-2 text-right money text-danger">{fmtMoney(r.moneyOut)}</td>
                  <td className="px-4 py-2 text-right money font-semibold">{fmtMoney(r.closing)}</td>
                </tr>
              ))}
              {data && (
                <tr className="border-t border-edge font-bold bg-surface-2/40">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right money">{fmtMoney(data.totals.opening)}</td>
                  <td className="px-4 py-2.5 text-right money text-success">{fmtMoney(data.totals.moneyIn)}</td>
                  <td className="px-4 py-2.5 text-right money text-danger">{fmtMoney(data.totals.moneyOut)}</td>
                  <td className="px-4 py-2.5 text-right money">{fmtMoney(data.totals.closing)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ───────────── Balance sheet tab ───────────── */

function BalanceSheetTab() {
  const { data, isLoading } = useQuery({ queryKey: ["balance-sheet"], queryFn: () => api<{ balanceSheet: BalanceSheet }>("/reports/balance-sheet") });
  const bs = data?.balanceSheet;
  if (isLoading || !bs) return <div className="card"><TableSkeleton cols={2} /></div>;
  const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
    <div className={`flex justify-between py-1.5 ${bold ? "font-bold border-t border-edge mt-1 pt-2" : ""}`}><span className={bold ? "" : "text-muted"}>{label}</span><span className="money">{fmtMoney(value)}</span></div>
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="card p-4"><h3 className="font-semibold display mb-2">Assets (what you have)</h3><Row label="Cash & bank" value={bs.assets.cashBank} /><Row label="Stock value (at cost)" value={bs.assets.stockValue} /><Row label="Receivables (owed to you)" value={bs.assets.receivables} />{num(bs.assets.vendorAdvances) > 0 && <Row label="Advances to vendors" value={bs.assets.vendorAdvances} />}{num(bs.assets.employeeAdvances) > 0 && <Row label="Staff advances" value={bs.assets.employeeAdvances} />}<Row label="Total assets" value={bs.assets.total} bold /></div>
        <div className="card p-4"><h3 className="font-semibold display mb-2">Liabilities (what you owe)</h3><Row label="Payables (to vendors)" value={bs.liabilities.payables} />{num(bs.liabilities.customerAdvances) > 0 && <Row label="Customer advances" value={bs.liabilities.customerAdvances} />}<Row label="Total liabilities" value={bs.liabilities.total} bold /></div>
        <div className="card p-4"><h3 className="font-semibold display mb-2">Equity (your stake)</h3><Row label="Capital" value={bs.equity.capital} />{num(bs.equity.openingStock) !== 0 && <Row label="Opening stock" value={bs.equity.openingStock} />}{num(bs.equity.openingBalances) !== 0 && <Row label="Opening balances" value={bs.equity.openingBalances} />}<Row label="Drawings" value={`-${num(bs.equity.drawings)}`} /><Row label="Retained profit" value={bs.equity.retainedEarnings} /><Row label="Total equity" value={bs.equity.total} bold /></div>
      </div>
      <div className={`card p-3 flex items-center gap-2 ${Math.abs(bs.imbalance) < 1 ? "text-success" : "text-danger"}`}>
        {Math.abs(bs.imbalance) < 1 ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
        <span className="text-sm font-medium">{Math.abs(bs.imbalance) < 1 ? `Balanced: Assets = Liabilities + Equity = ${fmtMoney(bs.assets.total)}` : `Out of balance by ${fmtMoney(bs.imbalance)} — run the Integrity check`}</span>
      </div>
    </div>
  );
}

/* ───────────── Integrity tab ───────────── */

function IntegrityTab() {
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ["integrity"], queryFn: () => api<IntegrityReport>("/reports/integrity") });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Proves the books are internally consistent — stock, cash, sales, purchases, ledgers and the balance sheet all agree.</p>
        <button className="btn btn-secondary" onClick={() => refetch()} disabled={isFetching}>{isFetching ? "Checking…" : "Re-run check"}</button>
      </div>
      {isLoading || !data ? (
        <div className="card"><TableSkeleton cols={2} /></div>
      ) : (
        <>
          <div className={`card p-4 flex items-center gap-3 ${data.allGreen ? "text-success" : "text-danger"}`}>
            {data.allGreen ? <CheckCircle2 size={24} /> : <XCircle size={24} />}
            <span className="text-lg font-bold">{data.allGreen ? "All green — everything reconciles" : "Some checks failed — see below"}</span>
          </div>
          <div className="card divide-y divide-edge">
            {data.checks.map((c) => (
              <div key={c.name} className="flex items-start gap-3 p-3">
                {c.ok ? <CheckCircle2 size={18} className="text-success shrink-0 mt-0.5" /> : <XCircle size={18} className="text-danger shrink-0 mt-0.5" />}
                <div><p className="font-medium text-sm">{c.name}</p><p className="text-xs text-muted mt-0.5">{c.detail}</p></div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
