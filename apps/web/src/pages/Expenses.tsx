import { useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Tags, Receipt, Repeat, Play, Wallet } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Expense, ExpenseCategory, Account, Paged, RecurringExpense } from "../lib/types";
import { fmtMoney } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, ConfirmDialog, EmptyState, TableSkeleton, SearchBox, Pagination, FormSection, useToast } from "../components/ui";

export default function Expenses() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);

  const { data: catData } = useQuery({ queryKey: ["expense-categories"], queryFn: () => api<{ categories: ExpenseCategory[] }>("/expenses/categories") });
  const categories = catData?.categories ?? [];

  const params = new URLSearchParams({ page: String(page), limit: "20", ...(search.trim() && { search: search.trim() }), ...(categoryId && { categoryId }), ...(from && { from }), ...(to && { to: `${to}T23:59:59` }) });
  const { data, isLoading } = useQuery({ queryKey: ["expenses", page, search, categoryId, from, to], queryFn: () => api<Paged<"expenses", Expense> & { totalAmount: string }>(`/expenses?${params}`), placeholderData: keepPreviousData });
  const expenses = data?.expenses ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => api<{ message: string }>(`/expenses/${id}`, { method: "DELETE" }),
    onSuccess: (d) => { toast(d.message); qc.invalidateQueries({ queryKey: ["expenses"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); setDeleting(null); },
    onError: (e: ApiError) => { toast(e.message, "error"); setDeleting(null); },
  });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["expenses"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); };

  return (
    <div>
      <PageHeader
        title="Expenses"
        sub={`Rent, salaries, electricity, transport and misc — all reduce your profit. Total shown: ${fmtMoney(data?.totalAmount ?? 0)}`}
        actions={
          <>
            {(can("expenses.create") || can("expenses.edit")) && <button className="btn btn-secondary" onClick={() => setRecurringOpen(true)}><Repeat size={16} /> Recurring</button>}
            {can("expenses.edit") && <button className="btn btn-secondary" onClick={() => setCatsOpen(true)}><Tags size={16} /> Categories</button>}
            {can("expenses.create") && <button className="btn btn-secondary" onClick={() => setAdding(true)}><Plus size={16} /> Add expense</button>}
          </>
        }
      />

      <div className="flex flex-wrap gap-2 mb-3">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search ref / note…" />
        <select className="input !w-44" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" className="input !w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From" />
        <input type="date" className="input !w-40" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To" />
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={6} />
        ) : expenses.length === 0 ? (
          <EmptyState title={search || categoryId ? "No expenses match" : "No expenses yet"} hint={search || categoryId ? "Try different filters." : "Record shop costs like rent and electricity here."} />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted border-b border-edge"><th className="px-4 py-2.5 font-medium">Ref</th><th className="px-4 py-2.5 font-medium">Date</th><th className="px-4 py-2.5 font-medium">Category</th><th className="px-4 py-2.5 font-medium">Account</th><th className="px-4 py-2.5 font-medium">Note</th><th className="px-4 py-2.5 font-medium text-right">Amount</th><th className="px-4 py-2.5 w-20" /></tr></thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                    <td className="px-4 py-2 mono text-xs whitespace-nowrap">{e.refNo}{e.recurringId && <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-surface-2 px-1 py-0.5 text-[10px] text-muted align-middle"><Repeat size={9} /> Auto</span>}</td>
                    <td className="px-4 py-2 text-muted whitespace-nowrap">{new Date(e.date).toLocaleDateString()}</td>
                    <td className="px-4 py-2"><span className="inline-flex items-center gap-1.5"><Receipt size={13} className="text-muted" /> {e.category?.name}</span></td>
                    <td className="px-4 py-2 text-muted">{e.payment?.method?.name ?? "—"}</td>
                    <td className="px-4 py-2 text-muted truncate max-w-[16rem]">{e.notes ?? "—"}</td>
                    <td className="px-4 py-2 text-right money text-danger">{fmtMoney(e.amount)}</td>
                    <td className="px-4 py-2">
                      {can("expenses.edit") && (
                        <div className="flex justify-end gap-1">
                          <button className="btn btn-secondary !p-1.5" title="Edit" onClick={() => setEditing(e)}><Pencil size={14} /></button>
                          <button className="btn btn-secondary !p-1.5 hover:!text-danger" title="Delete" onClick={() => setDeleting(e)}><Trash2 size={14} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} />
          </>
        )}
      </div>

      {adding && <ExpenseForm categories={categories} onClose={() => setAdding(false)} onDone={(m) => { toast(m); invalidate(); setAdding(false); }} />}
      {editing && <EditExpenseForm expense={editing} categories={categories} onClose={() => setEditing(null)} onDone={(m) => { toast(m); invalidate(); setEditing(null); }} />}
      <ConfirmDialog open={deleting !== null} title={`Delete ${deleting?.refNo ?? ""}?`} message="This reverses the money back onto its account. Salary expenses must be removed from the employee's salary history instead." busy={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting.id)} onClose={() => setDeleting(null)} />
      {catsOpen && <CategoriesModal categories={categories} onClose={() => setCatsOpen(false)} onChanged={() => qc.invalidateQueries({ queryKey: ["expense-categories"] })} />}
      {recurringOpen && <RecurringModal categories={categories} canEdit={can("expenses.edit")} canRun={can("expenses.create")} onClose={() => setRecurringOpen(false)} onPosted={invalidate} />}
    </div>
  );
}

function RecurringModal({ categories, canEdit, canRun, onClose, onPosted }: { categories: ExpenseCategory[]; canEdit: boolean; canRun: boolean; onClose: () => void; onPosted: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rulesData } = useQuery({ queryKey: ["recurring-expenses"], queryFn: () => api<{ rules: RecurringExpense[] }>("/expenses/recurring") });
  const { data: accData } = useQuery({ queryKey: ["accounts"], queryFn: () => api<{ accounts: Account[] }>("/accounts") });
  const rules = rulesData?.rules ?? [];
  const accounts = (accData?.accounts ?? []).filter((a) => a.isActive);
  const payCategories = categories.filter((c) => c.name !== "Salaries"); // payroll posts its own expenses

  const empty = { id: "", categoryId: "", methodId: "", amount: "", dayOfMonth: "1", notes: "" };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const categoryId = form.categoryId || payCategories[0]?.id || "";
  const methodId = form.methodId || accounts.find((a) => a.isCash)?.id || accounts[0]?.id || "";

  const refresh = () => qc.invalidateQueries({ queryKey: ["recurring-expenses"] });
  const save = useMutation({
    mutationFn: () => {
      const body = { categoryId, methodId, amount: Number(form.amount), dayOfMonth: Number(form.dayOfMonth), notes: form.notes || null };
      return form.id ? api(`/expenses/recurring/${form.id}`, { method: "PATCH", body }) : api("/expenses/recurring", { method: "POST", body });
    },
    onSuccess: () => { toast(form.id ? "Rule updated" : "Recurring rule added"); setForm(empty); refresh(); },
    onError: (e: ApiError) => setError(e.message),
  });
  const toggle = useMutation({
    mutationFn: (r: RecurringExpense) => api(`/expenses/recurring/${r.id}`, { method: "PATCH", body: { isActive: !r.isActive } }),
    onSuccess: refresh, onError: (e: ApiError) => toast(e.message, "error"),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/expenses/recurring/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast("Rule removed"); refresh(); }, onError: (e: ApiError) => toast(e.message, "error"),
  });
  const run = useMutation({
    mutationFn: () => api<{ count: number }>("/expenses/recurring/run", { method: "POST" }),
    onSuccess: (d) => { toast(d.count ? `Posted ${d.count} recurring expense(s)` : "Nothing was due"); refresh(); onPosted(); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  return (
    <Modal open onClose={onClose} title="Recurring expenses">
      <div className="space-y-4">
        <p className="text-xs text-muted">Rent, electricity and other fixed monthly costs post themselves automatically on their day each month (and when the app opens). Safe to run any time — each rule posts only once per month.</p>

        {canEdit && (
          <form onSubmit={(e) => { e.preventDefault(); setError(null); if (form.amount) save.mutate(); }} className="card p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Category</label><select className="input" value={categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{payCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label className="label">Paid from</label><select className="input" value={methodId} onChange={(e) => setForm({ ...form, methodId: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">Amount</label><input className="input mono" type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></div>
              <div><label className="label">Day of month</label><input className="input mono" type="number" min="1" max="28" value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })} /></div>
              <div><label className="label">Note</label><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Shop rent" /></div>
            </div>
            {error && <p className="text-danger text-sm">{error}</p>}
            <div className="flex justify-end gap-2">
              {form.id && <button type="button" className="btn btn-secondary" onClick={() => { setForm(empty); setError(null); }}>Cancel edit</button>}
              <button className="btn btn-primary" disabled={save.isPending || !form.amount}>{form.id ? "Save changes" : <><Plus size={15} /> Add rule</>}</button>
            </div>
          </form>
        )}

        <div className="card divide-y divide-edge max-h-64 overflow-y-auto">
          {rules.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted">No recurring rules yet.</div>
          ) : rules.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.category?.name}</span>
                  <span className="money">{fmtMoney(r.amount)}</span>
                  {!r.isActive && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">Paused</span>}
                </div>
                <div className="text-xs text-muted truncate">Day {r.dayOfMonth} · {r.method?.name}{r.notes ? ` · ${r.notes}` : ""}{r.lastPostedPeriod ? ` · last ${r.lastPostedPeriod}` : ""}</div>
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  <button className="btn btn-secondary !p-1.5" title={r.isActive ? "Pause" : "Resume"} onClick={() => toggle.mutate(r)}>{r.isActive ? "⏸" : "▶"}</button>
                  <button className="btn btn-secondary !p-1.5" title="Edit" onClick={() => setForm({ id: r.id, categoryId: r.categoryId, methodId: r.methodId, amount: String(r.amount), dayOfMonth: String(r.dayOfMonth), notes: r.notes ?? "" })}><Pencil size={14} /></button>
                  <button className="btn btn-secondary !p-1.5 hover:!text-danger" title="Delete" onClick={() => del.mutate(r.id)}><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{rules.filter((r) => r.isActive).length} active</span>
          {canRun && <button className="btn btn-secondary" onClick={() => run.mutate()} disabled={run.isPending}><Play size={15} /> {run.isPending ? "Posting…" : "Run due now"}</button>}
        </div>
      </div>
    </Modal>
  );
}

function ExpenseForm({ categories, onClose, onDone }: { categories: ExpenseCategory[]; onClose: () => void; onDone: (m: string) => void }) {
  const { data: accData } = useQuery({ queryKey: ["accounts"], queryFn: () => api<{ accounts: Account[] }>("/accounts") });
  const accounts = (accData?.accounts ?? []).filter((a) => a.isActive);
  const [form, setForm] = useState({ categoryId: categories.find((c) => c.name !== "Salaries")?.id ?? categories[0]?.id ?? "", methodId: "", amount: "", date: new Date().toISOString().slice(0, 10), notes: "" });
  const [error, setError] = useState<string | null>(null);
  const methodId = form.methodId || accounts.find((a) => a.isCash)?.id || accounts[0]?.id || "";
  const save = useMutation({
    mutationFn: () => api<{ expense: { refNo: string } }>("/expenses", { method: "POST", body: { categoryId: form.categoryId, methodId, amount: Number(form.amount), date: form.date, notes: form.notes || null } }),
    onSuccess: (d) => onDone(`Expense ${d.expense.refNo} saved`),
    onError: (e: ApiError) => setError(e.message),
  });
  return (
    <Modal open onClose={onClose} title="Add expense">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} className="space-y-4">
        <FormSection title="Expense details" icon={Receipt} color="var(--accent)">
          <div className="space-y-3">
            <div><label className="label">Category</label><select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{categories.filter((c) => c.name !== "Salaries").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="label">Date</label><input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div><label className="label">Note (optional)</label><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="July shop rent" /></div>
          </div>
        </FormSection>

        <FormSection title="Amount & payment" icon={Wallet} color="var(--danger)">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Amount</label><input className="input mono" type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required autoFocus /></div>
            <div><label className="label">Paid from</label><select className="input" value={methodId} onChange={(e) => setForm({ ...form, methodId: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          </div>
        </FormSection>

        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save expense"}</button></div>
      </form>
    </Modal>
  );
}

function EditExpenseForm({ expense, categories, onClose, onDone }: { expense: Expense; categories: ExpenseCategory[]; onClose: () => void; onDone: (m: string) => void }) {
  const [form, setForm] = useState({ categoryId: expense.categoryId, date: expense.date.slice(0, 10), notes: expense.notes ?? "" });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api(`/expenses/${expense.id}`, { method: "PATCH", body: { categoryId: form.categoryId, date: form.date, notes: form.notes || null } }),
    onSuccess: () => onDone(`${expense.refNo} updated`),
    onError: (e: ApiError) => setError(e.message),
  });
  return (
    <Modal open onClose={onClose} title={`Edit ${expense.refNo}`}>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} className="space-y-4">
        <div className="rounded-lg border border-edge bg-surface-2 px-3 py-2.5 text-xs text-muted">Amount (<span className="money text-danger">{fmtMoney(expense.amount)}</span>) and account can't be edited — delete and re-add to change them.</div>
        <FormSection title="Expense details" icon={Receipt} color="var(--accent)">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Category</label><select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label className="label">Date</label><input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            </div>
            <div><label className="label">Note</label><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
        </FormSection>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</button></div>
      </form>
    </Modal>
  );
}

function CategoriesModal({ categories, onClose, onChanged }: { categories: ExpenseCategory[]; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const add = useMutation({ mutationFn: () => api("/expenses/categories", { method: "POST", body: { name } }), onSuccess: () => { setName(""); onChanged(); }, onError: (e: ApiError) => toast(e.message, "error") });
  const del = useMutation({ mutationFn: (id: string) => api(`/expenses/categories/${id}`, { method: "DELETE" }), onSuccess: onChanged, onError: (e: ApiError) => toast(e.message, "error") });
  return (
    <Modal open onClose={onClose} title="Expense categories">
      <div className="space-y-3">
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }} className="flex gap-2">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" />
          <button className="btn btn-primary" disabled={add.isPending || !name.trim()}><Plus size={15} /> Add</button>
        </form>
        <div className="card divide-y divide-edge max-h-72 overflow-y-auto">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{c.name} <span className="text-muted text-xs">({c._count?.expenses ?? 0})</span></span>
              <button className="btn btn-secondary !p-1.5 hover:!text-danger" title="Delete" onClick={() => del.mutate(c.id)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
