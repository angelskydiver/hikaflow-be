-- CreateEnum
CREATE TYPE "CommentSeverity" AS ENUM ('1', '2', '3');

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "severity" "CommentSeverity" NOT NULL DEFAULT '1';
