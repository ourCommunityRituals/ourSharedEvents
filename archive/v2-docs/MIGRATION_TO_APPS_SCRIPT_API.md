# Migration from Clasp to Apps Script API

**Status:** 🔄 In Progress
**Started:** 2025-01-XX
**Reason:** Eliminate OAuth credential issues and move to production-grade deployment

---

## Why We're Migrating

### Problems with Clasp
- ❌ User OAuth credentials expire randomly
- ❌ Multiple format versions causing confusion
- ❌ 200+ lines of credential validation logic in CI/CD
- ❌ Credential exposure security risks
- ❌ Not designed for automated deployments
- ❌ Ongoing maintenance burden

### Benefits of Apps Script API
- ✅ Service account authentication (never expires)
- ✅ Production-grade reliability
- ✅ 10 lines of clean deployment code
- ✅ Official Google API
- ✅ Better security
- ✅ Set it and forget it

---

## Migration Status

### ✅ Completed

1. **Deployment Script** (`scripts/deploy-apps-script.js`)
   - Uses googleapis library
   - Service account authentication
   - Automatic file discovery
   - Clean error handling
   - GitHub Actions integration

2. **Package.json Updates**
   - Added `googleapis` dependency
   - Updated `npm run deploy` to use new script
   - Kept `npm run deploy:clasp` as backup

3. **CI/CD Pipeline Updates** (`.github/workflows/ci.yml`)
   - Replaced 200+ lines of Clasp OAuth logic
   - Simple service account authentication
   - Clean secret validation
   - Better error messages

4. **Documentation**
   - Complete setup guide (`docs/APPS_SCRIPT_API_SETUP.md`)
   - Step-by-step service account creation
   - Troubleshooting section
   - Security best practices

### 🔄 In Progress

5. **Service Account Setup**
   - [ ] Create service account in Google Cloud Console
   - [ ] Download JSON key
   - [ ] Grant Editor access to Apps Script project
   - [ ] Add GitHub secrets

6. **Testing**
   - [ ] Local deployment test
   - [ ] CI/CD deployment test
   - [ ] Verify deployment URL
   - [ ] Run full test suite

### 📅 Pending

7. **Validation Period** (30 days)
   - Monitor deployments
   - Compare with Clasp (if running parallel)
   - Gather metrics

8. **Cleanup**
   - Remove Clasp dependencies
   - Delete `.clasprc.json`, `.clasp.json`
   - Remove Clasp-related scripts
   - Update documentation

---

## Quick Start: What You Need to Do

### Step 1: Install Dependencies

```bash
npm install
```

This installs the `googleapis` package.

### Step 2: Follow Setup Guide

**👉 Complete guide:** `docs/APPS_SCRIPT_API_SETUP.md`

**Quick version:**

1. Create service account in Google Cloud Console
2. Enable Apps Script API
3. Download JSON key
4. Grant service account Editor access to your Apps Script project
5. Add these GitHub secrets:
   - `APPS_SCRIPT_SERVICE_ACCOUNT_JSON` (the entire JSON file content)
   - `SCRIPT_ID` (your Apps Script project ID)

### Step 3: Test Locally

```bash
# Set environment variables
export SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
export SCRIPT_ID='your-script-id'

# Test deployment
npm run deploy
```

### Step 4: Push and Verify

```bash
# Commit changes (already done by Claude)
git push origin your-branch

# Watch GitHub Actions
# It will use the new deployment method automatically
```

---

## Comparison: Before vs After

### Before: Clasp Deployment (200+ lines)

```yaml
- name: Install Clasp
  run: npm install -g @google/clasp

- name: Write .clasprc.json
  run: |
    cat > ~/.clasprc.json << 'EOF'
    ${{ secrets.CLASPRC_JSON }}
    EOF

    # 150+ lines of format detection and validation
    # Multiple conditional branches
    # Complex OAuth token handling
    # Format conversion logic
    # ...

- name: Write .clasp.json
  run: ...

- name: Push to Apps Script
  run: clasp push --force

- name: Deploy
  run: clasp deploy ...
```

### After: Apps Script API (10 lines)

```yaml
- name: Deploy to Apps Script via API
  env:
    SERVICE_ACCOUNT_JSON: ${{ secrets.APPS_SCRIPT_SERVICE_ACCOUNT_JSON }}
    SCRIPT_ID: ${{ secrets.SCRIPT_ID }}
  run: npm run deploy
```

**Reduction:** 95% less code, 100% more reliable

---

## Rollback Plan

If you need to rollback to Clasp:

### Option 1: Use Backup Command

```bash
# New method (default)
npm run deploy

# Old method (backup)
npm run deploy:clasp
```

### Option 2: Revert Pipeline

1. The Clasp code is still in git history
2. Find commit before migration
3. Cherry-pick the old CI/CD deploy job
4. Restore `CLASPRC_JSON` secret

---

## Parallel Operation (Recommended for First Week)

You can run both deployment methods in parallel:

### Update CI/CD to Deploy with Both

```yaml
- name: Deploy via Apps Script API (Primary)
  env:
    SERVICE_ACCOUNT_JSON: ${{ secrets.APPS_SCRIPT_SERVICE_ACCOUNT_JSON }}
    SCRIPT_ID: ${{ secrets.SCRIPT_ID }}
  run: npm run deploy

- name: Deploy via Clasp (Backup - Optional)
  if: success() || failure()  # Run even if API fails
  run: |
    # ... clasp deployment logic
```

Compare the results and verify both produce the same deployment.

---

## Success Metrics

Track these to validate the migration:

### Reliability
- ✅ Zero OAuth-related failures
- ✅ Zero credential expiration issues
- ✅ Consistent deployment success rate

### Performance
- ⏱️ Deployment time (should be similar or faster)
- ⏱️ Pipeline execution time (should be faster - less validation)

### Maintainability
- 📉 CI/CD complexity reduced
- 📉 Troubleshooting time reduced
- 📉 Documentation burden reduced

---

## Timeline

| Week | Activity | Status |
|------|----------|--------|
| Week 1 | Implementation complete | ✅ Done |
| Week 1 | Service account setup | 🔄 In Progress |
| Week 1 | Local testing | ⏳ Pending |
| Week 1 | First CI/CD deployment | ⏳ Pending |
| Week 2-4 | Validation period | ⏳ Pending |
| Week 4 | Remove Clasp (optional) | ⏳ Pending |

---

## Common Issues and Solutions

### "Service account does not have permission"

**Fix:** Add service account as Editor to Apps Script project
- Apps Script → Share → Add service account email → Editor role

### "Apps Script API not enabled"

**Fix:** Enable in Google Cloud Console
- APIs & Services → Library → Search "Apps Script API" → Enable

### "No files found to deploy"

**Fix:** Run from project root directory where `Code.gs` exists

### CI/CD fails but local works

**Fix:** Verify GitHub secrets are set correctly
- Exact secret names required
- No extra spaces or newlines in JSON

---

## Questions?

**Setup Issues:** See `docs/APPS_SCRIPT_API_SETUP.md`
**Deployment Issues:** Check GitHub Actions logs for detailed errors
**General Questions:** Review this migration guide

---

## Next Steps

1. ✅ Code changes complete (done by Claude)
2. 🔄 **YOU:** Follow setup guide to create service account
3. 🔄 **YOU:** Add GitHub secrets
4. 🔄 **YOU:** Test local deployment
5. 🔄 **YOU:** Push code and verify CI/CD works
6. ⏳ Monitor for 30 days
7. ⏳ Remove Clasp completely (optional)

---

**Remember:** This migration solves the root cause of your deployment issues. No more OAuth headaches! 🎉
