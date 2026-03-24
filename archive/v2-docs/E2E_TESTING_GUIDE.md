# E2E Testing - Deployment Setup Guide

**Quick guide to deploy and run E2E tests against your live Apps Script deployment**

---

## Step 1: Deploy to Apps Script

### Option A: Using Clasp (Recommended)

```bash
# Login to Google Apps Script (first time only)
clasp login

# Push code to Apps Script
clasp push

# Create new deployment
clasp deploy --description "E2E Testing $(date '+%Y-%m-%d %H:%M')"

# Get deployment URL
clasp deployments
```

The output will show something like:
```
2 Deployments.
- AKfycbz... @1 (Latest)
  https://script.google.com/macros/s/AKfycbz.../exec
- AKfycby... @HEAD
  https://script.google.com/macros/s/AKfycby.../exec
```

**Copy the HTTPS URL** (it starts with `https://script.google.com/macros/s/...`)

### Option B: Manual Deployment (Apps Script Editor)

1. Open the Apps Script project:
   ```bash
   clasp open
   # Or visit: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
   ```

2. Click **Deploy** → **New deployment**
3. Select **Web app** as deployment type
4. Configure:
   - **Execute as:** User accessing the web app
   - **Who has access:** Anyone
5. Click **Deploy**
6. **Copy the Web app URL**

---

## Step 2: Test Deployment URL

Quick sanity check:

```bash
# Replace {URL} with your actual deployment URL
curl "https://script.google.com/macros/s/{ID}/exec?page=status"
```

Expected response:
```json
{
  "ok": true,
  "value": {
    "build": "triangle-extended-v1.3",
    "contract": "1.0.3",
    "time": "2025-11-10T...",
    "db": { "ok": true, "id": "spreadsheet-id" }
  }
}
```

---

## Step 3: Set Environment Variables

Create a `.env` file in your project root:

```bash
cat > .env <<'EOF'
# Deployment URL (replace with your actual URL)
BASE_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec

# Admin key (replace with your actual admin secret from Config.gs)
ADMIN_KEY_ROOT=CHANGE_ME_root

# Optional: Set specific brand for testing
BRAND_ID=root
EOF
```

**IMPORTANT:** Add `.env` to `.gitignore`:

```bash
echo ".env" >> .gitignore
```

**OR** export directly in your shell:

```bash
export BASE_URL="https://script.google.com/macros/s/YOUR_ID/exec"
export ADMIN_KEY="CHANGE_ME_root"  # Use your actual admin secret
```

---

## Step 4: Run E2E Tests

### Run All E2E Tests

```bash
npm run test:e2e
```

### Run Specific Test File

```bash
npx playwright test tests/e2e/critical-flows.spec.js
```

### Run Specific Test

```bash
npx playwright test -g "Admin creates event"
```

### Run with UI (Headed Mode)

```bash
npx playwright test --headed
```

### Run with Playwright Inspector (Debug)

```bash
npx playwright test --debug
```

### Run Specific Browser/Project

```bash
# Desktop Chrome
npx playwright test --project=chromium

# Mobile Chrome
npx playwright test --project="Mobile Chrome"

# TV Display
npx playwright test --project="TV Display"
```

---

## Step 5: View Test Reports

After tests complete:

```bash
# Open HTML report
npx playwright show-report
```

The report will show:
- ✅ Passed tests
- ❌ Failed tests
- 📸 Screenshots on failure
- 🎥 Video recordings (if enabled)
- ⏱️ Execution time

---

## Quick Verification Checklist

Before running E2E tests, verify:

- [ ] Code deployed to Apps Script
- [ ] Deployment URL obtained
- [ ] Status endpoint returns valid JSON
- [ ] Admin secret changed from `CHANGE_ME_*`
- [ ] `BASE_URL` environment variable set
- [ ] `ADMIN_KEY` environment variable set
- [ ] Playwright browsers installed (`npx playwright install chromium`)

---

## Common Issues & Solutions

### Issue 1: "Cannot find BASE_URL"

**Solution:**
```bash
export BASE_URL="https://script.google.com/macros/s/YOUR_ID/exec"
npm run test:e2e
```

### Issue 2: "Admin key invalid"

**Solution:** Update `ADMIN_KEY` to match the actual secret in `Config.gs`:

```bash
# Check your Config.gs for the actual admin secret (line 17)
export ADMIN_KEY="your_actual_secret"
```

### Issue 3: "Timeout waiting for navigation"

**Cause:** Apps Script may be slow on first request (cold start)

**Solution:** Increase timeout in `playwright.config.js`:

```javascript
use: {
  baseURL: process.env.BASE_URL,
  timeout: 30000, // Increase from default
}
```

### Issue 4: "Browser not found"

**Solution:**
```bash
npx playwright install chromium
```

---

## E2E Test Scenarios

These tests will run automatically:

### Critical Flows (15 tests)

1. **Admin creates event → Public page shows event**
   - Creates event via admin interface
   - Verifies event appears on public page
   - Validates event details are correct

2. **Configure sponsors → Display page shows sponsors**
   - Adds sponsors with placements
   - Checks TV display shows sponsor banners
   - Verifies mobile banner displays

3. **Public page analytics logging**
   - Verifies sponsor impressions logged
   - Checks click tracking
   - Validates analytics batch flush

4. **Display carousel mode**
   - Tests dynamic mode with multiple URLs
   - Verifies auto-rotation
   - Checks fallback for blocked embeds

5. **Health check endpoint**
   - Validates status response structure
   - Checks build version
   - Verifies database connection

6. **Shortlink redirect**
   - Creates shortlink via API
   - Tests redirect functionality
   - Validates analytics logging

7. **Mobile responsive design**
   - Tests viewport settings
   - Validates single-column layout on mobile
   - Checks touch-friendly UI

8. **Keyboard accessibility**
   - Tests tab navigation
   - Validates focus states
   - Checks ARIA labels

### Security Tests (2 tests)

9. **Reject API calls without admin key**
   - Attempts create without key
   - Verifies error response

10. **Sanitize XSS in event names**
    - Submits XSS payload
    - Verifies script tags removed
    - Checks safe rendering

### Performance Tests (2 tests)

11. **Status endpoint < 500ms**
    - Measures response time
    - Fails if > 500ms

12. **Public page < 3s load**
    - Measures full page load
    - Fails if > 3s

---

## Expected Test Output

```
Running 15 tests using 1 worker

  ✓ Flow 1: Admin creates event and views on public page (12s)
  ✓ Flow 2: Configure display with sponsors (8s)
  ✓ Flow 3: Public page shows sponsor banner (5s)
  ✓ Flow 4: Display page carousel mode (6s)
  ✓ Flow 5: Health check and status endpoints (2s)
  ✓ Flow 6: Shortlink redirect (3s)
  ✓ Flow 7: Responsive design - Mobile viewport (4s)
  ✓ Flow 8: Accessibility - Keyboard navigation (3s)
  ✓ Security 1: Reject calls without admin key (4s)
  ✓ Security 2: Sanitize XSS attempts (5s)
  ✓ Performance 1: Status endpoint < 500ms (1s)
  ✓ Performance 2: Public page < 3s (2s)

  15 passed (55s)

To open last HTML report run:
  npx playwright show-report
```

---

## Continuous Integration (GitHub Actions)

The E2E tests will run automatically in GitHub Actions on every push to `main`:

1. Code is deployed to Apps Script
2. Deployment URL is extracted
3. E2E tests run against live deployment
4. Test reports uploaded as artifacts

**View results:**
- Go to **Actions** tab in GitHub
- Click on latest workflow run
- Scroll to **E2E Tests on Deployed URL**
- Download **playwright-report** artifact to view detailed results

---

## Next Steps After E2E Tests Pass

1. ✅ Review test report for any failures
2. ✅ Fix any issues found
3. ✅ Run tests again to verify fixes
4. ✅ Deploy to production
5. ✅ Set up monitoring (UptimeRobot, etc.)
6. ✅ Configure custom domain (zeventbooks.io)

---

**Ready to run?**

```bash
# Quick start (all in one)
export BASE_URL="https://script.google.com/macros/s/YOUR_ID/exec"
export ADMIN_KEY="your_admin_secret"
npm run test:e2e
```

Good luck! 🚀
