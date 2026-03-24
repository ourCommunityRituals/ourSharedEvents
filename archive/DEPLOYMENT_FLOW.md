# Deployment and Testing Flow

This document visualizes the complete CI/CD pipeline from local development to production deployment and testing.

## 📊 Complete Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         LOCAL DEVELOPMENT                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Developer → Code Changes → Local Testing                            │
│                    ↓                                                 │
│              Git Commit & Push                                       │
│                    ↓                                                 │
└─────────────────────────────────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────────────┐
│                       GITHUB ACTIONS CI/CD                           │
│                      (.github/workflows/ci.yml)                      │
└─────────────────────────────────────────────────────────────────────┘
                     │
                     ↓
        ┌────────────┴────────────┐
        │                         │
        ↓                         ↓
┌──────────────┐         ┌──────────────┐
│   Lint Job   │         │  Test Job    │
│              │         │              │
│ • ESLint     │         │ • Unit Tests │
│ • Code Style │         │ • Coverage   │
└──────┬───────┘         └──────┬───────┘
       │                        │
       └────────────┬───────────┘
                    ↓
         ┌────────────────────┐
         │ Contract Tests Job │
         │                    │
         │ • API Contracts    │
         └──────────┬─────────┘
                    │
                    ↓
         ┌────────────────────┐
         │    Deploy Job      │
         │  (main branch)     │
         └──────────┬─────────┘
                    │
       ┌────────────┴─────────────────────┐
       │                                  │
       ↓                                  ↓
┌─────────────────┐           ┌──────────────────────┐
│ Setup & Secrets │           │  Clasp Deployment    │
│                 │           │                      │
│ • Validate      │           │ 1. Install Clasp     │
│   CLASPRC_JSON  │──────────→│ 2. Write credentials │
│ • Validate      │           │ 3. Validate JSON     │
│   SCRIPT_ID     │           │ 4. Push to Apps      │
└─────────────────┘           │    Script            │
                              │ 5. Create Deployment │
                              └──────────┬───────────┘
                                         │
                                         ↓
                              ┌──────────────────────┐
                              │ Google Apps Script   │
                              │                      │
                              │ • Web App Deployed   │
                              │ • URL Generated      │
                              └──────────┬───────────┘
                                         │
                                         ↓
                              ┌──────────────────────┐
                              │ Verify Deployment    │
                              │                      │
                              │ • Health Check       │
                              │ • Endpoint Tests     │
                              └──────────┬───────────┘
                                         │
                     ┌───────────────────┴───────────────────┐
                     │                                       │
                     ↓                                       ↓
          ┌────────────────────┐              ┌────────────────────┐
          │  E2E Smoke Tests   │              │  E2E Page Tests    │
          │     (Critical)     │              │   (Components)     │
          │                    │              │                    │
          │ 🚨 Critical paths  │              │ 📄 UI Components   │
          │ • Health endpoint  │              │ • Admin page       │
          │ • Auth system      │              │ • Display page     │
          │ • API basics       │              │ • Public page      │
          └─────────┬──────────┘              └─────────┬──────────┘
                    │                                   │
                    └──────────────┬────────────────────┘
                                   ↓
                        ┌────────────────────┐
                        │  E2E Flow Tests    │
                        │   (End-to-End)     │
                        │                    │
                        │ 🔄 Complete flows  │
                        │ • Admin flows      │
                        │ • Sponsor flows    │
                        │ • Customer flows   │
                        │ • Reporting flows  │
                        └─────────┬──────────┘
                                  │
                                  ↓
                        ┌────────────────────┐
                        │   Quality Gate     │
                        │   Final Validation │
                        │                    │
                        │ 🎯 Must ALL Pass:  │
                        │ • Lint ✅          │
                        │ • Tests ✅         │
                        │ • Contracts ✅     │
                        │ • Deploy ✅        │
                        │ • E2E Smoke ✅     │
                        │ • E2E Pages ✅     │
                        │ • E2E Flows ✅     │
                        └─────────┬──────────┘
                                  │
                   ┌──────────────┴───────────────┐
                   │                              │
                   ↓                              ↓
            ✅ SUCCESS                      ❌ FAILURE
         Pipeline Passed                  Pipeline Failed
    Ready for Production              Fix Issues & Retry
```

## 🔍 Detailed Job Breakdown

### 1. Lint Job
**Purpose:** Ensure code quality and style consistency

```bash
npm run lint
```

**What it checks:**
- ESLint rules compliance
- Code formatting
- Best practices

**When it runs:** On all pushes and pull requests

---

### 2. Test Job
**Purpose:** Run unit tests and generate coverage

```bash
npm test -- --coverage
```

**What it tests:**
- Unit tests for all modules
- Code coverage metrics
- Upload coverage to Codecov

**When it runs:** After lint passes

---

### 3. Contract Tests Job
**Purpose:** Validate API contracts

```bash
npm run test:contract
```

**What it validates:**
- API endpoint contracts
- Request/response schemas
- Integration points

**When it runs:** After unit tests pass

---

### 4. Deploy Job
**Purpose:** Deploy to Google Apps Script

**Critical Steps:**

#### Step 4a: Validate Secrets
```bash
# Check CLASPRC_JSON is set
if [ -z "${{ secrets.CLASPRC_JSON }}" ]; then
  echo "❌ ERROR: CLASPRC_JSON secret is not set!"
  exit 1
fi

# Check SCRIPT_ID is set
if [ -z "${{ secrets.SCRIPT_ID }}" ]; then
  echo "❌ ERROR: SCRIPT_ID secret is not set!"
  exit 1
fi
```

#### Step 4b: Write .clasprc.json
```bash
# Use heredoc to handle all special characters
cat > ~/.clasprc.json << 'EOF'
${{ secrets.CLASPRC_JSON }}
EOF
```

**Why heredoc?**
- ✅ Handles quotes (single, double)
- ✅ Handles backslashes
- ✅ Handles newlines
- ✅ Prevents shell interpretation
- ✅ GitHub Actions expands `${{ }}` before bash sees it

#### Step 4c: Validate JSON
```bash
# Validate JSON format
if ! jq empty ~/.clasprc.json 2>/dev/null; then
  echo "❌ ERROR: CLASPRC_JSON is not valid JSON!"
  echo "Please check the CLASPRC_JSON secret format."
  echo "The secret must be valid JSON. Use 'jq' to validate locally before adding to GitHub secrets."
  exit 1
fi
```

#### Step 4d: Validate OAuth Fields
```bash
# Support both nested and flat OAuth structures
if ! jq -e '.token.access_token // .access_token' ~/.clasprc.json >/dev/null 2>&1; then
  echo "❌ ERROR: Missing required OAuth access_token field!"
  exit 1
fi
```

#### Step 4e: Push to Apps Script
```bash
clasp push --force
```

#### Step 4f: Create Deployment
```bash
DEPLOYMENT_ID=$(clasp deploy --description "CI Deploy $(date)" | grep -oP '(?<=@)\S+')
echo "deployment_id=$DEPLOYMENT_ID" >> $GITHUB_OUTPUT
```

**When it runs:** Only on `main` branch pushes

**Outputs:**
- `deployment_id`: The Apps Script deployment ID
- `url`: The deployed web app URL

---

### 5. Verify Deployment Job
**Purpose:** Ensure deployment is accessible and healthy

```bash
./verify-deployment.sh "$BASE_URL"
```

**What it checks:**
- Web app is accessible
- Health endpoint responds
- Basic API functionality

**When it runs:** After successful deployment

---

### 6. E2E Smoke Tests (Critical)
**Purpose:** Verify critical user paths work

```bash
npm run test:smoke
```

**What it tests:**
- 🚨 **Critical paths only**
- Health endpoint
- Authentication system
- Basic API operations
- Security fundamentals

**Test files:** `tests/e2e/1-smoke/critical-smoke.spec.js`

**When it runs:** After deployment verification

**Why critical?** If these fail, the app is broken!

---

### 7. E2E Page Tests (Components)
**Purpose:** Test individual UI components

```bash
npm run test:pages
```

**What it tests:**
- 📄 **UI component functionality**
- Admin page features
- Display page features
- Public page features
- Test page features

**Test files:** `tests/e2e/2-pages/*.spec.js`

**When it runs:** After smoke tests pass

---

### 8. E2E Flow Tests (End-to-End)
**Purpose:** Test complete user workflows

```bash
npm run test:flows
```

**What it tests:**
- 🔄 **Complete user journeys**
- Admin workflows (create events, manage sponsors)
- Sponsor workflows (submit info, update data)
- Customer workflows (view events, interact)
- Reporting workflows (generate reports, export data)
- Advanced features (poster maps, forms, etc.)

**Test files:** `tests/e2e/3-flows/*.spec.js`

**When it runs:** After page tests pass

---

### 9. Quality Gate
**Purpose:** Final validation of entire pipeline

**Must ALL Pass:**
- ✅ Lint
- ✅ Unit Tests
- ✅ Contract Tests
- ✅ Deploy (if main branch)
- ✅ Verify Deployment (if main branch)
- ✅ E2E Smoke Tests (if main branch)
- ✅ E2E Page Tests (if main branch)
- ✅ E2E Flow Tests (if main branch)

**When it runs:** After all jobs complete

**Failure conditions:**
- Any job has `result: failure`
- Skipped jobs are OK (e.g., deploy on non-main branches)

---

## 🎯 Test Organization: Triangle UI Flow

The E2E tests are organized by the **Triangle UI Flow** methodology:

```
┌─────────────────────────────────────────────┐
│          TRIANGLE UI FLOW PHASES             │
├─────────────────────────────────────────────┤
│                                             │
│  📋 BEFORE EVENT                            │
│  ├─ Admin setup                             │
│  ├─ Sponsor registration                    │
│  ├─ Forms & templates                       │
│  └─ Data preparation                        │
│                                             │
│  ▶️ DURING EVENT                             │
│  ├─ Display screens                         │
│  ├─ Public interaction                      │
│  ├─ Real-time updates                       │
│  └─ Customer experience                     │
│                                             │
│  📊 AFTER EVENT                              │
│  ├─ Data collection                         │
│  ├─ Report generation                       │
│  ├─ Analytics                               │
│  └─ Export functionality                    │
│                                             │
│  ⚡ ALL PHASES                               │
│  ├─ Authentication                          │
│  ├─ Security                                │
│  ├─ API contracts                           │
│  └─ System health                           │
│                                             │
└─────────────────────────────────────────────┘
```

**Test Commands:**
```bash
# Run all triangle tests sequentially
npm run test:triangle

# Run all triangle tests in parallel
npm run test:triangle:parallel

# Run specific phase
npm run test:triangle:before
npm run test:triangle:during
npm run test:triangle:after
npm run test:triangle:all
```

---

## 🔧 Local Development Workflow

### Quick Start
```bash
# Install dependencies
npm ci

# Login to Clasp (one time)
clasp login

# Pull latest from Apps Script
clasp pull

# Make changes...

# Run tests locally
npm test

# Push to Apps Script
npm run push

# Or use helper script
./scripts/validate-clasp-setup.sh
```

### Testing Locally
```bash
# Unit tests only
npm run test:unit

# Contract tests only
npm run test:contract

# Quick validation (unit + smoke)
npm run test:quick

# Full test suite
npm run test:all

# E2E tests (requires deployed app)
BASE_URL=<your-url> ADMIN_KEY=<your-key> npm run test:e2e
```

---

## 🚨 Common Issues & Solutions

### Issue 1: CLASPRC_JSON validation fails

**Symptoms:**
```
❌ ERROR: CLASPRC_JSON is not valid JSON!
```

**Solutions:**
1. Run locally: `./scripts/validate-clasp-setup.sh`
2. Check JSON format: `cat ~/.clasprc.json | jq .`
3. Re-login: `clasp logout && clasp login`
4. Update GitHub secret with new credentials

### Issue 2: Missing OAuth access_token

**Symptoms:**
```
❌ ERROR: Missing required OAuth access_token field!
```

**Solutions:**
1. Check token structure (nested vs flat)
2. Ensure you copied the entire `.clasprc.json` file
3. Re-authenticate: `clasp login`
4. Update GitHub secret

### Issue 3: Deploy fails - Script not found

**Symptoms:**
```
Error: Script not found
```

**Solutions:**
1. Verify `SCRIPT_ID` is correct
2. Check script permissions (must be accessible by OAuth account)
3. Ensure script exists: `clasp open`

### Issue 4: Token expired

**Symptoms:**
```
Error: Token expired
```

**Solutions:**
1. Re-login locally: `clasp login`
2. Get new `.clasprc.json` contents
3. Update `CLASPRC_JSON` GitHub secret

---

## 📚 Related Documentation

- [Clasp Setup Guide](../CLASP_SETUP.md) - Initial setup instructions
- [CI/CD Pipeline](.github/workflows/ci.yml) - GitHub Actions configuration
- [Validation Script](scripts/validate-clasp-setup.sh) - Local validation tool
- [Triangle UI Flow](tests/triangle/README.md) - Test organization methodology

---

## 🎯 Quality Standards

**Core Tests (Must Always Pass):**
- ✅ Lint
- ✅ Unit Tests (>80% coverage)
- ✅ Contract Tests

**Deployment Tests (Main Branch Only):**
- ✅ Deploy
- ✅ Verify Deployment
- ✅ E2E Smoke Tests
- ✅ E2E Page Tests
- ✅ E2E Flow Tests

**Success Criteria:**
- All core tests pass on every push
- All deployment tests pass on main branch
- Zero tolerance for broken main branch
- Quality gate must be green

---

## 🚀 Deployment Checklist

Before deploying to production:

- [ ] All local tests pass
- [ ] Clasp setup validated (`./scripts/validate-clasp-setup.sh`)
- [ ] GitHub secrets configured (CLASPRC_JSON, SCRIPT_ID)
- [ ] Code reviewed and approved
- [ ] Changelog updated
- [ ] Version bumped in package.json
- [ ] All CI checks pass
- [ ] Quality gate is green

---

**Last Updated:** 2025-11-12
**Version:** 1.0
