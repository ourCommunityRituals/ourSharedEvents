# Staging Backend Migration Guide

**Story:** 1.1.2 - Create new staging GAS backend owned by zeventbook
**Epic:** Backend Identity Consolidation
**Last Updated:** 2025-12-11
**Status:** PENDING USER ACTION

---

## Purpose

Replace the old "runs as mzdano" staging backend with a clean zeventbook-owned project to ensure proper identity consolidation.

---

## Prerequisites

Before starting, ensure you have:

- [ ] Access to `zeventbook@gmail.com` account
- [ ] Separate Chrome profile for zeventbook (recommended)
- [ ] clasp CLI installed (`npm install -g @google/clasp`)
- [ ] clasp logged in as zeventbook (`clasp login`)

---

## Deprecated Project (DO NOT USE)

| Property | Value |
|----------|-------|
| **Script ID** | `1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ` |
| **Former Owner** | `mzdano@gmail.com` |
| **Status** | **DEPRECATED** |

> **WARNING:** Do not deploy to this project. It is marked for deprecation.

---

## Migration Steps

### Step 1: Create New Apps Script Project

**Logged in as zeventbook (separate Chrome profile):**

1. Go to [Google Apps Script](https://script.google.com)
2. Click **New Project**
3. Rename project to: `EA-MVP-Backend-Staging`
4. Click **Project Settings** (gear icon)
5. Copy the **Script ID** (it looks like: `1abc...xyz`)
6. Verify **Owner** shows `zeventbook@gmail.com`

**Record the new Script ID:**
```
NEW_SCRIPT_ID: _________________________________
```

---

### Step 2: Copy Server Code

The source code is located in `src/mvp/`. Copy all `.gs` files:

**Option A: Using clasp (Recommended)**

```bash
# Navigate to project root
cd /path/to/MVP-EVENT-TOOLKIT

# Create a temporary clasp config with new script ID
echo '{
  "scriptId": "YOUR_NEW_SCRIPT_ID",
  "rootDir": "./src/mvp"
}' > .clasp.temp.json

# Push code to new project
clasp push --project .clasp.temp.json

# Clean up temp file
rm .clasp.temp.json
```

**Option B: Manual Copy**

Copy these files from `src/mvp/` to the new project:

| File | Description |
|------|-------------|
| `Code.gs` | Main application entry point |
| `Config.gs` | Configuration constants |
| `SecurityMiddleware.gs` | Security middleware |
| `SponsorService.gs` | Sponsor management |
| `TemplateService.gs` | Template handling |
| `FormService.gs` | Form processing |
| `SharedReporting.gs` | Reporting utilities |
| `AnalyticsService.gs` | Analytics |
| `ApiSchemas.gs` | API schemas |
| `DataHealthChecker.gs` | Data health checks |
| `AnalyticsRollup.gs` | Analytics rollup |
| `BackupService.gs` | Backup service |
| `DiagArchiver.gs` | Diagnostic archiver |
| `TemplateManagementService.gs` | Template management v2 |

Also copy HTML files:
- `Admin.html`
- `NUSDK.html`
- Other `.html` templates

---

### Step 3: Create Web App Deployment

1. In the new project, click **Deploy > New deployment**
2. Select type: **Web app**
3. Configure:
   - **Description**: `Staging Deployment - Story 1.1.2`
   - **Execute as**: `Me (zeventbook@gmail.com)`
   - **Who has access**: `Anyone`
4. Click **Deploy**
5. Copy the **Deployment ID** (starts with `AKfycb...`)

**Record the new Deployment ID:**
```
NEW_DEPLOYMENT_ID: _________________________________
```

---

### Step 4: Update Configuration Files

Update the following files with the new Script ID and Deployment ID:

#### 4.1 Update `.clasp-staging.json`

```json
{
  "scriptId": "YOUR_NEW_SCRIPT_ID",
  "rootDir": "./src/mvp",
  "_environment": "staging",
  "_comment": "NEW zeventbook-owned staging project (Story 1.1.2)",
  "_owner": "zeventbook@gmail.com",
  "_projectUrl": "https://script.google.com/home/projects/YOUR_NEW_SCRIPT_ID/edit",
  "_deploymentUrl": "https://stg.eventangle.com",
  "_story": "Story 1.1.2: Create new staging GAS backend owned by zeventbook"
}
```

#### 4.2 Update `.clasp.json` (default config)

```json
{
  "scriptId": "YOUR_NEW_SCRIPT_ID",
  "rootDir": "./src/mvp",
  "_environment": "staging",
  "_owner": "zeventbook@gmail.com"
}
```

#### 4.3 Update `deploy-manifest.json`

Update the `environments.staging.appsScript` section:

```json
{
  "appsScript": {
    "scriptId": "YOUR_NEW_SCRIPT_ID",
    "deploymentId": "YOUR_NEW_DEPLOYMENT_ID",
    "webAppUrl": "https://script.google.com/macros/s/YOUR_NEW_DEPLOYMENT_ID/exec",
    "editUrl": "https://script.google.com/u/1/home/projects/YOUR_NEW_SCRIPT_ID/edit",
    "_note": "Story 1.1.2: New zeventbook-owned staging project"
  }
}
```

#### 4.4 Update `config/deployment-ids.js`

```javascript
// STAGING - Story 1.1.2: New zeventbook-owned project
const STAGING_SCRIPT_ID = 'YOUR_NEW_SCRIPT_ID';
const STAGING_DEPLOYMENT_ID = 'YOUR_NEW_DEPLOYMENT_ID';
const STAGING_WEB_APP_URL = `https://script.google.com/macros/s/${STAGING_DEPLOYMENT_ID}/exec`;
const STAGING_GAS_EDIT_URL = `https://script.google.com/u/1/home/projects/${STAGING_SCRIPT_ID}/edit`;
```

---

### Step 5: Update Cloudflare Worker (if needed)

If the Cloudflare Worker references the deployment ID directly:

1. Update `cloudflare-proxy/wrangler.toml` with new `STAGING_DEPLOYMENT_ID`
2. Update `wrangler.toml` (root) if applicable
3. Redeploy the worker: `npm run deploy:worker:staging`

---

### Step 6: Update Documentation

Update `docs/env/gas-projects.md`:

1. Replace `PENDING_NEW_SCRIPTID` with actual Script ID
2. Replace `PENDING_NEW_DEPLOYMENT_ID` with actual Deployment ID
3. Update status from "PENDING" to "Correct"
4. Update the "Detailed Project Information" section

---

### Step 7: Verify Migration

Run verification commands:

```bash
# Check staging status
npm run staging:status

# Verify staging health
npm run staging:verify

# Test API endpoint
curl -s https://stg.eventangle.com/status | jq
```

---

### Step 8: Clean Up Old Project

**DO NOT DELETE the old project yet.** Instead:

1. Add a deprecation notice to the old project's description
2. Remove any active deployments from the old project
3. Keep for reference until production migration is complete

---

## Acceptance Criteria Checklist

- [ ] New project exists, owned by zeventbook@gmail.com
- [ ] All server code copied to new project
- [ ] Web app deployment created and working
- [ ] `.clasp-staging.json` updated with new scriptId
- [ ] `deploy-manifest.json` staging entry updated
- [ ] `config/deployment-ids.js` updated
- [ ] `docs/env/gas-projects.md` updated with new values
- [ ] Old mzdano scriptId explicitly marked as deprecated
- [ ] `stg.eventangle.com` serving from new backend
- [ ] `npm run staging:verify` passes

---

## Rollback Plan

If issues occur with the new staging backend:

1. Revert config files to use old Script ID
2. Old project remains functional (not deleted)
3. Investigate and resolve issues
4. Retry migration

---

## Files Modified by This Migration

| File | Change |
|------|--------|
| `.clasp.json` | New staging scriptId |
| `.clasp-staging.json` | New staging scriptId and deploymentId |
| `deploy-manifest.json` | New staging appsScript values |
| `config/deployment-ids.js` | New staging IDs |
| `docs/env/gas-projects.md` | Updated inventory and deprecated old project |
| `docs/env/staging-migration.md` | This migration guide |
| `cloudflare-proxy/wrangler.toml` | New deployment ID (if applicable) |

---

## Related Documentation

- [`gas-projects.md`](./gas-projects.md) - GAS Projects Inventory
- [`staging.md`](./staging.md) - Staging Environment Details
- [`../../APPS_SCRIPT_PROJECT.md`](../../APPS_SCRIPT_PROJECT.md) - Apps Script Project Overview
- [`../../STAGING_SETUP.md`](../../STAGING_SETUP.md) - Staging Setup Guide

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-12-11 | Initial migration guide created (Story 1.1.2) | Claude |
