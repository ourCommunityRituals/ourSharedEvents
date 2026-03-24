# 🧪 QA Deployment Environment Guide

**Implemented:** 2025-11-14
**Priority:** P1 (High)
**Status:** ✅ Active

---

## Overview

The QA (Quality Assurance) deployment environment provides a **staging area** for testing changes before they reach production. All code must pass quality gates in QA before production deployment.

### Benefits

✅ **Test before production** - Catch issues in a safe environment
✅ **Automated deployment** - Deploys after all tests pass
✅ **Health checks** - Automatic verification after deployment
✅ **Easy rollback** - One-click rollback if issues found
✅ **Isolated environment** - Separate from production data
✅ **Quality gates** - Only deploys if all tests pass

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              DEPLOYMENT PIPELINE FLOW                    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Stage 1: Build & Test                                  │
│  ├─ Lint (ESLint)                                       │
│  ├─ Unit Tests                                          │
│  ├─ Contract Tests                                      │
│  └─ Deploy to Production (main branch only)            │
│                                                          │
│  ⬇️ Auto-trigger                                         │
│                                                          │
│  Stage 2: Testing & QA                                  │
│  ├─ API Tests (Playwright)                              │
│  ├─ Smoke Tests (Playwright)                            │
│  ├─ Flow Tests (Playwright)                             │
│  ├─ Page Tests (Playwright)                             │
│  └─ Quality Gate Check                                  │
│                                                          │
│  ⬇️ If all tests pass                                    │
│                                                          │
│  Deploy to QA:                                          │
│  ├─ Push code to QA Apps Script                        │
│  ├─ Create/Update QA deployment                         │
│  ├─ Health check                                        │
│  └─ Generate QA URLs                                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Initial Setup

### Prerequisites

- Google Apps Script project for QA
- GitHub repository admin access
- Local development environment with clasp CLI

### Step 1: Create QA Apps Script Project

1. Go to [Google Apps Script](https://script.google.com/)
2. Click "New Project"
3. Name it: `MVP-EVENT-TOOLKIT-QA`
4. Copy the Script ID:
   - Click ⚙️ **Project Settings**
   - Under "IDs", copy the **Script ID**
   - Format: `1A...`
   - Save this for later

### Step 2: Generate QA OAuth Credentials

**On your local machine:**

```bash
# Login to clasp (if not already logged in)
npx @google/clasp login

# This opens browser for Google authentication
# After authentication, credentials are saved to ~/.clasprc.json

# Copy the credentials
cat ~/.clasprc.json
```

**Expected output:**
```json
{
  "token": {
    "access_token": "...",
    "refresh_token": "...",
    "scope": "...",
    "token_type": "Bearer",
    "expiry_date": ...
  },
  "oauth2ClientSettings": {
    "clientId": "...",
    "clientSecret": "...",
    "redirectUri": "..."
  },
  "isLocalCreds": false
}
```

Copy the **entire JSON object**.

### Step 3: Configure GitHub Secrets

Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions**

Click "New repository secret" for each:

#### 3.1: QA_SCRIPT_ID

- **Name:** `QA_SCRIPT_ID`
- **Value:** (Script ID from Step 1)
- Example: `1AaBbCcDd...`

#### 3.2: QA_OAUTH_CREDENTIALS

- **Name:** `QA_OAUTH_CREDENTIALS`
- **Value:** (Entire JSON from Step 2)
- Paste the complete JSON object including curly braces

#### 3.3: QA_DEPLOYMENT_ID (Optional)

- **Name:** `QA_DEPLOYMENT_ID`
- **Value:** (Leave empty for first deployment)
- After first QA deployment, add the deployment ID here
- This allows updating the same deployment each time
- Format: `AKfycb...`

#### 3.4: ADMIN_KEY_QA (Recommended)

- **Name:** `ADMIN_KEY_QA`
- **Value:** Generate a unique admin key for QA
- Use a password generator or:
  ```bash
  openssl rand -hex 32
  ```
- Add this key to QA Apps Script Script Properties:
  1. Open QA Apps Script project
  2. Click ⚙️ **Project Settings**
  3. Scroll to **Script Properties**
  4. Add property: `ADMIN_SECRET_ROOT` = (your generated key)

### Step 4: Configure QA Apps Script

1. Open your QA Apps Script project
2. Go to ⚙️ **Project Settings**
3. Add **Script Properties**:

| Property | Value | Description |
|----------|-------|-------------|
| `ADMIN_SECRET_ROOT` | (from ADMIN_KEY_QA) | Admin authentication |
| `SPREADSHEET_ID` | (Optional: QA spreadsheet) | Separate QA data |

4. (Optional) Create a separate Google Sheet for QA data
5. Deploy as Web App:
   - Click **Deploy** → **New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**

### Step 5: Set Up GitHub Environment

1. Go to repository → **Settings** → **Environments**
2. Click **New environment**
3. Name: `qa`
4. (Optional) Add **Protection rules**:
   - ☑️ Required reviewers (add yourself)
   - ☑️ Wait timer: 5 minutes
   - ☑️ Deployment branches: `main` only

---

## Usage

### Automatic QA Deployment

QA deployment happens **automatically** when:

1. Code is pushed to `main` branch
2. Stage 1 completes successfully (lint + unit tests + deploy to production)
3. Stage 2 tests all pass (API + smoke + flows + pages)
4. Quality gate approves the deployment

**Workflow:**

```bash
# 1. Push to main
git push origin main

# 2. GitHub Actions runs automatically:
#    - Stage 1: Build, test, deploy to production
#    - Stage 2: Run E2E tests against production
#    - If all pass: Deploy to QA automatically

# 3. Check Actions tab for status
```

### Manual QA Deployment

If you need to deploy to QA manually:

1. Go to **Actions** tab
2. Select **Stage 2 - Testing & QA**
3. Click **Run workflow**
4. (Optional) Enter deployment URL to test
5. Click **Run workflow**

### Viewing QA Deployment

After QA deployment completes:

1. Go to **Actions** tab
2. Click on the latest **Stage 2** workflow run
3. Scroll to **QA Deployment** job
4. Click **View more details**
5. See **Summary** for QA URLs

**QA URLs will be in format:**
```
https://script.google.com/macros/s/AKfycb.../exec?p=events&brand=root
```

---

## QA Testing

### Testing Checklist

After QA deployment, manually test:

- [ ] **Status API** - Verify application is responding
- [ ] **Public page** - Browse events, check UI
- [ ] **Admin page** - Login, create test event
- [ ] **Sponsor page** - Add test sponsor
- [ ] **Display page** - Verify carousel/sponsors
- [ ] **Forms** - Test registration/check-in
- [ ] **Multi-brand** - Test with different brands

### Automated Checks

QA deployment includes **automatic health checks**:

✅ HTTP 200 response from status endpoint
✅ Deployment URL accessible
✅ Apps Script responding

### Using QA Environment

**Create test data:**

```bash
# Use QA URLs with test data
QA_URL="https://script.google.com/macros/s/AKfycb.../exec"

# Test creating an event
curl -X POST "$QA_URL?action=create" \
  -H "Content-Type: application/json" \
  -d '{
    "brandId": "root",
    "scope": "events",
    "templateId": "event",
    "adminKey": "your-qa-admin-key",
    "data": {
      "title": "QA Test Event",
      "startDate": "2025-12-01",
      "location": "QA Test Location"
    }
  }'
```

**Important:** Always use **test data** in QA, not real customer data.

---

## Rollback

If issues are found in QA, rollback to previous version:

### Option 1: Via GitHub Actions (Recommended)

1. Go to **Actions** tab
2. Select **QA Rollback** workflow
3. Click **Run workflow**
4. Enter:
   - **Deployment ID** (optional - leave empty for automatic)
   - **Reason** (required - explain why rolling back)
5. Click **Run workflow**

### Option 2: Manual Rollback

```bash
# 1. Login to clasp
clasp login

# 2. Switch to QA project
echo '{"scriptId":"YOUR_QA_SCRIPT_ID"}' > .clasp.json

# 3. List deployments
clasp deployments

# 4. Rollback to previous (copy deployment ID from above)
clasp deploy -i AKfycb_PREVIOUS_DEPLOYMENT_ID -d "Rollback: [reason]"
```

### Rollback Verification

After rollback:

1. Check **Actions** tab for rollback summary
2. Test QA URLs to verify functionality
3. Investigate root cause of issue
4. Fix the issue
5. Re-deploy to QA

---

## Troubleshooting

### QA Not Deploying

**Problem:** "QA environment not configured"

**Solutions:**

1. Verify GitHub secrets are set:
   - `QA_SCRIPT_ID`
   - `QA_OAUTH_CREDENTIALS`
2. Check secret names match exactly (case-sensitive)
3. Verify OAuth credentials are valid (not expired)
4. Re-run `clasp login` if needed

### QA Deployment Fails

**Problem:** "Failed to extract QA deployment ID"

**Solutions:**

1. Check QA Apps Script project exists
2. Verify Script ID is correct
3. Ensure OAuth credentials have access to project
4. Check Apps Script execution logs:
   - Open QA project
   - View → **Executions**
   - Look for errors

### Health Check Fails

**Problem:** "QA health check warning - got HTTP 403/500"

**Solutions:**

1. **HTTP 403** - Usually rate limiting, wait and retry
2. **HTTP 500** - Check Apps Script logs for errors
3. **HTTP 000** - Network issue, check URL accessibility
4. Manually test the QA URL in browser

### Tests Pass but QA Not Deployed

**Problem:** Quality gate passed but no QA deployment

**Solutions:**

1. Check if push was to `main` branch (QA only deploys from main)
2. Verify GitHub environment `qa` is configured
3. Check workflow logs for "skipped" messages
4. Ensure QA secrets are configured

---

## CI/CD Integration

### Deployment Flow

```yaml
Push to main
  ↓
Stage 1: Build & Deploy
  ├─ Lint ✅
  ├─ Unit Tests ✅
  ├─ Contract Tests ✅
  └─ Deploy to Production ✅
  ↓
Stage 2: Testing
  ├─ API Tests ✅
  ├─ Smoke Tests ✅
  ├─ Flow Tests ✅
  ├─ Page Tests ✅
  └─ Quality Gate ✅
  ↓
Deploy to QA ✅
  ├─ Push code
  ├─ Create deployment
  ├─ Health check
  └─ Generate URLs
```

### Quality Gates

| Gate | Blocks QA Deployment | Action if Fails |
|------|---------------------|-----------------|
| Lint | ✅ Yes | Fix code quality issues |
| Unit Tests | ✅ Yes | Fix failing tests |
| Contract Tests | ✅ Yes | Fix API contract issues |
| E2E Tests | ✅ Yes | Fix E2E test failures |
| Health Check | ⚠️ No | Investigate but allows deployment |

### Environment Protection

**GitHub Environment:** `qa`

**Protection Rules (Optional):**
- ✅ Require approval from team member
- ✅ Wait 5 minutes before deployment
- ✅ Limit to `main` branch only

---

## Best Practices

### ✅ DO:

- **Test in QA first** - Always test new features in QA before production
- **Use test data** - Never use real customer data in QA
- **Check health** - Verify health checks pass after deployment
- **Document issues** - Note any QA findings in GitHub Issues
- **Rollback if needed** - Don't hesitate to rollback if issues found
- **Separate credentials** - Use different admin keys for QA vs. production

### ❌ DON'T:

- **Skip QA** - Don't deploy directly to production without QA testing
- **Use production data** - Never point QA to production database
- **Ignore failures** - Investigate all QA deployment failures
- **Share admin keys** - Keep QA and production keys separate
- **Deploy manually** - Let CI/CD handle deployments automatically

---

## Monitoring

### Deployment Status

**Via GitHub:**
1. **Actions** tab shows all deployments
2. **Environments** tab shows QA deployment history
3. **Summary** in each workflow run shows URLs

**Via Email:**
- GitHub sends notifications for:
  - Deployment failures
  - Waiting for approval (if configured)
  - Rollback completions

### QA Metrics

Track these metrics:

- **Deployment frequency** - How often QA is deployed
- **Failure rate** - % of QA deployments that fail
- **Rollback rate** - % of QA deployments rolled back
- **Test success rate** - % of tests passing before QA deployment
- **Mean time to recovery (MTTR)** - Time from issue found to rollback

---

## Security Considerations

### Secrets Management

**QA Secrets:**
- Store in GitHub Secrets (encrypted at rest)
- Never commit to Git
- Rotate OAuth credentials quarterly
- Use different admin keys than production

**Access Control:**
- Limit who can trigger QA deployments
- Use GitHub environment protection rules
- Require approval for QA deployments (optional)
- Audit deployment logs regularly

### Data Isolation

**QA Environment:**
- ✅ Separate Google Apps Script project
- ✅ Separate Google Sheet (optional)
- ✅ Separate admin keys
- ✅ Test data only (no real customer data)
- ✅ Different deployment URLs

---

## Advanced Configuration

### Custom QA URL

To use a custom domain for QA:

1. Set up Google Apps Script custom domain (Apps Script add-on required)
2. Add DNS CNAME record
3. Update workflow to use custom URL

### Multiple QA Environments

To create multiple QA environments (e.g., QA1, QA2):

1. Create additional Apps Script projects
2. Add secrets: `QA1_SCRIPT_ID`, `QA2_SCRIPT_ID`, etc.
3. Duplicate `deploy-to-qa` job for each environment
4. Create separate GitHub environments: `qa1`, `qa2`

### Automated QA Testing

After QA deployment, run additional automated tests:

```yaml
- name: Run QA smoke tests
  env:
    BASE_URL: ${{ steps.deploy.outputs.qa_url }}
  run: |
    npm run test:smoke
```

---

## Comparison: QA vs. Production

| Aspect | QA | Production |
|--------|----|-----------|
| **Purpose** | Testing & validation | Live customer use |
| **Data** | Test data only | Real customer data |
| **Deployment** | After quality gates pass | After Stage 1 tests pass |
| **Admin Key** | QA-specific key | Production key |
| **URL** | `script.google.com/macros/s/AKfycb_QA...` | `script.google.com/macros/s/AKfycb_PROD...` |
| **Rollback** | Easy via workflow | Manual via clasp |
| **Monitoring** | Basic health checks | Full monitoring (recommended) |
| **Users** | Internal team only | All customers |

---

## Workflow Files

| File | Purpose |
|------|---------|
| `.github/workflows/stage2-testing.yml` | Main QA deployment workflow |
| `.github/workflows/qa-rollback.yml` | QA rollback workflow |

---

## FAQ

### Q: When should I use QA vs. Production?

**A:** Use QA for testing new features, bug fixes, or any changes before they go live. Production is for stable, tested code only.

### Q: Can I deploy to QA without deploying to Production first?

**A:** Not with current setup. QA deployment is triggered after Stage 1 (production deployment). For manual QA-only deployment, use `workflow_dispatch` in Stage 2.

### Q: What if QA deployment fails?

**A:** Check workflow logs, verify secrets are configured, and ensure Apps Script project is accessible. Fix issues and re-run the workflow.

### Q: How do I know if QA is ready for production?

**A:** After QA deployment, manually test all functionality, verify health checks pass, and confirm no issues found. Then production is already deployed (Stage 1).

### Q: Can I skip QA deployment?

**A:** Yes - QA only deploys if configured. Without QA secrets, workflow shows setup instructions but doesn't fail.

### Q: How often should I deploy to QA?

**A:** QA deploys automatically after every successful Stage 1 + Stage 2 run. For main branch, this is after every merge.

---

## Resources

### Documentation
- [Google Apps Script Deployment](https://developers.google.com/apps-script/concepts/deployments)
- [Clasp CLI Documentation](https://github.com/google/clasp)
- [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments)

### Tools
- [Apps Script Dashboard](https://script.google.com/home)
- [GitHub Actions](https://github.com/features/actions)
- [Clasp CLI](https://www.npmjs.com/package/@google/clasp)

---

## Support

**Need help?**
- Check troubleshooting section above
- Review workflow logs in Actions tab
- Check Apps Script execution logs
- Open GitHub Issue for bugs

**Configuration assistance:**
- See "Initial Setup" section
- Review GitHub secrets configuration
- Verify Apps Script project settings

---

## Summary

✅ **QA Environment** - Separate staging for testing
✅ **Automated Deployment** - Deploys after quality gates pass
✅ **Health Checks** - Automatic verification
✅ **Easy Rollback** - One-click rollback workflow
✅ **Isolated** - Separate from production
✅ **Integrated** - Part of CI/CD pipeline

**QA deployment ensures code quality before it reaches customers.**

---

**Document Version:** 1.0
**Last Updated:** 2025-11-14
**Next Review:** 2025-12-14
