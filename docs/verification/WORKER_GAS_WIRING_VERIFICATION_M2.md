# Story M2: Worker → GAS Wiring Verification Results

**Date:** 2025-12-11
**Status:** PARTIAL PASS - Error Handling Verified, Positive Test Blocked by M1
**Verified by:** Claude Code (automated test via curl)

---

## Executive Summary

| Aspect | Status | Details |
|--------|--------|---------|
| Worker Error Handling | **PASS** | Returns 502 + structured JSON for GAS errors |
| Negative Check | **PASS** | No HTML wrapped in 200/JSON |
| Positive Check | **BLOCKED** | GAS deployment has permission issues (M1 dependency) |
| Configuration Parity | **PASS** | `STAGING_WEB_APP_URL` is single source of truth |

---

## Configuration Verification

### Worker Environment Variables (wrangler.toml)

```toml
[env.staging.vars]
STAGING_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm/exec"
STAGING_DEPLOYMENT_ID = "AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm"
WORKER_ENV = "staging"
WORKER_BUILD_VERSION = "stg-2025.12.09"
```

### deploy-manifest.json (Single Source of Truth)

```json
{
  "staging": {
    "appsScript": {
      "webAppUrl": "https://script.google.com/macros/s/AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm/exec",
      "deploymentId": "AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm"
    }
  }
}
```

**Configuration Status:** ✅ URLs are consistent across all config files.

---

## Test 1: Worker RPC Endpoint (Positive Test)

### Test Command

```bash
curl -i -X POST 'https://stg.eventangle.com/api/rpc' \
  -H 'Content-Type: application/json' \
  -d '{"method":"api_list","payload":{"brandId":"root","scope":"events"}}'
```

### Worker Response

```http
HTTP/2 502
content-type: application/json
x-backend-status: 200
x-backend-duration-ms: 2670
x-error-corrid: err_20251211201851_48z25e
x-proxied-by: eventangle-worker
x-worker-build-version: stg-2025.12.09
x-worker-env: staging
x-worker-version: 2.6.0
```

**Response Body:**
```json
{
  "ok": false,
  "status": 502,
  "errorCode": "GAS_UPSTREAM_NON_JSON",
  "message": "Upstream Apps Script returned permission error (misconfiguration or auth required).",
  "corrId": "err_20251211201851_48z25e",
  "workerVersion": "2.6.0"
}
```

### Analysis

- **Status:** Blocked by M1 (GAS permissions issue)
- **Worker Behavior:** Correctly detected GAS returned HTML and converted to structured JSON error
- **Error Code:** `GAS_UPSTREAM_NON_JSON` - accurate diagnosis

---

## Test 2: Direct GAS Endpoint (Baseline)

### Test Command

```bash
curl -i -X POST 'https://script.google.com/macros/s/AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm/exec' \
  -H 'Content-Type: application/json' \
  -d '{"method":"api_list","payload":{"brandId":"root","scope":"events"}}'
```

### Direct GAS Response

```http
HTTP/2 200
content-type: text/html; charset=utf-8
```

**Response Body:**
```html
<!DOCTYPE html><html>...
You do not have permission to access the requested document.
...</html>
```

### Analysis

- **Status:** GAS returns permission error (M1 documented issue)
- **Content-Type:** `text/html` (not JSON)
- **HTTP Status:** 200 (misleading - GAS wraps errors)

---

## Test 3: Negative Check (Error Handling Verification)

### Requirement from Story M2

> "If you still see the permission HTML wrapped in 200/JSON, the Worker logic still sucks and needs fixing."

### Result: **PASS** ✅

| What Should Happen | What Actually Happens |
|--------------------|----------------------|
| 5xx status code | ✅ HTTP 502 Bad Gateway |
| Structured JSON error | ✅ JSON with `errorCode`, `message`, `corrId` |
| No HTML in response | ✅ Pure JSON, no HTML |
| Clear error indication | ✅ `GAS_UPSTREAM_NON_JSON` error code |

### Worker Error Handling Breakdown

The Worker code in `cloudflare-proxy/worker.js` correctly:

1. **Detects non-JSON responses** (lines 1407-1527 in `processUpstreamResponse()`)
2. **Returns structured error** with `GAS_ERROR_CODES.NON_JSON_RESPONSE`
3. **Sets 502 Bad Gateway** (not 200)
4. **Includes debugging headers**:
   - `x-backend-status: 200` (shows GAS returned 200)
   - `x-backend-duration-ms` (timing info)
   - `x-error-corrid` (correlation ID for debugging)

---

## Worker Transparency Headers

The Worker adds excellent debugging headers:

| Header | Value | Purpose |
|--------|-------|---------|
| `x-proxied-by` | `eventangle-worker` | Identifies proxy |
| `x-worker-version` | `2.6.0` | Worker code version |
| `x-worker-build-version` | `stg-2025.12.09` | Build timestamp |
| `x-worker-env` | `staging` | Environment identifier |
| `x-backend-status` | `200` | Original GAS status |
| `x-backend-duration-ms` | `2670` | Upstream latency |
| `x-proxy-duration-ms` | `2670` | Total proxy time |
| `x-error-corrid` | `err_...` | Error correlation ID |

---

## GAS URL Resolution Logic

The Worker uses `getGasUrl(env)` function with this priority:

```javascript
// For staging environment:
1. env.STAGING_WEB_APP_URL           // Primary - single source of truth
2. env.GAS_DEPLOYMENT_BASE_URL       // Legacy fallback
3. Constructed from STAGING_DEPLOYMENT_ID  // Last resort
```

**Current Resolution:** Uses `STAGING_WEB_APP_URL` ✅

---

## Exit Criteria Status

| Criteria | Status | Evidence |
|----------|--------|----------|
| Worker uses exact GAS deployment | ✅ PASS | URL matches deploy-manifest.json |
| Worker doesn't destroy response | ✅ PASS | Returns structured JSON error, not raw HTML |
| Correct config: Worker → GAS → JSON proven | ⏸️ BLOCKED | Requires M1 fix (GAS permissions) |
| Bad config: 5xx + structured JSON error | ✅ PASS | Returns 502 + JSON, not 200 + HTML |

---

## Dependency on Story M1

Story M2 cannot fully pass until Story M1 is completed:

### M1 Status (from GAS_BACKEND_VERIFICATION_M1.md)
- **Status:** FAILED - Permissions Issue
- **Root Cause:** GAS deployment has restricted access (not "Anyone")
- **Required Fix:** Create new GAS deployment with "Anyone" access

### Once M1 is Fixed

Re-run this test to verify positive case:

```bash
curl -i -X POST 'https://stg.eventangle.com/api/rpc' \
  -H 'Content-Type: application/json' \
  -d '{"method":"api_list","payload":{"brandId":"root","scope":"events"}}'
```

**Expected after M1 fix:**
- HTTP 200
- Content-Type: application/json
- Body: `{"ok": true, "data": {...events array...}}`

---

## Worker Code Quality Assessment

### Error Handling: EXCELLENT ✅

The Worker at `cloudflare-proxy/worker.js` demonstrates robust error handling:

1. **Non-JSON Detection** (line ~1470):
   - Checks `content-type` header for `text/html`
   - Parses response and validates JSON structure

2. **Error Codes** (line ~1075):
   ```javascript
   const GAS_ERROR_CODES = Object.freeze({
     NON_JSON_RESPONSE: 'GAS_UPSTREAM_NON_JSON',
     PARSE_ERROR: 'GAS_UPSTREAM_PARSE_ERROR',
     INVALID_SHAPE: 'GAS_UPSTREAM_INVALID_SHAPE',
     HTTP_ERROR: 'GAS_UPSTREAM_HTTP_ERROR',
     TIMEOUT: 'GAS_TIMEOUT',
     NETWORK_ERROR: 'GAS_NETWORK_ERROR',
     SERVICE_UNAVAILABLE: 'GAS_SERVICE_UNAVAILABLE'
   });
   ```

3. **Structured Error Response**:
   ```json
   {
     "ok": false,
     "status": 502,
     "errorCode": "GAS_UPSTREAM_NON_JSON",
     "message": "...",
     "corrId": "...",
     "workerVersion": "..."
   }
   ```

---

## Recommendations

1. **Priority:** Complete Story M1 (fix GAS permissions)
2. **After M1:** Re-run positive test to verify full wiring
3. **No Worker changes needed:** Error handling is working correctly

---

## Test Artifacts

### Timestamp
- Test run: 2025-12-11T20:18:48Z
- Worker version: 2.6.0
- Build version: stg-2025.12.09

### Correlation ID
- `err_20251211201851_48z25e`

---

## References

- Story M1 Documentation: `docs/GAS_BACKEND_VERIFICATION_M1.md`
- Worker Source: `cloudflare-proxy/worker.js`
- Configuration: `cloudflare-proxy/wrangler.toml`
- Manifest: `deploy-manifest.json`
- Staging URL: https://stg.eventangle.com
- Direct GAS URL: https://script.google.com/macros/s/AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm/exec
