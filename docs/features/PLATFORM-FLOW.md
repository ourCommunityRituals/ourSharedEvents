# ourSharedEvents — End-to-End Platform Flow

> Pillar 1: The complete event lifecycle from creation to post-event analytics.
> This is the "scattered" knowledge unified into one document.

---

## The Full Picture

ourSharedEvents is event infrastructure for the hyperlocal economy. A Cloudflare Worker serves 6 surfaces, 4 form types, and 30+ API routes — all from a single deployment. Events are the core entity. Sponsors support them. Customers attend them. Every interaction flows through the Triangle. The platform's signature brand motif is **Rings and Triangles**.

### The Triangle (Relationships)

```
              Events
             ╱  ·   ╲
            ╱   ·    ╲
           ╱  Shared  ╲
          ╱  Reports   ╲
         ╱       ·      ╲
   Sponsors ──────────── Customers
```

- **Events** (apex): The core entity — gatherings/occasions
- **Sponsors** (bottom-left): Brands supporting events — placement + tracking
- **Customers** (bottom-right): Attendees — QR codes and shortlinks
- **SharedReports** (center): The proof layer — validates value for all three vertices

### The Ring (Lifecycle)

```
              Ads
           ↙     ↘
  SharedReports  Pre-Events
        ↑            ↓
   Post-Events ← Events
```

Five stages in a clockwise flywheel — Ads at 12 o'clock. SharedReports closes the loop and feeds the next round of Ads. The flywheel starts with visibility and ends with proof — which generates the next round of visibility.

---

## Phase Architecture

| Phase       | Stack                          | Data Layer                          | Auth          | Status          |
| ----------- | ------------------------------ | ----------------------------------- | ------------- | --------------- |
| **Phase 1** | Cloudflare Worker              | Google Sheets (events) + D1 (forms) | Bearer token  | Build complete  |
| **Phase 2** | Cloudflare Worker              | D1 edge SQLite (all data)           | Bearer token  | Foundation laid |
| **Phase 3** | Firebase Auth + React/Tailwind | D1 + Firebase Hosting               | Firebase Auth | Not started     |

---

## The Event Lifecycle

### Pre-Event: Incubation

```
Organizer creates event in Sheets/D1
        │
        ▼
Event appears on public page (/events)
        │
        ▼
Organizer generates QR codes from admin (/admin)
        │
        ▼
Posters printed with UEC-colored QR codes
        │
        ▼
Registration opens → GREEN QR scanned → /forms/:eventId?type=register
        │
        ▼
Attendee enters name + optional email → POST /api/v2/events/:id/forms/register
        │
        ▼
Email hashed (SHA-256), timestamp bucketed to hour, record stored in FORMS_DB
```

**What's generated:** Registration count, demand signal, email hashes for dedup.

### During-Event: Engagement

```
Attendees arrive at venue
        │
        ├── GREEN QR → Check-in tap counter (/forms/:eventId?type=checkin)
        │                Each tap → POST /api/v2/events/:id/forms/checkin
        │                Zero PII — aggregate count only
        │
        ├── BLUE QR → Sponsor placement scanned
        │               Tracked via poster_deployment_id + scan_bucket
        │               Anonymous presence signal → scan_placement_events + scan_node_returns (0062)
        │
        ├── CORAL QR → Live event content (real-time scoring, brackets)
        │
        └── PINK QR → Accessibility / ADA assistance
```

**What's generated:** Check-in headcount, scan aggregates by hour, sponsor attribution data.

### Post-Event: Analytics

```
Event ends
        │
        ├── AMBER QR → Survey (/forms/:eventId?type=survey)
        │                1-5 rating + optional comments
        │                POST /api/v2/events/:id/forms/survey
        │                Responses stored → later PII-scrubbed by lifecycle job
        │
        ├── AMBER QR → Email signup (/forms/:eventId?type=email)
        │                Email hashed (dedup) + AES-256-GCM encrypted (retrieval)
        │                POST /api/v2/events/:id/forms/email-signup
        │                Auto-deleted after 30 days
        │
        └── PURPLE QR → SharedReport (archive, memories, results)
                         Aggregate analytics for sponsors and organizers

        │
        ▼
Admin dashboard shows live counts
GET /api/v2/admin/events/:id/forms/registrations  → list (name + email hash)
GET /api/v2/admin/events/:id/forms/checkin-count   → integer
GET /api/v2/admin/events/:id/forms/surveys         → PII-scrubbed responses
GET /api/v2/admin/events/:id/forms/email-signups   → count only
```

**What's generated:** Satisfaction ratings, email opt-in list, shareable reports.

### Scheduled Cleanup: PII Lifecycle

```
Daily cron trigger (Cloudflare Worker scheduled event)
        │
        ├── Phase 1: DELETE expired registrations (90 days after event)
        │
        ├── Phase 2: SCRUB survey PII (whitelist approach — keep ratings, scrub strings)
        │
        └── Phase 3: DELETE expired email signups (30 days after signup)
        │
        ▼
Each phase independent — failure in one doesn't block others
Results logged as LIFECYCLE_COMPLETE structured JSON
```

---

## The 6 Surfaces

Each surface is a self-contained HTML page embedded in the Worker bundle.

| #   | Surface             | Route                                | Audience               | Phase   |
| --- | ------------------- | ------------------------------------ | ---------------------- | ------- |
| 1   | **Landing**         | `/`, `/home`, `/welcome`, `/landing` | Visitors               | Live    |
| 2   | **Public Events**   | `/events`, `/public`                 | Attendees              | Live    |
| 3   | **Admin Dashboard** | `/admin` (auth required)             | Organizers             | Live    |
| 4   | **Display**         | `/display`                           | Venue staff (TV/kiosk) | Phase 2 |
| 5   | **Poster**          | `/poster`                            | Print (QR codes)       | Phase 2 |
| 6   | **Shared Report**   | `/report`                            | Sponsors               | Phase 2 |

### Surface Data Flow

```
Landing (/)
  └── Email capture → POST /subscribe → D1 subscribers table

Public (/events)
  └── JS fetch → GET /api/v2/events → Event cards rendered

Admin (/admin)  [auth required]
  ├── JS fetch → GET /api/v2/admin/events → Event table (incl. archived)
  └── Click event → 4 parallel fetches → Form counts displayed
       ├── GET .../registrations
       ├── GET .../checkin-count
       ├── GET .../surveys
       └── GET .../email-signups

Form Pages (/forms/:eventId?type=X)
  └── Mobile-first HTML → JS fetch → POST /api/v2/events/:id/forms/:type
       Success shown inline (no page reload)
```

---

## The 4 Form Types

| Form             | UEC Code | PII Collected                        | Storage  | TTL                  | Tier |
| ---------------- | -------- | ------------------------------------ | -------- | -------------------- | ---- |
| **Registration** | GREEN    | Name (plain) + email (SHA-256 hash)  | FORMS_DB | 90 days              | All  |
| **Check-in**     | GREEN    | None — aggregate count only          | FORMS_DB | Permanent            | All  |
| **Survey**       | AMBER    | Rating (kept) + comments (scrubbed)  | FORMS_DB | Permanent (scrubbed) | Mid+ |
| **Email Signup** | AMBER    | Email (hash + AES-256-GCM encrypted) | FORMS_DB | 30 days              | Mid+ |

### Feature Flag Gating

Forms are gated by the 3-tier feature flag system:

| Flag Key             | Free | Mid | Enterprise |
| -------------------- | :--: | :-: | :--------: |
| `forms.register`     |  ON  | ON  |     ON     |
| `forms.checkin`      |  ON  | ON  |     ON     |
| `forms.survey`       | OFF  | ON  |     ON     |
| `forms.email-signup` | OFF  | ON  |     ON     |

The router checks `isFeatureEnabled()` before accepting any form submission. Disabled forms return `403 FORM_DISABLED`.

---

## API Contract Summary

### Public (no auth)

| Method | Path                                    | Returns                   |
| ------ | --------------------------------------- | ------------------------- |
| GET    | `/health`                               | `{ ok, env, version }`    |
| GET    | `/api/v2/events`                        | Active events list        |
| GET    | `/api/v2/events/:id`                    | Single event              |
| POST   | `/api/v2/events/:id/forms/register`     | Registration confirmation |
| POST   | `/api/v2/events/:id/forms/checkin`      | Check-in count            |
| POST   | `/api/v2/events/:id/forms/survey`       | Survey confirmation       |
| POST   | `/api/v2/events/:id/forms/email-signup` | Signup confirmation       |
| GET    | `/forms/:eventId`                       | Mobile form HTML page     |
| POST   | `/subscribe`                            | Email capture             |

### Admin (Bearer token or CF Access JWT)

| Method | Path                                           | Returns                     |
| ------ | ---------------------------------------------- | --------------------------- |
| GET    | `/admin`                                       | Admin dashboard HTML        |
| GET    | `/api/v2/admin/events`                         | All events (incl. archived) |
| GET    | `/api/v2/admin/events/:id/forms/registrations` | Registration list           |
| GET    | `/api/v2/admin/events/:id/forms/checkin-count` | Check-in integer            |
| GET    | `/api/v2/admin/events/:id/forms/surveys`       | PII-scrubbed surveys        |
| GET    | `/api/v2/admin/events/:id/forms/email-signups` | Signup count                |
| GET    | `/api/v2/admin/flags`                          | All feature flags           |
| PUT    | `/api/v2/admin/flags/:key`                     | Toggle flag                 |
| POST   | `/api/v2/admin/flags/apply-tier`               | Apply tier preset           |
| GET    | `/api/v2/admin/flags/resolve`                  | Resolved flags for event    |

---

## Data Architecture

### Two Separate Systems

```
┌─────────────────────────────────┐    ┌─────────────────────────────────┐
│        FORMS_DB (D1)            │    │          DB (D1)                │
│   Opt-in personal data          │    │   Anonymous presence signal     │
│                                 │    │                                 │
│  form_registrations             │    │  scans                          │
│    name, email_hash, expires_at │    │    scan_bucket, user_agent_hash │
│                                 │    │    poster_deployment_id         │
│  form_surveys                   │    │                                 │
│    responses_json, pii_scrubbed │    │  scan_aggregates                │
│                                 │    │    bucket_date, bucket_hour     │
│  email_signups                  │    │    total_scans, distinct_agent_hashes   │
│    email_hash, encrypted_email  │    │                                 │
│    retention_expires_at         │    │  poster_deployments             │
│                                 │    │    qr_token, latitude, longitude│
│  checkin_counts                 │    │                                 │
│    count (aggregate)            │    │  sponsors                       │
│                                 │    │    click_token, display_token│
│  feature_flags                  │    │                                 │
│    key, enabled, tier           │    │  events (core entity)           │
│                                 │    │    id, brand_id, data_json      │
│  ↓ AUTO-DELETED on schedule     │    │                                 │
└─────────────────────────────────┘    │  ↓ PERMANENT — no PII exists    │
                                       └─────────────────────────────────┘
```

### Privacy Enforcement Points

| Layer                   | Mechanism                                                          |
| ----------------------- | ------------------------------------------------------------------ |
| **Schema**              | No PII columns in scans/scan_aggregates tables                     |
| **Hashing**             | Emails SHA-256 hashed before storage                               |
| **Encryption**          | Email signups AES-256-GCM encrypted (PBKDF2, 100k iterations)      |
| **Time bucketing**      | All timestamps truncated to hour (`2026-03-27T14`)                 |
| **Whitelist scrubbing** | Survey responses: numeric + safe keys kept, strings → `[SCRUBBED]` |
| **TTL deletion**        | Registrations: 90 days. Email signups: 30 days. Daily cron.        |
| **Database separation** | FORMS_DB and DB are separate D1 databases with no cross-linking    |

---

## Worker Architecture

```
workers/oursharedevents/src/
├── index.ts              # Entry point + scheduled PII lifecycle job
├── router.ts             # Route table (30+ endpoints)
├── auth/admin.ts         # Auth guard (CF Access JWT + Bearer fallback)
├── handlers/
│   ├── health.ts         # GET /health
│   ├── events.ts         # Events API (Sheets → D1)
│   ├── pages.ts          # Landing, public, admin HTML
│   ├── forms.ts          # 4 form submissions + 4 admin reads
│   ├── form-pages.ts     # Mobile QR form landing pages
│   └── feature-flags.ts  # 8 admin flag endpoints
└── lib/
    ├── google-auth.ts    # Google JWT for Sheets (Phase 1)
    ├── sheets.ts         # Google Sheets client (Phase 1)
    ├── forms-db.ts       # hashEmail, encryptEmail, bucketTimestamp
    ├── feature-flags.ts  # isFeatureEnabled (3-tier resolution)
    └── cors.ts           # CORS allowlist
```

---

## Observability

Every form event emits structured JSON:

```json
{
  "type": "FORM_EVENT",
  "formType": "register",
  "eventId": "bocce-spring-2026",
  "action": "submit",
  "timestamp": "...",
  "id": "uuid",
  "latencyMs": 45
}
```

Feature flag changes emit:

```json
{
  "type": "FLAG_EVENT",
  "key": "forms.survey",
  "enabled": true,
  "scope": "global",
  "timestamp": "..."
}
```

Lifecycle job results emit:

```json
{
  "type": "LIFECYCLE_COMPLETE",
  "registrationsDeleted": 12,
  "surveysScrubbed": 8,
  "emailSignupsDeleted": 3,
  "timestamp": "..."
}
```

---

## How the Pillars Connect

| Pillar                               | Role in the Flow                                         |
| ------------------------------------ | -------------------------------------------------------- |
| **1. Platform Flow**                 | This document — the full lifecycle                       |
| **2. Anonymous ID**                  | Schema-level privacy that makes permanent scan data safe |
| **3. Sponsor Pricing Tier Balancer** | Governs sponsor display priority within events           |
| **4. UEC**                           | Color-semantic QR codes that bridge physical→digital     |
| **5. NCR Methodology**               | Geo-spatial intelligence from accumulated scan data      |

Every scan through a UEC QR code feeds the anonymous presence signal system. The `poster_deployments` table stores each physical QR placement with lat/lng. The `scans` table records the time-bucketed, PII-free interaction. SharedReports surface the aggregate results. At scale, this becomes the NCR dataset — hyperlocal economic intelligence from anonymous presence signal.

---

## Cross-References

- [ANONYMOUS-ID.md](ANONYMOUS-ID.md) — Pillar 2: Why and how the system avoids PII
- [PRIVACY.md](PRIVACY.md) — Technical PII handling details
- [UEC-CODES.md](UEC-CODES.md) — Pillar 4: The color-semantic QR standard
- [NCR-METHODOLOGY.md](NCR-METHODOLOGY.md) — Pillar 5: Geo-spatial intelligence horizon
- [FORMS.md](FORMS.md) — Deep dive into the 4 form types
- [SURFACES.md](SURFACES.md) — The 6 MVP surfaces
- [EVENTS.md](EVENTS.md) — Event data model and APIs
