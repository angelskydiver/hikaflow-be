-- CreateTable
CREATE TABLE "CodeOverview" (
    "id" TEXT NOT NULL,
    "Summary" JSONB NOT NULL DEFAULT '{}',
    "repositoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeOverview_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CodeOverview" ADD CONSTRAINT "CodeOverview_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("repositoryId") ON DELETE RESTRICT ON UPDATE CASCADE;
