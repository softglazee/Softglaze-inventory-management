/**
 * Cheque helpers (F1). A pending cheque sits in a non-cash "holding" account:
 *  - RECEIVED  → "Cheques in Hand"          (an asset — money owed to us on a cheque)
 *  - ISSUED    → "Post-dated Cheques"       (a contra account — money we've committed)
 * Receiving/issuing posts a normal Payment into the holding account (so the party's
 * balance settles immediately, the shopkeeper's expectation). Clearing transfers the
 * amount to/from a real bank account; bouncing posts a reversing Payment. Every step
 * keeps the account ledger + party reconciliation + balance sheet exactly consistent.
 */
import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

const HOLDING_NAME = {
  RECEIVED: "Cheques in Hand",
  ISSUED: "Post-dated Cheques",
} as const;

/** Get-or-create the non-cash holding account for a cheque direction. */
export async function ensureHoldingAccount(tx: Tx, direction: "RECEIVED" | "ISSUED"): Promise<string> {
  const name = HOLDING_NAME[direction];
  const existing = await tx.paymentMethod.findUnique({ where: { name }, select: { id: true } });
  if (existing) return existing.id;
  const created = await tx.paymentMethod.create({ data: { name, isCash: false, sortOrder: 90 } });
  return created.id;
}
