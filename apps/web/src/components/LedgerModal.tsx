import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, MessageCircle } from "lucide-react";
import { api } from "../lib/api";
import { CustomerLedger, VendorLedger } from "../lib/types";
import { fmtMoney, num } from "../lib/format";
import { Modal, TableSkeleton, EmptyState } from "./ui";
import { printCustomerStatement, printVendorStatement } from "../lib/statement";

/** 0300… → 92300…; keep 92… and already-international numbers. */
function waNumber(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("0")) return "92" + d.slice(1);
  return d;
}
function fillTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

/** Statement viewer for a customer (receivable) or vendor (payable), with PDF print. */
export default function LedgerModal({
  kind,
  id,
  name,
  onClose,
}: {
  kind: "customer" | "vendor";
  id: string;
  name: string;
  onClose: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const params = new URLSearchParams({ ...(from && { from }), ...(to && { to: `${to}T23:59:59` }) });

  const { data, isLoading } = useQuery({
    queryKey: ["ledger", kind, id, from, to],
    queryFn: () => api<CustomerLedger & VendorLedger>(`/ledger/${kind}/${id}?${params}`),
  });
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: () => api<{ settings: Record<string, string> }>("/settings") });

  const closing = data?.closing ?? 0;
  const label = kind === "customer" ? "owes you" : "you owe";

  function doPrint() {
    if (!data) return;
    const settings = settingsData?.settings ?? {};
    if (kind === "customer") printCustomerStatement(data as CustomerLedger, settings);
    else printVendorStatement(data as VendorLedger, settings);
  }

  const phone = kind === "customer" ? (data as CustomerLedger | undefined)?.customer?.phone : null;
  const waEnabled = kind === "customer" && !!phone && (settingsData?.settings.whatsapp_mode ?? "walink") !== "off" && num(closing) > 0;

  function sendReminder() {
    const s = settingsData?.settings ?? {};
    const tpl = s.tmpl_wa_reminder || "Dear {customer}, your balance at *{shop}* is {due}. Kindly clear it soon. Thank you.";
    const msg = fillTemplate(tpl, { shop: s.shop_name || "our shop", customer: name, due: `${s.currency_symbol || "₨"} ${Number(closing).toLocaleString("en-PK")}` });
    const url = `https://wa.me/${waNumber(phone!)}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
    api("/messages/log", { method: "POST", body: { channel: "WHATSAPP", recipient: phone, template: "DEBT_REMINDER", refType: "Customer", refId: id } }).catch(() => {});
  }

  return (
    <Modal open onClose={onClose} title={`Statement — ${name}`} wide>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label">From</label>
            <input type="date" className="input !w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input !w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex-1" />
          {waEnabled && (
            <button className="btn btn-secondary !text-success !border-success/40" onClick={sendReminder}>
              <MessageCircle size={15} /> WhatsApp reminder
            </button>
          )}
          <button className="btn btn-secondary" onClick={doPrint} disabled={!data}>
            <Printer size={15} /> Print / PDF
          </button>
        </div>

        <div className="card overflow-hidden">
          {isLoading ? (
            <TableSkeleton cols={6} />
          ) : !data || data.entries.length === 0 ? (
            <EmptyState title="No entries" hint="Nothing recorded in this period." />
          ) : (
            <div className="max-h-[50vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-left text-muted border-b border-edge text-xs">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Ref</th>
                    <th className="px-3 py-2 font-medium">Detail</th>
                    <th className="px-3 py-2 font-medium text-right">{kind === "customer" ? "Charge" : "Paid/Ret."}</th>
                    <th className="px-3 py-2 font-medium text-right">{kind === "customer" ? "Paid/Ret." : "Bill"}</th>
                    <th className="px-3 py-2 font-medium text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-edge text-muted">
                    <td className="px-3 py-1.5" colSpan={5}>Opening balance</td>
                    <td className="px-3 py-1.5 text-right money">{fmtMoney(data.opening)}</td>
                  </tr>
                  {data.entries.map((e, i) => (
                    <tr key={i} className="border-b border-edge last:border-0">
                      <td className="px-3 py-1.5 text-muted whitespace-nowrap">{new Date(e.date).toLocaleDateString()}</td>
                      <td className="px-3 py-1.5 mono text-xs">{e.refNo}</td>
                      <td className="px-3 py-1.5">{e.description}</td>
                      <td className="px-3 py-1.5 text-right money">{e.debit ? fmtMoney(e.debit) : "—"}</td>
                      <td className="px-3 py-1.5 text-right money">{e.credit ? fmtMoney(e.credit) : "—"}</td>
                      <td className="px-3 py-1.5 text-right money">{fmtMoney(e.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center">
          <span className="text-sm text-muted">Closing balance ({label})</span>
          <span className={`text-lg font-bold money ${Number(closing) > 0 ? "text-danger" : Number(closing) < 0 ? "text-success" : ""}`}>{fmtMoney(closing)}</span>
        </div>
      </div>
    </Modal>
  );
}
