import { Sale } from "./types";

/**
 * Print a sale as an 80mm thermal receipt or an A4 invoice by opening a print
 * window. In the browser the user can "Save as PDF"; Electron can silent-print later.
 * (True server-side pdfmake PDFs are a later polish — this covers v1 for both sizes.)
 */
export function printReceipt(sale: Sale, size: "80mm" | "a4", settings: Record<string, string>) {
  const sym = settings.currency_symbol || "₨";
  const money = (v: string | number) =>
    `${sym} ${Number(v).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const qty = (v: string | number) => Number(v).toLocaleString("en-PK", { maximumFractionDigits: 3 });
  const esc = (s: string) => (s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

  const shopName = settings.shop_name || "SoftGlaze";
  const logo = settings.shop_logo || settings.shop_logo_thumb;
  const addr = [settings.shop_address, settings.shop_city].filter(Boolean).join(", ");
  const phone = settings.shop_phone || "";
  const footer = settings.invoice_footer || "";
  const isReturn = sale.isReturn;

  const rows = sale.items
    .map(
      (it) => `<tr>
        <td>${esc(it.product?.name ?? "")}<div class="sku">${esc(it.product?.sku ?? "")}</div></td>
        <td class="r">${qty(it.qty)}</td>
        <td class="r">${money(it.unitPrice)}</td>
        <td class="r">${money(it.total)}</td>
      </tr>`
    )
    .join("");

  const width = size === "80mm" ? "80mm" : "210mm";
  const pad = size === "80mm" ? "4mm" : "16mm";
  const baseFont = size === "80mm" ? "11px" : "13px";

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.invoiceNo)}</title>
  <style>
    @page { size: ${size === "80mm" ? "80mm auto" : "A4"}; margin: 0; }
    * { box-sizing: border-box; }
    body { font-family: ${size === "80mm" ? "'Courier New', monospace" : "Arial, sans-serif"}; font-size: ${baseFont}; color: #000; width: ${width}; margin: 0 auto; padding: ${pad}; }
    .center { text-align: center; }
    .r { text-align: right; }
    .muted { color: #444; }
    h1 { font-size: ${size === "80mm" ? "15px" : "22px"}; margin: 0 0 2px; }
    .logo { max-height: ${size === "80mm" ? "40px" : "64px"}; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { padding: 3px 2px; vertical-align: top; }
    thead th { border-bottom: 1px solid #000; text-align: left; font-size: ${size === "80mm" ? "10px" : "12px"}; }
    thead th.r { text-align: right; }
    tbody td { border-bottom: 1px dashed #bbb; }
    .sku { font-size: 9px; color: #666; }
    .totals { margin-top: 8px; width: 100%; }
    .totals td { padding: 2px; }
    .grand { font-weight: bold; font-size: ${size === "80mm" ? "13px" : "16px"}; border-top: 1px solid #000; }
    .foot { margin-top: 10px; text-align: center; font-size: ${size === "80mm" ? "10px" : "12px"}; white-space: pre-wrap; }
    .tag { display:inline-block; border:1px solid #000; padding:1px 6px; border-radius:4px; font-size:10px; }
  </style></head><body>
    <div class="center">
      ${logo ? `<img class="logo" src="${window.location.origin}${logo}" />` : ""}
      <h1>${esc(shopName)}</h1>
      ${addr ? `<div class="muted">${esc(addr)}</div>` : ""}
      ${phone ? `<div class="muted">${esc(phone)}</div>` : ""}
      ${isReturn ? `<div style="margin-top:4px"><span class="tag">RETURN</span></div>` : ""}
    </div>
    <div style="margin-top:8px">
      <div><b>${isReturn ? "Return" : "Invoice"}:</b> ${esc(sale.invoiceNo)}</div>
      <div class="muted">${new Date(sale.date).toLocaleString()}</div>
      ${sale.customer ? `<div><b>Customer:</b> ${esc(sale.customer.name)}${sale.customer.phone ? " · " + esc(sale.customer.phone) : ""}</div>` : `<div class="muted">Walk-in customer</div>`}
    </div>
    <table>
      <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>Sub-total</td><td class="r">${money(sale.subTotal)}</td></tr>
      ${Number(sale.discount) ? `<tr><td>Discount</td><td class="r">- ${money(sale.discount)}</td></tr>` : ""}
      ${Number(sale.tax) ? `<tr><td>Tax</td><td class="r">${money(sale.tax)}</td></tr>` : ""}
      ${Number(sale.otherCharges) ? `<tr><td>Delivery / other</td><td class="r">${money(sale.otherCharges)}</td></tr>` : ""}
      ${Number(sale.roundOff) ? `<tr><td>Round off</td><td class="r">${Number(sale.roundOff) > 0 ? "" : "- "}${money(Math.abs(Number(sale.roundOff)))}</td></tr>` : ""}
      <tr class="grand"><td>Grand total</td><td class="r">${money(sale.grandTotal)}</td></tr>
      <tr><td>Paid</td><td class="r">${money(sale.paidAmount)}</td></tr>
      ${Number(sale.dueAmount) ? `<tr><td>Balance (udhaar)</td><td class="r">${money(sale.dueAmount)}</td></tr>` : ""}
    </table>
    ${footer ? `<div class="foot">${esc(footer)}</div>` : ""}
    <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
  </body></html>`;

  const w = window.open("", "_blank", "width=480,height=640");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
