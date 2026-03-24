# SERVICE_AUTH_PATTERN.md — Service-to-Service Authentication Pattern

> **PROMPTSPEC-SEC-5.3** — Service-to-Service Auth Pattern
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Define cryptographic proof for machine-only routes where no user identity is available. This pattern enables secure service-to-service communication using HMAC-based request signing.

| Attribute | Value |
|-----------|-------|
| **Scope** | Machine-only routes: webhooks, internal service calls, CI/CD operations |
| **Prerequisites** | Security Baseline (SEC-0.1), Route Classification (SEC-5.1) |
| **Enforcement** | Worker request handler, origin verification |

---

## 2. North Star Compliance

### 2.1 NS-2: Privileged Surface Identity Requirement

> **NS-2:** Privileged surfaces require identity (Cloudflare Access) or **cryptographic proof**

This specification implements the **cryptographic proof** layer of NS-2 for machine-to-machine communication:

| Authentication Type | Use Case | Mechanism |
|---------------------|----------|-----------|
| User Identity | Human operators accessing admin UI | Cloudflare Access + OAuth (SEC-5.2) |
| **Service Identity** | Machine-to-machine calls | **HMAC request signing (this spec)** |
| Signed Mutations | Client-signed public writes | HMAC tokens (SEC-IAC-05) |

### 2.2 Relationship to Existing Auth Patterns

| Pattern | Spec | Purpose | Signature Scope |
|---------|------|---------|-----------------|
| **Signed Mutations** | SEC-IAC-05 | Client-signed public mutations | action + brandId + eventId + payloadHash |
| **Service Auth** | SEC-5.3 | Machine-to-machine requests | **method + path + timestamp + nonce + bodyHash** |
| **Cloudflare Access** | SEC-5.2 | User identity at edge | JWT (Cloudflare-signed) |

---

## 3. HMAC Signing Pattern

### 3.1 Signature Inputs

The HMAC signature is computed over a **canonical string** that binds the signature to a specific request.

| Input | Description | Example |
|-------|-------------|---------|
| **method** | HTTP method (uppercase) | `POST` |
| **path** | Request path (no query string) | `/api/v2/internal/sync` |
| **ts** | Unix timestamp (seconds) | `1704470400` |
| **nonce** | Unique request identifier (UUID v4) | `a3b4c5d6-7890-1234-5678-abcdef012345` |
| **bodyHash** | SHA-256 hash of request body (hex) | `e3b0c44298fc1c149...` (empty body hash for no body) |

### 3.2 Canonical String Definition

The canonical string is constructed by joining the inputs with newline characters:

```
METHOD\n
PATH\n
TIMESTAMP\n
NONCE\n
BODY_HASH
```

**Example Canonical String:**

```
POST
/api/v2/internal/sync
1704470400
a3b4c5d6-7890-1234-5678-abcdef012345
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

**Important Rules:**

1. **Method**: Always uppercase (`GET`, `POST`, `PUT`, `DELETE`)
2. **Path**: Normalized path without query string, leading slash required
3. **Timestamp**: Unix epoch seconds (not milliseconds)
4. **Nonce**: UUID v4 format, lowercase with hyphens
5. **Body Hash**: SHA-256 of raw request body, hex-encoded, lowercase
   - Empty body uses hash of empty string: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

### 3.3 Signature Computation

```
Signature = Base64URL(HMAC-SHA256(CanonicalString, SharedSecret))
```

**Algorithm:**

1. Construct the canonical string per Section 3.2
2. Compute HMAC-SHA256 using the shared secret
3. Encode the result as Base64URL (RFC 4648)

**Pseudocode:**

```typescript
async function signRequest(
  method: string,
  path: string,
  timestamp: number,
  nonce: string,
  body: string,
  secret: string
): Promise<string> {
  // Step 1: Compute body hash
  const bodyHash = await sha256Hex(body);

  // Step 2: Build canonical string
  const canonical = [
    method.toUpperCase(),
    path,
    timestamp.toString(),
    nonce,
    bodyHash
  ].join('\n');

  // Step 3: Compute HMAC-SHA256
  const signature = await hmacSha256(canonical, secret);

  // Step 4: Encode as Base64URL
  return base64UrlEncode(signature);
}
```

### 3.4 Request Headers

The signature and metadata are transmitted via HTTP headers:

| Header | Value | Required |
|--------|-------|----------|
| `X-Service-Signature` | Base64URL-encoded HMAC signature | **Yes** |
| `X-Service-Timestamp` | Unix timestamp (seconds) | **Yes** |
| `X-Service-Nonce` | UUID v4 nonce | **Yes** |
| `X-Service-Id` | Service identifier (for key selection) | Optional |

**Example Request:**

```http
POST /api/v2/internal/sync HTTP/1.1
Host: www.eventangle.com
Content-Type: application/json
X-Service-Signature: dGhpcyBpcyBhIHRlc3Qgc2lnbmF0dXJl...
X-Service-Timestamp: 1704470400
X-Service-Nonce: a3b4c5d6-7890-1234-5678-abcdef012345

{"data": "payload"}
```

---

## 4. Expiration Window & Replay Prevention

### 4.1 Timestamp Expiration

Requests are rejected if the timestamp is outside the acceptable window.

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **Max clock skew** | ±300 seconds (5 minutes) | Allows for NTP drift |
| **Window calculation** | `abs(now - ts) <= 300` | Symmetric window |

**Verification Logic:**

```typescript
function isTimestampValid(ts: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - ts);
  return skew <= 300; // 5 minute window
}
```

**Error Response (Expired):**

```json
{
  "ok": false,
  "status": 403,
  "code": "SIGNATURE_EXPIRED",
  "message": "Request timestamp outside acceptable window",
  "requestId": "req_abc123"
}
```

### 4.2 Replay Prevention

Nonces are stored to prevent request replay attacks.

| Component | Implementation |
|-----------|----------------|
| **Storage** | Cloudflare KV namespace (`SERVICE_NONCE_KV`) |
| **Key format** | `svc-nonce:{nonce}` |
| **TTL** | 600 seconds (10 minutes) |
| **Lookup** | Check if nonce exists before processing |

**Replay Detection Flow:**

```
1. Extract nonce from X-Service-Nonce header
2. Check KV: exists("svc-nonce:{nonce}")
   ├─ YES → Return 403 NONCE_REPLAYED
   └─ NO  → Continue verification
3. After successful verification:
   └─ Store in KV: put("svc-nonce:{nonce}", "1", {expirationTtl: 600})
```

**Error Response (Replayed):**

```json
{
  "ok": false,
  "status": 403,
  "code": "NONCE_REPLAYED",
  "message": "Request nonce has already been used",
  "requestId": "req_abc123"
}
```

### 4.3 Nonce Requirements

| Requirement | Specification |
|-------------|---------------|
| **Format** | UUID v4 (lowercase, with hyphens) |
| **Uniqueness** | Must be unique per request |
| **Generation** | Caller responsibility (crypto.randomUUID) |
| **Validation** | Regex: `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/` |

---

## 5. Verification Approach

### 5.1 Verification Steps

The verifier performs these checks in order (fail-fast):

```
VERIFICATION FLOW
─────────────────

Step 1: Extract Headers
├─ X-Service-Signature → signature
├─ X-Service-Timestamp → ts
├─ X-Service-Nonce → nonce
└─ Missing any? → 403 MISSING_SIGNATURE_HEADERS

Step 2: Validate Timestamp
├─ Parse ts as integer
├─ Check |now - ts| <= 300
└─ Outside window? → 403 SIGNATURE_EXPIRED

Step 3: Validate Nonce Format
├─ Match UUID v4 regex
└─ Invalid format? → 403 INVALID_NONCE_FORMAT

Step 4: Check Replay
├─ Lookup "svc-nonce:{nonce}" in KV
└─ Exists? → 403 NONCE_REPLAYED

Step 5: Compute Expected Signature
├─ Build canonical string
├─ Compute HMAC-SHA256
└─ Encode Base64URL

Step 6: Compare Signatures
├─ Constant-time comparison
└─ Mismatch? → 403 INVALID_SIGNATURE

Step 7: Store Nonce
├─ KV put "svc-nonce:{nonce}" with TTL 600
└─ Proceed with request
```

### 5.2 Error Response Format

All verification failures return HTTP 403 with consistent structure:

```typescript
interface ServiceAuthError {
  ok: false;
  status: 403;
  code: ServiceAuthErrorCode;
  message: string;
  requestId: string;
}

type ServiceAuthErrorCode =
  | 'MISSING_SIGNATURE_HEADERS'  // Required headers not present
  | 'INVALID_TIMESTAMP'          // Timestamp not a valid integer
  | 'SIGNATURE_EXPIRED'          // Timestamp outside window
  | 'INVALID_NONCE_FORMAT'       // Nonce not valid UUID v4
  | 'NONCE_REPLAYED'             // Nonce already used
  | 'INVALID_SIGNATURE'          // HMAC verification failed
  | 'SERVICE_AUTH_NOT_CONFIGURED'; // Secret not configured
```

### 5.3 Constant-Time Comparison

Signature comparison **MUST** use constant-time comparison to prevent timing attacks:

```typescript
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
```

---

## 6. Implementation Plan

### 6.1 Worker Implementation

#### 6.1.1 Environment Bindings

```typescript
interface ServiceAuthEnv {
  /**
   * Shared secret for HMAC signing (minimum 32 bytes)
   * Store as Cloudflare secret, never in code
   */
  SERVICE_AUTH_SECRET?: string;

  /**
   * KV namespace for nonce storage
   */
  SERVICE_NONCE_KV?: KVNamespace;
}
```

#### 6.1.2 Verification Function

```typescript
// worker/src/auth/serviceAuth.ts

export async function verifyServiceAuth(
  request: Request,
  env: ServiceAuthEnv,
  requestId: string
): Promise<ServiceAuthResult> {
  // Check configuration
  if (!env.SERVICE_AUTH_SECRET || env.SERVICE_AUTH_SECRET.length < 32) {
    return {
      allowed: false,
      errorResponse: createServiceAuthError('SERVICE_AUTH_NOT_CONFIGURED', requestId),
      reason: 'Service auth secret not configured'
    };
  }

  // Extract headers
  const signature = request.headers.get('X-Service-Signature');
  const timestamp = request.headers.get('X-Service-Timestamp');
  const nonce = request.headers.get('X-Service-Nonce');

  if (!signature || !timestamp || !nonce) {
    return {
      allowed: false,
      errorResponse: createServiceAuthError('MISSING_SIGNATURE_HEADERS', requestId),
      reason: 'Missing required signature headers'
    };
  }

  // Validate timestamp
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) {
    return {
      allowed: false,
      errorResponse: createServiceAuthError('INVALID_TIMESTAMP', requestId),
      reason: 'Timestamp not a valid integer'
    };
  }

  if (!isTimestampValid(ts)) {
    return {
      allowed: false,
      errorResponse: createServiceAuthError('SIGNATURE_EXPIRED', requestId),
      reason: 'Timestamp outside acceptable window'
    };
  }

  // Validate nonce format
  if (!isValidNonce(nonce)) {
    return {
      allowed: false,
      errorResponse: createServiceAuthError('INVALID_NONCE_FORMAT', requestId),
      reason: 'Invalid nonce format'
    };
  }

  // Check replay
  if (env.SERVICE_NONCE_KV) {
    const isReplayed = await checkNonceReplayed(nonce, env.SERVICE_NONCE_KV);
    if (isReplayed) {
      return {
        allowed: false,
        errorResponse: createServiceAuthError('NONCE_REPLAYED', requestId),
        reason: 'Nonce already used'
      };
    }
  }

  // Compute expected signature
  const body = await request.clone().text();
  const expectedSignature = await computeServiceSignature(
    request.method,
    new URL(request.url).pathname,
    ts,
    nonce,
    body,
    env.SERVICE_AUTH_SECRET
  );

  // Verify signature
  if (!constantTimeCompare(signature, expectedSignature)) {
    return {
      allowed: false,
      errorResponse: createServiceAuthError('INVALID_SIGNATURE', requestId),
      reason: 'Signature verification failed'
    };
  }

  // Store nonce to prevent replay
  if (env.SERVICE_NONCE_KV) {
    await storeNonce(nonce, env.SERVICE_NONCE_KV);
  }

  return {
    allowed: true,
    reason: 'Valid service authentication'
  };
}
```

#### 6.1.3 Guard Function

```typescript
export async function guardServiceRoute(
  request: Request,
  env: ServiceAuthEnv,
  requestId: string
): Promise<Response | null> {
  const result = await verifyServiceAuth(request, env, requestId);

  if (!result.allowed) {
    console.warn(`[ServiceAuth] Verification failed: ${result.reason}`);
    return result.errorResponse;
  }

  console.log('[ServiceAuth] Request authenticated successfully');
  return null; // Allow request to proceed
}
```

### 6.2 Client Implementation (Caller)

#### 6.2.1 Request Signing

```typescript
// Example: Signing a service request

async function signServiceRequest(
  method: string,
  url: string,
  body: string,
  secret: string
): Promise<Headers> {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const path = new URL(url).pathname;

  // Compute body hash
  const bodyHash = await sha256Hex(body);

  // Build canonical string
  const canonical = [
    method.toUpperCase(),
    path,
    timestamp.toString(),
    nonce,
    bodyHash
  ].join('\n');

  // Compute signature
  const signature = await hmacSha256Base64Url(canonical, secret);

  // Return headers to add to request
  const headers = new Headers();
  headers.set('X-Service-Signature', signature);
  headers.set('X-Service-Timestamp', timestamp.toString());
  headers.set('X-Service-Nonce', nonce);

  return headers;
}

// Usage
async function callInternalService(endpoint: string, data: object) {
  const body = JSON.stringify(data);
  const secret = process.env.SERVICE_AUTH_SECRET;

  const authHeaders = await signServiceRequest('POST', endpoint, body, secret);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...Object.fromEntries(authHeaders)
    },
    body
  });

  return response;
}
```

### 6.3 Secret Management

| Environment | Secret Name | Storage |
|-------------|-------------|---------|
| Production | `SERVICE_AUTH_SECRET` | Cloudflare Secret (wrangler secret) |
| Staging | `SERVICE_AUTH_SECRET` | Cloudflare Secret |
| CI/CD | `SERVICE_AUTH_SECRET` | GitHub Actions Secret |

**Secret Requirements:**

1. Minimum 32 bytes (256 bits) of entropy
2. Generated using cryptographically secure random
3. Unique per environment (production vs staging)
4. Rotated according to security policy

**Generation Command:**

```bash
# Generate a 32-byte secret (base64 encoded)
openssl rand -base64 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## 7. Use Cases

### 7.1 Machine-Only Route Examples

| Route Pattern | Use Case | Caller |
|---------------|----------|--------|
| `/api/v2/internal/sync` | Data synchronization | Background Worker |
| `/api/v2/internal/webhook` | External webhook receiver | External service |
| `/api/v2/internal/health-report` | Internal health aggregation | Monitoring service |
| `/api/v2/ci/deploy-notify` | CI/CD deployment notification | GitHub Actions |

### 7.2 Integration with Route Classification

Per SEC-5.1 (Route Classification Policy), machine-only routes fall under **Privileged** classification with service auth:

```
Route Classification Decision Tree:
                    │
   Is this a machine-only call?
   (no user session, service-to-service)
                    │
         ┌──────────┴──────────┐
         │                     │
        YES                   NO
         │                     │
         ▼                     ▼
    PRIVILEGED           Follow normal
  (SEC-5.3 service)     classification
```

### 7.3 Combining with Other Auth Methods

For routes that may be accessed by both users and services:

```typescript
async function guardHybridRoute(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response | null> {
  // Check for service auth headers first
  if (request.headers.has('X-Service-Signature')) {
    return guardServiceRoute(request, env, requestId);
  }

  // Fall back to user authentication
  return guardV2AdminRoute(request, env, requestId);
}
```

---

## 8. Security Considerations

### 8.1 Threat Model

| Threat | Mitigation | Verification |
|--------|------------|--------------|
| **Replay attack** | Nonce storage with TTL | KV lookup before processing |
| **Timestamp manipulation** | ±5 minute window | Symmetric timestamp check |
| **Signature forgery** | HMAC-SHA256 with secret | Constant-time comparison |
| **Body tampering** | Body hash in signature | Hash included in canonical string |
| **Path manipulation** | Path in signature | Path included in canonical string |
| **Method confusion** | Method in signature | Method included in canonical string |
| **Timing attack** | Constant-time compare | XOR-based comparison |
| **Secret exposure** | Cloudflare Secrets | Never in code or logs |

### 8.2 What This Pattern Does NOT Protect

| Scenario | Reason | Alternative |
|----------|--------|-------------|
| **Secret compromise** | Attacker can forge signatures | Rotate secrets, use short-lived credentials |
| **Compromised caller** | Caller has legitimate secret | Audit logging, anomaly detection |
| **DoS attacks** | Signature verification has cost | Rate limiting at edge |
| **Internal network sniffing** | HTTPS required | TLS enforcement (SEC-3.1) |

### 8.3 Secret Rotation

When rotating the `SERVICE_AUTH_SECRET`:

1. Add new secret as `SERVICE_AUTH_SECRET_NEW`
2. Update verifier to accept both secrets
3. Deploy updated verifier
4. Update all callers to use new secret
5. Remove old secret after grace period (24-48 hours)
6. Clean up: remove `SERVICE_AUTH_SECRET_NEW`, use as primary

---

## 9. Verification Steps

### 9.1 Manual Verification

```bash
# Generate test signature (requires shared secret)
SECRET="your-shared-secret"
METHOD="POST"
PATH="/api/v2/internal/test"
TIMESTAMP=$(date +%s)
NONCE=$(uuidgen | tr '[:upper:]' '[:lower:]')
BODY='{"test": true}'
BODY_HASH=$(echo -n "$BODY" | openssl dgst -sha256 | cut -d' ' -f2)

CANONICAL="${METHOD}
${PATH}
${TIMESTAMP}
${NONCE}
${BODY_HASH}"

SIGNATURE=$(echo -n "$CANONICAL" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64 | tr '+/' '-_' | tr -d '=')

# Test the endpoint
curl -X POST "https://www.eventangle.com${PATH}" \
  -H "Content-Type: application/json" \
  -H "X-Service-Signature: ${SIGNATURE}" \
  -H "X-Service-Timestamp: ${TIMESTAMP}" \
  -H "X-Service-Nonce: ${NONCE}" \
  -d "$BODY"
```

### 9.2 Automated Test Cases

```typescript
describe('Service Auth Pattern', () => {
  it('should accept valid signature', async () => {
    const signature = await signRequest(/* valid params */);
    const response = await makeRequest(signature);
    expect(response.status).toBe(200);
  });

  it('should reject missing headers', async () => {
    const response = await fetch(endpoint, { method: 'POST' });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe('MISSING_SIGNATURE_HEADERS');
  });

  it('should reject expired timestamp', async () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 min ago
    const signature = await signRequest({ timestamp: oldTimestamp });
    const response = await makeRequest(signature);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe('SIGNATURE_EXPIRED');
  });

  it('should reject replayed nonce', async () => {
    const nonce = crypto.randomUUID();
    const signature = await signRequest({ nonce });

    // First request should succeed
    const response1 = await makeRequest(signature, nonce);
    expect(response1.status).toBe(200);

    // Second request with same nonce should fail
    const response2 = await makeRequest(signature, nonce);
    expect(response2.status).toBe(403);
    const body = await response2.json();
    expect(body.code).toBe('NONCE_REPLAYED');
  });

  it('should reject tampered body', async () => {
    const signature = await signRequest({ body: '{"original": true}' });
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: getAuthHeaders(signature),
      body: '{"tampered": true}' // Different body
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe('INVALID_SIGNATURE');
  });

  it('should reject invalid signature', async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-Service-Signature': 'invalid-signature',
        'X-Service-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Service-Nonce': crypto.randomUUID()
      },
      body: '{}'
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe('INVALID_SIGNATURE');
  });
});
```

---

## 10. Acceptance Criteria

### 10.1 Primary Acceptance Criteria

| # | Criterion | Verification Method | Status |
|---|-----------|---------------------|--------|
| **AC-1** | Pattern resists replay: same nonce rejected on second request | Automated test (9.2) | |
| **AC-2** | Pattern rejects missing signature headers | Automated test (9.2) | |
| **AC-3** | Pattern rejects expired timestamps (>5 min skew) | Automated test (9.2) | |
| **AC-4** | Pattern rejects invalid signatures | Automated test (9.2) | |
| **AC-5** | Pattern rejects tampered request body | Automated test (9.2) | |
| **AC-6** | Signature uses constant-time comparison | Code review | |

### 10.2 Security Acceptance Criteria

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| **SEC-1** | Secret stored in Cloudflare Secrets (never in code) | Configuration audit |
| **SEC-2** | Secret minimum 32 bytes | Configuration validation |
| **SEC-3** | Nonce TTL prevents indefinite storage growth | KV TTL configuration |
| **SEC-4** | All verification failures logged | Log review |

---

## 11. Related Documents

| Document | Path | Relationship |
|----------|------|--------------|
| Security Baseline | `docs/security/SECURITY_BASELINE.md` | Parent policy (NS-2) |
| Route Classification | `docs/security/ROUTE_CLASSIFICATION_POLICY.md` | Route definitions (SEC-5.1) |
| Cloudflare Access | `docs/security/CLOUDFLARE_ACCESS_PRIVILEGED.md` | User identity (SEC-5.2) |
| Signed Mutations | `worker/src/auth/signedMutations.ts` | Client signing (SEC-IAC-05) |

---

## 12. Summary

| Aspect | Value |
|--------|-------|
| **Auth Type** | HMAC-SHA256 request signing |
| **Canonical String** | method + path + timestamp + nonce + bodyHash |
| **Timestamp Window** | ±300 seconds (5 minutes) |
| **Replay Prevention** | Nonce storage in KV with 600s TTL |
| **Headers** | `X-Service-Signature`, `X-Service-Timestamp`, `X-Service-Nonce` |
| **Secret Storage** | Cloudflare Secrets |
| **Primary AC** | Pattern resists replay and rejects missing/expired signatures |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-5.3 service-to-service auth pattern |
