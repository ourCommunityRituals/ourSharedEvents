# QA Route Tests

Comprehensive end-to-end tests for validating all user journeys and route flows.

## Test Files

| File | Description |
|------|-------------|
| `offline-rendering.spec.js` | Tests for offline/degraded mode rendering, progressive enhancement |
| `poster-print-qr-chain.spec.js` | Poster → Print → QR link chain validation |
| `create-publish-view-display-loop.spec.js` | Full event lifecycle: Create → Publish → View → Display |
| `sponsor-path.spec.js` | Complete sponsor journey across all surfaces |
| `analytics-path.spec.js` | Analytics tracking, batching, and reporting flow |

## Running Tests

```bash
# Run all QA route tests
npm run test:e2e -- --grep "QA Routes"

# Run specific test file
npx playwright test tests/e2e/qa-routes/offline-rendering.spec.js
npx playwright test tests/e2e/qa-routes/poster-print-qr-chain.spec.js
npx playwright test tests/e2e/qa-routes/create-publish-view-display-loop.spec.js
npx playwright test tests/e2e/qa-routes/sponsor-path.spec.js
npx playwright test tests/e2e/qa-routes/analytics-path.spec.js

# Run with specific environment
BASE_URL=https://eventangle.com npx playwright test tests/e2e/qa-routes/
```

## Test Coverage

### Offline Rendering Tests
- Server-side rendered content visibility
- Critical CSS inline loading
- No-JS fallback behavior
- Print rendering without JavaScript
- Progressive enhancement validation

### Poster → Print → QR Chain
- Poster page loading and structure
- Print-ready layout validation
- QR code generation and sizing
- QR link resolution and redirects
- Analytics tracking on scan

### Create → Publish → View → Display Loop
- Admin event creation
- Event visibility on public page
- Cross-surface consistency
- Display/TV mode rendering
- Update propagation

### Sponsor Path
- Sponsor configuration in admin
- Display carousel rendering
- Public page sponsor visibility
- Poster sponsor strip
- Impression and click tracking
- Report aggregation

### Analytics Path
- Impression tracking on page views
- Click tracking on interactions
- Event batching and flushing
- API endpoint validation
- Report generation and filtering

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BASE_URL` | Base URL for testing | `https://eventangle.com` |
| `ADMIN_KEY` | Admin authentication key | `CHANGE_ME_root` |
| `BRAND_ID` | Brand ID for testing | `root` |

## Test Levels

These tests are **Level 3 (Flow Tests)** in the testing pyramid:

```
Level 1: Smoke Tests (~30 seconds)
Level 2: Page Tests (~5 minutes)
Level 3: Flow Tests (~10 minutes)  ← QA Routes
Level 4: API Tests
Level 5: Contract Tests
```
