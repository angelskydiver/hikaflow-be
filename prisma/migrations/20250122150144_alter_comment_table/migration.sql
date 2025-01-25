-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('1', '2', '3');

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "status" "CommentStatus" NOT NULL DEFAULT '1';
