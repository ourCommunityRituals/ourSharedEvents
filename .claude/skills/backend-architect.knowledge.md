# Lead Backend Architect — Knowledge Base

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
│   ├── events.ts      # Event CRUD: list, get, admin list (198 lines)
│   ├── health.ts      # Health + optional Sheets connectivity (54 lines)
│   └── pages.ts       # Embedded HTML: public + admin (161 lines)
└── lib/
    ├── google-auth.ts # Google SA JWT via Web Crypto RS256 (147 lines)
    └── sheets.ts      # Sheets API client, 10s timeout (77 lines)
```

**Total: ~740 lines of production TypeScript.**

### Route Table (Complete)

| Method | Path | Handler | Auth |
|--------|------|---------|------|
| GET | `/` | `handlePublicPage` | None |
| GET | `/admin` | `handleAdminPage` | Bearer/CF Access |
| GET | `/health` | `handleHealth` | None |
| GET | `/api/status` | `handleHealth` | None |
| GET | `/api/v2/events` | `handleListEvents` | None |
| GET | `/api/v2/events/:id` | `handleGetEvent` | None |
| GET | `/api/v2/admin/events` | `handleAdminListEvents` | Bearer/CF Access |
| OPTIONS | `*` | CORS preflight | None |
| * | `*` | 404 JSON | None |

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

**Current (Phase 1):** Google Sheets via Service Account JWT
- `sheetsGetValues(env, range)` → `string[][]`
- Single function, 10s AbortController timeout
- Column mapping constants in `events.ts` (COL.ID, COL.BRAND_ID, etc.)
- Latency: 200-800ms per request

**Planned (Phase 2):** D1 (edge SQLite)
- Target: <5ms per query
- Schema already written (7 migrations, 7 tables, 11 indexes)
- `d1.ts` not yet created — same exported function signatures as `sheets.ts`

### D1 Schema (Already Built)

| Table | Columns | Key Relationships |
|-------|---------|-------------------|
| events | 16 | Root entity, slug UNIQUE |
| sponsors | 12 | FK → events, click/impression tokens UNIQUE |
| poster_deployments | 10 | FK → events, qr_token UNIQUE |
| scans | 9 | FK → events + poster_deployments, PII-free |
| checkins | 7 | FK → events |
| registrations | 8 | FK → events, source_placement for ROI |
| scan_aggregates | 9 | FK → events, populated by scheduled jobs only |

**PII Firewall:** `scans` table explicitly excludes user_email, user_name, ip_address, exact_timestamp. Verified by automated schema gate test.

### Environment Configuration (wrangler.toml)

| Env | Route | D1 DB | Admin Fallback |
|-----|-------|-------|----------------|
| dev | localhost | `ocr-db-local` | N/A |
| staging | `stg.oursharedevents.com/*` | `ocr-db-staging` | ✅ Enabled |
| production | `oursharedevents.com/*`, `www.*` | `ocr-db-production` | ❌ Disabled |

### Required Secrets (per environment)

| Secret | Purpose |
|--------|---------|
| `ADMIN_KEY` | Bearer token auth |
| `SHEETS_SPREADSHEET_ID` | Google Sheets data source |
| `GOOGLE_SA_CLIENT_EMAIL` | Service account identity |
| `GOOGLE_SA_PRIVATE_KEY_PEM` | Service account signing key |
| `GOOGLE_MAPS_API_KEY` | Maps integration |
| `BIGQUERY_DATASET_ID` | Analytics (future) |
| `GCP_PROJECT_ID` | Google Cloud project |
| `VERTEX_AI_MODEL_ID` | AI features (future) |

---

## Known Gaps

1. **Dual Worker:** `worker/` (5,000+ lines, 40+ handlers) exists alongside `workers/oursharedevents/` (740 lines, 5 handlers). The feature-rich `worker/` has admin CRUD, file uploads, OAuth, sponsor management, monetization hooks, BigQuery/Vertex integrations. Canonical CI deploys from `workers/oursharedevents/`.

2. **No d1.ts yet:** Phase 2 data layer client not created. Same function signature swap planned.

3. **No route handler unit tests:** Vitest tests only cover D1 schema/constraints. No unit tests for `events.ts`, `health.ts`, `pages.ts`, `admin.ts`.

4. **API envelope inconsistency:** `workers/oursharedevents/` returns `{ ok, items }` while docs reference `{ ok, value }` envelope from the legacy system.

---

## Decision Log

| Decision | Rationale | Date |
|----------|-----------|------|
| Vanilla TS router (no Hono) | Minimize dependencies, <50KB bundle target | Pre-2026 |
| Web Crypto for JWT signing | Edge-compatible, no Node.js crypto dependency | Pre-2026 |
| CF Access + Bearer dual auth | CF Access for production security, Bearer for staging/testing | Pre-2026 |
| D1 over Turso/PlanetScale | Native Cloudflare integration, zero-latency binding | Pre-2026 |
| PII firewall in schema | Privacy-by-design, scans table anonymized at DB level | Pre-2026 |
