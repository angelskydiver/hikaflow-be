# Production Migration Fix Guide

## Problem

Migration `20251031052312_move_hierarchy_to_organization_level` failed in production because it tried to add a NOT NULL column (`organizationRoleId`) to `TeamMember` table that already had existing rows.

## Solution

Use the recovery script to complete the migration manually in production.

## Step-by-Step Instructions

### Step 1: Connect to Production Database

Connect to your production PostgreSQL database using your preferred tool (psql, pgAdmin, DBeaver, etc.)

### Step 2: Check Current State

Run the verification queries from the top of `recovery_script.sql` to see what's already done:

```sql
-- Check if tables exist
SELECT EXISTS (
   SELECT FROM information_schema.tables
   WHERE table_schema = 'public'
   AND table_name = 'OrganizationRole'
) as "OrganizationRole_exists";

SELECT EXISTS (
   SELECT FROM information_schema.tables
   WHERE table_schema = 'public'
   AND table_name = 'TeamRole'
) as "TeamRole_exists";

-- Check columns
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'TeamMember'
AND column_name IN ('teamRoleId', 'organizationRoleId');
```

### Step 3: Run Recovery Script

Execute the entire `recovery_script.sql` file. The script is idempotent (safe to run multiple times) and will:

- Create `OrganizationRole` table if it doesn't exist
- Migrate data from `TeamRole` to `OrganizationRole`
- Add `organizationRoleId` column as nullable
- Populate `organizationRoleId` for all existing `TeamMember` records
- Handle any orphaned records
- Make `organizationRoleId` NOT NULL
- Drop old `TeamRole` table and `teamRoleId` column
- Create all necessary indexes and foreign keys

### Step 4: Verify Migration Completion

Run the verification queries at the end of the recovery script:

```sql
SELECT
    (SELECT COUNT(*) FROM "OrganizationRole") as "OrganizationRole_count",
    (SELECT COUNT(*) FROM "TeamMember") as "TeamMember_count",
    (SELECT COUNT(*) FROM "TeamMember" WHERE "organizationRoleId" IS NULL) as "null_organizationRoleId_count",
    (SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'TeamRole')) as "TeamRole_still_exists";
```

**Expected Results:**

- `OrganizationRole_count` > 0 (or 0 if you had no roles)
- `TeamMember_count` > 0 (should match your actual member count)
- `null_organizationRoleId_count` = 0 (NO NULLS!)
- `TeamRole_still_exists` = false

### Step 5: Mark Migration as Applied in Prisma

After the recovery script completes successfully, mark the migration as applied:

```bash
# In production environment
cd backend/codedeno-server
npx prisma migrate resolve --applied 20251031052312_move_hierarchy_to_organization_level
```

Or manually update the `_prisma_migrations` table:

```sql
UPDATE "_prisma_migrations"
SET "applied_steps_count" = 1, "finished_at" = NOW(), "rolled_back_at" = NULL
WHERE "migration_name" = '20251031052312_move_hierarchy_to_organization_level';
```

### Step 6: Generate Prisma Client

```bash
npx prisma generate
```

### Step 7: Test Application

Test that:

- Teams can be listed
- Organization hierarchy can be viewed/created
- Members can be assigned to teams with roles
- No errors in application logs

## Rollback Plan (if needed)

If something goes wrong, you can rollback by:

```sql
-- Recreate TeamRole table (if dropped)
-- This would require restoring from backup or recreating based on OrganizationRole

-- Add back teamRoleId column
ALTER TABLE "TeamMember" ADD COLUMN "teamRoleId" TEXT;

-- Map back from OrganizationRole to TeamRole (requires recreating TeamRole structure)
-- Note: This is complex and may require data restoration

-- Mark migration as rolled back
UPDATE "_prisma_migrations"
SET "rolled_back_at" = NOW()
WHERE "migration_name" = '20251031052312_move_hierarchy_to_organization_level';
```

**⚠️ WARNING:** Rollback is complex. It's better to fix forward than rollback.

## Safety Notes

1. **Backup First:** Always backup your production database before running migrations
2. **Test in Staging:** If possible, test the recovery script on a staging environment first
3. **Run During Low Traffic:** Execute during maintenance window if possible
4. **Monitor Logs:** Watch application logs after migration
5. **Verify Data:** Spot check a few teams and members to ensure data integrity

## Common Issues

### Issue: "gen_random_uuid() does not exist"

**Solution:** Enable pgcrypto extension:

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

### Issue: Foreign key violations

**Solution:** Ensure all foreign keys exist before adding constraints. The recovery script handles this with IF NOT EXISTS checks.

### Issue: Still seeing TeamRole references in code

**Solution:** After migration, make sure to:

1. Run `npx prisma generate` to update Prisma Client
2. Restart your application server
3. Clear any caches
