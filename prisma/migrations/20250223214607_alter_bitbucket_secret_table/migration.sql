/*
  Warnings:

  - You are about to drop the column `bitbucketSecretId` on the `AccountCredentials` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AccountCredentials" DROP COLUMN "bitbucketSecretId",
ADD COLUMN     "bitbucketSecret" JSONB DEFAULT '{}';
