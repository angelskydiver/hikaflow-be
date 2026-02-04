/*
  Warnings:

  - A unique constraint covering the columns `[commitId]` on the table `RegressionReport` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[impactAnalysisReportId]` on the table `commitSummary` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "RegressionReport" ADD COLUMN     "analysisType" TEXT NOT NULL DEFAULT 'PR',
ADD COLUMN     "commitId" TEXT,
ADD COLUMN     "commitSha" TEXT,
ALTER COLUMN "prNumber" DROP NOT NULL;

-- AlterTable
ALTER TABLE "commitSummary" ADD COLUMN     "impactAnalysisReportId" TEXT,
ADD COLUMN     "impactAnalysisStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RegressionReport_commitId_key" ON "RegressionReport"("commitId");

-- CreateIndex
CREATE INDEX "RegressionReport_commitSha_idx" ON "RegressionReport"("commitSha");

-- CreateIndex
CREATE INDEX "RegressionReport_commitId_idx" ON "RegressionReport"("commitId");

-- CreateIndex
CREATE INDEX "RegressionReport_prNumber_idx" ON "RegressionReport"("prNumber");

-- CreateIndex
CREATE UNIQUE INDEX "commitSummary_impactAnalysisReportId_key" ON "commitSummary"("impactAnalysisReportId");

-- CreateIndex
CREATE INDEX "commitSummary_impactAnalysisReportId_idx" ON "commitSummary"("impactAnalysisReportId");

-- AddForeignKey
ALTER TABLE "commitSummary" ADD CONSTRAINT "commitSummary_impactAnalysisReportId_fkey" FOREIGN KEY ("impactAnalysisReportId") REFERENCES "RegressionReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegressionReport" ADD CONSTRAINT "RegressionReport_commitId_fkey" FOREIGN KEY ("commitId") REFERENCES "commitSummary"("id") ON DELETE SET NULL ON UPDATE CASCADE;
