/*
  Warnings:

  - A unique constraint covering the columns `[repositoryId]` on the table `Repository` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "PullRequest" DROP CONSTRAINT "PullRequest_repositoryId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "Repository_repositoryId_key" ON "Repository"("repositoryId");

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("repositoryId") ON DELETE RESTRICT ON UPDATE CASCADE;
