# Phase 1 Migration SQL

## Migration: add_commit_impact_analysis

This migration adds support for commit impact analysis by:
1. Making `prNumber` nullable in `RegressionReport`
2. Adding new fields for commit-based analysis
3. Adding indexes for performance
4. Adding relations between models

## SQL to Execute

```sql
-- AlterTable: Make prNumber nullable
ALTER TABLE "RegressionReport" ALTER COLUMN "prNumber" DROP NOT NULL;

-- AlterTable: Add new columns to RegressionReport
ALTER TABLE "RegressionReport" 
  ADD COLUMN "commitId" TEXT,
  ADD COLUMN "commitSha" TEXT,
  ADD COLUMN "analysisType" TEXT NOT NULL DEFAULT 'PR';

-- AlterTable: Add new columns to commitSummary
ALTER TABLE "commitSummary" 
  ADD COLUMN "impactAnalysisReportId" TEXT,
  ADD COLUMN "impactAnalysisStatus" TEXT;

-- CreateIndex: Add unique constraint and index for commitId
CREATE UNIQUE INDEX "RegressionReport_commitId_key" ON "RegressionReport"("commitId") WHERE "commitId" IS NOT NULL;

-- CreateIndex: Add unique constraint and index for impactAnalysisReportId
CREATE UNIQUE INDEX "commitSummary_impactAnalysisReportId_key" ON "commitSummary"("impactAnalysisReportId") WHERE "impactAnalysisReportId" IS NOT NULL;

-- CreateIndex: Add indexes for lookups
CREATE INDEX "RegressionReport_commitSha_idx" ON "RegressionReport"("commitSha");
CREATE INDEX "RegressionReport_commitId_idx" ON "RegressionReport"("commitId");
CREATE INDEX "commitSummary_impactAnalysisReportId_idx" ON "commitSummary"("impactAnalysisReportId");

-- AddForeignKey: Link RegressionReport.commitId to commitSummary.id
ALTER TABLE "RegressionReport" 
  ADD CONSTRAINT "RegressionReport_commitId_fkey" 
  FOREIGN KEY ("commitId") 
  REFERENCES "commitSummary"("id") 
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Link commitSummary.impactAnalysisReportId to RegressionReport.id
ALTER TABLE "commitSummary" 
  ADD CONSTRAINT "commitSummary_impactAnalysisReportId_fkey" 
  FOREIGN KEY ("impactAnalysisReportId") 
  REFERENCES "RegressionReport"("id") 
  ON DELETE SET NULL ON UPDATE CASCADE;
```

## Safety Notes

✅ **All operations are safe:**
- New columns are nullable (existing rows get NULL)
- `analysisType` has default 'PR' (existing rows get 'PR')
- `prNumber` becomes nullable but existing rows keep their values
- Unique constraints only apply to non-NULL values
- Foreign keys are optional (ON DELETE SET NULL)

⚠️ **Warnings (expected and safe):**
- Unique constraints will be added - this is safe because:
  - `commitId` is new (all existing rows have NULL)
  - `impactAnalysisReportId` is new (all existing rows have NULL)
  - Unique constraints only apply to non-NULL values in PostgreSQL

## How to Apply

### Option 1: Interactive Migration (Recommended)
```bash
cd backend/codedeno-server
npx prisma migrate dev --name add_commit_impact_analysis
```
This will:
1. Create the migration file
2. Apply it to your database
3. Generate Prisma client

### Option 2: Manual Review First
1. Review the SQL above
2. Run the migration interactively
3. Verify the changes

### Option 3: Production Deployment
```bash
# Create migration file only (for review)
npx prisma migrate dev --name add_commit_impact_analysis --create-only

# Review the generated SQL in:
# prisma/migrations/[timestamp]_add_commit_impact_analysis/migration.sql

# Then apply in production:
npx prisma migrate deploy
```

## Verification After Migration

```sql
-- Check new columns exist
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'RegressionReport' 
  AND column_name IN ('prNumber', 'commitId', 'commitSha', 'analysisType');

-- Check existing data
SELECT 
  COUNT(*) as total_reports,
  COUNT(prNumber) as reports_with_pr,
  COUNT(commitSha) as reports_with_commit,
  COUNT(CASE WHEN analysisType = 'PR' THEN 1 END) as pr_reports
FROM "RegressionReport";

-- Should show:
-- total_reports: X (existing count)
-- reports_with_pr: X (all existing have prNumber)
-- reports_with_commit: 0 (none yet)
-- pr_reports: X (all existing are PR type)
```

## Rollback (If Needed)

```sql
-- Remove foreign keys
ALTER TABLE "RegressionReport" DROP CONSTRAINT IF EXISTS "RegressionReport_commitId_fkey";
ALTER TABLE "commitSummary" DROP CONSTRAINT IF EXISTS "commitSummary_impactAnalysisReportId_fkey";

-- Remove indexes
DROP INDEX IF EXISTS "RegressionReport_commitSha_idx";
DROP INDEX IF EXISTS "RegressionReport_commitId_idx";
DROP INDEX IF EXISTS "RegressionReport_commitId_key";
DROP INDEX IF EXISTS "commitSummary_impactAnalysisReportId_idx";
DROP INDEX IF EXISTS "commitSummary_impactAnalysisReportId_key";

-- Remove columns
ALTER TABLE "RegressionReport" 
  DROP COLUMN IF EXISTS "commitId",
  DROP COLUMN IF EXISTS "commitSha",
  DROP COLUMN IF EXISTS "analysisType";

ALTER TABLE "commitSummary" 
  DROP COLUMN IF EXISTS "impactAnalysisReportId",
  DROP COLUMN IF EXISTS "impactAnalysisStatus";

-- Restore prNumber to NOT NULL (only if no NULL values exist)
-- ALTER TABLE "RegressionReport" ALTER COLUMN "prNumber" SET NOT NULL;
```
