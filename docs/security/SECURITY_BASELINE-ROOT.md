# Security Baseline - EventAngle

> **North Star Security Model Inventory**
> Epic SEC-0, Story SEC-0.1 — Document Current Edge Surface + Trust Boundaries
>
> Created: 2025-12-20
> Last Updated: 2025-12-20 (SEC-2.2 added)
> Status: Active

---

## Table of Contents

1. [Surface](#1-surface)
2. [Trust Boundaries](#2-trust-boundaries)
3. [Route Map](#3-route-map)
4. [Origins](#4-origins)
5. [Secrets](#5-secrets)
6. [Risks](#6-risks)
7. [Next Steps](#7-next-steps)

---

## 1. Surface

### 1.1 Domains & Subdomains

| Domain                   | Environment | Purpose          | Edge Status        |
| ------------------------ | ----------- | ---------------- | ------------------ |
| `eventangle.com`         | Production  | Apex domain      | Cloudflare proxied |
| `www.eventangle.com`     | Production  | Canonical host   | Cloudflare proxied |
| `api.eventangle.com`     | Production  | API subdomain    | Cloudflare proxied |
| `stg.eventangle.com`     | Staging     | Staging frontend | Cloudflare proxied |
| `api-stg.eventangle.com` | Staging     | Staging API      | Cloudflare proxied |

**Cloudflare Zone:** `eventangle.com`

### 1.2 Canonical Host Decision

| Decision       | Value                                   | Status                                   |
| -------------- | --------------------------------------- | ---------------------------------------- |
| Canonical Host | `www.eventangle.com`                    | **CONFIGURED** (in deploy-manifest.json) |
| Apex Redirect  | `eventangle.com` → `www.eventangle.com` | **NOT IMPLEMENTED**                      |
| API Host       | `api.eventangle.com`                    | Separate subdomain                       |

> **Gap Identified:** No explicit redirect from apex to www is implemented in the Worker.

### 1.3 Cloudflare Worker Entrypoints

| Worker Name          | Routes                                                             | Entry Point            |
| -------------------- | ------------------------------------------------------------------ | ---------------------- |
| `eventangle-prod`    | `eventangle.com/*`, `www.eventangle.com/*`, `api.eventangle.com/*` | `worker/src/router.ts` |
| `eventangle-staging` | `stg.eventangle.com/*`, `api-stg.eventangle.com/*`                 | `worker/src/router.ts` |

---

## 2. Trust Boundaries

### 2.1 Trust Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INTERNET                                        │
│                          (Untrusted Zone)                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLOUDFLARE EDGE                                      │
│                      (First Trust Boundary)                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   DNS       │  │   WAF       │  │   Bot       │  │   DDoS Protection  │ │
│  │   Proxy     │  │   Rules     │  │   Fight     │  │   (Always-On)      │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CLOUDFLARE WORKERS                                     │
│                     (Second Trust Boundary)                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    Central Router (router.ts)                           ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   ││
│  │  │ Public       │  │ Admin Auth   │  │ API Handler  │                   ││
│  │  │ HTML Pages   │  │ Middleware   │  │ Routes       │                   ││
│  │  └──────────────┘  └──────────────┘  └──────────────┘                   ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        GOOGLE SHEETS API                                     │
│                      (Third Trust Boundary)                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Service Account Authentication (GOOGLE_SA_CLIENT_EMAIL + KEY)         ││
│  │  Scopes: spreadsheets (read/write)                                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Identity Requirements by Zone

| Zone                         | Identity Requirement           | Mechanism                                           |
| ---------------------------- | ------------------------------ | --------------------------------------------------- |
| Public Internet → Cloudflare | None                           | DNS resolution                                      |
| Cloudflare → Worker (Public) | None                           | Route matching                                      |
| Cloudflare → Worker (Admin)  | **Access JWT or Bearer Token** | `Cf-Access-Jwt-Assertion` or `Authorization` header |
| Worker → Google Sheets       | **Service Account JWT**        | OAuth 2.0 JWT assertion                             |

### 2.3 Current Authentication Mechanisms

| Mechanism                | Header/Parameter                      | Protected Routes                              | Status                                              |
| ------------------------ | ------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| Cloudflare Access JWT    | `Cf-Access-Jwt-Assertion`             | `/api/v2/admin/*`                             | **IMPLEMENTED**                                     |
| Admin Key Bearer Token   | `Authorization: Bearer <ADMIN_KEY>`   | `/api/v2/admin/*`                             | **FALLBACK** (when `ALLOW_ADMIN_KEY_FALLBACK=true`) |
| Admin Token (Legacy)     | `Authorization: Bearer <ADMIN_TOKEN>` | `/api/admin/*`, `/api/events/:id/adminBundle` | **IMPLEMENTED**                                     |
| Query Parameter (Legacy) | `?adminKey=<token>`                   | `/api/admin/*`                                | **DEPRECATED** (backward compat)                    |

---

## 3. Route Map

### 3.1 Public Routes (No Authentication Required)

| Path Pattern                            | Type   | Handler          | Notes             |
| --------------------------------------- | ------ | ---------------- | ----------------- |
| `/`                                     | HTML   | `public` page    | Default landing   |
| `/public`                               | HTML   | `public` page    | Events list       |
| `/events`                               | HTML   | `public` page    | Events list       |
| `/schedule`                             | HTML   | `public` page    | Event schedule    |
| `/calendar`                             | HTML   | `public` page    | Calendar view     |
| `/display`, `/tv`, `/kiosk`, `/screen`  | HTML   | `display` page   | Digital signage   |
| `/poster`, `/posters`, `/flyers`        | HTML   | `poster` page    | Poster generator  |
| `/sponsor`, `/sponsors`, `/partnership` | HTML   | `sponsor` page   | Sponsor info      |
| `/api/status`                           | API    | Status ping      | Health check      |
| `/api/health/backend`                   | API    | Backend health   | Auth validation   |
| `/health/origin`                        | API    | Origin health    | Config validation |
| `/api/events`                           | API    | Events list      | Public data       |
| `/api/v2/events`                        | API    | Events list      | V2 format         |
| `/api/events/:id`                       | API    | Single event     | Public data       |
| `/api/events/:id/publicBundle`          | API    | Public bundle    | No auth           |
| `/api/events/:id/displayBundle`         | API    | Display bundle   | No auth           |
| `/api/events/:id/posterBundle`          | API    | Poster bundle    | No auth           |
| `/api/v2/sponsors`                      | API    | Sponsors list    | Public data       |
| `/api/v2/sponsor/:id`                   | API    | Single sponsor   | Public data       |
| `/api/v2/sharedreport`                  | API    | Analytics bundle | Public data       |
| `/web/shared/*.js`                      | Static | Shared modules   | JS assets         |

### 3.2 Privileged Routes (Authentication Required)

| Path Pattern                                     | Type | Auth Mechanism           | Handler           |
| ------------------------------------------------ | ---- | ------------------------ | ----------------- |
| `/admin`                                         | HTML | **SHOULD BE PROTECTED**  | Admin dashboard   |
| `/manage`                                        | HTML | **SHOULD BE PROTECTED**  | Event management  |
| `/dashboard`                                     | HTML | **SHOULD BE PROTECTED**  | Dashboard         |
| `/create`                                        | HTML | **SHOULD BE PROTECTED**  | Event creation    |
| `/report`, `/analytics`, `/reports`, `/insights` | HTML | **SHOULD BE PROTECTED**  | Analytics         |
| `/api/events/:id/adminBundle`                    | API  | `ADMIN_TOKEN`            | Admin data bundle |
| `/api/admin/events`                              | API  | `ADMIN_TOKEN`            | Create event      |
| `/api/admin/events/:id/results`                  | API  | `ADMIN_TOKEN`            | Record results    |
| `/api/v2/admin/events`                           | API  | `ADMIN_KEY` / Access JWT | Create event      |
| `/api/v2/admin/events/:id`                       | API  | `ADMIN_KEY` / Access JWT | Update event      |
| `/api/v2/admin/events/:id/archive`               | API  | `ADMIN_KEY` / Access JWT | Archive event     |
| `/api/v2/admin/events/:id/unarchive`             | API  | `ADMIN_KEY` / Access JWT | Unarchive event   |
| `/api/v2/admin/events/:id/default`               | API  | `ADMIN_KEY` / Access JWT | Set default       |
| `/api/v2/admin/events/:id/verify-qr`             | API  | `ADMIN_KEY` / Access JWT | QR verification   |

### 3.3 Special Endpoints

| Path                         | Purpose               | Visibility | Notes                                            |
| ---------------------------- | --------------------- | ---------- | ------------------------------------------------ |
| `/health/origin`             | Upstream config check | Internal   | Returns UPSTREAM_NOT_CONFIGURED if misconfigured |
| `/api/health/backend`        | Backend auth health   | Public     | Returns secretsConfigured, tokenMintSuccess      |
| `/api/status`                | Basic health ping     | Public     | Returns worker version                           |
| `/api/v2/monetization/inert` | CI/CD gate            | Internal   | Story F4 compliance                              |

### 3.4 Route Sprawl Analysis

**Current State:** Multiple route patterns handled by single Worker router.

| Entry Point            | Routes Count | Status                   |
| ---------------------- | ------------ | ------------------------ |
| `eventangle.com/*`     | 1 wildcard   | Good                     |
| `www.eventangle.com/*` | 1 wildcard   | Good                     |
| `api.eventangle.com/*` | 1 wildcard   | **Question: Necessary?** |

> **NS-4 Compliance:** Mostly compliant. Consider consolidating `api.eventangle.com` into main Worker if API is not externally consumed by third parties.

---

## 4. Origins

### 4.1 Origin Architecture

| Origin Type               | Endpoint                | Status       | Notes                   |
| ------------------------- | ----------------------- | ------------ | ----------------------- |
| **Worker-Only (Primary)** | Cloudflare Worker       | **ACTIVE**   | All traffic routes here |
| **Google Sheets API**     | `sheets.googleapis.com` | **ACTIVE**   | Data backend            |
| **Google Apps Script**    | `script.google.com`     | **ARCHIVED** | Deprecated in Story 5.2 |

### 4.2 Backend Mode Configuration

```
BACKEND_MODE=worker  (ONLY supported mode in production)
```

| Mode     | Status         | Description                               |
| -------- | -------------- | ----------------------------------------- |
| `worker` | **ACTIVE**     | All logic in Workers, Sheets API for data |
| `gas`    | **DEPRECATED** | Legacy GAS backend                        |
| `mixed`  | **DEPRECATED** | Hybrid mode                               |

### 4.3 Origin Bypass Risk Assessment

| Attack Vector           | Current Protection    | Status        |
| ----------------------- | --------------------- | ------------- |
| Direct origin IP access | N/A (Worker-only)     | **MITIGATED** |
| DNS bypass              | Cloudflare proxied    | **PROTECTED** |
| API key leakage         | Secrets in Cloudflare | **PROTECTED** |
| GAS URL discovery       | URLs archived         | **LOW RISK**  |

> **NS-3 Compliance:** Worker-only architecture means no origin to bypass. Google Sheets API is protected by service account auth.

---

## 5. Secrets

### 5.1 Current Secrets Inventory

#### Cloudflare Worker Secrets

| Secret Name                 | Purpose               | Rotation Schedule | Set Via               |
| --------------------------- | --------------------- | ----------------- | --------------------- |
| `GOOGLE_SA_CLIENT_EMAIL`    | Service account email | 90 days           | `wrangler secret put` |
| `GOOGLE_SA_PRIVATE_KEY_PEM` | Service account key   | 90 days           | `wrangler secret put` |
| `SHEETS_SPREADSHEET_ID`     | Target spreadsheet    | As needed         | `wrangler secret put` |
| `ADMIN_TOKEN`               | Legacy admin auth     | 90 days           | `wrangler secret put` |
| `ADMIN_KEY`                 | V2 admin auth         | 90 days           | `wrangler secret put` |

#### GitHub Actions Secrets

| Secret Name                     | Purpose              | Used In       |
| ------------------------------- | -------------------- | ------------- |
| `CLOUDFLARE_API_TOKEN`          | Wrangler deployment  | Stage-1 CI/CD |
| `CLOUDFLARE_ACCOUNT_ID`         | Account identifier   | Stage-1 CI/CD |
| `GOOGLE_CLIENT_EMAIL`           | SA email (CI/CD)     | Stage-2 tests |
| `GOOGLE_PRIVATE_KEY`            | SA key (CI/CD)       | Stage-2 tests |
| `STAGING_SHEETS_SPREADSHEET_ID` | Staging spreadsheet  | Stage-2 tests |
| `ADMIN_KEY_ROOT`                | Root admin key       | Stage-2 tests |
| `CF_ACCESS_CLIENT_ID`           | Access service token | Optional      |
| `CF_ACCESS_CLIENT_SECRET`       | Access service token | Optional      |

### 5.2 Secrets Exposure Risks

| Risk                             | Current State             | Mitigation                |
| -------------------------------- | ------------------------- | ------------------------- |
| Secrets in environment variables | Used (wrangler.toml vars) | Non-sensitive only        |
| Secrets in code                  | **NONE**                  | Enforced by code review   |
| Secrets in logs                  | **NONE**                  | DEBUG_LEVEL=error in prod |
| Secrets in error responses       | **NONE**                  | Generic error messages    |

### 5.3 Secret Verification

| Endpoint              | Check                           | Response                             |
| --------------------- | ------------------------------- | ------------------------------------ |
| `/health/origin`      | All upstream secrets configured | `UPSTREAM_NOT_CONFIGURED` if missing |
| `/api/health/backend` | Google auth secrets             | `secretsConfigured: true/false`      |

---

## 6. Risks

### 6.1 High Priority Risks

| Risk ID   | Description                           | Impact                         | Likelihood | Status                 |
| --------- | ------------------------------------- | ------------------------------ | ---------- | ---------------------- |
| **R-001** | Admin HTML pages not Access-protected | Unauthorized admin access      | Medium     | **OPEN**               |
| **R-002** | No apex → www redirect                | SEO issues, potential phishing | Low        | **OPEN**               |
| **R-003** | No rate limiting in code              | DoS vulnerability              | Medium     | **NEEDS VERIFICATION** |
| **R-004** | WAF rules not documented              | Unknown protection level       | Medium     | **NEEDS VERIFICATION** |

### 6.2 Medium Priority Risks

| Risk ID   | Description                        | Impact                     | Likelihood | Status                |
| --------- | ---------------------------------- | -------------------------- | ---------- | --------------------- |
| **R-005** | Legacy query param auth            | Credential leakage in logs | Medium     | **DEPRECATED**        |
| **R-006** | `ALLOW_ADMIN_KEY_FALLBACK` enabled | Weaker auth in some paths  | Low        | **BY DESIGN** (CI/CD) |
| **R-007** | Multiple wrangler.toml files       | Config drift risk          | Low        | **OPEN**              |
| **R-008** | Debug endpoints in staging         | Information disclosure     | Low        | **BY DESIGN**         |

### 6.3 Cloudflare Toggle Status (Needs Verification)

| Toggle                     | Expected State  | Verified | Notes                              |
| -------------------------- | --------------- | -------- | ---------------------------------- |
| Proxied DNS (orange cloud) | ON              | **TODO** | All domains should be proxied      |
| WAF Managed Rules          | ON              | **TODO** | OWASP rules                        |
| Bot Fight Mode             | ON              | **TODO** | Referenced in CI/CD error handling |
| TLS Mode                   | Full (Strict)   | **TODO** | Origin has valid cert              |
| Always Use HTTPS           | ON              | **TODO** | Redirect HTTP → HTTPS              |
| Minimum TLS Version        | 1.2+            | **TODO** | Block old TLS                      |
| Under Attack Mode          | OFF (available) | **TODO** | Enable during attacks              |

---

## 7. Next Steps

### 7.1 Immediate Actions (SEC-0 Completion)

- [ ] **SEC-0.1.1:** Verify all Cloudflare toggles in dashboard and document actual state
- [ ] **SEC-0.1.2:** Export Cloudflare configuration summary (Page Rules, WAF, etc.)
- [ ] **SEC-0.1.3:** Screenshot bundle of current dashboard settings

### 7.2 North Star Security Model Implementation Order

| Story     | Title                                              | Dependency     | Priority | Status          |
| --------- | -------------------------------------------------- | -------------- | -------- | --------------- |
| **SEC-0** | Security Baseline Inventory                        | -              | 0        | **COMPLETE**    |
| **SEC-1** | Identity & Access Control                          | SEC-0 complete | 1        | **IN PROGRESS** |
| **SEC-2** | Domain Control (DNS/Registrar Takeover Prevention) | SEC-1          | 2        | **IN PROGRESS** |
| **SEC-3** | TLS Configuration                                  | SEC-2          | 3        | Pending         |
| **SEC-4** | Single Edge Entrypoint                             | SEC-3          | 4        | Pending         |
| **SEC-5** | Rate Limits & WAF                                  | SEC-4          | 5        | Pending         |
| **SEC-6** | Origin Protection                                  | SEC-5          | 6        | Pending         |
| **SEC-7** | Observability & Logging                            | SEC-6          | 7        | Pending         |
| **SEC-8** | Regression Gates                                   | SEC-7          | 8        | Pending         |

#### SEC-1 Story Breakdown

| Story   | Title                                         | Runbook                                                                           | Status         |
| ------- | --------------------------------------------- | --------------------------------------------------------------------------------- | -------------- |
| SEC-1.1 | Enforce Strong MFA + Remove Unsafe Auth Paths | [RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md](docs/RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md)   | **DOCUMENTED** |
| SEC-1.2 | Replace Global API Key with Scoped Tokens     | [RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md](docs/RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md) | **DOCUMENTED** |
| SEC-1.3 | Cloudflare Access Configuration               | TBD                                                                               | Pending        |

#### SEC-2 Story Breakdown

| Story   | Title                                   | Runbook                                                                             | Status         |
| ------- | --------------------------------------- | ----------------------------------------------------------------------------------- | -------------- |
| SEC-2.1 | Registrar Lock + MFA + Recovery Hygiene | [RUNBOOK-SEC-2.1-REGISTRAR-LOCK-MFA.md](docs/RUNBOOK-SEC-2.1-REGISTRAR-LOCK-MFA.md) | **DOCUMENTED** |
| SEC-2.2 | DNSSEC Configuration                    | [RUNBOOK-SEC-2.2-DNSSEC.md](docs/RUNBOOK-SEC-2.2-DNSSEC.md)                         | **DOCUMENTED** |
| SEC-2.3 | DNS Record Audit + Monitoring           | TBD                                                                                 | Pending        |

### 7.3 Definition of Done Checklist

| Criterion                               | Current State          | Target                   |
| --------------------------------------- | ---------------------- | ------------------------ |
| Single Worker route governs traffic     | Partial (3 wildcards)  | Review api.\* necessity  |
| www canonical redirect works            | **NOT IMPLEMENTED**    | Implement apex → www     |
| Privileged paths blocked without Access | API only, HTML exposed | Protect admin HTML paths |
| Direct origin hits fail                 | N/A (Worker-only)      | **COMPLIANT**            |
| Rate limits active and measurable       | Unknown                | Verify & document        |
| WAF rules active and measurable         | Unknown                | Verify & document        |
| Verification checklist passes           | Not created            | Create automated tests   |

---

## Appendix A: Configuration Files Reference

| File                                         | Purpose                                 |
| -------------------------------------------- | --------------------------------------- |
| `wrangler.toml` (root)                       | Staging Worker config                   |
| `cloudflare-proxy/wrangler.toml`             | Legacy dual-env config                  |
| `worker/wrangler.toml`                       | Production TypeScript router config     |
| `deploy-manifest.json`                       | Single source of truth for environments |
| `.github/workflows/stage1.yml`               | CI/CD pipeline                          |
| `.github/workflows/stage2.yml`               | Post-deployment validation              |
| `.github/workflows/security-scan.yml`        | Security scanning                       |
| `docs/SECURITY.md`                           | Security procedures                     |
| `docs/CLOUDFLARE_SECRETS.md`                 | Secrets reference                       |
| `docs/RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md`   | SEC-1.1 MFA & Account Hardening         |
| `docs/RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md`  | SEC-1.2 Scoped API Tokens               |
| `docs/RUNBOOK-SEC-2.1-REGISTRAR-LOCK-MFA.md` | SEC-2.1 Registrar Lock + MFA            |
| `docs/RUNBOOK-SEC-2.2-DNSSEC.md`             | SEC-2.2 DNSSEC Configuration            |

---

## Appendix B: Verification Commands

```bash
# Verify Worker deployment
curl -s https://www.eventangle.com/api/status | jq .

# Verify backend health
curl -s https://www.eventangle.com/api/health/backend | jq .

# Verify origin configuration
curl -s https://www.eventangle.com/health/origin | jq .

# Test admin auth (should fail without token)
curl -s https://www.eventangle.com/api/v2/admin/events | jq .

# Test with auth (replace TOKEN)
curl -s -H "Authorization: Bearer TOKEN" \
  https://www.eventangle.com/api/v2/admin/events | jq .
```

---

## Document History

| Date       | Author      | Changes                                                 |
| ---------- | ----------- | ------------------------------------------------------- |
| 2025-12-20 | Claude Code | Initial baseline document (SEC-0.1)                     |
| 2025-12-20 | Claude Code | Added SEC-1.1 runbook reference, updated roadmap status |
| 2025-12-20 | Claude Code | Added SEC-1.2 scoped API tokens runbook                 |
| 2025-12-20 | Claude Code | Added SEC-2.1 registrar lock + MFA runbook              |
| 2025-12-20 | Claude Code | Added SEC-2.2 DNSSEC configuration runbook              |
