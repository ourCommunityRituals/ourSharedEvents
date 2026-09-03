# 0-architecture/ — Platform Contract Enforcement Layer

> These rules apply to the triangle itself, not to any specific entity.

## The Triangle

```
Sponsor → Event ← Customer
              │
        SharedReport
```

Any entity that plugs into any corner of the triangle inherits the invariant
wrapper. Travel partner, faith organization, university research node, healthcare
clinic, small business collective — the wrapper enforces HOW entities participate,
not WHAT they are.

## Invariants in this suite

The 0-architecture suite is the runtime mirror of the brain canonical at
`OCR-docs/ocr-docs-brain/architectural-invariants.yaml`. Every spec below is
wired: `structural` specs are named in the T0 Gate `invariants` shard of
`.github/workflows/oursharedevents-ci.yml` (every PR/push); `runtime` specs run
in T4a against deployed staging. Rows marked **unregistered** are OSE gates that
have no brain entry yet (spoke-ahead-of-brain — tracked in
`OCR-docs/docs/OCR_VISION.md` §10). Brain entries whose OSE artifact lives
outside this folder: #14 (`tests/playwright/mobile-workability.spec.ts`),
#22 (`scripts/check-cross-repo-imports.sh`), #23 (`tests/red-team/`),
#24 (`tests/audit-layer.spec.ts` — not yet written).

| Brain #        | Invariant                                       | Test file                                    | Kind       |
| -------------- | ----------------------------------------------- | -------------------------------------------- | ---------- |
| #7 (partial)   | Aggregate-Only Reporting                        | `aggregate-only.invariant.spec.ts`           | structural |
| #1 (live)      | Anonymous ID                                    | `anonymous-id.invariant.spec.ts`             | runtime    |
| #16 (live)     | API Response Schema Stability                   | `api-response-schema.invariant.spec.ts`      | structural |
| #15 (live)     | CORS Allowlist Immutability                     | `cors-allowlist.invariant.spec.ts`           | structural |
| — unregistered | Cost metric never-who (COST-301)                | `cost-metric-never-who.invariant.spec.ts`    | structural |
| #10 (live)     | Deprecation Lock                                | `deprecation-lock.invariant.spec.ts`         | structural |
| — unregistered | Edge token cryptographic verification (OSE-573) | `edge-token-verification.invariant.spec.ts`  | structural |
| #2 (live)      | Hyperlocal Geo-Resolution                       | `geo-resolution.invariant.spec.ts`           | runtime    |
| #19 (live)     | Migration Monotonicity                          | `migration-monotonicity.invariant.spec.ts`   | structural |
| #6 (live)      | Inert Monetization Hooks                        | `monetization-inert.invariant.spec.ts`       | structural |
| #4 (live)      | NCR Data Accumulation                           | `ncr-accumulation.invariant.spec.ts`         | runtime    |
| #17 (live)     | OER Emission Boundary                           | `oer-emission-boundary.invariant.spec.ts`    | structural |
| #8 (live)      | Bounded PII Retention                           | `pii-retention.invariant.spec.ts`            | structural |
| — unregistered | Runtime stays LLM-free (COST-101)               | `runtime-llm-free.invariant.spec.ts`         | structural |
| — unregistered | Split scan path — placement ⟂ session           | `scan-path-split.invariant.spec.ts`          | structural |
| #21 (live)     | SharedReport Schema Stability                   | `shared-report-schema.invariant.spec.ts`     | structural |
| #18 (live)     | QR Code URL / Slug Permanence                   | `slug-permanence.invariant.spec.ts`          | structural |
| — unregistered | Split sponsor identity (OSE-799)                | `sponsor-identity-split.invariant.spec.ts`   | structural |
| #25 (live)     | Sponsor Share Covenant                          | `sponsor-share-covenant.invariant.spec.ts`   | structural |
| — unregistered | Sponsor signal never-who (OSE-1164)             | `sponsor-signal-never-who.invariant.spec.ts` | structural |
| #9 (partial)   | Tenant Isolation                                | `tenant-isolation.invariant.spec.ts`         | structural |
| #5 (partial)   | Local Sponsor Covenant                          | `tier-equity.invariant.spec.ts`              | structural |
| #3 (live)      | Universal Event Code Standard                   | `uec-codes.invariant.spec.ts`                | runtime    |
| — unregistered | Worker-scoped CLAUDE.md boundary (COST-403)     | `worker-claude-md.invariant.spec.ts`         | structural |

_Generated 2026-09-03 from the registry (25 entries) and the CI file list: 24 specs, 20 structural / 4 runtime._

## Structural vs runtime — and where each runs in CI (OSE-350)

The suite has two kinds of spec, and they run at different points in the flow:

- **`structural`** — reads source files via `node:fs` and asserts load-bearing
  code shape. Needs **no deployed worker**. Runs in **T0 Gate, `invariants`
  shard — on EVERY PR + push**. This is the invariant-enforcement-continuity
  guarantee: the brain's architectural contracts are checked on every change.
- **`runtime`** — exercises a deployed worker (`page.goto`, HTTP requests).
  Needs staging up. Runs in **T4 Functional** (and is a candidate for T2 Smoke
  post-deploy — see follow-on).

**Why this split exists:** before OSE-350 the _whole_ suite ran only in
dispatch-only T4 Functional, so the "CI-enforced contracts" were not enforced
on normal development — a PR could break an invariant's code shape and nothing
caught it. OSE-350 wired the structural subset into T0 Gate.

**The continuity is self-policing.** The T0 `invariants` shard lists the
structural spec files explicitly. `tests/integration/infra-consistency.test.js`
contains a placement guard that classifies every spec in this folder
structural-vs-runtime and asserts each structural one is in that T0 list — so a
new structural invariant that isn't wired into the flow fails CI.

## Run

```bash
# Full suite (needs staging up for the runtime specs):
npx playwright test --config=playwright.e2e-smoke.config.ts tests/e2e/0-architecture/

# Structural subset only (no worker needed — what T0 Gate runs). The
# authoritative file list is the "Architecture: structural invariants" step
# in .github/workflows/oursharedevents-ci.yml; e.g.:
npx playwright test --config=playwright.e2e-smoke.config.ts \
  tests/e2e/0-architecture/deprecation-lock.invariant.spec.ts \
  tests/e2e/0-architecture/pii-retention.invariant.spec.ts \
  tests/e2e/0-architecture/tier-equity.invariant.spec.ts
```

## Design Principle

These tests are **entity-agnostic**. They don't test "does sponsor X render on
display Y." They test "does the platform enforce anonymous presence counting when
ANY entity participates in the triangle." A new product personality (OurWKRP,
OurOpenTable, OurSharedGames) must pass these same invariants to plug in.

## What the structural specs assert

The `structural` specs read source files from disk via `node:fs` (Playwright
runs with Node-tier filesystem access) and assert:

1. The mechanism's **files still exist** — deletion = failure.
2. The mechanism's **load-bearing code shape** is intact — e.g., the covenant
   allocator keeps the local share-of-voice floor (#5/#25), no migration
   mutates the `slug` column (#18), the cost-metric emitter only carries the
   sealed allowlist of aggregate fields (never-who). (The runner-verifier and
   janitor examples that used to sit here belonged to #11/#12, retired in
   OSE-1194.)
3. Wherever the mechanism depends on **CI wiring**, the workflow file actually
   invokes the script — a guard that lives in `scripts/` but is never invoked
   is theater. The deprecation-lock spec is the canonical example.

The `runtime` specs instead exercise a deployed worker (HTTP requests, page
navigation) — they verify behavior, not code shape, and so they run
post-deploy rather than in T0 Gate.

This is the brain-substrate alignment surface: brain says "the contract is X,"
the substrate ships the mechanism, and these specs assert the mechanism's
load-bearing shape so a future refactor can't silently break it.
