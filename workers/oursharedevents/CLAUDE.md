# CLAUDE.md — Worker scope: `workers/oursharedevents/`

> **Scope guard.** This is the **worker-local** brain for the OSE Cloudflare
> Worker. The full product/company context (phases, scrum POVs, roadmap,
> ecosystem) lives in the **repo-root** `../../CLAUDE.md` — do **not** load that
> 300+-line product file for worker-level ops. Read this file for the worker's
> hard boundaries; reach for the root file only when you need product context.
> Added under COST-403 / OSE-785 (Cost Sustainability — Hygiene) to stop the
> worker inheriting the whole product file by default.

---

## What this worker is

Deterministic Cloudflare Worker + D1 (edge SQLite) serving the OSE surfaces
(public event page, admin, poster/QR, display, SharedReport) and the forms
system. Served-user operations are plain Workers compute — **no model tokens on
any request path** (see the hot-path ban below).

## Source map

```
src/
├── index.ts        # fetch entry + scheduled PII-lifecycle job; cost-metric seam
├── router.ts       # route table (30+ endpoints)
├── auth/           # admin guard (CF Access JWT + Bearer fallback)
├── handlers/       # health, events, pages, forms, form-pages, feature-flags
├── lib/            # forms-db (hash/encrypt/bucket), feature-flags, cors,
│                   #   ai-sanitization.ts  ← the ONLY sanctioned AI seam
├── domain/ google/ cloud/ templates/   # domain logic, integrations, HTML
```

Config: `wrangler.toml`; vitest is a **projects root** (`vitest.config.mts`, OSE-946)
over two projects — the `workers` pool (`vitest.workers.config.mts`, miniflare/workerd)
and a fast parallel `node` project (`vitest.node.config.mts`); the shared spec list
`vitest.node-specs.mjs` is what the node project INCLUDES and the workers project
EXCLUDES (one project per spec). a11y stays separate (`vitest.config.a11y.mts`).
`migrations/` (main DB) and `migrations-forms/` (FORMS_DB).

## Hot-path import bans (load-bearing — do not break)

The free-forever promise is structurally sustainable **only while runtime stays
LLM-free**: served-user operations cost ~0 model tokens, so cost scales with
cheap deterministic primitives, never per-operation token metering (COST-101).

- **No model-provider SDK import** anywhere under `src/`:
  `@anthropic-ai/sdk`, `openai`, `cohere`, `mistral`, `gemini`, `groq`,
  `replicate`, `langchain`, `ollama` (or similar).
- **No model-provider base URL** in a runtime `fetch()` (`api.anthropic.com`,
  `api.openai.com`, …).
- The **single sanctioned AI seam** is `src/lib/ai-sanitization.ts` — dormant,
  the only allowlisted file, reviewed before any wiring (COST-102, ADR-014,
  CODEOWNERS-locked). A future AI feature enters **only** through it.

Enforced by `tests/e2e/0-architecture/runtime-llm-free.invariant.spec.ts` (COST-101),
run in the T0 Gate `invariants` shard on every PR/push. Adding a banned import
turns CI red — a ~0-token operation cannot silently become token-metered.

## Other worker boundaries

- **Two-DB isolation:** `DB` = anonymous public surface (events, sponsors,
  scans, poster deployments, audit log); `FORMS_DB` = identified-user surface
  (registrations, check-ins, surveys, email signups, feature flags, PII audit).
  A handler must never reach across this line. Gate: `tests/architecture.spec.ts`.
- **Cost metric is aggregate-only / never-who:** the `OPERATION_COST` line
  (`src/lib/cost-metric.ts`, emitted at the `index.ts` fetch seam) carries no
  user/slug/QR-token/id identity. Do not add identifying fields. Gate:
  `tests/e2e/0-architecture/cost-metric-never-who.invariant.spec.ts` (COST-301).
- **PII:** encrypt/scrub in `lib/forms-db.ts`; retention lifecycle in `index.ts`.

## Tests & "done"

- Worker specs: `tests/**/*.spec.ts`. Runtime-bound specs (`SELF.fetch`, `env.DB`,
  DO/KV/R2) run in the **workers** pool (`cloudflare:test` / miniflare — source
  reaches them via bundled `env.*_JSON`, not node `fs`). Pure-logic / static-source
  specs run in the fast **node** project (listed in `vitest.node-specs.mjs`; the
  node project loads `.html` as Text to match the worker bundle). Migration between
  pools is explicit-list + assertion-reviewed + run-green, never a broad testMatch
  (OSE-946); `scripts/vitest-projects-partition.mjs` asserts every spec runs in
  exactly one project, `scripts/triage-vitest-pool.mjs --check` guards the manifest.
- Structural architecture invariants live at repo-root
  `tests/e2e/0-architecture/*.invariant.spec.ts` and gate **every** PR/push via
  the T0 Gate `invariants` shard (OSE-350). A new structural invariant spec
  must be listed in that step (enforced by `tests/integration/infra-consistency.test.js`).
- **Done = merged to `main` AND exercised by a named CI job.** A green local
  `tsc`/vitest run is not done. If you can't name the CI job that goes red on
  regression, it's written, not done. (See root `CLAUDE.md` §7.2–7.3.)

### Branch & PR conventions — Linear close-guard (OSE-1250)

Linear auto-transitions a story to **Done** on PR merge when the issue id is in
the **branch name** or **PR title** (closing-link channels that fire regardless
of the PR body). This silently closed multi-part stories 3× in one day
(OSE-1071/946/1172) — see OSE-1250. The rule, enforced by
`.github/workflows/pr-linear-close-guard.yml` (logic in
`scripts/check-pr-linear-close.mjs`, self-tested in CI):

- **Slice PR** (one part of a multi-part story): use a branch name and title with
  **no** `OSE-###` id; reference the story via a **non-closing** magic word in the
  body — `Part of OSE-###` (also: `Ref`, `Contributes to`, `Towards`). This links
  for traceability WITHOUT auto-closing on merge.
- **Completing PR** (finishes the story): put `Closes OSE-###` in the body. An id
  in the branch/title is then fine — the auto-close is intentional and declared.
- The guard **fails** any PR that has an `OSE-###` id in its branch/title but no
  matching `Closes OSE-###` in the body (an undeclared auto-close). It is the real
  traceability gate — earlier revisions of this file claimed one that did not
  exist (drift now closed).
- **Prose and commit messages count too (OSE-1443).** Linear reads magic words
  anywhere in the body, prose included. #701 said `Part of OSE-867` but also
  "before closing OSE-867", and OSE-867 closed on merge. The guard fails an id
  that the body both calls `Part of` and puts a closing word in front of. A squash
  merge also copies every commit message onto `main`, so the guard fails any PR
  where a commit message closes an id that the body does not. To fix it, reword
  the prose or the commit.

## Where the rest lives

- Product/company context, scrum POVs, roadmap → root `../../CLAUDE.md`.
- Work queue → root `../../STORIES.md`.
- Security baselines, threat ledger, CONFORMANCE → `docs/security/`.
