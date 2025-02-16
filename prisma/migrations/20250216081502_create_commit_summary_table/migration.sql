-- CreateTable
CREATE TABLE "commitSummary" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "commitId" TEXT NOT NULL,
    "commitMessage" TEXT NOT NULL,
    "additions" INTEGER NOT NULL,
    "deletions" INTEGER NOT NULL,
    "totalFiles" INTEGER NOT NULL,
    "committer" TEXT NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commitSummary_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "commitSummary" ADD CONSTRAINT "commitSummary_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("repositoryId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitSummary" ADD CONSTRAINT "commitSummary_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ExecutiveReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
