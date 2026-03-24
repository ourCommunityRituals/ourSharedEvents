# Contract Test Matrices

This document defines the test matrices for API contract validation.
Each matrix documents the expected behavior for success and error cases.

## Test Matrix Format

```
| Input | Expected | Notes |
|-------|----------|-------|
| Description | ok/code | Additional info |
```

---

## 1. Bundle APIs

### api_getPublicBundle

| Input | Expected | Notes |
|-------|----------|-------|
| Valid brandId + eventId | Ok + event + config | Full canonical v2.0 shape |
| Valid brandId (no eventId) | Ok + default/first event | Uses first event |
| Invalid brandId | Err BAD_INPUT | Unknown brand |
| Missing brandId | Err BAD_INPUT | Required field |
| Valid ifNoneMatch (cached) | Ok + notModified | 304 equivalent |
| Invalid ifNoneMatch | Ok + full bundle | Returns fresh data |

**Response Shape:**
```javascript
{
  ok: true,
  etag: string,
  value: {
    event: EventCore,    // Canonical v2.0
    config: {
      appTitle: string,
      brandId: string,
      brandName: string
    }
  }
}
```

### api_getDisplayBundle

| Input | Expected | Notes |
|-------|----------|-------|
| Valid brandId | Ok + event + rotation | Display-specific fields |
| Invalid brandId | Err BAD_INPUT | Unknown brand |
| tv=1 parameter | Ok + TV mode enabled | Large font, auto-rotation |

**Response Shape:**
```javascript
{
  ok: true,
  etag: string,
  value: {
    event: EventCore,
    rotation: {
      sponsorSlots: number,
      rotationMs: number
    },
    layout: {
      hasSidePane: boolean,
      emphasis: string
    }
  }
}
```

### api_getAdminBundle

| Input | Expected | Notes |
|-------|----------|-------|
| Valid brandId + adminKey | Ok + full admin bundle | Includes templates |
| Invalid adminKey | Err BAD_INPUT | Auth failure |
| Missing adminKey | Err BAD_INPUT | Required for admin |
| Valid eventId | Ok + specific event | Loads event by ID |

**Response Shape:**
```javascript
{
  ok: true,
  etag: string,
  value: {
    event: EventCore,
    brandConfig: BrandConfig,
    templates: Template[],
    diagnostics: Diagnostics,
    allSponsors: Sponsor[]
  }
}
```

### api_getPosterBundle

| Input | Expected | Notes |
|-------|----------|-------|
| Valid brandId | Ok + print-optimized event | QR codes required |
| Valid eventId | Ok + specific event | Loads event by ID |
| Invalid brandId | Err BAD_INPUT | Unknown brand |

**Response Shape:**
```javascript
{
  ok: true,
  etag: string,
  value: {
    event: EventCore,  // With QR codes
    config: BrandConfig
  }
}
```

---

## 2. api_saveEvent

### CREATE Mode (no id)

| Input | Expected | Notes |
|-------|----------|-------|
| Valid MVP fields (name, date, venue) | Ok + new event | Auto-generates ID, slug |
| Missing name | Err BAD_INPUT | MVP required |
| Empty name | Err BAD_INPUT | Must be non-empty |
| Name > 200 chars | Err BAD_INPUT | Max length exceeded |
| Missing startDateISO | Err BAD_INPUT | MVP required |
| Invalid date (MM/DD/YYYY) | Err BAD_INPUT | Must be YYYY-MM-DD |
| Invalid date (DD-MM-YYYY) | Err BAD_INPUT | Must be YYYY-MM-DD |
| Missing venue | Err BAD_INPUT | MVP required |
| Empty venue | Err BAD_INPUT | Must be non-empty |
| Invalid adminKey | Err BAD_INPUT | Auth required |
| Missing brandId | Err BAD_INPUT | Required field |
| XSS in name | Ok (sanitized) | HTML stripped |
| Custom slug | Ok + custom slug | Uses provided slug |
| With signupUrl | Ok + signup QR | Generates signup QR |
| With schedule | Ok + schedule | Array preserved |
| With sponsors | Ok + sponsors | Array preserved |

### UPDATE Mode (with id)

| Input | Expected | Notes |
|-------|----------|-------|
| Valid id + changes | Ok + updated event | Merges with existing |
| Non-existent id | Err NOT_FOUND | ID must exist |
| Invalid id format | Err BAD_INPUT | Must be valid UUID |
| Partial update (name only) | Ok + merged | Preserves other fields |
| Update settings | Ok + new settings | Settings replaced |
| Update signupUrl | Ok + new QR | QR regenerated |

**Response Shape:**
```javascript
{
  ok: true,
  etag: string,
  value: {
    // Full canonical v2.0 event
    id: string,
    slug: string,
    name: string,
    startDateISO: string,
    venue: string,
    links: Links,
    qr: QRCodes,
    ctas: CTAs,
    settings: Settings,
    schedule: ScheduleRow[],
    standings: StandingRow[],
    sponsors: Sponsor[],
    media: Media,
    externalData: ExternalData,
    analytics: Analytics,
    payments: Payments,
    createdAtISO: string,
    updatedAtISO: string
  }
}
```

---

## 3. Validation Rules

### Field: name
- **Type:** string
- **Required:** Yes (CREATE)
- **Max Length:** 200 chars
- **Validation:** Non-empty after trim, HTML sanitized

### Field: startDateISO
- **Type:** string
- **Required:** Yes (CREATE)
- **Format:** YYYY-MM-DD
- **Validation:** Valid date (month 01-12, day 01-31)

### Field: venue
- **Type:** string
- **Required:** Yes (CREATE)
- **Max Length:** 200 chars
- **Validation:** Non-empty after trim

### Field: slug
- **Type:** string
- **Required:** No (auto-generated)
- **Max Length:** 50 chars
- **Format:** lowercase alphanumeric + hyphens
- **Collision:** Auto-appends suffix (-1, -2, etc.)

### Field: id
- **Type:** string (UUID v4)
- **Required:** Yes (UPDATE)
- **Format:** xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx

### Field: signupUrl
- **Type:** string (URL)
- **Required:** No
- **Validation:** Must be valid https:// URL

---

## 4. Error Codes

| Code | Description | HTTP Equivalent |
|------|-------------|-----------------|
| BAD_INPUT | Validation failure, missing field, invalid format | 400 |
| NOT_FOUND | Resource not found | 404 |
| RATE_LIMITED | Too many requests | 429 |
| INTERNAL | Unexpected server error | 500 |
| CONTRACT | Contract violation (data shape mismatch) | 500 |

---

## 5. Caching (ETags)

### Request with ifNoneMatch

```javascript
// Request
{
  action: 'api_getPublicBundle',
  brandId: 'root',
  ifNoneMatch: 'etag-from-previous-request'
}

// Response (cached)
{
  ok: true,
  notModified: true,
  etag: 'etag-from-previous-request'
}

// Response (changed)
{
  ok: true,
  etag: 'new-etag-value',
  value: { ... }
}
```

### ETags
- Computed from MD5 hash of response JSON
- Consistent for same data
- Changes when underlying data changes

---

## 6. Running Contract Tests

```bash
# Run all contract tests
npm run test:contract

# Run specific contract test file
npm test -- tests/contract/bundles.contract.test.js
npm test -- tests/contract/save-event.contract.test.js

# Run with coverage
npm run test:contract -- --coverage
```

---

## 7. Test Coverage Matrix

| API Endpoint | Contract Test | Jest Unit | E2E |
|--------------|:-------------:|:---------:|:---:|
| api_getPublicBundle | ✅ | - | ✅ |
| api_getDisplayBundle | ✅ | - | ✅ |
| api_getAdminBundle | ✅ | - | ✅ |
| api_getPosterBundle | ✅ | - | ✅ |
| api_saveEvent (CREATE) | ✅ | ✅ | ✅ |
| api_saveEvent (UPDATE) | ✅ | ✅ | ✅ |
| api_listEvents | ✅ | - | ✅ |
| api_getEventDetails | ✅ | - | ✅ |
| api_trackEventMetric | ✅ | - | ✅ |
| api_getReport | ✅ | - | ✅ |

---

## 8. EVENT_CONTRACT.md v2.0 Canonical Shape

```typescript
interface Event {
  // IDENTITY (MVP REQUIRED)
  id: string;
  slug: string;
  name: string;
  startDateISO: string;
  venue: string;

  // LINKS (MVP REQUIRED)
  links: {
    publicUrl: string;
    displayUrl: string;
    posterUrl: string;
    signupUrl: string;
    sharedReportUrl?: string;
  };

  // QR CODES (MVP REQUIRED)
  qr: {
    public: string;   // base64 PNG data URI
    signup: string;   // base64 PNG data URI
  };

  // CTA BLOCK (MVP REQUIRED)
  ctas: {
    primary: { label: string; url: string; };
    secondary?: { label: string; url: string; };
  };

  // SETTINGS (MVP REQUIRED)
  settings: {
    showSchedule: boolean;
    showStandings: boolean;
    showBracket: boolean;
    showSponsors?: boolean;
  };

  // OPTIONAL CONTENT
  schedule?: ScheduleRow[];
  standings?: StandingRow[];
  bracket?: BracketTree;
  sponsors?: Sponsor[];
  media?: Media;
  externalData?: ExternalData;
  analytics?: Analytics;
  payments?: Payments;

  // METADATA (MVP REQUIRED)
  createdAtISO: string;
  updatedAtISO: string;
}
```
