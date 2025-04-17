-- AlterTable
ALTER TABLE "AssistedQuestions" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "Researcher" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "accountId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Researcher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchAssistant" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "summary" TEXT DEFAULT '',
    "model" TEXT NOT NULL,
    "inputToken" BIGINT NOT NULL,
    "outputToken" BIGINT NOT NULL,
    "accountId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "researcherId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchAssistant_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Researcher" ADD CONSTRAINT "Researcher_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Researcher" ADD CONSTRAINT "Researcher_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Researcher" ADD CONSTRAINT "Researcher_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchAssistant" ADD CONSTRAINT "ResearchAssistant_researcherId_fkey" FOREIGN KEY ("researcherId") REFERENCES "Researcher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchAssistant" ADD CONSTRAINT "ResearchAssistant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchAssistant" ADD CONSTRAINT "ResearchAssistant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
