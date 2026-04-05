# TEST-MANIFEST.md — Canonical Test File Registry

> **Last updated:** 2026-03-31 (EFF-5 / OUR-144)
>
> This manifest documents **active test files** — files that run in CI and target the
> canonical Cloudflare Worker at `workers/oursharedevents/src/`. Legacy tests that
> targeted the dead GAS/NUSDK system have been moved to `archive/legacy-tests/tests/`
> and are excluded from CI runs.

---

## Before / After Summary

|                                   | Before EFF-5 | After EFF-5         |
| --------------------------------- | ------------ | ------------------- |
| Total test files in repo          | 272          | 272 (none deleted)  |
| Test files run by Jest (root)     | ~90          | 0 (all in archive/) |
| Test files run by Vitest (worker) | 7            | 7                   |
| Standalone node test scripts      | 2            | 2                   |
| Legacy tests (archived, not run)  | 0            | 263                 |

---

## Active Tests — Run in CI

### 1. Canonical Worker Tests (Vitest + @cloudflare/vitest-pool-workers)

**Location:** `workers/oursharedevents/tests/`
**Runner:** `vitest` via `workers/oursharedevents/vitest.config.ts`
**How to run:** `cd workers/oursharedevents && npx vitest run`

| File                              | What it tests                                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/schema.spec.ts`            | D1 schema verification — all 8 main tables exist post-migration, required columns present, indexes in place                                          |
| `tests/constraints.spec.ts`       | D1 constraint enforcement — migration idempotency, NOT NULL and UNIQUE constraints fire correctly                                                    |
| `tests/feature-flags.spec.ts`     | 3-tier feature flag system — free/mid/enterprise seed data, flag resolution, `applyTier` lifecycle                                                   |
| `tests/forms-schema.spec.ts`      | FORMS_DB schema verification — all 4 forms tables exist, columns and indexes correct                                                                 |
| `tests/forms-constraints.spec.ts` | FORMS_DB constraint enforcement — migration idempotency, duplicate submission handling                                                               |
| `tests/forms-security.spec.ts`    | Cross-contamination guard — FORMS_DB and main DB never share data; PII isolation verified                                                            |
| `tests/forms-e2e.spec.ts`         | Full form service E2E — handler → D1 → response → DB read-back for all 4 form types (register, check-in, survey, email); auth gating; PII encryption |

---

### 2. Guard Validation (Standalone Node.js)

**Location:** `scripts/guard-no-gas.test.js`
**Runner:** `node scripts/guard-no-gas.test.js` (no framework dependency)
**How to run:** `npm run test:guard-no-gas`

| File                           | What it tests                                                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/guard-no-gas.test.js` | Unit tests for the `guard-no-gas` security guard script — validates file analysis, GAS reference detection, and pass/fail reporting logic using temporary files |

---

### 3. Chaos / Resilience Tests (Standalone Node.js)

**Location:** `test/chaos/graceful-degradation.test.js`
**Runner:** `node test/chaos/graceful-degradation.test.js` (no framework dependency)
**How to run:** `node test/chaos/graceful-degradation.test.js`
**Note:** Can optionally target a live worker URL via environment variable.

| File                                      | What it tests                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `test/chaos/graceful-degradation.test.js` | Validates user-facing error pages for backend failures — worker timeouts, 5xx responses, client-side error rendering |

---

## Archived Tests (Not Run in CI)

**Location:** `archive/legacy-tests/tests/`
**Total files:** 263 test files (`.test.js`, `.spec.ts`, `.spec.js`)

These tests targeted the GAS (Google Apps Script) / NUSDK system, which is no longer the
canonical implementation. They have been **moved, not deleted**, per SECURITY-GUARDRAILS policy.

| Directory                                   | Count | What they tested                                                      |
| ------------------------------------------- | ----- | --------------------------------------------------------------------- |
| `archive/legacy-tests/tests/unit/`          | 36    | GAS worker logic, Sheets client, state machines, privacy controls     |
| `archive/legacy-tests/tests/e2e/`           | 77    | GAS application user flows, pages, forms, negative cases (Playwright) |
| `archive/legacy-tests/tests/contract/`      | 39    | GAS/NUSDK API response envelope structure and schema validation       |
| `archive/legacy-tests/tests/smoke/`         | 20    | GAS integration smoke tests                                           |
| `archive/legacy-tests/tests/api/smoke/`     | 31    | GAS/Stage-2 API smoke tests (Playwright)                              |
| `archive/legacy-tests/tests/triangle/`      | 6     | Event lifecycle phase contracts (before/during/after)                 |
| `archive/legacy-tests/tests/ui/smoke/`      | 12    | GAS application UI surface smoke tests                                |
| `archive/legacy-tests/tests/integration/`   | 3     | GAS backend integration workflows                                     |
| `archive/legacy-tests/tests/api/`           | 1     | MVP bundle contracts                                                  |
| `archive/legacy-tests/tests/api-contracts/` | 1     | MVP API contract validation                                           |
| `archive/legacy-tests/tests/playwright/`    | 1     | Playwright landing page test                                          |
| Other                                       | 36    | Miscellaneous GAS/NUSDK tests                                         |

---

## Test Runner Configuration

| Runner                        | Config file                                | Scope                                                                                                  |
| ----------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Vitest (canonical worker)     | `workers/oursharedevents/vitest.config.ts` | `workers/oursharedevents/tests/**/*.spec.ts`                                                           |
| Jest (root — no active tests) | `jest.config.js`                           | `tests/unit/`, `tests/contract/` etc. — all archived; `archive/` excluded via `testPathIgnorePatterns` |
| Playwright (legacy, archived) | `playwright.config.js` et al.              | `archive/legacy-tests/tests/e2e/` — targets dead GAS system                                            |
