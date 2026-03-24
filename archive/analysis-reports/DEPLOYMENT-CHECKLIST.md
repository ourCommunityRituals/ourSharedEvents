# Deployment @8 Checklist

## DevOps Engineer: Pre-Deployment Verification

### Step 1: Verify .claspignore ✅
```bash
cat .claspignore | grep -A2 "Test files"
```

**Expected:**
```
# Test files
tests/**
**/*.spec.js
**/*.test.js
test-*.js
test-*.html
coverage/**
playwright-report/**
```

**Status:** ✅ VERIFIED - coverage/ and playwright-report/ excluded

---

### Step 2: Push Clean Code
```bash
npm run push
```

**What this does:**
1. Moves node_modules temporarily
2. Pushes code to Apps Script (WITHOUT coverage/ and playwright-report/)
3. Restores node_modules

**Expected output:**
```
Pushed XX files.
└─ Admin.html
└─ Code.gs
└─ Config.gs
... (NO coverage/ or playwright-report/ files)
```

**Verify:** Should see ~20-22 files, NO coverage or playwright-report files

---

### Step 3: Create Deployment @8
```bash
npx clasp deploy --description "v8 - Clean deployment (no test artifacts)"
```

**Expected output:**
```
Created version 8.
- AKfycby... @8.
```

**Copy the deployment URL** (the part starting with `AKfycby...`)

---

### Step 4: Authorize Deployment @8

**In Apps Script UI:**

1. Open: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit

2. Click **Deploy** → **Manage deployments**

3. Find deployment ending in **`@8`**

4. Click **✏️ edit icon**

5. Change **"Who has access"** to **"Anyone"**

6. Click **Deploy**

7. **IMPORTANT:** If authorization popup appears, click **Allow**

8. Verify settings:
   - Execute as: **me (mzdano@gmail.com)**
   - Who has access: **anyone**

---

### Step 5: Test in Browser (Incognito)

**Open in incognito window:**
```
https://script.google.com/macros/s/[DEPLOYMENT_URL_FROM_STEP_3]/exec?p=status&brand=root&adminKey=4a249d9791716c208479712c74aae27a
```

**Expected:** JSON response (not "Access denied", not error about coverage files)

**Good response:**
```json
{"ok":true,"value":{"status":"ok"}}
```

**OR:**
```json
{"ok":false,"code":"...","message":"..."}
```

**Bad response:**
```
Access denied
```

**OR:**
```json
{"ok":false,"message":"...document is not defined...coverage..."}
```

---

## Backend Developer: Code Verification

### Files That Should Be Deployed
- ✅ Admin.html
- ✅ Code.gs
- ✅ Config.gs
- ✅ Display.html
- ✅ Public.html
- ✅ Diagnostics.html
- ✅ NUSDK.html
- ✅ appsscript.json
- ~15-20 more .html and .gs files

### Files That Should NOT Be Deployed
- ❌ tests/**
- ❌ coverage/**
- ❌ playwright-report/**
- ❌ node_modules/**
- ❌ *.spec.js files
- ❌ *.sh scripts
- ❌ package.json
- ❌ *.md documentation

---

## QA Engineer: Test Execution Plan

### Once deployment @8 is authorized and URL updated:

#### Test 1: Jest (Contract Tests)
```bash
npm run test:jest
```
**Expected:** 94 passing tests

#### Test 2: Newman Smoke Tests
```bash
npm run test:newman:smoke
```
**Expected:** 9 passing tests

#### Test 3: Newman Critical Tests
```bash
npm run test:newman:critical
```
**Expected:** All critical endpoint tests pass

#### Test 4: Playwright Smoke (Optional)
```bash
npm run test:e2e:smoke
```
**Expected:** Basic page load tests pass

---

## Team Lead: Success Criteria

**Deployment @8 is successful when:**

1. ✅ `curl` test returns valid JSON (not "Access denied")
2. ✅ Browser incognito test returns valid JSON
3. ✅ No error messages about "document is not defined" or coverage files
4. ✅ Jest tests pass (94/94)
5. ✅ Newman smoke tests pass (9/9)
6. ✅ Newman critical tests pass

**If ANY of these fail:**
- Stop and debug
- Do NOT proceed to next step
- Document the failure
- Investigate root cause

---

## Rollback Plan

**If deployment @8 fails:**

1. Switch back to a working deployment (if one exists)
2. Update environment files to point to working deployment
3. Investigate why @8 failed
4. Fix root cause
5. Try again with @9

**Rollback command:**
```bash
./update-deployment-url.sh "https://script.google.com/macros/s/[WORKING_DEPLOYMENT_URL]/exec"
```

---

**Created:** 2025-11-11
**Status:** Ready for Execution
**Next Action:** User runs Step 2 (npm run push)
