# CLAUDE.md — Worker scope: `workers/oursharedevents/`

> **Scope guard.** This is the **worker-local** brain for the OSE Cloudflare
> Worker. The repo-wide contract is `../../AGENTS.md` (invariants, approvals,
> Definition of Done); product context is in `../../docs/brain/`. Read this file
> for the worker's hard boundaries. Added under COST-403 / OSE-785.

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
- **Admin writes come from the admin site, as JSON:** one guard in `router.ts`
  (`lib/admin-write-guard.ts`) runs ahead of every admin route. A request that is
  not GET/HEAD/OPTIONS on an admin path must be same-origin (`Sec-Fetch-Site`, or
  `Origin` for an older browser) or carry an automation key header, and a body
  must be `application/json`. A new admin route needs no code for this. In a test,
  an email actor that writes needs `'Sec-Fetch-Site': 'same-origin'`. Gate:
  `tests/admin-write-guard.derived.spec.ts` reads the routes out of the router.

## Tests & "done"

- Worker specs: `tests/**/*.spec.ts`. Runtime-bound specs (`SELF.fetch`, `env.DB`,
  DO/KV/R2) run in the **workers** pool (`cloudflare:test` / miniflare — source
  reaches them via bundled `env.*_JSON`, not node `fs`). Pure-logic / static-source
  specs run in the fast **node** project (listed in `vitest.node-specs.mjs`; the
  node project loads `.html` as Text to match the worker bundle). Migration between
  pools is explicit-list + assertion-reviewed + run-green, never a broad testMatch
  (OSE-946); `scripts/vitest-projects-partition.mjs` (in this folder) asserts every
  spec runs in exactly one project, and `node scripts/triage-vitest-pool.mjs --check`
  (repo root, `../../scripts/`) guards the manifest in the T0 Gate `lint` shard.
- CI runs the suite as `--shard=i/N` slices cut by measured time, not file count
  (`vitest.sequencer.mjs` → `vitest-shard-plan.mjs`, times in
  `vitest-shard-durations.json`). A new spec gets its project's median until the
  times are refreshed with `node ../../scripts/vitest-shard-durations.mjs`;
  `tests/integration/vitest-shard-plan.test.js` fails once over 15% are unmeasured.
- Structural architecture invariants live at repo-root
  `tests/e2e/0-architecture/*.invariant.spec.ts` and gate **every** PR/push via
  the T0 Gate `invariants` shard (OSE-350). A new structural invariant spec
  must be listed in that step (enforced by `tests/integration/infra-consistency.test.js`).
- **Merged vs Done:** see `../../AGENTS.md`, "Definition of Done: two stages"
  (OSE-1443). That is the only definition, so don't restate it here. A green
  local `tsc`/vitest run counts as neither.

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

- Repo contract → `../../AGENTS.md`; product context → `../../docs/brain/PRODUCT.md`;
  role current states → `../../docs/brain/ROLE-STATE.md`.
- Work queue → Linear (team OSE); `../../STORIES.md` is historical.
- Security baselines, threat ledger, CONFORMANCE → `docs/security/`.
