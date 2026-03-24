# Project Configuration Reference

This document contains the project-specific configuration details for the MVP Event Toolkit.

## Google Cloud Project

**Project ID:** `zeventbooks`

**Service Accounts:** https://console.cloud.google.com/iam-admin/serviceaccounts?project=zeventbooks

## Apps Script Deployment Service Account

**Email:** `apps-script-deployer@zeventbooks.iam.gserviceaccount.com`

**Unique ID:** `103062520768864288562`

**Details:** https://console.cloud.google.com/iam-admin/serviceaccounts/details/103062520768864288562?project=zeventbooks

**Purpose:** Automated deployment to Apps Script via CI/CD

**Required Scopes:**
- `https://www.googleapis.com/auth/script.projects`
- `https://www.googleapis.com/auth/script.deployments`
- `https://www.googleapis.com/auth/script.webapp.deploy`

## Apps Script Project

**Project URL:** https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit

**Script ID:** `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`

**Deployment URL:** https://script.google.com/macros/s/AKfycbxaTPh3FS4NHJblIcUrz4k01kWAdxsKzLNnYRf0TXe18lBditTm3hqbBoQ4ZxbGhhGuCA/exec

**Access Control:**
- Service account `apps-script-deployer@zeventbooks.iam.gserviceaccount.com` must have **Editor** access
- Share the project with the service account email

## GitHub Repository

**Repository:** https://github.com/zeventbooks/MVP-EVENT-TOOLKIT

**Secrets Configuration:** https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions

**Required Secrets:**

1. **`APPS_SCRIPT_SERVICE_ACCOUNT_JSON`**
   - Complete JSON key file for the service account
   - Downloaded from Google Cloud Console when creating the service account key
   - Contains: `type`, `project_id`, `private_key_id`, `private_key`, `client_email`, etc.

2. **`SCRIPT_ID`**
   - Value: `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`
   - The Apps Script project identifier

3. **`ADMIN_KEY_ROOT`**
   - Admin API key for the root brand
   - Used in CI/CD testing

## Local Development

To test deployment locally:

```bash
# Set the service account JSON (get from Google Cloud Console)
export SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"zeventbooks",...}'

# Set the script ID
export SCRIPT_ID='1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l'

# Run diagnostics
npm run deploy:diagnose

# Deploy
npm run deploy
```

## Critical Setup Requirements

### 1. Apps Script API Enabled (GCP Console)

Go to: https://console.cloud.google.com/apis/library?project=zeventbooks

Search for "Apps Script API" and ensure it's **ENABLED**.

### 2. Apps Script API Enabled (User Settings)

**CRITICAL:** Project owner must visit: https://script.google.com/home/usersettings

Toggle ON: "Google Apps Script API"

This is **required** for service account deployments to work!

### 3. Service Account Has Editor Access

The service account email must be added as an Editor to the Apps Script project:

1. Open: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
2. Click "Share" (top right)
3. Add: `apps-script-deployer@zeventbooks.iam.gserviceaccount.com`
4. Role: **Editor**
5. Uncheck "Notify people"
6. Click "Share"

## Verification

To verify the configuration is correct:

```bash
npm run deploy:diagnose
```

This will check:
- ✅ Environment variables are set
- ✅ Service account authentication works
- ✅ Apps Script API is enabled (project level)
- ✅ Service account has access to the script
- ✅ Apps Script API is enabled (user level)

## Troubleshooting

If deployment fails, see:
- [Troubleshooting Guide](./TROUBLESHOOTING_APPS_SCRIPT.md)
- [Complete Setup Guide](./APPS_SCRIPT_API_SETUP.md)

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci.yml`) automatically:
1. Authenticates using the service account
2. Deploys to Apps Script
3. Runs tests against the deployed URL
4. Reports results

Workflow runs: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions

## Security Notes

- **Never commit** the service account JSON to git
- **Never expose** the `SCRIPT_ID` or `ADMIN_KEY_ROOT` in public logs
- Store all credentials in GitHub Secrets (encrypted at rest)
- Rotate service account keys every 90 days
- Monitor service account usage in Cloud Console
- Use principle of least privilege (Editor access only, not Owner)

## Contact

For access to the Google Cloud project or Apps Script project, contact the project owner.
