-- AlterTable
ALTER TABLE "DeliveryNote" ADD COLUMN     "tripId" TEXT;

-- CreateTable
CREATE TABLE "DeliveryTrip" (
    "id" TEXT NOT NULL,
    "refNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vehicleNo" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "customerId" TEXT,
    "freightCharged" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "freightPaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "expenseId" TEXT,
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryTrip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryTrip_refNo_key" ON "DeliveryTrip"("refNo");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryTrip_expenseId_key" ON "DeliveryTrip"("expenseId");

-- CreateIndex
CREATE INDEX "DeliveryTrip_date_idx" ON "DeliveryTrip"("date");

-- CreateIndex
CREATE INDEX "DeliveryTrip_customerId_idx" ON "DeliveryTrip"("customerId");

-- CreateIndex
CREATE INDEX "DeliveryNote_tripId_idx" ON "DeliveryNote"("tripId");

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "DeliveryTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTrip" ADD CONSTRAINT "DeliveryTrip_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTrip" ADD CONSTRAINT "DeliveryTrip_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTrip" ADD CONSTRAINT "DeliveryTrip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
