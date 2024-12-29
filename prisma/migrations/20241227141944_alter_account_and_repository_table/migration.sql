-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "baseBranch" TEXT NOT NULL DEFAULT 'main';
