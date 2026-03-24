# Staging Environment Setup Guide

This guide explains how to set up and configure the staging environment for the MVP Event Toolkit.

## Quick Start

```bash
# Check current staging status
npm run staging:status

# Configure staging (after creating GAS project)
npm run staging:configure -- --script-id=YOUR_ID --deployment-id=YOUR_ID

# Deploy to staging
npm run deploy:staging           # Deploy GAS code
npm run deploy:staging:worker    # Deploy Cloudflare worker

# Verify staging works
npm run staging:verify
```

## Overview

The staging environment provides a safe sandbox for:
- Destructive tests (load testing, chaos testing)
- Schema experiments and migrations
- Integration testing before production
- Pre-production validation

| Component | Staging | Production |
|-----------|---------|------------|
| URL | `https://stg.eventangle.com` | `https://www.eventangle.com` |
| API | `https://api-stg.eventangle.com` | `https://api.eventangle.com` |
| GAS Project | Separate Script ID | Production Script ID |
| Spreadsheets | Staging EVENTS/DIAG | Production EVENTS/DIAG |
| Cloudflare Env | `--env staging` | `--env events` |

---

## Step 1: Create Staging Google Apps Script Project

### 1.1 Create a New Apps Script Project

1. Go to [Google Apps Script](https://script.google.com)
2. Click **New project**
3. Name it: `MVP Event Toolkit - STAGING`

### 1.2 Create Staging Spreadsheets

Create two new Google Sheets for staging:

1. **STAGING_EVENTS** - Copy structure from production EVENTS sheet
2. **STAGING_DIAG** - Copy structure from production DIAG sheet

### 1.3 Get the Staging Script ID

1. In the Apps Script editor, go to **Project Settings** (gear icon)
2. Copy the **Script ID** (looks like: `1ABC...xyz`)
3. Update `.clasp-staging.json`:

```json
{
  "scriptId": "YOUR_STAGING_SCRIPT_ID_HERE",
  "rootDir": "./src/mvp"
}
```

### 1.4 Configure Staging GAS

Update the staging project's `Config.gs` to point to staging URLs:

```javascript
// In staging GAS project only:
const FRIENDLY_BASE_URL = 'https://stg.eventangle.com';
const BUILD_ID = 'staging-v1';
```

### 1.5 Deploy to Staging GAS

```bash
# Push code to staging GAS project
npm run deploy:staging

# Or manually:
cp .clasp-staging.json .clasp.json
clasp push
clasp deploy -d "Staging deployment"
git checkout .clasp.json  # Restore production clasp config
```

After deployment, note the **Deployment ID** (looks like: `AKfycbx...`).

---

## Step 2: Configure Cloudflare Worker for Staging

### 2.1 Update wrangler.toml

The staging routes are already configured in `cloudflare-proxy/wrangler.toml`. Update the deployment ID:

```toml
[env.staging.vars]
STAGING_DEPLOYMENT_ID = "YOUR_STAGING_DEPLOYMENT_ID_HERE"
GAS_DEPLOYMENT_BASE_URL = "https://script.google.com/macros/s/YOUR_STAGING_DEPLOYMENT_ID_HERE/exec"
DEPLOYMENT_ID = "YOUR_STAGING_DEPLOYMENT_ID_HERE"
```

### 2.2 Set Up DNS Records

In Cloudflare DNS for `eventangle.com`, add:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| CNAME | `stg` | `eventangle.workers.dev` | Proxied |
| CNAME | `api-stg` | `eventangle.workers.dev` | Proxied |

### 2.3 Deploy Staging Worker

```bash
npm run deploy:staging:worker
# Or: cd cloudflare-proxy && wrangler deploy --env staging
```

---

## Step 3: Configure CI/CD (GitHub Actions)

### 3.1 Add Repository Secrets

Add these secrets to your GitHub repository:

| Secret Name | Description |
|-------------|-------------|
| `STAGING_SCRIPT_ID` | Staging GAS Script ID |
| `STAGING_DEPLOYMENT_ID` | Staging GAS Deployment ID |
| `STAGING_OAUTH_CREDENTIALS` | OAuth credentials for staging GAS |

### 3.2 Environment Variables

For local development, create a `.env.staging` file:

```bash
# .env.staging
STAGING_SCRIPT_ID=1ABC...xyz
STAGING_DEPLOYMENT_ID=AKfycbx...
STAGING_URL=https://stg.eventangle.com
```

---

## Step 4: Verify Staging Setup

### 4.1 Test Staging URLs

```bash
# Health check
curl https://stg.eventangle.com/status

# Should return JSON with "ok": true
```

### 4.2 Run Tests Against Staging

```bash
# All test commands now default to staging
npm run test:smoke      # Tests stg.eventangle.com
npm run test:api        # API tests against staging
npm run ci:all          # Full CI gate against staging
```

### 4.3 Test Production (Explicit)

```bash
# Only when you need to verify production
npm run test:prod:smoke    # Tests www.eventangle.com
npm run test:prod:health   # Production health check
```

---

## Usage Guide

### For Daily Development

```bash
# Run tests (defaults to staging - safe)
npm run test:smoke

# Deploy changes to staging for team testing
npm run deploy:staging
npm run deploy:staging:worker
```

### For Pre-Production Validation

```bash
# Full staging gate before PR merge
npm run ci:all

# After PR merge, CI auto-deploys to production
# Then verify production:
npm run test:prod:smoke
```

### For Load Testing

```bash
# ALWAYS use staging for load tests
npm run test:load:smoke     # Safe - hits staging
npm run test:load:stress    # Safe - hits staging
```

---

## Troubleshooting

### "Staging URL not working"

1. Check DNS records in Cloudflare
2. Verify Worker is deployed: `wrangler tail --env staging`
3. Check deployment ID matches in wrangler.toml

### "Tests hitting production instead of staging"

1. Ensure `USE_PRODUCTION` is not set: `unset USE_PRODUCTION`
2. Check `BASE_URL` is not overriding: `unset BASE_URL`
3. Verify with: `npm run test:env:print`

### "Staging GAS deployment failed"

1. Verify `.clasp-staging.json` has correct Script ID
2. Check OAuth credentials: `npm run deploy:diagnose`
3. Try manual push: `cp .clasp-staging.json .clasp.json && clasp push`

---

## Architecture Diagram

```
                    ┌─────────────────────────────────────────┐
                    │         Developer Workstation           │
                    │                                         │
                    │  npm run test:*  ──► stg.eventangle.com │
                    │  npm run test:prod:* ► www.eventangle.com│
                    └─────────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
        ┌─────────────────────┐           ┌─────────────────────┐
        │   STAGING ENV       │           │   PRODUCTION ENV    │
        │                     │           │                     │
        │ stg.eventangle.com  │           │ www.eventangle.com  │
        │         │           │           │         │           │
        │         ▼           │           │         ▼           │
        │ Cloudflare Worker   │           │ Cloudflare Worker   │
        │   --env staging     │           │   --env events      │
        │         │           │           │         │           │
        │         ▼           │           │         ▼           │
        │ Staging GAS Project │           │ Prod GAS Project    │
        │         │           │           │         │           │
        │         ▼           │           │         ▼           │
        │ STAGING_EVENTS      │           │ EVENTS Spreadsheet  │
        │ STAGING_DIAG        │           │ DIAG Spreadsheet    │
        └─────────────────────┘           └─────────────────────┘
                                                    ▲
                                                    │
                                          ┌─────────────────┐
                                          │  GitHub Actions │
                                          │   (CI Only)     │
                                          └─────────────────┘
```

---

## Checklist

Use this checklist when setting up staging:

- [ ] Check current status: `npm run staging:status`
- [ ] Created staging GAS project in Google Apps Script
- [ ] Created STAGING_EVENTS and STAGING_DIAG spreadsheets
- [ ] Configured staging: `npm run staging:configure -- --script-id=... --deployment-id=...`
- [ ] Deployed to staging GAS: `npm run deploy:staging`
- [ ] Added DNS records in Cloudflare:
  - [ ] `stg` CNAME → `eventangle.workers.dev` (Proxied)
  - [ ] `api-stg` CNAME → `eventangle.workers.dev` (Proxied)
- [ ] Deployed staging Worker: `npm run deploy:staging:worker`
- [ ] Added GitHub secrets for staging (STAGING_SCRIPT_ID, STAGING_DEPLOYMENT_ID)
- [ ] Verified staging works: `npm run staging:verify`
- [ ] Ran tests against staging: `npm run test:smoke`

## Useful Commands

```bash
# Check staging configuration status
npm run staging:status

# Configure staging with your IDs
npm run staging:configure -- --script-id=YOUR_SCRIPT_ID --deployment-id=YOUR_DEPLOYMENT_ID

# Verify staging endpoint is working
npm run staging:verify

# Deploy GAS code to staging
npm run deploy:staging

# Deploy Cloudflare worker to staging
npm run deploy:staging:worker

# Run tests against staging
npm run test:staging:smoke
npm run test:staging:api

# Health check
curl https://stg.eventangle.com/status
```
