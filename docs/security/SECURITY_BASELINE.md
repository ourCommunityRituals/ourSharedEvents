# SECURITY_BASELINE.md — North Star Security Model

> **PROMPTSPEC-SEC-0.1** — Security Baseline Inventory
> Role: Director of Security + Lead Networking Consultant
> Created: 2026-01-05
> Last Updated: 2026-04-09 (D1 migration — replaced stale Google Sheets references)
> Status: **ACTIVE**

---

## 1. Scope

This document defines the security baseline for **EventAngle**, a multi-brand event management platform.

| Attribute             | Value                                                                 |
| --------------------- | --------------------------------------------------------------------- |
| **System**            | EventAngle MVP Event Toolkit                                          |
| **Version**           | 1.3.0 (Worker-only architecture)                                      |
| **Production Domain** | `eventangle.com`                                                      |
| **Staging Domain**    | `stg.eventangle.com`                                                  |
| **Edge Provider**     | Cloudflare (Workers + DNS Proxy)                                      |
| **Backend**           | Cloudflare D1 (edge SQLite) — previously Google Sheets API in Phase 1 |
| **Source Repository** | `zeventbooks/MVP-EVENT-TOOLKIT`                                       |

**In Scope:**

- All Cloudflare edge configuration (Workers, DNS, WAF, Access)
- All application routes (public, admin, infra)
- Authentication/authorization mechanisms
- Origin architecture and bypass prevention
- CI/CD security gates

**Out of Scope:**

- Third-party integrations not controlled by EventAngle
- End-user device security
- ~~Google Cloud internal security (assumed secure)~~ — no longer applicable (D1 migration)

---

## 2. North Star Invariants

These are the non-negotiable security principles. Every change must preserve these invariants.

| ID       | Invariant                                                                       | Verification Method                                    |
| -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **NS-1** | Every public request hits Cloudflare first                                      | DNS proxied (orange cloud), Worker route wildcards     |
| **NS-2** | Privileged surfaces require identity (Cloudflare Access) or cryptographic proof | OAuth guard (SEC-IAC-03), HMAC signatures (SEC-IAC-05) |
| **NS-3** | Origin bypass must fail (direct origin access is blocked/meaningless)           | Worker-only architecture (no exposed origin IP)        |
| **NS-4** | One edge entrypoint (no route sprawl); internal routing belongs in app/Worker   | Single `router.ts` handles all routing                 |
| **QR-0** | Never display a QR unless verified. If violated, the build must fail            | CI gate: QR verification required before display       |

### Invariant Compliance Status

| ID       | Status        | Evidence                                                                           |
| -------- | ------------- | ---------------------------------------------------------------------------------- |
| **NS-1** | **COMPLIANT** | All domains proxied via Cloudflare, Worker routes capture `/*`                     |
| **NS-2** | **COMPLIANT** | OAuth implemented (SEC-IAC-03), signed mutations (SEC-IAC-05), admin guards active |
| **NS-3** | **COMPLIANT** | Worker-only architecture since Story 5.2, no origin server to bypass               |
| **NS-4** | **PARTIAL**   | Single Worker router, but 3 route wildcards exist (apex, www, api)                 |
| **QR-0** | **COMPLIANT** | `verify-qr` endpoint enforced, unverified QRs blocked from display                 |

---

## 3. Current Surface

### 3.1 Hosts

| Host                     | Environment | Purpose            | Cloudflare Status |
| ------------------------ | ----------- | ------------------ | ----------------- |
| `eventangle.com`         | Production  | Apex domain        | Proxied           |
| `www.eventangle.com`     | Production  | **Canonical host** | Proxied           |
| `api.eventangle.com`     | Production  | API subdomain      | Proxied           |
| `stg.eventangle.com`     | Staging     | Staging site       | Proxied           |
| `api-stg.eventangle.com` | Staging     | Staging API        | Proxied           |

> **Canonical Host Decision:** `www.eventangle.com` is the canonical host (configured in `deploy-manifest.json`).
> **Gap:** Apex redirect (`eventangle.com` → `www.eventangle.com`) is **NOT IMPLEMENTED**.

### 3.2 Worker Routes

| Worker Name          | Environment | Route Patterns                                                     |
| -------------------- | ----------- | ------------------------------------------------------------------ |
| `eventangle-prod`    | Production  | `eventangle.com/*`, `www.eventangle.com/*`, `api.eventangle.com/*` |
| `eventangle-staging` | Staging     | `stg.eventangle.com/*`, `api-stg.eventangle.com/*`                 |

### 3.3 Route Sprawl Assessment

| Concern                  | Status                                         | Notes                                       |
| ------------------------ | ---------------------------------------------- | ------------------------------------------- |
| Multiple route wildcards | **3 in production**                            | `apex/*`, `www/*`, `api/*`                  |
| Route sprawl risk        | **LOW**                                        | All handled by single `router.ts`           |
| Recommendation           | Consolidate if `api.*` not externally consumed | Consider `www.eventangle.com/api/*` pattern |

### 3.4 All Endpoints Summary

**HTML Pages:** 20+ routes (via brand-prefix multiplier)
**API Endpoints:** 25+ routes (public + admin + health)
**Auth Endpoints:** 3 routes (`/auth/login`, `/auth/callback`, `/auth/logout`)
**Health Endpoints:** 3 routes (`/api/status`, `/api/health/backend`, `/health/origin`)

---

## 4. Trust Boundaries

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (Untrusted)                             │
│  User actions, form submissions, JavaScript execution                        │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ HTTPS only (HSTS preload)
┌──────────────────────────────────────────────────────────────────────────────┐
│                         CLOUDFLARE EDGE (Trust Boundary 1)                   │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌─────────────────────────────┐│
│  │ DNS Proxy  │ │ WAF/Rules  │ │ Bot Fight  │ │ Cloudflare Access (Identity)││
│  │ (hide IP)  │ │ (OWASP)    │ │ (anti-bot) │ │ (JWT assertion)             ││
│  └────────────┘ └────────────┘ └────────────┘ └─────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ Internal routing
┌──────────────────────────────────────────────────────────────────────────────┐
│                      CLOUDFLARE WORKER (Trust Boundary 2)                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                     Central Router (router.ts v1.24.0)                  │ │
│  │  ┌───────────────┐ ┌──────────────────┐ ┌─────────────────────────────┐ │ │
│  │  │ Public Routes │ │ Admin Guards     │ │ Auth Handlers               │ │ │
│  │  │ (read-only)   │ │ (OAuth, HMAC)    │ │ (Google OAuth, sessions)    │ │ │
│  │  └───────────────┘ └──────────────────┘ └─────────────────────────────┘ │ │
│  │  ┌───────────────────────────────────────────────────────────────────┐   │ │
│  │  │ Audit Logging (SEC-IAC-06) — all admin + denied actions logged    │   │ │
│  │  └───────────────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ D1 Binding (Worker-scoped)
┌──────────────────────────────────────────────────────────────────────────────┐
│                      CLOUDFLARE D1 (Trust Boundary 3)                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ Access: Worker binding only (no external credentials required)          │ │
│  │ Auth: D1 database_id in wrangler.toml (binding-scoped, not secret)     │ │
│  │ Tables: events, sponsors, analytics, audit_logs, config, shortlinks    │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│  Note: Previously Google Sheets API (Phase 1)                               │
│  ~~Auth: GOOGLE_SA_CLIENT_EMAIL + GOOGLE_SA_PRIVATE_KEY_PEM~~ (removed)     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Identity Requirements by Boundary

| Transition              | Identity Required       | Mechanism                     | Enforcement                                                                                |
| ----------------------- | ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| Browser → Edge (Public) | None                    | Route matching                | N/A                                                                                        |
| Browser → Edge (Admin)  | **Yes**                 | Cloudflare Access JWT         | `Cf-Access-Jwt-Assertion` header                                                           |
| Edge → Worker (Public)  | None                    | Automatic                     | N/A                                                                                        |
| Edge → Worker (Admin)   | **Yes**                 | OAuth session or Bearer token | `guardAdminOAuth()`, `guardV2AdminRoute()`                                                 |
| Worker → Cloudflare D1  | **No** (binding-scoped) | D1 Worker binding             | `wrangler.toml` database binding (previously Google Sheets service account JWT in Phase 1) |

---

## 5. Route Classification

### 5.1 Public Routes (No Auth Required)

| Category          | Example Paths                                                     | Method(s) | Handler                |
| ----------------- | ----------------------------------------------------------------- | --------- | ---------------------- |
| **Landing Pages** | `/`, `/public`, `/events`, `/schedule`, `/calendar`               | GET       | HTML (public surface)  |
| **Display Pages** | `/display`, `/tv`, `/kiosk`, `/screen`                            | GET       | HTML (display surface) |
| **Poster Pages**  | `/poster`, `/posters`, `/flyers`                                  | GET       | HTML (poster surface)  |
| **Sponsor Pages** | `/sponsor`, `/sponsors`, `/partnership`                           | GET       | HTML (sponsor surface) |
| **Public API**    | `/api/events`, `/api/v2/events`, `/api/events/:id`                | GET       | JSON (read-only)       |
| **Bundle API**    | `/api/events/:id/publicBundle`, `/displayBundle`, `/posterBundle` | GET       | JSON (read-only)       |
| **Sponsor API**   | `/api/v2/sponsors`, `/api/v2/sponsor/:id`                         | GET       | JSON (read-only)       |
| **Static Assets** | `/web/shared/*.js`                                                | GET       | JavaScript modules     |

**Enforcement:** `guardPublicReadOnly()` blocks POST/PUT/DELETE/PATCH on public routes (SEC-IAC-04).

### 5.2 Privileged Routes (Auth Required)

| Category               | Path Pattern                                         | Method(s) | Auth Mechanism      | Guard                 |
| ---------------------- | ---------------------------------------------------- | --------- | ------------------- | --------------------- |
| **Admin Pages**        | `/admin`, `/manage`, `/dashboard`, `/create`         | GET       | OAuth session       | `guardAdminOAuth()`   |
| **Analytics Pages**    | `/report`, `/analytics`, `/reports`, `/insights`     | GET       | OAuth session       | `guardAdminOAuth()`   |
| **Admin API (Legacy)** | `/api/admin/events`, `/api/admin/events/:id/results` | POST      | Bearer token        | `guardAdminRoute()`   |
| **Admin API (V2)**     | `/api/v2/admin/events`, `/api/v2/admin/events/:id`   | POST, PUT | Access JWT / Bearer | `guardV2AdminRoute()` |
| **QR Verification**    | `/api/v2/admin/events/:id/verify-qr`, `/unverify-qr` | POST      | Access JWT / Bearer | `guardV2AdminRoute()` |
| **Archive Actions**    | `/api/v2/admin/events/:id/archive`, `/unarchive`     | POST      | Access JWT / Bearer | `guardV2AdminRoute()` |

**Authentication Stack:**

1. **OAuth 2.0** (SEC-IAC-03): Google OAuth → Session cookie → Email allowlist
2. **Cloudflare Access**: JWT assertion header (`Cf-Access-Jwt-Assertion`)
3. **Bearer Token**: `Authorization: Bearer <ADMIN_TOKEN>` (fallback)
4. **Signed Mutations** (SEC-IAC-05): HMAC-SHA256 tokens for public write actions

### 5.3 Infrastructure Routes

| Path                         | Purpose                 | Public? | Notes                                              |
| ---------------------------- | ----------------------- | ------- | -------------------------------------------------- |
| `/api/status`                | Health check            | Yes     | Returns worker version                             |
| `/api/health/backend`        | Backend auth validation | Yes     | Returns `secretsConfigured`, `tokenMintSuccess`    |
| `/health/origin`             | Upstream config check   | Yes     | Returns `UPSTREAM_NOT_CONFIGURED` if misconfigured |
| `/api/v2/monetization/inert` | CI/CD gate (Story F4)   | Yes     | Compliance check                                   |
| `/auth/login`                | OAuth initiation        | Yes     | Redirects to Google                                |
| `/auth/callback`             | OAuth callback          | Yes     | Handles code exchange                              |
| `/auth/logout`               | Session termination     | Yes     | Clears session cookie                              |

---

## 6. Origins

### 6.1 Origin Architecture

| Origin Type            | Endpoint                 | Status                               | Bypass Risk                                    |
| ---------------------- | ------------------------ | ------------------------------------ | ---------------------------------------------- |
| **Cloudflare Worker**  | `eventangle-router`      | **ACTIVE** (Primary)                 | **NONE** (no origin IP)                        |
| **Cloudflare D1**      | D1 binding (edge SQLite) | **ACTIVE** (Data backend)            | **NONE** (binding-scoped, no external access)  |
| **Google Sheets API**  | `sheets.googleapis.com`  | **ARCHIVED** (D1 migration, Phase 2) | **N/A** (removed) — previously used in Phase 1 |
| **Google Apps Script** | `script.google.com`      | **ARCHIVED** (Story 5.2)             | **N/A** (deprecated)                           |

### 6.2 Worker-Only Architecture (NS-3 Compliance)

The system operates in **Worker-only mode** (Story 5.2):

```
BACKEND_MODE=worker  # Only supported mode
```

| Characteristic            | Value                                 |
| ------------------------- | ------------------------------------- |
| Origin IP                 | **None** (Workers have no exposed IP) |
| Direct bypass possible?   | **No**                                |
| GAS dependency            | **Removed** (archived in `/archive/`) |
| Origin protection needed? | **N/A** (no origin to protect)        |

### 6.3 Origin Bypass Risk Assessment

| Attack Vector        | Risk Level     | Mitigation                                 | Status             |
| -------------------- | -------------- | ------------------------------------------ | ------------------ |
| Direct IP access     | **ELIMINATED** | Worker-only architecture                   | **NS-3 COMPLIANT** |
| DNS bypass           | **LOW**        | All DNS proxied (orange cloud)             | **NS-1 COMPLIANT** |
| API credential theft | **LOW**        | Secrets in Cloudflare KV/vars              | Protected          |
| GAS URL discovery    | **N/A**        | GAS deprecated, URLs archived              | Mitigated          |
| D1 direct access     | **ELIMINATED** | Worker binding only (no external endpoint) | **NS-3 COMPLIANT** |

### 6.4 Banned Origins Enforcement

**Guard:** `npm run check:banned-origins`
**Script:** `scripts/check-banned-origins.mjs`
**Policy:** Block `script.google.com/macros/*` in runtime code
**CI Gate:** **REQUIRED** — merge blocked on violation

---

## 7. Current Risk Register

| ID        | Risk                                    | Severity   | Likelihood | Impact                   | Status                 | Notes                                                    |
| --------- | --------------------------------------- | ---------- | ---------- | ------------------------ | ---------------------- | -------------------------------------------------------- |
| **R-001** | Apex redirect not implemented           | **MEDIUM** | High       | SEO split, phishing risk | **OPEN**               | `eventangle.com` should redirect to `www.eventangle.com` |
| **R-002** | Multiple route wildcards (NS-4 partial) | **LOW**    | N/A        | Config complexity        | **OPEN**               | 3 wildcards vs 1 ideal                                   |
| **R-003** | WAF rules not documented                | **MEDIUM** | Medium     | Unknown protection level | **NEEDS VERIFICATION** | Cloudflare WAF state unknown                             |
| **R-004** | Rate limiting not verified              | **MEDIUM** | Medium     | DoS vulnerability        | **NEEDS VERIFICATION** | Cloudflare rate limits assumed                           |
| **R-005** | Legacy query param auth                 | **LOW**    | Low        | Credential leak in logs  | **DEPRECATED**         | `?adminKey=` still accepted                              |
| **R-006** | Debug endpoints in staging              | **LOW**    | Low        | Info disclosure          | **BY DESIGN**          | `ENABLE_DEBUG_ENDPOINTS=true` in staging only            |

### Risk Severity Definitions

| Severity     | Definition                                                     |
| ------------ | -------------------------------------------------------------- |
| **CRITICAL** | Immediate exploitation possible, data breach likely            |
| **HIGH**     | Exploitation possible with moderate effort, significant impact |
| **MEDIUM**   | Exploitation requires specific conditions, moderate impact     |
| **LOW**      | Minimal impact, defense-in-depth concern                       |

---

## 8. Target State

### 8.1 Architecture Target

```
                    ┌─────────────────────────────────┐
                    │      www.eventangle.com         │
                    │      (Single Edge Entrypoint)   │
                    └─────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │       CLOUDFLARE EDGE          │
                    │  - WAF (documented rules)      │
                    │  - Rate Limiting (configured)  │
                    │  - Bot Fight Mode (enabled)    │
                    │  - Access (admin gating)       │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │     CLOUDFLARE WORKER          │
                    │  - Single router.ts entrypoint │
                    │  - OAuth + allowlist (admin)   │
                    │  - Signed mutations (public)   │
                    │  - Audit logging (all actions) │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │     CLOUDFLARE D1 (SQLite)     │
                    │  - Worker binding only         │
                    │  - No external access          │
                    └───────────────────────────────┘
```

### 8.2 Target State Checklist

| Requirement                | Current           | Target                   | Gap                          |
| -------------------------- | ----------------- | ------------------------ | ---------------------------- |
| Single edge entrypoint     | 3 wildcards       | 1 canonical host         | Implement apex redirect      |
| Cloudflare Access on admin | OAuth implemented | Access gating documented | Document Access config       |
| Origin bypass prevention   | Worker-only       | Worker-only              | **ACHIEVED**                 |
| WAF rules documented       | Unknown           | Documented + tested      | Audit Cloudflare WAF         |
| Rate limits documented     | Unknown           | Documented + tested      | Audit Cloudflare Rate Limits |
| Apex → www redirect        | Not implemented   | Page Rule or Worker      | Implement redirect           |
| QR verification enforced   | Implemented       | CI gate                  | **ACHIEVED**                 |
| Audit logging              | Implemented       | All actions logged       | **ACHIEVED**                 |

### 8.3 Bypass Prevention Summary

| Vector                | Prevention Mechanism    | Verification         |
| --------------------- | ----------------------- | -------------------- |
| Direct origin access  | Worker-only (no origin) | N/A                  |
| DNS bypass            | Cloudflare proxied      | `dig` returns CF IPs |
| Subdomain enumeration | Limited subdomains      | DNS audit            |
| Credential stuffing   | OAuth + allowlist       | SEC-IAC-03           |
| Unsigned mutations    | HMAC signatures         | SEC-IAC-05           |

---

## 9. Execution Order Index

This baseline links to subsequent PromptSpecs for implementation:

| PromptSpec ID   | Title                                | Dependency | Priority | Status                    |
| --------------- | ------------------------------------ | ---------- | -------- | ------------------------- |
| **SEC-0.1**     | Security Baseline Inventory          | —          | 0        | **THIS DOCUMENT**         |
| **SEC-IAC-01**  | Worker-Only Architecture Enforcement | SEC-0.1    | 1        | **IMPLEMENTED**           |
| **SEC-IAC-02**  | Canonical Host & Apex Redirect       | SEC-0.1    | 1        | **DOCUMENTED** (apex gap) |
| **SEC-IAC-03**  | Admin OAuth + Allowlist              | SEC-0.1    | 1        | **IMPLEMENTED**           |
| **SEC-IAC-04**  | Public Read-Only Enforcement         | SEC-0.1    | 1        | **IMPLEMENTED**           |
| **SEC-IAC-05**  | Signed Public Mutations (HMAC)       | SEC-IAC-04 | 2        | **IMPLEMENTED**           |
| **SEC-IAC-06**  | Audit Logging                        | SEC-IAC-03 | 2        | **IMPLEMENTED**           |
| **SEC-IAC-07**  | IAC Smoke Tests (CI Enforcement)     | SEC-IAC-06 | 3        | **IMPLEMENTED**           |
| **SEC-EDGE-01** | WAF Rules Documentation              | SEC-0.1    | —        | Pending                   |
| **SEC-EDGE-02** | Rate Limiting Configuration          | SEC-0.1    | —        | Pending                   |
| **SEC-EDGE-03** | Apex Redirect Implementation         | SEC-IAC-02 | —        | Pending                   |

### Related Runbooks

| Runbook                     | Path                                          | Purpose                    |
| --------------------------- | --------------------------------------------- | -------------------------- |
| SEC-1 Cloudflare Account    | `docs/RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md`    | MFA + account hardening    |
| SEC-1.2 Scoped API Tokens   | `docs/RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md`   | Replace global API key     |
| SEC-2.1 Registrar Lock      | `docs/RUNBOOK-SEC-2.1-REGISTRAR-LOCK-MFA.md`  | Domain protection          |
| SEC-2.2 DNSSEC              | `docs/RUNBOOK-SEC-2.2-DNSSEC.md`              | DNS integrity              |
| SEC-3.1 Strict TLS          | `docs/RUNBOOK-SEC-3.1-STRICT-TLS.md`          | TLS configuration          |
| SEC-3.2 HSTS                | `docs/RUNBOOK-SEC-3.2-HSTS-PHASED.md`         | HSTS rollout               |
| SEC-4.1 Canonical Host      | `docs/RUNBOOK-SEC-4.1-CANONICAL-HOST.md`      | Canonical host enforcement |
| SEC-4.2 Single Worker Route | `docs/RUNBOOK-SEC-4.2-SINGLE-WORKER-ROUTE.md` | Route consolidation        |

---

## Verification

### Quick Verification Commands

```bash
# Verify Worker is responding (NS-1)
curl -s https://www.eventangle.com/api/status | jq .

# Verify backend health
curl -s https://www.eventangle.com/api/health/backend | jq .

# Verify admin requires auth (NS-2) — should return 401/403
curl -s https://www.eventangle.com/api/v2/admin/events | jq .

# Verify origin config
curl -s https://www.eventangle.com/health/origin | jq .

# Verify staging
curl -s https://stg.eventangle.com/api/status | jq .
```

### Manual Verification Checklist

A reviewer can answer these questions in under 2 minutes using this document:

1. **What's public?** → Section 5.1: All `GET` routes to public pages and read-only API endpoints
2. **What's privileged?** → Section 5.2: `/admin/*`, `/api/admin/*`, `/api/v2/admin/*` routes
3. **What's origin?** → Section 6: Worker-only (no origin IP), Cloudflare D1 as data backend
4. **What are the invariants?** → Section 2: NS-1 through NS-4 + QR-0
5. **What's the canonical host?** → Section 3.1: `www.eventangle.com` (apex redirect pending)
6. **What are the risks?** → Section 7: Risk register with 6 items, 2 medium severity

---

## Document History

| Date       | Author      | Changes                                                                                 |
| ---------- | ----------- | --------------------------------------------------------------------------------------- |
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-0.1 baseline (North Star format)                                 |
| 2026-04-09 | Claude Code | D1 migration: replaced Google Sheets with D1 in trust boundaries, origins, and diagrams |
