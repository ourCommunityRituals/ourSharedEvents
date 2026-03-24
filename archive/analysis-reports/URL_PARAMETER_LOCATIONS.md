# URL Parameter Handling - Code Locations Reference

## File: /home/user/MVP-EVENT-TOOLKIT/Code.gs

### doGet Function (Main Entry Point)
**Lines 233-362**

#### Parameter Extraction (Lines 234-236)
```javascript
const pageParam = (e?.parameter?.page || e?.parameter?.p || '').toString();
const actionParam = (e?.parameter?.action || '').toString();
const hostHeader = (e?.headers?.host || e?.parameter?.host || '').toString();
```

#### Brand Resolution (Lines 237-245)
```javascript
let brand = findBrandByHost_(hostHeader) || findBrand_('root');

if (e?.parameter?.brand) {
  const overrideBrand = findBrand_(e.parameter.brand);
  if (overrideBrand) {
    brand = overrideBrand;
  }
}
```

#### Demo Mode Detection (Line 248)
```javascript
const demoMode = (e?.parameter?.demo === 'true' || e?.parameter?.test === 'true');
```

#### Friendly URL Routing (Lines 250-303)
```javascript
const pathInfo = (e?.pathInfo || '').toString().replace(/^\/+|\/+$/g, '');

if (pathInfo) {
  const pathParts = pathInfo.split('/').filter(p => p);
  // Pattern: /{brand}/{alias} or /{alias}
  // Example: /abc/events → resolveUrlAlias_('events', 'abc')
}
```

#### REST API Routes (Lines 306-346)
```javascript
if (actionParam) {
  return handleRestApiGet_(e, actionParam, brand);
}

if (pageParam === 'r' || pageParam === 'redirect') {
  const token = (e?.parameter?.t || e?.parameter?.token || '').toString();
  return handleRedirect_(token);
}

if (pageParam === 'docs' || pageParam === 'api') {
  return HtmlService.createHtmlOutputFromFile('ApiDocs');
}

if (pageParam === 'status') {
  const brandParam = (e?.parameter?.brand || 'root').toString();
  const status = api_status(brandParam);
  return ContentService.createTextOutput(JSON.stringify(status, null, 2));
}

if (pageParam === 'setup' || pageParam === 'setupcheck') {
  const brandParam = (e?.parameter?.brand || 'root').toString();
  const setupResult = api_setupCheck(brandParam);
  return ContentService.createTextOutput(JSON.stringify(setupResult, null, 2));
}

if (pageParam === 'permissions' || pageParam === 'checkpermissions') {
  const brandParam = (e?.parameter?.brand || 'root').toString();
  const permissionResult = api_checkPermissions(brandParam);
  return ContentService.createTextOutput(JSON.stringify(permissionResult, null, 2));
}
```

#### Scope Validation (Lines 349-355)
```javascript
const scope = (e?.parameter?.p || e?.parameter?.scope || 'events').toString();
const allowed = brand.scopesAllowed?.length ? brand.scopesAllowed : ['events','leagues','tournaments'];

if (!allowed.includes(scope)){
  const first = allowed[0] || 'events';
  return HtmlService.createHtmlOutput(`<meta http-equiv="refresh" content="0;url=?p=${first}&brand=${brand.id}">`);
}
```

#### Page Determination (Line 358)
```javascript
let page = (pageParam==='admin' || pageParam==='wizard' || pageParam==='planner' || 
  pageParam==='poster' || pageParam==='test' || pageParam==='display' || 
  pageParam==='report' || pageParam==='analytics' || pageParam==='diagnostics' || 
  pageParam==='sponsor' || pageParam==='sponsor-roi' || pageParam==='signup' || 
  pageParam==='config') ? pageParam : 'public';
```

### routePage_ Function (Template Rendering)
**Lines 375-429**

#### Critical Issue Location (Line 395)
```javascript
const tpl = HtmlService.createTemplateFromFile(pageFile_(page));
// ⚠️ NO ERROR HANDLING - could fail silently if template doesn't exist
```

#### Template Variable Assignment (Lines 396-403)
```javascript
tpl.appTitle = sanitizeInput_(`${brand.name} · ${scope}`, 200);
tpl.brandId = sanitizeId_(brand.id) || brand.id;
tpl.scope = sanitizeInput_(scope, 50);
tpl.execUrl = ScriptApp.getService().getUrl();
tpl.ZEB = ZEB;
tpl.demoMode = demoMode;
tpl.brand = brand;  // IMPORTANT: This is passed to templates
```

#### Global Context Setup (Lines 413-423)
```javascript
global_setTemplateContext_({
  appTitle: tpl.appTitle,
  brandId: tpl.brandId,
  scope: tpl.scope,
  execUrl: tpl.execUrl,
  ZEB: tpl.ZEB,
  demoMode: tpl.demoMode,
  brand: tpl.brand,        // Full brand object passed here
  friendlyUrl: tpl.friendlyUrl || false,
  urlAlias: tpl.urlAlias || ''
});
```

### pageFile_ Function (Page-to-File Mapping)
**Lines 812-827**
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
  return 'Public';
}
```

### include() Function (Template Inclusion)
**Lines 861-878**
```javascript
function include(filename) {
  const template = HtmlService.createTemplateFromFile(filename);
  
  const context = global_getTemplateContext_();
  
  if (context) {
    Object.keys(context).forEach(function(key) {
      template[key] = context[key];  // Pass context variables to template
    });
  }
  
  return template.evaluate().getContent();
}
```

### Template Context Management
**Lines 831-849**
```javascript
var TEMPLATE_CONTEXT_ = null;

function global_setTemplateContext_(context) {
  TEMPLATE_CONTEXT_ = context;
}

function global_getTemplateContext_() {
  return TEMPLATE_CONTEXT_;
}
```

## File: /home/user/MVP-EVENT-TOOLKIT/Config.gs

### findBrand_ Function (Brand Lookup)
**Line 300**
```javascript
function findBrand_(id) { 
  return BRANDS.find(b => b.id === id) || null; 
}
```

### findBrandByHost_ Function (Hostname-based Brand Detection)
**Lines 302-317**
```javascript
function findBrandByHost_(host) {
  host = String(host || '').toLowerCase();
  const brand = BRANDS.find(b => (b.hostnames || []).includes(host));
  
  if (!brand) {
    try {
      const timestamp = new Date().toISOString();
      console.warn(`[${timestamp}] Unknown hostname: ${host}`);
    } catch (e) {
      // Ignore logging errors
    }
  }
  
  return brand || null;
}
```

### resolveUrlAlias_ Function (Friendly URL Resolution)
**Lines 373-393**
```javascript
function resolveUrlAlias_(alias, brandId) {
  if (!alias) return null;
  
  const aliasLower = alias.toLowerCase();
  
  // Check brand-specific custom aliases first
  if (brandId && ZEB.BRAND_URL_PATTERNS.customAliases[brandId]) {
    const customAlias = ZEB.BRAND_URL_PATTERNS.customAliases[brandId][aliasLower];
    if (customAlias) {
      return { ...customAlias, source: 'brand-custom' };
    }
  }
  
  // Check global aliases
  const globalAlias = ZEB.URL_ALIASES[aliasLower];
  if (globalAlias) {
    return { ...globalAlias, source: 'global' };
  }
  
  return null;
}
```

### URL Aliases Configuration
**Lines 13-49**
```javascript
URL_ALIASES: {
  'events': { page: 'public', label: 'Events', public: true },
  'schedule': { page: 'public', label: 'Schedule', public: true },
  'calendar': { page: 'public', label: 'Calendar', public: true },
  
  'manage': { page: 'admin', mode: 'advanced', label: 'Management', public: false },
  'admin': { page: 'admin', mode: 'advanced', label: 'Admin', public: false },
  'create': { page: 'wizard', label: 'Create Event', public: false },
  'planner': { page: 'planner', label: 'Event Planner', public: false },
  
  'display': { page: 'display', label: 'Display', public: true },
  'tv': { page: 'display', label: 'TV Display', public: true },
  
  'analytics': { page: 'report', label: 'Analytics', public: false },
  'reports': { page: 'report', label: 'Reports', public: false },
  
  'docs': { page: 'api', label: 'API Docs', public: true },
  'api': { page: 'api', label: 'API Documentation', public: true }
}
```

### Brand URL Patterns Configuration
**Lines 51-87**
```javascript
BRAND_URL_PATTERNS: {
  enableBrandPrefix: true,
  enableSubdomainRouting: false,
  customAliases: {
    'abc': {
      'tournaments': { page: 'public', label: 'Tournaments', public: true },
      'leagues': { page: 'public', label: 'Leagues', public: true },
      'bocce': { page: 'public', label: 'Bocce Events', public: true },
      'network': { page: 'report', label: 'Network Analytics', public: false }
    },
    'cbc': {
      'tournaments': { page: 'public', label: 'CBC Tournaments', public: true },
      'club-events': { page: 'public', label: 'Club Events', public: true },
      'register': { page: 'wizard', label: 'Register Event', public: false }
    },
    'cbl': {
      'seasons': { page: 'public', label: 'Seasons', public: true },
      'league-events': { page: 'public', label: 'League Events', public: true },
      'schedule': { page: 'public', label: 'Schedule', public: true }
    }
  }
}
```

## File: /home/user/MVP-EVENT-TOOLKIT/HeaderInit.html

### CRITICAL ISSUE - Line 8
```html
const logoUrl = '<?= findBrand_(brandId)?.logoUrl || "/My files/Linux files/zeventbook/assets/logos/ABCMainTransparent.webp" ?>';
```

**Problem:** 
- Tries to call `findBrand_()` function from within template
- `findBrand_` is NOT available in included template scope
- The brand object WITH logoUrl IS available (passed in context)

**Fix:** Replace with:
```html
const logoUrl = '<?= brand?.logoUrl || "/My files/Linux files/zeventbook/assets/logos/ABCMainTransparent.webp" ?>';
```

## Brand Configuration
**Lines 142-200+ in Config.gs**
```javascript
const BRANDS = [
  {
    id: 'root',
    name: 'Zeventbook',
    hostnames: ['zeventbook.io','www.zeventbook.io'],
    logoUrl: '/My files/Linux files/zeventbook/assets/logos/ABCMainTransparent.webp',
    store: { type: 'workbook', spreadsheetId: '1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ' },
    scopesAllowed: ['events', 'sponsors']
  },
  // ... more brands
];
```

## URL Parameter Flow Diagram

```
HTTP Request
    ↓
doGet(e)
    ↓
Extract parameters:
  - page/p parameter
  - brand parameter
  - action parameter
  - host header
  - scope parameter
    ↓
Route Decision:
  - If action → handleRestApiGet_()
  - If special page (docs, status, etc.) → Return specific response
  - If friendly URL → resolveUrlAlias_() → Set page
    ↓
Determine page:
  - Match against valid pages
  - Default to 'public'
    ↓
routePage_(e, page, brand, demoMode, options)
    ↓
pageFile_(page) → Get HTML filename
    ↓
createTemplateFromFile() → Load template
    ↓
Set template variables:
  - appTitle, brandId, scope, execUrl, ZEB, demoMode, brand
    ↓
global_setTemplateContext_() → Make available to includes
    ↓
tpl.evaluate() → Render template
    ↓
Return HtmlOutput to browser
```

## Common URL Patterns

### Parameter-based Routes
- `GET /` → default (public page, root brand)
- `GET /?p=public` → public page
- `GET /?p=admin` → admin page (redirects to wizard)
- `GET /?p=admin&mode=advanced` → advanced admin
- `GET /?p=admin&mode=enhanced` → enhanced admin
- `GET /?brand=abc` → specific brand
- `GET /?p=admin&brand=abc` → admin for brand 'abc'
- `GET /?action=status` → API status endpoint
- `GET /?action=status&brand=abc` → API status for brand

### Friendly URL Routes
- `GET /events` → public page, default brand
- `GET /abc/events` → public page, brand 'abc'
- `GET /manage` → admin page, default brand
- `GET /abc/manage` → admin page, brand 'abc'
- `GET /abc/tournaments` → custom 'tournaments' alias for brand 'abc'
- `GET /docs` → API documentation
- `GET /?p=status` → Status endpoint

