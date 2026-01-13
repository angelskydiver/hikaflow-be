-- CreateEnum
CREATE TYPE "PricingModelType" AS ENUM ('USER_BASED', 'PROJECT_BASED');

-- AlterTable
ALTER TABLE "PricingPlan" ADD COLUMN     "pricingModelType" "PricingModelType" NOT NULL DEFAULT 'USER_BASED',
ADD COLUMN     "projectBasePrice" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "customProjectPrice" DOUBLE PRECISION,
ADD COLUMN     "pricingModelType" "PricingModelType" NOT NULL DEFAULT 'USER_BASED';
