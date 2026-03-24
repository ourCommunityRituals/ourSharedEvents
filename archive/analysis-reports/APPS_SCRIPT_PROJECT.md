# Apps Script Project Configuration

## Unified Deployment Target

**ALL code in this repository deploys to a SINGLE Google Apps Script project:**

```
Project ID: 1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l
Project Name: zeventbooks/mvp-event-toolkit
```

**Editor URL:**
https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit

---

## Why One Project?

This repository follows a **single-source-of-truth** deployment model:

- ✅ **One codebase** → One Apps Script project
- ✅ **One deployment pipeline** → Consistent releases
- ✅ **One configuration** → No project ID confusion
- ✅ **One version** → Easier debugging and rollback

---

## Deployment Methods

### 1. GitHub Actions (Recommended)

The CI/CD pipeline automatically deploys to this project when code is merged to `main`.

**Required GitHub Secret:**
```
SCRIPT_ID = 1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l
```

See: [GITHUB_ACTIONS_DEPLOYMENT.md](./GITHUB_ACTIONS_DEPLOYMENT.md)

### 2. Local Deployment with clasp

```bash
# 1. Login to Google (one-time)
npx clasp login

# 2. Create .clasp.json with project ID
echo '{"scriptId":"1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l","rootDir":"."}' > .clasp.json

# 3. Push code
npm run push

# 4. Deploy
npm run deploy
```

See: [DEPLOYMENT_QUICK_START.md](./DEPLOYMENT_QUICK_START.md)

### 3. Manual Copy-Paste

1. Open the [Apps Script Editor](https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit)
2. Copy file contents from this repository
3. Paste into corresponding files in the editor
4. Deploy as web app

See: [DEPLOYMENT.md](./DEPLOYMENT.md)

---

## Files Deployed to Apps Script

### Backend Code (.gs files)
- `Code.gs` - Main API logic, routing, request handling
- `Config.gs` - Multi-brand configuration, schemas, secrets

### Frontend HTML Templates
- `Admin.html` - Admin dashboard
- `Public.html` - Mobile-friendly event display
- `Display.html` - TV/large-screen display
- `Poster.html` - Print-optimized poster with QR codes
- `Test.html` - Testing/diagnostics page
- `Diagnostics.html` - Diagnostic test interface
- `Styles.html` - Shared CSS
- `Header.html` - Common header component
- `DesignAdapter.html` - Design system adapter
- `NUSDK.html` - Utility SDK library

### Configuration
- `appsscript.json` - Apps Script manifest (runtime, scopes, timezone)

---

## Project Settings

### OAuth Scopes Required

```json
{
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/spreadsheets"
  ]
}
```

### Web App Deployment Settings

⚠️ **CRITICAL:** These settings must be configured when creating a NEW deployment in the Apps Script UI.

- **Execute as:** Me (the script owner/deployer)
- **Who has access:** Anyone, even anonymous

**Why "Execute as: Me" is required:**
- Allows the script to access your spreadsheets and resources
- Runs with owner permissions (not visitor permissions)
- Enables anonymous access without requiring user authentication

**Why "Anyone, even anonymous" is required:**
- Allows access without Google login (no 302 redirects)
- Enables public API access for external integrations
- Matches the `"access": "ANYONE_ANONYMOUS"` setting in appsscript.json

**Note:** Simply updating `appsscript.json` does NOT change existing deployments. You must create a new deployment for settings to take effect.

---

## Security Notes

⚠️ **Before deploying to production:**

1. Update all `adminSecret` values in `Config.gs`
2. Never commit `.clasp.json` or `.clasprc.json` to version control
3. Rotate admin secrets periodically
4. Review brand configurations for production use

See: [SECURITY_SETUP.md](./SECURITY_SETUP.md)

---

## Verification

After deployment, verify the app is working:

```bash
# Run automated verification
./verify-deployment.sh <YOUR_DEPLOYMENT_URL>

# Or manually test:
curl https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?action=status
```

Expected response:
```json
{
  "ok": {
    "msg": "MVP Event Toolkit - OK",
    "brand": "root"
  }
}
```

---

## Getting the Deployment URL

### Via clasp CLI:
```bash
npx clasp deployments
```

### Via Script Editor:
1. Open [Apps Script Editor](https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit)
2. Click **Deploy** → **Manage deployments**
3. Copy the web app URL

### Via GitHub Actions:
The CI/CD pipeline outputs the deployment URL in the workflow logs.

---

## Troubleshooting

### "Script not found" error
- Verify you're using the correct project ID: `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`
- Check your Google account has access to this project

### "Unauthorized" error
- Run `npx clasp login` to authenticate
- Ensure your `.clasprc.json` has valid OAuth tokens

### Deployment fails in GitHub Actions
- Verify `SCRIPT_ID` secret is set correctly in GitHub repository settings
- Check `CLASPRC_JSON` secret contains valid credentials
- Review GitHub Actions logs for specific errors

---

## Migration Notes

If you previously used a different Apps Script project:

1. ✅ **Old Project ID:** `1KttRXT0Sq2663irNS0FlUi3mMkHL9QisErtY4pAqwtqPKH2ZuS7y_Upe` (zeventbook:: latest)
2. ✅ **Current/Unified Project ID:** `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l` (zeventbooks/mvp-event-toolkit)

**This repository has been fully migrated to use only the unified project ID.**

All deployment scripts, documentation, and GitHub Actions are configured for the unified project.

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│  UNIFIED APPS SCRIPT PROJECT                                │
├─────────────────────────────────────────────────────────────┤
│  Project ID:                                                │
│  1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l  │
│                                                             │
│  Editor:                                                    │
│  https://script.google.com/home/projects/[PROJECT_ID]/edit │
│                                                             │
│  Deployment Methods:                                        │
│  • GitHub Actions (automatic)                               │
│  • clasp CLI (npm run push)                                 │
│  • Manual copy-paste                                        │
│                                                             │
│  Verify Deployment:                                         │
│  ./verify-deployment.sh <URL>                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Related Documentation

- [DEPLOYMENT.md](./DEPLOYMENT.md) - Complete deployment guide
- [DEPLOYMENT_QUICK_START.md](./DEPLOYMENT_QUICK_START.md) - DevOps quick start
- [GITHUB_ACTIONS_DEPLOYMENT.md](./GITHUB_ACTIONS_DEPLOYMENT.md) - CI/CD setup
- [DEPLOYMENT_PIPELINE.md](./DEPLOYMENT_PIPELINE.md) - Pipeline architecture
- [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) - System architecture
- [SECURITY_SETUP.md](./SECURITY_SETUP.md) - Security configuration

---

**Last Updated:** 2025-11-10
**Repository:** https://github.com/zeventbooks/MVP-EVENT-TOOLKIT
