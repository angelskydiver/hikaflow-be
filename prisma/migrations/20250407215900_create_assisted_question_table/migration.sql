-- CreateTable
CREATE TABLE "AssistedQuestions" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" JSONB NOT NULL DEFAULT '{}',
    "repositoryId" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "tokenUtilized" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistedQuestions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AssistedQuestions" ADD CONSTRAINT "AssistedQuestions_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistedQuestions" ADD CONSTRAINT "AssistedQuestions_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "RepositoryScan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
