# Newman Test Debugging Guide

## If Tests Keep Failing After Authentication Fix

### 1. Verify Admin Key Matches Everywhere

**Check Config.gs:**
```bash
grep "adminSecret" Config.gs | head -5
```
Should show: `adminSecret: '4a249d9791716c208479712c74aae27a'`

**Check Local Environment File:**
```bash
cat postman/environments/mvp-event-toolkit-local.json | grep adminKey
```
Should show: `"value": "4a249d9791716c208479712c74aae27a"`

**Check Deployment Status:**
```bash
# Verify Config.gs was actually deployed
clasp versions  # Check if there's a recent version
```

### 2. Test Individual API Endpoints

**Test Health Check First:**
```bash
curl "https://script.google.com/macros/s/AKfycbzu-U4UgdjdAiXHTg9TD5Y-1gDkc798YSTqQCdhOddG/exec?action=health"
```
Expected: `{"ok":true}`

**Test Authentication:**
```bash
# Replace with your actual base URL and admin key
BASE_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
ADMIN_KEY="4a249d9791716c208479712c74aae27a"

curl -X POST "$BASE_URL?action=listFormTemplates" \
  -H "Content-Type: application/json" \
  -d "{\"brandId\":\"root\",\"adminKey\":\"$ADMIN_KEY\"}"
```
Expected: JSON response with form templates

### 3. Run Tests with Maximum Verbosity

**Individual Collection Test:**
```bash
# Test just the System folder first (health checks)
npm run test:newman:smoke
```

**Full Flow Test with Detailed Output:**
```bash
newman run postman/collections/mvp-event-toolkit-flows.json \
  -e postman/environments/mvp-event-toolkit-local.json \
  -r cli,json \
  --reporter-json-export newman-reports/debug-report.json \
  --verbose
```

### 4. Common Failure Scenarios

#### Scenario A: Still Getting 401 Unauthorized
**Cause:** Config.gs wasn't deployed or deployment didn't propagate
**Fix:**
1. Run `./clasp-deploy.sh` again
2. Wait 30 seconds for deployment to propagate
3. Try tests again

#### Scenario B: Tests Fail on "Create Event"
**Cause:** EVENTS sheet doesn't exist or structure is wrong
**Fix:**
1. Check Google Sheet has EVENTS tab
2. Verify columns: id, brandId, name, date, venue, description, status, createdAt, updatedAt
3. Run health check: `curl "BASE_URL?action=health"`

#### Scenario C: Tests Fail on "Create Form"
**Cause:** Forms API scope not authorized or FormApp permissions issue
**Fix:**
1. Open Apps Script project: `npm run open`
2. Manually trigger form creation from Admin UI
3. Accept OAuth authorization for Forms API
4. Try tests again

#### Scenario D: Shortlink Generation Fails
**Cause:** SHORTLINKS sheet missing or token generation issue
**Fix:**
1. Check Google Sheet has SHORTLINKS tab
2. Verify columns: token, targetUrl, createdAt, eventId, sponsorId, surface, clicks
3. Test shortlink manually: `curl -X POST "BASE_URL?action=createShortlink" -d '{"brandId":"root","adminKey":"KEY","targetUrl":"https://example.com"}'`

#### Scenario E: Tests Timeout
**Cause:** Google Apps Script execution taking too long
**Fix:**
1. Increase Newman timeout: `--timeout-request 30000`
2. Check Apps Script execution logs: `npm run logs`
3. Look for performance issues or infinite loops

### 5. Get Detailed Error Information

**Check Newman JSON Report:**
```bash
cat newman-reports/debug-report.json | jq '.run.failures'
```

**Check Apps Script Logs:**
```bash
npm run logs
# Or manually: clasp logs
```

**Check Which Step Failed:**
```bash
# Look at the HTML report
open newman-reports/flow-report.html
# Or check the JSON for specific failure
cat newman-reports/flow-report.json | jq '.run.executions[] | select(.response.code != 200)'
```

### 6. Isolate the Problem

**Test Each Step Individually:**
```bash
# 1. Health check
curl "BASE_URL?action=health"

# 2. List templates
curl -X POST "BASE_URL?action=listFormTemplates" \
  -d '{"brandId":"root","adminKey":"4a249d9791716c208479712c74aae27a"}'

# 3. Create event
curl -X POST "BASE_URL?action=create" \
  -d '{"brandId":"root","adminKey":"KEY","scope":"EVENTS","data":{"name":"Test","date":"2025-12-01"}}'

# If step 3 works, get the event ID from response and try:

# 4. Create form
curl -X POST "BASE_URL?action=createFormFromTemplate" \
  -d '{"brandId":"root","adminKey":"KEY","templateType":"check-in","eventId":"EVENT_ID"}'
```

### 7. Environment Variable Issues

**Check Environment Variables Are Loading:**
```bash
# View what Newman sees
newman run postman/collections/mvp-event-toolkit-flows.json \
  -e postman/environments/mvp-event-toolkit-local.json \
  --env-var "testMode=true"
```

**Verify Environment File Structure:**
```bash
cat postman/environments/mvp-event-toolkit-local.json | jq '.values[] | {key: .key, value: .value}'
```

### 8. Nuclear Option: Fresh Start

If everything else fails:
```bash
# 1. Verify you have the latest code
git status
git pull origin claude/e2e-playwright-testing-011CUzuxDzMBaNQrs2xcK1NG

# 2. Verify file contents match
cat Config.gs | grep adminSecret
cat postman/environments/mvp-event-toolkit-local.json | grep adminKey

# 3. Deploy with confirmation
./clasp-deploy.sh
echo "Waiting for deployment to propagate..."
sleep 30

# 4. Test health endpoint first
curl "BASE_URL?action=health"

# 5. Run smoke test only
npm run test:newman:smoke

# 6. If smoke passes, try flow
npm run test:newman:flow
```

## Getting Help

If tests still fail after all these steps, share:
1. Output of `npm run test:newman:smoke`
2. Output of `curl "BASE_URL?action=health"`
3. Contents of `newman-reports/debug-report.json` (failures section)
4. Output of `npm run logs` (last 10 lines)
5. Screenshot of Google Sheet structure (EVENTS and SHORTLINKS tabs)

This gives us complete diagnostic information to identify the issue.
