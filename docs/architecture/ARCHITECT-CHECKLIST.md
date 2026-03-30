# Architect Checklist

**Story Card:** ZEVENT-005 – Architect + QA mini-audit
**Last Audited:** 2025-11-23
**Status:** PASS - MVP is structurally safe and testable

---

## Checklist Summary

| # | Invariant | Status | Notes |
|---|-----------|--------|-------|
| 1 | All event reads go through `_buildEventContract_()` | PASS | All endpoints use `getEventById_()` |
| 2 | All event writes go through `saveEvent_()` / adapters | PASS | api_create, api_updateEventData, api_saveEvent |
| 3 | No endpoint returns a non-canonical Event shape | PASS | All bundles wrap canonical Event |
| 4 | All bundles wrap the canonical Event | PASS | 6 bundles verified |
| 5 | No front-end builds URLs by hand | PASS | All use `event.links.*` |
| 6 | No front-end bypasses `NU.rpc` patterns | PASS* | Boot sequences acceptable |

---

## 1. All Event Reads Go Through `_buildEventContract_()`

**Definition:** `Code.gs:2098` - **Single source of truth for event shape**

**Schema:** `/schemas/event.schema.json`

**Invariant:** Every time an Event is loaded from storage, it MUST pass through `_buildEventContract_()` to ensure canonical shape matching `/schemas/event.schema.json`:
- Normalized fields (name, startDateISO, venue)
- Generated links (publicUrl, displayUrl, posterUrl, signupUrl)
- QR codes as base64 data URIs
- Normalized CTAs and settings

### Verification

All bundle endpoints use `getEventById_()` which calls `_buildEventContract_()`:

| Endpoint | Location | Calls getEventById_() |
|----------|----------|----------------------|
| `api_getPublicBundle` | `Code.gs:3080` | `Code.gs:3085` |
| `api_getAdminBundle` | `Code.gs:3136` | `Code.gs:3145` |
| `api_getDisplayBundle` | `Code.gs:3303` | `Code.gs:3308` |
| `api_getPosterBundle` | `Code.gs:3396` | `Code.gs:3401` |
| `api_getSponsorBundle` | `Code.gs:3507` | `Code.gs:3512` |
| `api_getSharedReportBundle` | `Code.gs:3627` | `Code.gs:3632` |

### Dead Code Cleanup (Completed)

~~`EventService.gs` contained alternative CRUD functions that did not use `_buildEventContract_()`.~~ **RESOLVED:** File deleted in story E-001 (2025-11-23). All event CRUD now goes through canonical `api_*` functions in `Code.gs`.

---

## 2. All Event Writes Go Through `saveEvent_()` / Adapters

**Definition:** `Code.gs:2657`

**Invariant:** All event persistence MUST go through `saveEvent_()` which:
- Validates required MVP fields (name, startDateISO, venue)
- Generates/validates UUID format
- Handles slug generation with collision detection
- Uses atomic sheet write with LockService
- Returns hydrated event via `_buildEventContract_()`

### Verification

| API Endpoint | Location | Calls saveEvent_() |
|--------------|----------|-------------------|
| `api_create` | `Code.gs:3805` | `Code.gs:3840` |
| `api_updateEventData` | `Code.gs:3855` | `Code.gs:3891` |
| `api_saveEvent` | `Code.gs:3910` | `Code.gs:3951` |

### Adapter Functions

Payloads are normalized before reaching `saveEvent_()`:

| Adapter | Location | Purpose |
|---------|----------|---------|
| `normalizeCreatePayloadToEvent_()` | `Code.gs:2526` | Maps API payload to canonical Event |
| `mergeEventUpdate_()` | `Code.gs:2575` | Overlays partial update onto hydrated Event |

---

## 3. No Endpoint Returns a Non-Canonical Event Shape

**Invariant:** All API endpoints that return event data MUST return either:
1. The full canonical Event shape, OR
2. A documented derived DTO (subset) explicitly derived from canonical Event

### Verification

| Bundle | Returns | Shape |
|--------|---------|-------|
| PublicBundle | `event: EventCore` | Full canonical |
| AdminBundle | `event: EventCore` | Full canonical |
| DisplayBundle | `event: EventCore` | Full canonical |
| PosterBundle | `event: EventCore` | Full canonical |
| SponsorBundle | `event: thinEvent` | Derived DTO (id, name, startDateISO, venue, templateId) |
| SharedReportBundle | `event: thinEvent` | Derived DTO (id, name, startDateISO, venue, templateId) |

**Note:** Sponsor and SharedReport bundles intentionally use a "thin event view" to minimize payload size. The thin view is derived from the full canonical Event returned by `getEventById_()`.

---

## 4. All Bundles Wrap the Canonical Event

**Invariant:** Every bundle returned to front-end surfaces MUST include the canonical Event (or derived DTO) as the source of truth.

### Bundle Structure

```
PublicBundle {
  event: EventCore,           // Full canonical
  config: { appTitle, brandId, brandName }
}

AdminBundle {
  event: EventCore,           // Full canonical
  brandConfig: { ... },
  templates: TemplateDescriptor[],
  diagnostics: { ... },
  allSponsors: Sponsor[]
}

DisplayBundle {
  event: EventCore,           // Full canonical
  rotation: { sponsorSlots, rotationMs },
  layout: { hasSidePane, emphasis }
}

PosterBundle {
  event: EventCore,           // Full canonical
  qrCodes: { public, signup },
  print: { dateLine, venueLine }
}

SponsorBundle {
  event: thinEvent,           // Derived DTO
  sponsors: Sponsor[] (with metrics)
}

SharedReportBundle {
  event: thinEvent,           // Derived DTO
  metrics: { views, clicks, ... }
}
```

---

## 5. No Front-End Builds URLs by Hand

**Invariant:** Front-end surfaces MUST use `event.links.*` for all event URLs. No string concatenation of URL parameters.

### URL Sources

URLs are generated server-side in `_buildEventContract_()` at `Code.gs:2112-2119`:

```javascript
const links = {
  publicUrl:  `${baseUrl}?page=events&brand=${brandId}&id=${id}`,
  displayUrl: `${baseUrl}?page=display&brand=${brandId}&id=${id}&tv=1`,
  posterUrl:  `${baseUrl}?page=poster&brand=${brandId}&id=${id}`,
  signupUrl:  signupUrl  // External or CTA URL
};
```

### Front-End Usage

| Surface | Usage | Location |
|---------|-------|----------|
| Admin.html | `links.publicUrl`, `links.displayUrl`, `links.posterUrl` | Lines 1060-1062, 1188-1209 |
| Poster.html | `event.links.publicUrl`, `event.links.signupUrl` | Lines 476-519 |
| Public.html | Uses `event.links.*` per contract | Line 1365 |

### Exceptions (Acceptable)

| Pattern | Location | Reason |
|---------|----------|--------|
| `?page=wizard` | `Admin.html:256` | Navigation link, not an event URL |

---

## 6. No Front-End Bypasses `NU.rpc` Patterns

**Invariant:** All RPC calls SHOULD use `NU.rpc()` or equivalent Promise wrapper around `google.script.run`.

### NU.rpc Definition

`NUSDK.html:1-37` provides the standard wrapper:

```javascript
window.NU = {
  rpc(method, payload) {
    return new Promise((resolve) => {
      google.script.run
        .withSuccessHandler(res => resolve(res))
        .withFailureHandler(err => resolve({ ok:false, ... }))
        [method](payload);
    });
  }
};
```

### Verification

| Surface | RPC Pattern | Compliant |
|---------|-------------|-----------|
| Admin.html | `NU.rpc('api_*', {...})` | YES |
| SharedReport.html | `NU.rpc('api_*', {...})` | YES |
| Public.html | `NU.rpc('api_*', {...})` | YES |
| Display.html | `NU.rpc('api_*', {...})` | YES |
| Poster.html | `NU.rpc('api_*', {...})` | YES |

### Acceptable Exceptions

| Surface | Pattern | Reason |
|---------|---------|--------|
| SponsorUtils.html | Fire-and-forget `api_logEvents` | Non-critical analytics, failure ignored |

**Note:** All MVP surfaces now use `NU.rpc()` for data loading (E-002, 2025-11-23).

---

## Audit Methodology

### Files Analyzed

**Backend (.gs):**
- Code.gs (5000+ lines) - Main router and API
- Config.gs - Configuration
- TemplateService.gs - Templates
- AnalyticsService.gs - Logging

**Frontend (.html):**
- Admin.html - Event management
- Public.html - Public view
- Display.html - TV display
- Poster.html - Print poster
- SharedReport.html - Analytics
- NUSDK.html - RPC wrapper
- SponsorUtils.html - Sponsor utilities
- APIClient.html - API client wrapper

### Search Patterns Used

```bash
# Event reads
grep -n "getEventById_\|_buildEventContract_" *.gs

# Event writes
grep -n "saveEvent_\|appendRow\|setValue" *.gs

# URL construction
grep -n "links\.\|publicUrl\|displayUrl\|posterUrl" *.html

# RPC patterns
grep -n "google\.script\.run\|NU\.rpc" *.html
```

---

## Recommendations

### Immediate (Before Focus Group)

None - MVP is structurally safe.

### Future Cleanup (Post-MVP)

1. ~~**Remove Dead Code:** `EventService.gs` functions are not used.~~ **DONE** (E-001, 2025-11-23)

2. ~~**Standardize Boot Sequences:** Poster.html and Display.html boot calls to use `NU.rpc()`.~~ **DONE** (E-002, 2025-11-23)

3. **Document Thin Event DTOs:** Add explicit TypeScript/JSDoc interface for `thinEvent` shape used in SponsorBundle and SharedReportBundle.

---

## Sign-Off

- [x] Architect pass complete
- [x] All 6 invariants verified
- [x] MVP is structurally safe for focus group
- [x] No blocking issues found

**Auditor:** Claude Code
**Date:** 2025-11-23
