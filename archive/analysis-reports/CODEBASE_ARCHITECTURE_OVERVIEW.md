# MVP-EVENT-TOOLKIT - Comprehensive Architecture Overview

**Date:** 2025-11-18  
**Build:** triangle-extended-v1.3  
**Contract Version:** 1.0.3  
**Purpose:** Planning implementation of webhooks, i18n, multi-template system, and MCP integrations

---

## 1. Project Structure

### 1.1 Technology Stack
- **Backend:** Google Apps Script (JavaScript runtime)
- **Frontend:** HTML/CSS/JavaScript (no framework - vanilla JS)
- **Database:** Google Sheets (multi-brand, single spreadsheet per brand)
- **Testing:** Jest (unit/contract) + Playwright (E2E)
- **CI/CD:** GitHub Actions
- **Deployment:** Apps Script API via clasp CLI

### 1.2 Directory Structure

```
MVP-EVENT-TOOLKIT/
├── *.gs                      # Backend services (Google Apps Script)
│   ├── Code.gs              # Main API router, authentication, RPC handlers
│   ├── Config.gs            # Multi-brand config, templates, URL aliases
│   └── SharedReporting.gs   # Shared analytics/reporting logic
│
├── services/                 # Service layer (business logic)
│   ├── EventService.gs      # Event CRUD operations
│   ├── SponsorService.gs    # Sponsor analytics, ROI, placement validation
│   ├── AnalyticsService.gs  # Analytics logging, aggregation, reporting
│   ├── FormService.gs       # Google Forms integration
│   └── SecurityMiddleware.gs # JWT, CSRF, rate limiting, input sanitization
│
├── contracts/               # API contracts & schemas
│   └── ApiSchemas.gs        # JSON Schema definitions for all endpoints
│
├── components/              # Reusable UI components
│   ├── CardComponent.html   # Card UI pattern
│   ├── StateManager.html    # Client-side state management with auto-save
│   ├── DashboardCard.html   # Dashboard-specific card component
│   └── QRRegenerator.html   # QR code regeneration component
│
├── *.html                   # Page templates (Apps Script HTML Service)
│   ├── Admin.html           # Event management interface
│   ├── Public.html          # Public event listing
│   ├── Display.html         # TV/kiosk display mode
│   ├── Poster.html          # Printable event posters
│   ├── ApiDocs.html         # Interactive API documentation
│   ├── Styles.html          # Global styles
│   ├── NUSDK.html           # Frontend SDK & RPC client
│   ├── PlannerCards.html    # Card-based event planner UI
│   └── SharedReport.html    # Shared analytics dashboard
│
├── tests/                   # Test suite (150+ tests)
│   ├── unit/                # Jest unit tests (78 tests)
│   ├── contract/            # API contract tests (16 tests)
│   ├── triangle/            # Triangle framework tests (56 tests)
│   │   ├── before-event/    # Pre-event preparation phase
│   │   ├── during-event/    # Live event execution phase
│   │   ├── after-event/     # Post-event analytics phase
│   │   └── all-phases/      # Cross-cutting concerns
│   ├── e2e/                 # Playwright E2E tests (40+ tests)
│   ├── load/                # k6 load tests
│   └── shared/              # Shared test utilities & fixtures
│
├── dashboard/               # DevOps monitoring dashboard
│   ├── src/                 # Express.js server
│   └── public/              # Dashboard UI
│
├── .github/workflows/       # CI/CD pipelines
│   ├── stage1-deploy.yml    # Build, test, deploy to Apps Script
│   ├── stage2-testing.yml   # E2E testing on deployed app
│   ├── unit-contract-tests.yml
│   └── quality-gates-scenarios.yml
│
└── docs/                    # Documentation
    └── [50+ markdown files covering setup, deployment, testing]

---

## 2. Existing Services Architecture

### 2.1 EventService (services/EventService.gs)

**Responsibilities:**
- Event CRUD operations (list, get, create, update)
- Pagination support (limit, offset)
- ETag-based caching
- Idempotency for create operations
- Slug generation with collision handling
- URL generation for event surfaces

**Key Functions:**
```javascript
EventService_list(params)        // Paginated event listing with ETag
EventService_get(params)         // Get single event with URLs
EventService_create(params)      // Create with validation & idempotency
EventService_update(params)      // Atomic update with LockService
EventService_validateData()      // Template-based validation
EventService_sanitizeData()      // Input sanitization
EventService_generateUrls()      // Generate publicUrl, posterUrl, displayUrl, reportUrl
```

**Data Flow:**
1. Validate brand and scope
2. Apply pagination/filtering
3. Read from Google Sheets
4. Generate ETags for cache validation
5. Return structured data with links

### 2.2 SponsorService (services/SponsorService.gs)

**Responsibilities:**
- Sponsor analytics aggregation (impressions, clicks, CTR, dwell time)
- ROI calculations
- Performance insights generation
- Placement validation
- Portfolio reporting (cross-brand)
- Engagement scoring

**Key Functions:**
```javascript
SponsorService_getAnalytics()          // Sponsor-specific analytics
SponsorService_calculateROI()          // ROI metrics with financials
SponsorService_aggregateMetrics()      // Aggregate by surface/event/timeline
SponsorService_calculateEngagementScore() // 0-100 engagement score
SponsorService_getSettings()           // Placement configuration
SponsorService_validatePlacements()    // Validate sponsor placements
SponsorService_getPortfolioSponsors()  // Cross-brand sponsor portfolio
```

**Placement System:**
- `posterTop`, `posterBottom` - Poster/print placements
- `tvTop`, `tvSide`, `tvDedicated` - TV display placements
- `mobileBanner`, `mobileInline` - Mobile/public page placements
- Premium upsell: `tvDedicated` for full-screen rotation

### 2.3 AnalyticsService (services/AnalyticsService.gs)

**Responsibilities:**
- Event logging (batch analytics)
- Data aggregation by surface, sponsor, token
- Report generation
- Timeline and trend analysis
- Shared analytics (event managers & sponsors)

**Key Functions:**
```javascript
AnalyticsService_logEvents(items)        // Batch log analytics events
AnalyticsService_getEventReport(params)  // Event-specific report
AnalyticsService_aggregateEventData()    // Aggregate metrics
AnalyticsService_getSharedAnalytics()    // Shared view for managers/sponsors
AnalyticsService_calculateEngagementRate() // CTR calculation
```

**Analytics Metrics:**
- **Impressions:** View counts
- **Clicks:** Interaction counts
- **Dwell Time:** Time spent viewing
- **CTR:** Click-through rate (clicks / impressions * 100)
- **Engagement Score:** Composite metric (CTR + dwell time)

### 2.4 FormService (services/FormService.gs)

**Responsibilities:**
- Google Forms template management
- Form creation from templates
- Response spreadsheet creation
- Form-event linking (partial implementation)

**Key Functions:**
```javascript
FormService_listTemplates()           // List available templates
FormService_createFromTemplate()      // Create form from template
FormService_addQuestionsToForm()      // Add questions to form
FormService_generateShortlink()       // Create trackable form links
```

**Template Types:**
- Signup forms
- Feedback forms
- Survey forms
- Custom event forms

### 2.5 SecurityMiddleware (services/SecurityMiddleware.gs)

**Responsibilities:**
- Multi-method authentication (adminKey, JWT, API Key)
- CSRF protection
- Rate limiting
- Input sanitization
- JWT generation and verification
- Brand isolation

**Key Functions:**
```javascript
SecurityMiddleware_authenticateRequest()  // Multi-method auth
SecurityMiddleware_generateJWT()         // Create JWT tokens
SecurityMiddleware_verifyJWT()           // Verify JWT with signature check
SecurityMiddleware_generateCSRFToken()   // CSRF token generation
SecurityMiddleware_validateCSRFToken()   // One-time CSRF validation
SecurityMiddleware_gate()                // Rate limit + auth gate
SecurityMiddleware_sanitizeInput()       // XSS prevention
SecurityMiddleware_sanitizeId()          // Safe ID validation
SecurityMiddleware_timingSafeCompare()   // Constant-time comparison
```

**Authentication Methods:**
1. **Admin Key** (legacy): `adminKey` in request body
2. **JWT Bearer Token**: `Authorization: Bearer <token>` header
3. **API Key**: `X-API-Key: <key>` header

**Security Features:**
- Timing-safe string comparison (prevents timing attacks)
- HMAC-SHA256 JWT signatures
- One-time CSRF tokens with atomic check-and-remove
- Rate limiting: 10 req/min per brand
- Failed auth tracking: Max 5 attempts per IP
- Formula injection prevention for spreadsheet values

---

## 3. API Patterns and Schemas

### 3.1 API Endpoint Structure

**RPC-style POST endpoints:**
```javascript
POST {BASE_URL}
Content-Type: application/json

{
  "action": "api_list",        // Function name
  "brandId": "root",
  "scope": "events",
  "limit": 100,
  "offset": 0,
  "ifNoneMatch": "etag-value"  // Optional ETag
}
```

**11 Core API Endpoints:**

| Endpoint | Auth Required | Purpose |
|----------|---------------|---------|
| `api_status` | No | Health check, system info |
| `api_list` | No | List events (public) |
| `api_get` | No | Get single event (public) |
| `api_create` | Yes | Create new event |
| `api_updateEventData` | Yes | Update event data |
| `api_logEvents` | No | Batch analytics logging |
| `api_getReport` | Yes | Get analytics report |
| `api_exportReport` | Yes | Export report to Sheets |
| `api_createShortlink` | Yes | Generate trackable shortlink |
| `api_runDiagnostics` | Yes | Run system diagnostics |
| `api_generateToken` | Yes | Generate JWT token |

### 3.2 Response Envelope Pattern

**Success Response:**
```javascript
{
  "ok": true,
  "value": { /* payload */ },
  "etag": "base64-hash"  // Optional for caching
}
```

**Error Response:**
```javascript
{
  "ok": false,
  "code": "BAD_INPUT",   // ERR.BAD_INPUT, NOT_FOUND, RATE_LIMITED, etc.
  "message": "User-friendly error message"
}
```

### 3.3 Contract Schemas (contracts/ApiSchemas.gs)

**Schema Definition Example:**
```javascript
events: {
  create: {
    request: {
      type: 'object',
      required: ['brandId', 'scope', 'templateId', 'data', 'adminKey'],
      properties: {
        brandId: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$' },
        templateId: { type: 'string' },
        data: { type: 'object' },
        idemKey: { type: 'string', pattern: '^[a-zA-Z0-9-]{1,128}$' }
      }
    },
    response: {
      type: 'object',
      required: ['ok', 'value'],
      properties: {
        ok: { type: 'boolean' },
        value: {
          type: 'object',
          required: ['id', 'links']
        }
      }
    }
  }
}
```

**Schema Categories:**
- `common` - Reusable types (id, brandId, scope, isoDate, url, email)
- `auth` - Authentication schemas
- `events` - Event CRUD schemas
- `analytics` - Analytics logging & reporting schemas
- `sponsors` - Sponsor analytics & ROI schemas
- `forms` - Form template schemas
- `error` - Error response schemas

**Contract Validation:**
- `ApiSchemas_validateRequest()` - Validate incoming requests
- `ApiSchemas_validateResponse()` - Validate outgoing responses
- `ApiSchemas_getSchema()` - Get schema for endpoint
- `ApiSchemas_getAllSchemas()` - Get all schemas (for documentation)

---

## 4. Card Components and UI Structure

### 4.1 Card Component System

**Base Card Component (components/CardComponent.html):**
```html
<section id="<?= cardId ?>" class="card" role="<?= cardRole || 'region' ?>">
  <div class="card-header">
    <h2><?= cardTitle ?></h2>
    <p class="card-subtitle"><?= cardSubtitle ?></p>
    <div class="card-actions"><?= cardActions ?></div>
  </div>
  <div class="card-body"><?= cardContent ?></div>
  <div class="card-footer"><?= cardFooter ?></div>
</section>
```

**Features:**
- Collapsible cards
- State variations (success, warning, error, info)
- Responsive design
- Accessibility support (ARIA labels, roles)
- Card actions (buttons, controls)

**Card Types:**
- `card-success` - Green border for success states
- `card-warning` - Orange border for warnings
- `card-error` - Red border for errors
- `card-info` - Blue border for informational cards

### 4.2 UI Pages

**Admin Pages:**
- **Admin.html** - Main admin interface (event CRUD, sponsor config)
- **AdminEnhanced.html** - Enhanced admin with wizard
- **AdminWizard.html** - Guided event creation wizard
- **PlannerCards.html** - Card-based event planning interface

**Public Pages:**
- **Public.html** - Public event listing with search/filter
- **Display.html** - TV/kiosk display mode with carousel
- **Poster.html** - Printable event posters with QR codes
- **SharedReport.html** - Shared analytics dashboard

**Utility Pages:**
- **ApiDocs.html** - Interactive API documentation
- **Test.html** - Built-in test/diagnostics page
- **Diagnostics.html** - System health dashboard
- **ConfigHtml.html** - Configuration UI
- **Signup.html** - Event signup forms

---

## 5. State Management Approach

### 5.1 Client-Side State (components/StateManager.html)

**EventStateManager Class:**
```javascript
class EventStateManager {
  constructor(options) {
    this.brandId = options.brandId;
    this.scope = options.scope;
    this.autoSaveInterval = options.autoSaveInterval || 30000;
    this.state = {
      currentEvent: null,
      draft: {},
      isDirty: false,
      lastSaved: null,
      history: [],        // Undo/redo history
      historyIndex: -1
    };
  }
}
```

**Features:**
- **Auto-save:** Periodic save every 30 seconds
- **Local storage:** Persist drafts across sessions
- **Undo/redo:** Full history with 50-state limit
- **Optimistic updates:** Update UI before server response
- **Event subscription:** Notify listeners of state changes

**State Operations:**
```javascript
updateDraft(updates)      // Partial update with history tracking
setCurrentEvent(event)    // Load event into state
clearDraft()              // Reset draft state
undo()                    // Revert to previous state
redo()                    // Reapply undone state
autoSave()                // Persist to server
subscribe(listener)       // Listen for state changes
```

### 5.2 Server-Side State

**Data Storage:**
- **Google Sheets:** Primary data store
- **Script Cache:** Rate limiting, CSRF tokens, idempotency keys
- **Script Properties:** Admin secrets (secure storage)
- **User Cache:** User-specific CSRF tokens

**Sheet Structure:**
```
EVENTS Sheet:
[id, brandId, templateId, data (JSON), createdAt, slug]

ANALYTICS Sheet:
[timestamp, eventId, surface, metric, sponsorId, value, token, userAgent]

DIAG Sheet:
[timestamp, level, where, message, metadata (JSON)]
```

---

## 6. Webhook and Integration Infrastructure

### 6.1 Current Integration Points

**Existing Integrations:**
- **Google Forms:** Template-based form creation (FormService)
- **Google Sheets:** Data storage and response collection
- **Google Drive:** File storage for forms/responses
- **Shortlink Service:** URL shortening with analytics tracking

**NO existing webhook infrastructure found:**
- No webhook registration system
- No webhook delivery mechanism
- No webhook retry logic
- No webhook payload signing

### 6.2 Integration Patterns

**Current Pattern (Pull):**
```
Client → API Request → Service → Google Sheets → Response → Client
```

**Needed Pattern (Push - Webhooks):**
```
Event Trigger → Webhook Service → Sign Payload → HTTP POST → External System
                                ↓
                         Retry Queue (if failed)
```

**Potential Implementation Location:**
- New service: `services/WebhookService.gs`
- New sheet: `WEBHOOKS` (webhook registrations)
- New sheet: `WEBHOOK_DELIVERIES` (delivery history)

---

## 7. i18n and Localization

### 7.1 Current Localization Status

**NO internationalization infrastructure found:**
- No language detection
- No translation system
- No locale-specific formatting
- Hardcoded English strings throughout UI

**Areas Requiring i18n:**
- UI labels and messages
- Error messages
- Date/time formatting
- Number formatting
- Currency display (for ROI calculations)
- Email templates (future)

### 7.2 i18n Implementation Strategy

**Recommended Approach:**

1. **Translation Files:**
```javascript
// Config.gs - Add locale definitions
const LOCALES = {
  'en-US': {
    errors: {
      BAD_INPUT: 'Invalid request. Please check your input.',
      NOT_FOUND: 'The requested resource was not found.'
    },
    ui: {
      events: {
        createButton: 'Create Event',
        editButton: 'Edit Event'
      }
    }
  },
  'es-ES': { /* Spanish translations */ },
  'fr-FR': { /* French translations */ }
};
```

2. **Locale Detection:**
- URL parameter: `?lang=es`
- Browser header: `Accept-Language`
- User preference: Stored in brand config
- Default fallback: `en-US`

3. **Translation Helper:**
```javascript
function t(key, locale = 'en-US') {
  const keys = key.split('.');
  let value = LOCALES[locale];
  for (const k of keys) {
    value = value?.[k];
  }
  return value || key;  // Fallback to key if not found
}
```


---

## 8. Testing Infrastructure

### 8.1 Test Organization (Triangle Framework)

**Triangle Framework - Event Lifecycle Testing:**

```
📋 Before Event (Green)    ▶️ During Event (Orange)    📊 After Event (Purple)    ⚡ All Phases (Blue)
├── Event creation         ├── Event display           ├── Analytics logging     ├── Health checks
├── Sponsor setup          ├── Public listing          ├── Report generation     ├── Authentication
├── Form templates         ├── Real-time updates       ├── Export to Sheets      ├── Error handling
└── Shortlink generation   └── Display carousel        └── ROI calculations       └── Diagnostics
```

**Test Counts:**
- **Unit Tests:** 78 tests (Jest)
- **Contract Tests:** 72 tests (16 general + 56 triangle-specific)
- **E2E Tests:** 40+ tests (Playwright)
- **Load Tests:** 4 scenarios (k6)
- **Total:** 150+ tests

### 8.2 Test Suite Structure

**Unit Tests (tests/unit/):**
```javascript
tests/unit/backend.test.js
  ├── Error envelope functions (Ok/Err)
  ├── Input sanitization (XSS, formula injection)
  ├── URL validation
  ├── Schema validation
  ├── Rate limiting logic
  ├── Slug generation
  └── Frontend SDK (NU.esc)
```

**Contract Tests (tests/contract/):**
```javascript
tests/contract/api.contract.test.js
  ├── Request schema validation
  ├── Response schema validation
  ├── Error format validation
  └── Contract version checking
```

**Triangle Contract Tests (tests/triangle/**/contract/):**
```javascript
Before Event:
  ├── Event creation contract
  ├── Shortlink generation contract
  └── Form template contract

During Event:
  ├── Event details contract
  ├── Event list contract
  └── ETag caching contract

After Event:
  ├── Analytics logging contract
  ├── Report generation contract
  └── Export contract

All Phases:
  ├── Status endpoint contract
  ├── Error handling contract
  └── Authentication contract
```

**E2E Tests (tests/e2e/):**
```javascript
tests/e2e/
  ├── authentication.spec.js        (25+ tests - all auth methods)
  ├── api-docs-page.spec.js         (40+ tests - interactive docs)
  ├── admin-workflows.spec.js       (admin interface flows)
  ├── critical-flows.spec.js        (end-to-end user journeys)
  ├── 1-smoke/                      (critical smoke tests)
  ├── 2-pages/                      (page-specific tests)
  ├── 3-flows/                      (complex workflow tests)
  └── api/                          (API integration tests)
```

### 8.3 Testing Commands

```bash
# Unit & Contract Tests
npm test                              # Run all Jest tests
npm run test:unit                     # Unit tests only
npm run test:contract                 # Contract tests only
npm run test:coverage                 # With coverage report

# Triangle Tests
npm run test:triangle                 # All triangle tests (sequential)
npm run test:triangle:parallel        # All triangle tests (parallel)
npm run test:triangle:before          # Before-event phase
npm run test:triangle:during          # During-event phase
npm run test:triangle:after           # After-event phase
npm run test:triangle:all             # All-phases tests

# E2E Tests
npm run test:e2e                      # All E2E tests
npm run test:smoke                    # Smoke tests only
npm run test:api                      # API tests only
npm run test:pages                    # Page tests only
npm run test:flows                    # Flow tests only

# Load Tests
npm run test:load:smoke               # Smoke load test
npm run test:load:average             # Average load test
npm run test:load:stress              # Stress test
npm run test:load:spike               # Spike test
```

---

## 9. DevOps and Deployment

### 9.1 CI/CD Pipeline

**GitHub Actions Workflows:**

```
.github/workflows/
├── stage1-deploy.yml           # Build, test, deploy to Apps Script
├── stage2-testing.yml          # E2E testing on deployed app
├── unit-contract-tests.yml     # Fast unit/contract tests
├── quality-gates-scenarios.yml # Scenario-based quality gates
├── load-testing.yml            # Performance/load testing
├── qa-rollback.yml             # QA environment rollback
└── codeql-analysis.yml         # Security scanning
```

**Deployment Pipeline (stage1-deploy.yml):**

```yaml
Stage 1: Build & Deploy
  ├── lint                 # ESLint code quality
  ├── unit-tests           # Jest unit tests
  ├── contract-tests       # API contract tests
  ├── deploy-to-apps-script # Deploy via Apps Script API
  └── outputs: deployment_url, root_url, abc_url, cbc_url
```

**Testing Pipeline (stage2-testing.yml):**

```yaml
Stage 2: Testing
  ├── e2e-smoke-tests      # Critical smoke tests
  ├── e2e-api-tests        # API integration tests
  ├── e2e-page-tests       # UI page tests
  ├── e2e-flow-tests       # User flow tests
  └── quality-gate-check   # Pass/fail decision
```

### 9.2 Deployment Methods

**1. GitHub Actions (Recommended):**
```bash
git push origin main
# Automatic deployment via CI/CD
```

**2. clasp CLI:**
```bash
npm run push       # Push code to Apps Script
npm run deploy     # Create new deployment
npm run open       # Open in Apps Script Editor
```

**3. Manual Copy-Paste:**
- Open Apps Script Editor
- Copy/paste files
- Deploy → New deployment

### 9.3 Environment Configuration

**Environments:**
- **Production:** Main deployment (auto-deploy on `main` branch)
- **QA:** Testing environment (manual deployment)
- **Development:** Local development with clasp

**Environment Variables (GitHub Secrets):**
```
SCRIPT_ID                # Apps Script project ID
GOOGLE_SERVICE_ACCOUNT   # Service account JSON (base64)
ADMIN_SECRET_ROOT        # Root brand admin secret
ADMIN_SECRET_ABC         # ABC brand admin secret
ADMIN_SECRET_CBC         # CBC brand admin secret
```

---

## 10. Multi-Template System

### 10.1 Current Template System

**Template Definition (Config.gs):**

```javascript
const TEMPLATES = [
  {
    id: 'default-v1',
    label: 'Simple Event',
    description: 'Basic event with essential fields',
    fields: [
      { id: 'name', label: 'Event Name', type: 'text', required: true },
      { id: 'dateISO', label: 'Date', type: 'date', required: true },
      { id: 'timeISO', label: 'Time', type: 'time', required: false },
      { id: 'location', label: 'Location', type: 'text', required: false },
      { id: 'summary', label: 'Description', type: 'textarea', required: false },
      { id: 'imageUrl', label: 'Image URL', type: 'url', required: false }
    ],
    formTemplates: ['signup', 'feedback']
  },
  {
    id: 'tournament-v1',
    label: 'Tournament Event',
    description: 'Tournament with brackets and scoring',
    fields: [
      /* tournament-specific fields */
    ],
    formTemplates: ['registration', 'team-signup', 'scoring']
  }
];
```

**Template Usage:**
1. Admin selects template during event creation
2. System validates data against template fields
3. Form templates auto-generated based on event type
4. UI dynamically renders based on template structure

### 10.2 Template Extension Points

**NO multi-template rendering system found:**
- No template inheritance
- No template composition
- No template versioning
- Single hardcoded template per event type

**Needed Enhancements:**
1. **Template Inheritance:**
   - Base template → Extended template
   - Shared field definitions
   - Override mechanisms

2. **Template Composition:**
   - Mix-and-match field sets
   - Conditional fields
   - Dynamic field groups

3. **Template Versioning:**
   - Version tracking (v1, v2, v3)
   - Migration paths
   - Backward compatibility

4. **Rendering System:**
   - Template-driven UI generation
   - Custom widgets per field type
   - Layout configurations

---

## 11. MCP (Model Context Protocol) Integration Opportunities

### 11.1 Current State

**NO MCP infrastructure found:**
- No AI/LLM integrations
- No external model connections
- No context management system
- No prompt engineering infrastructure

### 11.2 Potential MCP Use Cases

**1. Event Content Generation:**
```javascript
// Generate event descriptions from minimal input
MCPService_generateEventDescription({
  eventType: 'tournament',
  keywords: ['bocce', 'summer', 'Chicago'],
  tone: 'friendly'
})
→ Returns: AI-generated event description
```

**2. Smart Analytics Insights:**
```javascript
// Generate insights from analytics data
MCPService_analyzeEventPerformance({
  eventId: 'evt-123',
  analyticsData: { /* metrics */ }
})
→ Returns: AI-generated insights and recommendations
```

**3. Form Generation:**
```javascript
// Generate custom forms from natural language
MCPService_generateForm({
  eventType: 'workshop',
  description: 'I need a registration form with skill level and dietary preferences'
})
→ Returns: Form template with appropriate questions
```

**4. Sponsor Recommendations:**
```javascript
// Recommend optimal sponsor placements
MCPService_optimizeSponsorPlacement({
  sponsors: [/* sponsor list */],
  eventType: 'tournament',
  budget: 5000
})
→ Returns: Placement recommendations with ROI predictions
```

**5. Translation & Localization:**
```javascript
// AI-powered translation
MCPService_translate({
  text: 'Welcome to our event!',
  sourceLang: 'en',
  targetLang: 'es',
  context: 'event-invitation'
})
→ Returns: Context-aware translation
```

### 11.3 MCP Implementation Architecture

**Proposed Structure:**
```javascript
services/MCPService.gs
  ├── MCPService_connect()           // Establish MCP connection
  ├── MCPService_generateContent()   // Content generation
  ├── MCPService_analyzeData()       // Data analysis
  ├── MCPService_translate()         // Translation
  ├── MCPService_optimizePlacement() // Optimization
  └── MCPService_cacheResponse()     // Response caching
```

**Integration Points:**
- EventService → Content generation
- AnalyticsService → Insight generation
- SponsorService → Placement optimization
- FormService → Form generation
- i18n Service → Translation

---

## 12. Implementation Recommendations

### 12.1 Webhook System Implementation

**Priority: HIGH**

**Implementation Plan:**

1. **Create WebhookService (services/WebhookService.gs):**
```javascript
WebhookService_register(params)      // Register webhook endpoint
WebhookService_unregister(id)        // Unregister webhook
WebhookService_list(brandId)        // List registered webhooks
WebhookService_deliver(event, data)  // Deliver webhook payload
WebhookService_retry(deliveryId)     // Retry failed delivery
WebhookService_signPayload(payload)  // HMAC signature for security
```

2. **Add WEBHOOKS Sheet:**
```
[id, brandId, eventType, url, secret, enabled, createdAt]
```

3. **Add WEBHOOK_DELIVERIES Sheet:**
```
[id, webhookId, eventType, payload, statusCode, attempts, lastAttempt, success]
```

4. **Webhook Events:**
- `event.created` - New event created
- `event.updated` - Event data updated
- `event.deleted` - Event deleted
- `analytics.report` - Analytics report generated
- `sponsor.performance` - Sponsor performance threshold reached
- `form.submitted` - Form submission received

5. **Security:**
- HMAC-SHA256 signature in `X-Webhook-Signature` header
- Payload verification at receiver
- Rate limiting per webhook
- Retry with exponential backoff

### 12.2 i18n System Implementation

**Priority: MEDIUM-HIGH**

**Implementation Plan:**

1. **Create i18nService (services/i18nService.gs):**
```javascript
i18n_detectLocale(request)          // Detect user locale
i18n_translate(key, locale)         // Get translation
i18n_formatDate(date, locale)       // Locale-specific date format
i18n_formatNumber(number, locale)   // Locale-specific number format
i18n_formatCurrency(amount, locale) // Locale-specific currency
```

2. **Translation Storage:**
```javascript
// Option 1: Embedded in Config.gs (small apps)
const TRANSLATIONS = { /* locale data */ };

// Option 2: Separate sheet (large apps)
TRANSLATIONS Sheet:
[locale, key, value, context]
```

3. **Frontend Integration:**
```html
<!-- NUSDK.html - Add translation helper -->
<script>
window.NU.t = function(key, params = {}) {
  const locale = NU.locale || 'en-US';
  return NU.rpc('i18n_translate', { key, locale, params });
};
</script>
```

4. **Template Updates:**
```html
<!-- Before -->
<button>Create Event</button>

<!-- After -->
<button><?= t('ui.events.createButton') ?></button>
```

### 12.3 Multi-Template System Implementation

**Priority: MEDIUM**

**Implementation Plan:**

1. **Template Versioning:**
```javascript
const TEMPLATES = [
  {
    id: 'default-v2',
    version: 2,
    extendsFrom: 'default-v1',  // Inheritance
    fields: [/* new/overridden fields */],
    migration: function(v1Data) {
      // Migrate from v1 to v2
      return v2Data;
    }
  }
];
```

2. **Template Composition:**
```javascript
{
  id: 'custom-event',
  composedFrom: ['base-event', 'sponsor-fields', 'registration-fields'],
  conditionalFields: [
    {
      field: 'registrationEnabled',
      showIf: { type: 'checkbox', value: true },
      fields: [/* registration-specific fields */]
    }
  ]
}
```

3. **Rendering System:**
```javascript
TemplateService_render(templateId, data) {
  const template = findTemplate_(templateId);
  const html = template.fields.map(field => {
    return renderField(field, data[field.id]);
  }).join('\n');
  return html;
}
```

### 12.4 MCP Integration Implementation

**Priority: LOW-MEDIUM**

**Implementation Plan:**

1. **Create MCPService (services/MCPService.gs):**
```javascript
MCPService_initialize(config)        // Initialize MCP connection
MCPService_prompt(prompt, context)   // Send prompt to model
MCPService_stream(prompt, callback)  // Streaming responses
MCPService_embeddings(text)          // Generate embeddings
MCPService_completion(params)        // Text completion
```

2. **API Key Storage:**
```javascript
// Script Properties (secure)
PropertiesService.getScriptProperties()
  .setProperty('MCP_API_KEY', 'your-api-key');
```

3. **Use Cases (Phase 1):**
- Content generation for events
- Smart analytics insights
- Form question suggestions

4. **Use Cases (Phase 2):**
- Translation (alternative to Google Translate)
- Sponsor placement optimization
- Predictive analytics

---

## 13. Architecture Gaps & Risks

### 13.1 Current Gaps

**Missing Infrastructure:**
- ❌ Webhook system (event notifications)
- ❌ i18n/localization (multi-language support)
- ❌ Multi-template rendering (flexible UI generation)
- ❌ MCP integration (AI/LLM capabilities)
- ❌ Email notifications
- ❌ File uploads (images, documents)
- ❌ Background jobs/queue system
- ❌ Data export (CSV, PDF, Excel)

**Partial Implementations:**
- ⚠️ Form-event linking (FormService)
- ⚠️ Template system (basic, no versioning)
- ⚠️ Portfolio reporting (SponsorService)

### 13.2 Technical Debt

**Code Quality:**
- Large monolithic files (Code.gs: 2500+ lines)
- Some code duplication in HTML files
- Limited error recovery mechanisms
- No circuit breakers for external calls

**Testing:**
- Good coverage (90%+) but room for improvement
- Limited performance testing
- No chaos engineering tests
- Missing accessibility tests

**Documentation:**
- Extensive documentation (50+ MD files)
- Some docs outdated
- API docs in separate file (not auto-generated)

### 13.3 Scalability Concerns

**Google Apps Script Limits:**
- Script runtime: 6 minutes max
- Daily quotas: 90 minutes script runtime/day
- URL Fetch calls: 20,000/day
- Spreadsheet reads: Limited by quotas
- No background jobs

**Mitigations:**
- Batch operations (analytics logging)
- Caching (Script Cache, ETag)
- Pagination (event listing)
- Rate limiting (10 req/min per brand)

---

## 14. Summary & Next Steps

### 14.1 Architecture Strengths

✅ **Well-structured service layer** (EventService, SponsorService, AnalyticsService)
✅ **Comprehensive security** (JWT, CSRF, rate limiting, input sanitization)
✅ **Strong testing infrastructure** (150+ tests, Triangle framework)
✅ **Multi-brand architecture** (brand isolation, scope management)
✅ **API-first design** (11 endpoints with schemas)
✅ **Component-based UI** (reusable cards, state management)
✅ **Robust CI/CD** (GitHub Actions, automated deployment)

### 14.2 Recommended Implementation Order

**Phase 1 - Foundation (Weeks 1-2):**
1. Webhook infrastructure (WebhookService + sheets)
2. Basic i18n system (translation helper + locale detection)
3. Enhanced template system (versioning + composition)

**Phase 2 - Integration (Weeks 3-4):**
4. Webhook event triggers (event.created, event.updated)
5. i18n UI integration (translate all pages)
6. Template-driven form generation

**Phase 3 - Enhancement (Weeks 5-6):**
7. MCP integration (content generation, insights)
8. Advanced webhook features (retry logic, signature verification)
9. Multi-language templates

**Phase 4 - Polish (Weeks 7-8):**
10. Comprehensive testing for new features
11. Documentation updates
12. Performance optimization

### 14.3 Critical Success Factors

1. **Maintain backward compatibility** - Existing events must work
2. **Preserve security** - No regressions in auth/rate limiting
3. **Test coverage** - Maintain 90%+ coverage
4. **Performance** - Stay within Apps Script quotas
5. **Documentation** - Keep docs updated

---

## 15. File Reference

**Key Files to Modify for New Features:**

**Webhooks:**
- Create: `services/WebhookService.gs`
- Update: `Code.gs` (add `api_registerWebhook`, etc.)
- Update: `contracts/ApiSchemas.gs` (webhook schemas)
- Test: `tests/unit/webhook.test.js`, `tests/e2e/webhooks.spec.js`

**i18n:**
- Create: `services/i18nService.gs`
- Update: `Config.gs` (add LOCALES constant)
- Update: All `*.html` files (replace hardcoded strings)
- Update: `NUSDK.html` (add translation helper)
- Test: `tests/unit/i18n.test.js`, `tests/e2e/i18n.spec.js`

**Multi-Template:**
- Update: `Config.gs` (enhance TEMPLATES structure)
- Create: `services/TemplateService.gs`
- Update: `services/EventService.gs` (template rendering)
- Update: `Admin.html`, `PlannerCards.html` (dynamic UI)
- Test: `tests/contract/templates.contract.test.js`

**MCP:**
- Create: `services/MCPService.gs`
- Update: `Code.gs` (add MCP endpoints)
- Update: Script Properties (API keys)
- Test: `tests/unit/mcp.test.js`, `tests/e2e/mcp.spec.js`

---

**End of Architecture Overview**
