-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "landedBasis" TEXT NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN     "landedUnitCost" DECIMAL(18,2);
