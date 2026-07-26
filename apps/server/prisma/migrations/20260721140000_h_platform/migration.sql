-- Batch H — platform & safety (H2 saved filters, H3 2FA, H4 FX, H6 reconciliation, H7 offline POS)

-- H6 — mark an account entry as reconciled to a bank statement line
ALTER TABLE "AccountEntry" ADD COLUMN "reconciledAt" TIMESTAMP(3);

-- H4 — import-purchase FX capture (books stay PKR)
ALTER TABLE "Purchase" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'PKR';
ALTER TABLE "Purchase" ADD COLUMN "fxRate" DECIMAL(18,6) NOT NULL DEFAULT 1;

-- H3 — TOTP 2FA
ALTER TABLE "User" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "totpEnabled" BOOLEAN NOT NULL DEFAULT false;

-- H7 — offline-POS idempotency key
ALTER TABLE "Sale" ADD COLUMN "clientRef" TEXT;
CREATE UNIQUE INDEX "Sale_clientRef_key" ON "Sale"("clientRef");

-- H2 — saved report filter presets (per user)
CREATE TABLE "SavedFilter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedFilter_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SavedFilter_userId_reportKey_idx" ON "SavedFilter"("userId", "reportKey");
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
