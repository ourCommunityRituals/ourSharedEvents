# OurSharedEvents — Operations Runbook

> **Linear:** OUR-130 (HK-7) — Backfill RUNBOOK.md escalation contacts + monitoring links
>
> **Last Updated:** 2026-03-31

---

## Quick Reference

### Escalation Contacts

| Role                             | Contact                              | When to Escalate                 |
| -------------------------------- | ------------------------------------ | -------------------------------- |
| Primary On-Call / Platform Owner | Matt — ourcommunityrituals@gmail.com | All incidents, first contact     |
| Cloudflare / DNS                 | Matt via Cloudflare Dashboard        | Worker failures, DNS issues      |
| Google Sheets / GCP              | Matt via Google Cloud Console        | Auth failures, Sheets API issues |

> **Note:** This is a solo-operated platform. Matt is the single on-call for all incident types.

### Health Check URLs

| Environment | URL                                      | Expected Response                                |
| ----------- | ---------------------------------------- | ------------------------------------------------ |
| Staging     | `https://stg.oursharedevents.com/health` | `{"ok":true,"env":"staging","version":"..."}`    |
| Production  | `https://oursharedevents.com/health`     | `{"ok":true,"env":"production","version":"..."}` |

### Quick Commands

```bash
# Staging health check
curl -s https://stg.oursharedevents.com/health | jq

# Production health check
curl -s https://oursharedevents.com/health | jq

# Staging events API (public)
curl -s https://stg.oursharedevents.com/api/v2/events | jq

# Staging admin events API (requires Bearer token)
curl -s -H "Authorization: Bearer $ADMIN_KEY" \
  https://stg.oursharedevents.com/api/v2/admin/events | jq

# Check current Worker deployment version
curl -s https://stg.oursharedevents.com/health | jq '.version'
```

---

## Monitoring Links

| Resource                    | URL / Location                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare Worker Analytics | [dash.cloudflare.com](https://dash.cloudflare.com) → Workers → `oursharedevents-staging` / `oursharedevents-prod` → Analytics |
| Cloudflare Worker Logs      | Cloudflare Dashboard → Workers → Worker name → Logs (real-time tail)                                                          |
| GitHub Actions CI/CD        | [github.com/ourCommunityRituals/ourSharedEvents/actions](https://github.com/ourCommunityRituals/ourSharedEvents/actions)      |
| D1 Database Console         | Cloudflare Dashboard → D1 → `ocr-db-staging` / `ocr-db-production`                                                            |
| Forms D1 Console            | Cloudflare Dashboard → D1 → `ocr-forms-db-staging` / `ocr-forms-db-production`                                                |

> **Status:** No external uptime monitor (UptimeRobot / Pingdom) is configured yet. The `/health` endpoint is the canonical health anchor. Set up external monitoring as a next step.

---

## Secret Locations

### GitHub Actions Secrets

Set at: **github.com/ourCommunityRituals/ourSharedEvents/settings/secrets/actions**

| Secret                          | Purpose                                                                  | Required For                   |
| ------------------------------- | ------------------------------------------------------------------------ | ------------------------------ |
| `CLOUDFLARE_API_TOKEN`          | Scoped token for Worker deploy (Workers:Edit, Routes:Edit, Account:Read) | All deployments                |
| `CLOUDFLARE_ACCOUNT_ID`         | Cloudflare account identifier                                            | All deployments                |
| `ADMIN_KEY`                     | Bearer token for `/admin` and `/api/v2/admin/*` routes                   | E2E staging + production tests |
| `GOOGLE_CLIENT_EMAIL`           | Google service account email                                             | Sheets API (Phase 1)           |
| `GOOGLE_PRIVATE_KEY`            | Google service account private key (PEM)                                 | Sheets API (Phase 1)           |
| `STAGING_SHEETS_SPREADSHEET_ID` | Staging spreadsheet ID                                                   | Staging Sheets backend         |

> Full list: see `.github-secrets-required.json` and `docs/deployment/CLOUDFLARE_SECRETS.md`

### Cloudflare Worker Secrets (set via Wrangler)

These are set once per environment and live in Cloudflare — not in GitHub:

```bash
# Staging
wrangler secret put ADMIN_KEY                  --env staging
wrangler secret put SHEETS_SPREADSHEET_ID      --env staging
wrangler secret put GOOGLE_SA_CLIENT_EMAIL     --env staging
wrangler secret put GOOGLE_SA_PRIVATE_KEY_PEM  --env staging
wrangler secret put FORMS_ENCRYPTION_KEY       --env staging
wrangler secret put GOOGLE_MAPS_API_KEY        --env staging
wrangler secret put BIGQUERY_DATASET_ID        --env staging
wrangler secret put GCP_PROJECT_ID             --env staging
wrangler secret put VERTEX_AI_MODEL_ID         --env staging

# Production (same secrets, different values)
wrangler secret put ADMIN_KEY                  --env production
# ...repeat for each secret above
```

**List currently configured secrets:**

```bash
wrangler secret list --env staging
wrangler secret list --env production
```

**Security rule:** Never store secrets in `wrangler.toml` or source code. Use Wrangler secrets for Worker runtime and GitHub Secrets for CI/CD. See `docs/deployment/CLOUDFLARE_SECRETS.md` for rotation schedule (90 days for Google SA keys and Cloudflare API token).

---

## D1 Database Reference

### Main DB (`DB` binding)

| Environment | D1 Name             | Binding |
| ----------- | ------------------- | ------- |
| Local dev   | `ocr-db-local`      | `DB`    |
| Staging     | `ocr-db-staging`    | `DB`    |
| Production  | `ocr-db-production` | `DB`    |

**Tables:** `events`, `sponsors`, `poster_deployments`, `scans`, `scan_aggregates`, `subscribers`

**Contains:** Core event entities — event records, sponsor placements, scan/check-in aggregates, subscriber list.

**Migrations:** `workers/oursharedevents/migrations/0001_*.sql` through `0009_*.sql`

### Forms DB (`FORMS_DB` binding)

| Environment | D1 Name                   | Binding    |
| ----------- | ------------------------- | ---------- |
| Local dev   | `ocr-forms-db-local`      | `FORMS_DB` |
| Staging     | `ocr-forms-db-staging`    | `FORMS_DB` |
| Production  | `ocr-forms-db-production` | `FORMS_DB` |

**Tables:** `form_registrations`, `checkin_counts`, `form_surveys`, `email_signups`, `feature_flags`

**Contains:** PII-sensitive form submissions. Email signups are AES-GCM encrypted via `FORMS_ENCRYPTION_KEY`. PII is scrubbed by a daily cron job at 03:00 UTC (30-day retention for email signups, expired registrations destroyed).

**Migrations:** `workers/oursharedevents/migrations-forms/0001_*.sql` through `0007_*.sql`

> **IMPORTANT:** Production D1 migrations run ONLY via the `deploy-production` CI job with GitHub environment approval gate. Never run `--env production` migrations locally.

**Query D1 directly (staging example):**

```bash
npx wrangler d1 execute ocr-db-staging --env staging --remote \
  --command "SELECT id, name, start_date FROM events LIMIT 10"

npx wrangler d1 execute ocr-forms-db-staging --env staging --remote \
  --command "SELECT COUNT(*) FROM email_signups WHERE expires_at > datetime('now')"
```

---

## Deployment Paths

### Staging (automatic on push to `main`)

```
PR merged to main
  → CI job 01: TypeCheck Worker (tsc --noEmit)
  → CI job 01b: Schema Verify (Vitest D1 tests)
  → CI job 02: Deploy → Staging
      - Apply D1 migrations to ocr-db-staging (main DB)
      - Apply D1 migrations to ocr-forms-db-staging (forms DB)
      - Verify table counts (6 main, 5 forms)
      - wrangler deploy --env staging
      - Health check: GET stg.oursharedevents.com/health → HTTP 200
  → CI job 03: E2E → Staging
      - API smoke tests (npm run test:api:smoke)
      - UI smoke tests (npm run test:ui:smoke)
```

### Production (on `vX.Y.Z` tag)

```
git tag v1.2.3 && git push --tags
  → CI job 01: TypeCheck Worker
  → CI job 01b: Schema Verify
  → CI job 04: Deploy → Production (requires GitHub Environment approval)
      - Verify DB isolation (no staging/local refs in production config)
      - Apply D1 migrations to ocr-db-production
      - Apply D1 migrations to ocr-forms-db-production
      - Verify table counts
      - wrangler deploy --env production
      - Health check: GET oursharedevents.com/health → HTTP 200
  → CI job 05: E2E → Production
      - API + UI smoke tests against production
```

### Manual deploy (workflow_dispatch)

```bash
# Trigger from GitHub Actions UI or gh CLI:
gh workflow run oursharedevents-ci.yml \
  -f deploy_staging=true

# Production (requires typing "PRODUCTION" in the input)
gh workflow run oursharedevents-ci.yml \
  -f deploy_production=PRODUCTION
```

### Local deploy (skip CI — use with care)

```bash
cd workers/oursharedevents

# Staging
wrangler deploy --env staging

# Production — requires explicit confirmation, only when CI is unavailable
wrangler deploy --env production
```

---

## How to Roll Back

### Option 1: Cloudflare Instant Rollback (preferred)

```
Cloudflare Dashboard → Workers → oursharedevents-prod → Deployments
  → Find previous deployment → click "Rollback"
```

This is instant. No CI run needed.

### Option 2: Tag a previous commit and push tag

```bash
# Find the last known-good commit
git log --oneline

# Tag it as a new version to trigger CI deployment
git tag v1.2.2-hotfix <commit-sha>
git push origin v1.2.2-hotfix
```

CI will deploy it as a new production release.

### Option 3: Revert PR and merge to main

```bash
# Revert the bad commit
git revert <bad-commit-sha>
git push origin main
```

This redeploys staging automatically, then tag for production.

---

## Incident Response

### Step 1: Verify (0–5 min)

```bash
# Is the Worker responding?
curl -s -w "\nHTTP %{http_code} in %{time_total}s\n" \
  https://oursharedevents.com/health

# Is staging still healthy?
curl -s https://stg.oursharedevents.com/health | jq '.ok'
```

### Step 2: Diagnose (5–15 min)

**If Worker returns 5xx:**

1. Check Cloudflare status: https://www.cloudflarestatus.com/
2. Check Worker logs: Cloudflare Dashboard → Workers → `oursharedevents-prod` → Logs
3. Check last CI run: GitHub Actions → `OurSharedEvents CI/CD`
4. If recently deployed: roll back immediately (see above)

**If `/health` returns 200 but `/api/v2/events` fails:**

1. Check if Google Sheets backend is the issue — Sheets latency is 200–800ms (Phase 1 known limitation)
2. Check GCP / Sheets API status: https://www.google.com/appsstatus
3. Test admin endpoint to isolate public vs admin path

**If D1 queries fail:**

```bash
# Check D1 is reachable
npx wrangler d1 execute ocr-db-production --env production --remote \
  --command "SELECT 1"
```

### Step 3: Escalate

Email **ourcommunityrituals@gmail.com** with:

- Incident time (UTC)
- Endpoint(s) affected
- Error codes / HTTP status
- Last known-good deployment version (from `/health`)
- Steps taken so far

---

## Common Issues and Fixes

### Health check returns non-200

| Cause                                          | Fix                                                             |
| ---------------------------------------------- | --------------------------------------------------------------- |
| Worker not deployed                            | Push to `main` or trigger `workflow_dispatch`                   |
| D1 database ID placeholder (`<staging-db-id>`) | Provision D1 in Cloudflare Dashboard and update `wrangler.toml` |
| Missing `ADMIN_KEY` secret                     | `wrangler secret put ADMIN_KEY --env staging`                   |

### Admin API returns 401

```bash
# Verify the secret is set
wrangler secret list --env staging | grep ADMIN_KEY

# Test with explicit Bearer token
curl -H "Authorization: Bearer <your-token>" \
  https://stg.oursharedevents.com/api/v2/admin/events
```

Admin auth accepts either:

1. Cloudflare Access JWT (CF-Access-Jwt-Assertion header) — production
2. Bearer token fallback (`ALLOW_ADMIN_KEY_FALLBACK=true`) — staging only

### Google Sheets / Auth fails

| Error Symptom                   | Fix                                                                        |
| ------------------------------- | -------------------------------------------------------------------------- |
| `GOOGLE_AUTH_MISSING_SECRET`    | Set `GOOGLE_SA_CLIENT_EMAIL` + `GOOGLE_SA_PRIVATE_KEY_PEM` via Wrangler    |
| `GOOGLE_AUTH_KEY_IMPORT_FAILED` | PEM format issue — regenerate key from GCP Console, ensure actual newlines |
| `SHEETS_READ_FAILED`            | Share the target spreadsheet with the service account email                |
| `SHEETS_DB_ID_MISSING`          | `wrangler secret put SHEETS_SPREADSHEET_ID --env staging`                  |

```bash
# Extract service account email from auth error response hint
curl -s https://stg.oursharedevents.com/health | jq '.hint'

# Verify key format
cat credentials.json | jq -r '.private_key' | head -n 2
# Should show: -----BEGIN PRIVATE KEY-----
```

### D1 migration fails in CI

Check which migration failed in the Actions log, then:

```bash
# Re-run the specific migration manually
npx wrangler d1 execute ocr-db-staging --env staging --remote \
  --file migrations/0007_create_indexes.sql
```

If a migration has a partial state, inspect the `sqlite_master` table:

```bash
npx wrangler d1 execute ocr-db-staging --env staging --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table'"
```

### Forms encryption / PII cron errors

The PII destruction job runs daily at 03:00 UTC. If it fails:

- Check Worker logs for `LIFECYCLE` log events
- Verify `FORMS_ENCRYPTION_KEY` is set (`wrangler secret list --env production | grep FORMS_ENCRYPTION_KEY`)
- The job is non-blocking — a failure won't affect live form submissions

### Slow response times

Google Sheets latency is a known Phase 1 constraint (200–800ms). Expected behavior:

- Cold start (after inactivity): up to 5–10s on first request
- Subsequent requests: 200–800ms (Sheets overhead)

Phase 2 (D1 migration) will eliminate this. Until then, latency above 800ms warrants investigation.

---

## Priority Stack (Security Reference)

Operational decisions follow this priority order:

1. **No data loss** — PII retention and destruction schedules must be honored
2. **No auth bypass** — Admin endpoints must never be publicly accessible without a valid token
3. **No cross-env contamination** — Production D1 must never be touched by staging/local workflows
4. **Availability** — Platform should serve events to the public

> Note: `SECURITY-GUARDRAILS.md` has not yet been created. This priority stack is derived from CI gates and CLAUDE.md architecture decisions. Create `SECURITY-GUARDRAILS.md` as a follow-up (OUR backlog).

---

## Related Documentation

- `docs/deployment/CLOUDFLARE_SECRETS.md` — Full secrets inventory and rotation schedule
- `.github-secrets-required.json` — Machine-readable secrets manifest
- `workers/oursharedevents/wrangler.toml` — Worker config, environments, D1 bindings, cron triggers
- `.github/workflows/oursharedevents-ci.yml` — Full CI/CD pipeline definition
- `docs/migration/` — Phase implementation guides
- `STORIES.md` — Active work queue

---

---

# ARCHIVED: Legacy eventangle.com Runbook

> **Archived:** 2026-03-31 — Content below is from the pre-ourSharedEvents era (eventangle.com platform).
> Kept for reference per no-delete policy. The active runbook is above.

---

## Quick Reference (ARCHIVED — eventangle.com)

**External uptime / SLO is measured via `?p=status`.**

### Health Check URLs

| Check                         | URL                                             | Expected Response                        |
| ----------------------------- | ----------------------------------------------- | ---------------------------------------- |
| Ping                          | `https://www.eventangle.com/ping`               | `{"status":"ok"}`                        |
| Status (SLO anchor)           | `https://www.eventangle.com/status`             | `{"ok":true,"db":{"ok":true},...}`       |
| Setup                         | `https://www.eventangle.com/status?p=setup`     | 6-point diagnostic                       |
| **Backend Health (Story B3)** | `https://stg.eventangle.com/api/health/backend` | `{"ok":true,"backend":"cloudflare",...}` |

### Data Health Sheets

| Sheet         | Purpose                                                                                 |
| ------------- | --------------------------------------------------------------------------------------- |
| `DATA_ISSUES` | Issues found by nightly health checker - **check this first if system is acting weird** |
| `DIAG`        | Diagnostic logs                                                                         |
| `LOG_ERRORS`  | API error logs                                                                          |

### Quick Commands

```bash
# Basic health check
curl -s https://www.eventangle.com/ping

# Detailed status
curl -s https://www.eventangle.com/status | jq

# Full diagnostics
curl -s "https://www.eventangle.com/status?p=setup&brand=root" | jq

# Backend health (Story B3 - staging)
curl -s https://stg.eventangle.com/api/health/backend | jq

# Backend health (Story B3 - production)
curl -s https://www.eventangle.com/api/health/backend | jq
```

---

## Incident Response (ARCHIVED)

### When Alerted

**Step 1: Acknowledge** (0-2 minutes)

- Mark alert as acknowledged in monitoring tool
- Note the time and initial symptoms

**Step 2: Verify** (2-5 minutes)

```bash
# Try the ping endpoint
curl -s -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" \
  https://www.eventangle.com/ping

# If that fails, try direct GAS URL (bypasses Cloudflare)
curl -s -w "\nHTTP Status: %{http_code}\n" \
  "https://script.google.com/macros/s/AKfycbyS1cW9VhviR-Jr8AmYY_BAGrb1gzuKkrgEBP2M3bMdqAv4ktqHOZInWV8ogkpz5i8SYQ/exec?p=ping"
```

**Step 3: Diagnose** (5-15 minutes)

- See specific issue sections below

**Step 4: Resolve or Escalate** (15+ minutes)

- Apply fix from runbook
- Or escalate to development team

---

## Common Issues (ARCHIVED — eventangle.com)

### Issue: Ping Returns Non-200

**Symptoms:**

- Uptime monitor alerts "DOWN"
- `curl` returns HTTP 5xx or no response

**Diagnostic Steps:**

1. **Check Cloudflare status**
   - Visit https://www.cloudflarestatus.com/
   - Look for incidents affecting Workers

2. **Check Google Apps Script status**
   - Visit https://www.google.com/appsstatus
   - Look for Apps Script service issues

3. **Test direct GAS URL** (bypasses Cloudflare):

   ```bash
   curl -s "https://script.google.com/macros/s/AKfycbyS1cW9VhviR-Jr8AmYY_BAGrb1gzuKkrgEBP2M3bMdqAv4ktqHOZInWV8ogkpz5i8SYQ/exec?p=ping"
   ```

4. **Check Cloudflare Worker logs**:
   - Log in to Cloudflare Dashboard
   - Go to Workers > eventangle-events
   - Check "Logs" tab for errors

**Resolution:**

- If GAS is down: Wait for Google to restore service
- If Cloudflare is down: Wait for Cloudflare to restore service
- If both are up but site is down: Check recent deployments

---

### Issue: Backend Health Check Fails (Story B3)

**Error Code Reference:**

| Error Code                          | Cause                                                           | Fix                                      |
| ----------------------------------- | --------------------------------------------------------------- | ---------------------------------------- |
| `GOOGLE_AUTH_MISSING_SECRET`        | Missing `GOOGLE_SA_CLIENT_EMAIL` or `GOOGLE_SA_PRIVATE_KEY_PEM` | Set secrets via `wrangler secret put`    |
| `GOOGLE_AUTH_KEY_IMPORT_FAILED`     | Invalid PEM format                                              | Regenerate key from Google Cloud Console |
| `GOOGLE_AUTH_TOKEN_EXCHANGE_FAILED` | OAuth exchange failed                                           | Verify Sheets API is enabled             |
| `SHEETS_READ_FAILED`                | Can't read spreadsheet                                          | Share sheet with service account email   |
| `SHEETS_DB_ID_MISSING`              | Missing `SHEETS_SPREADSHEET_ID`                                 | Set the spreadsheet ID secret            |

---

## Monitoring Dashboard Locations (ARCHIVED — eventangle.com)

### UptimeRobot

- Dashboard: https://uptimerobot.com/dashboard

### Cloudflare

- Worker analytics: https://dash.cloudflare.com/ > Workers > eventangle-events > Analytics
- Request logs: Workers > eventangle-events > Logs

### GitHub Actions

- Deployments: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions

---

## Escalation Contacts (ARCHIVED — eventangle.com)

| Role              | Contact             | When to Escalate      |
| ----------------- | ------------------- | --------------------- |
| Primary On-Call   | (configure in team) | First responder       |
| Backend Developer | (configure in team) | GAS/API issues        |
| Infrastructure    | (configure in team) | Cloudflare/DNS issues |

---

## Data Health Checker (ARCHIVED — eventangle.com)

### Overview

The Data Health Checker (`DataHealthChecker.gs`) provides nightly sanity checking for EVENTS and DIAG sheets.

**If the system is acting weird, check the DATA_ISSUES sheet first!**

### Automatic Nightly Checks

The health checker runs automatically every night at 3 AM (after DIAG archiving at 2 AM).

### What Gets Checked

| Check                   | Severity | Description                                         |
| ----------------------- | -------- | --------------------------------------------------- |
| EVENTS required fields  | ERROR    | id, slug, brandId, templateId, dataJSON, createdAt  |
| EVENTS contract fields  | ERROR    | name, startDateISO, venue, links._, ctas.primary._  |
| EVENTS settings fields  | WARN     | settings.showSchedule, showStandings, showBracket   |
| DIAG required fields    | ERROR    | ts, level, where, msg                               |
| Orphan event references | WARN     | DIAG/ANALYTICS rows referencing non-existent events |

---

## Related Documentation (ARCHIVED)

- [UPTIME_MONITORING.md](./UPTIME_MONITORING.md) - Setting up external monitoring
- [SETUP_DIAGNOSTICS.md](./SETUP_DIAGNOSTICS.md) - 6-point setup verification
- [DEPLOYMENT.md](../DEPLOYMENT.md) - Deployment procedures
- [CLOUDFLARE_SECRETS.md](./CLOUDFLARE_SECRETS.md) - Cloudflare Worker secrets reference

---

**Archive Note:** eventangle.com section archived 2026-03-31. Original last updated: 2025-12-14.
