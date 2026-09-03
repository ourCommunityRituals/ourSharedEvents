# Lead Backend Architect — Knowledge Base

> **Reconciliation note (2026-09-03, code wins):** route table, migration count and Known Gaps are stale: 68 main + 13 forms migrations; ≈75 method+path pairs (see the `router.ts` header); OSE-1080 object-level brand scoping, anonymous ID, rate limiting, audit log and the SharedReport read API are all shipped. Trust root `CLAUDE.md` §3 and `router.ts` over the tables below until this file's truth pass (Linear: see OSE reconciliation story 2026-09-03).

> **Role:** Owns Worker architecture, route design, data layer, auth, and API contracts
> **Last Reconciled:** 2026-03-27

---

## Current Architecture State

### Canonical Implementation: `workers/oursharedevents/src/`

```
src/
├── index.ts           # Entry (32 lines) — global error handler → router
├── router.ts          # Route table (80 lines) — vanilla TS, no framework
├── auth/admin.ts      # Two-method auth: CF Access JWT + Bearer fallback (72 lines)
├── handlers/
│   ├── events.ts      # Event CRUD via D1
│   ├── health.ts      # Health + D1 connectivity check
│   ├── pages.ts       # Embedded HTML: public, admin, landing
│   ├── forms.ts       # Form submissions (register, checkin, survey, email)
│   ├── form-pages.ts  # Mobile-first QR form landing pages
│   └── feature-flags.ts # Admin flag management (8 endpoints)
└── lib/
    ├── forms-db.ts    # Privacy utilities (hash, encrypt, bucket)
    ├── feature-flags.ts # Flag resolution (3-tier: free/mid/enterprise)
    └── cors.ts        # CORS allowlist
```

**Total: ~740 lines of production TypeScript.**

### Route Table (Complete)

| Method  | Path                   | Handler                 | Auth             |
| ------- | ---------------------- | ----------------------- | ---------------- |
| GET     | `/`                    | `handlePublicPage`      | None             |
| GET     | `/admin`               | `handleAdminPage`       | Bearer/CF Access |
| GET     | `/health`              | `handleHealth`          | None             |
| GET     | `/api/status`          | `handleHealth`          | None             |
| GET     | `/api/v2/events`       | `handleListEvents`      | None             |
| GET     | `/api/v2/events/:id`   | `handleGetEvent`        | None             |
| GET     | `/api/v2/admin/events` | `handleAdminListEvents` | Bearer/CF Access |
| OPTIONS | `*`                    | CORS preflight          | None             |
| \*      | `*`                    | 404 JSON                | None             |

### Auth Model

```
Request → CF Access JWT check (decode + expiry)
            ↓ fail
         Bearer token check (constant-time compare vs ADMIN_KEY)
            ↓ fail
         401 + WWW-Authenticate header
```

- **Staging:** `ALLOW_ADMIN_KEY_FALLBACK=true` enables Bearer fallback
- **Production:** CF Access JWT is primary; Bearer is fallback
- **Phase 3 target:** Firebase Auth replaces both

### Data Layer

**Current (Phase 1+2):** Cloudflare D1 (edge SQLite)

- Two D1 databases: main (events, sponsors, scans) + forms (registrations, surveys, flags)
- 17 migrations applied, 11+ tables, 11 indexes
- Target: <5ms per query at edge
- Handlers query `env.DB` and `env.FORMS_DB` directly
- ~~Google Sheets~~ — removed in Phase 2 D1 migration. No `sheets.ts` or `google-auth.ts` in active code.

### D1 Schema (Already Built)

| Table              | Columns | Key Relationships                             |
| ------------------ | ------- | --------------------------------------------- |
| events             | 16      | Root entity, slug UNIQUE                      |
| sponsors           | 12      | FK → events, click/impression tokens UNIQUE   |
| poster_deployments | 10      | FK → events, qr_token UNIQUE                  |
| scans              | 9       | FK → events + poster_deployments, PII-free    |
| checkins           | 7       | FK → events                                   |
| registrations      | 8       | FK → events, source_placement for ROI         |
| scan_aggregates    | 9       | FK → events, populated by scheduled jobs only |

**PII Firewall:** `scans` table explicitly excludes user_email, user_name, ip_address, exact_timestamp. Verified by automated schema gate test.

### Environment Configuration (wrangler.toml)

| Env        | Route                            | D1 DB               | Admin Fallback |
| ---------- | -------------------------------- | ------------------- | -------------- |
| dev        | localhost                        | `ocr-db-local`      | N/A            |
| staging    | `stg.oursharedevents.com/*`      | `ocr-db-staging`    | ✅ Enabled     |
| production | `oursharedevents.com/*`, `www.*` | `ocr-db-production` | ❌ Disabled    |

### Required Secrets (per environment)

| Secret                          | Purpose                           | Status       |
| ------------------------------- | --------------------------------- | ------------ |
| `ADMIN_KEY`                     | Bearer token auth                 | Required     |
| `FORMS_ENCRYPTION_KEY`          | AES-GCM encryption for PII fields | Required     |
| `GOOGLE_MAPS_API_KEY`           | Maps integration (SharedReports)  | Future       |
| `BIGQUERY_DATASET_ID`           | Analytics export                  | Future       |
| `GCP_PROJECT_ID`                | Google Cloud project              | Future       |
| `VERTEX_AI_MODEL_ID`            | AI features                       | Future       |
| ~~`SHEETS_SPREADSHEET_ID`~~     | ~~Google Sheets~~                 | Removed (D1) |
| ~~`GOOGLE_SA_CLIENT_EMAIL`~~    | ~~Service account~~               | Removed (D1) |
| ~~`GOOGLE_SA_PRIVATE_KEY_PEM`~~ | ~~SA signing key~~                | Removed (D1) |

---

## Known Gaps

1. **Route expansion:** 30+ routes implemented (events, forms, feature flags, admin, pages). Route table in `router.ts`.

2. **D1 migration complete:** Phase 2 D1 swap done. All handlers query D1 directly. No Sheets code remains.

3. **Remaining gaps:** Anonymous ID handler (BE-1), rate limiting (BE-2), PII audit log (BE-3), 5 admin endpoints unimplemented.

4. **Forms system:** 4 form types (register, checkin, survey, email) with PII encryption and daily cron scrub.

---

## Decision Log

| Decision                     | Rationale                                                     | Date     |
| ---------------------------- | ------------------------------------------------------------- | -------- |
| Vanilla TS router (no Hono)  | Minimize dependencies, <50KB bundle target                    | Pre-2026 |
| Web Crypto for JWT signing   | Edge-compatible, no Node.js crypto dependency                 | Pre-2026 |
| CF Access + Bearer dual auth | CF Access for production security, Bearer for staging/testing | Pre-2026 |
| D1 over Turso/PlanetScale    | Native Cloudflare integration, zero-latency binding           | Pre-2026 |
| PII firewall in schema       | Privacy-by-design, scans table anonymized at DB level         | Pre-2026 |
