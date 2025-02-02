/*
  Warnings:

  - You are about to drop the column `Summary` on the `CodeOverview` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "CodeOverview" DROP COLUMN "Summary",
ADD COLUMN     "summary" JSONB NOT NULL DEFAULT '{}';
