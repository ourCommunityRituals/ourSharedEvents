# LOGGING_STANDARD.md — Structured Logging & Correlation IDs

> **PROMPTSPEC-SEC-9.2** — Logging Standard + Correlation IDs
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Define a structured logging standard that enables effective diagnosis of issues without exposing sensitive information. This standard ensures consistent, correlatable logs across edge (Cloudflare Worker) and application layers.

| Attribute | Value |
|-----------|-------|
| **Scope** | All Cloudflare Worker logs, audit logs, and application logs |
| **Prerequisites** | Security Runbook (SEC-9.1) |
| **Implementation** | `worker/src/logger.ts`, `worker/src/audit/auditLogger.ts` |

---

## 2. Required Log Fields

### 2.1 Core Fields (MUST be present in every log entry)

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `timestamp` | ISO 8601 string | When the log event occurred | `"2026-01-05T14:30:00.123Z"` |
| `reqId` | string | Unique request identifier for correlation | `"lxyz123-abc456789"` |
| `route` | string | Request path or route name | `"/api/v2/events"` |
| `decision` | string | Access decision made | `"allow"`, `"deny"`, `"error"` |
| `status` | number | HTTP response status code | `200`, `401`, `500` |
| `latency` | number | Request duration in milliseconds | `45` |

### 2.2 Contextual Fields (Include when available)

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `level` | string | Log severity | `"info"`, `"warn"`, `"error"` |
| `method` | string | HTTP method | `"GET"`, `"POST"` |
| `handler` | string | Handler function name | `"eventsV2"`, `"adminBundle"` |
| `brand` | string | Brand context | `"root"`, `"abc"` |
| `env` | string | Environment | `"production"`, `"staging"` |
| `ip` | string | Client IP (for security events) | `"198.51.100.1"` |
| `outcome` | string | Operation outcome (for audit) | `"ok"`, `"deny"`, `"error"` |

### 2.3 JSON Log Shape

All production logs MUST use this JSON structure:

```json
{
  "timestamp": "2026-01-05T14:30:00.123Z",
  "level": "info",
  "reqId": "lxyz123-abc456789",
  "route": "/api/v2/events",
  "method": "GET",
  "decision": "allow",
  "status": 200,
  "latency": 45,
  "handler": "eventsV2",
  "brand": "root",
  "env": "production"
}
```

---

## 3. Redaction Rules

### 3.1 NEVER Log These Values

The following data MUST NEVER appear in logs:

| Category | Examples | Reason |
|----------|----------|--------|
| **Authentication Headers** | `Authorization`, `Cookie`, `X-Admin-Token` | Credential exposure |
| **Tokens & Secrets** | JWT tokens, API keys, session tokens | Credential exposure |
| **Raw Request Bodies** | POST/PUT body content | May contain PII or secrets |
| **Passwords** | Any password field | Credential exposure |
| **OAuth Tokens** | Access tokens, refresh tokens, ID tokens | Credential exposure |
| **Private Keys** | `GOOGLE_PRIVATE_KEY`, any PEM data | Key compromise |
| **Session Data** | Session cookie values, CSRF tokens | Session hijacking |

### 3.2 Redaction Implementation

```typescript
// FORBIDDEN: Logging auth headers
console.log({ headers: request.headers }); // NEVER DO THIS

// FORBIDDEN: Logging tokens
console.log({ token: env.ADMIN_TOKEN }); // NEVER DO THIS

// FORBIDDEN: Logging request bodies
console.log({ body: await request.json() }); // NEVER DO THIS

// ALLOWED: Logging sanitized metadata
console.log({
  reqId: logger.getRequestId(),
  route: url.pathname,
  method: request.method,
  status: response.status,
  latency: Date.now() - startTime
});
```

### 3.3 Safe Logging Patterns

| What to Log | Safe Pattern | Unsafe Pattern |
|-------------|--------------|----------------|
| Auth result | `{ decision: "deny", reason: "token_expired" }` | `{ token: "eyJ...", valid: false }` |
| Request info | `{ route: "/api/events", method: "GET" }` | `{ headers: {...}, body: {...} }` |
| User identity | `{ actorEmail: "user@example.com" }` | `{ sessionToken: "abc123" }` |
| Error details | `{ error: "NOT_FOUND", eventId: "123" }` | `{ query: "SELECT * FROM..." }` |

---

## 4. Correlation ID Strategy

### 4.1 Request ID Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         REQUEST ID CORRELATION FLOW                           │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Client Request                                                              │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────┐                                                         │
│  │ Cloudflare Edge │                                                         │
│  │                 │                                                         │
│  │  CF-Ray: abc123 │ ◄── Cloudflare assigns unique Ray ID                   │
│  └────────┬────────┘                                                         │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────┐                                                         │
│  │ Worker Router   │                                                         │
│  │                 │                                                         │
│  │  reqId = cf-ray │ ◄── Worker uses CF-Ray as reqId                        │
│  │  OR generated   │     OR generates unique ID if missing                   │
│  └────────┬────────┘                                                         │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────┐     ┌─────────────────┐                                │
│  │ Handler         │────►│ Audit Logger    │                                │
│  │                 │     │                 │                                │
│  │  reqId passed   │     │  reqId in event │ ◄── Same reqId in audit logs  │
│  └────────┬────────┘     └─────────────────┘                                │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────┐                                                         │
│  │ Response        │                                                         │
│  │                 │                                                         │
│  │ X-Request-Id:   │ ◄── reqId returned in response header                  │
│  │   abc123        │                                                         │
│  └─────────────────┘                                                         │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Request ID Generation

```typescript
// Priority order for request ID:
// 1. CF-Ray header from Cloudflare (preferred - enables edge log correlation)
// 2. Generated unique ID (fallback)

function getRequestId(request: Request): string {
  const cfRay = request.headers.get('cf-ray');
  if (cfRay) {
    return cfRay;
  }
  // Fallback: timestamp + random suffix
  return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
}
```

### 4.3 Correlation Between Edge and App Logs

| Log Source | Correlation Field | How to Join |
|------------|-------------------|-------------|
| **Cloudflare Edge Logs** | `RayID` | Primary key |
| **Worker Logs** | `reqId` | = Edge `RayID` when available |
| **Audit Logs** | `requestId` | = Worker `reqId` |
| **Error Reports** | `X-Request-Id` header | = Worker `reqId` |

**Example Correlation Query:**

```sql
-- Find all logs for a specific request
SELECT * FROM edge_logs WHERE RayID = 'abc123'
UNION ALL
SELECT * FROM worker_logs WHERE reqId = 'abc123'
UNION ALL
SELECT * FROM audit_logs WHERE requestId = 'abc123';
```

---

## 5. Log Categories

### 5.1 Router Logs

Logged by `RouterLogger` in `worker/src/logger.ts`:

| Prefix | Purpose | Level | Example |
|--------|---------|-------|---------|
| `[ROUTE]` | Route resolution | info | Route resolved: /api/events -> events |
| `[API]` | API request completion | info | GET /api/status -> 200 |
| `[404]` | Not found | warn | Route not found: GET /unknown |
| `[ERROR]` | Errors | error | Internal server error |
| `[ROUTER]` | Router lifecycle | debug | Router initialized v1.24.0 |

### 5.2 Audit Logs

Logged by `AuditLogger` in `worker/src/audit/auditLogger.ts`:

| Action | Outcome | When Logged |
|--------|---------|-------------|
| Admin mutations | `ok` | After successful admin operations |
| Access denials | `deny` | When auth guard blocks request |
| Operation errors | `error` | When operation fails |

### 5.3 Security Event Logs

| Event Type | Fields | Purpose |
|------------|--------|---------|
| Auth failure | `reqId`, `route`, `ip`, `reason` | Track failed auth attempts |
| Guard denial | `reqId`, `route`, `guard`, `reason` | Track blocked requests |
| Rate limit | `reqId`, `route`, `ip`, `limit` | Track rate limiting |

---

## 6. Decision Logging

### 6.1 Decision Values

Every request MUST log a `decision` field:

| Decision | Meaning | When Used |
|----------|---------|-----------|
| `allow` | Request processed successfully | Normal successful requests |
| `deny` | Request blocked by guard/auth | Auth failures, guard blocks |
| `error` | Request failed due to error | 5xx errors, exceptions |
| `skip` | Request bypassed (e.g., OPTIONS) | CORS preflight, health checks |

### 6.2 Decision Logging Examples

```typescript
// Auth guard denial
logger.log({
  timestamp: new Date().toISOString(),
  level: 'warn',
  reqId: requestId,
  route: '/api/v2/admin/events',
  method: 'POST',
  decision: 'deny',
  status: 401,
  latency: 5,
  reason: 'ADMIN_KEY_INVALID'
});

// Successful request
logger.log({
  timestamp: new Date().toISOString(),
  level: 'info',
  reqId: requestId,
  route: '/api/v2/events',
  method: 'GET',
  decision: 'allow',
  status: 200,
  latency: 45
});

// Error
logger.log({
  timestamp: new Date().toISOString(),
  level: 'error',
  reqId: requestId,
  route: '/api/v2/events',
  method: 'GET',
  decision: 'error',
  status: 500,
  latency: 120,
  error: 'SHEETS_UNAVAILABLE'
});
```

---

## 7. Implementation Reference

### 7.1 Existing Logger (worker/src/logger.ts)

```typescript
// Current implementation meets this standard
// Key methods:
logger.apiRequest(method, path, status, durationMs, extras);
logger.routeResolved(path, handler, status, durationMs, extras);
logger.error(message, error, extras);
logger.warn(message, extras);
```

### 7.2 Request ID Middleware Pattern

```typescript
// See worker/src/middleware/requestId.ts
import { createRequestIdMiddleware } from './middleware/requestId';

// Applied in router.ts handleRequest():
const requestId = getOrGenerateRequestId(request);
logger.setRequestId(requestId);
```

### 7.3 Adding Request ID to Response

```typescript
// All responses include X-Request-Id header
function addStandardHeaders(response: Response, logger: RouterLogger): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Router-Version', ROUTER_VERSION);
  headers.set('X-Request-Id', logger.getRequestId());
  return new Response(response.body, { ...response, headers });
}
```

---

## 8. Compliance Checklist

### 8.1 Per-Request Logging Checklist

For every request, verify:

```
[ ] reqId present and unique
[ ] route logged (path, not query params with sensitive data)
[ ] method logged
[ ] decision logged (allow/deny/error/skip)
[ ] status code logged
[ ] latency logged (in milliseconds)
[ ] NO auth headers logged
[ ] NO tokens logged
[ ] NO request bodies logged
```

### 8.2 Code Review Checklist

When reviewing logging code:

```
[ ] No console.log of request.headers
[ ] No logging of env.* secrets
[ ] No logging of request bodies
[ ] No logging of tokens or cookies
[ ] Request ID used consistently
[ ] JSON format in production
[ ] Appropriate log levels used
[ ] Sensitive error details redacted
```

---

## 9. Log Retention & Access

### 9.1 Retention Periods

| Log Type | Retention | Location |
|----------|-----------|----------|
| Edge logs (Cloudflare) | 72 hours (free) / 7 days (paid) | Cloudflare Logpush |
| Worker console logs | Session only | Cloudflare dashboard |
| Audit logs | Permanent | Google Sheets (AUDIT_LOGS) |

### 9.2 Access Controls

| Log Type | Who Can Access | How |
|----------|----------------|-----|
| Edge logs | Security team, DevOps | Cloudflare dashboard, SIEM |
| Worker logs | Engineering, Security | Cloudflare Workers dashboard |
| Audit logs | Security team | Read-only Sheets access |

---

## 10. Error Handling in Logs

### 10.1 Safe Error Logging

```typescript
// SAFE: Log error type and message, not stack with sensitive data
logger.error('Request failed', {
  reqId: requestId,
  route: '/api/events',
  decision: 'error',
  status: 500,
  error: error.name,        // e.g., "TypeError"
  message: error.message    // sanitized message
  // NO: stack trace in production (may contain sensitive paths)
});
```

### 10.2 Error Categories

| Error Code | Log Level | Decision | Example |
|------------|-----------|----------|---------|
| 400 | warn | deny | `{ error: "VALIDATION_ERROR", field: "name" }` |
| 401 | warn | deny | `{ error: "UNAUTHORIZED", reason: "token_expired" }` |
| 403 | warn | deny | `{ error: "FORBIDDEN", reason: "not_in_allowlist" }` |
| 404 | info | deny | `{ error: "NOT_FOUND", resource: "event" }` |
| 429 | warn | deny | `{ error: "RATE_LIMITED", limit: 100 }` |
| 500 | error | error | `{ error: "INTERNAL_ERROR", code: "SHEETS_FAIL" }` |

---

## 11. Acceptance Criteria

| ID | Criterion | Verification | Status |
|----|-----------|--------------|--------|
| **AC-1** | Required fields defined | reqId, route, decision, status, latency documented | |
| **AC-2** | Redaction rules specified | No auth headers, tokens, or raw bodies | |
| **AC-3** | Correlation approach documented | Edge logs -> Worker logs -> Audit logs via reqId | |
| **AC-4** | Forbids logging sensitive material | Explicit list of forbidden data types | |
| **AC-5** | Consistent JSON shape defined | Standard schema with examples | |
| **AC-6** | Implementation reference provided | Points to existing logger.ts, auditLogger.ts | |

---

## 12. Related Documents

| Document | Path | Relationship |
|----------|------|--------------|
| Security Runbook | `docs/security/SECURITY_RUNBOOK.md` | Alerting on log signals |
| Security Baseline | `docs/security/SECURITY_BASELINE.md` | Overall security model |
| Secrets Policy | `docs/security/SECRETS_POLICY.md` | What must never be logged |
| Router Logger | `worker/src/logger.ts` | Implementation |
| Audit Logger | `worker/src/audit/auditLogger.ts` | Audit implementation |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-9.2 logging standard + correlation IDs |
