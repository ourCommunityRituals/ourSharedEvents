# MVP-EVENT-TOOLKIT: Navigation Quick Reference Guide

## Page Routing Summary Table

| Page | Route | File | Purpose | URL Example |
|------|-------|------|---------|-------------|
| **Public** | Default | `Public.html` | Event listing/detail | `?p=events&brand=root` |
| **Admin** | `?page=admin` | `Admin.html` | Event creation/config | `?page=admin&brand=root` |
| **Display** | `?page=display` | `Display.html` | TV screen | `?page=display&brand=root&id=EVT123&tv=1` |
| **Poster** | `?page=poster` | `Poster.html` | Print/QR codes | `?page=poster&brand=root&id=EVT123` |
| **Report** | `?page=report` | `SharedReport.html` | Analytics | `?page=report&brand=root&id=EVT123` |
| **Analytics** | `?page=analytics` | `SharedReport.html` | Analytics (alias) | `?page=analytics&brand=root&id=EVT123` |
| **Test Hub** | `?page=test` | `Test.html` | Testing navigation | `?page=test&brand=root` |
| **API Docs** | `?page=docs` or `?page=api` | `ApiDocs.html` | REST API docs | `?page=docs` |
| **Status** | `?p=status` | N/A (JSON) | Health check | `?p=status` |
| **Redirect** | `?p=r&t=TOKEN` | N/A (Redirect) | Shortlink tracking | `?p=r&t=abc123def` |

---

## URL Parameter Reference

### Core Parameters
```
?page=PAGENAME       Page identifier (admin, poster, test, display, report, analytics)
?p=SCOPE             Scope identifier (events, leagues, tournaments) - controls which sheet
?brand=BRANDID     Brand identifier (root, abc, cbc, cbl, etc.)
?id=EVENTID          Event identifier (UUID) - for event-specific pages
?tv=1                TV mode flag (for Display.html to use TV-optimized layout)
```

### Special Parameters
```
?action=ACTION       REST API route (list, get, create, update, etc.)
?t=TOKEN             Token for shortlink redirect (?p=r&t=TOKEN)
?token=TOKEN         Alternative token parameter for shortlink
?scope=SCOPE         Alternative scope parameter (usually via ?p= instead)
?host=HOSTNAME       Host header override for brand detection
```

---

## Router Decision Tree (Code.gs: doGet function, lines 97-146)

```javascript
function doGet(e){
  const pageParam = (e?.parameter?.page || e?.parameter?.p || '').toString();
  const actionParam = (e?.parameter?.action || '').toString();
  const brand = findBrandByHost_(hostHeader) || findBrand_('root');

  // 1. REST API endpoints (return JSON)
  if (actionParam) {
    return handleRestApiGet_(e, actionParam, brand);  // ?action=list|get|config|etc
  }

  // 2. Shortlink redirects
  if (pageParam === 'r' || pageParam === 'redirect') {
    return handleRedirect_(token);  // ?p=r&t=TOKEN
  }

  // 3. API documentation
  if (pageParam === 'docs' || pageParam === 'api') {
    return HtmlService.createHtmlOutputFromFile('ApiDocs');  // ?page=docs
  }

  // 4. Status endpoint (JSON)
  if (pageParam === 'status') {
    return ContentService.createTextOutput(JSON.stringify(status));  // ?p=status
  }

  // 5. Scope validation
  const scope = (e?.parameter?.p || e?.parameter?.scope || 'events').toString();
  const allowed = brand.scopesAllowed?.length ? brand.scopesAllowed : ['events','leagues','tournaments'];
  if (!allowed.includes(scope)){
    // Redirect to first allowed scope if invalid
    return HtmlService.createHtmlOutput(`<meta http-equiv="refresh" content="0;url=?p=${first}&brand=${brand.id}">`);
  }

  // 6. Named page routes
  const page = (pageParam==='admin' || pageParam==='poster' || pageParam==='test' ||
                pageParam==='display' || pageParam==='report' || pageParam==='analytics')
    ? pageParam
    : 'public';  // DEFAULT

  // 7. Load and populate template
  const tpl = HtmlService.createTemplateFromFile(pageFile_(page));
  tpl.appTitle = `${brand.name} · ${scope}`;
  tpl.brandId = brand.id;
  tpl.scope = scope;
  tpl.execUrl = ScriptApp.getService().getUrl();
  tpl.ZEB = ZEB;
  return tpl.evaluate();
}
```

---

## Page Mapping Function (Code.gs: pageFile_, lines 275-282)

```javascript
function pageFile_(page){
  if (page==='admin')      return 'Admin';
  if (page==='poster')     return 'Poster';
  if (page==='test')       return 'Test';
  if (page==='display')    return 'Display';
  if (page==='report')     return 'SharedReport';
  if (page==='analytics')  return 'SharedReport';
  return 'Public';  // DEFAULT
}
```

---

## Template Variables Available in All Pages

```javascript
// Passed from Code.gs to all HTML templates via tpl object:

appTitle      // String: "${brand.name} · ${scope}"
              // Example: "Zeventbook · events"

brandId      // String: brand.id
              // Example: "root", "abc", "cbc", "cbl"

scope         // String: 'events' | 'leagues' | 'tournaments'
              // Controls which sheet data is stored in

execUrl       // String: Base URL for creating self-referential links
              // Example: "https://script.google.com/macros/d/ABC123/usercontent?..."

ZEB           // Object: { BUILD_ID, CONTRACT_VER, APP_TITLE }
              // Example: { BUILD_ID: 'triangle-extended-v1.3', ... }
```

---

## How Admin Generates Links (Admin.html, line 310-321)

When an event is created, Admin.html generates 4 URLs:

```javascript
const event = res.value;  // API response with .links property

// Auto-generated during api_create() call
const { publicUrl, posterUrl, displayUrl, reportUrl } = event.links;

// Example links structure:
{
  publicUrl:  "?p=events&brand=root&id=evt-uuid-here",
  posterUrl:  "?page=poster&p=events&brand=root&id=evt-uuid-here",
  displayUrl: "?page=display&p=events&brand=root&id=evt-uuid-here&tv=1",
  reportUrl:  "?page=report&brand=root&id=evt-uuid-here"
}

// These are shown to admin with copy buttons
document.getElementById('lnkPublic').href = publicUrl;
document.getElementById('lnkDisplay').href = displayUrl;
document.getElementById('lnkPoster').href = posterUrl;
document.getElementById('lnkReport').href = reportUrl;
```

---

## Public Page Navigation (Public.html)

### Event List View
```
List of all events for brand/scope
  └─ Click event card
     └─ Load individual event detail with ?id=EVENTID
        └─ Show details + action buttons
           ├─ "Register" button → External URL (registerUrl)
           ├─ "Check In" button → External URL (checkinUrl)
           ├─ "Walk-in" button → External URL (walkinUrl)
           ├─ "Survey" button → External URL (surveyUrl)
           └─ "← Back to Events" → Reload event list (?p=events&brand=...)
```

---

## Event Lifecycle Indicator (Admin.html)

Admin dashboard shows event phase based on date:

```javascript
const eventDate = new Date(d.dateISO || '');
const today = new Date();

if (eventDate > today) {
  phase = 'pre-event';      // Future dates
  phaseLabel = 'Pre-Event Preparation';
} else if (eventDate === today) {
  phase = 'event-day';      // Today
  phaseLabel = 'Event Day - Live';
} else {
  phase = 'post-event';     // Past dates
  phaseLabel = 'Post-Event Analytics';
}
```

Progress bars update based on phase:
- Pre-Event: 0-50% (preparation underway)
- Event Day: 0-100% (event in progress to complete)
- Post-Event: 0-50%+ (analytics analysis)

---

## Multi-brand System (Config.gs)

```javascript
const BRANDS = [
  {
    id: 'root',
    name: 'Zeventbook',
    hostnames: ['zeventbook.io','www.zeventbook.io'],
    logoUrl: '/path/to/logo.webp',
    adminSecret: 'CHANGE_ME_root',
    store: { type: 'workbook', spreadsheetId: '...' },
    scopesAllowed: ['events', 'sponsors']
  },
  // ... more brands
];

// Brand detection order:
1. findBrandByHost_(e.headers.host)  // Match hostname first
2. findBrand_(e.parameter.brand)    // Or use ?brand=ID parameter
3. Default to 'root' brand
```

---

## Scope System

Scopes determine which Google Sheet stores data:

```javascript
const SCOPE = 'events';  // or 'leagues', 'tournaments'

// Sheet name derives from scope:
const SHEET_NAME = scope.toUpperCase();  // 'EVENTS', 'LEAGUES', 'TOURNAMENTS'

// Data stored in columns: [id, brandId, templateId, dataJSON, createdAt, slug]
// Each scope has independent sheet with same structure
```

---

## Current Navigation Gaps (Problems to Solve)

| Gap | Impact | Solution |
|-----|--------|----------|
| No persistent nav menu | Users lost between pages | Add Navigation.html component |
| Inconsistent URL scheme | Confusing (?page= vs ?p=) | Standardize to ?page= only |
| No breadcrumbs | Can't see current location | Add breadcrumb trail |
| No home/dashboard | No clear entry point | Create unified Dashboard |
| Isolated pages | Hard to navigate between flows | Link pages with navigation |
| No role indicators | Don't know whose page they're on | Add role badges |
| Mixed test/prod | Test page in production | Separate Test.html from routing |

---

## Recommended URL Standardization

### Current (Mixed)
```
Admin:   ?page=admin&brand=root
Public:  ?p=events&brand=root
Display: ?page=display&brand=root&id=...
Report:  ?page=report&brand=root&id=...
Status:  ?p=status
```

### Proposed (Consistent)
```
Admin:   ?page=admin&brand=root&scope=events
Public:  ?page=public&brand=root&scope=events&id=... (optional)
Display: ?page=display&brand=root&id=...
Report:  ?page=report&brand=root&id=...
Status:  ?page=status
Docs:    ?page=docs
Redirect:?page=redirect&token=...
```

---

## Code Locations Quick Index

| Need | File | Lines |
|------|------|-------|
| Router logic | Code.gs | 97-146 |
| Page file mapping | Code.gs | 275-282 |
| Template variables | Code.gs | 138-143 |
| REST API routes | Code.gs | 163-263 |
| Brand config | Config.gs | 11-48 |
| Event templates | Config.gs | 50-101 |
| Admin creation | Admin.html | 269-312 |
| Admin dashboard | Admin.html | 16-79 |
| Public list/detail | Public.html | 265-448 |
| Display layout | Display.html | 1-100+ |
| Report metrics | SharedReport.html | 53-100+ |
| Test navigation | Test.html | 139-292 |

---

## Key Learnings for Triangle Framework

1. **Already Organized by Phase**
   - Admin dashboard explicitly shows Before/During/After
   - Pages are use-case specific (display, poster, report)
   - Framework aligns with existing structure

2. **Separate User Journeys**
   - Admin journey: Create → Configure → Share links
   - Attendee journey: List → Detail → Register/Check-in
   - Sponsor journey: Display → Analytics
   - Staff journey: Admin dashboard

3. **Shared Infrastructure**
   - All pages use same Google Apps Script backend
   - Multi-brand support already implemented
   - Scope system allows flexible data organization
   - Analytics automatically logged across surfaces

4. **Navigation Improvements Needed**
   - No visible menu = hard to navigate
   - No breadcrumbs = easy to get lost
   - Inconsistent URLs = confusing
   - Test page as unofficial hub = not scalable

5. **For Triangle Reorganization**
   - Keep page separation (Admin, Public, Display, Report)
   - Add role-based landing pages
   - Implement persistent navigation showing phase
   - Standardize URL parameters
   - Create clear entry points for Before/During/After

