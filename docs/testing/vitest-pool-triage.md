# Vitest pool triage — node vs workerd (OSE-946, child 1)

> **Status:** manifest / measurement artifact. This is the **prerequisite** for the
> OSE-946 reshape (split the worker vitest suite into a fast **node** project and a
> small **workerd** project). It classifies where each spec _could_ run; it does
> **not** move anything. Relocation is child 3 and is gated by the review rule below.

## Why this exists

Every spec under `workers/oursharedevents/tests/**/*.spec.ts` runs in one
`@cloudflare/vitest-pool-workers` (miniflare/workerd) pool. Loading the pyramid's
_base_ (pure-logic / static-source gates) into the _integration_ runtime is what
drives the OSE-696 teardown flake and forces `maxWorkers:1` +
`max-parallel:1`. The cure is to put each spec in the cheapest runtime that still
proves what it proves. This manifest is the auditable map of which is which.

## How it's produced

`node scripts/triage-vitest-pool.mjs` — a **static** classifier (reads source,
never runs tests, deterministic). `--check` fails if the committed JSON is stale,
so the map can't silently drift from the specs (child 5 reuses this as the
coverage-parity gate). The machine artifact is
[`vitest-pool-triage.json`](./vitest-pool-triage.json).

## Buckets

| Bucket                  | Rule                                                                                                                                                 | Meaning                                                                                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **workerd**             | a hard runtime marker matched (`SELF.fetch`, `env.DB`/`env.FORMS_DB`, KV/R2, DO helpers, `createExecutionContext`, `applyD1Migrations`, `fetchMock`) | Proven runtime coupling — **stays** in the workers pool. Markers are matched comment-stripped; a stray match only over-classifies _toward_ workerd (safe).                                                                                          |
| **node** (clean)        | no `cloudflare:test` import at all                                                                                                                   | Pure logic / pure Node — runs in the node project as-is.                                                                                                                                                                                            |
| **node** (needs-review) | imports `cloudflare:test` for `env` only, no runtime marker                                                                                          | Almost always a static-source / config gate that is node-able once its source is fed via `fs` instead of the miniflare `env.*_JSON` binding — **auto-suggested `node`, flagged for human confirmation** (PO decision: auto-classify + flag review). |

## Current measurement

<!-- The JSON no longer stores totals (they made every pull request conflict on
the same lines). `node scripts/triage-vitest-pool.mjs` prints the current ones.
The table below is the 2026-09-14 measurement and is not kept current. -->

|                             | count |
| --------------------------- | ----- |
| total specs                 | 219   |
| total test cases            | 2,661 |
| **workerd** (must stay)     | 116   |
| **node** (relocatable)      | 103   |
| — of which **needs-review** | 55    |

Target realized by the reshape: ~103 specs leave the miniflare pool for a
parallel node project (seconds, zero teardown flake); the workers pool shrinks to
~116 and can restore `maxWorkers`/`max-parallel`.

## ⚠️ The classification is a MAP, not authorization to bulk-move

This classifier is **file-level**. File-level is not sufficient to relocate a
spec — only an **assertion-level** read is. The canonical trap:
`tests/e2e/2-pages/poster-qr-layout.spec.ts` navigates to the absolute URL
`http://poster.test/poster`, so it ignores `baseURL` entirely; a file-level pass
would call it portable, but moving it would let it go green while no longer
testing what it was written for — **a false green manufactured by the migration
itself**. (That spec is in the Playwright tier, out of this population — it is the
worked example, not an entry here.)

**Therefore, child-3 relocation rules:**

1. Move specs in **explicit CLI file lists**, one reviewed batch at a time — never
   flip the config to a broad `testMatch`/`include`.
2. Each moved spec gets an assertion-level read first: does every assertion still
   bind to the same behavior under the node runtime?
3. `needs-review` entries are **suggestions**; a human confirms each before it moves.
4. The lower tier must be a **required check** before relocation counts — moving
   risk down only helps if the node shard can block a merge (see OSE-946 child 4/5).

## Scope — what this manifest does NOT cover

The workers vitest pool is one axis. Two adjacent populations are **out of scope
here** and governed elsewhere:

- **Runtime architecture invariants** — `tests/e2e/0-architecture/*.invariant.spec.ts`
  (e.g. `anonymous-id`, `geo-resolution`, `ncr-accumulation`, `uec-*`). These need a
  deployed worker by design and are **meta-test-protected**:
  `tests/integration/infra-consistency.test.js` fails CI if a structural spec isn't
  wired into the T0 `invariants` step or a runtime one is moved down. It will (correctly)
  fight relocation attempts.
- **Playwright E2E / component tier** — `tests/e2e/**` (the `poster-qr-layout`
  trap above lives here). Its own "cheapest runtime" reshape is OSE-1071
  (component/viewport tests). Related hardening surfaced alongside this work:
  the component step should route through `scripts/pw-guarded.sh` (it currently
  calls `npx playwright test` directly, so a path outside `testDir` discovers zero
  tests and exits green), and the CI `playwright install` step must include
  `webkit` (declared-but-not-installed) so a WebKit-expecting spec fails on a named
  project rather than silently reducing coverage.

## Child chain (OSE-946)

1. **Triage manifest (this) — done when merged.**
2. Dual vitest projects (node + workers).
3. Migrate the node-able specs — explicit CLI batches, assertion-level review.
4. Slim workers project + restore parallelism; soften `vitest-retry`.
5. CI wiring + coverage-parity gate (`triage-vitest-pool.mjs --check` + count parity).
