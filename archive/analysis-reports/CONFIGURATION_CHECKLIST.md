# Configuration Checklist - Apps Script API Deployment

**Status:** Pre-deployment configuration verification
**Last Updated:** 2025-11-13
**Your Project:** mvp-event-toolkit
**Script ID:** `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`

---

## ✅ Quick Reference Links

Based on the URLs you provided:

| Resource | URL | Purpose |
|----------|-----|---------|
| **GitHub Secrets** | https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions | Configure deployment credentials |
| **GitHub Repo** | https://github.com/zeventbooks/MVP-EVENT-TOOLKIT | Monitor CI/CD runs |
| **Apps Script Project** | https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit | Edit code & view logs |
| **Live Web App** | https://script.google.com/macros/s/AKfycbxaTPh3FS4NHJblIcUrz4k01kWAdxsKzLNnYRf0TXe18lBditTm3hqbBoQ4ZxbGhhGuCA/exec | Current deployment |
| **Service Accounts** | https://console.cloud.google.com/iam-admin/serviceaccounts?project=mvp-event-toolkit | Manage service accounts |
| **IAM Permissions** | https://console.cloud.google.com/iam-admin/iam?project=mvp-event-toolkit | Project-level permissions |
| **Service Account Details** | https://console.cloud.google.com/iam-admin/serviceaccounts/details/117229303592824041396?project=mvp-event-toolkit | Specific SA: 117229303592824041396 |

---

## 🔍 Configuration Verification Checklist

### 1. Google Cloud Project Setup

#### 1.1 Apps Script API - **CRITICAL (Currently Blocking Deployment)**

- [ ] **Enable Apps Script API**
  - Go to: https://console.cloud.google.com/apis/library/script.googleapis.com?project=mvp-event-toolkit
  - Click: "ENABLE"
  - Wait: 2-5 minutes for propagation
  - **Status:** ❌ NOT ENABLED (based on error message)

#### 1.2 Required APIs

- [ ] Google Apps Script API (see 1.1 above)
- [ ] Google Sheets API (for spreadsheet integration)
  - URL: https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=mvp-event-toolkit
- [ ] Google Forms API (for forms integration)
  - URL: https://console.cloud.google.com/apis/library/forms.googleapis.com?project=mvp-event-toolkit

**How to verify:**
```bash
# Go to: APIs & Services → Enabled APIs & Services
# Or use this direct link:
https://console.cloud.google.com/apis/dashboard?project=mvp-event-toolkit
```

---

### 2. Service Account Configuration

Your service account ID: `117229303592824041396`

#### 2.1 Service Account Exists ✅

- [✅] Service account created
  - Verify at: https://console.cloud.google.com/iam-admin/serviceaccounts/details/117229303592824041396?project=mvp-event-toolkit

#### 2.2 Service Account Key

- [ ] **JSON key downloaded** (one-time setup)
  - You should have a file like: `mvp-event-toolkit-xxxxx.json`
  - **NEVER commit this to Git**

#### 2.3 Service Account Email

Expected format: `apps-script-deployer@mvp-event-toolkit.iam.gserviceaccount.com`

- [ ] Copy the email from: https://console.cloud.google.com/iam-admin/serviceaccounts/details/117229303592824041396?project=mvp-event-toolkit

---

### 3. Apps Script Project Configuration

#### 3.1 Link to Google Cloud Project

- [ ] **Apps Script linked to GCP project**
  - Open: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
  - Click: Project Settings (⚙️ icon)
  - Verify: "Google Cloud Platform (GCP) Project" shows `mvp-event-toolkit`
  - **Expected GCP Project Number:** You can find this at https://console.cloud.google.com/home/dashboard?project=mvp-event-toolkit

#### 3.2 Service Account Has Editor Access - **CRITICAL**

- [ ] **Grant service account access to Apps Script project**
  - Open: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
  - Click: "Share" (top right)
  - Add email: `apps-script-deployer@mvp-event-toolkit.iam.gserviceaccount.com`
  - Role: **Editor**
  - Uncheck: "Notify people"
  - Click: "Share"

**Verify it worked:**
- Service account email should appear in the Share dialog
- Role should be "Editor"

#### 3.3 Web App Deployment Settings

- [ ] **Check current deployment settings**
  - Open: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
  - Click: Deploy → Manage deployments
  - Verify settings:
    - Execute as: **User accessing the web app** (matches appsscript.json)
    - Who has access: **Anyone** (matches appsscript.json)

#### 3.4 OAuth Scopes (in appsscript.json)

Current scopes (verified in your code):
- ✅ `https://www.googleapis.com/auth/script.external_request`
- ✅ `https://www.googleapis.com/auth/spreadsheets`
- ✅ `https://www.googleapis.com/auth/forms`

---

### 4. GitHub Secrets Configuration

Go to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions

#### 4.1 Required Secrets

- [ ] **APPS_SCRIPT_SERVICE_ACCOUNT_JSON**
  - Name: Exactly `APPS_SCRIPT_SERVICE_ACCOUNT_JSON`
  - Value: Entire contents of your service account JSON key file
  - Format: Single line JSON (no pretty formatting, no newlines)
  - Example start: `{"type":"service_account","project_id":"mvp-event-toolkit",...`

- [ ] **SCRIPT_ID**
  - Name: Exactly `SCRIPT_ID`
  - Value: `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`

- [ ] **ADMIN_KEY_ROOT** (for E2E tests)
  - Name: `ADMIN_KEY_ROOT`
  - Value: Your root admin secret (from Config.gs line 17)
  - Used by: E2E tests after deployment

**How to verify:**
```bash
# You should see 3 secrets in the GitHub UI:
# 1. APPS_SCRIPT_SERVICE_ACCOUNT_JSON
# 2. SCRIPT_ID
# 3. ADMIN_KEY_ROOT
```

---

### 5. Local Configuration (Optional - for local testing)

#### 5.1 Environment Variables

If testing deployment locally:

```bash
# Set these in your terminal
export SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
export SCRIPT_ID='1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l'

# Then run
npm run deploy
```

#### 5.2 Dependencies Installed

- [ ] **Node.js 18+ installed**
  ```bash
  node --version  # Should be v18.x.x or higher
  ```

- [ ] **npm packages installed**
  ```bash
  npm install
  ```

---

## 🚨 Critical Issues Found

Based on your deployment error, here's what needs immediate attention:

### Issue #1: Apps Script API Not Enabled (BLOCKING)

**Error Message:**
```
User has not enabled the Apps Script API. Enable it by visiting
https://script.google.com/home/usersettings then retry.
```

**Fix:**
1. Go to: https://console.cloud.google.com/apis/library/script.googleapis.com?project=mvp-event-toolkit
2. Click: **"ENABLE"**
3. Wait: 2-5 minutes
4. Retry deployment

**Alternative (if above doesn't work):**
1. Go to: https://script.google.com/home/usersettings
2. Enable: "Google Apps Script API"
3. Wait: 2-5 minutes

---

## ✅ Post-Fix Verification Steps

After enabling the Apps Script API, verify everything works:

### Step 1: Test Locally (Optional)

```bash
# Set env vars
export SERVICE_ACCOUNT_JSON='<paste JSON here>'
export SCRIPT_ID='1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l'

# Run deployment
npm run deploy
```

**Expected output:**
```
🔐 Authenticating with service account...
✅ Authentication successful
🔍 Verifying Apps Script API access...
✅ Apps Script API is enabled and accessible
📂 Scanning project files...
📊 Found 31 files to deploy
📤 Uploading files to Apps Script...
✅ Uploaded 31 files successfully
🚀 Creating deployment...
✅ Deployment created successfully
```

### Step 2: Trigger GitHub Actions

```bash
# Push to main branch to trigger full deployment
git push origin main

# Or push to a claude/* branch for testing
git push origin claude/enable-apps-script-api-011CV56yaopDiFShzMmYNJDs
```

**Monitor at:**
- https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions

**Expected results:**
- ✅ Lint Code
- ✅ Unit Tests
- ✅ Contract Tests
- ✅ Deploy to Apps Script (main branch only)
- ✅ API Verification
- ✅ E2E Tests

---

## 📋 Security Checklist

- [ ] Service account JSON is stored ONLY in GitHub Secrets (not in code)
- [ ] No `.clasp.json` or `.clasprc.json` files in repository (verified: ✅ not present)
- [ ] Admin secrets in `Config.gs` have been changed from defaults
- [ ] Service account has minimum required permissions (Editor on Apps Script project only)

---

## 🔧 Troubleshooting Common Issues

### Issue: "Service account does not have permission"

**Fix:** Add service account as Editor to Apps Script project (Section 3.2)

### Issue: "Failed to parse SERVICE_ACCOUNT_JSON"

**Fix:** Ensure GitHub secret contains entire JSON on single line (no newlines)

### Issue: Deployment succeeds but tests fail

**Fix:** Verify `ADMIN_KEY_ROOT` secret matches value in `Config.gs`

### Issue: "Apps Script API has not been used in project"

**Fix:** Enable Apps Script API (Section 1.1) and wait 5 minutes

---

## 📚 Reference Documentation

- **Full Setup Guide:** `docs/APPS_SCRIPT_API_SETUP.md`
- **Migration Guide:** `docs/MIGRATION_TO_APPS_SCRIPT_API.md`
- **Quick Start:** `DEPLOYMENT_QUICK_START.md`
- **Deployment Flow:** `docs/DEPLOYMENT_FLOW.md`

---

## 🎯 Next Steps

### Immediate (Blocking Deployment):
1. ✅ Enable Apps Script API (Section 1.1)
2. ⏳ Wait 2-5 minutes for propagation
3. 🔄 Retry deployment

### Recommended (Before Production):
4. ✅ Verify service account has Editor access (Section 3.2)
5. ✅ Confirm all GitHub secrets are set (Section 4.1)
6. ✅ Change admin secrets in `Config.gs`
7. ✅ Test deployment locally (if possible)
8. ✅ Monitor GitHub Actions run

### Post-Deployment:
9. ✅ Verify web app URL works
10. ✅ Run E2E tests against deployed URL
11. ✅ Update `DEPLOYMENT_URLS.md` with new deployment info

---

**Questions?** See the troubleshooting guides or open an issue in the repository.
