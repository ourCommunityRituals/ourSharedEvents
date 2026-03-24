# Process Summary - Quick Reference

This document provides quick commands for the most common workflows. For detailed explanations, see [DEVOPS-WORKFLOW.md](DEVOPS-WORKFLOW.md).

## Daily Development

### Make Changes and Test

```bash
# 1. Make your code changes
# 2. Run this script (tests + deploys + verifies)
./scripts/dev-deploy.sh
```

**That's it!** This single script:
- Runs Jest unit tests
- Pushes to @HEAD
- Waits for propagation
- Verifies deployment
- Runs smoke tests

### Commit Your Work

```bash
git add .
git commit -m "feat: Your feature description"
git push origin your-branch-name
```

## Weekly Staging Release

### Create Staging Deployment

```bash
# Run full test suite and prepare for deployment
./scripts/create-staging.sh 1.4.0

# Follow the prompts to create deployment in Apps Script UI
# Then tag it:
./scripts/tag-staging.sh 1.4.0 <DEPLOYMENT_URL>
```

### Run Full Tests on Staging

```bash
npm run test:jest
npm run test:newman -- -e postman/environments/mvp-event-toolkit-staging.json
npm run test:e2e
```

## Production Release

### Promote to Production

```bash
# This script guides you through production release
./scripts/promote-to-production.sh 1.4.0
```

It will:
- Verify all prerequisites
- Guide you through creating production deployment
- Run smoke tests
- Create git tag
- Update VERSION file

## Quick Commands

### Testing

```bash
# Unit tests (run constantly during development)
npm run test:jest

# Quick smoke test
npm run test:newman:smoke

# Full API test suite
npm run test:newman

# E2E browser tests (~6 hours)
npm run test:e2e

# Everything
./run-all-tests.sh
```

### Deployment Management

```bash
# Check deployment status
./fix-deployment.sh

# Use @HEAD (auto-updating)
./use-head-deployment.sh

# Switch to specific deployment
./update-deployment-url.sh <URL>
```

### Environment Management

```bash
# Local development (uses @HEAD)
npm run test:newman:smoke

# Staging environment
npm run test:newman:smoke -- -e postman/environments/mvp-event-toolkit-staging.json

# Production environment
npm run test:newman:smoke -- -e postman/environments/mvp-event-toolkit-prod.json
```

## Three-Environment Strategy

```
@HEAD Deployment (auto-updates)
├── Used for: Daily development
├── Updates: Every 'npm run push'
└── Environment: mvp-event-toolkit-local.json

Staging Deployment (versioned, e.g., @7)
├── Used for: QA and testing
├── Updates: Manual (create new version)
└── Environment: mvp-event-toolkit-staging.json

Production Deployment (versioned, e.g., @8)
├── Used for: Live users
├── Updates: Manual (promote from staging)
└── Environment: mvp-event-toolkit-prod.json
```

## Common Scenarios

### "I made changes and want to test them"

```bash
./scripts/dev-deploy.sh
```

### "Tests are failing"

```bash
# Diagnose deployment
./fix-deployment.sh

# Check which environment you're using
grep baseUrl postman/environments/mvp-event-toolkit-local.json

# Verify @HEAD has latest code
npm run push && sleep 30
./use-head-deployment.sh
```

### "I need to rollback production"

```bash
# Option 1: Use previous deployment
# In Apps Script: Deploy → Manage deployments
# Copy previous version URL
./update-deployment-url.sh <PREVIOUS_URL>

# Update production environment file
sed -i "s|https://script.google.com/macros/s/[^\"]*|<PREVIOUS_URL>|g" postman/environments/mvp-event-toolkit-prod.json

# Option 2: Deploy hotfix (see DEVOPS-WORKFLOW.md)
```

### "Deployment authorization not working"

```bash
# Test in incognito browser
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?p=status&brand=root

# Should return JSON, not HTML redirect
# If redirect, edit deployment:
#   Deploy → Manage deployments → Edit
#   Who has access: Anyone → Deploy → Authorize
```

## Files to Commit

### Always Commit

- Source code (`*.gs`, `*.html`)
- Tests (`tests/**/*.js`)
- Package files (`package.json`, `package-lock.json`)
- Documentation (`*.md`)
- Environment configs (`postman/environments/*.json`)

### Never Commit (in .gitignore)

- `.env` (local secrets)
- `node_modules/`
- Test reports (`newman-reports/`, `playwright-report/`)
- `.clasp.json` (contains local paths)

## Quality Gates

### Before Committing

```bash
npm run test:jest  # Must pass
```

### Before Creating Staging

```bash
npm run test:jest          # Must pass
npm run test:newman:smoke  # Must pass
npm run test:e2e           # Recommended
```

### Before Production

```bash
# All tests on staging must pass
npm run test:jest
npm run test:newman -- -e postman/environments/mvp-event-toolkit-staging.json
npm run test:e2e
# Plus manual QA sign-off
```

## Emergency Contacts / Escalation

### Deployment Completely Broken

1. Check [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) troubleshooting section
2. Run `./fix-deployment.sh` for diagnostics
3. Check Apps Script execution logs in the UI
4. Rollback to previous working deployment

### Tests Suddenly Failing

1. Check if code was recently pushed: `git log -1`
2. Verify deployment URL is correct: `./fix-deployment.sh`
3. Check deployment authorization: Test in incognito browser
4. Check Google Apps Script status page for outages

### Need to Revert Changes

```bash
# Revert last commit
git revert HEAD
git push origin main

# Deploy reverted code
npm run push && sleep 30
./use-head-deployment.sh
```

## Helpful Links

- [Full DevOps Workflow](DEVOPS-WORKFLOW.md) - Comprehensive process documentation
- [Deployment Guide](DEPLOYMENT-GUIDE.md) - Deployment troubleshooting
- [Test Execution Summary](TEST-EXECUTION-SUMMARY.md) - Test suite overview
- Apps Script Project: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit

## Script Reference

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `dev-deploy.sh` | Daily development deployment | After every code change |
| `create-staging.sh` | Prepare staging release | Weekly or before major releases |
| `tag-staging.sh` | Tag and test staging | After creating staging deployment |
| `promote-to-production.sh` | Release to production | After full QA on staging |
| `use-head-deployment.sh` | Switch to @HEAD | Development work |
| `fix-deployment.sh` | Diagnose issues | When tests fail |
| `update-deployment-url.sh` | Change deployment URL | Manual deployment switching |
| `run-all-tests.sh` | Run complete test suite | Before releases |
| `debug-newman.sh` | Debug API tests | Newman test failures |

## Questions?

See [DEVOPS-WORKFLOW.md](DEVOPS-WORKFLOW.md) for detailed explanations of every step.
