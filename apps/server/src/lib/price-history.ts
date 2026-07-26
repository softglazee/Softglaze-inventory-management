import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;
type Num = Prisma.Decimal | number | string;

/**
 * D1 — append a price-history row (cost + sale price snapshot). Read-only audit trail
 * that feeds the cost/price trend report; writes nothing to the ledgers. Call it inside
 * the same transaction as the change so history can never diverge from the product.
 */
export async function logPriceChange(
  tx: Tx,
  args: { productId: string; costPrice: Num; salePrice: Num; source: "CREATE" | "UPDATE" | "PURCHASE"; userId?: string | null; note?: string | null }
): Promise<void> {
  await tx.priceHistory.create({
    data: {
      productId: args.productId,
      costPrice: new Prisma.Decimal(args.costPrice),
      salePrice: new Prisma.Decimal(args.salePrice),
      source: args.source,
      userId: args.userId ?? null,
      note: args.note ?? null,
    },
  });
}
