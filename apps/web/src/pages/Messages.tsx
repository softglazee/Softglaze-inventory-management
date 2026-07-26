import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Mail } from "lucide-react";
import { api } from "../lib/api";
import { MessageLogEntry } from "../lib/types";
import { PageHeader, EmptyState, TableSkeleton, Badge, Pagination, useClientPagination } from "../components/ui";

const statusTone: Record<string, "success" | "warn" | "danger" | "muted"> = { SENT: "success", CLICKED: "success", FAILED: "danger", QUEUED: "warn" };

export default function Messages() {
  const [channel, setChannel] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["messages", channel],
    queryFn: () => api<{ messages: MessageLogEntry[] }>(`/messages${channel ? `?channel=${channel}` : ""}`),
  });
  const list = data?.messages ?? [];
  const { page, pages, setPage, pageRows, total, perPage } = useClientPagination(list, 12);

  return (
    <div>
      <PageHeader title="Messages" sub="Every WhatsApp and email your shop has sent — receipts, reminders and statements." actions={
        <select className="input !w-40" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">All channels</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="EMAIL">Email</option>
        </select>
      } />
      <div className="card overflow-hidden">
        {isLoading ? <TableSkeleton cols={4} /> : list.length === 0 ? (
          <EmptyState title="No messages yet" hint="Sending a WhatsApp receipt or a debt reminder will show it here." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs">
                    <th className="px-4 py-2.5 font-semibold">When</th>
                    <th className="px-4 py-2.5 font-semibold">Channel</th>
                    <th className="px-4 py-2.5 font-semibold">To</th>
                    <th className="px-4 py-2.5 font-semibold">Type</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((m) => (
                    <tr key={m.id} className="border-b border-edge last:border-0 hover:bg-surface-2/50">
                      <td className="px-4 py-2 whitespace-nowrap">{new Date(m.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          {m.channel === "WHATSAPP" ? <MessageCircle size={14} className="text-success" /> : <Mail size={14} className="text-info" />}
                          {m.channel === "WHATSAPP" ? "WhatsApp" : "Email"}
                        </span>
                      </td>
                      <td className="px-4 py-2 mono">{m.recipient}</td>
                      <td className="px-4 py-2">{m.template.replace(/_/g, " ")}</td>
                      <td className="px-4 py-2"><Badge tone={statusTone[m.status] ?? "muted"}>{m.status.toLowerCase()}</Badge>{m.error && <span className="text-danger text-xs ml-2">{m.error}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pages={pages} onPage={setPage} total={total} perPage={perPage} />
          </>
        )}
      </div>
    </div>
  );
}
