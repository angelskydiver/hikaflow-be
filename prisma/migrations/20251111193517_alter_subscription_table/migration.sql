-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "nextPricingPlanId" TEXT;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_nextPricingPlanId_fkey" FOREIGN KEY ("nextPricingPlanId") REFERENCES "PricingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
