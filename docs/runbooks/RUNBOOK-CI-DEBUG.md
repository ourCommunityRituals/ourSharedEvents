# Runbook: Investigating a Failing CI Run

> **Purpose:** Guide for debugging and investigating failing CI/CD pipelines.
> **Last Updated:** 2025-12-17 | **Story:** 6 - Document Baseline & Runbooks

---

## Quick Reference

| Task                 | Where to Look                                        |
| -------------------- | ---------------------------------------------------- |
| View CI run          | GitHub Actions tab                                   |
| See test artifacts   | Actions > Run > Artifacts section                    |
| Find requestId       | Test output or artifact logs                         |
| Check staging health | `curl https://stg.eventangle.com/api/health/backend` |
| Reproduce locally    | `npm run ci:local`                                   |

---

## CI Pipeline Overview

Understanding which stage failed helps narrow down the investigation:

```
┌─────────────────────────────────────────────────────────────────┐
│                    CI FAILURE POINTS                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  STAGE-1 (Hermetic - runs on PR and push)                        │
│  ├── Security Check  → npm audit, secrets scanning              │
│  ├── Lint           → ESLint code quality                       │
│  ├── Unit Tests     → Jest, mocked tests                        │
│  ├── Contract Tests → Schema, API, bundles                      │
│  ├── Guards         → MVP surfaces, dead code, V2 files         │
│  └── Quality Gates  → Aggregates all above                      │
│                                                                  │
│  STAGE-2 (Live environment - runs after Stage-1 succeeds)        │
│  ├── Environment Alignment → Worker/GAS config match            │
│  ├── API Smoke Tests       → Critical API endpoints             │
│  ├── UI Smoke Tests        → Browser-based tests                │
│  └── Validation Gate       → Aggregates all above               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 1: Identify the Failing Job

1. Go to GitHub > Actions
2. Find the failing workflow run
3. Identify which job failed (look for red X)

### Common Failure Patterns

| Pattern                | Likely Cause                    |
| ---------------------- | ------------------------------- |
| Security Check failed  | npm audit found vulnerabilities |
| Lint failed            | ESLint errors in code           |
| Unit Tests failed      | Test assertion failure          |
| Contract Tests failed  | Schema drift or API change      |
| Guards failed          | MVP guard violation             |
| API Smoke Tests failed | Live environment issue          |
| UI Smoke Tests failed  | Browser test issue              |

---

## Step 2: View Detailed Logs

### Access Logs

1. Click on the failing job
2. Expand the failing step
3. Look for error messages and stack traces

### Finding the requestId

For API-related failures, look for `requestId` in logs:

```
Error: Request failed
  requestId: abc123-def456-ghi789
  status: 500
  message: Internal server error
```

**Use requestId to:**

- Correlate with server logs
- Search Cloudflare dashboard
- Find related errors in DIAG sheet

---

## Step 3: Download Artifacts

Most CI runs produce artifacts with detailed reports.

### Available Artifacts

| Artifact                  | Contents            |
| ------------------------- | ------------------- |
| `playwright-report`       | HTML test report    |
| `test-results`            | Screenshots, traces |
| `dependency-audit-report` | npm audit JSON      |
| `stg-base-url`            | Staging URL used    |
| `prod-base-url`           | Production URL used |

### Download Artifacts

1. Go to workflow run
2. Scroll to "Artifacts" section at bottom
3. Click artifact name to download
4. Extract and view

### View Playwright Report

```bash
# After downloading playwright-report.zip
unzip playwright-report.zip
npx playwright show-report
# Opens browser with detailed test report
```

---

## Step 4: Reproduce Locally

### Stage-1 Failures

```bash
# Reproduce full Stage-1
npm run stage1-local

# Or individual components
npm run lint          # Lint failure
npm run test:unit     # Unit test failure
npm run test:contract # Contract test failure
npm run guards        # Guard failure
```

### Stage-2 Failures

```bash
# First check staging is healthy
curl -s https://stg.eventangle.com/api/health/backend | jq

# Then reproduce tests
npm run test:api      # API failure
npm run test:smoke    # Smoke test failure
```

### With Debug Output

```bash
# Enable debug logging
DEBUG=true npm run test:api

# Or for Playwright
DEBUG=pw:api npm run test:smoke
```

---

## Debugging Specific Failures

### Security Check Failed

**npm audit vulnerabilities:**

```bash
# See what's vulnerable
npm audit

# Try to auto-fix
npm audit fix

# If breaking changes required
npm audit fix --force  # Use with caution
```

**Secrets scanning failed:**

- Check for accidentally committed credentials
- Look for patterns like API keys, private keys

### Lint Failed

```bash
# See all lint errors
npm run lint

# Auto-fix where possible
npm run lint:fix

# Remaining errors must be fixed manually
```

### Unit Tests Failed

```bash
# Run with verbose output
npm run test:unit -- --verbose

# Run specific failing test
npm run test:unit -- tests/unit/failing.test.js

# Run with coverage to see what's tested
npm run test:unit -- --coverage
```

### Contract Tests Failed

**Schema drift:**

```bash
npm run test:contract

# Check specific contract
npm run test -- tests/contract/bundles.contract.test.js
```

**Common causes:**

- API response structure changed
- Schema definition changed
- Bundle format changed

### Guards Failed

```bash
npm run guards

# Individual guards
node scripts/check-surfaces.js    # Surface count
node scripts/check-dead-code.js   # Dead exports
node scripts/check-v2-files.js    # V2 files in MVP
node scripts/check-schema-fields.js # Schema compliance
```

### API Smoke Tests Failed

1. **Check environment health:**

```bash
curl -s https://stg.eventangle.com/api/health/backend | jq
```

2. **Check specific failing endpoint:**

```bash
# From test output, identify failing URL
curl -s "https://stg.eventangle.com/api/v2/events" | jq
```

3. **Look for requestId in failure:**

```
Use requestId to search:
- Cloudflare dashboard logs
- Google Sheets DIAG tab
```

### UI Smoke Tests Failed

1. **Download Playwright artifacts:**
   - Screenshots at failure point
   - Trace files for replay

2. **View trace locally:**

```bash
npx playwright show-trace trace.zip
```

3. **Check for GAS HTML leak:**

```bash
curl -s https://stg.eventangle.com/events | grep -c "Google Apps Script"
# Should be 0
```

---

## Common Issues and Solutions

### Issue: Flaky Tests

**Symptoms:** Test passes locally but fails in CI intermittently

**Solutions:**

1. Add retry logic to test
2. Increase timeouts
3. Check for race conditions
4. Review test isolation

### Issue: Environment Mismatch

**Symptoms:** Tests work against staging but CI fails

**Solutions:**

1. Verify BASE_URL in workflow
2. Check secrets are set correctly
3. Verify staging deployment completed

### Issue: Timeout Failures

**Symptoms:** Tests fail with timeout error

**Solutions:**

1. Check if staging is slow/down
2. Increase test timeouts
3. Check for network issues

### Issue: Permission Denied

**Symptoms:** Tests fail with 401/403 errors

**Solutions:**

1. Verify ADMIN_KEY is set in secrets
2. Check secret rotation status
3. Verify token format

---

## Using requestId for Debugging

Every API response includes a `requestId` for tracing:

```json
{
  "ok": false,
  "error": "Something went wrong",
  "requestId": "abc123-def456"
}
```

### Find Request in Cloudflare

1. Go to Cloudflare Dashboard
2. Navigate to Workers > eventangle-staging
3. Go to Logs
4. Search for requestId

### Find Request in DIAG Sheet

1. Open the staging spreadsheet
2. Go to DIAG tab
3. Search (Ctrl+F) for requestId
4. View related log entries

---

## Escalation

If you can't resolve the issue:

1. **Document findings:**
   - Which job failed
   - requestId if available
   - Steps attempted

2. **Create GitHub issue:**
   - Link to failing workflow
   - Include error messages
   - Tag relevant team members

3. **Check if blocking:**
   - Is this blocking a release?
   - Can it be worked around temporarily?

---

## Related Documentation

- [BASELINE.md](./BASELINE.md) - System baseline documentation
- [ci-cd-architecture.md](./ci-cd-architecture.md) - CI/CD architecture
- [RUNBOOK.md](../RUNBOOK.md) - Incident response
- [E2E_PLAYWRIGHT_GUIDE.md](./E2E_PLAYWRIGHT_GUIDE.md) - Playwright debugging
