# URL Parameter Handling - Executive Summary

## Quick Answer
The Google Apps Script project uses a sophisticated two-layer URL parameter system:
1. **Query parameters**: `?p=page&brand=id` (short form) or `?page=page` (long form)
2. **Friendly URLs**: `/brand/alias` patterns with server-side alias resolution

## Critical Finding: White Screen Issue

**Root Cause:** `/home/user/MVP-EVENT-TOOLKIT/HeaderInit.html` (Line 8)

```html
const logoUrl = '<?= findBrand_(brandId)?.logoUrl || "/..." ?>';
                    ↑
          SERVER-SIDE FUNCTION NOT AVAILABLE IN INCLUDED TEMPLATE
```

**Impact:** When HeaderInit.html is included via `include()`, the server-side function `findBrand_` is not available in the template's execution context, causing a template evaluation error and potentially resulting in a blank white page.

**Immediate Fix:**
```html
const logoUrl = '<?= brand?.logoUrl || "/..." ?>';
                    ↑
          USES BRAND OBJECT ALREADY PASSED IN CONTEXT (Safe!)
```

This fix is safe because the `brand` object is explicitly passed in the template context at `Code.gs:420`.

---

## URL Parameter Architecture

### Layer 1: Query Parameters
The simplest way to request pages:
- `?p=public` - Public event listing page
- `?p=admin` - Admin interface (defaults to wizard mode)
- `?p=admin&mode=advanced` - Advanced admin interface
- `?brand=abc` - Switch to brand 'abc'
- `?scope=sponsors` - View sponsors instead of events
- `?action=status` - Get API status as JSON

**Accepted Parameter Names (Interchangeable):**
- `p` and `page` both select the page
- `scope` and sometimes `p` (context-dependent)

### Layer 2: Friendly URLs
Search-engine friendly, human-readable URLs:
- `/events` - Public events (root brand)
- `/abc/events` - Public events (brand 'abc')
- `/abc/manage` - Admin panel (brand 'abc')
- `/abc/tournaments` - Custom brand-specific page
- `/docs` - API documentation

---

## Request Flow

```
1. Browser makes HTTP request with parameters
                     ↓
2. doGet(e) extracts parameters:
   - pageParam (from ?p or ?page)
   - actionParam (from ?action)
   - hostHeader (from Host header or ?host param)
   - scope (from ?scope or default 'events')
   - brand (from ?brand or host-based lookup)
                     ↓
3. Route decision:
   ├─ If action param → API endpoint (JSON response)
   ├─ If friendly URL → resolveUrlAlias_() → get page config
   ├─ If special page (docs, status, etc.) → special handler
   └─ Otherwise → display page
                     ↓
4. Determine page filename:
   pageFile_(page) → returns HTML filename
                     ↓
5. Load and render template:
   - createTemplateFromFile(filename)
   - Set variables: appTitle, brandId, scope, ZEB, demoMode, brand
   - Evaluate template
   - Return HTML to browser
                     ↓
6. Browser renders the page
```

---

## Key Functions and Locations

| Function | File | Purpose |
|----------|------|---------|
| `doGet(e)` | Code.gs:233 | Main entry point, parameter extraction |
| `routePage_()` | Code.gs:375 | Template rendering and variable injection |
| `pageFile_()` | Code.gs:812 | Map page name to HTML filename |
| `include()` | Code.gs:861 | Include templates with context variables |
| `findBrand_()` | Config.gs:300 | Brand lookup by ID |
| `findBrandByHost_()` | Config.gs:302 | Brand detection by hostname |
| `resolveUrlAlias_()` | Config.gs:373 | Friendly URL to page configuration |

---

## Supported Pages

| Page | Filename | Access | Notes |
|------|----------|--------|-------|
| public | Public.html | Public | Default page, event listings |
| admin | Admin.html | Admin | Advanced admin interface |
| wizard | AdminWizard.html | Admin | Simplified admin (default when p=admin) |
| admin-enhanced | AdminEnhanced.html | Admin | Component-based admin UI |
| planner | PlannerCards.html | Admin | Card-based event planner |
| poster | Poster.html | Public | Poster/flyer generator |
| test | Test.html | Admin | Testing interface |
| display | Display.html | Public | TV/kiosk display mode |
| report | SharedReport.html | Admin | Analytics and reporting |
| analytics | SharedReport.html | Admin | Alias for report |
| sponsor | Sponsor.html | Admin | Sponsor management |
| sponsor-roi | SponsorDashboard.html | Admin | Sponsor ROI dashboard |
| diagnostics | Diagnostics.html | Admin | System diagnostics |
| signup | Signup.html | Public | User signup form |
| config | ConfigHtml.html | Admin | Configuration interface |
| docs/api | ApiDocs.html | Public | API documentation |

---

## Brands Configuration

```javascript
const BRANDS = [
  {
    id: 'root',
    name: 'Zeventbook',
    hostnames: ['zeventbook.io', 'www.zeventbook.io'],
    logoUrl: '/path/to/logo.webp',
    store: { spreadsheetId: '...' },
    scopesAllowed: ['events', 'sponsors']
  },
  {
    id: 'abc',
    name: 'American Bocce Co.',
    type: 'parent',
    childBrands: ['cbc', 'cbl'],
    // ... other properties
  },
  // More brands...
];
```

---

## Special Routes & Endpoints

### API Status Endpoints
- `?p=status` → System status (JSON)
- `?p=setup` or `?p=setupcheck` → Setup diagnostics (JSON)
- `?p=permissions` or `?p=checkpermissions` → Permission diagnostics (JSON)

### REST API Routes
- `?action=status` → API status
- `?action=generateCSRFToken` → CSRF token
- Various other API actions via `handleRestApiGet_()`

### Shortlinks
- `?p=r` or `?p=redirect` with `?t=token` → Redirect to URL

---

## Template Context Variables

Variables available in all templates:

```javascript
{
  appTitle: "Brand Name · Scope",
  brandId: "abc",
  scope: "events",
  execUrl: "https://script.google.com/...",
  ZEB: { BUILD_ID, URL_ALIASES, BRAND_URL_PATTERNS, DEMO_MODE },
  demoMode: false,
  brand: { id, name, logoUrl, store, scopesAllowed, ... },
  friendlyUrl: false,
  urlAlias: ""
}
```

Available in included templates via `include()` function.

---

## Scope Validation

Each brand defines `scopesAllowed`:
```javascript
scopesAllowed: ['events', 'sponsors']
```

If a user requests an invalid scope:
1. Automatically redirects to first allowed scope
2. Uses meta refresh: `<meta http-equiv="refresh" content="0;url=?p=SCOPE&brand=BRAND">`

---

## Security Features

1. **CSRF Token Protection**: Required for state-changing operations
2. **Origin Validation**: Checks request origin matches expected hosts
3. **Input Sanitization**: Template variables sanitized before injection
4. **Scope Validation**: Prevents access to unauthorized data scopes
5. **Admin Key Protection**: Stored in sessionStorage, not in URL

---

## Issues Identified

### Issue #1: Template Function Call (CRITICAL)
**File:** HeaderInit.html:8
**Status:** Needs immediate fix
**Solution:** Use `brand.logoUrl` instead of `findBrand_(brandId)`

### Issue #2: Missing Error Handling
**File:** Code.gs:395
**Status:** Potential silent failures
**Solution:** Wrap template creation in try-catch

### Issue #3: Include Function Limitations
**File:** Code.gs:861-878
**Status:** Server functions not available to included templates
**Solution:** Pass function references or alternative implementations in context

---

## Testing Recommendations

1. **Parameter Variants**
   - Test both `?p=` and `?page=` forms
   - Verify they work identically

2. **Brand Switching**
   - Test with `?brand=root`, `?brand=abc`, etc.
   - Test with invalid brand ID (should default to root)

3. **Friendly URLs**
   - Test `/abc/events` → should show public page for 'abc'
   - Test `/abc/manage` → should show admin for 'abc'
   - Test `/abc/tournaments` → custom alias for 'abc'

4. **Special Pages**
   - `?p=status` → JSON response
   - `?p=docs` → HTML documentation page
   - `?p=admin&mode=advanced` → advanced admin UI

5. **Template Rendering**
   - Verify HeaderInit.html logo renders correctly
   - Check console for JavaScript errors
   - Validate all included templates load properly

---

## Implementation Summary

The system is well-designed with:
- ✓ Multiple URL routing patterns (query params + friendly URLs)
- ✓ Brand-aware routing and data scoping
- ✓ Template variable injection system
- ✓ REST API endpoints
- ✓ Comprehensive configuration in Config.gs
- ✗ **Critical bug in HeaderInit.html template** (needs fixing)
- ✗ Missing error handling in template loading
- ✗ Limited context available to included templates

The critical HeaderInit.html bug should be fixed immediately to prevent white screen issues in production.

