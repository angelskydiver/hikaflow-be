-- CreateEnum
CREATE TYPE "CommentType" AS ENUM ('-', '1', '2');

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "type" "CommentType" NOT NULL DEFAULT '-';
