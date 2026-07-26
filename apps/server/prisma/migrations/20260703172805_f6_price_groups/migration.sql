-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "priceGroupId" TEXT;

-- CreateTable
CREATE TABLE "PriceGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceGroupItem" (
    "id" TEXT NOT NULL,
    "priceGroupId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PriceGroupItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceGroup_name_key" ON "PriceGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PriceGroupItem_priceGroupId_productId_key" ON "PriceGroupItem"("priceGroupId", "productId");

-- CreateIndex
CREATE INDEX "Customer_priceGroupId_idx" ON "Customer"("priceGroupId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_priceGroupId_fkey" FOREIGN KEY ("priceGroupId") REFERENCES "PriceGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceGroupItem" ADD CONSTRAINT "PriceGroupItem_priceGroupId_fkey" FOREIGN KEY ("priceGroupId") REFERENCES "PriceGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceGroupItem" ADD CONSTRAINT "PriceGroupItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
