# Deployment Guide - DevOps Flow

## The Problem We Solved

**Symptom**: Tests fail with "Cannot read properties of null (reading 'getId')"
**Root Cause**: Deployment version mismatch - versioned deployments don't auto-update

## Understanding Google Apps Script Deployments

### Two Types of Deployments

1. **@HEAD (Recommended for Development)**
   - Auto-updates with every `npm run push`
   - Always has latest code
   - Perfect for active development and testing
   - URL never changes

2. **Versioned (@1, @2, @3, etc.)**
   - Frozen to specific code snapshot
   - Does NOT auto-update when you push new code
   - Good for production/stable releases
   - Each version has different URL

### The DevOps Pipeline

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   GitHub    │────▶│ Local Code  │────▶│  Apps       │────▶│ Deployment  │
│             │ git │             │clasp│  Script     │     │  (@HEAD or  │
│   Branch    │pull │ /home/you/  │push │  Versions   │     │  @Version)  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                                                     │
                                                                     ▼
                                                            ┌─────────────┐
                                                            │   Newman    │
                                                            │  Playwright │
                                                            │   Tests     │
                                                            └─────────────┘
```

## Quick Fix: Use @HEAD Deployment

**From your terminal:**

```bash
cd ~/MVP-EVENT-TOOLKIT

# Option 1: Use existing @HEAD (if authorized)
./use-head-deployment.sh

# If @HEAD has old code, push latest:
npm run push
sleep 30
./use-head-deployment.sh

# Run tests
npm run test:newman:smoke
npm run test:e2e
```

## Systematic Deployment Process

### If @HEAD Doesn't Work

**1. Ensure local code is up to date:**
```bash
git pull origin claude/e2e-playwright-testing-011CUzuxDzMBaNQrs2xcK1NG
```

**2. Verify Config.gs has the fix:**
```bash
grep "spreadsheetId: '1ixHd" Config.gs
```
Should show: `spreadsheetId: '1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l'`

**3. Push to Apps Script:**
```bash
npm run push
sleep 30
```

**4. Either use @HEAD or create new version:**

**Option A: Authorize @HEAD** (recommended)
```bash
# In Apps Script editor: Deploy → Manage deployments
# Find @HEAD → Edit → Who has access: Anyone → Deploy
./use-head-deployment.sh
```

**Option B: Create new versioned deployment**
```bash
# In Apps Script editor: Deploy → New deployment
# Settings: Execute as: Me, Who has access: Anyone
# Copy URL and run:
./update-deployment-url.sh "NEW_URL"
```

## Authorization Checklist

When creating/editing deployments, ensure:

- ✅ **Execute as**: Me (your email)
- ✅ **Who has access**: Anyone
- ✅ Click **"Authorize access"** when prompted
- ✅ Review permissions and click **"Allow"**
- ✅ Wait for "Deployment successful" message

## Testing the Deployment

**Manual test in browser (incognito):**
```
https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?p=status&brand=root
```

**Expected response:**
```json
{
  "ok": true,
  "value": {
    "build": "triangle-extended-v1.3",
    "contract": "1.0.3",
    ...
  }
}
```

**NOT:**
- HTML redirect (means "Anyone" access not working)
- `"Cannot read properties of null (reading 'getId')"` (means old code deployed)

## Automated Tests

**Once deployment is working:**

```bash
# Quick smoke test
npm run test:newman:smoke

# Full API flow test
npm run test:newman:flow

# All E2E tests
npm run test:e2e

# Everything
./run-all-tests.sh
```

## Common Issues

### Issue: "Cannot read properties of null (reading 'getId')"
**Cause**: Deployment has old code without hard-coded spreadsheet ID
**Fix**:
```bash
npm run push
sleep 30
./use-head-deployment.sh
```

### Issue: "Moved Temporarily" / HTML redirect
**Cause**: "Who has access" not set to "Anyone"
**Fix**: Edit deployment → Change to "Anyone" → Authorize

### Issue: Tests pass locally but fail in deployment
**Cause**: Environment file pointing to wrong deployment URL
**Fix**:
```bash
./fix-deployment.sh  # Shows current deployment
./use-head-deployment.sh  # Switch to @HEAD
```

### Issue: Deployment worked yesterday, broken today
**Cause**: You pushed new code, but versioned deployment is frozen
**Fix**: Either use @HEAD or create new version after pushing code

## Best Practices

1. **Development**: Use @HEAD deployment
   - Auto-updates with code changes
   - No need to create new deployments constantly

2. **Testing**: Run tests after every deployment change
   ```bash
   ./use-head-deployment.sh && npm run test:newman:smoke
   ```

3. **Production**: Use versioned deployment
   - Stable URL
   - Control when updates go live
   - Tag version in git when deploying

4. **Quality Gates**:
   - Jest tests (unit/contract) must pass before push
   - Newman smoke tests must pass before full E2E
   - All E2E tests must pass before production deploy

## Scripts Reference

- `./fix-deployment.sh` - Diagnose current deployment status
- `./use-head-deployment.sh` - Switch to @HEAD (auto-updating)
- `./update-deployment-url.sh URL` - Switch to specific deployment
- `./deploy-and-test.sh` - Systematic deployment guide
- `./run-all-tests.sh` - Run all test suites
- `./debug-newman.sh` - Debug API test failures

## Files That Need To Sync

These must all have the correct deployment URL:

- `postman/environments/mvp-event-toolkit-local.json` (Newman tests)
- `.env` (Playwright tests)

The update scripts handle both automatically.
