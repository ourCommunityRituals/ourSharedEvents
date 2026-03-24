# DNS Cutover: Worker-Only Routing

## Story 5.2: DNS Cutover (stg + prod fully to Cloudflare)

This document describes the complete DNS cutover to route ALL eventangle.com traffic through the Cloudflare Worker, with NO GAS (Google Apps Script) backend calls.

## Status: COMPLETE ✅

As of Story 5.2, the DNS cutover is fully complete:
- **Staging** (`stg.eventangle.com`): BACKEND_MODE=worker
- **Production** (`eventangle.com`): BACKEND_MODE=worker
- **No script.google.com backend calls exist anywhere**

## Architecture

### Before Story 5.2
```
eventangle.com → Cloudflare Worker → GAS (for shortlinks, RPC)
                                   → Worker templates (HTML)
                                   → Google Sheets API (data)
```

### After Story 5.2 (CURRENT)
```
eventangle.com → Cloudflare Worker → Worker templates (HTML)
                                   → Google Sheets API (data)
                                   → Worker-native shortlinks (Sheets API)
                                   ✗ NO GAS calls anywhere
```

## Prerequisites

Before deploying Story 5.2 changes:

1. **Staging validation passes** - Stage-2 smoke tests must pass on staging
2. **Production parity confirmed** - Run `Prod Parity Check` workflow
3. **Secrets configured** - All production secrets must be set:
   - `GOOGLE_CLIENT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
   - `SHEETS_SPREADSHEET_ID`
   - `ADMIN_TOKEN`
4. **SHORTLINKS sheet exists** - Required for Worker-native shortlink resolution
5. **Rollback plan ready** - Review [ROLLBACK.md](./ROLLBACK.md)

## Cutover Process

### Step 1: Run Production Parity Check

1. Go to GitHub Actions → "Prod Parity Check" workflow
2. Click "Run workflow"
3. Wait for all checks to pass:
   - Staging baseline: PASSED
   - Production health: PASSED
   - API parity: PASSED
   - UI parity: PASSED

If any check fails, **DO NOT PROCEED**. Fix the issue first.

### Step 2: Verify Configuration

Confirm `BACKEND_MODE = "worker"` is set in `cloudflare-proxy/wrangler.toml`:

```toml
[env.production.vars]
BACKEND_MODE = "worker"
```

### Step 3: Deploy to Production

```bash
cd cloudflare-proxy
wrangler deploy --env production
```

Or trigger via CI/CD:
1. Merge to main branch
2. Stage-1 CI runs
3. Stage-2 validates staging
4. Approve production deployment
5. Production deploy executes

### Step 4: Verify Cutover

Run these verification commands:

```bash
# 1. Check Worker headers
curl -s -I https://www.eventangle.com/events | grep -iE "x-proxied-by|x-worker|x-backend"
# Expected: x-proxied-by: eventangle-worker

# 2. Check no GAS HTML leak (blue banner)
curl -s https://www.eventangle.com/events | grep -c "Google Apps Script user"
# Expected: 0

# 3. Check API status
curl -s https://www.eventangle.com/api/status | jq
# Expected: {"ok": true, "backendMode": "worker", ...}

# 4. Check events endpoint
curl -s https://www.eventangle.com/api/v2/events | jq '.ok'
# Expected: true

# 5. Run smoke tests
BASE_URL="https://www.eventangle.com" npm run test:api:smoke
```

### Step 5: Monitor

After cutover, monitor for:

- Error rate in Cloudflare dashboard
- Worker CPU/memory usage
- Response latency
- User reports

## What Changes (Story 5.2)

### All Routes Now Worker-Native

| Route | Implementation | Notes |
|-------|---------------|-------|
| `/events` | Worker template | Embedded HTML |
| `/admin` | Worker template | Embedded HTML |
| `/display` | Worker template | Embedded HTML |
| `/poster` | Worker template | Embedded HTML |
| `/report` | Worker template | Embedded HTML |
| `/api/v2/status` | Worker-native | Direct response |
| `/api/v2/events` | Worker → Sheets | Google Sheets API |
| `/api/v2/events/:id` | Worker → Sheets | Google Sheets API |
| `/api/v2/events/:id/bundle/*` | Worker → Sheets | Google Sheets API |
| `/r`, `/redirect` | **Worker → Sheets** | **NEW: Worker-native shortlinks** |
| `/api/rpc` | **410 Gone** | **DEPRECATED: Use /api/v2/* instead** |
| `/api/*` | **410 Gone** | **DEPRECATED: Use /api/v2/* instead** |

### No Routes Proxy to GAS

As of Story 5.2, **NO routes proxy to GAS**. All functionality is Worker-native:

- **Shortlinks**: Resolved via Worker reading SHORTLINKS sheet directly
- **Legacy RPC**: Returns 410 Gone with migration guidance to /api/v2/*
- **All HTML**: Served from embedded Worker templates
- **All API**: Worker-native using Google Sheets API

### GAS URLs Completely Unused

The following GAS URLs are **NO LONGER CALLED** by the Worker:

- ~~`script.google.com/macros/s/{DEPLOYMENT_ID}/exec?p=r&t=...`~~ → Worker-native
- ~~`script.google.com/macros/s/{DEPLOYMENT_ID}/exec` (RPC)~~ → 410 Gone

**GAS may still be accessible directly**, but is not used by any production system.

## Rollback

If issues occur after cutover:

### Quick Rollback (Worker Version)

```bash
npm run rollback:prod
```

### Backend Mode Rollback

To revert to GAS-first routing:

1. Edit `cloudflare-proxy/wrangler.toml`:
   ```toml
   [env.production.vars]
   BACKEND_MODE = "gas"  # or "mixed"
   ```

2. Deploy:
   ```bash
   cd cloudflare-proxy
   wrangler deploy --env production
   ```

3. Verify:
   ```bash
   curl -s https://www.eventangle.com/api/status | jq '.backendMode'
   # Expected: "gas" or "mixed"
   ```

## Backend Modes Reference

| Mode | Behavior | Use Case |
|------|----------|----------|
| `gas` | All routes use GAS | Emergency rollback |
| `mixed` | Per-route selection | Gradual migration |
| `worker` | All routes use Worker | **Production (current)** |

## Troubleshooting

### GAS HTML Leak (Blue Banner)

If you see "Google Apps Script user" or a blue banner:

1. Check `BACKEND_MODE` is `worker`
2. Verify Worker templates are bundled correctly
3. Check for errors in Worker logs
4. Rollback if needed

### API Errors

If API endpoints return errors:

1. Check Cloudflare Worker logs
2. Verify secrets are configured (`GOOGLE_*`, `ADMIN_TOKEN`)
3. Check Google Sheets API quotas
4. Test with `?backend=gas` on staging to isolate issue

### Shortlinks Not Working

Shortlinks (`/r/...`) still require GAS:

1. Verify GAS deployment is still running
2. Check `PROD_WEB_APP_URL` is correct in wrangler.toml
3. Test shortlink resolution manually

## Related Documentation

- [ROLLBACK.md](./ROLLBACK.md) - Rollback procedures
- [worker-routing.md](./worker-routing.md) - Worker routing architecture
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment procedures
- [cloudflare-proxy/src/config/backendConfig.js](../cloudflare-proxy/src/config/backendConfig.js) - Backend routing logic

## Timeline

| Story | Event |
|-------|-------|
| Story 0.1 | Versioned backend routing introduced |
| Story 4.2 | Staging switched to mixed mode |
| Story 6.1 | Production DNS cutover to Worker-only (with GAS shortlink proxy) |
| **Story 5.2** | **Full DNS cutover - NO GAS backend calls anywhere** |
| | - Staging BACKEND_MODE=worker |
| | - Production BACKEND_MODE=worker |
| | - Worker-native shortlink resolution |
| | - Legacy /api/* deprecated (410 Gone) |
| Story 6.2+ | GAS code archival (no longer needed for runtime) |

## Acceptance Criteria (Story 5.2)

- ✅ `eventangle.com/*` routes through Worker
- ✅ `stg.eventangle.com/*` routes through Worker
- ✅ No `script.google.com` backend calls exist anywhere
- ✅ Shortlinks use Worker-native Sheets API
- ✅ Legacy API returns 410 Gone with migration guidance
