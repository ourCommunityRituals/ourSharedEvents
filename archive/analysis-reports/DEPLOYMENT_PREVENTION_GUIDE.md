# Deployment Error Prevention Guide

**How to Never Repeat the Same Deployment Errors Again**

This guide consolidates all lessons learned and creates a systematic approach to prevent deployment failures.

---

## 🎯 The #1 Rule: Follow the Checklist

**ALWAYS run before deploying:**

```bash
./scripts/verify-deployment-config.sh
```

This single command checks everything needed for successful deployment.

---

## 🚨 The Top 5 Deployment Killers (And How to Prevent Them)

### 1. Apps Script API User Setting is OFF ⚠️ MOST COMMON!

**Error Message:** "User has not enabled the Apps Script API"

**Root Cause:** The project owner hasn't enabled the API in their user settings

**Prevention:**
- [ ] **Bookmark this URL:** https://script.google.com/home/usersettings
- [ ] **Check monthly:** Verify "Google Apps Script API" is ON
- [ ] **Document:** Who is the project owner (must be them who enables it)
- [ ] **Alert:** If project ownership changes, new owner MUST enable this

**Quick Fix:**
1. Visit: https://script.google.com/home/usersettings
2. Toggle ON: "Google Apps Script API"
3. Wait 2-5 minutes
4. Retry deployment

---

### 2. Service Account Not Shared with Apps Script Project

**Error Message:** "Service account does not have permission" or "403 Forbidden"

**Root Cause:** Service account email not added to Apps Script project sharing

**Prevention:**
- [ ] **Add to calendar:** Check quarterly that service account still has access
- [ ] **Document:** Service account email in DEPLOYMENT_CONFIGURATION.md
- [ ] **Process:** If project is copied/duplicated, re-share with service account

**Quick Fix:**
1. Go to: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
2. Click "Share" (top right)
3. Add: `apps-script-deployer@zeventbooks.iam.gserviceaccount.com`
4. Role: **Editor**
5. Uncheck "Notify people"
6. Click "Share"

---

### 3. Missing or Invalid GitHub Secrets

**Error Message:** "APPS_SCRIPT_SERVICE_ACCOUNT_JSON is not set" or "Failed to parse"

**Root Cause:** GitHub secrets not configured or contain invalid JSON

**Prevention:**
- [ ] **Backup:** Keep service account JSON in secure password manager
- [ ] **Audit:** Check annually that secrets are still valid
- [ ] **Rotate:** Update service account key every 90 days (security best practice)
- [ ] **Test:** Run local deployment test when secrets are updated

**Quick Fix:**
1. Go to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions
2. Verify these secrets exist:
   - `APPS_SCRIPT_SERVICE_ACCOUNT_JSON` (JSON from GCP)
   - `SCRIPT_ID` (value: `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`)
   - `ADMIN_KEY_ROOT` (from Config.gs)
3. If missing, recreate them

---

### 4. Wrong Script ID

**Error Message:** "Apps Script project not found" or "404 Not Found"

**Root Cause:** Using wrong Script ID or project was deleted

**Prevention:**
- [ ] **Single source of truth:** DEPLOYMENT_CONFIGURATION.md contains THE definitive Script ID
- [ ] **Verify:** Before any deployment, check Script ID matches docs
- [ ] **Never hardcode:** Always read from configuration file

**Quick Fix:**
1. Verify Script ID: `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`
2. Update GitHub secret if wrong
3. Update DEPLOYMENT_CONFIGURATION.md if changed

---

### 5. Code Quality Issues (Tests Fail, Linting Errors)

**Error Message:** Various test failures or ESLint errors

**Root Cause:** Pushing code without running local tests

**Prevention:**
- [ ] **Git hook:** Set up pre-push hook to run tests automatically
- [ ] **CI/CD:** GitHub Actions will block deployment if tests fail
- [ ] **Local first:** Always run `npm test` and `npm run lint` before pushing

**Quick Fix:**
```bash
# Fix linting
npm run lint:fix

# Run tests
npm test

# If tests fail, fix the code then rerun
```

---

## 📋 Your Deployment Workflow (The Right Way)

### Phase 1: Development

```bash
# 1. Make your changes
# 2. Test as you go
npm test

# 3. Format code
npm run format

# 4. Lint code
npm run lint
```

### Phase 2: Pre-Deployment Verification

```bash
# Run the comprehensive verification script
./scripts/verify-deployment-config.sh
```

**This script checks:**
- ✅ Dependencies installed
- ✅ Project files exist
- ✅ Configuration IDs are correct
- ✅ GitHub workflow configured
- ✅ Documentation exists
- ✅ Tests can run

### Phase 3: Deploy

```bash
# For CI/CD (recommended)
git add .
git commit -m "feat: descriptive message"
git push origin main

# Monitor deployment
# https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions
```

### Phase 4: Post-Deployment Verification

```bash
# Test the production URL
curl "https://script.google.com/macros/s/AKfycbx6ZTFD8H3NiAlagCLHa9DPzhgxcqWRmGXGiXzzC8CTpRUBUY_YHhfKDzGCdgMkKMZNMA/exec?page=status"

# Should return JSON with status: "ok"
```

---

## 🛡️ Defense in Depth: Multiple Safety Layers

### Layer 1: Local Pre-Commit Checks

```bash
# Add to .git/hooks/pre-push (optional)
#!/bin/bash
npm test || exit 1
npm run lint || exit 1
echo "✅ Pre-push checks passed"
```

### Layer 2: Verification Script

```bash
# Run before every deployment
./scripts/verify-deployment-config.sh
```

### Layer 3: CI/CD Pipeline

GitHub Actions automatically runs:
1. Linting
2. Unit tests (94+ tests)
3. Contract tests
4. Deployment (only if tests pass)
5. E2E tests on deployed app

### Layer 4: Post-Deployment Monitoring

- [ ] Check GitHub Actions completion
- [ ] Test production URL
- [ ] Review Apps Script execution logs
- [ ] Monitor for errors in first 24 hours

---

## 📚 Documentation Index (Your Safety Net)

### Quick Reference (Start Here)
- **PRE_DEPLOY_CHECKLIST.md** - Checklist for every deployment
- **DEPLOYMENT_CONFIGURATION.md** - All IDs and URLs (single source of truth)

### Setup Guides
- **docs/APPS_SCRIPT_API_SETUP.md** - Complete setup instructions
- **GITHUB_ACTIONS_DEPLOYMENT.md** - CI/CD pipeline setup
- **DEPLOYMENT_QUICK_START.md** - Fast start guide

### Troubleshooting
- **docs/TROUBLESHOOTING_APPS_SCRIPT.md** - Common issues and fixes
- **This file (DEPLOYMENT_PREVENTION_GUIDE.md)** - How to prevent errors

---

## 🔄 Monthly Maintenance Checklist

**Set a recurring calendar reminder for the 1st of each month:**

- [ ] Verify Apps Script API user setting is still ON
- [ ] Check service account still has Editor access
- [ ] Verify GitHub secrets haven't expired
- [ ] Run full test suite: `npm run test:all`
- [ ] Check for dependency updates: `npm outdated`
- [ ] Review deployment logs for any issues
- [ ] Test backup deployment method (Clasp)

---

## 🚨 Emergency Procedures

### If Deployment Completely Breaks

1. **Stop the bleeding:**
   ```bash
   # Rollback immediately
   git revert HEAD
   git push origin main
   ```

2. **Diagnose:**
   ```bash
   # Run diagnostic
   export SCRIPT_ID='1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l'
   export SERVICE_ACCOUNT_JSON='<paste-json>'
   npm run deploy:diagnose
   ```

3. **Fix the root cause using diagnostic output**

4. **Test locally before redeploying:**
   ```bash
   npm test
   npm run deploy:diagnose
   ```

5. **Redeploy:**
   ```bash
   git push origin main
   ```

### If GitHub Actions is Down

Use manual deployment:

```bash
# Method 1: Service Account (preferred)
export SCRIPT_ID='1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l'
export SERVICE_ACCOUNT_JSON='<paste-json>'
npm run deploy

# Method 2: Clasp (backup)
clasp login
clasp push --force
clasp deploy --description "Emergency deploy"
```

---

## 📞 Emergency Contacts

| What's Broken | Who to Contact | What They Can Do |
|---------------|----------------|------------------|
| Apps Script API user setting | **Project Owner** | Enable at https://script.google.com/home/usersettings |
| Service account access | **GCP Admin** | Grant permissions in Cloud Console |
| GitHub secrets | **DevOps Lead** | Update repository secrets |
| Code issues | **Tech Lead** | Fix bugs and redeploy |
| Complete outage | **All of the above** | War room / all hands |

**Project Owner:** _____________________ (Email: __________________)
**GCP Admin:** _____________________ (Email: __________________)
**DevOps Lead:** _____________________ (Email: __________________)
**Tech Lead:** _____________________ (Email: __________________)

---

## 🎓 Lessons Learned Log

Keep track of issues and how they were resolved:

| Date | Issue | Root Cause | Solution | Prevention |
|------|-------|------------|----------|------------|
| 2025-11-13 | Initial setup | No systematic process | Created comprehensive docs | Follow checklist |
| | | | | |
| | | | | |

**Add to this table whenever something goes wrong!**

---

## ✅ Success Metrics

Track your deployment reliability:

- **Target:** 100% successful deployments
- **Current:** _____ / _____ successful (____%)
- **Mean Time to Deploy:** _____ minutes
- **Mean Time to Detect:** _____ minutes (if failure)
- **Mean Time to Recover:** _____ minutes (if failure)

**Goal:** With this systematic approach, you should achieve 100% deployment success rate.

---

## 🎯 The Golden Rules

1. **ALWAYS run verification script before deploying**
2. **NEVER skip tests**
3. **ALWAYS check Apps Script API user setting is ON**
4. **NEVER commit secrets to git**
5. **ALWAYS monitor deployment completion**
6. **NEVER deploy on Friday afternoon** (unless you enjoy weekend debugging 😉)
7. **ALWAYS keep DEPLOYMENT_CONFIGURATION.md updated**
8. **NEVER assume - verify!**

---

## 🚀 You're Now Ready!

With this systematic approach, you have:

- ✅ **Prevention:** Checklist to catch issues before they happen
- ✅ **Detection:** Verification script to validate configuration
- ✅ **Documentation:** Single source of truth for all IDs and URLs
- ✅ **Recovery:** Emergency procedures if something goes wrong
- ✅ **Learning:** Process to capture and prevent future issues

**Next Steps:**

1. Print out PRE_DEPLOY_CHECKLIST.md and keep it visible
2. Bookmark DEPLOYMENT_CONFIGURATION.md
3. Add monthly maintenance to your calendar
4. Do a test deployment to verify everything works
5. Sleep well knowing you have a robust process! 😊

---

**Remember:** The best way to fix deployment errors is to prevent them in the first place!
