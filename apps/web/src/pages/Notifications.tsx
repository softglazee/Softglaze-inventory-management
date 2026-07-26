import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageX, Users, Truck, Info, CheckCheck, RefreshCw } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { AppNotification } from "../lib/types";
import { PageHeader, EmptyState, TableSkeleton, useToast } from "../components/ui";

const ICON: Record<string, typeof Info> = { LOW_STOCK: PackageX, DEBT_REMINDER: Users, PAYABLE_REMINDER: Truck, CREDIT_LIMIT: Info, PROMISE_DUE: Users, SYSTEM: Info };

export default function Notifications() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { toast } = useToast();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["notifs-page", unreadOnly], queryFn: () => api<{ notifications: AppNotification[] }>(`/notifications${unreadOnly ? "?unread=1" : ""}`) });
  const list = data?.notifications ?? [];

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["notifs-page"] }); qc.invalidateQueries({ queryKey: ["notif-count"] }); qc.invalidateQueries({ queryKey: ["notifs"] }); };
  const readAll = useMutation({ mutationFn: () => api("/notifications/read-all", { method: "POST" }), onSuccess: invalidate });
  const readOne = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: "POST" }), onSuccess: invalidate });
  const sweep = useMutation({ mutationFn: () => api<{ lowStock: number; debt: number; payable: number }>("/notifications/sweep", { method: "POST" }), onSuccess: (d) => { toast(`Checked: ${d.lowStock} low stock, ${d.debt} debt, ${d.payable} payable`); invalidate(); }, onError: (e: ApiError) => toast(e.message, "error") });

  function go(n: AppNotification) {
    if (!n.isRead) readOne.mutate(n.id);
    if (n.entity === "Product") nav("/stock");
    else if (n.entity === "Customer") nav("/customers");
    else if (n.entity === "Vendor") nav("/vendors");
  }

  return (
    <div>
      <PageHeader title="Notifications" sub="Low stock, udhaar reminders and payment alerts." actions={
        <>
          <button className="btn btn-secondary" onClick={() => sweep.mutate()} disabled={sweep.isPending}><RefreshCw size={15} /> {sweep.isPending ? "Checking…" : "Check now"}</button>
          <button className="btn btn-secondary" onClick={() => readAll.mutate()}><CheckCheck size={15} /> Mark all read</button>
        </>
      } />
      <label className="flex items-center gap-2 text-sm mb-3"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only</label>
      <div className="card overflow-hidden">
        {isLoading ? <TableSkeleton cols={2} /> : list.length === 0 ? <EmptyState title="Nothing here" hint="You're all caught up." /> : (
          <div className="divide-y divide-edge">
            {list.map((n) => {
              const Icon = ICON[n.type] ?? Info;
              return (
                <button key={n.id} onClick={() => go(n)} className={`w-full text-left flex gap-3 px-4 py-3 hover:bg-surface-2/50 ${n.isRead ? "opacity-60" : ""}`}>
                  <Icon size={18} className={`shrink-0 mt-0.5 ${n.isRead ? "text-muted" : "text-accent"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{n.title}</p>
                    <p className="text-sm text-muted">{n.message}</p>
                    <p className="text-[11px] text-muted mt-0.5">{new Date(n.createdAt).toLocaleString()}</p>
                  </div>
                  {!n.isRead && <span className="w-2 h-2 rounded-full bg-accent shrink-0 mt-2" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
