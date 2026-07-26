-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "siteId" TEXT;

-- CreateTable
CREATE TABLE "CustomerSite" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerSite_customerId_idx" ON "CustomerSite"("customerId");

-- CreateIndex
CREATE INDEX "Payment_siteId_idx" ON "Payment"("siteId");

-- CreateIndex
CREATE INDEX "Sale_siteId_idx" ON "Sale"("siteId");

-- AddForeignKey
ALTER TABLE "CustomerSite" ADD CONSTRAINT "CustomerSite_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "CustomerSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "CustomerSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
