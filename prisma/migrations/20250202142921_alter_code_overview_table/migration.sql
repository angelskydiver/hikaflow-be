-- AlterTable
ALTER TABLE "CodeOverview" ADD COLUMN     "reportId" TEXT NOT NULL DEFAULT '';

-- AddForeignKey
ALTER TABLE "CodeOverview" ADD CONSTRAINT "CodeOverview_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ExecutiveReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
