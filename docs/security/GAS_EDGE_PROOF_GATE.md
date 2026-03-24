# GAS_EDGE_PROOF_GATE.md — GAS Edge Proof Gate (If GAS is still used)

> **PROMPTSPEC-SEC-8.2** — GAS Edge Proof Gate
> Role: Director of Security + Lead Networking Consultant
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Define query-based signature enforcement that ensures **direct GAS URL access must fail** unless the request has been signed by the Cloudflare Worker at the edge. This provides cryptographic proof that requests have passed through the trusted edge layer.

| Attribute | Value |
|-----------|-------|
| **Scope** | Google Apps Script endpoints (if GAS is still used in legacy scenarios) |
| **Prerequisites** | Security Baseline (SEC-0.1), Service Auth Pattern (SEC-5.3), NO_GAS_GUARD (SEC-IAC-01) |
| **Constraints** | GAS cannot reliably inspect HTTP headers; **query parameter signatures are required** |

---

## 2. Architectural Context

### 2.1 Current State: Worker-Only

The EventAngle MVP uses a **Worker-only architecture** (no GAS runtime). This document exists for:

1. **Legacy systems** still transitioning from GAS
2. **Hybrid deployments** temporarily routing to GAS
3. **Defense-in-depth** if GAS endpoints are accidentally exposed

| Architecture State | GAS Edge Proof Requirement |
|--------------------|----------------------------|
| **Worker-only (current)** | N/A — GAS not in use |
| **Hybrid (transitional)** | **Required** — GAS must validate edge signatures |
| **GAS-primary (legacy)** | **Critical** — primary access control mechanism |

### 2.2 Core Invariant

> **INVARIANT:** Direct GAS URL access MUST return HTTP 401 or 403. Only edge-signed requests are processed.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        GAS EDGE PROOF GATE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Legitimate Flow:                                                           │
│  ┌──────────┐    ┌───────────────┐    ┌──────────────┐    ┌───────────┐    │
│  │  Client  │───▶│ CF Worker     │───▶│ GAS Endpoint │───▶│ Response  │    │
│  └──────────┘    │ (signs req)   │    │ (validates)  │    └───────────┘    │
│                  └───────────────┘    └──────────────┘                      │
│                         │                    │                              │
│                    Adds: ?ts=...&sig=...     Checks signature               │
│                                                                             │
│  Attack Attempt:                                                            │
│  ┌──────────┐                         ┌──────────────┐    ┌───────────┐    │
│  │ Attacker │────────────────────────▶│ GAS Endpoint │───▶│ 401/403   │    │
│  └──────────┘                         │ (no sig/     │    └───────────┘    │
│                                       │  invalid sig)│                      │
│  Direct access without signature      └──────────────┘                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Why Query Parameters (Not Headers)

### 3.1 GAS Header Limitations

Google Apps Script has **inconsistent and unreliable header handling**:

| Issue | Description | Impact |
|-------|-------------|--------|
| **Header stripping** | Google infrastructure may strip custom headers | Signatures lost in transit |
| **Header case sensitivity** | Header names may be normalized unpredictably | Signature verification fails |
| **Content-Type limitations** | Some headers cannot be set or read reliably | Limited metadata options |
| **CORS preflight** | OPTIONS requests don't reach `doGet/doPost` | Headers not inspectable |
| **Cache behavior** | Cached responses may not include request headers | State lost |

### 3.2 Query Parameters: The Reliable Choice

Query parameters are:

| Advantage | Description |
|-----------|-------------|
| **Preserved** | Always passed through to GAS `doGet(e)`/`doPost(e)` |
| **Accessible** | Available via `e.parameter` in GAS |
| **Cacheable** | Can be part of cache key if needed |
| **Inspectable** | Visible in GAS logs for debugging |
| **Cross-origin** | No CORS preflight required for simple requests |

> **EXPLICIT LIMITATION:** Header-based signatures are **NOT recommended** for GAS endpoints due to the above issues. Always prefer query parameter signatures.

---

## 4. Query-Signing Scheme

### 4.1 Signature Inputs

The signature binds the request to a specific timestamp and path:

| Input | Description | Example |
|-------|-------------|---------|
| **path** | Full request path (normalized) | `/macros/s/.../exec` |
| **ts** | Unix timestamp (seconds) | `1704470400` |
| **action** | API action (if applicable) | `api_getEvents` |
| **nonce** | Optional: unique request ID | `abc123` |

### 4.2 Canonical String Definition

The canonical string is constructed for HMAC computation:

```
VERSION|PATH|TIMESTAMP|ACTION|NONCE
```

**Version prefix** allows future signature format changes.

**Example Canonical String:**

```
v1|/macros/s/AKfycbx.../exec|1704470400|api_getEvents|abc123
```

**Canonical String Rules:**

1. **Version**: Always `v1` for this scheme
2. **Path**: URL path, no query string, no trailing slash normalization needed
3. **Timestamp**: Unix epoch seconds (10 digits)
4. **Action**: The `action` parameter value (empty string if none)
5. **Nonce**: Request nonce (empty string if none)
6. **Delimiter**: Pipe character `|` separates fields
7. **Encoding**: UTF-8, no URL encoding in canonical string

### 4.3 Signature Computation

```
sig = Base64URL(HMAC-SHA256(canonicalString, sharedSecret))
```

**Algorithm Steps:**

1. Construct the canonical string per Section 4.2
2. Compute HMAC-SHA256 using the shared secret
3. Encode the result as Base64URL (RFC 4648 §5)
4. Truncate to first 32 characters (optional, for URL length)

**Pseudocode (Worker side):**

```typescript
async function signGASRequest(
  path: string,
  timestamp: number,
  action: string,
  nonce: string,
  secret: string
): Promise<string> {
  // Step 1: Build canonical string
  const canonical = [
    'v1',
    path,
    timestamp.toString(),
    action || '',
    nonce || ''
  ].join('|');

  // Step 2: Compute HMAC-SHA256
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(canonical)
  );

  // Step 3: Encode as Base64URL
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  // Step 4: Truncate for URL friendliness (optional)
  return base64url.substring(0, 32);
}
```

### 4.4 Query Parameter Format

The signed request includes these query parameters:

| Parameter | Description | Required |
|-----------|-------------|----------|
| `_ts` | Unix timestamp (seconds) | **Yes** |
| `_sig` | Base64URL signature | **Yes** |
| `_nonce` | Unique request identifier | Recommended |
| `action` | API action identifier | Depends on API |

**Example Signed URL:**

```
https://script.google.com/macros/s/AKfycbx.../exec?action=api_getEvents&_ts=1704470400&_sig=dGhpc0lzQVRlc3RTaWduYXR1cmU&_nonce=req123
```

**Parameter Naming:**

- Underscore prefix (`_ts`, `_sig`, `_nonce`) distinguishes signature params from API params
- Prevents collision with application-level parameters

---

## 5. Expiration Window

### 5.1 Timestamp Validation

Requests are rejected if the timestamp is outside the acceptable window.

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **Max age** | 300 seconds (5 minutes) | Prevents capture-and-replay |
| **Max future** | 60 seconds | Allows minor clock drift |
| **Window** | `ts >= (now - 300) AND ts <= (now + 60)` | Asymmetric window |

**GAS Validation Logic:**

```javascript
function isTimestampValid(ts) {
  var now = Math.floor(Date.now() / 1000);
  var age = now - ts;

  // Reject if too old (> 5 minutes)
  if (age > 300) {
    return { valid: false, reason: 'SIGNATURE_EXPIRED' };
  }

  // Reject if too far in future (> 1 minute)
  if (age < -60) {
    return { valid: false, reason: 'TIMESTAMP_FUTURE' };
  }

  return { valid: true };
}
```

### 5.2 Expiration Error Response

```javascript
// GAS response for expired signature
function rejectExpired() {
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: false,
      status: 403,
      code: 'SIGNATURE_EXPIRED',
      message: 'Request signature has expired'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

## 6. Replay Handling

### 6.1 Replay Attack Definition

A replay attack occurs when an attacker captures a valid signed request and resubmits it:

```
1. Attacker intercepts: ?action=api_transfer&_ts=1704470400&_sig=abc123
2. Attacker replays the same request within the 5-minute window
3. Without replay protection, request is processed again
```

### 6.2 Replay Prevention Strategies

| Strategy | Complexity | Effectiveness | Recommended For |
|----------|------------|---------------|-----------------|
| **Timestamp-only** | Low | Medium | Read-only endpoints |
| **Timestamp + Nonce (GAS Cache)** | Medium | High | Most use cases |
| **Timestamp + Nonce (External Store)** | High | Highest | Critical mutations |

### 6.3 Strategy A: Timestamp-Only (Read Endpoints)

For **read-only endpoints**, timestamp expiration alone may be sufficient:

| Characteristic | Value |
|----------------|-------|
| **Use case** | `api_getEvents`, `api_getStatus` |
| **Risk** | Replayed reads are idempotent |
| **Protection** | 5-minute window limits replay duration |
| **Implementation** | Validate `_ts` only |

### 6.4 Strategy B: Nonce with GAS CacheService

For **mutation endpoints**, use nonce-based replay prevention:

```javascript
// GAS nonce validation using CacheService
function checkAndStoreNonce(nonce) {
  var cache = CacheService.getScriptCache();
  var key = 'nonce_' + nonce;

  // Check if nonce already used
  var existing = cache.get(key);
  if (existing) {
    return { valid: false, reason: 'NONCE_REPLAYED' };
  }

  // Store nonce with TTL (600 seconds = 10 minutes)
  // TTL must exceed timestamp window to prevent race conditions
  cache.put(key, '1', 600);

  return { valid: true };
}
```

**GAS CacheService Limitations:**

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| **6-hour max TTL** | Cannot track nonces longer | Timestamp window is 5 min anyway |
| **100KB value limit** | N/A for nonce storage | Store minimal value ('1') |
| **Shared quota** | High traffic may evict entries | Use short nonce TTL |
| **No atomic operations** | Rare race condition possible | Accept minimal risk |

### 6.5 Strategy C: External Nonce Store

For **high-security mutations**, use external nonce storage:

```javascript
// GAS nonce validation using external store (via UrlFetchApp)
function checkNonceExternal(nonce) {
  var response = UrlFetchApp.fetch(
    'https://nonce-store.example.com/check',
    {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({ nonce: nonce }),
      muteHttpExceptions: true
    }
  );

  var result = JSON.parse(response.getContentText());
  return result;
}
```

> **NOTE:** Using external stores from GAS adds latency and complexity. For most use cases, Strategy B (CacheService) is sufficient.

### 6.6 Nonce Requirements

| Requirement | Specification |
|-------------|---------------|
| **Format** | Alphanumeric, 8-32 characters |
| **Uniqueness** | Caller must ensure uniqueness per request |
| **Generation** | Use crypto.randomUUID() or similar at edge |
| **Validation** | Regex: `/^[a-zA-Z0-9]{8,32}$/` |

---

## 7. GAS Validation Outline

### 7.1 Complete Validation Flow

```javascript
/**
 * GAS Edge Proof Gate Validator
 * Validates that requests are signed by the Cloudflare Worker edge.
 *
 * @param {Object} e - The event object from doGet/doPost
 * @returns {Object} { valid: boolean, reason?: string, response?: TextOutput }
 */
function validateEdgeProof(e) {
  var params = e.parameter;

  // Step 1: Extract signature parameters
  var ts = params._ts;
  var sig = params._sig;
  var nonce = params._nonce || '';
  var action = params.action || '';

  // Step 2: Check required parameters
  if (!ts || !sig) {
    return {
      valid: false,
      reason: 'MISSING_SIGNATURE',
      response: createErrorResponse(401, 'MISSING_SIGNATURE', 'Missing _ts or _sig parameter')
    };
  }

  // Step 3: Parse and validate timestamp
  var timestamp = parseInt(ts, 10);
  if (isNaN(timestamp)) {
    return {
      valid: false,
      reason: 'INVALID_TIMESTAMP',
      response: createErrorResponse(403, 'INVALID_TIMESTAMP', 'Timestamp is not a valid number')
    };
  }

  var tsResult = isTimestampValid(timestamp);
  if (!tsResult.valid) {
    return {
      valid: false,
      reason: tsResult.reason,
      response: createErrorResponse(403, tsResult.reason, 'Timestamp validation failed')
    };
  }

  // Step 4: Check nonce replay (if nonce provided)
  if (nonce) {
    var nonceResult = checkAndStoreNonce(nonce);
    if (!nonceResult.valid) {
      return {
        valid: false,
        reason: nonceResult.reason,
        response: createErrorResponse(403, 'NONCE_REPLAYED', 'Request nonce has already been used')
      };
    }
  }

  // Step 5: Compute expected signature
  var path = getScriptPath(); // Get the deployed script URL path
  var expectedSig = computeSignature(path, timestamp, action, nonce);

  // Step 6: Verify signature (constant-time comparison)
  if (!constantTimeEquals(sig, expectedSig)) {
    return {
      valid: false,
      reason: 'INVALID_SIGNATURE',
      response: createErrorResponse(403, 'INVALID_SIGNATURE', 'Signature verification failed')
    };
  }

  // Validation passed
  return { valid: true };
}

/**
 * Compute HMAC-SHA256 signature for GAS validation
 */
function computeSignature(path, timestamp, action, nonce) {
  var secret = getEdgeSecret(); // Retrieve from PropertiesService
  var canonical = ['v1', path, timestamp.toString(), action, nonce].join('|');

  var signature = Utilities.computeHmacSha256Signature(canonical, secret);
  var base64 = Utilities.base64Encode(signature);
  // Convert to Base64URL
  var base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return base64url.substring(0, 32);
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeEquals(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  var result = 0;
  for (var i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Create standardized error response
 */
function createErrorResponse(status, code, message) {
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: false,
      status: status,
      code: code,
      message: message
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Retrieve shared secret from Script Properties
 */
function getEdgeSecret() {
  var secret = PropertiesService.getScriptProperties().getProperty('EDGE_PROOF_SECRET');
  if (!secret || secret.length < 32) {
    throw new Error('EDGE_PROOF_SECRET not configured or too short');
  }
  return secret;
}
```

### 7.2 Integration with doGet/doPost

```javascript
/**
 * GAS HTTP GET handler with Edge Proof Gate
 */
function doGet(e) {
  // Validate edge proof
  var validation = validateEdgeProof(e);
  if (!validation.valid) {
    console.warn('Edge proof validation failed:', validation.reason);
    return validation.response;
  }

  // Proceed with normal request handling
  var action = e.parameter.action;
  switch (action) {
    case 'api_getEvents':
      return handleGetEvents(e);
    case 'api_getStatus':
      return handleGetStatus(e);
    default:
      return createErrorResponse(404, 'UNKNOWN_ACTION', 'Unknown action');
  }
}

/**
 * GAS HTTP POST handler with Edge Proof Gate
 */
function doPost(e) {
  // Validate edge proof
  var validation = validateEdgeProof(e);
  if (!validation.valid) {
    console.warn('Edge proof validation failed:', validation.reason);
    return validation.response;
  }

  // Proceed with normal request handling
  var action = e.parameter.action;
  switch (action) {
    case 'api_createEvent':
      return handleCreateEvent(e);
    default:
      return createErrorResponse(404, 'UNKNOWN_ACTION', 'Unknown action');
  }
}
```

### 7.3 Secret Configuration

The shared secret must be configured in GAS Script Properties:

```javascript
/**
 * One-time setup: Configure the edge proof secret
 * Run this function manually from the GAS editor
 */
function setupEdgeProofSecret() {
  var secret = 'YOUR_32_BYTE_OR_LONGER_SECRET_HERE';

  if (secret.length < 32) {
    throw new Error('Secret must be at least 32 characters');
  }

  PropertiesService.getScriptProperties().setProperty('EDGE_PROOF_SECRET', secret);
  console.log('Edge proof secret configured successfully');
}
```

---

## 8. Worker Signing Outline

### 8.1 Worker Request Signing

```typescript
// worker/src/gas/signGASRequest.ts

interface GASSigningConfig {
  secret: string;
  path: string;
}

/**
 * Sign a request to GAS with edge proof
 */
export async function signGASRequest(
  baseUrl: string,
  action: string,
  additionalParams: Record<string, string>,
  config: GASSigningConfig
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID().replace(/-/g, '').substring(0, 16);

  // Compute signature
  const signature = await computeGASSignature(
    config.path,
    timestamp,
    action,
    nonce,
    config.secret
  );

  // Build URL with all parameters
  const url = new URL(baseUrl);
  url.searchParams.set('action', action);
  url.searchParams.set('_ts', timestamp.toString());
  url.searchParams.set('_sig', signature);
  url.searchParams.set('_nonce', nonce);

  // Add any additional parameters
  for (const [key, value] of Object.entries(additionalParams)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

/**
 * Compute the HMAC signature for GAS
 */
async function computeGASSignature(
  path: string,
  timestamp: number,
  action: string,
  nonce: string,
  secret: string
): Promise<string> {
  const canonical = ['v1', path, timestamp.toString(), action, nonce].join('|');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(canonical)
  );

  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return base64url.substring(0, 32);
}
```

### 8.2 Worker Environment Configuration

```typescript
// worker/src/types/env.ts

interface GASProxyEnv {
  /**
   * Shared secret for GAS edge proof signing
   * Must match the secret configured in GAS Script Properties
   */
  GAS_EDGE_PROOF_SECRET: string;

  /**
   * Base URL for GAS deployment
   * e.g., https://script.google.com/macros/s/AKfycbx.../exec
   */
  GAS_BASE_URL?: string;

  /**
   * Path component for signature computation
   * e.g., /macros/s/AKfycbx.../exec
   */
  GAS_SCRIPT_PATH?: string;
}
```

### 8.3 Worker Proxy Handler

```typescript
// worker/src/handlers/gasProxy.ts

export async function handleGASProxy(
  request: Request,
  env: GASProxyEnv,
  ctx: ExecutionContext
): Promise<Response> {
  // Ensure GAS proxy is configured
  if (!env.GAS_BASE_URL || !env.GAS_EDGE_PROOF_SECRET) {
    return new Response(JSON.stringify({
      ok: false,
      status: 503,
      code: 'GAS_PROXY_NOT_CONFIGURED',
      message: 'GAS proxy is not configured'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  // Sign the request
  const signedUrl = await signGASRequest(
    env.GAS_BASE_URL,
    action,
    Object.fromEntries(url.searchParams),
    {
      secret: env.GAS_EDGE_PROOF_SECRET,
      path: env.GAS_SCRIPT_PATH || new URL(env.GAS_BASE_URL).pathname
    }
  );

  // Forward to GAS
  const gasResponse = await fetch(signedUrl, {
    method: request.method,
    headers: {
      'Content-Type': 'application/json'
    }
  });

  // Return GAS response
  return new Response(gasResponse.body, {
    status: gasResponse.status,
    headers: {
      'Content-Type': 'application/json',
      'X-Proxied-Via': 'cf-worker'
    }
  });
}
```

---

## 9. Explicit Limitations

### 9.1 Header Handling Limitations

> **EXPLICIT LIMITATION:** Header-based authentication is **NOT reliable** for GAS endpoints.

| Limitation | Details |
|------------|---------|
| **Custom headers stripped** | Google's infrastructure may remove `X-` prefixed headers |
| **Header case normalization** | Header names may be lowercased or titlecased unpredictably |
| **Authorization header** | May be stripped by Google's proxy layer |
| **Content-Type restrictions** | Only standard content types reliably pass through |
| **CORS complications** | Preflight requests don't reach GAS handlers |

**Recommendation:** Always use query parameter signatures for GAS endpoints.

### 9.2 GAS Runtime Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| **6-minute execution limit** | Long operations may timeout | Keep operations short |
| **CacheService quotas** | High traffic may exhaust cache | Use short TTLs |
| **No true atomic operations** | Race conditions possible | Accept minimal risk |
| **Single-threaded execution** | No parallel signature verification | Keep validation fast |
| **PropertiesService limits** | 9KB per property | Secret fits easily |

### 9.3 Security Limitations

| Limitation | Details | Mitigation |
|------------|---------|------------|
| **Secret in PropertiesService** | Accessible to script editors | Limit GAS editor access |
| **No HSM support** | Software-based secret storage | Regular rotation |
| **Logging visibility** | GAS logs may expose parameters | Avoid logging signatures |
| **URL visibility** | Signed URLs in browser history | Use POST for mutations |

---

## 10. Verification Tests

### 10.1 Test 1: Direct Access Returns 401/403

Verify that direct GAS URL access without signature fails.

```bash
#!/bin/bash
# Test: Direct GAS access without signature

GAS_URL="${GAS_BASE_URL}?action=api_getEvents"

echo "=== Test 1: Direct Access Without Signature ==="
echo "URL: ${GAS_URL}"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GAS_URL")
BODY=$(curl -s "$GAS_URL")

echo "Status: $STATUS"
echo "Body: $BODY"

if [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ] || echo "$BODY" | grep -q "MISSING_SIGNATURE"; then
    echo "RESULT: PASS - Direct access rejected"
else
    echo "RESULT: FAIL - Direct access not rejected (status: $STATUS)"
fi
```

**Expected Output:**

```json
{
  "ok": false,
  "status": 401,
  "code": "MISSING_SIGNATURE",
  "message": "Missing _ts or _sig parameter"
}
```

### 10.2 Test 2: Expired Signature Returns 403

```bash
#!/bin/bash
# Test: Expired signature

OLD_TS=$(($(date +%s) - 600))  # 10 minutes ago
GAS_URL="${GAS_BASE_URL}?action=api_getEvents&_ts=${OLD_TS}&_sig=invalidsig"

echo "=== Test 2: Expired Signature ==="
BODY=$(curl -s "$GAS_URL")
echo "Body: $BODY"

if echo "$BODY" | grep -q "SIGNATURE_EXPIRED"; then
    echo "RESULT: PASS - Expired signature rejected"
else
    echo "RESULT: FAIL - Expired signature not detected"
fi
```

### 10.3 Test 3: Invalid Signature Returns 403

```bash
#!/bin/bash
# Test: Invalid signature

TS=$(date +%s)
GAS_URL="${GAS_BASE_URL}?action=api_getEvents&_ts=${TS}&_sig=InvalidSignatureHere123"

echo "=== Test 3: Invalid Signature ==="
BODY=$(curl -s "$GAS_URL")
echo "Body: $BODY"

if echo "$BODY" | grep -q "INVALID_SIGNATURE"; then
    echo "RESULT: PASS - Invalid signature rejected"
else
    echo "RESULT: FAIL - Invalid signature not detected"
fi
```

### 10.4 Test 4: Replayed Nonce Returns 403

```bash
#!/bin/bash
# Test: Nonce replay

# This test requires a valid signature; run through Worker
NONCE="test123replay"

echo "=== Test 4: Nonce Replay ==="
echo "First request (should succeed)..."
RESPONSE1=$(curl -s "${WORKER_URL}/api/gas?action=api_getEvents&_nonce=${NONCE}")

echo "Second request with same nonce (should fail)..."
RESPONSE2=$(curl -s "${WORKER_URL}/api/gas?action=api_getEvents&_nonce=${NONCE}")

if echo "$RESPONSE2" | grep -q "NONCE_REPLAYED"; then
    echo "RESULT: PASS - Replay detected"
else
    echo "RESULT: FAIL - Replay not detected"
fi
```

### 10.5 Test 5: Valid Signed Request Succeeds

```bash
#!/bin/bash
# Test: Valid signed request through Worker

echo "=== Test 5: Valid Signed Request ==="
RESPONSE=$(curl -s "${WORKER_URL}/api/gas?action=api_getStatus")
echo "Response: $RESPONSE"

if echo "$RESPONSE" | grep -q '"ok":true\|"status":"ok"'; then
    echo "RESULT: PASS - Valid request succeeded"
else
    echo "RESULT: WARNING - Check response format"
fi
```

---

## 11. Acceptance Criteria

### 11.1 Primary Acceptance Criteria

| ID | Criterion | Verification | Status |
|----|-----------|--------------|--------|
| **AC-1** | Direct GAS URL access returns 401 or 403 | Test 10.1 | |
| **AC-2** | Expired signatures (>5 min) are rejected | Test 10.2 | |
| **AC-3** | Invalid signatures are rejected | Test 10.3 | |
| **AC-4** | Replayed nonces are rejected (when nonce provided) | Test 10.4 | |
| **AC-5** | Valid edge-signed requests succeed | Test 10.5 | |

### 11.2 Security Acceptance Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| **SEC-1** | Shared secret is at least 32 bytes | Configuration audit |
| **SEC-2** | Signature uses constant-time comparison | Code review |
| **SEC-3** | Nonce TTL exceeds timestamp window | CacheService TTL = 600s |
| **SEC-4** | Query parameters used (not headers) | Code review |

### 11.3 Documentation Criteria

| ID | Criterion | Location |
|----|-----------|----------|
| **DOC-1** | Query-signing scheme documented | Section 4 |
| **DOC-2** | Expiration window specified | Section 5 |
| **DOC-3** | Replay handling guidance provided | Section 6 |
| **DOC-4** | GAS validation code outlined | Section 7 |
| **DOC-5** | Worker signing code outlined | Section 8 |
| **DOC-6** | Header limitations explicitly stated | Section 9 |

---

## 12. Implementation Checklist

### 12.1 Worker Implementation

```
[ ] 1. Add GAS_EDGE_PROOF_SECRET to Cloudflare Secrets
[ ] 2. Add GAS_BASE_URL and GAS_SCRIPT_PATH to wrangler.toml
[ ] 3. Implement signGASRequest function
[ ] 4. Implement GAS proxy handler
[ ] 5. Add route for GAS proxy (e.g., /api/gas/*)
[ ] 6. Test signature generation
```

### 12.2 GAS Implementation

```
[ ] 1. Add validateEdgeProof function to Code.gs
[ ] 2. Add computeSignature function
[ ] 3. Add constantTimeEquals function
[ ] 4. Configure EDGE_PROOF_SECRET in Script Properties
[ ] 5. Integrate validation into doGet/doPost
[ ] 6. Deploy new version of GAS
[ ] 7. Test rejection of unsigned requests
```

### 12.3 Verification

```
[ ] 1. Run Test 10.1: Direct access rejected
[ ] 2. Run Test 10.2: Expired signature rejected
[ ] 3. Run Test 10.3: Invalid signature rejected
[ ] 4. Run Test 10.4: Replayed nonce rejected
[ ] 5. Run Test 10.5: Valid request succeeds
[ ] 6. Document test results
```

---

## 13. Related Documents

| Document | Path | Relationship |
|----------|------|--------------|
| Security Baseline | `docs/security/SECURITY_BASELINE.md` | Parent policy |
| Origin Bypass Prevention | `docs/security/ORIGIN_BYPASS_PREVENTION.md` | Sibling (SEC-8.1) |
| Service Auth Pattern | `docs/security/SERVICE_AUTH_PATTERN.md` | Related HMAC pattern |
| NO_GAS_GUARD | `docs/security/NO_GAS_GUARD.md` | GAS deprecation guard |
| Secrets Policy | `docs/security/SECRETS_POLICY.md` | Secret management |

---

## 14. Summary

| Aspect | Value |
|--------|-------|
| **Core Invariant** | Direct GAS URL access MUST return 401/403 |
| **Signing Method** | Query parameters (`_ts`, `_sig`, `_nonce`) |
| **Algorithm** | HMAC-SHA256 with Base64URL encoding |
| **Canonical String** | `v1|path|timestamp|action|nonce` |
| **Timestamp Window** | 5 minutes past, 1 minute future |
| **Replay Prevention** | Nonce storage in CacheService (600s TTL) |
| **Header Limitation** | Headers NOT recommended; use query params |
| **Primary AC** | Direct GAS URL access returns 401/403 |

---

## 15. Glossary

| Term | Definition |
|------|------------|
| **GAS** | Google Apps Script |
| **Edge Proof** | Cryptographic signature added by Worker at edge |
| **Canonical String** | Standardized string format for signature computation |
| **Base64URL** | URL-safe Base64 encoding (RFC 4648 §5) |
| **Nonce** | Number used once; prevents replay attacks |
| **CacheService** | GAS built-in caching API |
| **PropertiesService** | GAS built-in key-value storage for secrets |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-8.2 GAS edge proof gate |
