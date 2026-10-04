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
dedicated test file here. This table is narrative and is not exhaustive; the
authoritative, complete list is the **Gate index (generated)** at the bottom of
this file, derived from the brain YAML and this directory by
`scripts/check-invariant-registry.py` (OSE-1604). A brain invariant's current
status is the YAML's `status:` field, not anything written here.

| #   | Invariant                            | Test File                                       | Kind       | Enforces                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------ | ----------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Anonymous ID                         | `anonymous-id.invariant.spec.ts`                | runtime    | Zero-PII scan system, two-database separation, cookie contract, no cross-linking                                                                                                                                                                                                                                                                                                                                                          |
| 2   | Hyper-local Geo-Resolution           | `geo-resolution.invariant.spec.ts`              | runtime    | sponsor_areas + sponsor_event_types, corridor-level resolution, zip+radius matching                                                                                                                                                                                                                                                                                                                                                       |
| 3   | UEC Encoding                         | `uec-codes.invariant.spec.ts`                   | runtime    | 7 color-semantic QR codes, Blue=#1A3A8A for SPONSOR, URL path semantics                                                                                                                                                                                                                                                                                                                                                                   |
| 4   | NCR Data Accumulation                | `ncr-accumulation.invariant.spec.ts`            | runtime    | poster_deployments lat/lng, scan_aggregates pipeline, permanent storage (no PII = no TTL)                                                                                                                                                                                                                                                                                                                                                 |
| 5   | Tier Equity / Local Sponsor Covenant | `tier-equity.invariant.spec.ts`                 | structural | Local sponsors take display-priority over non-local at every tier. tierSort() compares is_local BEFORE TIER_PRIORITY. Migration 0036 + ADR-013.                                                                                                                                                                                                                                                                                           |
| 8   | Bounded PII Retention                | `pii-retention.invariant.spec.ts`               | structural | Daily lifecycle cron deletes/scrubs PII keyed by TTL columns. Every PII-bearing table has a phase; every phase writes pii_audit_log on success AND error.                                                                                                                                                                                                                                                                                 |
| 25  | Rendered-Surface Lexicon             | `rendered-surface-lexicon.invariant.spec.ts`    | structural | No count-claim or metric label on any rendered template / page handler uses banned lexicon (attendance, impressions, reach, unique, people, views…). Vocabulary read from `schema-lexicon.ts`; shared-report.html ratcheted (OSE-1204). Added OSE-1201.                                                                                                                                                                                   |
| 3   | UEC Poster Color (poster leg)        | `uec-poster-color.invariant.spec.ts`            | structural | poster-bundle prints every form QR in its UEC `scan_hex` (fgColor wired) and the card carries word + path + consent tier in text. Added OSE-1200.                                                                                                                                                                                                                                                                                         |
| 10  | Deprecation Lock                     | `deprecation-lock.invariant.spec.ts`            | structural | Once a runtime is removed (today: GAS), CI forbids reintroduction. `scripts/guard-no-gas.js` is wired into the lint shard of `oursharedevents-ci`.                                                                                                                                                                                                                                                                                        |
| 2   | Geo-Resolution (resolver leg)        | `geo-resolution.structural.invariant.spec.ts`   | structural | PR-gating code-shape lock for `sponsor-resolver.ts` + migrations 0019/0020/0021: Path 1 Direct (`sp.event_id = ?`), Path 2 Template+Geo (zip OR haversine radius), two-sided acceptance, business lifecycle, dedup. Runtime sibling runs T4. Added OSE-1298.                                                                                                                                                                              |
| 4   | NCR Accumulation (pipeline leg)      | `ncr-accumulation.structural.invariant.spec.ts` | structural | PR-gating code-shape lock for the scan→aggregate pipeline: poster lat/lng, hour-bucketed scans (no exact time), `scan_aggregates` written by exactly one scheduled writer + no TTL (permanent), impression surface+placement. Runtime sibling runs T4. Added OSE-1298.                                                                                                                                                                    |
| 3   | UEC Encoding (decode leg)            | `qr-decode-matrix.invariant.spec.ts`            | structural | Meta-gate over `workers/oursharedevents/tests/qr-roundtrip.spec.ts`, the jsQR decode of real encoder output (OSE-1127/1128). Fails if that spec is deleted, skipped/focused, stops asserting decoded == encoded, loses a locked L/M/Q/H × v1–v7 sweep case, leaves the workers pool, or CI stops running `npm test` in `worker-d1-schema` (whole, or as `--shard` slices that must be exactly 1/N..N/N). Added OSE-1439 (QR Path rung 4). |
| —   | CSP connect-src Same-Origin          | `csp-connect-src.invariant.spec.ts`             | structural | Derived: every `Content-Security-Policy` in worker `src/` (header literals + any `<meta http-equiv>`) has an effective connect-src of `'self'`/`'none'` only; a non-literal policy fails; `connect-src` may not be spelled outside an audited CSP literal. An external origin needs ADR + CCR + Dr-of-Security and an exemption entry.                                                                                                    |
| —   | Log Redaction                        | `log-redaction.invariant.spec.ts`               | structural | Derived: every `console.log/warn/error/info` call in worker `src/`, plus every derived log wrapper (a function that spreads its own parameter into a console call, e.g. `logFormEvent`), must not carry `anonId`, `anonymous_id`, `emailHash`, `email_hash`, `request.url` (only `new URL(request.url).pathname`), a `token:` key or `cookie`. Workers Logs are on. Zero exemptions.                                                      |
| —   | Workflow Script-Injection Lock       | `workflow-injection.invariant.spec.ts`          | structural | Derived: parses every `.github/workflows/*.yml` and `.github/actions/**/action.yml`; no step `run:` may contain `${{` with `github.event.*`, `inputs.*` or `github.head_ref` — such values go through the step `env:` as a quoted `"$VAR"`. Negative controls: workflows parsed, run steps found, detector flags each form. Added OSE-1470.                                                                                               |

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
  tests/e2e/0-architecture/rendered-surface-lexicon.invariant.spec.ts \
  tests/e2e/0-architecture/uec-poster-color.invariant.spec.ts \
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

---

## Gate shape: property or subject? (OSE-1246, audited 2026-09-05)

An invariant gate can assert its rule two ways, and only one of them survives a
refactor.

- **Property-asserting** — derives its subject list (scans a directory, parses
  the schema, reads `TEST_SOURCE_FILES_JSON`) and asserts the rule over
  everything it finds. A file added next month is covered the day it is written.
- **Subject-naming** — hardcodes a path or a function name. It enforces the rule
  on that subject and is blind to every other. It does not fail when it stops
  covering the invariant; it stays green.

**Both are legitimate.** Which is correct depends on whether the invariant is
about a _class_ of things or about _one specific artifact_.

### The audit

| Shape                                  | Gates                                                                                                                                                                                                                                                                            | Verdict |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Derives its subjects                   | csp-connect-src, log-redaction, sponsor-signal-never-who (client + click-out, since OSE-1166), migration-monotonicity, slug-permanence, rendered-surface-lexicon, runtime-llm-free, monetization-inert, scan-path-split, sponsor-identity-split, tenant-isolation, pii-retention | correct |
| Names one specific artifact, correctly | cost-metric-never-who, deprecation-lock, worker-claude-md, and others whose invariant IS about one module's shape                                                                                                                                                                | correct |
| Runtime checks, not source-shape gates | anonymous-id, geo-resolution, ncr-accumulation, uec-codes                                                                                                                                                                                                                        | n/a     |

### Two findings, both fixed

**`tenant-isolation`** asserted _"public list queries use `WHERE brand_id = ?`"_
of exactly one function in one file. A second public list query shipped in a new
file with no brand scoping and the gate never saw it. Rewritten to scan every
handler — and on its first run it found a **pre-existing cross-brand leak** on
the public post-event recap page (`pages.ts`), which the named-subject version
had been green through for the whole life of that leak.

**`pii-retention`** kept a hand-maintained registry of PII tables whose own
instructions read _"to add a new PII table: 1. Add a row here"_ — a guarantee
that only binds someone who already decided to open the file. The registry was
complete; it simply could not notice if it stopped being. A completeness test
now derives PII tables from the migrations (CREATE **and** `ALTER ADD COLUMN`,
because that is how columns actually arrive here) and asserts the registry
covers them.

### `deprecation-lock` is the pattern to copy

It names seven paths and is _correct_, because it is a **meta-gate**: it asserts
that `scripts/guard-no-gas.js` exists, has self-tests, has an allowlist, has a
runbook, is registered in `package.json`, and is invoked by CI. The scanning is
done by that script, which walks the tree. The gate's subjects are the specific
artifacts that make up the enforcement mechanism — exactly the things worth
naming.

When an invariant is about a class, assert the property. When it is about one
artifact, name it. When it is about a _mechanism_, assert the mechanism exists
and is wired — and let the mechanism do the scanning.

### Two lessons from writing these

1. **Give a derived gate a negative control.** A completeness check that finds
   nothing is indistinguishable from one that looks at nothing. The first draft
   of the pii-retention parser anchored its identity regex to line start,
   matched **zero** columns in a schema full of them, and passed. There is now a
   test asserting the parser sees the tables it is meant to see.
2. **Give it a triaged exemption list with a reason per entry.** Legitimate
   exceptions exist — dynamically-built `WHERE` clauses, correlated sub-selects,
   cross-brand OER emission. A gate that cannot express them gets deleted
   instead of fixed.

## Gate index (generated)

<!-- prettier-ignore-start -->
<!-- BEGIN GENERATED: gate-index (scripts/check-invariant-registry.py --write) -->

| Gate spec | Brain invariant that names it |
| --------- | ----------------------------- |
| `aggregate-only.invariant.spec.ts` | #7 aggregate_only_reporting |
| `anonymous-id.invariant.spec.ts` | #1 anonymous_id |
| `api-response-schema.invariant.spec.ts` | #16 api_response_schema_stability |
| `ci-approval-gate-safety.invariant.spec.ts` | #28 ci_approval_gate_secret_surface |
| `cors-allowlist.invariant.spec.ts` | #15 cors_allowlist_immutability |
| `cost-metric-never-who.invariant.spec.ts` | — (OSE-local or derived gate, not the named test of a brain invariant) |
| `csp-connect-src.invariant.spec.ts` | — (OSE-local or derived gate, not the named test of a brain invariant) |
| `deprecation-lock.invariant.spec.ts` | #10 deprecation_lock |
| `edge-token-verification.invariant.spec.ts` | — (OSE-local or derived gate, not the named test of a brain invariant) |
| `geo-resolution.invariant.spec.ts` | #2 hyperlocal_geo_resolution |
| `geo-resolution.structural.invariant.spec.ts` | — (OSE-local or derived gate, not the named test of a brain invariant) |
| `log-redaction.invariant.spec.ts` | — (OSE-local or derived gate, not the named test of a brain invariant) |
| `migration-monotonicity.invariant.spec.ts` | #19 migration_monotonicity |
| `monetization-inert.invariant.spec.ts` | #6 inert_monetization_hooks |
| `ncr-accumulation.invariant.spec.ts` | #4 ncr_data_accumulation |
| `ncr-accumulation.structural.invariant.spec.ts` | — (OSE-local or derived gate, not the named test of a brain invariant) |
| `oer-emission-boundary.invariant.spec.ts` | #17 oer_emission_boundary |
| `pii-retention.invariant.spec.ts` | #8 bounded_pii_retention |
| `qr-decode-matrix.invariant.spec.ts` | — (OSE-local or derived gate, not the named test of a brain invariant) |
| `rendered-surface-lexicon.invariant.spec.ts` | — (OSE-local or derived gate, not the named test of a brain invariant) |
| `runtime-llm-free.invariant.spec.ts` | — (OSE-local or derived gate, not the named test of a brain invariant) |
| `scan-path-split.invariant.spec.ts` | — (OSE-local or derived gate, not the named test of a brain invariant) |
| `shared-report-schema.invariant.spec.ts` | #21 shared_report_schema_stability |
| `slug-permanence.invariant.spec.ts` | #18 slug_permanence |
| `sponsor-identity-split.invariant.spec.ts` | — (OSE-local or derived gate, not the named test of a brain invariant) |
| `sponsor-share-covenant.invariant.spec.ts` | #25 sponsor_share_covenant |
| `sponsor-signal-never-who.invariant.spec.ts` | — (OSE-local or derived gate, not the named test of a brain invariant) |
| `tenant-isolation.invariant.spec.ts` | #9 tenant_isolation |
| `tier-equity.invariant.spec.ts` | #5 tier_equity |
| `uec-codes.invariant.spec.ts` | #3 uec_encoding |
| `uec-poster-color.invariant.spec.ts` | — (OSE-local or derived gate, not the named test of a brain invariant) |
| `worker-claude-md.invariant.spec.ts` | — (OSE-local or derived gate, not the named test of a brain invariant) |
| `workflow-injection.invariant.spec.ts` | — (OSE-local or derived gate, not the named test of a brain invariant) |

<!-- END GENERATED: gate-index -->
<!-- prettier-ignore-end -->
