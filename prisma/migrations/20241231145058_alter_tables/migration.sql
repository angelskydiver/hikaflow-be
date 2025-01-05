-- CreateEnum
CREATE TYPE "UserLoginType" AS ENUM ('1', '2');

-- CreateEnum
CREATE TYPE "RepositoryProvider" AS ENUM ('1', '2');

-- CreateEnum
CREATE TYPE "AccountCredentialsType" AS ENUM ('1', '2');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "loginType" "UserLoginType" NOT NULL DEFAULT '1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "subscribedPlanType" INTEGER NOT NULL DEFAULT 1,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountCredentials" (
    "id" TEXT NOT NULL,
    "type" "AccountCredentialsType" NOT NULL DEFAULT '1',
    "value" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,

    CONSTRAINT "AccountCredentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "provider" "RepositoryProvider" NOT NULL DEFAULT '1',
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL DEFAULT 'mudassir693',
    "baseBranch" TEXT NOT NULL DEFAULT 'main',
    "private" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "response" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "prUrl" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "prTitle" TEXT NOT NULL,
    "prDescription" TEXT NOT NULL DEFAULT '',
    "head" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "file" TEXT NOT NULL,
    "issue" TEXT NOT NULL,
    "issueCategory" TEXT NOT NULL DEFAULT 'CodeSmells',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutiveReport" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ExecutiveReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_userId_key" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationCode_code_key" ON "VerificationCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_repositoryId_key" ON "Repository"("repositoryId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountCredentials" ADD CONSTRAINT "AccountCredentials_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountRepository" ADD CONSTRAINT "AccountRepository_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountRepository" ADD CONSTRAINT "AccountRepository_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoEvaluation" ADD CONSTRAINT "RepoEvaluation_accountId_repositoryId_fkey" FOREIGN KEY ("accountId", "repositoryId") REFERENCES "AccountRepository"("accountId", "repositoryId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("repositoryId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PullRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutiveReport" ADD CONSTRAINT "ExecutiveReport_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
