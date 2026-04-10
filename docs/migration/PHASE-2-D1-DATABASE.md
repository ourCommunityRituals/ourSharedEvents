# Phase 2 – Migrate Data Layer from Google Sheets to Cloudflare D1

**Status:** Step 1 complete — schema migrations written, D1 bindings configured, staging DBs provisioned. Production DB IDs pending INFRA-1.
**Prerequisite:** Phase 1 live and verified on `oursharedevents.com`
**Goal:** Replace Google Sheets as the data store with Cloudflare D1 (SQLite at the edge). Eliminate all Google SA credentials and Sheets API calls.

---

## Why D1

| Factor            | Google Sheets            | Cloudflare D1                        |
| ----------------- | ------------------------ | ------------------------------------ |
| Latency           | 200–800ms (external API) | <5ms (co-located with Worker)        |
| Query flexibility | Row-based range reads    | Full SQL                             |
| Writes            | Sheet append/update API  | Standard SQL INSERT/UPDATE           |
| Auth dependency   | Google SA credentials    | None (bound to Worker)               |
| Rate limits       | 300 req/min per project  | Worker-native, no external quota     |
| Cost              | Free (with limits)       | Free tier 5M rows/day, then $0.001/M |

---

## Scope

- Design and migrate SQL schema
- Build D1 migration tooling (Sheets → D1)
- Swap the data layer in `workers/oursharedevents/src/lib/`
- Remove all Google SA secrets
- No changes to auth, routing, or HTML pages

---

## SQL Schema

> **Note:** The schema evolved beyond this original spec during Phase 1 build. The actual schema spans 13 migration files in `workers/oursharedevents/migrations/` covering: events, sponsors, poster_deployments, scans, checkins, registrations, scan_aggregates, subscribers, NCR v2 hierarchy, corridor growth model, ring emergence support, and indexes. The original 4-table spec below is superseded by the actual migrations.

```sql
-- Original spec (superseded by migrations/0001–0013):

CREATE TABLE events (
  id           TEXT PRIMARY KEY,          -- evt_xxxx
  brand_id     TEXT NOT NULL DEFAULT 'root',
  template_id  TEXT,
  data_json    TEXT NOT NULL,             -- full event payload
  slug         TEXT,
  status       TEXT NOT NULL DEFAULT 'active',  -- active | archived
  is_default   INTEGER NOT NULL DEFAULT 0,      -- 0 | 1
  asset_state  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_events_brand_status ON events (brand_id, status);
CREATE INDEX idx_events_slug         ON events (slug);

CREATE TABLE analytics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  metadata   TEXT,                        -- JSON string
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_analytics_event ON analytics (event_id, created_at);

CREATE TABLE shortlinks (
  code       TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## wrangler.toml Changes

Add D1 bindings:

```toml
# Staging
[[env.staging.d1_databases]]
binding  = "DB"
database_name = "oursharedevents-staging"
database_id   = ""   # fill in after: wrangler d1 create oursharedevents-staging

# Production
[[env.production.d1_databases]]
binding  = "DB"
database_name = "oursharedevents-prod"
database_id   = ""   # fill in after: wrangler d1 create oursharedevents-prod
```

Update `Env` interface in `src/index.ts`:

```ts
DB: D1Database; // add this
// Remove: GOOGLE_SA_CLIENT_EMAIL, GOOGLE_SA_PRIVATE_KEY_PEM, SHEETS_SPREADSHEET_ID
```

---

## Migration Steps

> **Reconciliation (2026-04-08):** The codebase was built D1-native — handlers query `env.DB` directly and no Sheets client code was ever in the active source. Steps 3-5 below were never needed. Legacy Sheets/GAS code is archived in `archive/`.

### Step 1 – Create D1 databases ✅

Staging databases provisioned with real IDs in `wrangler.toml`. Production IDs are placeholders pending INFRA-1.

- `ocr-db-staging` (ID: `4c4381db-...`)
- `ocr-forms-db-staging` (ID: `ff1cb46d-...`)

### Step 2 – Apply schema migrations ✅

13 migration files in `migrations/` covering events, sponsors, poster_deployments, scans, checkins, registrations, scan_aggregates, subscribers, NCR v2 hierarchy, corridor growth, ring emergence, indexes, and seed data. Applied via `wrangler d1 migrations apply`.

### Step 3 – Export from Google Sheets — N/A

Not needed. The app was built D1-first; no runtime Sheets dependency ever existed in the active codebase.

### Step 4 – Swap data layer — N/A

Handlers (`events.ts`, `forms.ts`, `feature-flags.ts`) were written directly against D1. No `sheets.ts` → `d1.ts` swap was necessary.

### Step 5 – Remove Google credentials — N/A

No Google SA secrets were ever set in the active Worker config. No `googleapis` dependency in `package.json`.

---

## Acceptance Criteria

- [x] `wrangler d1 migrations list` shows all 13 migrations recognized
- [x] `GET /api/v2/events` queries D1 directly (`events.ts` line 55)
- [x] No `GOOGLE_SA_*` references in active source code
- [x] 113 Vitest tests pass locally (verified 2026-04-08)
- [x] TypeScript compiles cleanly

---

## Rollback Plan

N/A — there was no Sheets runtime to roll back to. Legacy code preserved in `archive/` for reference.
