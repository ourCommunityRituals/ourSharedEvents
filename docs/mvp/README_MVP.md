# MVP Contract v1.0

> **Status**: LOCKED for Focus Group Testing
> **Schema Lock Date**: 2025-11-30
> **Ground Truth**: v4.1.1/4.1.2 "Control-Strict + Eventbooks"

---

## The MVP Statement

**"These 5 surfaces and these 8 core endpoints are the product. Everything else is internal ops or v2."**

---

## MVP Surfaces (5 Total)

| # | Surface | File | Route | Purpose |
|---|---------|------|-------|---------|
| 1 | **Admin** | `Admin.html` | `?page=admin` | Event management - create/edit events via templates |
| 2 | **Public** | `Public.html` | `?page=public` | Mobile-first public event page with QR code |
| 3 | **Display** | `Display.html` | `?page=display` | TV/kiosk live event display |
| 4 | **Poster** | `Poster.html` | `?page=poster` | Printable poster with QR code |
| 5 | **SharedReport** | `SharedReport.html` | `?page=report` | Analytics dashboard (impressions, clicks, CTR) |

### Surface URLs

```
# Direct access
?page=admin
?page=public        (default)
?page=display
?page=poster
?page=report

# Friendly aliases (via Cloudflare proxy)
/events, /schedule, /calendar  → public
/manage, /admin, /dashboard    → admin
/display, /tv, /kiosk          → display
/posters, /poster              → poster
/analytics, /reports           → report
```

---

## MVP Core Endpoints (8)

These are the canonical APIs that surfaces depend on:

| Endpoint | Method | Auth | Used By | Purpose |
|----------|--------|------|---------|---------|
| `api_getEventTemplates` | GET | No | Admin | List available event templates |
| `api_saveEvent` | POST | Yes | Admin | Create or update event (CANONICAL write) |
| `api_get` | GET | No | Admin | Get single event by ID |
| `api_list` | GET | No | Admin | List all events |
| `api_getPublicBundle` | GET | No | Public | Event data for public page |
| `api_getDisplayBundle` | GET | No | Display | Event data for TV/kiosk |
| `api_getPosterBundle` | GET | No | Poster | Event data for print poster |
| `api_getSharedAnalytics` | GET | No | SharedReport | Analytics summary data |

### Request/Response Shapes

#### `api_getEventTemplates`
```
GET ?action=getEventTemplates&brand=root

Response:
{ ok: true, value: { templates: [{ id, label, icon, description, sections }] } }
```

#### `api_saveEvent` (CANONICAL - ZEVENT-003)
```
POST { action: "saveEvent", brandId, event: {...}, templateId?, csrfToken }

Response:
{ ok: true, etag: "...", value: { id, slug, name, startDateISO, venue, links, qr, ... } }
```

#### `api_get`
```
GET ?action=get&id=EVENT_ID&brand=root

Response:
{ ok: true, value: { id, slug, name, startDateISO, venue, links, qr, settings, ... } }
```

#### `api_list`
```
GET ?action=list&brand=root

Response:
{ ok: true, value: { events: [{ id, slug, name, startDateISO, venue }], count: N } }
```

#### `api_getPublicBundle`
```
GET ?action=getPublicBundle&id=EVENT_ID&brand=root

Response:
{ ok: true, value: { event: {...}, sponsors: [...], settings: {...} } }
```

#### `api_getDisplayBundle`
```
GET ?action=getDisplayBundle&id=EVENT_ID&brand=root

Response:
{ ok: true, value: { event: {...}, sponsors: [...], rotation: {...} } }
```

#### `api_getPosterBundle`
```
GET ?action=getPosterBundle&id=EVENT_ID&brand=root

Response:
{ ok: true, value: { event: {...}, qrCodes: {...}, sponsors: [...] } }
```

#### `api_getSharedAnalytics`
```
GET ?action=getSharedReportBundle&id=EVENT_ID&brand=root

Response:
{ ok: true, value: { summary: { totalImpressions, totalClicks, ctr }, surfaces: [...], sponsors: [...] } }
```

---

## MVP Supporting Endpoints

These support MVP operation but aren't core surface APIs:

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `api_status` | System health | Returns system status |
| `api_statusMvp` | MVP health check | Extended health with analytics |
| `api_generateToken` | Auth token | JWT generation for API access |
| `api_getAdminBundle` | Admin data | Optimized bundle for Admin.html |
| `api_logEvents` | Analytics logging | Fire-and-forget impression/click tracking |
| `api_trackEventMetric` | Simple tracking | Track view/impression/click/scan |
| `api_createFormFromTemplate` | Form creation | Create Google Form for signups |
| `api_generateFormShortlink` | Form shortlink | Generate trackable form URL |
| `api_createShortlink` | URL shortening | Generate trackable shortlinks |

---

## Event Data Contract

### Core Fields (MVP Required)

```typescript
interface Event {
  // Identity
  id: string;           // UUID v4
  slug: string;         // URL-safe identifier
  name: string;         // Event name
  startDateISO: string; // ISO 8601 date
  venue: string;        // Venue name/address
  templateId?: string;  // Template used to create

  // Auto-generated links (read-only)
  links: {
    publicUrl: string;
    displayUrl: string;
    posterUrl: string;
    signupUrl: string;
  };

  // Auto-generated QR codes (read-only)
  qr: {
    public: string;     // Data URI for public QR
    signup: string;     // Data URI for signup QR
  };

  // Primary CTA
  ctas: {
    primary: { label: string; url: string; }
  };

  // Display toggles
  settings: {
    showSchedule: boolean;
    showStandings: boolean;
    showBracket: boolean;
    showSponsors?: boolean;
    showVideo?: boolean;
    showMap?: boolean;
  };

  // Metadata
  createdAtISO: string;
  updatedAtISO: string;
}
```

### One QR Per Event Rule

- Each event has exactly ONE public QR code: `event.qr.public`
- This QR points to the Public surface: `?page=public&id=EVENT_ID`
- Poster displays this QR for attendees to scan
- All impressions/clicks tracked via this single entry point

### One Eventbook Per Event Rule

- Each event is a single row in the EVENTS sheet
- Event data stored as JSON in `dataJSON` column
- No multi-event bundles or eventbook groupings in MVP
- Brand hierarchy (parent/child) is V2+

---

## What Is NOT MVP

### V2+ Surfaces (Blocked)
- `Sponsor.html` - Sponsor self-service portal
- `ApiDocs.html` - Interactive API docs
- `Diagnostics.html` - System diagnostics
- `PortfolioDashboard.html` - Multi-brand portfolio

### V2+ Endpoints (Feature-Flagged OFF)
- `api_getPortfolioSponsorReport` - Portfolio analytics
- `api_getPortfolioSummary` - Portfolio metrics
- `api_listTemplatesV2` - Custom template CRUD
- All webhook endpoints (`WebhookService.gs` archived)
- All i18n endpoints (`i18nService.gs` archived)

### Legacy Endpoints (Deprecated)
- `api_create` - Use `api_saveEvent` instead
- `api_updateEventData` - Use `api_saveEvent` instead

### Files in src/mvp/ That Are V2 (Feature-Flagged)
- `TemplateManagementService.gs` - Gated by `TEMPLATE_MANAGEMENT_V2=false`

---

## Response Envelope Format

All MVP endpoints return this envelope:

### Success
```json
{ "ok": true, "value": { ... }, "etag": "optional" }
```

### Error
```json
{ "ok": false, "code": "ERR_CODE", "message": "Human readable", "corrId": "trace-id" }
```

### Error Codes
| Code | Meaning |
|------|---------|
| `BAD_INPUT` | Invalid request parameters |
| `NOT_FOUND` | Resource doesn't exist |
| `AUTH` | Authentication failed |
| `FORBIDDEN` | Not authorized for this action |
| `INTERNAL` | Server error |
| `CONFLICT` | Resource already exists |

---

## File Organization

```
src/
├── mvp/                    # DEPLOYED (clasp push)
│   ├── Code.gs             # Router + API endpoints
│   ├── Config.gs           # Brands, feature flags
│   ├── EventService.gs     # Event CRUD
│   ├── TemplateService.gs  # Event templates
│   ├── SponsorService.gs   # Sponsor management
│   ├── FormService.gs      # Google Forms
│   ├── SharedReporting.gs  # Analytics views
│   ├── AnalyticsService.gs # Logging/metrics
│   ├── SecurityMiddleware.gs
│   ├── ApiSchemas.gs       # Validation
│   ├── Admin.html          # Surface
│   ├── Public.html         # Surface
│   ├── Display.html        # Surface
│   ├── Poster.html         # Surface
│   ├── SharedReport.html   # Surface
│   └── *.html              # Infrastructure (Styles, NUSDK, etc.)
├── v2/                     # NOT DEPLOYED (future)
│   └── PortfolioDashboard.html
└── archive/                # HISTORICAL (reference only)
    ├── experimental-frontends/
    ├── analysis-reports/
    └── v2-docs/
```

---

## Quick Reference

```
MVP = 5 Surfaces + 8 Core Endpoints

Surfaces:
  Admin.html      → ?page=admin
  Public.html     → ?page=public
  Display.html    → ?page=display
  Poster.html     → ?page=poster
  SharedReport.html → ?page=report

Core APIs:
  api_getEventTemplates
  api_saveEvent          (CANONICAL write)
  api_get
  api_list
  api_getPublicBundle
  api_getDisplayBundle
  api_getPosterBundle
  api_getSharedAnalytics

One QR per event → Public page
One eventbook per event → Single EVENTS row
```

---

## Change Policy

1. **MVP surfaces and endpoints**: Cannot remove or change contracts without migration
2. **V2+ features**: Gated by feature flags, do not depend on in MVP
3. **Legacy endpoints**: Deprecated, will be removed in v2
4. **New surfaces**: Go to `src/v2/` by default until promoted

---

*MVP Contract v1.0 - Week 1 Baseline Lock*
