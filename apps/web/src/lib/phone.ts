/**
 * Phone helpers for WhatsApp (wa.me) deep links.
 * wa.me needs a full international number with no +, spaces or dashes. Pakistani
 * numbers are usually written locally as 03xx-xxxxxxx — that must become 923xx…,
 * otherwise the link silently fails to open a chat.
 */
export function waNumber(raw: string | null | undefined): string {
  let n = (raw ?? "").replace(/[^0-9]/g, "");
  if (!n) return "";
  if (n.startsWith("00")) n = n.slice(2); // 0092… → 92…
  if (n.startsWith("0")) n = "92" + n.slice(1); // 03001234567 → 923001234567
  else if (n.length === 10 && n.startsWith("3")) n = "92" + n; // 3001234567 → 92…
  return n;
}

/** A wa.me deep link with prefilled text, or "" if there's no usable number. */
export function waLink(phone: string | null | undefined, text: string): string {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : "";
}
