import { Prisma } from "@prisma/client";

/**
 * Generates gap-free document numbers like INV-000123 inside a transaction.
 * Usage (inside prisma.$transaction(async (tx) => { ... })):
 *   const invoiceNo = await nextNumber(tx, "sale", "INV");
 */
export async function nextNumber(
  tx: Prisma.TransactionClient,
  key: string,
  prefix: string,
  pad = 6
): Promise<string> {
  const counter = await tx.counter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${String(counter.value).padStart(pad, "0")}`;
}
