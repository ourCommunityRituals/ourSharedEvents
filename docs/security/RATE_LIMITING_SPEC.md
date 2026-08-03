# RATE_LIMITING_SPEC.md — Rate Limiting Configuration

> **PROMPTSPEC-SEC-6.2** — Rate Limiting Spec + Probe Script
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Protect high-risk endpoints from abuse and bill shock through layered rate limiting at the Cloudflare edge and Worker levels.

| Attribute         | Value                                                               |
| ----------------- | ------------------------------------------------------------------- |
| **Scope**         | All production and staging endpoints                                |
| **Prerequisites** | Security Baseline (SEC-0.1), WAF Baseline (SEC-6.1)                 |
| **Constraints**   | Worker-only architecture; rate limiting operates at Cloudflare edge |

---

## 2. North Star Compliance

### 2.1 NS-1: Edge-First Security

> **NS-1:** Every public request hits Cloudflare first

Rate limiting operates at the Cloudflare edge, providing abuse prevention before requests consume Worker resources:

| Layer                    | Protection             | Implementation                             |
| ------------------------ | ---------------------- | ------------------------------------------ |
| **Edge (Rate Limiting)** | Prevent abuse/DoS      | Cloudflare Rate Limiting Rules (this spec) |
| **Edge (WAF)**           | Block attack patterns  | Managed rulesets (SEC-6.1)                 |
| **Worker (Guards)**      | Application-level auth | `guardAdminOAuth()`, etc.                  |

### 2.2 Defense-in-Depth Principle

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         REQUEST FLOW                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Internet → Cloudflare Edge → Rate Limiting → WAF → Worker → Response        │
│                                    │                                         │
│                                    ├─ 429: Rate limit exceeded               │
│                                    ├─ ALLOW: Within limits                   │
│                                    └─ LOG: Approaching limits (optional)     │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Rate Limit Definitions

### 3.1 Endpoint Classification

| Classification       | Risk Level | Rate Limit         | Rationale                       |
| -------------------- | ---------- | ------------------ | ------------------------------- |
| **API Read**         | Medium     | 100 req/10s per IP | Public data access              |
| **API Write**        | High       | 20 req/10s per IP  | State mutations, backend writes |
| **Error Reporting**  | High       | 10 req/10s per IP  | Prevents log flooding           |
| **Health Endpoints** | Low        | 300 req/10s per IP | Monitoring systems              |
| **Static Assets**    | Low        | 500 req/10s per IP | HTML/JS/CSS                     |

### 3.2 Endpoint-Specific Limits

#### 3.2.1 API Endpoints (`/api/*`)

| Path Pattern                    | Method(s) | Rate Limit | Period     | Action |
| ------------------------------- | --------- | ---------- | ---------- | ------ |
| `/api/status`                   | GET       | 300/10s    | 10 seconds | Block  |
| `/api/health/backend`           | GET       | 300/10s    | 10 seconds | Block  |
| `/api/events`                   | GET       | 100/10s    | 10 seconds | Block  |
| `/api/v2/events`                | GET       | 100/10s    | 10 seconds | Block  |
| `/api/events/:id/publicBundle`  | GET       | 100/10s    | 10 seconds | Block  |
| `/api/events/:id/displayBundle` | GET       | 100/10s    | 10 seconds | Block  |
| `/api/events/:id/posterBundle`  | GET       | 100/10s    | 10 seconds | Block  |
| `/api/v2/sponsors`              | GET       | 100/10s    | 10 seconds | Block  |
| `/api/v2/sponsor/:id`           | GET       | 100/10s    | 10 seconds | Block  |
| `/api/v2/sharedreport`          | GET       | 50/10s     | 10 seconds | Block  |

#### 3.2.2 Admin Write Endpoints (`/api/*/admin/*`)

| Path Pattern                           | Method(s) | Rate Limit | Period     | Action |
| -------------------------------------- | --------- | ---------- | ---------- | ------ |
| `/api/admin/events`                    | POST      | 20/10s     | 10 seconds | Block  |
| `/api/v2/admin/events`                 | POST      | 20/10s     | 10 seconds | Block  |
| `/api/v2/admin/events/:id`             | PUT       | 20/10s     | 10 seconds | Block  |
| `/api/v2/admin/events/:id/archive`     | POST      | 20/10s     | 10 seconds | Block  |
| `/api/v2/admin/events/:id/unarchive`   | POST      | 20/10s     | 10 seconds | Block  |
| `/api/v2/admin/events/:id/default`     | POST      | 20/10s     | 10 seconds | Block  |
| `/api/v2/admin/events/:id/verify-qr`   | POST      | 20/10s     | 10 seconds | Block  |
| `/api/v2/admin/events/:id/unverify-qr` | POST      | 20/10s     | 10 seconds | Block  |
| `/api/admin/events/:id/results`        | POST      | 20/10s     | 10 seconds | Block  |
| `/api/events/:id/adminBundle`          | GET       | 50/10s     | 10 seconds | Block  |

#### 3.2.3 Error Reporting Endpoints (`/jserror*`)

| Path Pattern   | Method(s) | Rate Limit | Period     | Action |
| -------------- | --------- | ---------- | ---------- | ------ |
| `/jserror`     | POST      | 10/10s     | 10 seconds | Block  |
| `/jserror/*`   | POST      | 10/10s     | 10 seconds | Block  |
| `/api/jserror` | POST      | 10/10s     | 10 seconds | Block  |

#### 3.2.4 Authentication Endpoints

| Path Pattern     | Method(s) | Rate Limit | Period     | Action |
| ---------------- | --------- | ---------- | ---------- | ------ |
| `/auth/login`    | GET       | 30/10s     | 10 seconds | Block  |
| `/auth/callback` | GET       | 30/10s     | 10 seconds | Block  |
| `/auth/logout`   | GET, POST | 30/10s     | 10 seconds | Block  |

---

## 4. Method Constraints (Worker-Side)

### 4.1 Allowed Methods by Endpoint Type

| Endpoint Type   | Allowed Methods                 | Enforcement             |
| --------------- | ------------------------------- | ----------------------- |
| **Public Read** | GET, HEAD, OPTIONS              | `guardPublicReadOnly()` |
| **Admin Write** | GET, POST, PUT, DELETE, OPTIONS | `guardV2AdminRoute()`   |
| **Health**      | GET, HEAD, OPTIONS              | Router check            |
| **Static**      | GET, HEAD, OPTIONS              | Router check            |

### 4.2 Method Violation Response

```json
{
  "ok": false,
  "status": 405,
  "error": "Method Not Allowed",
  "path": "/api/events",
  "timestamp": "2026-01-05T00:00:00.000Z"
}
```

### 4.3 Worker Implementation

The Worker enforces method constraints via guards in `router.ts`:

```typescript
// SEC-IAC-04: Public Read-Only Enforcement
const publicReadOnlyResult = guardPublicReadOnly(request, env, logger.getRequestId());
if (!publicReadOnlyResult.allowed) {
  // Block mutation methods on public routes
  return addCorsHeaders(publicReadOnlyResult.errorResponse!);
}
```

---

## 5. Body Size Constraints (Worker-Side)

### 5.1 Request Body Limits

| Endpoint Type           | Max Body Size | Enforcement             |
| ----------------------- | ------------- | ----------------------- |
| **Admin Create/Update** | 100 KB        | Worker validation       |
| **Error Reporting**     | 10 KB         | Worker validation       |
| **Health Endpoints**    | N/A (no body) | N/A                     |
| **Public Read**         | N/A (no body) | `guardPublicReadOnly()` |

### 5.2 Oversized Request Response

```json
{
  "ok": false,
  "status": 413,
  "code": "PAYLOAD_TOO_LARGE",
  "message": "Request body exceeds maximum allowed size",
  "maxSize": "100KB"
}
```

### 5.3 Worker Implementation Guidance

Add body size validation to write handlers:

```typescript
// Example: In handleV2AdminCreateEvent
const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
const MAX_BODY_SIZE = 100 * 1024; // 100 KB

if (contentLength > MAX_BODY_SIZE) {
  return new Response(
    JSON.stringify({
      ok: false,
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body exceeds maximum allowed size',
      maxSize: '100KB',
    }),
    {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
```

---

## 6. Cloudflare Rate Limiting Rules

### 6.1 Rule Configuration Overview

Create these rate limiting rules in Cloudflare Dashboard (Security > WAF > Rate limiting rules):

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         RATE LIMITING RULES                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Priority 1: API Write Endpoints (20 req/10s)                                │
│  Priority 2: Error Reporting (10 req/10s)                                    │
│  Priority 3: Auth Endpoints (30 req/10s)                                     │
│  Priority 4: API Read Endpoints (100 req/10s)                                │
│  Priority 5: Health Endpoints (300 req/10s)                                  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Rule 1: API Write Protection

| Setting        | Value                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------- |
| **Name**       | API Write Rate Limit                                                                            |
| **Expression** | `(http.request.uri.path contains "/admin/" and http.request.method in {"POST" "PUT" "DELETE"})` |
| **Requests**   | 20                                                                                              |
| **Period**     | 10 seconds                                                                                      |
| **Counting**   | Per IP                                                                                          |
| **Action**     | Block (429)                                                                                     |
| **Duration**   | 10 seconds                                                                                      |

### 6.3 Rule 2: Error Reporting Protection

| Setting        | Value                                        |
| -------------- | -------------------------------------------- |
| **Name**       | Error Reporting Rate Limit                   |
| **Expression** | `(http.request.uri.path contains "jserror")` |
| **Requests**   | 10                                           |
| **Period**     | 10 seconds                                   |
| **Counting**   | Per IP                                       |
| **Action**     | Block (429)                                  |
| **Duration**   | 10 seconds                                   |

### 6.4 Rule 3: Auth Endpoint Protection

| Setting        | Value                                          |
| -------------- | ---------------------------------------------- |
| **Name**       | Auth Rate Limit                                |
| **Expression** | `(http.request.uri.path starts_with "/auth/")` |
| **Requests**   | 30                                             |
| **Period**     | 10 seconds                                     |
| **Counting**   | Per IP                                         |
| **Action**     | Block (429)                                    |
| **Duration**   | 10 seconds                                     |

### 6.5 Rule 4: API Read Protection

| Setting        | Value                                                                          |
| -------------- | ------------------------------------------------------------------------------ |
| **Name**       | API Read Rate Limit                                                            |
| **Expression** | `(http.request.uri.path starts_with "/api/" and http.request.method eq "GET")` |
| **Requests**   | 100                                                                            |
| **Period**     | 10 seconds                                                                     |
| **Counting**   | Per IP                                                                         |
| **Action**     | Block (429)                                                                    |
| **Duration**   | 10 seconds                                                                     |

### 6.6 Rule 5: Health Endpoint Protection

| Setting        | Value                                                                                   |
| -------------- | --------------------------------------------------------------------------------------- |
| **Name**       | Health Endpoint Rate Limit                                                              |
| **Expression** | `(http.request.uri.path contains "/health/" or http.request.uri.path eq "/api/status")` |
| **Requests**   | 300                                                                                     |
| **Period**     | 10 seconds                                                                              |
| **Counting**   | Per IP                                                                                  |
| **Action**     | Block (429)                                                                             |
| **Duration**   | 10 seconds                                                                              |

---

## 7. Implementation Plan

### 7.1 Phased Rollout Strategy

> **CRITICAL:** Never enable blocking without a log-only observation period.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      RATE LIMITING ROLLOUT PHASES                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Phase 1: LOG-ONLY (Minimum 3 days)                                         │
│  ├─ Deploy all rules with Action: Log                                       │
│  ├─ Monitor Security Analytics for rate limit matches                       │
│  ├─ Identify legitimate high-volume clients                                 │
│  └─ Adjust thresholds if needed                                             │
│                                                                             │
│  Phase 2: SELECTIVE BLOCKING (Minimum 3 days)                               │
│  ├─ Enable Block for error reporting rule (lowest impact)                   │
│  ├─ Enable Block for write endpoints                                        │
│  ├─ Keep Log for read endpoints                                             │
│  └─ Monitor for false positives                                             │
│                                                                             │
│  Phase 3: FULL BLOCKING (Production)                                        │
│  ├─ Enable Block for all rules                                              │
│  ├─ Maintain exception list for known high-volume clients                   │
│  └─ Ongoing monitoring and threshold tuning                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Phase 1: Log-Only Mode

| Setting        | Value              | Rationale                |
| -------------- | ------------------ | ------------------------ |
| **All Rules**  | Action: Log        | Observe traffic patterns |
| **Duration**   | Minimum 3 days     | Capture diverse usage    |
| **Monitoring** | Security Analytics | Track matches            |

### 7.3 Phase 2: Selective Blocking

| Rule            | Action | Rationale                               |
| --------------- | ------ | --------------------------------------- |
| Error Reporting | Block  | Lowest false-positive risk              |
| API Write       | Block  | High-risk mutations                     |
| Auth Endpoints  | Block  | Credential stuffing prevention          |
| API Read        | Log    | May have high-volume legitimate clients |
| Health          | Log    | Monitoring systems                      |

### 7.4 Phase 3: Full Blocking

| Rule      | Action | Notes                      |
| --------- | ------ | -------------------------- |
| All Rules | Block  | With documented exceptions |

---

## 8. Exception Management

### 8.1 Exception Criteria

| Criterion            | Requirement                                  |
| -------------------- | -------------------------------------------- |
| **Known Clients**    | Document IP ranges of monitoring systems     |
| **API Integrations** | Document authorized high-volume integrations |
| **Timeboxed**        | All exceptions expire and require renewal    |
| **Narrow Scope**     | Exception by IP + path, not blanket          |

### 8.2 Exception Implementation

Create IP Access Rules or skip rate limiting for specific IPs:

```
Rule: Skip Rate Limiting for Monitoring
Expression: (ip.src in {203.0.113.0/24} and http.request.uri.path eq "/api/status")
Action: Skip all rate limiting rules
```

### 8.3 Exception Registry

| ID        | IP/Range        | Endpoint    | Reason         | Expires | Status  |
| --------- | --------------- | ----------- | -------------- | ------- | ------- |
| RL-EX-001 | (monitoring IP) | /api/status | Uptime monitor | (date)  | Pending |

---

## 9. 429 Response Format

### 9.1 Cloudflare Default Response

When rate limit is exceeded, Cloudflare returns:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 10
Content-Type: text/html

<!DOCTYPE html>
<html>
<head><title>429 Too Many Requests</title></head>
<body>
<center><h1>429 Too Many Requests</h1></center>
</body>
</html>
```

### 9.2 Custom Response (Optional)

Configure a custom response page in Cloudflare:

```json
{
  "ok": false,
  "status": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Please retry after the specified period.",
  "retryAfter": 10
}
```

---

## 10. Monitoring and Alerting

### 10.1 Security Analytics Dashboard

| Metric             | Location             | Threshold            |
| ------------------ | -------------------- | -------------------- |
| Rate limit matches | Security > Analytics | Baseline + 2 std dev |
| 429 responses      | Security > Analytics | > 100/hour           |
| Unique IPs blocked | Security > Analytics | > 10/hour            |

### 10.2 Alert Configuration

| Alert                         | Threshold                 | Priority | Action                                 |
| ----------------------------- | ------------------------- | -------- | -------------------------------------- |
| **Rate limit spike**          | >5x normal 429s/hour      | High     | Investigate attack or adjust threshold |
| **Single IP flood**           | >1000 requests/hour       | High     | Consider IP block                      |
| **Legitimate client blocked** | Known-good IP returns 429 | Medium   | Add exception                          |

---

## 11. Verification

### 11.1 Probe Script

Use `scripts/security/rate_limit_probe.sh` to verify rate limiting:

```bash
# Test rate limit for API read endpoints
./scripts/security/rate_limit_probe.sh https://www.oursharedevents.com /api/v2/events 100

# Expected: 429 response within 100+ requests
```

### 11.2 Manual Verification

```bash
# Verify 429 appears after threshold exceeded
for i in {1..150}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://www.oursharedevents.com/api/v2/events")
  echo "Request $i: $STATUS"
  if [ "$STATUS" = "429" ]; then
    echo "Rate limit triggered at request $i"
    break
  fi
done
```

### 11.3 Expected Behavior

| Scenario                           | Expected Result         |
| ---------------------------------- | ----------------------- |
| 100 rapid GET /api/v2/events       | 429 after ~100 requests |
| 20 rapid POST /api/v2/admin/events | 429 after ~20 requests  |
| 10 rapid POST /jserror             | 429 after ~10 requests  |
| Normal browsing pace               | Never see 429           |

---

## 12. UI Execution Checklist

### 12.1 Initial Deployment

```
DOMAIN: _______________________  DATE: ___________

RATE LIMITING RULES DEPLOYMENT

[ ] 1. Navigate to Security > WAF > Rate limiting rules
[ ] 2. Create Rule: API Write Rate Limit
      [ ] Expression: (http.request.uri.path contains "/admin/" and http.request.method in {"POST" "PUT" "DELETE"})
      [ ] Requests: 20, Period: 10 seconds
      [ ] Action: Log (Phase 1)
[ ] 3. Create Rule: Error Reporting Rate Limit
      [ ] Expression: (http.request.uri.path contains "jserror")
      [ ] Requests: 10, Period: 10 seconds
      [ ] Action: Log (Phase 1)
[ ] 4. Create Rule: Auth Rate Limit
      [ ] Expression: (http.request.uri.path starts_with "/auth/")
      [ ] Requests: 30, Period: 10 seconds
      [ ] Action: Log (Phase 1)
[ ] 5. Create Rule: API Read Rate Limit
      [ ] Expression: (http.request.uri.path starts_with "/api/" and http.request.method eq "GET")
      [ ] Requests: 100, Period: 10 seconds
      [ ] Action: Log (Phase 1)
[ ] 6. Create Rule: Health Endpoint Rate Limit
      [ ] Expression: (http.request.uri.path contains "/health/" or http.request.uri.path eq "/api/status")
      [ ] Requests: 300, Period: 10 seconds
      [ ] Action: Log (Phase 1)
[ ] 7. Verify rules in Security Analytics
[ ] 8. Set calendar reminder for Phase 2 (+3 days)

Deployed by: _______________  Date: _______________
```

---

## 13. Acceptance Criteria

### 13.1 Primary Acceptance Criteria

| ID       | Criterion                                             | Verification                 | Status |
| -------- | ----------------------------------------------------- | ---------------------------- | ------ |
| **AC-1** | Rate limiting rules deployed for all endpoint classes | Dashboard shows rules        |        |
| **AC-2** | Probe script deterministically triggers 429           | `rate_limit_probe.sh` passes |        |
| **AC-3** | Normal requests are NOT rate limited                  | Manual verification          |        |
| **AC-4** | /api/\* endpoints have rate limits                    | Rule exists                  |        |
| **AC-5** | /jserror\* endpoints have rate limits                 | Rule exists                  |        |
| **AC-6** | Write endpoints have stricter limits than read        | 20/10s vs 100/10s            |        |

### 13.2 Probe Script Acceptance Criteria

| ID       | Criterion                          | Verification                   |
| -------- | ---------------------------------- | ------------------------------ |
| **PR-1** | Accepts base URL as argument       | Script parameter               |
| **PR-2** | Hits endpoints repeatedly          | Request loop                   |
| **PR-3** | Asserts 429 within expected bounds | Exit code 0 if 429 received    |
| **PR-4** | Does not crash normal operations   | Respects rate limit thresholds |

---

## 14. Related Documents

| Document             | Path                                           | Relationship               |
| -------------------- | ---------------------------------------------- | -------------------------- |
| Security Baseline    | `docs/security/SECURITY_BASELINE.md`           | Parent security model      |
| WAF Baseline         | `docs/security/WAF_BASELINE.md`                | Sibling edge protection    |
| Route Classification | `docs/security/ROUTE_CLASSIFICATION_POLICY.md` | Endpoint definitions       |
| Service Auth Pattern | `docs/security/SERVICE_AUTH_PATTERN.md`        | Auth bypass considerations |

---

## 15. Rollout Status

| Phase                     | Environment | Status  | Date | Notes |
| ------------------------- | ----------- | ------- | ---- | ----- |
| Phase 1 (Log-only)        | Staging     | PENDING |      |       |
| Phase 1 (Log-only)        | Production  | PENDING |      |       |
| Phase 2 (Selective Block) | Staging     | PENDING |      |       |
| Phase 2 (Selective Block) | Production  | PENDING |      |       |
| Phase 3 (Full Block)      | Staging     | PENDING |      |       |
| Phase 3 (Full Block)      | Production  | PENDING |      |       |

---

## Document History

| Date       | Author      | Changes                                                |
| ---------- | ----------- | ------------------------------------------------------ |
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-6.2 rate limiting specification |
