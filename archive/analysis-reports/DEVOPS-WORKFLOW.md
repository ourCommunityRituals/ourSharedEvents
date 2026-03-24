# DevOps Workflow - Best Practices

## Overview

This document defines the standard workflow for development, testing, and deployment of the MVP-EVENT-TOOLKIT Google Apps Script application.

## Environment Strategy

### Three Environments

```
┌─────────────────┐
│  DEVELOPMENT    │  @HEAD deployment (auto-updates)
│  (Active Work)  │  Used by: Developers
└─────────────────┘
         ↓
┌─────────────────┐
│  STAGING/QA     │  Versioned deployment (e.g., @7)
│  (Testing)      │  Used by: QA, automated tests
└─────────────────┘
         ↓
┌─────────────────┐
│  PRODUCTION     │  Versioned deployment (e.g., @8)
│  (Live Users)   │  Used by: End users
└─────────────────┘
```

### Why This Structure?

- **@HEAD (Development)**: Auto-updates immediately, fast iteration
- **Versioned Staging**: Stable for thorough testing, controlled updates
- **Versioned Production**: Zero surprises, only promoted after full QA

## Daily Development Workflow

### 1. Feature Development

```bash
# Start day - sync with team
cd ~/MVP-EVENT-TOOLKIT
git pull origin main  # or your feature branch

# Create feature branch
git checkout -b feature/your-feature-name

# Develop locally
# Edit Code.gs, Admin.html, etc.

# Run local unit tests frequently
npm run test:jest
```

### 2. Deploy to Development (@HEAD)

```bash
# Push code to Apps Script
npm run push

# Wait for propagation (CRITICAL)
sleep 30

# Verify deployment
./use-head-deployment.sh
# Should show: ✅ SUCCESS

# Quick smoke test
npm run test:newman:smoke
```

**Result**: Your changes are live on @HEAD immediately.

### 3. Commit and Push to Git

```bash
# Only commit if tests pass
git add .
git commit -m "feat: Add feature X"
git push origin feature/your-feature-name

# Create PR for team review
gh pr create --title "Add feature X" --body "..."
```

### 4. Merge to Main

```bash
# After PR approval
git checkout main
git pull origin main
# Changes are in main branch
```

## Release to Staging/QA

### When to Create Staging Deployment

- Weekly releases
- After major feature completion
- Before production deployments
- When multiple features need coordinated testing

### Process

```bash
# 1. Ensure main branch is deployed to @HEAD
git checkout main
git pull origin main
npm run push
sleep 30

# 2. Create new versioned deployment
# In Apps Script editor:
#   - Deploy → New deployment
#   - Gear → Web app
#   - Description: "v1.4.0 - Staging"
#   - Execute as: Me
#   - Who has access: Anyone
#   - Deploy → Authorize → Allow
#   - Copy URL

# 3. Tag in Git
git tag v1.4.0-staging
git push origin v1.4.0-staging

# 4. Update staging environment file
cp postman/environments/mvp-event-toolkit-local.json postman/environments/mvp-event-toolkit-staging.json
# Edit staging.json to use new deployment URL

# 5. Run full test suite
npm run test:jest              # Unit tests
npm run test:newman -- -e postman/environments/mvp-event-toolkit-staging.json
npm run test:e2e               # E2E tests

# 6. Document results
# Create test report, log any issues
```

## Release to Production

### Prerequisites (Quality Gates)

- ✅ All Jest unit tests pass (100%)
- ✅ All Newman API tests pass
- ✅ All Playwright E2E tests pass (on staging)
- ✅ Manual QA sign-off
- ✅ Documentation updated
- ✅ CHANGELOG.md updated
- ✅ No critical bugs

### Process

```bash
# 1. Create production deployment from staging code
# In Apps Script editor:
#   - Deploy → New deployment
#   - Description: "v1.4.0 - Production"
#   - Execute as: Me
#   - Who has access: Anyone (or "Only myself" if private)
#   - Deploy → Authorize → Allow
#   - Copy URL

# 2. Tag production release
git tag v1.4.0
git push origin v1.4.0

# 3. Update production environment
cp postman/environments/mvp-event-toolkit-staging.json postman/environments/mvp-event-toolkit-prod.json
# Edit prod.json with production URL

# 4. Smoke test production
npm run test:newman:smoke -- -e postman/environments/mvp-event-toolkit-prod.json

# 5. Update documentation
echo "v1.4.0" > VERSION
git add VERSION CHANGELOG.md
git commit -m "chore: Release v1.4.0"
git push origin main

# 6. Announce release
# Post in team channel, notify stakeholders
```

## File Structure

```
MVP-EVENT-TOOLKIT/
├── .env                                    # Local development config (gitignored)
├── postman/environments/
│   ├── mvp-event-toolkit-local.json       # @HEAD deployment
│   ├── mvp-event-toolkit-staging.json     # Staging deployment
│   └── mvp-event-toolkit-prod.json        # Production deployment
├── CHANGELOG.md                            # Version history
├── VERSION                                 # Current version number
└── DEVOPS-WORKFLOW.md                      # This file
```

## Configuration Management

### Environment Files

**Local (.env)** - For Playwright
```bash
BASE_URL=https://script.google.com/macros/s/[HEAD_ID]/exec
BRAND_ID=root
ADMIN_KEY=4a249d9791716c208479712c74aae27a
```

**Postman Local** - For Newman (@HEAD)
```json
{
  "name": "Local Development",
  "values": [
    {"key": "baseUrl", "value": "https://script.google.com/macros/s/[HEAD_ID]/exec"},
    {"key": "adminKey", "value": "4a249d9791716c208479712c74aae27a"}
  ]
}
```

**Postman Staging** - Versioned deployment
```json
{
  "name": "Staging",
  "values": [
    {"key": "baseUrl", "value": "https://script.google.com/macros/s/[VERSION_7_ID]/exec"},
    {"key": "adminKey", "value": "4a249d9791716c208479712c74aae27a"}
  ]
}
```

**Postman Production** - Versioned deployment
```json
{
  "name": "Production",
  "values": [
    {"key": "baseUrl", "value": "https://script.google.com/macros/s/[VERSION_8_ID]/exec"},
    {"key": "adminKey", "value": "[PRODUCTION_KEY]"}  // Different key!
  ]
}
```

## Testing Strategy

### Test Pyramid

```
                    ┌─────────────┐
                    │   Manual    │  Manual exploratory testing
                    │     QA      │  User acceptance testing
                    └─────────────┘
                   ┌───────────────┐
                   │   E2E Tests   │  Playwright browser tests
                   │  (Slow, ~6h)  │  Full user journeys
                   └───────────────┘
              ┌──────────────────────┐
              │   Integration Tests  │  Newman API flow tests
              │    (Medium, ~2min)   │  Multi-step scenarios
              └──────────────────────┘
         ┌───────────────────────────────┐
         │      Unit Tests               │  Jest tests (fast, ~2s)
         │  (Fast, run constantly)       │  Business logic validation
         └───────────────────────────────┘
```

### When to Run Each

**Every Code Change (Pre-commit)**
```bash
npm run test:jest
```

**After Every Push to @HEAD**
```bash
npm run push && sleep 30
npm run test:newman:smoke
```

**Before Creating Staging Deployment**
```bash
npm run test:jest
npm run test:newman -- -e postman/environments/mvp-event-toolkit-staging.json
npm run test:e2e
```

**Before Production Release**
```bash
# Full regression suite
./run-all-tests.sh -- -e postman/environments/mvp-event-toolkit-staging.json
# Plus manual QA
```

## Deployment Authorization

### One-Time Setup Per Deployment

When creating any new deployment (@HEAD or versioned):

1. **Set "Who has access"**
   - Development/Staging: "Anyone" (for automated tests)
   - Production: "Anyone" (if public) or "Only myself" (if private)

2. **Authorize**
   - Click "Authorize access" when prompted
   - Review permissions carefully
   - Click "Allow"
   - **Wait for "Deployment successful"**

3. **Verify**
   ```bash
   # Test in incognito browser
   curl "https://script.google.com/macros/s/[DEPLOYMENT_ID]/exec?p=status&brand=root"
   # Should return JSON, not HTML
   ```

### Common Authorization Issues

**Problem**: "Moved Temporarily" redirect
**Cause**: "Anyone" not properly set or not authorized
**Fix**: Edit deployment → Change to "Anyone" → Deploy → Authorize

**Problem**: Tests pass in browser, fail from curl
**Cause**: Authorization cached in browser but not for API
**Fix**: Open deployment URL in incognito, verify JSON response

## Version Numbering

### Semantic Versioning (SemVer)

```
v[MAJOR].[MINOR].[PATCH]

Example: v1.4.2

MAJOR: Breaking changes (v1 → v2)
MINOR: New features (v1.3 → v1.4)
PATCH: Bug fixes (v1.4.1 → v1.4.2)
```

### Deployment Naming

```
Description format: "v[VERSION] - [ENVIRONMENT]"

Examples:
- "v1.4.0 - Staging"
- "v1.4.0 - Production"
- "v1.4.1 - Hotfix Production"
```

### Git Tags

```bash
# Staging
git tag v1.4.0-staging
git push origin v1.4.0-staging

# Production
git tag v1.4.0
git push origin v1.4.0

# View tags
git tag -l
```

## Rollback Procedure

### If Production Has Issues

**Option 1: Quick Rollback (Use Previous Deployment)**

```bash
# In Apps Script: Deploy → Manage deployments
# Find previous working version (e.g., @7)
# Copy its URL

# Update production environment
./update-deployment-url.sh "https://script.google.com/macros/s/[PREVIOUS_VERSION]/exec"

# Update production postman environment
# Edit postman/environments/mvp-event-toolkit-prod.json

# Verify
npm run test:newman:smoke -- -e postman/environments/mvp-event-toolkit-prod.json

# Notify users
echo "Rolled back to v1.3.0 due to issues in v1.4.0"
```

**Option 2: Hotfix (Fix and Redeploy)**

```bash
# Create hotfix branch
git checkout v1.4.0
git checkout -b hotfix/critical-bug

# Fix the bug
# Edit code

# Test thoroughly
npm run test:jest
npm run push && sleep 30
npm run test:newman:smoke

# Deploy hotfix
# In Apps Script: Deploy → New deployment
# Description: "v1.4.1 - Production Hotfix"

# Tag
git tag v1.4.1
git push origin v1.4.1

# Merge back to main
git checkout main
git merge hotfix/critical-bug
git push origin main
```

## Monitoring and Alerts

### Health Checks

**Automated Monitoring (Set up cron job)**
```bash
# Every 15 minutes
*/15 * * * * curl -f "https://script.google.com/macros/s/[PROD_ID]/exec?p=status&brand=root" || echo "ALERT: Production down"
```

**Manual Checks**
```bash
# Check deployment status
./fix-deployment.sh

# Run smoke tests
npm run test:newman:smoke -- -e postman/environments/mvp-event-toolkit-prod.json
```

## Documentation Requirements

### For Every Release

- [ ] Update CHANGELOG.md with changes
- [ ] Update VERSION file
- [ ] Update README.md if API changed
- [ ] Update test cases if features added
- [ ] Create release notes
- [ ] Update deployment URLs in docs

### For Breaking Changes

- [ ] Migration guide for users
- [ ] Deprecation warnings (one release ahead)
- [ ] Update major version number
- [ ] Announcement to all stakeholders

## Team Collaboration

### Branch Strategy

```
main
├── feature/forms-templates
├── feature/analytics-dashboard
├── hotfix/critical-auth-bug
└── release/v1.4.0
```

### PR Requirements

Before merge to main:
- [ ] All tests pass (CI/CD)
- [ ] Code review approved (1+ reviewers)
- [ ] Documentation updated
- [ ] No merge conflicts
- [ ] Follows coding standards

### Communication

**Daily Standups**: What's deployed where
**Release Notes**: What changed, how to test
**Incident Reports**: What broke, how we fixed it, how to prevent

## CI/CD Integration (Future)

### GitHub Actions Workflow

```yaml
name: Test and Deploy

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run Jest tests
        run: npm run test:jest
      - name: Deploy to @HEAD
        run: npm run push
      - name: Run Newman smoke tests
        run: npm run test:newman:smoke

  deploy-staging:
    needs: test
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Create staging deployment
        # Script to create new versioned deployment
      - name: Run full test suite
        run: ./run-all-tests.sh
```

## Summary: The Golden Path

### Daily Development
1. Code → Jest tests → Push to @HEAD → Smoke test
2. Commit → Push to Git → PR → Review → Merge

### Weekly Release
1. Merge features to main
2. Create staging deployment (versioned)
3. Run full test suite on staging
4. Manual QA on staging
5. Create production deployment
6. Smoke test production
7. Tag and document

### Emergency Hotfix
1. Create hotfix branch from production tag
2. Fix → Test → Deploy new version
3. Verify → Tag → Merge back to main

This process ensures:
- ✅ Fast iteration with @HEAD
- ✅ Thorough testing before production
- ✅ Easy rollback if needed
- ✅ Clear audit trail (git tags)
- ✅ No surprises in production
