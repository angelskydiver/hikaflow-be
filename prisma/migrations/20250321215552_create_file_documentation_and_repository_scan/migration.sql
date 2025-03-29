/*
  Warnings:

  - The `fileType` column on the `FileDocumentation` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `RepositoryScan` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('PROJECT_SETUP', 'CONTROLLER', 'SERVICE', 'SCHEMA', 'MIGRATION', 'REPOSITORY', 'CONFIG', 'CONSTANTS', 'MIDDLEWARE', 'UTILITY', 'JOB', 'MODULE', 'ASSETS', 'DOCUMENTATION', 'TEST', 'EVENT_HANDLER', 'LOGGING');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "FileDocumentation" DROP COLUMN "fileType",
ADD COLUMN     "fileType" "FileType"[];

-- AlterTable
ALTER TABLE "RepositoryScan" DROP COLUMN "status",
ADD COLUMN     "status" "ScanStatus" NOT NULL DEFAULT 'PENDING';
