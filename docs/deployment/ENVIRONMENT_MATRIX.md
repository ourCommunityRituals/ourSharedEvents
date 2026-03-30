# Environment Matrix

Quick reference for deployment environments. This is the authoritative source for "what does staging vs prod actually mean?"

## TL;DR

| Env | Public URL | GAS Project | Cloudflare Env | Deploy Command |
|-----|------------|-------------|----------------|----------------|
| **Staging** | `https://stg.eventangle.com` | Staging Script | `[env.staging]` | `npm run deploy:staging` |
| **Production** | `https://www.eventangle.com` | Production Script | `[env.production]` | CI only (merge to `main`) |

## Environment Details

### Staging (`stg`)

| Property | Value |
|----------|-------|
| **URL** | `https://stg.eventangle.com` |
| **API URL** | `https://api-stg.eventangle.com` |
| **GAS Project** | Staging Apps Script deployment |
| **Cloudflare Env** | `[env.staging]` in `wrangler.toml` |
| **Wrangler Command** | `wrangler deploy --env staging` |
| **Purpose** | Safe sandbox for testing, destructive tests, schema experiments |
| **Who Can Deploy** | Developers, CI |
| **Test Default** | Yes - all `npm run test:*` commands target staging by default |

### Production (`prod`)

| Property | Value |
|----------|-------|
| **URL** | `https://www.eventangle.com` / `https://eventangle.com` |
| **API URL** | `https://api.eventangle.com` |
| **GAS Project** | Production Apps Script deployment |
| **Cloudflare Env** | `[env.production]` in `wrangler.toml` |
| **Wrangler Command** | `wrangler deploy --env production` |
| **Purpose** | Customer-facing live application |
| **Who Can Deploy** | **CI ONLY** - no manual deployments |
| **Test Command** | `npm run test:prod:*` (explicit only) |

## Cloudflare Worker Environments

The `cloudflare-proxy/wrangler.toml` defines these environments:

| Wrangler Env | Worker Name | Routes | Purpose |
|--------------|-------------|--------|---------|
| `[env.staging]` | `eventangle-staging` | `stg.eventangle.com/*`, `api-stg.eventangle.com/*` | Staging proxy |
| `[env.production]` | `eventangle-prod` | `eventangle.com/*`, `www.eventangle.com/*`, `api.eventangle.com/*` | Production proxy |
| `[env.events]` | `eventangle-events` | Friendly URL routes (`/events`, `/manage`, `/display`, etc.) | Legacy/alternative prod routes |

**Note:** `[env.production]` and `[env.events]` both point to the production GAS backend. Use `[env.production]` for full-site deployment.

## GAS Deployment Configuration

| Environment | Clasp Config | Script ID Source |
|-------------|--------------|------------------|
| Staging | `.clasp-staging.json` | `STAGING_SCRIPT_ID` env var |
| Production | `.clasp.json` | `SCRIPT_ID` GitHub secret |

## Test Environment Targeting

```bash
# Staging (default - safe sandbox)
npm run test:smoke              # -> stg.eventangle.com
npm run test:staging:smoke      # -> stg.eventangle.com (explicit)

# Production (explicit only)
npm run test:prod:smoke         # -> www.eventangle.com
USE_PRODUCTION=true npm test    # -> www.eventangle.com

# Custom target
BASE_URL="https://custom.example.com" npm run test:smoke
```

## Single Source of Truth

All environment URLs are defined in:

```
config/environments.js    # Canonical source
```

Key exports:
- `STAGING_URL = 'https://stg.eventangle.com'`
- `PRODUCTION_URL = 'https://www.eventangle.com'`

## Related Documentation

- [`DEPLOYMENT.md`](./DEPLOYMENT.md) - Full deployment runbook
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) - Extended deployment guide
- [`cloudflare-proxy/wrangler.toml`](./cloudflare-proxy/wrangler.toml) - Cloudflare Worker config
- [`config/environments.js`](./config/environments.js) - Environment URL definitions
