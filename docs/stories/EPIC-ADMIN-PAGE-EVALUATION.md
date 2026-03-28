# EPIC: Admin.html — The Launch Driver Evaluation

> **Date:** 2026-03-28
> **Scope:** Full scrum team evaluation of the 7-card Admin shell as the primary site workhorse
> **Goal:** Kaizen-driven analysis — what exists, what's missing, what changes, per role

---

## Executive Summary

Admin.html is a **13,042-line monolith** serving as the single entry point for event organizers. It owns the entire operator experience: event creation, sponsor management, form configuration, QR generation, link distribution across 5 surfaces (public, display, poster, report, admin), and diagnostics. Sponsors and SharedReports drive revenue, but Admin is the engine that makes them work.

**Current state:** MVP-hardened, 7-card flow-first layout, mobile-collapsible cards, wizard onboarding, Worker API v2 integration. Modularized into 9+ sub-components (AdminEvents, AdminForms, AdminDisplay, AdminTemplates, AdminDiagnostics, AdminApiClient, Styles, DesignAdapter, Accessibility).

**Critical gaps identified:** No feature flag tier gating (free/mid/enterprise), no native form hosting (relies on Google Forms), no anonymous ID tracking, no PII destruction jobs, no self-serve config, no file upload, no white-label support.

---

## Table of Contents

1. [Current 7-Card Architecture](#1-current-7-card-architecture)
2. [PO Evaluation — Use Cases & Acceptance Criteria](#2-po-evaluation)
3. [Lead BE Architect — API, DB, Auth, Testing](#3-lead-be-architect)
4. [Lead FE Integration — Surface Coordination](#4-lead-fe-integration)
5. [Sr Design FE — Kaizen UX](#5-sr-design-fe)
6. [Sr Automation QA — Test Matrix](#6-sr-automation-qa)
7. [SRE/SDET — Observability & CI Gates](#7-sresdet)
8. [DevOps — Infrastructure & Pipeline](#8-devops)
9. [3-Tier Feature Flag Model](#9-3-tier-feature-flag-model)
10. [Recommended Stories (Priority Order)](#10-recommended-stories)

---

## 1. Current 7-Card Architecture

The admin shell follows a **flow-first** layout — cards are ordered by the operator's natural workflow, not by technical importance.

| # | Card | ID | Color | Purpose | Mobile |
|---|------|----|-------|---------|--------|
| 1 | Event Basics | `card1EventBasics` | Green `#10b981` | Confirmation of created event — name, date, venue | Always expanded |
| 2 | Sponsors | `card2Sponsors` | Purple `#c026d3` | Sponsor exposure map, analytics link generation | Collapsed |
| 3 | Sign-Up Forms | `card3SignUp` | Teal `#059669` | Form config (register, checkin, walkin, survey), Google Forms creation | Always expanded |
| 4 | Poster Page | `card4Poster` | Orange `#d97706` | Print-ready link + QR preview | Collapsed |
| 5 | TV Display | `card5Display` | Blue `#2563eb` | Bar TV link + fullscreen tip + settings | Collapsed |
| 6 | Public Page | `card6PublicPage` | Green `#16a34a` | Customer-facing link + QR + social sharing | Always expanded |
| 7 | Shared Report | `card7Report` | Purple `#7c3aed` | Post-event analytics report link | Collapsed |
| — | Advanced Tools | `cardDiagnostics` | Gray `#94a3b8` | Event ID, NU transport logs, debug toggle | Collapsed |

### Supporting Flows (hidden sections, shown on demand)

| Section | Trigger | Purpose |
|---------|---------|---------|
| `signupCard` | Card 3 "Configure Forms" | Register/checkin/walkin/survey URL inputs |
| `formsCard` | Card 3 "Create Google Forms" | Google Forms template creation (check-in, walk-in, survey) |
| `displayCard` | Card 5 "Settings" | TV display mode (public vs slideshow), URL rotation config |
| Wizard (5-step) | New event creation | Guided onboarding: basics → template → signup → links → launch checklist |
| Happy Path Checklist | Post-creation | "1 of 6 done" progress tracker linking to each card |

### Data Flow

```
Admin.html → Worker API v2 → Google Sheets (Phase 1) / D1 (Phase 2)
     ↓                ↓
  QR codes      event.links.* (publicUrl, displayUrl, posterUrl, reportUrl)
     ↓                ↓
  Poster       Public / Display / SharedReport surfaces
```

### Current Modular Components

| Module | File | Key Functions |
|--------|------|---------------|
| Events | `AdminEvents.html` | `loadExistingEvents()`, `fetchAdminBundleFromWorker()`, `createEventViaWorker()` |
| Forms | `AdminForms.html` | `configureSignup()`, `createFormTemplate()`, `saveAllSignupForms()` |
| Display | `AdminDisplay.html` | `configureDisplay()`, `renderSponsors()`, `saveDisplayConfig()` |
| Templates | `AdminTemplates.html` | `loadTemplates()`, `selectTemplate()`, `applySectionDefaults()` |
| Diagnostics | `AdminDiagnostics.html` | `initDiagnosticsPanel()`, `refreshDiagLogs()`, `toggleDiagDebugMode()` |
| API Client | `AdminApiClient.html` | `getToken()`, `authenticatedFetch()` |
| Styles | `Styles.html` | CSS custom properties, mobile-first responsive design |
| Design Adapter | `DesignAdapter.html` | Brand-specific theming overrides |

---

## 2. PO Evaluation — Use Cases & Acceptance Criteria

### What Works Today (MVP Strengths)

- **3-field event creation** — name, date, venue. Bar-owner friendly copy throughout
- **Wizard onboarding** — 5-step guided flow from zero to live event
- **Happy Path Checklist** — "1 of 6 done" drives completion without confusion
- **Copy Link / Open / Show QR** pattern — consistent across Cards 4, 5, 6, 7
- **Sponsor exposure map** — clear visual showing where logos appear across surfaces
- **Mobile-collapsible cards** — Cards 2, 4, 5, 7 collapse on mobile to reduce scroll fatigue
- **Template system** — event types (rec league, open table, etc.) with section defaults

### Use Cases Identified (Missing or Incomplete)

| Use Case | Current State | Gap | Tier |
|----------|---------------|-----|------|
| **UC-1: Self-serve event config** | Admin-only, no client portal | No self-serve mode for mid/enterprise clients | Mid |
| **UC-2: Native form hosting** | Google Forms dependency (external) | No built-in registration, checkin, survey forms | Mid |
| **UC-3: File upload** (logos, posters) | URL-only input for images | No direct upload to R2/CDN | Enterprise |
| **UC-4: White-label branding** | Single brand theme via `DesignAdapter` | No per-event custom colors/logos/domains | Enterprise |
| **UC-5: Anonymous attendee tracking** | No anonymous ID system | Can't correlate QR scans to return visitors without PII | Free |
| **UC-6: PII data lifecycle** | No destruction jobs, no retention policy | GDPR/CCPA risk — form data lives forever | All |
| **UC-7: Email signup collection** | Not implemented (schema has `subscribers` table) | D1 migration ready but no UI | Mid |
| **UC-8: Post-event survey** | Google Forms link only | No native survey with analytics | Mid |
| **UC-9: Multi-event dashboard** | Dropdown selector per event | No aggregate view across events | Mid |
| **UC-10: Sponsor ROI report** | SharedReport has basic metrics | No click-through attribution, no conversion funnel | Enterprise |

### Privacy & Compliance Requirements

| Requirement | Status | Action Needed |
|-------------|--------|---------------|
| PII minimization | ❌ Not enforced | Collect only what's needed per form type |
| Data retention policy | ❌ None | Define retention windows (30/90/365 days) |
| Destruction jobs | ❌ Not built | Scheduled D1 cleanup + audit log |
| Consent tracking | ❌ Not captured | Checkbox + timestamp on every form submit |
| Right to deletion | ❌ No mechanism | API endpoint for PII scrub by anonymous ID |
| Data export | ❌ Not available | CSV/JSON export for event organizer |

### Business Case Priority

1. **Forms** — highest-value gap. Every event needs registration. Google Forms dependency is a churn risk and UX friction point
2. **Feature flags / tier gating** — unlocks monetization. Can't sell mid/enterprise without gating features
3. **PII lifecycle** — compliance blocker. Must ship before enterprise clients
4. **Anonymous ID** — enables the triangle (Events ↔ Sponsors ↔ Customers) without storing PII
5. **Self-serve** — reduces manual onboarding (OurPulse cost center)

---

## 3. Lead BE Architect — API, DB, Auth, Testing

### Current API Surface (Admin-relevant)

```
POST   /api/v2/admin/events                    → Create event
PUT    /api/v2/admin/events/:id                → Update event
POST   /api/v2/admin/events/:id/default        → Set default event
POST   /api/v2/admin/events/:id/archive        → Archive event
POST   /api/v2/admin/events/:id/verify-qr      → Verify QR scan
POST   /api/v2/admin/events/:id/uploads        → File upload → R2
GET    /api/v2/events                           → List events
GET    /api/v2/events/:id                       → Single event
GET    /api/v2/sponsors                         → List sponsors
GET    /api/v2/sponsor/:id                      → Sponsor detail
GET    /api/v2/sponsor/:id/monetization         → Sponsor monetization hooks
GET    /api/v2/sharedreport?eventId=:id         → Shared report data
```

### New API Contracts Needed (Per Form Type)

| Endpoint | Method | Tier | Purpose |
|----------|--------|------|---------|
| `POST /api/v2/forms/:eventId/register` | POST | Free | Submit registration (name, email, phone optional) |
| `POST /api/v2/forms/:eventId/checkin` | POST | Free | Check-in at door (anonymous ID or name) |
| `POST /api/v2/forms/:eventId/survey` | POST | Mid | Post-event survey submission |
| `POST /api/v2/forms/:eventId/email-signup` | POST | Mid | Email list signup |
| `GET /api/v2/forms/:eventId/config` | GET | Free | Get form config (which forms enabled, field config) |
| `PUT /api/v2/admin/forms/:eventId/config` | PUT | Mid | Update form config (self-serve) |
| `GET /api/v2/forms/:eventId/count` | GET | Free | Registration/checkin counts (no PII) |
| `DELETE /api/v2/admin/forms/:eventId/pii` | DELETE | All | PII scrub (destruction job trigger) |
| `GET /api/v2/admin/forms/:eventId/export` | GET | Mid | CSV/JSON export of form data |
| `GET /api/v2/admin/flags/:brandId` | GET | All | Feature flags for brand/tier |
| `PUT /api/v2/admin/flags/:brandId` | PUT | Enterprise | Override flags per event |

### DB Design — Forms (Separate D1 Database)

Migrations already exist in `migrations-forms/`:
- `0001_create_form_registrations.sql` — registrations table
- `0002_create_checkin_counts.sql` — checkin aggregates
- `0003_create_form_surveys.sql` — survey responses
- `0004_create_email_signups.sql` — email subscribers
- `0005_create_forms_indexes.sql` — performance indexes
- `0006_create_form_config.sql` — per-event form configuration
- `0007_seed_free_tier_flags.sql` — default free tier flags

**New migrations needed:**

```sql
-- 0008: Anonymous ID support
CREATE TABLE anonymous_ids (
  anon_id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  scan_count INTEGER DEFAULT 0
);
CREATE INDEX idx_anon_brand ON anonymous_ids(brand_id);

-- 0009: PII destruction audit log
CREATE TABLE pii_destruction_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  records_scrubbed INTEGER NOT NULL,
  triggered_by TEXT NOT NULL,        -- 'scheduled' | 'manual' | 'retention_policy'
  retention_days INTEGER,
  executed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 0010: Feature flag tiers
CREATE TABLE feature_tiers (
  brand_id TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free', -- 'free' | 'mid' | 'enterprise'
  flag_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  event_id TEXT,                     -- NULL = global, set = event-level override
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (brand_id, flag_key, COALESCE(event_id, '__global__'))
);
```

### Authentication Model

| Layer | Current | Needed |
|-------|---------|--------|
| Admin API | Bearer token (single shared) | Per-brand tokens, eventual OAuth (Phase 3) |
| Form submit | None (public endpoint) | Anonymous ID cookie + rate limiting |
| Self-serve | Not available | Scoped token per client (mid tier) |
| Enterprise | Not available | Cloudflare Access JWT + role claims |

### Testing Strategy

| Test Type | Current Coverage | Needed |
|-----------|-----------------|--------|
| Unit (Jest) | Admin auth, create, update, archive | Form submit handlers, PII scrub, flag resolution |
| Contract (Pact) | Kill-switch feature flags | Form submit/response contracts, tier flag contracts |
| Integration | Worker ↔ Sheets | Worker ↔ D1 forms DB, flag resolution chain |
| Postman/Newman | Smoke collection exists | E2E chaining: create event → configure form → submit → verify count → export → scrub |

### Feature Flag Architecture

```
Request → Worker middleware → resolve tier for brand
  ↓
  flag_key lookup: feature_tiers table
  ↓
  Resolution order:
    1. Event-level override (enterprise only)
    2. Brand-level setting
    3. Tier default (from seed data)
    4. Global default (free tier)
```

### Performance Targets

| Operation | Phase 1 (Sheets) | Phase 2 (D1) | Target |
|-----------|-------------------|---------------|--------|
| Form submit | N/A | < 50ms | < 100ms p99 |
| Count query | N/A | < 5ms | < 20ms p99 |
| Flag resolve | In-memory | < 2ms | < 5ms p99 |
| PII scrub | N/A | < 500ms (batch) | < 1s p99 |
| Admin bundle load | 200-800ms | < 50ms | < 100ms p99 |

---

## 4. Lead FE Integration — Surface Coordination

### How Admin Drives Every Surface

Admin.html is the **control room** — every surface reads from what Admin writes:

```
Admin.html (writes event)
  ├── public.html    ← event.links.publicUrl (Card 6)
  ├── display.html   ← event.links.displayUrl (Card 5)
  ├── poster.html    ← event.links.posterUrl (Card 4)
  ├── sharedReport   ← event.links.reportUrl (Card 7)
  └── forms (new)    ← QR → form routing (Card 3)
```

### Current Integration Points (What Works)

| Surface | Admin Card | Link Generation | QR Code | Copy Button | Open Button |
|---------|-----------|-----------------|---------|-------------|-------------|
| Public | Card 6 | ✅ `lnkPublic` | ✅ `qrPublicPreview` | ✅ | ✅ |
| Display | Card 5 | ✅ `lnkDisplay` | ❌ No QR | ✅ | ✅ |
| Poster | Card 4 | ✅ `lnkPoster` | ✅ `qrPosterPreview` | ✅ | ✅ |
| Report | Card 7 | ✅ `lnkReport` | ⚠️ Hidden `qrSharedReport` | ✅ | ✅ |
| Forms | Card 3 | ⚠️ External Google Forms only | ❌ | ❌ | ❌ |

### QR → Form Routing (New — Critical Path)

The biggest FE gap: **Card 3 has no native form rendering**. Currently:
1. User creates a Google Form externally
2. Pastes URL into admin
3. Admin generates a shortlink
4. QR code on poster/public points to Google Forms

**Needed:** Native form rendering on the public surface, with QR codes routing directly to embedded forms.

```
QR Scan → /e/:slug/register  → public.html (embedded form)
QR Scan → /e/:slug/checkin   → public.html (checkin mode)
QR Scan → /e/:slug/survey    → public.html (post-event survey)
```

### Integration Testing Points (FE ↔ BE)

| Integration | Current | Needed |
|-------------|---------|--------|
| Admin → Worker (create event) | ✅ Tested | — |
| Admin → Worker (update event) | ✅ Tested | — |
| Admin → Public (link works) | ✅ E2E smoke | — |
| Admin → Display (link works) | ✅ E2E smoke | — |
| Admin → Poster (link works) | ✅ E2E smoke | — |
| Admin → Report (link works) | ✅ E2E smoke | — |
| Admin → Form config → Public form render | ❌ Not built | E2E: configure form in admin → submit on public → verify count in admin |
| Admin → Flag toggle → Surface gating | ❌ Not built | E2E: disable feature → verify surface hides it |
| Admin → Sponsor config → All surfaces render | ⚠️ Partial | Full cross-surface sponsor visibility test |
| Form submit → Anonymous ID → Report attribution | ❌ Not built | E2E: submit form → verify anon ID → check report |

### Feature Flag UI on Admin (New)

Admin needs a **tier-aware settings panel** (per Card 1 or new Card 0):

```
Free tier:  Grayed-out locked icons on mid/enterprise features
Mid tier:   Self-serve toggles for forms.survey, forms.email-signup, config.self-serve
Enterprise: Full flag control panel with per-event overrides
```

### Doc Rendering Across Surfaces

| Surface | Rendering Need | Current | Gap |
|---------|---------------|---------|-----|
| Public (mobile) | Registration form, event info | ✅ Event info | ❌ No native forms |
| Poster (print) | QR codes, sponsor logos | ✅ Complete | — |
| Display (TV/tablet) | Sponsor rotation, event info | ✅ Complete | — |
| Table top (new) | QR tent card, mini-poster | ❌ Not built | New surface variant of poster |
| SharedReport | Sponsor metrics, funnel | ✅ Basic | ❌ No click attribution |

---

## 5. Sr Design FE — Kaizen UX

### What's Good (Keep)

- **Flow-first card order** — matches mental model of a bar owner setting up an event
- **Mobile-first responsive** — safe-area support, collapsible cards, `env(safe-area-inset-*)`
- **Consistent action pattern** — every card has Copy Link / Open / secondary actions
- **Warm, approachable color palette** — each card has distinct identity via border-left color
- **Wizard onboarding** — new users don't see 7 cards cold; guided 5-step flow
- **Happy Path Checklist** — gamification drives completion
- **Emoji icons** — fast visual scanning without icon library overhead

### What Needs Improvement (Kaizen Backlog)

#### UX Issues Found

| Issue | Severity | Card(s) | Recommendation |
|-------|----------|---------|----------------|
| **13K-line monolith** — slow initial parse on low-end devices | High | All | Progressive loading: core shell first, lazy-load card bodies |
| **Heavy inline styles** — 500+ inline `style=` attributes | High | All | Extract to CSS classes; use design tokens consistently |
| **No loading states** — cards appear empty then populate | Medium | 1-7 | Skeleton loaders per card while admin bundle loads |
| **No error states per card** — only global toast | Medium | 1-7 | Inline error messaging within each card |
| **Card 3 (Forms) dead end** — "Configure Forms" opens hidden section, no visual connection | Medium | 3 | Slide-open inline or modal, not hidden scroll-away section |
| **Card 5 (Display) no QR code** — only surface without QR preview | Low | 5 | Add QR preview matching Cards 4 and 6 |
| **Card 7 (Report) QR hidden** — `display:none` by default | Low | 7 | Show QR inline like Card 6 |
| **No confirmation feedback** — "Copy Link" has no visual feedback | Medium | 4-7 | Toast + button text change ("Copied!") for 2 seconds |
| **Wizard step 3 UX** — form config options confusing (have/need/create) | Medium | Wizard | Simplify to 2 options: "I have a form" / "Create one for me" |
| **No "last updated" indicator** — user can't tell if data is stale | Low | 1 | Timestamp on Card 1 showing last sync |

#### Color Palette Audit

Current card colors are distinct but not from a unified system:

| Card | Current Color | Token Needed |
|------|--------------|--------------|
| 1 Event | `#10b981` (emerald-500) | `--card-event` |
| 2 Sponsors | `#c026d3` (fuchsia-600) | `--card-sponsor` |
| 3 Forms | `#059669` (emerald-600) | `--card-form` |
| 4 Poster | `#d97706` (amber-600) | `--card-poster` |
| 5 Display | `#2563eb` (blue-600) | `--card-display` |
| 6 Public | `#16a34a` (green-600) | `--card-public` |
| 7 Report | `#7c3aed` (violet-600) | `--card-report` |

**Recommendation:** Formalize as CSS custom properties in Styles.html. Cards 1 and 3 are both greens — differentiate or unify.

#### Mobile-First Form UX (New Forms)

For native forms (replacing Google Forms dependency):

- **Single-column layout** on mobile — no side-by-side fields
- **Large tap targets** — minimum 48px touch targets (current buttons are close)
- **Progressive disclosure** — required fields first, optional behind "More info" toggle
- **Inline validation** — real-time feedback, not submit-then-error
- **Auto-advance** — after last required field, show submit button with pulse animation
- **Success state** — clear confirmation with next action ("You're registered! See you at [event]")

#### Test-ID Strategy (Automation-Friendly)

Current state: `data-testid` exists on some elements but inconsistently. Needed:

```
data-testid="card{N}-{action}"     → e.g., "card3-configure-forms"
data-testid="form-{type}-{field}"  → e.g., "form-register-email"
data-testid="wizard-step-{N}"      → already exists ✅
data-testid="flag-{key}"           → e.g., "flag-forms-survey"
```

**Rule:** Every interactive element gets a `data-testid`. Never use CSS classes or DOM structure for selectors. Test-ids survive redesigns.

---

## 6. Sr Automation QA — Test Matrix

### Current Test Coverage

| Suite | Files | Focus | Status |
|-------|-------|-------|--------|
| `tests/e2e/1-smoke/admin-seven-cards.spec.js` | 1 | 7-card visibility after event creation | ✅ |
| `tests/e2e/2-pages/admin-page.spec.js` | 1 | Page load, form elements | ✅ |
| `tests/e2e/3-flows/admin-wizard-flow.spec.js` | 1 | Wizard step-through | ✅ |
| `tests/e2e/3-flows/admin-flows.spec.js` | 1 | Event lifecycle flows | ✅ |
| `tests/e2e/admin-mobile-polish.spec.js` | 1 | Mobile collapsible cards | ✅ |
| `tests/e2e/admin-buttons.spec.js` | 1 | Button click handlers | ✅ |
| `tests/unit/worker/story3.1-adminAuth.test.js` | 1 | Auth guard unit tests | ✅ |
| `tests/unit/worker/story3.2-adminCreateEvent.test.js` | 1 | Create event handler | ✅ |
| `tests/smoke/admin-create-event.spec.ts` | 1 | Smoke: create flow | ✅ |
| `tests/smoke/admin-archive-event.spec.ts` | 1 | Smoke: archive flow | ✅ |
| `tests/ui/smoke/admin.smoke.spec.ts` | 1 | UI smoke | ✅ |
| `tests/ui/smoke/admin-diagnostics.smoke.spec.ts` | 1 | Diagnostics panel | ✅ |

### New Tests Needed (Per Form Type)

#### API Tests (Jest/Vitest)

| Test | Form Type | Assertions |
|------|-----------|------------|
| `form-register-submit.test` | Registration | 201 response, count incremented, PII stored in forms DB |
| `form-checkin-submit.test` | Check-in | 201 response, anon ID issued/updated, count incremented |
| `form-survey-submit.test` | Survey | 201 response, mid-tier flag required, 403 if free tier |
| `form-email-signup.test` | Email signup | 201 response, mid-tier flag required, duplicate detection |
| `form-count-verify.test` | All | GET count matches POST count, no PII leaked |
| `form-pii-scrub.test` | All | DELETE endpoint scrubs PII, count preserved, audit log written |
| `form-export.test` | All | GET export returns CSV/JSON, mid-tier required |
| `flag-resolve.test` | N/A | Tier resolution: event > brand > tier-default > global |
| `flag-gate.test` | N/A | Disabled flag returns 403 with upgrade prompt |

#### Playwright E2E (Per Form Type)

| Test | Flow | Assertions |
|------|------|------------|
| `admin-configure-register-form.spec` | Admin → Card 3 → Configure → Save | Form config saved, QR generated |
| `public-submit-registration.spec` | QR scan → Public → Fill form → Submit | Success message, count +1 |
| `admin-verify-registration-count.spec` | Admin → Card 3 → Check count | Count matches submissions |
| `admin-export-form-data.spec` | Admin → Export → Download | CSV contains expected rows |
| `admin-scrub-pii.spec` | Admin → Advanced → Scrub PII | Count preserved, PII gone, audit log |
| `cross-surface-sponsor-visibility.spec` | Admin → Add sponsor → Check all surfaces | Sponsor appears on public, display, poster per placement config |
| `tier-gate-upgrade-prompt.spec` | Free tier → Click survey → See upgrade | Locked icon + "Upgrade to Mid" message |

#### Edge Cases

| Case | Test |
|------|------|
| Double submit (race condition) | Idempotency key on form submit |
| Form submit after event archived | 410 Gone response |
| QR scan for non-existent event | 404 with friendly message |
| PII scrub while form is being submitted | Conflict handling |
| Feature flag change mid-session | Client-side flag refresh |

---

## 7. SRE/SDET — Observability & CI Gates

### CI/CD Gates for Form Deployment

| Gate | Trigger | Blocks Deploy If |
|------|---------|-----------------|
| Schema validation | Every PR | `event.schema.json` or form migrations invalid |
| Flag seed parity | Every PR | `0007_seed_free_tier_flags.sql` doesn't match flag definitions |
| Form API contract test | Every PR | Request/response shapes don't match OpenAPI spec |
| PII scrub test | Every PR | Scrub leaves PII in any column |
| Bundle size check | Every PR | `admin.html` exceeds 500KB (currently 438KB) |
| Lighthouse mobile score | Weekly | Performance < 60, Accessibility < 90 |
| axe-core violations | Every PR (after A11Y-7) | Any critical/serious violations |

### Observability — Form Submission Rates

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| `form.submit.count` | Worker handler | Spike: >10x baseline in 5 min (abuse) |
| `form.submit.latency_p99` | Worker handler | > 500ms |
| `form.submit.error_rate` | Worker handler | > 5% over 5 min |
| `pii.scrub.count` | Destruction job | Log every execution |
| `pii.scrub.failure` | Destruction job | Any failure → PagerDuty |
| `flag.resolve.cache_miss` | Flag middleware | > 20% miss rate (cache config issue) |
| `admin.bundle.latency_p99` | Worker handler | > 2s (Sheets regression) |

### Destruction Job Monitoring

```
Scheduled trigger (Cloudflare Cron):
  every 24h → scan events where:
    - event.status = 'archived'
    - event.updatedAt < NOW() - retention_days
  → execute PII scrub
  → write to pii_destruction_log
  → emit metric: pii.scrub.count
```

| Job | Schedule | Monitoring |
|-----|----------|------------|
| PII scrub (archived events) | Daily 03:00 UTC | Success/failure metric + audit log |
| PII scrub (retention policy) | Daily 03:00 UTC | Records affected count |
| Orphan anonymous ID cleanup | Weekly Sunday 04:00 UTC | Count of orphaned records |

---

## 8. DevOps — Infrastructure & Pipeline

### Current State

| Component | Status | Notes |
|-----------|--------|-------|
| GitHub Actions CI | ✅ Running | TypeScript checks, test suite on every PR |
| Cloudflare Worker | ✅ Code ready | Not deployed (P1-7 in progress) |
| Google Sheets (Phase 1) | ⚠️ Pending | SA credentials not provisioned |
| D1 Main DB | 📋 Migrations ready | 9 migration files, not provisioned |
| D1 Forms DB | 📋 Migrations ready | 7 migration files, not provisioned |
| R2 Storage | 📋 Planned | File uploads (enterprise tier) |
| Cloudflare Cron | 📋 Planned | PII destruction jobs |

### Separate DB Provisioning (Forms)

**Why separate:** Forms data has different lifecycle (PII, retention, destruction) than event config data. Separate D1 databases enable independent backup, retention, and compliance policies.

```
D1 Main DB (oursharedevents-main)
├── events
├── sponsors
├── poster_deployments
├── scans
├── scan_aggregates
└── subscribers

D1 Forms DB (oursharedevents-forms)
├── form_registrations
├── checkin_counts
├── form_surveys
├── email_signups
├── form_config
├── anonymous_ids        (new)
├── pii_destruction_log  (new)
└── feature_tiers        (new)
```

### Form Service Config

```toml
# wrangler.toml additions
[[d1_databases]]
binding = "FORMS_DB"
database_name = "oursharedevents-forms"
database_id = "<provisioned-id>"

[triggers]
crons = ["0 3 * * *"]  # Daily PII scrub at 03:00 UTC
```

### CI/CD Pipeline for Form Releases

```
PR opened
  → lint + typecheck
  → unit tests (form handlers)
  → contract tests (form API shapes)
  → schema validation
  → flag seed parity check
  → bundle size gate

PR merged to main
  → deploy to staging
  → run D1 forms migrations (staging)
  → E2E: create event → configure form → submit → verify count
  → smoke: PII scrub dry run

Tag vX.Y.Z
  → deploy to production
  → run D1 forms migrations (production)
  → post-deploy smoke
  → monitor form.submit.error_rate for 15 min
```

### Feature Flag Deployment Safety

```
New flag added:
  1. Add to 0007_seed_free_tier_flags.sql (default: OFF)
  2. Add to flag definitions in worker/src/lib/feature-flags.ts
  3. CI gate: seed ↔ definition parity check
  4. Deploy: flag exists but OFF
  5. Enable via admin API (no redeploy needed)
  6. Monitor: flag.resolve metrics
```

---

## 9. 3-Tier Feature Flag Model

### Tier Definitions

```
Free tier (default — every new brand starts here)
├── forms.register          ✓ ON   ← core value prop
├── forms.checkin           ✓ ON   ← core value prop
├── forms.survey            ✗ OFF
├── forms.email-signup      ✗ OFF
├── config.self-serve       ✗ OFF
├── assets.file-upload      ✗ OFF
└── branding.white-label    ✗ OFF

Mid tier (brand-level upgrade)
├── forms.survey            ✓ ON   ← post-event feedback
├── forms.email-signup      ✓ ON   ← list building
├── config.self-serve       ✓ ON   ← client manages own event settings
├── assets.file-upload      ✗ OFF
└── branding.white-label    ✗ OFF

Enterprise tier (event-level control)
├── config.self-serve       ✓ ON
├── assets.file-upload      ✓ ON   ← upload logos, posters, custom QR
├── branding.white-label    ✓ ON   ← their brand, their colors, their domain
└── (any flag per event)    ✓ ON   ← full per-event override control
```

### Resolution Chain

```
isFeatureEnabled(brandId, flagKey, eventId?)
  │
  ├── 1. Event-level override? (enterprise only)
  │     → SELECT enabled FROM feature_tiers
  │       WHERE brand_id = ? AND flag_key = ? AND event_id = ?
  │
  ├── 2. Brand-level setting?
  │     → SELECT enabled FROM feature_tiers
  │       WHERE brand_id = ? AND flag_key = ? AND event_id IS NULL
  │
  ├── 3. Tier default?
  │     → Look up brand's tier → apply tier defaults
  │
  └── 4. Global default (free tier)
        → Return free tier default for flag_key
```

### Admin UI Integration

**Card 1 (Event Basics)** gains a tier badge:

```html
<span class="tier-badge tier-free">Free</span>
<span class="tier-badge tier-mid">Pro</span>
<span class="tier-badge tier-enterprise">Enterprise</span>
```

**Card 3 (Forms)** gains gated sections:

```
┌─ Sign-Up Forms ──────────────────────────┐
│  ✅ Registration (free)     [Configure]  │
│  ✅ Check-In (free)         [Configure]  │
│  🔒 Survey (mid)            [Upgrade →]  │
│  🔒 Email Signup (mid)      [Upgrade →]  │
└──────────────────────────────────────────┘
```

**New: Settings Card** (enterprise self-serve):

```
┌─ Event Settings ─────────────────────────┐
│  Toggle: Show schedule    [ON/OFF]       │
│  Toggle: Show standings   [ON/OFF]       │
│  Toggle: Show sponsors    [ON/OFF]       │
│  Toggle: Show QR section  [ON/OFF]       │
│  🔒 Custom branding       [Upgrade →]   │
└──────────────────────────────────────────┘
```

### Flag Seed Data (D1)

```sql
-- Free tier defaults (brand_id = '__default__', event_id = NULL)
INSERT INTO feature_tiers VALUES ('__default__', 'free', 'forms.register', 1, NULL, datetime('now'));
INSERT INTO feature_tiers VALUES ('__default__', 'free', 'forms.checkin', 1, NULL, datetime('now'));
INSERT INTO feature_tiers VALUES ('__default__', 'free', 'forms.survey', 0, NULL, datetime('now'));
INSERT INTO feature_tiers VALUES ('__default__', 'free', 'forms.email-signup', 0, NULL, datetime('now'));
INSERT INTO feature_tiers VALUES ('__default__', 'free', 'config.self-serve', 0, NULL, datetime('now'));
INSERT INTO feature_tiers VALUES ('__default__', 'free', 'assets.file-upload', 0, NULL, datetime('now'));
INSERT INTO feature_tiers VALUES ('__default__', 'free', 'branding.white-label', 0, NULL, datetime('now'));
```

---

## 10. Recommended Stories — MVP vs V2 Priority

> **Principle:** MVP ships what makes the admin usable for a bar owner running their first event.
> V2 ships what makes the admin scalable for paying clients. Some V2 items are **pulled forward**
> when they directly fix usability friction — tagged `V2↑MVP` (V2 scope, MVP urgency).

### Release Tags

| Tag | Meaning | Ships When |
|-----|---------|------------|
| `MVP` | Must have for launch — admin doesn't work without it | Phase 1-2 |
| `MVP-UX` | Not blocking, but users will struggle without it — ship same sprint | Phase 1-2 |
| `V2↑MVP` | V2 scope pulled forward because it fixes real usability pain | With MVP |
| `V2` | Post-launch enhancement — valuable but not blocking | Phase 2-3 |
| `V2-ENT` | Enterprise tier — revenue feature, not usability | Phase 3+ |

---

### Sprint 1: MVP Core — "Admin Works End to End"

*Goal: An operator can create an event, get all links, and see them work across surfaces.*

| # | Story ID | Title | Tag | Prereq | Est |
|---|----------|-------|-----|--------|-----|
| 1 | **ADMIN-15** | Copy button feedback ("Copied!" 2s state) | `MVP-UX` | — | 2h |
| 2 | **ADMIN-14** | Card 5 QR code + Card 7 QR visibility | `MVP-UX` | — | 2h |
| 3 | **ADMIN-16** | data-testid complete coverage (all interactive elements) | `MVP` | — | 4h |
| 4 | **ADMIN-13** | Skeleton loaders + per-card error states | `MVP-UX` | — | 4h |
| 5 | **ADMIN-20** | Cross-surface sponsor integration test suite | `MVP` | — | 1 sp |

**Why this order:** These have zero dependencies — ship immediately. ADMIN-15/14 are the most visible user-facing friction. ADMIN-16 unblocks all QA automation. ADMIN-13 fixes the "blank screen then pop" first impression. ADMIN-20 validates that the sponsor money-maker actually renders everywhere it claims to.

**Gate:** All 7 cards render, all copy buttons give feedback, all link cards have QR codes, every interactive element has a test-id, skeleton states show during load.

---

### Sprint 2: MVP Foundation — "Flags + Forms Scaffolding"

*Goal: Feature flag system works. Native forms have API contracts. Card 3 stops being a dead end.*

| # | Story ID | Title | Tag | Prereq | Est |
|---|----------|-------|-----|--------|-----|
| 6 | **ADMIN-1** | Feature flag tier model (D1 + API + resolution chain) | `MVP` | P2-1 | 1 sp |
| 7 | **ADMIN-3** | Native registration form (submit endpoint, count, public render) | `MVP` | ADMIN-1 | 1 sp |
| 8 | **ADMIN-4** | Native check-in form (door mode, anonymous ID foundation) | `MVP` | ADMIN-3 | 1 sp |
| 9 | **ADMIN-5** | Card 3 redesign — inline form config replaces hidden scroll-away | `V2↑MVP` | ADMIN-4 | 1 sp |

**Why ADMIN-5 is V2↑MVP:** Card 3 currently opens a hidden section that scrolls away from context. Users lose their place. This is the #1 usability complaint in the wizard flow. Pulling it forward because the form cards are useless if operators can't find the config.

**Gate:** `POST /api/v2/forms/:eventId/register` returns 201. Count endpoint works. Card 3 shows inline config. Feature flags resolve from D1 with correct tier cascade.

---

### Sprint 3: MVP Forms Complete — "The Triangle Closes"

*Goal: Events ↔ Sponsors ↔ Customers triangle works. QR → form → count → report pipeline.*

| # | Story ID | Title | Tag | Prereq | Est |
|---|----------|-------|-----|--------|-----|
| 10 | **ADMIN-6** | Anonymous ID system (cookie + D1, scan correlation) | `MVP` | ADMIN-4 | 1 sp |
| 11 | **ADMIN-7** | PII destruction jobs (scheduled scrub, audit log, retention) | `MVP` | ADMIN-3 | 1 sp |
| 12 | **ADMIN-2** | Admin tier badge + gated UI (locked icons, upgrade prompts) | `MVP-UX` | ADMIN-1 | 1 sp |
| 13 | **ADMIN-19** | Newman E2E chain (create → config → submit → count → scrub) | `MVP` | ADMIN-3, ADMIN-7 | 1 sp |

**Why ADMIN-6 is MVP not V2:** Without anonymous ID, the entire triangle model is broken. Sponsors can't see customer engagement. Reports show zero attribution. This is the data backbone.

**Why ADMIN-7 is MVP:** Can't store form submissions without a destruction policy. Compliance blocker — no PII storage without a deletion path.

**Gate:** QR scan → form submit → anonymous ID created → count incremented → PII scrub works → audit log written. Newman chain passes end-to-end.

---

### Sprint 4: MVP Polish — "CSS Debt + Quality"

*Goal: Admin is fast, consistent, and ready for real users.*

| # | Story ID | Title | Tag | Prereq | Est |
|---|----------|-------|-----|--------|-----|
| 14 | **ADMIN-12** | Admin inline styles → CSS tokens extraction | `V2↑MVP` | — | 1 sp |

**Why ADMIN-12 is V2↑MVP:** 500+ inline styles make the page slow to parse on mobile and impossible to theme. Every future card change requires hunting through HTML. This is tech debt that compounds — paying it now makes Sprints 5-8 faster.

**Gate:** Zero inline `style=` attributes on card shells. All colors from CSS custom properties. Lighthouse performance score ≥ 70 on mobile.

---

### Sprint 5: V2 Mid Tier — "Monetization Unlocked"

*Goal: Mid-tier clients get survey, email signup, self-serve, export. Revenue starts.*

| # | Story ID | Title | Tag | Prereq | Est |
|---|----------|-------|-----|--------|-----|
| 15 | **ADMIN-8** | Native survey form (mid-tier gated, post-event) | `V2` | ADMIN-1, ADMIN-3 | 1 sp |
| 16 | **ADMIN-9** | Email signup form (mid-tier gated, duplicate detection) | `V2` | ADMIN-1, ADMIN-3 | 1 sp |
| 17 | **ADMIN-10** | Self-serve event config (mid-tier, scoped token) | `V2` | ADMIN-1 | 1 sp |
| 18 | **ADMIN-11** | Form data export (CSV/JSON, mid-tier) | `V2` | ADMIN-3 | 0.5 sp |

**Gate:** Free tier user sees locked icons with "Upgrade to Pro" on survey/email. Mid-tier user can configure, submit, and export. Self-serve token scopes enforced.

---

### Sprint 6-7: V2 Enterprise — "White Glove"

*Goal: Enterprise clients get full control — file upload, branding, per-event overrides.*

| # | Story ID | Title | Tag | Prereq | Est |
|---|----------|-------|-----|--------|-----|
| 19 | **ADMIN-17** | File upload to R2 (logos, posters, custom QR) | `V2-ENT` | ADMIN-1 | 1 sp |
| 20 | **ADMIN-18** | White-label branding (custom colors/logo/domain) | `V2-ENT` | ADMIN-1 | 2 sp |

**Gate:** Enterprise user uploads logo → appears on all surfaces. Custom color palette renders across public, display, poster. Per-event flag overrides work.

---

### Priority Matrix (Visual)

```
                    MVP IMPACT
                    ▲
                    │
    ADMIN-15 ●      │  ● ADMIN-3   ● ADMIN-7
    (copy btn)      │  (register)  (PII scrub)
                    │
    ADMIN-14 ●      │  ● ADMIN-4   ● ADMIN-6
    (QR parity)     │  (checkin)   (anon ID)
                    │
    ADMIN-13 ●      │  ● ADMIN-1   ● ADMIN-5 (V2↑)
    (skeletons)     │  (flags)     (card3 UX)
                    │
    ADMIN-16 ●      │  ● ADMIN-12 (V2↑)
    (test-ids)      │  (CSS tokens)
                    │
    ────────────────┼────────────────────────► EFFORT
    Low effort      │              High effort
                    │
                    │  ● ADMIN-8    ● ADMIN-17
                    │  (survey)     (upload)
                    │
                    │  ● ADMIN-9    ● ADMIN-18
                    │  (email)      (white-label)
                    │
                    V2 SCOPE
```

### Dependency Graph (MVP-first ordering)

```
Sprint 1 (no deps — ship now):
  ADMIN-15, ADMIN-14, ADMIN-16, ADMIN-13, ADMIN-20

Sprint 2 (foundation):
  ADMIN-1 (flags) ──→ ADMIN-3 (register) ──→ ADMIN-4 (checkin) ──→ ADMIN-5 (V2↑ card3)

Sprint 3 (triangle):
  ADMIN-4 ──→ ADMIN-6 (anon ID)
  ADMIN-3 ──→ ADMIN-7 (PII scrub)
  ADMIN-1 ──→ ADMIN-2 (tier badge)
  ADMIN-3 + ADMIN-7 ──→ ADMIN-19 (Newman chain)

Sprint 4 (polish):
  ADMIN-12 (CSS tokens — independent)

Sprint 5 (V2 mid):
  ADMIN-1 + ADMIN-3 ──→ ADMIN-8 (survey)
  ADMIN-1 + ADMIN-3 ──→ ADMIN-9 (email)
  ADMIN-1 ──→ ADMIN-10 (self-serve)
  ADMIN-3 ──→ ADMIN-11 (export)

Sprint 6-7 (V2 enterprise):
  ADMIN-1 ──→ ADMIN-17 (file upload)
  ADMIN-1 ──→ ADMIN-18 (white-label)
```

### Summary: What Ships When

| Release | Stories | User Impact |
|---------|---------|-------------|
| **MVP v1.0** (Sprints 1-3) | ADMIN-1,2,3,4,5,6,7,13,14,15,16,19,20 | Admin works end-to-end. Forms are native. Triangle closes. Compliance ready. |
| **MVP v1.1** (Sprint 4) | ADMIN-12 | Fast, themeable, maintainable. Unblocks all future UI work. |
| **V2 v2.0** (Sprint 5) | ADMIN-8,9,10,11 | Mid-tier revenue. Self-serve. Clients manage their own events. |
| **V2 v2.5** (Sprint 6-7) | ADMIN-17,18 | Enterprise. White-label. File upload. Full platform. |

### V2↑MVP Justification (Why 3 V2 items ship with MVP)

| Story | Original Tag | Pulled To | Justification |
|-------|-------------|-----------|---------------|
| **ADMIN-5** (Card 3 redesign) | V2 | MVP Sprint 2 | Card 3 config scrolls away — operators lose context. Forms are useless if you can't find the config. |
| **ADMIN-12** (CSS tokens) | V2 | MVP Sprint 4 | 500+ inline styles = slow mobile parse + impossible to theme. Every sprint after this is faster if we pay the debt now. |
| **ADMIN-2** (Tier badge UI) | V2 | MVP Sprint 3 | Without visible tier badges, operators don't know what they have access to. Locked features need visible "why" to drive upgrades. |

---

## Appendix: File Reference

| File | Purpose |
|------|---------|
| `cloudflare-proxy/templates/admin.html` | Main admin template (13,042 lines) |
| `src/mvp/Admin.html` | Legacy source template |
| `src/mvp/AdminEvents.html` | Event selector + Worker API module |
| `src/mvp/AdminForms.html` | Form config + Google Forms module |
| `src/mvp/AdminDisplay.html` | Display config + sponsor module |
| `src/mvp/AdminTemplates.html` | Template picker module |
| `src/mvp/AdminDiagnostics.html` | Diagnostics panel module |
| `schemas/event.schema.json` | Event contract (v1.0 frozen) |
| `workers/oursharedevents/migrations/` | D1 main migrations (9 files) |
| `migrations-forms/` | D1 forms migrations (7 files) |
| `config/feature-flags.js` | Feature flag definitions |
| `worker/src/lib/feature-flags.ts` | Worker-side flag resolution |
| `tests/e2e/1-smoke/admin-seven-cards.spec.js` | 7-card E2E smoke tests |
| `tests/e2e/3-flows/admin-wizard-flow.spec.js` | Wizard flow E2E |

---

*Generated by scrum team evaluation — all 7 roles represented. Each story satisfies PO acceptance criteria, BE route spec, FE UI spec, QA test matrix, SDET load targets, and DevOps deploy gates per CLAUDE.md §6.*
