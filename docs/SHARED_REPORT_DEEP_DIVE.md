# SharedReport Deep Dive — Quality, Security, UX, Performance & Maintenance

> **Date**: 2026-03-27
> **Scope**: `sharedReport.html` + `/api/v2/sharedreport` + domain contract + tests
> **Framework**: PO / Lead BE / Lead FE / Sr Design FE / Sr Automation QA / SRE SDET / DevOps

---

## Executive Summary

SharedReport is the **monetization anchor and case-study generator** for the platform. It serves three audiences (event organizers, sponsors, customers-as-aggregate) via a 3-pane tabbed UI backed by a locked v1.0.0 contract. This deep dive evaluates the feature across all scrum roles and identifies concrete improvements for quality, security, performance, ease of use, and maintainability.

**Overall Grade: B+** — Strong contract design, good privacy posture, solid test coverage. Gaps in rate limiting, CSP hardening, feature flag tiering, automation test-ids, and caching strategy.

---

## 1. Product Owner (PO) — Acceptance & Business Cases

### What's Working
- **3-Pane Tab UI** delivers clear separation: Event / Sponsor / Customer
- **Integrity banner** builds trust — users see data completeness at a glance
- **No-PII customer view** is a competitive differentiator for privacy-conscious sponsors
- **Customer Summary Export block** (Story F7) enables copy-paste sharing
- **Contract versioning** (v1.0.0 locked) prevents breaking downstream consumers

### Gaps & Recommendations

| Gap | Impact | Fix |
|-----|--------|-----|
| No tier-gated features on sharedReport | Can't monetize mid/enterprise tiers | Add feature flag gating: `report.advanced-metrics`, `report.export-pdf`, `report.white-label` |
| No PDF/email export | Sponsors can't save/share offline | Story candidate: PDF export (mid tier), email share (enterprise) |
| No date range picker | Locked to 30-day window | Story candidate: custom window (mid tier) |
| No multi-event portfolio view | Enterprise sponsors need cross-event roll-ups | V2 endpoints exist but are hidden — gate behind `report.portfolio` flag |
| No sponsor-specific deep link | Sponsors receive generic URL | Add `/report?eventId=X&sponsorId=Y` scoped view |

### 3-Tier Feature Flag Map for SharedReport

```
Free tier (default)
├── report.view              ✓ ON   ← basic 3-pane report
├── report.export-json       ✓ ON   ← raw JSON link
├── report.advanced-metrics  ✗ OFF
├── report.export-pdf        ✗ OFF
├── report.custom-window     ✗ OFF
├── report.portfolio         ✗ OFF
└── report.white-label       ✗ OFF

Mid tier
├── report.advanced-metrics  ✓ ON   ← conversion funnels, trends
├── report.export-pdf        ✓ ON   ← downloadable PDF
├── report.custom-window     ✓ ON   ← date range picker
└── report.portfolio         ✗ OFF

Enterprise tier
├── report.portfolio         ✓ ON   ← multi-event roll-ups
├── report.white-label       ✓ ON   ← custom branding on report
└── (any flag per event)     ✓ ON   ← full override control
```

---

## 2. Lead Backend Architect — API, Security, Performance

### What's Working
- **Parallel data fetching** (`Promise.all` for events + sponsors sheets)
- **Request tracing** (`X-Request-Id` header on all responses including errors)
- **Structured logging** (JSON logs with type, eventId, durationMs, requestId)
- **Contract validation** (`assertSharedAnalyticsBundle` before returning)
- **Error taxonomy** (4 distinct error codes with stable contract)
- **Graceful degradation** (sponsor data optional, integrity metadata always present)

### Security Findings

| Finding | Severity | Status | Remediation |
|---------|----------|--------|-------------|
| **No rate limiting on `/api/v2/sharedreport`** | HIGH | OPEN | Add per-IP rate limiting (e.g., 60 req/min) |
| **eventId not format-validated** | MEDIUM | OPEN | Validate pattern: `/^[a-zA-Z0-9_-]{1,64}$/` |
| **No CSP on report HTML page** | MEDIUM | OPEN | CSP only on landing page; extend to all HTML surfaces |
| **Error messages echo eventId** | LOW | OPEN | `Event not found: ${eventId}` could leak info — use generic message |
| **No auth on sharedReport endpoint** | BY DESIGN | OK | Public endpoint — intentional for sharing. Rate limit compensates. |
| **CORS properly configured** | — | OK | 3 origins whitelisted, Origin header checked |
| **escapeHtml covers all 5 chars** | — | OK | `& < > " '` all escaped in 3 implementations |
| **JSON.parse in try-catch** | — | OK | Malformed sheet data won't crash handler |

### Performance Findings

| Metric | Current | Target | Notes |
|--------|---------|--------|-------|
| Cold start | ~200-800ms (Sheets) | <50ms (D1) | Phase 2 fix |
| Cache headers | `no-cache, no-store` | `max-age=60, stale-while-revalidate=300` | Report data is not real-time |
| Bundle size | ~89KB HTML | <50KB | Move CSS to shared stylesheet, tree-shake legacy sections |
| Parallel fetch | Events + Sponsors | ✓ Already parallel | Good |
| Response size | ~2-5KB JSON | OK | Lean contract |

### API Contract Health
- **Version**: 1.0.0 (locked)
- **Breaking change policy**: Major bump required
- **CI gate**: Contract tests block merge on drift
- **Compliance checker**: `checkSharedAnalyticsBundleCompliance()` available

---

## 3. Lead Frontend Integration — Surfaces & Integration

### What's Working
- **Dual rendering paths**: V2 bundle (3-pane) + legacy (backwards compat)
- **Tab switching** with ARIA attributes (`role="tablist"`, `aria-selected`)
- **Empty states** per tab (no data = friendly message, not blank)
- **Error handling** via `StateRenderer.showFromError()` with retry button
- **escapeHtml** used consistently in all template literals

### Integration Gaps

| Gap | Impact | Fix |
|-----|--------|-----|
| No loading skeleton | Flash of empty content before data loads | Add skeleton placeholder for each tab pane |
| Legacy sections still in DOM | ~40KB of unused HTML when V2 active | Conditionally exclude or lazy-load |
| No keyboard navigation between tabs | Accessibility gap (WCAG 2.1) | Add arrow key navigation per WAI-ARIA tabs pattern |
| `onclick` handlers in HTML | Tight coupling, harder to test | Move to `addEventListener` in script block |
| No URL state for active tab | Refreshing page loses tab selection | Add `#tab=sponsor` hash routing |
| No print stylesheet | Print output includes UI chrome | Add `@media print` rules |

---

## 4. Sr Design FE — Mobile-First UX & Design System

### What's Working
- **Mobile breakpoints**: 375px, 640px, 1024px — covers iPhone SE through desktop
- **Card-based mobile tables**: Tables stack into cards on mobile (data-label pattern)
- **Touch targets**: Action buttons have `min-height: 48px` on mobile
- **Design tokens**: Consistent use of CSS custom properties (`--color-primary`, `--font-size-sm`)
- **Gradient header**: Professional, branded appearance
- **Integrity banner**: Color-coded (green/yellow/red) with iconography

### UX Improvement Opportunities

| Item | Current | Improved |
|------|---------|----------|
| Tab indicator | Underline only | Add subtle background highlight + transition |
| Metric cards | Static numbers | Add subtle count-up animation on load |
| Empty states | Text only | Add illustration/icon + actionable CTA |
| Data freshness | Text timestamp | Add relative time ("5 min ago") + auto-refresh indicator |
| Report sharing | Raw JSON link | Add "Copy Link" button with toast confirmation |
| Color palette | Blue primary only | Tab-specific accent colors (Event=blue, Sponsor=green, Customer=purple) |

### Accessibility Audit

| Check | Status | Notes |
|-------|--------|-------|
| Color contrast (WCAG AA) | ✓ Pass | Token colors meet 4.5:1 ratio |
| Tab semantics | ✓ Pass | `role="tablist"`, `role="tab"`, `role="tabpanel"` |
| Keyboard nav | ✗ Partial | Tab key works, arrow keys missing |
| Screen reader | ✗ Partial | No `aria-label` on metric values |
| Focus indicators | ✓ Pass | `.section-toggle:focus` has outline |
| Reduced motion | ✗ Missing | No `prefers-reduced-motion` media query |

---

## 5. Sr Automation QA — Test Coverage & Resilience

### Current Coverage

| Test Type | File | Coverage | Quality |
|-----------|------|----------|---------|
| Contract (Vitest) | `sharedAnalytics.contract.spec.ts` | 705 lines | Excellent — hermetic, no build deps |
| Smoke UI (Playwright) | `sharedreport-3pane.spec.ts` | 537 lines | Good — tabs, integrity, F7 block |
| API Smoke | `sharedreport.spec.ts` | Basic | Needs expansion |
| UI Smoke | `sharedreport.smoke.spec.ts` | Basic | Needs expansion |

### Test-ID Coverage (Automation Resilience)

| Element | Has test-id | Needed |
|---------|-------------|--------|
| Customer Summary Export | ✓ `customer-summary-export` | — |
| Integrity status | ✓ `customer-summary-integrity` | — |
| JSON link | ✓ `customer-summary-json-link` | — |
| Tab buttons | ✗ | `data-testid="tab-event"`, `tab-sponsor`, `tab-customer` |
| Tab panels | ✗ | `data-testid="panel-event"`, etc. |
| Integrity banner | ✗ | `data-testid="integrity-banner"` |
| Report header | ✗ | `data-testid="report-header"` |
| Metrics grid | ✗ | `data-testid="metrics-grid"` |
| Refresh button | ✗ | `data-testid="refresh-btn"` |
| Error state | ✗ | `data-testid="error-state"` |
| Loading state | ✗ | `data-testid="loading-state"` |
| Each metric row | ✗ | `data-testid="metric-signups"`, etc. |

### Missing Test Scenarios

1. **Rate limit behavior** — What happens at 429?
2. **Concurrent tab switching** — Rapid clicks don't break rendering
3. **Large data sets** — 100+ sponsors, does the sponsor pane scroll?
4. **Stale data rendering** — `integrity.stale=true` shows correct banner
5. **Window edge cases** — Future dates, start > end
6. **XSS via eventId** — `?eventId=<script>alert(1)</script>`
7. **Network timeout** — Fetch fails mid-stream
8. **Empty bundle** — All zeros, does UI still look sensible?

---

## 6. SRE / SDET — Observability, CI/CD, Monitoring

### Current Observability

| Signal | Implemented | Notes |
|--------|-------------|-------|
| Request duration | ✓ `durationMs` in JSON log | Good |
| Request tracing | ✓ `X-Request-Id` header | Good |
| Error logging | ✓ Structured JSON with error codes | Good |
| Access logging | ✓ `SHARED_ANALYTICS_ACCESS` log type | Good |
| Bundle generation audit | ✓ `SHARED_ANALYTICS_BUNDLE_GENERATED` | Good |
| Latency alerting | ✗ Not configured | Need threshold alert (>2s) |
| Error rate alerting | ✗ Not configured | Need 503 rate spike detection |
| Cache hit ratio | ✗ N/A (no caching) | Add when caching enabled |

### CI/CD Gates

| Gate | Status | Notes |
|------|--------|-------|
| Contract drift detection | ✓ Stage-2 blocks | Excellent |
| Smoke tests | ✓ Playwright in CI | Good |
| Bundle size check | ✗ Missing | Add HTML size regression gate |
| Lighthouse score | ✗ Missing | Add performance score gate (>80) |
| Security scan | ✗ Missing | Add CSP header validation in CI |

---

## 7. DevOps — Infrastructure & Deployment

### Current State
- Worker deployed via wrangler
- Secrets managed via Cloudflare dashboard
- CI pipeline runs on GitHub Actions
- No separate sharedReport deployment — it's part of the monolithic worker

### Recommendations

| Item | Priority | Notes |
|------|----------|-------|
| Feature flag DB table | P1 | `feature_flags` table with scope/key/enabled columns — already designed in `feature-flags.ts` |
| Report-specific monitoring dashboard | P2 | Grafana/CF Analytics panel for `/api/v2/sharedreport` |
| Separate cache zone for report data | P2 | CF Cache API with 60s TTL for report bundles |
| Automated PII scrub verification | P1 | CI gate that scans bundle output for email/phone patterns |

---

## Implementation Plan (This PR)

### Immediate Fixes (Shipped in this PR)

1. **eventId format validation** — Reject injection patterns
2. **CSP headers on sharedReport page** — Extend from landing-only to all HTML
3. **data-testid attributes** — Add to all interactive elements for automation
4. **Feature flag constants for report tiers** — Define flag keys
5. **Short-TTL cache headers** — `max-age=60, stale-while-revalidate=300`
6. **Rate limiting guard** — Per-endpoint request throttling
7. **Newman collection** — SharedReport API E2E test chain

### Future Stories (Backlog candidates)

- `SR-1`: PDF export (mid tier)
- `SR-2`: Custom date window (mid tier)
- `SR-3`: Portfolio mode (enterprise)
- `SR-4`: White-label report (enterprise)
- `SR-5`: Print stylesheet
- `SR-6`: Keyboard tab navigation (WCAG)
- `SR-7`: Loading skeletons
- `SR-8`: URL hash for active tab state
