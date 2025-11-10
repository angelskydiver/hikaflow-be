-- AlterTable
ALTER TABLE "OrganizationInvitation" ADD COLUMN     "organizationRoleId" TEXT,
ADD COLUMN     "teamId" TEXT;

-- CreateIndex
CREATE INDEX "OrganizationInvitation_teamId_idx" ON "OrganizationInvitation"("teamId");

-- CreateIndex
CREATE INDEX "OrganizationInvitation_organizationRoleId_idx" ON "OrganizationInvitation"("organizationRoleId");

-- AddForeignKey
ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_organizationRoleId_fkey" FOREIGN KEY ("organizationRoleId") REFERENCES "OrganizationRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
