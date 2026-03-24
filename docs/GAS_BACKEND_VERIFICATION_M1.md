# Story M1: GAS Backend Verification Results

**Date:** 2025-12-11
**Status:** FAILED - Permissions Issue
**Verified by:** Claude Code (automated test)

---

## Test Summary

| Test | Result | Details |
|------|--------|---------|
| GAS URL Reachable | PASS | HTTP 200 returned |
| Content-Type JSON | FAIL | `text/html; charset=utf-8` |
| Valid JSON Body | FAIL | HTML error page returned |
| api_list Contract | FAIL | Permission denied |

---

## Staging GAS URL Tested

```
https://script.google.com/macros/s/AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm/exec
```

---

## Test Command

```bash
curl -i -X POST 'https://script.google.com/macros/s/AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm/exec' \
  -H 'Content-Type: application/json' \
  -d '{"method":"api_list","payload":{"brandId":"root","scope":"events"}}'
```

---

## Actual Response

**HTTP Status:** 200 (misleading - GAS wraps errors in 200)

**Content-Type:** `text/html; charset=utf-8`

**Body:**
```html
<!DOCTYPE html><html><head>...</head><body style="margin:20px">
<div><img alt="Google Apps Script" src="//ssl.gstatic.com/docs/script/images/logo.png"></div>
<div style="text-align:center;font-family:monospace;margin:50px auto 0;max-width:600px">
You do not have permission to access the requested document.
</div></body></html>
```

---

## Root Cause

The GAS web app deployment does NOT have "Anyone" access configured.

When a GAS web app is deployed with restricted access (e.g., "Anyone with Google Account" or "Only myself"), anonymous HTTP requests (like those from curl or Cloudflare Workers) are rejected with this HTML error page.

---

## Required Fix

A new GAS deployment must be created with correct permissions:

### Step 1: Open the Staging GAS Project

https://script.google.com/home/projects/1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ/edit

### Step 2: Create New Deployment

1. Click **Deploy** > **New deployment**
2. Configure:
   - Type: **Web app**
   - Description: `Staging deployment 2025-12-11 - Anyone access`
   - Execute as: **Me** (zeventbook@gmail.com)
   - Who has access: **Anyone** ← CRITICAL

3. Click **Deploy**

### Step 3: Copy New Deployment ID

The new deployment will have a URL like:
```
https://script.google.com/macros/s/AKfycb<NEW_ID>/exec
```

Copy the deployment ID (the `AKfycb...` part).

### Step 4: Update Configuration Files

Update these files with the new deployment ID:

1. `config/deployment-ids.js`
2. `cloudflare-proxy/wrangler.toml` → `STAGING_DEPLOYMENT_ID` and `STAGING_WEB_APP_URL`
3. `deploy-manifest.json` → staging section
4. `docs/env/staging.md`

### Step 5: Re-verify

```bash
curl -i -X POST 'https://script.google.com/macros/s/<NEW_DEPLOYMENT_ID>/exec' \
  -H 'Content-Type: application/json' \
  -d '{"method":"api_list","payload":{"brandId":"root","scope":"events"}}'
```

Expected:
- **Content-Type:** `application/json`
- **Body:** JSON with `ok: true` and events array

---

## Exit Criteria Status

| Criteria | Status |
|----------|--------|
| Confirmed-good GAS URL that returns JSON for api_list | NOT MET |
| URL documented with no ambiguity | PARTIAL - URL known but not working |
| Backend handshake is real | NOT MET |

---

## Next Steps

1. Human action required: Create new GAS deployment with "Anyone" access
2. Update configuration files with new deployment ID
3. Re-run this verification test
4. Once passing, proceed to Story M2

---

## Reference

- Staging GAS Project: https://script.google.com/home/projects/1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ/edit
- Script ID: `1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ`
- Current (broken) Deployment ID: `AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm`
- Owner: `zeventbook@gmail.com`
