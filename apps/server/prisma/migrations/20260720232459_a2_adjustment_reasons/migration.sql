-- CreateEnum
CREATE TYPE "AdjustmentReason" AS ENUM ('COUNT_CORRECTION', 'BREAKAGE', 'THEFT', 'SAMPLE', 'WASTAGE', 'EXPIRY', 'FOUND', 'OTHER');

-- AlterTable
ALTER TABLE "StockAdjustment" ADD COLUMN     "reasonCode" "AdjustmentReason" NOT NULL DEFAULT 'COUNT_CORRECTION';

-- CreateIndex
CREATE INDEX "StockAdjustment_reasonCode_idx" ON "StockAdjustment"("reasonCode");
