-- AlterTable
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "FileDocumentation" ADD COLUMN     "summaryEmbedding" vector(768);
