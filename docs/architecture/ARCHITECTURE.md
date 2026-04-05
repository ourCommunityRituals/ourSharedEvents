# OurSharedEvents — Architecture

**Last Updated:** 2026-03-31
**Status:** Phase 1 Build Complete / Phase 2 Foundation Laid
**Story:** HK-4 (OUR-125) — Reconcile ARCHITECTURE.md vs MIGRATION_EPICS.md

---

## GAS Status Declaration

> **LEGACY GAS IMPLEMENTATION IS ARCHIVED.**
> The Google Apps Script backend is preserved in `archive/gas/` for emergency reference only.
> **Canonical worker is `workers/oursharedevents/src/`.**
> No new code should be written to `archive/gas/` or `cloudflare-proxy/`.
> `MIGRATION_EPICS.md` documents the completed GAS → Cloudflare migration history — it is a closed planning artifact.

---

## Architecture Overview

OurSharedEvents is a **Cloudflare Worker + Google Sheets (Phase 1) / D1 (Phase 2)** platform.
All API and HTML traffic flows through a single TypeScript Worker deployed to `oursharedevents.com`.

```
Clients (Admin, Public, Display, Poster, SharedReport, Form QR pages)
    │
    ▼
Cloudflare Worker  —  workers/oursharedevents/src/
    ├── index.ts          Entry point + scheduled PII lifecycle job (cron 0 3 * * *)
    ├── router.ts         Route table (30+ endpoints)
    ├── auth/admin.ts     Admin auth guard (CF Access JWT + Bearer fallback)
    ├── handlers/         Route handlers (health, events, pages, forms, form-pages, feature-flags)
    └── lib/              Utilities (google-auth, sheets, forms-db, feature-flags, cors)
    │
    ├── Phase 1 data path ────────────────────────────────────────────────
    │       ▼
    │   Google Sheets API (service account JWT)
    │       ├── EVENTS sheet         Event data
    │       ├── ANALYTICS sheet      Event tracking log
    │       ├── CONFIG sheet         Brand configuration
    │       └── SHORTLINKS sheet     URL shortening
    │
    └── Phase 2 data path (D1 — foundation laid, not yet provisioned) ────
            ▼
        MAIN_DB  (D1 — anonymous scan / event data)
        FORMS_DB (D1 — PII-bearing forms + feature flags, privacy-isolated)
```

---

## Phase Progression

| Phase       | Stack                                              | Status                                               |
| ----------- | -------------------------------------------------- | ---------------------------------------------------- |
| **Phase 1** | Cloudflare Worker + Google Sheets                  | Build ✅ complete / Ops blocked (D1 not provisioned) |
| **Phase 2** | Cloudflare Worker + D1 (edge SQLite)               | Schema + migrations written, infra pending           |
| **Phase 3** | Firebase Auth + React/Tailwind on Firebase Hosting | Not started                                          |

**Code-first principle:** Worker routes, D1 migrations, and tests are written and CI-verified now.
Infrastructure (CF zone, D1, Firebase) is the last step, not the first.

---

## Canonical Worker Location

```
workers/oursharedevents/
├── src/
│   ├── index.ts              Entry point + scheduled PII lifecycle job
│   ├── router.ts             Route table (30+ endpoints)
│   ├── auth/
│   │   └── admin.ts          Admin auth guard (CF Access JWT + Bearer fallback)
│   ├── handlers/
│   │   ├── health.ts         GET /health, GET /api/status
│   │   ├── events.ts         Events API (Sheets Phase 1)
│   │   ├── pages.ts          HTML pages (public, admin, landing) + POST /subscribe
│   │   ├── forms.ts          Form submissions (register, checkin, survey, email-signup)
│   │   ├── form-pages.ts     Mobile-first QR form landing pages
│   │   └── feature-flags.ts  Admin flag management (8 endpoints)
│   └── lib/
│       ├── google-auth.ts    Google service account JWT (Phase 1)
│       ├── sheets.ts         Google Sheets client (Phase 1)
│       ├── forms-db.ts       Privacy utilities (hash, encrypt, bucket)
│       ├── feature-flags.ts  Flag resolution (3-tier: free / mid / enterprise)
│       └── cors.ts           CORS allowlist
├── wrangler.toml             Cloudflare config (dev / staging / production)
├── migrations/               D1 migrations for MAIN_DB
└── migrations-forms/         D1 migrations for FORMS_DB
```

> **Retired paths** (do not edit):
>
> - `archive/gas/` — archived GAS backend
> - `cloudflare-proxy/` — superseded by `workers/oursharedevents/`

---

## Domains

| Environment | URL                                              |
| ----------- | ------------------------------------------------ |
| Production  | `oursharedevents.com`, `www.oursharedevents.com` |
| Staging     | `stg.oursharedevents.com`                        |
| Local dev   | `localhost` via `wrangler dev`                   |

> Old domain `stg.eventangle.com` is retired. All references should use `oursharedevents.com`.

---

## D1 Databases — Two-Database Privacy Architecture

Two separate D1 databases enforce a hard privacy boundary:

| Binding        | Database name (staging) | Purpose                                 |
| -------------- | ----------------------- | --------------------------------------- |
| `DB` (MAIN_DB) | `ocr-db-staging`        | Anonymous scan data, events, shortlinks |
| `FORMS_DB`     | `ocr-forms-db-staging`  | PII-bearing forms data + feature flags  |

**Why two databases?** Forms data contains email addresses and personal identifiers.
Keeping it in a separate D1 instance means a breach of MAIN_DB exposes zero PII,
and the FORMS_DB cron job can destroy expired data without touching event analytics.

### PII Lifecycle (cron `0 3 * * *`)

The Worker's scheduled handler runs nightly and:

- Deletes expired registrations
- Scrubs survey PII fields
- Removes email signups past 30-day retention

---

## Route Table (30+ endpoints)

### Public

| Method  | Path                                                    | Handler                                |
| ------- | ------------------------------------------------------- | -------------------------------------- |
| GET     | `/health`                                               | Health check — `{ ok, env, version }`  |
| GET     | `/api/status`                                           | Alias for `/health`                    |
| GET     | `/` `/home` `/welcome` `/landing`                       | Landing page HTML                      |
| GET     | `/events` `/public`                                     | Public event listing HTML              |
| GET     | `/api/v2/events`                                        | List active events — `{ ok, items[] }` |
| GET     | `/api/v2/events/:id`                                    | Single event — `{ ok, item }`          |
| POST    | `/api/v2/events/:id/forms/register`                     | Submit registration                    |
| POST    | `/api/v2/events/:id/forms/checkin`                      | Increment check-in                     |
| POST    | `/api/v2/events/:id/forms/survey`                       | Submit survey                          |
| POST    | `/api/v2/events/:id/forms/email-signup`                 | Email signup                           |
| GET     | `/forms/:eventId?type=register\|checkin\|survey\|email` | QR form landing page                   |
| POST    | `/subscribe`                                            | Email capture (landing page)           |
| OPTIONS | `*`                                                     | CORS preflight                         |

### Admin (Bearer token / CF Access JWT required)

| Method | Path                                           | Handler                             |
| ------ | ---------------------------------------------- | ----------------------------------- |
| GET    | `/admin`                                       | Admin dashboard HTML                |
| GET    | `/api/v2/admin/events`                         | List all events (includes archived) |
| GET    | `/api/v2/admin/events/:id/forms/registrations` | List registrations                  |
| GET    | `/api/v2/admin/events/:id/forms/checkin-count` | Check-in count                      |
| GET    | `/api/v2/admin/events/:id/forms/surveys`       | Surveys (PII-scrubbed)              |
| GET    | `/api/v2/admin/events/:id/forms/email-signups` | Email signup count                  |
| GET    | `/api/v2/admin/flags`                          | List all feature flags              |
| GET    | `/api/v2/admin/flags/tiers`                    | List tier presets                   |
| GET    | `/api/v2/admin/flags/current-tier`             | Detect active tier                  |
| GET    | `/api/v2/admin/flags/resolve`                  | Resolved flags (`?eventId=`)        |
| PUT    | `/api/v2/admin/flags/:key`                     | Toggle a global flag                |
| POST   | `/api/v2/admin/flags/apply-tier`               | Apply tier preset                   |
| PUT    | `/api/v2/admin/events/:id/flags/:key`          | Set event-level override            |
| DELETE | `/api/v2/admin/events/:id/flags/:key`          | Remove event-level override         |

---

## Feature Flags — 18 Flags, 3 Tiers

Feature flags are stored in `FORMS_DB` and resolved with a 3-tier lookup:

```
1. Event-scoped:  scope='event', scope_id=eventId  (Enterprise only)
2. Global:        scope='global', scope_id IS NULL
3. Default:       no row = flag ON (backwards compatible)
```

### Tiers

| Tier           | Included flags                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Free**       | forms.register, forms.checkin, forms.survey, forms.email-signup, analytics.shared-report, report.export-json, config.self-serve                              |
| **Mid**        | Free + report.advanced-metrics, report.export-pdf, report.custom-window, config.event-settings, assets.file-upload, assets.custom-qr, branding.color-palette |
| **Enterprise** | Mid + report.portfolio, branding.white-label, branding.custom-domain + event-level overrides                                                                 |

### All Flag Keys

```
forms.register           forms.checkin
forms.survey             forms.email-signup
config.self-serve        config.event-settings
analytics.shared-report  report.export-json
report.advanced-metrics  report.export-pdf
report.custom-window     report.portfolio
assets.file-upload       assets.custom-qr
branding.white-label     branding.custom-domain
branding.color-palette
```

---

## 5 HTML Surfaces

All surfaces are server-rendered HTML strings embedded in the Worker bundle (~200 KB total — moved to CDN in Phase 3).

| Surface             | URL       | Purpose                           |
| ------------------- | --------- | --------------------------------- |
| `admin.html`        | `/admin`  | Event management control room     |
| `public.html`       | `/events` | Mobile-first public event listing |
| `display.html`      | (bundle)  | TV/kiosk live event display       |
| `poster.html`       | (bundle)  | Printable poster with QR codes    |
| `sharedReport.html` | (bundle)  | Shareable analytics dashboard     |

QR codes on posters/displays route to `/forms/:eventId?type=<formType>` — mobile-first form landing pages served by `form-pages.ts`.

---

## Authentication

| Method                         | Used for                                                       |
| ------------------------------ | -------------------------------------------------------------- |
| **CF Access JWT**              | Production admin routes (Cloudflare-issued, validated at edge) |
| **Bearer token** (`ADMIN_KEY`) | Staging fallback (enabled by `ALLOW_ADMIN_KEY_FALLBACK=true`)  |
| **Google service account JWT** | Worker → Sheets API (Phase 1)                                  |

---

## CORS

`lib/cors.ts` maintains an allowlist of permitted origins.
CORS is handled at the Worker level before any route processing.
Admin routes allow `Authorization` and `Content-Type` headers.

---

## Brand / Ring Framework

### Ring (NCR flywheel — clockwise from 12 o'clock)

```
          Ads
        ↙     ↘
SharedReports  Pre-Events
      ↑            ↓
 Post-Events ← Events
```

Five lifecycle stages: **Ads → Pre-Events → Events → Post-Events → SharedReports → (Ads)**

### Triangle

```
         Events
        ╱  ·   ╲
       ╱   ·    ╲
      ╱  Shared  ╲
     ╱  Reports   ╲
    ╱       ·      ╲
Sponsors ──────── Customers
```

---

## Testing Strategy

| Level    | Framework       | Location          |
| -------- | --------------- | ----------------- |
| Unit     | Vitest          | `tests/unit/`     |
| Contract | Vitest (schema) | `tests/contract/` |
| E2E      | Playwright      | `tests/e2e/`      |
| Smoke    | Vitest / Newman | `tests/smoke/`    |
| Load     | k6              | `tests/load/`     |

CI gates: typecheck, schema verify, migration apply, table verify, health check, API smoke, UI smoke, prod isolation.

---

## Reconciliation with MIGRATION_EPICS.md

`docs/deployment/MIGRATION_EPICS.md` is the **closed** planning document for the GAS → Cloudflare migration.
It is preserved for historical reference. Its stories and epics are complete.

Key conflicts now resolved:

| MIGRATION_EPICS.md (historical)            | Current reality                                             |
| ------------------------------------------ | ----------------------------------------------------------- |
| Domain: `stg.eventangle.com`               | Domain: `stg.oursharedevents.com`                           |
| Worker entry: `cloudflare-proxy/worker.js` | Worker entry: `workers/oursharedevents/src/index.ts`        |
| Data: Google Sheets only                   | Data: Sheets (Phase 1) + D1 MAIN_DB + D1 FORMS_DB (Phase 2) |
| No feature flags                           | 18 feature flags, 3-tier system                             |
| No forms system                            | 4 form types with PII encryption/scrubbing                  |
| GAS coexistence proxy                      | GAS archived, CF Worker is sole backend                     |

No action needed on MIGRATION_EPICS.md — it is an accurate historical record and should not be modified.

---

## Related Documentation

- **[CLOUDFLARE_WORKER_MIGRATION.md](./CLOUDFLARE_WORKER_MIGRATION.md)** — Migration history
- **[INTEGRATION-FLOWS.md](./INTEGRATION-FLOWS.md)** — Detailed API request/response schemas
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** — Deployment and CI/CD
- **[docs/deployment/MIGRATION_EPICS.md](../deployment/MIGRATION_EPICS.md)** — Closed planning doc (GAS→CF migration history)
- **[archive/gas/README.md](../../archive/gas/README.md)** — GAS restoration guide (emergency only)
- **[CLAUDE.md](../../CLAUDE.md)** — Persistent project brain

---

_OurSharedEvents Architecture — updated 2026-03-31 (HK-4 / OUR-125)_
