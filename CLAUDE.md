# CLAUDE.md — ourSharedEvents

## Project overview

ourSharedEvents is the core events platform under the ourCommunityRituals ecosystem. It serves public event listings, admin dashboards, and a JSON API. The platform is migrating from Google Apps Script + Sheets to Cloudflare Workers + D1.

## Tech stack

- **Runtime:** Cloudflare Workers (TypeScript), Google Apps Script (legacy)
- **Data:** Google Sheets (Phase 1) → Cloudflare D1 (Phase 2)
- **Frontend:** Embedded HTML templates (Phase 1) → React + Tailwind on Firebase Hosting (Phase 3)
- **CI/CD:** GitHub Actions → Wrangler deploy
- **Testing:** Jest (unit/contract), Playwright (E2E/API), k6 (load)

## Key directories

- `src/mvp/` — Google Apps Script source (HTML, JS)
- `cloudflare-proxy/` — Cloudflare Worker code (router, middleware)
- `workers/oursharedevents/` — New Worker source (Phase 1 build)
- `tests/` — All tests: `unit/`, `contract/`, `e2e/`, `integration/`
- `schemas/` — JSON schemas for events and analytics
- `docs/` — Architecture docs, migration plans
- `archive/` — Legacy code

## Environments

- **Staging:** `stg.oursharedevents.com`
- **Production:** `oursharedevents.com`
- Env vars prefixed `STAGING_*` / `PROD_*`

## Testing

```bash
npm test              # Unit tests (Jest)
npm run test:contract # Contract tests
npm run test:e2e      # E2E tests (Playwright)
```

Tests are organized by story ID (e.g., Story 1.1, Story 2.3).

## Project tracking

- **Stories:** `STORIES.md` — single source of truth for all work
- **Linear:** Team `OUR` (OurSharedEvents) — see `.claude/sync/LINEAR-MAP.md` for story ↔ issue mapping
- **Phases:** P1 Build (done) → P1 Ops (current) → P2 D1 Database → P3 Firebase
- **Dependencies:** All issues have `blockedBy` relationships in Linear matching the prerequisite chain in STORIES.md

## Linear workflow loop

When starting a new session or when asked "what's next", follow this loop:

1. **Query Linear** for team OUR issues in Backlog/Todo state that have no unresolved blockers (all `blockedBy` issues are Done)
2. **Pick the first unblocked issue** by story ID order (P1-6 before P1-7, etc.)
3. **Move it to In Progress** in Linear (`state: "In Progress"`)
4. **Do the work** — read the issue description for acceptance criteria and referenced files
5. **Commit + push** with story ID in message: `feat: <description> (P1-6)` referencing `OUR-11`
6. **CI gate (BLOCKING)** — before marking Done, verify CI passes:
   ```bash
   # Wait for the run to appear, then poll until it completes
   gh run list --branch <branch> --limit 1 --json status,conclusion,headSha
   ```
   - If `conclusion` is `success` → proceed to step 7
   - If `conclusion` is `failure` → enter the **CCR loop** (see below). Max 3 attempts.
   - If the story has no code changes (e.g., infra provisioning, manual steps) → skip this gate, note why in the commit
7. **Mark Done** in Linear (`state: "Done"`) — only after CI is green or gate is explicitly skipped
8. **Update `.claude/sync/LINEAR-MAP.md`** status column to reflect the change
9. **Loop** — go back to step 1 for the next unblocked story

**CI gate is non-negotiable for any story that touches code or CI config.** A story is not Done until its changes pass the pipeline. This prevents broken code from unblocking downstream stories.

### CCR loop — Critique → Correct → Revalidate (max 3 attempts)

When CI fails, do NOT just patch the symptom. Each CCR iteration must critique the fix holistically before committing. Hard stop after 3 attempts — escalate to the user.

**Each CCR iteration:**

1. **Read failure logs** — `gh run view <id> --log-failed`
2. **Critique** — before writing any code, evaluate candidate fixes against ALL of these dimensions:
   - **Security** — does the fix introduce or leave open any vulnerability? (injection, auth bypass, secret exposure)
   - **Product** — does the fix preserve the acceptance criteria from the story? No silent regressions to user-facing behavior
   - **Time** — is this the most direct fix, or are you over-engineering? Prefer surgical changes
   - **Maintenance** — does the fix make the codebase harder to maintain? Avoid workarounds that create tech debt
   - **Existing maintainability** — does it respect current patterns, naming, and architecture? Don't refactor unrelated code mid-fix
   - **Testing** — does the fix need new/updated tests? Will existing tests still pass?
   - **Regressive functionality** — explicitly check that the fix doesn't break other endpoints, routes, or features
   - **Observability** — does the fix degrade logging, health checks, or error reporting?
   - **Token/batch efficiency** — is the fix minimal in scope? Avoid large rewrites that burn context and review bandwidth
3. **Correct** — implement the single best fix that scores well across all dimensions. Commit + push.
4. **Revalidate** — `gh run list --branch <branch> --limit 1 --json status,conclusion,headSha`
   - Green → exit CCR loop, proceed to step 7
   - Red → increment attempt counter, loop back to step 1

**After 3 failed CCR attempts:**
- **STOP.** Do not attempt a 4th fix.
- Move the issue to **In Review** in Linear (`state: "In Review"`)
- Add a comment to the Linear issue summarizing: what failed, what was tried (all 3 attempts), and what the agent believes the root cause is
- Alert the user: "CCR loop exhausted on OUR-XX — needs human review"

## Architecture decisions + why

- **Cloudflare Workers over traditional servers** — edge compute, <5ms data access with D1, no cold starts, global by default
- **Google Sheets → D1 migration** — Sheets latency 200-800ms, D1 <5ms. No Google credential dependency post-Phase 2
- **Embedded HTML → Firebase Hosting** — Worker bundle 200KB+ → <50KB. CDN-served pages with per-event theming
- **Anonymous ID architecture** — zero PII by design, not by policy. 5-layer privacy stack: token isolation, temporal bucketing, write delay, k-anonymity gate, aggregate-only API
- **Gaming Compression Governor** — proprietary algorithm prioritizing local business visibility during peak community engagement. Transparent by design — mandatory legal disclosure in Premium Sponsor Agreements

## Scrum POVs per role — current state

- **Sponsor** — sees event pricing ($75-$1000/event), receives SharedReport, governor disclosure in contract
- **Admin** — manages events, sponsors, display surfaces. isPrimary→tier schema bug currently blocking sponsor features
- **Display** — 3-surface model (wall_poster, kiosk_display, table_card). Sponsor rendering per tier per format
- **Public** — event listings, QR scan entry point, Blackboard Covenant consent
- **SharedReport** — per-event sponsor analytics with k-anonymity (HAVING COUNT >= 5), governor activation data
- **Documentation** — specs, compliance tracker, Privacy Bill of Rights (pending 12 compliance requirements)

## Platform knowledge — what OSE knows

- Event engagement patterns via anonymous QR scans (temporal bucketing, no PII)
- Sponsor display frequency and governor activation history
- Attendance wave patterns (arrival, peak, departure)
- Geographic cell data per venue/neighborhood
- Multi-tenant data model — each vertical (OurRecNights, OurBocce, etc.) is a tenant feeding the same data layer

## Skills — how to build on it

- **New vertical:** Tenant config + domain → agent reads SKILLS.md → stood up in a day
- **New Worker route:** Follow `worker_slug_routing.md` patterns (/p/ /e/ /d/ /r/)
- **New Newman collection:** Add to OurSharedMagnets API layer, follows existing contract patterns
- **New Playwright test:** Organized by story ID in `tests/e2e/` (smoke → pages → flows → negative)
- **Update claude.md:** Add section, commit with story ID, push — loop continues

*Full playbooks: see SKILLS.md (to be created)*

## The Beverly Thursday Study

- **Hypothesis:** Recurring community events with anonymous engagement tracking generate actionable behavioral data that improves local experiences, proves sponsor ROI, and produces research-grade longitudinal datasets — without collecting PII
- **Control period:** April 9 – June 2026. Every Thursday. Written into claude.md weekly. Qualitative observations only — no tech deployed. This is the baseline.
- **Methodology:** Zero-PII anonymous QR engagement tracking. Temporal bucketing. k-anonymity enforcement. Governor-governed sponsor visibility.
- **Baseline observations:** To be documented weekly starting April 9
- **Experiment start conditions:** Control period complete. OSE platform deployed. First anonymous QR scans at a Beverly OurRecNight.

## Vertical experiments

- **OurRecNights hypothesis:** Parks + recreation community events generate predictable behavioral patterns that correlate with local economic activity
- **OurRecordNights hypothesis:** Music community behavior at record nights produces distinct engagement signatures differentiable from other verticals
- **OurMagnets hypothesis:** Retail foot traffic patterns captured via anonymous QR engagement correlate with local economic indicators
- **Geographic cell definitions:** Each venue/neighborhood is a geographic cell. Cells aggregate into corridors. Corridors form the basis of the 20-year longitudinal dataset.

## Privacy legal stages — progress

| Stage | Status |
|-------|--------|
| LLC filing | NOT DONE — $150, ilsos.gov, non-negotiable |
| BIPA attorney opinion | NOT DONE — must complete before April 9 ($500-$1,500) |
| Blackboard Covenant as BIPA consent | Pending attorney review |
| Privacy Bill of Rights | Blocked by 12 compliance requirements (5 CRITICAL, 0 met) |
| Tongue removal verification (R2) | PARTIAL — can advance via code audit |
| Marketing language audit (R5) | NOT MET |
| NCD gap closure (R12) | NOT MET |

## Academic partner pipeline

- Target: one university partner signs Data Use Agreement (DUA)
- Value prop: privacy-safe behavioral data with k-anonymity, no PII, longitudinal
- Beverly study is the proof-of-concept dataset
- Geographic Counter-Data Doctrine positions data for alderman/policy conversations

## Long-term research questions

- How do recurring community events affect local economic activity over 5/10/20 years?
- What behavioral patterns emerge from anonymous engagement data across verticals?
- Can hyperlocal community health indicators be derived from anonymized event participation?
- Does governor-governed sponsor visibility increase local business trust and retention?
- What is the relationship between community event density and neighborhood economic resilience?

## Conventions

- Commit messages include story ID: `feat: add health endpoint (P1-1)`
- API endpoints under `/api/v2/`
- Admin routes require Bearer token auth (Phase 1) → Firebase Auth (Phase 3)
- Keep Worker bundle lean — HTML templates will move to Firebase Hosting CDN

## Key docs

- `E2E-LAUNCH.md` — Step-by-step launch checklist
- `API_CONTRACT.md` — API contracts and endpoints
- `DEPLOYMENT.md` — Deployment strategy
- `openapi.yaml` — OpenAPI spec
- `gaming_compression_governor_spec.md` — Governor state machine, pricing, legal disclosure
- `anonymous_id_application_spec.md` — 5-layer privacy stack
- `compliance_check_anonymous_architecture.md` — 12 compliance requirements tracker
