# API Contract – Envelope Boundaries

> **Version:** 1.0
> **Last Updated:** 2025-12-02
> **Source of Truth for:** Response envelope structure across all endpoints

This document defines the canonical boundary between **flat** (unwrapped) and **envelope** (Ok/Err wrapped) API responses. Tools, test harnesses, and workers rely on this contract.

---

## Response Formats

### Envelope Format (Default)

Most endpoints return the standard **Ok/Err envelope**:

```typescript
// Success
{ ok: true, value: T, etag?: string, notModified?: boolean }

// Error
{ ok: false, code: ErrorCode, message: string, corrId?: string }
```

**Error Codes:** `BAD_INPUT | NOT_FOUND | RATE_LIMITED | INTERNAL | CONTRACT`

### Flat Format (Health Endpoints Only)

Health/status endpoints return **flat JSON** for fast monitoring:

```typescript
// Success
{ ok: true, buildId: string, brandId: string, time: ISO8601, ... }

// Failure
{ ok: false, buildId: string, brandId: string, time: ISO8601, message: string, ... }
```

Note: Flat format still has `ok` field but **no `value` wrapper**.

---

## Endpoint Classification

### Flat Endpoints (No Envelope)

| Endpoint | Function | Schema | Purpose |
|----------|----------|--------|---------|
| `?p=status` | `api_statusPure()` | `status.schema.json` | SLO health anchor |
| `?p=statusmvp` | `api_statusMvp()` | `status-mvp.schema.json` | MVP analytics health |

**Why flat?**
- Optimized for monitoring tools (Datadog, UptimeRobot, etc.)
- No envelope overhead for high-frequency polling
- Direct boolean `ok` for alerting thresholds

### Envelope Endpoints (Ok/Err Wrapped)

| Category | Endpoints | Schema Pattern |
|----------|-----------|----------------|
| **Status (full)** | `?p=statusFull` | `status-envelope.schema.json` |
| **Setup** | `?p=setup`, `?p=permissions` | `setupcheck.schema.json`, `checkpermissions.schema.json` |
| **Bundles** | `getPublicBundle`, `getDisplayBundle`, `getPosterBundle`, `getAdminBundle`, `getSponsorBundle`, `getSharedReportBundle` | Envelope with `event` in value |
| **CRUD** | `list`, `get`, `create`, `saveEvent`, `updateEventData` | Envelope with entity in value |
| **Analytics** | `getReport`, `exportReport`, `getSponsorAnalytics`, `getSponsorROI` | Envelope with metrics in value |
| **Templates** | `listTemplates`, `getTemplate`, `createTemplate`, `updateTemplate` | Envelope with template in value |
| **Utilities** | `generateToken`, `createShortlink`, `generateFormShortlink` | Envelope with result in value |

---

## Contract Rules

### Rule 1: Flat endpoints never emit envelope structure
```javascript
// CORRECT: api_statusPure returns flat
{ ok: true, buildId: "mvp-v19", brandId: "root", time: "...", db: { ok: true } }

// WRONG: api_statusPure should NOT return envelope
{ ok: true, value: { buildId: "mvp-v19", ... } }  // ← Contract violation!
```

### Rule 2: Envelope endpoints always wrap in value
```javascript
// CORRECT: api_status returns envelope
{ ok: true, value: { build: "mvp-v19", brand: "root", ... } }

// WRONG: api_status should NOT return flat data
{ ok: true, build: "mvp-v19", brand: "root", ... }  // ← Contract violation!
```

### Rule 3: Error responses follow their format's pattern
```javascript
// Flat error (status endpoints)
{ ok: false, buildId: "mvp-v19", brandId: "unknown", time: "...", message: "Brand not found" }

// Envelope error (all other endpoints)
{ ok: false, code: "NOT_FOUND", message: "Brand not found", corrId: "abc123" }
```

### Rule 4: notModified omits value
```javascript
// 304-equivalent response (bundles with If-None-Match)
{ ok: true, notModified: true, etag: "abc123..." }
// Note: NO value field when notModified=true
```

---

## Validation Helpers

### Node.js (tests/shared/helpers/test.helpers.js)

```javascript
// For envelope endpoints
validateEnvelope(response);        // Checks ok, value/code+message
validateSuccessEnvelope(response); // Asserts ok=true + value
validateErrorEnvelope(response);   // Asserts ok=false + code+message

// For flat endpoints
validateFlatResponse(response);    // Checks ok + required flat fields

// Boundary assertions
assertIsEnvelope(response);        // Fails if response is flat
assertNotEnvelope(response);       // Fails if response has value wrapper
```

### Google Apps Script (Code.gs)

```javascript
// Envelope validation
Ok(value)                          // Creates { ok: true, value }
Err(code, message)                 // Creates { ok: false, code, message }
_ensureOk_(label, schema, obj)     // Schema validates envelope

// Flat responses: construct directly, no wrapper
return { ok: true, buildId: ZEB.BUILD_ID, ... };
```

---

## Schema Files

| Schema | Format | Used By |
|--------|--------|---------|
| `status.schema.json` | Flat | `api_statusPure` |
| `status-mvp.schema.json` | Flat | `api_statusMvp` |
| `status-envelope.schema.json` | Envelope | `api_status` |
| `setupcheck.schema.json` | Envelope | `api_setupCheck` |
| `checkpermissions.schema.json` | Envelope | `api_checkPermissions` |
| `event.schema.json` | Inner value | All event endpoints |
| `shared-analytics.schema.json` | Inner value | SharedReport |

---

## Testing Requirements

1. **Contract tests must validate envelope boundaries:**
   - Flat endpoints: `assertNotEnvelope(response)`
   - Envelope endpoints: `assertIsEnvelope(response)`

2. **TestRunner's matrix runs must use shared validators:**
   - `validateEnvelope()` for envelope endpoints
   - `validateFlatResponse()` for flat endpoints

3. **Backend tests must fail if:**
   - A flat endpoint returns `{ ok: true, value: {...} }`
   - An envelope endpoint returns data without `value` wrapper
   - Error responses use wrong format for endpoint type

---

## Breaking Change Policy

- **Adding a new flat endpoint:** Requires update to this document + new schema file
- **Converting flat ↔ envelope:** BREAKING CHANGE – requires semver major bump
- **Adding optional fields:** Non-breaking if follows existing pattern

---

## Quick Reference

```
Is my endpoint flat or envelope?
├── /status, /statusmvp → FLAT (no value wrapper)
└── Everything else → ENVELOPE (value wrapper required)

How do I validate?
├── Flat: validateFlatResponse() + assertNotEnvelope()
└── Envelope: validateEnvelope() + assertIsEnvelope()
```
