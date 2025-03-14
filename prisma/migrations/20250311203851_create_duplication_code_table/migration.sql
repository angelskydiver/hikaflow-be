-- CreateEnum
CREATE TYPE "DuplicateCode" AS ENUM ('DUPLICATE', 'IDENTICAL_CODE');

-- CreateTable
CREATE TABLE "DuplicatedCode" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "duplicateOf" JSONB NOT NULL DEFAULT '{}',
    "prId" TEXT NOT NULL,
    "type" "DuplicateCode" NOT NULL DEFAULT 'DUPLICATE',

    CONSTRAINT "DuplicatedCode_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DuplicatedCode" ADD CONSTRAINT "DuplicatedCode_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("repositoryId") ON DELETE RESTRICT ON UPDATE CASCADE;
