-- CreateTable
CREATE TABLE "RateContract" (
    "id" TEXT NOT NULL,
    "refNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateContractItem" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "RateContractItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RateContract_refNo_key" ON "RateContract"("refNo");

-- CreateIndex
CREATE INDEX "RateContract_customerId_idx" ON "RateContract"("customerId");

-- CreateIndex
CREATE INDEX "RateContract_validFrom_validUntil_idx" ON "RateContract"("validFrom", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "RateContractItem_contractId_productId_key" ON "RateContractItem"("contractId", "productId");

-- AddForeignKey
ALTER TABLE "RateContract" ADD CONSTRAINT "RateContract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateContractItem" ADD CONSTRAINT "RateContractItem_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "RateContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateContractItem" ADD CONSTRAINT "RateContractItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
