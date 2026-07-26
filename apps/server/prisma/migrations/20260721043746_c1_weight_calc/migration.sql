-- CreateEnum
CREATE TYPE "WeightCalc" AS ENUM ('NONE', 'ROD', 'SHEET');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "densityKgM3" DECIMAL(10,2),
ADD COLUMN     "diameterMm" DECIMAL(10,3),
ADD COLUMN     "pieceLengthFt" DECIMAL(10,3),
ADD COLUMN     "sheetWidthFt" DECIMAL(10,3),
ADD COLUMN     "thicknessMm" DECIMAL(10,3),
ADD COLUMN     "weightCalc" "WeightCalc" NOT NULL DEFAULT 'NONE';
