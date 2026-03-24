# Staged Deployment Pipeline Guide

## Overview

This guide explains the **two-stage deployment pipeline** with manual verification gates, designed to give you full control over when tests run and when deployments proceed to QA.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      STAGE 1 (Automated)                     │
│                                                              │
│  ┌──────────────┐     ┌───────────────┐                     │
│  │ Unit Tests   │────▶│               │                     │
│  └──────────────┘     │               │                     │
│                       │  Deploy to    │                     │
│  ┌──────────────┐     │  Apps Script  │                     │
│  │Contract Tests│────▶│     API       │                     │
│  └──────────────┘     │               │                     │
│                       └───────┬───────┘                     │
│                               │                              │
│                               ▼                              │
│                       ┌───────────────┐                     │
│                       │ Output URLs:  │                     │
│                       │ • ROOT        │                     │
│                       │ • ABC         │                     │
│                       │ • CBC         │                     │
│                       └───────────────┘                     │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  🧑 MANUAL GATE       │
                    │  Verify Deployments  │
                    └──────────┬───────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  STAGE 2 (Manual Trigger)                    │
│                                                              │
│  1️⃣ Newman API Tests                                        │
│           ↓                                                  │
│  2️⃣ Playwright Smoke Tests                                  │
│           ↓                                                  │
│  3️⃣ Playwright Flow Tests                                   │
│           ↓                                                  │
│  4️⃣ Playwright Page Tests                                   │
│           ↓                                                  │
│  🎯 Quality Gate                                             │
│           ↓                                                  │
│  🚀 Deploy to QA (if all pass)                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Stage 1: Build & Deploy

### Trigger
Automatically runs on:
- Push to `main` branch
- Push to `claude/**` branches
- Pull requests to `main`

### What Happens

1. **Unit Tests** - Validates code logic
2. **Contract Tests** - Validates API contracts and Triangle tests
3. **Deploy to Apps Script** - Deploys to your Google Apps Script API
4. **Generate URLs** - Creates brand-specific URLs for verification:
   - **ROOT**: `https://script.google.com/...?p=events&brand=root`
   - **ABC**: `https://script.google.com/...?p=events&brand=abc`
   - **CBC**: `https://script.google.com/...?p=events&brand=cbc`

### Success Criteria
- ✅ All tests must pass
- ✅ Deployment must succeed
- ✅ URLs must be generated

### Output
The workflow creates a **GitHub Actions Summary** with:
- Test results
- Clickable brand URLs for manual verification
- Instructions for triggering Stage 2

## Manual Verification Gate

### Your Responsibility

After Stage 1 completes, **you must manually verify** the deployment:

1. **Go to the GitHub Actions run summary**
2. **Click each brand URL** to verify:
   - ✅ ROOT brand loads correctly
   - ✅ ABC brand loads correctly
   - ✅ CBC brand loads correctly
3. **Check for any issues**:
   - Pages render properly
   - No JavaScript errors
   - Data displays correctly
   - Authentication works

### Decision Point

- **✅ All verified?** → Proceed to Stage 2
- **❌ Issues found?** → Fix and re-run Stage 1

## Stage 2: Testing & QA

### Trigger
**Manual workflow dispatch** from GitHub Actions UI

### How to Trigger

1. Go to **Actions** tab in GitHub
2. Select **"Stage 2 - Testing & QA"** workflow
3. Click **"Run workflow"** button
4. **Paste the deployment URL** from Stage 1
5. Click **"Run workflow"** to start

### What Happens (Sequential)

Tests run **in order** (not parallel):

1. **🧪 Newman API Tests**
   - Validates API endpoints
   - Tests system functionality
   - Uses Postman collections

2. **🚨 Playwright Smoke Tests** (only if Newman passes)
   - Critical path validation
   - Quick UI checks
   - Must pass before Flow tests

3. **🔄 Playwright Flow Tests** (only if Smoke passes)
   - End-to-end user journeys
   - Multi-step workflows
   - Must pass before Page tests

4. **📄 Playwright Page Tests** (only if Flow passes)
   - Component-level testing
   - Page functionality
   - Final test gate

### Quality Gate

After all tests complete:

**✅ All Tests Pass:**
- Quality gate approves deployment
- Triggers QA deployment (placeholder for now)
- Creates success summary

**❌ Any Test Fails:**
- Quality gate blocks deployment
- Workflow stops
- Creates failure summary with details

### QA Deployment

Currently a **placeholder** for future implementation. When ready to implement:

1. Set up QA Apps Script project
2. Add `QA_SCRIPT_ID` secret to GitHub
3. Add QA OAuth credentials
4. Implement deployment logic in `deploy-to-qa` job

## Workflow Files

### `stage1-deploy.yml`
- Location: `.github/workflows/stage1-deploy.yml`
- Runs: Unit tests, Contract tests, Deploy
- Outputs: Brand URLs for verification

### `stage2-testing.yml`
- Location: `.github/workflows/stage2-testing.yml`
- Runs: Sequential tests → Quality gate → QA deploy
- Triggered: Manually via workflow_dispatch

## Usage Example

### Typical Flow

```bash
# 1. Make changes and push to main
git add .
git commit -m "feat: Add new feature"
git push origin main

# 2. Stage 1 runs automatically
# → Go to Actions tab
# → Watch Stage 1 complete
# → Review the Summary

# 3. Manual verification
# → Click ROOT URL → Verify ✅
# → Click ABC URL → Verify ✅
# → Click CBC URL → Verify ✅

# 4. Trigger Stage 2
# → Go to Actions → "Stage 2 - Testing & QA"
# → Click "Run workflow"
# → Paste deployment URL from Stage 1
# → Click "Run workflow"

# 5. Watch tests run sequentially
# → Newman API Tests ✅
# → Smoke Tests ✅
# → Flow Tests ✅
# → Page Tests ✅

# 6. Quality gate passes
# → QA deployment triggered (when implemented)
# → Production deployment ready
```

## Benefits

### 🎯 **Full Control**
- You decide when to proceed to full testing
- Catch deployment issues before running expensive E2E tests

### ⚡ **Cost Efficient**
- Only run full test suite after manual verification
- Avoid wasting CI minutes on broken deployments

### 🔍 **Better Visibility**
- Clear separation between deploy and test phases
- Easy to identify where failures occur

### 📊 **Sequential Testing**
- Tests run in order: API → Smoke → Flow → Page
- Faster failure detection (fail fast)
- No parallel conflicts

### 🚀 **Flexible Workflow**
- Can trigger Stage 2 multiple times with same deployment
- Can skip Stage 2 if you want to test manually
- Easy to add new stages

## Required GitHub Secrets

Ensure these secrets are configured in your GitHub repository:

### Stage 1 (Deploy)
- `OAUTH_CREDENTIALS` - Clasp OAuth credentials
- `DEPLOYMENT_ID` - Apps Script deployment ID
- `SCRIPT_ID` - Apps Script project ID (if needed)

### Stage 2 (Testing)
- `ADMIN_KEY_ROOT` - Admin key for ROOT brand

### Future QA Deployment
- `QA_SCRIPT_ID` - QA Apps Script project ID
- `QA_OAUTH_CREDENTIALS` - QA OAuth credentials

## Troubleshooting

### Stage 1 doesn't run
- ✅ Check you pushed to `main` or `claude/**` branch
- ✅ Check workflow file is in `.github/workflows/`
- ✅ Check GitHub Actions are enabled

### URLs not generated
- ✅ Check deployment succeeded
- ✅ Check `clasp deployments` command works
- ✅ Verify OAuth credentials are valid

### Stage 2 can't be triggered
- ✅ Check you're on the Actions tab
- ✅ Check you selected "Stage 2 - Testing & QA"
- ✅ Check you have permissions to run workflows

### Tests fail in Stage 2
- ✅ Check deployment URL is correct
- ✅ Check admin keys are set
- ✅ Review test logs for specific errors
- ✅ Run tests locally first

## Migration from Old CI/CD

The old `ci.yml` had all tests in one pipeline. Key differences:

| Old CI/CD | New Staged Pipeline |
|-----------|---------------------|
| All tests run automatically | Stage 2 runs manually |
| Tests run in parallel | Tests run sequentially |
| No manual verification | Manual gate between stages |
| No URL outputs | Brand URLs provided |
| Single quality gate | Two quality gates (Stage 1 + Stage 2) |

### Keeping Old Pipeline

You can keep `ci.yml` as a backup or for PR checks:
- Rename to `ci-backup.yml` to disable
- Or configure to only run on PRs
- Or delete if no longer needed

## Next Steps

1. **Test Stage 1**: Push a change and verify it runs
2. **Verify URLs**: Check that brand URLs work
3. **Test Stage 2**: Manually trigger with Stage 1 URL
4. **Implement QA Deploy**: When ready, set up QA environment
5. **Customize**: Adjust tests, add stages as needed

---

**Questions?** Check the workflow YAML files for implementation details.
