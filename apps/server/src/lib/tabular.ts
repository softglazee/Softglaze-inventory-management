/**
 * Tabular parsing for the import wizard (A3 / G7).
 * Accepts an uploaded file (.csv .txt .xlsx .xls .xml) OR pasted text and returns
 * a uniform { columns, rows } shape where each row is keyed by column header.
 */
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { XMLParser } from "fast-xml-parser";

export type ParsedTable = { columns: string[]; rows: Record<string, string>[] };

export type ParseSource = {
  buffer?: Buffer;
  filename?: string;
  text?: string;
};

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as any;
    if (typeof o.text === "string") return o.text.trim();
    if (typeof o.result !== "undefined") return cellToString(o.result);
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text ?? "").join("").trim();
    if (o.hyperlink) return cellToString(o.text ?? o.hyperlink);
  }
  return String(v).trim();
}

/** Strip a UTF-8 BOM if present. */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function fromDelimited(text: string): ParsedTable {
  const parsed = Papa.parse<Record<string, string>>(stripBom(text), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    dynamicTyping: false,
  });
  const columns = (parsed.meta.fields ?? []).filter((f) => f && f.length > 0);
  const rows = (parsed.data as Record<string, unknown>[]).map((r) => {
    const out: Record<string, string> = {};
    for (const c of columns) out[c] = cellToString(r[c]);
    return out;
  });
  return { columns, rows: rows.filter((r) => columns.some((c) => r[c] !== "")) };
}

async function fromExcel(buffer: Buffer): Promise<ParsedTable> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.worksheets[0];
  if (!ws) return { columns: [], rows: [] };
  const headerRow = ws.getRow(1);
  const columns: string[] = [];
  const colIndexes: number[] = [];
  headerRow.eachCell((cell, col) => {
    const name = cellToString(cell.value);
    if (name) {
      columns.push(name);
      colIndexes.push(col);
    }
  });
  const rows: Record<string, string>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const out: Record<string, string> = {};
    let any = false;
    columns.forEach((name, i) => {
      const val = cellToString(row.getCell(colIndexes[i]).value);
      out[name] = val;
      if (val !== "") any = true;
    });
    if (any) rows.push(out);
  }
  return { columns, rows };
}

/** Recursively find the first array of plain objects in a parsed XML tree. */
function findRecordArray(node: any): any[] | null {
  if (!node || typeof node !== "object") return null;
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === "object" && !Array.isArray(val[0])) {
      return val;
    }
  }
  for (const key of Object.keys(node)) {
    const found = findRecordArray(node[key]);
    if (found) return found;
  }
  return null;
}

function fromXml(text: string): ParsedTable {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", trimValues: true });
  const tree = parser.parse(stripBom(text));
  let records = findRecordArray(tree);
  if (!records) {
    // maybe a single record: <products><product>..single..</product></products>
    // findRecordArray only matches arrays; fall back to any object with scalar fields
    const firstObj = (function walk(n: any): any {
      if (!n || typeof n !== "object") return null;
      const scalarKeys = Object.keys(n).filter((k) => typeof n[k] !== "object");
      if (scalarKeys.length > 0) return n;
      for (const k of Object.keys(n)) {
        const f = walk(n[k]);
        if (f) return f;
      }
      return null;
    })(tree);
    records = firstObj ? [firstObj] : [];
  }
  const columns: string[] = [];
  for (const rec of records) {
    for (const k of Object.keys(rec)) {
      if (typeof rec[k] !== "object" && !columns.includes(k)) columns.push(k);
    }
  }
  const rows = records.map((rec) => {
    const out: Record<string, string> = {};
    for (const c of columns) out[c] = cellToString(rec[c]);
    return out;
  });
  return { columns, rows };
}

/** Parse any supported source into a uniform table. */
export async function parseTabular(src: ParseSource): Promise<ParsedTable> {
  const ext = (src.filename ?? "").toLowerCase().split(".").pop() ?? "";
  if (src.buffer && (ext === "xlsx" || ext === "xls")) return fromExcel(src.buffer);
  const text = src.text ?? (src.buffer ? src.buffer.toString("utf8") : "");
  if (!text.trim()) return { columns: [], rows: [] };
  if (ext === "xml" || text.trimStart().startsWith("<")) return fromXml(text);
  return fromDelimited(text);
}

/** Guess a field→column mapping from header names (case/space/underscore-insensitive). */
export function guessMapping(columns: string[], fields: { key: string; aliases: string[] }[]): Record<string, string> {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.]+/g, "");
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const field of fields) {
    const wanted = [field.key, ...field.aliases].map(norm);
    const match = columns.find((c) => !used.has(c) && wanted.includes(norm(c)));
    if (match) {
      mapping[field.key] = match;
      used.add(match);
    }
  }
  return mapping;
}
