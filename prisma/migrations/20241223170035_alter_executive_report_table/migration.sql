/*
  Warnings:

  - You are about to drop the column `prId` on the `ExecutiveReport` table. All the data in the column will be lost.
  - Added the required column `prNumber` to the `ExecutiveReport` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ExecutiveReport" DROP COLUMN "prId",
ADD COLUMN     "prNumber" TEXT NOT NULL;
