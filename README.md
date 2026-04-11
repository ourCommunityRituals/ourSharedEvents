# ourSharedEvents

**Core event infrastructure platform** under the [ourCommunityRituals](https://github.com/ourCommunityRituals) organization.

ourSharedEvents powers community leagues and recurring events — from registration and scheduling to public-facing event pages and admin tools. It is the infrastructure layer that other products in the ourCommunityRituals ecosystem build on top of.

---

## The ourCommunityRituals Ecosystem

| Code | Product                           | Role                                                         |
| ---- | --------------------------------- | ------------------------------------------------------------ |
| OSE  | **OurSharedEvents** _(this repo)_ | Core platform — event infrastructure, API, admin             |
| OSG  | **OurSharedGames**                | Founding activation format — anchor game nights              |
| OSR  | **OurSharedRecords**              | Music, story, and archive layer — oral history               |
| OW   | **OurWKRP**                       | Community music curation — named identity, white label tiers |
| OER  | **OurEventRings**                 | Intelligence and analytics — long horizon                    |
| OSM  | **OurSharedMagnets**              | Developer and franchise layer — API, white label support     |
| OSP  | **OurSharedPulse**                | Pre-platform consulting — human-delivered entry point        |
| OWL  | **OurWhiteList**                  | Deployment and white label layer — client fork template      |

---

## Architecture

### Phase 1 + 2 (current) — Cloudflare Worker + D1

```
User
 └── oursharedevents.com (Cloudflare Worker)
      ├── D1 main database (events, sponsors, scans, subscribers)
      └── D1 forms database (registrations, surveys, email signups, feature flags)
```

- TypeScript Cloudflare Worker at `workers/oursharedevents/`
- Cloudflare D1 (edge SQLite) as the data store — 17 migrations, 2 databases
- 3-tier feature flag system (free/mid/enterprise)
- PII lifecycle: daily cron job scrubs expired data
- Public API: `/api/v2/events`
- Admin dashboard: `/admin` (Bearer token auth)
- ~~Google Sheets~~ — removed in Phase 2 D1 migration

### Phase 3 (future) — Firebase

Add Firebase Auth (multi-user admin) and Firebase Hosting (React/Tailwind UI, replaces embedded HTML templates). See `docs/migration/PHASE-3-FIREBASE.md`.

---

## Quick Start (D1-Native Deploy)

### Prerequisites

- Cloudflare account with `oursharedevents.com` added as a zone
- D1 databases provisioned (staging IDs already in `wrangler.toml`)

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

### 3. Apply D1 migrations

```bash
wrangler d1 migrations apply DB --env staging --remote
wrangler d1 migrations apply FORMS_DB --env staging --remote
```

### 4. Deploy to staging

```bash
npm run deploy:staging
```

### 5. Verify

```bash
curl https://stg.oursharedevents.com/health
# → { "ok": true, "env": "staging", "d1": "ok" }

curl https://stg.oursharedevents.com/api/v2/events
# → { "ok": true, "items": [...] }
```

Full infrastructure setup: `docs/deployment/INFRA-CHECKLIST.md`
Zone + DNS config: `workers/oursharedevents/CLOUDFLARE-SETUP.md`

---

## API Reference

| Method | Path                   | Auth   | Description                           |
| ------ | ---------------------- | ------ | ------------------------------------- |
| GET    | `/health`              | —      | Worker health + D1 connectivity       |
| GET    | `/api/status`          | —      | Alias for /health                     |
| GET    | `/api/v2/events`       | —      | List active events                    |
| GET    | `/api/v2/events/:id`   | —      | Single event by ID                    |
| GET    | `/`                    | —      | Public events page (HTML)             |
| GET    | `/admin`               | Bearer | Admin dashboard (HTML)                |
| GET    | `/api/v2/admin/events` | Bearer | Admin events list (includes archived) |

Query params for `/api/v2/events`: `?brand=root`, `?full=true`

---

## Documentation

Full documentation index: [`docs/INDEX.md`](docs/INDEX.md)

| Section          | Path                 | Contents                                        |
| ---------------- | -------------------- | ----------------------------------------------- |
| **Architecture** | `docs/architecture/` | System design, API contracts, integration flows |
| **Security**     | `docs/security/`     | Baselines, hardening, access control (28 files) |
| **Runbooks**     | `docs/runbooks/`     | Operational procedures, incident response       |
| **Deployment**   | `docs/deployment/`   | Deploy guides, environment setup                |
| **QA & Testing** | `docs/qa/`           | E2E guides, test matrices, QA flows             |
| **Monitoring**   | `docs/monitoring/`   | Uptime, synthetic checks, performance           |
| **MVP**          | `docs/mvp/`          | Scope, surfaces, production readiness           |
| **Migration**    | `docs/migration/`    | Phase 1→2→3 migration guides                    |
| **Stories**      | `docs/stories/`      | Epic and story specifications                   |
| **Audits**       | `docs/audits/`       | System and frontend audit reports               |
| **Archive**      | `archive/`           | Historical docs, legacy code (189 files)        |

---

## Repo Structure

```
workers/
└── oursharedevents/        # Phase 1 Cloudflare Worker (TypeScript)
    ├── src/
    │   ├── index.ts        # Entry point
    │   ├── router.ts       # Route table
    │   ├── auth/admin.ts   # Admin auth guard
    │   ├── handlers/       # health, events, pages, forms
    │   └── lib/            # forms-db, feature-flags, cors
    ├── wrangler.toml       # Staging + production config
    └── CLOUDFLARE-SETUP.md # Zone + secrets setup guide

docs/                       # Organized documentation (13 categories)
├── INDEX.md                # Master documentation index
├── architecture/           # System design & contracts
├── security/               # Security baselines & policies
├── runbooks/               # Operational runbooks
├── deployment/             # Deploy & infrastructure
├── qa/                     # Testing & QA
├── monitoring/             # Observability & performance
├── mvp/                    # MVP scope & surfaces
├── migration/              # Phase migration guides
├── stories/                # Epics & stories
├── audits/                 # Audit reports
├── verification/           # Milestone verification
├── env/                    # Environment configuration
├── support/                # Troubleshooting
└── chat-training/          # Live chat training corpus map

.github/workflows/
└── oursharedevents-ci.yml  # CI/CD: typecheck → staging → E2E → production

STORIES.md                  # Story registry — synced with Linear
```

---

## CI/CD

Push to `main` → deploys to `stg.oursharedevents.com` + E2E smoke tests
Tag `vX.Y.Z` → deploys to `oursharedevents.com` + E2E smoke tests

**Required GitHub secrets:**

- `CLOUDFLARE_API_TOKEN_ESE`
- `CLOUDFLARE_ACCOUNT_ID`
- `ADMIN_KEY`

---

## Story Tracking

Stories are tracked in [`STORIES.md`](./STORIES.md) and mirrored to Linear. Each commit that closes a story includes the story ID (e.g., `feat: add health endpoint (P1-1)`).

**Current status:** Worker ✅ · D1 ✅ · CI ✅ · Feature flags ✅ · Forms ✅ · Staging deploy 📋 · Prod launch 📋
