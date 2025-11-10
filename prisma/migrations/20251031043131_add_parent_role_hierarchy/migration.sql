-- AlterTable
ALTER TABLE "TeamRole" ADD COLUMN     "parentRoleId" TEXT;

-- CreateIndex
CREATE INDEX "TeamRole_parentRoleId_idx" ON "TeamRole"("parentRoleId");

-- AddForeignKey
ALTER TABLE "TeamRole" ADD CONSTRAINT "TeamRole_parentRoleId_fkey" FOREIGN KEY ("parentRoleId") REFERENCES "TeamRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
