-- AlterTable
ALTER TABLE "AccountRepository" ADD COLUMN     "organizationId" TEXT;

-- AddForeignKey
ALTER TABLE "AccountRepository" ADD CONSTRAINT "AccountRepository_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
