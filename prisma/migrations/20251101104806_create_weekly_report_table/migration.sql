-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('CONTRIBUTOR', 'TEAM', 'PROJECT', 'ORGANIZATION');

-- CreateTable
CREATE TABLE "WeeklyReport" (
    "id" TEXT NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT,
    "teamId" TEXT,
    "accountId" TEXT,
    "repositoryId" TEXT,
    "collaboratorId" TEXT,
    "reportData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyReport_organizationId_periodStart_periodEnd_idx" ON "WeeklyReport"("organizationId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "WeeklyReport_teamId_periodStart_periodEnd_idx" ON "WeeklyReport"("teamId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "WeeklyReport_accountId_periodStart_periodEnd_idx" ON "WeeklyReport"("accountId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "WeeklyReport_repositoryId_periodStart_periodEnd_idx" ON "WeeklyReport"("repositoryId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "WeeklyReport_reportType_periodStart_idx" ON "WeeklyReport"("reportType", "periodStart");

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
