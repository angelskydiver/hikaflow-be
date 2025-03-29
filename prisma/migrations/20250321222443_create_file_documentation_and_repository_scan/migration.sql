/*
  Warnings:

  - The `fileType` column on the `FileDocumentation` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "FileDocumentation" DROP COLUMN "fileType",
ADD COLUMN     "fileType" TEXT[];
