-- DropForeignKey
ALTER TABLE "VerificationCode" DROP CONSTRAINT "VerificationCode_accountId_fkey";

-- DropIndex
DROP INDEX "VerificationCode_accountId_key";
