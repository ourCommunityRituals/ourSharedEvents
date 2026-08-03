# Environment Matrix

Quick reference for deployment environments. This is the authoritative source for "what does staging vs prod actually mean?"

## TL;DR

| Env            | Public URL                        | GAS Project       | Cloudflare Env     | Deploy Command            |
| -------------- | --------------------------------- | ----------------- | ------------------ | ------------------------- |
| **Staging**    | `https://stg.oursharedevents.com` | Staging Script    | `[env.staging]`    | `npm run deploy:staging`  |
| **Production** | `https://www.oursharedevents.com` | Production Script | `[env.production]` | CI only (merge to `main`) |

## Environment Details

### Staging (`stg`)

| Property             | Value                                                           |
| -------------------- | --------------------------------------------------------------- |
| **URL**              | `https://stg.oursharedevents.com`                               |
| **API URL**          | `https://api-stg.oursharedevents.com`                           |
| **GAS Project**      | Staging Apps Script deployment                                  |
| **Cloudflare Env**   | `[env.staging]` in `wrangler.toml`                              |
| **Wrangler Command** | `wrangler deploy --env staging`                                 |
| **Purpose**          | Safe sandbox for testing, destructive tests, schema experiments |
| **Who Can Deploy**   | Developers, CI                                                  |
| **Test Default**     | Yes - all `npm run test:*` commands target staging by default   |

### Production (`prod`)

| Property             | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **URL**              | `https://www.oursharedevents.com` / `https://oursharedevents.com` |
| **API URL**          | `https://api.oursharedevents.com`                                 |
| **GAS Project**      | Production Apps Script deployment                                 |
| **Cloudflare Env**   | `[env.production]` in `wrangler.toml`                             |
| **Wrangler Command** | `wrangler deploy --env production`                                |
| **Purpose**          | Customer-facing live application                                  |
| **Who Can Deploy**   | **CI ONLY** - no manual deployments                               |
| **Test Command**     | `npm run test:prod:*` (explicit only)                             |

## Cloudflare Worker Environments

The `cloudflare-proxy/wrangler.toml` defines these environments:

| Wrangler Env       | Worker Name               | Routes                                                                            | Purpose                        |
| ------------------ | ------------------------- | --------------------------------------------------------------------------------- | ------------------------------ |
| `[env.staging]`    | `oursharedevents-staging` | `stg.oursharedevents.com/*`, `api-stg.oursharedevents.com/*`                      | Staging proxy                  |
| `[env.production]` | `oursharedevents-prod`    | `oursharedevents.com/*`, `www.oursharedevents.com/*`, `api.oursharedevents.com/*` | Production proxy               |
| `[env.events]`     | `oursharedevents-events`  | Friendly URL routes (`/events`, `/manage`, `/display`, etc.)                      | Legacy/alternative prod routes |

**Note:** `[env.production]` and `[env.events]` both point to the production GAS backend. Use `[env.production]` for full-site deployment.

## GAS Deployment Configuration

| Environment | Clasp Config          | Script ID Source            |
| ----------- | --------------------- | --------------------------- |
| Staging     | `.clasp-staging.json` | `STAGING_SCRIPT_ID` env var |
| Production  | `.clasp.json`         | `SCRIPT_ID` GitHub secret   |

## Test Environment Targeting

```bash
# Staging (default - safe sandbox)
npm run test:smoke              # -> stg.oursharedevents.com
npm run test:staging:smoke      # -> stg.oursharedevents.com (explicit)

# Production (explicit only)
npm run test:prod:smoke         # -> www.oursharedevents.com
USE_PRODUCTION=true npm test    # -> www.oursharedevents.com

# Custom target
BASE_URL="https://custom.example.com" npm run test:smoke
```

## Single Source of Truth

All environment URLs are defined in:

```
config/environments.js    # Canonical source
```

Key exports:

- `STAGING_URL = 'https://stg.oursharedevents.com'`
- `PRODUCTION_URL = 'https://www.oursharedevents.com'`

## Related Documentation

- [`DEPLOYMENT.md`](./DEPLOYMENT.md) - Full deployment runbook
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) - Extended deployment guide
- [`cloudflare-proxy/wrangler.toml`](./cloudflare-proxy/wrangler.toml) - Cloudflare Worker config
- [`config/environments.js`](./config/environments.js) - Environment URL definitions
