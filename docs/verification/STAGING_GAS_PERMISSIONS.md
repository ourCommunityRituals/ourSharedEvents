# Staging GAS Web App Permissions

> **Story 2**: Fix GAS web app permissions for staging

This document describes how to configure Google Apps Script web app deployments
to accept HTTP requests from the Cloudflare Worker on staging.

## TL;DR

The GAS web app must be deployed with:
- **Execute as**: "Me" (the owner)
- **Who has access**: "Anyone" (not "Anyone with Google account")

## Problem Statement

When the Cloudflare Worker on `stg.eventangle.com` sends POST requests to the
GAS backend, the requests were being rejected with either:
- HTTP 403 (permission denied)
- HTML error page ("Sorry, unable to open the file")

## Root Cause

Two issues were preventing staging from working:

### 1. Origin Validation in Application Code

The `isAllowedOrigin_()` function in `Code.gs` validates the `Origin` header
against configured hostnames in the `BRANDS` array. The staging hostname
`stg.eventangle.com` was not in the list.

**Fix**: Added `stg.eventangle.com` and `api-stg.eventangle.com` to the root
brand's hostnames in `Config.gs`:

```javascript
hostnames: [
  'zeventbook.io',
  'www.zeventbook.io',
  'eventangle.com',
  'www.eventangle.com',
  'stg.eventangle.com',      // Added for staging
  'api-stg.eventangle.com'   // Added for staging API
]
```

### 2. Web App Deployment Permissions

When deploying a GAS web app, you must configure:

1. **Execute as**: Choose "Me" so the script runs with your permissions
2. **Who has access**: Choose "Anyone" to allow anonymous HTTP requests

If "Anyone with Google account" is selected, the Cloudflare Worker (which
doesn't have Google credentials) cannot access the API.

## Creating a New Staging Deployment

### Via Google Apps Script UI

1. Open the staging script: [Staging GAS Project](https://script.google.com/home/projects/1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ/edit)

2. Click **Deploy** > **New deployment**

3. Configure:
   - Type: **Web app**
   - Description: `Staging deployment YYYY-MM-DD`
   - Execute as: **Me** (your-email@gmail.com)
   - Who has access: **Anyone**

4. Click **Deploy**

5. Copy the deployment ID (starts with `AKfycb...`)

6. Update `wrangler.toml`:
   ```toml
   STAGING_DEPLOYMENT_ID = "AKfycb..."
   STAGING_WEB_APP_URL = "https://script.google.com/macros/s/AKfycb.../exec"
   ```

7. Deploy the Worker:
   ```bash
   wrangler deploy
   ```

### Via clasp CLI

```bash
# Push code changes
npm run push:staging

# Create new deployment
npm run deploy:staging

# The script will output the new deployment ID
# Update wrangler.toml with the new ID
```

## Environment Variable Configuration

The staging Worker uses these environment variables:

| Variable | Purpose | Status |
|----------|---------|--------|
| `STAGING_WEB_APP_URL` | Full GAS URL (single source of truth) | **Primary** |
| `STAGING_DEPLOYMENT_ID` | Deployment ID for reference | **Primary** |
| `GAS_DEPLOYMENT_BASE_URL` | Legacy alias | **Deprecated** |
| `DEPLOYMENT_ID` | Legacy alias | **Deprecated** |

**Important**: Always update `STAGING_WEB_APP_URL` when creating new deployments.

## Verification

After deployment, run the smoke test:

```bash
./scripts/check-staging-api-list-events.sh
```

Expected output:
- Test 1 (Direct GAS): HTTP 200, valid JSON with `ok: true`
- Test 2 (Worker proxy): HTTP 200, valid JSON with `ok: true`
- Test 3 (Invalid method): HTTP 200, JSON with `ok: false`

## Negative Path Handling

### Calling the Wrong (Old) Deployment

If the `STAGING_WEB_APP_URL` points to an old or invalid deployment ID:

```json
{
  "ok": false,
  "code": "INTERNAL",
  "message": "Script function not found: doPost"
}
```

Or you may get an HTML error page (not JSON).

### Calling with Invalid Method Name

```bash
curl -X POST https://stg.eventangle.com/api/rpc \
  -H "Content-Type: application/json" \
  -d '{"method":"api_nonexistent","payload":{}}'
```

Response:
```json
{
  "ok": false,
  "code": "BAD_INPUT",
  "message": "Unknown action: nonexistent"
}
```

### Calling from Unauthorized Origin

If a request comes from an origin not in the `BRANDS` hostnames list:

```json
{
  "ok": false,
  "code": "BAD_INPUT",
  "message": "Unauthorized origin or missing auth headers"
}
```

## Troubleshooting

### "Sorry, unable to open the file" Error

This HTML response means the deployment doesn't have "Anyone" access.
Create a new deployment with correct permissions.

### "Unauthorized origin" Error

The requesting hostname is not in `Config.gs` BRANDS hostnames array.
Add the hostname and redeploy.

### Worker Returns 503

Check that:
1. `STAGING_WEB_APP_URL` in `wrangler.toml` is correct
2. Worker is deployed: `wrangler deploy`
3. DNS is configured for `stg.eventangle.com`

### View Worker Logs

```bash
wrangler tail --env staging
```

## Related Documentation

- [DEPLOYMENT.md](./DEPLOYMENT.md) - General deployment guide
- [FRIENDLY_URLS.md](./FRIENDLY_URLS.md) - URL routing documentation
- [worker-routing.md](./worker-routing.md) - Worker routing details

## File Changes (Story 2)

| File | Change |
|------|--------|
| `src/mvp/Config.gs` | Added staging hostnames to BRANDS |
| `wrangler.toml` | Marked legacy env vars as deprecated |
| `cloudflare-proxy/wrangler.toml` | Marked legacy env vars as deprecated |
| `scripts/check-staging-api-list-events.sh` | New smoke test script |
| `docs/STAGING_GAS_PERMISSIONS.md` | This documentation |
