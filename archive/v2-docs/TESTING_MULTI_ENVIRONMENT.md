# Multi-Environment Testing Guide

This guide explains how to test the MVP Event Toolkit against different deployment environments.

## Supported Environments

| Environment | Base URL | Description |
|------------|----------|-------------|
| **Hostinger** (Default) | `https://zeventbooks.com` | Custom domain proxying to Google Apps Script |
| **Google Apps Script** | `https://script.google.com/macros/s/...` | Direct Google Apps Script deployment |
| **Local Development** | `http://localhost:3000` | Local development server |

## Quick Start

### Testing Against Hostinger (Default)

The default environment is Hostinger. You can run tests without setting BASE_URL:

```bash
# Run all Playwright tests against Hostinger
npm run test:hostinger

# Run specific test suites against Hostinger
npm run test:hostinger:api      # API tests only
npm run test:hostinger:smoke    # Smoke tests only
npm run test:hostinger:pages    # Page tests only
npm run test:hostinger:flows    # Flow tests only
npm run test:hostinger:all      # All E2E tests
```

### Testing Against Google Apps Script

```bash
# Set BASE_URL to your Google Apps Script deployment
export BASE_URL="https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec"
export ADMIN_KEY="your-admin-key"

# Run tests
npm run test:api
npm run test:e2e
```

Or use the convenience script:

```bash
# Uses BASE_URL from environment (not recommended - use Hostinger instead)
npm run test:google-script
```

## Environment Configuration

### How It Works

The test framework automatically detects the environment based on the `BASE_URL`:

1. If `BASE_URL` contains `zeventbooks.com` → **Hostinger**
2. If `BASE_URL` contains `script.google.com` → **Google Apps Script**
3. If `BASE_URL` contains `localhost` → **Local Development**
4. No `BASE_URL` set → **Defaults to Hostinger**

### Brand URLs

All environments support multi-brand URLs with the same pattern:

```
{BASE_URL}?p={page}&brand={brand}
```

#### Hostinger Examples

```bash
# Root brand
https://zeventbooks.com?p=status&brand=root
https://zeventbooks.com?p=admin&brand=root

# ABC brand
https://zeventbooks.com?p=status&brand=abc
https://zeventbooks.com?p=admin&brand=abc

# CBC brand
https://zeventbooks.com?p=status&brand=cbc
https://zeventbooks.com?p=admin&brand=cbc
```

#### Google Apps Script Examples

```bash
# Root brand
https://script.google.com/macros/s/AKfycb.../exec?p=status&brand=root
https://script.google.com/macros/s/AKfycb.../exec?p=admin&brand=root

# ABC brand
https://script.google.com/macros/s/AKfycb.../exec?p=status&brand=abc
https://script.google.com/macros/s/AKfycb.../exec?p=admin&brand=abc
```

### Available Pages

| Page | URL Parameter | Description |
|------|--------------|-------------|
| Status | `?p=status` | System status and health check |
| Admin | `?p=admin` | Event creation and management |
| Events | `?p=events` | Public events listing |
| Display | `?p=display` | TV display mode for live events |
| Poster | `?p=poster` | Event poster/flyer |
| Report | `?p=report` | Analytics and reports |

## Environment Variables

### Required for Playwright Tests

| Variable | Required? | Default | Description |
|----------|-----------|---------|-------------|
| `BASE_URL` | Optional | `https://zeventbooks.com` | Base URL of deployment to test |
| `ADMIN_KEY` | Yes* | `CHANGE_ME_root` | Admin key for write operations |
| `BRAND_ID` | Optional | `root` | Default brand for tests |

*Required only for tests that create/modify data

### Optional Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TEST_ENV` | Auto-detect | Force specific environment (`hostinger`, `googleAppsScript`, `local`) |
| `HOSTINGER_URL` | `https://zeventbooks.com` | Override Hostinger base URL |
| `GOOGLE_SCRIPT_URL` | Auto | Override Google Apps Script URL |

## Common Testing Scenarios

### Scenario 1: Testing Hostinger Deployment

```bash
# Default - tests against Hostinger
npm run test:hostinger:api
npm run test:hostinger:smoke

# Or manually set
export BASE_URL="https://zeventbooks.com"
export ADMIN_KEY="your-admin-key"
npm run test:e2e
```

### Scenario 2: Testing Google Apps Script Directly

```bash
export BASE_URL="https://script.google.com/macros/s/AKfycb.../exec"
export ADMIN_KEY="your-admin-key"
npm run test:api
```

### Scenario 3: Testing Specific Brand

```bash
export BASE_URL="https://zeventbooks.com"
export BRAND_ID="abc"
export ADMIN_KEY="your-abc-admin-key"
npm run test:api
```

### Scenario 4: Print Environment Info

```bash
# See current environment configuration
npm run test:env:print
```

Output:
```
==============================================
🌍 Test Environment Configuration
==============================================
Environment: Hostinger
Description: Hostinger custom domain (proxies to Google Apps Script)
Base URL: https://zeventbooks.com

Brand URLs (status page):
  root: https://zeventbooks.com?p=status&brand=root
  abc: https://zeventbooks.com?p=status&brand=abc
  cbc: https://zeventbooks.com?p=status&brand=cbc
  cbl: https://zeventbooks.com?p=status&brand=cbl

Brand URLs (admin page):
  root: https://zeventbooks.com?p=admin&brand=root
  abc: https://zeventbooks.com?p=admin&brand=abc
  cbc: https://zeventbooks.com?p=admin&brand=cbc
  cbl: https://zeventbooks.com?p=admin&brand=cbl
==============================================
```

## CI/CD Configuration

### GitHub Actions - Stage 2 Testing

The Stage 2 workflow automatically sets BASE_URL based on deployment:

```yaml
- name: Run Playwright tests
  env:
    BASE_URL: ${{ needs.setup.outputs.deployment_url }}
    ADMIN_KEY: ${{ secrets.ADMIN_KEY_ROOT }}
  run: npm run test:api
```

This can point to either:
- Google Apps Script URL (from Stage 1 deployment)
- Hostinger URL (for production testing)

### Testing Hostinger in CI/CD

To test against Hostinger in CI/CD:

```yaml
- name: Test Hostinger deployment
  env:
    BASE_URL: "https://zeventbooks.com"
    ADMIN_KEY: ${{ secrets.ADMIN_KEY_ROOT }}
  run: npm run test:e2e
```

## Troubleshooting

### Tests fail with "baseURL is not set"

Check your environment configuration:

```bash
npm run test:env:print
```

If using Hostinger, no BASE_URL should be needed:

```bash
# Should work without BASE_URL
npm run test:hostinger:api
```

### Tests connect to wrong environment

Force a specific environment:

```bash
# Force Hostinger
export TEST_ENV=hostinger
npm run test:api

# Force Google Apps Script
export TEST_ENV=googleAppsScript
export BASE_URL="https://script.google.com/macros/s/.../exec"
npm run test:api
```

### 404 errors on Hostinger

Verify the Hostinger proxy is configured correctly:

```bash
# Test status endpoint
curl -I "https://zeventbooks.com?p=status&brand=root"

# Should return 200 OK, not 404
```

### CORS errors

Hostinger may require additional CORS configuration. Check:

1. Google Apps Script CORS settings
2. Hostinger proxy configuration
3. Test with direct Google Apps Script URL to isolate issue

## Best Practices

### 1. Use Hostinger for Regular Testing

Hostinger provides a cleaner, more production-like URL:

```bash
# Preferred
npm run test:hostinger:api

# Instead of
BASE_URL="https://script.google.com/macros/s/.../exec" npm run test:api
```

### 2. Use Google Apps Script for Debugging

When debugging issues, test against Google Apps Script directly to isolate proxy issues:

```bash
export BASE_URL="https://script.google.com/macros/s/.../exec"
npm run test:api
```

### 3. Test All Brands

Multi-brand isolation is critical:

```bash
# Test each brand
for brand in root abc cbc cbl; do
  export BRAND_ID=$brand
  npm run test:api
done
```

### 4. Check Environment Before Tests

Always verify your environment:

```bash
npm run test:env:print
```

## Architecture Notes

### URL Construction

The test framework constructs URLs consistently:

```javascript
// API Helper
const url = `${baseUrl}?p=status&brand=${brand}`;
// Result: https://zeventbooks.com?p=status&brand=root

// Page Test
await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);
// Result: https://zeventbooks.com?page=admin&brand=root
```

### Environment Detection

See `tests/config/environments.js` for implementation:

```javascript
const { getCurrentEnvironment } = require('./tests/config/environments');
const env = getCurrentEnvironment();
console.log(env.baseUrl); // https://zeventbooks.com
```

### Global Setup

Before tests run, the environment info is printed (see `tests/config/global-setup.js`):

```javascript
module.exports = async () => {
  printEnvironmentInfo();
};
```

## Related Documentation

- [Testing Environment Variables](./TESTING_ENV_VARIABLES.md) - Explains BASE_URL behavior for Jest vs Playwright
- [Hostinger Deployment Strategy](./HOSTINGER_DEPLOYMENT_STRATEGY.md) - Hostinger setup and configuration
- [Newman to Playwright Migration](./NEWMAN_TO_PLAYWRIGHT_MIGRATION.md) - API testing migration guide
