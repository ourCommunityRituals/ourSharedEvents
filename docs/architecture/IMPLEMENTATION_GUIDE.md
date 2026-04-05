# Sequential Progressive Testing - Implementation Guide

## What Changed

Your Stage 2 workflow now implements **sequential progressive testing** with failure gates:

### Old Flow (Parallel)

```
API Tests     ←┐
Smoke Tests    ├─ All run in parallel
Flow Tests     │  (waste time if early failures)
Page Tests    ←┘
```

### New Flow (Sequential with Gates)

```
API Tests (always run)
   ↓
Gate 1: Did API pass?
   ├─ NO  → STOP (skip everything else)
   └─ YES → Continue to Smoke Tests
             ↓
          Smoke Tests (run only if API passed)
             ↓
          Gate 2: Did Smoke pass?
             ├─ NO  → STOP (skip expensive tests)
             └─ YES → Continue to Expensive Tests
                       ↓
                    Flow Tests + Page Tests
```

## Key Benefits

1. **Fail Fast**: Stop immediately when critical tests fail
2. **Save Time**: Don't run expensive tests if basic tests fail
3. **Clear Feedback**: Know exactly which stage failed
4. **Cost Efficient**: Skip Playwright expensive tests when pointless

## Implementation Steps

### 1. Backup existing workflow

```bash
cd ~/ZEVENTBOOKS/MVP-EVENT-TOOLKIT
cp .github/workflows/stage2-testing.yml .github/workflows/stage2-testing.yml.backup
```

### 2. Replace with new workflow

Download the new `stage2-testing.yml` from this conversation and replace:

```bash
# Copy the downloaded file to your repo
cp ~/Downloads/stage2-testing.yml .github/workflows/stage2-testing.yml
```

### 3. Commit and push

```bash
git add .github/workflows/stage2-testing.yml
git commit -m "feat: Implement sequential progressive testing with failure gates

- API tests always run first
- Gate 1: Block Smoke tests if API fails
- Gate 2: Block Expensive tests if Smoke fails
- Fail fast, save test time, clear feedback"

git push origin main
```

### 4. Watch it work!

1. Go to https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions
2. Your push will trigger Stage 1
3. Stage 1 completion will auto-trigger Stage 2
4. Watch the sequential execution with gates

## Expected Behavior

### Scenario 1: All Tests Pass ✅

```
✅ API Tests → Gate 1 (proceed)
   ↓
✅ Smoke Tests → Gate 2 (proceed)
   ↓
✅ Flow Tests + Page Tests
   ↓
✅ QUALITY GATE PASSED
```

### Scenario 2: API Tests Fail ❌

```
❌ API Tests → Gate 1 (BLOCK)
   ↓
⏭️  Smoke Tests SKIPPED
⏭️  Expensive Tests SKIPPED
   ↓
❌ QUALITY GATE FAILED (at API stage)
```

### Scenario 3: Smoke Tests Fail ❌

```
✅ API Tests → Gate 1 (proceed)
   ↓
❌ Smoke Tests → Gate 2 (BLOCK)
   ↓
⏭️  Expensive Tests SKIPPED
   ↓
❌ QUALITY GATE FAILED (at Smoke stage)
```

## Deployment URL (Anonymous Access)

Your current deployment is already configured correctly:

- **Execute as:** Me (zeventbook@gmail.com)
- **Who has access:** Anyone

This means:

- ✅ Users can access WITHOUT signing into Google
- ✅ App runs with your permissions
- ✅ No authentication required

**Keep this setting!** Do NOT change to "Execute as: User accessing" because that WOULD require Google sign-in.

## Next Steps

1. Replace the workflow file
2. Push to main branch
3. Watch the sequential execution
4. Never run `clasp push` manually again!

## Your Complete Workflow

```bash
# Make changes to your code
vim Admin.html

# Commit and push (that's it!)
git add .
git commit -m "Add feature"
git push origin main

# Wait ~3-5 minutes
# ✅ Stage 1: Lint → Unit → Contract → Deploy
# ✅ Stage 2: API → (gate) → Smoke → (gate) → Expensive
# 📊 Review reports in GitHub Actions
```

## Troubleshooting

**Q: Tests are still running in parallel**
A: Make sure the new workflow file replaced the old one completely

**Q: Gate logic not working**
A: Check the job dependencies in the workflow - each job should need the previous gate

**Q: Google sign-in required**
A: Verify Apps Script deployment settings are "Execute as: Me" + "Who has access: Anyone"

**Q: Can I test locally?**
A: Yes! Use the GOOGLE_SCRIPT_URL from GitHub Actions:

```bash
export GOOGLE_SCRIPT_URL="https://script.google.com/macros/s/AKfycbz-RVTCdsQsI913wN3TkPtUP8F8EhSjyFAlWIpLVRgzV6WJ-isDyG-ntaV1VjBNaWZLdw/exec"
export ADMIN_KEY="your-admin-key"
npm run test:api
npm run test:smoke
npm run test:flows
```
