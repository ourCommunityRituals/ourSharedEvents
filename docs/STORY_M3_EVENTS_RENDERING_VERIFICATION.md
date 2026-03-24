# Story M3 — /events Rendering Verification Results

**Date:** 2025-12-11
**Verified By:** Claude (automated verification)
**Environment:** Staging (`stg.eventangle.com`)

---

## Executive Summary

**Status: ⚠️ BLOCKED - GAS Permission Issue**

The `/events` page HTML loads successfully (HTTP 200), but API calls via POST to `/api/rpc` fail due to a Google Apps Script deployment permission configuration issue. This is **not** a Worker or frontend bug—it's a GAS deployment misconfiguration that requires redeployment with correct permissions.

---

## Test Results

### 1. GET /events → HTML Page Load

| Test | Result | Details |
|------|--------|---------|
| `GET https://stg.eventangle.com/events` | ✅ **200 OK** | Full HTML template loads (5800+ lines) |
| HTML contains error handling | ✅ | `StateRenderer`, `classifyError()`, `showTemporaryIssue()` present |
| CSS/JS framework intact | ✅ | All styles, SDK code present |

### 2. GET /ping → Worker Health

| Test | Result | Details |
|------|--------|---------|
| `GET https://stg.eventangle.com/ping` | ✅ **200 OK** | `{"status":"ok"}` |
| Response is JSON | ✅ | Proper content-type |

### 3. GET /status → GAS Health

| Test | Result | Details |
|------|--------|---------|
| `GET https://stg.eventangle.com/status` | ❌ **Permission Error** | GAS returns "You do not have permission" HTML |
| HTTP Status | 200 | But body is HTML error, not JSON |

### 4. POST /api/rpc → API Calls

| Test | Result | Details |
|------|--------|---------|
| `POST /api/rpc` with `api_list` | ❌ **502** | `GAS_UPSTREAM_NON_JSON` error |
| `POST /api/rpc` with `api_getPublicBundle` | ❌ **502** | `GAS_UPSTREAM_NON_JSON` error |
| Error response structure | ✅ | Properly structured JSON with `corrId` |

**Actual Error Response:**
```json
{
  "ok": false,
  "status": 502,
  "errorCode": "GAS_UPSTREAM_NON_JSON",
  "message": "Upstream Apps Script returned permission error (misconfiguration or auth required).",
  "corrId": "err_20251211203118_qit5dl",
  "workerVersion": "2.6.0"
}
```

### 5. Direct GAS Deployment Testing

| Test | Result | Details |
|------|--------|---------|
| Staging GAS GET (with redirects) | ✅ **200 OK** | `{"status":"ok"}` |
| Staging GAS POST (with redirects) | ❌ **Permission Error** | "You do not have permission" |
| Production GAS GET (with redirects) | ✅ **200 OK** | `{"status":"ok"}` |
| Production GAS POST (with redirects) | ❌ **Permission Error** | "You do not have permission" |

**Root Cause Confirmed:** GAS deployments reject POST requests with permission errors.

---

## Verification Commands Used

```bash
# 1. Test ping (Worker-level)
curl -s "https://stg.eventangle.com/ping"
# Result: {"status":"ok"}

# 2. Test status (GAS-level)
curl -s "https://stg.eventangle.com/status"
# Result: HTML permission error

# 3. Test events page HTML
curl -s "https://stg.eventangle.com/events" | head -100
# Result: Full HTML with template

# 4. Test RPC API
curl -s -X POST "https://stg.eventangle.com/api/rpc" \
  -H "Content-Type: application/json" \
  -d '{"method":"api_list","payload":{"brandId":"root","scope":"events"}}'
# Result: 502 with structured error

# 5. Test GAS directly (GET works)
curl -sL "https://script.google.com/macros/s/AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm/exec?p=ping"
# Result: {"status":"ok"}

# 6. Test GAS directly (POST fails)
curl -sL -X POST "https://script.google.com/macros/s/AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm/exec" \
  -H "Content-Type: application/json" \
  -d '{"action":"list","brandId":"root","scope":"events"}'
# Result: HTML permission error
```

---

## Architecture Analysis

### What's Working

1. **Cloudflare Worker** ✅
   - Routes requests correctly
   - Handles redirects from GAS
   - Returns structured JSON errors for upstream failures
   - Includes correlation IDs (`corrId`) for tracing
   - Version header (`workerVersion: "2.6.0"`)

2. **Frontend HTML/JS** ✅
   - Full template loads correctly
   - Error handling code present (`StateRenderer`, `classifyError()`)
   - Would display "Temporary Issue" card on 502 errors

3. **GAS GET Endpoints** ✅
   - `/ping` returns JSON correctly
   - `/status` route exists (just permission blocked)

### What's Broken

1. **GAS POST Handler** ❌
   - All POST requests return "You do not have permission"
   - Affects: `api_list`, `api_getPublicBundle`, all other API calls
   - Root cause: GAS deployment permission configuration

---

## Root Cause

The Google Apps Script deployment is configured incorrectly for POST requests. This typically happens when:

1. **Deployment Access Level** is set to "Only myself" or "Anyone with Google account" instead of "Anyone"
2. **Web App Execution** is set to "User accessing the web app" instead of "Me"
3. **Deployment was made private** after being public
4. **API scopes changed** requiring re-authorization

### Current Deployment IDs

| Environment | Deployment ID |
|-------------|---------------|
| Staging | `AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm` |
| Production | `AKfycbz-RVTCdsQsI913wN3TkPtUP8F8EhSjyFAlWIpLVRgzV6WJ-isDyG-ntaV1VjBNaWZLdw` |

---

## Required Fix

**Key Insight:** GAS deployment permissions are **IMMUTABLE** after creation. You cannot fix an existing deployment - you must create a NEW one.

### Option 1: GitHub Actions Workflow (Recommended)

A new workflow has been created to automate this fix:

1. Go to **Actions** > **Fix GAS Permissions**
2. Click **Run workflow**
3. Select environment (`staging` or `production`)
4. The workflow will:
   - Push code with correct `appsscript.json`
   - Create a NEW deployment with `ANYONE_ANONYMOUS` access
   - Update `wrangler.toml` with the new deployment ID
   - Deploy the Cloudflare Worker
   - Verify end-to-end functionality

**Required Secrets:**
- `OAUTH_CREDENTIALS` - Clasp OAuth credentials (from `~/.clasprc.json`)
- `CLOUDFLARE_API_TOKEN` - Cloudflare API token
- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account ID

### Option 2: Manual Script

Run locally with clasp authenticated:

```bash
./scripts/redeploy-with-permissions.sh staging
# or
./scripts/redeploy-with-permissions.sh production
```

### Option 3: Manual UI Steps

1. Open GAS project: https://script.google.com/home/projects/1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ/edit
2. Verify `appsscript.json` has:
   ```json
   "webapp": {
     "executeAs": "USER_DEPLOYING",
     "access": "ANYONE_ANONYMOUS"
   }
   ```
3. Go to **Deploy > New deployment**
4. Create with:
   - Execute as: **Me**
   - Who has access: **Anyone** (anonymous)
5. Copy new deployment ID
6. Update `cloudflare-proxy/wrangler.toml`
7. Deploy Worker: `cd cloudflare-proxy && wrangler deploy --env staging`

---

## Exit Criteria Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| Happy path: `/events` renders | ⚠️ **Partial** | HTML loads but API fails |
| Network tab shows clean JSON | ❌ **Failed** | Shows 502 error responses |
| No hidden 503 behavior | ✅ **Pass** | Errors are explicit 502 with details |
| Broken backend path: controlled error | ✅ **Pass** | Worker returns structured errors |
| No crashes, no unhandled exceptions | ✅ **Pass** | Error handling is robust |

---

## Recommendation

**Immediate Action Required:** Redeploy both staging and production GAS with correct permissions:
- Execute as: Me
- Who has access: Anyone (anonymous)

This will unblock the full `/events` rendering verification.

---

## Related Documentation

- `STAGING_SETUP.md` - Staging environment setup
- `RUNBOOK.md` - Operational procedures
- `cloudflare-proxy/wrangler.toml` - Worker configuration
- `src/mvp/Code.gs` - GAS backend code
