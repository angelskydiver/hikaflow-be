-- DropForeignKey
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_repositoryId_fkey";

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("repositoryId") ON DELETE RESTRICT ON UPDATE CASCADE;
