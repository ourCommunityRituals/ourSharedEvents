# ourSharedEvents

**Core event infrastructure platform** under the [ourCommunityRituals](https://github.com/ourCommunityRituals) organization.

ourSharedEvents powers community leagues and recurring events — from registration and scheduling to public-facing event pages and admin tools. It is the infrastructure layer that other products in the ourCommunityRituals ecosystem build on top of.

---

## The ourCommunityRituals Ecosystem

| Product | Role |
|---------|------|
| **ourSharedEvents** *(this repo)* | Core platform — event infrastructure, API, admin |
| **ourRecNights** | Product: recreational night leagues |
| **OurRecordNights** | Product: record-night social events |
| **OurOpenTables** | Product: open-table community dinners |
| **ourEventRings** | Research: data analysis from ourSharedEvents usage |
| **OurMagnets** | Technical: Cloudflare/infra setup layer |
| **OurPulse** | Consulting: manual league onboarding → ourSharedEvents adoption |

---

## Architecture

### Phase 1 (current) — Cloudflare Worker + Google Sheets

```
User
 └── oursharedevents.com (Cloudflare Worker)
      └── Google Sheets (event data)
```

- TypeScript Cloudflare Worker at `workers/oursharedevents/`
- Google Sheets as the data store (zero infrastructure to manage)
- Public API: `/api/v2/events`
- Admin dashboard: `/admin` (Bearer token auth)

### Phase 2 (next) — Cloudflare D1

Replace Google Sheets with Cloudflare D1 (edge SQLite). Same Worker, surgical data-layer swap. See `docs/migration/PHASE-2-D1-DATABASE.md`.

### Phase 3 (future) — Firebase

Add Firebase Auth (multi-user admin) and Firebase Hosting (React/Tailwind UI, replaces embedded HTML templates). See `docs/migration/PHASE-3-FIREBASE.md`.

---

## Quick Start (Phase 1 Deploy)

### Prerequisites
- Cloudflare account with `oursharedevents.com` added as a zone
- Google Sheets spreadsheet with an `EVENTS` sheet
- Google Service Account with Sheets API access

### 1. Install dependencies
```bash
cd workers/oursharedevents
npm install
```

### 2. Set Wrangler secrets (staging)
```bash
wrangler secret put GOOGLE_SA_CLIENT_EMAIL --env staging
wrangler secret put GOOGLE_SA_PRIVATE_KEY_PEM --env staging
wrangler secret put SHEETS_SPREADSHEET_ID --env staging
wrangler secret put ADMIN_KEY --env staging
```

### 3. Deploy to staging
```bash
npm run deploy:staging
```

### 4. Verify
```bash
curl https://stg.oursharedevents.com/health
# → { "ok": true, "env": "staging" }

curl https://stg.oursharedevents.com/api/v2/events
# → { "ok": true, "items": [...] }
```

Full setup guide (DNS, zone config, production deploy): `workers/oursharedevents/CLOUDFLARE-SETUP.md`

---

## API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Worker health + Sheets connectivity |
| GET | `/api/status` | — | Alias for /health |
| GET | `/api/v2/events` | — | List active events |
| GET | `/api/v2/events/:id` | — | Single event by ID |
| GET | `/` | — | Public events page (HTML) |
| GET | `/admin` | Bearer | Admin dashboard (HTML) |
| GET | `/api/v2/admin/events` | Bearer | Admin events list (includes archived) |

Query params for `/api/v2/events`: `?brand=root`, `?full=true`

---

## Repo Structure

```
workers/
└── oursharedevents/        # Phase 1 Cloudflare Worker (TypeScript)
    ├── src/
    │   ├── index.ts        # Entry point
    │   ├── router.ts       # Route table
    │   ├── auth/admin.ts   # Admin auth guard
    │   ├── handlers/       # health, events, pages
    │   └── lib/            # google-auth, sheets
    ├── wrangler.toml       # Staging + production config
    └── CLOUDFLARE-SETUP.md # Zone + secrets setup guide

.github/workflows/
└── oursharedevents-ci.yml  # CI/CD: typecheck → staging → E2E → production

docs/migration/
├── PHASE-1-OURSHAREDEVENTS.md
├── PHASE-2-D1-DATABASE.md
└── PHASE-3-FIREBASE.md

STORIES.md                  # Story registry — synced with Trello
```

---

## CI/CD

Push to `main` → deploys to `stg.oursharedevents.com` + E2E smoke tests
Tag `vX.Y.Z` → deploys to `oursharedevents.com` + E2E smoke tests

**Required GitHub secrets:**
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `ADMIN_KEY`

---

## Story Tracking

Stories are tracked in [`STORIES.md`](./STORIES.md) and mirrored to Trello. Each commit that closes a story includes the story ID (e.g., `feat: add health endpoint (P1-1)`).

**Phase 1 status:** Worker ✅ · CI ✅ · README ✅ · Secrets setup 📋 · Repo migration 📋
