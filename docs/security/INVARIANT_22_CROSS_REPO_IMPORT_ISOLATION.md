# Invariant #22 — Cross-Repo Import Isolation: Audit + Gate

**Date:** 2026-08-02
**Audit scope:** OSE-388 (OCR-ENF-21) + OSE-389 (OCR-ENF-23)
**Auditor:** Claude Code (automated, reviewed by founder)
**Status:** Clean — no violations

---

## Invariant definition

**Invariant #22 (Cross-Repo Import Isolation) — `security_isolation` group, order 6:** No module-level imports may cross the OSE / WKRP / OAW repo boundary. Each product repo is a separate tenant. Cross-repo coupling must only exist at the OER aggregation boundary — a single, documented HTTP API seam.

---

## Audit findings (2026-08-02)

### Scope

| Repo                                        | Paths scanned                                        | Status       |
| ------------------------------------------- | ---------------------------------------------------- | ------------ |
| `ourCommunityRituals/ourSharedEvents` (OSE) | `workers/**/*.ts`, `workers/**/*.js`, `package.json` | **Clean**    |
| `ourCommunityRituals/ourWKRP` (WKRP)        | `src/**/*.ts`, `src/**/*.js`, `package.json`         | **Clean**    |
| `ourCommunityRituals/ourAirwaves` (OAW)     | Not yet active — OCR-ENF-22 deferred                 | **Deferred** |

### Findings

No module-level imports cross repo boundaries in either direction.

### Permitted boundary: the music API seam

One documented, permitted cross-repo coupling exists:

| Detail        | Value                                                 |
| ------------- | ----------------------------------------------------- |
| Endpoint      | `GET /api/events/:id/music`                           |
| Direction     | OSE calls WKRP (HTTP fetch, not module import)        |
| WKRP handler  | `src/handlers/events.ts`                              |
| CORS rule     | `oursharedevents.com` allowed in `src/lib/privacy.ts` |
| Contract test | OSE-423 (F2.3 — Pact at the frozen music seam)        |

This seam is the **only** permitted data flow between OSE and WKRP at the application layer. It is HTTP-only; no npm package, no `import`, no `file:` or `workspace:` link crosses the boundary.

### Non-violations confirmed

The following references were audited and confirmed **not violations**:

| File                                               | Reference                                                | Verdict                                       |
| -------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| `workers/oursharedevents/src/handlers/briefing.ts` | `id: 'wkrp'`, string descriptions of OurWKRP             | Content string — not an import                |
| `ourWKRP/src/lib/privacy.ts`                       | `origin.includes('oursharedevents.com')`                 | CORS check — permitted for the music API seam |
| `ourWKRP/src/router.ts`                            | `// --- OurSharedEvents Integration ---`                 | Code comment — not an import                  |
| `ourWKRP/src/handlers/events.ts`                   | `event_page: \`https://oursharedevents.com/events/...\`` | URL string in response JSON — permitted       |

---

## What is prohibited

Any of the following patterns in OSE, WKRP, or OAW source code constitutes a violation of Invariant #22:

```
import ... from '@ourwkrp/...'
import ... from '@oursharedevents/...'
import ... from '@ourairwaves/...'
require('ourwkrp/...')
require('oursharedevents/...')
"@ourwkrp": "..." in package.json dependencies
"@oursharedevents": "..." in package.json dependencies
file:../../ourWKRP in package.json
workspace:../ourWKRP in package.json
```

The shared OCR packages (`@ocr/flags`, `@ocr/ui`) are **not** a violation — they live under `packages/` in the OCR monorepo root and are consumed by all product repos as intended.

---

## CI enforcement

The canonical, live-read brain guard `ocr-docs-brain/scripts/check_cross_repo_imports.py` (OCR-docs) scans this repo's source and `package.json` files (both `src/` and `workers/`) for any prohibited pattern and exits 1 on any match, deriving the prohibited sibling scopes from `product-registry.yaml`. Invariant #22 declares `enforcement_kind: brain_script`, so brain conformance verifies this repo _wires_ that guard rather than that a local script exists. The former OSE-local `scripts/check-cross-repo-imports.sh` was retired once the brain guard became canonical (OSE-1288 / F13).

The guard runs in **two** places (OSE-1297):

1. **`inv22-cross-repo-gate.yml` — the BLOCKING gate.** A dedicated, isolated job (`Invariant #22 cross-repo isolation gate`) that runs _only_ the guard — no brain pyramid, conformance, or ticket-opener — so it carries none of the false-red modes that kept `brain-contract-check.yml` out of the required set. It is listed as a **required status check** in `tools/ci/main-branch-protection.json` (activate with `scripts/apply-branch-protection.mjs --apply`). The brain is checked out **SHA-pinned** (pin-code) so a required gate cannot false-red on brain content drift; live-read of the `enforcement_mode` plane is the OSE-1294 follow-up that supersedes the pin. This is what makes OSE's own #22 enforcement **block** a PR rather than merely advise — closing the OSE-1297 gap where the gate ran but the brain job was excluded from required checks.
2. **`brain-contract-check.yml`** still runs the guard as part of the broader (advisory) brain-conformance flow, which additionally opens a Linear drift ticket on failure. Its `enforcement_mode` is read live from OCR-docs `main`.

To add this gate to a sibling repo (WKRP, OAW), wire the same brain guard into that repo's CI with `--product-id <wkrp|oaw>`; the prohibited sibling scopes are derived per-product from `product-registry.yaml`, and the repo's severity comes from the `enforcement_mode` plane (`warn` until its side of the seam is built, then `block`).

---

## References

- [ADR-002 — Static Invariant Gates](../adr/ADR-002-static-invariant-gates.md)
- [OSE-388](https://linear.app/oursharedevents/issue/OSE-388) — F5a: Invariant #9 Cross-Repo Audit
- [OSE-389](https://linear.app/oursharedevents/issue/OSE-389) — F5b: Invariant #9 Cross-Repo CI Gate
- [OSE-423](https://linear.app/oursharedevents/issue/OSE-423) — F2.3: Pact at the frozen music seam (contract test for the music API boundary)
