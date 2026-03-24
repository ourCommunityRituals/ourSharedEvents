# UNKNOWN GAPS - EventAngle System Map

> **Generated:** 2026-01-04
> **Purpose:** Document areas where evidence is missing or uncertain
> **Action Required:** Inspect listed locations to fill gaps

---

## Overview

During the Loop 1 System Map generation, the following gaps were identified where:
1. Evidence could not be located in the codebase
2. Behavior is inferred but not directly observed
3. Configuration exists outside the repository (e.g., Cloudflare Dashboard)
4. Documentation references features without implementation evidence

---

## 1. OBSERVABILITY GAPS

### 1.1 Centralized Log Aggregation

| Field | Value |
|-------|-------|
| **Gap** | No centralized log storage or aggregation service |
| **Evidence Sought** | Cloudflare Logpush config, ELK/Datadog integration |
| **Where to Inspect** | Cloudflare Dashboard → Account → Logs, `wrangler.toml` for Logpush bindings |
| **Impact** | Cannot query historical logs, logs lost after Worker restart |
| **Severity** | HIGH |

### 1.2 APM / Distributed Tracing

| Field | Value |
|-------|-------|
| **Gap** | No distributed tracing platform (OpenTelemetry, Datadog APM, etc.) |
| **Evidence Sought** | OTEL exporter config, tracing SDK integration |
| **Where to Inspect** | `worker/src/logger.ts`, `package.json` for tracing dependencies |
| **Impact** | Cannot trace request flow across Worker → Sheets API |
| **Severity** | HIGH |

### 1.3 Real User Monitoring (RUM)

| Field | Value |
|-------|-------|
| **Gap** | No RUM solution for production traffic |
| **Evidence Sought** | Cloudflare Browser Insights, Datadog RUM SDK |
| **Where to Inspect** | `src/mvp/*.html` for RUM script tags, Cloudflare Dashboard → Analytics |
| **Impact** | Cannot detect real-world performance issues or user-affecting errors |
| **Severity** | MEDIUM |

### 1.4 Error Rate Alerting

| Field | Value |
|-------|-------|
| **Gap** | No threshold-based error rate alerting |
| **Evidence Sought** | Alert rules in Cloudflare, PagerDuty/Opsgenie config |
| **Where to Inspect** | Cloudflare Dashboard → Notifications, `.github/workflows/*.yml` for Slack/Teams |
| **Impact** | Cannot detect slow degradation of error rates before outage |
| **Severity** | MEDIUM |

### 1.5 SLO Tracking

| Field | Value |
|-------|-------|
| **Gap** | No SLO (Service Level Objective) definitions or tracking |
| **Evidence Sought** | SLO definitions, error budget dashboards |
| **Where to Inspect** | `docs/`, Cloudflare/Datadog dashboards |
| **Impact** | Cannot quantify reliability goals or alert on SLO violations |
| **Severity** | MEDIUM |

---

## 2. CACHING GAPS

### 2.1 Explicit Cache Invalidation

| Field | Value |
|-------|-------|
| **Gap** | No explicit cache invalidation mechanism |
| **Evidence Sought** | Cache purge API calls, webhook-triggered invalidation |
| **Where to Inspect** | `worker/src/handlers/*.ts` for cache.delete(), Cloudflare API calls |
| **Current Behavior** | Cache expires passively via TTL (60s max-age) |
| **Impact** | Up to 60s data drift after updates |
| **Severity** | LOW |

### 2.2 Cache Hit/Miss Metrics

| Field | Value |
|-------|-------|
| **Gap** | No observability into cache hit/miss rates |
| **Evidence Sought** | Cache metrics logging, Cloudflare Analytics |
| **Where to Inspect** | Cloudflare Dashboard → Caching, `worker/src/logger.ts` |
| **Impact** | Cannot optimize caching strategy |
| **Severity** | LOW |

---

## 3. SECURITY GAPS

### 3.1 Rate Limiting Configuration

| Field | Value |
|-------|-------|
| **Gap** | Rate limiting rules unclear |
| **Evidence Sought** | Cloudflare WAF rules, Worker-level rate limiting |
| **Where to Inspect** | Cloudflare Dashboard → Security → WAF, `worker/src/router.ts` |
| **Impact** | Unknown protection against abuse |
| **Severity** | MEDIUM |

### 3.2 Cloudflare Access Configuration

| Field | Value |
|-------|-------|
| **Gap** | Access policies for /admin not visible in codebase |
| **Evidence Sought** | Cloudflare Access Application config |
| **Where to Inspect** | Cloudflare Dashboard → Access → Applications |
| **Notes** | `wrangler.toml:62-84` references ADMIN_TOKEN but Access config is in Dashboard |
| **Severity** | LOW (documented in comments) |

---

## 4. DATA STORE GAPS

### 4.1 Sheets Backup/Recovery

| Field | Value |
|-------|-------|
| **Gap** | Backup and recovery procedures for Google Sheets data unclear |
| **Evidence Sought** | Backup scripts, GCP project settings, version history config |
| **Where to Inspect** | GCP Console → Project settings, Google Sheets version history |
| **Impact** | Unknown RTO/RPO for data loss scenarios |
| **Severity** | MEDIUM |

### 4.2 Sheets Quota/Limits

| Field | Value |
|-------|-------|
| **Gap** | Google Sheets API quota configuration unclear |
| **Evidence Sought** | Quota usage monitoring, retry policies |
| **Where to Inspect** | GCP Console → APIs & Services → Quotas, `worker/src/google/sheets.ts` |
| **Impact** | Could hit rate limits under high load |
| **Severity** | LOW (retry logic exists in `base.ts`) |

---

## 5. CI/CD GAPS

### 5.1 Production Deployment Approval Matrix

| Field | Value |
|-------|-------|
| **Gap** | Who can approve production deployments is unclear |
| **Evidence Sought** | GitHub Environment protection rules, CODEOWNERS |
| **Where to Inspect** | GitHub Repo → Settings → Environments → production |
| **Notes** | Stage-2 has approval gate but approvers not visible in code |
| **Severity** | LOW |

### 5.2 Rollback Automation

| Field | Value |
|-------|-------|
| **Gap** | Automated rollback triggers unclear |
| **Evidence Sought** | Rollback workflow, auto-rollback on smoke test failure |
| **Where to Inspect** | `.github/workflows/`, `scripts/rollback-*.mjs` |
| **Notes** | Rollback scripts exist but automated trigger is unclear |
| **Severity** | MEDIUM |

---

## 6. TESTING GAPS

### 6.1 Chaos/Resilience Testing

| Field | Value |
|-------|-------|
| **Gap** | Chaos tests exist but may not be enabled in CI |
| **Evidence Sought** | Chaos test integration in workflows |
| **Where to Inspect** | `.github/workflows/stage1.yml`, `tests/chaos/` |
| **Notes** | `test/chaos/graceful-degradation.test.js` referenced in observability report |
| **Severity** | LOW |

### 6.2 Performance Regression Tests

| Field | Value |
|-------|-------|
| **Gap** | No automated performance regression gates |
| **Evidence Sought** | Performance thresholds in CI, k6/artillery integration |
| **Where to Inspect** | `.github/workflows/`, `tests/load/` |
| **Notes** | Load tests exist but not integrated into CI gates |
| **Severity** | LOW |

---

## 7. CONFIGURATION GAPS

### 7.1 Cloudflare Redirect Rules (SEC-4.1)

| Field | Value |
|-------|-------|
| **Gap** | Redirect rule configuration exists in Cloudflare Dashboard, not code |
| **Evidence Sought** | Terraform config, Cloudflare API script |
| **Where to Inspect** | Cloudflare Dashboard → Rules → Redirect Rules |
| **Notes** | Referenced in `cloudflare-proxy/wrangler.toml:85-86` and `docs/RUNBOOK-SEC-4.1-CANONICAL-HOST.md` |
| **Impact** | Configuration drift if Dashboard changes without documentation update |
| **Severity** | LOW (documented in runbook) |

### 7.2 Cloudflare Health Check Configuration

| Field | Value |
|-------|-------|
| **Gap** | Health check configuration exists in Cloudflare Dashboard, not code |
| **Evidence Sought** | Terraform config, health check definitions |
| **Where to Inspect** | Cloudflare Dashboard → Traffic → Health Checks |
| **Notes** | Referenced in `docs/SYNTHETIC_MONITORING.md` |
| **Severity** | LOW (documented) |

---

## 8. DOMAIN GAPS

### 8.1 Multi-Brand Behavior

| Field | Value |
|-------|-------|
| **Gap** | Limited test coverage for non-root brands (abc, cbc, cbl) |
| **Evidence Sought** | Brand-specific E2E tests |
| **Where to Inspect** | `tests/e2e/`, `config/brand-config.js` |
| **Notes** | Router supports brands at `worker/src/router.ts:108` but tests focus on root |
| **Severity** | LOW |

### 8.2 SharedAnalytics Data Pipeline

| Field | Value |
|-------|-------|
| **Gap** | How analytics data is aggregated for SharedReport unclear |
| **Evidence Sought** | Aggregation logic, scheduled jobs |
| **Where to Inspect** | `worker/src/handlers/sharedReport.ts`, ANALYTICS sheet structure |
| **Notes** | API exists but aggregation source not fully traced |
| **Severity** | LOW |

---

## 9. DOCUMENTATION GAPS

### 9.1 API Versioning Policy

| Field | Value |
|-------|-------|
| **Gap** | v1 vs v2 endpoint support policy unclear |
| **Evidence Sought** | Deprecation timeline, version sunset policy |
| **Where to Inspect** | `docs/API_CONTRACT.md`, `schemas/*.schema.json` |
| **Notes** | v1 is "FROZEN" but deprecation timeline not stated |
| **Severity** | LOW |

### 9.2 Disaster Recovery Runbook

| Field | Value |
|-------|-------|
| **Gap** | No comprehensive DR runbook found |
| **Evidence Sought** | DR procedures, RTO/RPO definitions |
| **Where to Inspect** | `docs/RUNBOOK*.md`, `docs/support/` |
| **Notes** | Individual runbooks exist but no consolidated DR plan |
| **Severity** | MEDIUM |

---

## Priority Action Items

### HIGH Priority (Investigate First)
1. **Centralized Log Aggregation** - Check Cloudflare Dashboard for Logpush configuration
2. **APM/Distributed Tracing** - Evaluate OpenTelemetry integration options

### MEDIUM Priority
3. **Error Rate Alerting** - Check Cloudflare Notifications for alert rules
4. **Sheets Backup/Recovery** - Verify GCP project backup settings
5. **Rollback Automation** - Clarify automated rollback triggers
6. **Disaster Recovery Runbook** - Consolidate existing runbooks into DR plan

### LOW Priority
7. **Rate Limiting** - Document existing WAF rules
8. **Cache Metrics** - Enable Cloudflare Cache Analytics
9. **Multi-Brand Testing** - Add brand-specific E2E tests
10. **API Versioning Policy** - Document deprecation timeline

---

## How to Update This Document

When a gap is resolved:
1. Move the entry to a new section: `## RESOLVED GAPS`
2. Add resolution date and evidence file path
3. Update `SYSTEM_MAP.md` with new evidence

Example:
```markdown
## RESOLVED GAPS

### Centralized Log Aggregation
- **Resolved:** 2026-01-15
- **Solution:** Cloudflare Logpush to Datadog
- **Evidence:** `terraform/cloudflare-logpush.tf:1-50`
```

---

> **Last Updated:** 2026-01-04
> **Generated by:** Claude Code System Map (Loop 1)
