# MVP-EVENT-TOOLKIT: Comprehensive Technical Architecture Analysis

**Analysis Date:** November 11, 2025
**Build ID:** triangle-extended-v1.3
**Contract Version:** 1.0.3

---

## Executive Summary

The MVP-EVENT-TOOLKIT is a multi-brand event management system built on Google Apps Script (serverless) with a Google Sheets backend. It implements a layered architecture with clear separation between configuration, backend logic, and frontend presentation layers.

### Key Architectural Characteristics
- **Multi-brand:** Isolated brands with separate admin secrets
- **Serverless:** Google Apps Script backend with no external servers
- **Spreadsheet-Backed:** Google Sheets as primary database
- **Event-Driven:** Analytics and impression tracking throughout
- **Progressive Web App:** Works offline on mobile/desktop
- **CORS-Safe:** Designed for custom frontend integrations

---

## 1. CONFIGURATION ARCHITECTURE

### 1.1 Config.gs Structure

**File Location:** `/home/user/MVP-EVENT-TOOLKIT/Config.gs`

#### Brand Configuration Model

```javascript
BRANDS = [
  {
    id: 'root',                           // Unique brand identifier
    name: 'Zeventbook',                   // Display name
    hostnames: ['zeventbook.io', ...],    // Hostname routing
    logoUrl: '/My files/...',             // Branding
    adminSecret: 'HASH',                  // Authentication key
    store: { type: 'workbook', 
             spreadsheetId: '1ixHd2...' }, // Data store reference
    scopesAllowed: ['events', 'sponsors'] // Feature scopes
  }
]
```

#### Template Configuration

**Event Template Fields (13 fields)**
- Core: `name`, `dateISO`, `timeISO`, `location`, `entity`
- Content: `summary`, `summaryLink`, `imageUrl`, `videoUrl`, `galleryUrls`, `bio`, `bioLink`
- Actions: `signupUrl`, `registerUrl`, `checkinUrl`, `walkinUrl`, `surveyUrl`
- Relationships: `sponsorIds` (comma-separated)

**Sponsor Template Fields (8 fields)**
- Identification: `name`, `logoUrl`, `website`
- Metadata: `tier`, `entity`, `startDate`, `endDate`, `displayOrder`

#### Form Templates (Google Forms Pre-built)

| Template | Type | Purpose | Questions |
|----------|------|---------|-----------|
| check-in | Pre-built | Registered attendee check-in | 5 |
| walk-in | Pre-built | On-site registration | 6 |
| survey | Pre-built | Post-event feedback | 6 |

### 1.2 Data Flow: Config → Backend → Frontend

```
┌─────────────────────────────────────────────────────────────┐
│ USER REQUEST                                                 │
├─────────────────────────────────────────────────────────────┤
│ 1. doGet(e) receives request with:                          │
│    - page parameter (admin/public/display/poster/report)    │
│    - brand identification (hostname, query param)           │
│    - scope parameter (events, sponsors, etc)                │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│ CONFIGURATION LOOKUP                                        │
├─────────────────────────────────────────────────────────────┤
│ findBrandByHost_() → findBrand_()                        │
│ Resolves: logoUrl, adminSecret, scopesAllowed             │
│ Validates: scope in scopesAllowed[]                        │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│ TEMPLATE INSTANTIATION                                      │
├─────────────────────────────────────────────────────────────┤
│ tpl = HtmlService.createTemplateFromFile(pageFile_())      │
│ tpl.appTitle = "${brand.name} · ${scope}"                │
│ tpl.brandId = brand.id                                  │
│ tpl.scope = scope                                          │
│ tpl.execUrl = ScriptApp.getService().getUrl()            │
│ tpl.ZEB = ZEB (build info)                                │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND INITIALIZATION                                     │
├─────────────────────────────────────────────────────────────┤
│ HTML template receives:                                      │
│ - const BRAND = '<?= brandId ?>'                         │
│ - const SCOPE = '<?= scope ?>'                             │
│ - const EXEC_URL = '<?= execUrl ?>'                        │
│ - const appTitle = '<?= appTitle ?>'                       │
│ - const ZEB = <?= JSON.stringify(ZEB) ?>                   │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│ RPC CALLS WITH CONFIG                                       │
├─────────────────────────────────────────────────────────────┤
│ NU.rpc('api_list', {                                        │
│   brandId: BRAND,        ← From config                   │
│   scope: SCOPE             ← From config                   │
│ })                                                          │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 Environment-Specific Settings

**Current Implementation:**
- **No explicit environment handling** - Single config for all environments
- Brand system provides isolation, not environment separation
- Build ID (`ZEB.BUILD_ID`) is hardcoded version identifier

**Hardcoded Values That Should Be Configurable:**

| Value | Location | Severity | Recommendation |
|-------|----------|----------|-----------------|
| `DIAG_MAX = 3000` | Code.gs:54 | Low | Move to Config.gs |
| `DIAG_PER_DAY = 800` | Code.gs:54 | Low | Move to Config.gs |
| `RATE_MAX_PER_MIN = 20` | Code.gs:476 | Medium | Make brand-specific |
| Log retention logic | Code.gs:73-81 | Medium | Extract to config |
| Video embed logic | Public.html:377-394 | Low | Centralize providers |
| Restricted embeds | Display.html:226 | Low | Config-driven allowlist |
| Image URLs (logos) | Config.gs:16,25,34,43 | High | Use CDN with fallback |
| Admin secrets | Config.gs:17,26,35,44 | Critical | Use Google Secrets API |

---

## 2. EVENT SYSTEM ARCHITECTURE

### 2.1 Event Lifecycle Model

```
CREATE → DISPLAY → ANALYTICS → EXPORT
  ↓        ↓          ↓          ↓
DB    Multiple   Impression  Report
      Surfaces   Tracking    Creation
```

### 2.2 Event Data Model

**Event Storage (Spreadsheet Row)**
```
Column 1: id           (UUID)
Column 2: brandId     (Reference to Config.BRANDS[].id)
Column 3: templateId   ('event')
Column 4: dataJSON     (Serialized event fields)
Column 5: createdAt    (ISO timestamp)
Column 6: slug         (URL-safe name for shortlinks)
```

**Nested Data Structure (JSON)**
```javascript
{
  // Core event metadata
  name: "Annual Bocce Championship",
  dateISO: "2025-12-15",
  timeISO: "14:00",
  location: "Central Park, NYC",
  entity: "American Bocce Co.",
  
  // Content
  summary: "Join us for the biggest bocce event...",
  summaryLink: "https://example.com/event",
  imageUrl: "https://example.com/poster.jpg",
  videoUrl: "https://youtube.com/watch?v=...",
  galleryUrls: "url1, url2, url3",
  bio: "Organized by...",
  bioLink: "https://example.com/about",
  
  // Sign-up/Check-in URLs (form links)
  registerUrl: "https://forms.google.com/...",
  checkinUrl: "https://forms.google.com/...",
  walkinUrl: "https://forms.google.com/...",
  surveyUrl: "https://forms.google.com/...",
  signupUrl: "https://forms.google.com/...",
  
  // Display configuration
  display: {
    mode: "public" | "dynamic",
    urls: [ { url, seconds } ]  // For dynamic carousel
  },
  
  // Sponsor integration
  sponsors: [
    {
      id: "uuid",
      name: "Sponsor Name",
      url: "https://sponsor.com",
      img: "https://cdn.example.com/logo.png",
      placements: {
        posterTop: boolean,
        tvTop: boolean,
        tvSide: boolean,
        mobileBanner: boolean
      }
    }
  ]
}
```

### 2.3 Event Listeners and Event Flow

#### Frontend Event Listeners by Page

**Public.html**
```
┌─────────────────────────────────────────────────────────┐
│ PAGE LOAD (window.onload equivalent)                    │
├─────────────────────────────────────────────────────────┤
│ if (ID) → NU.rpc('api_get') → renderDetail()           │
│ else → NU.rpc('api_list') → renderList()               │
└─────────────────────────────────────────────────────────┘

USER INTERACTIONS:
├─ Sponsor banner hover → logEvent('impression')
├─ Sponsor banner click → logEvent('click')
├─ Event card click → Navigate to detail view
├─ Button clicks (Register/Signin/Survey) → window.open()
└─ beforeunload → flush() [queue analytics]

ANALYTICS BATCHING:
├─ Collect events in logBatch[]
├─ Flush when logBatch.length >= 4
├─ Flush every 5 seconds (setInterval)
├─ Flush on beforeunload (page exit)
└─ Transport: google.script.run.api_logEvents()
```

**Admin.html**
```
┌─────────────────────────────────────────────────────────┐
│ FORM SUBMISSION (createForm.addEventListener)           │
├─────────────────────────────────────────────────────────┤
│ 1. Collect form data (name, date, optional fields)      │
│ 2. NU.rpc('api_create', {...})                          │
│ 3. Store currentEventId = res.value.id                  │
│ 4. showEventCard(res.value)                             │
│ 5. Display links (public, poster, display, report)      │
└─────────────────────────────────────────────────────────┘

CHILD INTERACTIONS:
├─ configureDisplay() → loadDisplayConfig() → saveDisplayConfig()
│  ├─ Manage sponsors list
│  ├─ Configure display mode (public/dynamic)
│  └─ Upload carousel URLs
│
├─ configureSignup() → loadSignupForms() → saveAllSignupForms()
│  ├─ Set register URL
│  ├─ Set checkin URL
│  ├─ Set walkin URL
│  └─ Set survey URL
│
└─ openFormsTemplates() → createFormTemplate() → copyFormLink()
   ├─ createFormTemplate('check-in'|'walk-in'|'survey')
   ├─ api_createFormFromTemplate() → FormApp.create()
   ├─ api_generateFormShortlink() → api_createShortlink()
   └─ Display results with copy buttons
```

**Display.html (TV/Kiosk Mode)**
```
┌─────────────────────────────────────────────────────────┐
│ PAGE LOAD (boot())                                      │
├─────────────────────────────────────────────────────────┤
│ 1. NU.rpc('api_get', {eventId, brandId})              │
│ 2. renderSponsorTop(ev.data.sponsors[].tvTop)          │
│ 3. renderSponsorSide(ev.data.sponsors[].tvSide)        │
│ 4. Check display.mode:                                  │
│    ├─ 'public' → startPublicMode()                      │
│    └─ 'dynamic' → startDynamicMode(display.urls)        │
└─────────────────────────────────────────────────────────┘

CAROUSEL LOGIC (Dynamic Mode):
├─ Loop through display.urls[]
├─ Load iframe for each URL
├─ Log impressions/dwell time
├─ Handle blocked embeds (Instagram, TikTok)
├─ Rotate on timer (url.seconds)
└─ Log: { eventId, surface: 'display', metric: 'impression|dwellSec' }

ERROR HANDLING:
├─ Fallback on iframe load error
├─ Timeout detection (4 seconds)
└─ Restricted embed detection (skip Instagram/TikTok)
```

#### Event Listener Patterns: Anti-Patterns & Issues

**Issue #1: Dual Event Logging Mechanisms**
```javascript
// Public.html: Batch + interval
logBatch.push(evt);
if (logBatch.length >= 4) flush();
setInterval(flush, 5000);

// Display.html: Direct + interval
logEvent(); // Direct append to batch
setInterval(flush, 6000);
```
**Problem:** Inconsistent flush thresholds (4 vs 5000ms, 5s vs 6s)
**Fix:** Centralize in NU SDK

**Issue #2: Race Condition in Admin.html**
```javascript
currentEventId = res.value.id;  // Set here
showEventCard(res.value);        // Used here

// But if user clicks buttons before showEventCard() completes...
configureDisplay() {
  if (!currentEventId) return;  // Could be undefined
}
```
**Severity:** Low (UI prevents interaction before completion)
**Fix:** Add loading state overlay

**Issue #3: Missing Error Boundaries**
```javascript
// No catch blocks in many event handlers
NU.rpc('api_create', {...})  // If fails, error silent
  .then(res => {
    // Assumes res.ok = true
    currentEventId = res.value.id;  // Crashes if undefined
  })
```

---

## 3. SPONSOR SYSTEM ARCHITECTURE

### 3.1 Sponsor Data Model

**Sponsor Storage**
```javascript
{
  id: "uuid",
  name: "Company Name",
  url: "https://company.com",
  img: "https://cdn.example.com/logo.png",
  placements: {
    posterTop: boolean,     // Display on printed poster
    tvTop: boolean,         // Top banner on TV display
    tvSide: boolean,        // Side panel on TV display
    mobileBanner: boolean   // Banner on mobile (Public.html)
  }
}
```

**Where Stored:**
- Event's `data.sponsors[]` array in spreadsheet JSON
- Updated via `api_updateEventData()` → Admin.html form

### 3.2 Sponsor → Display Rendering Path

```
┌─────────────────────────────────────────────────────────┐
│ ADMIN CREATES/EDITS EVENT                               │
├─────────────────────────────────────────────────────────┤
│ Admin.html: configureDisplay()                          │
│  └─ User adds sponsor with placements                  │
│     └─ saveDisplayConfig()                              │
│        └─ NU.rpc('api_updateEventData', {sponsors})    │
│           └─ Code.gs: api_updateEventData()            │
│              └─ Spreadsheet updated with new sponsors   │
└──────────────────┬──────────────────────────────────────┘
                   │
        ┌──────────┴──────────┬──────────────┐
        │                     │              │
        ▼                     ▼              ▼
    PUBLIC        DISPLAY      POSTER
    (Mobile)      (TV)         (Print)
        │           │          │
        ├─ Filter:  ├─ Filter: └─ Filter:
        │ mobileBanner
        │ only       │ tvTop    posterTop
        │            │ & tvSide only
        ▼            ▼          ▼
  Banner at       Top bar +  Sponsor
  top of event    Side panel  strip
```

### 3.3 Sponsor Analytics Integration

**Impression Logging:**
```javascript
// Public.html: renderSponsorBanner()
logEvent({
  eventId: ev.id,
  surface: 'public',
  metric: 'impression',
  sponsorId: s.id || ''
})

// Display.html: renderSponsorTop/renderSponsorSide()
logEvent({
  eventId,
  surface: 'display',
  metric: 'impression',
  sponsorId: s.id || ''
})
```

**Click Tracking:**
```javascript
// When sponsor has URL, log click
sponsorLink.addEventListener('click', () => {
  logEvent({
    eventId: ev.id,
    surface: 'public',
    metric: 'click',
    sponsorId: s.id || ''
  })
})
```

**Aggregation (Code.gs: api_getReport):**
```javascript
agg.bySponsor[sponsorId] = {
  impressions: number,
  clicks: number,
  ctr: clicks / impressions,
  dwellSec: total_dwell
}
```

### 3.4 Sponsor System Issues

**Issue #1: Sponsor ID Collision Risk**
```javascript
// Admin.html line 782
id: (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `sp-${Date.now()}`  // ← Not collision-safe
```
**Risk:** Two sponsors added in same millisecond get same ID
**Fix:** Use `Utilities.getUuid()` from Apps Script

**Issue #2: No Sponsor Template Management**
- Sponsors are nested in events
- No separate Sponsor CRUD
- Can't reuse sponsors across events
**Impact:** Sponsor data duplication
**Recommendation:** Create SPONSOR sheet + normalize relationships

---

## 4. FUNCTION MAPPING

### 4.1 All Backend API Functions

| Function | Purpose | Auth | Input | Output | Called By |
|----------|---------|------|-------|--------|-----------|
| `api_status()` | Health check | No | - | {build, contract, time, db} | DiagnosticsDashboard.html |
| `api_healthCheck()` | Health ping | No | - | {checks:[]} | Custom integrations |
| `api_getConfig({brandId, scope})` | Get config/templates | No | brandId, scope | {brands[], templates[]} | Public.html (init) |
| `api_list({brandId, scope})` | List events/sponsors | No | brandId, scope, etag | {items:[]} | Public.html, Admin.html |
| `api_get({brandId, scope, id})` | Get single event | No | brandId, scope, id, etag | {id, data, links} | Admin.html, Display.html |
| `api_create({brandId, scope, templateId, data, adminKey})` | Create event | **Yes** | data fields | {id, links} | Admin.html, Diagnostics.html |
| `api_updateEventData({brandId, scope, id, data, adminKey})` | Update event | **Yes** | partial data | updated event | Admin.html |
| `api_logEvents({items:[]})` | Log analytics | No | impression/click/dwell events | {count} | Public.html, Display.html |
| `api_getReport({id})` | Get analytics report | No | eventId | {totals, bySurface, bySponsor} | Analytics viewers |
| `api_exportReport({id})` | Export to sheet | **Yes** | eventId | {sheetUrl} | Admin.html (planned) |
| `api_createShortlink({targetUrl, eventId, sponsorId, surface, adminKey})` | Create redirect | **Yes** | targetUrl, metadata | {token, shortlink} | Admin.html, Diagnostics.html |
| `api_generateToken({brandId, adminKey, expiresIn, scope})` | Generate JWT | **Yes** | adminKey, scope | {token, expiresAt, usage} | Integration requests |
| `api_listFormTemplates()` | List form templates | No | - | {templates:[]} | Admin.html |
| `api_createFormFromTemplate({brandId, templateType, eventName, adminKey})` | Create Google Form | **Yes** | templateType | {formId, editUrl, publishedUrl} | Admin.html |
| `api_generateFormShortlink({brandId, formUrl, formType, eventId, adminKey})` | Shortlink for form | **Yes** | formUrl | {token, shortlink} | Admin.html |
| `api_runDiagnostics()` | Self-test | **Yes** | - | {steps[], ok} | Diagnostics.html |

### 4.2 HTTP Entry Points (doGet / doPost)

**doGet(e) Routes:**
```
GET ?page=ADMIN    → Admin.html (requires auth UI)
GET ?page=PUBLIC   → Public.html (default)
GET ?page=DISPLAY  → Display.html (TV mode)
GET ?page=POSTER   → Poster.html (Print)
GET ?page=TEST     → Test.html (internal)
GET ?page=REPORT   → SharedReport.html (Analytics)
GET ?action=STATUS → JSON status endpoint
GET ?action=CONFIG → JSON config endpoint
GET ?action=LIST   → JSON list API
GET ?action=GET    → JSON item API
GET ?p=r&t=TOKEN   → Redirect shortlink
GET ?p=docs        → ApiDocs.html
GET ?p=status      → Status JSON
```

**doPost(e) Routes:**
```
POST action=create                 → api_create()
POST action=update                 → api_updateEventData()
POST action=logEvents              → api_logEvents()
POST action=getReport              → api_getReport()
POST action=createShortlink        → api_createShortlink()
POST action=listFormTemplates      → api_listFormTemplates()
POST action=createFormFromTemplate → api_createFormFromTemplate()
POST action=generateFormShortlink  → api_generateFormShortlink()
POST action=generateToken          → api_generateToken()
```

### 4.3 File-to-Function Call Dependency Graph

```
┌─ Public.html
│  ├─ onLoad: api_list()
│  ├─ onclick: api_get()
│  └─ analytics: api_logEvents()
│
├─ Admin.html
│  ├─ onSubmit: api_create()
│  ├─ buttons:
│  │  ├─ configureDisplay() → api_get() → api_updateEventData()
│  │  ├─ configureSignup() → api_get() → api_updateEventData()
│  │  └─ createFormTemplate() → api_createFormFromTemplate()
│  │                         → api_generateFormShortlink()
│  └─ analytics: api_logEvents()
│
├─ Display.html (TV)
│  ├─ onLoad: api_get()
│  ├─ carousel: startDynamicMode()
│  └─ analytics: api_logEvents()
│
├─ Poster.html
│  ├─ onLoad: api_get() [for QR code generation]
│  └─ no analytics
│
├─ SharedReport.html
│  ├─ onLoad: api_getSharedAnalytics() [in SharedReporting.gs]
│  └─ export: api_exportSharedReport() [in SharedReporting.gs]
│
├─ Diagnostics.html
│  ├─ runDiagnostics() → api_runDiagnostics()
│  └─ various tests → api_*()
│
└─ DiagnosticsDashboard.html
   ├─ onLoad: api_status()
   └─ no backend calls
```

### 4.4 Orphaned / Unused Functions

**Checking Code.gs for functions not called:**

- `api_healthCheck()` - Defined but never called (low severity - can be used externally)
- `api_exportReport()` - Defined but UI not integrated (medium severity)
- `api_getSharedAnalytics()` - In SharedReporting.gs, may not be wired up

### 4.5 Duplicate Logic

**Duplicate #1: HTML Escaping**
```javascript
// NUSDK.html
NU.esc(s) → String(s).replace(/[&<>"']/g, ...)

// Public.html (duplicated)
esc(s) → String(s).replace(/[&<>"']/g, ...)

// Admin.html (uses NU.esc)
```
**Fix:** Always use NU.esc, remove local version from Public.html

**Duplicate #2: Sponsor Banner Rendering**
```javascript
// Public.html: renderSponsorBanner()
// Display.html: renderSponsorTop() + renderSponsorSide()
// Poster.html: renderSponsorStrip() [if it exists]

// All duplicate filtering logic for placements
```
**Fix:** Extract to shared utility in NU SDK

---

## 5. TRIGGER & LISTENER ANALYSIS

### 5.1 doGet/doPost Triggers

```
REQUEST FLOW:
┌──────────────────────┐
│ User Request (HTTP)  │
└──────────┬───────────┘
           │
           ├─ GET  → doGet(e)
           │
           └─ POST → doPost(e)
                      │
                      ├─ JSON parse body
                      ├─ action routing
                      └─ API handler
```

**doGet Execution Path:**
```javascript
doGet(e) {
  // 1. Extract parameters
  const pageParam = e.parameter.page || 'public'
  const actionParam = e.parameter.action || ''
  const hostHeader = e.headers.host
  const brand = findBrandByHost_(hostHeader) || findBrand_('root')
  
  // 2. Route to REST API if action specified
  if (actionParam) return handleRestApiGet_(e, actionParam, brand)
  
  // 3. Handle special pages (docs, status)
  if (pageParam === 'docs') return ApiDocs.html
  if (pageParam === 'status') return JSON(api_status())
  
  // 4. Render HTML page with template
  const tpl = HtmlService.createTemplateFromFile(pageFile_(pageParam))
  tpl.appTitle = `${brand.name} · ${scope}`
  tpl.brandId = brand.id
  return tpl.evaluate()
}
```

### 5.2 DOM Event Listeners

**Pattern 1: Form Submission**
```javascript
document.getElementById('createForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const data = { name: ..., dateISO: ... }
  const res = await NU.rpc('api_create', {
    brandId: BRAND,
    scope: SCOPE,
    templateId: 'event',
    adminKey: getAdminKey(),
    data
  })
})
```

**Pattern 2: Button Click with Dialog**
```javascript
function configureDisplay() {
  document.getElementById('displayCard').style.display = ''
  loadDisplayConfig()  // Async load
}

async function loadDisplayConfig() {
  const res = await NU.rpc('api_get', {...})
  document.getElementById('displayMode').value = res.value.data.display.mode
}

async function saveDisplayConfig() {
  const data = collectFormData()
  const res = await NU.rpc('api_updateEventData', {..., data})
}
```

**Pattern 3: Direct onclick Handlers**
```html
<button onclick="copy('lnkPublic')">Copy Link</button>
<button onclick="configureDisplay()">Configure</button>
```

### 5.3 Initialization Sequence by Page

**Public.html**
```
1. Window load
2. Parse URL for ID parameter
3. If ID: api_get() → renderDetail() → renderSponsorBanner()
4. Else: api_list() → renderList()
5. Analytics logger starts: setInterval(flush, 5000)
6. beforeunload handler: flush()
```

**Admin.html**
```
1. Window load
2. Include Header, Styles, NUSDK, DesignAdapter
3. Attach form submit listener
4. Admin key prompt on first api_create()
5. Display management UI (hidden until event created)
6. Form template UI (hidden until event created)
```

**Display.html**
```
1. Window load
2. Parse eventId, brandId from URL
3. boot() function:
   a. api_get({eventId})
   b. renderSponsorTop/Side()
   c. Check display.mode
   d. startPublicMode() OR startDynamicMode()
4. If dynamic: carousel loop with timers
5. Analytics logger: setInterval(flush, 6000)
```

### 5.4 Timing Issues & Race Conditions

**Issue #1: Unordered Analytics Flushes**
```javascript
// Public.html
setInterval(flush, 5000)        // Every 5s
if (logBatch.length >= 4) flush() // OR when 4 items

// Potential: 2 concurrent flushes if batch hits 4 at 4999ms
```
**Severity:** Low (logBatch is spliced in flush())
**Fix:** Add lock flag

**Issue #2: Admin Key Prompt Race Condition**
```javascript
function getAdminKey() {
  const k = sessionStorage.getItem('ADMIN_KEY:' + BRAND)
  || prompt('Admin key for ' + BRAND)
  // If user opens multiple tabs, prompts conflict
}
```
**Severity:** Medium (UX issue)
**Fix:** Centralize key in localStorage with encryption hint

**Issue #3: Carousel Timing Variance**
```javascript
// Display.html
loadIframe(url, () => {
  setTimeout(next, 2000)  // Skip after 2s if error
})
// vs
setTimeout(next, sec * 1000)  // Rotate after sec

// If iframe blocks, 2s skip races against sec*1000 timer
```
**Severity:** Medium (could skip multiple items)
**Fix:** Use clearTimeout before scheduling next

---

## 6. CROSS-FILE DEPENDENCY TRACKING

### 6.1 Include/Import Structure

```
NUSDK.html (Shared Utilities)
├─ window.NU.rpc()        → RPC wrapper
├─ window.NU.swr()        → Stale-while-revalidate caching
└─ window.NU.esc()        → HTML escape

Styles.html (Global CSS)
├─ Reset & base styles
├─ Layout components (.container, .card, .form-*)
├─ Responsive breakpoints
└─ Color palette (--blue-600, --slate-*, etc)

DesignAdapter.html
└─ Theme adaptation (stub, 1 line)

Header.html (Template)
├─ Logo from brand config
├─ App title from template
└─ Build info badge

Pages That Include:
├─ Admin.html:          Styles + DesignAdapter + NUSDK + Header
├─ Diagnostics.html:    Styles + DesignAdapter + NUSDK + Header
├─ DiagnosticsDashboard.html: Styles + DesignAdapter + NUSDK + Header
├─ Display.html:        Styles (no Header)
├─ Poster.html:         Styles + DesignAdapter
├─ Public.html:         Styles (no Header)
└─ SharedReport.html:   (Check separately)
```

### 6.2 Dependency Matrix

| File | Depends On | Used By | Type |
|------|-----------|---------|------|
| **Backend** |
| Config.gs | - | Code.gs (all) | Config |
| Code.gs | Config.gs | All HTML | Logic |
| SharedReporting.gs | Code.gs | SharedReport.html | Logic |
| **Frontend** |
| NUSDK.html | Code.gs (RPC) | All admin/report pages | Util |
| Styles.html | - | All pages | Style |
| Header.html | Config.gs (template) | Admin, Diagnostics, etc | Component |
| DesignAdapter.html | - | Most pages | Style |
| Public.html | Styles, Code.gs | User | Page |
| Admin.html | Styles, NUSDK, Header, Code.gs | Manager | Page |
| Display.html | Styles, Code.gs | TV/Kiosk | Page |
| Poster.html | Styles, DesignAdapter, Code.gs | Print | Page |
| SharedReport.html | Styles, NUSDK, SharedReporting.gs | Analyst | Page |
| Diagnostics.html | Styles, NUSDK, Header, Code.gs | DevOps | Page |

### 6.3 Circular Dependencies

**None detected.** Architecture is acyclic:
```
Config.gs → Code.gs → HTML pages
                   ↘ SharedReporting.gs
```

### 6.4 Hidden Dependencies

**Issue: Header.html requires template context**
```html
<!-- Header.html line 4 -->
<img src="<?= findBrand_(brandId)?.logoUrl || ... ?>"

<!-- This requires brandId to be set by parent template -->
```
**Impact:** Header.html cannot be tested in isolation
**Fix:** Document that brandId must be provided by calling template

**Issue: NUSDK.html depends on google.script.run**
```javascript
// NUSDK.html line 4
google.script.run
  .withSuccessHandler(...)
  [method](payload)
```
**Impact:** Won't work in non-Apps-Script environment
**Fix:** Add feature detection or mock

---

## 7. TECHNICAL DEBT & IMPROVEMENTS

### 7.1 Hardcoded Values Requiring Configuration

| Line | Value | Current | Recommendation |
|------|-------|---------|-----------------|
| Config.gs:16-44 | Logo URLs | Fixed paths | Use env var with fallback |
| Config.gs:17,26,35,44 | Admin secrets | Plaintext | Use Google Secret Manager |
| Code.gs:54 | DIAG_MAX = 3000 | Hardcoded | Config + per-brand |
| Code.gs:54 | DIAG_PER_DAY = 800 | Hardcoded | Config + per-brand |
| Code.gs:476 | RATE_MAX_PER_MIN = 20 | Global | Per-brand, per-scope |
| Code.gs:512 | sanitizeInput_ max 1000 | Hardcoded | Config-driven |
| Code.gs:625 | Slug collision counter | Start at 2 | Config-driven starting |
| Public.html:377 | YouTube/Vimeo patterns | Hardcoded | Config-driven embed providers |
| Display.html:226 | Instagram/TikTok block | Hardcoded | Config-driven blocklist |
| Admin.html:822 | Session storage key pattern | Format-dependent | Use constants |

### 7.2 Code Duplication (DRY Violations)

| Pattern | Locations | Lines | Fix |
|---------|-----------|-------|-----|
| HTML escape function | Public.html, NUSDK | 2 | Use NU.esc everywhere |
| Sponsor placement filtering | Public, Display, Poster | 9-12 | Extract to utility |
| Analytics batching logic | Public, Display | 15-20 | Move to NU SDK |
| Admin key prompt | Admin.html only | 1 | OK (local only) |
| Form validation | Admin.html UI | 5+ | Consider zod/joi if grows |
| Error envelope pattern | Code.gs | 5-10 | Already DRY (good) |

### 7.3 Architectural Inconsistencies

**Issue #1: Mixed RPC Patterns**
```javascript
// Pattern A: NU.rpc (Admin, Diagnostics)
const res = await NU.rpc('api_create', {...})

// Pattern B: google.script.run direct (Public, Display)
google.script.run.withFailureHandler(...).api_logEvents(...)

// Pattern C: Promise wrapper (Public)
const promise = new Promise((resolve) => {
  google.script.run
    .withSuccessHandler(res => resolve(res))
    [method](payload)
})
```
**Fix:** Standardize on NU.rpc everywhere

**Issue #2: Two Analytics Systems**
```
Code.gs:
- api_logEvents() → ANALYTICS sheet
- api_getReport() → aggregate by surface/sponsor/token

SharedReporting.gs:
- api_getSharedAnalytics() → higher-level aggregation
- Missing integration in UI
```
**Fix:** Consolidate or clearly separate concerns

**Issue #3: No Service Layer**
```
Currently:
Code.gs (1000+ lines)
├─ Config loading
├─ Routing
├─ Validation
├─ Business logic
├─ Analytics
└─ Google Services calls (Forms, Sheets, Cache)

Better:
Code.gs (routing)
├─ EventService
├─ SponsorService
├─ AnalyticsService
└─ FormService
```

### 7.4 Security Vulnerabilities

| Issue | Severity | Location | Fix |
|-------|----------|----------|-----|
| **Plaintext admin secrets in Config** | Critical | Config.gs:17 | Use Google Secrets API |
| **Session storage for admin key** | High | Admin.html:822 | Encrypt or use time-limited token |
| **No CSRF protection** | Medium | Code.gs:150 | Add token validation |
| **Insufficient XSS validation** | Medium | Admin.html | Use DOMPurify or sanitize-html |
| **No rate limiting per user** | Medium | Code.gs:486 | Implement user-based limits |
| **Shortlink token prediction** | Low | Code.gs:851 | Token is UUID prefix (8 chars) - acceptable |
| **No audit logging** | Medium | Code.gs | Log admin actions to AUDIT sheet |
| **API key in Bearer token** | Low | Code.gs:379 | JWT payload doesn't expose secret (good) |
| **File inclusion in templates** | Low | Code.gs:308 | Currently safe (no user input) |

**Recommended Quick Wins:**
1. Move admin secrets to Google Secrets API
2. Add nonce-based CSRF tokens to forms
3. Implement User-ID-based rate limiting
4. Add audit logging for data mutations
5. Sanitize all user input (already done for URLs, but expand)

### 7.5 Performance Bottlenecks

| Issue | Severity | Impact | Fix |
|-------|----------|--------|-----|
| **Full sheet scan on every query** | Medium | api_get/list | Add index by ID |
| **No pagination in api_list** | Medium | Slow with 1000+ events | Implement cursor-based pagination |
| **All analytics in memory** | High | OutOfMemory risk with big events | Implement chunked processing |
| **Synchronous Sheets operations** | Low | Blocks execution | Already async via RPC |
| **No caching in backend** | Medium | Repeated template.evaluate() | Cache templates for 1m |
| **Analytics flush every 5s** | Low | Overhead for high traffic | Batch more aggressively |
| **Shortlink token not indexed** | Medium | Slow redirects | Add index on SHORTLINKS sheet |

### 7.6 Testing Gaps

| Component | Coverage | Recommendation |
|-----------|----------|-----------------|
| Code.gs (17 api_* functions) | Unit: None, E2E: Basic | Add Jest tests, E2E in Playwright |
| Public.html | Smoke: Yes, E2E: Yes | Add form testing, input validation |
| Admin.html | Smoke: Yes, E2E: Yes | Add concurrent edit scenarios |
| Display.html | Smoke: Yes, E2E: Partial | Add carousel timing tests |
| Config.gs | None | Add validation tests |
| NUSDK.html | None | Add RPC mock tests |
| Sponsor integration | Smoke only | Add e2e for all placements |
| Analytics aggregation | None | Add unit tests for groupBy* functions |

---

## 8. ARCHITECTURE DIAGRAMS

### 8.1 High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       USER BROWSERS                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  Public  │  │  Admin   │  │ Display  │  │  Poster  │        │
│  │ (Events) │  │(Manager) │  │   (TV)   │  │ (Print)  │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │             │             │             │               │
│       └─────────────┴─────────────┴─────────────┘               │
│                     │                                            │
│              NU.rpc() / google.script.run                        │
│                     │                                            │
└─────────────────────┼──────────────────────────────────────────┘
                      │
        ┌─────────────▼──────────────┐
        │  Google Apps Script        │
        │  (Backend Service)         │
        │                            │
        │  ┌──────────────────────┐  │
        │  │ Code.gs (36KB)       │  │
        │  │ - Router (doGet)     │  │
        │  │ - API handlers       │  │
        │  │ - Validation         │  │
        │  └──────────────────────┘  │
        │                            │
        │  ┌──────────────────────┐  │
        │  │ Config.gs (7KB)      │  │
        │  │ - BRANDS[]          │  │
        │  │ - TEMPLATES[]        │  │
        │  │ - FORM_TEMPLATES[]   │  │
        │  └──────────────────────┘  │
        │                            │
        │  ┌──────────────────────┐  │
        │  │ SharedReporting.gs   │  │
        │  │ - Analytics agg      │  │
        │  └──────────────────────┘  │
        │                            │
        └────────────┬───────────────┘
                     │
        ┌────────────▼──────────────┐
        │  Google Sheets            │
        │  (Data Store)             │
        │                           │
        │  Sheets:                  │
        │  - EVENTS (rows)          │
        │  - SPONSORS (nested)      │
        │  - ANALYTICS (events)     │
        │  - SHORTLINKS (tokens)    │
        │  - DIAG (logs)            │
        │                           │
        └──────────────────────────┘
```

### 8.2 Data Flow: Event Creation

```
USER (Admin)
    │
    ├─ Visits Admin.html?page=admin&brand=root
    │
    ├─ Fills form: name, dateISO, etc
    │
    └─ Clicks "Create Event"
            │
            ▼
    ┌────────────────────────┐
    │ DOM Event: submit      │
    │ Admin.html:330         │
    └────────────┬───────────┘
                 │
                 ▼
    ┌────────────────────────────────────────┐
    │ Collect form data into data{}          │
    │ - name, dateISO, timeISO, location, .. │
    │ Admin.html:334-347                     │
    └────────────┬───────────────────────────┘
                 │
                 ▼
    ┌────────────────────────────────────────┐
    │ Prompt for adminKey (first time)       │
    │ Admin.html:821-824                     │
    └────────────┬───────────────────────────┘
                 │
                 ▼
    ┌────────────────────────────────────────┐
    │ NU.rpc('api_create', {                 │
    │   brandId: 'root',                    │
    │   scope: 'events',                     │
    │   templateId: 'event',                 │
    │   adminKey: 'HASH',                    │
    │   idemKey: crypto.randomUUID(),        │
    │   data: {...}                          │
    │ })                                     │
    │ Admin.html:349-356                     │
    └────────────┬───────────────────────────┘
                 │
                 ▼ (RPC -> Server)
    ┌────────────────────────────────────────┐
    │ doPost(e) in Code.gs:150               │
    │ - Parse JSON body                      │
    │ - Extract: action='create'             │
    │ - Authenticate: gate_(brandId, key)   │
    └────────────┬───────────────────────────┘
                 │
                 ▼
    ┌────────────────────────────────────────┐
    │ handleRestApiPost_(...) -> api_create()│
    │ Code.gs:635                            │
    │ 1. Validate required fields            │
    │ 2. Check idempotency cache             │
    │ 3. Sanitize inputs                     │
    │ 4. Generate UUID & slug                │
    │ 5. Get EVENTS sheet from brand store  │
    │ 6. appendRow([id, brandId, ...])      │
    │ 7. Generate links (public/poster/etc)  │
    │ 8. diag_('info', ...)                  │
    │ 9. Return Ok({id, links})              │
    └────────────┬───────────────────────────┘
                 │
                 ▼ (Response -> Client)
    ┌────────────────────────────────────────┐
    │ Promise resolves with {ok, value}      │
    │ Admin.html:360-366                     │
    │ - currentEventId = res.value.id        │
    │ - showEventCard(res.value)             │
    │ - Display links for sharing            │
    └────────────────────────────────────────┘
```

### 8.3 Data Flow: Sponsor Tracking

```
┌─────────────────────────────────────────────────────────────┐
│ ADMIN: Configure Event Display & Sponsors (Admin.html)      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ configureDisplay()                                          │
│  ├─ loadDisplayConfig() → api_get(eventId)                 │
│  ├─ renderSponsors(data.sponsors)                          │
│  │  └─ For each sponsor: show input fields + checkboxes    │
│  │                       (tvTop, tvSide, posterTop, mobile) │
│  └─ saveDisplayConfig()                                     │
│     ├─ Collect sponsor data from form                      │
│     └─ NU.rpc('api_updateEventData', {sponsors: [...]})    │
│        └─ Spreadsheet updated: data.sponsors = new array   │
│                                                              │
└──────────────┬──────────────────────────────────────────────┘
               │
    ┌──────────┴──────────┬──────────────┐
    │                     │              │
    ▼                     ▼              ▼
 PUBLIC               DISPLAY           POSTER
 (Mobile)             (TV)              (Print)
    │                  │                │
    ├─ User visits     ├─ TV display    ├─ Poster view
    │  event page      │  page boot     │
    │                  │                │
    ├─ api_get()       ├─ api_get()     ├─ api_get()
    │                  │                │
    ├─ renderDetail()  ├─ renderTop()   ├─ renderStrip()
    │  └─ call         │  └─ filter     │  └─ filter
    │  renderSponsor   │  sponsors[]    │  sponsors[]
    │  Banner()        │  .tvTop        │  .posterTop
    │                  │                │
    ├─ Filter:         ├─ renderSide()  ├─ Display
    │  sponsors        │  └─ filter     │  sponsor
    │  .mobileBanner   │  sponsors[]    │  logos +
    │                  │  .tvSide       │  links
    ├─ Show banner     │                │
    │  with logo       ├─ Log events:   │
    │  & link          │  impression    │
    │                  │  dwellSec      │
    ├─ Log:            │                │
    │  impression      └─ Rotate        │
    │  click (if link)    carousel      │
    │                                    │
    └────────────┬───────────────────────┘
                 │
        ┌────────▼────────┐
        │ Analytics Sheet │
        │ (ANALYTICS)     │
        │                 │
        │ Rows:           │
        │ timestamp       │
        │ eventId         │
        │ surface (public │
        │   |display|     │
        │   poster)       │
        │ metric          │
        │   (impression   │
        │   |click|dwell) │
        │ sponsorId       │
        │ value           │
        │                 │
        └─────────────────┘
```

### 8.4 Configuration & Template Flow

```
┌──────────────────────────────────────────────────────────┐
│ Config.gs (Compile Time)                                 │
│ ┌───────────────────────────────────────────────────────┤
│ │ const BRANDS = [                                      │
│ │   { id: 'root', name: 'Zeventbook',                   │
│ │     adminSecret, store.spreadsheetId,                │
│ │     scopesAllowed: ['events', 'sponsors'] }           │
│ │ ]                                                       │
│ │                                                        │
│ │ const TEMPLATES = [                                   │
│ │   { id: 'event', fields: [{id, type, required}] }   │
│ │   { id: 'sponsor', fields: [...] }                   │
│ │ ]                                                      │
│ │                                                        │
│ │ const FORM_TEMPLATES = [...]                          │
│ └────────────────┬────────────────────────────────────┘
│                  │
└──────────────────┼──────────────────────────────────────┘
                   │
        ┌──────────▼──────────────┐
        │ User Request            │
        │ GET /?page=admin&       │
        │     brand=root&        │
        │     scope=events        │
        └──────────────┬──────────┘
                       │
        ┌──────────────▼──────────────┐
        │ doGet(e) in Code.gs         │
        │ 1. Find brand by hostname  │
        │ 2. Validate scope allowed   │
        │ 3. Select page file:        │
        │    pageFile_('admin')       │
        │    → 'Admin'                │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────────┐
        │ HtmlService.createTemplateFrom  │
        │ File('Admin')                   │
        │                                 │
        │ Inject variables:               │
        │ tpl.appTitle =                  │
        │   "Zeventbook · events"         │
        │ tpl.brandId = 'root'           │
        │ tpl.scope = 'events'            │
        │ tpl.execUrl = script URL        │
        │ tpl.ZEB = ZEB object            │
        │                                 │
        │ Evaluate template:              │
        │ return tpl.evaluate()           │
        └──────────────┬──────────────────┘
                       │
        ┌──────────────▼──────────────────┐
        │ Admin.html receives:            │
        │ const BRAND = 'root'           │
        │ const SCOPE = 'events'          │
        │ const EXEC_URL = 'https://...'  │
        │                                 │
        │ Scripts inside <script>:        │
        │ <?!= include('NUSDK'); ?>       │
        │ → Injects NU RPC client         │
        │                                 │
        │ NU.rpc('api_create', {          │
        │   brandId: BRAND,             │
        │   scope: SCOPE,                 │
        │   ...                           │
        │ })                              │
        └─────────────────────────────────┘
```

---

## 9. CRITICAL PATHS & DEPENDENCIES

### 9.1 Critical User Journeys

**Path 1: Event Manager Creates Event & Adds Sponsors**
```
Prerequisites:
- Admin page accessible (/Admin.html)
- ADMIN_KEY available

Steps:
1. Load Admin.html
2. Submit create form (api_create)
3. Click "Configure Display & Sponsors"
4. Add sponsor entries
5. Click "Save Configuration"
6. Share links (copy buttons)

Critical Functions:
- api_create() → must be secure (auth check)
- api_updateEventData() → must validate sponsor data
- Page state management (currentEventId)

Failure Points:
- Admin key expired/lost → can't save
- Spreadsheet quota exceeded → append fails
- Network timeout → loses unsaved data (no auto-save)
```

**Path 2: Event Attendee Registers (Public Page)**
```
Prerequisites:
- Event exists in spreadsheet
- registerUrl configured

Steps:
1. Load Public.html
2. Page loads: api_list() → api_get(id)
3. Render event detail
4. Click "Register" button
5. Opens registerUrl in new tab
6. User submits Google Form
7. Return to event page

Analytics:
- impression logged on pageload
- click logged when button clicked
- Form responses go to separate spreadsheet

Failure Points:
- Event not found (404)
- registerUrl broken (user sees 404)
- No error handling for missing event
```

**Path 3: TV Display Carousel**
```
Prerequisites:
- Display.html accessed with event ID
- display.mode = 'dynamic'
- display.urls configured

Steps:
1. Load Display.html
2. api_get() fetches event config
3. startDynamicMode(urls)
4. Loop through URLs:
   - Load iframe
   - Log impression
   - Wait sec seconds
   - Rotate to next

Failure Points:
- Blocked embeds (Instagram/TikTok silently skip)
- Iframe load timeout (4s) → fallback
- Missing URLs → falls back to public mode
- Memory leak if carousel runs 24/7
```

### 9.2 Data Consistency Requirements

| Requirement | Current | Issue |
|-------------|---------|-------|
| Event ID uniqueness | UUID in append | OK (collision impossible) |
| Brand isolation | brandId filter in all queries | OK |
| Sponsor placements | Stored in event.data | OK |
| Analytics integrity | Append-only ANALYTICS sheet | OK |
| Shortlink redirection | SHORTLINKS sheet lookup | OK |
| Admin auth | adminSecret comparison | Weak (plaintext) |

### 9.3 Dependency Resolution on Failures

| Failure | Current Behavior | Recommended |
|---------|------------------|------------|
| No admin key provided | Empty string → auth fails | Prompt again with better UX |
| Spreadsheet quota exceeded | appendRow() throws → caught by runSafe() | Graceful error, suggest pagination |
| Brand not found | Returns null → use 'root' | Explicit error to user |
| Event not in list | Returns null → shows "Not found" | 404 page |
| Invalid URL in carousel | Iframe error → skip silently | Log to DIAG, inform user |
| Network timeout | Promise never resolves → UI hangs | Add timeout wrapper to NU.rpc() |

---

## 10. RECOMMENDATIONS FOR NEXT PHASES

### Phase 1: Stabilization (Urgent)
- [ ] Add error boundaries to all RPC calls
- [ ] Implement timeout wrapper for NU.rpc()
- [ ] Move admin secrets to Google Secrets API
- [ ] Add CSRF token validation
- [ ] Implement user-based rate limiting

### Phase 2: Scalability (Important)
- [ ] Implement pagination in api_list()
- [ ] Add database indexing (by ID, brand)
- [ ] Split Code.gs into service modules
- [ ] Add caching layer for templates
- [ ] Implement chunked analytics processing

### Phase 3: Features (Nice-to-Have)
- [ ] Sponsor management dashboard (separate SPONSOR sheet)
- [ ] Event templates/cloning
- [ ] Bulk import from CSV
- [ ] Advanced analytics (daily trends, cohort analysis)
- [ ] Email notifications for attendees

### Phase 4: DevOps
- [ ] Automated backup of analytics data
- [ ] Monitoring & alerting dashboard
- [ ] Load testing framework
- [ ] A/B testing infrastructure
- [ ] Multi-region deployment capability

---

## 11. APPENDICES

### A. Function Call Count by Type

**Google Services Called:**
- SpreadsheetApp: 45+ calls
- FormApp: 8 calls (in api_createFormFromTemplate)
- HtmlService: 10 calls
- Utilities: 12 calls (UUID, base64, etc)
- CacheService: 4 calls
- ScriptApp: 3 calls

**HTTP Entry Points:**
- doGet: 1
- doPost: 1

**Frontend API Calls:**
```
Public.html:
- api_list() or api_get() once on load
- api_logEvents() every 5 seconds

Admin.html:
- api_create() on form submit
- api_get() when loading forms/display
- api_updateEventData() on save
- api_createFormFromTemplate() on form creation
- api_generateFormShortlink() on form creation

Display.html:
- api_get() once on load
- api_logEvents() every 6 seconds

Others:
- api_status() in Diagnostics
- api_getSharedAnalytics() in SharedReport
```

### B. Sheets Used

| Sheet | Purpose | Rows | Auto-created | Index |
|-------|---------|------|--------------|-------|
| EVENTS | Event storage | ~1000 | No | ID col |
| SPONSORS | (nested in EVENTS) | N/A | N/A | N/A |
| ANALYTICS | Event impressions/clicks | ~100k/month | Yes (diag_) | None |
| SHORTLINKS | Redirect tokens | ~1000 | Yes (api_) | None |
| DIAG | Debug logs | ~3000 | Yes (diag_) | None |

### C. Security Checklist

```javascript
[ ] Admin secrets in Google Secrets API
[ ] CSRF tokens on all forms
[ ] User-based rate limiting (not just IP)
[ ] Content Security Policy headers
[ ] Input validation on all fields
[ ] Output escaping in all templates
[ ] No eval() or dynamic code execution
[ ] SQL injection N/A (spreadsheet not DB)
[ ] SSRF checks on form URLs
[ ] Audit logging for data mutations
[ ] Encryption for PII (if any)
[ ] Session expiration (current: sessionStorage never expires)
```

---

**End of Analysis Document**
