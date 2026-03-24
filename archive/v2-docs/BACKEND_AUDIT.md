# Backend Architecture Audit

**Date:** 2025-11-21
**Updated:** 2025-11-21 (security fixes applied)
**Scope:** MVP readiness for focus group testing
**Focus:** Security, contracts, service scope

## Executive Summary

The backend is **architecturally sound** with proper layering, contract-driven design, and security middleware. ~~However, there are **4 security gaps** that need attention and **1,275 lines of non-MVP code** that could be deferred.~~

**UPDATE:** Critical security issues have been fixed and feature flags implemented.

### Verdict
- **Contract Consistency:** GOOD - All APIs use Ok/Err envelopes
- **Security Coverage:** FIXED - Critical auth gaps resolved
- **MVP Scope:** IMPLEMENTED - Feature flags defer non-MVP features

---

## Backend Service Inventory

| Service | Lines | MVP Priority | Purpose |
|---------|-------|--------------|---------|
| Code.gs | 3,390 | CORE | Main router, API endpoints |
| ApiSchemas.gs | 851 | CORE | Contract schemas |
| SponsorService.gs | 698 | HIGH | Sponsor management |
| TemplateService.gs | 676 | HIGH | HTML rendering |
| WebhookService.gs | 660 | LOW | External integrations (Zapier, etc.) |
| i18nService.gs | 615 | LOW | Multi-language (EN, ES, FR, DE, etc.) |
| SharedReporting.gs | 536 | MEDIUM | Shared analytics |
| SecurityMiddleware.gs | 488 | CORE | Auth, rate limiting |
| Config.gs | 486 | CORE | Brand configuration |
| AnalyticsService.gs | 447 | MEDIUM | Metrics collection |
| EventService.gs | 431 | HIGH | Event CRUD |
| FormService.gs | 285 | HIGH | Form management |
| **Total** | **9,563** | | |

### Non-MVP Services (Can Defer)

| Service | Lines | Reason |
|---------|-------|--------|
| WebhookService.gs | 660 | External integrations not needed for focus group |
| i18nService.gs | 615 | English-only sufficient for MVP |
| **Total** | **1,275** | **13% of codebase** |

---

## Security Audit

### Auth Methods Supported

The backend supports 3 authentication methods:

1. **adminKey** (legacy) - Simple secret in request body
2. **Bearer JWT** - Stateless token with HS256 signature
3. **X-API-Key** header - Header-based API key

### Security Functions

```
gate_(brandId, adminKey)           - Rate-limited auth check
authenticateRequest_(e, body, brandId) - Multi-method auth
SecurityMiddleware_gate()          - Centralized security (in middleware)
```

### Endpoint Security Matrix

| Endpoint | Auth Check | Status | Notes |
|----------|------------|--------|-------|
| `api_status` | None | OK | Public health check |
| `api_setupCheck` | None | OK | Public diagnostics |
| `api_checkPermissions` | None | OK | Public permission check |
| `api_healthCheck` | None | OK | Public health |
| `api_getConfig` | None | OK | Public config |
| `api_list` | None | OK | Public event listing |
| `api_get` | None | OK | Public event details |
| `api_getPublicBundle` | None | OK | Bundled public data (event+sponsors+links) |
| `api_generateToken` | `gate_()` | OK | Protected |
| `api_create` | `gate_()` | OK | Protected |
| `api_updateEventData` | `gate_()` | OK | Protected |
| `api_getReport` | `gate_()` | OK | Protected |
| `api_createShortlink` | `gate_()` | OK | Protected |
| `api_createFormFromTemplate` | `gate_()` | OK | Protected |
| `api_generateFormShortlink` | `gate_()` | OK | Protected |
| `api_logEvents` | **NONE** | **CRITICAL** | Anyone can inject analytics |
| `api_exportReport` | **BROKEN** | **HIGH** | Missing adminKey in call |
| `api_getSponsorAnalytics` | Optional | **MEDIUM** | Anyone with sponsorId can view |
| `api_getSponsorROI` | Optional | **MEDIUM** | Anyone with sponsorId can view |

---

## Critical Security Issues

### 1. `api_logEvents` - No Authentication (CRITICAL)

**Location:** `Code.gs:2085`

```javascript
function api_logEvents(req){
  return runSafe('api_logEvents', () => {
    const items = (req && req.items) || [];
    if (!items.length) return Ok({count:0});
    // NO AUTH CHECK - Anyone can inject analytics data
    ...
  });
}
```

**Risk:** Anyone can inject arbitrary analytics events, corrupting sponsor metrics.

**Fix Required:**
```javascript
const g = gate_(req.brandId || 'root', req.adminKey);
if (!g.ok) return g;
```

### 2. `api_exportReport` - Broken Auth (HIGH)

**Location:** `Code.gs:2191`

```javascript
function api_exportReport(req){
  return runSafe('api_exportReport', () => {
    const eventId = String(req && req.id || '');
    if (!eventId) return Err(ERR.BAD_INPUT,'missing id');

    const rep = api_getReport({id:eventId});  // Missing brandId and adminKey!
    ...
  });
}
```

**Risk:** Auth check in `api_getReport` will fail because no credentials passed.

**Fix Required:**
```javascript
const rep = api_getReport({id: eventId, brandId: req.brandId, adminKey: req.adminKey});
```

### 3. `api_getSponsorAnalytics` - Optional Auth (MEDIUM)

**Location:** `Code.gs:2241`

```javascript
// Optional authentication - sponsors can view their own data
// Admin key allows viewing any sponsor's data
if (adminKey) {
  const g = gate_(brandId || 'root', adminKey);
  if (!g.ok) return g;
}
```

**Risk:** Anyone with a sponsorId can view sponsor analytics without authentication.

**Recommendation:** Require sponsor-specific token or enforce admin auth.

### 4. `api_getSponsorROI` - Optional Auth (MEDIUM)

**Location:** `Code.gs:2397`

Same pattern as above. Anyone with sponsorId can view ROI data.

---

## Contract Consistency Audit

### Response Envelope Pattern

All APIs correctly use the Ok/Err envelope:

```javascript
const Ok  = (value={}) => ({ ok:true,  value });
const Err = (code, message) => ({ ok:false, code, message: message||code });
```

### Schema Constants

```javascript
const SC_OK = {type: 'object', props: {ok: {type: 'boolean', required: true}}};
const SC_LIST = {type: 'object', props: {ok: {type: 'boolean', required: true}, value: {type: 'object'}}};
const SC_GET = {type: 'object', props: {ok: {type: 'boolean', required: true}, value: {type: 'object'}}};
const SC_STATUS = {type: 'object', props: {ok: {type: 'boolean', required: true}, value: {type: 'object'}}};
```

### Schema Usage

The `_ensureOk_` function correctly handles error short-circuiting:

```javascript
function _ensureOk_(label, schema, obj) {
  // If already an error envelope, return as-is without validation
  if (obj && obj.ok === false) {
    return obj;
  }
  // ... schema validation
}
```

### Contract Validation Coverage

| Endpoint | Uses `_ensureOk_` | Schema |
|----------|-------------------|--------|
| `api_list` | Yes | SC_LIST |
| `api_get` | Yes | SC_GET |
| `api_status` | No | None |
| `api_create` | No | Returns Ok() directly |
| `api_updateEventData` | No | Returns Ok() directly |

**Recommendation:** Add schema validation to all endpoints returning complex data.

---

## CSRF Protection

CSRF protection is properly implemented for state-changing operations:

```javascript
const stateChangingActions = ['create', 'update', 'delete', 'updateEventData',
  'createShortlink', 'createFormFromTemplate', 'generateFormShortlink'];

if (stateChangingActions.includes(action)) {
  if (!validateCSRFToken_(body.csrfToken)) {
    return jsonResponse_(Err(ERR.BAD_INPUT, 'Invalid or missing CSRF token...'));
  }
}
```

**Status:** GOOD - Atomic token validation with LockService.

---

## Rate Limiting

Rate limiting is implemented in `gate_()`:

```javascript
const RATE_MAX_PER_MIN = 10;  // Max requests per minute
const RATE_LOCKOUT_MINS = 15; // Lockout duration
const MAX_FAILED_AUTH = 5;    // Max failed auth attempts
```

**Status:** GOOD - IP-based tracking with exponential backoff.

---

## Recommendations

### Critical (Fix Before Focus Group)

1. **Add auth to `api_logEvents`** - Prevents analytics injection
2. **Fix `api_exportReport`** - Pass credentials to internal call

### High Priority

3. **Review sponsor analytics auth model** - Decide if open access is intentional
4. **Add schema validation to all endpoints** - Ensure contract compliance

### Medium Priority

5. **Consider deferring WebhookService** - 660 lines not needed for MVP
6. **Consider deferring i18nService** - 615 lines not needed for MVP

### Low Priority

7. **Consolidate SecurityMiddleware** - Code.gs has duplicate functions
8. **Add response schema validation** - Use ApiSchemas.gs more consistently

---

## Fixes Applied (2025-11-21)

### Security Fixes

#### 1. `api_logEvents` - Authentication Added
**File:** `Code.gs:2090-2093`
```javascript
// Security fix: Require authentication to prevent analytics injection
const { brandId, adminKey } = req || {};
const g = gate_(brandId || 'root', adminKey);
if (!g.ok) return g;
```

#### 2. `api_exportReport` - Credentials Propagation Fixed
**File:** `Code.gs:2201-2203`
```javascript
// Security fix: Pass credentials to api_getReport for proper authentication
const { brandId, adminKey } = req || {};
const rep = api_getReport({id: eventId, brandId: brandId || 'root', adminKey});
```

### Feature Flags Implemented

**File:** `Config.gs` - Added `FEATURE_FLAGS` to ZEB object

```javascript
FEATURE_FLAGS: {
  // MVP Features (always enabled)
  EVENTS: true,
  SPONSORS: true,
  ANALYTICS: true,
  FORMS: true,
  SHORTLINKS: true,

  // Deferred Features (disabled for MVP)
  WEBHOOKS: false,        // External integrations
  I18N: false,            // Multi-language support
  ADVANCED_ANALYTICS: false,

  // Experimental Features
  PORTFOLIO_ANALYTICS: true,
  SPONSOR_SELF_SERVICE: true
}
```

**Helper Functions Added:**
- `isFeatureEnabled_(featureName)` - Check if feature is enabled
- `requireFeature_(featureName)` - Gate API with feature check

### Endpoints Gated

| Endpoint | Feature Flag | Status |
|----------|--------------|--------|
| `registerWebhook` | WEBHOOKS | Disabled |
| `unregisterWebhook` | WEBHOOKS | Disabled |
| `listWebhooks` | WEBHOOKS | Disabled |
| `testWebhook` | WEBHOOKS | Disabled |
| `getWebhookDeliveries` | WEBHOOKS | Disabled |
| `translate` | I18N | Disabled |
| `getSupportedLocales` | I18N | Disabled |
| `setUserLocale` | I18N | Disabled |

### Enabling Deferred Features

To enable webhooks or i18n for production:

1. Edit `Config.gs`
2. Set `FEATURE_FLAGS.WEBHOOKS = true` or `FEATURE_FLAGS.I18N = true`
3. Deploy via CI pipeline

---

## Next Steps

1. ~~Fix `api_logEvents` auth gap~~ DONE
2. ~~Fix `api_exportReport` broken call~~ DONE
3. Review sponsor analytics auth model (currently optional - design decision)
4. ~~Implement feature flags for WebhookService/i18nService~~ DONE
5. Run contract tests to verify fixes
