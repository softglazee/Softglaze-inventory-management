import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, PackageX, Users, Truck, Info, CheckCheck } from "lucide-react";
import { api } from "../lib/api";
import { AppNotification } from "../lib/types";

const ICON: Record<string, typeof Bell> = { LOW_STOCK: PackageX, DEBT_REMINDER: Users, PAYABLE_REMINDER: Truck, CREDIT_LIMIT: Info, PROMISE_DUE: Users, SYSTEM: Info };

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationBell() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: countData } = useQuery({ queryKey: ["notif-count"], queryFn: () => api<{ count: number }>("/notifications/unread-count"), refetchInterval: 60000 });
  const { data } = useQuery({ queryKey: ["notifs"], queryFn: () => api<{ notifications: AppNotification[] }>("/notifications"), enabled: open });
  const count = countData?.count ?? 0;
  const list = data?.notifications ?? [];

  const readAll = useMutation({ mutationFn: () => api("/notifications/read-all", { method: "POST" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["notif-count"] }); qc.invalidateQueries({ queryKey: ["notifs"] }); } });
  const readOne = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: "POST" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["notif-count"] }); qc.invalidateQueries({ queryKey: ["notifs"] }); } });

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(n: AppNotification) {
    if (!n.isRead) readOne.mutate(n.id);
    setOpen(false);
    if (n.entity === "Product") nav("/stock");
    else if (n.entity === "Customer") nav("/customers");
    else if (n.entity === "Vendor") nav("/vendors");
    else nav("/notifications");
  }

  return (
    <div className="relative" ref={ref}>
      <button className="btn btn-ghost !p-2 relative" onClick={() => setOpen((o) => !o)} title="Notifications" aria-label="Notifications">
        <Bell size={17} />
        {count > 0 && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-accent text-accent-ink text-[10px] font-bold flex items-center justify-center">{count > 9 ? "9+" : count}</span>}
      </button>

      {open && (
        <div className="absolute top-full mt-2 right-0 w-80 max-w-[calc(100vw-2rem)] card shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 h-11 border-b border-edge">
            <span className="font-semibold text-sm">Notifications</span>
            {count > 0 && <button className="text-xs text-muted hover:text-ink flex items-center gap-1" onClick={() => readAll.mutate()}><CheckCheck size={13} /> Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {list.length === 0 ? (
              <p className="text-muted text-sm text-center py-8">You're all caught up 🎉</p>
            ) : (
              list.map((n) => {
                const Icon = ICON[n.type] ?? Info;
                return (
                  <button key={n.id} onClick={() => go(n)} className={`w-full text-left flex gap-2.5 px-3 py-2.5 border-b border-edge last:border-0 hover:bg-surface-2 ${n.isRead ? "opacity-60" : ""}`}>
                    <Icon size={16} className={`shrink-0 mt-0.5 ${n.isRead ? "text-muted" : "text-accent"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{n.title}</p>
                      <p className="text-xs text-muted line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-muted mt-0.5">{timeAgo(n.createdAt)}</p>
                    </div>
                    {!n.isRead && <span className="w-2 h-2 rounded-full bg-accent shrink-0 mt-1.5" />}
                  </button>
                );
              })
            )}
          </div>
          <button className="w-full text-center text-xs text-muted hover:text-ink py-2 border-t border-edge" onClick={() => { setOpen(false); nav("/notifications"); }}>See all</button>
        </div>
      )}
    </div>
  );
}
