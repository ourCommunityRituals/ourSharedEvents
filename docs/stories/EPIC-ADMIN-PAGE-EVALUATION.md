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
4. **Anonymous ID** — enables the triangle (Events (apex) ↔ Sponsors ↔ Customers, SharedReports (center)) without storing PII
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

*Goal: Events (apex) ↔ Sponsors ↔ Customers, SharedReports (center) triangle works. QR → form → count → report pipeline.*

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

### Sprint 4: MVP Platform — "The Art Institute Pitch"

*Goal: Survey, email signup, self-serve, and export ship NOW — not someday.
When you walk into the Art Institute 6 months from now, you show 6 months of live
survey data, an email list they built themselves, and a CSV export they downloaded
without calling support. That's a platform, not a prototype.*

| # | Story ID | Title | Tag | Prereq | Est |
|---|----------|-------|-----|--------|-----|
| 14 | **ADMIN-8** | Native survey form (post-event feedback, tier-aware) | `V2↑MVP` | ADMIN-1, ADMIN-3 | 1 sp |
| 15 | **ADMIN-9** | Email signup form (list building, duplicate detection) | `V2↑MVP` | ADMIN-1, ADMIN-3 | 1 sp |
| 16 | **ADMIN-10** | Self-serve event config (client manages own settings) | `V2↑MVP` | ADMIN-1 | 1 sp |
| 17 | **ADMIN-11** | Form data export (CSV/JSON download) | `V2↑MVP` | ADMIN-3 | 0.5 sp |

**Why V2↑MVP:** These were tagged V2 because they're "mid-tier" features. But the pitch isn't "we have forms" — the pitch is "we have 6 months of survey responses, an email list of 2,000 attendees, and here's the CSV." That data doesn't exist if these ship in V2. They need to be collecting data from day one.

**The Art Institute math:**
- MVP launches month 0
- 4 events/month × 6 months = 24 events
- 24 events × avg 80 attendees = ~1,920 survey responses
- 24 events × avg 30% email opt-in = ~576 email subscribers
- All exportable, all with anonymous ID attribution, all with PII lifecycle

Without Sprint 4 in MVP, you walk in with: "we can do forms." With Sprint 4: "here's what 24 events produced."

**Gate:** Survey form submits, gated by tier flag. Email signup deduplicates. Self-serve config saves without admin intervention. CSV export downloads with correct row count. All four form types show in Card 3 with tier-appropriate lock/unlock state.

---

### Sprint 5: MVP Polish — "CSS Debt + Quality"

*Goal: Admin is fast, consistent, and ready for scale.*

| # | Story ID | Title | Tag | Prereq | Est |
|---|----------|-------|-----|--------|-----|
| 18 | **ADMIN-12** | Admin inline styles → CSS tokens extraction | `V2↑MVP` | — | 1 sp |

**Why ADMIN-12 is V2↑MVP:** 500+ inline styles make the page slow to parse on mobile and impossible to theme. Every future card change requires hunting through HTML. This is tech debt that compounds — paying it now makes enterprise sprints faster.

**Gate:** Zero inline `style=` attributes on card shells. All colors from CSS custom properties. Lighthouse performance score ≥ 70 on mobile.

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
                    MVP IMPACT (ships with launch)
                    ▲
                    │
    ADMIN-15 ●      │  ● ADMIN-3    ● ADMIN-7
    (copy btn)      │  (register)   (PII scrub)
                    │
    ADMIN-14 ●      │  ● ADMIN-4    ● ADMIN-6
    (QR parity)     │  (checkin)    (anon ID)
                    │
    ADMIN-13 ●      │  ● ADMIN-1    ● ADMIN-5 (V2↑)
    (skeletons)     │  (flags)      (card3 UX)
                    │
    ADMIN-16 ●      │  ● ADMIN-8 (V2↑)  ● ADMIN-10 (V2↑)
    (test-ids)      │  (survey)          (self-serve)
                    │
    ADMIN-11 (V2↑)  │  ● ADMIN-9 (V2↑)  ● ADMIN-12 (V2↑)
    (export)        │  (email)           (CSS tokens)
                    │
    ────────────────┼────────────────────────────────────► EFFORT
    Low effort      │                      High effort
                    │
                    │  ● ADMIN-17          ● ADMIN-18
                    │  (upload)            (white-label)
                    │
                    V2-ENT ONLY
                    (Enterprise — post-launch)
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

Sprint 4 (Art Institute pitch — V2↑MVP):
  ADMIN-1 + ADMIN-3 ──→ ADMIN-8 (survey)
  ADMIN-1 + ADMIN-3 ──→ ADMIN-9 (email)
  ADMIN-1 ──→ ADMIN-10 (self-serve)
  ADMIN-3 ──→ ADMIN-11 (export)

Sprint 5 (polish):
  ADMIN-12 (CSS tokens — independent)

Sprint 6-7 (V2 enterprise):
  ADMIN-1 ──→ ADMIN-17 (file upload)
  ADMIN-1 ──→ ADMIN-18 (white-label)
```

### Summary: What Ships When

| Release | Stories | What You Walk In With |
|---------|---------|----------------------|
| **MVP v1.0** (Sprints 1-4) | 17 stories: ADMIN-1,2,3,4,5,6,7,8,9,10,11,13,14,15,16,19,20 | Full platform. Native forms (all 4 types). Triangle closes. Survey data collecting. Email list growing. Self-serve live. CSV export works. 6 months of data by Art Institute meeting. |
| **MVP v1.1** (Sprint 5) | ADMIN-12 | Fast, themeable, maintainable. Unblocks enterprise UI. |
| **V2 v2.5** (Sprint 6-7) | ADMIN-17,18 | Enterprise. White-label. File upload. |

### V2↑MVP Justification (Why 11 V2 items ship with MVP)

| Story | Original Tag | Pulled To | Justification |
|-------|-------------|-----------|---------------|
| **ADMIN-5** (Card 3 redesign) | V2 | Sprint 2 | Card 3 config scrolls away — operators lose context. Forms are useless if you can't find the config. |
| **ADMIN-2** (Tier badge UI) | V2 | Sprint 3 | Without visible tier badges, operators don't know what they can access. Locked features need visible "why." |
| **ADMIN-8** (Survey form) | V2 | Sprint 4 | You don't pitch "we can do surveys." You pitch "here's 1,920 survey responses from 24 events." Data starts day one or it doesn't exist at the meeting. |
| **ADMIN-9** (Email signup) | V2 | Sprint 4 | Same logic. "We have 576 email subscribers" beats "we could collect emails." The list compounds — every month it doesn't exist is lost growth. |
| **ADMIN-10** (Self-serve) | V2 | Sprint 4 | Art Institute isn't going to call you to change their event settings. Self-serve is table stakes for an institution. They test by trying it. If it's locked, the meeting is over. |
| **ADMIN-11** (Export) | V2 | Sprint 4 | First question any institution asks: "Can I get my data out?" If the answer is "not yet," trust evaporates. Export is the proof that you don't lock them in. |
| **ADMIN-12** (CSS classes) | V2 | Sprint 4 | 500+ inline styles = slow mobile + impossible to theme. Every enterprise sprint is faster after this. |
| **DESIGN-8** (External tokens) | V2 | Sprint 4 | Same token file duplicated in 5 templates. One edit = 5 files to update. Single source of truth stops drift cold. |
| **DESIGN-11** (Hex audit) | V2 | Sprint 4 | 1,773 hardcoded hex colors. Primary palette is token-controlled but secondary drifts. Audit + extract in one pass with ADMIN-12. |
| **DESIGN-2** (Breakpoints) | V2 | Sprint 4 | 58 `max-width` queries in a "mobile-first" codebase. Every new surface inherits the inconsistency. Fix once, all surfaces benefit. |
| **DESIGN-6** (Report print) | V2 | Sprint 4 | Sponsors ask for printable report. Currently zero `@media print` on SharedReport. One sponsor handout = one deal closed. |

---

## 11. Lead Design Engineer Review — Universal Theme & Cross-Surface Testing

> **Concern:** Does the design system carry uniformly across admin, public, display, poster,
> sharedReport in every display POV (mobile, tablet, desktop, TV, print, tabletop doc)?
> Is it tested with Playwright across all viewport/device types in CI/CD?

---

### 11.1 Design Token Consistency Scorecard

| Aspect | Score | Finding |
|--------|-------|---------|
| **Shared Token Definitions** | A | `DesignTokens.html` defines 80+ tokens (colors, type, spacing, radius, shadows, z-index, animation, breakpoints, touch targets) |
| **Token Adoption (surfaces)** | B- | Tokens duplicated inline per template — not referenced from external sheet. Drift risk on every surface edit. |
| **Font Stacks** | A+ | 100% unified. All 5 surfaces use identical `--font-family-base` and `--font-family-mono` with same fallback chains. |
| **Color Palette Control** | B- | Primary colors token-controlled. **1,773 hardcoded hex instances across all templates.** Many are fallbacks in `var(--x, #hex)`, but ~500+ in admin are pure inline styles. |
| **Responsive Breakpoints** | B | All surfaces use 640/768/1024/1440px. **But mixed `min-width` vs `max-width` patterns** — some mobile-first up, some desktop-first down, even within the same file. |
| **Touch Targets** | A | All surfaces enforce `--touch-target-min: 44px` (WCAG AAA). Buttons, inputs, form controls all compliant. |
| **Safe Area (notch devices)** | B+ | Public/Display/Poster have `viewport-fit=cover` + `env(safe-area-inset-*)`. **Admin and Report are missing viewport meta tags.** |
| **Print Styles** | C+ | Only Poster has full `@media print` (7 blocks, `@page` rules, color-adjust). Other surfaces have 1 block max. Report has zero. |
| **data-testid Coverage** | D+ | Admin: 47, Sponsor: 18, Public: 5, Report: 5, Display: 3, Poster: 2. **Total: 80 across 5 surfaces — massively uneven.** |
| **Shared JS Modules** | A | `apiClient.js`, `assetState.js`, `errorStates.js` — unified API/error/state modules. All use `EA.*` namespace with IIFE isolation. |
| **Dark Mode** | F | Tokens defined but commented out. No `prefers-color-scheme: dark` active. Not blocking MVP but needed for V2 enterprise white-label. |

---

### 11.2 Surface-by-Surface Display POV Gaps

| Surface | Mobile (390px) | Tablet (768px) | Desktop (1280px) | TV (1920px) | 4K (3840px) | Print | Tabletop/Doc |
|---------|---------------|----------------|-------------------|-------------|-------------|-------|-------------|
| **Admin** | ✅ Collapsible cards | ✅ 2-col grid | ✅ Max-width 1200px | ⚠️ Not designed for TV | — | ⚠️ Minimal | — |
| **Public** | ✅ Mobile-first hero | ✅ Grid responsive | ✅ Full width | ⚠️ Used via Display iframe | — | ⚠️ Basic | — |
| **Display** | ⚠️ Phone debug mode | ⚠️ iPad not optimized | ✅ Desktop preview | ✅ 1080p primary target | ⚠️ Defined but untested | — | — |
| **Poster** | ⚠️ Not designed for mobile | ⚠️ Not optimized | ✅ Preview works | — | — | ✅ Full `@media print` | ❌ No tabletop variant |
| **Report** | ⚠️ Tables overflow | ✅ Responsive tabs | ✅ Dashboard layout | — | — | ❌ No print styles | — |

**Critical gaps by display POV:**

**Mobile (390px):**
- Admin missing `<meta name="viewport">` tag — browser may not respect mobile rendering
- Report tables overflow on small screens — needs horizontal scroll or responsive table pattern
- Poster has no mobile-optimized view (it's print-only, but QR scan lands here on mobile)

**TV/Display (1920x1080):**
- Display.html is the only surface designed for 10-foot viewing
- Uses dark theme tokens (`--color-tv-bg`, `--color-tv-text-muted`) and 16px min font
- 4K viewport defined in config but never tested in CI

**Print:**
- Only Poster has real print CSS (`@page`, margin-safe, color-adjust)
- Report should print for sponsor handouts — currently no print stylesheet
- Admin could benefit from a "print event summary" feature

**Tabletop/Doc:**
- No table tent or tabletop card variant exists
- Poster is closest but designed for 8.5x11 not 4x6 tent cards
- This is a new surface needed (referenced in FE Integration section)

---

### 11.3 Breakpoint Standardization Audit

**Current state: 4 breakpoints, mixed direction**

```css
/* FOUND IN CODEBASE — INCONSISTENT PATTERN */
@media (max-width: 640px) { ... }   /* ← desktop-first DOWN (wrong) */
@media (min-width: 640px) { ... }   /* ← mobile-first UP (correct) */
@media (max-width: 768px) { ... }   /* ← desktop-first DOWN (wrong) */
@media (min-width: 768px) { ... }   /* ← mobile-first UP (correct) */
```

**Counts by direction:**

| Pattern | Count | Correct? |
|---------|-------|----------|
| `min-width: 640px` | 52 | ✅ Mobile-first |
| `max-width: 640px` | 37 | ❌ Desktop-first |
| `min-width: 768px` | 31 | ✅ Mobile-first |
| `max-width: 768px` | 21 | ❌ Desktop-first |
| `min-width: 1024px` | 11 | ✅ Mobile-first |
| `max-width: 375px` | 8 | ⚠️ Small device fallback |

**Recommendation:** Standardize to mobile-first `min-width` everywhere. Base styles are mobile. Scale up. The 58 `max-width` queries should be refactored.

---

### 11.4 Playwright Test Coverage by Viewport

**Current CI runs: Chromium + iPhone 14 Pro only**

| Device/Viewport | In Config | In CI | In Tests | Gap |
|-----------------|-----------|-------|----------|-----|
| iPhone 14 Pro (390x844) | ✅ | ✅ | ✅ Admin, Public | — |
| iPhone SE (375x667) | ✅ | ❌ | ✅ Display only | Not in CI |
| Pixel 7 | ✅ | ❌ | ❌ | Configured but unused |
| Samsung Galaxy S21 | ✅ | ❌ | ❌ | Configured but unused |
| iPad Pro (768x1024) | ✅ | ❌ | ✅ Display only | Not in CI |
| Desktop Chrome (1280x720) | ✅ | ✅ | ✅ All surfaces | — |
| Desktop Firefox | ✅ | ❌ | ❌ | Not in CI |
| Desktop Safari (WebKit) | ✅ | ❌ | ❌ | Not in CI |
| TV 1080p (1920x1080) | ✅ | ❌ | ✅ Display only | Not in CI |
| TV 4K (3840x2160) | ✅ | ❌ | ⚠️ Defined, not run | Not in CI |

**Problem:** CI tests only 2 viewports (mobile + desktop Chromium). The full device matrix (8+ devices, 3 browsers) exists in config but never runs. Display/TV tests exist but aren't in the CI pipeline.

**Visual Regression:** Screenshots captured on every test run but **no `toHaveScreenshot()` automated comparison**. Visual regression is manual.

---

### 11.5 Design System Stories (New — DESIGN Epic)

| Story ID | Title | Tag | Sprint | Est |
|----------|-------|-----|--------|-----|
| **DESIGN-1** | Viewport meta tags on Admin + Report surfaces | `MVP` | 1 | 2h |
| **DESIGN-2** | Breakpoint direction standardization (eliminate `max-width` queries) | `MVP` | 4 | 1 sp |
| **DESIGN-3** | data-testid parity — all surfaces to 30+ test-ids each | `MVP` | 1 | 1 sp |
| **DESIGN-4** | CI viewport matrix — add iPad, TV 1080p, iPhone SE to pipeline | `MVP` | 2 | 0.5 sp |
| **DESIGN-5** | Visual regression baseline — `toHaveScreenshot()` per surface per viewport | `MVP-UX` | 3 | 1 sp |
| **DESIGN-6** | Report print stylesheet (sponsor handout) | `V2↑MVP` | 4 | 0.5 sp |
| **DESIGN-7** | Tabletop tent card surface (4x6 variant of poster) | `V2` | 5 | 1 sp |
| **DESIGN-8** | External design token file (stop inline duplication) | `V2↑MVP` | 4 | 1 sp |
| **DESIGN-9** | Poster mobile landing (QR scan → mobile-friendly view) | `MVP-UX` | 3 | 0.5 sp |
| **DESIGN-10** | Report responsive tables (horizontal scroll or card-collapse) | `MVP-UX` | 2 | 0.5 sp |
| **DESIGN-11** | Color palette hardcode audit — extract remaining 500+ inline hex to tokens | `V2↑MVP` | 4 | 1 sp |
| **DESIGN-12** | Cross-browser CI — add Firefox + WebKit to pipeline (weekly schedule) | `V2` | 5 | 0.5 sp |

---

### 11.6 Recommended CI/CD Viewport Pipeline

**Current:** 2 viewports, 1 browser, smoke only

**Proposed MVP pipeline:**

```
PR Opened (every PR):
  ├── Chromium Desktop (1280x720)     → all 5 surfaces
  ├── iPhone 14 Pro (390x844)          → all 5 surfaces
  └── Schema + TypeCheck + Unit tests

Merge to Main (staging deploy):
  ├── Chromium Desktop (1280x720)     → all 5 surfaces
  ├── iPhone 14 Pro (390x844)          → all 5 surfaces
  ├── iPad Pro (768x1024)              → admin, public, report
  ├── TV 1080p (1920x1080)            → display only
  ├── iPhone SE (375x667)             → public, poster (QR landing)
  ├── Visual regression (toHaveScreenshot) → all surfaces × all viewports
  └── axe-core accessibility scan      → all 5 surfaces

Tag vX.Y.Z (production):
  ├── Full staging matrix (above)
  ├── Post-deploy smoke (Chromium + iPhone 14 Pro)
  └── 15-min error rate monitoring

Weekly (scheduled, off-peak):
  ├── Firefox Desktop                  → all 5 surfaces
  ├── WebKit Desktop (Safari)          → all 5 surfaces
  ├── TV 4K (3840x2160)              → display
  ├── Samsung Galaxy S21               → public, poster
  └── Pixel 7                          → public, poster
```

**Cost analysis:** Current CI runs ~2 min for 2 viewports. Adding iPad + TV + iPhone SE adds ~3 min per merge. Weekly cross-browser adds ~8 min but only runs once. Total MVP cost increase: ~3 min per merge to main.

---

### 11.7 Visual Regression Strategy

**Phase 1 (MVP): Baseline snapshots**
```javascript
// Per surface × per viewport = 15 baseline screenshots
const surfaces = ['admin', 'public', 'display', 'poster', 'report'];
const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'tv', width: 1920, height: 1080 },  // display only
];

test(`${surface} renders correctly on ${viewport.name}`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await page.goto(`${BASE_URL}?page=${surface}`);
  await expect(page).toHaveScreenshot(`${surface}-${viewport.name}.png`, {
    maxDiffPixelRatio: 0.01,  // 1% tolerance for anti-aliasing
    fullPage: true,
  });
});
```

**Phase 2 (V2): Component-level snapshots**
- Individual card snapshots (7 admin cards)
- Sponsor placement rendering per surface
- Form states (empty, filled, error, success)
- QR code rendering consistency

---

### 11.8 Theme Consistency Checklist (Per Surface)

| Check | Admin | Public | Display | Poster | Report |
|-------|-------|--------|---------|--------|--------|
| `<meta viewport>` present | ❌ | ✅ | ✅ | ✅ | ❌ |
| DesignTokens inlined | ✅ | ✅ | ✅ | ✅ | ✅ |
| Font stack matches | ✅ | ✅ | ✅ | ✅ | ✅ |
| `--color-primary` used (not hardcoded) | ⚠️ | ✅ | ✅ | ✅ | ⚠️ |
| Safe-area insets | ✅ | ✅ | ✅ | ✅ | ❌ |
| 44px touch targets | ✅ | ✅ | ✅ | N/A | ✅ |
| Skip link (a11y) | ✅ | ✅ | ❌ | ❌ | ❌ |
| `@media print` | ⚠️ 1 block | ⚠️ 2 blocks | ⚠️ 1 block | ✅ 7 blocks | ❌ |
| data-testid 30+ | ✅ 47 | ❌ 5 | ❌ 3 | ❌ 2 | ❌ 5 |
| Error state handling | ✅ | ✅ (errorStates.js) | ✅ | ⚠️ | ✅ |
| Loading skeleton | ⚠️ Spinner only | ⚠️ Spinner only | ⚠️ Spinner only | ❌ | ⚠️ |
| Sponsor renders correctly | ✅ | ✅ Carousel | ✅ Strip+panel | ✅ Strip | ✅ Metrics |
| Breakpoints mobile-first only | ❌ Mixed | ❌ Mixed | ❌ Mixed | ❌ Mixed | ❌ Mixed |

**Red flags (blocks MVP confidence):**
1. Admin and Report missing viewport meta — mobile rendering unreliable
2. data-testid coverage 2-5 on non-admin surfaces — can't write reliable automation
3. No visual regression — theme drift invisible until a user reports it
4. 58 `max-width` media queries — mobile-first is inconsistent

---

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

---

## 12. Unified Priority — ADMIN + DESIGN Combined

> **Principle:** ADMIN stories and DESIGN stories are not separate backlogs. The design system
> is the foundation that every ADMIN story builds on. A form that doesn't render on mobile is
> a broken form. A test that can't find a test-id is a test that doesn't exist. Design debt
> compounds faster than feature debt because it multiplies across 5 surfaces × N viewports.

### Completeness Audit (Section 1-11 → Section 12 cross-reference)

Every actionable finding from every section was checked against the story list.
8 gaps were found and added. **40 stories total** (was 32).

| Gap Found | Source Section | Story Added | Sprint |
|-----------|---------------|-------------|--------|
| UC-9: Multi-event aggregate dashboard | §2 PO | **ADMIN-21** | 5 |
| UC-10: Sponsor ROI click-through attribution | §2 PO | **ADMIN-22** | 5 |
| Consent tracking (checkbox + timestamp on form submit) | §2 PO Privacy | **ADMIN-23** | 3 |
| Wizard step 3 UX simplification (3 options → 2) | §5 Design | **DESIGN-13** | 2 |
| "Last updated" indicator on Card 1 | §5 Design | **DESIGN-14** | 1 |
| Edge case test suite (double submit, archived form, flag mid-session) | §6 QA | **QA-1** | 3 |
| Flag toggle → surface gating E2E test | §4 FE Integration | **QA-2** | 3 |
| Skip links on Display, Poster, Report (a11y) | §11 Design Engineer | **A11Y-ADMIN-1** | 2 |

### Combined Sprint Plan (40 stories, ordered by compound value)

---

#### Sprint 1: "The Floor Works" — No-Dep Quick Wins

*Gate: All surfaces render correctly on mobile + desktop. All interactive elements testable.*

| # | ID | Title | Tag | Est | Why Now |
|---|-----|-------|-----|-----|---------|
| 1 | **DESIGN-1** | Viewport meta → proper `<head>` on Admin + Report | `MVP` | 2h | Broken HTML. Mobile rendering unreliable on the 2 most-used surfaces. |
| 2 | **ADMIN-15** | Copy button feedback ("Copied!" 2s state) | `MVP-UX` | 2h | Most visible user friction — buttons give zero feedback. |
| 3 | **ADMIN-14** | Card 5 QR code + Card 7 QR visibility | `MVP-UX` | 2h | Consistency — every link card should have a QR preview. |
| 4 | **DESIGN-3** | data-testid parity — Public, Display, Poster, Report to 30+ each | `MVP` | 1 sp | Unblocks ALL automation. Can't write Playwright for 4/5 surfaces without this. |
| 5 | **ADMIN-16** | data-testid complete on Admin (fill gaps in existing 47) | `MVP` | 4h | Merges with DESIGN-3 — one pass, all surfaces. |
| 6 | **ADMIN-13** | Skeleton loaders + per-card error states | `MVP-UX` | 4h | "Blank screen then pop" kills first impressions. |
| 7 | **DESIGN-10** | Report responsive tables (horizontal scroll or card-collapse) | `MVP-UX` | 0.5 sp | Report tables overflow on mobile. Sponsor handout is unusable on phones. |
| 8 | **ADMIN-20** | Cross-surface sponsor integration test suite | `MVP` | 1 sp | Validates the money-maker renders on every surface. |
| 9 | **DESIGN-14** | "Last updated" timestamp on Card 1 (event basics) | `MVP-UX` | 2h | §5: Users can't tell if data is stale. One line of text builds trust. |

**Sprint 1 total:** ~4.5 sp. All zero-dependency. Can start today.

---

#### Sprint 2: "The Foundation" — Flags + Forms + CI Viewports

*Gate: Feature flags resolve. Registration form submits. CI tests 5 viewports not 2.*

| # | ID | Title | Tag | Est | Why Now |
|---|-----|-------|-----|-----|---------|
| 9 | **ADMIN-1** | Feature flag tier model (D1 + API + resolution chain) | `MVP` | 1 sp | Everything gated depends on this. |
| 10 | **ADMIN-3** | Native registration form (submit, count, QR routing) | `MVP` | 1 sp | Core value prop. Google Forms dependency is churn risk. |
| 11 | **ADMIN-4** | Native check-in form (door mode, anonymous ID foundation) | `MVP` | 1 sp | Second most-used form. Door check-in is event-day critical. |
| 12 | **ADMIN-5** | Card 3 redesign — inline form config | `V2↑MVP` | 1 sp | Forms are useless if operators can't find the config. |
| 13 | **DESIGN-4** | CI viewport matrix — add iPad, TV 1080p, iPhone SE | `MVP` | 0.5 sp | 8 devices in config, 2 in CI. Fixing this catches breakpoint bugs before users do. |
| 14 | **DESIGN-9** | Poster mobile landing (QR scan → mobile-friendly view) | `MVP-UX` | 0.5 sp | QR on poster → phone lands on print-optimized page. Bad UX. |
| 15 | **DESIGN-13** | Wizard step 3 UX simplification (3 options → 2: "I have a form" / "Create one") | `MVP-UX` | 0.5 sp | §5: Current 3-way choice confuses operators. Simplify before forms ship. |
| 16 | **A11Y-ADMIN-1** | Skip links on Display, Poster, Report surfaces | `MVP` | 0.5 sp | §11: Admin + Public have skip links. 3 surfaces missing. A11Y blocker. |

**Sprint 2 total:** ~6 sp.

---

#### Sprint 3: "The Triangle Closes" — Anonymous ID + PII + Visual Regression

*Gate: Events (apex) ↔ Sponsors ↔ Customers, SharedReports (center) triangle works. Visual regression catches drift.*

| # | ID | Title | Tag | Est | Why Now |
|---|-----|-------|-----|-----|---------|
| 17 | **ADMIN-6** | Anonymous ID system (cookie + D1, scan correlation) | `MVP` | 1 sp | Triangle model is broken without this. |
| 18 | **ADMIN-7** | PII destruction jobs (scrub, audit, retention) | `MVP` | 1 sp | Compliance blocker — can't store form data without deletion path. |
| 19 | **ADMIN-23** | Consent tracking on form submit (checkbox + timestamp) | `MVP` | 0.5 sp | §2 Privacy: Can't collect PII without consent record. GDPR/CCPA. Ships with ADMIN-7. |
| 20 | **ADMIN-2** | Tier badge + gated UI (locked icons, upgrade prompts) | `MVP-UX` | 1 sp | Operators need to see what they can/can't access. |
| 21 | **ADMIN-19** | Newman E2E chain (create → config → submit → count → scrub) | `MVP` | 1 sp | End-to-end validation of the entire form pipeline. |
| 22 | **QA-1** | Edge case test suite (double submit idempotency, archived form 410, nonexistent QR 404, flag change mid-session) | `MVP` | 0.5 sp | §6: 5 edge cases identified with no test coverage. Race conditions and error paths. |
| 23 | **QA-2** | Flag toggle → surface gating E2E (disable feature → verify surface hides it) | `MVP` | 0.5 sp | §4: Admin flag changes must propagate to all 5 surfaces. Currently untested. |
| 24 | **DESIGN-5** | Visual regression baseline — `toHaveScreenshot()` all surfaces × viewports | `MVP-UX` | 1 sp | Theme drift is invisible without this. One bad merge breaks 5 surfaces. |

**Sprint 3 total:** ~6.5 sp.

---

#### Sprint 4: "Art Institute Pitch" — Mid-Tier + Design Debt

*Gate: All 4 form types live. 6 months of data collecting. Design system extracted.*

| # | ID | Title | Tag | Est | Why Now |
|---|-----|-------|-----|-----|---------|
| 25 | **ADMIN-8** | Native survey form (tier-aware) | `V2↑MVP` | 1 sp | "Here's 1,920 survey responses" > "we can do surveys." |
| 26 | **ADMIN-9** | Email signup form (duplicate detection) | `V2↑MVP` | 1 sp | Email list compounds. Every month without it is lost growth. |
| 27 | **ADMIN-10** | Self-serve event config | `V2↑MVP` | 1 sp | Art Institute won't call you to change settings. |
| 28 | **ADMIN-11** | Form data export (CSV/JSON) | `V2↑MVP` | 0.5 sp | "Can I get my data out?" Export = trust. |
| 29 | **DESIGN-8** | External design token file (stop inline duplication) | `V2↑MVP` | 1 sp | Tokens duplicated in 5 files. One edit = 5 files to update. Single source stops drift. |
| 30 | **DESIGN-11** | Color palette hardcode audit — extract 500+ inline hex to tokens | `V2↑MVP` | 1 sp | Merges with ADMIN-12 scope. |
| 31 | **ADMIN-12** | Admin inline styles → CSS classes | `V2↑MVP` | 1 sp | Combined with DESIGN-11 as one design debt pass. |
| 32 | **DESIGN-2** | Breakpoint direction standardization (eliminate 58 `max-width` queries) | `V2↑MVP` | 1 sp | Mobile-first is inconsistent. Standardize now before more surfaces ship. |
| 33 | **DESIGN-6** | Report print stylesheet (sponsor handout) | `V2↑MVP` | 0.5 sp | Sponsors want to print the report. Currently no print CSS. |

**Sprint 4 total:** ~8 sp. Heavy but this is the "make it real" sprint.

---

#### Sprint 5: "Scale" — Enterprise + Cross-Browser

*Gate: Enterprise features available. Full browser matrix in CI.*

| # | ID | Title | Tag | Est | Why Now |
|---|-----|-------|-----|-----|---------|
| 34 | **ADMIN-17** | File upload to R2 (logos, posters, custom QR) | `V2-ENT` | 1 sp | Enterprise feature. |
| 35 | **ADMIN-18** | White-label branding (colors/logo/domain) | `V2-ENT` | 2 sp | Enterprise feature. |
| 36 | **ADMIN-21** | Multi-event aggregate dashboard (cross-event view) | `V2` | 1.5 sp | §2 UC-9: Current dropdown is per-event. No portfolio view across events. Mid/enterprise need this. |
| 37 | **ADMIN-22** | Sponsor ROI click-through attribution + conversion funnel | `V2` | 1.5 sp | §2 UC-10: SharedReport has basic metrics. No click attribution. Sponsors can't prove ROI without this. |
| 38 | **DESIGN-7** | Tabletop tent card surface (4x6 variant of poster) | `V2` | 1 sp | New surface for restaurants/bars. |
| 39 | **DESIGN-12** | Cross-browser CI — Firefox + WebKit weekly schedule | `V2` | 0.5 sp | Safari rendering bugs caught before users report them. |
| 40 | **ADMIN-13b** | Progressive loading — core admin shell first, lazy-load card bodies | `V2` | 1 sp | §5: 13K-line monolith is slow on low-end devices. Shell first, cards on demand. |

**Sprint 5 total:** ~9 sp (spread across 2 sprints if needed).

---

### Combined Dependency Graph

```
Sprint 1 (no deps — ship now):
  DESIGN-1 ← viewport fix (2h)
  DESIGN-3 + ADMIN-16 ← testid pass (combined, all surfaces)
  ADMIN-15, ADMIN-14, ADMIN-13 ← UX polish
  DESIGN-10 ← report tables
  DESIGN-14 ← last-updated indicator
  ADMIN-20 ← sponsor test suite

Sprint 2 (foundation):
  ADMIN-1 (flags)
    ├── ADMIN-3 (register) → ADMIN-4 (checkin) → ADMIN-5 (card3 V2↑)
    └── feeds Sprint 3 + 4
  DESIGN-4 (CI viewports) ← independent
  DESIGN-9 (poster mobile) ← independent
  DESIGN-13 (wizard step 3) ← independent, but best before ADMIN-3 ships
  A11Y-ADMIN-1 (skip links) ← independent

Sprint 3 (triangle + testing):
  ADMIN-4 → ADMIN-6 (anon ID)
  ADMIN-3 → ADMIN-7 (PII scrub) → ADMIN-23 (consent tracking — ships with ADMIN-7)
  ADMIN-1 → ADMIN-2 (tier badge)
  ADMIN-3 + ADMIN-7 → ADMIN-19 (Newman chain)
  ADMIN-1 → QA-2 (flag → surface gating E2E)
  QA-1 (edge cases) ← needs ADMIN-3 form endpoints
  DESIGN-5 (visual regression) ← needs DESIGN-3 testids from Sprint 1

Sprint 4 (Art Institute + design debt):
  ADMIN-1 + ADMIN-3 → ADMIN-8, 9 (survey, email)
  ADMIN-1 → ADMIN-10 (self-serve)
  ADMIN-3 → ADMIN-11 (export)
  DESIGN-8 → DESIGN-11 + ADMIN-12 (token extraction + hex audit + inline styles — combined pass)
  DESIGN-2 (breakpoints) ← independent
  DESIGN-6 (report print) ← independent

Sprint 5 (enterprise + scale):
  ADMIN-1 → ADMIN-17, 18 (upload, white-label)
  ADMIN-21 (multi-event dashboard) ← needs ADMIN-1 flags
  ADMIN-22 (sponsor attribution) ← needs ADMIN-6 anon ID
  DESIGN-7 (tabletop) ← independent
  DESIGN-12 (cross-browser) ← needs DESIGN-5 baselines
  ADMIN-13b (progressive loading) ← independent
```

### Final Count

| Category | MVP | MVP-UX | V2↑MVP | V2 | V2-ENT | Total |
|----------|-----|--------|--------|-----|--------|-------|
| ADMIN stories | 10 | 2 | 6 | 3 | 2 | 23 |
| DESIGN stories | 3 | 5 | 5 | 2 | 0 | 15 |
| QA stories | 2 | 0 | 0 | 0 | 0 | 2 |
| **Combined** | **15** | **7** | **11** | **5** | **2** | **40** |

| Release | Sprint | Stories | What You Have |
|---------|--------|---------|---------------|
| **MVP v1.0** | 1-3 | **24** | Platform works. Forms native. Triangle closes. Consent tracked. CI validates 5 viewports. Visual regression catches drift. Edge cases tested. Skip links on all surfaces. |
| **MVP v1.1** | 4 | **9** | All 4 form types. Design system extracted. Breakpoints standardized. 6 months of data collecting. Art Institute ready. |
| **V2** | 5 | **7** | Enterprise (upload, white-label). Multi-event dashboard. Sponsor attribution. Tabletop. Cross-browser. Progressive loading. |
