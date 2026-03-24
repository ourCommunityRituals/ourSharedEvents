# Agile Test Automation - Scenario-Based Testing

This directory contains comprehensive scenario-based test suites designed for continuous bug discovery, fixing, and verification using an Agile team approach.

## 🎯 Overview

The test automation follows a **customer-first, ease-of-use** philosophy with three core scenarios:

1. **Scenario 1: First-Time Admin** - Admin workflow from event creation to sponsor configuration
2. **Scenario 2: Mobile User at Event** - Mobile customer experience with performance focus
3. **Scenario 3: TV Display at Venue** - Large screen display with carousel and analytics

## 🏗️ Agile Team Roles

### Software Architect
- Ensures tests validate architectural integrity
- Backend/frontend integration points
- Data flow and state management

### Front-End Integration Specialist
- Tests integration between back-end APIs and front-end
- Validates data contracts
- Ensures responsive design works across devices

### Front-End Designer
- TV display tests (1080p, 4K)
- Mobile display tests (iPhone, Android)
- Customer-first UX validation
- Sponsor visibility and engagement

### SDET / SRE
- **Contract Tests**: API contracts, data validation
- **Unit Tests**: Business logic validation
- **Integration Tests**: Component integration
- **E2E Tests**: Full user journeys
- **Quality Gates**: CI/CD pipeline checks

### Software Tester
- Ease of use validation
- Functionality verification
- User journey testing
- Regression testing

### DevOps Engineer
- CI/CD pipeline: Local → Apps Script → GitHub → GitHub Actions → Deployment
- Quality gate enforcement
- Test result tracking and reporting
- Automated bug tracking

## 📋 Test Scenarios

### Scenario 1: First-Time Admin (7 Tests)

**File**: `scenario-1-first-time-admin.spec.js`

Tests complete admin workflow:

1. ✅ **Empty Form Load** - Admin page displays clean form state
2. ✅ **Admin Key Prompt** - Security validation on submission
3. ✅ **Form Validation** - Invalid data rejection
4. ✅ **Event Creation** - Successful event with all links generated
5. ✅ **Sponsor Configuration** - Add and configure sponsors
6. ⚠️ **Google Forms Creation** - Sign-up, check-in, walk-in, survey forms
7. ✅ **Poster Generation** - Event poster link and accessibility

**Run Command**:
```bash
npm run test:scenario:1
```

**Focus Areas**:
- Form validation and UX
- Admin workflow efficiency
- Event/sponsor data management
- Link generation accuracy

### Scenario 2: Mobile User at Event (5 Tests)

**File**: `scenario-2-mobile-user.spec.js`

Tests mobile customer experience:

1. ✅ **Fast Page Load** - Public page loads in < 2 seconds
2. ✅ **Sponsor Presence** - Sponsor banner visible on mobile
3. ✅ **Sponsor Click Tracking** - Analytics on sponsor engagement
4. ⚠️ **Check-In Flow** - Google Form integration for check-in
5. ⚠️ **Gallery Lazy Loading** - Images load efficiently on mobile

**Run Command**:
```bash
npm run test:scenario:2
```

**Focus Areas**:
- Mobile performance (< 2s load time)
- Touch-friendly UI (44px tap targets)
- Sponsor engagement tracking
- Network efficiency (3G simulation)

**Devices Tested**:
- iPhone 14 Pro (iOS Safari)
- Mobile viewports: 375x667px
- 3G network simulation

### Scenario 3: TV Display at Venue (2 Test Groups)

**File**: `scenario-3-tv-display.spec.js`

Tests TV display functionality:

#### Test Group 1: Config & Display
1. ✅ **Config Transfer** - Public → Display page config transfer
2. ✅ **Fast Sponsor Load** - Sponsors appear within 3 seconds
3. ✅ **Sponsor Config Presence** - Sponsor data in DOM

#### Test Group 2: Dynamic Carousel
1. ✅ **Carousel Initialization** - No errors on load
2. ✅ **Rotation Timing** - Carousel rotates every N seconds
3. ✅ **Blocked Embed Handling** - Instagram/social embeds fail gracefully
4. ⚠️ **Analytics Logging** - Track every carousel rotation

**Run Command**:
```bash
npm run test:scenario:3
```

**Focus Areas**:
- Large screen optimization (1080p, 4K)
- Carousel stability and rotation
- Long-running reliability (60s+ tests)
- Error-free operation

**Devices Tested**:
- 1920x1080 (Full HD)
- 3840x2160 (4K UHD)
- Desktop Chrome

## 🚀 Running Tests

### Run All Scenarios

```bash
# Run all scenarios with bug discovery
npm run test:scenarios

# Run all scenarios sequentially
npm run test:scenarios:all
```

### Run Individual Scenarios

```bash
# Scenario 1: Admin workflow
npm run test:scenario:1

# Scenario 2: Mobile user
npm run test:scenario:2

# Scenario 3: TV display
npm run test:scenario:3
```

### Bug Discovery Mode

```bash
# Discover bugs and generate report
npm run test:bug:discover

# View bug report
npm run test:bug:report
```

### Environment-Specific Testing

```bash
# Test against production (Cloudflare)
BASE_URL=https://eventangle.com npm run test:scenario:1

# Test against QA environment (Cloudflare)
BASE_URL=https://zeventbooks.com npm run test:scenario:2

# Test with admin key
ADMIN_KEY=your_admin_key npm run test:scenario:1
```

## 🐛 Bug Discovery Workflow

### 1. Discover Bugs

```bash
npm run test:bug:discover
```

This runs all scenarios and generates a bug tracker at `.test-results/scenarios/bug-tracker.json`.

### 2. Review Bugs

```bash
npm run test:bug:report
```

Bugs are categorized by priority:
- 🔴 **Critical**: System-breaking issues
- 🟠 **High**: Major functionality broken
- 🟡 **Medium**: Feature limitations
- 🟢 **Low**: Minor issues, optimizations

### 3. Fix Bugs

1. Pick the highest priority bug
2. Fix the code
3. Run the specific scenario to verify
4. Commit the fix

### 4. Verify Fix

```bash
# Run specific scenario
npm run test:scenario:1

# Or run all scenarios
npm run test:scenarios
```

### 5. Repeat

Continue until all bugs are resolved.

## 📊 Test Results & Reports

### HTML Reports

After running tests, view the HTML report:

```bash
npx playwright show-report
```

### JSON Results

Test results are saved to:
- `.test-results/playwright-results.json`
- `.test-results/scenarios/bug-tracker.json`

### Bug Tracker Format

```json
{
  "discoveredAt": "2025-01-15T10:30:00Z",
  "scenarios": {
    "scenario-1": {
      "bugs": [...],
      "passed": 6,
      "failed": 1,
      "skipped": 0
    }
  },
  "summary": {
    "totalBugs": 5,
    "criticalBugs": 0,
    "highPriorityBugs": 2,
    "mediumPriorityBugs": 3,
    "lowPriorityBugs": 0
  }
}
```

## 🔄 CI/CD Integration

### GitHub Actions

The project includes quality gates workflow: `.github/workflows/quality-gates-scenarios.yml`

**Quality Gates**:
1. **QG1**: Unit & Contract Tests
2. **QG2**: Scenario 1 - Admin
3. **QG3**: Scenario 2 - Mobile
4. **QG4**: Scenario 3 - TV Display
5. **QG5**: Bug Discovery & Reporting
6. **QG6**: Performance & Accessibility
7. **Final**: Overall pass/fail

**Triggers**:
- Push to `main`, `develop`, or `claude/**` branches
- Pull requests
- Daily at 6 AM UTC
- Manual workflow dispatch

### Quality Gate Criteria

Tests must meet these criteria to pass:

1. **Unit Tests**: 100% pass rate
2. **Contract Tests**: All API contracts valid
3. **Scenario 1**: All 7 admin tests pass
4. **Scenario 2**: Load time < 2s, all mobile tests pass
5. **Scenario 3**: Display loads < 3s, carousel stable
6. **No Critical Bugs**: 0 critical priority bugs

## 📝 Test Patterns

### Customer-First Testing

All tests prioritize customer experience:
- Fast load times (< 2s mobile, < 3s TV)
- Mobile-friendly UI (44px tap targets)
- Clear error messages
- Dead-simple workflows

### Integration Testing

Tests validate full stack:
```javascript
test('Complete admin workflow', async ({ page }) => {
  // 1. Create event (backend + frontend)
  // 2. Configure sponsors (data persistence)
  // 3. Verify links (URL generation)
  // 4. Check public display (config transfer)
});
```

### Performance Testing

```javascript
test('Mobile load time < 2s', async ({ page }) => {
  const startTime = Date.now();
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  const loadTime = Date.now() - startTime;

  expect(loadTime).toBeLessThan(2000);
});
```

### Analytics Validation

```javascript
test('Track sponsor clicks', async ({ page }) => {
  const requests = [];
  page.on('request', req => {
    if (req.url().includes('analytics')) {
      requests.push(req);
    }
  });

  await page.click('.sponsor-banner');
  expect(requests.length).toBeGreaterThan(0);
});
```

## 🛠️ Configuration

### Environment Variables

The test framework uses environment variables for configuration. **Never hardcode secrets in tests!**

#### Required Variables

```bash
# Base URL for testing
BASE_URL=https://zeventbooks.com

# Admin authentication key (REQUIRED for Scenario 1)
ADMIN_KEY=your_admin_key_here

# Brand ID (optional, defaults to 'root')
BRAND_ID=root
```

#### Local Development Setup

**Option 1: Terminal Export** (Quick)
```bash
export BASE_URL=https://zeventbooks.com
export ADMIN_KEY=your_admin_key_here
npm run test:scenario:1
```

**Option 2: .env.local File** (Recommended)
```bash
# 1. Copy template
cp .env.example .env.local

# 2. Edit .env.local with your values
# BASE_URL=https://zeventbooks.com
# ADMIN_KEY=your_actual_admin_key

# 3. Load and run
source .env.local
npm run test:scenario:1
```

**Option 3: One-liner**
```bash
BASE_URL=https://zeventbooks.com ADMIN_KEY=your_key npm run test:scenario:1
```

#### GitHub Actions / CI/CD Setup

For GitHub Actions, configure **Repository Secrets**:

1. Go to: `Settings` → `Secrets and variables` → `Actions`
2. Add secrets:
   - `ADMIN_KEY_ROOT` (required for Scenario 1)
   - `PROD_BASE_URL` (optional, defaults to zeventbooks.com)
   - `BRAND_ID` (optional, defaults to root)

**📚 Full Guide**: See [`docs/SECRETS_SETUP.md`](../../../docs/SECRETS_SETUP.md) for detailed setup instructions.

### Playwright Config

Tests use the project's `playwright.config.js`:
- Browsers: Chromium, WebKit (iPhone)
- Retries: 2 in CI, 0 locally
- Timeouts: Configured per test
- Screenshots: On failure
- Trace: On first retry

## 📚 Best Practices

### 1. Test Isolation

Each test should be independent:
```javascript
test.beforeEach(async ({ page }) => {
  // Fresh page state
  await page.goto(url);
});
```

### 2. Explicit Waits

Use Playwright's auto-waiting:
```javascript
await expect(page.locator('#element')).toBeVisible();
```

### 3. Accessibility

Validate accessible UI:
```javascript
// Check tap target size
const box = await element.boundingBox();
expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
```

### 4. Error Handling

Tests should fail gracefully:
```javascript
const exists = await element.count() > 0;
if (exists) {
  // Test the element
} else {
  console.log('⚠️ Feature not implemented');
  // Don't fail - document the gap
}
```

## 🎓 Learning Resources

- [Playwright Documentation](https://playwright.dev/)
- [Test Automation Patterns](https://martinfowler.com/articles/practical-test-pyramid.html)
- [Mobile Testing Best Practices](https://web.dev/mobile/)
- [Accessibility Testing](https://www.w3.org/WAI/test-evaluate/)

## 🤝 Contributing

When adding new tests:

1. Follow the scenario structure
2. Include customer-first validation
3. Add performance checks
4. Document expected behavior
5. Update this README

## 📞 Support

For questions or issues:
- Open a GitHub issue
- Tag with `testing` label
- Include test output and error messages

---

**Version**: 1.0.0
**Last Updated**: 2025-01-15
**Maintained By**: Agile Test Automation Team
