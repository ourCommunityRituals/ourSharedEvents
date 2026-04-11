# Synthetic Monitoring Setup

Story 3.2: Synthetic Health for /events + /health/origin

Synthetic monitoring proactively checks your endpoints before users notice problems. This document covers both Cloudflare Health Checks (primary) and Datadog Synthetics (optional).

---

## Overview

### Why Synthetic Monitoring?

You don't want to learn about 410s by staring at Playwright logs. Synthetic tests should be screaming first.

### Endpoints Monitored

| Endpoint          | URL                                        | Assertions                            |
| ----------------- | ------------------------------------------ | ------------------------------------- |
| **Health Origin** | `https://stg.eventangle.com/health/origin` | `ok === true`, `env === "staging"`    |
| **Events Page**   | `https://stg.eventangle.com/events`        | HTTP 200, `data-testid="events-root"` |

### Alert Routing Logic

| Scenario                                 | Interpretation                        | Action                                  |
| ---------------------------------------- | ------------------------------------- | --------------------------------------- |
| `/health/origin` fails, `/events` passes | Config drift (upstream misconfigured) | Check worker env vars, upstream URL     |
| `/events` fails, `/health/origin` passes | Frontend/route issue (not upstream)   | Check worker routing, HTML templates    |
| Both fail                                | Worker down or Cloudflare issue       | Check Cloudflare dashboard, worker logs |
| Both pass                                | System healthy                        | No action needed                        |

---

## Priority 1: Cloudflare Health Checks

Cloudflare Health Checks are the primary synthetic monitoring solution, integrated directly with the Worker infrastructure.

### Setup via Cloudflare Dashboard

1. **Log in to Cloudflare Dashboard**
   - Go to https://dash.cloudflare.com/
   - Select your account and zone (eventangle.com)

2. **Navigate to Traffic > Health Checks**

3. **Create Health Check 1: /health/origin**

   ```
   Name: eventangle-staging-health-origin
   Monitor Type: HTTPS
   URL: https://stg.eventangle.com/health/origin
   Check Interval: 60 seconds (1 minute)
   Retries: 2
   Expected Response:
     - HTTP Status: 200
     - Response Body Contains: "ok":true
     - Response Body Contains: "env":"staging"
   Timeout: 10 seconds
   Headers: (none required)
   ```

4. **Create Health Check 2: /events**
   ```
   Name: eventangle-staging-events
   Monitor Type: HTTPS
   URL: https://stg.eventangle.com/events
   Check Interval: 60 seconds (1 minute)
   Retries: 2
   Expected Response:
     - HTTP Status: 200
     - Response Body Contains: data-testid="events-root"
   Timeout: 15 seconds
   Headers: (none required)
   ```

### Setup via Cloudflare API / Terraform

For infrastructure-as-code, use the Cloudflare API or Terraform provider:

```hcl
# terraform/cloudflare-health-checks.tf

# Health Check 1: /health/origin
resource "cloudflare_healthcheck" "staging_health_origin" {
  zone_id     = var.cloudflare_zone_id
  name        = "eventangle-staging-health-origin"
  description = "Story 3.2 - Synthetic health check for /health/origin"
  address     = "stg.eventangle.com"
  type        = "HTTPS"
  port        = 443
  method      = "GET"
  path        = "/health/origin"

  interval         = 60
  retries          = 2
  timeout          = 10
  consecutive_fails = 2
  consecutive_successes = 2

  expected_codes = ["200"]
  expected_body  = "\"ok\":true"

  header {
    header = "User-Agent"
    values = ["Cloudflare-Health-Check/1.0"]
  }
}

# Health Check 2: /events
resource "cloudflare_healthcheck" "staging_events" {
  zone_id     = var.cloudflare_zone_id
  name        = "eventangle-staging-events"
  description = "Story 3.2 - Synthetic health check for /events page"
  address     = "stg.eventangle.com"
  type        = "HTTPS"
  port        = 443
  method      = "GET"
  path        = "/events"

  interval         = 60
  retries          = 2
  timeout          = 15
  consecutive_fails = 2
  consecutive_successes = 2

  expected_codes = ["200"]
  expected_body  = "data-testid=\"events-root\""

  header {
    header = "User-Agent"
    values = ["Cloudflare-Health-Check/1.0"]
  }
}
```

### Cloudflare Notifications

Configure notifications in Cloudflare Dashboard:

1. **Go to Notifications > Create**
2. **Select "Health Check Events"**
3. **Configure:**
   - Select health checks: both staging checks
   - Alert when: Health check becomes unhealthy
   - Notification method: Webhook (Slack), Email, or PagerDuty
4. **Add Tags:**
   - `service:eventangle`
   - `env:staging`

### Cloudflare Health Check API Reference

```bash
# List health checks
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/healthchecks" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN_ESE" \
  -H "Content-Type: application/json"

# Create health check
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/healthchecks" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN_ESE" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "eventangle-staging-health-origin",
    "address": "stg.eventangle.com",
    "type": "HTTPS",
    "port": 443,
    "path": "/health/origin",
    "interval": 60,
    "retries": 2,
    "timeout": 10,
    "expected_codes": ["200"],
    "expected_body": "\"ok\":true"
  }'
```

---

## Datadog Implementation Plan (Deferred)

> **Status: Not started.** Everything in this section is planned but unimplemented.
> Pick it up when you want alerting beyond Cloudflare Health Checks.

### What exists today

| Layer                    | State                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| Cloudflare Health Checks | Documented above — still needs manual creation                     |
| `stage2.yml` Datadog job | **Not present** — no `datadog-synthetic` job in the workflow       |
| Datadog synthetic tests  | **Not created** — no public IDs exist yet                          |
| GitHub secrets           | **Not set** — `DATADOG_API_KEY`, `DATADOG_APP_KEY` absent          |
| Slack → Datadog alert    | **Not wired** — Slack webhook not connected to any Datadog monitor |
| Terraform for Datadog    | **Not written** — no `.tf` file for synthetics                     |

### Implementation steps (in order)

**Step 1 — GitHub secrets**

Add to the repo's GitHub Actions secrets (Settings → Secrets → Actions):

```
DATADOG_API_KEY   ← from Datadog > Organization Settings > API Keys
DATADOG_APP_KEY   ← from Datadog > Organization Settings > Application Keys
```

Add as a GitHub variable (not secret):

```
DATADOG_SYNTHETICS_ENABLED = true
```

**Step 2 — Create Datadog synthetic tests**

Follow the "Create Synthetic Tests in Datadog" section below to create both tests.
After saving each test, note its **Public ID** (format: `abc-123-xyz`).

**Step 3 — Wire into stage2.yml**

Add this job to `.github/workflows/stage2.yml`, after the `ui-smoke` job:

```yaml
datadog-synthetic:
  name: Datadog Synthetics
  needs: [api-smoke] # only run if API smoke passed
  if: vars.DATADOG_SYNTHETICS_ENABLED == 'true'
  runs-on: ubuntu-latest
  steps:
    - uses: DataDog/synthetics-ci-github-action@v1
      with:
        api_key: ${{ secrets.DATADOG_API_KEY }}
        app_key: ${{ secrets.DATADOG_APP_KEY }}
        test_search_query: 'tag:env:staging tag:service:eventangle'
        fail_on_critical_errors: true
        fail_on_timeout: true
```

Replace `test_search_query` with explicit IDs once you have them:

```yaml
public_ids: |
  abc-123-xyz
  def-456-uvw
```

**Step 4 — Slack webhook → Datadog monitor**

1. Create a Slack incoming webhook for `#ops-alerts` (or reuse the one from UptimeRobot if already set up — see `UPTIME_MONITORING.md`)
2. In Datadog: **Monitors → Manage → [your synthetic monitor] → Edit → Notify your team**
3. Add the Slack webhook URL in the notification message body:
   ```
   @slack-ops-alerts
   ```
   Or configure via **Integrations → Slack** in Datadog to create the channel integration.
4. Set alert conditions:
   - Alert: 2 consecutive failures
   - Recovery: 1 consecutive success
   - No-data: alert after 10 minutes

**Step 5 — Verify end-to-end**

```bash
# Manually trigger synthetics via API to confirm secrets work
curl -X POST "https://api.datadoghq.com/api/v1/synthetics/tests/trigger/ci" \
  -H "DD-API-KEY: $DATADOG_API_KEY" \
  -H "DD-APPLICATION-KEY: $DATADOG_APP_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tests": [{"public_id": "abc-123-xyz"}]}'
```

### Dependencies / blockers before starting

- [ ] Datadog account with Synthetics feature enabled (not on free plan)
- [ ] Slack `#ops-alerts` channel exists
- [ ] Cloudflare Health Checks (Priority 1) already set up and green — do that first

---

## Priority 2: Datadog Synthetics (Optional)

Datadog provides more sophisticated synthetic testing with browser tests, multi-step API tests, and detailed analytics.

### Prerequisites

1. Datadog account with Synthetics enabled
2. GitHub secrets configured:
   - `DATADOG_API_KEY`
   - `DATADOG_APP_KEY`
3. GitHub variable: `DATADOG_SYNTHETICS_ENABLED=true`

### Create Synthetic Tests in Datadog

#### Test 1: /health/origin API Test

1. **Go to Datadog > Synthetics > New Test > API Test**
2. **Configure:**
   ```
   Name: [Staging] EventAngle Health Origin
   Type: HTTP
   URL: https://stg.eventangle.com/health/origin
   Method: GET
   ```
3. **Add Assertions:**
   ```
   - Status code is 200
   - Response body contains: "ok":true
   - Response body contains: "env":"staging"
   - Response time is less than 5000ms
   ```
4. **Configure Tags:**
   ```
   service:eventangle
   env:staging
   team:devops
   ```
5. **Set Locations:** At least 2 regions for redundancy
6. **Set Frequency:** Every 1 minute
7. **Save and note the Public ID** (e.g., `abc-123-xyz`)

#### Test 2: /events Browser Test

1. **Go to Datadog > Synthetics > New Test > Browser Test**
2. **Configure:**
   ```
   Name: [Staging] EventAngle Events Page
   Starting URL: https://stg.eventangle.com/events
   ```
3. **Record steps or add assertions:**
   - Wait for page load
   - Assert element exists: `[data-testid="events-root"]`
   - Assert status code is 200
4. **Configure Tags:**
   ```
   service:eventangle
   env:staging
   team:devops
   ```
5. **Set Locations:** At least 2 regions
6. **Set Frequency:** Every 5 minutes (browser tests are more expensive)
7. **Save and note the Public ID**

### Trigger Synthetics via CI/CD

The Stage-2 workflow includes Datadog synthetic triggers. Update the test IDs:

```yaml
# In .github/workflows/stage2-smoke.yml
# datadog-synthetic job

env:
  DATADOG_SYNTHETIC_TESTS: |
    abc-123-xyz
    def-456-uvw
```

### Datadog API Reference

```bash
# Trigger synthetic tests
curl -X POST "https://api.datadoghq.com/api/v1/synthetics/tests/trigger/ci" \
  -H "DD-API-KEY: $DATADOG_API_KEY" \
  -H "DD-APPLICATION-KEY: $DATADOG_APP_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tests": [
      {"public_id": "abc-123-xyz"},
      {"public_id": "def-456-uvw"}
    ]
  }'

# Poll for results
curl -X GET "https://api.datadoghq.com/api/v1/synthetics/tests/poll_results" \
  -H "DD-API-KEY: $DATADOG_API_KEY" \
  -H "DD-APPLICATION-KEY: $DATADOG_APP_KEY" \
  -G --data-urlencode "result_ids=$RESULT_IDS"
```

---

## Local Validation Script

Validate synthetic health checks locally before deployment:

```bash
# Run synthetic health check validation
npm run test:synthetic

# Or run directly
node scripts/synthetic-health-check.js --env staging
node scripts/synthetic-health-check.js --env production
```

### Expected Output

```
============================================
SYNTHETIC HEALTH CHECK VALIDATION
============================================
Environment: staging
Target: https://stg.eventangle.com

Check 1: /health/origin
  HTTP Status: 200 OK
  ok: true
  env: staging
  upstreamReachable: true
  latencyMs: 245
  PASSED

Check 2: /events
  HTTP Status: 200 OK
  data-testid="events-root": FOUND
  PASSED

============================================
RESULT: ALL CHECKS PASSED
============================================
```

---

## Negative Path Handling

### Planned Maintenance

When intentionally taking down upstream:

1. **Option A: Pause Synthetics**
   - Cloudflare: Dashboard > Health Checks > Pause
   - Datadog: Synthetics > Test > Pause Test

2. **Option B: Adjust Alert Threshold**
   - Increase consecutive failures before alerting
   - Set maintenance window in alerting rules

3. **Option C: Use Maintenance Window**
   - Cloudflare: Configure maintenance windows in notifications
   - Datadog: Use scheduled downtime feature

### Alert Suppression

```bash
# Cloudflare: Update health check to increase failure threshold
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/healthchecks/{healthcheck_id}" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN_ESE" \
  -H "Content-Type: application/json" \
  --data '{"consecutive_fails": 5}'
```

---

## CI/CD Integration

### Pre-Deployment Check

Before deploying to production:

1. Stage-2 smoke tests must pass
2. Cloudflare health checks must be green
3. (Optional) Datadog synthetics must pass

### Deployment Runbook Addition

Add to your deployment checklist:

```markdown
## Pre-Production Promotion Checklist

- [ ] Stage-1 CI passed
- [ ] Stage-2 smoke tests passed
- [ ] Cloudflare health checks green for staging:
  - [ ] /health/origin: healthy
  - [ ] /events: healthy
- [ ] (Optional) Datadog synthetics green
- [ ] Manual approval received (if not auto-promote)
```

---

## Environment Matrix

| Environment | Health Origin URL                          | Events URL                          | Check Interval |
| ----------- | ------------------------------------------ | ----------------------------------- | -------------- |
| Staging     | `https://stg.eventangle.com/health/origin` | `https://stg.eventangle.com/events` | 1 minute       |
| Production  | `https://www.eventangle.com/health/origin` | `https://www.eventangle.com/events` | 1 minute       |

---

## Troubleshooting

### Health Check Failing

1. **Check endpoint directly:**

   ```bash
   curl -s https://stg.eventangle.com/health/origin | jq
   curl -s -o /dev/null -w "%{http_code}" https://stg.eventangle.com/events
   ```

2. **Verify assertions:**

   ```bash
   # Check ok field
   curl -s https://stg.eventangle.com/health/origin | jq '.ok'

   # Check env field
   curl -s https://stg.eventangle.com/health/origin | jq '.env'

   # Check events page marker
   curl -s https://stg.eventangle.com/events | grep -o 'data-testid="events-root"'
   ```

3. **Check worker logs:**
   - Cloudflare Dashboard > Workers > eventangle-staging > Logs

### Alert Interpretation

| Alert                                   | Likely Cause             | First Action                        |
| --------------------------------------- | ------------------------ | ----------------------------------- |
| `/health/origin` unhealthy, `ok: false` | Upstream unreachable     | Check `UPSTREAM_WEBAPP_URL` env var |
| `/health/origin` unhealthy, `env` wrong | Wrong environment config | Check `WORKER_ENV` env var          |
| `/events` unhealthy, 404                | Route not configured     | Check worker routing                |
| `/events` unhealthy, missing marker     | HTML template issue      | Check KV templates                  |
| Both unhealthy                          | Worker down              | Check Cloudflare Workers status     |

---

## Related Documentation

- [UPTIME_MONITORING.md](./UPTIME_MONITORING.md) - External uptime monitoring
- [RUNBOOK.md](../RUNBOOK.md) - Incident response procedures
- [DEPLOYMENT.md](../DEPLOYMENT.md) - Deployment procedures
- [Story 3.1 - /health/origin endpoint](../worker/src/handlers/healthOrigin.ts)

---

**Last Updated:** 2026-03-22
**Story:** 3.2 - Datadog / Synthetic Health for /events + /health/origin
