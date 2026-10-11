# AGENTS.md: OurSharedEvents (OSE)

The operating contract for every coding agent in this repo (Claude Code, Copilot, Codex, others) and for people. It holds what stays true; history and status live elsewhere (see "Where things live"). Keep it under 12 KB: `tests/integration/agent-instructions-budget.test.js` fails above that.

OSE is one product in the OurCommunityRituals (OCR) line: event infrastructure, API and admin. The org vision is `OCR-docs/docs/VISION.md`; this file governs OSE only.

## Sources of truth

- **Code and tests are the system of record.** Linear, STORIES.md and docs can lag. Before calling anything done or broken, find direct source + test evidence (reconciliation rule, 2026-09-22).
- **ADRs are the rationale** (`docs/adr/`). Read the ADR for intent, then check the code. If they differ, update or supersede the ADR in the same change (`docs/adr/ADR-RECONCILIATION-PROCESS.md`).
- The canonical route list is the header of `workers/oursharedevents/src/router.ts`; the canonical schema is `workers/oursharedevents/migrations/` (DB) + `migrations-forms/` (FORMS_DB).

## Architecture

- One Cloudflare Worker + D1 (`workers/oursharedevents/`). Surfaces: admin, public event page, `/events`, display (TV), poster, SharedReport, sponsor home, form pages. Templates are Wrangler text modules served with per-request CSP nonces.
- **Two databases, never crossed:** `DB` is the anonymous public side (events, sponsors, scans, audit log); `FORMS_DB` is the identified side (registrations, check-ins, surveys, email sign-ups, flags, PII audit). Gate: `tests/architecture.spec.ts`.
- **Runtime is LLM-free:** no model-provider SDK or API URL under `src/`. The only sanctioned AI seam is `src/lib/ai-sanitization.ts` (dormant, CODEOWNERS-locked). Gate: `runtime-llm-free.invariant.spec.ts`.
- Admin auth: Cloudflare Access JWT (JWKS-verified) + allowlist; key fallbacks are env-gated. Every non-GET admin request passes `lib/admin-write-guard.ts` (same-origin or key actor, JSON body only). In a worker test, an email actor that writes sends `'Sec-Fetch-Site': 'same-origin'`.
- Public reads are rate-limited at the route (`lib/public-read-limit.ts`); public event responses are an allowlist (`lib/public-event-projection.ts`), never a spread of the row.
- `@ocr/ui` lives in the hub repo and is pinned by `.ocr-hub-ref`; stage it with `scripts/ci-stage-ocr-workspace.sh`. Never pin hub `main`.

## Invariants (owner decisions; do not reopen)

1. **Never who, only how many.** Publish counts, never identities. Presenters who opt in are the only exception.
2. **The under-5 floor has no exceptions:** any published count below 5 is withheld, for a brand's own admin too and at every tier. Totals and rates use `lib/count-floor.ts` (`floorTotalOfParts`, `flooredRatePct`). A withheld count reads in words ("Fewer than 5"), never as 0.
3. **Place, not person:** location is H3 cell res 7 (the area a link was published into) or res 9 (a physical placement), never request geo or IP. Endpoints refuse coordinate-shaped input. No `CF-IP*` header is read.
4. **No cookies on public surfaces.** Geolocation picks what to show and is never stored.
5. **The display shows no counts.** The public check-in answer carries no count; counts are post-event.
6. **Sponsors need two-sided consent:** a sponsor shows only when it accepted and the organizer accepted; the one rule is `SPONSOR_ON_SHOW_SQL` in `lib/sponsor-card.ts`. On a page that shows an event title, the sponsor strip sits below the title and date and above the content and map.
7. **Security is never tier-gated:** audit, roles, isolation and retention are the same at every tier. Templates never gate; tiers gate features.
8. **Design system:** colours come from `packages/tokens` (hub) only. Never hardcode a hex in a page, never change colours in `packages/ui`. One `<h1>` per page; touch targets ≥ 44 px; input text ≥ 16 px.
9. **PII** is encrypted and scrubbed in `lib/forms-db.ts` / `lib/pii.ts`; forms tables store a per-event keyed id, never the raw anonymous id.

## Commands

Install: `npm ci` at the root and in `workers/oursharedevents/`. For a worktree, run `npm ci` in both folders; never symlink `node_modules`.

| What                                                           | Command                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Root unit, contract and integration tests                      | `npm test` (root)                                                                     |
| Worker tests, both projects                                    | `npm test` in `workers/oursharedevents` (`test:node`, `test:workers` for one project) |
| Lint                                                           | `npm run lint:ci` (zero warnings)                                                     |
| Architecture invariants                                        | `npx playwright test tests/e2e/0-architecture`                                        |
| Pool manifest (after adding a spec or changing a spec's count) | `node scripts/triage-vitest-pool.mjs --check`                                         |
| Local worker                                                   | `npm run dev` in `workers/oursharedevents`                                            |

On Windows, `git show <ref>:<path>` is mangled by Git Bash; use PowerShell for it.

## Quality gates

- **Born red:** every new test, check or gate is watched failing on an injected fault before it is trusted. A gate that cannot fail counts as absent.
- **Coverage is what CI runs.** A `tests/e2e/` or Playwright spec is coverage only if a workflow names it. A Bruno run is coverage only if its `test()` names print.
- Every case at two layers: the workers-pool mock layer and staging (Bruno / Playwright).
- A new structural invariant spec must be listed in the T0 `invariants` step (`tests/integration/infra-consistency.test.js` enforces it).
- Run lint and tests locally before pushing. Each push cancels the running OSE CI run, so batch review fixes into one push.

## Human approval (an agent never does these)

- **Production:** deploys go only through CI (tag or `deploy_production=PRODUCTION` dispatch). No workstation `wrangler deploy`, no remote D1 writes, no production changes.
- **Secrets:** never in chat or logs, never read from credential files; the owner sets them in their own terminal. A secret that reaches a transcript is rotated.
- **Repository controls:** branch protection, rulesets, runners, repo secrets and variables, `--admin` merges, force pushes.
- **Destructive data steps:** D1 Time Travel restores, deleting databases, buckets or namespaces (break-glass, runbook only).
- **Moving a story to Done** in Linear.

These are enforced on workstations by `.claude/hooks/policy-gate.mjs` and the owner's deny rules. **A model's confidence (a CCR score included) is a signal, never permission;** required checks and the PO are the authority.

## Definition of Done: two stages (OSE-1443)

| Stage      | Means                                                                                                                                                                     | Linear      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **Merged** | On `main`, levels 1–5 ran on the PR, and a named CI job goes red if it regresses                                                                                          | In Progress |
| **Done**   | Merged **and** the post-merge staging chain is green for the merge SHA (or a later `main` SHA containing it): T1 Deploy, T2 Contract (Bruno), T3 E2E Smoke, T4 Functional | Done        |

The full pyramid is required: security, lint, contract, unit, integration, API (Bruno on staging), E2E (Playwright). No partial pyramids. Check with `gh run list --workflow "OurSharedEvents CI/CD" --branch main --event push`, then `gh run view <id> --json jobs`.

## Pull requests (Linear close-guard)

- A merge never closes a story by itself. Use `Part of OSE-###` in the PR body; keep ids out of the branch name and title.
- Keep closing words (close, fix, resolve, complete, implement) away from ids in the body **and** in commit messages (a squash copies them to `main`). `scripts/check-pr-linear-close.mjs` fails a PR that breaks this.
- Only a PR that finishes a story says `Closes OSE-###`.
- Copilot-authored PRs wait for a human CI approval by design (ADR-020).

## Reviews: CCR

Assessments, readiness reviews and gating decisions use CCR (Critical, Conservative, Recursive): loops that run in order, a weighted score (`100 − Σ finding × 25/15/10/5/2`), a 95% gate, and a human gate below it. Security Critical findings get no partial credit. Worksheets go in `.claude/outputs/CCR-<topic>-<date>.md`. Protocol: `.claude/skills/ccr/SKILL.md` → `.claude/skills/ccr-protocol.md`.

## Where things live

| Need                                              | File                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| Role current states (what each role last changed) | `docs/brain/ROLE-STATE.md`                                        |
| Phases, brand motif (Triangle / Ring), ecosystem  | `docs/brain/PRODUCT.md`                                           |
| Story template                                    | `docs/brain/STORY-FORMAT.md`                                      |
| Worker boundaries and test pools                  | `workers/oursharedevents/CLAUDE.md`                               |
| Security baselines and threat ledger              | `docs/security/`                                                  |
| Runbooks (deploy, rollback, recovery)             | `docs/runbooks/`                                                  |
| Design system rules and mockups                   | hub `packages/ui/design-system/` (`HANDOFF.md`, then `README.md`) |
| Work queue                                        | Linear (team OSE); `STORIES.md` is historical                     |
