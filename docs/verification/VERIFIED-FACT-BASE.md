# Verified Fact Base — ourSharedEvents MVP

# Generated: 2026-03-28

# Method: Direct file system counts, no delegation

## Codebase Structure

### Canonical Worker (DEPLOYED by CI)

- Location: workers/oursharedevents/src/
- Source files: 14 TypeScript files
  - auth/admin.ts
  - handlers/events.ts, feature-flags.ts, form-pages.ts, forms.ts, health.ts, pages.ts (6)
  - lib/cors.ts, feature-flags.ts, forms-db.ts, google-auth.ts, sheets.ts (5)
  - index.ts, router.ts (2)
- Total LOC: 2,767
- Route conditions in router.ts: 26

### Legacy Worker (NOT deployed)

- Location: worker/src/
- Source files: 70 TypeScript files
- Total LOC: 29,252
- Status: NOT deployed by CI, NOT in wrangler deploy path

### Migrations

- Main DB: 9 SQL files (0001-0009)
- Forms DB: 7 SQL files (0001-0007)
- Total: 16 migrations

### Schemas

- JSON schema files: 19 (in /schemas/)

## Test Inventory (Verified Counts)

### By Directory

| Directory                      | Count   | Targets                                |
| ------------------------------ | ------- | -------------------------------------- |
| tests/unit/                    | 68      | Legacy worker/GAS                      |
| tests/contract/                | 38      | Legacy worker/GAS                      |
| tests/integration/             | 3       | Legacy worker/GAS                      |
| tests/api/smoke/               | 31      | Deployed endpoints (staging/prod URLs) |
| tests/ui/smoke/                | 12      | Deployed endpoints (staging/prod URLs) |
| tests/e2e/                     | 79      | Legacy worker/GAS                      |
| workers/oursharedevents/tests/ | 7       | Canonical Worker (Vitest)              |
| **TOTAL**                      | **238** |                                        |

### Targeting Deployed Worker

| Category                  | Count  | Framework           |
| ------------------------- | ------ | ------------------- |
| Vitest (Worker internals) | 7      | vitest-pool-workers |
| API smoke (deployed URLs) | 31     | Playwright          |
| UI smoke (deployed URLs)  | 12     | Playwright          |
| **Subtotal deployed**     | **50** |                     |
| Legacy (not deployed)     | 188    | Jest + Playwright   |

## CI/CD Pipeline (oursharedevents-ci.yml)

### Jobs: 6 defined

1. typecheck
2. schema-verify
3. deploy-staging
4. e2e-staging
5. deploy-production
6. e2e-production

### Sub-gates within jobs (deploy-staging contains):

- Apply 9 main DB migrations
- Apply 7 forms DB migrations
- Verify 6 main tables exist
- Verify 5 forms tables exist
- Deploy worker
- Health check (GET /health → 200)

## Rate Limiting

- EXISTS on: /subscribe endpoint (pages.ts:397-435, in-memory sliding window)
- MISSING on: All 4 form POST endpoints (forms.ts has zero rate limiting code)
- Type: Per-isolate in-memory (resets on worker restart, not shared across CF edge)

## Feature Flags

- 12 flag keys defined (lib/feature-flags.ts)
- 3 tier presets: free (2 ON), mid (6 ON), enterprise (12 ON)
- Resolution: event-scoped → global → default (ON)
- Seed data: migrations-forms/0007_seed_free_tier_flags.sql

## Infrastructure Status (from wrangler.toml)

- D1 Main DB IDs: PLACEHOLDER strings (not provisioned)
- D1 Forms DB IDs: PLACEHOLDER strings (not provisioned)
- Cron trigger: "0 3 \* \* \*" (configured, not active until deployed)
- ALLOW_ADMIN_KEY_FALLBACK: "true" (staging only)
- FORMS_ENCRYPTION_KEY: referenced in code, listed in wrangler.toml line 81

## Data Lifecycle (index.ts)

- Phase 1: DELETE form_registrations WHERE expires_at < now (90-day TTL)
- Phase 2: Scrub survey PII via whitelist (SAFE_KEY_PATTERNS regex)
- Phase 3: DELETE email_signups WHERE retention_expires_at < now (30-day TTL)
- Audit log: NOT implemented (no pii_destruction_log table)

## Anonymous ID System

- Migration: DOES NOT EXIST
- Handler: DOES NOT EXIST
- Table: NOT in any migration file

## Missing API Endpoints (verified against router.ts)

- GET /api/v2/admin/forms/:id/export — NOT in router
- GET/PUT /api/v2/admin/forms/:id/config — NOT in router
- DELETE /api/v2/admin/forms/:id/pii — NOT in router
- GET /api/v2/sharedreport — NOT in router
- GET /api/v2/sponsors — NOT in router
