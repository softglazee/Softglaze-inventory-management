import { Prisma } from "@prisma/client";
import { nextNumber } from "./counter";

/** "Iron Rods (Sariya)" → "IRO", "Cement" → "CEM" — 3-letter SKU prefix */
export function skuPrefix(categoryName: string) {
  const letters = categoryName.toUpperCase().replace(/[^A-Z]/g, "");
  return (letters.slice(0, 3) || "PRD").padEnd(3, "X");
}

/** Auto SKU like CEM-0001, counted per category prefix, inside the transaction */
export async function nextSku(tx: Prisma.TransactionClient, categoryName: string) {
  const prefix = skuPrefix(categoryName);
  return nextNumber(tx, `sku:${prefix}`, prefix, 4);
}
