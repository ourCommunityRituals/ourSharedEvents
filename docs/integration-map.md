# Integration Map

> **Purpose**: A single wiring diagram for the MVP Event Toolkit system.
> **Audience**: Architects and developers who need to understand data flow without reading code.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              MVP EVENT TOOLKIT                                   │
│                                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐ │
│  │  Admin   │    │  Public  │    │ Display  │    │  Poster  │    │SharedReport│ │
│  │  .html   │    │  .html   │    │  .html   │    │  .html   │    │   .html   │ │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘    └─────┬─────┘ │
│       │               │               │               │                │        │
│       ▼               ▼               ▼               ▼                ▼        │
│    ┌──────┐        ┌──────┐        ┌──────┐        ┌──────┐        ┌──────┐    │
│    │NUSDK │        │NUSDK │        │NUSDK │        │NUSDK │        │NUSDK │    │
│    └──┬───┘        └──┬───┘        └──┬───┘        └──┬───┘        └──┬───┘    │
│       │               │               │               │                │        │
│       ▼               ▼               ▼               ▼                ▼        │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         Code.gs (Backend APIs)                          │   │
│  │  api_create, api_updateEventData, api_getPublicBundle, etc.             │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│       │                                                        │               │
│       ▼                                                        ▼               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   ┌─────────────────────┐   │
│  │   EVENTS    │  │  ANALYTICS  │  │ SHORTLINKS  │   │  Google Forms/Sheets │   │
│  │   Sheet     │  │   Sheet     │  │   Sheet     │   │                     │   │
│  └─────────────┘  └─────────────┘  └─────────────┘   └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Admin Flow

**Admin.html → NUSDK → Code.gs APIs → Sheets/Forms**

```
┌──────────────────┐
│    Admin.html    │
│  (Event Editor)  │
└────────┬─────────┘
         │
         │ NU.rpc('api_*', payload)
         ▼
┌──────────────────┐
│      NUSDK       │
│  (RPC Wrapper)   │
└────────┬─────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Code.gs APIs                             │
│                                                                 │
│  ┌─────────────────────┐    ┌─────────────────────┐            │
│  │ api_getEventTemplates│    │     api_create      │            │
│  │   Load templates     │    │   Create new event  │            │
│  └─────────────────────┘    └─────────────────────┘            │
│                                                                 │
│  ┌─────────────────────┐    ┌─────────────────────┐            │
│  │ api_updateEventData │    │     api_saveEvent   │            │
│  │   Update existing   │    │   Contract-first V2 │            │
│  └─────────────────────┘    └─────────────────────┘            │
│                                                                 │
│  ┌─────────────────────┐    ┌─────────────────────┐            │
│  │api_createFormFromTemplate│ │api_generateFormShortlink│       │
│  │  Create Google Form │    │ Generate trackable link │        │
│  └─────────────────────┘    └─────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐           ┌─────────────────────┐
│   EVENTS Sheet  │           │   Google Forms/     │
│  [id, brandId,  │           │   Sheets Service    │
│   templateId,   │           │  (FormApp, etc.)    │
│   dataJSON,     │           └─────────────────────┘
│   createdAt,    │
│   slug]         │
└─────────────────┘
```

### Admin API Request/Response Schemas

#### api_create

| Direction | Schema |
|-----------|--------|
| **Request** | `{ brandId, templateId, data, adminKey, idemKey? }` |
| **Response** | `{ ok, etag, value: Event }` |

**Request Fields:**
```typescript
{
  brandId: string      // Required - Brand identifier
  templateId: string   // Required - Template to use
  data: {
    name: string            // Required (1-200 chars)
    startDateISO: string    // Required (YYYY-MM-DD)
    venue: string           // Required (1-200 chars)
    ctas?: { primary: { label, url }, secondary? }
    settings?: { showSchedule, showStandings, showBracket, ... }
    schedule?: ScheduleRow[]
    standings?: StandingRow[]
    bracket?: BracketTree
  }
  adminKey: string     // Required - Authentication
  idemKey?: string     // Optional - Idempotency key
}
```

**Response (Event) Fields Added:**
- `id` - System-generated UUID
- `slug` - Generated from name
- `links.publicUrl, displayUrl, posterUrl` - Generated URLs
- `qr.public, qr.signup` - Generated base64 PNG QR codes
- `createdAtISO, updatedAtISO` - Timestamps

#### api_updateEventData

| Direction | Schema |
|-----------|--------|
| **Request** | `{ brandId, id, data, adminKey }` |
| **Response** | `{ ok, etag, value: Event }` |

**Key Behavior:** Load-merge-save pattern (existing + updates → saved)

#### api_createFormFromTemplate

| Direction | Schema |
|-----------|--------|
| **Request** | `{ templateType, eventName?, eventId?, adminKey, brandId? }` |
| **Response** | `{ ok, value: { formId, editUrl, publishedUrl, responseSheetUrl, templateType, eventId } }` |

**templateType Options:** `'check-in' | 'walk-in' | 'survey'`

#### api_generateFormShortlink

| Direction | Schema |
|-----------|--------|
| **Request** | `{ formUrl, eventId?, brandId?, adminKey }` |
| **Response** | `{ ok, value: { shortlink, originalUrl, eventId, token } }` |

---

## 2. Public Flow

**Public.html → api_getPublicBundle → Event slice + Config**

```
┌──────────────────┐
│   Public.html    │
│  (Public View)   │
└────────┬─────────┘
         │
         │ NU.rpc('api_getPublicBundle', { brandId, id })
         ▼
┌──────────────────┐
│      NUSDK       │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│            api_getPublicBundle                   │
│                                                  │
│  1. getEventById_(brandId, id, {hydrateSponsors})│
│  2. findBrand_(brandId)                          │
│  3. Build response envelope                      │
└──────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│                  Response                        │
│  {                                               │
│    ok: true,                                     │
│    etag: "md5-hash",                             │
│    value: {                                      │
│      event: Event,     // Full canonical event   │
│      config: {                                   │
│        appTitle: string,                         │
│        brandId: string,                          │
│        brandName: string                         │
│      }                                           │
│    }                                             │
│  }                                               │
└──────────────────────────────────────────────────┘
```

### Public Bundle Schema

| Direction | Schema |
|-----------|--------|
| **Request** | `{ brandId, id, scope?, ifNoneMatch? }` |
| **Response** | `{ ok, etag, notModified?, value: { event, config } }` |

**Incoming (Request):**
```typescript
{
  brandId: string      // Required - Brand identifier
  id: string           // Required - Event ID
  scope?: string       // Optional - 'events' | 'leagues' | 'tournaments'
  ifNoneMatch?: string // Optional - ETag for 304 caching
}
```

**Outgoing (Response):**
```typescript
{
  ok: true,
  etag: string,                    // MD5 hash for caching
  notModified?: boolean,           // True if ETag matched (304)
  value: {
    event: Event,                  // Full canonical event (see below)
    config: {
      appTitle: string,
      brandId: string,
      brandName: string
    }
  }
}
```

**Event Fields Included (Full Canonical Event v2.2):**
- Identity: `id, slug, name, startDateISO, venue, templateId`
- Links: `publicUrl, displayUrl, posterUrl, signupUrl, sharedReportUrl`
- QR Codes: `qr.public, qr.signup` (base64 PNG)
- CTAs: `ctas.primary, ctas.secondary`
- Settings: `showSchedule, showStandings, showBracket, showSponsors, ...`
- Content: `schedule[], standings[], bracket`
- V2 Optional: `sponsors[], media, externalData`
- Metadata: `createdAtISO, updatedAtISO`

**Key Fields Added by Bundle:**
- `config.appTitle` - Brand app title
- `config.brandId` - Brand identifier
- `config.brandName` - Brand display name

**Nothing Stripped:** Full event data is returned; Public.html decides what to render.

---

## 3. Display Flow

**Display.html → api_getDisplayBundle → Event + Rotation + Layout**

```
┌──────────────────┐
│   Display.html   │
│   (TV/Kiosk)     │
└────────┬─────────┘
         │
         │ NU.rpc('api_getDisplayBundle', { brandId, id })
         ▼
┌──────────────────┐
│      NUSDK       │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│            api_getDisplayBundle                  │
│                                                  │
│  1. getEventById_(brandId, id, {hydrateSponsors})│
│  2. getDisplayConfig_(templateId, brandId)       │
│  3. Build response with rotation + layout        │
└──────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│                  Response                        │
│  {                                               │
│    ok: true,                                     │
│    etag: "md5-hash",                             │
│    value: {                                      │
│      event: Event,        // Full canonical      │
│      rotation: {                                 │
│        sponsorSlots: number,                     │
│        rotationMs: number                        │
│      },                                          │
│      layout: {                                   │
│        hasSidePane: boolean,                     │
│        emphasis: 'hero'|'scores'|'sponsors'      │
│      }                                           │
│    }                                             │
│  }                                               │
└──────────────────────────────────────────────────┘
```

### Display Bundle Schema

| Direction | Schema |
|-----------|--------|
| **Request** | `{ brandId, id, scope?, ifNoneMatch? }` |
| **Response** | `{ ok, etag, notModified?, value: { event, rotation, layout } }` |

**Incoming (Request):**
```typescript
{
  brandId: string      // Required
  id: string           // Required
  scope?: string       // Optional - 'events' | 'leagues' | 'tournaments'
  ifNoneMatch?: string // Optional - ETag for 304 caching
}
```

**Outgoing (Response):**
```typescript
{
  ok: true,
  etag: string,
  value: {
    event: Event,                  // Full canonical event
    rotation: {
      sponsorSlots: number,        // Display N sponsor tiles (default: 4)
      rotationMs: number           // Cycle time in ms (default: 8000)
    },
    layout: {
      hasSidePane: boolean,        // Show sponsor side panel
      emphasis: 'hero' | 'scores' | 'sponsors'
    }
  }
}
```

**Key Fields Added by Bundle:**
| Field | Source | Description |
|-------|--------|-------------|
| `rotation.sponsorSlots` | `ZEB.DISPLAY_CONFIG` | Number of sponsor tiles |
| `rotation.rotationMs` | `ZEB.DISPLAY_CONFIG` | Rotation interval |
| `layout.hasSidePane` | Template override | Side panel visibility |
| `layout.emphasis` | Template override | Content emphasis mode |

**Template-Specific Overrides:**

| Template | emphasis | hasSidePane | sponsorSlots | rotationMs |
|----------|----------|-------------|--------------|------------|
| `rec_league` | scores | true | 3 | 6000 |
| `bar_night` | sponsors | true | 4 | 10000 |
| `trivia` | hero | false | 2 | 12000 |
| `fundraiser` | sponsors | true | 6 | 5000 |
| (default) | hero | true | 4 | 8000 |

---

## 4. Poster Flow

**Poster.html → api_getPosterBundle → Event + QR URLs + Print Strings**

```
┌──────────────────┐
│   Poster.html    │
│  (Print-Ready)   │
└────────┬─────────┘
         │
         │ NU.rpc('api_getPosterBundle', { brandId, id })
         ▼
┌──────────────────┐
│      NUSDK       │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│            api_getPosterBundle                   │
│                                                  │
│  1. getEventById_(brandId, id, {hydrateSponsors})│
│  2. generateQRCodes_(event)                      │
│  3. generatePrintStrings_(event)                 │
│  4. Build response envelope                      │
└──────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│                  Response                        │
│  {                                               │
│    ok: true,                                     │
│    etag: "md5-hash",                             │
│    value: {                                      │
│      event: Event,        // Full canonical      │
│      qrCodes: {                                  │
│        public: string,    // quickchart.io URL   │
│        signup: string     // quickchart.io URL   │
│      },                                          │
│      print: {                                    │
│        dateLine: string,  // "Saturday, Aug 15"  │
│        venueLine: string  // Raw venue name      │
│      }                                           │
│    }                                             │
│  }                                               │
└──────────────────────────────────────────────────┘
```

### Poster Bundle Schema

| Direction | Schema |
|-----------|--------|
| **Request** | `{ brandId, id, scope?, ifNoneMatch? }` |
| **Response** | `{ ok, etag, notModified?, value: { event, qrCodes, print } }` |

**Incoming (Request):**
```typescript
{
  brandId: string      // Required
  id: string           // Required
  scope?: string       // Optional
  ifNoneMatch?: string // Optional - ETag for 304 caching
}
```

**Outgoing (Response):**
```typescript
{
  ok: true,
  etag: string,
  value: {
    event: Event,                  // Full canonical event
    qrCodes: {
      public: string | null,       // quickchart.io URL (200px, 1px margin)
      signup: string | null        // quickchart.io URL
    },
    print: {
      dateLine: string | null,     // "Saturday, August 15, 2025"
      venueLine: string | null     // Raw venue string
    }
  }
}
```

**Key Fields Added by Bundle:**

| Field | Source | Format |
|-------|--------|--------|
| `qrCodes.public` | `event.links.publicUrl` | `https://quickchart.io/qr?text=...&size=200&margin=1` |
| `qrCodes.signup` | `event.links.signupUrl` | Same format |
| `print.dateLine` | `event.startDateISO` | Full weekday + month + day + year (en-US) |
| `print.venueLine` | `event.venue` | Unchanged |

**Note on QR Codes:**
- `event.qr.*` contains **base64 PNG** (embedded, from backend)
- `qrCodes.*` contains **URLs** (print-optimized, for external rendering)

---

## 5. SharedReport Flow

**SharedReport.html → api_getSharedAnalytics / api_getSponsorAnalytics → SharedReporting → AnalyticsService**

```
┌──────────────────────┐
│  SharedReport.html   │
│ (Analytics Dashboard)│
└────────┬─────────────┘
         │
         │ NU.rpc('api_getSharedAnalytics', { brandId, eventId?, sponsorId? })
         │ NU.rpc('api_getSponsorAnalytics', { brandId, sponsorId })
         ▼
┌──────────────────────┐
│       NUSDK          │
└────────┬─────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Code.gs API Layer                            │
│  ┌─────────────────────────┐  ┌─────────────────────────────┐  │
│  │  api_getSharedAnalytics │  │   api_getSponsorAnalytics   │  │
│  │    (Organizer View)     │  │      (Sponsor View)         │  │
│  └───────────┬─────────────┘  └───────────────┬─────────────┘  │
│              │                                 │                 │
│              └──────────────┬──────────────────┘                 │
│                             ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   SharedReporting.gs                        ││
│  │   buildSharedAnalyticsResponse_(analytics, isSponsorView)   ││
│  │   ├─ buildSurfacesArray_()                                  ││
│  │   ├─ buildSponsorsArray_() (null if sponsor view)           ││
│  │   └─ buildEventsArray_()                                    ││
│  └─────────────────────────────┬───────────────────────────────┘│
│                                │                                 │
│                                ▼                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   AnalyticsService.gs                       ││
│  │   MetricsUtils_calculateCTR()                               ││
│  │   MetricsUtils_parseRow()                                   ││
│  │   MetricsUtils_createBucket()                               ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐
│  ANALYTICS Sheet │
│  [timestamp,     │
│   eventId,       │
│   surface,       │
│   metric,        │
│   sponsorId,     │
│   value,         │
│   token,         │
│   userAgent]     │
└──────────────────┘
```

### SharedAnalytics Schema

| Direction | Schema |
|-----------|--------|
| **Request (Shared)** | `{ brandId, eventId?, sponsorId?, isSponsorView? }` |
| **Request (Sponsor)** | `{ brandId, sponsorId, eventId? }` |
| **Response** | `{ ok, value: SharedAnalytics }` |

**Incoming (api_getSharedAnalytics):**
```typescript
{
  brandId: string       // Required
  eventId?: string      // Optional - filter to single event
  sponsorId?: string    // Optional - filter to single sponsor
  isSponsorView?: boolean // Optional - hide sponsor comparisons
}
```

**Incoming (api_getSponsorAnalytics):**
```typescript
{
  brandId: string       // Required
  sponsorId: string     // Required
  eventId?: string      // Optional
}
```

**Outgoing (SharedAnalytics):**
```typescript
{
  ok: true,
  value: {
    lastUpdatedISO: string,          // ISO timestamp

    summary: {
      totalImpressions: number,
      totalClicks: number,
      totalQrScans: number,
      totalSignups: number,
      uniqueEvents: number,
      uniqueSponsors: number
    },

    surfaces: Array<{
      id: 'poster' | 'display' | 'public' | 'signup',
      label: string,
      impressions: number,
      clicks: number,
      qrScans: number,
      engagementRate: number | null    // (clicks + qrScans) / impressions * 100
    }>,

    sponsors: Array<{                  // null if isSponsorView=true
      id: string,
      name: string,
      impressions: number,
      clicks: number,
      ctr: number                      // clicks / impressions * 100
    }> | null,

    events: Array<{
      id: string,
      name: string,
      impressions: number,
      clicks: number,
      ctr: number
    }> | null
  }
}
```

**Key Fields in Response:**

| Field | Computation | Notes |
|-------|-------------|-------|
| `summary.totalImpressions` | `COUNT(metric='impression')` | All surfaces |
| `summary.totalClicks` | `COUNT(metric='click')` | All surfaces |
| `summary.totalQrScans` | `COUNT(metric='qr_scan')` | QR code scans |
| `summary.totalSignups` | `COUNT(metric='signup')` | Form completions |
| `summary.uniqueEvents` | `COUNT(DISTINCT eventId)` | Events with data |
| `summary.uniqueSponsors` | `COUNT(DISTINCT sponsorId)` | Sponsors with data |
| `surfaces[].engagementRate` | `(clicks + qrScans) / impressions * 100` | Rounded to 1 decimal |
| `sponsors[].ctr` | `clicks / impressions * 100` | Rounded to 2 decimals |
| `sponsors` | (entire array) | **null** if `isSponsorView=true` |

---

## Canonical Event Shape (v2.2)

All bundles return the full canonical Event. Here's the complete shape:

```typescript
interface Event {
  // ═══════════════════════════════════════════════════════
  // MVP REQUIRED - Always present
  // ═══════════════════════════════════════════════════════

  // Identity
  id: string;                    // UUID v4
  slug: string;                  // URL-safe (generated from name)
  name: string;                  // 1-200 chars
  startDateISO: string;          // YYYY-MM-DD
  venue: string;                 // 1-200 chars
  templateId: string | null;     // Template used to create

  // Links (system-generated)
  links: {
    publicUrl: string;           // ?page=events&brand={brandId}&id={id}
    displayUrl: string;          // ?page=display&brand={brandId}&id={id}&tv=1
    posterUrl: string;           // ?page=poster&brand={brandId}&id={id}
    signupUrl: string;           // Form/signup URL
    sharedReportUrl: string | null;
  };

  // QR Codes (system-generated, base64 PNG)
  qr: {
    public: string;              // data:image/png;base64,...
    signup: string;
  };

  // CTAs
  ctas: {
    primary: { label: string; url: string };
    secondary: { label: string; url: string } | null;
  };

  // Settings (visibility toggles)
  settings: {
    showSchedule: boolean;
    showStandings: boolean;
    showBracket: boolean;
    showSponsors: boolean;
    showSponsorBanner: boolean;  // default: true
    showSponsorStrip: boolean;   // default: true
    showLeagueStrip: boolean;    // default: true
    showQRSection: boolean;      // default: true
    showVideo: boolean;          // default: true
    showMap: boolean;            // default: true
    showGallery: boolean;        // default: true
  };

  // Metadata
  createdAtISO: string;          // ISO 8601
  updatedAtISO: string;          // ISO 8601

  // ═══════════════════════════════════════════════════════
  // MVP OPTIONAL - May be null
  // ═══════════════════════════════════════════════════════

  schedule: Array<{
    time: string;
    title: string;
    description: string | null;
  }> | null;

  standings: Array<{
    rank: number;
    team: string;
    wins: number;
    losses: number;
    points: number | null;
  }> | null;

  bracket: {
    rounds: Array<{
      name: string;
      matches: Array<{
        id: string;
        team1: string | null;
        team2: string | null;
        score1: number | null;
        score2: number | null;
        winner: string | null;
      }>;
    }>;
  } | null;

  // ═══════════════════════════════════════════════════════
  // V2 OPTIONAL - May be null
  // ═══════════════════════════════════════════════════════

  sponsors: Array<{
    id: string;
    name: string;
    logoUrl: string;
    linkUrl: string | null;
    placement: 'poster' | 'display' | 'public' | 'tv-banner';
  }> | null;

  media: {
    videoUrl: string | null;
    mapUrl: string | null;
    gallery: string[] | null;
  } | null;

  externalData: {
    scheduleUrl: string | null;
    standingsUrl: string | null;
    bracketUrl: string | null;
  } | null;

  // ═══════════════════════════════════════════════════════
  // RESERVED - Populated but not for end-user editing
  // ═══════════════════════════════════════════════════════

  analytics: {
    enabled: boolean;
    eventViews: number | null;
    publicPageViews: number | null;
    displayViews: number | null;
    signupStarts: number | null;
    signupCompletes: number | null;
    qrScans: number | null;
  } | null;

  payments: {
    enabled: boolean;
    provider: 'stripe' | null;
    price: number | null;
    currency: string | null;
    checkoutUrl: string | null;
  } | null;
}
```

---

## NUSDK (Client-Side RPC)

All surfaces communicate with the backend through NUSDK:

```javascript
window.NU = {
  // Standard RPC call
  rpc(method, payload) → Promise<{ ok, value?, code?, message? }>

  // Stale-while-revalidate (cached reads)
  swr(method, payload, { staleMs, onUpdate }) → Promise<{ ok, value? }>

  // HTML escaping utility
  esc(s) → string
}
```

**Response Envelope Contract:**
```typescript
// Success
{ ok: true, etag?: string, notModified?: boolean, value: any }

// Error
{ ok: false, code: ErrorCode, message: string }

type ErrorCode =
  | 'BAD_INPUT'      // Validation failed
  | 'NOT_FOUND'      // Resource not found
  | 'RATE_LIMITED'   // Too many requests
  | 'INTERNAL'       // Server error
  | 'UNAUTHORIZED'   // Auth failed
  | 'CONTRACT';      // Schema validation failed
```

---

## Storage Layer

### EVENTS Sheet

| Column | Content |
|--------|---------|
| A | `id` - UUID |
| B | `brandId` - Brand identifier |
| C | `templateId` - Template used |
| D | `dataJSON` - Full event data as JSON |
| E | `createdAt` - Creation timestamp |
| F | `slug` - URL-safe identifier |

### ANALYTICS Sheet

| Column | Content |
|--------|---------|
| A | `timestamp` - Event time |
| B | `eventId` - Event reference |
| C | `surface` - 'public', 'display', 'poster', 'signup' |
| D | `metric` - 'impression', 'click', 'qr_scan', 'signup' |
| E | `sponsorId` - Sponsor reference (nullable) |
| F | `value` - Metric value |
| G | `token` - Tracking token |
| H | `userAgent` - Client user agent |

### SHORTLINKS Sheet

| Column | Content |
|--------|---------|
| A | `token` - UUID token |
| B | `targetUrl` - Destination URL |
| C | `eventId` - Event reference |
| D | `sponsorId` - Sponsor reference |
| E | `surface` - Origin surface |
| F | `createdAt` - Creation timestamp |
| G | `brandId` - Brand identifier |

---

## Quick Reference: What Each Surface Gets

| Surface | API | Bundle Contents |
|---------|-----|-----------------|
| **Admin** | Multiple APIs | Templates, Events (full CRUD) |
| **Public** | `api_getPublicBundle` | Event + Brand Config |
| **Display** | `api_getDisplayBundle` | Event + Rotation + Layout |
| **Poster** | `api_getPosterBundle` | Event + QR URLs + Print Strings |
| **SharedReport** | `api_getSharedAnalytics` | Summary + Surfaces + Sponsors + Events |

---

## File Locations

| File | Purpose |
|------|---------|
| `src/mvp/NUSDK.html` | Client-side RPC wrapper |
| `src/mvp/Code.gs` | All backend API functions |
| `src/mvp/ApiSchemas.gs` | Schema validation |
| `src/mvp/SharedReporting.gs` | Analytics response builder |
| `src/mvp/AnalyticsService.gs` | Metrics aggregation |
| `src/mvp/Config.gs` | Display config defaults |
| `schemas/event.schema.json` | Canonical Event schema |
| `schemas/shared-analytics.schema.json` | Analytics schema |
