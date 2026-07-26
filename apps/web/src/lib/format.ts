/** Prisma Decimal fields arrive as strings — parse once, format everywhere */
export function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

const moneyFmt = new Intl.NumberFormat("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

/** ₨ 12,345.50 — currency symbol comes from Settings later; PKR for now */
export function fmtMoney(value: string | number | null | undefined, symbol = "₨") {
  return `${symbol} ${moneyFmt.format(num(value))}`;
}

export function fmtQty(value: string | number | null | undefined) {
  return qtyFmt.format(num(value));
}
