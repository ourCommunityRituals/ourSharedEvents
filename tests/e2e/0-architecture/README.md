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

## Four Invariants

| #   | Invariant                  | Test File                            | Enforces                                                                                  |
| --- | -------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1   | Anonymous ID               | `anonymous-id.invariant.spec.ts`     | Zero-PII scan system, two-database separation, cookie contract, no cross-linking          |
| 2   | Hyper-local Geo-Resolution | `geo-resolution.invariant.spec.ts`   | sponsor_areas + sponsor_event_types, corridor-level resolution, zip+radius matching       |
| 3   | UEC Encoding               | `uec-codes.invariant.spec.ts`        | 7 color-semantic QR codes, Blue=#1A3A8A for SPONSOR, URL path semantics                   |
| 4   | NCR Data Accumulation      | `ncr-accumulation.invariant.spec.ts` | poster_deployments lat/lng, scan_aggregates pipeline, permanent storage (no PII = no TTL) |

## Run

```bash
npx playwright test --config=playwright.e2e-smoke.config.ts tests/e2e/0-architecture/
```

## Design Principle

These tests are **entity-agnostic**. They don't test "does sponsor X render on
display Y." They test "does the platform enforce anonymous presence counting when
ANY entity participates in the triangle." A new product personality (OurWKRP,
OurOpenTable, OurSharedGames) must pass these same invariants to plug in.
