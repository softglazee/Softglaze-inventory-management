-- AlterEnum
ALTER TYPE "MessageChannel" ADD VALUE 'SMS';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "email" TEXT,
ADD COLUMN     "lastReminderAt" TIMESTAMP(3),
ADD COLUMN     "reminderTier" INTEGER NOT NULL DEFAULT 0;
