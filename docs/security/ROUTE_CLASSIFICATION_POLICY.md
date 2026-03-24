# ROUTE_CLASSIFICATION_POLICY.md — Route Classification & Access Control Policy

> **PROMPTSPEC-SEC-5.1** — Route Classification Policy
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Define the classification system for all application routes, establishing clear boundaries between public, privileged, and infrastructure surfaces. This policy ensures consistent access control enforcement across the EventAngle platform.

| Attribute | Value |
|-----------|-------|
| **Scope** | All routes handled by `router.ts` |
| **Prerequisites** | Security Baseline (SEC-0.1), OAuth Implementation (SEC-IAC-03) |
| **Enforcement** | Router guards, Cloudflare Access, CI gates |

---

## 2. North Star Invariant Compliance

This policy directly supports the following North Star invariants defined in `SECURITY_BASELINE.md`:

### 2.1 NS-2: Privileged Surface Identity Requirement

> **NS-2:** Privileged surfaces require identity (Cloudflare Access) or cryptographic proof

| Class | Identity Required | Mechanisms |
|-------|-------------------|------------|
| **Public** | No | N/A |
| **Privileged** | **Yes** | OAuth session (SEC-IAC-03), Cloudflare Access JWT, Bearer token, HMAC signature (SEC-IAC-05) |
| **Infra** | Varies | Some public, some require authentication |

**Verification:** All privileged routes pass through `guardAdminOAuth()`, `guardV2AdminRoute()`, or `guardAdminRoute()` before handler execution.

### 2.2 QR-0: Verified QR Enforcement

> **QR-0:** Never display a QR unless verified. If violated, the build must fail.

| Route Category | QR Display | QR-0 Enforcement |
|----------------|------------|------------------|
| **Display surfaces** (`/display`, `/tv`, `/kiosk`, `/screen`) | May display QR codes | `qrVerified` field must be `true` |
| **Poster surfaces** (`/poster`, `/posters`, `/flyers`) | May display QR codes | `qrVerified` field must be `true` |
| **Public surfaces** (`/events`, `/schedule`) | Read-only event data | No QR display requirement |
| **Admin surfaces** (`/admin`, `/manage`) | QR management UI | Admin sets `qrVerified` flag |

**Verification:** Display/poster bundles return `403 QR_NOT_VERIFIED` if `qrVerified !== true`. CI gate validates QR verification logic.

---

## 3. Route Classification System

### 3.1 Classification Definitions

| Class | Definition | Default Auth | Typical Use |
|-------|------------|--------------|-------------|
| **Public** | Accessible to any user without authentication | None | End-user content consumption |
| **Privileged** | Requires authenticated identity | OAuth/JWT/Bearer | Administrative functions, data mutation |
| **Infra** | Operational/diagnostic endpoints | Varies | Health checks, monitoring, debugging |

### 3.2 Decision Criteria

Use this decision tree to classify new routes:

```
Does the route modify data (write/update/delete)?
│
├─ YES → Is it a signed public mutation (HMAC)?
│        │
│        ├─ YES → PUBLIC (with SEC-IAC-05 signature guard)
│        │
│        └─ NO → PRIVILEGED
│
└─ NO (read-only) → Does it expose sensitive data?
                    │
                    ├─ YES → PRIVILEGED
                    │
                    └─ NO → Is it for end-users?
                            │
                            ├─ YES → PUBLIC
                            │
                            └─ NO → INFRA
```

---

## 4. Route Classification Table

### 4.1 Public Routes

Routes accessible to all users without authentication. Subject to `guardPublicReadOnly()` enforcement (SEC-IAC-04).

| Route Prefix | Aliases | Method(s) | Handler | Required Controls |
|--------------|---------|-----------|---------|-------------------|
| `/` | — | GET | public page | Rate limiting |
| `/events` | `/public`, `/schedule`, `/calendar` | GET | public page | Rate limiting |
| `/display` | `/tv`, `/kiosk`, `/screen` | GET | display page | QR-0 enforcement, rate limiting |
| `/poster` | `/posters`, `/flyers` | GET | poster page | QR-0 enforcement, rate limiting |
| `/sponsor` | `/sponsors`, `/partnership` | GET | sponsor page | Rate limiting |
| `/api/events` | — | GET | events list (legacy) | CORS, rate limiting |
| `/api/v2/events` | — | GET | events list v2 | CORS, rate limiting |
| `/api/events/:id` | — | GET | single event | CORS, rate limiting |
| `/api/events/:id/publicBundle` | — | GET | public bundle | CORS, rate limiting |
| `/api/events/:id/displayBundle` | — | GET | display bundle | QR-0 enforcement, CORS |
| `/api/events/:id/posterBundle` | — | GET | poster bundle | QR-0 enforcement, CORS |
| `/api/v2/sponsors` | — | GET | sponsors list | CORS, rate limiting |
| `/api/v2/sponsor/:id` | — | GET | single sponsor | CORS, rate limiting |
| `/api/v2/sponsor/:id/monetization` | — | GET | sponsor monetization | CORS, rate limiting |
| `/api/v2/event/:id/monetization` | — | GET | event monetization | CORS, rate limiting |
| `/api/v2/sharedreport` | — | GET | shared analytics | CORS, rate limiting |
| `/web/shared/*.js` | — | GET | JS modules | Cache headers |

**Enforcement:** `guardPublicReadOnly()` blocks POST/PUT/DELETE/PATCH on these routes unless signed mutation token present (SEC-IAC-05).

### 4.2 Privileged Routes

Routes requiring authenticated identity. Guarded by OAuth session, Cloudflare Access JWT, or Bearer token.

| Route Prefix | Aliases | Method(s) | Auth Mechanism | Required Controls |
|--------------|---------|-----------|----------------|-------------------|
| `/admin` | `/manage`, `/dashboard`, `/create` | GET | OAuth session | `guardAdminOAuth()`, audit log |
| `/report` | `/analytics`, `/reports`, `/insights` | GET | OAuth session | `guardAdminOAuth()`, audit log |
| `/api/admin/events` | — | POST | Bearer token | `guardAdminRoute()`, audit log |
| `/api/admin/events/:id/results` | — | POST | Bearer token | `guardAdminRoute()`, audit log |
| `/api/events/:id/adminBundle` | — | GET | Bearer token | `guardAdminRoute()` |
| `/api/v2/admin/events` | — | POST | Access JWT/Bearer | `guardV2AdminRoute()`, audit log |
| `/api/v2/admin/events/:id` | — | PUT | Access JWT/Bearer | `guardV2AdminRoute()`, audit log |
| `/api/v2/admin/events/:id/archive` | — | POST | Access JWT/Bearer | `guardV2AdminRoute()`, audit log |
| `/api/v2/admin/events/:id/unarchive` | — | POST | Access JWT/Bearer | `guardV2AdminRoute()`, audit log |
| `/api/v2/admin/events/:id/default` | — | POST | Access JWT/Bearer | `guardV2AdminRoute()`, audit log |
| `/api/v2/admin/events/:id/verify-qr` | — | POST | Access JWT/Bearer | `guardV2AdminRoute()`, QR-0 gate, audit log |
| `/api/v2/admin/events/:id/unverify-qr` | — | POST | Access JWT/Bearer | `guardV2AdminRoute()`, QR-0 gate, audit log |

**Required Controls for All Privileged Routes:**
1. **Identity Verification** — OAuth session, Cloudflare Access JWT, or Bearer token (NS-2)
2. **Audit Logging** — All successful and denied actions logged (SEC-IAC-06)
3. **Email Allowlist** — For OAuth, only allowed emails/domains (SEC-IAC-03)
4. **Rate Limiting** — Protect against credential stuffing

### 4.3 Infrastructure Routes

Operational endpoints for health checks, diagnostics, and platform operations.

| Route | Method | Public? | Purpose | Required Controls |
|-------|--------|---------|---------|-------------------|
| `/health/origin` | GET | **Yes** | Upstream config check | Rate limiting |
| `/api/status` | GET | **Yes** | Worker health/version | Rate limiting |
| `/api/health/backend` | GET | **Yes** | Backend auth validation | Rate limiting |
| `/api/v2/monetization/inert` | GET | **Yes** | CI/CD billing gate | Rate limiting |
| `/auth/login` | GET | **Yes** | OAuth initiation | CSRF protection |
| `/auth/callback` | GET | **Yes** | OAuth callback | State validation, rate limiting |
| `/auth/logout` | GET, POST | **Yes** | Session termination | Session validation |

**Note:** Infra routes are publicly accessible for operational reasons but contain no sensitive data. They report system status without exposing configuration secrets.

---

## 5. Naming Conventions & Prohibited Patterns

### 5.1 Route Naming Rules

| Rule | Description | Example |
|------|-------------|---------|
| **Lowercase** | All route segments lowercase | `/api/v2/events` ✓ |
| **Kebab-case** | Multi-word segments use hyphens | `/verify-qr` ✓, `/verifyQr` ✗ |
| **Noun-first for resources** | Resource name before action | `/events/:id/archive` ✓ |
| **Version prefix for API** | API versions use `/v2/` prefix | `/api/v2/admin/events` ✓ |
| **Singular for single resource** | Use singular when returning one | `/api/v2/sponsor/:id` ✓ |
| **Plural for collections** | Use plural for lists | `/api/v2/sponsors` ✓ |

### 5.2 Prohibited Route Patterns

> **EXPLICITLY PROHIBITED:** Routes that suggest elevated system access beyond their actual capability.

| Pattern | Reason | Alternative |
|---------|--------|-------------|
| `/root/*` | Implies system root access (optics concern) | Use `/admin/*` |
| `/superuser/*` | Implies elevated privileges beyond scope | Use `/admin/*` |
| `/sudo/*` | Unix privilege escalation connotation | Use `/admin/*` |
| `/god/*` | Implies unrestricted access | Use `/admin/*` |
| `/master/*` | Outdated terminology, implies control | Use `/admin/*` or `/primary/*` |
| `/internal/*` | Ambiguous — use explicit classification | Use `/api/admin/*` or `/health/*` |
| `/debug/*` in production | Debug endpoints must not exist in prod | Guard with `ENABLE_DEBUG_ENDPOINTS` |
| `/test/*` in production | Test endpoints must not exist in prod | Remove before deploy |

### 5.3 Brand Prefix Handling

The router supports brand prefixes (e.g., `/abc/events`). Brand prefixes are **NOT** route classifications:

```
Valid brand prefixes: root, abc, cbc, cbl

/abc/events        → Brand: abc, Route: /events (Public)
/abc/admin         → Brand: abc, Route: /admin (Privileged)
/cbc/api/v2/events → Brand: cbc, Route: /api/v2/events (Public)
```

**Classification applies to the remaining path after brand extraction.**

---

## 6. Implementation Plan

### 6.1 Current State

| Component | Status | Evidence |
|-----------|--------|----------|
| Public route enforcement | **IMPLEMENTED** | `guardPublicReadOnly()` in router.ts |
| Privileged route guards | **IMPLEMENTED** | `guardAdminOAuth()`, `guardV2AdminRoute()`, `guardAdminRoute()` |
| Audit logging | **IMPLEMENTED** | `logAdminAction()`, `logDeniedAccess()` in router.ts |
| QR-0 enforcement | **IMPLEMENTED** | Display/poster bundles check `qrVerified` |
| Rate limiting | **PARTIAL** | Cloudflare default, not explicitly configured |

### 6.2 Gap Analysis

| Gap | Priority | Remediation |
|-----|----------|-------------|
| Rate limiting not documented | Medium | Document Cloudflare rate limit config (SEC-EDGE-02) |
| No explicit route classification comments in code | Low | Add classification comments to route handlers |
| Debug endpoints in staging | By Design | `ENABLE_DEBUG_ENDPOINTS=true` only in staging |

### 6.3 Enforcement Verification

```bash
# Verify public routes block mutations
curl -X POST https://eventangle.com/events -d '{}'
# Expected: 403 PUBLIC_READ_ONLY

# Verify privileged routes require auth
curl -X POST https://eventangle.com/api/v2/admin/events -d '{}'
# Expected: 401 UNAUTHORIZED

# Verify QR-0 enforcement
curl https://eventangle.com/api/events/TEST_ID/displayBundle
# Expected: 403 QR_NOT_VERIFIED (if qrVerified != true)

# Verify health endpoints are accessible
curl https://eventangle.com/api/status
# Expected: 200 with version info
```

---

## 7. Controls Matrix

### 7.1 Required Controls by Classification

| Control | Public | Privileged | Infra |
|---------|--------|------------|-------|
| **Rate Limiting** | Required | Required | Required |
| **CORS Headers** | Required (API) | Required (API) | Required (API) |
| **Identity Verification** | No | **Required (NS-2)** | Varies |
| **Audit Logging** | No | **Required** | No |
| **QR-0 Enforcement** | Display/Poster only | Admin QR endpoints | No |
| **HTTPS Only** | Required | Required | Required |
| **Input Validation** | Required | Required | Required |
| **Error Masking** | Required | Required | Not required |

### 7.2 Guard Function Mapping

| Guard Function | Applied To | Effect on Failure |
|----------------|------------|-------------------|
| `guardPublicReadOnly()` | All routes (first check) | 403 PUBLIC_READ_ONLY |
| `guardSignedMutation()` | Public routes with mutation token | 403 SIGNATURE_INVALID |
| `guardV2AdminRoute()` | `/api/v2/admin/*` | 401 UNAUTHORIZED |
| `guardAdminRoute()` | `/api/admin/*`, `/api/events/:id/adminBundle` | 401 UNAUTHORIZED |
| `guardAdminOAuth()` | `/admin`, `/manage`, `/report`, etc. | Redirect to `/auth/login` |

---

## 8. Adding New Routes

### 8.1 Checklist for New Route Addition

```
NEW ROUTE CLASSIFICATION CHECKLIST

Route: _______________
Method(s): _______________

STEP 1: CLASSIFICATION
[ ] Determine classification using decision tree (Section 3.2)
    Classification: PUBLIC / PRIVILEGED / INFRA

STEP 2: NAMING COMPLIANCE
[ ] Route uses lowercase
[ ] Multi-word segments use kebab-case
[ ] No prohibited patterns (Section 5.2)
[ ] Brand prefix handling considered

STEP 3: REQUIRED CONTROLS
[ ] Rate limiting documented
[ ] CORS headers if API endpoint
[ ] Identity verification if PRIVILEGED
[ ] Audit logging if PRIVILEGED
[ ] QR-0 enforcement if display/poster surface
[ ] Input validation implemented
[ ] Error responses don't leak secrets

STEP 4: GUARD IMPLEMENTATION
[ ] Appropriate guard function applied in router.ts
[ ] Guard failure returns correct HTTP status
[ ] Denied access logged (SEC-IAC-06)

STEP 5: DOCUMENTATION
[ ] Route added to this classification table
[ ] Route documented in SECURITY_BASELINE.md if significant
[ ] Test coverage for auth enforcement

Added by: _______________ Date: _______________
```

### 8.2 Route Registration in router.ts

When adding a new route:

1. **Add to `matchRoute()` function** with appropriate handler mapping
2. **Apply guards** in the main handler switch statement
3. **Add audit logging** for privileged routes
4. **Update HTML_ROUTE_MAP** if it's a page route with aliases

---

## 9. Compliance Verification

### 9.1 Manual Verification Questions

| # | Question | Expected Answer | How to Verify |
|---|----------|-----------------|---------------|
| 1 | What class is `/events`? | Public | This document, Section 4.1 |
| 2 | What class is `/admin`? | Privileged | This document, Section 4.2 |
| 3 | What class is `/api/status`? | Infra (public) | This document, Section 4.3 |
| 4 | Can `/events` accept POST? | No (unless signed) | `guardPublicReadOnly()` blocks |
| 5 | Does `/admin` require auth? | Yes | `guardAdminOAuth()` enforces |
| 6 | Does `/api/status` require auth? | No | Publicly accessible health check |
| 7 | Are there any `/root/*` routes? | No | Prohibited pattern |
| 8 | How is NS-2 enforced? | Route guards | Guards + Cloudflare Access |
| 9 | How is QR-0 enforced? | Bundle handlers | `qrVerified` check in display/poster |

### 9.2 Automated Verification

```bash
# CI gate: Verify no prohibited route patterns
grep -r "router.*root\|router.*superuser\|router.*sudo" worker/src/
# Expected: No matches

# CI gate: Verify all /admin routes have guards
grep -A5 "case 'admin'" worker/src/router.ts | grep -i guard
# Expected: guardAdminOAuth or guardV2AdminRoute present

# CI gate: Verify PUBLIC_READ_ONLY guard is first check
head -100 worker/src/router.ts | grep guardPublicReadOnly
# Expected: Guard applied before route matching
```

---

## 10. Related Documents

| Document | Path | Relationship |
|----------|------|--------------|
| Security Baseline | `docs/security/SECURITY_BASELINE.md` | Parent policy (NS-2, QR-0) |
| Canonical Host Spec | `docs/security/CANONICAL_HOST_SPEC.md` | Host routing (SEC-4.1) |
| Worker Route Collapse | `docs/security/WORKER_ROUTE_COLLAPSE_RUNBOOK.md` | Route consolidation (SEC-4.2) |
| OAuth Implementation | — | SEC-IAC-03 guards |
| Public Read-Only | — | SEC-IAC-04 enforcement |
| Signed Mutations | — | SEC-IAC-05 signature validation |
| Audit Logging | — | SEC-IAC-06 action logging |

---

## 11. Summary

| Aspect | Value |
|--------|-------|
| **Total Route Classifications** | 3 (Public, Privileged, Infra) |
| **Public Routes** | ~17 route patterns (read-only) |
| **Privileged Routes** | ~14 route patterns (auth required) |
| **Infra Routes** | ~7 route patterns (operational) |
| **NS-2 Enforcement** | All privileged routes guarded |
| **QR-0 Enforcement** | Display/poster bundles + admin QR endpoints |
| **Prohibited Patterns** | `/root/*`, `/sudo/*`, `/superuser/*`, etc. |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-5.1 route classification policy |
