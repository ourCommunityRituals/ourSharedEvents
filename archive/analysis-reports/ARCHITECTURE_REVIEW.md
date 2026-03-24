# Comprehensive Architecture Review - MVP Event Toolkit

**Date:** 2025-11-10
**Build:** triangle-extended-v1.3
**Contract:** 1.0.3
**Reviewers:** Software Architect, Frontend Integration Engineer, Frontend Designer, SDET, Software Tester, DevOps Engineer

---

## Executive Summary

The MVP Event Toolkit is a **production-grade Google Apps Script web application** for multi-brand event management with sponsor tracking and analytics. The codebase demonstrates sophisticated patterns but requires infrastructure hardening for production deployment.

**Overall Grade: B-** (Code: C+, Architecture: B+, Need: Testing & DevOps Infrastructure)

### Critical Findings
- ✅ **Strong:** Multi-brand architecture, analytics tracking, API design
- ⚠️ **Security:** Hardcoded admin secrets (CHANGE_ME_*) in Config.gs
- ❌ **Missing:** Automated tests, CI/CD pipeline, deployment automation
- ❌ **Missing:** .clasp.json for CLI deployment
- ⚠️ **Frontend:** localStorage credential storage without encryption

---

## 1. Software Architect Review

### 1.1 Configuration Architecture

**Files:**
- `appsscript.json` - Google Apps Script manifest
- `Config.gs` - Multi-brand configuration with templates

**Configuration Flow:**
```
appsscript.json (OAuth scopes, runtime, web app settings)
    ↓
Config.gs (BRANDS array, TEMPLATES array)
    ↓
Code.gs doGet() → findBrandByHost_(hostHeader)
    ↓
Route to appropriate page with brand context
```

**Brand Resolution:**
1. Extract `host` header from request
2. Match against `BRANDS[].hostnames[]`
3. Fallback to 'root' brand if no match
4. Load brand-specific configuration (admin secret, allowed scopes)

**Security Issue:** Admin secrets hardcoded in source code (Lines 17, 26, 35, 44 in Config.gs)

### 1.2 Functions, Events, Triggers, and Event Listeners

**Backend API Functions (Code.gs):**

| Function | Lines | Trigger | Purpose | Events Logged |
|----------|-------|---------|---------|---------------|
| `doGet(e)` | 97-134 | HTTP GET | Router for all requests | None |
| `handleRedirect_(token)` | 149-191 | HTTP GET ?p=r | Shortlink redirect + analytics | Click event |
| `api_status()` | 271-288 | RPC call | Health check | None |
| `api_healthCheck()` | 290-295 | RPC call | Ping test | DIAG log |
| `api_list(payload)` | 309-324 | RPC call | List events with SWR | None |
| `api_get(payload)` | 326-349 | RPC call | Get single event | None |
| `api_create(payload)` | 352-410 | RPC call | Create event (admin) | DIAG log |
| `api_updateEventData(req)` | 412-436 | RPC call | Update event config | DIAG log |
| `api_logEvents(req)` | 438-460 | RPC call | Batch analytics | None |
| `api_getReport(req)` | 462-508 | RPC call | Generate report | None |
| `api_exportReport(req)` | 510-552 | RPC call | Export to Sheets | DIAG log |
| `api_createShortlink(req)` | 554-581 | RPC call | Create shortlink | DIAG log |
| `api_runDiagnostics()` | 583-658 | RPC call | E2E self-test | DIAG log |

**Frontend Event Listeners:**

**Admin.html:**
- Line 205: `createForm.addEventListener('submit')` → Create event
- Line 272: `copy()` → Copy link to clipboard
- Line 288: `configureSignup()` → Show signup form config
- Line 308: `saveAllSignupForms()` → Save signup URLs via api_updateEventData
- Line 341: `configureDisplay()` → Show display config
- Line 436: `saveDisplayConfig()` → Save display/sponsor config via api_updateEventData

**Public.html:**
- Line 166: `setInterval(flush, 5000)` → Analytics batch flush
- Line 167: `window.addEventListener('beforeunload', flush)` → Flush on page exit
- Line 206: `sponsorLink.addEventListener('click')` → Log sponsor click
- Inline event handlers for event list/detail rendering

**Display.html:**
- Line 104: `setInterval(flush, 6000)` → Analytics batch flush
- Line 105: `window.addEventListener('beforeunload', flush)` → Flush on page exit
- Line 156: `stage.onload` → Detect iframe load success
- Line 157: `stage.onerror` → Detect iframe load failure
- Line 208: `startDynamicMode._t = setTimeout(next, sec * 1000)` → Carousel rotation

### 1.3 Complete Application Flow Trace

**Pre-Event Flow (Admin):**
```
User → Admin.html (?page=admin)
    ↓
doGet(e) [Code.gs:97]
    ↓ pageParam === 'admin'
    ↓ findBrandByHost_(hostHeader) [Config.gs:106]
    ↓ pageFile_('admin') → 'Admin' [Code.gs:137]
    ↓ include('Styles', 'DesignAdapter', 'NUSDK', 'Header') [Code.gs:144]
    ↓
Admin.html renders with brand context
    ↓
User fills form → submit event [Admin.html:205]
    ↓
NU.rpc('api_create', {...}) [NUSDK.html:3, Admin.html:223]
    ↓ google.script.run.api_create(payload)
    ↓
api_create(payload) [Code.gs:352]
    ↓ gate_(brandId, adminKey) [Code.gs:357] → Rate limiting + auth
    ↓ assertScopeAllowed_() [Code.gs:358]
    ↓ findTemplate_('event') [Config.gs:110]
    ↓ Validate required fields [Code.gs:362-366]
    ↓ Idempotency check (CacheService) [Code.gs:369-373]
    ↓ sanitizeInput_() [Code.gs:376-382]
    ↓ getStoreSheet_() [Code.gs:235] → Ensure EVENTS sheet exists
    ↓ appendRow([id, brandId, templateId, dataJSON, createdAt, slug]) [Code.gs:399]
    ↓ diag_('info', 'api_create', ...) [Code.gs:407]
    ↓
Return Ok({ id, links: { publicUrl, posterUrl, displayUrl } })
    ↓
showEventCard(res.value) [Admin.html:240]
    ↓ Render links for Public, Display, Poster
```

**During Event Flow (Display):**
```
User opens Display URL (?page=display&id=EVENT_ID)
    ↓
doGet(e) [Code.gs:97]
    ↓ pageParam === 'display'
    ↓ pageFile_('display') → 'Display' [Code.gs:140]
    ↓
Display.html renders
    ↓
boot() [Display.html:213]
    ↓ google.script.run.api_get({ brandId, scope: 'events', id: eventId })
    ↓
api_get(payload) [Code.gs:326]
    ↓ assertScopeAllowed_() [Code.gs:330]
    ↓ getStoreSheet_() → Read EVENTS sheet [Code.gs:331]
    ↓ Find row by id + brandId [Code.gs:332]
    ↓ Parse dataJSON [Code.gs:338]
    ↓ Build links object [Code.gs:340-344]
    ↓ Return Ok({ id, data, links })
    ↓
renderSponsorTop(ev) [Display.html:107]
    ↓ Filter sponsors with tvTop placement [Display.html:108]
    ↓ Render sponsor banner [Display.html:110-114]
    ↓ logEvent({ metric: 'impression', sponsorId }) [Display.html:115]
    ↓
renderSponsorSide(ev) [Display.html:118]
    ↓ Filter sponsors with tvSide placement [Display.html:119]
    ↓ Render side panel [Display.html:121-126]
    ↓ logEvent({ metric: 'impression', sponsorId }) [Display.html:129]
    ↓
Check display.mode [Display.html:225]
    ↓ IF 'dynamic' → startDynamicMode(d.urls) [Display.html:178]
        ↓ Load each URL in iframe carousel [Display.html:198]
        ↓ logEvent({ metric: 'impression' }) [Display.html:199]
        ↓ logEvent({ metric: 'dwellSec', value: sec }) [Display.html:200]
        ↓ Detect blocked embeds [Display.html:144-168]
        ↓ Skip to next URL [Display.html:208]
    ↓ ELSE → startPublicMode() [Display.html:132]
        ↓ Load ?p=public&id=EVENT_ID in iframe [Display.html:134]
    ↓
Every 6s → flush() [Display.html:97]
    ↓ google.script.run.api_logEvents({ items: logBatch }) [Display.html:101]
    ↓
api_logEvents(req) [Code.gs:438]
    ↓ _ensureAnalyticsSheet_() [Code.gs:443]
    ↓ Map items to rows [Code.gs:445-454]
    ↓ Batch insert to ANALYTICS sheet [Code.gs:455]
    ↓ Return Ok({ count })
```

**Post-Event Flow (Reports):**
```
Admin → Diagnostics panel in Admin.html (future implementation)
    OR
Admin → Apps Script → Run api_getReport({ id: EVENT_ID })
    ↓
api_getReport(req) [Code.gs:462]
    ↓ _ensureAnalyticsSheet_() [Code.gs:467]
    ↓ Filter rows by eventId [Code.gs:468-469]
    ↓ Aggregate by totals, surface, sponsor, token [Code.gs:471-504]
    ↓ Calculate CTR [Code.gs:497-504]
    ↓ Return Ok(agg)
    ↓
api_exportReport(req) [Code.gs:510]
    ↓ Call api_getReport() [Code.gs:515]
    ↓ Create/replace sheet [Code.gs:519-522]
    ↓ Write totals [Code.gs:525-530]
    ↓ Write bySurface [Code.gs:533-535]
    ↓ Write bySponsor [Code.gs:538-540]
    ↓ Write byToken [Code.gs:543-545]
    ↓ Return Ok({ sheetUrl })
```

**Shortlink Flow:**
```
User clicks shortlink (?p=r&t=TOKEN)
    ↓
doGet(e) [Code.gs:97]
    ↓ pageParam === 'r' || 'redirect' [Code.gs:103]
    ↓
handleRedirect_(token) [Code.gs:149]
    ↓ Open SHORTLINKS sheet [Code.gs:155]
    ↓ Find row by token [Code.gs:160-161]
    ↓ Extract targetUrl, eventId, sponsorId, surface [Code.gs:168]
    ↓ api_logEvents({ metric: 'click', token, sponsorId }) [Code.gs:172-180]
    ↓ Return HTML redirect [Code.gs:187-190]
```

### 1.4 Data Storage Schema

**Sheets:**
- `EVENTS`: [id, brandId, templateId, dataJSON, createdAt, slug]
- `SPONSORS`: Same schema (not actively used in MVP)
- `ANALYTICS`: [timestamp, eventId, surface, metric, sponsorId, value, token, userAgent]
- `SHORTLINKS`: [token, targetUrl, eventId, sponsorId, surface, createdAt]
- `DIAG`: [ts, level, where, msg, meta] - Auto-rotated logs

### 1.5 Architecture Strengths

✅ **Multi-tenancy:** Clean separation via brand config
✅ **API Envelopes:** Uniform Ok/Err pattern
✅ **Contract Validation:** Runtime schema checks
✅ **Rate Limiting:** 20 req/min per brand
✅ **Idempotency:** 10-min cache for create operations
✅ **SWR Caching:** ETag-based cache with stale-while-revalidate
✅ **Analytics:** Comprehensive tracking across surfaces
✅ **Diagnostics:** Self-test suite + auto-rotating logs

### 1.6 Architecture Weaknesses

❌ **Security:** Hardcoded admin secrets in source
❌ **Scalability:** Google Sheets not optimized for high read/write
❌ **No Auth:** Admin key via prompt/sessionStorage (not OAuth)
❌ **No Versioning:** No API version strategy
❌ **No Rollback:** No ability to rollback deployments

---

## 2. Frontend Integration Engineer Review

### 2.1 Frontend-Backend Integration Patterns

**Communication Layer:**
```javascript
// NUSDK.html provides:
NU.rpc(method, payload) → google.script.run[method](payload) → Promise<Response>
NU.swr(method, payload, { staleMs, onUpdate }) → SWR pattern with localStorage
NU.esc(s) → HTML escaping for XSS prevention
```

**Admin.html Integration:**
```javascript
createForm.submit → NU.rpc('api_create', { brandId, scope, templateId, adminKey, data })
    → showEventCard({ id, links })
        → Display Public/Display/Poster URLs

configureDisplay() → NU.rpc('api_get', { id }) → loadDisplayConfig()
    → User edits sponsors + display mode
    → saveDisplayConfig() → NU.rpc('api_updateEventData', { id, adminKey, data: { display, sponsors } })
```

**Public.html Integration:**
```javascript
// List view
NU.rpc('api_list', { brandId, scope }) → renderList(items)

// Detail view
NU.rpc('api_get', { brandId, scope, id }) → renderDetail(evt)
    → renderSponsorBanner(evt) → Log impression
    → Render event details, gallery, video
```

**Display.html Integration:**
```javascript
boot() → google.script.run.api_get({ id })
    → renderSponsorTop(ev) → Log impressions
    → renderSponsorSide(ev) → Log impressions
    → startDynamicMode(urls) OR startPublicMode()
        → loadIframe(url)
        → Detect blocked embeds
        → Log dwell time
```

### 2.2 Data Flow Tracing

**Create Event Flow:**
```
Admin UI Form Data
    ↓ JavaScript (Admin.html:209-221)
    ↓ NU.rpc('api_create', payload)
    ↓ Google Apps Script RPC (NUSDK.html:3-9)
    ↓ Code.gs api_create(payload)
    ↓ Validation + Sanitization (Code.gs:362-382)
    ↓ Google Sheets EVENTS.appendRow()
    ↓ Return { id, links }
    ↓ Admin.html showEventCard()
    ↓ Render links for end-user access
```

**Display Config Flow:**
```
Admin UI (sponsors + display.mode + urls)
    ↓ JavaScript (Admin.html:436-483)
    ↓ Collect form data
    ↓ NU.rpc('api_updateEventData', { data: { display, sponsors } })
    ↓ Code.gs api_updateEventData()
    ↓ Merge with existing dataJSON
    ↓ Google Sheets update cell
    ↓ Return updated event
    ↓ Alert success
    ↓
Display.html boot()
    ↓ api_get() reads updated dataJSON
    ↓ Renders sponsors in tvTop + tvSide
    ↓ Loads carousel or public mode
```

**Analytics Flow:**
```
User interaction (sponsor click, page view)
    ↓ logEvent({ eventId, surface, metric, sponsorId })
    ↓ Push to logBatch[]
    ↓ Every 5-6s OR beforeunload → flush()
    ↓ google.script.run.api_logEvents({ items })
    ↓ Code.gs api_logEvents()
    ↓ Batch insert to ANALYTICS sheet
    ↓
Admin requests report
    ↓ api_getReport({ id })
    ↓ Aggregate from ANALYTICS sheet
    ↓ Return { totals, bySurface, bySponsor, byToken }
    ↓ api_exportReport() writes to new sheet
```

### 2.3 Integration Strengths

✅ **Uniform RPC:** Single NU.rpc() interface
✅ **Error Handling:** Graceful fallback on RPC failure
✅ **Batch Analytics:** Reduces API calls
✅ **SWR Caching:** Reduces load times
✅ **XSS Prevention:** NU.esc() used consistently

### 2.4 Integration Weaknesses

⚠️ **No Request Retries:** Network failures not retried
⚠️ **localStorage Security:** Admin keys stored in plaintext
⚠️ **No Loading States:** Minimal user feedback during RPC
⚠️ **No Offline Support:** Requires internet connection

---

## 3. Frontend Designer Review (TV + Mobile)

### 3.1 Mobile Display (Public.html)

**Viewport Configuration:** Line 7
```html
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
```

**Responsive Grid:** Lines 11-13
```css
.events-grid {
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}
@media (max-width: 640px) {
  .events-grid { grid-template-columns: 1fr; }
}
```

**Sponsor Banner (Mobile-Optimized):** Lines 18-25
- Flexbox with wrap for responsive layout
- Max-height: 56px for logos (48px on mobile)
- Centered alignment
- Line 124: Mobile adjustments

**Typography:** Lines 38-50
- h1: 2.2rem (1.6rem mobile)
- Body: 1rem (0.9rem mobile)
- Line-height: 1.7 for readability

**Gallery Grid:** Lines 99-114
- Desktop: minmax(200px, 1fr)
- Mobile: minmax(150px, 1fr)
- Lazy loading: `<img loading="lazy">`

**User Flow (Mobile):**
1. Land on event list → Grid of event cards
2. Tap event → Detail view with full event info
3. See sponsor banner at top (if configured)
4. Access Register/Check-In buttons (prominent)
5. View media (image, video, gallery)
6. Read bio and summary
7. Back to list

### 3.2 TV Display (Display.html)

**TV-Optimized Typography:** Lines 9-13
```css
body[data-tv="1"] {
  font-size: clamp(20px, 2.8vw, 32px); /* Legible at 10-12ft */
  line-height: 1.5;
}
```

**Layout (Grid):** Lines 16-21
```css
main#tv {
  display: grid;
  grid-template-columns: 1fr; /* Single column by default */
  grid-template-rows: auto 1fr; /* Top banner + content */
  height: 100vh;
}
main#tv.has-side {
  grid-template-columns: 1fr var(--side-w); /* Add side panel */
}
```

**Sponsor Placements:**
- `sponsor-top` (Lines 22-26): Full-width banner at top, 64px logos
- `sponsorSide` (Lines 39-43): Side panel (320px) with sponsor cards

**Iframe Stage:** Lines 28-31
- Full viewport iframe for content embedding
- Sandbox: allow-scripts, allow-same-origin, allow-popups, allow-forms

**Fallback Card:** Lines 32-38
- Displayed when iframe embed blocked (Instagram, Tikok)
- Centered message with warning icon

**Carousel Logic:** Lines 178-210
- Rotate through URLs based on `display.urls[].seconds`
- Skip restricted embeds silently
- Toast notification for current slide

**User Experience (TV):**
1. Display loads → Sponsor banner appears at top
2. Side panel shows sponsor cards (if configured)
3. **Mode: Public** → Mirrors mobile page in iframe
4. **Mode: Dynamic** → Carousel through configured URLs
   - YouTube/Vimeo: Embeds successfully
   - Instagram/TikTok: Skipped automatically
   - Blocked embeds: Shows fallback, skips after 2s
5. Auto-rotation every N seconds
6. Analytics logged automatically

### 3.3 Design Strengths

✅ **Responsive:** Mobile-first with desktop enhancements
✅ **Accessible:** Semantic HTML, focus-visible, reduced-motion support
✅ **TV Legibility:** Large fonts, high contrast
✅ **Sponsor Visibility:** Multiple placement options
✅ **Graceful Degradation:** Fallback for blocked embeds

### 3.4 Design Weaknesses

⚠️ **No Dark Mode:** Only TV has dark background
⚠️ **Limited A11y:** No ARIA labels, skip links, or keyboard nav testing
⚠️ **Print CSS:** Poster.html has print CSS but not tested
⚠️ **No Loading Skeleton:** Blank screen during API calls

---

## 4. SDET Review

### 4.1 Current Test Coverage

**Existing Tests:**
- ❌ **Unit Tests:** None
- ❌ **Integration Tests:** None
- ⚠️ **Manual E2E:** Test.html (basic health check)
- ✅ **Diagnostic Suite:** api_runDiagnostics() (7-step self-test)

**Test.html Coverage (Lines 1-32):**
- Health check validation
- SWR/etag caching test
- Scope blocking test (leagues disabled)

**api_runDiagnostics() Coverage (Code.gs:583-658):**
1. Status check (DB connection)
2. Create event
3. Update event config
4. Log analytics
5. Get report
6. Export report to Sheets
7. Create shortlink

### 4.2 Test Infrastructure Gaps

❌ **No Test Framework:** No Jest, Mocha, or Apps Script test runner
❌ **No CI/CD:** No automated test execution
❌ **No Code Coverage:** No coverage reporting
❌ **No Mock Data:** Tests use production database
❌ **No Contract Tests:** API contracts not validated in CI
❌ **No Performance Tests:** No load testing
❌ **No Security Tests:** No automated security scanning

### 4.3 Required Test Suite

**Unit Tests (Backend):**
- gate_() - Rate limiting + auth
- sanitizeInput_() - XSS prevention
- isUrl() - URL validation
- schemaCheck() - Contract validation
- slug generation with collision handling

**Integration Tests (Backend + Sheets):**
- api_create() - Full create flow
- api_updateEventData() - Update flow
- api_list() with SWR caching
- api_logEvents() - Analytics batch insert
- api_getReport() - Aggregation logic

**Contract Tests:**
- API envelope validation (Ok/Err)
- Schema validation for all endpoints
- ETag behavior

**E2E Tests (Frontend + Backend):**
- Create event in Admin → Verify in Public
- Configure display → Verify in Display
- Log analytics → Verify in report
- Shortlink redirect → Verify analytics

---

## 5. Software Tester Review (End-User Focus)

### 5.1 User Personas

**Persona 1: Event Organizer (Admin)**
- **Goal:** Create event, configure display, track analytics
- **Entry:** Admin page (?page=admin)
- **Journey:**
  1. Open admin page
  2. Fill event form (name, date, time, location)
  3. Add media (image, video, gallery)
  4. Add bio and summary
  5. Submit → See event links
  6. Configure display mode (public or dynamic)
  7. Add sponsors with placements
  8. Copy links for poster/TV/mobile

**Persona 2: Event Attendee (Mobile)**
- **Goal:** View event details, register, check in
- **Entry:** Public page (?p=events&id=EVENT_ID)
- **Journey:**
  1. Open event link on phone
  2. See event name, date, location
  3. View sponsor banner (if any)
  4. Click "Register" button
  5. Fill Google Form
  6. (Optional) View gallery, video, bio

**Persona 3: Event Viewer (TV Display)**
- **Goal:** Passively view event content
- **Entry:** Display page (?page=display&id=EVENT_ID&tv=1)
- **Journey:**
  1. TV auto-loads display page
  2. See sponsor banner at top
  3. See sponsor cards on side
  4. Content rotates (carousel mode) or mirrors public page
  5. Analytics logged automatically

### 5.2 Critical User Flows

**Flow 1: Triangle Workflow (Pre → During → Post)**

**Pre-Event (Admin):**
1. Navigate to admin page
2. Create event with all details
3. Configure sponsors with TV/mobile placements
4. Set display mode (carousel with URLs)
5. Generate links
6. Print posters with QR codes
7. Test TV display

**During Event:**
1. Display page on TV (auto-refresh)
2. Attendees scan QR → Public page
3. Attendees register via form
4. Sponsors visible on all surfaces
5. Analytics logged in background

**Post-Event:**
1. Admin runs diagnostics
2. Admin exports report
3. View sponsor CTR and impressions
4. Share report with sponsors

### 5.3 Usability Issues

⚠️ **Admin Key UX:** Prompt appears on every action
⚠️ **No Confirmation:** No "Event created" toast
⚠️ **No Validation Feedback:** Form errors not highlighted
⚠️ **No Back Button:** Display config has Cancel but no visual hierarchy
⚠️ **No Sponsor Preview:** Can't preview sponsor placements before saving
⚠️ **No Analytics Dashboard:** Must export to Sheets to see data

### 5.4 Recommended Test Scenarios

**Scenario 1: First-Time Admin**
- Open admin page → Should see empty form
- Try to submit without admin key → Should prompt
- Submit with invalid data → Should show error
- Submit valid event → Should see success + links

**Scenario 2: Mobile User at Event**
- Open public link → Should load in < 2s
- Tap sponsor banner → Should log click + redirect
- Tap "Check In" → Should open Google Form
- View gallery → Images should lazy load

**Scenario 3: TV Display at Venue**
- Load display page → Sponsors should appear within 3s
- Carousel mode → Should rotate every N seconds
- Blocked embed (Instagram) → Should skip silently
- Analytics → Should log every rotation

---

## 6. DevOps Review

### 6.1 Current Deployment Process

**Manual Process:**
1. Edit code in local files
2. Copy/paste to Apps Script editor (https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit)
3. Deploy as web app
4. Test manually

### 6.2 Missing Infrastructure

❌ **No .clasp.json:** Can't use `clasp push/pull`
❌ **No package.json:** No dependency management
❌ **No GitHub Actions:** No CI/CD pipeline
❌ **No .gitignore:** No file exclusions
❌ **No linting:** No ESLint or Prettier
❌ **No pre-commit hooks:** No validation before commit
❌ **No versioning:** No semantic versioning
❌ **No rollback:** Can't revert deployments

### 6.3 Deployment URL

**Current:** https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec
**Desired:** zeventbooks.io (custom domain)
**Status:** Not configured

### 6.4 Quality Gates

**Required Gates:**
1. Linting (ESLint) - Fail on errors
2. Unit tests - 80% coverage
3. Contract tests - All endpoints
4. E2E tests - Critical flows
5. Security scan - No secrets in code
6. Performance check - API < 500ms

---

## 7. Recommendations

### 7.1 Immediate (Critical)

1. **Change admin secrets** in Config.gs (lines 17, 26, 35, 44)
2. **Create .clasp.json** for CLI deployment
3. **Add .gitignore** to exclude .clasp.json and secrets
4. **Run diagnostics** (api_runDiagnostics) to verify current state

### 7.2 Short-Term (1-2 weeks)

1. **Implement test suite** (unit + integration)
2. **Set up GitHub Actions** with quality gates
3. **Add ESLint + Prettier** for code quality
4. **Migrate secrets** to Script Properties (not hardcoded)
5. **Add loading states** in frontend
6. **Improve error messages** for better UX

### 7.3 Long-Term (1-3 months)

1. **Migrate to Firestore** for better scalability
2. **Implement OAuth2** for admin access
3. **Add analytics dashboard** in Admin UI
4. **Create versioned API** (/v1/api_*)
5. **Add rollback capability** via deployment tracking
6. **Implement A/B testing** for sponsor placements

---

## 8. File-by-File Reference

| File | Lines | Purpose | Entry Points | Dependencies |
|------|-------|---------|--------------|--------------|
| appsscript.json | 14 | Manifest | N/A | None |
| Config.gs | 111 | Multi-brand config | loadBrands_(), findBrand_(), findTemplate_() | None |
| Code.gs | 659 | Backend API | doGet(), api_*() | Config.gs, SpreadsheetApp |
| Admin.html | 502 | Admin interface | doGet(?page=admin) | Styles, NUSDK, Header |
| Public.html | 378 | Public mobile page | doGet(?p=events) | Styles, Code.gs (api_list, api_get) |
| Display.html | 239 | TV display | doGet(?page=display) | Styles, Code.gs (api_get, api_logEvents) |
| Poster.html | 216 | Print/QR poster | doGet(?page=poster) | Styles, Code.gs (api_get) |
| Test.html | 32 | Basic tests | doGet(?page=test) | Code.gs (api_healthCheck) |
| Diagnostics.html | 234 | Test runner UI | Include only | Code.gs (api_runDiagnostics) |
| Styles.html | 203 | Global CSS | Include only | None |
| NUSDK.html | 39 | Client SDK | Include only | google.script.run |
| Header.html | 14 | Shared header | Include only | Config.gs (ZEB) |
| DesignAdapter.html | 10 | CSS mapping | Include only | None |

---

## 9. Conclusion

This is a **well-architected MVP** with production-grade patterns (multi-tenancy, analytics, API design) but requires **infrastructure hardening** before production deployment. The biggest gaps are testing automation, deployment pipeline, and security (hardcoded secrets).

**Next Steps:**
1. Complete DevOps setup (.clasp, GitHub Actions, quality gates)
2. Implement test suite (unit, integration, e2e)
3. Migrate secrets to Script Properties
4. Deploy to testable URL with e2e validation

**Estimated Effort:** 2-3 days for full infrastructure setup
