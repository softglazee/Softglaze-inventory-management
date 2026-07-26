-- CreateEnum
CREATE TYPE "CutOutputKind" AS ENUM ('PIECE', 'OFFCUT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMoveType" ADD VALUE 'CUT_OUT';
ALTER TYPE "StockMoveType" ADD VALUE 'CUT_IN';

-- CreateTable
CREATE TABLE "CuttingJob" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceProductId" TEXT NOT NULL,
    "sourceQty" DECIMAL(18,3) NOT NULL,
    "sourceUnitCost" DECIMAL(18,2) NOT NULL,
    "wastageQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuttingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuttingOutput" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "CutOutputKind" NOT NULL DEFAULT 'PIECE',
    "qty" DECIMAL(18,3) NOT NULL,
    "lengthFt" DECIMAL(10,2),
    "unitCost" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "CuttingOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CuttingJob_number_key" ON "CuttingJob"("number");

-- CreateIndex
CREATE INDEX "CuttingJob_date_idx" ON "CuttingJob"("date");

-- AddForeignKey
ALTER TABLE "CuttingJob" ADD CONSTRAINT "CuttingJob_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuttingJob" ADD CONSTRAINT "CuttingJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuttingOutput" ADD CONSTRAINT "CuttingOutput_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CuttingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuttingOutput" ADD CONSTRAINT "CuttingOutput_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
