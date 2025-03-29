-- DropForeignKey
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_prId_fkey";

-- AlterTable
ALTER TABLE "Comment" ALTER COLUMN "prId" DROP NOT NULL,
ALTER COLUMN "prId" SET DEFAULT '';
