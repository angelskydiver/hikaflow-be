/*
  Warnings:

  - You are about to drop the column `organizationId` on the `AssistedQuestions` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "FileDocumentationType" AS ENUM ('COMPONENT', 'UTILITY', 'CONFIG', 'CONTENT', 'DOCUMENTATION', 'TEST', 'UNKNOWN');

-- DropForeignKey
ALTER TABLE "AssistedQuestions" DROP CONSTRAINT "AssistedQuestions_accountId_fkey";

-- DropForeignKey
ALTER TABLE "AssistedQuestions" DROP CONSTRAINT "AssistedQuestions_scanId_fkey";

-- AlterTable
ALTER TABLE "AssistedQuestions" DROP COLUMN "organizationId",
ADD COLUMN     "repositoryScanId" TEXT,
ALTER COLUMN "accountId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "RegressionReport" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "impactedFlows" JSONB NOT NULL,
    "changedBehavior" JSONB NOT NULL,
    "potentialBreakages" JSONB NOT NULL,
    "testCases" JSONB NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegressionReport_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AssistedQuestions" ADD CONSTRAINT "AssistedQuestions_repositoryScanId_fkey" FOREIGN KEY ("repositoryScanId") REFERENCES "RepositoryScan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegressionReport" ADD CONSTRAINT "RegressionReport_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegressionReport" ADD CONSTRAINT "RegressionReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
