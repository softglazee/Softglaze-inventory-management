import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Tag } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Brand } from "../lib/types";
import { PageHeader, Modal, ConfirmDialog, EmptyState, TableSkeleton, SearchBox, Badge, FormSection, Pagination, useClientPagination, useToast } from "../components/ui";
import ImageDropzone from "../components/ImageDropzone";

export default function Brands() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Brand | "new" | null>(null);
  const [deleting, setDeleting] = useState<Brand | null>(null);
  const [name, setName] = useState("");
  const [logo, setLogo] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["brands", search],
    queryFn: () => api<{ brands: Brand[] }>(`/brands${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`),
  });
  const brands = data?.brands ?? [];

  const { page, pages, setPage, pageRows, total, perPage } = useClientPagination(brands, 12);

  const save = useMutation({
    mutationFn: async (payload: { id?: string; body: { name: string } }) => {
      const result = payload.id
        ? await api<{ brand: Brand }>(`/brands/${payload.id}`, { method: "PATCH", body: payload.body })
        : await api<{ brand: Brand }>("/brands", { method: "POST", body: payload.body });
      if (logo.length > 0) {
        const fd = new FormData();
        fd.append("image", logo[0]);
        await api(`/brands/${result.brand.id}/image`, { method: "POST", body: fd, isForm: true });
      }
      return result;
    },
    onSuccess: (d, payload) => {
      qc.invalidateQueries({ queryKey: ["brands"] });
      qc.invalidateQueries({ queryKey: ["brands-all"] });
      toast(payload.id ? `${d.brand.name} updated` : `${d.brand.name} added`);
      setEditing(null);
    },
    onError: (e: ApiError) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<{ message: string }>(`/brands/${id}`, { method: "DELETE" }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["brands"] });
      toast(d.message);
      setDeleting(null);
    },
    onError: (e: ApiError) => {
      toast(e.message, "error");
      setDeleting(null);
    },
  });

  function openNew() {
    setName("");
    setLogo([]);
    setError(null);
    setEditing("new");
  }
  function openEdit(b: Brand) {
    setName(b.name);
    setLogo([]);
    setError(null);
    setEditing(b);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate({ id: editing === "new" ? undefined : (editing as Brand).id, body: { name: name.trim() } });
  }

  const editingBrand = editing !== "new" ? (editing as Brand | null) : null;

  return (
    <div>
      <PageHeader
        title="Brands"
        sub="Makers and companies — Lucky, Ittehad, Master. Optional, useful for filtering."
        actions={
          <button className="btn btn-secondary" onClick={openNew}>
            <Plus size={16} /> Add brand
          </button>
        }
      />

      <div className="mb-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Search brands…" />
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={3} />
        ) : brands.length === 0 ? (
          <EmptyState
            title={search ? "No brands match" : "No brands yet"}
            hint={search ? "Try a different search." : "Add a brand like Lucky or Master — then tag products with it."}
            action={!search && (
              <button className="btn btn-secondary" onClick={openNew}>
                <Plus size={16} /> Add brand
              </button>
            )}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs">
                    <th className="px-4 py-2.5 font-semibold">Brand</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Products</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 w-24" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((b) => (
                <tr key={b.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-medium">
                    <span className="inline-flex items-center gap-2.5">
                      {b.image ? (
                        <img src={b.image} alt="" className="w-8 h-8 rounded object-cover border border-edge" />
                      ) : (
                        <span className="w-8 h-8 rounded bg-surface-2 border border-edge flex items-center justify-center">
                          <Tag size={14} className="text-muted" />
                        </span>
                      )}
                      {b.name}
                      {!b.isActive && <span className="text-muted text-xs ml-1">(inactive)</span>}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right mono text-muted">{b._count?.products ?? 0}</td>
                  <td className="px-4 py-2">{b.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive</Badge>}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <button className="btn btn-secondary !p-1.5" onClick={() => openEdit(b)} title={`Edit ${b.name}`}>
                        <Pencil size={14} />
                      </button>
                      <button className="btn btn-secondary !p-1.5 hover:!text-danger" onClick={() => setDeleting(b)} title={`Delete ${b.name}`}>
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

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add brand" : `Edit ${editingBrand?.name ?? ""}`}>
        <form onSubmit={submit} className="space-y-4">
          <FormSection title="Brand details" icon={Tag} color="var(--accent)">
            <div className="space-y-3">
              <div>
                <label className="label">Brand name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lucky" required autoFocus />
              </div>
              <div>
                <label className="label">Logo (optional)</label>
                <ImageDropzone
                  saved={editingBrand?.image ? [{ id: "logo", url: editingBrand.image, isPrimary: true }] : []}
                  files={logo}
                  onFilesChange={setLogo}
                  max={1}
                  multiple={false}
                  hint="Drag, click or paste one logo image."
                />
              </div>
            </div>
          </FormSection>
          {error && <p className="text-danger text-sm">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save brand"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ""}?`}
        message={`"${deleting?.name}" will be removed. If products use this brand it will be deactivated instead.`}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
