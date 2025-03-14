-- DropForeignKey
ALTER TABLE "DuplicatedCode" DROP CONSTRAINT "DuplicatedCode_repositoryId_fkey";

-- AddForeignKey
ALTER TABLE "DuplicatedCode" ADD CONSTRAINT "DuplicatedCode_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
