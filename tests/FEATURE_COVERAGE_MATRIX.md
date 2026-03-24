# Feature Coverage Matrix

> **Purpose**: This document defines what the test suite validates, serving as both test documentation and product specification. Updated: 2025-01-21

---

## What We Test

### Event Lifecycle (Core MVP)

| Feature | Jest | Playwright | Notes |
|---------|:----:|:----------:|-------|
| Event creation via Admin | `validation.test.js` | `admin-page.spec.js`, `admin-flows.spec.js` | Required fields, response structure |
| Event editing via Admin | `forms.test.js` | `admin-flows.spec.js` | Update, verify changes |
| Event deletion | - | `events-crud-api.spec.js` | API CRUD |
| Event list retrieval | `events-list.contract.test.js` | `public-page.spec.js` | With etag, pagination |
| Event details view | `event-details.contract.test.js` | `public-page.spec.js`, `customer-flows.spec.js` | Full event structure |

### Sponsor System

| Feature | Jest | Playwright | Notes |
|---------|:----:|:----------:|-------|
| Sponsor creation | `sponsor-utils.test.js` | `sponsors-crud-api.spec.js` | API CRUD |
| Sponsor linking to events | - | `sponsor-flows.spec.js` | Configuration flow |
| Sponsor display on TV | - | `display-page.spec.js`, `sponsor-flows.spec.js` | Top/bottom/left/right positions |
| Sponsor carousel rotation | - | `sponsor-flows.spec.js`, `advanced-display-features.spec.js` | Auto-rotation, manual controls |
| Sponsor tier display order | - | `sponsor-flows.spec.js` | Priority ordering |
| Sponsor impressions tracking | `shared-reporting.test.js` | `sponsor-flows.spec.js` | View counts |
| Sponsor click tracking | - | `sponsor-flows.spec.js` | Click analytics |

### Data Propagation (Triangle Framework)

| Feature | Jest | Playwright | Notes |
|---------|:----:|:----------:|-------|
| Admin → Poster sync | - | `poster-maps-integration.spec.js` | Changes flow to poster |
| Admin → Display sync | - | `triangle-framework.spec.js` | TV display updates |
| Admin → Public sync | - | `triangle-framework.spec.js` | Public page reflects changes |
| Poster → Display sync | - | `poster-maps-integration.spec.js` | Complete propagation cycle |
| Cross-page data consistency | `all-endpoints.contract.test.js` | `triangle-framework.spec.js` | Data integrity |

### Shared Reporting

| Feature | Jest | Playwright | Notes |
|---------|:----:|:----------:|-------|
| Report generation | `shared-reporting.test.js` | `shared-reporting.spec.js` | Analytics reports |
| Sponsor performance metrics | - | `shared-reporting.spec.js` | ROI calculations |
| Event analytics | `analytics.contract.test.js` | `portfolio-analytics-api.spec.js` | Aggregations |

### Security & Validation

| Feature | Jest | Playwright | Notes |
|---------|:----:|:----------:|-------|
| Input sanitization (XSS) | `security.test.js`, `backend.test.js` | - | 9 security bug fixes |
| CSRF protection | `security.test.js` | `security-smoke.spec.js` | Token handling |
| JWT security | `jwt-security.contract.test.js` | `authentication.spec.js` | Claims validation |
| Rate limiting | `rate-limiting.test.js` | - | Per-brand limits |
| SQL injection prevention | `security.test.js` | - | Query parameterization |
| Admin key authentication | - | `authentication.spec.js` | Session management |

### Multi-Brand (Root Brand Only)

| Feature | Jest | Playwright | Notes |
|---------|:----:|:----------:|-------|
| Brand configuration | `config.test.js`, `multi-brand.test.js` | `brand-branding.spec.js` | Brand settings |
| Brand routing | `multi-brand.test.js` | `multi-brand-api.spec.js` | Event isolation |
| Brand-specific styling | - | `brand-branding.spec.js` | CSS/theming |

### Pages & Components

| Feature | Jest | Playwright | Notes |
|---------|:----:|:----------:|-------|
| Admin page | `forms.test.js` | `admin-page.spec.js` | Form fields, navigation |
| Display page (TV) | - | `display-page.spec.js` | Responsive 1080p/4K |
| Public page | - | `public-page.spec.js` | Event cards, mobile |
| Poster page | - | `poster-page.spec.js` | Print layout |
| Config page | `config.test.js` | `config-page.spec.js` | Settings editor |

---

## What We Don't Test (Yet)

### Portfolio Analytics (Deferred)
- **Full cross-event portfolio dashboard** - Only basic aggregations tested
- **Historical trend analysis** - Time-series comparisons
- **Benchmark comparisons** - Industry metrics
- **Export to external BI tools** - CSV/Excel exports for deep analysis

### Multi-Language (Deferred)
- **Language switching UI** - Locale selector
- **Content translation validation** - Translated strings accuracy
- **RTL layout support** - Arabic, Hebrew layouts
- **Language-specific date/time formats** - Regional formatting

> Note: `advanced-display-features.spec.js` includes placeholder multi-language tests (EN, ES, FR, DE) but these are not comprehensive.

### Edge Brands (Deferred)
- **Non-root brand creation** - Only root brand tested
- **Cross-brand data isolation** - Brand boundaries
- **Brand-specific API keys** - Per-brand authentication
- **Brand hierarchy** - Parent/child relationships

### Advanced Features (Deferred)
- **Offline mode** - Service worker caching
- **Real-time updates** - WebSocket/SSE
- **Concurrent editing** - Conflict resolution (unit tests exist, E2E deferred)
- **Bulk import/export** - CSV/JSON batch operations
- **API rate limiting under load** - Stress testing

### Performance & Scale (Deferred)
- **Load testing** - High concurrent users
- **Large dataset handling** - 1000+ events
- **Memory leak detection** - Long-running sessions
- **CDN cache validation** - Asset caching

---

## Test Coverage by User Journey

### Tested Journeys

1. **First-Time Admin** (`scenario-1-first-time-admin.spec.js`)
   - Create first event
   - Configure basic settings
   - Publish to public

2. **Mobile User** (`scenario-2-mobile-user.spec.js`)
   - Access event
   - View details
   - Register/share event

3. **TV Display Operator** (`scenario-3-tv-display.spec.js`)
   - Start display
   - Configure sponsors
   - Manage carousel
   - Monitor impressions

4. **Customer Discovery** (`customer-flows.spec.js`)
   - Browse events
   - Search/filter
   - View details
   - Share/export calendar

5. **Sponsor Manager** (`sponsor-flows.spec.js`)
   - Configure sponsors
   - Verify TV display
   - Track analytics

### Untested Journeys

1. **Multi-Brand Administrator**
   - Switch between brands
   - Manage brand-specific settings
   - Cross-brand reporting

2. **Power User**
   - Bulk operations
   - API-first workflows
   - Custom integrations

3. **International User**
   - Multi-language navigation
   - Regional format preferences

---

## Coverage Metrics

| Layer | Files | Coverage Target | Status |
|-------|-------|-----------------|--------|
| Unit Tests | 13 | 60% lines | Enforced |
| Contract Tests | 11 | API envelopes | Enforced |
| Smoke Tests | 4 | Critical paths | Enforced |
| Page Tests | 6 | UI components | Tracked |
| Flow Tests | 11+ | User journeys | Tracked |
| Scenario Tests | 3 | Real-world usage | Tracked |

---

## How to Read This Document

- **Jest column**: Unit/contract tests (Stage 1, no deployment needed)
- **Playwright column**: E2E tests (Stage 2, requires BASE_URL)
- **Dash (-)**: No dedicated test exists; may be covered implicitly
- **Notes**: Additional context or test scope

---

## Maintaining This Document

1. **When adding a new feature**: Add a row to the appropriate table
2. **When writing tests**: Update the Jest/Playwright columns
3. **When deferring features**: Add to "What We Don't Test" with rationale
4. **Review cadence**: Update when test suite changes significantly

---

## Related Documentation

- [Test Hierarchy](./e2e/README.md) - E2E organization
- [Triangle Test Organization](./docs/TRIANGLE_TEST_ORGANIZATION.md) - Phase alignment
- [QA Infrastructure](./QA_INFRASTRUCTURE.md) - CI/CD setup
