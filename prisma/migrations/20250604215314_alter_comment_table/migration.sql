-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "affectedCodeBlock" JSONB DEFAULT '{}',
ADD COLUMN     "enhancementType" TEXT,
ADD COLUMN     "improvedCodeBlock" JSONB DEFAULT '{}',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
