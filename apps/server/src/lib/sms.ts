/**
 * E2 — Local SMS gateway (🔌 needs the owner's provider details).
 *
 * Provider-agnostic HTTP sender. The SUPER_ADMIN saves, in Settings → Integrations:
 *   sms_api_url   — a URL template with {to} {text} {key} {sender} placeholders, e.g.
 *                   https://api.provider.pk/send?apikey={key}&to={to}&from={sender}&text={text}
 *   sms_api_key   — the provider API key
 *   sms_sender    — the sender/mask id
 *   sms_method    — "GET" (default) or "POST" (JSON body from the same template's query)
 * Until sms_api_url is filled this throws a clear, actionable error — nothing is sent.
 * Every send/attempt is logged in MessageLog by the caller.
 */
import { prisma } from "./prisma";

export type SmsConfig = { url: string; key: string; sender: string; method: "GET" | "POST" };

export async function smsConfig(): Promise<SmsConfig> {
  const rows = await prisma.setting.findMany({ where: { key: { in: ["sms_api_url", "sms_api_key", "sms_sender", "sms_method"] } } });
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { url: s.sms_api_url || "", key: s.sms_api_key || "", sender: s.sms_sender || "", method: (s.sms_method || "GET").toUpperCase() === "POST" ? "POST" : "GET" };
}

export async function smsConfigured(): Promise<boolean> {
  return !!(await smsConfig()).url;
}

function fill(template: string, cfg: SmsConfig, to: string, text: string): string {
  return template
    .replaceAll("{key}", encodeURIComponent(cfg.key))
    .replaceAll("{sender}", encodeURIComponent(cfg.sender))
    .replaceAll("{to}", encodeURIComponent(to))
    .replaceAll("{text}", encodeURIComponent(text));
}

/** Send one SMS via the configured gateway. Throws {status,code} if not configured / on failure. */
export async function sendSms(opts: { to: string; text: string }): Promise<void> {
  const cfg = await smsConfig();
  if (!cfg.url) throw Object.assign(new Error("SMS gateway is not configured — set it in Settings → Integrations"), { status: 400, code: "VALIDATION" });
  const target = fill(cfg.url, cfg, opts.to, opts.text);
  let res: Response;
  try {
    if (cfg.method === "POST") {
      const u = new URL(target);
      const body = Object.fromEntries(u.searchParams.entries());
      res = await fetch(`${u.origin}${u.pathname}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } else {
      res = await fetch(target, { method: "GET" });
    }
  } catch (e: any) {
    throw Object.assign(new Error(`SMS gateway unreachable: ${e.message}`), { status: 502, code: "SMS_FAILED" });
  }
  if (!res.ok) throw Object.assign(new Error(`SMS gateway returned ${res.status}`), { status: 502, code: "SMS_FAILED" });
}
