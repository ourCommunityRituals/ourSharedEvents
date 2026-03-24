# Smoke Tests

Quick health checks for all pages and API endpoints.

## Purpose

Smoke tests verify basic functionality without deep testing:
- Pages load successfully (200 status)
- Core UI elements are present
- No JavaScript errors on load
- Basic responsive behavior
- API endpoints respond correctly

## Running Smoke Tests

```bash
# Run all smoke tests
npm run test:smoke

# Run with specific browser
npm run test:smoke -- --project=chromium

# Run in headed mode (see browser)
npm run test:smoke -- --headed

# Run specific test file
npm run test:smoke tests/smoke/pages.smoke.test.js
```

## Test Coverage

### Pages (pages.smoke.test.js)
- ✅ Admin page loads with create form
- ✅ Public page shows event listing
- ✅ Display page loads TV layout
- ✅ Poster page loads print layout
- ✅ Test page health check
- ✅ Diagnostics page system tests
- ✅ Status API JSON endpoint
- ✅ Responsive design (mobile, tablet, TV)
- ✅ No JavaScript errors on load
- ✅ Performance checks (load time < 5s)
- ✅ Accessibility (keyboard nav, labels)

### API Endpoints (api.smoke.test.js)
- ✅ Status endpoint returns system info
- ✅ Health check responds
- ✅ Error handling (invalid params)
- ✅ Response format (OK/Err envelopes)
- ✅ Multi-brand support
- ✅ Rate limiting graceful handling

## Environment Variables

### BASE_URL-Aware Testing

All smoke tests are **BASE_URL-aware** - run against any deployment:

```bash
# Run against eventangle.com (default - no BASE_URL needed)
npm run test:smoke

# Run against production (eventangle.com)
BASE_URL="https://www.eventangle.com" npm run test:smoke

# Run against GAS webapp directly
BASE_URL="https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec" npm run test:smoke
```

### Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BASE_URL` | No | `https://eventangle.com` | Target deployment URL |
| `ADMIN_KEY` | No | - | Admin secret (for admin tests) |

**No code changes needed** to switch between GAS and eventangle.com.

## CI/CD Integration

Smoke tests run in the GitHub Actions pipeline:

```
Lint → Unit Tests → Contract Tests → Deploy → Smoke Tests → E2E Tests
```

Smoke tests run after deployment to verify the live application works.

## Expected Results

All smoke tests should pass on a healthy deployment:
- **pages.smoke.test.js**: 20+ tests
- **api.smoke.test.js**: 10+ tests
- **Total**: ~30 tests in ~30-60 seconds

## Troubleshooting

**Tests timeout:**
- Check BASE_URL is correct
- Verify deployment is live
- Check network connectivity

**Console errors about google.script:**
- Normal in Playwright tests (not running in Apps Script context)
- These errors are filtered out in tests

**401/403 errors:**
- Check brand ID is correct
- Verify deployment permissions (set to ANYONE)
