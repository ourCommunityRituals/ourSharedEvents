# OCR Architectural Invariants — Standards Index

> **Canonical source**: `ocr-docs-brain/architectural-invariants.yaml`
> **Schema version**: 1.2.0
> **Purpose**: Human-readable index of all architectural invariants. Each entry links to the machine-enforced spec. This file is the propagation target for Invariant #20 (Standards Propagation Completeness) — `level2_schema.py` asserts every live invariant ID appears here.

---

## Group 1: Privacy & Identity

*Foundation. Data never escapes as PII, outputs are aggregates-only, retention is bounded.*

| # | Name | Status | Test file |
|---|------|--------|-----------|
| 1 | Anonymous ID | live | `tests/e2e/0-architecture/anonymous-id.invariant.spec.ts` |
| 7 | Aggregate-Only Reporting | partial | `tests/e2e/0-architecture/aggregate-only.invariant.spec.ts` |
| 8 | Bounded PII Retention | live | `tests/e2e/0-architecture/pii-retention.invariant.spec.ts` |
| 26 | Explicit Identity | partial | `tests/security/explicit-identity.invariant.test.ts` (ourWKRP) |
| 27 | No Biometric Identifiers | partial | `tests/security/no-biometrics.invariant.test.ts` (ourWKRP; OSE pending) |
| 29 | Declined Regulatory Regimes | partial | `tests/security/declined-regimes.invariant.test.ts` (ourWKRP); OSE routing + `scripts/guard-declined-regimes.js` |

---

## Group 2: Product & Experience

*What the platform does. Geo-resolution, UEC encoding, NCR data accumulation, mobile workability.*

| # | Name | Status | Test file |
|---|------|--------|-----------|
| 2 | Hyperlocal Geo-Resolution | live | `tests/e2e/0-architecture/geo-resolution.invariant.spec.ts` |
| 3 | Universal Event Code Standard | live | `tests/e2e/0-architecture/uec-codes.invariant.spec.ts` |
| 4 | NCR Data Accumulation | live | `tests/e2e/0-architecture/ncr-accumulation.invariant.spec.ts` |
| 14 | Mobile Workability | partial | `tests/playwright/mobile-workability.spec.ts` |
| 16 | API Response Schema Stability | live | `tests/e2e/0-architecture/api-response-schema.invariant.spec.ts` |
| 18 | QR Code URL / Slug Permanence | live | `tests/e2e/0-architecture/slug-permanence.invariant.spec.ts` |
| 21 | SharedReport Schema Stability | partial | `tests/e2e/0-architecture/shared-report-schema.invariant.spec.ts` |

---

## Group 3: Commercial Governance

*How the business operates. Tier equity and the pre-revenue monetization gate.*

| # | Name | Status | Test file |
|---|------|--------|-----------|
| 5 | Local Sponsor Covenant | partial | `tests/e2e/0-architecture/tier-equity.invariant.spec.ts` |
| 6 | Inert Monetization Hooks | live | `tests/e2e/0-architecture/monetization-inert.invariant.spec.ts` |
| 25 | Sponsor Share Covenant | live | `tests/e2e/0-architecture/sponsor-share-covenant.invariant.spec.ts` |

---

## Group 4: Security & Isolation

*Cross-cutting security. Tenant isolation, CORS, and inter-product boundary enforcement.*

| # | Name | Status | Test file |
|---|------|--------|-----------|
| 9 | Tenant Isolation | partial | `tests/e2e/0-architecture/tenant-isolation.invariant.spec.ts` |
| 15 | CORS Allowlist Immutability | live | `tests/e2e/0-architecture/cors-allowlist.invariant.spec.ts` |
| 17 | OER Emission Boundary | live | `tests/e2e/0-architecture/oer-emission-boundary.invariant.spec.ts` |
| 22 | Cross-Repo Import Isolation | live | `scripts/check-cross-repo-imports.sh (OSE repo)` |
| 23 | Red Team Coverage | partial | `tests/red-team/` (OSE, in construction: OSE-564) |
| 28 | CI Approval-Gate Secret Surface | partial | `tests/e2e/0-architecture/ci-approval-gate-safety.invariant.spec.ts` |

---

## Group 5: Infrastructure & CI

*Deployment layer. Deprecation locks, runner environment, migration integrity.*

| # | Name | Status | Test file |
|---|------|--------|-----------|
| 10 | Deprecation Lock | live | `tests/e2e/0-architecture/deprecation-lock.invariant.spec.ts` |
| 11 | Self-Hosted Runner Bash Resolution | retired | _retired 2026-09-02 (OSE-1194) — self-hosted pool decommissioned; spec deleted_ |
| 12 | Runner Pool Readiness Probe | retired | _retired 2026-09-02 (OSE-1194) — self-hosted pool decommissioned; spec deleted_ |
| 19 | Migration Monotonicity | live | `tests/e2e/0-architecture/migration-monotonicity.invariant.spec.ts` |

---

## Group 6: Governance & Brain

*Meta-governance. Brain artifact co-location and self-enforcement.*

| # | Name | Status | Test file |
|---|------|--------|-----------|
| 13 | Brain Enforcement Co-location | live | `ocr-docs-brain/tests/level2_schema.py` (inv13_* checks) |
| 20 | Standards Propagation Completeness | partial | `ocr-docs-brain/tests/level2_schema.py` (inv20_* checks) |
| 24 | Auditability | partial | `tests/audit-layer.spec.ts` (OSE, in construction: OSE-560 / OSE-557) |

---

## Status legend

| Status | Meaning |
|--------|---------|
| `live` | CI-enforced on every PR + push to main. All enforcement layers present and green. |
| `partial` | Enforcement mechanism exists and wired, but not all criteria for `live` are met (e.g. T3/T4 staging test pending, or multi-product rollout incomplete). |
| `planned` | Invariant authored in brain but spec not yet wired to CI. |

*Last updated: 2026-10-08. Every invariant in `architectural-invariants.yaml` now has a row (#23, #24, #26, #27, #28 were missing; #29 is new). Check: every `id` in the registry appears as a row here.*
