import { CustomerLedger, VendorLedger, AccountStatement } from "./types";

/**
 * Print a ledger / account statement as an A4 page (browser "Save as PDF").
 * Same print-window approach as receipt.ts; true server-side PDFs are a Phase 5 polish.
 */
type Meta = { label: string; value: string }[];
type Col = { head: string; right?: boolean };
type Row = (string | number)[];

function printDoc(opts: { title: string; heading: string; meta: Meta; cols: Col[]; rows: Row[]; footNote?: string; settings: Record<string, string> }) {
  const { settings } = opts;
  const shopName = settings.shop_name || "SoftGlaze";
  const logo = settings.shop_logo || settings.shop_logo_thumb;
  const addr = [settings.shop_address, settings.shop_city].filter(Boolean).join(", ");
  const phone = settings.shop_phone || "";
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

  const thead = opts.cols.map((c) => `<th class="${c.right ? "r" : ""}">${esc(c.head)}</th>`).join("");
  const tbody = opts.rows
    .map((r) => `<tr>${r.map((cell, i) => `<td class="${opts.cols[i]?.right ? "r" : ""}">${esc(cell)}</td>`).join("")}</tr>`)
    .join("");
  const metaHtml = opts.meta.map((m) => `<div><span class="muted">${esc(m.label)}:</span> <b>${esc(m.value)}</b></div>`).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #000; }
    .head { display:flex; align-items:center; gap:12px; border-bottom:2px solid #000; padding-bottom:8px; }
    .logo { max-height: 54px; }
    h1 { font-size: 20px; margin: 0; }
    .muted { color:#555; }
    .doc { text-align:right; }
    .doc h2 { margin:0; font-size:16px; }
    .meta { display:flex; flex-wrap:wrap; gap:6px 28px; margin:12px 0; }
    table { width:100%; border-collapse:collapse; margin-top:6px; }
    th, td { padding:5px 6px; border-bottom:1px solid #ddd; text-align:left; vertical-align:top; }
    thead th { border-bottom:1.5px solid #000; background:#f4f4f4; }
    th.r, td.r { text-align:right; font-variant-numeric: tabular-nums; }
    .foot { margin-top:14px; text-align:right; font-size:13px; font-weight:bold; }
    .note { margin-top:10px; color:#555; font-size:11px; }
  </style></head><body>
    <div class="head">
      ${logo ? `<img class="logo" src="${window.location.origin}${logo}" />` : ""}
      <div style="flex:1">
        <h1>${esc(shopName)}</h1>
        ${addr ? `<div class="muted">${esc(addr)}</div>` : ""}
        ${phone ? `<div class="muted">${esc(phone)}</div>` : ""}
      </div>
      <div class="doc"><h2>${esc(opts.heading)}</h2><div class="muted">${new Date().toLocaleDateString()}</div></div>
    </div>
    <div class="meta">${metaHtml}</div>
    <table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
    ${opts.footNote ? `<div class="foot">${esc(opts.footNote)}</div>` : ""}
    <div class="note">Computer-generated statement — ${esc(shopName)}.</div>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
  </body></html>`;

  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

const m2 = (v: number | string) => `₨ ${Number(v).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const d = (s: string) => new Date(s).toLocaleDateString();

export function printCustomerStatement(l: CustomerLedger, settings: Record<string, string>) {
  printDoc({
    title: `Statement — ${l.customer.name}`,
    heading: "Customer Statement",
    settings,
    meta: [
      { label: "Customer", value: `${l.customer.name} (${l.customer.code})` },
      ...(l.customer.phone ? [{ label: "Phone", value: l.customer.phone }] : []),
      { label: "Opening", value: m2(l.opening) },
      { label: "Closing (owes you)", value: m2(l.closing) },
    ],
    cols: [{ head: "Date" }, { head: "Ref" }, { head: "Detail" }, { head: "Debit", right: true }, { head: "Credit", right: true }, { head: "Balance", right: true }],
    rows: l.entries.map((e) => [d(e.date), e.refNo, e.description, e.debit ? m2(e.debit) : "", e.credit ? m2(e.credit) : "", m2(e.balance)]),
    footNote: `Closing balance: ${m2(l.closing)}`,
  });
}

export function printVendorStatement(l: VendorLedger, settings: Record<string, string>) {
  printDoc({
    title: `Statement — ${l.vendor.name}`,
    heading: "Vendor Statement",
    settings,
    meta: [
      { label: "Vendor", value: `${l.vendor.name} (${l.vendor.code})` },
      ...(l.vendor.phone ? [{ label: "Phone", value: l.vendor.phone }] : []),
      { label: "Opening", value: m2(l.opening) },
      { label: "Closing (you owe)", value: m2(l.closing) },
    ],
    cols: [{ head: "Date" }, { head: "Ref" }, { head: "Detail" }, { head: "Paid / Returned", right: true }, { head: "Bill", right: true }, { head: "Balance", right: true }],
    rows: l.entries.map((e) => [d(e.date), e.refNo, e.description, e.debit ? m2(e.debit) : "", e.credit ? m2(e.credit) : "", m2(e.balance)]),
    footNote: `Closing balance: ${m2(l.closing)}`,
  });
}

export function printAccountStatement(s: AccountStatement, settings: Record<string, string>) {
  printDoc({
    title: `Statement — ${s.account.name}`,
    heading: "Account Statement",
    settings,
    meta: [
      { label: "Account", value: s.account.name },
      { label: "Opening", value: m2(s.opening) },
      { label: "Money in", value: m2(s.totalIn) },
      { label: "Money out", value: m2(s.totalOut) },
      { label: "Closing", value: m2(s.closing) },
    ],
    cols: [{ head: "Date" }, { head: "Type" }, { head: "Detail" }, { head: "In", right: true }, { head: "Out", right: true }, { head: "Balance", right: true }],
    rows: s.entries.map((e) => {
      const amt = Number(e.amount);
      return [d(e.date), e.type.replace("_", " "), e.notes ?? "", amt > 0 ? m2(amt) : "", amt < 0 ? m2(-amt) : "", m2(e.running ?? e.balance)];
    }),
    footNote: `Closing balance: ${m2(s.closing)}`,
  });
}
