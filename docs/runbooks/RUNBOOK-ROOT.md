# RUNBOOK: Releases, Incidents & SEV Response

**When something breaks, you don't want to think. You want steps.**

This document is your single source of truth for:

- How to cut a release
- SEV definitions and response procedures
- Production incident handling

Read it before you need it.

---

## Table of Contents

1. [How to Cut a Release](#1-how-to-cut-a-release)
2. [SEV Ladder](#2-sev-ladder)
3. [System Health Checks](#3-system-health-checks)
4. [Common Failure Scenarios](#4-common-failure-scenarios)
   - [4.5 Events Sheet Corrupted or Data Loss](#45-events-sheet-corrupted-or-data-loss)
5. [Rollback Procedures](#5-rollback-procedures)
6. [Escalation Guide](#6-escalation-guide)
7. [Quick Reference](#7-quick-reference)
8. [Backup Strategy](#8-backup-strategy)

---

## 1. How to Cut a Release

### Pre-Release Checklist

Before starting a release:

- [ ] `npm run ci:all` passes locally
- [ ] No open SEV1 or SEV2 incidents
- [ ] Avoid releasing on Fridays, holidays, or during peak traffic
- [ ] Synthetic health checks passing (Story 3.2):
  ```bash
  npm run test:synthetic:staging
  ```

**Golden Rule: We do not ship if Triangle Happy Path fails on staging.**

### Release Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    RELEASE PIPELINE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. CREATE PR TO MAIN                                            │
│     git push -u origin feature/my-feature                        │
│                                                                  │
│  2. STAGE 1 CI (Automatic)                                       │
│     ├── Lint (ESLint)                                            │
│     ├── Unit Tests (Jest)                                        │
│     ├── Contract Tests (schema consistency)                      │
│     ├── MVP Guards (surfaces, dead exports)                      │
│     └── CI:ALL Gate                                              │
│                                                                  │
│  3. MERGE PR → Triggers Stage 1 Deploy                           │
│     ├── Deploy to Apps Script                                    │
│     └── Update Cloudflare Worker                                 │
│                                                                  │
│  4. STAGE 2 TESTS (Automatic)                                    │
│     ├── API Tests (critical path)                                │
│     ├── Smoke Packs (4 core tests)                               │
│     │   ├── pages.smoke.test.js                                  │
│     │   ├── integration.smoke.test.js                            │
│     │   ├── components.smoke.test.js                             │
│     │   └── api.smoke.test.js                                    │
│     ├── E2E Smoke Tests                                          │
│     ├── Expensive Tests (flows, pages)                           │
│     └── 🏆 GOLDEN TEST (Triangle Happy Path)                     │
│         Admin → Public → Display → SharedReport                  │
│         ⚠️ BLOCKS RELEASE IF FAILS                               │
│                                                                  │
│  5. VERIFY PRODUCTION                                            │
│     npm run test:prod:smoke                                      │
│                                                                  │
│  6. MONITOR (30 min post-deploy)                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Step-by-Step Commands

```bash
# 1. Ensure local tests pass
npm run ci:all

# 2. Create PR
git push -u origin feature/my-feature
# Open PR to main in GitHub

# 3. Wait for Stage 1 CI (watch Actions tab)

# 4. Merge PR
# Stage 1 deploy + Stage 2 tests run automatically

# 5. Verify production after Stage 2
npm run test:prod:smoke
npm run test:prod:health

# 6. Spot check all brands
curl -s https://www.oursharedevents.com/status | jq '.ok'
curl -s https://www.oursharedevents.com/abc/status | jq '.ok'
curl -s https://www.oursharedevents.com/cbc/status | jq '.ok'
curl -s https://www.oursharedevents.com/cbl/status | jq '.ok'
```

### Release Gates Summary

| Gate                    | Tests                                                   | Blocks                |
| ----------------------- | ------------------------------------------------------- | --------------------- |
| **Stage 1 CI**          | lint, unit, contract, MVP guards                        | Deploy to Apps Script |
| **Stage 2 API**         | api.contract, api.smoke                                 | Smoke Packs           |
| **Stage 2 Smoke Packs** | 4 core smoke tests                                      | E2E smoke tests       |
| **Stage 2 E2E**         | smoke, flows, pages                                     | Golden Test           |
| **Stage 2 Golden Test** | Triangle Happy Path (Admin→Public→Display→SharedReport) | Production approval   |
| **Production Gate**     | Quality Gate + CI:ALL + Golden Test                     | Production deployment |

---

## 2. SEV Ladder

### SEV Definitions

| SEV      | Definition                                  | Response Time   | Who            |
| -------- | ------------------------------------------- | --------------- | -------------- |
| **SEV1** | Complete outage or data loss risk           | **< 15 min**    | All hands      |
| **SEV2** | Major feature broken, single brand affected | **< 1 hour**    | On-call        |
| **SEV3** | Minor feature degraded, workaround exists   | **< 4 hours**   | Next available |
| **SEV4** | Cosmetic or low-impact                      | **Next sprint** | Backlog        |

### SEV1 Triggers (Immediate Action)

| Trigger                        | Detection                      | Example                                             |
| ------------------------------ | ------------------------------ | --------------------------------------------------- |
| **Status endpoint 500**        | `/status` returns error        | `curl https://www.oursharedevents.com/status` fails |
| **All brands unreachable**     | All `/events` return 5xx       | Complete public outage                              |
| **Cloudflare Worker down**     | 522/523 errors                 | Proxy layer broken                                  |
| **Apps Script quota exceeded** | 403 with quota message         | Backend unreachable                                 |
| **Data corruption**            | Events missing/malformed       | DATA_ISSUES sheet has RED rows                      |
| **Auth system broken**         | Admin operations fail globally | Cannot manage events                                |

**SEV1 Immediate Actions:**

```bash
# 1. Confirm outage
curl -s https://www.oursharedevents.com/status | jq '.ok'

# 2. If false or error → check if recent deploy
gh run list --workflow="Stage 1 - Build & Deploy" --limit 5

# 3. ROLLBACK immediately if recent deploy caused it
git revert HEAD && git push origin main
# OR manual rollback (see Section 5)

# 4. Verify recovery
npm run test:prod:health

# 5. Communicate to stakeholders
# 6. Create incident issue within 24 hours
```

### SEV2 Triggers (Urgent Response)

| Trigger                         | Detection                        | Example                    |
| ------------------------------- | -------------------------------- | -------------------------- |
| **Single brand broken**         | `/abc/status` fails, others work | ABC organization affected  |
| **Sponsor display broken**      | Sponsors not rendering           | Partner visibility issue   |
| **Bundle contract failure**     | `bundles.contract.test.js` fails | API structure broke        |
| **Admin panel unusable**        | Cannot create/edit events        | Event management blocked   |
| **Display page broken**         | `/display` not rendering         | TV/kiosk displays affected |
| **Contract test failure in CI** | Schema drift detected            | API breaking changes       |

**SEV2 Immediate Actions:**

```bash
# 1. Identify affected brand/feature
for brand in root abc cbc cbl; do
  echo "$brand: $(curl -s https://www.oursharedevents.com/$brand/status | jq -r '.ok')"
done

# 2. Isolate: Is it brand-specific or code?
# Single brand → likely config/data issue
# All brands → likely code issue

# 3. (Optional) Disable affected brand if needed
# Edit cloudflare-proxy/worker.js VALID_BRANDS

# 4. Investigate with contract tests
npm run test:contract

# 5. Fix via hotfix branch
git checkout -b hotfix/fix-issue
# ... fix ...
npm run ci:all
# Create PR and merge
```

### SEV3 Triggers (Standard Response)

| Trigger                       | Detection                 | Example                 |
| ----------------------------- | ------------------------- | ----------------------- |
| **Slow responses**            | > 5s page loads           | Degraded experience     |
| **Single smoke test failing** | One test in pack fails    | Partial feature issue   |
| **Poster QR broken**          | QR not generating         | Poster feature degraded |
| **Minor UI issues**           | CSS/layout problems       | Visual only             |
| **Analytics drift**           | Reporting inconsistencies | Data accuracy reduced   |

### Contract Test Failure Response

When contract tests fail, API structure has changed unexpectedly:

```bash
# 1. Identify which contract failed
npm run test:contract 2>&1 | grep -A5 "FAIL"

# 2. Key contract files:
#    bundles.contract.test.js     → Event bundle structure
#    sponsor-contract.test.js     → Sponsor data format
#    schema-consistency.contract  → JSON schemas match ApiSchemas.gs
#    envelope-boundary.contract   → API envelope structure

# 3. If intentional → update contract + schemas
# 4. If unintentional → rollback the code change
```

### Sponsor Display Broken Response

```bash
# 1. Check sponsor endpoint
curl -s "https://www.oursharedevents.com/events?action=api_listSponsors&brand=root" | jq

# 2. Verify sponsor contract
npm test -- tests/contract/sponsor-contract.test.js

# 3. Check multi-brand isolation
npm test -- tests/contract/sponsor-brand-isolation.smoke.test.js
```

---

## 3. System Health Checks

**External uptime / SLO is measured via `?p=status`.**

### 3.1 URLs to Verify System Status

| Check                   | URL                                              | What You're Looking For                                |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| **Ping** (fastest)      | `https://www.oursharedevents.com/ping`           | `{"status":"ok"}`                                      |
| **Status** (SLO anchor) | `https://www.oursharedevents.com/status`         | `{"ok":true,"buildId":"mvp-v19","db":{"ok":true},...}` |
| **Setup Diagnostics**   | `https://www.oursharedevents.com/status?p=setup` | 6-point diagnostic check                               |
| **Staging**             | `https://stg.oursharedevents.com/ping`           | Verify staging is separate from prod                   |

### 3.2 External Uptime Dashboard

| Service               | Dashboard URL                          | What to Check                          |
| --------------------- | -------------------------------------- | -------------------------------------- |
| **UptimeRobot**       | https://uptimerobot.com/dashboard      | Response time trends, downtime history |
| **Pingdom**           | https://my.pingdom.com/                | SLA reports, incident timeline         |
| **Cloudflare**        | https://dash.cloudflare.com/ > Workers | Request volume, error rates, CPU time  |
| **Google Status**     | https://www.google.com/appsstatus      | Apps Script service status             |
| **Cloudflare Status** | https://www.cloudflarestatus.com/      | Workers outages                        |

### 3.3 Critical Sheets to Check

Open the production spreadsheet and check these sheets:

| Sheet           | Purpose                      | What to Look For                                     |
| --------------- | ---------------------------- | ---------------------------------------------------- |
| **DATA_ISSUES** | Nightly health check results | Red rows = ERROR (fix immediately), Yellow = WARNING |
| **DIAG**        | Diagnostic logs              | Recent errors, timestamps, stack traces              |
| **LOG_ERRORS**  | API error log                | Error spikes, correlation IDs, patterns              |
| **EVENTS**      | Event data                   | Row count, recent entries, data integrity            |
| **ANALYTICS**   | Metrics data                 | Metric logging working, no gaps                      |

**Quick Sheet Health Assessment:**

```
DATA_ISSUES empty?     → Good, nightly check found no issues
DATA_ISSUES has RED?   → Stop. Fix these before anything else.
DIAG growing normally? → Good, logging is working
DIAG stale (>24hr)?    → Bad, something stopped logging
```

### 3.4 Quick Health Commands

```bash
# Quick ping - should return instantly
curl -s https://www.oursharedevents.com/ping

# Detailed status with timing
curl -s -w "\nHTTP: %{http_code} | Time: %{time_total}s\n" \
  https://www.oursharedevents.com/status | jq

# Full 6-point diagnostic
curl -s "https://www.oursharedevents.com/status?p=setup&brand=root" | jq '.value.checks'

# Bypass Cloudflare - test GAS directly
curl -s "https://script.google.com/macros/s/AKfycbyS1cW9VhviR-Jr8AmYY_BAGrb1gzuKkrgEBP2M3bMdqAv4ktqHOZInWV8ogkpz5i8SYQ/exec?p=ping"

# Check current build ID
curl -s https://www.oursharedevents.com/status | jq '.buildId'
```

### 3.5 Synthetic Health Checks (Story 3.2)

Synthetic health checks validate `/health/origin` and `/events` endpoints with specific assertions.

```bash
# Run synthetic health checks for staging
npm run test:synthetic:staging

# Run synthetic health checks for production
npm run test:synthetic:prod

# Get JSON output for CI/CD
npm run test:synthetic:json
```

**Alert Routing Logic:**

| Scenario                                 | Interpretation       | Action                               |
| ---------------------------------------- | -------------------- | ------------------------------------ |
| `/health/origin` fails, `/events` passes | Config drift         | Check `UPSTREAM_WEBAPP_URL` env var  |
| `/events` fails, `/health/origin` passes | Frontend/route issue | Check worker routing, HTML templates |
| Both fail                                | System down          | Check Cloudflare Workers status      |

**Manual endpoint checks:**

```bash
# Check /health/origin
curl -s https://stg.oursharedevents.com/health/origin | jq

# Verify assertions
curl -s https://stg.oursharedevents.com/health/origin | jq '{ok, env}'
# Expected: {"ok":true,"env":"staging"}

# Check /events page
curl -s -o /dev/null -w "%{http_code}" https://stg.oursharedevents.com/events
# Expected: 200

# Check events page marker
curl -s https://stg.oursharedevents.com/events | grep -o 'data-testid="events-root"'
# Expected: data-testid="events-root"
```

See: [docs/SYNTHETIC_MONITORING.md](./docs/SYNTHETIC_MONITORING.md) for full setup guide.

---

## 4. Common Failure Scenarios

### 4.1 GAS Errors / Deployment Issues

**Symptoms:**

- 500 errors from oursharedevents.com
- Status returns `"ok": false`
- Error messages mention "Script error" or "Service unavailable"
- Everything was working, then a deployment happened

**Diagnosis Checklist:**

1. Check recent GitHub Actions: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions
2. Compare build IDs: `curl -s https://www.oursharedevents.com/status | jq '.buildId'`
3. Check Google Apps Script status: https://www.google.com/appsstatus
4. Test GAS directly (bypasses Cloudflare):
   ```bash
   curl -s "https://script.google.com/macros/s/AKfycbyS1cW9VhviR-Jr8AmYY_BAGrb1gzuKkrgEBP2M3bMdqAv4ktqHOZInWV8ogkpz5i8SYQ/exec?p=status"
   ```

**Resolution:**

- **If GAS direct URL works but oursharedevents.com doesn't:** Problem is Cloudflare Worker (see 2.2)
- **If GAS direct URL also fails:**
  - Check Google Apps Script status page
  - If Google is up, recent deployment likely broke something → **Rollback GAS** (see 3.1)
- **If quota errors:** Wait 24 hours or contact Google Workspace admin

---

### 4.2 Worker Misrouting

**Symptoms:**

- Requests go to wrong backend or return 404
- Some routes work, others don't
- Brand-specific URLs broken
- Friendly URLs (`/manage`, `/display`) not resolving

**Diagnosis Checklist:**

1. Check Cloudflare Worker logs: Dashboard > Workers > oursharedevents-events > Logs
2. Test specific routes:

   ```bash
   # Test friendly URL routing
   curl -s -I https://www.oursharedevents.com/manage
   curl -s -I https://www.oursharedevents.com/display
   curl -s -I https://www.oursharedevents.com/abc/events

   # Check X-Proxied-By header
   curl -s -I https://www.oursharedevents.com/ping | grep -i x-proxied
   ```

3. Verify `DEPLOYMENT_ID` in wrangler.toml matches production GAS deployment

**Resolution:**

- **Wrong DEPLOYMENT_ID:** Update `cloudflare-proxy/wrangler.toml` and redeploy worker
- **Route pattern issue:** Check `wrangler.toml` route patterns, redeploy
- **Worker crashed:** Check Cloudflare dashboard for errors, may need to **Rollback Worker** (see 5.2)

---

### 4.3 Broken SharedReport / Analytics

**Symptoms:**

- SharedReport page shows no data or errors
- Analytics metrics not updating
- "No events found" when events exist
- Dashboard shows stale numbers

**Diagnosis Checklist:**

1. Check ANALYTICS sheet: Is it being written to?
2. Check DATA_ISSUES sheet for analytics-related errors
3. Test the analytics bundle endpoint:
   ```bash
   curl -s "https://www.oursharedevents.com/api?action=getSharedAnalytics&brand=root" | jq
   ```
4. Check for recent events with analytics:
   ```bash
   curl -s "https://www.oursharedevents.com/api?action=listEvents&brand=root" | jq '.value | length'
   ```

**Resolution:**

- **ANALYTICS sheet missing:** Will auto-create on next metric write. Force by visiting any public event page.
- **Schema mismatch:** Check `shared-analytics.schema.json` against actual response
- **No metrics for time period:** Analytics only tracks actual visits. Check ANALYTICS sheet has rows.
- **Aggregation broken:** Check `AnalyticsService.gs` for errors, may need code fix via PR

---

### 4.4 DIAG Sheet Full or Archiving Failure

**Symptoms:**

- DIAG sheet has 3000+ rows (max is 3000)
- DIAG_ARCHIVE_YYYY_MM sheets not being created
- "Exceeded maximum execution time" errors in triggers
- Old logs not being rotated

**Diagnosis Checklist:**

1. Count DIAG rows: Open sheet, scroll to bottom or use `COUNTA(A:A)`
2. Check for archive sheets: Look for `DIAG_ARCHIVE_2025_11` pattern
3. Check trigger status in Apps Script:
   - Open Apps Script editor
   - Go to Triggers (clock icon)
   - Look for `archiveDiagLogs_` trigger
4. Check LOG_ERRORS for archiver errors

**Resolution:**

**If DIAG is full (3000+ rows):**

```javascript
// Run manually in Apps Script editor
archiveDiagLogs_();
```

**If archiver trigger missing:**

```javascript
// Install the trigger
installDiagArchiveTrigger_();
```

**If archiver is failing:**

1. Check LOG_ERRORS for specific error
2. Common issue: Quota exceeded - wait 24h or batch smaller
3. Manual emergency cleanup:
   - Copy DIAG data to a new sheet manually
   - Clear DIAG sheet (keep headers)
   - Document in GitHub issue

**Prevention:**

- Archiver should run nightly at 2 AM
- Health checker runs at 3 AM after archiver
- If both triggers are missing, reinstall:
  ```javascript
  installDiagArchiveTrigger_();
  installDataHealthTrigger_();
  ```

---

## 4.5 Events Sheet Corrupted or Data Loss

**Symptoms:**

- Events missing or showing incorrect data
- DATA_ISSUES sheet shows RED rows for event validation
- "Event not found" errors for known events
- Blank or malformed event pages
- Admin shows fewer events than expected

**Diagnosis Checklist:**

1. Check DATA_ISSUES sheet for specific errors
2. Compare current EVENTS row count with expected
3. Check DIAG logs for recent bulk operations or errors
4. Verify backup sheets exist: Look for `BACKUP_YYYY_MM_DD_HHMM` tabs

**Resolution:**

### Option A: Restore from Script Backup (Preferred)

If `backupControlSheet()` has been running:

```javascript
// 1. List available backups (run in Apps Script editor)
listBackups_();

// 2. Check backup stats to find latest good backup
getBackupStats_();

// 3. Dry run restore to validate (doesn't change data)
restoreFromBackup_('BACKUP_2025_12_03_1030', null, { dryRun: true });

// 4. Perform actual restore
restoreFromBackup_('BACKUP_2025_12_03_1030');
```

### Option B: Restore from Manual Backup

If you have a manual spreadsheet copy:

1. Open the backup spreadsheet copy
2. Select the EVENTS sheet tab
3. Right-click → "Copy to..." → Select production spreadsheet
4. Rename original EVENTS to `EVENTS_CORRUPTED_YYYYMMDD`
5. Rename copied sheet to `EVENTS`
6. Verify event count matches expected
7. Test: `curl -s "https://www.oursharedevents.com/api?action=listEvents&brand=root" | jq '.value | length'`

### Option C: Partial Recovery from Archives

If DIAG_ARCHIVE sheets exist with event creation logs:

1. Search DIAG_ARCHIVE sheets for `saveEvent` entries
2. Extract event data from log metadata
3. Manually recreate missing events through Admin UI
4. Document which events were recovered

### Post-Recovery Verification

```bash
# Verify events are accessible
curl -s "https://www.oursharedevents.com/api?action=listEvents&brand=root" | jq '.value | length'

# Test a specific event
curl -s "https://www.oursharedevents.com/api?action=getPublicBundle&slug=test-event&brand=root" | jq '.ok'

# Check for data issues
# Open DATA_ISSUES sheet - should be empty or have only warnings
```

**Prevention:**

- Run weekly manual backups before major changes
- Enable scheduled `backupControlSheet()` trigger
- Monitor backup health via `getBackupStats_()`

---

## 5. Rollback Procedures

### 5.1 Roll Back Apps Script Deployment

**When to use:** GAS code is broken, need to restore previous version.

**Option A: Git Revert (Preferred - Uses CI)**

```bash
# This is the safest option - CI tests the revert before deploying
git revert HEAD
git push origin main
# Wait for CI to deploy (~3-5 minutes)
```

**Option B: Manual Rollback (Emergency Only)**

Use this ONLY if CI is completely broken:

1. **Open Apps Script Deployments:**
   https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/deployments

2. **Find Previous Working Version:**
   - Click on the web app deployment
   - Click "Manage versions"
   - Note the current version number
   - Find the last known-good version (check GitHub Actions history for deployment times)

3. **Edit Deployment:**
   - Click pencil icon to edit
   - Change "Version" to the previous good version
   - Click "Deploy"

4. **Verify:**

   ```bash
   curl -s https://www.oursharedevents.com/ping
   curl -s https://www.oursharedevents.com/status | jq '.buildId'
   ```

5. **Document Immediately:**
   - Create GitHub issue explaining what happened
   - Note the version numbers involved
   - Fix the underlying issue via proper PR

---

### 5.2 Roll Back Cloudflare Worker

**When to use:** Worker code is broken, routing is wrong, or wrong DEPLOYMENT_ID.

**Option A: Redeploy Previous Code (Preferred)**

```bash
# Check out previous working commit
git log --oneline cloudflare-proxy/worker.js
git checkout HEAD~1 -- cloudflare-proxy/worker.js cloudflare-proxy/wrangler.toml

# Or revert the entire cloudflare-proxy directory
git checkout <last-good-commit> -- cloudflare-proxy/

# Deploy
cd cloudflare-proxy && wrangler deploy --env events
```

**Option B: Cloudflare Dashboard Rollback**

1. **Open Cloudflare Dashboard:**
   https://dash.cloudflare.com/ > Workers & Pages > oursharedevents-events

2. **View Deployments:**
   - Click "Deployments" tab
   - Find previous deployment (shows timestamp)
   - Click "Rollback to this deployment"

3. **Verify:**
   ```bash
   curl -s -I https://www.oursharedevents.com/ping | grep -i x-worker-version
   curl -s https://www.oursharedevents.com/status
   ```

**Option C: Fix DEPLOYMENT_ID Mismatch**

If the Worker is pointing to wrong GAS deployment:

1. Get current production GAS deployment ID from Apps Script
2. Edit `cloudflare-proxy/wrangler.toml`:
   ```toml
   [env.events.vars]
   GAS_DEPLOYMENT_BASE_URL = "https://script.google.com/macros/s/CORRECT_ID_HERE/exec"
   DEPLOYMENT_ID = "CORRECT_ID_HERE"
   ```
3. Deploy: `cd cloudflare-proxy && wrangler deploy --env events`

---

## 6. Escalation Guide

### 6.1 If Harbor Calls During a Failure

Harbor is likely your operations partner or client. They're calling because something is broken and customers are affected.

**What You Say:**

> "I'm aware of the issue and actively working on it. Let me get you a status update in [X] minutes."

**What You Do:**

1. **Acknowledge** - Note the time and what they're reporting
2. **Don't guess** - Follow the diagnosis steps below
3. **Communicate** - Give updates every 15 minutes until resolved
4. **Document** - Create incident report after

**First 5 Minutes:**

```bash
# Run these immediately
curl -s https://www.oursharedevents.com/ping
curl -s https://www.oursharedevents.com/status | jq '.ok'
curl -s "https://www.oursharedevents.com/status?p=setup" | jq '.value.checks[] | select(.ok == false)'
```

**Report template:**

> "The [ping/status/events] endpoint is [working/failing]. Error is [specific error]. Checking [GAS/Cloudflare/Data]. ETA for update: [time]."

---

### 6.2 If a Bar Can't See Their Event

**What they're probably experiencing:**

- "My event isn't showing up"
- "The page is blank"
- "It says no events found"

**Triage Questions:**

1. What URL are they using?
2. What brand are they (root, abc, cbc, cbl)?
3. When did they create the event?
4. Can they see the admin page?

**Diagnostic Steps:**

**Check 1: Is the event in the database?**

```bash
# List events for the brand
curl -s "https://www.oursharedevents.com/api?action=listEvents&brand=abc" | jq '.value[] | {id, slug, name}'
```

**Check 2: Is the specific event accessible?**

```bash
# Get the event by slug
curl -s "https://www.oursharedevents.com/api?action=getEvent&slug=their-event-slug&brand=abc" | jq
```

**Check 3: Is the public bundle loading?**

```bash
# Get the public bundle
curl -s "https://www.oursharedevents.com/api?action=getPublicBundle&slug=their-event-slug&brand=abc" | jq '.ok'
```

**Common Causes & Fixes:**

| Problem         | Symptom                              | Fix                                |
| --------------- | ------------------------------------ | ---------------------------------- |
| Wrong brand     | Event exists but not for their brand | Have them use correct brand URL    |
| Event not saved | Not in listEvents                    | Check admin, re-save event         |
| Slug typo       | getEvent returns not found           | Verify exact slug spelling         |
| Data corruption | DATA_ISSUES has errors               | Fix data issues first              |
| Caching         | Old data showing                     | Clear browser cache, try incognito |

---

### 6.3 What to Check First, Second, Third

When something's broken and you don't know why:

#### First (0-2 minutes): Is the system alive?

```bash
curl -s -w "Time: %{time_total}s\n" https://www.oursharedevents.com/ping
```

- **If fails:** System is down. Check Cloudflare status, Google status.
- **If slow (>5s):** Cold start or performance issue.
- **If ok:** System is alive, problem is specific.

#### Second (2-5 minutes): Where is it broken?

```bash
# Test Cloudflare → GAS chain
curl -s https://www.oursharedevents.com/status | jq '.ok'

# Test GAS directly (bypass Cloudflare)
curl -s "https://script.google.com/macros/s/AKfycbyS1cW9VhviR-Jr8AmYY_BAGrb1gzuKkrgEBP2M3bMdqAv4ktqHOZInWV8ogkpz5i8SYQ/exec?p=status" | jq '.ok'
```

- **Cloudflare fails, GAS works:** Cloudflare Worker issue
- **Both fail:** GAS issue (deployment or Google outage)
- **Both work:** Problem is specific feature/data

#### Third (5-15 minutes): What specifically broke?

```bash
# Run full diagnostics
curl -s "https://www.oursharedevents.com/status?p=setup&brand=root" | jq '.value.checks'
```

Check each diagnostic point:

1. Brand Config - Is the brand configured?
2. Spreadsheet Access - Can we read/write?
3. Secrets - Are admin secrets set?
4. Sheets - Do required sheets exist?
5. Events - Are there any events?
6. Analytics - Is analytics healthy?

**Then check DATA_ISSUES sheet for data-level problems.**

---

### 6.4 Escalation Contacts

| Situation                 | First Contact         | Escalate To            |
| ------------------------- | --------------------- | ---------------------- |
| Worker routing issues     | On-call engineer      | Cloudflare support     |
| GAS deployment broken     | On-call engineer      | Google Workspace admin |
| Data corruption           | On-call engineer      | Database owner         |
| Sustained outage (>30min) | On-call engineer      | Team lead              |
| Security incident         | Team lead immediately | Security team          |

**Configure your team's contacts:**

```
Primary On-Call: [Name] - [Phone] - [Slack]
Backup On-Call:  [Name] - [Phone] - [Slack]
Team Lead:       [Name] - [Phone] - [Slack]
```

---

## 7. Quick Reference

### 7.1 Key URLs

| Resource                | URL                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| Production              | https://www.oursharedevents.com                                                                               |
| Staging                 | https://stg.oursharedevents.com                                                                               |
| Apps Script Project     | https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l             |
| Apps Script Deployments | https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/deployments |
| Cloudflare Dashboard    | https://dash.cloudflare.com/ > Workers > oursharedevents-events                                               |
| GitHub Actions          | https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions                                                      |
| Google Status           | https://www.google.com/appsstatus                                                                             |
| Cloudflare Status       | https://www.cloudflarestatus.com/                                                                             |

### 7.2 Key IDs

| ID                       | Value                                                                        | Purpose                           |
| ------------------------ | ---------------------------------------------------------------------------- | --------------------------------- |
| GAS Project ID           | `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`                  | Apps Script project               |
| Production Deployment ID | `AKfycbyS1cW9VhviR-Jr8AmYY_BAGrb1gzuKkrgEBP2M3bMdqAv4ktqHOZInWV8ogkpz5i8SYQ` | GAS exec URL                      |
| Build ID                 | `mvp-v19`                                                                    | Current version (check Config.gs) |
| Contract Version         | `1.0.0`                                                                      | API contract version              |

### 7.3 Emergency Commands

```bash
# Is it alive?
curl -s https://www.oursharedevents.com/ping

# What version is running?
curl -s https://www.oursharedevents.com/status | jq '{ok,buildId}'

# What's broken?
curl -s "https://www.oursharedevents.com/status?p=setup" | jq '.value.checks[] | select(.ok==false)'

# Bypass Cloudflare
curl -s "https://script.google.com/macros/s/AKfycbyS1cW9VhviR-Jr8AmYY_BAGrb1gzuKkrgEBP2M3bMdqAv4ktqHOZInWV8ogkpz5i8SYQ/exec?p=ping"

# Git revert (emergency rollback via CI)
git revert HEAD && git push origin main

# Manual worker deploy (emergency)
cd cloudflare-proxy && wrangler deploy --env events
```

### 7.4 Post-Incident Checklist

After any incident:

- [ ] Update status page (if applicable)
- [ ] Create GitHub issue with incident report
- [ ] Document: time detected, time resolved, root cause, fix applied
- [ ] Update this runbook if procedures were unclear or missing
- [ ] Schedule post-mortem if incident lasted >30 minutes
- [ ] Verify monitoring caught the issue (add alerts if not)

---

## 8. Backup Strategy

### 8.1 Backup Options

#### Option A: Manual Backup (Minimum)

If you're just getting started, this is the bare minimum:

1. **Weekly:** Open the master spreadsheet
2. File → Make a copy
3. Name it: `MVP-EVENT-TOOLKIT-BACKUP-YYYY-MM-DD`
4. Store in a "Backups" folder in Google Drive
5. Keep at least 4 weeks of backups

**When to make extra backups:**

- Before any major code deployment
- Before bulk data operations
- Before giving new team members edit access

#### Option B: Scripted Backup (Recommended)

Use `backupControlSheet()` for automated, in-spreadsheet backups:

```javascript
// Run manually in Apps Script editor
const result = backupControlSheet();
console.log(result);
// Returns: { ok: true, value: { backupId: "BACKUP_2025_12_03_1030", ... } }
```

**What gets backed up:**

- EVENTS (all event data)
- SPONSORS (sponsor configurations)
- ANALYTICS (metrics data)
- TEMPLATES (event templates)

**Backup naming:** `BACKUP_YYYY_MM_DD_HHMM` (e.g., `BACKUP_2025_12_03_1030`)

**Retention:** Last 10 backups are kept automatically

### 8.2 Setting Up Scheduled Backups

Scheduled backups are configured via the Cloudflare Worker cron trigger in `wrangler.toml`. No manual installation is required.

### 8.3 Checking Backup Health

```javascript
// Get backup statistics
const stats = getBackupStats_();
console.log(stats);
// Returns:
// {
//   ok: true,
//   value: {
//     totalBackups: 5,
//     maxBackups: 10,
//     latestBackup: { id: "BACKUP_2025_12_03_1030", ageHours: 12 },
//     backupHealth: "good"  // good | stale | critical | none
//   }
// }

// List all available backups
const list = listBackups_();
console.log(list.value.backups);
```

**Health Status Meanings:**

- `good`: Latest backup < 24 hours old
- `stale`: Latest backup 24-72 hours old
- `critical`: Latest backup > 72 hours old
- `none`: No backups exist

### 8.4 Restore Procedure

**CAUTION:** Restore operations overwrite existing data. Always verify the backup first.

```javascript
// Step 1: Dry run to validate backup (doesn't change data)
const dryRun = restoreFromBackup_('BACKUP_2025_12_03_1030', null, { dryRun: true });
console.log(dryRun);
// Check: dryRun.value.sheets shows what would be restored

// Step 2: Perform actual restore
const result = restoreFromBackup_('BACKUP_2025_12_03_1030');
console.log(result);

// Step 3: Verify restoration
// curl -s "https://www.oursharedevents.com/api?action=listEvents&brand=root" | jq '.value | length'
```

**Restore Options:**

- Restore all sheets: `restoreFromBackup_(backupId)`
- Restore specific sheets: `restoreFromBackup_(backupId, null, { sheets: ['EVENTS'] })`

### 8.5 Emergency Commands

```bash
# Check if events are accessible
curl -s "https://www.oursharedevents.com/api?action=listEvents&brand=root" | jq '.value | length'

# Compare with expected count (check EVENTS sheet row count)
# If mismatch → consider restore

# After restore, verify a specific event
curl -s "https://www.oursharedevents.com/api?action=getPublicBundle&slug=test-event&brand=root" | jq '.ok'
```

### 8.6 Backup Best Practices

1. **Test restores periodically** - Don't wait for an emergency to learn the process
2. **Monitor backup health** - Check `getBackupStats_()` weekly
3. **Keep manual backups** - Scripted backups are in the same spreadsheet; keep external copies too
4. **Document recovery** - After any restore, create a GitHub issue documenting what happened
5. **Backup before changes** - Run `backupControlSheet()` before bulk operations

---

## Related Documentation

| Document                                                             | Purpose                                        |
| -------------------------------------------------------------------- | ---------------------------------------------- |
| [docs/RUNBOOK.md](./docs/RUNBOOK.md)                                 | Detailed operational procedures                |
| [docs/UPTIME_MONITORING.md](./docs/UPTIME_MONITORING.md)             | Setting up external monitoring                 |
| [docs/SYNTHETIC_MONITORING.md](./docs/SYNTHETIC_MONITORING.md)       | Cloudflare/Datadog synthetic tests (Story 3.2) |
| [docs/SETUP_DIAGNOSTICS.md](./docs/SETUP_DIAGNOSTICS.md)             | 6-point setup verification                     |
| [DEPLOYMENT.md](./DEPLOYMENT.md)                                     | Deployment procedures                          |
| [PRODUCTION_DEPLOYMENT_POLICY.md](./PRODUCTION_DEPLOYMENT_POLICY.md) | CI-only deployment policy                      |
| [docs/DATA_POLICY.md](./docs/DATA_POLICY.md)                         | Data retention and archiving                   |
| [src/mvp/BackupService.gs](./src/mvp/BackupService.gs)               | Backup/restore implementation                  |

---

**Last Updated:** 2025-12-03

**Remember:** When you're under pressure, don't think. Follow the steps. That's what this document is for.
