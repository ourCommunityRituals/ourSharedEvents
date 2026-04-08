# ourSharedEvents — Story Registry

Master list of all development stories. Read top to bottom — this is the order you do the work.
Synced with Linear: fill in `Linear #` when issues are created.

**Workflow:**

- Creating a Linear issue → fill in the `Linear #` column with the issue ID (e.g., `OUR-42`)
- Starting work → change status to 🔄 IN PROGRESS, commit this file
- Finishing → change status to ✅ DONE, include story ID in commit message (e.g., `feat: add health endpoint (P1-1)`)

> **Linear setup:** When ready — provide API key to Claude and all issues are created automatically with `Linear #` filled in. Mapping stored in `.claude/sync/LINEAR-MAP.md`.

---

## Master Status Table

Stories are ordered by the sequence you work through them. Each row unlocks the next.

| Story ID                                          | Linear # | Status         | Title                                                                 | Prerequisite     |
| ------------------------------------------------- | -------- | -------------- | --------------------------------------------------------------------- | ---------------- |
| **Phase 0 — Project Setup**                       |          |                |                                                                       |                  |
| P0-1                                              | —        | 📋 BACKLOG     | Create Linear project + import all stories                            | —                |
| **Phase 1 — Build (code + docs)**                 |          |                |                                                                       |                  |
| P1-1                                              | —        | ✅ DONE        | Cloudflare Worker code                                                | —                |
| P1-2                                              | —        | ✅ DONE        | CI/CD pipeline (GitHub Actions)                                       | P1-1             |
| P1-3                                              | —        | ✅ DONE        | README — ourSharedEvents identity                                     | P1-1             |
| P1-4                                              | —        | ✅ DONE        | STORIES.md — project tracking registry                                | P1-3             |
| P1-5                                              | —        | ✅ DONE        | E2E launch checklist (this doc's guide)                               | P1-4             |
| **Phase 1 — Operations (go live)**                |          |                |                                                                       |                  |
| P1-6                                              | —        | 📋 BACKLOG     | Infra provisioning — Google Cloud + Cloudflare                        | P1-5             |
| P1-7                                              | —        | 🔄 IN PROGRESS | Secrets + first staging deploy                                        | P1-6             |
| P1-8                                              | —        | 📋 BACKLOG     | Staging sign-off — all checks pass                                    | P1-7             |
| P1-9                                              | —        | 📋 BACKLOG     | Repo migration → ourCommunityRituals/ourSharedEvents                  | P1-8             |
| P1-10                                             | —        | 📋 BACKLOG     | Production launch — v1.0.0 live                                       | P1-9             |
| **Phase 2 — D1 Database (replace Google Sheets)** |          |                |                                                                       |                  |
| P2-1                                              | OSE-16   | ✅ DONE        | D1 database creation + schema migrations                              | P1-10            |
| P2-2                                              | —        | ✅ DONE        | Data migration script: Sheets → D1                                    | P2-1             |
| P2-3                                              | —        | ✅ DONE        | Swap data layer: sheets.ts → d1.ts                                    | P2-2             |
| P2-4                                              | —        | ✅ DONE        | Remove Google SA credentials (cleanup)                                | P2-3             |
| P2-5                                              | —        | ✅ DONE        | Event templates table + seed (32 types, ADR-010)                      | P2-1             |
| **Phase 3 — Firebase (auth + modern UI)**         |          |                |                                                                       |                  |
| P3-1                                              | —        | 📋 BACKLOG     | Firebase Hosting + React/Tailwind UI                                  | P2-3             |
| P3-2                                              | —        | 📋 BACKLOG     | Firebase Auth — replace Bearer token admin                            | P3-1             |
| **Epic A11Y — ADA Accessibility**                 |          |                |                                                                       |                  |
| A11Y-1                                            | —        | ✅ DONE        | Accessibility foundation — lang, skip links, landmarks, focus styles  | —                |
| A11Y-2                                            | —        | 📋 BACKLOG     | Form accessibility — labels, errors, `role="alert"`, `autocomplete`   | A11Y-1           |
| A11Y-3                                            | —        | 📋 BACKLOG     | Table & tab panel accessibility (report.html)                         | A11Y-1           |
| A11Y-4                                            | —        | 📋 BACKLOG     | Data-testid foundation (all surfaces)                                 | A11Y-1           |
| A11Y-5                                            | —        | 📋 BACKLOG     | Color contrast remediation                                            | A11Y-1           |
| A11Y-6                                            | —        | 📋 BACKLOG     | Keyboard navigation & focus trap                                      | A11Y-1           |
| A11Y-7                                            | —        | 📋 BACKLOG     | axe-core CI integration                                               | A11Y-1           |
| A11Y-8                                            | —        | 📋 BACKLOG     | Screen reader testing & polish                                        | A11Y-7           |
| **Epic SR — SharedReport Hardening**              |          |                |                                                                       |                  |
| SR-12                                             | —        | 📋 BACKLOG     | Runtime flag gating on sharedReport endpoint                          | —                |
| SR-13                                             | —        | 📋 BACKLOG     | Export JSON button (FE)                                               | SR-12            |
| SR-14                                             | —        | 📋 BACKLOG     | CSP headers on all remaining surfaces _(subsumes SEC-2)_              | —                |
| SR-15                                             | —        | 📋 BACKLOG     | Form page CSP (nonce-based) _(subsumes SEC-2)_                        | —                |
| SR-16                                             | —        | 📋 BACKLOG     | Rate limiting on form endpoints _(subsumes BE-2)_                     | —                |
| SR-17                                             | —        | 📋 BACKLOG     | Advanced metrics (conversion funnels, trends)                         | SR-12            |
| SR-18                                             | —        | 📋 BACKLOG     | PDF export (mid tier)                                                 | SR-12            |
| SR-19                                             | —        | 📋 BACKLOG     | Custom date range picker                                              | SR-17            |
| SR-20                                             | —        | 📋 BACKLOG     | Sponsor-scoped deep link                                              | —                |
| SR-21                                             | —        | 📋 BACKLOG     | Portfolio multi-event view (enterprise)                               | SR-17            |
| SR-22                                             | —        | 📋 BACKLOG     | White-label branding on report (enterprise)                           | —                |
| SR-23                                             | —        | 📋 BACKLOG     | Distributed rate limiting (CF Rules)                                  | SR-16            |
| SR-24                                             | —        | 📋 BACKLOG     | Report email share (enterprise)                                       | SR-18            |
| **Epic AS — All-Surface FE Uniformity**           |          |                |                                                                       |                  |
| AS-1                                              | —        | 📋 BACKLOG     | Uniform DesignTokens across all surfaces _(xref DESIGN-8)_            | —                |
| AS-2                                              | —        | 📋 BACKLOG     | data-testid on Poster (0→10+) _(xref DESIGN-3)_                       | —                |
| AS-3                                              | —        | 📋 BACKLOG     | data-testid on Display (1→10+) _(xref DESIGN-3)_                      | —                |
| AS-4                                              | —        | 📋 BACKLOG     | data-testid on Public (3→15+) _(xref DESIGN-3)_                       | —                |
| AS-5                                              | —        | 📋 BACKLOG     | ARIA attributes on Admin                                              | A11Y-1           |
| AS-6                                              | —        | 📋 BACKLOG     | ARIA attributes on Public                                             | A11Y-1           |
| AS-7                                              | —        | 📋 BACKLOG     | ARIA attributes on Display                                            | A11Y-1           |
| AS-8                                              | —        | 📋 BACKLOG     | ARIA attributes on Poster                                             | A11Y-1           |
| AS-9                                              | —        | 📋 BACKLOG     | Sponsor surface module integration                                    | AS-1             |
| AS-10                                             | —        | 📋 BACKLOG     | Print styles on Admin                                                 | —                |
| AS-11                                             | —        | 📋 BACKLOG     | Keyboard nav on Admin                                                 | —                |
| AS-12                                             | —        | 📋 BACKLOG     | Keyboard nav on Public                                                | —                |
| AS-13                                             | —        | 📋 BACKLOG     | axe-core CI integration _(xref A11Y-7)_                               | A11Y-7           |
| **Epic INFRA — Infrastructure Provisioning**      |          |                |                                                                       |                  |
| INFRA-1                                           | —        | 📋 BACKLOG     | Provision D1 databases (main + forms, staging + prod)                 | —                |
| INFRA-2                                           | —        | 📋 BACKLOG     | Activate Cloudflare zone + DNS for oursharedevents.com                | —                |
| INFRA-3                                           | —        | 📋 BACKLOG     | Create Google Cloud service account + set secrets                     | —                |
| INFRA-4                                           | —        | 📋 BACKLOG     | Document FORMS_ENCRYPTION_KEY generation + rotation                   | —                |
| **Epic BE — Backend Architecture**                |          |                |                                                                       |                  |
| BE-7                                              | —        | 📋 BACKLOG     | API envelope standardization (match schema)                           | —                |
| BE-8                                              | —        | 📋 BACKLOG     | Pagination on admin list endpoints                                    | —                |
| BE-9                                              | —        | 📋 BACKLOG     | Privacy notice at point of collection (GDPR Art. 13)                  | —                |
| BE-10                                             | —        | 📋 BACKLOG     | Privacy policy link on form pages                                     | —                |
| BE-11                                             | —        | 📋 BACKLOG     | Email format validation on form submit                                | —                |
| BE-12                                             | —        | 📋 BACKLOG     | Flag resolution optimization (batch query)                            | —                |
| **Epic SEC — Security**                           |          |                |                                                                       |                  |
| SEC-1                                             | —        | 📋 BACKLOG     | Fix CORS wildcard in forms.ts (use corsOrigin())                      | —                |
| **Epic ADMIN — Admin Page Architecture**          |          |                |                                                                       |                  |
| ADMIN-1                                           | —        | ✅ DONE        | Feature flag tier model (D1 + API + resolution chain)                 | P2-1             |
| ADMIN-2                                           | —        | ✅ DONE        | Admin tier badge + gated UI (locked icons, upgrade prompts)           | ADMIN-1          |
| ADMIN-3                                           | —        | ✅ DONE        | Native registration form (submit, count, QR routing)                  | ADMIN-1          |
| ADMIN-4                                           | —        | ✅ DONE        | Native check-in form (door mode, anonymous ID foundation)             | ADMIN-3          |
| ADMIN-5                                           | —        | ✅ DONE        | Card 3 redesign — inline form config                                  | ADMIN-4          |
| ADMIN-6                                           | —        | ✅ DONE        | Anonymous ID system (cookie + D1, scan correlation)                   | ADMIN-4          |
| ADMIN-7                                           | —        | ✅ DONE        | PII destruction jobs (scrub, audit log, retention)                    | ADMIN-3          |
| ADMIN-8                                           | —        | ✅ DONE        | Native survey form (tier-aware)                                       | ADMIN-1, ADMIN-3 |
| ADMIN-9                                           | —        | ✅ DONE        | Email signup form (duplicate detection)                               | ADMIN-1, ADMIN-3 |
| ADMIN-10                                          | —        | ✅ DONE        | Self-serve event config                                               | ADMIN-1          |
| ADMIN-11                                          | —        | ✅ DONE        | Form data export (CSV/JSON)                                           | ADMIN-3          |
| ADMIN-12                                          | —        | ✅ DONE        | Admin inline styles → CSS classes                                     | —                |
| ADMIN-13                                          | —        | ✅ DONE        | Skeleton loaders + per-card error states                              | —                |
| ADMIN-14                                          | —        | ✅ DONE        | Card 5 QR code + Card 7 QR visibility                                 | —                |
| ADMIN-15                                          | —        | ✅ DONE        | Copy button feedback ("Copied!" 2s state)                             | —                |
| ADMIN-16                                          | —        | ✅ DONE        | data-testid complete coverage (all interactive elements)              | —                |
| ADMIN-17                                          | —        | 📋 BACKLOG     | File upload to R2 (logos, posters, custom QR)                         | ADMIN-1          |
| ADMIN-18                                          | —        | 📋 BACKLOG     | White-label branding (colors/logo/domain)                             | ADMIN-1          |
| ADMIN-19                                          | —        | 📋 BACKLOG     | Newman E2E chain (create→config→submit→count→scrub)                   | ADMIN-3, ADMIN-7 |
| ADMIN-20                                          | —        | 📋 BACKLOG     | Cross-surface sponsor integration test suite                          | —                |
| ADMIN-21                                          | —        | 📋 BACKLOG     | Multi-event aggregate dashboard                                       | ADMIN-1          |
| ADMIN-22                                          | —        | 📋 BACKLOG     | Sponsor ROI click-through attribution                                 | ADMIN-6          |
| ADMIN-23                                          | —        | 📋 BACKLOG     | Consent tracking on form submit (privacy notice + timestamp)          | —                |
| **Epic DESIGN — Design System**                   |          |                |                                                                       |                  |
| DESIGN-1                                          | —        | 📋 BACKLOG     | Viewport meta tags on Admin + Report surfaces                         | —                |
| DESIGN-2                                          | —        | 📋 BACKLOG     | Breakpoint direction standardization (eliminate max-width)            | —                |
| DESIGN-3                                          | —        | 📋 BACKLOG     | data-testid parity — all surfaces to 30+ each _(xref AS-2/3/4)_       | —                |
| DESIGN-4                                          | —        | 📋 BACKLOG     | CI viewport matrix — add iPad, TV 1080p, iPhone SE                    | —                |
| DESIGN-5                                          | —        | 📋 BACKLOG     | Visual regression baseline — toHaveScreenshot()                       | DESIGN-3         |
| DESIGN-6                                          | —        | 📋 BACKLOG     | Report print stylesheet (sponsor handout)                             | —                |
| DESIGN-7                                          | —        | 📋 BACKLOG     | Tabletop tent card surface (4x6 poster variant)                       | —                |
| DESIGN-8                                          | —        | 📋 BACKLOG     | External design token file (stop inline duplication) _(xref AS-1)_    | —                |
| DESIGN-9                                          | —        | 📋 BACKLOG     | Poster mobile landing (QR scan → mobile view)                         | —                |
| DESIGN-10                                         | —        | 📋 BACKLOG     | Report responsive tables (horizontal scroll)                          | —                |
| DESIGN-11                                         | —        | 📋 BACKLOG     | Color palette hardcode audit — extract 500+ inline hex                | —                |
| DESIGN-12                                         | —        | 📋 BACKLOG     | Cross-browser CI — Firefox + WebKit weekly                            | DESIGN-5         |
| DESIGN-13                                         | —        | 📋 BACKLOG     | Wizard step 3 UX simplification (3 options → 2)                       | —                |
| DESIGN-14                                         | —        | 📋 BACKLOG     | "Last updated" timestamp on Card 1                                    | —                |
| DESIGN-15                                         | —        | 📋 BACKLOG     | Skip links on Display, Poster, Report                                 | —                |
| **Epic QA — Test Coverage**                       |          |                |                                                                       |                  |
| QA-1                                              | —        | 📋 BACKLOG     | Edge case test suite (double submit, archived form, flag mid-session) | ADMIN-3          |
| QA-2                                              | —        | 📋 BACKLOG     | Flag toggle → surface gating E2E test                                 | ADMIN-1          |
| QA-3                                              | —        | 📋 BACKLOG     | API smoke tests for form endpoints in CI                              | INFRA-1          |
| QA-4                                              | —        | 📋 BACKLOG     | E2E flow: admin→configure→QR→submit→verify count                      | QA-3             |
| QA-5                                              | —        | 📋 BACKLOG     | Contract tests (Pact) for form API shapes                             | —                |
| QA-6                                              | —        | 📋 BACKLOG     | Feature flag seed parity CI gate                                      | —                |
| QA-7                                              | —        | 📋 BACKLOG     | Newman E2E chain (create→config→submit→count→scrub)                   | QA-3, ADMIN-7    |
| **Epic SRE — Observability**                      |          |                |                                                                       |                  |
| SRE-1                                             | —        | 📋 BACKLOG     | Form submission rate dashboard + alerting                             | INFRA-1          |
| SRE-2                                             | —        | 📋 BACKLOG     | PII destruction job monitoring + failure alerts                       | ADMIN-7          |
| SRE-3                                             | —        | 📋 BACKLOG     | Wire k6 load tests to staging CI gate                                 | INFRA-1          |
| SRE-4                                             | —        | 📋 BACKLOG     | Enable Workers Logs/Traces in wrangler.toml                           | —                |
| SRE-5                                             | —        | 📋 BACKLOG     | Define SLOs (availability, latency, error rate)                       | SRE-4            |
| **Epic HK — Housekeeping**                        |          |                |                                                                       |                  |
| HK-1                                              | —        | 📋 BACKLOG     | Archive legacy worker/ directory                                      | —                |
| HK-2                                              | —        | 📋 BACKLOG     | Sync STORIES.md with implemented features                             | —                |
| HK-3                                              | —        | 📋 BACKLOG     | Update stale docs (DEPLOYMENT, .env.example, RUNBOOK)                 | HK-1             |

---

## Phase 0 — Project Setup

### P0-1: Create Linear project + import all stories

**Status:** 📋 BACKLOG
**Prerequisite:** —
**Unlocks:** Everything — gives you a Linear project to track all work below
**Description:** Create the `ourSharedEvents` Linear project under the `ourCommunityRituals` workspace. Create columns: Backlog / In Progress / Done. Create one card per story in this file. Record each card's short ID in the `Linear #` column above.
**How to automate:** Provide Linear API key to Claude → all cards created via Linear API, `Linear #` column auto-filled.

---

## Phase 1 — Build

_Stories P1-1 through P1-5 are complete. They represent everything built and documented before the operational launch work begins._

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
**Description:** This file. Single source of truth for all stories. Linear-synced via `Linear #` column.
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

_Work through P1-6 through P1-10 in order. Each story is a gate — don't start the next until the current one's acceptance criteria are met._

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

_Replace Google Sheets with Cloudflare D1 (edge SQLite). Same Worker, surgical data-layer swap._
_Why D1: Sheets latency is 200–800ms. D1 is <5ms. No Google credential dependency._

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

_Track B (Hosting) before Track A (Auth) — React/Tailwind lands on the CDN first, then Firebase Auth uses the SDK that's already there._

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

---

## Epic SR — SharedReport Hardening

_Stories sourced from CCR audit (docs/CCR_SHARED_REPORT_AUDIT.md). SR-1 through SR-11 shipped in previous sprints. SR-12+ are open gaps._

### SR-12: Runtime flag gating on sharedReport endpoint

**Status:** 📋 BACKLOG
**Rating:** MVP
**Prerequisite:** —
**Tier:** Mid+
**Effort:** S
**Description:** Check `analytics.shared-report` flag in the sharedReport handler before returning data. Free tier gets 403 with upgrade prompt. `isFeatureEnabled()` already exists — wire it into the handler.
**Acceptance criteria:**

- Free tier request to `/api/v2/sharedreport` → 403 `{ ok: false, code: 'FEATURE_DISABLED' }`
- Mid/Enterprise tier → 200 as before
- Event-level override can enable for free tier events
  **Files:** `worker/src/handlers/sharedReport.ts`

---

### SR-13: Export JSON button (FE)

**Status:** 📋 BACKLOG
**Rating:** MVP
**Prerequisite:** SR-12
**Tier:** Free+
**Effort:** S
**Description:** Add a "Download JSON" button to the SharedReport action bar. Uses the existing API response data — no new endpoint needed. Button triggers a client-side Blob download.
**Acceptance criteria:**

- Button visible on all tiers (free flag `report.export-json` is ON)
- Click downloads `report-{eventId}.json` with the full bundle
- data-testid: `export-json-btn`
  **Files:** `src/mvp/SharedReport.html`

---

### SR-14: CSP headers on all remaining surfaces

**Status:** 📋 BACKLOG
**Rating:** MVP
**Prerequisite:** —
**Tier:** All
**Effort:** S
**Description:** Extend the nonce-based CSP from landing/report to Admin, Public, Display, Poster, and Sponsor pages. Pattern already exists in `staticAssets.ts` — extend the conditional to all page types.
**Acceptance criteria:**

- All 7 HTML page responses include `Content-Security-Policy` header
- Nonce rotates per request (16 bytes, base64)
- Inline `<script>` tags use matching nonce
- No `unsafe-inline` for script-src
  **Files:** `worker/src/handlers/staticAssets.ts`

---

### SR-15: Form page CSP (nonce-based)

**Status:** 📋 BACKLOG
**Rating:** MVP
**Prerequisite:** —
**Tier:** All
**Effort:** S
**Description:** Apply nonce-based CSP to `/forms/:eventId` pages. Currently these pages have inline scripts with no CSP protection.
**Acceptance criteria:**

- `/forms/:eventId` responses include nonce-based CSP header
- Inline scripts work with nonce
- Form submission still functions
  **Files:** `workers/oursharedevents/src/handlers/form-pages.ts`

---

### SR-16: Rate limiting on form endpoints

**Status:** 📋 BACKLOG
**Rating:** MVP
**Prerequisite:** —
**Tier:** All
**Effort:** M
**Description:** Add per-eventId + per-IP rate limiting to form submission endpoints (register, checkin, survey, email-signup). Prevent spam without blocking legitimate multi-user submissions.
**Acceptance criteria:**

- 10 submissions per IP per eventId per minute
- 429 response with `Retry-After` header when exceeded
- Rate limit state is per-isolate (same as `/subscribe` pattern)
- Different eventIds have independent limits
  **Files:** `workers/oursharedevents/src/handlers/forms.ts`

---

### SR-17: Advanced metrics (conversion funnels, trends)

**Status:** 📋 BACKLOG
**Rating:** V2↑MVP
**Prerequisite:** SR-12
**Tier:** Mid+
**Effort:** L
**Description:** Add conversion funnel visualization and trend charts to the SharedReport. Requires new domain logic for time-series aggregation and FE chart rendering.
**Acceptance criteria:**

- Funnel: impressions → clicks → signups → check-ins
- Trend: daily metrics over the event window
- Gated behind `report.advanced-metrics` flag
- Graceful degradation when data insufficient

---

### SR-18: PDF export (mid tier)

**Status:** 📋 BACKLOG
**Rating:** V2↑MVP
**Prerequisite:** SR-12
**Tier:** Mid+
**Effort:** M
**Description:** Generate a downloadable PDF from the SharedReport data. Server-side generation preferred (html-to-pdf or puppeteer).
**Acceptance criteria:**

- "Download PDF" button visible for mid+ tier
- Gated behind `report.export-pdf` flag
- PDF includes all 3 tab sections with formatting
- data-testid: `export-pdf-btn`

---

### SR-19: Custom date range picker

**Status:** 📋 BACKLOG
**Rating:** V2
**Prerequisite:** SR-17
**Tier:** Mid+
**Effort:** M
**Description:** Replace the hardcoded 30-day lookback window with a configurable date range picker. Gated behind `report.custom-window` flag.
**Acceptance criteria:**

- Date picker UI with start/end inputs
- API accepts `?windowStart=&windowEnd=` query params
- Free tier sees "Upgrade for custom date range" prompt

---

### SR-20: Sponsor-scoped deep link

**Status:** 📋 BACKLOG
**Rating:** V2
**Prerequisite:** —
**Tier:** Mid+
**Effort:** S
**Description:** Support `/report?eventId=X&sponsorId=Y` to auto-focus the Sponsor tab filtered to a specific sponsor. Enables sponsor-specific share links.
**Acceptance criteria:**

- `?sponsorId=Y` auto-switches to Sponsor tab
- Sponsor row highlighted/expanded
- URL updates on sponsor selection

---

### SR-21: Portfolio multi-event view (enterprise)

**Status:** 📋 BACKLOG
**Rating:** V2-ENT
**Prerequisite:** SR-17
**Tier:** Enterprise
**Effort:** L
**Description:** Aggregate metrics across multiple events for enterprise sponsors. Gated behind `report.portfolio` flag.
**Acceptance criteria:**

- New "Portfolio" tab or view toggle
- Cross-event totals and per-event breakdown
- Enterprise-only access

---

### SR-22: White-label branding on report (enterprise)

**Status:** 📋 BACKLOG
**Rating:** V2-ENT
**Prerequisite:** —
**Tier:** Enterprise
**Effort:** M
**Description:** Allow enterprise customers to customize report appearance (logo, colors, footer). Gated behind `branding.white-label` flag.
**Acceptance criteria:**

- Custom logo replaces default header
- Brand colors applied via CSS variables
- "Powered by" footer removable

---

### SR-23: Distributed rate limiting (CF Rules)

**Status:** 📋 BACKLOG
**Rating:** V2
**Prerequisite:** SR-16
**Tier:** All
**Effort:** M
**Description:** Replace per-isolate rate limiting with Cloudflare Rate Limiting Rules for cross-isolate enforcement. The per-isolate approach resets on cold starts and doesn't share state.
**Acceptance criteria:**

- Rate limits enforced across all isolates
- Configured via `wrangler.toml` or Cloudflare dashboard
- Per-isolate fallback remains as defense-in-depth

---

### SR-24: Report email share (enterprise)

**Status:** 📋 BACKLOG
**Rating:** V2-ENT
**Prerequisite:** SR-18
**Tier:** Enterprise
**Effort:** M
**Description:** Allow enterprise users to email a report link or PDF attachment directly from the report page.
**Acceptance criteria:**

- "Share via Email" button for enterprise tier
- Sends link or PDF attachment
- Respects PII firewall (no customer data in email)

---

## Epic AS — All-Surface FE Uniformity

_Stories sourced from CCR audit FE uniformity matrix. Goal: consistent experience across all 7 surfaces._

### AS-1: Uniform DesignTokens across all surfaces

**Status:** 📋 BACKLOG
**Rating:** MVP-UX
**Prerequisite:** —
**Effort:** S
**Description:** Include `DesignTokens.html` in Admin, Public, Display, and Sponsor surfaces. Currently only Poster and SharedReport include it.
**Acceptance criteria:**

- All 6 MVP surfaces reference DesignTokens.html
- CSS custom properties (spacing, colors, radii) consistent across surfaces
- No visual regression on existing surfaces

---

### AS-2: data-testid on Poster (0→10+)

**Status:** 📋 BACKLOG
**Rating:** MVP-UX
**Prerequisite:** —
**Effort:** S
**Description:** Add data-testid attributes to Poster surface. Currently at 0 — target 10+.
**Acceptance criteria:**

- Minimum 10 data-testid attributes on key elements (header, QR sections, sponsor strip, event info, print button)
- Test specs updated to use new testids

---

### AS-3: data-testid on Display (1→10+)

**Status:** 📋 BACKLOG
**Rating:** MVP-UX
**Prerequisite:** —
**Effort:** S
**Description:** Add data-testid attributes to Display surface. Currently at 1 — target 10+.
**Acceptance criteria:**

- Minimum 10 data-testid attributes on key elements (rotation controls, panes, sponsor strip, mode indicator)
- Test specs updated to use new testids

---

### AS-4: data-testid on Public (3→15+)

**Status:** 📋 BACKLOG
**Rating:** MVP-UX
**Prerequisite:** —
**Effort:** S
**Description:** Add data-testid attributes to Public surface. Currently at 3 — target 15+.
**Acceptance criteria:**

- Minimum 15 data-testid attributes on key elements (event cards, sections, CTAs, sponsor banner, form links)
- Test specs updated to use new testids

---

### AS-5: ARIA attributes on Admin

**Status:** 📋 BACKLOG
**Rating:** MVP-UX
**Prerequisite:** A11Y-1
**Effort:** M
**Description:** Add ARIA roles and labels to Admin surface. Currently no ARIA attributes.
**Acceptance criteria:**

- Tabs use `role="tablist"`, `role="tab"`, `role="tabpanel"`
- Forms use `aria-required`, `aria-invalid`, `aria-describedby`
- Cards use `role="region"` with `aria-label`
- Live regions for status updates

---

### AS-6: ARIA attributes on Public

**Status:** 📋 BACKLOG
**Rating:** MVP-UX
**Prerequisite:** A11Y-1
**Effort:** S
**Description:** Add ARIA roles and labels to Public surface.
**Acceptance criteria:**

- Event cards use `role="article"` or `role="region"`
- Sections use `aria-label` for screen readers
- CTA buttons use `aria-label` for context

---

### AS-7: ARIA attributes on Display

**Status:** 📋 BACKLOG
**Rating:** MVP-UX
**Prerequisite:** A11Y-1
**Effort:** S
**Description:** Add ARIA roles and labels to Display surface.
**Acceptance criteria:**

- Rotation panes use `aria-live="polite"` for announcements
- Controls use `aria-label` for keyboard users
- Mode indicator uses `role="status"`

---

### AS-8: ARIA attributes on Poster

**Status:** 📋 BACKLOG
**Rating:** MVP-UX
**Prerequisite:** A11Y-1
**Effort:** S
**Description:** Add ARIA roles and labels to Poster surface.
**Acceptance criteria:**

- QR images use `alt` text with destination URL description
- Print button uses `aria-label`
- Sponsor logos use `alt` text

---

### AS-9: Sponsor surface module integration

**Status:** 📋 BACKLOG
**Rating:** V2↑MVP
**Prerequisite:** AS-1
**Effort:** M
**Description:** Integrate Sponsor surface (currently standalone CF template) into the standard module system (Styles.html, SharedUtils.html, NUSDK.html, GlobalErrorHandler.html).
**Acceptance criteria:**

- Sponsor surface uses shared Styles.html
- Sponsor surface uses SharedUtils.html helpers
- Sponsor surface uses NUSDK.html for API calls
- No visual regression

---

### AS-10: Print styles on Admin

**Status:** 📋 BACKLOG
**Rating:** V2
**Prerequisite:** —
**Effort:** S
**Description:** Add `@media print` stylesheet to Admin surface for printable event summaries.
**Acceptance criteria:**

- Navigation and action bars hidden in print
- Event details print cleanly on A4/Letter

---

### AS-11: Keyboard nav on Admin

**Status:** 📋 BACKLOG
**Rating:** V2
**Prerequisite:** —
**Effort:** M
**Description:** Add keyboard navigation support to Admin surface (tab management, form focus, card navigation).
**Acceptance criteria:**

- Arrow keys navigate between tabs/cards
- Enter/Space activate buttons and links
- Escape closes modals/wizards
- Focus visible on all interactive elements

---

### AS-12: Keyboard nav on Public

**Status:** 📋 BACKLOG
**Rating:** V2
**Prerequisite:** —
**Effort:** S
**Description:** Add keyboard navigation to Public surface event cards and sections.
**Acceptance criteria:**

- Tab key navigates between event cards
- Enter opens event detail
- Focus management on section toggles

---

### AS-13: axe-core CI integration

**Status:** 📋 BACKLOG
**Rating:** V2↑MVP
**Prerequisite:** A11Y-7
**Effort:** M
**Description:** Add automated accessibility testing using axe-core via Playwright. Runs on all 7 surfaces in CI.
**Acceptance criteria:**

- `@axe-core/playwright` installed
- Test spec runs axe on each surface
- CI blocks merge on critical a11y violations
- Results reported in test output
