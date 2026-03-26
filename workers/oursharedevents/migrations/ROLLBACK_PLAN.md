# D1 Migration Rollback Plan

## Staging — Self-Service Rollback

Staging can be dropped and recreated at any time without approval.

```bash
# 1. Delete the staging database
wrangler d1 delete ocr-db-staging

# 2. Recreate it
wrangler d1 create ocr-db-staging

# 3. Update database_id in wrangler.toml [env.staging.d1_databases]

# 4. Re-apply all migrations
wrangler d1 migrations apply --env staging
```

## Production — Requires DevOps Approval

Production rollback is a destructive operation. **Do not execute without DevOps lead sign-off.**

### Option A: Drop and recreate (data loss — pre-launch only)

Only safe before real user data exists.

```bash
# Requires DevOps approval
wrangler d1 delete ocr-db-production
wrangler d1 create ocr-db-production
# Update database_id in wrangler.toml [env.production.d1_databases]
wrangler d1 migrations apply --env production
```

### Option B: Targeted table drop (surgical rollback)

Drop specific tables in reverse migration order. Run against production D1:

```sql
-- Reverse order: indexes first, then tables
-- 0007: Drop indexes
DROP INDEX IF EXISTS idx_scan_aggregates_event_date;
DROP INDEX IF EXISTS idx_registrations_source_placement;
DROP INDEX IF EXISTS idx_registrations_event_id;
DROP INDEX IF EXISTS idx_checkins_event_id;
DROP INDEX IF EXISTS idx_scans_poster_deployment;
DROP INDEX IF EXISTS idx_scans_event_bucket;
DROP INDEX IF EXISTS idx_poster_deployments_qr_token;
DROP INDEX IF EXISTS idx_poster_deployments_event_id;
DROP INDEX IF EXISTS idx_sponsors_event_id;
DROP INDEX IF EXISTS idx_events_slug;
DROP INDEX IF EXISTS idx_events_brand_status;

-- 0006
DROP TABLE IF EXISTS scan_aggregates;
-- 0005
DROP TABLE IF EXISTS registrations;
DROP TABLE IF EXISTS checkins;
-- 0004
DROP TABLE IF EXISTS scans;
-- 0003
DROP TABLE IF EXISTS poster_deployments;
-- 0002
DROP TABLE IF EXISTS sponsors;
-- 0001
DROP TABLE IF EXISTS events;
```

## Post-Migration Smoke Test

Run after every migration apply to verify success:

```bash
# Verify all 6 tables exist with expected column counts
wrangler d1 execute <db-name> --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

# Expected output: checkins, events, poster_deployments, registrations, scan_aggregates, scans, sponsors

# Verify index count
wrangler d1 execute <db-name> --command "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name;"

# Expected: 11 custom indexes
```
