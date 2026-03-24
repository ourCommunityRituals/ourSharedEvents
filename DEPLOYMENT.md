# Deployment Runbook

A boring, step-by-step checklist for shipping a release.

> **CI-ONLY PRODUCTION POLICY**
>
> Production deployments MUST go through GitHub Actions. The steps in this
> runbook are for **verification and troubleshooting only** - not for manual
> production deployments. See [PRODUCTION_DEPLOYMENT_POLICY.md](./PRODUCTION_DEPLOYMENT_POLICY.md).
>
> **To deploy to production:** Create a PR to `main`, get it reviewed, merge it.
> CI will handle the rest.

---

## Environment Matrix: Dev → Staging → Prod

> **Quick reference:** See [ENVIRONMENT_MATRIX.md](./ENVIRONMENT_MATRIX.md) for the authoritative environment table.

| Environment | URL | GAS Project | Cloudflare Env | Who Can Deploy |
|-------------|-----|-------------|----------------|----------------|
| **Dev** | `http://localhost:3000` | Production (read-only) | N/A | Developers |
| **Staging** | `https://stg.eventangle.com` | Staging Script | `[env.staging]` | Developers, CI |
| **Production** | `https://www.eventangle.com` | Production Script | `[env.production]` | **CI ONLY** |

### Environment Configuration (Single Source of Truth)

All environment URLs and brand defaults are defined in:

```
config/environments.js    # Canonical source - all tests import from here
tests/config/environments.js    # Re-exports from canonical source
```

**Key URLs:**
- **Production**: `https://www.eventangle.com`
- **Staging**: `https://stg.eventangle.com`
- **QA**: `https://zeventbooks.com`
- **Local**: `http://localhost:3000`
- **GAS Direct**: `https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec`

**Brands (all environments):**
- `root` - Zeventbook (default)
- `abc` - American Bocce Co.
- `cbc` - Community Based Cricket
- `cbl` - Community Based League

### Key Principles

1. **All `npm run test:*` commands default to STAGING** - Safe sandbox for destructive tests
2. **Production testing requires explicit `test:prod:*`** - Prevents accidental prod load
3. **Only CI deploys to production** - Human error prevention
4. **Staging mirrors production** - Same routes, different GAS backend
5. **Single source of truth** - All URLs defined in `config/environments.js`

### How to Deploy to Each Environment

| Environment | Deploy Command | Notes |
|-------------|----------------|-------|
| **Staging GAS** | `npm run deploy:staging` | Uses `.clasp-staging.json` |
| **Staging Worker** | `npm run deploy:staging:worker` | `wrangler deploy --env staging` |
| **Production** | `git push origin main` (after PR) | **CI only - no manual deploy** |

---

## BASE_URL Configuration

The same test suite runs against different environments by changing `BASE_URL`.

### Quick Reference

```bash
# Test against STAGING (default - safe sandbox)
npm run test:smoke                    # Uses stg.eventangle.com by default
npm run test:staging:smoke            # Explicit staging

# Test against PRODUCTION (explicit only)
npm run test:prod:smoke               # Uses www.eventangle.com
USE_PRODUCTION=true npm run test:smoke

# Test against GAS directly (debugging)
BASE_URL="https://script.google.com/macros/s/XXX/exec" npm run test:smoke
```

### How It Works

- All API/E2E tests use `process.env.BASE_URL` (or config equivalent)
- **Default** `BASE_URL` → **Staging** (`stg.eventangle.com`) for safety
- `USE_PRODUCTION=true` or `test:prod:*` → Production (`www.eventangle.com`)
- Tests auto-detect environment type (GAS vs Cloudflare vs Staging)
- No code changes needed to switch targets

### Configuration

| File | Purpose |
|------|---------|
| `.clasp.json` | Production GAS project (CI only) |
| `.clasp-staging.json` | Staging GAS project |
| `cloudflare-proxy/wrangler.toml` | Worker routes for all environments |
| `tests/config/environments.js` | Environment detection logic |
| `tests/shared/config/test.config.js` | Test configuration using BASE_URL |

### Environment-Specific URLs

| Environment | Status Endpoint | Manage Endpoint |
|-------------|-----------------|-----------------|
| Staging | `https://stg.eventangle.com/status` | `https://stg.eventangle.com/manage` |
| Production | `https://www.eventangle.com/status` | `https://www.eventangle.com/manage` |

---

## 1. Pre-flight (Staging Gate)

**Before any deployment, run tests against STAGING:**

```bash
npm run ci:all  # Tests against stg.eventangle.com by default
```

**No green on staging, no deploy to prod.**

This unified gate runs all tests required for a release:
1. `test:schemas` — schema synchronization validation
2. `test:api-contracts` — explicit API contract validation
3. `test:smoke` — smoke tests (requires Playwright)
4. `test:negative` — negative/edge-case tests

If any test fails, the chain stops immediately.

### Production Validation (Post-Deploy)

After CI deploys to production, validate with explicit prod tests:

```bash
npm run test:prod:smoke   # Validates www.eventangle.com
npm run test:prod:health  # Quick health check
```

### Legacy Commands

For granular control, you can still run individual stages:

```bash
npm run test:ci:stage1   # Fast gate: lint + unit + contract
npm run test:ci:stage2   # E2E: API + frontend tests
```

---

## 2. Deploy to Apps Script

> **For Production:** Do NOT run this manually. Push to `main` and let CI deploy.
> The commands below are for **Dev/Stage environments only**.

```bash
npm run deploy  # Dev/Stage only - CI handles production
```

Watch for the deployment URL in the output. It looks like:

```
https://script.google.com/macros/s/AKfycbx.../exec
```

Copy the deployment ID (the `AKfycbx...` part) - you'll need it for step 4.

---

## 3. Verify GAS Deployment

Hit the exec URL directly to confirm the new build is live:

```
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?page=status&brand=root
```

Confirm:
- `"ok": true`
- `"buildId"` matches the version you just deployed (check `src/mvp/Config.gs` for BUILD_ID)

---

## 4. Update Cloudflare Worker

> **For Production:** CI automatically updates the Cloudflare Worker when deploying.
> Manual updates below are for **Dev/Stage or troubleshooting only**.

If the DEPLOYMENT_ID changed (it does on each deploy):

1. Edit `cloudflare-proxy/wrangler.toml`
2. Update `GAS_DEPLOYMENT_BASE_URL` in `[env.events.vars]`:

```toml
[env.events.vars]
# The full Google Apps Script exec URL - this is the production backend
GAS_DEPLOYMENT_BASE_URL = "https://script.google.com/macros/s/AKfycbx.../exec"
DEPLOYMENT_ID = "AKfycbx..."
```

3. Deploy the worker:

```bash
cd cloudflare-proxy && wrangler deploy --env events
```

**Important:** The `--env events` flag deploys to the production EventAngle routes:
- `eventangle.com/events*`
- `www.eventangle.com/events*`

All requests are proxied (not redirected), so `script.google.com` is never user-facing.

---

## 5. Verify eventangle.com

Hit these URLs in a browser to confirm the proxy is working:

**Page routes (HTML via proxy):**
- https://www.eventangle.com/events?page=admin - Admin panel
- https://www.eventangle.com/events?page=public - Public event listing
- https://www.eventangle.com/events?page=display - TV/kiosk display
- https://www.eventangle.com/events?page=poster - Printable poster
- https://www.eventangle.com/events?page=report - Analytics report
- https://www.eventangle.com/events?page=status&brand=root - Status/health

**Friendly URL routes:**
- https://www.eventangle.com/manage - Admin (via path)
- https://www.eventangle.com/display - Display (via path)
- https://www.eventangle.com/abc/events - Brand-specific public page

**Verify:** The browser address bar should always show `eventangle.com`, never `script.google.com`.

---

## 6. Run Smoke Tests

```bash
BASE_URL="https://www.eventangle.com/events" npm run test:health
BASE_URL="https://www.eventangle.com/events" npm run test:smoke
```

Both should pass. If they fail, check:
- DEPLOYMENT_ID mismatch between GAS and Cloudflare
- BUILD_ID mismatch between deployed code and local Config.gs

---

## Quick Reference

| Step | Command | Environment |
|------|---------|-------------|
| **Deploy to Prod** | `git push origin main` (after PR merge) | **Production (CI only)** |
| Pre-flight (gate) | `npm run ci:all` | Staging (default) |
| Deploy GAS (staging) | `npm run deploy:staging` | Staging |
| Deploy CF Worker (staging) | `npm run deploy:staging:worker` | Staging |
| Deploy CF Worker (prod) | `npm run deploy:prod:worker` | Dev/Stage only |
| Health check (staging) | `npm run test:health` | Staging (default) |
| Health check (prod) | `npm run test:prod:health` | Production |
| Smoke test (staging) | `npm run test:smoke` | Staging (default) |
| Smoke test (prod) | `npm run test:prod:smoke` | Production |

---

## Rollback

If something goes wrong:

### Option 1: Git Revert (Preferred - Uses CI)

```bash
git revert HEAD
git push origin main
# CI will deploy the reverted version
```

### Option 2: Manual Rollback (Last Resort)

**Only if CI is completely broken:**

1. In Apps Script: Deploy > Manage deployments > select previous version
2. Update `DEPLOYMENT_ID` in `cloudflare-proxy/wrangler.toml` to the old ID
3. Redeploy: `cd cloudflare-proxy && wrangler deploy --env events`
4. **Document this in a GitHub issue immediately**
