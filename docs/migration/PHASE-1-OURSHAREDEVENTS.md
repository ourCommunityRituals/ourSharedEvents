# Phase 1 – OurSharedEvents.com Worker

**Status:** In progress
**Branch:** `claude/setup-cloudflare-worker-XBVK5`
**Goal:** Ship a fully functional Cloudflare Worker on `oursharedevents.com` backed by Google Sheets, replacing the blocked `stg.eventangle.com`.

---

## Scope

Phase 1 is intentionally scoped to: deploy a working product on the new domain without any data-layer migration. Google Sheets remains the source of truth. The code is written to make D1 (Phase 2) a surgical swap.

---

## Deliverables

| # | Deliverable | File(s) |
|---|-------------|---------|
| 1 | Google Auth (JWT + token cache) | `src/lib/google-auth.ts` |
| 2 | Sheets API read client | `src/lib/sheets.ts` |
| 3 | Admin auth guard (CF Access + Bearer fallback) | `src/auth/admin.ts` |
| 4 | Health + status handler | `src/handlers/health.ts` |
| 5 | Events API v2 handler | `src/handlers/events.ts` |
| 6 | HTML page handler (public + admin) | `src/handlers/pages.ts` |
| 7 | Central router | `src/router.ts` |
| 8 | Worker entry point | `src/index.ts` |
| 9 | Cloudflare zone + deploy guide | `CLOUDFLARE-SETUP.md` |

---

## Routes

### Public
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Worker health + Sheets connectivity |
| GET | `/api/status` | Alias for `/health` |
| GET | `/api/v2/events` | List events (`?brand=root&full=true`) |
| GET | `/api/v2/events/:id` | Single event by ID |
| GET | `/` | Public events listing page |

### Admin (requires auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin` | Admin dashboard page |
| GET | `/api/v2/admin/events` | Admin events list (includes archived) |

---

## Environment / Secrets

### `wrangler.toml` vars (non-secret)
```
WORKER_ENV          = "staging" | "production"
WORKER_BUILD_VERSION = "stg-2026.03.22"
ALLOW_ADMIN_KEY_FALLBACK = "true"   # staging only
```

### Wrangler secrets (per env)
```bash
wrangler secret put GOOGLE_SA_CLIENT_EMAIL    --env staging
wrangler secret put GOOGLE_SA_PRIVATE_KEY_PEM --env staging
wrangler secret put SHEETS_SPREADSHEET_ID     --env staging
wrangler secret put ADMIN_KEY                 --env staging
```

---

## Data model

Google Sheets `EVENTS` sheet column layout (unchanged from eventangle worker):

| Col | Field | Notes |
|-----|-------|-------|
| A | ID | `evt_xxxx` format |
| B | BRAND_ID | `root`, `abc`, `cbc`, `cbl` |
| C | TEMPLATE_ID | optional |
| D | DATA_JSON | full event payload (JSON string) |
| E | CREATED_AT | ISO timestamp |
| F | SLUG | URL slug |
| G | UPDATED_AT | ISO timestamp |
| H | STATUS | `active` \| `archived` |
| I | IS_DEFAULT | boolean string |
| J | ASSET_STATE | lifecycle state |

---

## D1-Readiness (Phase 2 prep)

All Sheets calls are isolated in `src/lib/sheets.ts` and called only from handlers via a thin `getData(env, …)` abstraction. When Phase 2 migrates to D1:
- Replace `src/lib/sheets.ts` with `src/lib/d1.ts`
- Handler code changes minimally (swap `sheetsGetValues` → `db.prepare().all()`)
- Auth layer is unchanged

---

## Acceptance Criteria

- [ ] `curl https://stg.oursharedevents.com/health` → `{ ok: true, env: "staging" }`
- [ ] `curl https://stg.oursharedevents.com/api/v2/events` → `{ ok: true, items: [...] }`
- [ ] `GET /` returns HTML (200)
- [ ] `GET /admin` without token → 401
- [ ] `GET /admin` with valid Bearer → 200
- [ ] Deploy via `npm run deploy:staging` succeeds

---

## Deploy Steps

```bash
# 1. Add domain to Cloudflare (see CLOUDFLARE-SETUP.md)

# 2. Install deps
cd workers/oursharedevents && npm install

# 3. Set secrets
wrangler secret put GOOGLE_SA_CLIENT_EMAIL    --env staging
wrangler secret put GOOGLE_SA_PRIVATE_KEY_PEM --env staging
wrangler secret put SHEETS_SPREADSHEET_ID     --env staging
wrangler secret put ADMIN_KEY                 --env staging

# 4. Deploy
npm run deploy:staging

# 5. Verify
curl https://stg.oursharedevents.com/health
curl https://stg.oursharedevents.com/api/v2/events
```
