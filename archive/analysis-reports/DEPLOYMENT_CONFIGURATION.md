# Deployment Configuration - Single Source of Truth

**Last Updated:** 2025-11-13
**Status:** ✅ Active Configuration

> **Purpose:** This document contains ALL critical IDs, URLs, and configuration needed for deployment.
> **Keep this updated!** When anything changes, update this file immediately.

> **🆕 Setting up for the first time?** See [Google Cloud Secrets Setup Guide](GOOGLE_CLOUD_SECRETS_SETUP.md) for step-by-step instructions to configure GitHub Actions secrets.

---

## 📋 Quick Reference

| Component | Value |
|-----------|-------|
| **Apps Script Project ID** | `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l` |
| **Current Deployment ID** | `AKfycbx6ZTFD8H3NiAlagCLHa9DPzhgxcqWRmGXGiXzzC8CTpRUBUY_YHhfKDzGCdgMkKMZNMA` |
| **Production URL** | `https://script.google.com/macros/s/AKfycbx6ZTFD8H3NiAlagCLHa9DPzhgxcqWRmGXGiXzzC8CTpRUBUY_YHhfKDzGCdgMkKMZNMA/exec` |
| **Database Spreadsheet ID** | `1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ` |
| **GCP Project ID** | `zeventbooks` |
| **GCP Project Number** | `372175485955` |
| **Service Account Email** | `apps-script-deployer@zeventbooks.iam.gserviceaccount.com` |
| **Service Account ID** | `103062520768864288562` |

---

## 🔗 Important URLs

### Apps Script
- **Editor:** https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
- **Settings:** https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/settings
- **Deployments:** https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/deployments

### Google Cloud Console
- **Project Dashboard:** https://console.cloud.google.com/home/dashboard?project=zeventbooks
- **Service Accounts:** https://console.cloud.google.com/iam-admin/serviceaccounts?project=zeventbooks
- **APIs & Services:** https://console.cloud.google.com/apis/dashboard?project=zeventbooks
- **Apps Script API:** https://console.cloud.google.com/apis/api/script.googleapis.com?project=zeventbooks

### GitHub
- **Repository:** https://github.com/zeventbooks/MVP-EVENT-TOOLKIT
- **Actions:** https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions
- **Secrets:** https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions

### Spreadsheet Database
- **Database:** https://docs.google.com/spreadsheets/d/1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ/edit

---

## 🔐 Required GitHub Secrets

These MUST be set in GitHub repository settings for CI/CD to work:

### 1. APPS_SCRIPT_SERVICE_ACCOUNT_JSON
- **Type:** JSON (service account key)
- **Source:** Google Cloud Console → Service Accounts → Keys
- **How to get:**
  1. Go to https://console.cloud.google.com/iam-admin/serviceaccounts?project=zeventbooks
  2. Click `apps-script-deployer@zeventbooks.iam.gserviceaccount.com`
  3. Go to **KEYS** tab
  4. Click **ADD KEY** → **Create new key** → **JSON**
  5. Copy entire contents of downloaded file
  6. Paste as GitHub secret
- **Status:** ⚠️ VERIFY THIS IS SET

### 2. SCRIPT_ID
- **Value:** `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`
- **Status:** ✅ Known value

### 3. ADMIN_KEY_ROOT (for E2E tests)
- **Source:** Check `Config.gs` line 17
- **Security:** Never commit this to git!
- **Status:** ⚠️ VERIFY THIS IS SET

---

## ✅ Pre-Deployment Checklist

### One-Time Setup (Do Once)

- [ ] **Google Cloud Project configured**
  - [ ] Project: `zeventbooks` exists and is accessible
  - [ ] Apps Script API enabled in GCP Console
  - [ ] Service account `apps-script-deployer` created
  - [ ] Service account key downloaded (JSON)

- [ ] **Apps Script API - User Settings (CRITICAL!)**
  - [ ] Visit: https://script.google.com/home/usersettings
  - [ ] Toggle ON: "Google Apps Script API"
  - [ ] Verify: ✅ "Google Apps Script API: ON"
  - [ ] **⚠️ This must be done by the PROJECT OWNER**
  - [ ] **⚠️ Without this, ALL deployments will fail!**

- [ ] **Service Account Access to Apps Script**
  - [ ] Go to: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
  - [ ] Click "Share" (top right)
  - [ ] Add: `apps-script-deployer@zeventbooks.iam.gserviceaccount.com`
  - [ ] Role: **Editor**
  - [ ] Uncheck "Notify people"
  - [ ] Click "Share"

- [ ] **GitHub Secrets configured**
  - [ ] `APPS_SCRIPT_SERVICE_ACCOUNT_JSON` set
  - [ ] `SCRIPT_ID` set
  - [ ] `ADMIN_KEY_ROOT` set

### Before Each Deployment (Verify)

- [ ] All tests pass locally: `npm test`
- [ ] Linting passes: `npm run lint`
- [ ] Code formatted: `npm run format`
- [ ] Branch is up to date with main
- [ ] No sensitive data in code (secrets, API keys)

---

## 🚀 Deployment Methods

### Method 1: Automated CI/CD (Recommended)

```bash
# Push to main branch triggers automatic deployment
git push origin main
```

**What happens:**
1. ✅ Lint code
2. ✅ Run unit tests (94 tests)
3. ✅ Run contract tests
4. ✅ Deploy to Apps Script via API
5. ✅ Run E2E tests on deployed URL
6. ✅ Upload test reports

**Monitor:** https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions

### Method 2: Manual Deployment via API (Local)

```bash
# Set environment variables
export SCRIPT_ID='1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l'
export SERVICE_ACCOUNT_JSON='<paste service account JSON here>'

# Run deployment
npm run deploy
```

### Method 3: Clasp (Backup/Emergency)

```bash
# Login (first time only)
clasp login

# Push code
clasp push --force

# Deploy
clasp deploy --description "Emergency deploy $(date)"

# Get URL
clasp deployments
```

---

## 🔍 Diagnostic Commands

### Test Service Account Access

```bash
# Run comprehensive diagnostics
export SCRIPT_ID='1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l'
export SERVICE_ACCOUNT_JSON='<paste service account JSON here>'

npm run deploy:diagnose
```

**Checks:**
1. ✅ Environment variables are set
2. ✅ Service account authentication works
3. ✅ Apps Script API is enabled (project level)
4. ✅ Service account has access to the script
5. ✅ Apps Script API user setting is enabled (CRITICAL!)

### Test Production URL

```bash
# Health check
curl "https://script.google.com/macros/s/AKfycbx6ZTFD8H3NiAlagCLHa9DPzhgxcqWRmGXGiXzzC8CTpRUBUY_YHhfKDzGCdgMkKMZNMA/exec?page=status"

# Admin page (requires ADMIN_KEY)
curl "https://script.google.com/macros/s/AKfycbx6ZTFD8H3NiAlagCLHa9DPzhgxcqWRmGXGiXzzC8CTpRUBUY_YHhfKDzGCdgMkKMZNMA/exec?page=admin&brand=root&key=YOUR_ADMIN_KEY"
```

---

## 🐛 Common Issues & Solutions

### Issue 1: "User has not enabled the Apps Script API"

**Symptom:** Deployment fails with 403 error

**Root Cause:** Apps Script API not enabled in user settings (Step 1.4 in setup)

**Solution:**
1. **Project owner** must visit: https://script.google.com/home/usersettings
2. Toggle ON: "Google Apps Script API"
3. Wait 2-5 minutes
4. Retry deployment

**Prevention:**
- ✅ Verify user setting is ON before any deployment
- ✅ Document who the project owner is
- ✅ If project owner changes, new owner must enable this setting

### Issue 2: "Service account does not have permission"

**Symptom:** Cannot read/write to Apps Script project

**Root Cause:** Service account not added to Apps Script project sharing

**Solution:**
1. Go to: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
2. Click "Share"
3. Add: `apps-script-deployer@zeventbooks.iam.gserviceaccount.com` as **Editor**

**Prevention:**
- ✅ Keep service account in shared list
- ✅ Don't remove service account access
- ✅ If project is duplicated, re-share with service account

### Issue 3: GitHub Actions deployment fails

**Symptom:** CI/CD pipeline fails at deploy step

**Root Cause:** Missing or invalid GitHub secrets

**Solution:**
1. Check secrets: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions
2. Verify `APPS_SCRIPT_SERVICE_ACCOUNT_JSON` exists and is valid JSON
3. Verify `SCRIPT_ID` matches: `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`

**Prevention:**
- ✅ Test locally with `npm run deploy:diagnose` before pushing
- ✅ Keep service account key backed up securely (NOT in git)
- ✅ Rotate keys annually and update GitHub secret

### Issue 4: Deployment succeeds but URL returns 404

**Symptom:** Deployment completes but web app doesn't load

**Root Cause:** Deployment not set to "Execute as: Me" or "Who has access: Anyone"

**Solution:**
1. Go to: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/deployments
2. Click on active deployment
3. Verify settings:
   - Execute as: **Me** (project owner)
   - Who has access: **Anyone**

**Prevention:**
- ✅ Check deployment settings after first deployment
- ✅ Document correct settings in this file

---

## 📊 Monitoring & Maintenance

### Daily Checks
- [ ] Production URL responds: `curl <URL>?page=status`
- [ ] No errors in Apps Script logs

### Weekly Checks
- [ ] Run full test suite: `npm run test:all`
- [ ] Check GitHub Actions success rate
- [ ] Review error logs

### Monthly Checks
- [ ] Verify all GitHub secrets are still valid
- [ ] Test backup deployment method (Clasp)
- [ ] Review and update this document

### Quarterly Checks
- [ ] Rotate service account keys (security best practice)
- [ ] Audit service account permissions
- [ ] Review and test disaster recovery procedures

---

## 🔄 Rollback Procedures

### If bad deployment goes live:

**Option 1: Revert via GitHub**
```bash
# Revert the commit
git revert <bad-commit-sha>
git push origin main

# CI/CD will auto-deploy the reverted code
```

**Option 2: Redeploy previous version via Clasp**
```bash
# List deployments
clasp deployments

# Undeploy current
clasp undeploy <deployment-id>

# Redeploy previous version from Apps Script UI
# Go to: Deploy → Manage deployments → Click previous version
```

**Option 3: Manual rollback in Apps Script UI**
1. Go to: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/deployments
2. Find working version
3. Click "⋮" → "Test deployments"
4. Promote to production

---

## 📝 Change Log

Keep track of major changes to this configuration:

| Date | Change | Changed By | Reason |
|------|--------|------------|--------|
| 2025-11-13 | Initial configuration documented | System | Establish single source of truth |
| | | | |

---

## 🆘 Emergency Contacts

| Role | Contact | Responsibility |
|------|---------|----------------|
| Project Owner | _[Add name/email]_ | Apps Script API user settings |
| GCP Admin | _[Add name/email]_ | Service account management |
| DevOps Lead | _[Add name/email]_ | CI/CD pipeline |
| Tech Lead | _[Add name/email]_ | Code and architecture |

---

## 📚 Related Documentation

- **Setup Guide:** `docs/APPS_SCRIPT_API_SETUP.md` - Detailed setup instructions
- **Troubleshooting:** `docs/TROUBLESHOOTING_APPS_SCRIPT.md` - Common issues
- **GitHub Actions:** `GITHUB_ACTIONS_DEPLOYMENT.md` - CI/CD setup
- **Quick Start:** `DEPLOYMENT_QUICK_START.md` - Fast deployment guide
- **Architecture:** `ARCHITECTURE_REVIEW.md` - System overview

---

**⚠️ KEEP THIS FILE SECURE!**

This file contains sensitive IDs and URLs. Do not share publicly. Treat as confidential.

**✅ KEEP THIS FILE UPDATED!**

When any configuration changes, update this file immediately. This is your single source of truth!
