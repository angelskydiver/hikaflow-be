-- CreateEnum
CREATE TYPE "PrTrackerStatus" AS ENUM ('1', '2', '3');

-- CreateTable
CREATE TABLE "PrTracker" (
    "id" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "status" "PrTrackerStatus" NOT NULL DEFAULT '1',
    "try" INTEGER NOT NULL DEFAULT 1,
    "response" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrTracker_pkey" PRIMARY KEY ("id")
);
