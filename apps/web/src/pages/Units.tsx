import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Ruler } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Unit } from "../lib/types";
import { num, fmtQty } from "../lib/format";
import {
  PageHeader,
  Modal,
  ConfirmDialog,
  EmptyState,
  TableSkeleton,
  FormSection,
  Pagination,
  useClientPagination,
  useToast,
} from "../components/ui";

type FormState = { name: string; shortName: string; baseUnitId: string; factor: string };
const emptyForm: FormState = { name: "", shortName: "", baseUnitId: "", factor: "1" };

export default function Units() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Unit | "new" | null>(null);
  const [deleting, setDeleting] = useState<Unit | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["units"],
    queryFn: () => api<{ units: Unit[] }>("/units"),
  });
  const units = data?.units ?? [];
  const baseCandidates = units.filter((u) => !u.baseUnitId);

  const { page, pages, setPage, pageRows, total, perPage } = useClientPagination(units, 12);

  const save = useMutation({
    mutationFn: (payload: { id?: string; body: Record<string, unknown> }) =>
      payload.id
        ? api(`/units/${payload.id}`, { method: "PATCH", body: payload.body })
        : api("/units", { method: "POST", body: payload.body }),
    onSuccess: (_d, payload) => {
      qc.invalidateQueries({ queryKey: ["units"] });
      toast(payload.id ? `Unit ${form.name} updated` : `Unit ${form.name} added`);
      setEditing(null);
    },
    onError: (e: ApiError) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<{ message: string }>(`/units/${id}`, { method: "DELETE" }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["units"] });
      toast(d.message);
      setDeleting(null);
    },
    onError: (e: ApiError) => {
      toast(e.message, "error");
      setDeleting(null);
    },
  });

  function openNew() {
    setForm(emptyForm);
    setError(null);
    setEditing("new");
  }
  function openEdit(unit: Unit) {
    setForm({
      name: unit.name,
      shortName: unit.shortName,
      baseUnitId: unit.baseUnitId ?? "",
      factor: String(num(unit.factor)),
    });
    setError(null);
    setEditing(unit);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate({
      id: editing === "new" ? undefined : editing?.id,
      body: {
        name: form.name,
        shortName: form.shortName,
        baseUnitId: form.baseUnitId || null,
        factor: Number(form.factor) || 1,
      },
    });
  }

  return (
    <div>
      <PageHeader
        title="Units"
        sub="How you sell things — bags, kg, tons, feet. Conversions keep rod weights honest."
        actions={
          <button className="btn btn-secondary" onClick={openNew}>
            <Plus size={16} /> Add unit
          </button>
        }
      />

      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={5} />
        ) : units.length === 0 ? (
          <EmptyState
            title="No units yet"
            hint="Add the units you sell in — piece, bag, kg…"
            action={
              <button className="btn btn-secondary" onClick={openNew}>
                <Plus size={16} /> Add unit
              </button>
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs">
                    <th className="px-4 py-2.5 font-semibold">Unit</th>
                    <th className="px-4 py-2.5 font-semibold">Short</th>
                    <th className="px-4 py-2.5 font-semibold">Conversion</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Products</th>
                    <th className="px-4 py-2.5 w-24" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((u) => (
                <tr key={u.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-medium">
                    <span className="inline-flex items-center gap-2">
                      <Ruler size={14} className="text-muted" /> {u.name}
                    </span>
                  </td>
                  <td className="px-4 py-2 mono text-muted">{u.shortName}</td>
                  <td className="px-4 py-2 text-muted">
                    {u.baseUnit ? (
                      <span>
                        1 {u.shortName} = <span className="mono">{fmtQty(u.factor)}</span> {u.baseUnit.shortName}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-right mono">{u._count?.products ?? 0}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <button className="btn btn-secondary !p-1.5" onClick={() => openEdit(u)} title={`Edit ${u.name}`}>
                        <Pencil size={14} />
                      </button>
                      <button
                        className="btn btn-secondary !p-1.5 hover:!text-danger"
                        onClick={() => setDeleting(u)}
                        title={`Delete ${u.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
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

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add unit" : `Edit ${editing?.name ?? ""}`}
      >
        <form onSubmit={submit} className="space-y-4">
          <FormSection title="Unit details" icon={Ruler} color="var(--accent)">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Name</label>
                  <input
                    className="input"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Kilogram"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="label">Short name</label>
                  <input
                    className="input"
                    value={form.shortName}
                    onChange={(e) => setForm({ ...form, shortName: e.target.value })}
                    placeholder="kg"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Converts to (optional)</label>
                  <select
                    className="input"
                    value={form.baseUnitId}
                    onChange={(e) => setForm({ ...form, baseUnitId: e.target.value })}
                  >
                    <option value="">— no conversion —</option>
                    {baseCandidates
                      .filter((u) => editing === "new" || u.id !== (editing as Unit)?.id)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.shortName})
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="label">Factor</label>
                  <input
                    className="input mono"
                    type="number"
                    step="any"
                    min="0.000001"
                    value={form.factor}
                    onChange={(e) => setForm({ ...form, factor: e.target.value })}
                    disabled={!form.baseUnitId}
                  />
                </div>
              </div>
              {form.baseUnitId && (
                <p className="text-xs text-muted">
                  Example: Ton converts to Kilogram with factor 1000 → 1 t = 1000 kg.
                </p>
              )}
            </div>
          </FormSection>
          {error && <p className="text-danger text-sm">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save unit"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ""}?`}
        message={`This removes the unit "${deleting?.name}". Units used by products cannot be deleted.`}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
