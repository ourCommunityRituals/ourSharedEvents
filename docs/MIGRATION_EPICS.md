# Migration Plan: GAS → Cloudflare Workers

## Epics & Stories for Backlog

**Environment Assumption**: STAGING first, PROD only when explicitly called out.

---

# EPIC 0 – Risk Containment & Coexistence

## Purpose / Value

Don't blow up existing QR flows while you cut over from GAS to Workers. This is the "no whack-a-mole" guardrail.

## Scope

| Component | Status |
|-----------|--------|
| Cloudflare Worker router config | In scope |
| GAS backend (leave as legacy) | In scope (read-only, no changes) |
| DNS / routes `stg.eventangle.com` → Worker | In scope |

## Epic Definition of Done

- [ ] All existing QR flows continue to work unchanged via GAS proxy
- [ ] New `/api/v2/*` routes available but not yet consumed by frontend
- [ ] Feature flag `USE_WORKER_API` defaults to `false`
- [ ] Rollback procedure documented and tested
- [ ] Smoke tests pass on both v1 (GAS) and v2 (Worker) endpoints

---

## Stories

### Story 0.1: Establish Coexistence Router Pattern

**As a** platform engineer
**I want** the Worker to route requests to GAS by default while exposing v2 endpoints in parallel
**So that** existing flows remain unbroken during migration

**Acceptance Criteria:**

```gherkin
Given the Worker receives a request to /api/rpc
When the request method is POST
Then the Worker proxies to GAS backend
And returns the GAS response unchanged

Given the Worker receives a request to /api/v2/status
When the request method is GET
Then the Worker handles it natively (no GAS call)
And returns Worker-native response with header X-Handler: worker-native
```

**Technical Tasks:**

- [ ] Verify `worker.js` routing logic sends `/api/*` → GAS proxy
- [ ] Verify `worker.js` routing logic sends `/api/v2/*` → Worker-native handlers
- [ ] Add `X-Handler` response header to identify response source (`gas-proxy` | `worker-native`)
- [ ] Write routing unit tests for both paths

**Points:** 3
**Priority:** P0 (Critical)

---

### Story 0.2: Feature Flag for API Version Selection

**As a** platform engineer
**I want** a feature flag to control whether frontend calls v1 (GAS) or v2 (Worker) APIs
**So that** I can toggle migration on/off without code deployment

**Acceptance Criteria:**

```gherkin
Given USE_WORKER_API is set to "false" (default)
When frontend calls event listing API
Then the call goes to /api/rpc with method=api_list

Given USE_WORKER_API is set to "true"
When frontend calls event listing API
Then the call goes to /api/v2/events
```

**Technical Tasks:**

- [ ] Add `USE_WORKER_API` environment variable to `wrangler.toml` (default: `"false"`)
- [ ] Document feature flag in `config/brand-config.js`
- [ ] Add runtime check in frontend NUSDK to respect flag
- [ ] Ensure flag is readable from both staging and production configs

**Points:** 2
**Priority:** P0 (Critical)

---

### Story 0.3: Validate GAS Backend Still Works (M1 Completion)

**As a** platform engineer
**I want** confirmation that GAS backend accepts POST requests
**So that** I can be confident the proxy path works end-to-end

**Acceptance Criteria:**

```gherkin
Given GAS is deployed with ANYONE_ANONYMOUS access
When I POST to /api/rpc with {"method": "api_status"}
Then I receive HTTP 200
And response body contains {"ok": true, "value": {...}}
And response body does NOT contain HTML
```

**Technical Tasks:**

- [ ] Redeploy GAS with correct permissions (Execute as: Me, Access: Anyone)
- [ ] Update `STAGING_DEPLOYMENT_ID` in `wrangler.toml`
- [ ] Update `deploy-manifest.json` with new deployment ID
- [ ] Run smoke test: `POST /api/rpc {"method":"api_status"}`
- [ ] Document new deployment ID in `APPS_SCRIPT_PROJECT.md`

**Points:** 2
**Priority:** P0 (Critical) – Currently BLOCKED

**Notes:**
- Current issue: GAS POST returns HTML permission error
- Resolution: Requires new deployment with correct access settings
- GitHub Action "Fix GAS Permissions" available for automation

---

### Story 0.4: Verify QR Code Invariant Protection

**As a** platform engineer
**I want** automated tests that verify QR codes are never shown unless valid
**So that** the "if you show it, it works" invariant is protected during migration

**Acceptance Criteria:**

```gherkin
Given an event with valid qr.public and qr.signup
When I request /api/v2/events/:id/bundle/poster
Then response includes both QR data URIs
And QR codes are scannable and resolve to correct URLs

Given an event missing qr.public
When I request /api/v2/events/:id/bundle/poster
Then response returns 400 or omits the event
And no broken QR is exposed to the user
```

**Technical Tasks:**

- [ ] Add Playwright E2E test: poster page renders valid QR codes
- [ ] Add unit test: `validateEventContract_()` rejects events without QR
- [ ] Add integration test: `/api/v2/events/:id/bundle/poster` returns error for invalid events
- [ ] Add QR decode verification in test (scan QR, verify URL)

**Points:** 5
**Priority:** P1 (High)

**Files:**
- `tests/api/smoke/worker-gas-routing.spec.ts`
- `tests/e2e/poster-qr.spec.ts` (new)

---

### Story 0.5: Rollback Procedure & Runbook

**As a** platform engineer
**I want** a documented rollback procedure
**So that** I can quickly revert to GAS-only if Worker migration causes issues

**Acceptance Criteria:**

```gherkin
Given a production incident caused by Worker v2 API
When I follow the rollback runbook
Then traffic reverts to GAS-only within 5 minutes
And no data loss occurs
```

**Technical Tasks:**

- [ ] Document rollback steps in `docs/ROLLBACK_RUNBOOK.md`
- [ ] Create `wrangler.toml` backup config (GAS-only mode)
- [ ] Test rollback procedure in staging
- [ ] Add Slack/PagerDuty alert for v2 API errors > threshold
- [ ] Document DNS TTL considerations (currently 60s for stg.eventangle.com)

**Rollback Steps:**
1. Set `USE_WORKER_API=false` in environment
2. Deploy Worker with v2 routes returning 503
3. Verify all traffic flows through GAS proxy
4. Investigate root cause before re-enabling

**Points:** 3
**Priority:** P1 (High)

---

### Story 0.6: Smoke Test Suite for Coexistence

**As a** QA engineer
**I want** automated smoke tests that verify both v1 and v2 APIs work simultaneously
**So that** I can detect regressions in either path

**Acceptance Criteria:**

```gherkin
Given both v1 and v2 APIs are deployed
When smoke tests run
Then all v1 (GAS proxy) endpoints return expected responses
And all v2 (Worker-native) endpoints return expected responses
And response times are within SLA (< 3s for GAS, < 500ms for Worker)
```

**Technical Tasks:**

- [ ] Create `tests/smoke/coexistence.spec.ts`
- [ ] Test matrix:

| Endpoint | Method | Expected Source |
|----------|--------|-----------------|
| `/api/rpc {method: api_status}` | POST | GAS proxy |
| `/api/rpc {method: api_list}` | POST | GAS proxy |
| `/api/rpc {method: api_getPosterBundle}` | POST | GAS proxy |
| `/api/v2/status` | GET | Worker-native |
| `/api/v2/events` | GET | Worker-native |
| `/api/v2/events/:id/bundle/poster` | GET | Worker-native |

- [ ] Add GitHub Actions workflow: `smoke-coexistence.yml`
- [ ] Run on every PR to `main`

**Points:** 5
**Priority:** P1 (High)

---

### Story 0.7: Observability for Migration

**As a** platform engineer
**I want** separate metrics for v1 and v2 API calls
**So that** I can monitor migration progress and detect issues

**Acceptance Criteria:**

```gherkin
Given traffic is flowing to both v1 and v2 endpoints
When I view the dashboard
Then I see request counts by version (v1 vs v2)
And I see error rates by version
And I see latency percentiles by version (p50, p95, p99)
```

**Technical Tasks:**

- [ ] Add `X-API-Version` header to all responses (`v1` or `v2`)
- [ ] Configure Cloudflare Analytics to track by version
- [ ] Create Grafana/Cloudflare dashboard for migration monitoring
- [ ] Set up alerts for:
  - v2 error rate > 1%
  - v2 p95 latency > 2s
  - v1 traffic > 50% after cutover date

**Points:** 3
**Priority:** P2 (Medium)

---

## Epic 0 Summary

| Story | Points | Priority | Status |
|-------|--------|----------|--------|
| 0.1 Coexistence Router Pattern | 3 | P0 | ✅ Done (commit 168deda) |
| 0.2 Feature Flag | 2 | P0 | Pending |
| 0.3 GAS Backend Validation | 2 | P0 | ⚠️ Blocked (permissions) |
| 0.4 QR Invariant Protection | 5 | P1 | Pending |
| 0.5 Rollback Runbook | 3 | P1 | Pending |
| 0.6 Smoke Test Suite | 5 | P1 | Pending |
| 0.7 Observability | 3 | P2 | Pending |

**Total Points:** 23
**Critical Path:** Stories 0.1, 0.2, 0.3 must complete before any traffic shift

---

## Architecture Reference

```
                    ┌─────────────────────────────────────────┐
                    │         Cloudflare Worker               │
                    │    stg.eventangle.com / api-stg.*       │
                    └─────────────────┬───────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
              ▼                       ▼                       ▼
    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
    │  /api/rpc       │    │  /api/v2/*      │    │  /events, etc.  │
    │  /api/*         │    │  Worker-Native  │    │  HTML Templates │
    │  → GAS Proxy    │    │  Handlers       │    │  (embedded)     │
    └────────┬────────┘    └────────┬────────┘    └─────────────────┘
             │                      │
             ▼                      ▼
    ┌─────────────────┐    ┌─────────────────┐
    │  Google Apps    │    │  Google Sheets  │
    │  Script (GAS)   │    │  Direct API     │
    │                 │    │  (via service   │
    │  Legacy backend │    │   account)      │
    └────────┬────────┘    └─────────────────┘
             │
             ▼
    ┌─────────────────┐
    │  Google Sheets  │
    │  (Data Store)   │
    └─────────────────┘
```

**Coexistence Invariants:**

1. **GAS Proxy Passthrough**: All `/api/*` requests (except `/api/v2/*`) proxy to GAS unchanged
2. **Worker-Native Independence**: `/api/v2/*` never touches GAS
3. **Feature Flag Control**: Frontend uses `USE_WORKER_API` to select endpoint version
4. **Response Tagging**: Every response includes `X-Handler` header for debugging

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `cloudflare-proxy/worker.js` | Router logic (v1 vs v2) |
| `cloudflare-proxy/wrangler.toml` | Worker config & routes |
| `cloudflare-proxy/src/api/` | Worker-native v2 handlers |
| `src/mvp/Code.gs` | GAS backend (legacy) |
| `config/brand-config.js` | Frontend feature flags |
| `deploy-manifest.json` | Deployment configuration |

---

## Risk Register (Epic 0)

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| GAS POST permission blocks testing | High | High | Story 0.3: Redeploy with correct settings |
| QR codes break during cutover | Medium | Critical | Story 0.4: Invariant tests |
| Worker latency spikes | Low | Medium | Story 0.7: Observability + alerts |
| Rollback takes too long | Low | High | Story 0.5: Documented runbook |
| Frontend calls wrong endpoint | Medium | Medium | Story 0.2: Feature flag |

---

# EPIC 1 – Read-Only API Migration

## Purpose / Value

Shift all read traffic (event listing, retrieval, bundles) from GAS to Worker-native v2 APIs. This eliminates GAS latency (~2-3s) for the most common operations and proves the Worker-native Sheets integration at scale.

## Scope

| Component | Status |
|-----------|--------|
| `/api/v2/events` (list) | In scope |
| `/api/v2/events/:id` (get) | In scope |
| `/api/v2/events/:id/bundle/*` (public, display, poster) | In scope |
| Frontend NUSDK updates | In scope |
| GAS read APIs | Out of scope (leave as fallback) |

## Epic Definition of Done

- [ ] Frontend uses `/api/v2/*` for all read operations (when flag enabled)
- [ ] Latency p95 < 500ms for all v2 read endpoints
- [ ] Zero QR code regressions (all QR codes remain functional)
- [ ] GAS fallback still works if v2 fails
- [ ] Canary deployment successful in staging

---

## Stories

### Story 1.1: Migrate Events List to v2 API

**As a** event organizer
**I want** faster event listing on the public page
**So that** attendees see events quickly without waiting for GAS

**Acceptance Criteria:**

```gherkin
Given USE_WORKER_API is "true"
When Public.html loads
Then it calls GET /api/v2/events (not /api/rpc api_list)
And events render within 500ms
And event data matches GAS response schema

Given USE_WORKER_API is "false"
When Public.html loads
Then it calls POST /api/rpc {method: "api_list"}
And existing behavior is unchanged
```

**Technical Tasks:**

- [ ] Update NUSDK `listEvents()` to check `USE_WORKER_API` flag
- [ ] Add v2 fetch path: `GET /api/v2/events?brand={brandId}`
- [ ] Map v2 response to existing schema (ensure compatibility)
- [ ] Add unit tests for both paths
- [ ] Add E2E test: Public.html renders events from v2 API

**Points:** 5
**Priority:** P0 (Critical)

**Files:**
- `config/nusdk.js` - Add v2 fetch path
- `src/mvp/Public.html` - No changes needed (uses NUSDK)
- `cloudflare-proxy/src/api/events.js` - Already implemented

---

### Story 1.2: Migrate Single Event Retrieval to v2 API

**As a** event organizer
**I want** faster event detail loading
**So that** admin and display pages respond quickly

**Acceptance Criteria:**

```gherkin
Given USE_WORKER_API is "true"
When Admin.html loads an event
Then it calls GET /api/v2/events/:id
And event data loads within 500ms
And all fields match GAS response

Given event does not exist
When GET /api/v2/events/:id is called
Then response is 404 with {ok: false, code: "NOT_FOUND"}
```

**Technical Tasks:**

- [ ] Update NUSDK `getEvent(id)` to check `USE_WORKER_API` flag
- [ ] Add v2 fetch path: `GET /api/v2/events/{id}`
- [ ] Handle 404 responses gracefully in frontend
- [ ] Add cache headers (ETag support already in Worker)
- [ ] Add unit tests for both paths

**Points:** 3
**Priority:** P0 (Critical)

---

### Story 1.3: Migrate Poster Bundle to v2 API

**As a** event organizer
**I want** the poster page to load faster with QR codes
**So that** I can print posters quickly

**Acceptance Criteria:**

```gherkin
Given USE_WORKER_API is "true"
When Poster.html loads
Then it calls GET /api/v2/events/:id/bundle/poster
And QR codes render correctly (public + signup)
And poster loads within 500ms

Given event has invalid QR data
When GET /api/v2/events/:id/bundle/poster is called
Then response is 400 with descriptive error
And poster page shows error message (not broken QR)
```

**Technical Tasks:**

- [ ] Update NUSDK `getPosterBundle(id)` to check flag
- [ ] Verify QR data URIs are base64-encoded PNG
- [ ] Add QR validation in frontend before rendering
- [ ] Add E2E test: scan rendered QR codes, verify URLs
- [ ] Add visual regression test for poster layout

**Points:** 5
**Priority:** P0 (Critical)

**QR Invariant Check:**
- `event.qr.public` must be valid data URI
- `event.qr.signup` must be valid data URI
- Both must decode to correct URLs

---

### Story 1.4: Migrate Display Bundle to v2 API

**As a** venue operator
**I want** the TV display to refresh quickly
**So that** event info stays current without lag

**Acceptance Criteria:**

```gherkin
Given USE_WORKER_API is "true"
When Display.html auto-refreshes (every 30s)
Then it calls GET /api/v2/events/:id/bundle/display
And display updates within 500ms
And no visible flicker during refresh

Given event status changes
When display refreshes
Then new status appears immediately
And transition is smooth
```

**Technical Tasks:**

- [ ] Update NUSDK `getDisplayBundle(id)` to check flag
- [ ] Add ETag support for conditional refresh (304 Not Modified)
- [ ] Optimize display refresh to only update changed fields
- [ ] Add test: display handles 304 responses correctly
- [ ] Add load test: 100 concurrent display refreshes

**Points:** 3
**Priority:** P1 (High)

---

### Story 1.5: Migrate Public Bundle to v2 API

**As a** attendee
**I want** the public event page to load instantly
**So that** I can see event details without waiting

**Acceptance Criteria:**

```gherkin
Given USE_WORKER_API is "true"
When Public.html loads event details
Then it calls GET /api/v2/events/:id/bundle/public
And page renders within 500ms
And all event details are correct
```

**Technical Tasks:**

- [ ] Update NUSDK `getPublicBundle(id)` to check flag
- [ ] Verify public bundle excludes private fields
- [ ] Add test: private fields not exposed in public bundle
- [ ] Add SEO meta tag generation from bundle data

**Points:** 2
**Priority:** P1 (High)

---

### Story 1.6: Canary Deployment for Read APIs

**As a** platform engineer
**I want** to gradually shift read traffic to v2
**So that** I can detect issues before full rollout

**Acceptance Criteria:**

```gherkin
Given canary is set to 10%
When 100 requests come in
Then ~10 use v2 API, ~90 use v1 API
And metrics show split traffic

Given v2 error rate exceeds 5%
When canary is running
Then traffic automatically reverts to v1
And alert fires
```

**Technical Tasks:**

- [ ] Add `CANARY_PERCENTAGE` environment variable (0-100)
- [ ] Implement percentage-based routing in Worker
- [ ] Add canary metrics to dashboard
- [ ] Set up automatic rollback on error threshold
- [ ] Document canary deployment procedure

**Canary Rollout Plan:**
1. Staging: 100% v2 (already done)
2. Production: 10% → 25% → 50% → 100%
3. Each step requires 24h stability

**Points:** 5
**Priority:** P1 (High)

---

## Epic 1 Summary

| Story | Points | Priority | Status |
|-------|--------|----------|--------|
| 1.1 Events List | 5 | P0 | Pending |
| 1.2 Single Event | 3 | P0 | Pending |
| 1.3 Poster Bundle | 5 | P0 | Pending |
| 1.4 Display Bundle | 3 | P1 | Pending |
| 1.5 Public Bundle | 2 | P1 | Pending |
| 1.6 Canary Deployment | 5 | P1 | Pending |

**Total Points:** 23
**Dependencies:** Epic 0 complete (especially 0.2 Feature Flag, 0.3 GAS Validation)

---

## API Mapping Reference (v1 → v2)

| GAS (v1) | Worker (v2) | Method |
|----------|-------------|--------|
| `api_list` | `/api/v2/events` | GET |
| `api_get` | `/api/v2/events/:id` | GET |
| `api_getPublicBundle` | `/api/v2/events/:id/bundle/public` | GET |
| `api_getDisplayBundle` | `/api/v2/events/:id/bundle/display` | GET |
| `api_getPosterBundle` | `/api/v2/events/:id/bundle/poster` | GET |

---

# EPIC 2 – Write API Migration

## Purpose / Value

Migrate event creation and updates from GAS to Worker-native v2 APIs. This is higher risk than reads because it involves data mutations, but eliminates the last synchronous dependency on GAS for core event management.

## Scope

| Component | Status |
|-----------|--------|
| `POST /api/v2/events` (create) | In scope |
| `PUT /api/v2/events/:id` (update) | In scope |
| QR code generation (Worker-native) | In scope |
| Event validation | In scope |
| Admin authentication | In scope |
| Analytics tracking | Out of scope (Epic 3) |
| Form generation | Out of scope (Epic 3) |

## Epic Definition of Done

- [ ] Admin can create events via v2 API
- [ ] Admin can update events via v2 API
- [ ] QR codes generated by Worker match GAS quality
- [ ] All validation rules enforced identically to GAS
- [ ] Audit log captures all mutations
- [ ] Zero data loss during transition

---

## Stories

### Story 2.1: Migrate Event Creation to v2 API

**As an** admin
**I want** to create events via the faster v2 API
**So that** event setup is quicker

**Acceptance Criteria:**

```gherkin
Given USE_WORKER_API is "true"
When admin submits new event form
Then POST /api/v2/events is called
And event is created in Sheets
And response includes generated QR codes
And event appears in list within 1s

Given required fields are missing
When POST /api/v2/events is called
Then response is 400 with validation errors
And no partial event is created
```

**Technical Tasks:**

- [ ] Update NUSDK `createEvent(data)` to check flag
- [ ] Verify Worker-native QR generation matches GAS output
- [ ] Implement full validation (name, date, venue, signupUrl required)
- [ ] Add atomic write (all-or-nothing) to Sheets
- [ ] Add audit log entry for event creation
- [ ] Add E2E test: create event → verify in list → verify QR works

**Points:** 8
**Priority:** P0 (Critical)

**Validation Rules (must match GAS):**
- `name`: required, string, max 200 chars
- `date`: required, ISO 8601 format
- `venue`: required, string
- `signupUrl`: required, valid URL
- `slug`: auto-generated from name if not provided

---

### Story 2.2: Migrate Event Update to v2 API

**As an** admin
**I want** to update events via the faster v2 API
**So that** changes take effect immediately

**Acceptance Criteria:**

```gherkin
Given USE_WORKER_API is "true"
When admin updates event details
Then PUT /api/v2/events/:id is called
And changes are saved to Sheets
And QR codes regenerated if URLs changed
And response includes updated event

Given event does not exist
When PUT /api/v2/events/:id is called
Then response is 404 with {ok: false, code: "NOT_FOUND"}

Given concurrent updates occur
When two PUTs race
Then one succeeds, one gets 409 Conflict
And no data is corrupted
```

**Technical Tasks:**

- [ ] Update NUSDK `updateEvent(id, data)` to check flag
- [ ] Implement optimistic locking (ETag-based)
- [ ] Regenerate QR codes only if signupUrl or publicUrl changed
- [ ] Add audit log entry for event updates
- [ ] Add test: concurrent update handling (409 response)
- [ ] Add E2E test: update event → verify changes persisted

**Points:** 8
**Priority:** P0 (Critical)

**Concurrency Handling:**
- Client sends `If-Match: <etag>` header
- Server rejects if ETag mismatch (409 Conflict)
- Client must re-fetch and retry

---

### Story 2.3: Worker-Native QR Code Generation Parity

**As a** platform engineer
**I want** Worker-generated QR codes to be identical to GAS-generated ones
**So that** users don't notice any difference after migration

**Acceptance Criteria:**

```gherkin
Given an event with signupUrl and publicUrl
When QR codes are generated by Worker
Then they are valid PNG data URIs
And they scan correctly to the right URLs
And visual quality matches GAS output (min 200x200px)

Given QR generation fails
When event is being created
Then event creation fails entirely (atomic)
And error message indicates QR failure
```

**Technical Tasks:**

- [ ] Verify `cloudflare-proxy/src/utils/qr.js` generates scannable QR
- [ ] Add QR decode test (generate → decode → compare URL)
- [ ] Set minimum QR size: 200x200 pixels, scale 4
- [ ] Add error correction level M (15% recovery)
- [ ] Visual comparison test: GAS QR vs Worker QR (pixel diff)
- [ ] Performance test: QR generation < 50ms

**Points:** 3
**Priority:** P0 (Critical)

**QR Spec:**
- Format: PNG, base64 data URI
- Size: 200x200px minimum
- Error correction: Level M
- Encoding: UTF-8

---

### Story 2.4: Admin Authentication for Write APIs

**As a** platform engineer
**I want** write APIs to require admin authentication
**So that** only authorized users can create/update events

**Acceptance Criteria:**

```gherkin
Given valid admin token in Authorization header
When POST /api/v2/events is called
Then request is processed normally

Given missing or invalid token
When POST /api/v2/events is called
Then response is 401 Unauthorized
And no event is created

Given token for wrong brand
When POST /api/v2/events is called
Then response is 403 Forbidden
```

**Technical Tasks:**

- [ ] Verify `cloudflare-proxy/src/middleware/auth.js` validates Bearer token
- [ ] Add per-brand admin token validation
- [ ] Add rate limiting: 100 writes/minute per token
- [ ] Add audit log: who made what change
- [ ] Add test: invalid token rejected
- [ ] Add test: cross-brand access denied

**Points:** 3
**Priority:** P0 (Critical)

**Auth Flow:**
```
Authorization: Bearer <ADMIN_TOKEN>
Token validated against per-brand secret
Multi-brand: token must match request brand
```

---

### Story 2.5: Write API Audit Trail

**As a** platform engineer
**I want** all write operations logged
**So that** I can trace who changed what and when

**Acceptance Criteria:**

```gherkin
Given an event is created
When I check the audit log
Then I see: timestamp, action=CREATE, eventId, userId, changes

Given an event is updated
When I check the audit log
Then I see: timestamp, action=UPDATE, eventId, userId, fieldChanged, oldValue, newValue
```

**Technical Tasks:**

- [ ] Create AUDIT_LOG sheet in Sheets workbook
- [ ] Log on every write: timestamp, action, eventId, userId, payload
- [ ] Add API: `GET /api/v2/audit?eventId=X` (admin only)
- [ ] Retention: keep 90 days of audit logs
- [ ] Add test: verify audit entries created

**Points:** 5
**Priority:** P1 (High)

**Audit Log Schema:**
| Column | Type | Description |
|--------|------|-------------|
| timestamp | ISO 8601 | When |
| action | CREATE/UPDATE/DELETE | What |
| eventId | string | Which event |
| userId | string | Who (from token) |
| changes | JSON | Field-level diff |

---

### Story 2.6: Write API Canary & Rollout

**As a** platform engineer
**I want** to gradually enable write APIs on v2
**So that** I can catch issues before they affect all users

**Acceptance Criteria:**

```gherkin
Given WRITE_CANARY is set to 10%
When admins create events
Then ~10% use v2 API, ~90% use v1 API

Given v2 write fails
When canary is running
Then automatic fallback to v1 occurs
And admin sees success (transparent retry)
```

**Technical Tasks:**

- [ ] Add `WRITE_CANARY_PERCENTAGE` environment variable
- [ ] Implement fallback: if v2 fails, retry on v1
- [ ] Add metrics: write success/failure by version
- [ ] Document rollout plan: staging → 10% → 50% → 100%
- [ ] Add alert: v2 write failure rate > 1%

**Rollout Plan:**
1. Staging: 100% v2 writes
2. Production: 10% → 25% → 50% → 100%
3. Minimum 48h at each step
4. Rollback if error rate > 1%

**Points:** 5
**Priority:** P1 (High)

---

## Epic 2 Summary

| Story | Points | Priority | Status |
|-------|--------|----------|--------|
| 2.1 Event Creation | 8 | P0 | Pending |
| 2.2 Event Update | 8 | P0 | Pending |
| 2.3 QR Parity | 3 | P0 | Pending |
| 2.4 Admin Auth | 3 | P0 | Pending |
| 2.5 Audit Trail | 5 | P1 | Pending |
| 2.6 Canary Rollout | 5 | P1 | Pending |

**Total Points:** 32
**Dependencies:** Epic 1 complete (read APIs proven stable)

---

## Data Flow: Write Operation

```
Admin.html
    │
    ▼ (USE_WORKER_API=true)
POST /api/v2/events
    │
    ├─► Auth middleware (validate token)
    │
    ├─► Validation (name, date, venue, signupUrl)
    │
    ├─► QR Generation (Worker-native)
    │
    ├─► Sheets Write (atomic)
    │
    ├─► Audit Log (async)
    │
    └─► Response {ok: true, value: event}
```

---

# EPIC 3 – GAS Retirement

## Purpose / Value

Remove Google Apps Script from the critical path entirely. This eliminates the latency, reliability, and maintenance burden of GAS, completing the migration to a fully Worker-native architecture.

## Scope

| Component | Status |
|-----------|--------|
| Remove GAS proxy routes from Worker | In scope |
| Migrate remaining GAS-only features | In scope |
| Archive GAS codebase | In scope |
| Update documentation | In scope |
| DNS changes | Out of scope (no DNS changes needed) |

## Epic Definition of Done

- [ ] Zero traffic flows through GAS proxy
- [ ] All features work via Worker-native APIs
- [ ] GAS deployment archived (not deleted)
- [ ] Documentation updated to reflect new architecture
- [ ] Cost savings realized (no GAS quota usage)

---

## Stories

### Story 3.1: Migrate Analytics Tracking to Worker

**As a** platform engineer
**I want** analytics to be captured by the Worker
**So that** we don't depend on GAS for event tracking

**Acceptance Criteria:**

```gherkin
Given an event is viewed
When trackEventMetric is called
Then metric is recorded via Worker (not GAS)
And metric appears in analytics dashboard

Given high traffic (100 events/second)
When metrics are being recorded
Then no events are dropped
And Worker latency is unaffected
```

**Technical Tasks:**

- [ ] Create `/api/v2/analytics/track` endpoint
- [ ] Implement async write to ANALYTICS sheet
- [ ] Add batching: collect metrics for 5s, write in batch
- [ ] Migrate `api_logEvents` logic to Worker
- [ ] Migrate `api_trackEventMetric` logic to Worker
- [ ] Add test: high-volume metric recording
- [ ] Verify analytics aggregation still works

**Points:** 8
**Priority:** P1 (High)

**Analytics Schema:**
| Field | Type |
|-------|------|
| eventId | string |
| metric | string (view, click, signup) |
| timestamp | ISO 8601 |
| metadata | JSON |

---

### Story 3.2: Migrate Form Generation to Worker

**As an** admin
**I want** form generation to work via Worker
**So that** signup forms don't depend on GAS

**Acceptance Criteria:**

```gherkin
Given admin requests form creation
When POST /api/v2/forms is called
Then Google Form is created via Forms API
And form URL is returned
And form is linked to event

Given Forms API is unavailable
When form creation fails
Then error is returned with retry guidance
And no orphan forms are created
```

**Technical Tasks:**

- [ ] Add Google Forms API client to Worker
- [ ] Create `/api/v2/forms` endpoint
- [ ] Migrate `api_createFormFromTemplate` logic
- [ ] Add form template management
- [ ] Add test: form creation end-to-end
- [ ] Add cleanup: delete orphan forms on failure

**Points:** 8
**Priority:** P2 (Medium)

**Note:** Form generation is less critical than events. Can remain on GAS longer if needed.

---

### Story 3.3: Migrate Shortlinks to Worker

**As a** marketing user
**I want** shortlinks to resolve via Worker
**So that** link tracking doesn't depend on GAS

**Acceptance Criteria:**

```gherkin
Given a shortlink exists
When user visits /s/abc123
Then Worker redirects to target URL
And click is tracked
And response is 301/302

Given shortlink doesn't exist
When user visits /s/invalid
Then Worker returns 404
And custom error page is shown
```

**Technical Tasks:**

- [ ] Create SHORTLINKS sheet (or column in EVENTS)
- [ ] Add `/api/v2/shortlinks` CRUD endpoints
- [ ] Add `/s/:code` redirect handler in Worker
- [ ] Migrate `api_createShortlink` logic
- [ ] Add click tracking to analytics
- [ ] Add test: shortlink create → resolve → track

**Points:** 5
**Priority:** P2 (Medium)

---

### Story 3.4: Remove GAS Proxy Routes

**As a** platform engineer
**I want** to remove GAS proxy code from Worker
**So that** the codebase is simpler and GAS dependency is eliminated

**Acceptance Criteria:**

```gherkin
Given all features are migrated to v2
When GAS proxy routes are removed
Then all /api/v2/* endpoints work
And /api/rpc returns 410 Gone with migration message
And no traffic reaches GAS

Given a client still uses v1 API
When they call /api/rpc
Then they get 410 Gone with upgrade instructions
```

**Technical Tasks:**

- [ ] Verify 0% traffic to GAS for 7 days
- [ ] Add deprecation warning to v1 responses (30 days before removal)
- [ ] Remove GAS proxy code from `worker.js`
- [ ] Remove GAS URLs from `wrangler.toml`
- [ ] Remove GAS secrets from Cloudflare
- [ ] Add 410 Gone handler for legacy endpoints
- [ ] Update error messages with v2 migration guide

**Points:** 3
**Priority:** P0 (Critical) – but blocked by 3.1-3.3

---

### Story 3.5: Archive GAS Codebase

**As a** platform engineer
**I want** GAS code archived but not deleted
**So that** we can reference it if needed

**Acceptance Criteria:**

```gherkin
Given GAS is no longer in use
When archival is complete
Then GAS code is in /archive/gas/ directory
Then GAS deployment is disabled (not deleted)
And README documents how to restore if needed
```

**Technical Tasks:**

- [ ] Move `src/mvp/*.gs` to `archive/gas/`
- [ ] Update `.gitignore` to exclude archive from builds
- [ ] Disable GAS deployment (Apps Script console)
- [ ] Document GAS restoration procedure
- [ ] Remove GAS from CI/CD pipeline
- [ ] Update deploy-manifest.json (remove GAS entries)

**Points:** 2
**Priority:** P2 (Medium)

---

### Story 3.6: Update Architecture Documentation

**As a** developer
**I want** documentation to reflect the new Worker-only architecture
**So that** future developers understand the system

**Acceptance Criteria:**

```gherkin
Given migration is complete
When developer reads docs
Then they see Worker-only architecture
And GAS is mentioned as "legacy, archived"
And all API references point to v2
```

**Technical Tasks:**

- [ ] Update `docs/ARCHITECTURE.md`
- [ ] Update `docs/CLOUDFLARE_WORKER_MIGRATION.md` (mark complete)
- [ ] Update `README.md` with new architecture
- [ ] Update `API_CONTRACT.md` with v2 endpoints only
- [ ] Archive old integration docs
- [ ] Add post-mortem: lessons learned from migration

**Points:** 3
**Priority:** P2 (Medium)

---

### Story 3.7: Production Cutover (PROD)

**As a** platform engineer
**I want** to complete the migration in production
**So that** all users benefit from the faster Worker-native APIs

**Acceptance Criteria:**

```gherkin
Given staging has been 100% Worker for 14 days
When production cutover is approved
Then production routes use Worker-only
And GAS proxy is disabled
And monitoring confirms zero GAS traffic

Given an issue is detected post-cutover
When rollback is triggered
Then GAS proxy can be re-enabled within 5 minutes
```

**Technical Tasks:**

- [ ] Staging stability: 14 days at 100% Worker
- [ ] Production canary: 10% → 50% → 100%
- [ ] Coordinate with stakeholders (announce maintenance window)
- [ ] Execute production deployment
- [ ] Monitor for 24h post-cutover
- [ ] Declare migration complete
- [ ] Celebrate 🎉

**Points:** 5
**Priority:** P0 (Critical) – final story

---

## Epic 3 Summary

| Story | Points | Priority | Status |
|-------|--------|----------|--------|
| 3.1 Analytics Migration | 8 | P1 | Pending |
| 3.2 Form Generation | 8 | P2 | Pending |
| 3.3 Shortlinks | 5 | P2 | Pending |
| 3.4 Remove GAS Proxy | 3 | P0 | Blocked |
| 3.5 Archive GAS | 2 | P2 | Pending |
| 3.6 Update Docs | 3 | P2 | Pending |
| 3.7 Production Cutover | 5 | P0 | Blocked |

**Total Points:** 34
**Dependencies:** Epic 2 complete, 14 days stability in staging

---

## Final Architecture (Post-Migration)

```
                    ┌─────────────────────────────────────────┐
                    │         Cloudflare Worker               │
                    │    eventangle.com / api.eventangle.com  │
                    └─────────────────┬───────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
              ▼                       ▼                       ▼
    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
    │  /api/v2/*      │    │  /events, etc.  │    │  /s/*           │
    │  All APIs       │    │  HTML Templates │    │  Shortlinks     │
    │  Worker-Native  │    │  (embedded)     │    │  (redirects)    │
    └────────┬────────┘    └─────────────────┘    └────────┬────────┘
             │                                              │
             ▼                                              ▼
    ┌─────────────────┐                          ┌─────────────────┐
    │  Google Sheets  │                          │  Analytics      │
    │  (via Sheets    │                          │  (async batch)  │
    │   API + SA)     │                          │                 │
    └─────────────────┘                          └─────────────────┘

    ┌─────────────────┐
    │  Google Forms   │  (optional, via Forms API)
    │  (templates)    │
    └─────────────────┘
```

**Key Changes:**
- ❌ No GAS in request path
- ✅ All APIs handled by Worker
- ✅ Direct Sheets API access (service account)
- ✅ Sub-500ms latency for all operations
- ✅ Full control over error handling

---

# Migration Timeline Overview

```
EPIC 0 ─────────────────► EPIC 1 ─────────────────► EPIC 2 ─────────────────► EPIC 3
Risk Containment          Read APIs                 Write APIs                GAS Retirement
(23 pts)                  (23 pts)                  (32 pts)                  (34 pts)

     │                         │                         │                         │
     ▼                         ▼                         ▼                         ▼
┌─────────┐             ┌─────────┐             ┌─────────┐             ┌─────────┐
│ Staging │────────────►│ Staging │────────────►│ Staging │────────────►│ Prod    │
│ 100% v2 │             │ Canary  │             │ Canary  │             │ Cutover │
│ reads   │             │ reads   │             │ writes  │             │         │
└─────────┘             └─────────┘             └─────────┘             └─────────┘
```

**Total Story Points:** 112
**Critical Path:** Epic 0 → Epic 1 (1.1-1.3) → Epic 2 (2.1-2.4) → Epic 3 (3.4, 3.7)

---

# Appendix: Story Point Reference

| Points | Complexity | Examples |
|--------|------------|----------|
| 1-2 | Trivial | Config change, doc update |
| 3 | Small | Single endpoint, unit tests |
| 5 | Medium | Feature with tests, integration |
| 8 | Large | Complex feature, E2E tests |
| 13+ | Epic-level | Should be broken down |

---

# Appendix: Risk Register (All Epics)

| Epic | Risk | Likelihood | Impact | Mitigation |
|------|------|------------|--------|------------|
| 0 | GAS POST permission | High | High | Redeploy GAS |
| 0 | QR codes break | Medium | Critical | Invariant tests |
| 1 | v2 latency spikes | Low | Medium | Canary + monitoring |
| 1 | Schema mismatch | Medium | High | Schema validation tests |
| 2 | Data loss on write | Low | Critical | Atomic writes + audit |
| 2 | QR quality differs | Low | High | Visual regression tests |
| 3 | Premature GAS removal | Medium | Critical | Traffic verification |
| 3 | Analytics gap | Medium | Medium | Batch write buffer |

---

*Document generated: 2024-12-12*
*Last updated: See git history*
