/**
 * Bulk Import Wizard (A3 products + G7 customers/vendors) and product export.
 * Flow: /parse (preview + auto-mapping) → /:entity/validate (dry-run) →
 * /:entity/commit (chunked writes, per-row salvage on failure).
 * Files are re-parsed on each step (stateless) so nothing half-imports.
 */
import { Router } from "express";
import multer from "multer";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { parseTabular, guessMapping, ParseSource } from "../lib/tabular";
import { nextNumber } from "../utils/counter";
import { nextSku } from "../utils/sku";

const router = Router();
router.use(requireAuth);

const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ─────────────────────────── Field catalogs ───────────────────────────

type Field = { key: string; label: string; required: boolean; aliases: string[] };

const PRODUCT_FIELDS: Field[] = [
  { key: "name", label: "Product name", required: true, aliases: ["itemname", "productname", "title", "item", "product"] },
  { key: "sku", label: "SKU / Item code", required: false, aliases: ["code", "itemcode", "productcode"] },
  { key: "barcode", label: "Barcode", required: false, aliases: ["ean", "upc"] },
  { key: "category", label: "Category", required: true, aliases: ["categoryname", "group", "department"] },
  { key: "unit", label: "Unit", required: true, aliases: ["uom", "unitname", "measure"] },
  { key: "brand", label: "Brand", required: false, aliases: ["make", "manufacturer", "company"] },
  { key: "type", label: "Type", required: false, aliases: ["producttype", "itemtype"] },
  { key: "costPrice", label: "Cost price", required: false, aliases: ["cost", "purchaseprice", "buyprice", "costrate"] },
  { key: "salePrice", label: "Sale price", required: false, aliases: ["price", "rate", "mrp", "retail", "sellprice", "saleprice"] },
  { key: "wholesalePrice", label: "Wholesale price", required: false, aliases: ["wholesale", "tradeprice", "dealerprice"] },
  { key: "taxPercent", label: "Tax %", required: false, aliases: ["tax", "gst", "vat", "taxrate"] },
  { key: "minStockLevel", label: "Low-stock level", required: false, aliases: ["minstock", "reorder", "reorderlevel", "minqty"] },
  { key: "openingStock", label: "Opening stock", required: false, aliases: ["stock", "qty", "quantity", "openingqty", "onhand"] },
  { key: "description", label: "Description", required: false, aliases: ["details", "notes", "remarks"] },
  { key: "length", label: "Length", required: false, aliases: ["len"] },
  { key: "width", label: "Width", required: false, aliases: ["wide"] },
  { key: "height", label: "Height", required: false, aliases: ["ht"] },
  { key: "weight", label: "Weight", required: false, aliases: ["wt", "mass"] },
];

const CUSTOMER_FIELDS: Field[] = [
  { key: "name", label: "Name", required: true, aliases: ["customername", "party", "account"] },
  { key: "phone", label: "Phone", required: false, aliases: ["mobile", "cell", "contact", "phoneno"] },
  { key: "address", label: "Address", required: false, aliases: ["location", "city"] },
  { key: "taxNumber", label: "NTN / CNIC", required: false, aliases: ["ntn", "cnic", "taxno", "taxnumber"] },
  { key: "openingBalance", label: "Opening balance", required: false, aliases: ["balance", "openingbal", "due", "udhaar"] },
  { key: "creditLimit", label: "Credit limit", required: false, aliases: ["limit", "creditlimit"] },
];

const VENDOR_FIELDS: Field[] = [
  { key: "name", label: "Name", required: true, aliases: ["vendorname", "supplier", "party", "account"] },
  { key: "phone", label: "Phone", required: false, aliases: ["mobile", "cell", "contact", "phoneno"] },
  { key: "address", label: "Address", required: false, aliases: ["location", "city"] },
  { key: "taxNumber", label: "NTN", required: false, aliases: ["ntn", "taxno", "taxnumber"] },
  { key: "bankDetails", label: "Bank details", required: false, aliases: ["bank", "iban", "accountno"] },
  { key: "openingBalance", label: "Opening balance", required: false, aliases: ["balance", "openingbal", "payable"] },
];

const FIELD_CATALOG: Record<string, Field[]> = { products: PRODUCT_FIELDS, customers: CUSTOMER_FIELDS, vendors: VENDOR_FIELDS };

// ─────────────────────────── helpers ───────────────────────────

function sourceFromReq(req: any): ParseSource {
  const file = req.file as Express.Multer.File | undefined;
  const text = typeof req.body?.text === "string" && req.body.text.trim() ? req.body.text : undefined;
  return { buffer: file?.buffer, filename: file?.originalname, text };
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Parse a numeric cell tolerantly (strips ₨, commas, spaces). */
function toNum(raw: string | undefined): { n: number | null; bad: boolean } {
  const t = (raw ?? "").toString().replace(/[₨,\s]/g, "").trim();
  if (t === "") return { n: null, bad: false };
  const n = Number(t);
  return Number.isFinite(n) ? { n, bad: false } : { n: null, bad: true };
}

function mapRow(row: Record<string, string>, mapping: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, col] of Object.entries(mapping)) {
    out[field] = col ? (row[col] ?? "").toString().trim() : "";
  }
  return out;
}

type RowIssue = { row: number; messages: string[] };
const ERROR_CAP = 200;

/**
 * Chunked writer with per-row salvage: tries 100 rows in one transaction; if the
 * chunk fails, retries each row in its own transaction so one bad row can't sink
 * the other 99. Returns the set of items that still failed.
 */
async function runChunked<T>(items: T[], writeOne: (tx: Prisma.TransactionClient, item: T) => Promise<void>) {
  const failed: { item: T; error: string }[] = [];
  const SIZE = 100;
  for (let i = 0; i < items.length; i += SIZE) {
    const chunk = items.slice(i, i + SIZE);
    try {
      await prisma.$transaction(async (tx) => {
        for (const it of chunk) await writeOne(tx, it);
      });
    } catch {
      for (const it of chunk) {
        try {
          await prisma.$transaction((tx) => writeOne(tx, it));
        } catch (e: any) {
          failed.push({ item: it, error: e?.message ?? "row failed" });
        }
      }
    }
  }
  return failed;
}

// ─────────────────────────── shared endpoints ───────────────────────────

/** GET /import/fields/:entity — field list for the mapping step */
router.get("/fields/:entity", (req, res) => {
  const fields = FIELD_CATALOG[req.params.entity];
  if (!fields) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Unknown import type" } });
  res.json({ ok: true, data: { fields } });
});

/** POST /import/parse — preview (columns, first 20 rows, count) + auto-mapping */
router.post("/parse", fileUpload.single("file"), async (req, res, next) => {
  try {
    const entity = String(req.body?.entity ?? "");
    const fields = FIELD_CATALOG[entity];
    const { columns, rows } = await parseTabular(sourceFromReq(req));
    if (columns.length === 0) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Could not read any columns — check the file or pasted text" } });
    }
    const suggestedMapping = fields ? guessMapping(columns, fields) : {};
    res.json({
      ok: true,
      data: { columns, rowCount: rows.length, preview: rows.slice(0, 20), suggestedMapping },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────── PRODUCTS ───────────────────────────

type ProductMaps = {
  cat: Map<string, string>; // lower(name) → id
  catName: Map<string, string>; // lower(name) → original name (for sku prefix)
  unit: Map<string, string>; // lower(shortName|name) → id
  brand: Map<string, string>; // lower(name) → id
  sku: Map<string, string>; // lower(sku) → productId
  barcode: Map<string, string>; // barcode → productId
};

async function loadProductMaps(): Promise<ProductMaps> {
  const [cats, units, brands, prods] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true } }),
    prisma.unit.findMany({ select: { id: true, name: true, shortName: true } }),
    prisma.brand.findMany({ select: { id: true, name: true } }),
    prisma.product.findMany({ select: { id: true, sku: true, barcode: true } }),
  ]);
  const cat = new Map<string, string>();
  const catName = new Map<string, string>();
  for (const c of cats) {
    cat.set(c.name.toLowerCase(), c.id);
    catName.set(c.name.toLowerCase(), c.name);
  }
  const unit = new Map<string, string>();
  for (const u of units) {
    unit.set(u.shortName.toLowerCase(), u.id);
    unit.set(u.name.toLowerCase(), u.id);
  }
  const brand = new Map<string, string>();
  for (const b of brands) brand.set(b.name.toLowerCase(), b.id);
  const sku = new Map<string, string>();
  const barcode = new Map<string, string>();
  for (const p of prods) {
    if (p.sku) sku.set(p.sku.toLowerCase(), p.id);
    if (p.barcode) barcode.set(p.barcode, p.id);
  }
  return { cat, catName, unit, brand, sku, barcode };
}

type ProductRow = {
  row: number;
  action: "create" | "update" | "skip" | "error";
  messages: string[];
  data: Record<string, string>;
};

function classifyProducts(
  mappedRows: Record<string, string>[],
  maps: ProductMaps,
  opts: { mode: string; autoCreateCategories: boolean; autoCreateUnits: boolean; autoCreateBrands: boolean }
): ProductRow[] {
  const seenSku = new Set<string>();
  const seenBarcode = new Set<string>();
  return mappedRows.map((data, i) => {
    const messages: string[] = [];
    const rowNo = i + 1;
    const name = (data.name ?? "").trim();
    if (!name) messages.push("Name is required");

    const typeRaw = (data.type ?? "").trim().toUpperCase();
    if (typeRaw && !["STANDARD", "SERVICE", "COMBO"].includes(typeRaw)) messages.push(`Unknown type "${data.type}"`);
    if (typeRaw === "COMBO") messages.push("Combo products can't be imported — build them in the app");

    const catName = (data.category ?? "").trim();
    if (!catName) messages.push("Category is required");
    else if (!maps.cat.has(catName.toLowerCase()) && !opts.autoCreateCategories) messages.push(`Unknown category "${catName}"`);

    const unitVal = (data.unit ?? "").trim();
    if (!unitVal) messages.push("Unit is required");
    else if (!maps.unit.has(unitVal.toLowerCase()) && !opts.autoCreateUnits) messages.push(`Unknown unit "${unitVal}"`);

    const brandName = (data.brand ?? "").trim();
    if (brandName && !maps.brand.has(brandName.toLowerCase()) && !opts.autoCreateBrands) messages.push(`Unknown brand "${brandName}"`);

    for (const f of ["costPrice", "salePrice", "wholesalePrice", "taxPercent", "minStockLevel", "openingStock", "length", "width", "height", "weight"]) {
      if (toNum(data[f]).bad) messages.push(`"${f}" is not a number`);
    }

    const skuKey = (data.sku ?? "").trim().toLowerCase();
    const barcode = (data.barcode ?? "").trim();
    if (skuKey) {
      if (seenSku.has(skuKey)) messages.push("Duplicate SKU within file");
      else seenSku.add(skuKey);
    }
    if (barcode) {
      if (seenBarcode.has(barcode)) messages.push("Duplicate barcode within file");
      else seenBarcode.add(barcode);
    }

    const existingId = (skuKey && maps.sku.get(skuKey)) || (barcode && maps.barcode.get(barcode)) || null;

    let action: ProductRow["action"];
    if (messages.length > 0) action = "error";
    else if (existingId) action = opts.mode === "update" ? "update" : "skip";
    else action = "create";
    return { row: rowNo, action, messages, data };
  });
}

function report(rows: { action: string; row: number; messages: string[] }[], total: number) {
  const errors = rows.filter((r) => r.action === "error").map((r) => ({ row: r.row, messages: r.messages }));
  return {
    total,
    create: rows.filter((r) => r.action === "create").length,
    update: rows.filter((r) => r.action === "update").length,
    skip: rows.filter((r) => r.action === "skip").length,
    errorRows: errors.length,
    errors: errors.slice(0, ERROR_CAP),
  };
}

/** POST /import/products/validate — dry run */
router.post("/products/validate", requirePermission("products.import"), fileUpload.single("file"), async (req, res, next) => {
  try {
    const mapping = parseJson<Record<string, string>>(req.body?.mapping, {});
    const opts = parseJson<any>(req.body?.options, {});
    const { rows } = await parseTabular(sourceFromReq(req));
    const maps = await loadProductMaps();
    const classified = classifyProducts(rows.map((r) => mapRow(r, mapping)), maps, {
      mode: opts.mode ?? "skip",
      autoCreateCategories: !!opts.autoCreateCategories,
      autoCreateUnits: !!opts.autoCreateUnits,
      autoCreateBrands: !!opts.autoCreateBrands,
    });
    res.json({ ok: true, data: report(classified, rows.length) });
  } catch (err) {
    next(err);
  }
});

/** POST /import/products/commit */
router.post("/products/commit", requirePermission("products.import"), fileUpload.single("file"), async (req, res, next) => {
  try {
    const mapping = parseJson<Record<string, string>>(req.body?.mapping, {});
    const opts = {
      mode: (parseJson<any>(req.body?.options, {}).mode ?? "skip") as string,
      autoCreateCategories: !!parseJson<any>(req.body?.options, {}).autoCreateCategories,
      autoCreateUnits: !!parseJson<any>(req.body?.options, {}).autoCreateUnits,
      autoCreateBrands: !!parseJson<any>(req.body?.options, {}).autoCreateBrands,
    };
    const { rows } = await parseTabular(sourceFromReq(req));
    const mapped = rows.map((r) => mapRow(r, mapping));
    let maps = await loadProductMaps();

    // Pre-create missing masters (so per-row writes just resolve ids)
    const distinct = (vals: string[]) => [...new Map(vals.filter((v) => v).map((v) => [v.toLowerCase(), v])).values()];
    if (opts.autoCreateCategories) {
      const missing = distinct(mapped.map((m) => (m.category ?? "").trim())).filter((n) => !maps.cat.has(n.toLowerCase()));
      if (missing.length) await prisma.category.createMany({ data: missing.map((name) => ({ name })), skipDuplicates: true });
    }
    if (opts.autoCreateBrands) {
      const missing = distinct(mapped.map((m) => (m.brand ?? "").trim())).filter((n) => n && !maps.brand.has(n.toLowerCase()));
      if (missing.length) await prisma.brand.createMany({ data: missing.map((name) => ({ name })), skipDuplicates: true });
    }
    if (opts.autoCreateUnits) {
      const missing = distinct(mapped.map((m) => (m.unit ?? "").trim())).filter((n) => !maps.unit.has(n.toLowerCase()));
      for (const name of missing) {
        const shortName = (name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "unit");
        await prisma.unit.create({ data: { name, shortName } }).catch(() => {});
      }
    }
    maps = await loadProductMaps(); // refresh after creating masters

    const classified = classifyProducts(mapped, maps, opts);
    const errors: RowIssue[] = classified.filter((r) => r.action === "error").map((r) => ({ row: r.row, messages: r.messages }));
    const skipped = classified.filter((r) => r.action === "skip").length;
    const writes = classified.filter((r) => r.action === "create" || r.action === "update");

    const failed = await runChunked(writes, async (tx, item) => {
      const d = item.data;
      const type = ((d.type ?? "").trim().toUpperCase() || "STANDARD") as "STANDARD" | "SERVICE" | "COMBO";
      const catId = maps.cat.get((d.category ?? "").trim().toLowerCase())!;
      const unitId = maps.unit.get((d.unit ?? "").trim().toLowerCase())!;
      const brandId = d.brand ? maps.brand.get(d.brand.trim().toLowerCase()) ?? null : null;
      const cost = toNum(d.costPrice).n ?? 0;
      const opening = type === "STANDARD" ? toNum(d.openingStock).n ?? 0 : 0;
      const common = {
        name: d.name.trim(),
        barcode: (d.barcode ?? "").trim() || null,
        description: (d.description ?? "").trim() || null,
        type,
        categoryId: catId,
        unitId,
        brandId,
        costPrice: cost,
        salePrice: toNum(d.salePrice).n ?? 0,
        wholesalePrice: toNum(d.wholesalePrice).n,
        taxPercent: toNum(d.taxPercent).n ?? 0,
        minStockLevel: toNum(d.minStockLevel).n ?? 0,
        length: toNum(d.length).n,
        width: toNum(d.width).n,
        height: toNum(d.height).n,
        weight: toNum(d.weight).n,
      };
      if (item.action === "update") {
        const skuKey = (d.sku ?? "").trim().toLowerCase();
        const barcode = (d.barcode ?? "").trim();
        const existingId = (skuKey && maps.sku.get(skuKey)) || (barcode && maps.barcode.get(barcode))!;
        await tx.product.update({ where: { id: existingId as string }, data: common });
      } else {
        const catName = maps.catName.get((d.category ?? "").trim().toLowerCase()) ?? d.category.trim();
        const sku = (d.sku ?? "").trim() || (await nextSku(tx, catName));
        const created = await tx.product.create({ data: { ...common, sku, stockQty: opening } });
        if (opening > 0) {
          await tx.stockMovement.create({
            data: { productId: created.id, type: "OPENING", qty: opening, unitCost: cost, refType: "OPENING", balance: opening, notes: "Opening stock (import)" },
          });
        }
      }
    });

    const failedSet = new Set(failed.map((f) => f.item));
    const created = writes.filter((w) => w.action === "create" && !failedSet.has(w)).length;
    const updated = writes.filter((w) => w.action === "update" && !failedSet.has(w)).length;
    for (const f of failed) errors.push({ row: f.item.row, messages: [f.error] });

    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "IMPORT_PRODUCTS", entity: "Product", details: `created ${created}, updated ${updated}, skipped ${skipped}, failed ${failed.length}` },
    });
    res.json({ ok: true, data: { created, updated, skipped, failed: failed.length, errors: errors.slice(0, ERROR_CAP) } });
  } catch (err) {
    next(err);
  }
});

/** GET /import/products/export?format=csv|xlsx — round-trippable product list */
router.get("/products/export", requirePermission("products.import"), async (req, res, next) => {
  try {
    const format = String(req.query.format ?? "csv").toLowerCase();
    const products = await prisma.product.findMany({
      include: { category: true, unit: true, brand: true },
      orderBy: { name: "asc" },
    });
    const headers = ["name", "sku", "barcode", "category", "unit", "brand", "type", "costPrice", "salePrice", "wholesalePrice", "taxPercent", "minStockLevel", "description", "length", "width", "height", "weight"];
    const rows = products.map((p) => ({
      name: p.name,
      sku: p.sku,
      barcode: p.barcode ?? "",
      category: p.category.name,
      unit: p.unit.shortName,
      brand: p.brand?.name ?? "",
      type: p.type,
      costPrice: p.costPrice.toString(),
      salePrice: p.salePrice.toString(),
      wholesalePrice: p.wholesalePrice?.toString() ?? "",
      taxPercent: p.taxPercent.toString(),
      minStockLevel: p.minStockLevel.toString(),
      description: p.description ?? "",
      length: p.length?.toString() ?? "",
      width: p.width?.toString() ?? "",
      height: p.height?.toString() ?? "",
      weight: p.weight?.toString() ?? "",
    }));

    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Products");
      ws.columns = headers.map((h) => ({ header: h, key: h, width: 16 }));
      ws.addRows(rows);
      ws.getRow(1).font = { bold: true };
      const buf = await wb.xlsx.writeBuffer();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="products-export.xlsx"');
      return res.send(Buffer.from(buf));
    }
    const csv = Papa.unparse({ fields: headers, data: rows.map((r) => headers.map((h) => (r as any)[h])) });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="products-export.csv"');
    res.send("﻿" + csv);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────── PARTIES (customers / vendors) ───────────────────────────

type PartyConfig = {
  entity: "customers" | "vendors";
  counterKey: string;
  prefix: string;
  hasCreditLimit: boolean;
  hasBank: boolean;
};

const PARTY: Record<string, PartyConfig> = {
  customers: { entity: "customers", counterKey: "customer", prefix: "CUS", hasCreditLimit: true, hasBank: false },
  vendors: { entity: "vendors", counterKey: "vendor", prefix: "VEN", hasCreditLimit: false, hasBank: true },
};

async function loadPartyPhones(entity: "customers" | "vendors"): Promise<Map<string, string>> {
  const rows =
    entity === "customers"
      ? await prisma.customer.findMany({ select: { id: true, phone: true } })
      : await prisma.vendor.findMany({ select: { id: true, phone: true } });
  const map = new Map<string, string>();
  for (const r of rows) if (r.phone) map.set(r.phone.trim(), r.id);
  return map;
}

type PartyRow = { row: number; action: "create" | "update" | "skip" | "error"; messages: string[]; data: Record<string, string> };

function classifyParties(mappedRows: Record<string, string>[], phones: Map<string, string>, cfg: PartyConfig, mode: string): PartyRow[] {
  const seenPhone = new Set<string>();
  return mappedRows.map((data, i) => {
    const messages: string[] = [];
    const name = (data.name ?? "").trim();
    if (!name) messages.push("Name is required");
    for (const f of ["openingBalance", ...(cfg.hasCreditLimit ? ["creditLimit"] : [])]) {
      if (toNum(data[f]).bad) messages.push(`"${f}" is not a number`);
    }
    const phone = (data.phone ?? "").trim();
    if (phone) {
      if (seenPhone.has(phone)) messages.push("Duplicate phone within file");
      else seenPhone.add(phone);
    }
    const existingId = phone ? phones.get(phone) ?? null : null;
    let action: PartyRow["action"];
    if (messages.length > 0) action = "error";
    else if (existingId) action = mode === "update" ? "update" : "skip";
    else action = "create";
    return { row: i + 1, action, messages, data };
  });
}

router.post("/:entity/validate", requirePermission("customers.create", "vendors.create"), fileUpload.single("file"), async (req, res, next) => {
  try {
    const cfg = PARTY[req.params.entity];
    if (!cfg) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Unknown import type" } });
    const mapping = parseJson<Record<string, string>>(req.body?.mapping, {});
    const mode = parseJson<any>(req.body?.options, {}).mode ?? "skip";
    const { rows } = await parseTabular(sourceFromReq(req));
    const phones = await loadPartyPhones(cfg.entity);
    const classified = classifyParties(rows.map((r) => mapRow(r, mapping)), phones, cfg, mode);
    res.json({ ok: true, data: report(classified, rows.length) });
  } catch (err) {
    next(err);
  }
});

router.post("/:entity/commit", requirePermission("customers.create", "vendors.create"), fileUpload.single("file"), async (req, res, next) => {
  try {
    const cfg = PARTY[req.params.entity];
    if (!cfg) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Unknown import type" } });
    const mapping = parseJson<Record<string, string>>(req.body?.mapping, {});
    const mode = parseJson<any>(req.body?.options, {}).mode ?? "skip";
    const { rows } = await parseTabular(sourceFromReq(req));
    const phones = await loadPartyPhones(cfg.entity);
    const classified = classifyParties(rows.map((r) => mapRow(r, mapping)), phones, cfg, mode);

    const errors: RowIssue[] = classified.filter((r) => r.action === "error").map((r) => ({ row: r.row, messages: r.messages }));
    const skipped = classified.filter((r) => r.action === "skip").length;
    const writes = classified.filter((r) => r.action === "create" || r.action === "update");

    const failed = await runChunked(writes, async (tx, item) => {
      const d = item.data;
      const opening = toNum(d.openingBalance).n ?? 0;
      const phone = (d.phone ?? "").trim() || null;
      const base: any = {
        name: d.name.trim(),
        phone,
        address: (d.address ?? "").trim() || null,
        taxNumber: (d.taxNumber ?? "").trim() || null,
      };
      if (cfg.hasBank) base.bankDetails = (d.bankDetails ?? "").trim() || null;
      if (cfg.hasCreditLimit) base.creditLimit = toNum(d.creditLimit).n ?? 0;

      if (item.action === "update") {
        const existingId = phone ? phones.get(phone)! : "";
        if (cfg.entity === "customers") {
          const cur = await tx.customer.findUnique({ where: { id: existingId }, select: { openingBalance: true } });
          const delta = opening - Number(cur?.openingBalance ?? 0);
          await tx.customer.update({ where: { id: existingId }, data: { ...base, openingBalance: opening, balance: delta !== 0 ? { increment: delta } : undefined } });
        } else {
          const cur = await tx.vendor.findUnique({ where: { id: existingId }, select: { openingBalance: true } });
          const delta = opening - Number(cur?.openingBalance ?? 0);
          await tx.vendor.update({ where: { id: existingId }, data: { ...base, openingBalance: opening, balance: delta !== 0 ? { increment: delta } : undefined } });
        }
      } else {
        const code = await nextNumber(tx, cfg.counterKey, cfg.prefix, 4);
        if (cfg.entity === "customers") {
          await tx.customer.create({ data: { ...base, code, openingBalance: opening, balance: opening } });
        } else {
          await tx.vendor.create({ data: { ...base, code, openingBalance: opening, balance: opening } });
        }
      }
    });

    const failedSet = new Set(failed.map((f) => f.item));
    const created = writes.filter((w) => w.action === "create" && !failedSet.has(w)).length;
    const updated = writes.filter((w) => w.action === "update" && !failedSet.has(w)).length;
    for (const f of failed) errors.push({ row: f.item.row, messages: [f.error] });

    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: `IMPORT_${cfg.entity.toUpperCase()}`, entity: cfg.entity, details: `created ${created}, updated ${updated}, skipped ${skipped}, failed ${failed.length}` },
    });
    res.json({ ok: true, data: { created, updated, skipped, failed: failed.length, errors: errors.slice(0, ERROR_CAP) } });
  } catch (err) {
    next(err);
  }
});

export default router;
