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
`OCR-docs/ocr-docs-brain/architectural-invariants.yaml`. Each row below is one
brain-listed invariant whose enforcement mechanism has shipped + has a
dedicated test file here. Brain invariants whose mechanisms are still
unshipped (currently 6, 7, 9) do not yet have a row.

| #   | Invariant                            | Test File                                 | Kind       | Enforces                                                                                                                                                  |
| --- | ------------------------------------ | ----------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Anonymous ID                         | `anonymous-id.invariant.spec.ts`          | runtime    | Zero-PII scan system, two-database separation, cookie contract, no cross-linking                                                                          |
| 2   | Hyper-local Geo-Resolution           | `geo-resolution.invariant.spec.ts`        | runtime    | sponsor_areas + sponsor_event_types, corridor-level resolution, zip+radius matching                                                                       |
| 3   | UEC Encoding                         | `uec-codes.invariant.spec.ts`             | runtime    | 7 color-semantic QR codes, Blue=#1A3A8A for SPONSOR, URL path semantics                                                                                   |
| 4   | NCR Data Accumulation                | `ncr-accumulation.invariant.spec.ts`      | runtime    | poster_deployments lat/lng, scan_aggregates pipeline, permanent storage (no PII = no TTL)                                                                 |
| 5   | Tier Equity / Local Sponsor Covenant | `tier-equity.invariant.spec.ts`           | structural | Local sponsors take display-priority over non-local at every tier. tierSort() compares is_local BEFORE TIER_PRIORITY. Migration 0036 + ADR-013.           |
| 8   | Bounded PII Retention                | `pii-retention.invariant.spec.ts`         | structural | Daily lifecycle cron deletes/scrubs PII keyed by TTL columns. Every PII-bearing table has a phase; every phase writes pii_audit_log on success AND error. |
| 10  | Deprecation Lock                     | `deprecation-lock.invariant.spec.ts`      | structural | Once a runtime is removed (today: GAS), CI forbids reintroduction. `scripts/guard-no-gas.js` is wired into the lint shard of `oursharedevents-ci`.        |
| 11  | Self-Hosted Runner Bash Resolution   | `runner-environment.invariant.spec.ts`    | structural | On Windows self-hosted runners, `bash` MUST resolve to Git Bash not WSL. `runner-env-validation.yml` enforces per-PR.                                     |
| 12  | Runner Pool Readiness                | `runner-pool-readiness.invariant.spec.ts` | structural | Probe + watchdog mechanism: 1-min readiness probe, 5-min heartbeat watchdog, circuit-breaker, pool-wide outage suppression.                               |

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

# Structural subset only (no worker needed — what T0 Gate runs):
npx playwright test --config=playwright.e2e-smoke.config.ts \
  tests/e2e/0-architecture/deprecation-lock.invariant.spec.ts \
  tests/e2e/0-architecture/pii-retention.invariant.spec.ts \
  tests/e2e/0-architecture/runner-environment.invariant.spec.ts \
  tests/e2e/0-architecture/runner-pool-readiness.invariant.spec.ts \
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
2. The mechanism's **load-bearing code shape** is intact — e.g., `tierSort()`
   compares `is_local` before `TIER_PRIORITY`, the runner verifier still
   detects `WindowsApps` paths as WSL bash, the janitor still emits
   `RUNNER_POOL_DEGRADED` for circuit-breaker trips.
3. Wherever the mechanism depends on **CI wiring**, the workflow file actually
   invokes the script — a guard that lives in `scripts/` but is never invoked
   is theater. The deprecation-lock spec is the canonical example.

The `runtime` specs instead exercise a deployed worker (HTTP requests, page
navigation) — they verify behavior, not code shape, and so they run
post-deploy rather than in T0 Gate.

This is the brain-substrate alignment surface: brain says "the contract is X,"
the substrate ships the mechanism, and these specs assert the mechanism's
load-bearing shape so a future refactor can't silently break it.
