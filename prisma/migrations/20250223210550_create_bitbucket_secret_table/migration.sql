-- AlterTable
ALTER TABLE "AccountCredentials" ADD COLUMN     "bitbucketSecretId" JSONB DEFAULT '{}';

-- CreateTable
CREATE TABLE "bitbucketSecret" (
    "id" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bitbucketSecret_pkey" PRIMARY KEY ("id")
);
