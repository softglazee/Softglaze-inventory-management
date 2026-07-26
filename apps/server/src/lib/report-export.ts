/**
 * Report export (Phase 5). One generic ReportDoc shape drives three outputs:
 *  - JSON  → the web renders it in a table (columns/rows/totals)
 *  - PDF   → pdfmake (standard Helvetica font, no embedding needed)
 *  - Excel → exceljs
 * Money is written "Rs 12,345.00" (ASCII) in files so it renders in every font.
 */
import type { Response } from "express";
import path from "path";
import fs from "fs";
import PdfPrinter from "pdfmake";
import ExcelJS from "exceljs";
import sharp from "sharp";

const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "uploads");

/** Read the shop logo off disk and return it as a PNG data URI (pdfmake can't read webp). */
async function logoDataUri(settings: Record<string, string>): Promise<string | null> {
  const web = settings.shop_logo_thumb || settings.shop_logo;
  if (!web) return null;
  try {
    const file = path.join(UPLOAD_ROOT, web.replace(/^\/?uploads\//, ""));
    if (!fs.existsSync(file)) return null;
    const png = await sharp(file).resize(160, 160, { fit: "inside" }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

export type ReportCol = { header: string; key: string; align?: "left" | "right"; money?: boolean; width?: number };
export type ReportRow = Record<string, string | number | null | undefined>;
export type ReportDoc = {
  title: string;
  subtitle?: string;
  meta?: { label: string; value: string }[];
  columns: ReportCol[];
  rows: ReportRow[];
  totals?: ReportRow; // a bold summary row (keyed by column key)
};

const nf = new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v: unknown) => `Rs ${nf.format(Number(v ?? 0))}`;
const cellText = (row: ReportRow, col: ReportCol) => {
  const v = row[col.key];
  if (v === null || v === undefined || v === "") return col.money ? money(0) : "";
  return col.money ? money(v) : String(v);
};

// pdfmake with the built-in Helvetica family — no font files to ship.
const printer = new PdfPrinter({
  Helvetica: { normal: "Helvetica", bold: "Helvetica-Bold", italics: "Helvetica-Oblique", bolditalics: "Helvetica-BoldOblique" },
});

function shopHeader(settings: Record<string, string>) {
  const name = settings.shop_name || "SoftGlaze";
  const addr = [settings.shop_address, settings.shop_city].filter(Boolean).join(", ");
  const phone = settings.shop_phone || "";
  const lines: any[] = [{ text: name, style: "shop" }];
  if (addr) lines.push({ text: addr, style: "muted" });
  if (phone) lines.push({ text: phone, style: "muted" });
  return lines;
}

export async function buildPdf(doc: ReportDoc, settings: Record<string, string>): Promise<Buffer> {
  const logo = await logoDataUri(settings);
  const body: any[] = [];
  // header row
  body.push(doc.columns.map((c) => ({ text: c.header, style: "th", alignment: c.align ?? "left" })));
  // data rows
  for (const row of doc.rows) {
    body.push(doc.columns.map((c) => ({ text: cellText(row, c), alignment: c.align ?? "left", style: "td" })));
  }
  // totals row
  if (doc.totals) {
    body.push(doc.columns.map((c, i) => ({ text: i === 0 && doc.totals![c.key] == null ? "Total" : cellText(doc.totals!, c), alignment: c.align ?? "left", style: "tot" })));
  }

  const definition: any = {
    pageMargins: [32, 40, 32, 40],
    defaultStyle: { font: "Helvetica", fontSize: 9, color: "#222" },
    footer: (page: number, count: number) => ({ text: `Page ${page} of ${count}`, alignment: "center", fontSize: 7, color: "#999", margin: [0, 8, 0, 0] }),
    content: [
      { columns: [...(logo ? [{ image: logo, width: 42, margin: [0, 0, 10, 0] }] : []), { stack: shopHeader(settings), width: "*" }, { text: new Date().toLocaleString(), alignment: "right", style: "muted" }] },
      { text: doc.title, style: "title", margin: [0, 12, 0, 2] },
      ...(doc.subtitle ? [{ text: doc.subtitle, style: "muted", margin: [0, 0, 0, 4] }] : []),
      ...(doc.meta && doc.meta.length ? [{ text: doc.meta.map((m) => `${m.label}: ${m.value}`).join("     "), style: "muted", margin: [0, 0, 0, 8] }] : [{ text: "", margin: [0, 0, 0, 6] }]),
      {
        table: { headerRows: 1, widths: doc.columns.map((c) => c.width ?? "*"), body },
        layout: {
          hLineWidth: (i: number) => (i === 0 || i === 1 || i === body.length ? 0.8 : 0.4),
          vLineWidth: () => 0,
          hLineColor: (i: number) => (i <= 1 || i === body.length ? "#333" : "#e2e2e2"),
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
      },
    ],
    styles: {
      shop: { fontSize: 14, bold: true },
      title: { fontSize: 13, bold: true },
      muted: { color: "#777", fontSize: 8 },
      th: { bold: true, fontSize: 9, fillColor: "#f2f2f2" },
      td: { fontSize: 9 },
      tot: { bold: true, fontSize: 9, fillColor: "#f7f7f7" },
    },
  };

  return new Promise((resolve, reject) => {
    const pdf = printer.createPdfKitDocument(definition);
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.end();
  });
}

export async function buildXlsx(doc: ReportDoc, settings: Record<string, string>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = settings.shop_name || "SoftGlaze";
  const ws = wb.addWorksheet(doc.title.slice(0, 28) || "Report");

  ws.addRow([settings.shop_name || "SoftGlaze"]);
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.addRow([doc.title]);
  ws.getRow(2).font = { bold: true, size: 12 };
  if (doc.subtitle) ws.addRow([doc.subtitle]);
  if (doc.meta?.length) ws.addRow(doc.meta.map((m) => `${m.label}: ${m.value}`).join("   "));
  ws.addRow([]);

  const headerRow = ws.addRow(doc.columns.map((c) => c.header));
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F0F0" } }; cell.border = { bottom: { style: "thin" } }; });

  const numFmt = '#,##0.00';
  const addDataRow = (row: ReportRow, bold = false) => {
    const r = ws.addRow(doc.columns.map((c) => {
      const v = row[c.key];
      if (c.money) return v == null || v === "" ? 0 : Number(v);
      return v ?? "";
    }));
    doc.columns.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      if (c.money) cell.numFmt = numFmt;
      if (c.align === "right") cell.alignment = { horizontal: "right" };
    });
    if (bold) r.font = { bold: true };
  };
  for (const row of doc.rows) addDataRow(row);
  if (doc.totals) addDataRow({ ...doc.totals, [doc.columns[0].key]: doc.totals[doc.columns[0].key] ?? "Total" }, true);

  doc.columns.forEach((c, i) => {
    const maxLen = Math.max(c.header.length, ...doc.rows.map((r) => String(r[c.key] ?? "").length), 10);
    ws.getColumn(i + 1).width = Math.min(40, maxLen + 4);
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

/** Send a report as JSON, PDF, or Excel based on `format`. */
export async function sendReport(res: Response, format: string, filenameBase: string, doc: ReportDoc, settings: Record<string, string>, extra: Record<string, unknown> = {}) {
  if (format === "pdf") {
    const buf = await buildPdf(doc, settings);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safe(filenameBase)}.pdf"`);
    return res.send(buf);
  }
  if (format === "xlsx" || format === "excel") {
    const buf = await buildXlsx(doc, settings);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safe(filenameBase)}.xlsx"`);
    return res.send(buf);
  }
  return res.json({ ok: true, data: { report: doc, ...extra } });
}
