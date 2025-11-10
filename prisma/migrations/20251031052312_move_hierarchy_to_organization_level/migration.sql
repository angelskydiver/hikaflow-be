/*
  Warnings:

  - You are about to drop the column `teamRoleId` on the `TeamMember` table. All the data in the column will be lost.
  - You are about to drop the `TeamRole` table. If the table is not empty, all the data it contains will be lost.

*/
-- Step 1: Create OrganizationRole table first
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

-- Step 2: Migrate existing TeamRole data to OrganizationRole
-- Group TeamRoles by organization and create OrganizationRoles
-- This assumes that roles with the same name in the same organization should be unified
INSERT INTO "OrganizationRole" ("id", "organizationId", "name", "rank", "parentRoleId", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid()::TEXT as "id",
    t."organizationId",
    tr."name",
    MIN(tr."rank") as "rank",
    NULL as "parentRoleId", -- We'll update parentRoleId in a second pass if needed
    MIN(tr."createdAt") as "createdAt",
    MAX(tr."updatedAt") as "updatedAt"
FROM "TeamRole" tr
INNER JOIN "Team" t ON tr."teamId" = t."id"
GROUP BY t."organizationId", tr."name";

-- Step 3: Update parentRoleId relationships (second pass)
-- Match by organization and role name
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

-- Step 4: Add nullable organizationRoleId column to TeamMember
ALTER TABLE "TeamMember" ADD COLUMN "organizationRoleId" TEXT;

-- Step 5: Populate organizationRoleId by matching TeamRole to OrganizationRole
UPDATE "TeamMember" tm
SET "organizationRoleId" = org_role."id"
FROM "TeamRole" tr
INNER JOIN "Team" t ON tr."teamId" = t."id"
INNER JOIN "OrganizationRole" org_role ON org_role."organizationId" = t."organizationId" AND org_role."name" = tr."name"
WHERE tm."teamRoleId" = tr."id";

-- Step 5a: Handle any orphaned TeamMember records (those without matching OrganizationRole)
-- Create a default role for any organization that has members but no roles yet
-- This should not happen in normal cases, but we handle it just in case
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
        -- Check if organization already has a default role
        SELECT "id" INTO default_role_id
        FROM "OrganizationRole"
        WHERE "organizationId" = org_id AND "name" = 'Default Role'
        LIMIT 1;
        
        -- Create default role if it doesn't exist
        IF default_role_id IS NULL THEN
            INSERT INTO "OrganizationRole" ("id", "organizationId", "name", "rank", "createdAt", "updatedAt")
            VALUES (gen_random_uuid()::TEXT, org_id, 'Default Role', 999, NOW(), NOW())
            RETURNING "id" INTO default_role_id;
        END IF;
        
        -- Update orphaned members
        UPDATE "TeamMember"
        SET "organizationRoleId" = default_role_id
        WHERE "id" = member_record."id" AND "organizationRoleId" IS NULL;
    END LOOP;
END $$;

-- Step 6: Drop old foreign key and index
ALTER TABLE "TeamMember" DROP CONSTRAINT IF EXISTS "TeamMember_teamRoleId_fkey";
DROP INDEX IF EXISTS "TeamMember_teamRoleId_idx";

-- Step 7: Now make organizationRoleId NOT NULL (after data migration)
-- Verify no nulls remain before making NOT NULL
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "TeamMember" WHERE "organizationRoleId" IS NULL) THEN
        RAISE EXCEPTION 'Cannot make organizationRoleId NOT NULL: null values still exist in TeamMember';
    END IF;
END $$;

ALTER TABLE "TeamMember" ALTER COLUMN "organizationRoleId" SET NOT NULL;

-- Step 8: Drop old teamRoleId column
ALTER TABLE "TeamMember" DROP COLUMN "teamRoleId";

-- Step 9: Drop foreign keys for TeamRole
ALTER TABLE "TeamRole" DROP CONSTRAINT IF EXISTS "TeamRole_parentRoleId_fkey";
ALTER TABLE "TeamRole" DROP CONSTRAINT IF EXISTS "TeamRole_teamId_fkey";

-- Step 10: Drop TeamRole table
DROP TABLE "TeamRole";

-- Step 11: Create indexes for OrganizationRole
CREATE INDEX "OrganizationRole_organizationId_rank_idx" ON "OrganizationRole"("organizationId", "rank");
CREATE INDEX "OrganizationRole_parentRoleId_idx" ON "OrganizationRole"("parentRoleId");
CREATE UNIQUE INDEX "OrganizationRole_organizationId_name_key" ON "OrganizationRole"("organizationId", "name");

-- Step 12: Create index for TeamMember
CREATE INDEX "TeamMember_organizationRoleId_idx" ON "TeamMember"("organizationRoleId");

-- Step 13: Add foreign keys
ALTER TABLE "OrganizationRole" ADD CONSTRAINT "OrganizationRole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationRole" ADD CONSTRAINT "OrganizationRole_parentRoleId_fkey" FOREIGN KEY ("parentRoleId") REFERENCES "OrganizationRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_organizationRoleId_fkey" FOREIGN KEY ("organizationRoleId") REFERENCES "OrganizationRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
