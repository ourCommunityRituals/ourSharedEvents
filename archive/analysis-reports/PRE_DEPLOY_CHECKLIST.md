# Pre-Deployment Checklist

**Print this out and check off before EVERY deployment!**

---

## 🚨 CRITICAL - ONE-TIME SETUP (Do Once, Verify Before First Deploy)

### Apps Script API - User Settings ⚠️ MOST COMMON FAILURE!

- [ ] **Go to:** https://script.google.com/home/usersettings
- [ ] **Verify:** ✅ "Google Apps Script API" is **ON**
- [ ] **Who:** Must be done by PROJECT OWNER
- [ ] **When last checked:** ________________

> ⚠️ If this is OFF, ALL deployments will fail with "User has not enabled API" error!

### Service Account Access to Apps Script

- [ ] **Go to:** https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
- [ ] **Click:** "Share" button (top right)
- [ ] **Verify:** `apps-script-deployer@zeventbooks.iam.gserviceaccount.com` is listed
- [ ] **Verify:** Role is "Editor"
- [ ] **When last checked:** ________________

### GitHub Secrets

- [ ] **Go to:** https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions
- [ ] **Verify:** `APPS_SCRIPT_SERVICE_ACCOUNT_JSON` exists
- [ ] **Verify:** `SCRIPT_ID` exists and equals `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`
- [ ] **Verify:** `ADMIN_KEY_ROOT` exists (for E2E tests)
- [ ] **When last checked:** ________________

---

## 📋 BEFORE EVERY DEPLOYMENT

### 1. Code Quality

```bash
# Run all checks
npm run lint          # ✅ Pass
npm test              # ✅ Pass
npm run format        # ✅ Run
```

- [ ] Linting passed (no errors)
- [ ] All tests passed (94+ tests)
- [ ] Code formatted

### 2. Configuration Verification

```bash
# Run verification script
./scripts/verify-deployment-config.sh
```

- [ ] Verification script passed
- [ ] No failed checks
- [ ] Warnings reviewed and acceptable

### 3. Git Status

```bash
git status
```

- [ ] All changes committed
- [ ] No sensitive data in code (API keys, passwords, secrets)
- [ ] Commit message is descriptive
- [ ] Branch is up to date with remote

### 4. Documentation

- [ ] Updated relevant documentation if features changed
- [ ] Updated DEPLOYMENT_CONFIGURATION.md if IDs changed
- [ ] Updated this checklist if process changed

---

## 🚀 DEPLOYMENT

### Option A: CI/CD (Recommended)

```bash
# Push to main to trigger automatic deployment
git push origin main
```

- [ ] Push completed successfully
- [ ] **Monitor:** https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions
- [ ] CI/CD pipeline started
- [ ] Watch for any failures

### Option B: Manual (Emergency/Testing)

```bash
# Set environment variables
export SCRIPT_ID='1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l'
export SERVICE_ACCOUNT_JSON='<paste-json-here>'

# Deploy
npm run deploy
```

- [ ] Environment variables set
- [ ] Deployment completed successfully
- [ ] Deployment URL received

---

## ✅ POST-DEPLOYMENT

### 1. Verify Deployment

```bash
# Test production URL
curl "https://script.google.com/macros/s/AKfycbx6ZTFD8H3NiAlagCLHa9DPzhgxcqWRmGXGiXzzC8CTpRUBUY_YHhfKDzGCdgMkKMZNMA/exec?page=status"
```

- [ ] Status endpoint returns 200 OK
- [ ] Response contains valid data

### 2. Smoke Tests

Open in browser and verify:

- [ ] **Status:** `?page=status` loads
- [ ] **Admin:** `?page=admin&brand=root` loads (with key)
- [ ] **Public:** `?p=events&brand=root` loads
- [ ] **Display:** `?page=display&brand=root&tv=1` loads
- [ ] **Poster:** `?page=poster&brand=root` loads

### 3. E2E Tests

- [ ] GitHub Actions E2E tests passed (if CI/CD)
- [ ] Or run manually: `npm run test:e2e`

### 4. Monitor

- [ ] Check Apps Script logs for errors: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/executions
- [ ] No unexpected errors in logs
- [ ] Performance is acceptable

---

## 🐛 IF DEPLOYMENT FAILS

### Common Failures & Quick Fixes

#### ❌ "User has not enabled the Apps Script API"

**Fix:**
1. Go to: https://script.google.com/home/usersettings
2. Toggle ON: "Google Apps Script API"
3. Wait 2-5 minutes
4. Retry deployment

#### ❌ "Service account does not have permission"

**Fix:**
1. Go to: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
2. Click "Share"
3. Add: `apps-script-deployer@zeventbooks.iam.gserviceaccount.com` as Editor

#### ❌ GitHub Actions fails

**Fix:**
1. Check logs: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions
2. Verify GitHub secrets are set correctly
3. Run locally: `npm run deploy:diagnose`

#### ❌ Deployment succeeds but URL returns 404

**Fix:**
1. Go to: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/deployments
2. Verify deployment settings:
   - Execute as: **Me** (project owner)
   - Who has access: **Anyone**

---

## 🔄 ROLLBACK (If bad deployment goes live)

### Quick Rollback

```bash
# Revert the commit
git revert <bad-commit-sha>
git push origin main
```

### Manual Rollback

1. Go to: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/deployments
2. Find previous working version
3. Click "⋮" → Promote to production

---

## 📝 DEPLOYMENT LOG

Keep track of deployments:

| Date | Version | Deployed By | Status | Notes |
|------|---------|-------------|--------|-------|
| YYYY-MM-DD | vX.X.X | Name | ✅/❌ | Description |
| | | | | |

---

## 🆘 EMERGENCY CONTACTS

| Issue Type | Contact | Action |
|------------|---------|--------|
| Apps Script API user setting | Project Owner | Enable at https://script.google.com/home/usersettings |
| Service account access | GCP Admin | Grant permissions |
| GitHub secrets | DevOps Lead | Update secrets |
| Code issues | Tech Lead | Fix and redeploy |

---

## 📚 REFERENCES

- **Full Config:** DEPLOYMENT_CONFIGURATION.md
- **Setup Guide:** docs/APPS_SCRIPT_API_SETUP.md
- **Troubleshooting:** docs/TROUBLESHOOTING_APPS_SCRIPT.md
- **CI/CD Guide:** GITHUB_ACTIONS_DEPLOYMENT.md

---

**💡 TIP:** Print this checklist and keep it handy. Check off items as you go!

**⚠️ REMEMBER:** The #1 cause of deployment failures is the Apps Script API user setting being OFF!
