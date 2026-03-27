# ourSharedEvents — Story Registry

Master list of all development stories. Read top to bottom — this is the order you do the work.
Synced with Trello: fill in `Trello #` when cards are created.

**Workflow:**
- Creating a Trello card → fill in the `Trello #` column with the card short ID (e.g., `42`)
- Starting work → change status to 🔄 IN PROGRESS, commit this file
- Finishing → change status to ✅ DONE, include story ID in commit message (e.g., `feat: add health endpoint (P1-1)`)

> **Trello setup:** When ready — provide API key + token to Claude and all cards are created automatically with `Trello #` filled in.

---

## Master Status Table

Stories are ordered by the sequence you work through them. Each row unlocks the next.

| Story ID | Trello # | Status | Title | Prerequisite |
|----------|----------|--------|-------|--------------|
| **Phase 0 — Project Setup** | | | | |
| P0-1 | — | 📋 BACKLOG | Create Trello board + import all stories | — |
| **Phase 1 — Build (code + docs)** | | | | |
| P1-1 | — | ✅ DONE | Cloudflare Worker code | — |
| P1-2 | — | ✅ DONE | CI/CD pipeline (GitHub Actions) | P1-1 |
| P1-3 | — | ✅ DONE | README — ourSharedEvents identity | P1-1 |
| P1-4 | — | ✅ DONE | STORIES.md — project tracking registry | P1-3 |
| P1-5 | — | ✅ DONE | E2E launch checklist (this doc's guide) | P1-4 |
| **Phase 1 — Operations (go live)** | | | | |
| P1-6 | — | 📋 BACKLOG | Infra provisioning — Google Cloud + Cloudflare | P1-5 |
| P1-7 | — | 🔄 IN PROGRESS | Secrets + first staging deploy | P1-6 |
| P1-8 | — | 📋 BACKLOG | Staging sign-off — all checks pass | P1-7 |
| P1-9 | — | 📋 BACKLOG | Repo migration → ourCommunityRituals/ourSharedEvents | P1-8 |
| P1-10 | — | 📋 BACKLOG | Production launch — v1.0.0 live | P1-9 |
| **Phase 2 — D1 Database (replace Google Sheets)** | | | | |
| P2-1 | — | 📋 BACKLOG | D1 database creation + schema migrations | P1-10 |
| P2-2 | — | 📋 BACKLOG | Data migration script: Sheets → D1 | P2-1 |
| P2-3 | — | 📋 BACKLOG | Swap data layer: sheets.ts → d1.ts | P2-2 |
| P2-4 | — | 📋 BACKLOG | Remove Google SA credentials (cleanup) | P2-3 |
| **Phase 3 — Firebase (auth + modern UI)** | | | | |
| P3-1 | — | 📋 BACKLOG | Firebase Hosting + React/Tailwind UI | P2-3 |
| P3-2 | — | 📋 BACKLOG | Firebase Auth — replace Bearer token admin | P3-1 |

---

## Phase 0 — Project Setup

### P0-1: Create Trello board + import all stories
**Status:** 📋 BACKLOG
**Prerequisite:** —
**Unlocks:** Everything — gives you a Trello board to track all work below
**Description:** Create the `ourSharedEvents` Trello board under the `ourCommunityRituals` workspace. Create columns: Backlog / In Progress / Done. Create one card per story in this file. Record each card's short ID in the `Trello #` column above.
**How to automate:** Provide Trello API key + token to Claude → all cards created via Trello REST API, `Trello #` column auto-filled.

---

## Phase 1 — Build

*Stories P1-1 through P1-5 are complete. They represent everything built and documented before the operational launch work begins.*

### P1-1: Cloudflare Worker code
**Status:** ✅ DONE
**Prerequisite:** —
**Unlocks:** P1-2 (CI/CD needs something to deploy)
**Description:** TypeScript Cloudflare Worker serving the public events listing, admin dashboard, and `/api/v2/events` JSON API. Data source is Google Sheets (Phase 1). All handler logic isolated so Phase 2 (D1) swap is surgical.
**Acceptance criteria:**
- `GET /health` → `{ ok: true, env: "staging" }`
- `GET /api/v2/events` → `{ ok: true, items: [...] }`
- `GET /` → 200 HTML
- `GET /admin` without token → 401
- `GET /admin` with Bearer token → 200
**Files:** `workers/oursharedevents/`
**Commits:** `210d208`, `c2a32a5`

---

### P1-2: CI/CD pipeline (GitHub Actions)
**Status:** ✅ DONE
**Prerequisite:** P1-1 ✅
**Unlocks:** P1-7 (secrets + deploy — CI/CD is the automation that runs deployments)
**Description:** GitHub Actions workflow that runs TypeScript checks on every PR, deploys to `stg.oursharedevents.com` on every push to `main`, runs E2E smoke tests, and deploys to production on `vX.Y.Z` tags.
**Acceptance criteria:**
- Push to `main` → staging deploy completes + E2E tests pass
- Tag `vX.Y.Z` → production deploy completes
**Files:** `.github/workflows/oursharedevents-ci.yml`
**Commits:** `791f9ce`

---

### P1-3: README — ourSharedEvents identity
**Status:** ✅ DONE
**Prerequisite:** P1-1 ✅
**Unlocks:** P1-4 (STORIES.md builds on the identity established here)
**Description:** Rewrote README.md to describe ourSharedEvents as the core platform under ourCommunityRituals. Replaced old Zeventbook MVP / Google Apps Script narrative. Includes ecosystem overview, Phase 1-3 architecture, API reference, quick start.
**Files:** `README.md`
**Commits:** `2e91855`

---

### P1-4: STORIES.md — project tracking registry
**Status:** ✅ DONE
**Prerequisite:** P1-3 ✅
**Unlocks:** P1-5 (E2E checklist builds on story IDs defined here)
**Description:** This file. Single source of truth for all stories. Trello-synced via `Trello #` column.
**Files:** `STORIES.md`
**Commits:** `2e91855`

---

### P1-5: E2E launch checklist
**Status:** ✅ DONE
**Prerequisite:** P1-4 ✅
**Unlocks:** P1-6 (infra provisioning — the checklist tells you exactly what to do next)
**Description:** Step-by-step doc `E2E-LAUNCH.md` covering every action from zero to live site: Google Cloud setup, Cloudflare zone + DNS, secrets configuration, first staging deploy, staging sign-off, repo migration, and production launch. Each part tagged with the story it fulfills.
**Files:** `E2E-LAUNCH.md`
**Commits:** `eeae17c`

---

## Phase 1 — Operations

*Work through P1-6 through P1-10 in order. Each story is a gate — don't start the next until the current one's acceptance criteria are met.*

### P1-6: Infra provisioning — Google Cloud + Cloudflare
**Status:** 📋 BACKLOG
**Prerequisite:** P1-5 ✅ (follow E2E-LAUNCH.md Parts 1–3)
**Unlocks:** P1-7 (secrets need somewhere to live — infra must exist first)
**Description:** Set up the two external services the worker depends on: Google Cloud service account with Sheets access, and Cloudflare zone for oursharedevents.com with DNS records pointing to the worker.
**Acceptance criteria:**
- Google Cloud project exists, Sheets API enabled
- Service account created, key JSON downloaded
- Google Sheets spreadsheet created with `EVENTS` tab + correct columns + test event row
- Spreadsheet shared with service account email
- `oursharedevents.com` zone is active in Cloudflare (nameservers propagated)
- DNS A records exist for `@`, `www`, `stg` — all proxied (orange cloud)
- SSL/TLS set to Full (strict), Always Use HTTPS enabled
**Ref:** `E2E-LAUNCH.md` Parts 1, 2, 3

---

### P1-7: Secrets + first staging deploy
**Status:** 🔄 IN PROGRESS
**Prerequisite:** P1-6 ✅ (infra must exist before secrets can point to it)
**Unlocks:** P1-8 (staging sign-off — nothing to verify until it's deployed)
**Description:** Add all credentials to GitHub Actions and Cloudflare Worker, then trigger the first deploy to `stg.oursharedevents.com`.
**Acceptance criteria:**
- 3 GitHub Actions secrets set: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ADMIN_KEY`
- 4 Wrangler staging secrets set: `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY_PEM`, `SHEETS_SPREADSHEET_ID`, `ADMIN_KEY`
- `wrangler secret list --env staging` shows all 4
- `npm run deploy:staging` completes without error
- `https://stg.oursharedevents.com/health` returns `{ "ok": true, "env": "staging" }`
**Ref:** `E2E-LAUNCH.md` Parts 4, 5, 6.1

---

### P1-8: Staging sign-off
**Status:** 📋 BACKLOG
**Prerequisite:** P1-7 ✅ (staging must be deployed before it can be verified)
**Unlocks:** P1-9 (repo migration — only migrate a product that you know works)
**Description:** Run all verification checks against staging. Every check must pass before moving to production.
**Acceptance criteria:**
- `GET /health` → `{ "ok": true, "env": "staging" }`
- `GET /api/v2/events` → `{ "ok": true, "items": [{ "id": "evt_001", ... }] }`
- `GET /` → 200 HTML, event listing visible in browser
- `GET /admin` (no token) → HTTP 401
- `GET /admin` (with `Authorization: Bearer <ADMIN_KEY>`) → HTTP 200
- Public events page loads on mobile without errors
- HTTPS padlock visible, no mixed-content warnings
**Ref:** `E2E-LAUNCH.md` Parts 6.2–6.7, 7

---

### P1-9: Repo migration → ourCommunityRituals/ourSharedEvents
**Status:** 📋 BACKLOG
**Prerequisite:** P1-8 ✅ (migrate a known-working product, not a work-in-progress)
**Unlocks:** P1-10 (production launch happens from the new org's CI pipeline)
**Description:** Create a clean-history repo under `ourCommunityRituals/ourSharedEvents`. Single orphan commit — no zeventbooks history. Re-add GitHub secrets. Archive the old repo.
**Acceptance criteria:**
- `https://github.com/ourCommunityRituals/ourSharedEvents` exists with `main` as default branch
- Clean single commit: `"Initial commit: ourSharedEvents platform"`
- 3 GitHub Actions secrets re-added in new repo
- CI workflow triggers successfully on push to `main`
- Old `zeventbooks/MVP-EVENT-TOOLKIT` repo archived
**Ref:** `E2E-LAUNCH.md` Part 8

---

### P1-10: Production launch — v1.0.0
**Status:** 📋 BACKLOG
**Prerequisite:** P1-9 ✅ (launch from the correct org, not the archived one)
**Unlocks:** Phase 2 work
**Description:** Set production secrets, tag `v1.0.0`, CI deploys to `oursharedevents.com`. Verify production smoke checks. This is the public launch gate.
**Acceptance criteria:**
- 4 Wrangler production secrets set (same values as staging)
- `git tag v1.0.0 && git push origin v1.0.0` triggers production CI
- `https://oursharedevents.com/health` → `{ "ok": true, "env": "production" }`
- `https://oursharedevents.com` loads public events page in browser
- `https://www.oursharedevents.com` serves same content (www route works)
- `GET /admin` (no token) → 401 on production
**Ref:** `E2E-LAUNCH.md` Part 9

---

## Phase 2 — D1 Database

*Replace Google Sheets with Cloudflare D1 (edge SQLite). Same Worker, surgical data-layer swap.*
*Why D1: Sheets latency is 200–800ms. D1 is <5ms. No Google credential dependency.*

### P2-1: D1 database creation + schema migrations
**Status:** 📋 BACKLOG
**Prerequisite:** P1-10 ✅ (production must be live before replacing its data source)
**Unlocks:** P2-2
**Description:** Create Cloudflare D1 databases (staging + production). Write and apply SQL schema migration for the `events` table plus indexes.
**Acceptance criteria:**
- `wrangler d1 list` shows `oursharedevents-staging` and `oursharedevents-prod`
- `SELECT count(*) FROM events` runs without error
- Index on `(brand_id, status)` exists
**Files to create:** `workers/oursharedevents/migrations/0001_initial.sql`
**Ref:** `docs/migration/PHASE-2-D1-DATABASE.md`

---

### P2-2: Data migration script — Sheets → D1
**Status:** 📋 BACKLOG
**Prerequisite:** P2-1 ✅
**Unlocks:** P2-3
**Description:** Script that reads all rows from the Google Sheets `EVENTS` tab and inserts them into D1. Run against staging first, verify row count matches, then run against production.
**Acceptance criteria:**
- `SELECT count(*) FROM events` matches row count in Google Sheets
- Sample rows have correct `id`, `brand_id`, `status`, `data_json` values
- Script is idempotent (safe to run twice — no duplicate rows)
**Files to create:** `scripts/migrate-sheets-to-d1.ts`

---

### P2-3: Swap data layer — sheets.ts → d1.ts
**Status:** 📋 BACKLOG
**Prerequisite:** P2-2 ✅ (D1 must have data before the code points at it)
**Unlocks:** P2-4
**Description:** Replace `src/lib/sheets.ts` with `src/lib/d1.ts` using the same exported function signatures. Update `wrangler.toml` to add D1 bindings. Deploy to staging, verify all endpoints return identical data, then promote to production.
**Acceptance criteria:**
- `GET /api/v2/events` returns same items as before swap
- `GET /health` shows `{ "ok": true }` with no Sheets dependency
- No `GOOGLE_SA_*` variables referenced in worker code
**Files:** `workers/oursharedevents/src/lib/` (add `d1.ts`, delete `sheets.ts`)

---

### P2-4: Remove Google SA credentials
**Status:** 📋 BACKLOG
**Prerequisite:** P2-3 ✅ verified in production for at least 1 week
**Unlocks:** Phase 3 work
**Description:** Delete Google Service Account secrets from Cloudflare. Delete the Service Account from Google Cloud. No Google credentials remain in the system.
**Acceptance criteria:**
- `wrangler secret list --env staging` shows no `GOOGLE_SA_*` entries
- `wrangler secret list --env production` shows no `GOOGLE_SA_*` entries
- Google Cloud service account deleted
- Worker health check still passes after deletion

---

## Phase 3 — Firebase

*Track B (Hosting) before Track A (Auth) — React/Tailwind lands on the CDN first, then Firebase Auth uses the SDK that's already there.*

### P3-1: Firebase Hosting + React/Tailwind UI
**Status:** 📋 BACKLOG
**Prerequisite:** P2-3 ✅ (D1 as data source — Worker bundle must be lean before moving HTML out)
**Unlocks:** P3-2
**Description:** Move embedded HTML templates (~200KB in Worker bundle) to Firebase Hosting CDN. Rebuild with React components and Tailwind CSS. Worker becomes a lean ~30KB API-only bundle. Templates served from CDN with per-event theming via `brandConfig`.
**Migration order (lowest risk first):**
1. `public.html` (2,125 lines) → `EventPublicPage.tsx`
2. `display.html` (1,789 lines) → `EventDisplay.tsx`
3. `poster.html` (832 lines) → `EventPoster.tsx`
4. `admin.html` → `AdminShell.tsx`
**Acceptance criteria:**
- Worker bundle < 50KB (was 200KB+)
- Public events page looks identical to pre-migration
- Firebase Hosting serves pages from CDN (check response headers for `x-firebase-hosting`)
**Ref:** `docs/migration/PHASE-3-FIREBASE.md`

---

### P3-2: Firebase Auth — replace Bearer token admin
**Status:** 📋 BACKLOG
**Prerequisite:** P3-1 ✅ (Firebase SDK is already on the page from Hosting — Auth can use it)
**Unlocks:** Future multi-product features (ourRecNights admins, etc.)
**Description:** Replace the single shared `ADMIN_KEY` Bearer token with Firebase Auth (email/password + Google SSO). Multi-user support with role-based access. Worker verifies Firebase ID tokens on every admin request via REST API (no Admin SDK needed).
**Acceptance criteria:**
- `/admin` requires Firebase login (email or Google)
- Multiple admin users can be added without code changes
- `ADMIN_KEY` Wrangler secret deleted
- Old Bearer token auth removed from codebase
**New secrets:** `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`
**Removes:** `ADMIN_KEY` secret
