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
unshipped (currently 6, 7, 8, 9) do not yet have a row.

| #   | Invariant                            | Test File                                 | Enforces                                                                                                                                           |
| --- | ------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Anonymous ID                         | `anonymous-id.invariant.spec.ts`          | Zero-PII scan system, two-database separation, cookie contract, no cross-linking                                                                   |
| 2   | Hyper-local Geo-Resolution           | `geo-resolution.invariant.spec.ts`        | sponsor_areas + sponsor_event_types, corridor-level resolution, zip+radius matching                                                                |
| 3   | UEC Encoding                         | `uec-codes.invariant.spec.ts`             | 7 color-semantic QR codes, Blue=#1A3A8A for SPONSOR, URL path semantics                                                                            |
| 4   | NCR Data Accumulation                | `ncr-accumulation.invariant.spec.ts`      | poster_deployments lat/lng, scan_aggregates pipeline, permanent storage (no PII = no TTL)                                                          |
| 5   | Tier Equity / Local Sponsor Covenant | `tier-equity.invariant.spec.ts`           | Local sponsors take display-priority over non-local at every tier. tierSort() compares is_local BEFORE TIER_PRIORITY. Migration 0036 + ADR-013.    |
| 10  | Deprecation Lock                     | `deprecation-lock.invariant.spec.ts`      | Once a runtime is removed (today: GAS), CI forbids reintroduction. `scripts/guard-no-gas.js` is wired into the lint shard of `oursharedevents-ci`. |
| 11  | Self-Hosted Runner Bash Resolution   | `runner-environment.invariant.spec.ts`    | On Windows self-hosted runners, `bash` MUST resolve to Git Bash not WSL. `runner-env-validation.yml` enforces per-PR.                              |
| 12  | Runner Pool Readiness                | `runner-pool-readiness.invariant.spec.ts` | Probe + watchdog mechanism: 1-min readiness probe, 5-min heartbeat watchdog, circuit-breaker, pool-wide outage suppression.                        |

## Run

```bash
npx playwright test --config=playwright.e2e-smoke.config.ts tests/e2e/0-architecture/
```

## Design Principle

These tests are **entity-agnostic**. They don't test "does sponsor X render on
display Y." They test "does the platform enforce anonymous presence counting when
ANY entity participates in the triangle." A new product personality (OurWKRP,
OurOpenTable, OurSharedGames) must pass these same invariants to plug in.

## What is asserted, structurally

Every spec in this folder reads source files from disk via `node:fs` (Playwright
runs with Node-tier filesystem access) and asserts:

1. The mechanism's **files still exist** — deletion = failure.
2. The mechanism's **load-bearing code shape** is intact — e.g., `tierSort()`
   compares `is_local` before `TIER_PRIORITY`, the runner verifier still
   detects `WindowsApps` paths as WSL bash, the janitor still emits
   `RUNNER_POOL_DEGRADED` for circuit-breaker trips.
3. Wherever the mechanism depends on **CI wiring**, the workflow file actually
   invokes the script — a guard that lives in `scripts/` but is never invoked
   is theater. The deprecation-lock spec is the canonical example.

This is the brain-substrate alignment surface: brain says "the contract is X,"
the substrate ships the mechanism, and these specs assert the mechanism's
load-bearing shape so a future refactor can't silently break it.
