-- AddForeignKey
ALTER TABLE "ExecutiveReport" ADD CONSTRAINT "ExecutiveReport_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("repositoryId") ON DELETE RESTRICT ON UPDATE CASCADE;
