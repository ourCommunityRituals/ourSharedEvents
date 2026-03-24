# KV Templates Setup Guide

**Last Updated:** 2025-12-09
**Status:** Story 8 - Template serving infrastructure

---

## Overview

The Cloudflare Worker serves HTML templates from Cloudflare KV storage. This guide explains how to set up and manage the KV-based template system.

### Architecture

```
  User Request
       ↓
  Cloudflare Worker
       ↓
  getTemplate(name, env)
       ↓
  env.TEMPLATES_KV.get(name)
       ↓
  HTML Response
```

Templates are:
1. Bundled from GAS source files (`src/mvp/*.html`)
2. Uploaded to Cloudflare KV storage
3. Retrieved by the Worker at runtime
4. Rendered with runtime variables (brandId, scope, etc.)

---

## Quick Start

### One-Time Setup (per environment)

```bash
# 1. Create KV namespace for staging
cd cloudflare-proxy
wrangler kv:namespace create "TEMPLATES_KV" --env staging

# 2. Copy the namespace ID from the output and update wrangler.toml
# Look for: id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# 3. Repeat for production
wrangler kv:namespace create "TEMPLATES_KV" --env production
```

### Deploy Templates

```bash
# 1. Bundle templates from source
npm run bundle:templates

# 2. Upload to KV (staging)
npm run upload:templates:staging

# 3. Deploy the worker
cd cloudflare-proxy && wrangler deploy --env staging
```

---

## Detailed Setup

### Step 1: Create KV Namespace

```bash
cd cloudflare-proxy

# For staging
wrangler kv:namespace create "TEMPLATES_KV" --env staging
# Output: Created namespace with ID = "abc123..."

# For production
wrangler kv:namespace create "TEMPLATES_KV" --env production
# Output: Created namespace with ID = "def456..."
```

### Step 2: Configure wrangler.toml

Add the namespace IDs to `cloudflare-proxy/wrangler.toml`:

```toml
# For staging
[[env.staging.kv_namespaces]]
binding = "TEMPLATES_KV"
id = "abc123..."  # Replace with actual ID

# For production
[[env.production.kv_namespaces]]
binding = "TEMPLATES_KV"
id = "def456..."  # Replace with actual ID
```

### Step 3: Bundle Templates

```bash
# Generate bundled HTML files from GAS sources
npm run bundle:templates

# Verify bundles are valid
npm run bundle:templates:validate
```

This creates files in `cloudflare-proxy/templates/`:
- `public.html` - Public events view
- `admin.html` - Admin dashboard
- `display.html` - Display/kiosk mode
- `poster.html` - Poster generator
- `report.html` - Analytics reports
- `manifest.json` - Template metadata

### Step 4: Upload Templates

```bash
# Upload to staging
npm run upload:templates:staging

# Upload to production
npm run upload:templates:production

# Dry run (preview only)
node scripts/upload-templates-to-kv.js --env staging --dry-run
```

### Step 5: Deploy Worker

```bash
cd cloudflare-proxy

# Deploy to staging
wrangler deploy --env staging

# Deploy to production
wrangler deploy --env production
```

### Step 6: Verify

```bash
# Test staging
curl -I https://stg.eventangle.com/events

# Should return 200 OK, not 503

# Check template debug endpoint (staging only)
curl https://stg.eventangle.com/__debug/template/public
```

---

## Troubleshooting

### Error: Template not found (no KV)

**Symptom:** Logs show `[EventAngle] Template not found (no KV): public.html`

**Cause:** The `TEMPLATES_KV` binding is not configured in wrangler.toml

**Fix:**
1. Verify KV namespace exists: `wrangler kv:namespace list`
2. Check wrangler.toml has the correct namespace ID
3. Redeploy the worker

### Error: Template not found in KV storage

**Symptom:** Logs show `Template file 'public.html' not found in KV storage`

**Cause:** Templates were not uploaded to KV

**Fix:**
```bash
npm run bundle:templates
npm run upload:templates:staging  # or production
```

### Error: KV namespace not configured

**Symptom:** Upload script shows "KV namespace not configured for environment"

**Cause:** wrangler.toml has placeholder ID or missing config

**Fix:**
1. Create namespace: `wrangler kv:namespace create "TEMPLATES_KV" --env staging`
2. Copy the ID to wrangler.toml
3. Re-run upload

### Verifying KV Contents

```bash
# List all keys in the namespace
wrangler kv:key list --namespace-id=YOUR_NAMESPACE_ID

# Get a specific template
wrangler kv:key get "public.html" --namespace-id=YOUR_NAMESPACE_ID
```

---

## CI/CD Integration

Templates should be uploaded as part of the deployment pipeline:

```yaml
# Example GitHub Actions step
- name: Upload templates to KV
  run: |
    npm run bundle:templates
    npm run upload:templates:staging
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

---

## NPM Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run bundle:templates` | Bundle GAS templates to `cloudflare-proxy/templates/` |
| `npm run bundle:templates:check` | Verify bundles are up-to-date |
| `npm run bundle:templates:validate` | Validate bundled templates |
| `npm run upload:templates:staging` | Upload templates to staging KV |
| `npm run upload:templates:production` | Upload templates to production KV |

---

## Related Files

- `cloudflare-proxy/wrangler.toml` - KV namespace configuration
- `cloudflare-proxy/worker.js` - Template retrieval logic (`getTemplate()`)
- `scripts/bundle-worker-templates.js` - Template bundler
- `scripts/upload-templates-to-kv.js` - KV upload script
- `cloudflare-proxy/templates/` - Bundled template output
- `src/mvp/` - Source GAS templates
