/**
 * H1 — Offsite auto-backup (🔌 needs the owner's cloud destination).
 *
 * Builds the same JSON snapshot as the manual export and uploads it to a destination URL
 * the SUPER_ADMIN configures in Settings → Integrations (`backup_cloud_url`) — e.g. a
 * pre-signed S3/GCS PUT URL or a storage webhook. Runs nightly (deduped once per day).
 * Until the URL is filled nothing is uploaded. No provider SDK/credentials live here —
 * the owner supplies a URL that already carries its own auth (pre-signed / token).
 */
import { prisma } from "./prisma";

const ORDER = [
  "setting", "counter", "permission", "user", "rolePermission",
  "unit", "category", "brand", "expenseCategory", "paymentMethod", "department", "shift", "holiday",
  "product", "productImage", "comboItem",
  "customer", "vendor", "employee",
  "purchase", "purchaseItem", "sale", "saleItem",
  "expense", "payment", "accountEntry", "fundTransfer", "capitalEntry", "salaryPayment", "leaveRequest",
  "stockMovement", "stockAdjustment", "stockAdjustmentItem",
  "auditLog", "notification", "messageLog",
] as const;

export async function buildSnapshot(): Promise<string> {
  const data: Record<string, unknown[]> = {};
  for (const model of ORDER) data[model] = await (prisma as any)[model].findMany();
  return JSON.stringify({ app: "SoftGlaze", version: 1, exportedAt: new Date().toISOString(), data });
}

/** Upload the snapshot to the configured URL (PUT). Throws {status,code} on any problem. */
export async function uploadSnapshot(): Promise<{ bytes: number }> {
  const rows = await prisma.setting.findMany({ where: { key: { in: ["backup_cloud_url", "backup_cloud_enabled"] } } });
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (!s.backup_cloud_url) throw Object.assign(new Error("No cloud backup URL set — add one in Settings → Integrations"), { status: 400, code: "VALIDATION" });
  const body = await buildSnapshot();
  let res: Response;
  try {
    res = await fetch(s.backup_cloud_url, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
  } catch (e: any) {
    throw Object.assign(new Error(`Backup upload failed: ${e.message}`), { status: 502, code: "BACKUP_FAILED" });
  }
  if (!res.ok) throw Object.assign(new Error(`Backup destination returned ${res.status}`), { status: 502, code: "BACKUP_FAILED" });
  return { bytes: Buffer.byteLength(body) };
}

/** Nightly hook: upload once per day if enabled + configured. Safe to call daily. */
export async function runCloudBackupIfDue(): Promise<{ bytes: number } | null> {
  const rows = await prisma.setting.findMany({ where: { key: { in: ["backup_cloud_url", "backup_cloud_enabled", "backup_cloud_last"] } } });
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (s.backup_cloud_enabled !== "1" || !s.backup_cloud_url) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (s.backup_cloud_last === today) return null; // already done today
  const result = await uploadSnapshot();
  await prisma.setting.upsert({ where: { key: "backup_cloud_last" }, create: { key: "backup_cloud_last", value: today }, update: { value: today } });
  return result;
}
