-- CreateTable
CREATE TABLE "git_contributor_names" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "git_contributor_names_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "git_contributor_names_accountId_name_key" ON "git_contributor_names"("accountId", "name");

-- AddForeignKey
ALTER TABLE "git_contributor_names" ADD CONSTRAINT "git_contributor_names_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
