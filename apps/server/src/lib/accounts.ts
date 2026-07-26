/**
 * Money-account ledger service (Phase 4, G1). The AccountEntry table is the source
 * of truth for every account's balance (the ledger-is-authoritative rule applied to
 * money, not just stock) — every Payment / FundTransfer / CapitalEntry appends a signed entry with a
 * running balance and updates the cached PaymentMethod.currentBalance in the SAME
 * transaction. Mirrors lib/stock.ts. Reused by sales, purchases, payments, expenses,
 * salaries, transfers and capital/drawings.
 */
import { Prisma, PaymentType, AccountEntryType } from "@prisma/client";
import { nextNumber } from "../utils/counter";

type Tx = Prisma.TransactionClient;
type Num = Prisma.Decimal | number | string;

const money = (v: Num) => new Prisma.Decimal(v).toDecimalPlaces(2);

/** Payment types that bring money INTO an account (everything else takes it out). */
const MONEY_IN: PaymentType[] = ["SALE_RECEIPT", "CUSTOMER_RECEIPT", "REFUND_IN"];

/** +1 = money into the account, −1 = money out of the account. */
export function paymentSign(type: PaymentType): number {
  return MONEY_IN.includes(type) ? 1 : -1;
}

/**
 * Append an account ledger entry and update the cached currentBalance.
 * `amount` is SIGNED (+in / −out). Returns the new running balance.
 */
export async function postToAccount(
  tx: Tx,
  args: {
    accountId: string;
    amount: Num; // signed
    type: AccountEntryType;
    refType?: string | null;
    refId?: string | null;
    date?: Date;
    notes?: string | null;
  }
): Promise<Prisma.Decimal> {
  const account = await tx.paymentMethod.findUnique({ where: { id: args.accountId }, select: { currentBalance: true, name: true } });
  if (!account) throw new Error("Account not found for money movement");
  const amount = money(args.amount);
  const balance = money(new Prisma.Decimal(account.currentBalance).plus(amount));
  await tx.accountEntry.create({
    data: {
      accountId: args.accountId,
      type: args.type,
      amount,
      balance,
      refType: args.refType ?? null,
      refId: args.refId ?? null,
      notes: args.notes ?? null,
      ...(args.date ? { date: args.date } : {}),
    },
  });
  await tx.paymentMethod.update({ where: { id: args.accountId }, data: { currentBalance: balance } });
  return balance;
}

/**
 * Create a Payment AND post its effect to the account ledger, atomically.
 * `amount` is POSITIVE; the sign for the account is derived from the payment type.
 * Generates the PAY- refNo. Returns the created Payment.
 */
export async function postPayment(
  tx: Tx,
  args: {
    type: PaymentType;
    methodId: string;
    amount: Num; // positive
    userId: string;
    customerId?: string | null;
    vendorId?: string | null;
    saleId?: string | null;
    purchaseId?: string | null;
    expenseId?: string | null;
    siteId?: string | null; // C4 — customer site this receipt/refund is allocated to
    date?: Date;
    notes?: string | null;
  }
) {
  const refNo = await nextNumber(tx, "payment", "PAY");
  const amount = money(args.amount);
  const payment = await tx.payment.create({
    data: {
      refNo,
      type: args.type,
      methodId: args.methodId,
      amount,
      userId: args.userId,
      customerId: args.customerId ?? null,
      vendorId: args.vendorId ?? null,
      saleId: args.saleId ?? null,
      purchaseId: args.purchaseId ?? null,
      expenseId: args.expenseId ?? null,
      siteId: args.siteId ?? null,
      notes: args.notes ?? null,
      ...(args.date ? { date: args.date } : {}),
    },
  });
  await postToAccount(tx, {
    accountId: args.methodId,
    amount: amount.times(paymentSign(args.type)),
    type: "PAYMENT",
    refType: "Payment",
    refId: payment.id,
    date: args.date,
    notes: args.notes ?? null,
  });
  return payment;
}
