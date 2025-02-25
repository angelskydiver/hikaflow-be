-- AlterTable
ALTER TABLE "OrganizationInvitation" ADD COLUMN     "inviterId" TEXT NOT NULL DEFAULT '5058706f-b560-41bf-8bff-483514d3e9e8';

-- AddForeignKey
ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
