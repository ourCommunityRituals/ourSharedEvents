# Worker Routing & HTML Asset Wiring

**Date:** 2025-12-08
**Author:** Discovery / Story 1 & Story 2
**Purpose:** Document Worker routing architecture and HTML template serving

---

## Architecture Overview (Story 2 Update)

```
                  +-----------------------+
                  |   eventangle.com/*    |
                  +-----------+-----------+
                              |
                              v
                  +-----------+-----------+
                  |  Cloudflare Worker    |
                  |  cloudflare-proxy/    |
                  |     worker.js v2.0    |
                  +-----------+-----------+
                              |
               +--------------+--------------+--------------+
               |              |              |              |
               v              v              v              v
         [HTML Routes]  [JSON Routes]  [API Routes]  [Shortlinks]
               |              |              |              |
               v              v              v              v
          Worker-gen      GAS doGet      GAS doPost     GAS doGet
          (templates)     (proxy)        (proxy)        (proxy)
               |              |              |              |
               v              v              v              v
          renderTemplate  ContentService  ContentService  handleRedirect_
```

**Worker Entry File:** `cloudflare-proxy/worker.js` (v2.0.0)

---

## Story 2: Explicit HTML Route Map Implementation

### Key Principle: No HTML → GAS

HTML routes are now served directly from Worker templates. GAS is ONLY accessed via:
- `/api/*` JSON RPC endpoints
- `/status`, `/ping` JSON endpoints
- `?p=r&t=...` shortlink redirects

This eliminates the "leaky" routing where HTML could come from GAS.

---

## Route Categories

### 1. HTML-Returning Routes (Worker Templates - NO GAS)

| URL Pattern | Aliases | Template | Handler |
|-------------|---------|----------|---------|
| `/events` | `/schedule`, `/calendar` | `public.html` | `handleHtmlPageRequest()` |
| `/manage` | `/admin`, `/dashboard`, `/create`, `/docs` | `admin.html` | `handleHtmlPageRequest()` |
| `/display` | `/tv`, `/kiosk`, `/screen` | `display.html` | `handleHtmlPageRequest()` |
| `/poster` | `/posters`, `/flyers` | `poster.html` | `handleHtmlPageRequest()` |
| `/analytics` | `/reports`, `/insights`, `/stats` | `report.html` | `handleHtmlPageRequest()` |
| `/` (root, no page param) | - | `public.html` | `handleHtmlPageRequest()` |

**HTML_ROUTE_MAP (worker.js:59-90):**
```javascript
const HTML_ROUTE_MAP = Object.freeze({
  // Public-facing routes
  'public': 'public',
  'events': 'public',
  'schedule': 'public',
  'calendar': 'public',
  // Admin routes
  'admin': 'admin',
  'manage': 'admin',
  'dashboard': 'admin',
  'create': 'admin',
  'docs': 'admin',
  // Display/TV routes
  'display': 'display',
  'tv': 'display',
  'kiosk': 'display',
  'screen': 'display',
  // Poster routes
  'poster': 'poster',
  'posters': 'poster',
  'flyers': 'poster',
  // Report/Analytics routes
  'report': 'report',
  'analytics': 'report',
  'reports': 'report',
  'insights': 'report',
  'stats': 'report'
});
```

### 2. JSON-Returning Routes (Proxied to GAS)

| URL Pattern | Handler | Response |
|-------------|---------|----------|
| `/status`, `/health` | `handleJsonPageRequest()` | JSON status |
| `/ping` | `handleJsonPageRequest()` | `{"status":"ok"}` |
| `/diagnostics` | `handleJsonPageRequest()` | JSON diagnostics |

**JSON_ROUTE_MAP (worker.js:96-102):**
```javascript
const JSON_ROUTE_MAP = Object.freeze({
  'status': 'status',
  'health': 'status',
  'ping': 'ping',
  'diagnostics': 'diagnostics',
  'test': 'test'
});
```

### 3. API Routes (Proxied to GAS)

| URL Pattern | Handler | Response |
|-------------|---------|----------|
| `POST /api/rpc` | `handleRpcRequest()` → GAS | JSON RPC response |
| `POST /api/<path>` | `handleApiRequest()` → GAS | JSON API response |
| `?action=*` | `proxyToAppsScript()` → GAS | JSON API response |

**Whitelisted API Actions (worker.js:137-164):**
```javascript
const CANONICAL_API_ACTIONS = [
  'api_status', 'api_statusPure', 'api_events', 'api_eventById', 'api_sponsors',
  'api_createEvent', 'api_updateEvent', 'api_deleteEvent', 'api_uploadImage',
  'api_displayData', 'api_nextEvent', 'api_posterData', 'api_reportData',
  'api_analytics', 'list', 'getPublicBundle', 'getSponsorReportQr',
  'getSharedAnalytics', 'getSharedReportBundle'
];
```

### 4. Shortlink Routes (Proxied to GAS)

| URL Pattern | Handler | Response |
|-------------|---------|----------|
| `?p=r&t=...` | `handleShortlinkRedirect()` | Redirect response |
| `?p=redirect&t=...` | `handleShortlinkRedirect()` | Redirect response |

**GAS_PROXY_ROUTES (worker.js:108-111):**
```javascript
const GAS_PROXY_ROUTES = Object.freeze({
  'r': 'redirect',
  'redirect': 'redirect'
});
```

### 5. Routes Handled Locally (NOT proxied)

| URL Pattern | Handler | Response |
|-------------|---------|----------|
| `/static/*` | `Response.redirect()` | 302 to `script.google.com/static/*` |
| `/wardeninit*`, `/warden*`, `/jserror*`, `/_/*` | Stub response | `)]}'` + `[]` (Google internal endpoints) |
| Unknown routes | `create404Response()` | Worker-generated 404 HTML |
| Unknown API actions | `create404Response()` | Worker-generated 404 JSON |

### 6. Brand-Prefixed Routes

| Pattern | Example | Resolved |
|---------|---------|----------|
| `/{brand}/{alias}` | `/abc/events` | brand=abc, template=public |
| `/{brand}/{alias}` | `/cbc/manage` | brand=cbc, template=admin |

**Valid Brands (worker.js:206):**
```javascript
const VALID_BRANDS = ['root', 'abc', 'cbc', 'cbl'];
```

---

## `/events` Route - New Behavior (Story 2)

### Worker Processing Flow

```
1. Request: GET https://eventangle.com/events
                    |
                    v
2. Worker receives request
   - URL parsed: pathname = '/events', search = ''
                    |
                    v
3. validateRoute() called
   - First segment: 'events'
   - isValidPathSegment('events') → true
   - Returns: { valid: true, isApiRequest: false }
                    |
                    v
4. extractRouteParams() called
   - page = 'events' → resolves to 'public' (via HTML_ROUTE_MAP)
   - brandId = 'root'
   - brandName = 'EventAngle'
   - scope = 'events'
                    |
                    v
5. handleHtmlPageRequest() called (NOT proxyPageRequest!)
   - Gets template 'public' from KV storage
   - Renders with variables (appTitle, brandId, scope, execUrl)
   - Returns HTML with Content-Type: text/html
                    |
                    v
6. Response: public.html rendered by Worker (NO GAS CALL)
```

### Key Difference from Story 1

| Aspect | Story 1 (Before) | Story 2 (After) |
|--------|------------------|-----------------|
| Handler | `proxyPageRequest()` | `handleHtmlPageRequest()` |
| Template Source | GAS `HtmlService` | Worker KV templates |
| GAS Call | YES - fetch(GAS_URL) | NO - local render |
| Network Latency | +200-500ms (GAS roundtrip) | Eliminated |

---

## Template Rendering System

### Template Bundling

Templates are pre-compiled from GAS source files at build time:

**Build Script:** `scripts/bundle-worker-templates.js`

```bash
# Bundle templates
npm run bundle:templates

# Check if templates are up-to-date
npm run bundle:templates:check
```

**Bundled Templates Location:** `cloudflare-proxy/templates/`

| Template | Source | Size |
|----------|--------|------|
| `public.html` | `src/mvp/Public.html` | ~175 KB |
| `admin.html` | `src/mvp/Admin.html` | ~296 KB |
| `display.html` | `src/mvp/Display.html` | ~164 KB |
| `poster.html` | `src/mvp/Poster.html` | ~139 KB |
| `report.html` | `src/mvp/SharedReport.html` | ~166 KB |

### Template Variables

Variables replaced at runtime by Worker:

| Variable | Source | Example |
|----------|--------|---------|
| `<?= appTitle ?>` | `brandName + ' · ' + scope` | "EventAngle · events" |
| `<?= brandId ?>` | URL path or query param | "root" |
| `<?= scope ?>` | URL path or brand config | "events" |
| `<?= execUrl ?>` | `env.GAS_DEPLOYMENT_BASE_URL` | GAS URL for API calls |
| `<?= demoMode ?>` | `?demo=true` query param | "true" or "false" |

### Template Loading (worker.js:260-279)

```javascript
async function getTemplate(templateName, env) {
  const templateFile = `${templateName}.html`;

  // Try KV storage first (for production deployments)
  if (env.TEMPLATES_KV) {
    const content = await env.TEMPLATES_KV.get(templateFile);
    if (content) return content;
  }

  // Fallback: Return null to trigger error page
  return null;
}
```

### Template Rendering (worker.js:222-248)

```javascript
function renderTemplate(templateContent, params, env) {
  const { brandId, brandName, scope, demoMode } = params;

  // Get exec URL from environment (for API calls)
  const execUrl = env.GAS_DEPLOYMENT_BASE_URL || DEFAULT_GAS_URL;

  // Build app title
  const appTitle = `${brandName} · ${scope}`;

  // Replace template variables
  let html = templateContent;
  html = html.replace(/<\?=\s*appTitle\s*\?>/g, escapeHtml(appTitle));
  html = html.replace(/<\?=\s*brandId\s*\?>/g, escapeHtml(brandId));
  html = html.replace(/<\?=\s*scope\s*\?>/g, escapeHtml(scope));
  html = html.replace(/<\?=\s*execUrl\s*\?>/g, escapeHtml(execUrl));
  html = html.replace(/<\?=\s*demoMode\s*\?>/g, demoMode ? 'true' : 'false');

  return html;
}
```

---

## Routes That Touch GAS

### Explicit List (Story 2 Acceptance Criteria)

| Route Type | Route Pattern | Handler | Touches GAS |
|------------|---------------|---------|-------------|
| HTML Page | `/events`, `/admin`, etc. | `handleHtmlPageRequest()` | **NO** |
| JSON Page | `/status`, `/ping` | `handleJsonPageRequest()` | YES |
| API RPC | `POST /api/*` | `handleApiRequest()` | YES |
| Shortlink | `?p=r&t=...` | `handleShortlinkRedirect()` | YES |
| Static | `/static/*` | `Response.redirect()` | NO (CDN redirect) |
| 404 | Unknown routes | `create404Response()` | NO (Worker-generated) |

### GAS No Longer Receives

- Raw HTML page loads from `/events`
- Raw HTML page loads from `/admin`
- Raw HTML page loads from `/display`
- Raw HTML page loads from `/poster`
- Raw HTML page loads from `/analytics`

---

## Deprecated Functions

### proxyPageRequest_DEPRECATED

The function `proxyPageRequest()` has been renamed to `proxyPageRequest_DEPRECATED()` and is no longer used in the main routing logic.

**Migration Path:**
- HTML pages → `handleHtmlPageRequest()` (renders from Worker templates)
- JSON pages → `handleJsonPageRequest()` (proxies to GAS for data)
- Shortlinks → `handleShortlinkRedirect()` (proxies to GAS for redirect resolution)
- API calls → `proxyToAppsScript()` (unchanged)

---

## Configuration Reference

### Environment Variables (wrangler.toml)

| Variable | Purpose |
|----------|---------|
| `GAS_DEPLOYMENT_BASE_URL` | Full GAS exec URL (for API calls) |
| `DEPLOYMENT_ID` | GAS deployment ID (fallback) |
| `UPSTREAM_TIMEOUT_MS` | Timeout for GAS requests (default: 30000ms) |
| `ERROR_LOG_ENDPOINT` | External error logging URL (optional) |
| `TEMPLATES_KV` | KV binding for template storage |

### Deployment Environments

| Environment | Domain | Config |
|-------------|--------|--------|
| Production | `eventangle.com/*` | `[env.production]` |
| Staging | `stg.eventangle.com/*` | `[env.staging]` |
| API-only | `api.eventangle.com/*` | `[env.api-only]` |
| Development | `*.workers.dev` | Default |

---

## Testing

### Unit Tests

```bash
# Run Worker routing tests
npm run test:unit -- tests/unit/worker-routing.test.js
```

**Test Coverage:**
- Route validation logic
- HTML_ROUTE_MAP configuration
- JSON_ROUTE_MAP configuration
- GAS_PROXY_ROUTES configuration
- handleHtmlPageRequest() function
- renderTemplate() function
- extractRouteParams() function
- Route handling logic
- GAS isolation guarantee
- Template bundle validation

### Template Bundle Tests

Tests verify:
- Templates directory exists
- manifest.json is valid
- All required templates exist
- Templates have GAS variable placeholders
- Includes are resolved (no `<?!= include()` remaining)
- Bundle metadata is present

---

## Summary

1. **Worker Role:** Explicit routing with template rendering for HTML pages
2. **Template Loading:** Worker KV storage with pre-bundled templates
3. **`/events` Path:** Rendered by Worker (NOT proxied to GAS)
4. **Fallback Behavior:** Unknown routes return Worker-generated 404
5. **GAS Access:** Only via `/api/*`, `/status`, `/ping`, and shortlinks
6. **HTML pages are served by Worker** - GAS only receives JSON API calls
