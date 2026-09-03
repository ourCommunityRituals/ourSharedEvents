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
├── router.ts       # route table (≈75 method+path pairs + surface aliases; header comment is canonical)
├── auth/           # admin guard (CF Access JWT + Bearer fallback)
├── handlers/       # 30 files: health, events, pages, forms, form-pages, feature-flags,
│                   #   sponsors*, poster-*, qr-*, uec-resolve, shortlink-resolve,
│                   #   shared-report-*, event-stats, portfolio-rollup, upload, bigquery,
│                   #   audit, data-subject, privacy, briefing, demo, subscribers, geocode
├── lib/            # forms-db (hash/encrypt/bucket), feature-flags, cors,
│                   #   ai-sanitization.ts  ← the ONLY sanctioned AI seam
├── domain/ google/ cloud/ templates/   # domain logic, integrations, HTML
```

Config: `wrangler.toml`, `vitest.config.mts` (+ `vitest.config.a11y.mts`),
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

- Worker specs: `tests/**/*.spec.ts` (vitest, `cloudflare:test` / miniflare
  pool — source files reach tests via bundled `env.*_JSON`, not node `fs`).
- Structural architecture invariants live at repo-root
  `tests/e2e/0-architecture/*.invariant.spec.ts` and gate **every** PR/push via
  the T0 Gate `invariants` shard (OSE-350). A new structural invariant spec
  must be listed in that step (enforced by `tests/integration/infra-consistency.test.js`).
- **Done = merged to `main` AND exercised by a named CI job.** A green local
  `tsc`/vitest run is not done. If you can't name the CI job that goes red on
  regression, it's written, not done. (See root `CLAUDE.md` §7.2–7.3;
  every PR needs `Closes OSE-###` for the traceability gate.)

## Where the rest lives

- Product/company context, scrum POVs, roadmap → root `../../CLAUDE.md`.
- Work queue → root `../../STORIES.md`.
- Security baselines, threat ledger, CONFORMANCE → `docs/security/`.
