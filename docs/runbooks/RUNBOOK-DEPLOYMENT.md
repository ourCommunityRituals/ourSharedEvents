# Runbook: Deploying to Staging and Production

> **Purpose:** Step-by-step deployment procedures for the MVP Event Toolkit.
> **Last Updated:** 2025-12-17 | **Story:** 6 - Document Baseline & Runbooks

---

## Quick Reference

| Action                | Command                                  |
| --------------------- | ---------------------------------------- |
| Deploy to staging     | Push to `main` branch (automatic via CI) |
| Deploy to production  | Tag with `vX.Y.Z` (automatic via CI)     |
| Manual staging worker | `wrangler deploy --env staging`          |
| Rollback staging      | `npm run rollback:staging`               |
| Rollback production   | `npm run rollback:prod`                  |

---

## Deployment Workflow

### CI/CD-Based Deployment (Recommended)

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT WORKFLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Create PR to main                                            │
│     └── Stage-1 validates (lint, test, contract, guards)        │
│                                                                  │
│  2. Merge PR to main                                             │
│     └── Stage-1 deploys to staging (stg.oursharedevents.com)         │
│     └── Stage-2 validates live staging                          │
│                                                                  │
│  3. Tag release (vX.Y.Z)                                         │
│     └── Stage-1 deploys to production (www.oursharedevents.com)      │
│     └── Manual approval required for Stage-2 production tests   │
│     └── Stage-2 validates live production                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Deploying to Staging

### Step 1: Prepare Changes

```bash
# Ensure local tests pass
npm run stage1-local

# Or quick CI for faster feedback
npm run ci:local quick
```

### Step 2: Create Pull Request

```bash
# Push your feature branch
git push -u origin feature/my-feature

# Create PR in GitHub targeting main
```

### Step 3: Wait for Stage-1 Validation

Watch the Actions tab for these status checks:

- Security Check
- Lint
- Unit Tests
- Contract Tests
- Guards
- Quality Gates

**All checks must pass before merge.**

### Step 4: Merge PR

Once approved and all checks pass:

- Click "Merge pull request"
- Stage-1 automatically deploys to staging

### Step 5: Verify Staging Deployment

```bash
# Wait for deployment (~2-3 minutes)

# Verify staging is up
curl -s https://stg.oursharedevents.com/ping

# Check backend health
curl -s https://stg.oursharedevents.com/api/health/backend | jq

# Run staging smoke tests
npm run test:smoke
```

### Step 6: Monitor Stage-2

Watch the Stage-2 Orchestrator workflow:

- Check Stage-1 Status
- API Smoke Tests
- UI Smoke Tests
- Validation Gate

**Stage-2 must pass before considering production deployment.**

---

## Deploying to Production

### Prerequisites

- [ ] Staging deployment successful
- [ ] Stage-2 staging validation passed
- [ ] No open SEV1 or SEV2 incidents
- [ ] Avoid deploying on Fridays, holidays, or peak traffic times

### Step 1: Verify Staging

```bash
# Ensure staging is healthy
curl -s https://stg.oursharedevents.com/api/health/backend | jq '.ok'
# Expected: true

# Run synthetic health checks
npm run test:synthetic:staging
```

### Step 2: Create Release Tag

```bash
# Get current version
git describe --tags --abbrev=0

# Create new tag (semver format required)
git tag -a v1.2.3 -m "Release v1.2.3: Brief description"

# Push tag to trigger deployment
git push origin v1.2.3
```

### Step 3: Wait for Stage-1 Production Deploy

Stage-1 will:

1. Run all validation steps
2. Deploy Cloudflare Worker to production
3. Create `prod-base-url` artifact for Stage-2

### Step 4: Approve Production Validation

Stage-2 requires manual approval for production:

1. Go to Actions > Stage-2 Orchestrator workflow
2. Click "Review deployments"
3. Select "production" environment
4. Click "Approve and deploy"

### Step 5: Monitor Stage-2 Production Validation

Watch for:

- API smoke tests against production
- UI smoke tests against production
- Validation gate result

### Step 6: Post-Deployment Verification

```bash
# Verify production is up
curl -s https://www.oursharedevents.com/ping

# Check backend health
curl -s https://www.oursharedevents.com/api/health/backend | jq

# Verify no GAS HTML leak
curl -s https://www.oursharedevents.com/events | grep -c "Google Apps Script"
# Expected: 0

# Check Worker headers
curl -s -I https://www.oursharedevents.com/events | grep x-proxied-by
# Expected: x-proxied-by: oursharedevents-worker

# Run production smoke tests
npm run test:prod:smoke
```

### Step 7: Monitor (30 minutes post-deploy)

- Check Cloudflare dashboard for error rates
- Monitor application logs
- Watch for user reports

---

## First Production Launch — Cloudflare Access App (OSE-1353)

**Why:** production admin is Cloudflare Access only. `ALLOW_OCR_INTERNAL` and `ALLOW_ADMIN_KEY_FALLBACK` are absent from `[env.production.vars]` (ADR-012 gate R2, `tests/prod-admin-scope-config.spec.ts`). The Worker requires an Access identity on every path it guards with `requireAdmin`. A guarded path that the Access app does not cover reaches the Worker with no `Cf-Access-Jwt-Assertion` and returns 401, so the admin UI breaks on it. Protecting `/admin` alone is not enough: the dashboard loads, then every `/api/v2/admin/*` call fails.

**The paths:** `scripts/ci/access-protected-paths.txt` is the list. `tests/integration/access-protected-paths.test.js` derives the guarded paths from `src/router.ts` and fails when the file misses one. As of 2026-10-01 the Access app destinations are:

`admin` · `manage` · `dashboard` · `create` · `api/v2/admin/*` · `briefing` · `overview` · `summary`

**Create** (Zero Trust → Access → Applications → Add → Self-hosted), in a separate browser session:

1. Domain `oursharedevents.com`, one destination per path above. `www` needs none: it 301s to the apex.
2. Policy: **Allow**, Include → **Emails** → `mzdano@gmail.com`. Use the single email, not the `oursharedevents.com` domain: `ALLOWED_ADMIN_DOMAINS` admits that whole domain at the Worker, so the Access policy is the narrower gate.
3. Copy the app's **Application Audience (AUD) tag** for the pin step below.

**Verify:** every path is challenged by the production app (`access_ok`). The 6-hourly `cf-access-canary.yml` runs the same loop, so dispatch it afterwards and confirm the production row is green.

```bash
for p in $(grep -vE '^\s*(#|$)' scripts/ci/access-protected-paths.txt); do
  scripts/ci/cf-access-probe.sh --expect-challenge --url="https://oursharedevents.com$p"
done
```

**Staging too:** on 2026-10-01 the staging app covered `admin`, `manage` and `api/v2/admin/*` only. Add `dashboard`, `create`, `briefing`, `overview` and `summary` to it. Until you do, the canary's staging row is red, and `GET /briefing` cannot reach the Worker with an identity.

**Pin the audience (OSE-1377), after the app exists:** set `CF_ACCESS_AUD = "<AUD tag>"` in `[env.production.vars]` in a PR. The tag is not a secret. Until it is pinned, a token from any Access app on the `mzdano` team verifies on production. The pin takes effect on the next production deploy.

**Before that deploy:** `deploy-production` refuses to run while `ADMIN_KEY`, `X_OCR_INTERNAL` or `ADMIN_TOKEN` is set as a production Worker secret (ADR-012 gate R2). Check with `npx wrangler secret list --env production`. Delete any of the three with `npx wrangler secret delete <NAME> --env production`.

---

## First Production Launch — One-Time Data Steps

These run once, against the production database, before the first launch. They are data steps, not migrations, so no test brand or fixture ever ships in `migrations/`.

### Founder admin brand membership (OSE-1415)

**Why:** production has no `ADMIN_SCOPE_ALL` escape hatch. That setting exists only on staging, and `tests/prod-admin-scope-config.spec.ts` fails if it is ever added to `[env.production.vars]`. So an admin sees events only through a row in `admin_brand_memberships` (`src/lib/admin-brand-scope.ts`, `resolveAdminBrandScopeAsync`). With 0 rows, the founder's `/admin` list is empty ("deny" scope) on launch day.

**Order:**

1. After the production Cloudflare Access app protects `oursharedevents.com/admin` (OSE-1353).
2. Before the first authenticated admin smoke on production.

**The row:** one row, matching staging's shape exactly. Staging holds `mzdano@gmail.com | root | brand_owner`. The email must match the CF Access identity character for character, because the lookup is an exact `WHERE email = ?`.

**Apply** (idempotent: re-running changes nothing):

```bash
cd workers/oursharedevents
npx wrangler d1 execute DB --env production --remote --command "
INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role)
  VALUES ('mzdano@gmail.com', 'root', 'brand_owner');
INSERT OR IGNORE INTO admin_audit_log
  (id, action, actor, resource_type, resource_id, request_id, outcome, details)
  VALUES ('ose-1415-founder-membership', 'GRANT_BRAND_MEMBERSHIP', 'mzdano@gmail.com',
          'admin_brand_membership', 'mzdano@gmail.com:root', 'runbook:OSE-1415', 'success',
          '{\"role\":\"brand_owner\",\"source\":\"RUNBOOK-DEPLOYMENT first-launch step\"}');"
```

The audit row gives the first admin grant on production a trace in `admin_audit_log`. It uses a fixed id so a re-run stays idempotent.

**Verify:**

```bash
npx wrangler d1 execute DB --env production --remote --command "
SELECT email, brand_id, role FROM admin_brand_memberships;
SELECT action, resource_id, outcome FROM admin_audit_log WHERE id = 'ose-1415-founder-membership';"
# Expected: exactly one membership row (mzdano@gmail.com | root | brand_owner) and one audit row.
```

After OSE-1353, sign in to `https://oursharedevents.com/admin` through the **production** Access app:

- `GET /api/v2/admin/events` must return `ok: true` with `filters` echoed back, not an empty deny-scoped list. Production starts with 0 events (migration 0086), so an empty `items` proves nothing: a deny-scoped response is also `ok: true, items: []` but has no `filters` key.
- A non-member identity must still get an empty list. `tests/admin-brand-membership.spec.ts` covers this fail-closed case.

**Never:** add a wildcard brand, add a second identity without its own ticket, or set `ADMIN_SCOPE_ALL` on production.

### Founder platform-brand membership (AUD-3, OSE-1447)

**Why:** platform-owned admin routes are reachable only in scope mode `all` (a `key:` actor with `ADMIN_SCOPE_ALL`, which production never has) or by a member of the reserved platform brand `ose-platform` (`PLATFORM_BRAND_ID`, `src/lib/admin-brand-scope.ts`; guard `requirePlatformScope`, `src/lib/admin-object-scope.ts`). Those routes are:

- `GET /briefing`, `/overview`, `/summary`
- `GET /api/v2/admin/subscribers`, `/api/v2/admin/audit-log`, `/api/v2/admin/security/rate-limit-stats`
- `POST /api/v2/admin/data-subject/erase`, `/api/v2/admin/events/backfill-h3-cells`, `/api/v2/admin/poster-deployments/backfill-h3`

Every other admin gets 404 on them. Without this row the founder gets 404 too, which means data-subject erasure cannot be run over HTTP.

**Order:** on **staging as soon as this change deploys** (the founder's staging identity is scoped to `root` and loses these routes until the row exists), and on **production** alongside the OSE-1415 row above.

**The row:** `mzdano@gmail.com | ose-platform | brand_owner`. It grants nothing inside any other brand. Do not grant `ose-platform` to anyone else without its own ticket and a second approver (OSE-1133).

**Apply** (idempotent; run once per environment, `--env staging` then `--env production`):

```bash
cd workers/oursharedevents
npx wrangler d1 execute DB --env staging --remote --command "
INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role)
  VALUES ('mzdano@gmail.com', 'ose-platform', 'brand_owner');
INSERT OR IGNORE INTO admin_audit_log
  (id, action, actor, resource_type, resource_id, request_id, outcome, details)
  VALUES ('ose-1447-founder-platform-membership', 'GRANT_BRAND_MEMBERSHIP', 'mzdano@gmail.com',
          'admin_brand_membership', 'mzdano@gmail.com:ose-platform', 'runbook:OSE-1447', 'success',
          '{\"role\":\"brand_owner\",\"source\":\"RUNBOOK-DEPLOYMENT platform-brand step\"}');"
```

**Verify:**

```bash
npx wrangler d1 execute DB --env staging --remote --command "
SELECT email, brand_id, role FROM admin_brand_memberships WHERE brand_id = 'ose-platform';"
# Expected: exactly one row (mzdano@gmail.com | ose-platform | brand_owner).
```

Then, signed in through Access: `GET /briefing` returns 200 for the founder, and a brand-only identity gets 404 (`tests/platform-scope-tenant-writes.invariant.spec.ts`, `tests/briefing.spec.ts`).

### Re-run the 0088 audit brand backfill once after deploy (AUD-3, OSE-1447)

**Why:** CI applies migrations before it deploys the Worker. In that gap the old Worker can still write `admin_audit_log` rows without `brand_id`, and 0088's backfill has already run, so those rows stay NULL. NULL means platform-only, which is fail closed: no brand ever sees a row it should not. But the brand owner then misses those few rows. The Worker deliberately has no runtime `UPDATE admin_audit_log` path (TL-042, append-only), so this is a one-time operator step instead.

**When:** once per environment, after the deploy that carries 0088 is live (staging, then production).

**Apply** (idempotent: it touches only rows whose `brand_id` is still NULL, and re-running it changes nothing):

```bash
ENV=staging   # then ENV=production after the production deploy
cd workers/oursharedevents
sed -n '/^UPDATE/,$p' migrations/0088_admin_audit_log_brand_id.sql > /tmp/0088-backfill.sql  # the five UPDATEs only
npx wrangler d1 execute DB --env "$ENV" --remote --file /tmp/0088-backfill.sql
```

**Verify** (same `ENV`):

```bash
npx wrangler d1 execute DB --env "$ENV" --remote \
  --command "SELECT brand_id IS NOT NULL AS resolved, COUNT(*) FROM admin_audit_log GROUP BY 1;"
```

The visitor-country cleanup (0089) needs no such step: the nightly roll-up clears any `country_code` a Worker wrote in the deploy window (`aggregateScanBuckets`, OSE-1460).

### Create the BigQuery pool tables before the first export (OSE-1460, OSE-1416)

**Why:** the nightly backup and SharedReport exports stream rows with `tabledata.insertAll`, which fails if the table does not exist; BigQuery does not create it on first insert. Staging's 2026-10-02 03:01Z run failed exactly this way (`404 Not found: Table …oureventring_general_stg.events_backup`, and the same for `corridor_returns_export`). Every pool dataset needs four tables: `events_backup`, `corridor_returns_export`, `corridor_density_baseline_export` and `event_series_export`. Their schemas are checked in at `workers/oursharedevents/bigquery/<table>.schema.json`. The export specs (`oer-boundary`, `shared-report-bigquery-export`, `scan-to-export-trace`) fail if any row they send does not fit its file (`tests/helpers/bigquery-pool-schema.ts`).

**When:** once per environment, before that environment's first nightly run (`0 3 * * *` UTC).

**State:** staging's `oureventring_general_stg` holds all four tables (created 2026-10-02 with the script below). Production's `oureventring_general` does **not** exist yet.

```bash
PROJECT=project-7cc9adcd-ed55-47aa-958
DATASET=oureventring_general_stg   # production: DATASET=oureventring_general
cd workers/oursharedevents
# Production only, first time: create the dataset, then let only production's Worker write it.
bq --project_id="$PROJECT" show "$DATASET" >/dev/null 2>&1   || bq --project_id="$PROJECT" mk --dataset --location=US "$DATASET"
bash scripts/bq-create-pool-tables.sh "$PROJECT" "$DATASET"   # idempotent; never alters an existing table
```

On production, also grant the dataset to production's Worker **only** (OSE-1416; staging's datasets are granted to `attribute.env/staging` the same way). Run this in the BigQuery console or `bq query --nouse_legacy_sql`:

```sql
GRANT `roles/bigquery.dataEditor` ON SCHEMA `project-7cc9adcd-ed55-47aa-958.oureventring_general`
TO "principalSet://iam.googleapis.com/projects/295230478705/locations/global/workloadIdentityPools/cf-workers-pool/attribute.env/production";
```

**Verify:** `bq --project_id="$PROJECT" ls "$DATASET"` lists the four tables, each partitioned by day and clustered on `corridor_id`. After the next 03:00 UTC run, `SELECT * FROM export_manifest WHERE export_type = 'BIGQUERY' ORDER BY created_at DESC LIMIT 4` (D1) shows no `404 Not found` and no `PERMISSION_DENIED`.

### Purge return rows after migration 0091 and after any `ANON_ID_HASH_PEPPER` rotation (OSE-1460)

**Why:** `anon_id_returns.anon_id_hash` is keyed by `ANON_ID_HASH_PEPPER`. Erasure (`handlers/data-subject.ts`) can only re-derive the hash under the current pepper, so rows written under any other pepper, or before 0091 (`pepper_epoch` NULL), cannot be found for a person who asks to be erased. The export never counts them. The nightly materializer deletes them, but at most 50,000 rows a run; past that it logs `ANON_ID_RETURNS_PEPPER_PURGE_INCOMPLETE` and continues the next night. This step removes them all at once.

**When:**

- once per environment, right after the deploy that applies 0091;
- after every `ANON_ID_HASH_PEPPER` rotation, straight after the secret is changed and before the next nightly run (`0 3 * * *` UTC).

A rotation resets return counts by design, so after a rotation every row is from the old pepper and the whole table goes.

```bash
ENV=staging   # then ENV=production
cd workers/oursharedevents
# After the 0091 deploy: rows of unknown pepper.
npx wrangler d1 execute DB --env "$ENV" --remote --command "DELETE FROM anon_id_returns WHERE pepper_epoch IS NULL;"
# After a pepper rotation: every row is from the old pepper.
npx wrangler d1 execute DB --env "$ENV" --remote --command "DELETE FROM anon_id_returns;"
```

**Verify:** `SELECT pepper_epoch IS NULL AS unknown, COUNT(*) FROM anon_id_returns GROUP BY 1;` shows no `unknown = 1` row after the 0091 step, and `0` rows in total straight after a rotation.

### Turn on production monitoring (OSE-1418)

**When:** launch day, right after the first production deploy passes its smoke checks.

**Step:** set the repo variable `PRODUCTION_LIVE=true` (GitHub → Settings → Secrets and variables → Actions → Variables). Set `PRODUCTION_URL` too if production is not `https://oursharedevents.com`.

**What it turns on:**

- `security-monitoring.yml`: the daily health and security-header check runs against production as well. A production failure opens an urgent Linear issue and fails the digest.
- `security-regression.yml`: main-push and nightly runs target production instead of staging.

**Already on, no variable needed:** `cf-access-canary.yml` checks every 6 hours that every path in `scripts/ci/access-protected-paths.txt` on each host is challenged by that host's own Access app. The production row stays red until OSE-1353 is fixed.

**Verify:** dispatch `Security Monitoring — Daily` with `dry_run=true`. The job summary should show a "Health check (production)" row that is not `SKIPPED`.

---

## Manual Deployment (Emergency Only)

Use only when CI/CD is broken and immediate deployment is critical.

### Manual Staging Deploy

```bash
# Deploy staging worker
cd cloudflare-proxy
wrangler deploy --env staging

# Verify
curl -s https://stg.oursharedevents.com/ping
```

### Manual Production Deploy

```bash
# CAUTION: Only use in emergencies
cd cloudflare-proxy
wrangler deploy --env production

# Verify
curl -s https://www.oursharedevents.com/ping
```

---

## Rollback Procedures

### Staging Rollback

```bash
# Single-command rollback
npm run rollback:staging

# Or via wrangler
wrangler rollback --env staging
```

### Production Rollback

```bash
# Single-command rollback
npm run rollback:prod

# Or via wrangler
wrangler rollback --env production
```

### Verify Rollback

```bash
# Check staging
curl -s https://stg.oursharedevents.com/api/health/backend | jq

# Check production
curl -s https://www.oursharedevents.com/api/health/backend | jq
```

---

## Troubleshooting

### Deployment Fails in Stage-1

1. Check which quality gate failed in Actions tab
2. Review logs for specific failure reason
3. Fix locally and re-push

### Stage-2 Tests Fail

1. Check which test failed
2. Review Playwright report artifact
3. If staging issue, investigate and fix via new PR
4. If flaky test, re-run workflow

### Worker Not Responding

1. Check Cloudflare dashboard for errors
2. Verify secrets are set: `wrangler secret list --env <env>`
3. Check health endpoint: `curl https://<domain>/api/health/backend`
4. Consider rollback if issues persist

---

## Related Documentation

- [BASELINE.md](./BASELINE.md) - System baseline documentation
- [ROLLBACK.md](./ROLLBACK.md) - Detailed rollback procedures
- [ci-cd-architecture.md](./ci-cd-architecture.md) - CI/CD architecture
- [RUNBOOK.md](../RUNBOOK.md) - Incident response
