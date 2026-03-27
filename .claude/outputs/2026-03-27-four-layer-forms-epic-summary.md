# 4-Layer Form System — Epic Summary

### Origin

Art Institute of Chicago instructor printed 20 wrong QR codes, wasted time reprinting. Too many tools, not enough bridges. OurSharedEvents consolidates: one platform, one QR system, 4 form types, all managed from admin Card 2.

### Architecture

```
Anonymous scan system (DB)         Form system (FORMS_DB — SEPARATE)
├── events                         ├── form_registrations (destroy post-event)
├── sponsors                       ├── checkin_counts (just a number)
├── poster_deployments             ├── form_surveys (PII-scrubbed)
├── scans                          ├── email_signups (AES-GCM encrypted)
└── scan_aggregates                ├── feature_flags (tier gating)
         ↕ NEVER LINKED ↕          └── (future: branding, file config)
```

### The 4 Form Layers

| Layer | Purpose | Data Lifecycle | Privacy |
|-------|---------|---------------|---------|
| **Registration** | Pre-event sign-up from poster/table card/ad | Server-set 90-day TTL, destroyed by lifecycle job | SHA-256 hashed email, never raw. Separate DB. |
| **Check-in** | Walk-in tally at door | Running count only. Scan = count + 1. | Zero PII by design. 4 columns: id, event_id, total_count, updated_at. |
| **Survey** | Post-event feedback | Kept, but ALL PII scrubbed before accessible | Whitelist approach: only safe keys (rating, score, quality) survive. All other strings → [SCRUBBED]. |
| **Email List** | Voluntary opt-in | 30-day retention post-event, auto-delete | AES-GCM encrypted at rest. SHA-256 hash for dedup. Never linked to scan data. |

### API Contract

**Public (no auth):**
```
POST /api/v2/events/:id/forms/register      → { ok, id, registrationBucket }
POST /api/v2/events/:id/forms/checkin        → { ok, count }
POST /api/v2/events/:id/forms/survey         → { ok, id }
POST /api/v2/events/:id/forms/email-signup   → { ok, id, duplicate? }
GET  /forms/:eventId?type=register|checkin|survey|email  → HTML form page
```

**Admin (Bearer token required):**
```
GET /api/v2/admin/events/:id/forms/registrations  → { ok, items[], count }
GET /api/v2/admin/events/:id/forms/checkin-count   → { ok, count }
GET /api/v2/admin/events/:id/forms/surveys         → { ok, items[], count }  (PII-scrubbed only)
GET /api/v2/admin/events/:id/forms/email-signups   → { ok, count }
```

### Security Model

| Control | Implementation |
|---------|---------------|
| **DB Isolation** | FORMS_DB is a separate D1 database. Migration 0008 dropped misplaced tables from main DB. Static analysis gates prove no cross-contamination. |
| **XSS Prevention** | `escapeHtml()` on all user-provided values in HTML (event names, admin table data). |
| **Input Validation** | Event ID regex (`^[a-zA-Z0-9_\-]+$`), 16KB body limit, 200/320 char field limits. |
| **Email Privacy** | Never stored raw. Registration: SHA-256 hash. Email list: AES-GCM encrypted + SHA-256 hash for dedup. |
| **PII Scrub** | Whitelist approach — only safe keys survive (rating, score, quality, etc). ALL other string values → `[SCRUBBED]`. Catches `first_name`, `attendee_phone`, etc. that a blacklist would miss. |
| **Survey Gate** | Admin survey endpoint returns ZERO results until `pii_scrubbed = 1`. PII is invisible to admins by design. |
| **Auth** | All admin endpoints require Bearer token via `requireAdmin()`. Tested: 401 without token, 401 with wrong token, 200 with correct token. |
| **Server-Set Expiry** | Client NEVER controls `expires_at` or `retention_expires_at`. Server computes: registration 90-day TTL, email 30-day retention. |

### Feature Flags

General-purpose system in `feature_flags` table. Dot-notation keys. Scope hierarchy:

```
1. Event-scoped   (scope='event', scope_id=eventId)  ← wins first
2. Global         (scope='global')                    ← tier default
3. No row         → feature is ON                     ← backwards compatible
```

**Tier model (future):**
```
Flag key                    Free    Mid     Enterprise
forms.register              ON      ON      ON
forms.checkin               ON      ON      ON
forms.survey                OFF     ON      ON
forms.email-signup          OFF     ON      ON
config.self-serve           OFF     ON      ON
assets.file-upload          OFF     OFF     ON
branding.white-label        OFF     OFF     ON
```

### Container Pattern

All 4 form types share:
- `validateFormRequest()` — event ID validation, body parsing, size limits
- `handleDbError()` — consistent 503 response + structured error log on D1 failure
- `logFormEvent()` — observability with formType, eventId, action, latencyMs
- `jsonResponse()` / `errorResponse()` — consistent response shape + CORS headers

Each type implements only its specific write logic and success response shape.

### Error Handling

- Every D1 operation wrapped in try-catch with `handleDbError()` returning 503
- Lifecycle job runs 3 independent phases — failure in one does NOT abort others
- Individual survey row scrub errors counted, not job-killing
- Structured error logs: `FORM_EVENT` with `action: 'error'` and error message

### Lifecycle Job (Cron: daily 3 AM UTC)

```
Phase 1: DELETE FROM form_registrations WHERE expires_at < now
Phase 2: For each unscrubbed survey → whitelist scrub → SET pii_scrubbed = 1
Phase 3: DELETE FROM email_signups WHERE retention_expires_at < now
```

Each phase independent. Logs per-phase results: `registrationsDeleted`, `surveysScrubbed`, `surveysScrubErrors`, `emailSignupsDeleted`.

### Frontend Surfaces

**Public Form Pages** (`GET /forms/:eventId?type=...`):
- Mobile-first, 10-second comprehension design
- Registration: name + optional email, single submit
- Check-in: large tap button with touch debounce, scale animation, running counter
- Survey: 1-5 star rating buttons, optional comments
- Email signup: single email field, dedup feedback
- All elements have `data-testid` for non-brittle Playwright automation

**Admin Card 2** (forms management on `/admin`):
- Click any event row → Card 2 shows form links + live counts
- 4 form type links open in new tab (QR-ready URLs)
- 4 count boxes: Registrations, Check-ins, Surveys, Emails
- All values XSS-escaped

### Test Coverage

**69 tests across 6 files:**

| File | Tests | What It Proves |
|------|-------|---------------|
| `schema.spec.ts` | 12 | Main DB: 5 tables, 8 indexes, PII firewall, scan_aggregates write protection |
| `constraints.spec.ts` | 14 | FK enforcement, UNIQUE constraints, idempotency, DB isolation (6 DBs) |
| `forms-schema.spec.ts` | 10 | FORMS_DB: 5 tables, 8 indexes, PII firewall, DB isolation |
| `forms-constraints.spec.ts` | 6 | UPSERT counter, email dedup, UNIQUE constraint, migration idempotency |
| `forms-security.spec.ts` | 14 | Static analysis: form handlers never touch DB, scan handlers never touch FORMS_DB. Behavioral: destruction works, PII scrub works, hash consistent, no raw email columns. |
| `forms-e2e.spec.ts` | 13 | Full lifecycle per form type through real D1. Auth gates. Input guards. Cross-layer isolation. Existing routes unaffected. |

### DevOps

- `wrangler.toml`: FORMS_DB binding (3 environments) + cron trigger `0 3 * * *`
- `FORMS_ENCRYPTION_KEY` documented in staging + production secrets
- CI pipeline: applies both main DB and forms DB migrations, verifies table counts per DB
- Feature flag migration included in CI deploy steps

### Commits

| # | Hash | Summary |
|---|------|---------|
| 1 | `997f3ac` | 4-layer form system core — 8 endpoints, FORMS_DB, 5 migrations, lifecycle job, migration 0008 cleanup |
| 2 | `21a5c36` | Security hardening — server-set expiry, PII scrub fix, body size limits, 14 security tests, static analysis gates |
| 3 | `afcff35` | E2E mock processing — 13 scenarios through real D1 handlers, full lifecycle verification |
| 4 | `feb9cb2` | Full scrum team POVs — form pages, admin Card 2, QR routing, cron trigger, observability logging |
| 5 | `fae07f4` | Team re-evaluation — XSS fix, mobile touch UX, Card 2 wiring, whitelist PII scrub, CORS headers |
| 6 | `056b807` | Error handling + feature flags + data-testid + resilient lifecycle — expanded team responsibilities |
| 7 | `1ee8b4d` | Story intake: config surface with tiered feature flags (free/mid/enterprise) |
| 8 | This commit | Epic summary document |

### Files Created/Modified

| File | Status |
|------|--------|
| `migrations/0008_drop_form_tables_from_main_db.sql` | New |
| `migrations-forms/0001_create_form_registrations.sql` | New |
| `migrations-forms/0002_create_checkin_counts.sql` | New |
| `migrations-forms/0003_create_form_surveys.sql` | New |
| `migrations-forms/0004_create_email_signups.sql` | New |
| `migrations-forms/0005_create_forms_indexes.sql` | New |
| `migrations-forms/0006_create_form_config.sql` | New (feature_flags table) |
| `src/handlers/forms.ts` | New (8 endpoints + container pattern + error handling) |
| `src/handlers/form-pages.ts` | New (4 form UIs + QR routing + data-testid) |
| `src/lib/forms-db.ts` | New (SHA-256, AES-GCM, bucketing) |
| `src/lib/feature-flags.ts` | New (isFeatureEnabled, scope hierarchy, FORM_FLAGS) |
| `src/router.ts` | Modified (form routes + feature flag check + form page route) |
| `src/index.ts` | Modified (resilient lifecycle job + scheduled handler) |
| `src/handlers/pages.ts` | Modified (admin Card 2 + XSS escaping) |
| `wrangler.toml` | Modified (FORMS_DB binding + cron + FORMS_ENCRYPTION_KEY docs) |
| `tests/forms-schema.spec.ts` | New (10 schema gates) |
| `tests/forms-constraints.spec.ts` | New (6 constraint tests) |
| `tests/forms-security.spec.ts` | New (14 security + cross-contamination tests) |
| `tests/forms-e2e.spec.ts` | New (13 E2E lifecycle scenarios) |
| `tests/schema.spec.ts` | Modified (7→5 tables, 11→8 indexes) |
| `tests/constraints.spec.ts` | Modified (7→5 tables, 6 DB names) |
| `.github/workflows/oursharedevents-ci.yml` | Modified (forms DB migration + verification steps) |
| `.claude/inputs/2026-03-27-config-surface-tiered-flags.md` | New (next story intake) |
| `.claude/outputs/2026-03-27-four-layer-forms-epic-summary.md` | New (this file) |

### Branch

`claude/implement-feature-safely-gws3j` — 8 commits, 69 tests, TypeScript clean.

### What's Next (Queued)

Config surface with tiered feature flags — self-serve client management for returning clients. File upload (R2), white-label branding, custom domains. Intake saved at `.claude/inputs/2026-03-27-config-surface-tiered-flags.md`.
