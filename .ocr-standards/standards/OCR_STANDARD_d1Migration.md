# D1 Migration Standard — OCR Org-Level

> Derived from the OSE production pattern. All product repos using Cloudflare D1 must follow this standard.

---

## Folder layout

Each worker that uses D1 gets one `migrations/` directory per database binding, inside the worker directory:

```
workers/<worker-name>/
├── migrations/            # Primary database
│   ├── 0001_create_foo.sql
│   ├── 0002_create_bar.sql
│   └── ROLLBACK_PLAN.md
├── migrations-forms/      # Secondary database (if needed)
│   ├── 0001_create_baz.sql
│   └── ...
├── wrangler.toml
└── src/
```

## Naming convention

```
NNNN_<snake_case_description>.sql
```

- 4-digit zero-padded sequence number
- Always increment sequentially — no gaps
- Description should reflect the action: `create_`, `add_`, `drop_`, `seed_`, `backfill_`

## Schema rules

1. **`CREATE TABLE IF NOT EXISTS`** — all migrations must be idempotent
2. **`CREATE INDEX IF NOT EXISTS`** — same for indexes
3. **`TEXT` primary keys** — ID generation happens in the application layer
4. **`datetime('now')` defaults** — all `created_at` / `updated_at` columns
5. **Foreign keys declared** — referential integrity enforced at the schema level
6. **Privacy by schema** — use bucketed timestamps (`scan_bucket`, `registration_bucket`) instead of exact times for anonymous behavioral data. Use hashed values (`email_hash`) instead of raw PII.
   - **Known drift (2026-10-01, unresolved):** ourSharedEvents scan rows carry `scan_bucket` **and** a `created_at` defaulting to `datetime('now')` (second precision). The exact value is never shown or exported, but it is stored. Either the code drops/coarsens it or this rule gains an exception; that is a decision for a human, not settled here.
7. **Separate databases for PII** — if the worker handles both anonymous and personally identifiable data, use separate D1 bindings (e.g., `DB` for core, `FORMS_DB` for PII). This enables independent retention and scrubbing policies.

## wrangler.toml configuration

Each environment declares its own D1 bindings:

```toml
# Local
[[d1_databases]]
binding = "DB"
database_name = "<product>-db-local"
database_id = "local"
migrations_dir = "migrations"

# Staging
[[env.staging.d1_databases]]
binding = "DB"
database_name = "<product>-db-staging"
database_id = "<uuid-from-cloudflare>"
migrations_dir = "migrations"

# Production
[[env.production.d1_databases]]
binding = "DB"
database_name = "<product>-db-production"
database_id = "<uuid-from-cloudflare>"
migrations_dir = "migrations"
```

- `binding` = the name used in TypeScript (`env.DB`)
- `migrations_dir` must match the folder name exactly
- Local uses `"local"` as `database_id` placeholder
- Production IDs come from the Cloudflare dashboard

## Running migrations

### Local development

```bash
wrangler d1 migrations apply DB --local
wrangler d1 migrations apply FORMS_DB --local   # if secondary DB exists
```

### Staging (CI — push to main)

```bash
npx wrangler d1 migrations apply DB --env staging --remote
npx wrangler d1 migrations apply FORMS_DB --env staging --remote
```

Post-migration verification is required:

```bash
wrangler d1 execute <db-name>-staging --env staging --remote \
  --command "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name IN ('<expected-tables>')"
```

### Production (CI — tag release with approval gate)

```bash
npx wrangler d1 migrations apply DB --env production --remote
npx wrangler d1 migrations apply FORMS_DB --env production --remote
```

Production migrations require:
- GitHub environment protection (approval gate)
- Pre-migration check for cross-env contamination
- Post-migration table verification
- Health check before workflow completes

## Rollback

Every `migrations/` directory must contain a `ROLLBACK_PLAN.md` that documents:

1. **Staging** — self-service: drop and recreate
2. **Production** — requires DevOps approval: surgical rollback with documented table drop order
3. **Post-rollback smoke tests** — verification commands to confirm state

## Testing

Each worker should have schema and constraint tests:

```json
{
  "scripts": {
    "test:schema": "vitest run tests/schema.spec.ts",
    "test:constraints": "vitest run tests/constraints.spec.ts",
    "test:d1": "vitest run tests/schema.spec.ts tests/constraints.spec.ts"
  }
}
```

## Reference implementation

OSE (`ourSharedEvents/workers/oursharedevents/`) is the canonical implementation:
- 17 main migrations, 10 forms migrations
- Dual-database pattern (DB + FORMS_DB)
- Full CI pipeline with staging and production gates
- ROLLBACK_PLAN.md with surgical procedures
- Privacy-by-schema design throughout

---

*Last updated: April 9 2026*
*Owner: Matt*
*Status: ACTIVE*
