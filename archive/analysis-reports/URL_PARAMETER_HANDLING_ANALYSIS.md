# URL Parameter Handling Analysis - MVP Event Toolkit

## Summary
This analysis examines how the Google Apps Script project handles URL parameters and identifies potential causes for white screen issues.

## Parameter Handling Mechanism

### 1. Parameter Extraction (doGet function - Code.gs, line 233-236)
```javascript
function doGet(e){
  const pageParam = (e?.parameter?.page || e?.parameter?.p || '').toString();
  const actionParam = (e?.parameter?.action || '').toString();
  const hostHeader = (e?.headers?.host || e?.parameter?.host || '').toString();
```

**Key Points:**
- Accepts TWO parameter names: `page` and `p` (interchangeable)
- Examples: `?page=admin` or `?p=admin` both work
- Empty string defaults to 'public' page

### 2. Main Routing Logic (doGet function - Code.gs, line 358)
```javascript
let page = (pageParam==='admin' || pageParam==='wizard' || pageParam==='planner' || 
  pageParam==='poster' || pageParam==='test' || pageParam==='display' || 
  pageParam==='report' || pageParam==='analytics' || pageParam==='diagnostics' || 
  pageParam==='sponsor' || pageParam==='sponsor-roi' || pageParam==='signup' || 
  pageParam==='config') ? pageParam : 'public';
```

**Supported Pages:**
- admin (redirects to wizard by default)
- wizard
- planner
- poster
- test
- display
- report
- analytics
- diagnostics
- sponsor
- sponsor-roi
- signup
- config
- public (default)

### 3. URL Alias Resolution (Friendly URLs)
Location: `Config.gs` (lines 373-393)

Supports friendly URL patterns:
- `/abc/events` → page=public
- `/abc/manage` → page=admin
- `/abc/tournaments` → custom alias per brand
- `/events` → uses default brand

## Page File Mapping (Code.gs, lines 812-827)
```javascript
function pageFile_(page){
  if (page==='admin') return 'Admin';
  if (page==='admin-enhanced') return 'AdminEnhanced';
  if (page==='wizard') return 'AdminWizard';
  if (page==='planner') return 'PlannerCards';
  if (page==='poster') return 'Poster';
  if (page==='test') return 'Test';
  if (page==='display') return 'Display';
  if (page==='report' || page==='analytics') return 'SharedReport';
  if (page==='diagnostics') return 'Diagnostics';
  if (page==='sponsor') return 'Sponsor';
  if (page==='sponsor-roi') return 'SponsorDashboard';
  if (page==='signup') return 'Signup';
  if (page==='config') return 'ConfigHtml';
  return 'Public';  // DEFAULT
}
```

**Verified:** All referenced HTML files exist in repository.

## Critical Issues Found

### Issue #1: HeaderInit.html - Server-Side Function Call in Template
**Location:** HeaderInit.html, line 8
**Problem:** 
```html
const logoUrl = '<?= findBrand_(brandId)?.logoUrl || "/..." ?>';
```

**Why This Is a Problem:**
1. `findBrand_` is a server-side function defined in Config.gs
2. HeaderInit.html is included via `include()` function (Code.gs, line 861-878)
3. When included templates are evaluated, server-side functions may not be available in the template's scope
4. The template context passed to included files (lines 870-874) does NOT include `findBrand_` function

**Solution:** 
Replace with the brand object already passed in context:
```html
const logoUrl = '<?= brand?.logoUrl || "/..." ?>';
```

The brand object IS properly included in the context (Code.gs, line 420).

### Issue #2: Missing Error Handling in routePage_
**Location:** Code.gs, line 395
**Current Code:**
```javascript
const tpl = HtmlService.createTemplateFromFile(pageFile_(page));
```

**Problem:**
- No try-catch block around template creation
- If template file fails to load or evaluate, function will fail silently
- Could return blank/white page without error information

**Note:** All HTML files currently exist, but error handling should be added for robustness.

### Issue #3: Potential Include() Function Limitation
**Location:** Code.gs, lines 861-878
**Issue:**
When `include()` creates a template for included files, it may not have access to:
- Server-side functions defined in the main project
- Only has access to variables passed in the template context

**Current Context Passed:**
- appTitle
- brandId
- scope
- execUrl
- ZEB (configuration object)
- demoMode
- brand (full brand object)
- friendlyUrl
- urlAlias

**Missing from Context:**
- findBrand_() function
- Other helper functions

## Brand Parameter Handling

### Default Brand Selection (doGet, lines 237-245)
```javascript
let brand = findBrandByHost_(hostHeader) || findBrand_('root');

if (e?.parameter?.brand) {
  const overrideBrand = findBrand_(e.parameter.brand);
  if (overrideBrand) {
    brand = overrideBrand;
  }
}
```

**Logic:**
1. First, tries to find brand by hostname
2. Falls back to 'root' brand
3. Can be overridden with `?brand=abc` parameter
4. Unrecognized brand IDs are silently ignored (no error)

## Action Parameter Handling

### REST API Routes (doGet, lines 306-346)
The `action` parameter routes to REST API endpoints:
- `?action=status` → API status check
- `?action=setupcheck` → Setup diagnostics
- `?action=checkpermissions` → Permission diagnostics
- Other actions handled by `handleRestApiGet_()` function

### Special Routes (doGet, lines 316-346)
```javascript
if (pageParam === 'docs' || pageParam === 'api') → ApiDocs.html
if (pageParam === 'status') → API status endpoint
if (pageParam === 'setup' || pageParam === 'setupcheck') → Setup check
if (pageParam === 'permissions' → Permission check
if (pageParam === 'r' || pageParam === 'redirect') → Shortlink redirect
```

## Scope Parameter Handling (doGet, lines 349-355)
```javascript
const scope = (e?.parameter?.p || e?.parameter?.scope || 'events').toString();
const allowed = brand.scopesAllowed?.length ? brand.scopesAllowed : ['events','leagues','tournaments'];

if (!allowed.includes(scope)){
  // Redirect to first allowed scope
  return HtmlService.createHtmlOutput(`<meta http-equiv="refresh" content="0;url=?p=${first}&brand=${brand.id}">`);
}
```

**Logic:**
- Validates requested scope against brand's allowed scopes
- Automatically redirects to first allowed scope if invalid
- Uses meta refresh for browser-side redirect

## Template Variable Passing

### Main Template Context (routePage_, lines 395-403)
```javascript
const tpl = HtmlService.createTemplateFromFile(pageFile_(page));
tpl.appTitle = sanitizeInput_(`${brand.name} · ${scope}`, 200);
tpl.brandId = sanitizeId_(brand.id) || brand.id;
tpl.scope = sanitizeInput_(scope, 50);
tpl.execUrl = ScriptApp.getService().getUrl();
tpl.ZEB = ZEB;
tpl.demoMode = demoMode;
tpl.brand = brand;
```

### Global Context for Includes (routePage_, lines 413-423)
```javascript
global_setTemplateContext_({
  appTitle: tpl.appTitle,
  brandId: tpl.brandId,
  scope: tpl.scope,
  execUrl: tpl.execUrl,
  ZEB: tpl.ZEB,
  demoMode: tpl.demoMode,
  brand: tpl.brand,
  friendlyUrl: tpl.friendlyUrl || false,
  urlAlias: tpl.urlAlias || ''
});
```

## Recent Changes Related to Blank Screen

### Commit 2f5574c (Nov 20, 2025)
- **Message:** "refactor: Replace all 'tenant' references with 'brand' for consistency"
- **Issue Fixed:** Undefined `findTenant_()` function references
- **Files Modified:** 19 files including HeaderInit.html
- **Change:** TENANT → BRAND variable renaming

### Commit 1046968 
- **Message:** "fix: Replace undefined findTenant_ with findBrand_ in HeaderInit.html"
- **Note:** This fix replaced undefined function but still using problematic pattern

## Recommendations

### Critical Fix (Prevents Blank Screen)
**File:** HeaderInit.html
**Change Line 8 from:**
```html
const logoUrl = '<?= findBrand_(brandId)?.logoUrl || "/My files/Linux files/zeventbook/assets/logos/ABCMainTransparent.webp" ?>';
```

**To:**
```html
const logoUrl = '<?= brand?.logoUrl || "/My files/Linux files/zeventbook/assets/logos/ABCMainTransparent.webp" ?>';
```

**Reason:** The brand object is already passed in the template context and has all necessary properties.

### Add Error Handling (Prevents Silent Failures)
**File:** Code.gs
**Location:** Around line 395
**Add try-catch:**
```javascript
let tpl;
try {
  const pageFileName = pageFile_(page);
  tpl = HtmlService.createTemplateFromFile(pageFileName);
} catch(err) {
  diag_('error', 'routePage_', `Failed to load template`, {page, error: String(err)});
  return HtmlService.createHtmlOutput(`<p>Error loading page: ${page}</p>`);
}
```

### Include() Function Enhancement
**Option:** Pass more context variables to included templates or create a safer include() mechanism that has access to server-side functions through a wrapper object.

## Testing Checklist

1. Test with `?p=public` → Should show Public.html
2. Test with `?page=admin` → Should show AdminWizard.html (default admin)
3. Test with `?page=admin&mode=advanced` → Should show Admin.html
4. Test with `/abc/events` → Should show public page for brand 'abc'
5. Test with `?brand=unknown` → Should use 'root' brand silently
6. Test with invalid scope → Should redirect to first allowed scope
7. Test with `?action=status` → Should return JSON status
8. Test HeaderInit.html rendering → Verify logo loads correctly

## URL Parameter Quick Reference

| Parameter | Values | Example | Effect |
|-----------|--------|---------|--------|
| `p` or `page` | public, admin, wizard, planner, poster, test, display, report, analytics, diagnostics, sponsor, sponsor-roi, signup, config, docs, status, setup, permissions, r/redirect | `?p=admin` | Selects which page template to show |
| `brand` | Brand ID (root, abc, cbc, cbl, etc.) | `?brand=abc` | Override default brand |
| `action` | REST API actions | `?action=status` | Routes to API handlers |
| `scope` | events, sponsors, leagues, tournaments | `?scope=sponsors` | Selects data scope |
| `mode` | advanced, enhanced | `?mode=advanced` | Sets admin interface mode |
| `demo` | true | `?demo=true` | Enables demo mode |
| `test` | true | `?test=true` | Enables test mode |

