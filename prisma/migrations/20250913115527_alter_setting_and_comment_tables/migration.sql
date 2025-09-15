-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "ignoreReason" TEXT,
ADD COLUMN     "isIgnored" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RepositorySettings" ADD COLUMN     "customPrompt" TEXT;

-- CreateIndex
CREATE INDEX "Comment_isIgnored_idx" ON "Comment"("isIgnored");
