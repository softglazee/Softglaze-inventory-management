import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, IdCard, HandCoins, Camera, History, CalendarDays, Building2, Clock, CheckCircle2, XCircle, Coins, CalendarCheck, FileDown, Upload } from "lucide-react";
import { api, ApiError, download } from "../lib/api";
import { Employee, SalaryPayment, Department, Shift, Holiday, LeaveRequest, Account, Attendance, AttendanceStatus, AttendanceSummary, EmployeeAdvance, SalaryPreview } from "../lib/types";
import { num, fmtMoney } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, ConfirmDialog, EmptyState, TableSkeleton, SearchBox, Badge, FormSection, Pagination, useClientPagination, useToast } from "../components/ui";

type Tab = "staff" | "attendance" | "salaries" | "hr";

export default function Employees() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("staff");
  return (
    <div>
      <PageHeader title="Employees & Salaries" sub="Staff profiles, daily attendance, salary advances, and monthly salary (auto-recorded as expenses)." />
      <div className="flex gap-1 mb-4 border-b border-edge">
        {([["staff", "Staff", IdCard], ["attendance", "Attendance", CalendarCheck], ["salaries", "Salaries", HandCoins], ["hr", "HR", CalendarDays]] as [Tab, string, typeof IdCard][]).map(([key, label, Icon]) => (
          <button key={key} className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px ${tab === key ? "border-accent text-ink font-semibold" : "border-transparent text-muted hover:text-ink"}`} onClick={() => setTab(key)}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {tab === "staff" && <StaffTab can={can} />}
      {tab === "attendance" && <AttendanceTab can={can} />}
      {tab === "salaries" && <SalariesTab can={can} />}
      {tab === "hr" && <HRTab can={can} />}
    </div>
  );
}

/* ───────────── Staff ───────────── */

function StaffTab({ can }: { can: (...k: string[]) => boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Employee | "new" | null>(null);
  const [paying, setPaying] = useState<Employee | null>(null);
  const [advancing, setAdvancing] = useState<Employee | null>(null);
  const [history, setHistory] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["employees", search], queryFn: () => api<{ employees: Employee[] }>(`/employees?status=active${search ? `&search=${encodeURIComponent(search)}` : ""}`) });
  const employees = data?.employees ?? [];
  const { page, pages, setPage, pageRows, total, perPage } = useClientPagination(employees, 12);
  const manage = can("employees.manage");

  const remove = useMutation({
    mutationFn: (id: string) => api<{ message: string }>(`/employees/${id}`, { method: "DELETE" }),
    onSuccess: (d) => { toast(d.message); qc.invalidateQueries({ queryKey: ["employees"] }); setDeleting(null); },
    onError: (e: ApiError) => { toast(e.message, "error"); setDeleting(null); },
  });

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Search name / code…" />
        <div className="flex-1" />
        {manage && <button className="btn btn-secondary" onClick={() => setEditing("new")}><Plus size={16} /> Add employee</button>}
      </div>

      {isLoading ? (
        <div className="card"><TableSkeleton cols={3} /></div>
      ) : employees.length === 0 ? (
        <div className="card"><EmptyState title={search ? "No staff match" : "No employees yet"} hint={search ? "Try another search." : "Add your salesmen, loaders and drivers here."} /></div>
      ) : (
        <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pageRows.map((e) => (
            <div key={e.id} className="card p-4">
              <div className="flex items-start gap-3">
                {e.photo ? <img src={e.photo} alt="" className="w-12 h-12 rounded-full object-cover border border-edge" /> : <div className="w-12 h-12 rounded-full bg-surface-2 border border-edge flex items-center justify-center"><IdCard size={20} className="text-muted" /></div>}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{e.name}</p>
                  <p className="text-xs text-muted">{e.code}{e.designation ? ` · ${e.designation}` : ""}</p>
                  <p className="text-sm money mt-0.5">{fmtMoney(e.baseSalary)}<span className="text-muted text-xs"> /month</span></p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {can("salary.pay") && <button className="btn btn-secondary !py-1 !text-xs !border-accent !text-accent" onClick={() => setPaying(e)}><HandCoins size={13} /> Pay salary</button>}
                {can("salary.pay") && <button className="btn btn-secondary !py-1 !text-xs" onClick={() => setAdvancing(e)}><Coins size={13} /> Advance</button>}
                <button className="btn btn-secondary !py-1 !text-xs" onClick={() => setHistory(e)}><History size={13} /> History</button>
                {manage && <button className="btn btn-secondary !p-1.5" title="Edit" onClick={() => setEditing(e)}><Pencil size={13} /></button>}
                {manage && <button className="btn btn-secondary !p-1.5 hover:!text-danger" title="Remove" onClick={() => setDeleting(e)}><Trash2 size={13} /></button>}
              </div>
            </div>
          ))}
        </div>
        <Pagination page={page} pages={pages} onPage={setPage} total={total} perPage={perPage} />
        </>
      )}

      {editing !== null && <EmployeeForm employee={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ["employees"] }); setEditing(null); }} />}
      {paying && <PaySalaryModal employee={paying} onClose={() => setPaying(null)} onDone={(m) => { toast(m); qc.invalidateQueries({ queryKey: ["employees"] }); qc.invalidateQueries({ queryKey: ["salaries"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); setPaying(null); }} />}
      {advancing && <GiveAdvanceModal employee={advancing} onClose={() => setAdvancing(null)} onDone={() => { qc.invalidateQueries({ queryKey: ["accounts"] }); setAdvancing(null); }} />}
      {history && <SalaryHistoryModal employee={history} onClose={() => setHistory(null)} />}
      <ConfirmDialog open={deleting !== null} title={`Remove ${deleting?.name ?? ""}?`} message="Staff with salary history are deactivated so their records stay on file." busy={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting.id)} onClose={() => setDeleting(null)} />
    </div>
  );
}

function EmployeeForm({ employee, onClose, onSaved }: { employee: Employee | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: depData } = useQuery({ queryKey: ["departments"], queryFn: () => api<{ departments: Department[] }>("/hr/departments") });
  const { data: shiftData } = useQuery({ queryKey: ["shifts"], queryFn: () => api<{ shifts: Shift[] }>("/hr/shifts") });
  const [form, setForm] = useState({
    name: employee?.name ?? "", phone: employee?.phone ?? "", cnic: employee?.cnic ?? "", address: employee?.address ?? "",
    designation: employee?.designation ?? "", departmentId: employee?.departmentId ?? "", shiftId: employee?.shiftId ?? "",
    baseSalary: String(num(employee?.baseSalary)), notes: employee?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, phone: form.phone || null, cnic: form.cnic || null, address: form.address || null, designation: form.designation || null, departmentId: form.departmentId || null, shiftId: form.shiftId || null, baseSalary: Number(form.baseSalary) || 0, notes: form.notes || null };
      return employee ? api<{ employee: Employee }>(`/employees/${employee.id}`, { method: "PATCH", body }) : api<{ employee: Employee }>("/employees", { method: "POST", body });
    },
    onSuccess: onSaved,
    onError: (e: ApiError) => setError(e.message),
  });
  const photo = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append("image", file); return api(`/employees/${employee!.id}/photo`, { method: "POST", body: fd, isForm: true }); },
    onSuccess: () => { toast("Photo updated"); onSaved(); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  return (
    <Modal open onClose={onClose} title={employee ? `Edit ${employee.name}` : "Add employee"} wide>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} className="space-y-4">
        {employee && (
          <div className="flex items-center gap-3">
            {employee.photo ? <img src={employee.photo} alt="" className="w-14 h-14 rounded-full object-cover border border-edge" /> : <div className="w-14 h-14 rounded-full bg-surface-2 border border-edge flex items-center justify-center"><IdCard size={22} className="text-muted" /></div>}
            <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}><Camera size={15} /> {photo.isPending ? "Uploading…" : "Photo"}</button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && photo.mutate(e.target.files[0])} />
          </div>
        )}
        <FormSection title="Employee details" icon={IdCard} color="var(--accent)">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus /></div>
            <div><label className="label">Designation</label><input className="input" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="Salesman / Loader" /></div>
            <div><label className="label">Phone</label><input className="input mono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><label className="label">CNIC</label><input className="input mono" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} /></div>
            <div><label className="label">Department</label><select className="input" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}><option value="">—</option>{(depData?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div><label className="label">Shift</label><select className="input" value={form.shiftId} onChange={(e) => setForm({ ...form, shiftId: e.target.value })}><option value="">—</option>{(shiftData?.shifts ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div className="col-span-2"><label className="label">Address</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          </div>
        </FormSection>

        <FormSection title="Salary & notes" icon={HandCoins} color="var(--success)">
          <div className="space-y-3">
            <div><label className="label">Base salary (monthly)</label><input className="input mono" type="number" step="0.01" min="0" value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} /></div>
            <div><label className="label">Notes</label><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
        </FormSection>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : employee ? "Save changes" : "Save employee"}</button></div>
      </form>
    </Modal>
  );
}

function PaySalaryModal({ employee, onClose, onDone }: { employee: Employee; onClose: () => void; onDone: (m: string) => void }) {
  const { data: accData } = useQuery({ queryKey: ["accounts"], queryFn: () => api<{ accounts: Account[] }>("/accounts") });
  const accounts = (accData?.accounts ?? []).filter((a) => a.isActive);
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [bonus, setBonus] = useState("0");
  const [deduction, setDeduction] = useState("0");
  const [absentDeduction, setAbsentDeduction] = useState("0");
  const [methodSel, setMethodSel] = useState("");
  const [date, setDate] = useState(now.toISOString().slice(0, 10));
  const [advSel, setAdvSel] = useState<Record<string, boolean>>({});
  const [touchedAbsent, setTouchedAbsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fill absent deduction + open advances from attendance for the chosen month.
  const { data: preview } = useQuery({
    queryKey: ["salary-preview", employee.id, month],
    queryFn: () => api<SalaryPreview>(`/employees/${employee.id}/salary-preview?month=${month}`),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });
  const openAdvances = preview?.openAdvances ?? [];
  // When a fresh preview arrives, prefill the suggested absent deduction (unless edited) and check all advances.
  const prevKey = useRef("");
  if (preview && prevKey.current !== `${employee.id}|${month}`) {
    prevKey.current = `${employee.id}|${month}`;
    if (!touchedAbsent) setAbsentDeduction(String(preview.suggestedAbsentDeduction));
    setAdvSel(Object.fromEntries(preview.openAdvances.map((a) => [a.id, true])));
  }

  const methodId = methodSel || accounts.find((a) => a.isCash)?.id || accounts[0]?.id || "";
  const advanceRecovered = openAdvances.filter((a) => advSel[a.id]).reduce((s, a) => s + num(a.amount), 0);
  const earned = num(employee.baseSalary) + Number(bonus || 0) - Number(deduction || 0) - Number(absentDeduction || 0);
  const net = earned - advanceRecovered;

  const save = useMutation({
    mutationFn: () => api<{ salary: { refNo: string } }>(`/employees/${employee.id}/salary`, {
      method: "POST",
      body: { month, methodId, bonus: Number(bonus) || 0, deduction: Number(deduction) || 0, absentDeduction: Number(absentDeduction) || 0, advanceIds: openAdvances.filter((a) => advSel[a.id]).map((a) => a.id), date },
    }),
    onSuccess: (d) => onDone(`Salary ${d.salary.refNo} paid`),
    onError: (e: ApiError) => setError(e.message),
  });

  return (
    <Modal open onClose={onClose} title={`Pay salary — ${employee.name}`} wide>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div><label className="label">Month</label><input className="input mono" type="month" value={month} onChange={(e) => { setMonth(e.target.value); setTouchedAbsent(false); }} required /></div>
          <div><label className="label">Base salary</label><input className="input mono" value={fmtMoney(employee.baseSalary)} disabled /></div>
          <div><label className="label">Bonus</label><input className="input mono" type="number" step="0.01" min="0" value={bonus} onChange={(e) => setBonus(e.target.value)} /></div>
          <div><label className="label">Other deduction</label><input className="input mono" type="number" step="0.01" min="0" value={deduction} onChange={(e) => setDeduction(e.target.value)} /></div>
          <div><label className="label">Absent deduction</label><input className="input mono" type="number" step="0.01" min="0" value={absentDeduction} onChange={(e) => { setTouchedAbsent(true); setAbsentDeduction(e.target.value); }} /></div>
          <div><label className="label">Paid from</label><select className="input" value={methodId} onChange={(e) => setMethodSel(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        </div>

        {preview && (
          <div className="text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
            <span>Attendance: <b className="text-success">{preview.attendance.present}P</b> · <b className="text-danger">{preview.attendance.absent}A</b> · {preview.attendance.half} half · {preview.attendance.leave} leave</span>
            <span>Suggested absent dock: {fmtMoney(preview.suggestedAbsentDeduction)} <span className="opacity-70">(₨{preview.perDay}/day × absent)</span></span>
            {preview.alreadyPaid && <span className="text-danger">Already paid for this month ({preview.alreadyPaid})</span>}
          </div>
        )}

        {openAdvances.length > 0 && (
          <div className="card p-3">
            <p className="text-sm font-medium mb-1.5 flex items-center gap-1.5"><Coins size={14} /> Recover advances from this salary</p>
            <div className="space-y-1">
              {openAdvances.map((a) => (
                <label key={a.id} className="flex items-center justify-between text-sm py-0.5">
                  <span className="flex items-center gap-2"><input type="checkbox" checked={!!advSel[a.id]} onChange={(e) => setAdvSel({ ...advSel, [a.id]: e.target.checked })} /> <span className="mono text-xs text-muted">{a.refNo}</span> · {new Date(a.date).toLocaleDateString("en-GB")}</span>
                  <span className="money">{fmtMoney(a.amount)}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Date</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>

        <div className="card p-3 space-y-1">
          <div className="flex justify-between text-sm"><span className="text-muted">Earned (wage expense)</span><span className="money">{fmtMoney(earned)}</span></div>
          {advanceRecovered > 0 && <div className="flex justify-between text-sm"><span className="text-muted">Less advances recovered</span><span className="money">− {fmtMoney(advanceRecovered)}</span></div>}
          <div className="flex justify-between items-center border-t border-edge pt-1"><span className="text-sm font-medium">Net cash to pay</span><span className="text-lg font-bold money text-accent">{fmtMoney(net)}</span></div>
        </div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending || earned <= 0 || net < 0}>{save.isPending ? "Paying…" : "Pay salary"}</button></div>
      </form>
    </Modal>
  );
}

function GiveAdvanceModal({ employee, onClose, onDone }: { employee: Employee; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: accData } = useQuery({ queryKey: ["accounts"], queryFn: () => api<{ accounts: Account[] }>("/accounts") });
  const accounts = (accData?.accounts ?? []).filter((a) => a.isActive);
  const { data: advData } = useQuery({ queryKey: ["advances", employee.id], queryFn: () => api<{ advances: EmployeeAdvance[]; openTotal: number }>(`/employees/${employee.id}/advances`) });
  const advances = advData?.advances ?? [];
  const [amount, setAmount] = useState("");
  const [methodSel, setMethodSel] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const methodId = methodSel || accounts.find((a) => a.isCash)?.id || accounts[0]?.id || "";

  const refresh = () => { qc.invalidateQueries({ queryKey: ["advances", employee.id] }); qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: ["salary-preview", employee.id] }); onDone(); };
  const give = useMutation({
    mutationFn: () => api<{ advance: { refNo: string } }>(`/employees/${employee.id}/advance`, { method: "POST", body: { amount: Number(amount), methodId, date, notes: notes || null } }),
    onSuccess: (d) => { toast(`Advance ${d.advance.refNo} given`); setAmount(""); setNotes(""); refresh(); },
    onError: (e: ApiError) => setError(e.message),
  });
  const reverse = useMutation({
    mutationFn: (id: string) => api(`/employees/advances/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast("Advance reversed"); refresh(); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  return (
    <Modal open onClose={onClose} title={`Salary advance — ${employee.name}`}>
      <div className="space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); setError(null); if (!(Number(amount) > 0)) return setError("Enter an amount"); give.mutate(); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Amount</label><input className="input mono" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
            <div><label className="label">From account</label><select className="input" value={methodId} onChange={(e) => setMethodSel(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
            <div><label className="label">Date</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><label className="label">Note</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" /></div>
          </div>
          <p className="text-xs text-muted">An advance is cash given now and recovered from a future salary — it's held as a receivable, not counted as an expense.</p>
          {error && <p className="text-danger text-sm">{error}</p>}
          <div className="flex justify-end"><button className="btn btn-primary" disabled={give.isPending}>{give.isPending ? "Saving…" : "Give advance"}</button></div>
        </form>

        <div>
          <p className="text-sm font-medium mb-1">Advances</p>
          {advances.length === 0 ? <p className="text-muted text-sm">None yet.</p> : (
            <div className="card divide-y divide-edge">
              {advances.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span><span className="mono text-xs text-muted">{a.refNo}</span> · {new Date(a.date).toLocaleDateString("en-GB")} {a.recoveredInId ? <Badge tone="success">recovered {a.recoveredIn?.month}</Badge> : <Badge tone="warn">open</Badge>}</span>
                  <span className="flex items-center gap-2"><span className="money">{fmtMoney(a.amount)}</span>{!a.recoveredInId && <button className="btn btn-secondary !p-1.5 hover:!text-danger" title="Reverse" onClick={() => reverse.mutate(a.id)}><Trash2 size={13} /></button>}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  );
}

function SalaryHistoryModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ["employee", employee.id], queryFn: () => api<{ employee: Employee }>(`/employees/${employee.id}`) });
  const salaries = data?.employee.salaries ?? [];
  return (
    <Modal open onClose={onClose} title={`Salary history — ${employee.name}`} wide>
      {salaries.length === 0 ? <EmptyState title="No salaries paid yet" /> : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs"><th className="px-3 py-2 font-semibold">Ref</th><th className="px-3 py-2 font-semibold">Month</th><th className="px-3 py-2 font-semibold text-right">Base</th><th className="px-3 py-2 font-semibold text-right">Bonus</th><th className="px-3 py-2 font-semibold text-right">Deduction</th><th className="px-3 py-2 font-semibold text-right">Advance</th><th className="px-3 py-2 font-semibold text-right">Net paid</th></tr></thead>
            <tbody>
              {salaries.map((s) => (
                <tr key={s.id} className="border-b border-edge last:border-0">
                  <td className="px-3 py-1.5 mono text-xs">{s.refNo}</td>
                  <td className="px-3 py-1.5">{s.month}</td>
                  <td className="px-3 py-1.5 text-right money">{fmtMoney(s.baseAmount)}</td>
                  <td className="px-3 py-1.5 text-right money">{fmtMoney(s.bonus)}</td>
                  <td className="px-3 py-1.5 text-right money">{fmtMoney(num(s.deduction) + num(s.absentDeduction))}</td>
                  <td className="px-3 py-1.5 text-right money">{fmtMoney(s.advanceRecovered)}</td>
                  <td className="px-3 py-1.5 text-right money font-semibold">{fmtMoney(s.netPaid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/* ───────────── Attendance tab ───────────── */

const STATUSES: { key: AttendanceStatus; short: string; label: string; tone: string }[] = [
  { key: "PRESENT", short: "P", label: "Present", tone: "!border-success !text-success" },
  { key: "ABSENT", short: "A", label: "Absent", tone: "!border-danger !text-danger" },
  { key: "HALF_DAY", short: "H", label: "Half", tone: "!border-accent !text-accent" },
  { key: "LEAVE", short: "L", label: "Leave", tone: "text-muted" },
];

function AttendanceTab({ can }: { can: (...k: string[]) => boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const manage = can("employees.manage");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const month = date.slice(0, 7);

  const { data: empData } = useQuery({ queryKey: ["employees", ""], queryFn: () => api<{ employees: Employee[] }>("/employees?status=active") });
  const employees = empData?.employees ?? [];
  const { data: recData } = useQuery({ queryKey: ["attendance", month], queryFn: () => api<{ records: Attendance[] }>(`/attendance?month=${month}`) });
  const { data: sumData } = useQuery({ queryKey: ["attendance-summary", month], queryFn: () => api<AttendanceSummary>(`/attendance/summary?month=${month}`) });

  // Map each employee's status for the selected day.
  const dayMark = new Map<string, AttendanceStatus>();
  for (const r of recData?.records ?? []) if (r.date.slice(0, 10) === date) dayMark.set(r.employeeId, r.status);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["attendance", month] }); qc.invalidateQueries({ queryKey: ["attendance-summary", month] }); };
  const mark = useMutation({
    mutationFn: (v: { employeeId: string; status: AttendanceStatus }) => api("/attendance", { method: "POST", body: { employeeId: v.employeeId, date, status: v.status } }),
    onSuccess: refresh,
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const markAll = useMutation({
    mutationFn: () => api("/attendance/bulk", { method: "POST", body: { date, entries: employees.map((e) => ({ employeeId: e.id, status: "PRESENT" })) } }),
    onSuccess: () => { toast("All marked present"); refresh(); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const importRef = useRef<HTMLInputElement>(null);
  const importCsv = useMutation({
    mutationFn: (csv: string) => api<{ imported: number; skipped: number; errors: string[] }>("/attendance/import", { method: "POST", body: { csv } }),
    onSuccess: (d) => { toast(`Imported ${d.imported} mark(s)${d.skipped ? `, ${d.skipped} skipped` : ""}`, d.skipped ? "error" : "success"); refresh(); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const sumRows = sumData?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="label">Date</label><input className="input !w-44" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="flex-1" />
        {manage && (
          <>
            <input ref={importRef} type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) importCsv.mutate(await f.text()); e.target.value = ""; }} />
            <button className="btn btn-secondary" title="Import a fingerprint-machine CSV (columns: code, date, status or in/out)" onClick={() => importRef.current?.click()} disabled={importCsv.isPending}><Upload size={15} /> {importCsv.isPending ? "Importing…" : "Import CSV"}</button>
          </>
        )}
        {manage && employees.length > 0 && <button className="btn btn-secondary" onClick={() => markAll.mutate()} disabled={markAll.isPending}><CheckCircle2 size={15} /> Mark all present</button>}
      </div>

      <div className="card overflow-hidden">
        {employees.length === 0 ? <EmptyState title="No staff yet" hint="Add employees on the Staff tab first." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs"><th className="px-4 py-2.5 font-semibold">Employee</th><th className="px-4 py-2.5 font-semibold text-right">Mark for {new Date(date).toLocaleDateString("en-GB")}</th></tr></thead>
            <tbody>
              {employees.map((e) => {
                const cur = dayMark.get(e.id);
                return (
                  <tr key={e.id} className="border-b border-edge last:border-0">
                    <td className="px-4 py-2">{e.name} <span className="text-muted text-xs">{e.code}</span></td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1 justify-end">
                        {STATUSES.map((s) => (
                          <button key={s.key} disabled={!manage || mark.isPending} title={s.label}
                            className={`btn btn-secondary !px-2.5 !py-1 !text-xs ${cur === s.key ? s.tone + " font-bold bg-surface-2" : "text-muted"}`}
                            onClick={() => mark.mutate({ employeeId: e.id, status: s.key })}>{s.short}</button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {sumRows.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-1">This month ({month}) — {sumData?.daysInMonth} days</p>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs"><th className="px-4 py-2 font-semibold">Employee</th><th className="px-4 py-2 font-semibold text-right">Present</th><th className="px-4 py-2 font-semibold text-right">Absent</th><th className="px-4 py-2 font-semibold text-right">Half</th><th className="px-4 py-2 font-semibold text-right">Leave</th></tr></thead>
              <tbody>
                {sumRows.map((r) => (
                  <tr key={r.employeeId} className="border-b border-edge last:border-0">
                    <td className="px-4 py-1.5">{r.name} <span className="text-muted text-xs">{r.code}</span></td>
                    <td className="px-4 py-1.5 text-right mono text-success">{r.present}</td>
                    <td className="px-4 py-1.5 text-right mono text-danger">{r.absent}</td>
                    <td className="px-4 py-1.5 text-right mono">{r.half}</td>
                    <td className="px-4 py-1.5 text-right mono text-muted">{r.leave}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────── Salaries tab ───────────── */

function SalariesTab({ can }: { can: (...k: string[]) => boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [month, setMonth] = useState("");
  const [deleting, setDeleting] = useState<SalaryPayment | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["salaries", month], queryFn: () => api<{ salaries: SalaryPayment[]; totalPaid: string }>(`/employees/salaries${month ? `?month=${month}` : ""}`) });
  const salaries = data?.salaries ?? [];
  const { page, pages, setPage, pageRows, total, perPage } = useClientPagination(salaries, 12);
  const del = useMutation({
    mutationFn: (id: string) => api(`/employees/salaries/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast("Salary reversed"); qc.invalidateQueries({ queryKey: ["salaries"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); setDeleting(null); },
    onError: (e: ApiError) => { toast(e.message, "error"); setDeleting(null); },
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="label">Month</label><input className="input mono !w-44" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
        {month && <button className="btn btn-secondary" onClick={() => setMonth("")}>Clear</button>}
        <div className="flex-1" />
        <div className="card px-4 py-2 flex items-center gap-3"><span className="text-muted text-sm">Total paid</span><span className="text-lg font-bold money">{fmtMoney(data?.totalPaid ?? 0)}</span></div>
      </div>
      <div className="card overflow-hidden">
        {isLoading ? <TableSkeleton cols={5} /> : salaries.length === 0 ? <EmptyState title="No salaries" hint="Pay a salary from the Staff tab." /> : (
          <>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs"><th className="px-4 py-2.5 font-semibold">Ref</th><th className="px-4 py-2.5 font-semibold">Employee</th><th className="px-4 py-2.5 font-semibold">Month</th><th className="px-4 py-2.5 font-semibold">Date</th><th className="px-4 py-2.5 font-semibold text-right">Net paid</th><th className="px-4 py-2.5 w-12" /></tr></thead>
            <tbody>
              {pageRows.map((s) => (
                <tr key={s.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                  <td className="px-4 py-2 mono text-xs font-semibold text-accent">{s.refNo}</td>
                  <td className="px-4 py-2">{s.employee?.name}</td>
                  <td className="px-4 py-2">{s.month}</td>
                  <td className="px-4 py-2 text-muted">{new Date(s.date).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-right money font-semibold">{fmtMoney(s.netPaid)}</td>
                  <td className="px-4 py-2 flex gap-1">
                    <button className="btn btn-secondary !p-1.5" title="Download payslip PDF" onClick={() => download(`/reports/payslip?salaryId=${s.id}&format=pdf`, `payslip-${s.refNo}.pdf`).catch((e) => toast((e as ApiError).message || "Download failed", "error"))}><FileDown size={13} /></button>
                    {can("salary.pay") && <button className="btn btn-secondary !p-1.5 hover:!text-danger" title="Reverse" onClick={() => setDeleting(s)}><Trash2 size={13} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pagination page={page} pages={pages} onPage={setPage} total={total} perPage={perPage} />
          </>
        )}
      </div>
      <ConfirmDialog open={deleting !== null} title={`Reverse ${deleting?.refNo ?? ""}?`} message="This removes the salary, its expense and the cash movement. Use it to fix a mistake." confirmLabel="Reverse" busy={del.isPending} onConfirm={() => deleting && del.mutate(deleting.id)} onClose={() => setDeleting(null)} />
    </div>
  );
}

/* ───────────── HR tab (G6) ───────────── */

function HRTab({ can }: { can: (...k: string[]) => boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const manage = can("employees.manage");
  const { data: deps } = useQuery({ queryKey: ["departments"], queryFn: () => api<{ departments: Department[] }>("/hr/departments") });
  const { data: shifts } = useQuery({ queryKey: ["shifts"], queryFn: () => api<{ shifts: Shift[] }>("/hr/shifts") });
  const { data: holidays } = useQuery({ queryKey: ["holidays"], queryFn: () => api<{ holidays: Holiday[] }>("/hr/holidays") });
  const { data: leaves } = useQuery({ queryKey: ["leaves"], queryFn: () => api<{ leaves: LeaveRequest[] }>("/hr/leaves") });
  const { data: emps } = useQuery({ queryKey: ["employees", ""], queryFn: () => api<{ employees: Employee[] }>("/employees?status=active") });

  const [depName, setDepName] = useState("");
  const [shift, setShift] = useState({ name: "", startTime: "09:00", endTime: "18:00" });
  const [holiday, setHoliday] = useState({ date: "", name: "" });
  const [leave, setLeave] = useState({ employeeId: "", fromDate: "", toDate: "", type: "UNPAID", reason: "" });

  const err = (e: ApiError) => toast(e.message, "error");
  const addDep = useMutation({ mutationFn: () => api("/hr/departments", { method: "POST", body: { name: depName } }), onSuccess: () => { setDepName(""); qc.invalidateQueries({ queryKey: ["departments"] }); }, onError: err });
  const delDep = useMutation({ mutationFn: (id: string) => api(`/hr/departments/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["departments"] }), onError: err });
  const addShift = useMutation({ mutationFn: () => api("/hr/shifts", { method: "POST", body: shift }), onSuccess: () => { setShift({ name: "", startTime: "09:00", endTime: "18:00" }); qc.invalidateQueries({ queryKey: ["shifts"] }); }, onError: err });
  const delShift = useMutation({ mutationFn: (id: string) => api(`/hr/shifts/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["shifts"] }), onError: err });
  const addHol = useMutation({ mutationFn: () => api("/hr/holidays", { method: "POST", body: holiday }), onSuccess: () => { setHoliday({ date: "", name: "" }); qc.invalidateQueries({ queryKey: ["holidays"] }); }, onError: err });
  const delHol = useMutation({ mutationFn: (id: string) => api(`/hr/holidays/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["holidays"] }), onError: err });
  const addLeave = useMutation({ mutationFn: () => api("/hr/leaves", { method: "POST", body: leave }), onSuccess: () => { setLeave({ employeeId: "", fromDate: "", toDate: "", type: "UNPAID", reason: "" }); qc.invalidateQueries({ queryKey: ["leaves"] }); }, onError: err });
  const setLeaveStatus = useMutation({ mutationFn: (v: { id: string; status: string }) => api(`/hr/leaves/${v.id}`, { method: "PATCH", body: { status: v.status } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["leaves"] }), onError: err });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Departments */}
      <div className="card p-4">
        <h3 className="font-semibold display mb-2 flex items-center gap-1.5"><Building2 size={16} /> Departments</h3>
        {manage && <form onSubmit={(e) => { e.preventDefault(); if (depName.trim()) addDep.mutate(); }} className="flex gap-2 mb-2"><input className="input" value={depName} onChange={(e) => setDepName(e.target.value)} placeholder="Sales / Warehouse" /><button className="btn btn-secondary"><Plus size={15} /></button></form>}
        <div className="divide-y divide-edge">{(deps?.departments ?? []).map((d) => <div key={d.id} className="flex justify-between items-center py-1.5 text-sm"><span>{d.name} <span className="text-muted text-xs">({d._count?.employees ?? 0})</span></span>{manage && <button className="btn btn-secondary !p-1 hover:!text-danger" onClick={() => delDep.mutate(d.id)}><Trash2 size={12} /></button>}</div>)}{!deps?.departments.length && <p className="text-muted text-sm py-2">None yet.</p>}</div>
      </div>

      {/* Shifts */}
      <div className="card p-4">
        <h3 className="font-semibold display mb-2 flex items-center gap-1.5"><Clock size={16} /> Shifts</h3>
        {manage && <form onSubmit={(e) => { e.preventDefault(); if (shift.name.trim()) addShift.mutate(); }} className="flex flex-wrap gap-2 mb-2"><input className="input flex-1 !min-w-24" value={shift.name} onChange={(e) => setShift({ ...shift, name: e.target.value })} placeholder="Morning" /><input className="input mono !w-24" type="time" value={shift.startTime} onChange={(e) => setShift({ ...shift, startTime: e.target.value })} /><input className="input mono !w-24" type="time" value={shift.endTime} onChange={(e) => setShift({ ...shift, endTime: e.target.value })} /><button className="btn btn-secondary"><Plus size={15} /></button></form>}
        <div className="divide-y divide-edge">{(shifts?.shifts ?? []).map((s) => <div key={s.id} className="flex justify-between items-center py-1.5 text-sm"><span>{s.name} <span className="text-muted mono text-xs">{s.startTime}–{s.endTime}</span></span>{manage && <button className="btn btn-secondary !p-1 hover:!text-danger" onClick={() => delShift.mutate(s.id)}><Trash2 size={12} /></button>}</div>)}{!shifts?.shifts.length && <p className="text-muted text-sm py-2">None yet.</p>}</div>
      </div>

      {/* Holidays */}
      <div className="card p-4">
        <h3 className="font-semibold display mb-2 flex items-center gap-1.5"><CalendarDays size={16} /> Holidays</h3>
        {manage && <form onSubmit={(e) => { e.preventDefault(); if (holiday.date && holiday.name.trim()) addHol.mutate(); }} className="flex flex-wrap gap-2 mb-2"><input className="input !w-40" type="date" value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} /><input className="input flex-1 !min-w-24" value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} placeholder="Eid" /><button className="btn btn-secondary"><Plus size={15} /></button></form>}
        <div className="divide-y divide-edge">{(holidays?.holidays ?? []).map((h) => <div key={h.id} className="flex justify-between items-center py-1.5 text-sm"><span>{new Date(h.date).toLocaleDateString()} · {h.name}</span>{manage && <button className="btn btn-secondary !p-1 hover:!text-danger" onClick={() => delHol.mutate(h.id)}><Trash2 size={12} /></button>}</div>)}{!holidays?.holidays.length && <p className="text-muted text-sm py-2">None yet.</p>}</div>
      </div>

      {/* Leaves */}
      <div className="card p-4">
        <h3 className="font-semibold display mb-2 flex items-center gap-1.5"><CalendarDays size={16} /> Leave requests</h3>
        {manage && (
          <form onSubmit={(e) => { e.preventDefault(); if (leave.employeeId && leave.fromDate && leave.toDate) addLeave.mutate(); }} className="grid grid-cols-2 gap-2 mb-2">
            <select className="input col-span-2" value={leave.employeeId} onChange={(e) => setLeave({ ...leave, employeeId: e.target.value })}><option value="">Pick employee…</option>{(emps?.employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            <input className="input" type="date" value={leave.fromDate} onChange={(e) => setLeave({ ...leave, fromDate: e.target.value })} />
            <input className="input" type="date" value={leave.toDate} onChange={(e) => setLeave({ ...leave, toDate: e.target.value })} />
            <select className="input" value={leave.type} onChange={(e) => setLeave({ ...leave, type: e.target.value })}><option value="UNPAID">Unpaid</option><option value="PAID">Paid</option><option value="SICK">Sick</option></select>
            <button className="btn btn-secondary"><Plus size={15} /> Request</button>
          </form>
        )}
        <div className="divide-y divide-edge max-h-56 overflow-y-auto">
          {(leaves?.leaves ?? []).map((l) => (
            <div key={l.id} className="flex justify-between items-center py-1.5 text-sm gap-2">
              <span className="min-w-0"><span className="font-medium">{l.employee?.name}</span> <span className="text-muted text-xs">{new Date(l.fromDate).toLocaleDateString()}→{new Date(l.toDate).toLocaleDateString()} · {l.days}d · {l.type}</span></span>
              <span className="flex items-center gap-1 shrink-0">
                {l.status === "PENDING" ? <Badge tone="warn">Pending</Badge> : l.status === "APPROVED" ? <Badge tone="success">Approved</Badge> : <Badge tone="danger">Rejected</Badge>}
                {manage && l.status === "PENDING" && <><button className="btn btn-secondary !p-1 hover:!text-success" title="Approve" onClick={() => setLeaveStatus.mutate({ id: l.id, status: "APPROVED" })}><CheckCircle2 size={13} /></button><button className="btn btn-secondary !p-1 hover:!text-danger" title="Reject" onClick={() => setLeaveStatus.mutate({ id: l.id, status: "REJECTED" })}><XCircle size={13} /></button></>}
              </span>
            </div>
          ))}
          {!leaves?.leaves.length && <p className="text-muted text-sm py-2">No leave requests.</p>}
        </div>
      </div>
    </div>
  );
}
