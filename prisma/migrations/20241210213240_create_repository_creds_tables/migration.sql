-- CreateEnum
CREATE TYPE "RepositoryProvider" AS ENUM ('1', '2');

-- CreateEnum
CREATE TYPE "AccountCredentialsType" AS ENUM ('1', '2');

-- CreateTable
CREATE TABLE "AccountCredentials" (
    "id" TEXT NOT NULL,
    "type" "AccountCredentialsType" NOT NULL DEFAULT '1',
    "value" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,

    CONSTRAINT "AccountCredentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "provider" "RepositoryProvider" NOT NULL DEFAULT '1',
    "name" TEXT NOT NULL,
    "private" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountRepository" (
    "accountId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,

    CONSTRAINT "AccountRepository_pkey" PRIMARY KEY ("accountId","repositoryId")
);

-- CreateTable
CREATE TABLE "RepoEvaluation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "accountRepositoryId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoEvaluation_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AccountCredentials" ADD CONSTRAINT "AccountCredentials_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountRepository" ADD CONSTRAINT "AccountRepository_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountRepository" ADD CONSTRAINT "AccountRepository_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoEvaluation" ADD CONSTRAINT "RepoEvaluation_accountId_repositoryId_fkey" FOREIGN KEY ("accountId", "repositoryId") REFERENCES "AccountRepository"("accountId", "repositoryId") ON DELETE RESTRICT ON UPDATE CASCADE;
