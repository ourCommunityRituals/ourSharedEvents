# Deployment Pipeline Documentation

Complete guide to the CI/CD pipeline from local code to production.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DEPLOYMENT PIPELINE                           │
└─────────────────────────────────────────────────────────────────────┘

Local Development
      ↓
Git Commit & Push
      ↓
GitHub Repository
      ↓
┌─────────────────────────────────────────────────────────────────────┐
│              STAGE 1 - BUILD & DEPLOY (stage1-deploy.yml)           │
├─────────────────────────────────────────────────────────────────────┤
│  1. Lint (ESLint)                                                   │
│     ├─ Code style check                                             │
│     └─ PASS → Continue                                              │
│                                                                      │
│  2. Unit Tests (Jest)                                               │
│     ├─ Backend logic tests                                          │
│     ├─ Security tests (XSS, CSRF, JWT)                              │
│     ├─ Input sanitization                                           │
│     └─ PASS → Continue                                              │
│                                                                      │
│  3. Contract Tests (Jest)                                           │
│     ├─ API response format validation                               │
│     ├─ OK/Err envelope structure                                    │
│     ├─ Triangle contract tests (before/during/after/all)            │
│     └─ PASS → Continue                                              │
│                                                                      │
│  4. Deploy (clasp) - MAIN BRANCH ONLY                               │
│     ├─ Validate OAuth credentials                                   │
│     ├─ Write .clasprc.json from secrets                             │
│     ├─ clasp push --force                                           │
│     ├─ clasp deploy (update existing or create new)                 │
│     ├─ Extract deployment ID and URL                                │
│     └─ Update Cloudflare Worker (automated wrangler)                │
│                                                                      │
│  5. Generate Brand URLs                                             │
│     ├─ root, abc, cbc, cbl brands                                   │
│     └─ Save deployment URL for Stage 2                              │
└─────────────────────────────────────────────────────────────────────┘
      ↓ (auto-triggers on main branch)
┌─────────────────────────────────────────────────────────────────────┐
│         STAGE 2 - SEQUENTIAL PROGRESSIVE TESTING                    │
│                    (stage2-testing.yml)                             │
├─────────────────────────────────────────────────────────────────────┤
│  1. Setup                                                           │
│     └─ Extract deployment URL from Stage 1 artifact                 │
│                                                                      │
│  2. 🔥 API Tests (Critical - Always Run First)                      │
│     ├─ Validates REST endpoints                                     │
│     └─ PASS → Gate 1                                                │
│                                                                      │
│  🚦 GATE 1: Check API Results                                       │
│     ├─ PASS → Continue to Smoke Tests                               │
│     └─ FAIL → STOP (Skip all remaining tests)                       │
│                                                                      │
│  3. 🔥 Smoke Tests (Critical)                                       │
│     ├─ Quick page load checks                                       │
│     ├─ Core UI elements present                                     │
│     └─ PASS → Gate 2                                                │
│                                                                      │
│  🚦 GATE 2: Check Smoke Results                                     │
│     ├─ PASS → Continue to Expensive Tests                           │
│     └─ FAIL → STOP (Skip expensive tests)                           │
│                                                                      │
│  4. 💰 Expensive Tests (Parallel)                                   │
│     ├─ Flow Tests (multi-step user workflows)                       │
│     ├─ Page Tests (comprehensive page validation)                   │
│     └─ PASS → Quality Gate                                          │
│                                                                      │
│  🎯 QUALITY GATE: Final Validation                                  │
│     └─ All tests passed → Deployment Complete ✅                    │
└─────────────────────────────────────────────────────────────────────┘
      ↓
Google Apps Script (Production)
https://script.google.com/u/0/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
      ↓
Live Web App URLs
├─ Apps Script: https://script.google.com/macros/s/[DEPLOYMENT_ID]/exec
└─ Cloudflare:  https://eventangle.com
```

## Prerequisites

### Local Development

1. **Node.js & npm**
   ```bash
   node --version  # v18+
   npm --version   # v9+
   ```

2. **Google Clasp CLI**
   ```bash
   npm install -g @google/clasp
   clasp login
   ```

3. **Project Dependencies**
   ```bash
   npm install
   ```

4. **Environment Setup**
   ```bash
   # .clasp.json (local only, gitignored)
   {
     "scriptId": "1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l",
     "rootDir": "."
   }
   ```

### GitHub Secrets (Required for CI/CD)

Configure in: `Settings → Secrets and variables → Actions`

| Secret Name | Description | How to Get |
|-------------|-------------|------------|
| `OAUTH_CREDENTIALS` | Google OAuth credentials (clasp) | `cat ~/.clasprc.json` |
| `DEPLOYMENT_ID` | Existing deployment ID to update | From `clasp deployments` |
| `ADMIN_KEY_ROOT` | Admin secret for E2E testing | From Config.gs |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token for Worker deploys | Cloudflare dashboard |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | Cloudflare dashboard |

**Getting OAUTH_CREDENTIALS:**
```bash
# After clasp login
cat ~/.clasprc.json

# Copy entire JSON:
{
  "token": {
    "access_token": "...",
    "refresh_token": "...",
    "scope": "...",
    "token_type": "Bearer",
    "expiry_date": ...
  },
  "oauth2ClientSettings": {...},
  "isLocalCreds": false
}
```

**Getting Cloudflare Credentials:**
```bash
# 1. Create API Token at https://dash.cloudflare.com/profile/api-tokens
#    - Use template: "Edit Cloudflare Workers"
#    - Or custom with Workers:Edit permission

# 2. Get Account ID from Cloudflare dashboard
#    - Workers & Pages → Overview → Account ID (right sidebar)

# 3. Add to GitHub Secrets:
#    - CLOUDFLARE_API_TOKEN
#    - CLOUDFLARE_ACCOUNT_ID
```

## Local Deployment

### Quick Deploy (Recommended)

```bash
# 1. Make your changes
# 2. Commit to git
git add .
git commit -m "feat: your changes"

# 3. Push to main branch (triggers full CI/CD with deployment)
git push -u origin main

# Or push to feature branch (triggers tests only, no deploy)
git push -u origin feature/my-feature
```

### Manual Deploy

```bash
# 1. Push code to Apps Script
npm run push
# or: clasp push

# 2. Deploy new version
npm run deploy
# or: clasp deploy --description "Manual deploy v1.3"

# 3. Get deployment URL
clasp deployments
```

### Cloudflare Workers Deployment

The Cloudflare Worker proxies requests to Google Apps Script, providing:
- Custom domain (eventangle.com)
- CORS headers for cross-origin requests
- Edge caching
- SSL/TLS termination

```bash
# 1. Install Wrangler CLI
npm install -g wrangler

# 2. Authenticate with Cloudflare
wrangler login

# 3. Deploy the Worker
cd cloudflare-proxy
wrangler deploy --env production

# 4. Verify deployment
curl "https://eventangle.com?p=status&brand=root"
```

**Configuration files:**
- `cloudflare-proxy/worker.js` - Worker code
- `cloudflare-proxy/wrangler.toml` - Deployment configuration

**Environment-specific deployments:**
```bash
# Production (eventangle.com)
wrangler deploy --env production

# Staging (staging.eventangle.com)
wrangler deploy --env staging

# Development (workers.dev subdomain)
wrangler deploy
```

### Local Testing (Before Push)

```bash
# Run linter
npm run lint

# Run unit tests
npm run test:unit

# Run contract tests
npm run test:contract

# Run all local tests (Jest)
npm test

# Run Triangle contract tests
npm run test:triangle:before:contract
npm run test:triangle:during:contract
npm run test:triangle:after:contract
npm run test:triangle:all:contract
```

## CI/CD Pipeline Details

### Pipeline Triggers

**Stage 1 (stage1-deploy.yml):**
- Push to `main` branch → Full pipeline + deployment
- Push to `claude/**` branches → Tests only (no deploy)
- Pull requests to `main` → Tests only

**Stage 2 (stage2-testing.yml):**
- Auto-triggered when Stage 1 completes successfully on `main`
- Manual trigger available with custom deployment URL

**Unit & Contract Tests (unit-contract-tests.yml):**
- Runs on ALL branches (every push)
- Pull requests to `main`

### Stage 1: Build & Deploy

#### 1.1 Linting (ESLint)

**What it checks:**
- Code style consistency
- Common errors
- Best practices

**Files checked:**
- `*.js` (JavaScript)
- `*.gs` (Google Apps Script)

**How to fix failures:**
```bash
npm run lint:fix
```

#### 1.2 Unit Tests (Jest)

**What it tests:**
- Backend utility functions
- Input sanitization (XSS prevention)
- Error envelope creation
- Data validation
- Security functions (CSRF, JWT, rate limiting)

**Test files:**
- `tests/unit/backend.test.js`
- `tests/unit/security.test.js`
- `tests/unit/validation.test.js`
- `tests/unit/rate-limiting.test.js`
- `tests/unit/forms.test.js`
- `tests/unit/multi-brand.test.js`
- `tests/unit/concurrency.test.js`
- `tests/unit/error-handling.test.js`
- `tests/unit/config.test.js`
- `tests/unit/shared-reporting.test.js`

#### 1.3 Contract Tests (Jest)

**What it validates:**
- API response structure
- OK envelope: `{ ok: true, value: {...} }`
- Err envelope: `{ ok: false, code: '...', message: '...' }`
- JWT security contracts
- Triangle API contracts (before/during/after event phases)

**Test files:**
- `tests/contract/api.contract.test.js`
- `tests/contract/jwt-security.contract.test.js`
- `tests/contract/all-endpoints.contract.test.js`

#### 1.4 Deployment (Main Branch Only)

**What it does:**
1. Validates OAuth credentials from `OAUTH_CREDENTIALS` secret
2. Writes credentials to `~/.clasprc.json`
3. Pushes all files to Apps Script via `clasp push --force`
4. Updates existing deployment (if `DEPLOYMENT_ID` set) or creates new
5. Extracts deployment ID and constructs web app URL
6. Updates Hostinger proxy via FTP (if FTP secrets configured)

**Requirements:**
- Must be on `main` branch
- Must be a `push` event (not PR)
- All previous stages passed
- Valid `OAUTH_CREDENTIALS` secret

**Output:**
- Deployment ID (e.g., `AKfycb...`)
- Web app URL
- Hostinger proxy updated

#### 1.5 Brand URL Generation

**Supported Brands:**
- `root` - Zeventbook (main brand)
- `abc` - American Bocce Co.
- `cbc` - Chicago Bocce Club
- `cbl` - Chicago Bocce League

**Generated URLs per brand:**
- Status: `?p=status&brand={brand}`
- Admin: `?page=admin&brand={brand}`
- Events: `?p=events&brand={brand}`
- Display: `?p=display&brand={brand}`
- Sponsor: `?p=sponsor&brand={brand}`
- Public: `?p=public&brand={brand}`

### Stage 2: Sequential Progressive Testing

Stage 2 uses a progressive testing strategy to **fail fast** and **save test time**.

#### 2.1 API Tests (Critical)

**Always runs first. If these fail, all other tests are skipped.**

**What it tests:**
- REST API endpoint health
- Response format validation
- Authentication endpoints
- Data retrieval endpoints

**Command:** `npm run test:api`

#### 🚦 Gate 1: API Results Check

- **PASS** → Proceed to Smoke Tests
- **FAIL** → Stop pipeline, skip all remaining tests

#### 2.2 Smoke Tests (Critical)

**Quick validation of deployment. Runs only if API tests pass.**

**What it checks:**
- All pages load (200 status)
- Core UI elements present
- No JavaScript errors
- Basic responsive behavior

**Duration:** ~30-60 seconds

**Command:** `npm run test:smoke`

#### 🚦 Gate 2: Smoke Results Check

- **PASS** → Proceed to Expensive Tests
- **FAIL** → Stop pipeline, skip expensive tests

#### 2.3 Expensive Tests (Flow + Page)

**Run in parallel. Only if smoke tests pass.**

**Flow Tests:**
- Multi-step user workflows
- Admin creates event
- Public views event
- Sponsor management flows

**Page Tests:**
- Comprehensive page validation
- All UI components
- Cross-browser compatibility

**Command:** `npm run test:flows` and `npm run test:pages`

#### 🎯 Quality Gate: Final Validation

All tests must pass for deployment to be validated:
1. API Tests ✅
2. Smoke Tests ✅
3. Flow Tests ✅
4. Page Tests ✅

## Deployment URLs

### Multi-Platform Support

The application is deployed to two platforms:

| Platform | Base URL | Use Case |
|----------|----------|----------|
| **Apps Script** | `https://script.google.com/macros/s/{ID}/exec` | Direct Google access |
| **Cloudflare** | `https://eventangle.com` | Custom domain, Workers proxy |

### Production URLs by Brand

**ROOT (Eventangle):**
```
Status:  https://eventangle.com?p=status&brand=root
Admin:   https://eventangle.com?page=admin&brand=root
Events:  https://eventangle.com?p=events&brand=root
Display: https://eventangle.com?p=display&brand=root
```

**ABC (American Bocce Co.):**
```
Status:  https://eventangle.com?p=status&brand=abc
Admin:   https://eventangle.com?page=admin&brand=abc
Events:  https://eventangle.com?p=events&brand=abc
Display: https://eventangle.com?p=display&brand=abc
```

### Apps Script Project

**Project URL:**
https://script.google.com/u/0/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit

**Get deployment URL:**
```bash
clasp deployments
# Look for: https://script.google.com/macros/s/.../exec
```

## Testing the Deployment

### Quick Smoke Test

```bash
# Set environment variable (defaults to eventangle.com if not set)
export APP_URL="https://eventangle.com"

# Run smoke tests
npm run test:smoke
```

### Full E2E Test Suite

```bash
# Set environment variables
export APP_URL="https://eventangle.com"
export ADMIN_KEY="your-admin-secret"

# Run all Playwright tests
npm run test:api
npm run test:smoke
npm run test:flows
npm run test:pages
```

### Manual Browser Test

1. **Status Check:**
   ```
   {BASE_URL}?p=status&brand=root
   ```
   Should return: `{ ok: true, value: { build: "triangle-extended-v1.3" } }`

2. **Admin Page:**
   ```
   {BASE_URL}?page=admin&brand=root
   ```
   Should show event creation form

3. **Public Events Page:**
   ```
   {BASE_URL}?p=events&brand=root
   ```
   Should show event listing

4. **Display Page (TV Mode):**
   ```
   {BASE_URL}?p=display&brand=root
   ```
   Should show TV display layout

## Troubleshooting

### "clasp: command not found"

```bash
npm install -g @google/clasp
```

### "User has not enabled the Apps Script API"

1. Go to: https://script.google.com/home/usersettings
2. Enable "Google Apps Script API"

### "Cannot read property 'scriptId'"

Missing `.clasp.json`:
```bash
echo '{"scriptId":"1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l","rootDir":"."}' > .clasp.json
```

### "Push failed" or "Invalid credentials"

Re-authenticate:
```bash
clasp logout
clasp login
```

### GitHub Actions Deploy Fails

1. Check `OAUTH_CREDENTIALS` secret is set and valid JSON
2. Verify JSON has `token.access_token` and `token.refresh_token`
3. Check branch is `main` (deploy only runs on main)
4. View workflow logs for specific error messages

### Stage 2 Tests Fail

1. Check Stage 1 completed successfully
2. Verify deployment URL is accessible
3. Wait 30 seconds for deployment to propagate
4. Check `ADMIN_KEY_ROOT` secret is set for authenticated tests
5. Test manually in browser first

### Cloudflare Worker Not Updated

1. Verify Cloudflare secrets are configured:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
2. Check API token has Workers permissions
3. Manual update:
   ```bash
   cd cloudflare-proxy
   wrangler deploy --env production
   ```

## Best Practices

### Development Workflow

1. **Create feature branch from main**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make changes and test locally**
   ```bash
   npm run lint
   npm test
   ```

3. **Commit with conventional commits**
   ```bash
   git commit -m "feat: add new feature"
   git commit -m "fix: resolve bug"
   git commit -m "docs: update README"
   ```

4. **Push to GitHub**
   ```bash
   git push -u origin feature/my-feature
   ```

5. **Create Pull Request**
   - CI will run tests (unit, contract, security)
   - Merge to main after approval

6. **Deployment happens automatically**
   - Merge to main triggers Stage 1 (build + deploy)
   - Stage 2 auto-triggers (E2E tests)
   - Quality gate validates deployment

### Rollback Strategy

If deployment fails or has issues:

1. **Find previous deployment:**
   ```bash
   clasp deployments
   ```

2. **Undeploy bad version:**
   ```bash
   clasp undeploy [DEPLOYMENT_ID]
   ```

3. **Revert git commit:**
   ```bash
   git revert HEAD
   git push origin main
   ```

### Monitoring

**Check deployment logs:**
```bash
clasp logs
# or
clasp logs --watch
```

**View in Apps Script:**
https://script.google.com/home → Your Project → Executions

**GitHub Actions:**
Check the **Actions** tab for workflow status and logs.

## Quality Gates Summary

All of these must pass for deployment to succeed:

| Stage | Gate | Tool | Duration | Failure Action |
|-------|------|------|----------|----------------|
| 1 | Linting | ESLint | ~10s | Fix code style |
| 1 | Unit Tests | Jest | ~10s | Fix failing tests |
| 1 | Contract Tests | Jest | ~5s | Fix API contracts |
| 1 | Security Tests | Jest | ~5s | Fix security issues |
| 2 | API Tests | Playwright | ~30s | Fix API endpoints |
| 2 | Smoke Tests | Playwright | ~60s | Check deployment |
| 2 | Flow Tests | Playwright | ~2min | Fix user flows |
| 2 | Page Tests | Playwright | ~2min | Fix page issues |

## Performance Targets

| Metric | Target | Actual |
|--------|--------|--------|
| Status API response | < 500ms | ~200ms |
| Page load time | < 3s | ~1-2s |
| Stage 1 pipeline | < 5min | ~3-4min |
| Stage 2 pipeline | < 10min | ~5-8min |
| Test coverage | > 60% | 65%+ |

## Workflow Files Reference

| File | Purpose | Trigger |
|------|---------|---------|
| `stage1-deploy.yml` | Build, test, deploy | Push to main/claude/** |
| `stage2-testing.yml` | E2E testing | Auto after Stage 1 |
| `unit-contract-tests.yml` | Unit/contract tests | All branches |
| `quality-gates-scenarios.yml` | Scenario testing | Manual |
| `codeql-analysis.yml` | Security scanning | Push/PR |

## Next Steps

- [ ] Set up GitHub secrets (OAUTH_CREDENTIALS, ADMIN_KEY_ROOT)
- [ ] Configure Hostinger FTP secrets (optional for auto-proxy update)
- [ ] Test deployment manually: `npm run push && npm run deploy`
- [ ] Push to main branch to trigger full CI/CD
- [ ] Monitor GitHub Actions workflow
- [ ] Verify Stage 2 E2E tests pass
