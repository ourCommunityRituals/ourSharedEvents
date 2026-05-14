# D1 Migration Rollback Plan — OSE

> **Production migrations NEVER run from a developer's local machine.**
> They run ONLY via the `deploy-prod` GitHub Actions workflow with explicit
> approval from a named DevOps gatekeeper.

This document covers all migrations applied to both D1 databases bound to
the OSE Worker:

- `DB` — main / anonymous public surface (28 migrations: 0001–0028)
- `FORMS_DB` — identified-user surface (12 migrations: 0001–0012)

Companion CI gate: [`tests/migration-smoke.spec.ts`](../tests/migration-smoke.spec.ts)
locks in the canonical post-migration shape (table count, trigger count,
critical index names) on every PR. If you add or drop a migration object,
update both that file and this plan in the same commit.

---

## Migration execution model

Migrations are applied via `wrangler d1 migrations apply` (one file at a
time, in lexical order). The CI pipeline handles this automatically for
both staging and production. Local manual execution:

```bash
# Staging
wrangler d1 migrations apply DB        --env staging --remote
wrangler d1 migrations apply FORMS_DB  --env staging --remote

# Production (CI-only path; do NOT run from a developer laptop)
wrangler d1 migrations apply DB        --env production --remote
wrangler d1 migrations apply FORMS_DB  --env production --remote
```

All migrations use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
or are idempotent ALTERs handled by the migration test helpers (see the
`'duplicate column name'` / `'no such column'` ignore-clauses in
`tests/constraints.spec.ts` and `tests/migration-smoke.spec.ts`).

---

## Staging — self-service rollback

Staging can be dropped and recreated at any time without approval.

```bash
# 1. Delete both staging databases
wrangler d1 delete ocr-db-staging
wrangler d1 delete ocr-forms-db-staging

# 2. Recreate
wrangler d1 create ocr-db-staging
wrangler d1 create ocr-forms-db-staging

# 3. Update database_id in wrangler.toml [env.staging.d1_databases]

# 4. Re-apply all migrations
wrangler d1 migrations apply DB        --env staging --remote
wrangler d1 migrations apply FORMS_DB  --env staging --remote

# 5. Verify (see "Post-migration smoke test" below)
```

---

## Production — requires DevOps approval

Production rollback is destructive. **Do not execute without DevOps lead sign-off.**

### Option A — drop and recreate (pre-launch only)

Only safe before real user data exists. After Pulse 1 launch, prefer Option B.

```bash
# Run via CI workflow_dispatch only — never from a developer laptop
wrangler d1 delete ocr-db-production
wrangler d1 delete ocr-forms-db-production
wrangler d1 create ocr-db-production
wrangler d1 create ocr-forms-db-production
# Update database_id in wrangler.toml [env.production.d1_databases]
# Trigger deploy-prod CI workflow to re-apply migrations
```

### Option B — surgical reverse-order rollback (post-launch)

Drop objects in reverse migration order. Run against production D1 **via
CI or DevOps gatekeeper only**. The SQL below is the canonical full
rollback; for partial rollback (drop only the last N migrations), execute
the relevant sections from the bottom up.

#### B.1 — `DB` (main database)

```sql
-- 0028: Replace ip_address with ip_hash on subscribers
ALTER TABLE subscribers ADD COLUMN ip_address TEXT;
ALTER TABLE subscribers DROP COLUMN ip_hash;

-- 0027: qr_verified column
ALTER TABLE events DROP COLUMN qr_verified;

-- 0026: admin_audit_log
DROP INDEX IF EXISTS idx_admin_audit_log_resource;
DROP INDEX IF EXISTS idx_admin_audit_log_actor;
DROP INDEX IF EXISTS idx_admin_audit_log_created_at;
DROP TABLE IF EXISTS admin_audit_log;

-- 0025: event state machine — no-op (only SELECT 1)

-- 0024: seed phase1 event types — data-only (TRUNCATE event_type_registry to roll back)
DELETE FROM event_type_registry WHERE event_phase = 1;

-- 0023: regulatory schema
DROP INDEX IF EXISTS idx_corridor_regulatory_status_corridor;
DROP TABLE IF EXISTS corridor_regulatory_status;
DROP INDEX IF EXISTS idx_event_type_registry_uec;
DROP INDEX IF EXISTS idx_event_type_registry_phase;
DROP TABLE IF EXISTS event_type_registry;

-- 0022: sponsor_impressions
DROP INDEX IF EXISTS idx_sponsor_impressions_event;
DROP INDEX IF EXISTS idx_sponsor_impressions_sponsor;
DROP TABLE IF EXISTS sponsor_impressions;

-- 0021: geo on events
ALTER TABLE events DROP COLUMN lon;
ALTER TABLE events DROP COLUMN lat;
ALTER TABLE events DROP COLUMN zip_code;

-- 0020: sponsor_areas
DROP INDEX IF EXISTS idx_sponsor_areas_zip;
DROP INDEX IF EXISTS idx_sponsor_areas_sponsor;
DROP TABLE IF EXISTS sponsor_areas;

-- 0019: sponsor_event_types
DROP INDEX IF EXISTS idx_sponsor_event_types_template;
DROP INDEX IF EXISTS idx_sponsor_event_types_sponsor;
DROP TABLE IF EXISTS sponsor_event_types;

-- 0018: sponsors tier default — data-only fix; rollback restores prior default
-- (refer to git history of 0018 for the prior DEFAULT value)

-- 0017: template_id on events
ALTER TABLE events DROP COLUMN template_id;

-- 0016: anonymous_id on scans
DROP INDEX IF EXISTS idx_scans_anonymous;
ALTER TABLE scans DROP COLUMN anonymous_id;

-- 0015: seed event templates — data-only (DELETE from event_templates to roll back)
DELETE FROM event_templates;

-- 0014: event_templates
DROP INDEX IF EXISTS idx_event_templates_category;
DROP TABLE IF EXISTS event_templates;

-- 0013: seed test event — data-only (DELETE from events WHERE id = 'test-event' or similar)
-- See 0013 for the exact seed row.

-- 0012: ring emergence support — index-only ADDs on corridors and node_hierarchy
DROP INDEX IF EXISTS idx_node_hierarchy_ring_role;
-- idx_corridors_signal_class is recreated by 0010, leave in place
DROP INDEX IF EXISTS idx_corridors_temporal;
DROP INDEX IF EXISTS idx_corridors_directionality;

-- 0011: corridor growth model — index/column ADDs on corridors and node_hierarchy
DROP INDEX IF EXISTS idx_node_hierarchy_legal_tier;
DROP INDEX IF EXISTS idx_corridors_growth_pattern;
DROP INDEX IF EXISTS idx_corridors_parent;
-- (ALTER TABLE column ADDs from 0011 must be dropped explicitly — see 0011 source)

-- 0010: NCR v2 hierarchy
DROP INDEX IF EXISTS idx_corridors_signal_class;
DROP INDEX IF EXISTS idx_corridors_status;
DROP INDEX IF EXISTS idx_corridors_brand;
DROP INDEX IF EXISTS idx_node_hierarchy_parent;
DROP INDEX IF EXISTS idx_node_hierarchy_brand_level;
DROP TABLE IF EXISTS corridors;
DROP TABLE IF EXISTS node_hierarchy;

-- 0009: drop form tables from main DB — already a destructive migration;
-- rolling back would require recreating checkins + registrations in DB,
-- which contradicts the architecture invariant 1 (Anonymous ID / two-DB
-- isolation). Do NOT roll this back without explicit architectural review.

-- 0008: subscribers (post-0028 the schema is email/source/ip_hash/created_at)
DROP TABLE IF EXISTS subscribers;

-- 0007: original indexes
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

-- 0006: scan_aggregates
DROP TABLE IF EXISTS scan_aggregates;

-- 0005: checkins + registrations
-- These were already dropped by 0009; if you reached this step you skipped 0009.
DROP TABLE IF EXISTS registrations;
DROP TABLE IF EXISTS checkins;

-- 0004: scans
DROP TABLE IF EXISTS scans;

-- 0003: poster_deployments
DROP TABLE IF EXISTS poster_deployments;

-- 0002: sponsors
DROP TABLE IF EXISTS sponsors;

-- 0001: events
DROP TABLE IF EXISTS events;
```

#### B.2 — `FORMS_DB` (identified-user database)

```sql
-- 0012: add consent_type
ALTER TABLE form_registrations DROP COLUMN consent_type;
ALTER TABLE email_signups      DROP COLUMN consent_type;

-- 0011: seed regulatory flags — data-only (DELETE rows added by 0011)
DELETE FROM feature_flags WHERE flag_key LIKE 'regulatory.%';

-- 0010: consent tracking — column ADDs on form_registrations/email_signups
ALTER TABLE form_registrations DROP COLUMN consent_text_version;
ALTER TABLE form_registrations DROP COLUMN consent_at;
ALTER TABLE email_signups      DROP COLUMN consent_text_version;
ALTER TABLE email_signups      DROP COLUMN consent_at;

-- 0009: pii_audit_log
DROP TABLE IF EXISTS pii_audit_log;

-- 0008: anonymous_id on form_registrations / checkin_counts / form_surveys
ALTER TABLE checkin_counts       DROP COLUMN last_anonymous_id;
ALTER TABLE form_registrations   DROP COLUMN anonymous_id;
ALTER TABLE form_surveys         DROP COLUMN anonymous_id;

-- 0007: seed free-tier flags — data-only (DELETE seed rows from feature_flags)
DELETE FROM feature_flags WHERE scope = 'global';

-- 0006: feature_flags (form_config table)
DROP TABLE IF EXISTS feature_flags;

-- 0005: forms indexes
DROP INDEX IF EXISTS idx_email_signups_retention;
DROP INDEX IF EXISTS idx_email_signups_event;
DROP INDEX IF EXISTS idx_form_surveys_event;
DROP INDEX IF EXISTS idx_checkin_counts_event;
DROP INDEX IF EXISTS idx_form_registrations_expires;
DROP INDEX IF EXISTS idx_form_registrations_event;

-- 0004: email_signups
DROP TABLE IF EXISTS email_signups;

-- 0003: form_surveys
DROP TABLE IF EXISTS form_surveys;

-- 0002: checkin_counts
DROP TABLE IF EXISTS checkin_counts;

-- 0001: form_registrations
DROP TABLE IF EXISTS form_registrations;
```

---

---

## Retention policies per table (PII lifecycle)

The scheduled lifecycle job runs daily. Two functions live in `src/index.ts`:

| Function                           | Touches             | What it does                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runFormDataLifecycle`             | FORMS_DB only       | Deletes expired `form_registrations`, scrubs `form_surveys` PII via the whitelist, deletes `email_signups` past `retention_expires_at`. Audits to `pii_audit_log`. Bounded by the `forms-security` S4 isolation gate.                                                                                                                                                                                |
| `runSubscribersRetentionLifecycle` | DB.subscribers only | OSE-207. **Off by default.** If `env.SUBSCRIBERS_RETENTION_DAYS` is set to a positive integer N, deletes subscribers whose `created_at` is older than N days. When unset, logs `SUBSCRIBERS_RETENTION_NOOP` — retention is uncapped and right-to-erase (Phase C in `data-subject.ts`) covers ad-hoc removal. Audits to `admin_audit_log` (action=`SUBSCRIBERS_RETENTION`, actor=`system:lifecycle`). |

### Operator knobs

| Env var                                | Default | Effect                                                                                                                |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `SUBSCRIBERS_RETENTION_DAYS`           | unset   | Cron is a no-op (with structured log line); subscribers are never auto-deleted. Right-to-erase still works on demand. |
| `SUBSCRIBERS_RETENTION_DAYS=N` (N > 0) | —       | Cron deletes rows where `created_at < datetime('now', '-N days')`. Audits each run.                                   |

Set via `wrangler secret put` or `[vars]` in `wrangler.toml` per env:

```bash
wrangler secret put SUBSCRIBERS_RETENTION_DAYS --env staging   # interactive value entry
```

### Cross-DB no-raw-IP invariant

`tests/pii-invariant.spec.ts` asserts on every PR that no table in either
binding carries a column whose name is a raw network identifier (`ip_address`,
`client_ip`, `remote_addr`, `x_forwarded_for`, `cf_connecting_ip`, etc.).
The hashed escape hatch (`*_hash`) is allowed. Adding any forbidden column
name fails CI; the right fix is to use a peppered hash like
`hashIpForSubscribe` from OSE-207, not to weaken the gate.

---

## Post-migration smoke test

The authoritative gate is `tests/migration-smoke.spec.ts`, run on every PR
as part of T0 Gate. It asserts:

| What                          | Expected (as of 0028 / forms 0012)                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `DB` tables                   | exactly 15, names match canonical set                                                                                                    |
| `FORMS_DB` tables             | exactly 6, names match canonical set                                                                                                     |
| `DB` triggers                 | 0 (state-machine moved to app layer per 0025)                                                                                            |
| `FORMS_DB` triggers           | 0                                                                                                                                        |
| Critical `DB` indexes present | `idx_events_brand_status`, `idx_events_slug`, `idx_poster_deployments_qr_token`, `idx_scans_anonymous`, `idx_admin_audit_log_created_at` |

For manual verification against a live D1:

```bash
# All tables in DB
wrangler d1 execute DB --env <env> --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name;"

# All tables in FORMS_DB
wrangler d1 execute FORMS_DB --env <env> --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name;"

# All triggers across both DBs (expected: empty)
wrangler d1 execute DB        --env <env> --remote --command \
  "SELECT name FROM sqlite_master WHERE type='trigger';"
wrangler d1 execute FORMS_DB  --env <env> --remote --command \
  "SELECT name FROM sqlite_master WHERE type='trigger';"

# Custom indexes only (idx_* prefix)
wrangler d1 execute DB        --env <env> --remote --command \
  "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name;"
wrangler d1 execute FORMS_DB  --env <env> --remote --command \
  "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name;"
```

The CI smoke test emits a JSON observability line per run:

```
{"type":"OSE_209_MIGRATION_SMOKE","db":{"tables":15,"indexes":33,"triggers":0},"forms_db":{"tables":6,"indexes":12,"triggers":0},"timestamp":"..."}
```

Grep CI logs for `OSE_209_MIGRATION_SMOKE` to confirm the run executed
and read the live count.

---

## Adding a new migration — checklist

When you add migration `NNNN_*.sql` to either `migrations/` or `migrations-forms/`:

1. The migration SQL itself must be idempotent (`IF NOT EXISTS` / `IF EXISTS` clauses).
2. Update `tests/migration-smoke.spec.ts` `DB_TABLES` or `FORMS_DB_TABLES` constants if a new table is added.
3. Update `.github/workflows/oursharedevents-ci.yml` `EXPECTED_DB` / `EXPECTED_FORMS` shell variables — in **both** the T1 Deploy → Staging and T1 Deploy → Production blocks. These run against the live D1 post-`wrangler d1 migrations apply` and must agree with the miniflare-based smoke test (#2).
4. Update `tests/constraints.spec.ts` table/index counts if those change.
5. Add a "## NNNN" entry to the relevant section (B.1 or B.2) of this file with the reverse SQL.
6. Run `npx vitest run tests/migration-smoke.spec.ts tests/constraints.spec.ts` locally — both must pass.
7. Document data-loss implications in the PR description if the migration drops a column or table.
