-- DropForeignKey
ALTER TABLE "commitSummary" DROP CONSTRAINT "commitSummary_reportId_fkey";

-- AlterTable
ALTER TABLE "commitSummary" ADD COLUMN     "branchName" TEXT,
ADD COLUMN     "commitUrl" TEXT,
ADD COLUMN     "isMerged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "moduleChanges" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "parentCommitId" TEXT,
ALTER COLUMN "reportId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "commitSummary" ADD CONSTRAINT "commitSummary_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ExecutiveReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
