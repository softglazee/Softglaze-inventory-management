import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, KeyRound, Ban, ShieldCheck, UserCog } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { ManagedUser } from "../lib/types";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Modal, ConfirmDialog, EmptyState, TableSkeleton, Badge, Pagination, useClientPagination, useToast } from "../components/ui";

const ROLES = ["ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"];

export default function Users() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user: me } = useAuth();
  const [editing, setEditing] = useState<ManagedUser | "new" | null>(null);
  const [pwFor, setPwFor] = useState<ManagedUser | null>(null);
  const [disabling, setDisabling] = useState<ManagedUser | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["users"], queryFn: () => api<{ users: ManagedUser[] }>("/users") });
  const users = data?.users ?? [];
  const { page, pages, setPage, pageRows, total, perPage } = useClientPagination(users, 12);

  const disable = useMutation({
    mutationFn: (id: string) => api<{ message: string }>(`/users/${id}`, { method: "DELETE" }),
    onSuccess: (d) => { toast(d.message); qc.invalidateQueries({ queryKey: ["users"] }); setDisabling(null); },
    onError: (e: ApiError) => { toast(e.message, "error"); setDisabling(null); },
  });
  const reactivate = useMutation({
    mutationFn: (u: ManagedUser) => api(`/users/${u.id}`, { method: "PATCH", body: { isActive: true } }),
    onSuccess: () => { toast("User re-enabled"); qc.invalidateQueries({ queryKey: ["users"] }); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  return (
    <div>
      <PageHeader title="Users & Roles" sub="Staff accounts and what each role can do. Public sign-up is closed — create staff here." actions={<button className="btn btn-secondary !border-accent !text-accent" onClick={() => setEditing("new")}><Plus size={16} /> Add user</button>} />

      <div className="card overflow-hidden">
        {isLoading ? <TableSkeleton cols={5} /> : users.length === 0 ? <EmptyState title="No users" /> : (
          <>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs"><th className="px-4 py-2.5 font-semibold">Name</th><th className="px-4 py-2.5 font-semibold">Email</th><th className="px-4 py-2.5 font-semibold">Role</th><th className="px-4 py-2.5 font-semibold">Status</th><th className="px-4 py-2.5 w-32" /></tr></thead>
            <tbody>
              {pageRows.map((u) => {
                const isSuper = u.role === "SUPER_ADMIN";
                const isMe = u.id === me?.id;
                return (
                  <tr key={u.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                    <td className="px-4 py-2 font-medium"><span className="inline-flex items-center gap-2">{isSuper ? <ShieldCheck size={14} className="text-accent" /> : <UserCog size={14} className="text-muted" />}{u.name}{isMe && <span className="text-xs text-muted">(you)</span>}</span></td>
                    <td className="px-4 py-2 text-muted">{u.email}</td>
                    <td className="px-4 py-2"><Badge tone={isSuper ? "warn" : "muted"}>{u.role}</Badge></td>
                    <td className="px-4 py-2">{u.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Disabled</Badge>}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        {!isSuper && <button className="btn btn-secondary !p-1.5" title="Edit" onClick={() => setEditing(u)}><Pencil size={14} /></button>}
                        <button className="btn btn-secondary !p-1.5" title="Reset password" onClick={() => setPwFor(u)}><KeyRound size={14} /></button>
                        {!isSuper && !isMe && (u.isActive
                          ? <button className="btn btn-secondary !p-1.5 hover:!text-danger" title="Disable" onClick={() => setDisabling(u)}><Ban size={14} /></button>
                          : <button className="btn btn-secondary !p-1.5 hover:!text-success" title="Re-enable" onClick={() => reactivate.mutate(u)}><ShieldCheck size={14} /></button>)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <Pagination page={page} pages={pages} onPage={setPage} total={total} perPage={perPage} />
          </>
        )}
      </div>

      {editing !== null && <UserForm user={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ["users"] }); setEditing(null); }} />}
      {pwFor && <ResetPasswordModal user={pwFor} onClose={() => setPwFor(null)} onDone={(m) => { toast(m); setPwFor(null); }} />}
      <ConfirmDialog open={disabling !== null} title={`Disable ${disabling?.name ?? ""}?`} message="They won't be able to log in. Their history stays on record and you can re-enable them anytime." confirmLabel="Disable" busy={disable.isPending} onConfirm={() => disabling && disable.mutate(disabling.id)} onClose={() => setDisabling(null)} />
    </div>
  );
}

function UserForm({ user, onClose, onSaved }: { user: ManagedUser | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: user?.name ?? "", email: user?.email ?? "", phone: user?.phone ?? "", role: user?.role && user.role !== "SUPER_ADMIN" ? user.role : "CASHIER", password: "", commissionPercent: String(user?.commissionPercent ?? "0") });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => user
      ? api(`/users/${user.id}`, { method: "PATCH", body: { name: form.name, phone: form.phone || null, role: form.role, commissionPercent: Number(form.commissionPercent) || 0 } })
      : api("/users", { method: "POST", body: { name: form.name, email: form.email, phone: form.phone || null, role: form.role, password: form.password, commissionPercent: Number(form.commissionPercent) || 0 } }),
    onSuccess: onSaved,
    onError: (e: ApiError) => setError(e.message),
  });
  return (
    <Modal open onClose={onClose} title={user ? `Edit ${user.name}` : "Add user"}>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus /></div>
          <div><label className="label">Role</label><select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
        </div>
        <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!!user} required /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Phone (optional)</label><input className="input mono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><label className="label">Commission %</label><input className="input mono" type="number" step="0.01" min="0" max="100" value={form.commissionPercent} onChange={(e) => setForm({ ...form, commissionPercent: e.target.value })} /></div>
        </div>
        {!user && <div><label className="label">Temporary password</label><input className="input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" required /></div>}
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-secondary !border-accent !text-accent" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</button></div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: ManagedUser; onClose: () => void; onDone: (m: string) => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api<{ message: string }>(`/users/${user.id}/reset-password`, { method: "POST", body: { password: pw } }),
    onSuccess: (d) => onDone(d.message),
    onError: (e: ApiError) => setError(e.message),
  });
  return (
    <Modal open onClose={onClose} title={`Reset password — ${user.name}`}>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} className="space-y-4">
        <p className="text-sm text-muted">Set a new password and share it with {user.name.split(" ")[0]}. They'll be logged out of other sessions.</p>
        <div><label className="label">New password</label><input className="input" type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" required autoFocus /></div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-secondary !border-accent !text-accent" disabled={save.isPending}>{save.isPending ? "Saving…" : "Reset password"}</button></div>
      </form>
    </Modal>
  );
}
