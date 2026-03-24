# Deployment Quick Start Guide

**For DevOps Engineers** - Get the app from local code to production in minutes

---

## Prerequisites

1. **Node.js 18+** installed
2. **Google Apps Script project** created (ID: `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`)
3. **GitHub repository** with Actions enabled
4. **Admin secrets** changed in `Config.gs` (lines 17, 26, 35, 44)

---

## Local Setup (First Time)

```bash
# 1. Install dependencies
npm install

# 2. Install Clasp globally
npm install -g @google/clasp

# 3. Login to Google Apps Script
clasp login

# 4. Verify .clasp.json exists
cat .clasp.json
# Should show: { "scriptId": "1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l", "rootDir": "." }

# 5. Push code to Apps Script
clasp push

# 6. Deploy as web app
clasp deploy --description "Manual deploy $(date)"

# 7. Get deployment URL
clasp deployments
```

---

## Running Tests Locally

```bash
# Run unit tests
npm test

# Run with coverage
npm run test:coverage

# Run contract tests
npm run test:contract

# Run linter
npm run lint

# Format code
npm run format
```

---

## GitHub Actions Setup (CI/CD)

### 1. Add GitHub Secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `CLASPRC_JSON` | Contents of `~/.clasprc.json` | Clasp credentials for deployment |
| `SCRIPT_ID` | `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l` | Apps Script project ID |
| `ADMIN_KEY_ROOT` | Your root admin secret | For E2E tests |

**How to get CLASPRC_JSON:**
```bash
# After running 'clasp login'
cat ~/.clasprc.json | jq -c
# Copy the output (one line of JSON)
```

### 2. Trigger Deployment

```bash
# Push to main branch triggers full pipeline
git push origin main

# Or push to claude/* branch for testing
git push origin claude/my-feature-branch
```

### 3. Monitor Pipeline

1. Go to **Actions** tab in GitHub
2. Watch the workflow run:
   - ✅ Lint Code
   - ✅ Run Tests (with coverage)
   - ✅ Contract Tests
   - ✅ Deploy to Apps Script (main branch only)
   - ✅ E2E Tests on Deployed URL (main branch only)

---

## Deployment Flow

```
Local Code
    ↓
git push
    ↓
GitHub Actions
    ├─ Lint (ESLint)
    ├─ Unit Tests (Jest)
    ├─ Contract Tests
    ↓ (if main branch)
    ├─ clasp push --force
    ├─ clasp deploy
    ↓
Apps Script Project
    ↓
    ├─ Web App Deployment
    ├─ Get Deployment URL
    ↓
E2E Tests (Playwright)
    ├─ Test on deployed URL
    ├─ Generate test reports
    ↓
✅ Production URL Ready
```

---

## Testable URL

After successful deployment:

**Production URL:**
```
https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec
```

**Test Endpoints:**
- Health Check: `?page=status`
- Admin: `?page=admin&brand=root`
- Public: `?p=events&brand=root`
- Display: `?page=display&brand=root&tv=1`
- Poster: `?page=poster&brand=root`

---

## Quality Gates

All these must pass before deployment:

| Gate | Tool | Threshold | Fail Behavior |
|------|------|-----------|---------------|
| Linting | ESLint | 0 errors | ❌ Block deployment |
| Unit Tests | Jest | 70% coverage | ❌ Block deployment |
| Contract Tests | Jest | All pass | ❌ Block deployment |
| E2E Tests | Playwright | Critical flows pass | ⚠️ Warn (post-deploy) |

---

## Manual Deployment (Bypass CI)

If you need to deploy without GitHub Actions:

```bash
# 1. Ensure tests pass
npm test

# 2. Push to Apps Script
clasp push --force

# 3. Deploy
clasp deploy --description "Manual hotfix $(date)"

# 4. Get URL
clasp deployments | tail -1

# 5. Test manually
open "https://script.google.com/macros/s/.../exec?page=status"
```

---

## Rollback

If deployment breaks:

```bash
# 1. List all deployments
clasp deployments

# 2. Note the previous deployment ID (e.g., @5)
# 3. Undeploy current
clasp undeploy

# 4. Re-deploy from previous version
# (Apps Script keeps version history)
# Manually redeploy from Apps Script UI: Deploy → Manage deployments
```

---

## Troubleshooting

### Issue: `clasp push` fails with "Unauthorized"

**Solution:**
```bash
clasp logout
clasp login
clasp push
```

### Issue: GitHub Actions deploy fails

**Solution:**
1. Check that `CLASPRC_JSON` secret is valid JSON (no newlines)
2. Verify `SCRIPT_ID` matches your Apps Script project
3. Ensure service account has Editor access to the script

### Issue: E2E tests fail on deployed URL

**Solution:**
1. Check `BASE_URL` environment variable in GitHub Actions
2. Verify `ADMIN_KEY_ROOT` secret is correct
3. Check Apps Script logs: `clasp logs`

### Issue: Deployment URL returns 404

**Solution:**
1. Go to Apps Script editor
2. Deploy → Manage deployments
3. Ensure "New deployment" is active
4. Update access to "Anyone"

---

## Next Steps

1. ✅ **Change admin secrets** in `Config.gs`
2. ✅ **Run `npm install`**
3. ✅ **Run `clasp login`**
4. ✅ **Push to Apps Script**: `clasp push`
5. ✅ **Deploy**: `clasp deploy`
6. ✅ **Test**: Visit deployment URL
7. ✅ **Set up GitHub Actions secrets**
8. ✅ **Push to main**: Trigger CI/CD

---

## Production Checklist

Before going live:

- [ ] Admin secrets changed (not CHANGE_ME_*)
- [ ] All tests passing locally
- [ ] GitHub Actions pipeline green
- [ ] E2E tests pass on deployed URL
- [ ] Custom domain configured (zeventbooks.io)
- [ ] SSL certificate active
- [ ] Analytics tracking verified
- [ ] Sponsor logos loading correctly
- [ ] TV display tested on actual TV (4+ hours)
- [ ] Mobile tested on iPhone and Android
- [ ] Load testing: 100+ concurrent users
- [ ] Security scan: No hardcoded secrets
- [ ] Backup: Spreadsheet exported to Google Drive
- [ ] Monitoring: Set up uptime checks (e.g., UptimeRobot)
- [ ] Documentation: Admin guide published

---

**Questions?** See `ARCHITECTURE_REVIEW.md` for detailed architecture analysis or `tests/USER_FLOWS.md` for end-user testing scenarios.
