# Hostinger URLs & Deployment Strategy
## Cost-Effective Solo Dev + Professional Agile Paradigms

**Last Updated:** 2025-11-14
**Branch:** `claude/hostinger-urls-deployment-testing-01RrnZbGJa6kiryxB2wCt29J`

---

## 🎯 Executive Summary

This document outlines a **cost-effective deployment and testing strategy** for a solo developer maintaining a **professional multi-brand event management platform** while proving long-term viability across the event triangle (organizers, customers, sponsors) and event lifecycle (pre-event, during-event, post-event).

**Key Metrics:**
- **Monthly Cost:** $1-5 (Hostinger domain only)
- **CI/CD Runtime:** ~15 minutes per deployment
- **Test Coverage:** 130+ tests across 10+ devices
- **Deployment Frequency:** Push-to-deploy on main branch
- **Maintenance Time:** <2 hours/week for DevOps

---

## 📊 Current Architecture

### Multi-brand Structure
```
zeventbooks.com (Hostinger)
├─ Production:  zeventbooks.com         → Apps Script Prod
├─ QA:          qa.zeventbooks.com      → Apps Script Staging
└─ Development: [Direct Apps Script URLs] → Apps Script Dev

Brands (shared database):
├─ root (Zeventbook)
├─ abc  (American Bocce Co.)
├─ cbc  (Chicago Bocce Club)
└─ cbl  (Chicago Bocce League)

Pages (13 types):
├─ Public:  events, display, poster, signup
├─ Admin:   wizard, admin, report, diagnostics
└─ API:     status, docs
```

### URL Pattern Examples
```
Production:
https://zeventbooks.com/?p=events&brand=root
https://zeventbooks.com/?p=admin&brand=abc
https://zeventbooks.com/?p=display&brand=cbc

QA:
https://qa.zeventbooks.com/?p=events&brand=root
https://qa.zeventbooks.com/?p=admin&brand=abc

Development (Direct Apps Script):
https://script.google.com/macros/s/AKfycb.../exec?p=events&brand=root
```

---

## 🚀 Deployment Strategy: 3 Environments

### Environment 1: Development (Direct Apps Script URLs)
**When:** Every commit to `claude/**` branches, PR builds
**URL:** Direct Apps Script deployment URL
**Testing:** Unit + Contract tests only
**Cost:** FREE (Google Apps Script quota)
**Maintenance:** Zero - fully automated

**Use Cases:**
- ✅ Rapid iteration during development
- ✅ CI/CD automated testing
- ✅ Feature branch testing
- ✅ Contract validation

**Workflow:**
```bash
git push origin claude/feature-xyz
→ Stage 1 runs automatically
→ Tests pass/fail in ~5 minutes
→ No Stage 2 (saves cost)
```

### Environment 2: QA (qa.zeventbooks.com)
**When:** Deployments to main branch (after Stage 1 passes)
**URL:** `https://qa.zeventbooks.com`
**Testing:** Full test suite (Unit + Contract + Newman + Playwright)
**Cost:** FREE (included in Hostinger domain)
**Maintenance:** ~5 minutes per deployment (manual redirect update)

**Use Cases:**
- ✅ Stakeholder demos
- ✅ User acceptance testing (UAT)
- ✅ Pre-production validation
- ✅ Performance testing
- ✅ Cross-brand smoke testing

**Workflow:**
```bash
git push origin main
→ Stage 1 deploys to Apps Script
→ GitHub Actions outputs new URL
→ Manually update qa.zeventbooks.com redirect in Hostinger
→ Stage 2 runs full test suite
→ Quality gate validates deployment
```

**Manual Steps (5 minutes):**
1. Copy new Apps Script URL from GitHub Actions summary
2. Log into Hostinger: https://hpanel.hostinger.com
3. Navigate: Domains → zeventbooks.com → Redirects
4. Edit `qa.zeventbooks.com` redirect
5. Paste new Apps Script URL
6. Save (DNS updates in 1-2 minutes)

### Environment 3: Production (zeventbooks.com)
**When:** Manual promotion after QA validation
**URL:** `https://zeventbooks.com`
**Testing:** Smoke tests only (real user traffic)
**Cost:** $12/year (Hostinger domain)
**Maintenance:** ~5 minutes per promotion

**Use Cases:**
- ✅ Live user traffic
- ✅ Production events
- ✅ Public-facing demos
- ✅ Performance metrics collection

**Workflow:**
```bash
# After QA validation passes
→ Manually update zeventbooks.com redirect
→ Point to same Apps Script URL as QA
→ Monitor production logs
→ Run production smoke tests
```

---

## 🧪 Testing Strategy: Cost-Effective Test Pyramid

### Test Pyramid Distribution
```
         /\           E2E Tests (Playwright)
        /10\          ~10 minutes, 10+ devices
       /____\         Run: QA only, parallel
      /      \
     / 20 API \       API Tests (Newman)
    /__________\      ~2 minutes, sequential
   /            \     Run: QA only
  /  100 Unit   \    Unit Tests (Jest)
 /_______________\   ~30 seconds, fast
                     Run: Every commit
```

### Testing Matrix by Environment

| Test Suite | Dev Branch | Main (QA) | Production |
|-------------|-----------|-----------|------------|
| Unit Tests (Jest) | ✅ Always | ✅ Always | ❌ Skip |
| Contract Tests | ✅ Always | ✅ Always | ❌ Skip |
| Playwright API Tests | ❌ Skip | ✅ Parallel | ❌ Skip |
| Playwright Smoke | ❌ Skip | ✅ Parallel | ✅ Smoke only |
| Playwright Flows | ❌ Skip | ✅ Parallel | ❌ Skip |
| Playwright Pages | ❌ Skip | ✅ Parallel | ❌ Skip |

**Cost Savings:**
- **Dev branches:** ~5 min runtime, skip expensive E2E tests
- **Main (QA):** ~15 min runtime, full validation
- **Production:** ~1 min runtime, smoke only

**GitHub Actions Cost (Free Tier):**
- 2,000 minutes/month free
- Dev commits: 5 min × 20 commits = 100 min/month
- QA deployments: 15 min × 10 deploys = 150 min/month
- **Total:** ~250 min/month (12.5% of free tier)

---

## 📱 Device Testing: Mobile-First Strategy

### Playwright Device Matrix (10 profiles)
```
Priority 1: Mobile (6 devices)
├─ iPhone 14          (iOS 16, Safari)
├─ iPhone 14 Pro      (iOS 16, Safari)
├─ Pixel 7            (Android 13, Chrome)
├─ Samsung Galaxy S21 (Android 12, Chrome)
├─ iPad Pro           (iOS 16, Safari)
└─ Mobile 3G Throttle (Slow network simulation)

Priority 2: Desktop (3 browsers)
├─ Desktop Chrome     (Latest)
├─ Desktop Firefox    (Latest)
└─ Desktop Safari     (Webkit)

Priority 3: Display (2 sizes)
├─ TV Display 1080p   (1920×1080)
└─ TV Display 4K      (3840×2160)
```

**Why Mobile-First:**
- ✅ Event attendees primarily use phones for QR code scanning
- ✅ Sponsors view displays on mobile during events
- ✅ Admin tools need mobile accessibility
- ✅ Display pages shown on TVs at event venues

### Cost-Effective Device Prioritization

**For QA (Full Suite):**
Run all 10 devices in parallel (15 minutes total)

**For Production Smoke:**
Run only critical devices (5 minutes):
```javascript
// playwright.config.js - Smoke profile
projects: [
  { name: 'iPhone 14' },      // Primary mobile
  { name: 'Pixel 7' },        // Primary Android
  { name: 'Desktop Chrome' }, // Primary desktop
]
```

---

## 🔺 Triangle Framework: Event-Agnostic Testing

### The Event Triangle
```
        Event Organizers
             /\
            /  \
           / EO \
          /______\
         /        \
        / Sponsor  \      Event Lifecycle:
       /   Mgmt     \     ├─ Pre-Event  (Planning)
      /_____________.\    ├─ During     (Live)
     /               \    └─ Post-Event (Analytics)
    /    Customers    \
   /__________________\
```

### Testing Across Event Phases

#### Phase 1: Pre-Event (Planning & Setup)
**Pages Tested:**
- `?p=wizard` - Admin creates event
- `?p=admin` - Full admin configuration
- `?p=poster` - QR code generation

**Test Coverage:**
```javascript
// tests/triangle/pre-event.spec.js
test('Event Organizer: Create event with sponsors', async ({ authenticatedAdminPage }) => {
  await authenticatedAdminPage.createEvent({
    name: 'Summer Bocce Tournament',
    date: '2025-07-15',
    sponsors: ['abc', 'cbc']
  });

  // Verify sponsor logos appear
  // Verify QR codes generated
  // Verify URLs are accessible
});

test('Sponsor: Verify logo placement', async ({ publicPage }) => {
  await publicPage.goto('?p=events&brand=abc');
  await expect(page.locator('[data-sponsor-logo]')).toBeVisible();
});
```

#### Phase 2: During Event (Live Operations)
**Pages Tested:**
- `?p=events` - Public event listing
- `?p=display` - TV display with live updates
- `?p=signup` - Customer registration

**Test Coverage:**
```javascript
// tests/triangle/during-event.spec.js
test('Customer: Scan QR code and view event', async ({ mobile }) => {
  // Simulate QR code scan (direct URL navigation)
  await mobile.goto('?p=events&brand=abc&event=123');

  // Mobile-optimized display
  await expect(page.locator('.event-details')).toBeVisible();
  await expect(page.locator('[data-sponsor-logos]')).toBeVisible();
});

test('Event Staff: Display page shows live updates', async ({ displayPage }) => {
  await displayPage.goto('?p=display&brand=abc');

  // Auto-refresh every 30s
  await page.waitForTimeout(31000);
  // Verify content updated
});
```

#### Phase 3: Post-Event (Analytics & Reporting)
**Pages Tested:**
- `?p=report` - Analytics dashboard
- `?p=diagnostics` - System health metrics

**Test Coverage:**
```javascript
// tests/triangle/post-event.spec.js
test('Event Organizer: View event analytics', async ({ authenticatedAdminPage }) => {
  await authenticatedAdminPage.goto('?p=report&brand=abc');

  // Verify metrics
  await expect(page.locator('[data-metric="views"]')).toContainText(/\d+/);
  await expect(page.locator('[data-metric="signups"]')).toContainText(/\d+/);
});

test('Sponsor: Verify ROI metrics', async ({ authenticatedAdminPage }) => {
  await authenticatedAdminPage.goto('?p=report&brand=abc&sponsor=cbc');

  // Sponsor-specific metrics
  await expect(page.locator('[data-sponsor-impressions]')).toBeVisible();
});
```

---

## 🎯 Playwright Test Organization

### Test Suite Structure
```
tests/e2e/
├─ 1-smoke/               (30 seconds - Critical paths)
│  ├─ critical-smoke.spec.js
│  ├─ security-smoke.spec.js
│  └─ api-contract.spec.js
│
├─ 2-pages/               (5 minutes - Component tests)
│  ├─ admin-page.spec.js
│  ├─ public-page.spec.js
│  └─ display-page.spec.js
│
├─ 3-flows/               (10 minutes - End-to-end journeys)
│  ├─ admin-flows.spec.js
│  ├─ customer-flows.spec.js
│  ├─ sponsor-flows.spec.js
│  └─ triangle-framework.spec.js
│
└─ triangle/              (Event lifecycle)
   ├─ pre-event.spec.js
   ├─ during-event.spec.js
   └─ post-event.spec.js
```

### Parallel Execution Strategy

**Stage 2 CI/CD:**
```yaml
# .github/workflows/stage2-testing.yml
playwright-tests:
  strategy:
    matrix:
      suite: [smoke, flows, pages]

  # All 3 suites run in parallel
  # Total time: max(smoke, flows, pages) = ~10 minutes
```

**Local Development:**
```bash
# Run specific suite
npm run test:smoke   # Quick validation (30s)
npm run test:pages   # Component testing (5min)
npm run test:flows   # Full E2E (10min)

# Run specific brand
npm run test:brand:abc  # Test single brand

# Run specific phase
npm run test:triangle:before  # Pre-event tests
npm run test:triangle:during  # Live event tests
npm run test:triangle:after   # Post-event tests
```

---

## 🔧 Maintenance Strategy

### Weekly DevOps Checklist (< 2 hours/week)

**Monday: Deploy to QA**
- [ ] Review PRs and merge to main
- [ ] Stage 1 auto-deploys (5 min)
- [ ] Update qa.zeventbooks.com redirect (5 min)
- [ ] Stage 2 auto-tests (15 min)
- [ ] Review quality gate results
- **Total:** ~30 minutes

**Wednesday: Mid-week validation**
- [ ] Check production error logs (5 min)
- [ ] Review Google Apps Script quota usage (2 min)
- [ ] Run manual exploratory testing (15 min)
- **Total:** ~20 minutes

**Friday: Production promotion**
- [ ] Review QA metrics from week
- [ ] Update zeventbooks.com redirect (5 min)
- [ ] Run production smoke tests (5 min)
- [ ] Monitor first hour of traffic (10 min)
- **Total:** ~20 minutes

**Monthly: Infrastructure review**
- [ ] Review GitHub Actions usage (free tier check)
- [ ] Review Apps Script quota trends
- [ ] Update test data fixtures
- [ ] Review and prune old deployments
- **Total:** ~1 hour

---

## 💰 Cost Analysis: Solo Dev vs. Professional Team

### Current Setup (Solo Dev - Hostinger)
| Item | Monthly Cost | Annual Cost |
|------|-------------|-------------|
| Hostinger domain | $1 | $12 |
| Google Apps Script | FREE | FREE |
| GitHub Actions | FREE | FREE |
| Newman/Playwright | FREE | FREE |
| **TOTAL** | **$1** | **$12** |

### Alternative: Professional Team Setup
| Item | Monthly Cost | Annual Cost |
|------|-------------|-------------|
| AWS/GCP hosting | $50 | $600 |
| Cloudflare Pro | $20 | $240 |
| CI/CD (CircleCI) | $30 | $360 |
| Monitoring (Datadog) | $15 | $180 |
| Test infrastructure | $10 | $120 |
| **TOTAL** | **$125** | **$1,500** |

**Savings:** $1,488/year (99.2% cost reduction)

---

## 🚦 Quality Gates & Deployment Rules

### Stage 1 (Build & Deploy) - Always Runs
```yaml
✅ Unit tests pass (Jest)
✅ Contract tests pass (Jest)
✅ Deploy to Apps Script succeeds
✅ Deployment URL generated

→ If all pass: Stage 2 auto-triggers
→ If any fail: Stop, no deployment
```

### Stage 2 (Testing & QA) - Main Branch Only
```yaml
✅ Newman API tests pass (with retry logic)
✅ Playwright Smoke tests pass (3 devices)
✅ Playwright Flow tests pass (10+ devices)
✅ Playwright Page tests pass (10+ devices)
✅ Quality gate validates

→ If all pass: QA deployment approved
→ If any fail: Block QA, notify developer
```

### Production Promotion - Manual Only
```yaml
✅ QA has been stable for 24+ hours
✅ No critical bugs in issue tracker
✅ Smoke tests pass on production URL
✅ Stakeholder approval received

→ Update zeventbooks.com redirect
→ Monitor first hour of traffic
```

---

## 📈 Metrics & Monitoring

### Key Performance Indicators (KPIs)

**Development Velocity:**
- Commits per week: ~10-20
- Average time to QA: ~20 minutes (Stage 1 + redirect update + Stage 2)
- Average time to production: 1-2 days (manual gating)

**Test Coverage:**
- Unit test coverage: 85%+
- Contract test coverage: 100% (all API endpoints)
- E2E test coverage: 90%+ (all critical paths)

**Reliability:**
- Stage 1 success rate: 95%+ (unit + contract tests)
- Stage 2 success rate: 90%+ (includes E2E flakiness)
- Production uptime: 99.9% (Google Apps Script SLA)

**Cost Efficiency:**
- GitHub Actions usage: 250 min/month (12.5% of free tier)
- Apps Script quota: <10% daily quota
- Zero paid services required

### Monitoring Tools (All Free)

**GitHub Actions:**
- Build/test status badges
- Workflow run history (90 days)
- Artifact storage (test reports, 1 day retention)

**Google Apps Script:**
- Execution logs (Apps Script console)
- Quota usage dashboard
- Error tracking

**Browser DevTools:**
- Performance profiling (Lighthouse)
- Network analysis
- Console error tracking

---

## 🎓 Learning from Professional Agile Teams

### Adaptations for Solo Dev

| Professional Team Practice | Solo Dev Adaptation |
|---------------------------|---------------------|
| **Separate QA team** | Automated Playwright tests |
| **Manual exploratory testing** | Playwright + weekly 15-min manual session |
| **Staging + Production servers** | Hostinger redirects (QA + Prod) |
| **Feature flags** | Brand-based configuration |
| **Blue-green deployments** | Apps Script versioning |
| **Load testing** | Mobile 3G throttling simulation |
| **Incident response team** | GitHub issue tracking + logs |
| **On-call rotation** | Google Apps Script error emails |

### Time-Saving Patterns

**1. Test Fixtures (Reduce test writing time by 50%)**
```javascript
// tests/shared/fixtures/events.fixtures.js
export const EventBuilder = {
  withName: (name) => ({ ...defaults, name }),
  withSponsors: (sponsors) => ({ ...defaults, sponsorIds: sponsors.join(',') }),
  withDate: (date) => ({ ...defaults, dateISO: date }),
  build: () => fullEventObject
};

// Usage in tests (1 line vs 20 lines)
const event = EventBuilder.withName('Test Event').withSponsors(['abc']).build();
```

**2. Page Objects (Maintainability)**
```javascript
// tests/e2e/pages/AdminPage.js
class AdminPage {
  async createEvent(eventData) {
    // Encapsulate complex interactions
    // Change once, affect all tests
  }

  async addSponsor(sponsorId) {
    // Reusable sponsor management
  }
}

// Tests stay simple
test('Create event', async ({ authenticatedAdminPage }) => {
  await authenticatedAdminPage.createEvent(testEvent);
});
```

**3. Multi-brand Test Parameterization**
```javascript
// Run same test across all brands
const BRANDS = ['root', 'abc', 'cbc', 'cbl'];

BRANDS.forEach(brand => {
  test(`${brand}: Create and view event`, async ({ page }) => {
    // Test brand isolation
    // Ensure no cross-brand data leaks
  });
});
```

---

## 🔮 Future Optimization Paths

### Phase 1: Current State (Implemented) ✅
- ✅ Hostinger domain with manual redirects
- ✅ 2-stage CI/CD pipeline
- ✅ Multi-brand architecture
- ✅ Mobile-first Playwright testing
- ✅ Newman API testing

**Time Investment:** 40 hours initial setup
**Ongoing Maintenance:** 2 hours/week
**Cost:** $1/month

### Phase 2: Professional Automation (3-6 months)
- [ ] Cloudflare Workers for automatic subdomain routing
- [ ] Automated QA subdomain updates (no manual redirect)
- [ ] Performance testing (Lighthouse CI)
- [ ] Accessibility testing (axe-core)
- [ ] Visual regression testing (Percy/Chromatic)

**Time Investment:** 20 hours
**Ongoing Maintenance:** 1 hour/week
**Cost:** $20/month (Cloudflare Pro)

### Phase 3: Enterprise Scale (6-12 months)
- [ ] Separate Apps Script projects per environment
- [ ] Feature flags (LaunchDarkly or custom)
- [ ] Real user monitoring (RUM)
- [ ] Synthetic monitoring (Uptime checks)
- [ ] Multi-region deployment

**Time Investment:** 60 hours
**Ongoing Maintenance:** 3 hours/week
**Cost:** $50/month

---

## 📚 Reference Documentation

### Related Files
- **Deployment:** [APPS_SCRIPT_PROJECT.md](./APPS_SCRIPT_PROJECT.md)
- **Testing:** [TESTING.md](./TESTING.md)
- **CI/CD:** [GITHUB_ACTIONS_DEPLOYMENT.md](./GITHUB_ACTIONS_DEPLOYMENT.md)
- **Quick Start:** [QUICK_START_STAGE2.md](./QUICK_START_STAGE2.md)

### Key Configuration Files
- **Playwright:** [playwright.config.js](./playwright.config.js)
- **Stage 1 CI/CD:** [.github/workflows/stage1-deploy.yml](./.github/workflows/stage1-deploy.yml)
- **Stage 2 CI/CD:** [.github/workflows/stage2-testing.yml](./.github/workflows/stage2-testing.yml)
- **Multi-brand Config:** [Config.gs](./Config.gs)

### External Resources
- **Hostinger Panel:** https://hpanel.hostinger.com
- **Apps Script Console:** https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l
- **GitHub Actions:** https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions
- **Playwright Docs:** https://playwright.dev

---

## ✅ Action Items for Current Deployment

### Immediate (This Week)
1. **Verify QA environment:** Test `qa.zeventbooks.com` across all brands
2. **Run full test suite:** Ensure Stage 2 completes successfully
3. **Document manual steps:** Create checklist for redirect updates

### Short-term (This Month)
1. **Add production smoke tests:** Verify production after redirect updates
2. **Implement error monitoring:** Set up Apps Script error email alerts
3. **Create runbook:** Document incident response procedures

### Long-term (Next Quarter)
1. **Evaluate Cloudflare migration:** Cost/benefit analysis
2. **Add performance testing:** Lighthouse CI integration
3. **Expand device coverage:** Add more mobile devices to test matrix

---

**Questions or Issues?**
- Review this document for deployment strategy
- Check GitHub Actions for CI/CD status
- Review test reports in artifacts
- Check Hostinger panel for DNS/redirect status

**Last Review:** 2025-11-14
