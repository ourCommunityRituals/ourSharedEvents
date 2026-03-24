# CLOUDFLARE_ACCESS_PRIVILEGED.md — Cloudflare Access Gating for Privileged Paths

> **PROMPTSPEC-SEC-5.2** — Cloudflare Access Gating Spec
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Ensure privileged paths cannot be reached without identity + MFA verification at the Cloudflare edge, implementing defense-in-depth per North Star invariant NS-2.

| Attribute | Value |
|-----------|-------|
| **Scope** | All privileged HTML surfaces and admin API endpoints |
| **Prerequisites** | Security Baseline (SEC-0.1), Route Classification (SEC-5.1), OAuth Implementation (SEC-IAC-03) |
| **Enforcement** | Cloudflare Access Applications + Policies |

---

## 2. North Star Compliance

### 2.1 NS-2: Privileged Surface Identity Requirement

> **NS-2:** Privileged surfaces require identity (Cloudflare Access) or cryptographic proof

This specification implements the **Cloudflare Access** layer of NS-2 enforcement, providing:

| Layer | Purpose | Implementation |
|-------|---------|----------------|
| **Edge (Cloudflare Access)** | Identity gate before request reaches Worker | Access Application + Policy (this spec) |
| **Worker (OAuth)** | Session verification after Access allows | `guardAdminOAuth()` (SEC-IAC-03) |
| **Worker (Bearer)** | API authentication | `guardV2AdminRoute()`, `guardAdminRoute()` |

**Defense-in-Depth:** Even if Worker OAuth is bypassed, Cloudflare Access blocks unauthenticated requests at the edge.

---

## 3. Protected Paths

### 3.1 Privileged HTML Surfaces

Routes serving admin/management UI that require identity verification.

| Path | Aliases | Purpose | Current Guard | Access Required |
|------|---------|---------|---------------|-----------------|
| `/admin` | `/manage`, `/dashboard`, `/create` | Event management UI | `guardAdminOAuth()` | **YES** |
| `/report` | `/analytics`, `/reports`, `/insights` | Analytics dashboard | `guardAdminOAuth()` | **YES** |

### 3.2 Privileged API Endpoints

API routes requiring authentication that should also be protected at the edge.

| Path Pattern | Method(s) | Purpose | Current Guard | Access Required |
|--------------|-----------|---------|---------------|-----------------|
| `/api/admin/*` | POST | Legacy admin actions | `guardAdminRoute()` | **YES** |
| `/api/v2/admin/*` | POST, PUT | V2 admin CRUD | `guardV2AdminRoute()` | **YES** |
| `/api/events/:id/adminBundle` | GET | Admin event data | `guardAdminRoute()` | **YES** |

### 3.3 Path Patterns for Access Application

```
Protected path patterns (use in Cloudflare Access Application):

HTML Surfaces:
  /admin
  /admin/*
  /manage
  /manage/*
  /dashboard
  /dashboard/*
  /create
  /create/*
  /report
  /report/*
  /analytics
  /analytics/*
  /reports
  /reports/*
  /insights
  /insights/*

API Endpoints:
  /api/admin/*
  /api/v2/admin/*
  /api/events/*/adminBundle

Brand-prefixed (if using brand routing):
  /abc/admin
  /abc/admin/*
  /cbc/admin
  /cbc/admin/*
  ... (repeat for all brands)
```

### 3.4 Explicitly Excluded Paths

These paths must remain publicly accessible (no Access gating):

| Path | Reason |
|------|--------|
| `/auth/login` | OAuth initiation flow |
| `/auth/callback` | OAuth callback handler |
| `/auth/logout` | Session termination |
| `/api/status` | Health checks |
| `/api/health/*` | Operational monitoring |
| `/health/*` | Operational monitoring |

---

## 4. Access Application Configuration

### 4.1 Application Definition

Create a Cloudflare Access Application to protect privileged paths.

| Setting | Value | Notes |
|---------|-------|-------|
| **Application Name** | `EventAngle Admin` | Descriptive name |
| **Application Domain** | `www.eventangle.com` | Production canonical host |
| **Application Type** | Self-hosted | Worker-served application |
| **Session Duration** | 8 hours | Balance security/usability |
| **Enable CORS** | No | Worker handles CORS |

### 4.2 Path Configuration

```yaml
# Access Application Path Rules
application:
  name: "EventAngle Admin"
  domain: "www.eventangle.com"

  # Include these paths (protected)
  include_paths:
    - "/admin"
    - "/admin/*"
    - "/manage"
    - "/manage/*"
    - "/dashboard"
    - "/dashboard/*"
    - "/create"
    - "/create/*"
    - "/report"
    - "/report/*"
    - "/analytics"
    - "/analytics/*"
    - "/reports"
    - "/reports/*"
    - "/insights"
    - "/insights/*"
    - "/api/admin/*"
    - "/api/v2/admin/*"

  # Exclude these paths (must remain public)
  exclude_paths:
    - "/auth/*"
    - "/api/status"
    - "/api/health/*"
    - "/health/*"
```

### 4.3 Staging Configuration

Duplicate configuration for staging environment:

| Setting | Production | Staging |
|---------|------------|---------|
| **Domain** | `www.eventangle.com` | `stg.eventangle.com` |
| **Application Name** | `EventAngle Admin` | `EventAngle Admin (Staging)` |
| **Session Duration** | 8 hours | 8 hours |

---

## 5. Access Policy Configuration

### 5.1 Policy Definition

Create an Access Policy that defines who can access privileged paths.

| Setting | Value | Notes |
|---------|-------|-------|
| **Policy Name** | `Admin Team Access` | Descriptive name |
| **Action** | Allow | Permit matching users |
| **Session Duration** | 8 hours | Inherit from application |

### 5.2 Allow Rules

Configure identity requirements for access.

#### Email Allowlist (Recommended for Small Teams)

```yaml
policy:
  name: "Admin Team Access"
  action: "allow"

  include:
    - email:
        - "admin@eventangle.com"
        - "ops@eventangle.com"
        # Add authorized admin emails here
```

#### Domain Allowlist (Recommended for Organizations)

```yaml
policy:
  name: "Admin Team Access"
  action: "allow"

  include:
    - email_domain:
        - "eventangle.com"
        # All @eventangle.com emails can access
```

#### Combined Rules (Most Flexible)

```yaml
policy:
  name: "Admin Team Access"
  action: "allow"

  include:
    # Organization domain
    - email_domain:
        - "eventangle.com"

    # External collaborators
    - email:
        - "contractor@external-agency.com"
```

### 5.3 MFA Requirement

> **CRITICAL:** MFA must be enforced for all privileged access.

| Setting | Value | Notes |
|---------|-------|-------|
| **Require MFA** | **YES** | Non-negotiable for admin access |
| **MFA Method** | Any configured | TOTP, WebAuthn, or IdP MFA |

#### Cloudflare Access MFA Configuration

```yaml
policy:
  name: "Admin Team Access"
  action: "allow"

  include:
    - email_domain:
        - "eventangle.com"

  require:
    - mfa: true  # <-- Enforces MFA for all policy matches
```

**Note:** MFA enforcement requires identity provider configuration:
- **Google Workspace**: Enable 2-Step Verification
- **Okta/Azure AD**: Configure MFA policies
- **Cloudflare One-Time PIN**: Built-in email OTP (less secure)

### 5.4 Session Duration Guidance

| Use Case | Recommended Duration | Rationale |
|----------|---------------------|-----------|
| **Production Admin** | 8 hours | Full workday, re-auth daily |
| **Staging Admin** | 24 hours | Development convenience |
| **High-Security Operations** | 1 hour | Financial/destructive actions |

---

## 6. Identity Provider Configuration

### 6.1 Supported Identity Providers

| Provider | MFA Support | Recommended |
|----------|-------------|-------------|
| **Google Workspace** | Yes (2-Step Verification) | **YES** |
| **Azure AD** | Yes (Conditional Access) | YES |
| **Okta** | Yes (Adaptive MFA) | YES |
| **GitHub** | Yes (2FA) | YES (for dev teams) |
| **One-Time PIN** | Email OTP only | NO (fallback only) |

### 6.2 Google Workspace Configuration

Since EventAngle uses Google OAuth (SEC-IAC-03), Google Workspace is the natural IdP:

```
Cloudflare Access IdP Settings:
  - Provider: Google
  - Client ID: [from Google Cloud Console]
  - Client Secret: [from Google Cloud Console]
  - Allowed Groups: (optional) security@eventangle.com
```

### 6.3 IdP MFA Enforcement

MFA should be enforced at the IdP level for maximum security:

| Provider | MFA Setting |
|----------|-------------|
| **Google Workspace** | Admin Console → Security → 2-Step Verification → Enforcement |
| **Azure AD** | Conditional Access → Require MFA for all users |
| **Okta** | Security → Multifactor → Enable for all |

---

## 7. Implementation Plan

### 7.1 Phase 1: Staging Deployment

| Step | Action | Verification |
|------|--------|--------------|
| 1 | Create Access Application for `stg.eventangle.com` | Application visible in dashboard |
| 2 | Configure path rules (Section 4.2) | Paths listed correctly |
| 3 | Create Allow policy with email/domain rules | Policy attached to application |
| 4 | Enable MFA requirement | Policy shows MFA required |
| 5 | Test with authorized user | Access granted after MFA |
| 6 | Test with unauthorized user | Access denied (403) |

### 7.2 Phase 2: Production Deployment

| Step | Action | Verification |
|------|--------|--------------|
| 1 | Create Access Application for `www.eventangle.com` | Application visible in dashboard |
| 2 | Mirror staging path configuration | Paths match staging |
| 3 | Create Allow policy (may differ from staging) | Policy attached |
| 4 | Enable MFA requirement | MFA enforced |
| 5 | Announce rollout to admin team | Team notified |
| 6 | Monitor Access logs for issues | No unauthorized denials |

### 7.3 Rollback Plan

If Access gating causes issues:

```bash
# Quick rollback: Disable Access Application
# Cloudflare Dashboard → Access → Applications → EventAngle Admin → Disable

# Emergency: Delete Access Application
# WARNING: This removes all access logs
```

---

## 8. Verification Steps

### 8.1 Incognito Browser Verification

Test that unauthenticated users cannot reach privileged paths.

```
VERIFICATION: Incognito Browser Test

1. Open incognito/private browser window
2. Navigate to: https://www.eventangle.com/admin
3. Expected: Cloudflare Access login page (NOT application page)
4. Verify: Page shows "Sign in with [IdP]" prompt
5. Do NOT sign in
6. Confirm: Cannot view admin page content

Repeat for:
  - /manage
  - /dashboard
  - /create
  - /report
  - /analytics
  - /reports
  - /insights
```

### 8.2 curl Header Behavior Verification

Test API endpoint protection using curl.

```bash
# Test: Unauthenticated request to admin API
curl -s -o /dev/null -w "%{http_code}" \
  https://www.eventangle.com/api/v2/admin/events
# Expected: 403 (Forbidden by Access) or 302 (Redirect to Access login)

# Test: Request without Access JWT
curl -s -I https://www.eventangle.com/admin
# Expected: 302 redirect to Cloudflare Access login
# Look for: Location: https://[team-name].cloudflareaccess.com/...

# Test: Request with invalid Access JWT
curl -s -o /dev/null -w "%{http_code}" \
  -H "Cf-Access-Jwt-Assertion: invalid-token" \
  https://www.eventangle.com/admin
# Expected: 403 (Invalid token)

# Test: Public endpoint (should NOT be gated)
curl -s -o /dev/null -w "%{http_code}" \
  https://www.eventangle.com/api/status
# Expected: 200 (Access does NOT gate this path)
```

### 8.3 Response Header Verification

```bash
# Verify Access headers on protected path
curl -s -I https://www.eventangle.com/admin 2>&1 | grep -i "cf-"

# Expected headers when Access is active:
#   cf-ray: [ray-id]
#   cf-cache-status: DYNAMIC
#   (Redirect to Access login if unauthenticated)

# After authentication, verify JWT header is present:
# Cf-Access-Jwt-Assertion header will be set by Access
```

### 8.4 Authenticated Access Verification

```
VERIFICATION: Authenticated Access Test

1. Navigate to: https://www.eventangle.com/admin (not incognito)
2. Cloudflare Access login page appears
3. Click "Sign in with Google" (or configured IdP)
4. Complete MFA challenge (if prompted)
5. Verify: Redirected to /admin page
6. Verify: Admin UI loads correctly
7. Check browser DevTools:
   - Network tab shows 200 response
   - Response headers include Cf-Access-* headers
```

---

## 9. Access Logs & Monitoring

### 9.1 Access Log Location

```
Cloudflare Dashboard → Access → Logs

Log fields:
  - User email
  - Application accessed
  - Action (Allow/Block)
  - Timestamp
  - Client IP
  - User agent
```

### 9.2 Alerting Configuration

Configure alerts for security events:

| Event | Alert Priority | Action |
|-------|----------------|--------|
| Failed login attempts (>5/hour) | High | Investigate potential attack |
| Access from new country | Medium | Verify with user |
| Policy denial | Low | Review if expected |
| MFA bypass attempt | Critical | Immediate investigation |

### 9.3 Log Retention

| Environment | Retention | Notes |
|-------------|-----------|-------|
| Production | 30 days (Access default) | Extend if compliance requires |
| Staging | 7 days | Shorter for development |

---

## 10. Acceptance Criteria

### 10.1 Primary Acceptance Criteria

| # | Criterion | Verification Method | Status |
|---|-----------|---------------------|--------|
| **AC-1** | `/admin` requires Access; unauthenticated users cannot reach app handler | Incognito browser test (8.1) | |
| **AC-2** | All privileged paths (Section 3) protected by Access | Path configuration audit | |
| **AC-3** | MFA is required for all Access authentication | Policy configuration check | |
| **AC-4** | Public paths (`/api/status`, `/auth/*`) remain accessible | curl test returns 200 | |
| **AC-5** | Access logs capture all authentication attempts | Log review in dashboard | |

### 10.2 Security Acceptance Criteria

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| **SEC-1** | Direct IP access (if any) also protected | N/A (Worker-only, no origin IP) |
| **SEC-2** | Access tokens cannot be forged | JWT signature validation (Cloudflare-managed) |
| **SEC-3** | Session timeout enforces re-authentication | Wait 8+ hours, verify re-auth required |
| **SEC-4** | Unauthorized emails receive 403 | Test with non-allowlisted email |

### 10.3 Operational Acceptance Criteria

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| **OPS-1** | Legitimate admins can access after authentication | Manual test by team member |
| **OPS-2** | Access does not break existing OAuth flow | Full login flow test |
| **OPS-3** | Access logs are queryable | Dashboard log search |
| **OPS-4** | Rollback procedure documented and tested | Execute rollback in staging |

---

## 11. Troubleshooting

### 11.1 Common Issues

| Issue | Cause | Resolution |
|-------|-------|------------|
| "Access Denied" for authorized user | Email not in allowlist | Add email to policy |
| MFA not prompted | IdP MFA not enforced | Enable MFA at IdP level |
| Infinite redirect loop | Path exclusion missing | Add `/auth/*` to exclude list |
| API returns HTML (Access page) | Access gating API incorrectly | Check path patterns |
| Worker OAuth still required | Defense-in-depth working | Expected behavior (dual auth) |

### 11.2 Debug Commands

```bash
# Check if Access is active on a path
curl -s -I https://www.eventangle.com/admin | head -20

# Verify Access application exists
# (Requires Cloudflare API token with Access:Read)
curl -s "https://api.cloudflare.com/client/v4/accounts/{account_id}/access/apps" \
  -H "Authorization: Bearer {api_token}" | jq '.result[] | {name, domain}'

# Test specific path protection
curl -s -o /dev/null -w "Status: %{http_code}\nRedirect: %{redirect_url}\n" \
  https://www.eventangle.com/admin
```

---

## 12. Related Documents

| Document | Path | Relationship |
|----------|------|--------------|
| Security Baseline | `docs/security/SECURITY_BASELINE.md` | Parent policy (NS-2) |
| Route Classification | `docs/security/ROUTE_CLASSIFICATION_POLICY.md` | Protected path definitions (SEC-5.1) |
| OAuth Implementation | — | Worker-level auth (SEC-IAC-03) |
| CF Account Hardening | `docs/security/CF_ACCOUNT_HARDENING_RUNBOOK.md` | Account security |

---

## 13. Summary

| Aspect | Value |
|--------|-------|
| **Protected Paths** | `/admin/*`, `/manage/*`, `/create/*`, `/dashboard/*`, `/report/*`, `/analytics/*`, `/reports/*`, `/insights/*`, `/api/admin/*`, `/api/v2/admin/*` |
| **Identity Provider** | Google Workspace (recommended) |
| **MFA Requirement** | **Mandatory** |
| **Session Duration** | 8 hours (production) |
| **Defense Layers** | Cloudflare Access (edge) + Worker OAuth (application) |
| **Primary AC** | `/admin` requires Access; unauthenticated users cannot reach app handler |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-5.2 Cloudflare Access gating specification |
