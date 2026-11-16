# TEST-MANIFEST.md — Test File Registry

> Corrected 2026-11-16: this file named Jest and a `jest.config.js` that no longer exist. The root suite is Vitest. Nothing generates or gates this file, so read `package.json`, the Vitest configs and the workflows for what runs. A spec under `tests/e2e/` counts as coverage only if a workflow names it (AGENTS.md); `node scripts/ci/ci-integrity-ratchets.mjs --root .` prints how many do not (97 on 2026-11-16).

> EFF-5 (OUR-144): Legacy GAS/NUSDK test audit. Moved orphaned Phase-1 GAS tests to archive.

## Active Test Suites

| Framework            | Config                                     | Glob                                                                            | Purpose                                           |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Vitest (Workers)** | `workers/oursharedevents/vitest.config.ts` | `tests/**/*.spec.ts`                                                            | Worker D1 unit/e2e tests (real miniflare)         |
| **Vitest (root)**    | `vitest.config.ts`                         | `tests/unit/**`, `tests/contract/**`, `tests/integration/**` (`*.test.{js,ts}`) | Unit, contract and integration tests (`npm test`) |
| **Playwright (UI)**  | `playwright.config.ts`                     | `tests/playwright/**`, `tests/e2e/**`, `tests/ui/**`                            | Browser E2E + smoke                               |
| **Bruno**            | `bruno/*/opencollection.yml`               | `bruno/ose-*/**/*.yml`, seeds in `bruno/fixtures/`                              | API + pages contract collections (T2)             |
| **k6**               | `tests/load/`                              | `*.js`                                                                          | Load / performance scenarios                      |

## Excluded Paths

- `/archive/` — excluded from all CI test runners (`exclude` in `vitest.config.ts`)
- `/tests/e2e/`, `/tests/playwright/`, `/tests/ui/` — excluded from root Vitest (run via Playwright)
- `/tests/api/`, `/tests/smoke/` — excluded from root Vitest (network-based)
- `/workers/` — excluded from root Vitest (the worker has its own Vitest projects)

## Archived: Legacy GAS / NUSDK Tests

Moved to `archive/legacy-tests/` by EFF-5. These targeted the old GAS backend
(Phase-1 Google Apps Script) which has been superseded by the Cloudflare Worker
(Phase-2). They are preserved for reference, not executed in CI.

| Original Path                                         | Reason Archived                                   |
| ----------------------------------------------------- | ------------------------------------------------- |
| `tests/api/smoke/gas-health.spec.ts`                  | GAS reachability — no GAS in Phase-2              |
| `tests/api/smoke/gas-html-integrity.spec.ts`          | GAS HTML integrity — GAS removed                  |
| `tests/api/smoke/worker-gas-routing.spec.ts`          | Worker→GAS proxy routing — proxy removed          |
| `tests/contract/gas-html-guardrails.contract.test.js` | GAS HTML contract — GAS removed                   |
| `tests/contract/nusdk-api-proxy.contract.test.js`     | NUSDK /api/\* proxy — superseded by Worker routes |
| `tests/contract/nusdk-single-source.contract.test.js` | NUSDK single-source rule — no longer applicable   |
| `tests/contract/worker-gas-routing.contract.test.js`  | Worker→GAS routing contract — GAS removed         |
| `tests/smoke/nusdk-api-proxy.smoke.test.js`           | NUSDK proxy smoke (network) — GAS backend gone    |
| `tests/unit/nusdk-rpc.test.js`                        | NUSDK RPC unit tests — client SDK retired         |

## Adding New Tests

- **Worker logic** → `workers/oursharedevents/tests/*.spec.ts` (picked up by vitest)
- **API contracts** → `tests/contract/*.contract.test.js` (picked up by root Vitest)
- **Browser flows** → `tests/playwright/*.spec.ts` or `tests/e2e/*.spec.js`
- **Load scenarios** → `tests/load/*.js` (run manually via k6)
- Do **not** place tests under `archive/` — they will be ignored by all runners.
