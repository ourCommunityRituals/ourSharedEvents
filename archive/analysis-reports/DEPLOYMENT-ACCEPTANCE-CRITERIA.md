# Deployment Acceptance Criteria

## Definition of Done

A deployment is considered "working" when ALL of the following pass:

### 1. Deployment Accessibility ✅
- [ ] `curl` to deployment URL returns JSON (not HTML/Access denied)
- [ ] Response contains `{"ok":true}` or `{"ok":false}` (valid JSON structure)
- [ ] Works in incognito browser (anonymous access)
- [ ] Works with admin key authentication

**Test Command:**
```bash
curl -s "DEPLOYMENT_URL?p=status&brand=root&adminKey=ADMIN_KEY"
```

**Expected Output:**
```json
{"ok":true,"value":{"status":"ok","version":"1.3.0"}}
```

---

### 2. Contract Tests (Jest) ✅
- [ ] All 94 Jest tests pass
- [ ] No errors or warnings
- [ ] Runs in < 5 seconds

**Test Command:**
```bash
npm run test:jest
```

**Expected Output:**
```
Test Suites: 1 passed, 1 total
Tests:       94 passed, 94 total
Time:        2.123 s
```

---

### 3. API Tests (Newman - Smoke) ✅
- [ ] All 9 smoke tests pass
- [ ] System health check passes
- [ ] Event lifecycle passes
- [ ] Shortlinks work

**Test Command:**
```bash
npm run test:newman:smoke
```

**Expected Output:**
```
┌─────────────────────────┬───────────────────┐
│                         │          executed │
├─────────────────────────┼───────────────────┤
│              iterations │                 1 │
│                requests │                 9 │
│            test-scripts │                18 │
│      assertions │                18 │
│      assertions failed │                 0 │
└─────────────────────────┴───────────────────┘
```

---

### 4. API Tests (Newman - Critical) ✅
- [ ] All critical endpoint tests pass
- [ ] CRUD operations work
- [ ] Authentication works

**Test Command:**
```bash
npm run test:newman:critical
```

---

### 5. E2E Tests (Playwright - Smoke) ✅
- [ ] Basic smoke tests pass
- [ ] Admin page loads
- [ ] Public page loads
- [ ] No console errors

**Test Command:**
```bash
npm run test:e2e:smoke
```

---

## Current Status

**Deployment:** @7 - ❌ BLOCKED
- Issue: Returns "Access denied" to curl
- Root cause: Coverage files in deployment causing runtime errors
- Fix: Create @8 with clean code (coverage/ excluded)

**Tests:**
- Jest: ✅ PASSING (94/94)
- Newman: ❌ BLOCKED (waiting for deployment)
- Playwright: ❌ BLOCKED (waiting for deployment)

---

## Next Steps

1. ✅ Fixed .claspignore (excluded coverage/ and playwright-report/)
2. ⏳ Push clean code to Apps Script
3. ⏳ Create deployment @8
4. ⏳ Authorize @8 with "Who has access: anyone"
5. ⏳ Update environment files with @8 URL
6. ⏳ Run full test suite

---

**Updated:** 2025-11-11
**Status:** In Progress
