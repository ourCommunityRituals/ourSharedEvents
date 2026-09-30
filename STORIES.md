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

**Last verified: 2026-08-03** — P1-6 infra complete (OSE-544/545/546/547 Done), P1-7 staging deploy in progress (OSE-548 Todo), DAC-1..5 cleared via OSE-553.

**Reconciled: 2026-09-09** — evidence-based status pass over the epic sections (not the frozen table below): flipped to ✅ DONE — **P1-6** (zone+D1 provisioned), **P2-1..P2-4** (already done), **SR-14/15/16** (CSP + form-page CSP + form rate-limit), **AS-1** (design tokens), **DAC-1..5** (eventangle audit, `docs/`=0). Flagged as superseded: **SR-25** (conflicts with ratified ADR-017 depth model), **TP-3** (Newman→Bruno, OSE-1191). Still open: P1-7..P1-10, TP-2 (cross-surface E2E), TP-4 (k6→CI), AS-5..AS-13. New: **Epic SECGATE** (OSE-1186 G1–G4). Canonical next-story pointer is Linear + `CLAUDE.md` §3, not the table below.

> **Reconciliation 2026-09-22 (backlog-to-code pass).** The master table below remains a historical snapshot, not the true live tracker. A fresh code-vs-Linear audit (`docs/audits/LINEAR_BACKLOG_RECONCILIATION_2026-09-22.md`) found 23 tickets in the audited 99-item slice already **DONE_IN_CODE**, 17 **PARTIAL**, 7 **UNCLEAR**, and 52 **NOT_STARTED**. This means a material portion of the backlog is code-complete but stale in admin state; do not re-open or re-implement anything that already has source + test evidence. Before starting story work, reconcile against the live codebase, then update Linear or this doc to reflect the actual remaining gap.

> **Reconciliation 2026-09-09 (HK-2).** The `P#/SR#/ADMIN#` master table below is a **point-in-time snapshot**, not a per-merge live tracker. Since 2026-08-03, ~60 `OSE-####` tickets have merged (see `git log` + PR history) that this table does not model — day-to-day work is tracked in **Linear (`OSE-####`)**, and the canonical record of what shipped is the commit history + `CLAUDE.md` §3 role states. **Do not trust the ordered "next story" pointer in this table** (it still reads P1-6/P1-7 infra, which contradicts CLAUDE.md's "infra is last, code now"). Verified-done since the snapshot, with citable evidence, are folded in below; the largest untracked body of work is the **OSE-1186 security-gate campaign (G1–G4)** — see the new Epic SECGATE section. Only status changes with a citable commit/file are made here (CCR evidence rule); the rest of the table is left as historical.

> **Shipped 2026-09-09/10 (SharedReport line).** **OSE-628** ✅ DONE ([#510](https://github.com/ourCommunityRituals/ourSharedEvents/pull/510), `dbfde44`) — corridor_map SVG composed into the signed-link SharedReport view (`section#corridor-map-container`), mobile/tablet/laptop responsive; the previously-orphaned `renderCorridorMap` module now renders on a real surface. **OSE-631** ✅ DONE ([#511](https://github.com/ourCommunityRituals/ourSharedEvents/pull/511), `d7b17da`) — `refreshCorridorBaselines` `COALESCE(h3_res7, corridor_id)` coverage verified born-red + one window-count test closing a surviving mutant Stryker structurally can't reach (SQL-in-string on the workers pool). Both Linear-tracked, auto-closed on merge via the close-guard.

| Story ID                                           | Linear # | Status         | Title                                                                  | Prerequisite     |
| -------------------------------------------------- | -------- | -------------- | ---------------------------------------------------------------------- | ---------------- |
| **Phase 0 — Project Setup**                        |          |                |                                                                        |                  |
| P0-1                                               | —        | 📋 BACKLOG     | Create Linear project + import all stories                             | —                |
| **Phase 1 — Build (code + docs)**                  |          |                |                                                                        |                  |
| P1-1                                               | —        | ✅ DONE        | Cloudflare Worker code                                                 | —                |
| P1-2                                               | —        | ✅ DONE        | CI/CD pipeline (GitHub Actions)                                        | P1-1             |
| P1-3                                               | —        | ✅ DONE        | README — ourSharedEvents identity                                      | P1-1             |
| P1-4                                               | —        | ✅ DONE        | STORIES.md — project tracking registry                                 | P1-3             |
| P1-5                                               | —        | ✅ DONE        | E2E launch checklist (this doc's guide)                                | P1-4             |
| **Phase 1 — Operations (go live)**                 |          |                |                                                                        |                  |
| P1-6                                               | —        | ✅ DONE        | Infra provisioning — Google Cloud + Cloudflare                         | P1-5             |
| P1-7                                               | —        | 🔄 IN PROGRESS | Secrets + first staging deploy                                         | P1-6             |
| P1-8                                               | —        | 📋 BACKLOG     | Staging sign-off — all checks pass                                     | P1-7             |
| P1-9                                               | —        | 📋 BACKLOG     | Repo migration → ourCommunityRituals/ourSharedEvents                   | P1-8             |
| P1-10                                              | —        | 📋 BACKLOG     | Production launch — v1.0.0 live                                        | P1-9             |
| **Phase 2 — D1 Database (replace Google Sheets)**  |          |                |                                                                        |                  |
| P2-1                                               | OSE-16   | ✅ DONE        | D1 database creation + schema migrations                               | P1-10            |
| P2-2                                               | —        | ✅ DONE        | Data migration script: Sheets → D1                                     | P2-1             |
| P2-3                                               | —        | ✅ DONE        | Swap data layer: sheets.ts → d1.ts                                     | P2-2             |
| P2-4                                               | —        | ✅ DONE        | Remove Google SA credentials (cleanup)                                 | P2-3             |
| P2-5                                               | —        | ✅ DONE        | Event templates table + seed (32 types, ADR-010)                       | P2-1             |
| **Phase 3 — Firebase (auth + modern UI)**          |          |                |                                                                        |                  |
| P3-1                                               | —        | 📋 BACKLOG     | Firebase Hosting + React/Tailwind UI                                   | P2-3             |
| P3-2                                               | —        | 📋 BACKLOG     | Firebase Auth — replace Bearer token admin                             | P3-1             |
| **Epic A11Y — ADA Accessibility**                  |          |                |                                                                        |                  |
| A11Y-1                                             | —        | ✅ DONE        | Accessibility foundation — lang, skip links, landmarks, focus styles   | —                |
| A11Y-2                                             | —        | 📋 BACKLOG     | Form accessibility — labels, errors, `role="alert"`, `autocomplete`    | A11Y-1           |
| A11Y-3                                             | —        | 📋 BACKLOG     | Table & tab panel accessibility (report.html)                          | A11Y-1           |
| A11Y-4                                             | —        | ✅ DONE        | Data-testid foundation (all surfaces)                                  | A11Y-1           |
| A11Y-5                                             | —        | 📋 BACKLOG     | Color contrast remediation                                             | A11Y-1           |
| A11Y-6                                             | —        | 📋 BACKLOG     | Keyboard navigation & focus trap                                       | A11Y-1           |
| A11Y-7                                             | —        | 📋 BACKLOG     | axe-core CI integration                                                | A11Y-1           |
| A11Y-8                                             | —        | 📋 BACKLOG     | Screen reader testing & polish                                         | A11Y-7           |
| **Epic SR — SharedReport Hardening**               |          |                |                                                                        |                  |
| SR-12                                              | —        | ✅ DONE        | Runtime flag gating on sharedReport endpoint                           | —                |
| SR-13                                              | —        | 📋 BACKLOG     | Export JSON button (FE)                                                | SR-12            |
| SR-14                                              | —        | 📋 BACKLOG     | CSP headers on all remaining surfaces _(subsumes SEC-2)_               | —                |
| SR-15                                              | —        | 📋 BACKLOG     | Form page CSP (nonce-based) _(subsumes SEC-2)_                         | —                |
| SR-16                                              | —        | 📋 BACKLOG     | Rate limiting on form endpoints _(subsumes BE-2)_                      | —                |
| SR-17                                              | —        | 📋 BACKLOG     | Advanced metrics (conversion funnels, trends)                          | SR-12            |
| SR-18                                              | —        | 📋 BACKLOG     | PDF export (mid tier)                                                  | SR-12            |
| SR-19                                              | —        | 📋 BACKLOG     | Custom date range picker                                               | SR-17            |
| SR-20                                              | —        | 📋 BACKLOG     | Sponsor-scoped deep link                                               | —                |
| SR-21                                              | —        | 📋 BACKLOG     | Portfolio multi-event view (enterprise)                                | SR-17            |
| SR-22                                              | —        | 📋 BACKLOG     | White-label branding on report (enterprise)                            | —                |
| SR-23                                              | —        | 📋 BACKLOG     | Distributed rate limiting (CF Rules)                                   | SR-16            |
| SR-24                                              | —        | 📋 BACKLOG     | Report email share (enterprise)                                        | SR-18            |
| SR-25                                              | —        | 📋 BACKLOG     | SharedReport competitive intelligence — local-vs-paid sponsor frame    | SR-12            |
| **Epic AS — All-Surface FE Uniformity**            |          |                |                                                                        |                  |
| AS-1                                               | —        | 📋 BACKLOG     | Uniform DesignTokens across all surfaces _(xref DESIGN-8)_             | —                |
| AS-2                                               | —        | ✅ DONE        | data-testid on Poster (0→10+) _(xref DESIGN-3)_                        | —                |
| AS-3                                               | —        | ✅ DONE        | data-testid on Display (1→10+) _(xref DESIGN-3)_                       | —                |
| AS-4                                               | —        | ✅ DONE        | data-testid on Public (3→15+) _(xref DESIGN-3)_                        | —                |
| AS-5                                               | —        | 📋 BACKLOG     | ARIA attributes on Admin                                               | A11Y-1           |
| AS-6                                               | —        | ✅ DONE        | ARIA attributes on Public (DONE_IN_CODE; +card-role test) — #653       | A11Y-1           |
| AS-7                                               | —        | ✅ DONE        | ARIA attributes on Display (DONE_IN_CODE; kiosk N/A criteria)          | A11Y-1           |
| AS-8                                               | —        | ✅ DONE        | ARIA attributes on Poster (DONE_IN_CODE; +print-btn aria-label) — #653 | A11Y-1           |
| AS-9                                               | —        | 📋 BACKLOG     | Sponsor surface module integration                                     | AS-1             |
| AS-10                                              | —        | 📋 BACKLOG     | Print styles on Admin                                                  | —                |
| AS-11                                              | —        | 📋 BACKLOG     | Keyboard nav on Admin                                                  | —                |
| AS-12                                              | —        | 📋 BACKLOG     | Keyboard nav on Public                                                 | —                |
| AS-13                                              | —        | 🔄 IN PROGRESS | axe-core CI integration (@axe-core/playwright, browser tier)           | A11Y-7           |
| **Epic INFRA — Infrastructure Provisioning**       |          |                |                                                                        |                  |
| INFRA-1                                            | —        | ✅ DONE        | Provision D1 databases (main + forms, staging + prod)                  | —                |
| INFRA-2                                            | —        | ✅ DONE        | Activate Cloudflare zone + DNS for oursharedevents.com                 | —                |
| INFRA-3                                            | —        | 📋 BACKLOG     | Create Google Cloud service account + set secrets                      | —                |
| INFRA-4                                            | —        | 📋 BACKLOG     | Document FORMS_ENCRYPTION_KEY generation + rotation                    | —                |
| **Epic BE — Backend Architecture**                 |          |                |                                                                        |                  |
| BE-7                                               | —        | 📋 BACKLOG     | API envelope standardization (match schema)                            | —                |
| BE-8                                               | —        | 📋 BACKLOG     | Pagination on admin list endpoints                                     | —                |
| BE-9                                               | —        | 📋 BACKLOG     | Privacy notice at point of collection (GDPR Art. 13)                   | —                |
| BE-10                                              | —        | 📋 BACKLOG     | Privacy policy link on form pages                                      | —                |
| BE-11                                              | —        | ✅ DONE        | Email format validation on form submit                                 | —                |
| BE-12                                              | —        | 📋 BACKLOG     | Flag resolution optimization (batch query)                             | —                |
| **Epic SEC — Security**                            |          |                |                                                                        |                  |
| SEC-1                                              | —        | ✅ DONE        | Fix CORS wildcard in forms.ts (use corsOrigin())                       | —                |
| **Epic ADMIN — Admin Page Architecture**           |          |                |                                                                        |                  |
| ADMIN-1                                            | —        | ✅ DONE        | Feature flag tier model (D1 + API + resolution chain)                  | P2-1             |
| ADMIN-2                                            | —        | ✅ DONE        | Admin tier badge + gated UI (locked icons, upgrade prompts)            | ADMIN-1          |
| ADMIN-3                                            | —        | ✅ DONE        | Native registration form (submit, count, QR routing)                   | ADMIN-1          |
| ADMIN-4                                            | —        | ✅ DONE        | Native check-in form (door mode, anonymous ID foundation)              | ADMIN-3          |
| ADMIN-5                                            | —        | ✅ DONE        | Card 3 redesign — inline form config                                   | ADMIN-4          |
| ADMIN-6                                            | —        | ✅ DONE        | Anonymous ID system (cookie + D1, scan correlation)                    | ADMIN-4          |
| ADMIN-7                                            | —        | ✅ DONE        | PII destruction jobs (scrub, audit log, retention)                     | ADMIN-3          |
| ADMIN-8                                            | —        | ✅ DONE        | Native survey form (tier-aware)                                        | ADMIN-1, ADMIN-3 |
| ADMIN-9                                            | —        | ✅ DONE        | Email signup form (duplicate detection)                                | ADMIN-1, ADMIN-3 |
| ADMIN-10                                           | —        | ✅ DONE        | Self-serve event config                                                | ADMIN-1          |
| ADMIN-11                                           | —        | ✅ DONE        | Form data export (CSV/JSON)                                            | ADMIN-3          |
| ADMIN-12                                           | —        | ✅ DONE        | Admin inline styles → CSS classes                                      | —                |
| ADMIN-13                                           | —        | ✅ DONE        | Skeleton loaders + per-card error states                               | —                |
| ADMIN-14                                           | —        | ✅ DONE        | Card 5 QR code + Card 7 QR visibility                                  | —                |
| ADMIN-15                                           | —        | ✅ DONE        | Copy button feedback ("Copied!" 2s state)                              | —                |
| ADMIN-16                                           | —        | ✅ DONE        | data-testid complete coverage (all interactive elements)               | —                |
| ADMIN-17                                           | —        | 📋 BACKLOG     | File upload to R2 (logos, posters, custom QR)                          | ADMIN-1          |
| ADMIN-18                                           | —        | 📋 BACKLOG     | White-label branding (colors/logo/domain)                              | ADMIN-1          |
| ADMIN-19                                           | —        | 📋 BACKLOG     | Newman E2E chain (create→config→submit→count→scrub)                    | ADMIN-3, ADMIN-7 |
| ADMIN-20                                           | —        | 📋 BACKLOG     | Cross-surface sponsor integration test suite                           | —                |
| ADMIN-21                                           | —        | 📋 BACKLOG     | Multi-event aggregate dashboard                                        | ADMIN-1          |
| ADMIN-22                                           | —        | 📋 BACKLOG     | Sponsor ROI click-through attribution                                  | ADMIN-6          |
| ADMIN-23                                           | —        | ✅ DONE        | Consent tracking on form submit (privacy notice + timestamp)           | —                |
| **Epic DESIGN — Design System**                    |          |                |                                                                        |                  |
| DESIGN-1                                           | —        | 📋 BACKLOG     | Viewport meta tags on Admin + Report surfaces                          | —                |
| DESIGN-2                                           | —        | 📋 BACKLOG     | Breakpoint direction standardization (eliminate max-width)             | —                |
| DESIGN-3                                           | —        | 📋 BACKLOG     | data-testid parity — all surfaces to 30+ each _(xref AS-2/3/4)_        | —                |
| DESIGN-4                                           | —        | 📋 BACKLOG     | CI viewport matrix — add iPad, TV 1080p, iPhone SE                     | —                |
| DESIGN-5                                           | —        | 📋 BACKLOG     | Visual regression baseline — toHaveScreenshot()                        | DESIGN-3         |
| DESIGN-6                                           | —        | 📋 BACKLOG     | Report print stylesheet (sponsor handout)                              | —                |
| DESIGN-7                                           | —        | 📋 BACKLOG     | Tabletop tent card surface (4x6 poster variant)                        | —                |
| DESIGN-8                                           | —        | 📋 BACKLOG     | External design token file (stop inline duplication) _(xref AS-1)_     | —                |
| DESIGN-9                                           | —        | 📋 BACKLOG     | Poster mobile landing (QR scan → mobile view)                          | —                |
| DESIGN-10                                          | —        | 📋 BACKLOG     | Report responsive tables (horizontal scroll)                           | —                |
| DESIGN-11                                          | —        | 📋 BACKLOG     | Color palette hardcode audit — extract 500+ inline hex                 | —                |
| DESIGN-12                                          | —        | 📋 BACKLOG     | Cross-browser CI — Firefox + WebKit weekly                             | DESIGN-5         |
| DESIGN-13                                          | —        | 📋 BACKLOG     | Wizard step 3 UX simplification (3 options → 2)                        | —                |
| DESIGN-14                                          | —        | 📋 BACKLOG     | "Last updated" timestamp on Card 1                                     | —                |
| DESIGN-15                                          | —        | 📋 BACKLOG     | Skip links on Display, Poster, Report                                  | —                |
| **Epic QA — Test Coverage**                        |          |                |                                                                        |                  |
| QA-1                                               | —        | 📋 BACKLOG     | Edge case test suite (double submit, archived form, flag mid-session)  | ADMIN-3          |
| QA-2                                               | —        | 📋 BACKLOG     | Flag toggle → surface gating E2E test                                  | ADMIN-1          |
| QA-3                                               | —        | 📋 BACKLOG     | API smoke tests for form endpoints in CI                               | INFRA-1          |
| QA-4                                               | —        | 📋 BACKLOG     | E2E flow: admin→configure→QR→submit→verify count                       | QA-3             |
| QA-5                                               | —        | 📋 BACKLOG     | Contract tests (Pact) for form API shapes                              | —                |
| QA-6                                               | —        | 📋 BACKLOG     | Feature flag seed parity CI gate                                       | —                |
| QA-7                                               | —        | 📋 BACKLOG     | Newman E2E chain (create→config→submit→count→scrub)                    | QA-3, ADMIN-7    |
| **Epic SRE — Observability**                       |          |                |                                                                        |                  |
| SRE-1                                              | —        | 📋 BACKLOG     | Form submission rate dashboard + alerting                              | INFRA-1          |
| SRE-2                                              | —        | 📋 BACKLOG     | PII destruction job monitoring + failure alerts                        | ADMIN-7          |
| SRE-3                                              | —        | 📋 BACKLOG     | Wire k6 load tests to staging CI gate                                  | INFRA-1          |
| SRE-4                                              | —        | ✅ DONE        | Enable Workers Logs/Traces in wrangler.toml                            | —                |
| SRE-5                                              | —        | 📋 BACKLOG     | Define SLOs (availability, latency, error rate)                        | SRE-4            |
| **Epic HK — Housekeeping**                         |          |                |                                                                        |                  |
| HK-1                                               | —        | ✅ DONE        | Archive legacy worker/ directory                                       | —                |
| HK-2                                               | —        | 📋 BACKLOG     | Sync STORIES.md with implemented features                              | —                |
| HK-3                                               | —        | ✅ DONE        | Update stale docs (DEPLOYMENT, .env.example, RUNBOOK)                  | HK-1             |
| **Epic DAC — Documentation Domain Reconciliation** |          |                |                                                                        |                  |
| DAC-1                                              | —        | ✅ DONE        | Batch rename — Security docs (13 files, ~295 refs)                     | P1-8             |
| DAC-2                                              | —        | ✅ DONE        | Batch rename — Runbooks (12 files, ~386 refs)                          | P1-8             |
| DAC-3                                              | —        | ✅ DONE        | Batch rename — Architecture docs (9 files, ~126 refs)                  | P1-8             |
| DAC-4                                              | —        | ✅ DONE        | Batch rename — Deploy + Monitor + QA docs (16 files, ~161 refs)        | P1-8             |
| DAC-5                                              | —        | ✅ DONE        | Final verification — zero active eventangle references                 | DAC-1,2,3,4      |
| **Epic TP — Test Pyramid Enforcement**             |          |                |                                                                        |                  |
| TP-1                                               | —        | ✅ DONE        | Wire 78 E2E Playwright files into CI pipeline (post-smoke gate)        | P1-8             |
| TP-2                                               | —        | 📋 BACKLOG     | Cross-surface E2E: poster → pre-event → event → post-event flow        | TP-1             |
| TP-3                                               | —        | 📋 BACKLOG     | Newman collection audit — verify all 6 surfaces covered                | P1-8             |
| TP-4                                               | —        | 📋 BACKLOG     | Wire k6 load tests into staging CI gate                                | TP-1             |
| TP-5                                               | —        | ✅ DONE        | Retroactive audit — 43/43 pre-TP, no full pyramid at completion        | TP-1             |

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

### P1-6: Infra provisioning — Cloudflare zone + D1 databases

**Status:** ✅ DONE (2026-09-09 reconcile) — INFRA-1 (D1) + INFRA-2 (CF zone + DNS) done (CLAUDE.md §3 PO/DevOps). D1/KV/R2/zone provisioned for staging **and** production with real IDs in `wrangler.toml`; routes live on `stg.oursharedevents.com` + `oursharedevents.com`; `scripts/check-binding-placeholders.mjs` gates CI against placeholder IDs. (P1-7 secrets + first staging deploy remains 🔄; remaining infra is INFRA-3 GCP SA / INFRA-4 key-rotation doc.)
**Prerequisite:** P1-5 ✅
**Unlocks:** P1-7 (secrets need somewhere to live — infra must exist first)
**Description:** Activate the Cloudflare zone for oursharedevents.com and provision production D1 databases. Google Sheets dependency was removed in Phase 2 — the worker is D1-native. Staging D1 databases already exist (IDs in wrangler.toml).
**Acceptance criteria:**

- `oursharedevents.com` zone is active in Cloudflare (nameservers propagated)
- DNS A records exist for `@`, `www`, `stg` — all proxied (orange cloud)
- SSL/TLS set to Full (strict), Always Use HTTPS enabled
- Cloudflare Account ID recorded
- Scoped API Token created (Workers Scripts: Edit, Workers Routes: Edit, Account Settings: Read — zone-restricted to oursharedevents.com)
- Production D1 databases provisioned: `ocr-db-production` + `ocr-forms-db-production`
- Production database IDs updated in `wrangler.toml` (replacing `<production-db-id>` and `<production-forms-db-id>` placeholders)
- ~~Google Cloud project~~ — REMOVED: D1 replaced Sheets in Phase 2
  **Ref:** `CLOUDFLARE-SETUP.md`, `docs/deployment/CLOUDFLARE_SECRETS.md`

---

### P1-7: Secrets + first staging deploy

**Status:** 🔄 IN PROGRESS
**Prerequisite:** P1-6 ✅ (infra must exist before secrets can point to it)
**Unlocks:** P1-8 (staging sign-off — nothing to verify until it's deployed)
**Description:** Add all credentials to GitHub Actions and Cloudflare Worker, then trigger the first deploy to `stg.oursharedevents.com`. D1-native — no Google Sheets secrets needed.
**Acceptance criteria:**

- 3 GitHub Actions secrets set: `CLOUDFLARE_API_TOKEN_OSE`, `CLOUDFLARE_ACCOUNT_ID`, `ADMIN_KEY`
- 2 Wrangler staging secrets set: `ADMIN_KEY`, `FORMS_ENCRYPTION_KEY`
- `wrangler secret list --env staging` shows both secrets
- D1 migrations applied to staging: `wrangler d1 migrations apply DB --env staging --remote` + `wrangler d1 migrations apply FORMS_DB --env staging --remote`
- `npm run deploy:staging` completes without error
- `https://stg.oursharedevents.com/health` returns `{ "ok": true, "env": "staging", "d1": "ok" }`
- ~~Google Sheets secrets~~ — REMOVED: D1 replaced Sheets in Phase 2
  **Ref:** `CLOUDFLARE-SETUP.md`, `scripts/set-secrets.sh`

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

**Status:** ✅ DONE
**Prerequisite:** P1-10 ✅ (production must be live before replacing its data source)
**Unlocks:** P2-2
**Description:** Create Cloudflare D1 databases (staging + production). Write and apply SQL schema migration for the `events` table plus indexes.
**Acceptance criteria:**

- `wrangler d1 list` shows `ocr-db-staging` and `ocr-db-production` (plus `ocr-forms-db-staging` / `ocr-forms-db-production` for the FORMS_DB separation per Invariant #1)
- `SELECT count(*) FROM events` runs without error
- Index on `(brand_id, status)` exists
  **Files to create:** `workers/oursharedevents/migrations/0001_initial.sql`
  **Ref:** `docs/migration/PHASE-2-D1-DATABASE.md`

---

### P2-2: Data migration script — Sheets → D1

**Status:** ✅ DONE
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

**Status:** ✅ DONE
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

**Status:** ✅ DONE
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

**Status:** ✅ DONE
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

**Status:** ✅ DONE (2026-09-09 reconcile) — cross-cutting response-header hardening landed via `src/lib/security-headers.ts` (#502 `sec(headers)`), applied per-request with CSP nonces. Superseded/subsumed by the header-hardening work; DAST (#501) gates the public surfaces.
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

**Status:** ✅ DONE (2026-09-09 reconcile) — `form-pages.ts` builds a per-request nonce-based CSP (`buildSecurityHeaders`, OSE-638): `script-src 'self' 'nonce-…'`, no `unsafe-inline` for scripts; inline `<script nonce="${nonce}">` tags carry the matching nonce. `img-src 'self' data:` admits QR codes (OSE-1199).
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

**Status:** ✅ DONE (2026-09-09 reconcile) — `forms.ts` enforces per-IP + per-eventId rate limiting (`isFormRateLimited`, sliding window) on register/checkin/survey/email paths; exceeding returns `429 RATE_LIMITED` with `Retry-After: 60`. Per-isolate today; distributed enforcement remains tracked separately as SR-23. (KV-backed limiter also exists — `lib/rate-limit.ts`, OSE-552.)
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

### SR-25: SharedReport competitive intelligence — local-vs-paid sponsor frame

**Status:** 📋 BACKLOG — ⚠️ premise conflicts with ratified direction (2026-09-09 reconcile). This story proposes **removing** `filterReportByDepth` from the read paths; the project instead **ratified depth as the model** (ADR-017, #474) and hardened server-side depth enforcement (#411 OSE-816, #473 OSE-817, #489 OSE-714). Revisit/rewrite this story against ADR-017 before starting — do not implement as written.
**Rating:** MVP-CORE
**Prerequisite:** SR-12
**Effort:** M

**Why this story exists:**
The SharedReport's core value proposition to a paying sponsor is the local-vs-paid comparison: _Are local grassroots advertisers out-clicking your investment, or is your spend doing real work against them?_ That comparison IS the proof of ROI — the data that drives renewal decisions.

The current `filterReportByDepth` implementation treats `local`/`mid`/`premium` as access gates, stripping report fields from sponsor readers. This is architecturally backwards: those labels are sponsor classification metadata that belong **in** the report as competitive intelligence, not on the read path as a filter.

**The correct model:**

- `local`/`mid`/`premium` are sponsor class labels — they describe what class of competitor is at the event
- The SharedReport shows the full competitive picture: all sponsor classes, all impression counts, the local-vs-paid breakdown by class
- Authorization controls WHO reads the report (signed-link token, service token) — TL-040 boundary stays (sponsor tokens can't read another individual sponsor's raw attribution)
- The `platform tier` (free/mid/enterprise feature flags) controls what tools the organizer has; the SharedReport reflects what those tools produced — it is a straight readout, not a gated view
- The report is the truth: a premium-tier sponsor bought premium placement, so they see premium results because that's what they earned

**PO Acceptance Criteria:**

- [ ] `filterReportByDepth` is removed from the batch and single-event read paths — report output is no longer field-stripped by depth parameter
- [ ] SharedReport output includes a `sponsor_class_breakdown` section: impression counts and scan attribution aggregated by sponsor class (`local`, `mid`, `premium`) — no individual sponsor names or tokens, just class-level aggregates
- [ ] The local-vs-paid delta is computable from the report: total local impressions vs. total paid (mid + premium) impressions for the event
- [ ] TL-040 security boundary is preserved: individual sponsor attribution (impression token, click token, specific placement data) remains scoped to that sponsor's signed-link token — only class-level aggregates are in the shared view
- [ ] The `depth` field on signed-link tokens is repurposed: it now controls whether the reader sees their own individual attribution detail (`local` = class aggregate only, `mid` = own placement breakdown, `premium` = admin/bar_owner full cross-class view)
- [ ] `buildSharedReport` emits `sponsor_class_breakdown` from existing scan aggregate + sponsor tier data — no new DB tables required
- [ ] All existing SharedReport tests remain green; new tests cover the class breakdown shape and the local-vs-paid delta computation

**BE Route Spec:**

- `GET /api/v2/events/:id/shared-report` — response gains `sponsor_class_breakdown: { local: { count, impressions }, mid: { count, impressions }, premium: { count, impressions } }`
- `POST /api/v2/events/shared-reports/batch` — same shape on each report in `reports` map
- `filterReportByDepth` removed from both paths; `resolveDepth` retained only for TL-040 individual-attribution scoping

**Data shape (new `sponsor_class_breakdown` field):**

```json
"sponsor_class_breakdown": {
  "local":   { "sponsor_count": 3, "total_impressions": 142 },
  "mid":     { "sponsor_count": 1, "total_impressions": 87  },
  "premium": { "sponsor_count": 1, "total_impressions": 210 }
}
```

**FD UI Spec:**

- `sharedReport.html` gains a "Sponsor Competitive View" section
- Shows local vs. paid bar comparison: local class aggregate vs. mid+premium aggregate
- Copy: "Your [Premium] placement earned X impressions vs. Y from local sponsors" — data-driven proof of ROI
- Available to all authorized report readers (not gated by tier)

**QA Test Pyramid:**

- [ ] Security: TL-040 preserved — sponsor token cannot read individual cross-sponsor attribution
- [ ] Contract: `sponsor_class_breakdown` present and shaped correctly on single + batch endpoints
- [ ] Unit: `buildSharedReport` emits correct class breakdown from seeded sponsor + scan data
- [ ] Unit: local-vs-paid delta computable (local.impressions vs mid.impressions + premium.impressions)
- [ ] Integration: batch endpoint returns class breakdown per event in reports map
- [ ] Regression: all 2204 existing tests remain green after `filterReportByDepth` removal from read paths

---

## Epic AS — All-Surface FE Uniformity

_Stories sourced from CCR audit FE uniformity matrix. Goal: consistent experience across all 7 surfaces._

### AS-1: Uniform DesignTokens across all surfaces

**Status:** ✅ DONE (2026-09-09 reconcile) — `feat(OSE-46): AS-1 uniform design tokens — scope surface tokens + contract gate`; 34 design tokens defined with a contract gate enforcing them (CLAUDE.md §3, 85% color adoption). Note: the module system this story names (`DesignTokens.html`) predates the `@ocr/ui` migration; tokens now ship via `@ocr/ui`.
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

**Status:** ✅ DONE
**Rating:** MVP-UX
**Prerequisite:** —
**Effort:** S
**Description:** Add data-testid attributes to Poster surface. Currently at 0 — target 10+.
**Acceptance criteria:**

- Minimum 10 data-testid attributes on key elements (header, QR sections, sponsor strip, event info, print button)
- Test specs updated to use new testids

---

### AS-3: data-testid on Display (1→10+)

**Status:** ✅ DONE
**Rating:** MVP-UX
**Prerequisite:** —
**Effort:** S
**Description:** Add data-testid attributes to Display surface. Currently at 1 — target 10+.
**Acceptance criteria:**

- Minimum 10 data-testid attributes on key elements (rotation controls, panes, sponsor strip, mode indicator)
- Test specs updated to use new testids

---

### AS-4: data-testid on Public (3→15+)

**Status:** ✅ DONE
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

**Status:** ✅ DONE (DONE_IN_CODE — reconciled 2026-09-27; merged #653)
**Rating:** MVP-UX
**Prerequisite:** A11Y-1
**Effort:** S
**Description:** Add ARIA roles and labels to Public surface.
**Acceptance criteria:**

- [x] Event cards use `role="article"` or `role="region"` — cards render as a
      semantic `<article>` (native `role="article"`; a redundant explicit role on
      `<article>` is an ARIA anti-pattern). `src/lib/event-list.ts:153`.
- [x] Sections use `aria-label` for screen readers — header (`role="banner"` +
      `aria-label`), `<main aria-label>`, sponsor section/banner (`aria-label`),
      events + anonymity sections (`aria-labelledby`). `src/templates/public.html`.
- [x] CTA buttons use `aria-label` for context — both list CTA variants
      (Register / recap) + the card overlay link. `src/lib/event-list.ts:147-154`.

**Reconciliation note (2026-09-27):** the ARIA implementation was already on
`main` before this session (verified in source + the 8-test AS-6 block, OSE-51, in
`tests/as-display-public-admin.spec.ts:152-201`). The backlog table was stale
(per the CLAUDE.md reconciliation rule). The one criterion implemented-but-not-
test-validated — the card **role** — is now locked by a born-red test
("event cards expose the article role via a semantic `<article>`") appended to
that block; verified red against an `<article>`→`<div>` mutation, green restored.
Flip to ✅ DONE on merge.

---

### AS-7: ARIA attributes on Display

**Status:** ✅ DONE (DONE_IN_CODE — reconciled 2026-09-27)
**Rating:** MVP-UX
**Prerequisite:** A11Y-1
**Effort:** S
**Description:** Add ARIA roles and labels to Display surface.
**Acceptance criteria:**

- [x] Rotation panes use `aria-live="polite"` for announcements — the event
      rotation region is `<main aria-live="polite" aria-atomic="false">`
      (`src/templates/display.html:358`); the clock is deliberately
      `aria-live="off"` so ticking never spams a reader. Tested:
      `tests/as-display-public-admin.spec.ts` (AS-7 block, OSE-52).
- [~] Controls use `aria-label` — **N/A: the display is a passive venue-TV
  kiosk with no interactive controls** (see brain `display_no_counts`). It
  auto-rotates; there is nothing for a keyboard user to operate, so there is
  no control to label. Header/sidebar already carry `aria-label`; ticker is
  `aria-hidden`.
- [~] Mode indicator uses `role="status"` — **N/A as a discrete widget: there is
  no separate mode-indicator element.** The `<main aria-live="polite">`
  region _is_ the status/announcement channel (content changes are
  announced), and the privacy line carries `role="note"`. Adding a fake mode
  indicator would manufacture UI the surface does not have.

**Reconciliation note (2026-09-27):** the ARIA implementation and its test block
were already on `main` (verified in source + `as-display-public-admin.spec.ts`,
OSE-52). The two "missing" criteria are not applicable to a passive kiosk (no
controls, no discrete mode widget); the applicable criterion (rotation
`aria-live`) is implemented and tested. Closed as DONE_IN_CODE; backlog table was
stale (CLAUDE.md reconciliation rule).

---

### AS-8: ARIA attributes on Poster

**Status:** ✅ DONE (DONE_IN_CODE — reconciled 2026-09-27; merged #653)
**Rating:** MVP-UX
**Prerequisite:** A11Y-1
**Effort:** S
**Description:** Add ARIA roles and labels to Poster surface.
**Acceptance criteria:**

- [x] QR images use `alt` text with destination URL description — each QR `<img>`
      is `alt="<label> QR code"` and its link wrapper carries
      `aria-label="<label> QR code — tap to open"`
      (`src/templates/poster.html`, `loadPosterQR`). Tested.
- [x] Print button uses `aria-label` — **added this session:** the print
      `<button>` now carries `aria-label="Print poster"` and its printer emoji is
      wrapped in `<span aria-hidden="true">` so the announced name is clean
      (`src/templates/poster.html:698`). Born-red test in
      `tests/poster-print-gate.spec.ts` (verified red against a removed label).
- [x] Sponsor logos use `alt` text — each sponsor `<img>` is
      `alt="<sponsor name> logo"`, inside `role="listitem"` items under a
      `role="list"` strip. Tested (`tests/poster-spon4-as2-spon10.spec.ts`).

**Reconciliation note (2026-09-27):** the poster carried a strong ARIA set
already (poster card `role="article"` + `aria-label`, QR alt + link labels,
sponsor `role=list`/`listitem` + alt, meta icons `aria-hidden`) with an existing
test block. The one genuine gap — the Print button had no `aria-label` (its
accessible name was the printer-emoji + "Print") — is closed this session. Flip
to ✅ DONE on merge.

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

**Status:** 🔄 IN PROGRESS (2026-09-27)
**Rating:** V2↑MVP
**Prerequisite:** A11Y-7
**Effort:** M
**Description:** Add automated accessibility testing using axe-core via Playwright. Runs on all 7 surfaces in CI.
**Acceptance criteria:**

- [x] `@axe-core/playwright` installed — `^4.13.0` in root devDependencies.
- [x] Test spec runs axe on each surface — `tests/e2e/2-pages/a11y-axe-surfaces.spec.ts`
      runs `AxeBuilder` (wcag2a/wcag2aa, critical+serious, one-`<h1>`) in a real
      browser against the local worker. **Two-tier design:** this covers the four
      publicly-reachable surfaces (`/`, `/events`, `/display`, `/poster`) in
      Chromium **and** WebKit; the auth/token-gated surfaces (`/admin`,
      `/sharedReport`, `/sponsor`) stay on the pre-existing jsdom axe gate
      (`workers/oursharedevents/tests/a11y-axe.spec.ts`, A11Y-7), which reaches
      them via direct handler calls — a browser can't satisfy their CF Access /
      signed-token requirement on the unseeded local worker. So **every surface is
      axe-scanned in CI**; the browser tier adds contrast/computed-role/focus
      coverage jsdom is blind to. Wiring browser auth for the gated 3 is a
      follow-up.
- [x] CI blocks merge on critical a11y violations — added to the T0 `component`
      shard's explicit spec list (`.github/workflows/oursharedevents-ci.yml`),
      run through `scripts/pw-guarded.sh` (blocking, executed>0 floor). A
      critical/serious violation turns the T0 gate red before deploy.

**Note:** first CI run confirmed real-browser axe surfaces colour-contrast debt on
landing/events/display that jsdom cannot see (poster is clean). Remediating
contrast is **A11Y-5**'s scope, so the gate **logs** contrast findings (visible,
counted) but **blocks on every other critical/serious rule** — it tightens to
include contrast once A11Y-5 lands. (Also fixed a spec bug found by that run:
`expect.fail` is a Vitest API, not Playwright's — replaced with
`expect(v, msg).toHaveLength(0)`.)

---

## Epic DAC — Documentation Domain Reconciliation

_55 documentation files reference `eventangle.com` (the pre-OSE domain). This epic renames them to `oursharedevents.com` and verifies each against live staging. Gated by P1-8 — only rename URLs you can verify against a running system._

_Source: CCR prod readiness audit 2026-04-09. DAC Backup Protocol rule: stale documentation is a defect._

### DAC-1: Batch rename — Security docs (13 files, ~295 occurrences)

**Status:** ✅ DONE (2026-09-09 reconcile) — DAC domain audit completed via `b3dca95 fix(ose-550/553): DAC domain audit complete`. `grep -ric eventangle docs/` returns 0.
**Prerequisite:** P1-8 ✅ (staging must be live to verify renamed URLs)
**Effort:** M
**Description:** Replace `eventangle.com` → `oursharedevents.com` across all `docs/security/` files. Verify any endpoint URLs against live staging after rename.
**Acceptance criteria:**

- `grep -r "eventangle" docs/security/` returns 0 matches (excluding strikethrough/historical context)
- Security specs reference correct domain for canonical host, TLS, WAF, route collapse
- No broken cross-references between security docs

**Files:**
CANONICAL_HOST_SPEC.md (68), WORKER_ROUTE_COLLAPSE_RUNBOOK.md (70), ORIGIN_BYPASS_PREVENTION.md (24), CLOUDFLARE_ACCESS_PRIVILEGED.md (21), TLS_STRICT_BASELINE.md (14), SECURITY_RUNBOOK.md (12), CF_API_TOKENS_POLICY.md (8), WAF_BASELINE.md (7), SETTINGS_AS_CODE_PLAN.md (6), ROUTE_CLASSIFICATION_POLICY.md (4), CI_DEPLOY_HARDENING.md (4), CF_ZONE_CONFIG_BASELINE.md (2), RATE_LIMITING_SPEC.md (2), SERVICE_AUTH_PATTERN.md (2)

---

### DAC-2: Batch rename — Runbooks (12 files, ~386 occurrences)

**Status:** ✅ DONE (2026-09-09 reconcile) — cleared with the DAC domain audit (`b3dca95`, OSE-553). `grep -ric eventangle docs/` returns 0.
**Prerequisite:** P1-8 ✅
**Effort:** M
**Description:** Replace `eventangle.com` → `oursharedevents.com` across all `docs/runbooks/` files (excluding RUNBOOK.md, ROLLBACK.md, RUNBOOK-SECRETS.md which are already corrected).
**Acceptance criteria:**

- `grep -r "eventangle" docs/runbooks/` returns 0 matches
- Runbook curl commands point to `stg.oursharedevents.com` / `oursharedevents.com`
- SEC runbook verification steps reference correct Worker names

**Files:**
RUNBOOK-ROOT.md (56), RUNBOOK-SEC-4.2-SINGLE-WORKER-ROUTE.md (69), RUNBOOK-SEC-4.1-CANONICAL-HOST.md (70), RUNBOOK-SEC-3.2-HSTS-PHASED.md (23), RUNBOOK-SEC-2.2-DNSSEC.md (20), RUNBOOK-SEC-3.1-STRICT-TLS.md (14), RUNBOOK-DEPLOYMENT.md (14), RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md (8), RUNBOOK-CI-DEBUG.md (6), RUNBOOK-LOCAL-TESTING.md (6), RUNBOOK-SEC-2.1-REGISTRAR-LOCK-MFA.md (4)

---

### DAC-3: Batch rename — Architecture docs (9 files, ~126 occurrences)

**Status:** ✅ DONE (2026-09-09 reconcile) — cleared with the DAC domain audit (`b3dca95`, OSE-553). `grep -ric eventangle docs/` returns 0.
**Prerequisite:** P1-8 ✅
**Effort:** S
**Description:** Replace `eventangle.com` → `oursharedevents.com` across all `docs/architecture/` files.
**Acceptance criteria:**

- `grep -r "eventangle" docs/architecture/` returns 0 matches
- Origin tables, routing diagrams, and URL examples reference correct domain

**Files:**
origins.md (44), FRIENDLY_URLS.md (29), BASELINE.md (17), api-version-check-sample-output.md (10), ci-cd-architecture.md (9), APPS_SCRIPT_PROJECT.md (6), worker-routing.md (5), PAGES.md (4), ARCHITECTURE.md (2)

---

### DAC-4: Batch rename — Deployment + Monitoring + QA docs (16 files, ~161 occurrences)

**Status:** ✅ DONE (2026-09-09 reconcile) — cleared with the DAC domain audit (`b3dca95`, OSE-553). `grep -ric eventangle docs/` returns 0.
**Prerequisite:** P1-8 ✅
**Effort:** M
**Description:** Replace `eventangle.com` → `oursharedevents.com` across deployment, monitoring, QA, verification, and stories docs.
**Acceptance criteria:**

- `grep -r "eventangle" docs/deployment/ docs/monitoring/ docs/qa/ docs/verification/ docs/stories/` returns 0 matches
- Environment matrices, monitoring endpoints, and test targets reference correct domain

**Files (deployment 7):**
DEPLOYMENT-ROOT.md (27), STAGING_SETUP.md (16), ENVIRONMENT_MATRIX.md (15), DNS_CUTOVER.md (14), DEPLOYMENT.md (11), CLOUDFLARE_WORKER_MIGRATION.md (7), MIGRATION_EPICS.md (4), KV_TEMPLATES_SETUP.md (2)

**Files (monitoring 4):**
SYNTHETIC_MONITORING.md (28), ENVIRONMENT_PARITY_REPORT.md (11), UPTIME_MONITORING.md (10), PERFORMANCE_NOTES.md (4)

**Files (qa 5):**
E2E_PLAYWRIGHT_GUIDE.md (5), QA_ENVIRONMENT_MANAGEMENT.md (4), TEST_MATRIX.md (2), NEGATIVE_TEST_PLAN.md (2), test-matrix-legacy.md (1)

**Files (verification 5):**
STAGING_EVENTS_DIAGNOSIS.md (15), STAGING_GAS_PERMISSIONS.md (9), STORY_M3_EVENTS_RENDERING_VERIFICATION.md (8), WORKER_GAS_WIRING_VERIFICATION_M2.md (5), PO_SIGNOFF_STAGING_PARITY.md (2)

**Files (stories 1):**
STORY-A2-OBSERVABILITY.md (6)

---

### DAC-5: Final verification — zero active eventangle references

**Status:** ✅ DONE (2026-09-09 reconcile) — DAC domain audit signed off in `b3dca95` (OSE-553). `docs/` is 0. Residual `eventangle` strings survive only in historical audit records (`.claude/outputs/2026-04-06-eventangle-removal-audit.md`, `.claude/documents/RECONCILIATION.md`), in `archive/`/`docs/migration/`, and in this epic's own descriptive text — all expected/historical.
**Prerequisite:** DAC-1, DAC-2, DAC-3, DAC-4
**Effort:** XS
**Description:** Confirm the only remaining `eventangle` references are in `archive/` and `docs/migration/` (historical context). Update RECONCILIATION.md with final traffic light.
**Acceptance criteria:**

- `grep -r "eventangle" docs/ .claude/ README.md STORIES.md` returns 0 matches
- `grep -r "eventangle" archive/ docs/migration/` returns only historical references (expected)
- RECONCILIATION.md updated with DAC epic completion record
- Results reported in test output

---

## Epic TP — Test Pyramid Enforcement

_Too many stories shipped without full QA. This epic wires the complete test pyramid into CI and establishes the cross-surface E2E flow. No story reaches DONE without all 7 pyramid levels passing. This is retroactive — past gaps are acknowledged debt._

_Required pyramid: Security → Lint → Contract → Unit → Integration → API (Newman) → E2E (Playwright)_

_Source: PO directive 2026-04-09. Standard protocol._

### TP-1: Wire 78 E2E Playwright files into CI pipeline

**Status:** ✅ DONE (2026-08-25, OSE-554) — T4b/T4c/T4d wired into the post-deploy chain as blocking and validated green on staging (run 32875459164). T4c: register/checkin + validation blocking; survey/email submission continue-on-error (Phase-2 gate → OSE-1004/OSE-1007). T4d: 16 tier-1 page-smokes blocking; 3 auth/token routes (admin ×2 + sharedReport) deferred → OSE-1010. T4e/T4f continue-on-error. Reporter→dashboard AC split → OSE-1009.
**Prerequisite:** P1-8 ✅ (staging must be live for E2E to run against)
**Effort:** L
**Description:** Add a new CI job (Stage 04: E2E Gate) that runs the full 78-file Playwright E2E suite against staging after the Functional Smoke stage passes. This is the missing top of the pyramid. The tests exist — they just aren't gated.
**CI/CD Ticket:** Required

**Acceptance criteria:**

- New CI job `04-e2e-gate` added to `oursharedevents-ci.yml`
- Job runs after `03b-functional-smoke` completes successfully
- All 78 E2E files execute against `stg.oursharedevents.com`
- Job is blocking — staging is not considered green until E2E passes
- Test artifacts (screenshots, traces) uploaded on failure
- Production deploy (`v*.*.*` tag) requires E2E gate green

**Pipeline after this story:**

```
Security Gate → Deploy Staging → Quality Smoke → Functional Smoke → E2E Gate → [Prod on tag]
```

**E2E test directories wired:**

- `tests/e2e/1-smoke/` (13 files) — surface smoke
- `tests/e2e/2-pages/` (10 files) — page-level
- `tests/e2e/3-flows/` (14 files) — user journeys
- `tests/e2e/4-negative/` (10 files) — error/edge cases
- `tests/e2e/api/` (7 files) — API CRUD
- `tests/e2e/scenarios/` (4 files) — real-world scenarios
- Remaining 20 files — auth, accessibility, diagnostics, workflows

---

### TP-2: Cross-surface E2E — poster → pre-event → event → post-event flow

**Status:** 📋 BACKLOG
**Prerequisite:** TP-1
**Effort:** L
**Description:** Write the definitive cross-surface E2E test that validates the full NCR lifecycle flow across all 6 MVP surfaces. This test proves the product works end-to-end as a customer, sponsor, and admin would experience it.
**CI/CD Ticket:** Required

**The flow under test:**

```
1. ADMIN configures event (admin surface)
   → Event created with template, forms enabled, sponsor attached

2. POSTER generates (poster surface)
   → QR codes render, shortlinks resolve, print layout correct

3. PRE-EVENT registration (public surface)
   → Customer scans QR → registration form → anonymous ID assigned

4. EVENT check-in (public surface)
   → Customer checks in → count increments → display updates

5. DISPLAY shows live data (display surface)
   → Event stats, sponsor rotation, real-time counts

6. POST-EVENT survey (public surface)
   → Customer submits survey → PII handled correctly

7. SHARED REPORT validates (sharedReport surface)
   → Aggregate data renders, sponsor ROI visible, flag gating works

8. CONFIG verified (admin surface)
   → Feature flags, tier gating, form toggles all reflect correctly
```

**Acceptance criteria:**

- Single Playwright spec file: `tests/e2e/3-flows/full-ncr-lifecycle.spec.js`
- Tests run against `stg.oursharedevents.com`
- All 6 surfaces hit in sequence: admin → poster → public → display → public → sharedReport
- Flow validates data flows between surfaces (event created in admin appears in public, counts in display match check-ins)
- Sponsor integration tested: sponsor appears on poster, display, and sharedReport
- Anonymous ID persists across check-in and survey (same session)
- Feature flag gating tested: disable a form type, verify it's blocked
- Test passes in CI as part of TP-1 E2E gate

---

### TP-3: Newman collection audit — verify all 6 surfaces covered

**Status:** 📋 BACKLOG — ⚠️ framing superseded (2026-09-09 reconcile). Newman entry points were repointed at live OSE collections and the GAS-era ones archived (OSE-838), then the contract tier was migrated **Postman/Newman → Bruno** (offline/git-native, OSE-1191, #—). The `ose-api.json`/`ose-pages.json` Newman artifacts this story audits no longer drive CI. Rewrite the surface-coverage audit against the Bruno collections before starting; TP-2 (cross-surface E2E) and TP-4 (k6→CI) remain genuinely open.
**Prerequisite:** P1-8 ✅
**Effort:** S
**Description:** Audit the existing Newman collections (`ose-api.json`, `ose-pages.json`) to confirm all 6 MVP surfaces and all form endpoints are covered. Add missing requests. Ensure latency assertions are present.
**CI/CD Ticket:** Required

**Acceptance criteria:**

- `ose-api.json` covers: health, events CRUD, forms (4 types), feature flags (8 endpoints), QR, analytics
- `ose-pages.json` covers: admin, public, display, poster, sharedReport, sponsor, config
- Every request has at least: status code assertion + response time < 2000ms
- `npm run test:newman:api` and `npm run test:newman:pages` pass against staging
- Gap report documented if any surface or endpoint is missing

---

### TP-4: Wire k6 load tests into staging CI gate

**Status:** 📋 BACKLOG
**Prerequisite:** TP-1
**Effort:** M
**Description:** Add k6 smoke load test to CI pipeline as a post-E2E stage. 5 existing k6 scripts exist (`tests/load/`). Wire the smoke variant into CI with pass/fail thresholds.
**CI/CD Ticket:** Required

**Acceptance criteria:**

- New CI job `05-load-gate` runs k6 smoke test against staging
- Thresholds: p95 < 500ms, error rate < 1%
- Job runs after E2E gate passes
- Failure blocks production deploy but does not block staging (warning gate)
- k6 results artifact uploaded

---

### TP-5: Retroactive audit — flag stories marked DONE without full pyramid

**Status:** ✅ DONE
**Prerequisite:** TP-1
**Effort:** S
**Description:** Review all stories currently marked DONE. For each, determine whether it had CI/CD validation at the time of completion. Flag any that shipped without full pyramid as acknowledged debt. This is not a re-test — it's a transparency record.
**CI/CD Ticket:** N/A — this is the audit itself
**Completed:** 2026-04-10

**Result: 43 of 43 DONE stories shipped without full test pyramid (pre-TP)**

All stories completed before the TP epic was established. The E2E gate (TP-1) does not exist in CI yet. Every story had partial CI validation (security gate, unit/contract tests pass locally or in CI) but zero had the full 7-level pyramid because levels 6 (Newman against live) and 7 (Playwright E2E against live) require a deployed staging environment that does not yet exist (blocked on P1-6).

| CI Level                    | Data Source       | Available at time of completion? | Stories covered |
| --------------------------- | ----------------- | -------------------------------- | --------------- |
| Security (lint, typecheck)  | _MOCK_            | ✅ Yes                           | All 43          |
| Unit tests (Vitest)         | _MOCK_            | ✅ Yes                           | All 43          |
| Contract tests (Vitest)     | _MOCK_            | ✅ Yes                           | All 43          |
| Worker D1 tests (miniflare) | _MOCK_ (local D1) | ✅ Yes (post P2-1)               | 30+             |
| Newman API                  | **LIVE**          | ❌ No staging deployed           | 0               |
| Playwright smoke            | **LIVE**          | ❌ No staging deployed           | 0               |
| Playwright E2E              | **LIVE**          | ❌ No staging deployed           | 0               |

**Summary: 43/43 stories validated by _MOCK_ data only. 0/43 validated against LIVE.**

**Stories audited (43 total, all pre-TP):**

| Story                    | Commit Evidence                  | CI Level                    |
| ------------------------ | -------------------------------- | --------------------------- |
| P1-1 through P1-5        | Early commits                    | Security + Unit             |
| P2-1 through P2-5        | `a9f289d`, `0142f97`, `5ab6892`  | Security + Unit + Worker D1 |
| A11Y-1                   | `c9ec475`                        | Security + Unit             |
| A11Y-4                   | `ba20a88`                        | Security + Unit             |
| SR-12                    | `b698fcc`                        | Security + Unit + Worker D1 |
| AS-2, AS-3, AS-4         | `ba20a88`, `a526332`             | Security + Unit             |
| BE-11                    | `b698fcc`                        | Security + Unit             |
| SEC-1                    | `b698fcc`                        | Security + Unit             |
| ADMIN-1 through ADMIN-11 | `a9f289d`                        | Security + Unit + Worker D1 |
| ADMIN-12                 | `d635b2f`                        | Security + Unit             |
| ADMIN-13                 | `167a77d`, `a526332`             | Security + Unit             |
| ADMIN-14, ADMIN-15       | `7dcd8d9`                        | Security + Unit             |
| ADMIN-16                 | `a526332`                        | Security + Unit             |
| ADMIN-23                 | `b698fcc`                        | Security + Unit             |
| HK-1                     | Prior session (worker/ archived) | N/A (housekeeping)          |
| HK-3                     | `6045233`                        | Security + Unit             |
| SRE-4                    | This session                     | Security + Worker D1        |

**Conclusion:** No stories are reverted. The debt is acknowledged. Once TP-1 wires E2E into CI and P1-6/7/8 deliver a live staging site, all future stories will require the full 7-level pyramid to reach DONE.

---

## Epic SECGATE — OSE-1186 Security-Gate Campaign (G1–G4)

_Added 2026-09-09 reconcile. The largest body of work merged since the 2026-08-03 snapshot that the Master Status Table above does not model. Day-to-day tracking is Linear (OSE-1186); this section is the STORIES.md record with citable PRs. All slices below are merged to `main`._

### SECGATE-G1: Mutation-testing floor on covenant + authZ guards

**Status:** ✅ DONE — Stryker config for the covenant guards (#498), 100% mutation + break threshold 95, CCR-consistent (#499), nightly + dispatch Stryker CI job (#500). AuthZ slice: JWKS/RSA harness covering `verifyCfAccessJWT` (#505), admin auth guard `admin.ts` at 100% mutation, break:95 (#506). PII-scrub crypto `pii.ts` at 100% mutation, 0 real survivors (#504).

### SECGATE-G4: Fail-closed authentication + negative-auth fuzzing

**Status:** ✅ DONE — fail-closed CF Access JWT + negative-auth fuzz (#503). Related fail-closed hardening: `PHASE_REQUIRED` on unknown event with red-team proof (#497).

### SECGATE-DAST: OWASP ZAP baseline + response-header hardening

**Status:** ✅ DONE — OWASP ZAP baseline over the public surfaces (#501, slice 1); cross-cutting response-header hardening applied per-request with CSP nonces + DAST gating (#502, `src/lib/security-headers.ts`). This is the same header work that closed SR-14 and confirmed SR-15.

---

## Epic CONTINUITY — Doc→Code→Process Continuity Remediation (CCR 5-loop)

_Added 2026-09-10. Output of a 5-loop CCR continuity audit across ADRs ↔ invariant constitution ↔ shared brain ↔ OCR-docs ↔ OSE ↔ OW ↔ test pyramids ↔ CI/CD. **Evidentiary rule (PO-set): Code authoritative → Linear corroborating → ADR/brain docs reconciled after human review.** Nothing auto-applied. Linear EPIC = project `Doc→Code→Process Continuity Remediation (CCR 5-loop)` under the "Self-Checking Infrastructure" initiative; sits in team OSE. Tier A is 📋 Todo (start next session); B/C 📋 Backlog._

> **Reconciliation protocol (lean).** How to run one finding without it becoming cumbersome:
>
> 1. **Verify before editing.** Confirm the authoritative code/config first (grep the file, the CI shard, the merged PR). Cite that evidence in the PR body — evidence trail = code → Linear → doc. The PR review _is_ the human review.
> 2. **One finding → one PR → `Closes OSE-###` + `Part of OSE-1282`.** Keeps the close-guard happy and the Feature open until its last child merges.
> 3. **Batch only what is _the same edit_.** Fixing a table? Backfill its stale rows in the same PR (e.g. ADR-018 rode with the ADR-README row backfill). Different concern = different PR (F2 ADRs and F11 CLAUDE.md shipped separately). When in doubt, split.
> 4. **Respect the append-only / immutable surfaces.** Brain `enrichment_history` is append-only (never renumber/delete). ADRs are immutable except `Status` — record supersession as a dated top-note, not a body rewrite. Verify with the doc's own gate (`run_all.py` for the brain) before pushing.
> 5. **Cross-repo findings live where the file lives.** OCR-docs findings (e.g. F16) get a clean worktree off that repo's `origin/main`; don't entangle with in-progress branches there.

| Story ID   | Linear # | Status          | Title                                                                                  | Parent     |
| ---------- | -------- | --------------- | -------------------------------------------------------------------------------------- | ---------- |
| **EPIC**   | —        | 📋              | Doc→Code→Process Continuity Remediation (CCR 5-loop)                                   | Initiative |
| Feature A  | OSE-1282 | ✅ DONE         | Reconcile Docs to Authoritative Code                                                   | EPIC       |
| F2         | OSE-1285 | ✅ #515         | Author ADR-018 (Declined Regulatory Regimes) + supersession notes ADR-001/009          | OSE-1282   |
| F16        | OSE-1286 | ✅ OCR-docs#125 | Reconcile invariant #21 activation_note (partial) with its live status (OCR-docs repo) | OSE-1282   |
| F11        | OSE-1287 | ✅ #516         | Correct "self-hosted pool retired org-wide" claim (only OSE migrated)                  | OSE-1282   |
| Feature B  | OSE-1283 | 📋              | Close Enforcement Gaps                                                                 | EPIC       |
| F13        | OSE-1288 | 📋              | Enforce Invariant #22 (cross-repo import isolation) on the OW side                     | OSE-1283   |
| F9         | OSE-1289 | 📋              | #2/#4 are `live` but only T4-gated — add PR-gating specs or correct status             | OSE-1283   |
| F10        | OSE-1290 | 📋              | Wire or retire ~104 dead tests/e2e specs + unused test:e2e:* scripts                   | OSE-1283   |
| Feature C  | OSE-1284 | 📋              | Traceability & Hygiene                                                                 | EPIC       |
| F3         | OSE-1291 | 📋              | Add ADR↔invariant back-references (traceability at 12%)                                | OSE-1284   |
| F14        | OSE-1292 | 📋              | Refresh OW CLAUDE.md (test counts ~10× stale, invariant mechanism, fuzz)               | OSE-1284   |
| F12/F15/F5 | OSE-1293 | 📋              | Brain silent-pass hardening + label 3rd testing layer + ADR-009↔010 axis               | OSE-1284   |

---

## Epic TRIANGLE — Screens on every corner (2026-09-16, Cowork slice)

> Standing directive (PO, 2026-09-16): the event / sponsor / attendee corners and the SharedReport at the centre must be connected by **screens**, not by links someone has to keep. Usability identification first (`workers/oursharedevents/docs/ops/TRIANGLE-SCREEN-MAP-2026-09-16.md`), then stitching, security posture unchanged. Slice PRs: no `OSE-###` in branch/title; body `Part of OSE-1245`.

### TRI-1: Event lifecycle driver — Your events, status panel, honest wizard, draft expiry

**Status:** 🔄 IN PROGRESS (code + worker specs green locally; needs PR + CI)
**Prerequisite:** —
**CI/CD Ticket:** — (to open)

**PO Acceptance Criteria:**

- [x] Every UI-created event can be moved draft → ready → live → archived from `/admin` (status panel; state machine edges only)
- [x] Front door has **Your events**; list filters Drafts / Ready / Live / Archived, **Only mine** (`events.created_by`, migration 0075), **Show more** (cursor)
- [x] Wizard step 5 says "saved as a draft" and offers **Go live now**
- [x] `PUT /admin/events/:id` with `status` enforces `VALID_TRANSITIONS` (409 `INVALID_TRANSITION`)
- [x] Nightly `runDraftExpiry` archives (never deletes) drafts untouched ≥ `DRAFT_EXPIRY_DAYS` (default 30, 0 = off); future-dated drafts skipped; audited
- [ ] Merged + exercised by named CI jobs (T0 invariants, workers pool, mobile-workability)

**QA:** `tests/admin-events-lifecycle-list.spec.ts`, `tests/draft-expiry.spec.ts`, `tests/admin-event-lifecycle-ui.spec.ts`; schema/constraints counts bumped (44 cols / 72 idx); INV9 exemption re-keyed `events.ts:256→301`.
**Audit doc:** `workers/oursharedevents/docs/ops/EVENT-LIFECYCLE-AUDIT-2026-09-16.md`.

### TRI-2: Sponsor home — the sponsor corner gets a screen

**Status:** 🔄 IN PROGRESS
**Prerequisite:** TRI-1

**PO Acceptance Criteria:**

- [x] `POST /api/v2/admin/sponsors/:id/home-link` mints a 30-day sponsor-scoped signed link (brand-scoped, rate-limited, audited `MINT_SPONSOR_HOME_LINK`); **Sponsor link** action on the admin sponsors row
- [x] `GET /sponsor?t=` server-renders the sponsor's placements with event state, Event page link (live only), sponsor-scoped **Your report** link (active/archived only), **Accept / Decline**
- [x] `POST /api/v2/sponsor/placements/:id/respond` sets `sponsor_placement.sponsor_accepted` for the token's own placement only (404 otherwise); audited as `sponsor:<id>`
- [x] No attendee data on the page; `noindex`; `no-store`; nonce CSP; token `kind` distinct from the report token
- [ ] Adopt `@ocr/ui` partials for the sponsor template (currently hand-rolled CSS on tokens — FE drift to close)
- [ ] Register `/sponsor` as a UEC URL class in OCR-docs (`uec-codes.yaml`) — brain intake

**QA:** `tests/sponsor-home.spec.ts` (19). **Lib:** `src/lib/sponsor-home-auth.ts`, `src/handlers/sponsor-home.ts`, `src/templates/sponsor-home.html`.

### TRI-3: Attendee discovery — /events answers a question

**Status:** 🔄 IN PROGRESS
**Prerequisite:** —

**PO Acceptance Criteria:**

- [x] Server-rendered search (name / venue) + **Everything / Today / This weekend / Next 7 days / This month / Recently wrapped** chips; `when` allowlisted, `q` capped + escaped once; URL is the state; no client fetch
- [x] Default view unchanged (every listed event incl. wrapped) — API-parity contract holds
- [x] Map view — PR #700: the **landing** area's map view (`src/lib/attendee-map.ts`), inline-SVG H3 res-7 hexes + legend, drawn from `h3_res7` through the public projection, never lat/lon. **Per-corridor gate + latch** (VISION §6.2b, PO 2026-09-30): a corridor is drawn at ≥ 5 upcoming events of its own or once latched (`corridor_readiness_latch`, migration 0083, nightly `runCorridorLatch`). Deliberately NOT `renderCorridorMap` (that is retrospective proof, "honest at any density"; this surface is density-gated). QA: `attendee-map.spec.ts`, `corridor-latch.spec.ts`, `public-projection-routing.spec.ts`, browser `landing-theme.spec.ts`.

**QA:** `tests/event-discovery.spec.ts` (16). **Lib:** `src/lib/event-discovery.ts`.

### TRI-4: Admin event timeline — the chain at a glance

**Status:** 🔄 IN PROGRESS
**Prerequisite:** TRI-1

- [x] Card hydrates from `ose:event-selected`; six steps (Set up → Live → Poster out → People scanning → Sponsors on → Report) from row + `/stats` (k-floored) + poster deployments + sponsors; **Next:** one link into the right card; stale-response guard
- [x] Organizer inbox — PR #700: "Needs your attention" on the checklist card (not answered / declined / asked to join) via `oseEventView().inbox`; QA `admin-organizer-inbox.spec.ts` + browser steps in `sponsor-home-flow.spec.ts`

### TRI-5: Reconciliation to the shared brain

**Status:** 📋 BACKLOG

- [ ] OCR-docs brain: `/sponsor` URL class (UEC), `events.created_by` column, `DRAFT_EXPIRY` + `SPONSOR_PLACEMENT_RESPOND` + `MINT_SPONSOR_HOME_LINK` + `SPONSOR_REQUEST_PLACEMENT` + `ANSWER_SPONSOR_REQUEST` audit actions, `DRAFT_EXPIRY_DAYS` env knob, `corridor_readiness_latch` table (0083)
- [ ] Bruno collection: admin list filters incl. `?sort=upcoming`, home-link mint, respond endpoint, `POST /api/v2/sponsor/requests`, `POST /api/v2/admin/sponsor-requests/:id/respond` — request files added in PR #700; staging run pending (T2 runs only after deploy). Found while adding them: CRLF in the collection script made Bruno's comment-stripper eat most request assertions (13 scripts + the latency budget); all Bruno YAML normalized to LF, guarded in `tests/integration/infra-consistency.test.js`
- [x] Playwright E2E: organizer → sponsor link → sponsor accepts → placement visible on `/events/:id` — PR #700 `tests/playwright/sponsor-home-flow.spec.ts`, blocking phone audit on every PR
- [x] ~~`admin.html` split~~ → **re-scoped (PR #700, remediation step 7a):** measured, admin's effect on startup CPU is not measurable; `h3-js` is ~85%. Lazy-load h3-js is the pending cold-start decision; the admin split is a size/maintainability item (`docs/ops/STARTUP-COST-2026-09-30.md`)

### TRI-7: Sponsor discovery — a sponsor asks to back an event

**Status:** 🔄 IN PROGRESS (PR #700)
**Prerequisite:** TRI-2

**PO Acceptance Criteria:**

- [x] `/sponsor` lists **Events you could back** (the brand's published, active, upcoming events the sponsor is not linked to; "Near you" when in the sponsor's res-7 cell) and **Your requests** (waiting / the organizer said no)
- [x] `POST /api/v2/sponsor/requests`: token in body, brand from the signed claim, ≤ 5 waiting per sponsor (live events only, atomic), route-rate-limited, audited `sponsor:<id>`; out-of-brand / unlisted / over → 404 (no oracle)
- [x] Two-sided consent (ADR-019 amendment 2026-09-30): stored `is_active = 0, organizer_accepted = NULL`; public readers also require `organizer_accepted = 1` for `source = 'sponsor_request'`
- [x] Organizer: inbox "asked to join", sponsors card **Approve / Decline / Approve after all**, attach approves a waiting request; `POST /api/v2/admin/sponsor-requests/:id/respond` (JSON-only, brand-scoped, audited)
- [ ] Sponsor withdraw; request expiry; paging past 20 discoverable events

**QA:** `tests/sponsor-discovery.spec.ts` (22), `sponsor-home-xss.spec.ts`, `red-team/sponsor-promotion.spec.ts` (writer enumeration), browser `sponsor-home-flow.spec.ts`.

### TRI-8: Admin list "Soonest first"

**Status:** 🔄 IN PROGRESS (PR #700)
**Prerequisite:** TRI-1

- [x] `GET /api/v2/admin/events?sort=upcoming` (upcoming soonest → undated → past most-recent; floor "today somewhere"; own opaque cursor carrying its floor; bad sort/cursor → 400); admin toggle; `filters.sort` echo
- [x] List labels each page from a per-request query snapshot and drops stale responses (label race)

**QA:** `admin-events-upcoming.spec.ts` (D1), `admin-events-upcoming-cursor.spec.ts`, browser tests in `admin-csp-controls.spec.ts`.

### TRI-6 / OSE-1344: Category → Type picker on Create Event ("Sports > Bocce")

**Status:** 🔄 IN PROGRESS (code + tests on disk 2026-09-16; needs PR + CI)
**Linear:** OSE-1344 (High) under OSE-1322; linked OSE-1314, registry tickets, advanced-form redesign
**Prerequisite:** TRI-1

**Finding (measured 2026-09-16):** BOTH create paths lacked a type control — the advanced form had no field; the wizard's step 2 rendered fine but was four hardcoded copy-prefill cards (`TEMPLATE_PREFILL`), not a type picker (so no separate "blank step 2" bug). `events.event_type_id` (0023) had never been written by any handler. `category_registry` (OSE-729) is the layout-template axis (bar_events / leagues / general), NOT the type taxonomy; the 47 types (0024) carried their category only as the UEC prefix (15 clusters).

- [x] Migration **0076**: `event_type_category_registry` (15 clusters, display names + order) + `event_type_registry.category_code` backfilled from the UEC prefix + index; `REQUIRED_DB_MIGRATION` = 76
- [x] `lib/event-type-catalog.ts` — one grouping for every reader; an unmapped type goes to **Other**, never dropped; `orphans` counted
- [x] `GET /api/v2/admin/event-types` (admin, read-only, `{ ok, categories:[{code,name,types:[{id,uec_code,name,description}]}], orphans }`)
- [x] `POST/PUT /api/v2/admin/events` accept `event_type_id` — id-shape + registry-validated (400 `INVALID_EVENT_TYPE`), null clears; **does not touch `legal_clearance_tier`** (Invariant #4 / OSE-380 — the born-red gate caught a first draft that derived it)
- [x] `admin.html`: Category → Type selects on the advanced form AND wizard step 2 (ahead of the prefill cards); ONE loader (`window.oseTypePicker`), createElement/textContent only, honest failure copy; both POSTs send `event_type_id`
- [x] **Acceptance criterion gated:** `tests/event-type-catalog.spec.ts` asserts 0 orphans, 47/47 prefix-matched, 15 categories each non-empty
- [ ] Show the type on the admin list row + public event page (discovery filter by category is the attendee-side follow-on)
- [ ] Edit path in admin (change type after create — API supports it, no UI yet)
- [ ] PR (slice: no OSE-### in branch/title; body `Part of OSE-1344`) + CI pyramid; Bruno; OCR-docs brain intake (new table, column, endpoint)

**QA:** `tests/event-type-catalog.spec.ts` (17). Counts bumped: tables 36, indexes 73, `event_type_registry` 11 cols. INV9 exemption re-keyed `events.ts:301→335`.
