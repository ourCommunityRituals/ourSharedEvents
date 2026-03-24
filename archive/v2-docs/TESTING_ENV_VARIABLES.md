# Testing Environment Variables

This document explains how environment variables are used across different test types in the MVP Event Toolkit.

## BASE_URL Environment Variable

### Overview

The `BASE_URL` environment variable behaves differently depending on the type of tests being run:

| Test Type | BASE_URL Required? | Purpose | Test Framework |
|-----------|-------------------|---------|----------------|
| Unit Tests | ❌ No | Tests logic in isolation with mocks | Jest |
| Contract Tests | ❌ No | Validates response structures with mock data | Jest |
| E2E/API Tests | ✅ Yes | Tests against real deployment | Playwright |

### Jest Tests (Unit & Contract)

**Command**: `npm test` or `npm test -- --coverage`

**BASE_URL**: OPTIONAL

These tests use mock data and test response structures/logic without making real API calls:

- Default value provided: `https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec`
- Tests run successfully without setting BASE_URL
- Used for CI/CD Stage 1 (pre-deployment validation)

**Example**:
```bash
# Works without BASE_URL
npm test -- --coverage

# Also works with BASE_URL (but not required)
BASE_URL="https://example.com" npm test
```

### Playwright Tests (E2E & API)

**Command**: `npm run test:api`, `npm run test:e2e`, etc.

**BASE_URL**: REQUIRED

These tests make real HTTP requests to a deployed instance:

- Must point to actual Google Apps Script deployment
- Used for CI/CD Stage 2 (post-deployment validation)
- Tests real API behavior, not mocks

**Example**:
```bash
# Requires BASE_URL to test real deployment
BASE_URL="https://script.google.com/macros/s/AKfycb.../exec" npm run test:api
```

## Other Environment Variables

### BRAND_ID

**Default**: `root`

Specifies which brand to use for tests:
- `root` - Default brand
- `abc` - ABC brand
- `cbc` - CBC brand
- `cbl` - CBL brand

```bash
BRAND_ID="abc" npm run test:api
```

### ADMIN_KEY

**Default**: `CHANGE_ME_root`

Admin key for authenticated operations:
- Required for E2E tests that create/modify data
- Different per brand in production
- Should be set from secrets in CI/CD

```bash
ADMIN_KEY="your-secret-key" npm run test:api
```

## CI/CD Usage

### Stage 1 - Pre-Deployment (Jest Tests)

```yaml
- name: Run unit tests
  run: npm test -- --coverage
  # No BASE_URL needed - tests use mock data
```

### Stage 2 - Post-Deployment (Playwright Tests)

```yaml
- name: Run E2E tests
  env:
    BASE_URL: ${{ needs.setup.outputs.deployment_url }}
    ADMIN_KEY: ${{ secrets.ADMIN_KEY_ROOT }}
  run: npm run test:e2e
  # BASE_URL required - tests real deployment
```

## Troubleshooting

### Error: BASE_URL not set

If you see an error about BASE_URL not being set:

1. **For Jest tests** (`npm test`): This should NOT happen. Jest tests don't require BASE_URL.
   - Check that `tests/shared/config/test.config.js` provides defaults
   - Verify no validation code is throwing errors

2. **For Playwright tests** (`npm run test:api`): Set BASE_URL before running:
   ```bash
   export BASE_URL="https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec"
   npm run test:api
   ```

### Running All Tests Locally

```bash
# 1. Run Jest tests (no env vars needed)
npm test

# 2. Run Playwright tests (requires deployment)
export BASE_URL="https://script.google.com/macros/s/AKfycb.../exec"
export ADMIN_KEY="your-admin-key"
npm run test:e2e
```

## Design Philosophy

This setup follows the **Triangle Testing Model**:

1. **Fast** Jest tests run first without external dependencies
2. **Slower** Playwright tests run against real deployment only after code quality is validated
3. **Progressive** failure - fails fast on unit tests before expensive E2E tests

This saves CI/CD time and costs by catching issues early.
