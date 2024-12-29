-- CreateEnum
CREATE TYPE "UserLoginType" AS ENUM ('1', '2');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "loginType" "UserLoginType" NOT NULL DEFAULT '1';
