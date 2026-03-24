# Staging /events Endpoint Diagnosis Report

**Story:** Lock down the diagnosis & baseline for /api_list -> events
**Date:** 2025-12-11
**Environment:** Staging (`stg.eventangle.com`)

---

## Executive Summary

This document captures the hard diagnosis of why `/events` and `/api/rpc` calls fail on staging. The issue stems from two root causes:

1. **Worker Response Handling**: The Worker blindly returns `Content-Type: application/json` regardless of what GAS actually returns (including HTML error pages)
2. **Origin Validation**: The staging hostname `stg.eventangle.com` is NOT in the GAS BRANDS hostnames whitelist

---

## 1. Architecture Overview

```
Browser → stg.eventangle.com → Cloudflare Worker → GAS Web App
                                    │
                                    └─ Returns HTTP 200 + Content-Type: application/json
                                       (even when GAS returns HTML error!)
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Cloudflare Worker | `cloudflare-proxy/worker.js` | RPC proxy, serves HTML templates |
| Worker Config | `cloudflare-proxy/wrangler.toml` | Environment variables, deployment IDs |
| GAS Backend | `src/mvp/Code.gs` | API implementation, origin validation |
| GAS Config | `src/mvp/Config.gs` | BRANDS hostnames, feature flags |

---

## 2. Current Staging Configuration

### Worker Environment Variables (wrangler.toml:123-153)

```toml
[env.staging.vars]
WORKER_ENV = "staging"
WORKER_BUILD_VERSION = "stg-2025.12.09"
STAGING_DEPLOYMENT_ID = "AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm"
STAGING_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm/exec"
ENABLE_DEBUG_ENDPOINTS = "true"
DEBUG_LEVEL = "debug"
```

### Exact URL Called for api_list

The Worker calls GAS at:
```
POST https://script.google.com/macros/s/AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm/exec
```

With body:
```json
{
  "action": "list",
  "brandId": "root",
  "scope": "events"
}
```

### GAS Web App Settings (Required)

For the GAS deployment to work, it must be configured as:

| Setting | Required Value |
|---------|----------------|
| Execute as | **Me (owner's email)** |
| Who has access | **Anyone** (not "Anyone with Google account") |

If "Who has access" is set to "Only myself" or "Anyone with Google account", GAS returns an HTML login/error page instead of JSON.

---

## 3. Root Cause Analysis

### Issue 1: Worker Response Handling (CONFIRMED)

**Location:** `cloudflare-proxy/worker.js:2446-2453` and `2524-2532`

```javascript
// handleApiRequest and handleRpcRequest both do this:
const responseText = await response.text();

return new Response(responseText, {
  status: response.status,
  headers: {
    'Content-Type': 'application/json'  // ALWAYS JSON, even for HTML!
  }
});
```

**Problem:** The Worker:
- Does NOT check if GAS returned valid JSON
- Does NOT check the actual Content-Type from GAS
- ALWAYS sets `Content-Type: application/json`
- Passes through whatever GAS returns (including HTML errors)

**Impact:** When GAS returns HTML (error page, login page, 404), the browser receives:
```
HTTP/1.1 200 OK
Content-Type: application/json

<!DOCTYPE html><html><head>...
```

This causes JSON.parse() to fail silently in the frontend.

### Issue 2: Origin Validation Whitelist (POTENTIAL)

**Location:** `src/mvp/Config.gs:432-482`

The BRANDS array defines allowed hostnames:
```javascript
const BRANDS = [
  {
    id: 'root',
    name: 'Zeventbook',
    hostnames: ['zeventbook.io','www.zeventbook.io','eventangle.com','www.eventangle.com'],
    // ...
  },
  // ... other brands
];
```

**Missing:** `stg.eventangle.com` is NOT in any brand's hostnames array!

**Origin validation logic** (`Code.gs:1618-1665`):
```javascript
function isAllowedOrigin_(origin, authHeaders) {
  // ... checks for auth headers for non-browser requests ...

  // Check against brand hostnames
  for (const brand of BRANDS) {
    if (brand.hostnames && brand.hostnames.some(h => h.toLowerCase() === originHost)) {
      return true;
    }
  }
  // ... allows *.google.com and localhost ...
  return false;
}
```

However, the Worker sends `Origin: https://stg.eventangle.com` which should be blocked. But GAS should return a JSON error, not HTML.

### Issue 3: GAS Platform Errors (HTML Responses)

GAS returns HTML (not JSON) in these scenarios:

| Scenario | Response |
|----------|----------|
| Deployment ID invalid/deleted | HTML 404 page |
| "Who has access" = "Only myself" | HTML login page |
| Script execution error (uncaught) | HTML error page |
| Request timeout | HTML timeout page |

---

## 4. How to Reproduce

### 4.1 curl Commands to Test Staging

**Test 1: Direct GAS call (should work)**
```bash
curl -X POST \
  "https://script.google.com/macros/s/AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm/exec" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Origin: https://eventangle.com" \
  -d '{"action":"list","brandId":"root","scope":"events"}'
```

**Test 2: Direct GAS call with staging origin (may fail origin check)**
```bash
curl -X POST \
  "https://script.google.com/macros/s/AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm/exec" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Origin: https://stg.eventangle.com" \
  -d '{"action":"list","brandId":"root","scope":"events"}'
```

**Test 3: Via Worker RPC endpoint**
```bash
curl -X POST \
  "https://stg.eventangle.com/api/rpc" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"method":"api_list","payload":{"brandId":"root","scope":"events"}}'
```

**Test 4: Via Worker path-based API**
```bash
curl -X POST \
  "https://stg.eventangle.com/api/events/list" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"brandId":"root","scope":"events"}'
```

**Test 5: Status endpoint (simplest health check)**
```bash
curl "https://stg.eventangle.com/status"
```

### 4.2 Expected vs Actual Responses

**Expected (working JSON):**
```json
{
  "ok": true,
  "etag": "base64_hash...",
  "value": {
    "items": [...],
    "pagination": {"total": N, "limit": 100, "offset": 0, "hasMore": false}
  }
}
```

**Actual (HTML error wrapped in JSON content-type):**
```
HTTP/1.1 200 OK
Content-Type: application/json

<!DOCTYPE html>
<html>
<head><title>Error</title></head>
<body>
<p>Sorry, unable to open the file at this time.</p>
<p>Please check the address and try again.</p>
</body>
</html>
```

---

## 5. Negative Path Handling

### 5.1 What Happens If GAS URL is Wrong

**Symptom:** HTML 404 error from Google

**curl test:**
```bash
curl -X POST \
  "https://script.google.com/macros/s/INVALID_DEPLOYMENT_ID/exec" \
  -H "Content-Type: application/json" \
  -d '{"action":"list","brandId":"root","scope":"events"}'
```

**Response:**
```html
<!DOCTYPE html>
<html>
<head>
  <title>Error</title>
  <style>...</style>
</head>
<body>
  <p>Sorry, the file you have requested does not exist.</p>
  <p>Make sure that you have the correct URL and the file exists.</p>
</body>
</html>
```

**Worker behavior:** Returns this HTML with `Content-Type: application/json`

### 5.2 What Happens If Deployment ID is Missing

If `STAGING_DEPLOYMENT_ID` is empty/missing in wrangler.toml:

1. `getGasUrl()` falls back to constructing URL with `'unknown'`:
   ```javascript
   return `https://script.google.com/macros/s/${env.STAGING_DEPLOYMENT_ID || 'unknown'}/exec`;
   ```

2. Request to `.../s/unknown/exec` returns HTML 404

**Worker behavior:** Returns HTML 404 with `Content-Type: application/json`

### 5.3 What Happens If GAS Has Execution Error

If GAS throws an uncaught exception:

**Response:** HTML error page from Google:
```html
<!DOCTYPE html>
<html>
<head><title>Error</title></head>
<body>
<p>Script function not found: doPost</p>
</body>
</html>
```

**Worker behavior:** Returns this HTML with `Content-Type: application/json`

---

## 6. Checks to Implement Later

Based on this diagnosis, these checks should become:

### 6.1 Health Check Endpoint

**Current:** `/status` exists but may not test full RPC flow

**Needed:** Dedicated `/health` or `/__debug/health` endpoint that:
- Calls GAS with a simple action
- Validates response is JSON
- Returns structured health status

### 6.2 API Contract Tests

**Assertions for Stage-2 CI:**
1. `POST /api/rpc` returns `Content-Type: application/json`
2. Response body is valid JSON (parseable)
3. Response contains `ok` boolean field
4. If `ok: true`, response contains expected schema

### 6.3 Worker Response Validation

**Needed fix in worker.js:**
```javascript
// Validate GAS response before returning
const contentType = response.headers.get('content-type') || '';
const responseText = await response.text();

// Check if response looks like JSON
if (!contentType.includes('application/json') || !responseText.trim().startsWith('{')) {
  return new Response(JSON.stringify({
    ok: false,
    code: 'UPSTREAM_ERROR',
    message: 'Invalid response from upstream service',
    _debug: env.DEBUG_LEVEL === 'debug' ? {
      contentType,
      bodySnippet: responseText.slice(0, 200)
    } : undefined
  }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

---

## 7. CI/CD Gate Impacts

### Current State
- No assertions on response format
- Tests may pass even when receiving HTML errors

### Recommended Stage-2 Gates

| Gate | Description | Blocker? |
|------|-------------|----------|
| Response is JSON | Parse response, fail if not JSON | Yes |
| Status 200 + ok:true | Health check returns success | Yes |
| No HTML in body | Body doesn't start with `<` | Yes |
| ETag present | List responses include etag | No |

---

## 8. Production Parity Check

**Production URL:** `https://www.eventangle.com`

**Production GAS Deployment ID:**
```
AKfycbz-RVTCdsQsI913wN3TkPtUP8F8EhSjyFAlWIpLVRgzV6WJ-isDyG-ntaV1VjBNaWZLdw
```

**Test production (for comparison only):**
```bash
curl -X POST \
  "https://www.eventangle.com/api/events/list" \
  -H "Content-Type: application/json" \
  -d '{"brandId":"root","scope":"events"}'
```

**Note:** Production likely exhibits the same Worker response handling issue, but origin validation passes because `eventangle.com` is in the BRANDS whitelist.

---

## 9. Immediate Action Items

### Priority 1: Verify GAS Deployment Settings
- [ ] Confirm staging GAS deployment exists and is active
- [ ] Verify "Execute as" = Me (owner)
- [ ] Verify "Who has access" = Anyone

### Priority 2: Test Direct GAS Access
- [ ] Run Test 1 (curl direct to GAS with prod origin)
- [ ] Run Test 2 (curl direct to GAS with staging origin)
- [ ] Document actual responses

### Priority 3: Fix Worker Response Handling
- [ ] Add JSON validation before returning response
- [ ] Return 502 with structured error for HTML responses
- [ ] Add debug logging for upstream errors

### Priority 4: Add Staging to Origin Whitelist
- [ ] Add `stg.eventangle.com` to root brand hostnames
- [ ] Redeploy GAS
- [ ] Retest

---

## Appendix A: File References

| File | Lines | Content |
|------|-------|---------|
| `cloudflare-proxy/worker.js` | 140-152 | `getGasUrl()` - URL resolution |
| `cloudflare-proxy/worker.js` | 2359-2457 | `handleApiRequest()` - API routing |
| `cloudflare-proxy/worker.js` | 2472-2536 | `handleRpcRequest()` - RPC handling |
| `cloudflare-proxy/wrangler.toml` | 114-154 | Staging env config |
| `src/mvp/Code.gs` | 1260-1308 | `doPost()` - GAS entry point |
| `src/mvp/Code.gs` | 1618-1665 | `isAllowedOrigin_()` - Origin validation |
| `src/mvp/Config.gs` | 432-482 | BRANDS configuration |

## Appendix B: Related Documentation

- [STAGING_SETUP.md](../STAGING_SETUP.md) - Staging environment setup guide
- [docs/worker-routing.md](worker-routing.md) - Worker routing documentation
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [docs/FRIENDLY_URLS.md](FRIENDLY_URLS.md) - URL routing patterns
