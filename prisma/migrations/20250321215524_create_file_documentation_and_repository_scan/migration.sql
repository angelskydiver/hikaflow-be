-- CreateTable
CREATE TABLE "FileDocumentation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullPath" TEXT NOT NULL,
    "imports" TEXT[],
    "exports" TEXT[],
    "functions" JSONB NOT NULL,
    "classes" JSONB NOT NULL,
    "fileType" TEXT[],
    "summary" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "repositoryScanId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileDocumentation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryScan" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "tokenUsed" INTEGER NOT NULL DEFAULT 0,
    "totalFilesScanned" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "logs" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryScan_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "FileDocumentation" ADD CONSTRAINT "FileDocumentation_repositoryScanId_fkey" FOREIGN KEY ("repositoryScanId") REFERENCES "RepositoryScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileDocumentation" ADD CONSTRAINT "FileDocumentation_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryScan" ADD CONSTRAINT "RepositoryScan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryScan" ADD CONSTRAINT "RepositoryScan_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
