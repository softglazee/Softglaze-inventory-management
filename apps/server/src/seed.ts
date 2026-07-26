/**
 * Seed: shop-ready defaults for a building materials business.
 *
 * Lives in src/ (not prisma/) so `tsc` compiles it to dist/seed.js — the packaged
 * desktop app runs `node dist/seed.js` on first launch (no tsx at runtime). In dev
 * it's still invoked via `prisma/seed.ts` → `npm run db:seed`.
 *
 * Safe to re-run — every write is an upsert. Does NOT create a user: the first
 * registration from the app becomes the SUPER_ADMIN owner.
 */
import { PrismaClient } from "@prisma/client";
import { seedPermissions } from "./data/permissions";

export async function runSeed(prisma: PrismaClient): Promise<void> {
  // ── Units ──
  const units = [
    { name: "Piece", shortName: "pc" },
    { name: "Kilogram", shortName: "kg" },
    { name: "Bag", shortName: "bag" },
    { name: "Foot", shortName: "ft" },
    { name: "Square Foot", shortName: "sqft" },
    { name: "Bundle", shortName: "bdl" },
    { name: "Length", shortName: "len" },
    { name: "Litre", shortName: "ltr" },
  ];
  for (const u of units) {
    await prisma.unit.upsert({ where: { shortName: u.shortName }, create: u, update: {} });
  }
  // Ton = 1000 Kg
  const kg = await prisma.unit.findUnique({ where: { shortName: "kg" } });
  await prisma.unit.upsert({
    where: { shortName: "t" },
    create: { name: "Ton", shortName: "t", baseUnitId: kg!.id, factor: 1000 },
    update: {},
  });

  // ── Categories (typical iron & building materials shop) ──
  const categories = [
    "Cement",
    "Iron Rods (Sariya)",
    "Windows",
    "Doors",
    "Pipes & Fittings",
    "Bricks & Blocks",
    "Sand & Crush",
    "Hardware",
    "Paint",
    "Electrical",
    "Sanitary",
    "Steel Sheets & Girders",
  ];
  for (const name of categories) {
    await prisma.category.upsert({ where: { name }, create: { name }, update: {} });
  }
  // Sub-categories example
  const iron = await prisma.category.findUnique({ where: { name: "Iron Rods (Sariya)" } });
  for (const name of ["Sariya 10mm", "Sariya 12mm", "Sariya 16mm", "Sariya 20mm"]) {
    await prisma.category.upsert({ where: { name }, create: { name, parentId: iron!.id }, update: {} });
  }

  // ── Payment methods / money accounts (G1) ──
  const methods = [
    { name: "Cash", isCash: true, sortOrder: 0 },
    { name: "Bank Transfer", isCash: false, sortOrder: 1 },
    { name: "JazzCash", isCash: false, sortOrder: 2 },
    { name: "EasyPaisa", isCash: false, sortOrder: 3 },
    { name: "Card", isCash: false, sortOrder: 4 },
  ];
  for (const m of methods) {
    await prisma.paymentMethod.upsert({ where: { name: m.name }, create: m, update: { sortOrder: m.sortOrder } });
  }

  // ── Expense categories ──
  for (const name of ["Rent", "Salaries", "Electricity", "Transport & Loading", "Tea & Misc", "Repairs", "Miscellaneous"]) {
    await prisma.expenseCategory.upsert({ where: { name }, create: { name }, update: {} });
  }

  // ── Default settings ──
  const settings: Record<string, string> = {
    shop_name: "SoftGlaze Store",
    business_type: "building_materials",
    shop_address: "",
    shop_phone: "",
    currency: "PKR",
    currency_symbol: "₨",
    tax_percent: "0",
    invoice_prefix: "INV",
    invoice_footer: "Thank you for your business! Goods once sold on credit must be settled within agreed time.",
    receipt_size: "80mm",
    round_off_to: "0",                  // A5 — 0 off, or 1/5/10 (round POS grand total to nearest)
    // Notifications & reminders
    low_stock_sweep_time: "09:00",
    debt_reminder_days: "30",
    // Integrations (SUPER_ADMIN → Settings → Integrations)
    whatsapp_mode: "walink",            // walink | cloud_api | off
    whatsapp_receipt_template: "*{shop}*\nInvoice {invoice} — Total ₨{total}\nPaid ₨{paid} · Balance ₨{due}\nThank you for your business!",
    smtp_host: "",
    smtp_port: "587",
    smtp_user: "",
    smtp_pass: "",
    smtp_from_name: "SoftGlaze Store",
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }

  // ── Permissions catalog + role defaults (A2) ──
  await seedPermissions(prisma);
}

/** CLI entry — `node dist/seed.js` (packaged first-run) or `tsx src/seed.ts`. */
async function mainCli() {
  const prisma = new PrismaClient();
  try {
    await runSeed(prisma);
    console.log("✅ Seed complete: units, categories, payment methods, expense categories, settings, permissions.");
    console.log("👉 Now open the app and create your admin account on the Register page.");
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when executed directly (not when imported as a module).
const invokedDirectly =
  typeof require !== "undefined" && typeof module !== "undefined" && require.main === module;
if (invokedDirectly) {
  mainCli().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
