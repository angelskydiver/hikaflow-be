-- AlterTable
ALTER TABLE "PricingPlan" ADD COLUMN     "assistantQuota" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "prAnalysisQuota" INTEGER NOT NULL DEFAULT 20;
