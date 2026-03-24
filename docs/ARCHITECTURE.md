# MVP Architecture

**Last Updated:** 2025-12-13
**Status:** v2.0 - Worker-Only Architecture (GAS Retired)
**Story:** 5.3 - Decommission Apps Script Project

---

## Architecture Overview

The MVP Event Toolkit has been migrated from Google Apps Script to a **Cloudflare Worker-only architecture**. All API traffic now flows through the Cloudflare Worker which connects directly to Google Sheets via the Sheets API.

```
Clients (Admin, Public, Display, Poster, SharedReport)
    │
    ▼
Cloudflare Worker (edge)
    ├── /api/v2/status      → Worker health check
    ├── /api/v2/events      → List events from Sheets
    ├── /api/v2/events/:id  → Get single event
    ├── /api/v2/events/:id/bundle/:type → Bundles
    ├── /admin, /public, /display, /poster → HTML templates
    │
    ▼
Google Sheets API (via service account)
    ├── EVENTS sheet        → Event data
    ├── ANALYTICS sheet     → Event tracking log
    ├── CONFIG sheet        → Brand configuration
    └── SHORTLINKS sheet    → URL shortening
```

**Key Benefits:**
- Sub-500ms latency (vs 2-3s with GAS)
- No Google Apps Script quotas
- Direct control over error handling and observability
- Simplified CI/CD via Wrangler

---

## Legacy GAS Backend (Archived)

> **Note:** The Google Apps Script backend has been archived as of 2025-12-13.
> See `archive/gas/README.md` for restoration instructions in emergency scenarios.

The legacy backend code is preserved in `archive/gas/` and includes:
- `Code.gs` - Router + API endpoints (doGet/doPost)
- `Config.gs` - Brands, environment, templates
- `TemplateService.gs` - Event templates
- `ApiSchemas.gs` - JSON Schema validation
- And 9 other service files

---

## Navigation & Integration Diagram

For a comprehensive visual representation of the integration flow, see:

**[NAVIGATION_DIAGRAM.txt](../NAVIGATION_DIAGRAM.txt)** - Master navigation diagram including:
- **Section 1**: Master Integration Diagram (Admin → Bundles → Surfaces → Analytics)
- **Section 2**: Analytics Logging Flow (CTA/scan logging endpoints)
- **Section 3**: SharedReport Analytics Consumption
- **Section 4**: MVP vs V2 Path Separation (clearly labeled)
- **Section 5-8**: Entry Points, Router Priority, User Journeys, File Structure

See also: [INTEGRATION-FLOWS.md](./INTEGRATION-FLOWS.md) for detailed API request/response schemas.

---

## Backend Services

### Cloudflare Worker (Primary)

The Worker is the sole backend, handling all API requests:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/v2/status` | GET | Health check |
| `/api/v2/events` | GET | List events |
| `/api/v2/events/:id` | GET | Get single event |
| `/api/v2/events/:id/bundle/public` | GET | Public bundle |
| `/api/v2/events/:id/bundle/display` | GET | Display bundle |
| `/api/v2/events/:id/bundle/poster` | GET | Poster bundle |
| `/api/v2/events` | POST | Create event (auth required) |
| `/api/v2/events/:id` | PUT | Update event (auth required) |

### Worker Source Files

Located in `cloudflare-proxy/`:

| File | Purpose |
|------|---------|
| `worker.js` | Main entry point and router |
| `src/api/events.js` | Events API handlers |
| `src/api/bundles.js` | Bundle API handlers |
| `src/api/status.js` | Health check handler |
| `src/sheets/client.js` | Google Sheets API client |
| `src/sheets/auth.js` | Service account JWT auth |
| `src/utils/qr.js` | QR code generation |
| `src/middleware/auth.js` | Admin auth middleware |
| `src/middleware/cors.js` | CORS handling |

---

## Frontend Surfaces (.html files)

These 5 files are the **only user-visible surfaces** for MVP:

| Surface | Purpose | Key Features |
|---------|---------|--------------|
| **Admin.html** | Event management control room | Template picker, section toggles, event lifecycle |
| **Public.html** | Mobile-first public event page | Map, Calendar, Share, Skeleton loaders, YouTube/Vimeo |
| **Display.html** | TV/kiosk display layout | Auto-rotate, iframe stage, fallback handling |
| **Poster.html** | Print/share with QR | QR grid, sponsor strip, print CSS |
| **SharedReport.html** | Analytics dashboard | 5-metric grid, data tables |

### Supporting HTML (included via templates)

| File | Purpose |
|------|---------|
| NUSDK.html | RPC client for API calls |
| Styles.html | CSS design system |
| DesignTokens.html | CSS variables (colors, spacing) |
| DesignAdapter.html | Brand theming |
| DemoMode.html | Demo/sandbox mode support |
| SponsorUtils.html | Shared sponsor rendering |
| Header.html | Page header component |
| HeaderInit.html | Header initialization |
| CollapsibleSections.html | Accordion UI component |
| SharedUtils.html | Utility functions |
| APIClient.html | API wrapper functions |

### Video Embedding

Both Public.html and Display.html support video embeds:

**Public.html** - Full YouTube/Vimeo handling:
```javascript
// YouTube URL validation and embed generation
const youtubeRegex = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11}).*$/;
const youtubeMatch = videoUrl.match(youtubeRegex);
if (youtubeMatch) {
  const videoId = youtubeMatch[3];
  embedUrl = `https://www.youtube.com/embed/${videoId}`;
}
```

**Display.html** - Generic iframe stage:
```html
<iframe id="stage"
  allow="autoplay; fullscreen"
  sandbox="allow-scripts allow-same-origin allow-popups allow-forms">
</iframe>
```

---

## Data Storage

### Google Sheets Structure

Each brand has a dedicated spreadsheet with these sheets:

| Sheet | Purpose | Auto-created |
|-------|---------|--------------|
| EVENTS | Event data storage | Yes |
| SPONSORS | Sponsor configurations | Yes |
| ANALYTICS | Usage metrics | Yes |
| DIAG | Diagnostic logs | Yes |

### Direct Sheets API Access

The Worker connects directly to Google Sheets using a service account:

```javascript
// Service account auth via JWT
const jwt = await createJWT(env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY);
const token = await getAccessToken(jwt);

// Direct Sheets API calls
const response = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/EVENTS`,
  { headers: { 'Authorization': `Bearer ${token}` } }
);
```

---

## API Design

### Envelope Pattern

All API responses use a consistent envelope:

```javascript
// Success
{ "ok": true, "value": { ... } }

// Error
{ "ok": false, "code": "ERROR_CODE", "message": "Human-readable message" }
```

### Authentication Methods

1. **Admin Token** (header) - For admin operations
   - Header: `Authorization: Bearer <ADMIN_TOKEN>`
2. **Service Account** - For Worker → Sheets access
   - JWT-based authentication

### CORS Configuration

CORS is handled at the Worker level:

```javascript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};
```

---

## Security Model

### Request Flow

```
Request → Cloudflare Worker
  ├─ CORS preflight handling
  ├─ Authentication check (admin routes)
  ├─ Input validation
  ├─ Route to handler
  └─ Google Sheets API call (if needed)
```

### Input Validation

All user input is validated before use:

```javascript
function validateEventData(data) {
  if (!data.name || typeof data.name !== 'string') {
    throw new Error('Event name is required');
  }
  // Additional validation...
}
```

---

## Templates

### Available Templates

The MVP includes 18 event templates:

| Category | Templates |
|----------|-----------|
| **Bar/Restaurant** | Happy Hour, Trivia Night, Live Music |
| **Recreation** | Tournament, League, Pickup Game |
| **School** | Sports Event, Fundraiser, Community Event |
| **Fundraiser** | Charity Event, Auction, Benefit |
| **Custom** | Generic Event, Custom Template |

---

## Development Workflow

### File Organization

```
MVP-EVENT-TOOLKIT/
├── cloudflare-proxy/   # Worker source code
│   ├── worker.js       # Main entry
│   ├── src/            # API handlers, utilities
│   ├── templates/      # HTML templates
│   └── wrangler.toml   # Cloudflare config
├── archive/
│   └── gas/            # Archived GAS backend
├── docs/               # Documentation
├── tests/              # Test suites
├── scripts/            # Build/deploy scripts
└── .github/            # CI/CD workflows
```

### Testing Strategy

| Level | Purpose | Location |
|-------|---------|----------|
| Unit | Service function testing | tests/unit/ |
| Contract | API schema validation | tests/contract/ |
| E2E | Full user flows | tests/e2e/ |
| Smoke | Critical path validation | tests/smoke/ |

---

## Quick Reference

### Key URLs

```
# Admin (event management)
https://stg.eventangle.com/admin?brand=root

# Public (event listing)
https://stg.eventangle.com/events?brand=root

# Display (TV/kiosk)
https://stg.eventangle.com/display?brand=root

# Poster (print view)
https://stg.eventangle.com/poster?brand=root&eventId=EVT_xxx

# Status (health check)
https://stg.eventangle.com/api/v2/status
```

### API Endpoints

```
GET  /api/v2/status              # Health check
GET  /api/v2/events              # List events
GET  /api/v2/events/:id          # Get event
GET  /api/v2/events/:id/bundle/public   # Public bundle
GET  /api/v2/events/:id/bundle/display  # Display bundle
GET  /api/v2/events/:id/bundle/poster   # Poster bundle
POST /api/v2/events              # Create event (auth required)
PUT  /api/v2/events/:id          # Update event (auth required)
```

---

## Related Documentation

- **[CLOUDFLARE_WORKER_MIGRATION.md](./CLOUDFLARE_WORKER_MIGRATION.md)** - Migration history
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Deployment and CI/CD
- **[FRIENDLY_URLS.md](./FRIENDLY_URLS.md)** - URL aliasing system
- **[archive/gas/README.md](../archive/gas/README.md)** - GAS restoration guide

---

*MVP Architecture v2.0 - Worker-Only (GAS Retired)*
