# Phase 2 – Migrate Data Layer from Google Sheets to Cloudflare D1

**Status:** Not started (begins after Phase 1 is stable)
**Prerequisite:** Phase 1 live and verified on `oursharedevents.com`
**Goal:** Replace Google Sheets as the data store with Cloudflare D1 (SQLite at the edge). Eliminate all Google SA credentials and Sheets API calls.

---

## Why D1

| Factor | Google Sheets | Cloudflare D1 |
|--------|---------------|---------------|
| Latency | 200–800ms (external API) | <5ms (co-located with Worker) |
| Query flexibility | Row-based range reads | Full SQL |
| Writes | Sheet append/update API | Standard SQL INSERT/UPDATE |
| Auth dependency | Google SA credentials | None (bound to Worker) |
| Rate limits | 300 req/min per project | Worker-native, no external quota |
| Cost | Free (with limits) | Free tier 5M rows/day, then $0.001/M |

---

## Scope

- Design and migrate SQL schema
- Build D1 migration tooling (Sheets → D1)
- Swap the data layer in `workers/oursharedevents/src/lib/`
- Remove all Google SA secrets
- No changes to auth, routing, or HTML pages

---

## SQL Schema

```sql
-- migrations/0001_initial.sql

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
DB: D1Database;  // add this
// Remove: GOOGLE_SA_CLIENT_EMAIL, GOOGLE_SA_PRIVATE_KEY_PEM, SHEETS_SPREADSHEET_ID
```

---

## Migration Steps

### Step 1 – Create D1 databases
```bash
wrangler d1 create oursharedevents-staging
wrangler d1 create oursharedevents-prod
```
Copy the returned `database_id` into `wrangler.toml`.

### Step 2 – Apply schema migrations
```bash
wrangler d1 execute oursharedevents-staging --file=migrations/0001_initial.sql
wrangler d1 execute oursharedevents-prod    --file=migrations/0001_initial.sql
```

### Step 3 – Export from Google Sheets
Write a one-time migration script `scripts/migrate-sheets-to-d1.ts`:
- Read all rows from the `EVENTS`, `ANALYTICS`, `SHORTLINKS`, `CONFIG` sheets
- Transform to SQL INSERT statements
- Execute via `wrangler d1 execute --command`

### Step 4 – Swap data layer
Replace `src/lib/sheets.ts` with `src/lib/d1.ts`:

```ts
// src/lib/d1.ts (replaces sheets.ts)
export async function listEvents(db: D1Database, brandId: string): Promise<Event[]> {
  const { results } = await db.prepare(
    'SELECT * FROM events WHERE brand_id = ? AND status = ? ORDER BY created_at DESC'
  ).bind(brandId, 'active').all<EventRow>();
  return results.map(rowToEvent);
}
```

Update handlers to accept `D1Database` instead of `SheetsEnv`.

### Step 5 – Remove Google credentials
```bash
wrangler secret delete GOOGLE_SA_CLIENT_EMAIL    --env staging
wrangler secret delete GOOGLE_SA_PRIVATE_KEY_PEM --env staging
wrangler secret delete SHEETS_SPREADSHEET_ID     --env staging
# Repeat for production
```

Delete `src/lib/google-auth.ts` and `src/lib/sheets.ts`.

---

## Files Changed

| File | Action |
|------|--------|
| `wrangler.toml` | Add D1 bindings, remove Sheets vars |
| `src/index.ts` | Update `Env` interface |
| `src/lib/sheets.ts` | Delete |
| `src/lib/google-auth.ts` | Delete |
| `src/lib/d1.ts` | Create (new data access layer) |
| `src/handlers/events.ts` | Swap `sheetsGetValues` → D1 query |
| `migrations/0001_initial.sql` | Create (schema) |
| `scripts/migrate-sheets-to-d1.ts` | Create (one-time migration) |

---

## Acceptance Criteria

- [ ] `wrangler d1 execute --command "SELECT count(*) FROM events"` returns correct row count
- [ ] `GET /api/v2/events` returns same data as before migration
- [ ] No `GOOGLE_SA_*` secrets remain in wrangler secret list
- [ ] `/health` no longer reports `sheets` status (field removed or renamed `db`)
- [ ] Write operations (create/update event) persist to D1

---

## Rollback Plan

Keep the Sheets secrets in place during a 2-week parallel-run period. The migration script can be run in reverse (D1 → Sheets export) if needed.
