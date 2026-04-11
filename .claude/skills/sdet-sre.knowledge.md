# Lead SDET/SRE — Knowledge Base

> **Role:** Owns CI/CD pipeline, Postman/Newman API testing, Playwright automation infrastructure, Datadog Synthetics planning, site reliability
> **Last Reconciled:** 2026-03-27

---

## CI/CD Pipeline Architecture

### Canonical Pipeline: `oursharedevents-ci.yml`

```
Trigger Matrix:
┌──────────────────┬───────────┬────────────┬─────────────┬─────────────┐
│ Event            │ TypeCheck │ Deploy Stg │ E2E Staging │ Deploy Prod │
├──────────────────┼───────────┼────────────┼─────────────┼─────────────┤
│ PR to main       │ ✅        │ ❌          │ ❌           │ ❌           │
│ Push to main     │ ✅        │ ✅          │ ✅           │ ❌           │
│ Tag vX.Y.Z       │ ✅        │ ❌          │ ❌           │ ✅           │
│ workflow_dispatch │ ✅        │ optional   │ optional    │ optional    │
└──────────────────┴───────────┴────────────┴─────────────┴─────────────┘

Job DAG:
  typecheck ──┬── schema-verify
              ├── deploy-staging ── e2e-staging
              └── deploy-production ── e2e-production
```

**Working directory:** `workers/oursharedevents/`

### Security Pipeline (5 workflows)

| Workflow                       | Trigger          | Purpose                       |
| ------------------------------ | ---------------- | ----------------------------- |
| `security-scan.yml`            | Push, PR, weekly | CodeQL + npm audit            |
| `security-triage.yml`          | Scan failure     | Auto-create issues with SLA   |
| `security-sla-enforcement.yml` | Daily            | Escalate overdue findings     |
| `security-human-gate.yml`      | Scan blocks PR   | Require human override label  |
| `security-regression.yml`      | PR               | Detect regression in security |
| `advanced-security-scan.yml`   | Push, PR         | Extended scanning             |
| `dependency-review.yml`        | PR               | Dependency diff review        |

### Security SLAs

| Severity | Response | Fix | Exception Max |
| -------- | -------- | --- | ------------- |
| Critical | 1h       | 4h  | None allowed  |
| High     | 4h       | 24h | 30 days       |
| Moderate | 24h      | 7d  | 90 days       |
| Low      | 7d       | 30d | 180 days      |

### Legacy Pipelines (still in repo)

| Workflow          | Status      | Action Needed                         |
| ----------------- | ----------- | ------------------------------------- |
| `stage1.yml`      | ⚠️ Active   | Archive — targets old `worker/` + GAS |
| `stage2.yml`      | ⚠️ Active   | Archive — targets old `worker/` + GAS |
| 20+ in `archive/` | ✅ Archived | No action                             |

---

## Postman/Newman API Testing

### Current Collections

| Collection                     | Location   | Status                           |
| ------------------------------ | ---------- | -------------------------------- |
| `mvp-event-toolkit-api.json`   | `postman/` | ⚠️ Stale — targets GAS endpoints |
| `mvp-event-toolkit-flows.json` | `postman/` | ⚠️ Stale — targets GAS flows     |

### Environments

| Environment                    | Location   | Status          |
| ------------------------------ | ---------- | --------------- |
| `mvp-event-toolkit-local.json` | `postman/` | ⚠️ Needs update |
| `mvp-event-toolkit-dev.json`   | `postman/` | ⚠️ Needs update |

### Newman CI Config

`newman.config.json` exists at root but targets legacy endpoints.

### Required Updates

New collections needed targeting Worker API:

```
Collection: ourSharedEvents-worker-api.json
├── Health
│   ├── GET /health → 200 { ok: true, env: "..." }
│   └── GET /api/status → 200 { ok: true }
├── Events (Public)
│   ├── GET /api/v2/events → 200 { ok: true, items: [...] }
│   ├── GET /api/v2/events/:id → 200 { ok: true, item: {...} }
│   └── GET /api/v2/events/nonexistent → 404
├── Admin (Authenticated)
│   ├── GET /api/v2/admin/events (no token) → 401
│   ├── GET /api/v2/admin/events (valid token) → 200
│   └── GET /admin (valid token) → 200 HTML
├── Pages
│   ├── GET / → 200 text/html
│   └── GET /admin (no token) → 401
└── Negative
    ├── GET /nonexistent → 404 JSON
    ├── POST /api/v2/events → 405 (method not allowed)
    └── OPTIONS /* → 200 (CORS preflight)
```

### Newman CI Integration Target

Add to `oursharedevents-ci.yml` after `deploy-staging`:

```yaml
newman-tests:
  needs: deploy-staging
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: npm install -g newman
    - run: newman run postman/oursharedevents-worker-api.json
        -e postman/oursharedevents-staging.json
        --reporters cli,junit
        --reporter-junit-export results/newman.xml
```

---

## Datadog Synthetics Planning

### Endpoints to Monitor

| Check       | URL                     | Frequency | Threshold                    |
| ----------- | ----------------------- | --------- | ---------------------------- |
| Health      | `GET /health`           | 1 min     | <500ms, status 200           |
| Events API  | `GET /api/v2/events`    | 5 min     | <1000ms, status 200          |
| Public Page | `GET /`                 | 5 min     | <2000ms, status 200          |
| Admin Auth  | `GET /admin` (no token) | 15 min    | status 401                   |
| SSL         | TLS check               | 1 hour    | Valid cert, no mixed content |

### Browser Tests (Datadog Synthetic Browser)

| Test             | Steps                                                            | Frequency |
| ---------------- | ---------------------------------------------------------------- | --------- |
| Public Page Load | Navigate → verify event cards render → check mobile viewport     | 15 min    |
| Admin Login Flow | Navigate → enter token → verify dashboard loads                  | 30 min    |
| API Contract     | GET /api/v2/events → validate JSON schema → check item count > 0 | 5 min     |

### Alerting

| Condition             | Channel           | Severity |
| --------------------- | ----------------- | -------- |
| Health check fails 2x | Slack + PagerDuty | P1       |
| API latency > 2s (3x) | Slack             | P2       |
| SSL cert < 30 days    | Email             | P3       |
| Public page fails     | Slack             | P1       |

### Prerequisites (not yet provisioned)

- Datadog account with Synthetic Monitoring enabled
- Datadog API key + App key as GitHub secrets
- Datadog Terraform provider (or manual setup)

---

## Test Infrastructure Metrics

### Current Test Counts

| Category    | Files | Runner     | Target                        |
| ----------- | ----- | ---------- | ----------------------------- |
| D1 Schema   | 2     | Vitest     | `workers/oursharedevents/` ✅ |
| Unit        | 40+   | Jest       | `worker/` ⚠️                  |
| Contract    | 35+   | Jest       | `worker/` ⚠️                  |
| API Smoke   | 20+   | Playwright | Live endpoints                |
| E2E         | 60+   | Playwright | Live surfaces                 |
| Integration | 3     | Jest       | `worker/` ⚠️                  |
| Triangle    | 8     | Jest       | `worker/` ⚠️                  |

### Coverage Gap

Only **2 Vitest files** test the canonical deployed Worker (`workers/oursharedevents/`). The 80+ Jest/Playwright tests target the legacy `worker/` implementation. This is the **single biggest testing risk**.

---

## Environment URLs

| Environment       | Base URL                          | Status              |
| ----------------- | --------------------------------- | ------------------- |
| Staging           | `https://stg.oursharedevents.com` | Not yet provisioned |
| Production        | `https://oursharedevents.com`     | Not yet provisioned |
| Legacy Staging    | `https://stg.eventangle.com`      | Active (old domain) |
| Legacy Production | `https://www.eventangle.com`      | Active (old domain) |

---

## Secrets Inventory for CI

### GitHub Actions Secrets

| Secret                     | Used By        | Rotation |
| -------------------------- | -------------- | -------- |
| `CLOUDFLARE_API_TOKEN_OSE` | Deploy jobs    | 90 days  |
| `CLOUDFLARE_ACCOUNT_ID`    | Deploy jobs    | Static   |
| `ADMIN_KEY`                | E2E auth tests | 90 days  |

### Cloudflare Worker Secrets (per env)

| Secret                      | Purpose         | Rotation |
| --------------------------- | --------------- | -------- |
| `ADMIN_KEY`                 | Bearer auth     | 90 days  |
| `SHEETS_SPREADSHEET_ID`     | Data source     | Static   |
| `GOOGLE_SA_CLIENT_EMAIL`    | Service account | 90 days  |
| `GOOGLE_SA_PRIVATE_KEY_PEM` | Signing key     | 90 days  |

---

## Known Gaps

1. **Postman collections stale:** Need rewrite for Worker API
2. **Newman not in CI:** Config exists but not wired into `oursharedevents-ci.yml`
3. **No Datadog:** Synthetic monitoring not set up (infra not provisioned)
4. **No load testing:** SDET performance targets documented (Sheets 200-800ms → D1 <5ms) but no k6/Artillery scripts
5. **No SLA dashboards:** Security SLAs defined but no Datadog/Grafana dashboard
6. **Test target drift:** Most tests target wrong Worker implementation
