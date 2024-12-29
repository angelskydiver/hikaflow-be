/*
  Warnings:

  - Changed the type of `prNumber` on the `ExecutiveReport` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "ExecutiveReport" DROP COLUMN "prNumber",
ADD COLUMN     "prNumber" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "PullRequest" ALTER COLUMN "prDescription" SET DEFAULT '';
