-- CreateTable
CREATE TABLE "Collaborator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "githubUsername" TEXT,
    "bitbucketUsername" TEXT,
    "performanceGains" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "codeFootprintReduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refactorQuality" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cleanDiffRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "criticalModuleImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "speedToDeploy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errorRateReduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "firstTimeRight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ownershipClarity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "internalDocumentation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CollaboratorToOrganization" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CollaboratorToOrganization_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_CollaboratorToRepository" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CollaboratorToRepository_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CollaboratorToOrganization_B_index" ON "_CollaboratorToOrganization"("B");

-- CreateIndex
CREATE INDEX "_CollaboratorToRepository_B_index" ON "_CollaboratorToRepository"("B");

-- AddForeignKey
ALTER TABLE "_CollaboratorToOrganization" ADD CONSTRAINT "_CollaboratorToOrganization_A_fkey" FOREIGN KEY ("A") REFERENCES "Collaborator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CollaboratorToOrganization" ADD CONSTRAINT "_CollaboratorToOrganization_B_fkey" FOREIGN KEY ("B") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CollaboratorToRepository" ADD CONSTRAINT "_CollaboratorToRepository_A_fkey" FOREIGN KEY ("A") REFERENCES "Collaborator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CollaboratorToRepository" ADD CONSTRAINT "_CollaboratorToRepository_B_fkey" FOREIGN KEY ("B") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
