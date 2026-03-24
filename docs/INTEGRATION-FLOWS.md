# Integration Flows

**Last Updated:** 2025-11-23
**Status:** MVP v1.0 - Focus Group Ready
**Story:** ZEVENT-004

---

## Overview

This document captures the wiring diagram between Admin surfaces, backend APIs (Code.gs), and output surfaces (Public/Display/Poster/Analytics). Use this as a reference when tracing data flow or debugging integration issues.

### Quick Reference Diagram

```
Admin
  └── api_create/api_updateEventData ──► Code.gs (saveEvent_/_buildEventContract_)
                                           ├── EVENTS sheet
                                           └── Bundles → Public/Display/Poster

Public
  ├── api_list ──────────────────────► Code.gs (getEventsByBrand_)
  ├── api_getPublicBundle ───────────► Code.gs (event + brand config)
  └── api_logExternalClick ──────────► AnalyticsService (ANALYTICS sheet)
      SponsorUtils.logEvent ─────────► api_logEvents (batched)

Display
  └── api_getDisplayBundle ──────────► Code.gs (event + rotation/layout)
      SponsorUtils.logEvent ─────────► api_logEvents (view/impression/click)

Poster
  └── api_getPosterBundle ───────────► Code.gs (event + QR codes + print)
      SponsorUtils.logEvent ─────────► api_logEvents (view/impression/print)

Analytics
  └── api_logEvents ─────────────────► AnalyticsService (aggregation)
                                           ├── bySurface
                                           ├── bySponsor
                                           ├── byToken
                                           └── timeline
```

---

## Flow: Admin → Code.gs

The Admin surface (`Admin.html`) communicates with backend APIs in `Code.gs` via the NUSDK RPC client. All requests use the standard envelope pattern.

### APIs Used

| API | Purpose | Line |
|-----|---------|------|
| `api_getEventTemplates` | Fetch available templates for brand | Code.gs:1347 |
| `api_create` | Create new event | Code.gs:3816 |
| `api_get` | Retrieve single event | Code.gs:3053 |
| `api_updateEventData` | Update existing event | Code.gs:3869 |
| `api_createFormFromTemplate` | Generate Google Form from template | Code.gs:4766 |
| `api_generateFormShortlink` | Create trackable shortlink for form | Code.gs:4863 |

---

### api_getEventTemplates

**Purpose:** Retrieve available event templates for a brand.

**Payload:**
```javascript
{
  brandId: string,      // Optional - defaults from context
  ctx: { brandId }      // Alternative context parameter
}
```

**Response:**
```javascript
{
  ok: true,
  value: {
    items: [{
      id: string,           // 'bar_night', 'rec_league', 'school', 'fundraiser', 'custom'
      label: string,        // Human-readable label
      description: string,  // Template description
      icon: string,         // Emoji icon
      sections: { video, map, schedule, sponsors, notes, gallery },
      defaultCtas: string[],
      defaults: { audience, notesLabel, sponsorStripLabel }
    }],
    defaultTemplateId: string
  }
}
```

**Helpers:** `getBrandTemplateConfig_()`, `getTemplatesForBrand_()`

---

### api_create

**Purpose:** Create a new event (normalized to canonical Event structure).

**Payload:**
```javascript
{
  brandId: string,           // Required
  adminKey: string,          // Required - auth
  scope: string,             // 'events' | 'leagues' | 'tournaments' (default: 'events')
  templateId: string,        // Default: 'custom'
  idemKey: string,           // Idempotency key (optional)
  data: {
    name: string,            // REQUIRED (1-200 chars)
    startDateISO: string,    // REQUIRED (YYYY-MM-DD)
    venue: string,           // REQUIRED (1-200 chars)
    signupUrl: string,
    ctas: { primary: { label, url }, secondary: { label, url } },
    settings: { showSchedule, showStandings, showBracket, showSponsors },
    schedule: ScheduleRow[],
    sponsors: Sponsor[],
    media: { videoUrl, mapUrl, gallery }
  }
}
```

**Response:**
```javascript
{
  ok: true,
  etag: string,
  value: {
    id: string,              // UUID v4 (auto-generated)
    slug: string,            // URL slug (auto-generated from name)
    name: string,
    startDateISO: string,
    venue: string,
    links: { publicUrl, displayUrl, posterUrl, signupUrl, sharedReportUrl },
    qr: { public, signup },  // base64 PNG data URIs
    ctas: { primary, secondary },
    // ... full canonical Event per EVENT_CONTRACT.md v2.0
    createdAtISO: string,
    updatedAtISO: string
  }
}
```

**Helpers:** `gate_()`, `normalizeCreatePayloadToEvent_()`, `saveEvent_()`

---

### api_get

**Purpose:** Retrieve a single event by ID with full hydration.

**Payload:**
```javascript
{
  brandId: string,        // Required
  scope: string,          // 'events' | 'leagues' | 'tournaments'
  id: string,             // Event ID (required)
  ifNoneMatch: string     // ETag for caching (optional)
}
```

**Response:**
```javascript
{
  ok: true,
  etag: string,           // MD5 hash for caching
  notModified: boolean,   // true if ifNoneMatch matches (304 cache hit)
  value: {
    id: string,
    slug: string,
    name: string,
    startDateISO: string,
    venue: string,
    links: { publicUrl, displayUrl, posterUrl, signupUrl, sharedReportUrl },
    qr: { public, signup },
    schedule: ScheduleRow[] | null,
    standings: StandingRow[] | null,
    bracket: BracketTree | null,
    ctas: { primary, secondary },
    sponsors: Sponsor[],
    media: { videoUrl, mapUrl, gallery },
    externalData: { scheduleUrl, standingsUrl, bracketUrl },
    analytics: { enabled: boolean },
    payments: { enabled, provider, price, currency, checkoutUrl },
    settings: { showSchedule, showStandings, showBracket, showSponsors },
    createdAtISO: string,
    updatedAtISO: string
  }
}
```

**Helpers:** `getEventById_()`, `_buildEventContract_()`, `validateEventContract_()`

---

### api_updateEventData

**Purpose:** Update an existing event using Load-Merge-Save pattern.

**Payload:**
```javascript
{
  brandId: string,        // Required
  adminKey: string,       // Required - auth
  scope: string,          // 'events' | 'leagues' | 'tournaments'
  id: string,             // Event ID (required)
  data: {
    // Partial update - only include fields to change
    name: string,
    startDateISO: string,
    venue: string,
    ctas: { primary, secondary },
    settings: { ... },
    schedule: ScheduleRow[],
    sponsors: Sponsor[],
    media: { videoUrl, mapUrl, gallery }
  }
}
```

**Response:**
```javascript
{
  ok: true,
  etag: string,
  value: {
    // Full canonical Event with updates applied
    id: string,           // Immutable
    slug: string,         // Immutable
    name: string,
    // ... all fields from Event contract
    updatedAtISO: string  // Updated timestamp
  }
}
```

**Helpers:** `gate_()`, `getEventById_()`, `mergeEventUpdate_()`, `saveEvent_()`

---

### api_createFormFromTemplate

**Purpose:** Create a Google Form from a predefined template and link to an event.

**Payload:**
```javascript
{
  templateType: string,    // Required: 'sign-up', 'check-in', 'walk-in', 'survey'
  eventName: string,       // Event name for form title (optional)
  eventId: string,         // Event ID to associate (optional)
  adminKey: string,        // Required - auth
  brandId: string          // Default: 'root'
}
```

**Response:**
```javascript
{
  ok: true,
  value: {
    formId: string,           // Google Form ID
    editUrl: string,          // URL to edit form
    publishedUrl: string,     // Public form URL
    responseSheetUrl: string, // Google Sheet for responses
    templateType: string,     // Template used
    eventId: string           // Associated event ID
  }
}
```

**Form Templates:**

| Template | Description | Key Questions |
|----------|-------------|---------------|
| `sign-up` | Pre-registration | Name, Email, Phone, Attendees, Dietary, Source |
| `check-in` | Day-of check-in | Name, Email, Confirmation#, Party Size |
| `walk-in` | Walk-in registration | Name, Email, Phone, Party Size, Source |
| `survey` | Post-event feedback | Rating (1-5), Enjoyed, Improve, Recommend (NPS) |

**Helpers:** `gate_()`, `findFormTemplate_()`, `FormApp.create()`

---

### api_generateFormShortlink

**Purpose:** Generate a trackable shortlink for a form URL.

**Payload:**
```javascript
{
  formUrl: string,        // Required - full form URL (validated)
  formType: string,       // Form type label (optional)
  eventId: string,        // Event ID to associate (optional)
  adminKey: string,       // Required - auth
  brandId: string         // Default: 'root'
}
```

**Response:**
```javascript
{
  ok: true,
  value: {
    token: string,        // UUID shortlink token
    shortlink: string,    // Full shortlink URL (?p=r&t=<token>)
    targetUrl: string     // Original form URL
  }
}
```

**Helpers:** `isUrl()`, `api_createShortlink()`

---

## Flow: Public → Code.gs

The Public surface (`Public.html`) reads event data and logs analytics via these APIs.

### APIs Used

| API | Purpose | Line |
|-----|---------|------|
| `api_list` | Paginated event listing | Code.gs:3026 |
| `api_getPublicBundle` | Single event + brand config | Code.gs:3080 |
| `api_logExternalClick` | Track external link clicks | Code.gs:4112 |

---

### api_list

**Purpose:** Paginated list of events for the public list view.

**Payload:**
```javascript
{
  brandId: string,        // Required
  scope: string,          // 'events' | 'leagues' | 'tournaments' (default: 'events')
  limit: number,          // Max results, capped at 1000 (optional)
  offset: number,         // Pagination offset (optional)
  ifNoneMatch: string     // ETag for caching (optional)
}
```

**Response:**
```javascript
{
  ok: true,
  etag: string,
  value: {
    items: [Event],       // Array of canonical Event objects
    pagination: {
      total: number,
      limit: number,
      offset: number,
      hasMore: boolean
    }
  }
}
```

**Helpers:** `getEventsByBrand_()`, `_buildEventContract_()`, `validateEventContract_()`

---

### api_getPublicBundle

**Purpose:** Single event with brand config for detail view (Public, Display, Poster surfaces).

**Payload:**
```javascript
{
  brandId: string,        // Required
  scope: string,          // 'events' | 'leagues' | 'tournaments' (default: 'events')
  id: string,             // Event ID (required)
  ifNoneMatch: string     // ETag for caching (optional)
}
```

**Response:**
```javascript
{
  ok: true,
  etag: string,
  value: {
    event: Event,         // Full canonical Event object
    config: {
      appTitle: string,   // Brand's app title
      brandId: string,
      brandName: string
    }
  }
}
```

**Helpers:** `getEventById_()`, `findBrand_()`, `validateEventContract_()`

---

### api_logExternalClick

**Purpose:** Track clicks on external links (schedule, standings, bracket, stream URLs).

**Payload:**
```javascript
{
  eventId: string,              // Required
  linkType: string,             // 'schedule' | 'standings' | 'bracket' | 'stats' | 'scoreboard' | 'stream'
  surface: string,              // Surface name (default: 'public')
  sessionId: string,            // Session ID for attribution (optional)
  visibleSponsorIds: string[]   // Sponsor IDs visible on page (optional, max 20)
}
```

**Response:**
```javascript
{
  ok: true,
  value: { logged: true }
}
```

**Helpers:** `_ensureAnalyticsSheet_()`, `sanitizeSpreadsheetValue_()`

---

### Sponsor Impression Logging

Client-side analytics for sponsor impressions and clicks use `SponsorUtils.logEvent()` (defined in `SponsorUtils.html:65`).

**Usage:**
```javascript
// Log sponsor impression
SponsorUtils.logEvent({
  eventId: string,
  surface: 'public' | 'display' | 'poster',
  metric: 'impression',
  sponsorId: string
});

// Log sponsor click
SponsorUtils.logEvent({
  eventId: string,
  surface: 'public',
  metric: 'click',
  sponsorId: string
});
```

**Batching:** Events batch (size: 5) and flush every 5 seconds or on page unload. Sends to `api_logEvents()` backend.

**Auto-populated fields:** `sessionId`, `ua` (user agent), `ts` (timestamp).

---

## Flow: Display → Code.gs

The Display surface (`Display.html`) fetches TV/kiosk-optimized bundles and logs view metrics.

### APIs Used

| API | Purpose | Line |
|-----|---------|------|
| `api_getDisplayBundle` | Event + rotation/layout config | Code.gs:3303 |

---

### api_getDisplayBundle

**Purpose:** Single event with TV/kiosk display configuration (sponsor rotation, layout emphasis).

**Payload:**
```javascript
{
  brandId: string,        // Required
  scope: string,          // 'events' | 'leagues' | 'tournaments' (default: 'events')
  id: string,             // Event ID (required)
  ifNoneMatch: string     // ETag for caching (optional)
}
```

**Response:**
```javascript
{
  ok: true,
  etag: string,
  value: {
    event: Event,         // Full canonical Event object
    rotation: {
      sponsorSlots: number,   // Number of sponsor slots to display
      rotationMs: number      // Rotation interval in milliseconds
    },
    layout: {
      hasSidePane: boolean,   // Whether to show side pane
      emphasis: string        // Layout emphasis mode
    }
  }
}
```

**Helpers:** `getEventById_()`, `getDisplayConfig_()`

---

### Analytics Logging

Display surface logs metrics via `SponsorUtils.logEvent()`:

```javascript
// Log display page view (on bundle load)
logEvent({ eventId: ev.id, surface: 'display', metric: 'view', value: 1 });

// Log sponsor impressions (when rendered)
sponsors.forEach(s => logEvent({
  eventId, surface: 'display', metric: 'impression', sponsorId: s.id
}));

// Log sponsor clicks
logEvent({ eventId, surface: 'display', metric: 'click', sponsorId: id });
```

---

## Flow: Poster → Code.gs

The Poster surface (`Poster.html`) fetches print-optimized bundles with QR codes.

### APIs Used

| API | Purpose | Line |
|-----|---------|------|
| `api_getPosterBundle` | Event + QR codes + print strings | Code.gs:3396 |

---

### api_getPosterBundle

**Purpose:** Single event with print-optimized QR codes and formatted strings.

**Payload:**
```javascript
{
  brandId: string,        // Required
  scope: string,          // 'events' | 'leagues' | 'tournaments' (default: 'events')
  id: string,             // Event ID (required)
  ifNoneMatch: string     // ETag for caching (optional)
}
```

**Response:**
```javascript
{
  ok: true,
  etag: string,
  value: {
    event: Event,         // Full canonical Event object
    qrCodes: {
      public: string,     // QR code URL for public page (quickchart.io)
      signup: string      // QR code URL for signup page
    },
    print: {
      dateFormatted: string,   // Human-readable date
      venueFormatted: string   // Formatted venue string
    }
  }
}
```

**Helpers:** `getEventById_()`, `generateQRCodes_()`, `generatePrintStrings_()`

---

### Analytics Logging

Poster surface logs metrics via `SponsorUtils.logEvent()`:

```javascript
// Log poster page view (on bundle load)
logEvent({ eventId: event.id, surface: 'poster', metric: 'view', value: 1 });

// Log sponsor impressions (when rendered)
sponsors.forEach(s => logEvent({
  eventId, surface: 'poster', metric: 'impression', sponsorId: s.id
}));

// Log print action (via beforeprint event)
window.addEventListener('beforeprint', () => {
  logEvent({ eventId: event.id, surface: 'poster', metric: 'print', value: 1 });
});
```

---

## Flow: Analytics

All surfaces log metrics to `AnalyticsService.gs` for aggregation and reporting.

### APIs Used

| API | Purpose | Line |
|-----|---------|------|
| `api_logEvents` | Batch write analytics events | Code.gs:3987 |
| `api_logExternalClick` | Track external link clicks | Code.gs:4112 |

---

### api_logEvents

**Purpose:** Batch write analytics events to ANALYTICS sheet.

**Payload:**
```javascript
{
  items: [{
    eventId: string,        // Event ID
    surface: string,        // 'public' | 'display' | 'poster' | 'sponsor'
    metric: string,         // 'view' | 'impression' | 'click' | 'print' | 'dwellSec'
    sponsorId: string,      // Sponsor ID (for sponsor metrics)
    value: number,          // Metric value (default: 0)
    ts: number,             // Timestamp (default: now)
    ua: string,             // User agent (truncated to 200 chars)
    sessionId: string,      // Session ID for attribution
    token: string           // Tracking token (optional)
  }]
}
```

**Response:**
```javascript
{
  ok: true,
  value: { count: number }  // Number of events logged
}
```

**Storage format (10 columns):**
```
timestamp | eventId | surface | metric | sponsorId | value | token | ua | sessionId | visibleSponsorIds
```

---

### Aggregation (AnalyticsService.gs)

`AnalyticsService_aggregateEventData()` groups metrics by:

| Dimension | Description |
|-----------|-------------|
| `bySurface` | Metrics per surface (public, display, poster) |
| `bySponsor` | Metrics per sponsor ID |
| `byToken` | Metrics per tracking token |
| `timeline` | Daily breakdown (date → metrics) |

**Aggregated metrics per dimension:**
```javascript
{
  impressions: number,
  clicks: number,
  dwellSec: number,
  ctr: number              // Click-through rate (clicks/impressions * 100)
}
```

**Report API:** `AnalyticsService_getEventReport({ eventId, brandId, dateFrom, dateTo })`

---

## Flow: Code.gs → Public/Display/Poster

Output surfaces consume event data via `api_get` or `api_list`:

```
┌─────────────────────────────────────────────────────────────────┐
│  Admin.html                                                      │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ api_create / api_updateEventData                            │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
└─────────────────────────────┼───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Code.gs                                                         │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────────┐│
│  │ saveEvent_  │ → │ EVENTS      │ ← │ getEventById_ /         ││
│  │             │   │ Sheet       │   │ _buildEventContract_    ││
│  └─────────────┘   └─────────────┘   └─────────────────────────┘│
└─────────────────────────────┬───────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Public.html    │  │  Display.html   │  │  Poster.html    │
│  ───────────────│  │  ───────────────│  │  ───────────────│
│  Mobile-first   │  │  TV/Kiosk mode  │  │  Print/QR view  │
│  event page     │  │  auto-rotate    │  │  sponsor strip  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Flow: Analytics Tracking

All surfaces log metrics to `AnalyticsService.gs`:

```
User Action → Surface → api_logMetric → ANALYTICS Sheet
                │
                ├── surface: 'public' | 'display' | 'poster' | 'sponsor'
                ├── metric: 'view' | 'click' | 'cta_click' | 'sponsor_click'
                ├── eventId: string
                ├── sponsorId: string (if applicable)
                └── sessionId: string (anonymous tracking)
```

**Analytics consumption:** `SharedReport.html` uses `api_getAnalyticsSummary` to aggregate metrics.

---

## Authentication & Error Handling

### Authentication

All write operations require `adminKey` validated via `gate_()`:
- Rate limited: 10 req/min per brand/IP
- Lockout: 15 minutes after 5 failed attempts

### Response Envelope

```javascript
// Success
{ ok: true, value: { ... }, etag: string }

// Error
{ ok: false, code: 'BAD_INPUT' | 'NOT_FOUND' | 'RATE_LIMITED' | 'INTERNAL', message: string }
```

---

## Related Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - System architecture overview
- **[MVP_SURFACES.md](./MVP_SURFACES.md)** - Frontend surfaces detail
- **[EVENT_CONTRACT.md](../src/mvp/EVENT_CONTRACT.md)** - Canonical Event schema

---

*Integration Flows - ZEVENT-004*
