-- Recovery Script for Failed Migration
-- Run this in production database to complete the migration manually
-- Check each step before running to ensure it's safe

-- ============================================
-- STEP 1: Check Current State
-- ============================================
-- Run these queries first to see what's already done:

-- Check if OrganizationRole table exists
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name = 'OrganizationRole'
) as "OrganizationRole_exists";

-- Check if TeamRole table still exists
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name = 'TeamRole'
) as "TeamRole_exists";

-- Check TeamMember table structure
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'TeamMember'
AND column_name IN ('teamRoleId', 'organizationRoleId');

-- Count records
SELECT 
    (SELECT COUNT(*) FROM "TeamMember") as "TeamMember_count",
    (SELECT COUNT(*) FROM "TeamRole") as "TeamRole_count",
    (SELECT COUNT(*) FROM "OrganizationRole") as "OrganizationRole_count";

-- ============================================
-- STEP 2: Complete Migration Based on State
-- ============================================

-- If OrganizationRole doesn't exist, create it
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'OrganizationRole'
    ) THEN
        CREATE TABLE "OrganizationRole" (
            "id" TEXT NOT NULL,
            "organizationId" TEXT NOT NULL,
            "name" TEXT NOT NULL,
            "rank" INTEGER NOT NULL,
            "parentRoleId" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            CONSTRAINT "OrganizationRole_pkey" PRIMARY KEY ("id")
        );
    END IF;
END $$;

-- Migrate TeamRole data if it exists and OrganizationRole is empty
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'TeamRole')
       AND EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'OrganizationRole')
       AND NOT EXISTS (SELECT FROM "OrganizationRole")
       AND EXISTS (SELECT FROM "TeamRole") THEN
        
        INSERT INTO "OrganizationRole" ("id", "organizationId", "name", "rank", "parentRoleId", "createdAt", "updatedAt")
        SELECT 
            gen_random_uuid()::TEXT as "id",
            t."organizationId",
            tr."name",
            MIN(tr."rank") as "rank",
            NULL as "parentRoleId",
            MIN(tr."createdAt") as "createdAt",
            MAX(tr."updatedAt") as "updatedAt"
        FROM "TeamRole" tr
        INNER JOIN "Team" t ON tr."teamId" = t."id"
        GROUP BY t."organizationId", tr."name";
        
        -- Update parentRoleId relationships
        UPDATE "OrganizationRole" org_role1
        SET "parentRoleId" = org_role2."id"
        FROM "TeamRole" tr1
        INNER JOIN "Team" t1 ON tr1."teamId" = t1."id"
        INNER JOIN "TeamRole" tr2 ON tr1."parentRoleId" = tr2."id"
        INNER JOIN "Team" t2 ON tr2."teamId" = t2."id"
        INNER JOIN "OrganizationRole" org_role2 ON org_role2."organizationId" = t2."organizationId" AND org_role2."name" = tr2."name"
        WHERE org_role1."organizationId" = t1."organizationId" 
          AND org_role1."name" = tr1."name"
          AND tr1."parentRoleId" IS NOT NULL;
    END IF;
END $$;

-- Add organizationRoleId column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'TeamMember' 
        AND column_name = 'organizationRoleId'
    ) THEN
        ALTER TABLE "TeamMember" ADD COLUMN "organizationRoleId" TEXT;
    END IF;
END $$;

-- Populate organizationRoleId for existing TeamMember records
UPDATE "TeamMember" tm
SET "organizationRoleId" = org_role."id"
FROM "TeamRole" tr
INNER JOIN "Team" t ON tr."teamId" = t."id"
INNER JOIN "OrganizationRole" org_role ON org_role."organizationId" = t."organizationId" AND org_role."name" = tr."name"
WHERE tm."teamRoleId" = tr."id"
  AND tm."organizationRoleId" IS NULL;

-- Handle orphaned records
DO $$
DECLARE
    member_record RECORD;
    default_role_id TEXT;
    org_id TEXT;
BEGIN
    FOR member_record IN 
        SELECT DISTINCT tm."id", t."organizationId"
        FROM "TeamMember" tm
        INNER JOIN "Team" t ON tm."teamId" = t."id"
        WHERE tm."organizationRoleId" IS NULL
    LOOP
        org_id := member_record."organizationId";
        SELECT "id" INTO default_role_id
        FROM "OrganizationRole"
        WHERE "organizationId" = org_id AND "name" = 'Default Role'
        LIMIT 1;
        
        IF default_role_id IS NULL THEN
            INSERT INTO "OrganizationRole" ("id", "organizationId", "name", "rank", "createdAt", "updatedAt")
            VALUES (gen_random_uuid()::TEXT, org_id, 'Default Role', 999, NOW(), NOW())
            RETURNING "id" INTO default_role_id;
        END IF;
        
        UPDATE "TeamMember"
        SET "organizationRoleId" = default_role_id
        WHERE "id" = member_record."id" AND "organizationRoleId" IS NULL;
    END LOOP;
END $$;

-- Verify no nulls before making NOT NULL
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "TeamMember" WHERE "organizationRoleId" IS NULL) THEN
        RAISE EXCEPTION 'Cannot proceed: null values still exist in TeamMember.organizationRoleId';
    END IF;
END $$;

-- Drop old constraints if they exist
ALTER TABLE "TeamMember" DROP CONSTRAINT IF EXISTS "TeamMember_teamRoleId_fkey";
DROP INDEX IF EXISTS "TeamMember_teamRoleId_idx";

-- Make organizationRoleId NOT NULL (only if column exists and has no nulls)
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'TeamMember' 
        AND column_name = 'organizationRoleId'
        AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE "TeamMember" ALTER COLUMN "organizationRoleId" SET NOT NULL;
    END IF;
END $$;

-- Drop teamRoleId column if it still exists
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'TeamMember' 
        AND column_name = 'teamRoleId'
    ) THEN
        ALTER TABLE "TeamMember" DROP COLUMN "teamRoleId";
    END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS "OrganizationRole_organizationId_rank_idx" ON "OrganizationRole"("organizationId", "rank");
CREATE INDEX IF NOT EXISTS "OrganizationRole_parentRoleId_idx" ON "OrganizationRole"("parentRoleId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationRole_organizationId_name_key" ON "OrganizationRole"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "TeamMember_organizationRoleId_idx" ON "TeamMember"("organizationRoleId");

-- Add foreign keys if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.table_constraints 
        WHERE constraint_name = 'OrganizationRole_organizationId_fkey'
    ) THEN
        ALTER TABLE "OrganizationRole" 
        ADD CONSTRAINT "OrganizationRole_organizationId_fkey" 
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT FROM information_schema.table_constraints 
        WHERE constraint_name = 'OrganizationRole_parentRoleId_fkey'
    ) THEN
        ALTER TABLE "OrganizationRole" 
        ADD CONSTRAINT "OrganizationRole_parentRoleId_fkey" 
        FOREIGN KEY ("parentRoleId") REFERENCES "OrganizationRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT FROM information_schema.table_constraints 
        WHERE constraint_name = 'TeamMember_organizationRoleId_fkey'
    ) THEN
        ALTER TABLE "TeamMember" 
        ADD CONSTRAINT "TeamMember_organizationRoleId_fkey" 
        FOREIGN KEY ("organizationRoleId") REFERENCES "OrganizationRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Drop TeamRole table and its constraints (only after everything is migrated)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM "TeamMember" WHERE "teamRoleId" IS NOT NULL
    ) THEN
        ALTER TABLE "TeamRole" DROP CONSTRAINT IF EXISTS "TeamRole_parentRoleId_fkey";
        ALTER TABLE "TeamRole" DROP CONSTRAINT IF EXISTS "TeamRole_teamId_fkey";
        DROP TABLE IF EXISTS "TeamRole";
    END IF;
END $$;

-- ============================================
-- STEP 3: Verify Migration Completion
-- ============================================
-- Run these to verify everything is correct:

SELECT 'Verification Checks:' as check_type;
SELECT 
    (SELECT COUNT(*) FROM "OrganizationRole") as "OrganizationRole_count",
    (SELECT COUNT(*) FROM "TeamMember") as "TeamMember_count",
    (SELECT COUNT(*) FROM "TeamMember" WHERE "organizationRoleId" IS NULL) as "null_organizationRoleId_count",
    (SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'TeamRole')) as "TeamRole_still_exists";

