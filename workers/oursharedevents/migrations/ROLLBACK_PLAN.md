# D1 Migration Rollback Plan

> **Production migrations NEVER run from a developer's local machine.**
> They run ONLY via the `deploy-prod` GitHub Actions workflow with explicit
> approval from a named DevOps gatekeeper.

## Migration Execution Model

Migrations are applied via `wrangler d1 execute --file` (one file at a time, in order).
The CI pipeline handles this automatically for both staging and production.

```bash
# Per-file execution (used by CI and for staging manual runs):
for f in migrations/000{1..7}_*.sql; do
  wrangler d1 execute <db-name> --env <env> --file "$f" --remote
done
```

All migrations use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` — safe to re-run.

---

## Staging — Self-Service Rollback

Staging can be dropped and recreated at any time without approval.

```bash
# 1. Delete the staging database
wrangler d1 delete ocr-db-staging

# 2. Recreate it
wrangler d1 create ocr-db-staging

# 3. Update database_id in wrangler.toml [env.staging.d1_databases]

# 4. Re-apply all migrations
for f in migrations/000{1..7}_*.sql; do
  wrangler d1 execute ocr-db-staging --env staging --file "$f" --remote
done
```

## Production — Requires DevOps Approval

Production rollback is a destructive operation. **Do not execute without DevOps lead sign-off.**

> Production rollback commands must be run via CI or by a named DevOps
> gatekeeper — never from a developer laptop.

### Option A: Drop and recreate (data loss — pre-launch only)

Only safe before real user data exists.

```bash
# Requires DevOps approval — run via CI workflow_dispatch only
wrangler d1 delete ocr-db-production
wrangler d1 create ocr-db-production
# Update database_id in wrangler.toml [env.production.d1_databases]
# Trigger deploy-prod CI workflow to re-apply migrations
```

### Option B: Targeted table drop (surgical rollback)

Drop specific tables in reverse migration order. Run against production D1
**via CI or DevOps gatekeeper only**:

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

CI runs this automatically after every migration apply. For manual verification:

```bash
# Verify all 7 tables exist
wrangler d1 execute <db-name> --env <env> --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

# Expected: checkins, events, poster_deployments, registrations,
#           scan_aggregates, scans, sponsors

# Verify 11 custom indexes
wrangler d1 execute <db-name> --env <env> --remote \
  --command "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name;"

# Expected indexes:
#   idx_checkins_event_id
#   idx_events_brand_status
#   idx_events_slug
#   idx_poster_deployments_event_id
#   idx_poster_deployments_qr_token
#   idx_registrations_event_id
#   idx_registrations_source_placement
#   idx_scan_aggregates_event_date
#   idx_scans_event_bucket
#   idx_scans_poster_deployment
#   idx_sponsors_event_id
```
