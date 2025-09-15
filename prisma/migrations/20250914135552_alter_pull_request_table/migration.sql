-- AlterTable
ALTER TABLE "PullRequest" ADD COLUMN     "contextualPrompt" TEXT DEFAULT '',
ADD COLUMN     "copyPasteCode" TEXT DEFAULT '',
ADD COLUMN     "expectedSolution" TEXT DEFAULT '';
