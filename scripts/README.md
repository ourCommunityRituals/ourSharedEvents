# Scripts Directory

This directory contains helper scripts for Clasp deployment, authentication, and automation.

## 🎯 Quick Reference

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `run-ci-local.js` | Interactive CI runner with gates | Mirror CI pipeline locally |
| `validate-clasp-setup.sh` | Validate local Clasp configuration | Before configuring GitHub Actions secrets |
| `refresh-clasp-auth.sh` | Refresh OAuth credentials | When tokens expire or authentication fails |
| `dev-deploy.sh` | Development deployment | During local development |
| `create-staging.sh` | Create staging deployment | For testing before production |
| `tag-staging.sh` | Tag staging deployment | Mark a staging version |
| `promote-to-production.sh` | Promote to production | Deploy staging to production |

## 🚦 Local CI Parity Commands (NEW)

These commands mirror the GitHub Actions CI/CD pipeline for local development:

### npm Commands

| Command | Purpose | Mirrors |
|---------|---------|---------|
| `npm run test:ci:stage1` | Run Stage 1 tests (lint, unit, contract) | Stage 1 GitHub Actions |
| `npm run test:ci:stage2` | Run Stage 2 tests (Playwright e2e) | Stage 2 GitHub Actions |
| `npm run test:ci:quick` | Run critical tests only (fast) | Quick validation |
| `npm run ci:local` | Interactive CI runner with progressive gating | Full CI pipeline |

### Interactive CI Runner (`run-ci-local.js`)

**Purpose:** Full CI pipeline locally with progressive gating - tests stop on first failure.

**Usage:**
```bash
npm run ci:local
```

**What it does:**
1. **Gate 1:** Linting (ESLint)
2. **Gate 2:** Unit tests (Jest)
3. **Gate 3:** Contract tests (API contracts)
4. **Gate 4:** E2E Smoke tests (if Stage 2 enabled)
5. **Gate 5:** E2E Page tests (if all gates pass)
6. **Gate 6:** E2E Flow tests (if all gates pass)

**Flags:**
- `--stage1-only` - Only run Stage 1 tests
- `--stage2-only` - Only run Stage 2 tests
- `--skip-lint` - Skip linting gate
- `--verbose` - Show full test output

**Example:**
```bash
# Full CI run
npm run ci:local

# Stage 1 only (quick validation)
npm run test:ci:stage1

# Stage 2 only (e2e tests)
npm run test:ci:stage2
```

---

## 📋 Clasp Authentication & Validation Scripts

### `validate-clasp-setup.sh`

**Purpose:** Comprehensive validation of local Clasp setup before configuring GitHub Actions.

**Usage:**
```bash
./scripts/validate-clasp-setup.sh
```

**What it checks:**
- ✅ Clasp installation and version
- ✅ `.clasprc.json` exists and is valid JSON
- ✅ OAuth `access_token` field exists (nested or flat structure)
- ✅ OAuth `refresh_token` field exists
- ✅ Token expiration status
- ✅ `.clasp.json` exists and contains valid Script ID
- ✅ Connection to Google Apps Script API

**Output:**
- Success/error messages for each check
- Preview of `.clasprc.json` (with credentials redacted)
- Ready-to-use values for GitHub secrets
- Summary of warnings and errors

**When to run:**
- ✅ Before configuring GitHub Actions for the first time
- ✅ After running `clasp login`
- ✅ When GitHub Actions deployment starts failing
- ✅ After updating Clasp or Node.js versions
- ✅ When troubleshooting authentication issues

**Example output:**
```
🔍 Clasp Setup Validation Tool
================================

Step 1: Checking Clasp Installation
------------------------------------
✅ Clasp is installed (version: 2.4.2)

Step 2: Checking .clasprc.json (OAuth Credentials)
---------------------------------------------------
✅ Found .clasprc.json at /Users/you/.clasprc.json
✅ CLASPRC_JSON is valid JSON
✅ Found OAuth access_token field
✅ Found OAuth refresh_token field
✅ OAuth token is not expired

...

Summary
=======
✅ All validations passed! Your Clasp setup is ready for GitHub Actions.
```

---

### `refresh-clasp-auth.sh`

**Purpose:** Interactive script to refresh Clasp OAuth credentials and prepare GitHub secret values.

**Usage:**
```bash
./scripts/refresh-clasp-auth.sh
```

**What it does:**
1. Logs out from current Clasp session
2. Opens browser for Google OAuth re-authentication
3. Validates new credentials
4. Displays ready-to-paste values for GitHub secrets
5. Optionally copies values to clipboard

**When to run:**
- ✅ When OAuth tokens expire (after ~6 months)
- ✅ When GitHub Actions shows "Invalid token" or "Token expired"
- ✅ After changing Google account passwords
- ✅ When switching Google accounts for deployment
- ✅ When setting up Clasp on a new machine

**Interactive steps:**
```
Step 1: Logout from current session
Step 2: Login to Clasp (opens browser)
Step 3: Validate new credentials
Step 4: Get Script ID
Step 5: Prepare GitHub Secret Values (displays formatted output)
Step 6: Update GitHub Secrets (instructions)
```

**Output includes:**
- Complete CLASPRC_JSON value (formatted for copy/paste)
- SCRIPT_ID value
- Direct link to GitHub secrets settings
- Step-by-step instructions for updating secrets

---

## 🚀 Deployment Scripts

### `dev-deploy.sh`

**Purpose:** Quick deployment for local development.

**Usage:**
```bash
./scripts/dev-deploy.sh
```

**What it does:**
- Creates a development deployment
- Tags with timestamp
- Returns deployment URL

**When to use:**
- During active development
- For quick testing of changes
- Before creating staging deployment

---

### `create-staging.sh`

**Purpose:** Create a staging deployment for pre-production testing.

**Usage:**
```bash
./scripts/create-staging.sh
```

**What it does:**
- Creates a staging deployment
- Tags with "staging" label
- Generates unique deployment ID
- Returns staging URL

**When to use:**
- Before promoting to production
- For QA and testing
- To share with stakeholders

---

### `tag-staging.sh`

**Purpose:** Tag a specific deployment as "staging".

**Usage:**
```bash
./scripts/tag-staging.sh <deployment-id>
```

**What it does:**
- Tags an existing deployment as staging
- Updates deployment metadata

**When to use:**
- After validating a deployment
- To mark a specific version for testing

---

### `promote-to-production.sh`

**Purpose:** Promote a staging deployment to production.

**Usage:**
```bash
./scripts/promote-to-production.sh <staging-deployment-id>
```

**What it does:**
- Verifies staging deployment is working
- Creates production deployment
- Tags as "production"
- Returns production URL

**When to use:**
- After successful staging validation
- When ready to release to production

---

## 🔧 Script Permissions

All scripts should be executable. If you get a "permission denied" error, run:

```bash
chmod +x scripts/*.sh
```

Or for a specific script:
```bash
chmod +x scripts/validate-clasp-setup.sh
```

---

## 🌐 Environment Requirements

### Required Tools

**For all scripts:**
- `bash` (v4.0+)
- `jq` - JSON processor
  - Install: `brew install jq` (macOS)
  - Install: `apt-get install jq` (Ubuntu/Debian)
  - Install: `choco install jq` (Windows)

**For authentication scripts:**
- `@google/clasp` - Google Apps Script CLI
  - Install: `npm install -g @google/clasp`
- `node` and `npm`

**Optional (for clipboard support):**
- `pbcopy` (macOS - built-in)
- `xclip` (Linux - `apt-get install xclip`)
- `clip` (Windows - built-in)

---

## 📚 Integration with GitHub Actions

These scripts are designed to work alongside the GitHub Actions CI/CD pipeline defined in `.github/workflows/ci.yml`.

**Workflow:**
1. **Local Development:**
   - Use `validate-clasp-setup.sh` to verify setup
   - Use `dev-deploy.sh` for quick testing

2. **Configure GitHub Actions:**
   - Run `refresh-clasp-auth.sh` to get latest credentials
   - Update GitHub secrets with provided values

3. **Deployment Pipeline:**
   - Push to feature branch → Runs tests only
   - Merge to main → Deploys to production automatically

4. **When tokens expire:**
   - Run `refresh-clasp-auth.sh` again
   - Update GitHub secrets
   - Push to trigger new deployment

---

## 🐛 Troubleshooting

### "command not found: jq"

**Solution:**
```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq

# Windows (with Chocolatey)
choco install jq
```

---

### "permission denied: ./scripts/validate-clasp-setup.sh"

**Solution:**
```bash
chmod +x scripts/validate-clasp-setup.sh
```

---

### "clasp: command not found"

**Solution:**
```bash
npm install -g @google/clasp
```

---

### Script runs but shows errors

**Check:**
1. You're in the project root directory
2. You've run `clasp login` at least once
3. `.clasp.json` exists in project root
4. `~/.clasprc.json` exists in your home directory

**Debug:**
```bash
# Verify project structure
ls -la | grep clasp

# Verify home directory credentials
ls -la ~/.clasprc.json

# Re-run with verbose output
bash -x ./scripts/validate-clasp-setup.sh
```

---

## 📖 Related Documentation

- [Clasp Setup Guide](../CLASP_SETUP.md) - Initial Clasp configuration
- [Deployment Flow](../docs/DEPLOYMENT_FLOW.md) - Complete CI/CD pipeline
- [GitHub Actions Debugging](../docs/CLASP_GITHUB_ACTIONS_DEBUG.md) - Troubleshooting guide
- [CI/CD Workflow](../.github/workflows/ci.yml) - GitHub Actions configuration

---

## 🎯 Best Practices

### Before GitHub Actions Setup
1. ✅ Run `validate-clasp-setup.sh`
2. ✅ Fix any errors or warnings
3. ✅ Copy values to GitHub secrets
4. ✅ Test with a push to feature branch

### When Authentication Fails
1. ✅ Run `refresh-clasp-auth.sh`
2. ✅ Update GitHub secrets
3. ✅ Test locally: `npm run push`
4. ✅ Push to GitHub to verify

### Regular Maintenance
- 🔄 Refresh credentials every 6 months
- 🔄 Run validation after system updates
- 🔄 Keep Clasp updated: `npm update -g @google/clasp`

---

**Last Updated:** 2025-11-22
**Version:** 1.1
