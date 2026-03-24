# MVP Golden Path

This document defines the canonical frontend pages and backend services for the MVP Event Toolkit. All development should focus on these components.

## Production Stack

```
User Request → eventangle.com → Cloudflare Worker → Google Apps Script → Response
```

| Layer | Technology | Location |
|-------|------------|----------|
| Domain | eventangle.com | Cloudflare DNS |
| Proxy | Cloudflare Workers | `cloudflare-proxy/worker.js` |
| Backend | Google Apps Script | `Code.gs` + Services |
| Frontend | Server-rendered HTML | `*.html` in root |

## Canonical Frontend Pages

### MVP Surfaces (LOCKED - Focus Group Critical)

These pages have `MVP SURFACE` headers and are locked for focus group testing:

| Page | File | Purpose | Auth | Status |
|------|------|---------|------|--------|
| **Admin** | `Admin.html` | Event management dashboard | Admin key | MVP LOCKED |
| **Public** | `Public.html` | Public event listing | None | MVP LOCKED |
| **Display** | `Display.html` | TV/kiosk mode | None | MVP LOCKED |
| **Poster** | `Poster.html` | Printable poster with QR | None | MVP LOCKED |
| **Sponsor** | `Sponsor.html` | Sponsor management | None | MVP LOCKED |
| **SharedReport** | `SharedReport.html` | Analytics sharing | Report token | MVP LOCKED |

### Experimental Pages (v2+)

These pages have `EXPERIMENTAL` headers and are NOT part of MVP focus group testing:

| Page | File | Purpose | Status |
|------|------|---------|--------|
| **Signup** | `Signup.html` | Registration forms | EXPERIMENTAL |
| **SponsorDashboard** | `SponsorDashboard.html` | Advanced sponsor ROI | EXPERIMENTAL |
| **ApiDocs** | `ApiDocs.html` | API documentation | EXPERIMENTAL |
| **Diagnostics** | `Diagnostics.html` | System diagnostics | EXPERIMENTAL |
| **Test** | `Test.html` | Development testing | EXPERIMENTAL |

### Archived/Deprecated Pages

Do NOT develop or test these (archived in `docs/archived/experimental-frontends/`):
- `AdminEnhanced.html` - Experimental enhanced UI
- `AdminWizard.html` - Experimental wizard flow

## Backend Services

### Core Entry Point
- `Code.gs` - Main router, request handling, API endpoints

### Service Layer
| Service | File | Purpose |
|---------|------|---------|
| Events | `EventService.gs` | Event CRUD operations |
| Sponsors | `SponsorService.gs` | Sponsor management |
| Forms | `FormService.gs` | Form handling |
| Templates | `TemplateService.gs` | HTML rendering |
| Analytics | `AnalyticsService.gs` | Metrics and reporting |
| Webhooks | `WebhookService.gs` | External integrations |
| i18n | `i18nService.gs` | Internationalization |

### Configuration & Security
| File | Purpose |
|------|---------|
| `Config.gs` | App config, brand settings |
| `ApiSchemas.gs` | Response schemas, contracts |
| `SecurityMiddleware.gs` | Auth, rate limiting |
| `SharedReporting.gs` | Shared analytics |

## API Response Contract

All API responses follow this envelope:

```javascript
// Success
{ ok: true, value: { ... } }

// Error
{ ok: false, code: "ERR_CODE", message: "Human readable" }

// List responses
{ ok: true, value: { items: [...], meta: { total, page } } }
```

## URL Routing

### Page Access
```
?p=<page>&brand=<brand>&id=<eventId>
?page=admin&brand=<brand>  // Admin uses 'page' param
```

### Supported Pages (via `p=` parameter)
- `status` - API health check
- `events` - Event listing
- `public` - Public event view
- `display` - TV/kiosk display
- `poster` - Printable poster
- `sponsor` - Sponsor portal
- `signup` - Registration forms

### Brands
- `root` - Eventangle (default)
- `abc` - American Bocce Co.
- `cbc` - Chicago Bocce Club
- `cbl` - Chicago Bocce League

## CI/CD Pipeline

### Stage 1 - Build & Deploy (`stage1-deploy.yml`)
1. ESLint code quality
2. Jest unit tests
3. Contract tests (schema validation)
4. Deploy to Apps Script via clasp
5. Update Cloudflare Worker (optional)

### Stage 2 - Testing (`stage2-testing.yml`)
1. Playwright API tests
2. Smoke tests (critical paths)
3. Flow tests (multi-step workflows)
4. Page tests (comprehensive validation)

## Test Organization

### Unit/Contract Tests (`tests/unit/`, `tests/contract/`)
- Backend logic validation
- Schema compliance
- No network required

### Triangle Tests (`tests/triangle/`)
Organized by event lifecycle phase:
- `before-event/` - Creation, setup
- `during-event/` - Live event operations
- `after-event/` - Analytics, reporting
- `all-phases/` - Cross-phase functionality

### E2E Tests (`tests/e2e/`)
- `1-smoke/` - Critical path validation
- `2-pages/` - Page-specific tests
- `3-flows/` - Multi-step workflows
- `api/` - REST endpoint tests

## Feature Coverage Matrix

| Feature | Admin | Poster | Display | Public |
|---------|:-----:|:------:|:-------:|:------:|
| Event Creation | X | - | - | - |
| Event Editing | X | X | - | - |
| Sponsor Management | X | - | - | - |
| Sponsor Display | - | X | X | X |
| Data Propagation | X | X | X | X |
| TV Layout | - | - | X | - |
| Mobile Responsive | X | X | X | X |
| Video Streaming | X | X | X | X |
| Google Maps | X | - | - | X |
| Admin Notes | X | - | X | - |
| Print Layout | - | X | - | - |
| QR Codes | - | X | - | - |

## Development Guidelines

### DO
- Develop only canonical pages listed above
- Use `Ok/Err` envelope for all API responses
- Test against all 4 brands
- Run unit tests before pushing
- Use Cloudflare proxy for production URLs

### DON'T
- Create new HTML pages without PM approval
- Return raw data from API endpoints
- Skip contract tests
- Push to main without Stage 1 passing
- Modify archived files

## Quick Reference

```bash
# Local development
npm run lint          # Code quality
npm test              # Unit tests
npm run test:contract # Contract tests

# Deploy
npm run deploy        # Apps Script via clasp

# Test URLs
https://eventangle.com?p=status&brand=root
https://eventangle.com?page=admin&brand=root
https://eventangle.com?p=public&brand=root&id=<eventId>
```
