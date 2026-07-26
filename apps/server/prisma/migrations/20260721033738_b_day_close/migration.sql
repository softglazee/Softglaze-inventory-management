-- CreateTable
CREATE TABLE "DayClose" (
    "id" TEXT NOT NULL,
    "refNo" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "openingFloat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "expectedCash" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "countedCash" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "variance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cashIn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cashOut" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "denominations" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DayClose_refNo_key" ON "DayClose"("refNo");

-- CreateIndex
CREATE INDEX "DayClose_businessDate_idx" ON "DayClose"("businessDate");

-- AddForeignKey
ALTER TABLE "DayClose" ADD CONSTRAINT "DayClose_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
