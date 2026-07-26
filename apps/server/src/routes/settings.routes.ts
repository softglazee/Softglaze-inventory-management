import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { imageUpload, saveImage, saveFavicon, deleteImageFiles } from "../lib/upload";
import { BUSINESS_PRESETS, getPreset } from "../data/business-presets";
import { nextSku } from "../utils/sku";
import { sendMail } from "../lib/mailer";

const router = Router();

/**
 * Keys any settings-admin may edit (Shop Profile — A1 + G10 branding).
 * Integrations (smtp_*, whatsapp_*) are gated separately in Phase 6.
 */
const EDITABLE_KEYS = [
  // Identity
  "shop_name",
  "shop_tagline",
  // Contact
  "shop_address",
  "shop_address2",
  "shop_city",
  "shop_phone",
  "shop_phone2",
  "shop_whatsapp",
  "shop_email",
  "shop_website",
  // Legal
  "tax_number",
  "strn",
  "cnic",
  // Invoice
  "invoice_prefix",
  "invoice_header_lines",
  "invoice_footer",
  "invoice_footer_urdu",
  "show_logo",
  "receipt_size",
  "round_off_to",
  "allow_negative_stock", // D2 — allow overselling (stock goes negative, line flagged backorder)
  // Batch G — POS experience
  "pos_favourites",        // G1 — comma-separated product IDs for the quick-sale grid
  "max_discount_percent",  // G3 — bill discount cap before manager approval (0 = off)
  "loyalty_enabled",       // G4 — "1" to earn/redeem points
  "loyalty_earn_per_100",  // G4 — points earned per ₨100 spent
  "loyalty_redeem_value",  // G4 — ₨ value of one point when redeemed
  // Regional
  "currency",
  "currency_symbol",
  "tax_percent",
  "date_format",
  "timezone",
  // Branding (G10)
  "page_title",
  // Reminders
  "low_stock_sweep_time",
  "debt_reminder_days",
  // E4 — tiered udhaar reminder escalation
  "reminder_t1_days", "reminder_t2_days", "reminder_t3_days",
  "reminder_t1_text", "reminder_t2_text", "reminder_t3_text",
  "reminder_cooldown_days",
] as const;

/**
 * Keys safe to expose WITHOUT auth (login page, receipts, PDF headers need these).
 * Never include integration secrets here.
 */
const PUBLIC_KEYS = [
  "shop_name",
  "shop_tagline",
  "shop_logo",
  "shop_logo_thumb",
  "currency",
  "currency_symbol",
  "business_type",
  "page_title",
  "favicon",
  "receipt_size",
  "invoice_prefix",
] as const;

/** Integration settings (SUPER_ADMIN / settings.integrations). Kept out of EDITABLE_KEYS. */
const INTEGRATION_KEYS = [
  "smtp_host", "smtp_port", "smtp_secure", "smtp_user", "smtp_pass", "smtp_from_name",
  "whatsapp_mode", "whatsapp_number", "sms_enabled",
  // E2 — local SMS gateway (🔌 owner fills these)
  "sms_api_url", "sms_api_key", "sms_sender", "sms_method",
  // H1 — offsite cloud backup (🔌 owner fills the destination URL)
  "backup_cloud_url", "backup_cloud_enabled",
  // G8 message templates (WhatsApp text with {placeholders})
  "tmpl_wa_receipt", "tmpl_wa_reminder", "tmpl_wa_purchase", "tmpl_wa_statement", "tmpl_wa_quotation",
  // G8 email templates (subject + body, same {placeholders})
  "tmpl_email_subject", "tmpl_email_body", "tmpl_email_reminder_subject", "tmpl_email_reminder_body",
] as const;

/** Secrets never returned to the client in plain text. */
const SECRET_KEYS = new Set(["smtp_pass"]);

/** GET /settings/public — unauthenticated shop identity for the login page & PDFs */
router.get("/public", async (_req, res, next) => {
  try {
    const rows = await prisma.setting.findMany({ where: { key: { in: PUBLIC_KEYS as unknown as string[] } } });
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key] = row.value;
    res.json({ ok: true, data: { settings } });
  } catch (err) {
    next(err);
  }
});

// Everything below requires a logged-in user
router.use(requireAuth);

/** GET /settings — key/value map (secrets masked; a *_set flag says whether one is stored) */
router.get("/", async (_req, res, next) => {
  try {
    const rows = await prisma.setting.findMany();
    const settings: Record<string, string> = {};
    for (const row of rows) {
      if (SECRET_KEYS.has(row.key)) {
        settings[`${row.key}_set`] = row.value ? "1" : "0";
      } else {
        settings[row.key] = row.value;
      }
    }
    res.json({ ok: true, data: { settings } });
  } catch (err) {
    next(err);
  }
});

/** GET /settings/integrations — integration config for SUPER_ADMIN (secrets masked) */
router.get("/integrations", requirePermission("settings.integrations"), async (_req, res, next) => {
  try {
    const rows = await prisma.setting.findMany({ where: { key: { in: INTEGRATION_KEYS as unknown as string[] } } });
    const settings: Record<string, string> = {};
    for (const row of rows) settings[SECRET_KEYS.has(row.key) ? `${row.key}_set` : row.key] = SECRET_KEYS.has(row.key) ? (row.value ? "1" : "0") : row.value;
    res.json({ ok: true, data: { settings } });
  } catch (err) {
    next(err);
  }
});

/** PATCH /settings/integrations — save SMTP / WhatsApp / template settings */
router.patch("/integrations", requirePermission("settings.integrations"), async (req, res, next) => {
  try {
    const body = z.record(z.string()).parse(req.body);
    const entries = Object.entries(body).filter(([key]) => (INTEGRATION_KEYS as readonly string[]).includes(key));
    // A blank secret means "leave unchanged" — never overwrite a stored password with "".
    const toSave = entries.filter(([key, value]) => !(SECRET_KEYS.has(key) && value === ""));
    if (toSave.length === 0) return res.json({ ok: true, data: { message: "Nothing to update" } });
    await prisma.$transaction(toSave.map(([key, value]) => prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } })));
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "UPDATE_INTEGRATIONS", entity: "Setting", details: toSave.map(([k]) => k).join(",") } });
    res.json({ ok: true, data: { message: "Integration settings saved" } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Settings must be text values" } });
    next(err);
  }
});

/** POST /settings/test-email — verify SMTP by sending a test message */
router.post("/test-email", requirePermission("settings.integrations"), async (req, res, next) => {
  try {
    const to = z.string().email("Enter a valid email").parse(req.body?.to);
    const shopRow = await prisma.setting.findUnique({ where: { key: "shop_name" } });
    const shop = shopRow?.value || "SoftGlaze";
    let status: "SENT" | "FAILED" = "SENT";
    let error: string | null = null;
    try {
      await sendMail({ to, subject: `${shop} — SMTP test`, html: `<p>Your SoftGlaze email settings are working. 🎉</p><p>Sent from <b>${shop}</b>.</p>`, text: `Your SoftGlaze email settings are working. Sent from ${shop}.` });
    } catch (e: any) {
      status = "FAILED";
      error = e?.message ?? "Send failed";
    }
    await prisma.messageLog.create({ data: { channel: "EMAIL", recipient: to, template: "TEST", status, error } });
    if (status === "FAILED") return res.status(400).json({ ok: false, error: { code: "SEND_FAILED", message: error ?? "Could not send" } });
    res.json({ ok: true, data: { message: `Test email sent to ${to}` } });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    next(err);
  }
});

/** PATCH /settings — { key: value, ... } (whitelisted keys) */
router.patch("/", requirePermission("settings.shop"), async (req, res, next) => {
  try {
    const body = z.record(z.string()).parse(req.body);
    const entries = Object.entries(body).filter(([key]) => (EDITABLE_KEYS as readonly string[]).includes(key));
    if (entries.length === 0) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "No editable settings in request" } });
    }
    await prisma.$transaction(
      entries.map(([key, value]) => prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } }))
    );
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "UPDATE_SETTING", entity: "Setting", details: entries.map(([k]) => k).join(",") },
    });
    res.json({ ok: true, data: { message: "Settings saved" } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "Settings must be text values" } });
    }
    next(err);
  }
});

/** Helper: read a single setting value (or null). */
async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

/**
 * POST /settings/logo — multipart field "logo" (A1 logo pipeline).
 * sharp → webp (1200px) + thumb (300px, used on receipts). Old logo files are
 * removed only after the new one is safely stored.
 */
router.post("/logo", requirePermission("settings.shop"), imageUpload.single("logo"), async (req, res, next) => {
  try {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "No logo file received" } });
    }
    const [oldMain, oldThumb] = await Promise.all([getSetting("shop_logo"), getSetting("shop_logo_thumb")]);
    const saved = await saveImage(file.buffer, "branding");
    await prisma.$transaction([
      prisma.setting.upsert({ where: { key: "shop_logo" }, create: { key: "shop_logo", value: saved.path }, update: { value: saved.path } }),
      prisma.setting.upsert({ where: { key: "shop_logo_thumb" }, create: { key: "shop_logo_thumb", value: saved.thumbPath }, update: { value: saved.thumbPath } }),
    ]);
    await deleteImageFiles(oldMain, oldThumb);
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "UPDATE_SETTING", entity: "Setting", details: "shop_logo" } });
    res.json({ ok: true, data: { shop_logo: saved.path, shop_logo_thumb: saved.thumbPath } });
  } catch (err) {
    next(err);
  }
});

/** DELETE /settings/logo — remove the shop logo */
router.delete("/logo", requirePermission("settings.shop"), async (req, res, next) => {
  try {
    const [oldMain, oldThumb] = await Promise.all([getSetting("shop_logo"), getSetting("shop_logo_thumb")]);
    await prisma.setting.deleteMany({ where: { key: { in: ["shop_logo", "shop_logo_thumb"] } } });
    await deleteImageFiles(oldMain, oldThumb);
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "UPDATE_SETTING", entity: "Setting", details: "shop_logo removed" } });
    res.json({ ok: true, data: { message: "Logo removed" } });
  } catch (err) {
    next(err);
  }
});

/** POST /settings/favicon — multipart field "favicon" → 64px PNG (G10 branding) */
router.post("/favicon", requirePermission("settings.shop"), imageUpload.single("favicon"), async (req, res, next) => {
  try {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "No favicon file received" } });
    }
    const old = await getSetting("favicon");
    const path = await saveFavicon(file.buffer);
    await prisma.setting.upsert({ where: { key: "favicon" }, create: { key: "favicon", value: path }, update: { value: path } });
    await deleteImageFiles(old);
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "UPDATE_SETTING", entity: "Setting", details: "favicon" } });
    res.json({ ok: true, data: { favicon: path } });
  } catch (err) {
    next(err);
  }
});

/** GET /settings/presets — business type choices for onboarding/Settings */
router.get("/presets", async (_req, res, next) => {
  try {
    const presets = BUSINESS_PRESETS.map(({ key, label, description, categories, units }) => ({
      key,
      label,
      description,
      categoryNames: categories.map((c) => c.name),
      unitNames: units.map((u) => u.name),
    }));
    res.json({ ok: true, data: { presets } });
  } catch (err) {
    next(err);
  }
});

const applyPresetSchema = z.object({
  type: z.string().min(1, "Pick a business type"),
  force: z.boolean().optional(),
});

/**
 * POST /settings/apply-preset [SUPER_ADMIN]
 * Seeds categories + units + sample products for the chosen business type.
 * Refuses when real transactions exist (unless force) — presets are starter data,
 * not something to run over a live shop.
 */
router.post("/apply-preset", requireRole("SUPER_ADMIN"), async (req, res, next) => {
  try {
    const body = applyPresetSchema.parse(req.body);
    const preset = getPreset(body.type);
    if (!preset) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Unknown business type" } });
    }

    const [saleCount, purchaseCount] = await Promise.all([prisma.sale.count(), prisma.purchase.count()]);
    if ((saleCount > 0 || purchaseCount > 0) && !body.force) {
      return res.status(409).json({
        ok: false,
        error: {
          code: "CONFLICT",
          message: "This shop already has sales or purchases. Changing the preset only adds starter data — send force=true to proceed.",
        },
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      let unitsAdded = 0;
      let categoriesAdded = 0;
      let productsAdded = 0;

      // Units — base units first, then converted ones (Ton → kg)
      for (const u of preset.units.filter((x) => !x.base)) {
        const existing = await tx.unit.findUnique({ where: { shortName: u.shortName } });
        if (!existing) {
          await tx.unit.create({ data: { name: u.name, shortName: u.shortName } });
          unitsAdded++;
        }
      }
      for (const u of preset.units.filter((x) => x.base)) {
        const existing = await tx.unit.findUnique({ where: { shortName: u.shortName } });
        if (!existing) {
          const base = await tx.unit.findUnique({ where: { shortName: u.base!.shortName } });
          await tx.unit.create({
            data: { name: u.name, shortName: u.shortName, baseUnitId: base?.id ?? null, factor: u.base!.factor },
          });
          unitsAdded++;
        }
      }

      // Categories — parents, then children
      for (const c of preset.categories) {
        let parent = await tx.category.findUnique({ where: { name: c.name } });
        if (!parent) {
          parent = await tx.category.create({ data: { name: c.name } });
          categoriesAdded++;
        }
        for (const childName of c.children ?? []) {
          const child = await tx.category.findUnique({ where: { name: childName } });
          if (!child) {
            await tx.category.create({ data: { name: childName, parentId: parent.id } });
            categoriesAdded++;
          }
        }
      }

      // Sample products (skipped when a product with the same name exists)
      for (const p of preset.sampleProducts) {
        const exists = await tx.product.findFirst({ where: { name: p.name } });
        if (exists) continue;
        const category = await tx.category.findUnique({ where: { name: p.category } });
        const unit = await tx.unit.findUnique({ where: { shortName: p.unit } });
        if (!category || !unit) continue;
        const sku = await nextSku(tx, category.name);
        await tx.product.create({
          data: {
            sku,
            name: p.name,
            categoryId: category.id,
            unitId: unit.id,
            costPrice: p.costPrice,
            salePrice: p.salePrice,
          },
        });
        productsAdded++;
      }

      await tx.setting.upsert({
        where: { key: "business_type" },
        create: { key: "business_type", value: preset.key },
        update: { value: preset.key },
      });
      await tx.setting.upsert({
        where: { key: "onboarding_done" },
        create: { key: "onboarding_done", value: "1" },
        update: { value: "1" },
      });
      await tx.auditLog.create({
        data: { userId: req.user!.id, action: "APPLY_PRESET", entity: "Setting", details: preset.key },
      });

      return { unitsAdded, categoriesAdded, productsAdded };
    });

    res.json({ ok: true, data: { preset: preset.key, ...result } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.errors[0].message } });
    }
    next(err);
  }
});

export default router;
