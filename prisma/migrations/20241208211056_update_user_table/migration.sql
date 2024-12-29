-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "loginType" "UserLoginType" NOT NULL DEFAULT '1';
