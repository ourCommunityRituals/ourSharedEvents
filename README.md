# ourSharedEvents

**Core event infrastructure platform** under the [ourCommunityRituals](https://github.com/ourCommunityRituals) organization.

ourSharedEvents powers community event management — registration, check-in, sponsor attribution, and anonymous geographic intelligence. It is the infrastructure layer that other products in the ourCommunityRituals ecosystem build on top of.

**Privacy by architecture, not policy.** The platform never collects personal information at the scan level. Anonymous data can be kept forever, shared with researchers, and accumulated over years to produce hyperlocal maps of community gathering patterns.

---

## The ourCommunityRituals Ecosystem

Registry of record: `OCR-docs/ocr-docs-brain/product-registry.yaml` (mirrored in `OCR-docs/docs/OCR_VISION.md` §7).

| Code | Product                           | Repo                                                                      | Role                                                              |
| ---- | --------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| OCR  | OurCommunityRituals LLC           | [OCR-docs](https://github.com/ourCommunityRituals/OCR-docs)               | Holding company · org brain · governance                          |
| OSE  | **ourSharedEvents** _(this repo)_ | [ourSharedEvents](https://github.com/ourCommunityRituals/ourSharedEvents) | The platform · anonymous ID · sponsor model                       |
| OW   | OurWKRP                           | [ourWKRP](https://github.com/ourCommunityRituals/ourWKRP)                 | Community music curation · named identity (separate database)     |
| OSG  | OurSharedGames                    | `ourSharedGames`                                                          | Founding activation format · anchor game nights (inherits OSE)    |
| OSR  | OurSharedRecords                  | `ourSharedRecords`                                                        | Music, story, archive · oral history (inherits OSE)               |
| OSP  | OurSharedPulse                    | `ourSharedPulse`                                                          | Pre-platform consulting · human-delivered                         |
| OSM  | OurSharedMagnets                  | `ourSharedMagnets`                                                        | Developer and franchise layer · API + white label (flywheel back) |
| OA   | OurAirwaves                       | `ourAirwaves`                                                             | Deployment and white label · client fork template (flywheel front)|
| OER  | OurEventRings                     | —                                                                         | BigQuery RAG · cross-product intelligence                         |

---

## Architecture

### Current Stack — Cloudflare Workers + D1

```
User
 └── oursharedevents.com (Cloudflare Worker)
      ├── D1 Main DB (events, sponsors, scans, poster_deployments)
      ├── D1 Forms DB (registrations, surveys, email_signups, checkin_counts)
      └── Feature Flags (17 OSE-active flags, 3 tiers: Free/Mid/Enterprise — `@ocr/flags`)
```

- **Runtime:** TypeScript Cloudflare Worker at `workers/oursharedevents/`
- **Database:** Cloudflare D1 — two separate databases for privacy isolation
  - **MAIN_DB:** events, sponsors, poster_deployments, scans, scan_aggregates — zero PII
  - **FORMS_DB:** registrations (90-day TTL), email_signups (30-day TTL, AES-256-GCM encrypted), surveys, checkin_counts
- **Auth:** CF Access JWT + Bearer token dual auth on admin endpoints
- **CI/CD:** GitHub Actions on `ubuntu-latest` — S0 security (CodeQL, Semgrep, detect-secrets, npm audit, SBOM) → T0 gate (lint, typecheck, tests, a11y, structural invariants, component) → T1 staging deploy (D1 migrations) → T2 Bruno contract → T3 smoke → T4 functional; production deploy on `v*.*.*` tags
- **Secrets:** Doppler (configured), Wrangler secrets (deployed)
- **Monitoring:** Cloudflare Workers analytics, /health endpoint with D1 connectivity check

### Two-Database Privacy Architecture

The platform runs two physically separate databases. MAIN_DB holds anonymous event data — if breached, the attacker gets event schedules and scan counts. FORMS_DB holds personal data with automatic destruction timers — encrypted, hashed, and time-limited. No cross-database joins exist. This is blast radius control by design.

### Phase Progression

| Phase       | Stack                                 | Status                     |
| ----------- | ------------------------------------- | -------------------------- |
| ~~Phase 1~~ | ~~Cloudflare Worker + Google Sheets~~ | Retired — no Sheets/GAS code remains (Deprecation Lock, brain #10) |
| **Phase 2** | Cloudflare Worker + D1                | **Current — staging deployed (OSE-548); production launch = OSE-15** |
| Phase 3     | + Firebase Auth + React/Tailwind UI   | Not started                |

---

## Six Surfaces

| Surface      | Route                      | Purpose                                                     |
| ------------ | -------------------------- | ----------------------------------------------------------- |
| Landing      | `/`                        | Marketing + email capture                                   |
| Public       | `/events`, `/events/:slug` | Public event listing + event page for attendees             |
| Admin        | `/admin`                   | Event management, sponsor config, form setup, feature flags |
| Display      | `/display`                 | TV/kiosk at venue — sponsor rotation, live scan counts      |
| Poster       | `/poster`                  | Print-ready QR code displays with UEC color-semantic codes  |
| SharedReport | `/sharedReport`            | Sponsor analytics — depth enforced server-side (OSE-816)    |

Alias paths (`/tv`, `/posters`, `/report`, …) are listed in the `router.ts` dispatch.

---

## API Reference

### Public Endpoints

| Method | Path                 | Description                     |
| ------ | -------------------- | ------------------------------- |
| GET    | `/health`            | Worker health + D1 connectivity |
| GET    | `/api/status`        | Alias for /health               |
| GET    | `/`                  | Landing page (HTML)             |
| GET    | `/events`            | Public events page (HTML)       |
| GET    | `/display`           | TV/kiosk display surface (HTML) |
| GET    | `/poster`            | Print poster surface (HTML)     |
| GET    | `/sharedReport`      | Sponsor analytics report (HTML) |
| GET    | `/api/v2/events`     | List active events              |
| GET    | `/api/v2/events/:id` | Single event by ID              |

### Form Endpoints (Public)

| Method | Path                                      | Description                              |
| ------ | ----------------------------------------- | ---------------------------------------- |
| POST   | `/api/v2/events/:id/forms/register`       | Event registration (90-day TTL)          |
| POST   | `/api/v2/events/:id/forms/checkin`        | Anonymous check-in (counter only)        |
| POST   | `/api/v2/events/:id/forms/survey`         | Post-event survey (PII scrubbed by cron) |
| POST   | `/api/v2/events/:id/forms/email-signup`   | Email capture (AES-256-GCM, 30-day TTL)  |
| GET    | `/forms/:eventId?type=…`                  | Mobile-first form landing page (QR)      |
| GET    | `/q/<qr_token>`, `/s/<code>`              | QR scan ingestion / shortlink resolve    |

### Admin Endpoints (CF Access JWT; Bearer / X-OCR-Internal fallbacks are env-gated)

| Method     | Path                                              | Description                                   |
| ---------- | ------------------------------------------------- | --------------------------------------------- |
| GET        | `/admin`                                          | Admin dashboard (HTML)                        |
| GET/POST   | `/api/v2/admin/events`                            | Admin events list (includes archived) / create |
| PUT/DELETE | `/api/v2/admin/events/:id`                        | Update / scan-guarded hard delete             |
| GET        | `/api/v2/admin/events/:id/forms/registrations`    | Registration list for event                   |
| GET        | `/api/v2/admin/events/:id/forms/checkin-count`    | Check-in count for event                      |
| GET        | `/api/v2/admin/events/:id/forms/surveys`          | Surveys (PII-scrubbed)                        |
| GET        | `/api/v2/admin/events/:id/forms/email-signups`    | Email signup count for event                  |
| GET        | `/api/v2/admin/audit-log`                         | Admin mutation audit trail                    |

Full table (sponsors, poster deployments, QR verify, uploads, data-subject erase, shared-report mint): header comment of `workers/oursharedevents/src/router.ts`.

### Feature Flag Endpoints (Admin)

| Method | Path                                    | Description                              |
| ------ | --------------------------------------- | ---------------------------------------- |
| GET    | `/api/v2/admin/flags`                   | List all 17 flags with current state     |
| GET    | `/api/v2/admin/flags/tiers`             | Free/Mid/Enterprise tier presets         |
| GET    | `/api/v2/admin/flags/current-tier`      | Detect current tier                      |
| GET    | `/api/v2/admin/flags/resolve?eventId=`  | Resolve flags for specific event         |
| PUT    | `/api/v2/admin/flags/:key`              | Toggle a global flag                     |
| POST   | `/api/v2/admin/flags/apply-tier`        | Apply tier preset (single API call)      |
| PUT    | `/api/v2/admin/events/:id/flags/:key`   | Set per-event flag override (Enterprise) |
| DELETE | `/api/v2/admin/events/:id/flags/:key`   | Remove per-event override                |

### CORS

All endpoints enforce origin allowlist via `corsOrigin()`. OPTIONS preflight returns proper CORS headers for allowed origins. Disallowed origins receive 403.

---

## Feature Flag Tiers

17 OSE-active flags (shim over `@ocr/flags`) control three subscription tiers. Upgrading a customer is a single API call — `POST /api/v2/admin/flags/apply-tier`.

| Flag                    | Free | Mid | Enterprise |
| ----------------------- | :--: | :-: | :--------: |
| forms.register          |  ✅  | ✅  |     ✅     |
| forms.checkin           |  ✅  | ✅  |     ✅     |
| forms.survey            |  ❌  | ✅  |     ✅     |
| forms.email-signup      |  ❌  | ✅  |     ✅     |
| config.self-serve       |  ❌  | ✅  |     ✅     |
| config.event-settings   |  ❌  | ✅  |     ✅     |
| analytics.shared-report |  ❌  | ✅  |     ✅     |
| report.export-json      |  ✅  | ✅  |     ✅     |
| report.advanced-metrics |  ❌  | ✅  |     ✅     |
| report.export-pdf       |  ❌  | ✅  |     ✅     |
| report.custom-window    |  ❌  | ✅  |     ✅     |
| report.portfolio        |  ❌  | ❌  |     ✅     |
| assets.file-upload      |  ❌  | ❌  |     ✅     |
| assets.custom-qr        |  ❌  | ❌  |     ✅     |
| branding.white-label    |  ❌  | ❌  |     ✅     |
| branding.custom-domain  |  ❌  | ❌  |     ✅     |
| branding.color-palette  |  ❌  | ❌  |     ✅     |

Resolution hierarchy: event-scoped → global → default ON.

---

## Repo Structure

```
workers/
└── oursharedevents/          # Canonical Cloudflare Worker (TypeScript)
    ├── src/
    │   ├── index.ts          # Entry point
    │   ├── router.ts         # Route table (≈75 routes — header comment is canonical)
    │   ├── auth/             # CF Access JWT + Bearer token auth
    │   ├── handlers/         # 30 handlers — events, pages, forms, sponsors, poster, QR, shared-report, …
    │   └── lib/              # feature-flags, encryption, cors, utils
    ├── migrations/           # D1 main database migrations (68)
    ├── migrations-forms/     # D1 forms database migrations (13)
    ├── wrangler.toml         # Staging + production config with D1 bindings
    └── CLOUDFLARE-SETUP.md   # Zone + secrets setup guide

.github/workflows/
└── oursharedevents-ci.yml    # CI/CD: S0 security → T0 gate → T1 staging deploy
                              #        → T2 Bruno contract → T3 smoke → T4 functional

docs/                         # Architecture, regulatory phases, methodology
schemas/                      # JSON schema definitions
specs/                        # Test specifications
tests/                        # Vitest + Playwright test suites
bruno/                        # Bruno API/pages/sharedReport contract collections (T2)
postman/                      # SQL fixtures only — Newman collections retired (OSE-1191)
archive/                      # Legacy GAS/NUSDK code (preserved, not deployed)

STORIES.md                    # Story registry — synced with Linear
API_CONTRACT.md               # API envelope and contract specification
SECURITY_BASELINE.md          # Security posture documentation
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- Cloudflare account with `oursharedevents.com` zone
- Wrangler CLI (`npm install -g wrangler`)

### 1. Install dependencies

```bash
cd workers/oursharedevents
npm install
```

### 2. Set Wrangler secrets (staging)

```bash
wrangler secret put ADMIN_KEY --env staging
wrangler secret put FORMS_ENCRYPTION_KEY --env staging
```

### 3. Run D1 migrations

```bash
wrangler d1 migrations apply ose-main-stg --env staging
wrangler d1 migrations apply ose-forms-stg --env staging
```

### 4. Deploy to staging

```bash
npm run deploy:staging
```

### 5. Verify

```bash
curl https://stg.oursharedevents.com/health
# → { "ok": true, "env": "staging", "d1": "connected" }

curl https://stg.oursharedevents.com/api/v2/events
# → { "ok": true, "items": [...] }
```

---

## CI/CD

Push to `main` → deploys to `stg.oursharedevents.com` + smoke tests
Tag `vX.Y.Z` → deploys to `oursharedevents.com` (human-gated)

**CI pipeline stages:**

1. TypeScript typecheck
2. ESLint + Prettier
3. Semgrep + gitleaks + detect-secrets (security scan)
4. D1 migration validation
5. Staging deploy
6. Playwright smoke tests

**Required GitHub secrets:**

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `ADMIN_KEY`

---

## Story Tracking

Stories are tracked in [Linear](https://linear.app/oursharedevents) under the **OurSharedEvents** team (prefix: OSE). Story IDs appear in commit messages (e.g., `fix(OSE-161): return empty envelope when D1 not bound`).

**Current status:** 117+ stories Done. Staging live. CI green. Production gated on BIPA legal review.

---

## Testing

### Test Pyramid

| Layer            | Tool           | Scope                                      | When                |
| ---------------- | -------------- | ------------------------------------------ | ------------------- |
| Unit/Integration | Vitest         | Handler logic, flag resolution, encryption | CI (every PR)       |
| API Contract     | Newman/Postman | All 30+ endpoints against mock + staging   | Local + CI          |
| Smoke (FE)       | Playwright     | 5 surfaces render, critical flows          | CI (every PR)       |
| Regression (FE)  | Playwright     | Full visual + behavioral                   | Local (pre-release) |

### Running Tests

```bash
# Vitest (unit/integration)
cd workers/oursharedevents && npx vitest run

# Newman (API against mock server)
npx newman run postman/ose-api-staging.json -e postman/mock-env.json

# Playwright smoke
npx playwright test --config=playwright.smoke.config.ts
```

---

## Security

- **Anonymous ID:** 7-layer schema-enforced anonymity on scan data
- **PII Encryption:** AES-256-GCM on stored emails, SHA-256 hashing for dedup
- **PII TTLs:** 30-day email signups, 90-day registrations, scheduled destruction cron
- **Two-Database Separation:** MAIN_DB (no PII) isolated from FORMS_DB (PII with TTLs)
- **CORS:** Origin allowlist enforced on all endpoints (no wildcards)
- **CSP:** Nonce-based Content Security Policy on all HTML surfaces
- **Auth:** CF Access JWT + Bearer token dual auth on admin endpoints
- **Rate Limiting:** In-isolate rate limiter on public form endpoints
- **CI Security:** Semgrep SAST, gitleaks secret scanning, detect-secrets pre-commit
- **Audit Log:** Admin mutation audit trail

See `SECURITY_BASELINE.md` for the full security posture.

---

## Regulatory Phase Model

The platform supports 5 regulatory phases, each unlocking new event types:

| Phase               | Events                                         | Status      |
| ------------------- | ---------------------------------------------- | ----------- |
| Phase 1 — Community | 47 types (sports, dinners, markets, cultural)  | **Active**  |
| Phase 2 — Commerce  | +10 types (ticketed, food trucks, paid events) | June target |
| Phase 3 — Licensed  | +10 types (raffles, political, cannabis)       | Post-June   |
| Phase 4 — HIPAA     | +11 types (health fairs, support groups)       | Pre-AJ demo |
| Phase 5 — COPPA     | +12 types (youth sports, school programs)      | Year 2      |

Two independent axes gate access: subscription tier (Free/Pro/Enterprise) controls features, regulatory phase controls which event types are available per corridor.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

Private — ourCommunityRituals LLC. All rights reserved.
