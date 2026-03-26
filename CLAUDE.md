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
