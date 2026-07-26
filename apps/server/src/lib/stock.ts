/**
 * Stock ledger service (Phase 2). The StockMovement table is the source of truth
 * — every quantity change goes through applyMovement, which appends
 * a ledger row with a running balance and updates the cached Product.stockQty in the
 * SAME transaction. Reused by purchases, adjustments, returns, and (Phase 3) sales.
 */
import { Prisma, StockMoveType } from "@prisma/client";

type Tx = Prisma.TransactionClient;
type Num = Prisma.Decimal | number | string;

/**
 * Weighted-average cost after an inflow:
 *   newAvg = (oldQty*oldAvg + inQty*inCost) / (oldQty + inQty)
 * Guards division by zero (falls back to the incoming cost).
 */
export function weightedAvg(oldQty: Num, oldAvg: Num, inQty: Num, inCost: Num): Prisma.Decimal {
  const oq = new Prisma.Decimal(oldQty);
  const oa = new Prisma.Decimal(oldAvg);
  const iq = new Prisma.Decimal(inQty);
  const ic = new Prisma.Decimal(inCost);
  const total = oq.plus(iq);
  if (total.lte(0)) return ic;
  return oq.times(oa).plus(iq.times(ic)).div(total).toDecimalPlaces(2);
}

/** Error thrown when a movement would drive stock negative. */
export class InsufficientStockError extends Error {
  code = "INSUFFICIENT_STOCK";
  constructor(message: string) {
    super(message);
  }
}

/**
 * Append a stock movement and update the cached stockQty. `qty` is SIGNED
 * (+in / −out). Set allowNegative=false (default) to block over-issue.
 * Returns the new running balance.
 */
export async function applyMovement(
  tx: Tx,
  args: {
    productId: string;
    type: StockMoveType;
    qty: Num; // signed
    unitCost?: Num | null;
    refType?: string | null;
    refId?: string | null;
    notes?: string | null;
    date?: Date;
    allowNegative?: boolean;
    productName?: string; // for a friendlier error message
  }
): Promise<Prisma.Decimal> {
  const product = await tx.product.findUnique({ where: { id: args.productId }, select: { stockQty: true, name: true } });
  if (!product) throw new Error("Product not found for stock movement");
  const qty = new Prisma.Decimal(args.qty);
  const balance = new Prisma.Decimal(product.stockQty).plus(qty);
  if (!args.allowNegative && balance.lt(0)) {
    throw new InsufficientStockError(
      `${args.productName ?? product.name} has only ${product.stockQty} in stock`
    );
  }
  await tx.stockMovement.create({
    data: {
      productId: args.productId,
      type: args.type,
      qty,
      unitCost: args.unitCost == null ? null : new Prisma.Decimal(args.unitCost),
      refType: args.refType ?? null,
      refId: args.refId ?? null,
      balance,
      notes: args.notes ?? null,
      ...(args.date ? { date: args.date } : {}),
    },
  });
  await tx.product.update({ where: { id: args.productId }, data: { stockQty: balance } });
  return balance;
}
