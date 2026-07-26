import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Mail, Send, BellRing, MessageSquare, ExternalLink } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { ReminderPlan } from "../lib/types";
import { fmtMoney } from "../lib/format";
import { PageHeader, EmptyState, TableSkeleton, Badge, Pagination, useClientPagination, useToast } from "../components/ui";

type Tab = "statements" | "campaign" | "reminders";

export default function Outreach() {
  const [tab, setTab] = useState<Tab>("statements");
  return (
    <div>
      <PageHeader title="Customer Outreach" sub="Email monthly statements, send festival greetings to all your customers, and run the automatic udhaar reminder ladder. Nothing here touches your accounts — it only sends messages." />
      <div className="flex gap-1 mb-4 border-b border-edge">
        {([["statements", "Statements", Mail], ["campaign", "Bulk Message", MessageSquare], ["reminders", "Udhaar Reminders", BellRing]] as [Tab, string, typeof Mail][]).map(([k, label, Icon]) => (
          <button key={k} className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${tab === k ? "border-accent text-ink font-semibold" : "border-transparent text-muted hover:text-ink"}`} onClick={() => setTab(k)}><Icon size={15} /> {label}</button>
        ))}
      </div>
      {tab === "statements" && <Statements />}
      {tab === "campaign" && <Campaign />}
      {tab === "reminders" && <Reminders />}
    </div>
  );
}

function Statements() {
  const { toast } = useToast();
  const [result, setResult] = useState<{ attempted: number; sent: number; results: { name: string; ok: boolean; detail: string }[] } | null>(null);
  const run = useMutation({
    mutationFn: () => api<{ attempted: number; sent: number; results: { name: string; ok: boolean; detail: string }[] }>("/outreach/statements/email", { method: "POST", body: {} }),
    onSuccess: (d) => { setResult(d); toast(`${d.sent} of ${d.attempted} statements emailed`); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  return (
    <div className="card p-4 space-y-3">
      <p className="text-sm text-muted">Emails an up-to-date statement of account (PDF) to every active customer who has an email address and an outstanding balance. This also runs automatically once a month.</p>
      <button className="btn btn-primary" disabled={run.isPending} onClick={() => run.mutate()}><Mail size={16} /> {run.isPending ? "Sending…" : "Email statements now"}</button>
      {result && (
        <div className="text-sm">
          <p className="mb-1"><strong>{result.sent}</strong> sent of {result.attempted} attempted.</p>
          <div className="max-h-52 overflow-y-auto divide-y divide-edge">
            {result.results.map((r, i) => <div key={i} className="flex items-center justify-between py-1"><span>{r.name}</span><span className={r.ok ? "text-success text-xs" : "text-danger text-xs"}>{r.ok ? r.detail : r.detail}</span></div>)}
          </div>
        </div>
      )}
    </div>
  );
}

function Campaign() {
  const { toast } = useToast();
  const [channel, setChannel] = useState<"WHATSAPP" | "SMS" | "EMAIL">("WHATSAPP");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("Dear {name}, warm greetings from {shop}! Thank you for your continued trust.");
  const [links, setLinks] = useState<{ name: string; url: string }[]>([]);
  const send = useMutation({
    mutationFn: () => api<{ total: number; sent: number; failed: number; skipped: number; links: { name: string; url: string }[] }>("/outreach/campaign", { method: "POST", body: { channel, message, subject: subject || undefined } }),
    onSuccess: (d) => { setLinks(d.links); toast(`${d.sent} queued/sent · ${d.skipped} skipped · ${d.failed} failed`); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  return (
    <div className="card p-4 space-y-3">
      <p className="text-sm text-muted">Send the same message to all your active customers — great for Eid / festival greetings. Use <code className="mono">{"{name}"}</code> and <code className="mono">{"{shop}"}</code> as placeholders.</p>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Channel</label><select className="input" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}><option value="WHATSAPP">WhatsApp (open links)</option><option value="SMS">SMS (gateway)</option><option value="EMAIL">Email</option></select></div>
        {channel === "EMAIL" && <div><label className="label">Subject</label><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Eid Mubarak!" /></div>}
      </div>
      <div><label className="label">Message</label><textarea className="input min-h-[90px]" value={message} onChange={(e) => setMessage(e.target.value)} /></div>
      <button className="btn btn-primary" disabled={send.isPending} onClick={() => { setLinks([]); send.mutate(); }}><Send size={16} /> {send.isPending ? "Sending…" : "Send to all customers"}</button>
      {channel === "WHATSAPP" && links.length > 0 && (
        <div className="text-sm">
          <p className="mb-1 text-muted">Click each to open WhatsApp with the message ready:</p>
          <div className="max-h-60 overflow-y-auto grid sm:grid-cols-2 gap-1">
            {links.map((l, i) => <a key={i} href={l.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-surface-2 text-accent"><ExternalLink size={13} /> {l.name}</a>)}
          </div>
        </div>
      )}
    </div>
  );
}

function Reminders() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery({ queryKey: ["reminder-preview"], queryFn: () => api<{ plans: ReminderPlan[] }>("/outreach/reminders/preview") });
  const plans = data?.plans ?? [];
  const due = plans.filter((p) => p.willSend);
  const sortedPlans = plans.sort((a, b) => Number(b.willSend) - Number(a.willSend));
  const { page, pages, setPage, pageRows, total, perPage } = useClientPagination(sortedPlans, 12);
  const run = useMutation({
    mutationFn: () => api<{ sent: number; byChannel: Record<string, number>; reset: number }>("/outreach/reminders/run", { method: "POST", body: {} }),
    onSuccess: (d) => { toast(`${d.sent} reminder(s) sent · ${d.reset} reset`); refetch(); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-edge">
        <p className="text-sm text-muted">{due.length} customer(s) due a reminder now. The ladder escalates from gentle → firm → final as debt ages (thresholds & wording in Settings).</p>
        <button className="btn btn-primary" disabled={run.isPending || due.length === 0} onClick={() => run.mutate()}><BellRing size={15} /> {run.isPending ? "Sending…" : `Send ${due.length} due now`}</button>
      </div>
      {isLoading ? <TableSkeleton cols={5} /> : plans.length === 0 ? <EmptyState title="No customers owe money" hint="Reminders appear here as balances age." /> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted bg-surface-2 border-b border-edge text-xs"><th className="px-4 py-2.5 font-semibold">Customer</th><th className="px-4 py-2.5 font-semibold text-right">Balance</th><th className="px-4 py-2.5 font-semibold text-right">Oldest due</th><th className="px-4 py-2.5 font-semibold">Tier</th><th className="px-4 py-2.5 font-semibold">Status</th></tr></thead>
              <tbody>
                {pageRows.map((p) => (
                  <tr key={p.customerId} className="border-b border-edge last:border-0">
                    <td className="px-4 py-2">{p.name}</td>
                    <td className="px-4 py-2 text-right money">{fmtMoney(p.balance)}</td>
                    <td className="px-4 py-2 text-right mono">{p.ageDays}d</td>
                    <td className="px-4 py-2">{p.tier > 0 ? <Badge tone={p.tier >= 3 ? "danger" : p.tier === 2 ? "warn" : "muted"}>Tier {p.tier}</Badge> : <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-2 text-xs text-muted">{p.willSend ? <span className="text-accent">will send · {p.reason}</span> : p.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={pages} onPage={setPage} total={total} perPage={perPage} />
        </>
      )}
    </div>
  );
}
