# CLAUDE-TEST-SUITES-v2.md — Test Infrastructure Reference

> Current test infrastructure for ourSharedEvents Cloudflare Worker platform.
> Legacy references have been scanned and flagged per pre-execution alignment.

---

## Active Test Infrastructure

| Framework | Count | Target |
|-----------|-------|--------|
| Vitest | 7 files | Deployed Worker endpoints |
| Playwright | Multiple | UI smoke, E2E flows |
| Jest | Unit tests | Worker handlers, config, schemas |
| k6 | 5 scenarios | Load testing |
| Newman/Postman | Collections | API contract testing |

### Active Test Directories

```
tests/
├── unit/worker/          # Worker unit tests (Vitest/Jest)
├── ui/smoke/             # UI smoke tests (Playwright)
├── smoke/                # API smoke tests
├── load/                 # k6 load test scripts
├── contract/             # Schema contract tests
├── e2e/                  # End-to-end flows
└── triangle/             # Triangle framework tests
workers/oursharedevents/tests/  # Worker-specific schema tests
```

---

## Legacy Reference Scan — 2026-03-30

The following legacy references were found across the repository.
All are flagged `[ARCHIVE - NOT CURRENT]`. Do not treat as active spec.

### clasp / Apps Script / GAS References

| File | Legacy Reference | Status |
|------|-----------------|--------|
| `.claspignore` (root) | [ARCHIVE - NOT CURRENT] clasp config file from GAS era | Retained for history |
| `Code.gs.backup` (root) | [ARCHIVE - NOT CURRENT] Full Apps Script backup | Retained for history |
| `Code.gs.temp` (root) | [ARCHIVE - NOT CURRENT] Temp Apps Script file | Retained for history |
| `.devcontainer/README.md:31` | [ARCHIVE - NOT CURRENT] References `github.com/zeventbooks/MVP-EVENT-TOOLKIT` | Needs update |
| `.devcontainer/README.md:162-163` | [ARCHIVE - NOT CURRENT] Clone instructions for MVP-EVENT-TOOLKIT | Needs update |
| `archive/START_HERE.md` | [ARCHIVE - NOT CURRENT] Full Apps Script setup guide (lines 111-306) | In archive/ — OK |
| `archive/hostinger-proxy/README.md` | [ARCHIVE - NOT CURRENT] clasp deployments, Apps Script proxy (lines 11-237) | In archive/ — OK |
| `archive/postman/POSTMAN_API_TESTING.md` | [ARCHIVE - NOT CURRENT] Apps Script API testing (lines 24-432) | In archive/ — OK |
| `archive/v2-code/README.md` | [ARCHIVE - NOT CURRENT] .clasp.json, .gs files, Config.gs references | In archive/ — OK |
| `tests/e2e/scenarios/README.md:45` | [ARCHIVE - NOT CURRENT] CI/CD pipeline references Apps Script | Needs update |
| `.github/DEPLOYMENT_TEST.md` | [ARCHIVE - NOT CURRENT] Google Apps Script deployment setup (lines 3-18) | Needs update |
| `tests/e2e/README.md:362-400` | [ARCHIVE - NOT CURRENT] isGoogleAppsScript(), clasp deploy references | Needs update |
| `tests/FORMS_WORKFLOW_TEST_SUMMARY.md` | [ARCHIVE - NOT CURRENT] Full file references MVP-EVENT-TOOLKIT, Config.gs, Apps Script runtime (16 refs) | Needs update |
| `web/README.md:29` | References "No GAS Fetch" — actually correct (documents the migration away) | OK — keep |
| `.security-reports/AUDIT_REPORT_2025-12-10.md:37-38` | [ARCHIVE - NOT CURRENT] @google/clasp dependency audit | Needs update |
| `CONTRIBUTING.md:28` | [ARCHIVE - NOT CURRENT] References Code.gs dead exports | Needs update |
| `.claude/documents/RECONCILIATION.md:11` | References "legacy systems (GAS/Apps Script)" — correct contextual mention | OK — keep |

### zeventbooks / MVP-EVENT-TOOLKIT References

| File | Legacy Reference | Status |
|------|-----------------|--------|
| `.devcontainer/README.md:31,162-163` | [ARCHIVE - NOT CURRENT] `github.com/zeventbooks/MVP-EVENT-TOOLKIT` | Needs update |
| `archive/START_HERE.md:127,199,282-283,306` | [ARCHIVE - NOT CURRENT] Multiple zeventbooks/MVP-EVENT-TOOLKIT URLs | In archive/ — OK |
| `tests/FORMS_WORKFLOW_TEST_SUMMARY.md:25,52,93` | [ARCHIVE - NOT CURRENT] `/home/user/MVP-EVENT-TOOLKIT/` paths | Needs update |
| `tests/triangle/*/e2e/README.md` | [ARCHIVE - NOT CURRENT] `/home/user/MVP-EVENT-TOOLKIT/tests/` paths (21 refs across 4 files) | Needs update |

### ~/ZEVENTBOOKS References

No direct `~/ZEVENTBOOKS` path references found in the repository.

---

## Summary

- **Total legacy references found:** 3,145 occurrences across 228 files (clasp, Apps Script, GAS, Code.gs, zeventbooks, MVP-EVENT-TOOLKIT)
- **In archive/ directory (acceptable):** Majority — these are historical, no action needed
- **In active docs/tests (need update):** 100+ references across 30+ files outside archive/
- **Priority files to clean up:**
  1. `tests/FORMS_WORKFLOW_TEST_SUMMARY.md` — heaviest legacy concentration
  2. `tests/triangle/*/e2e/README.md` — MVP-EVENT-TOOLKIT paths
  3. `.devcontainer/README.md` — setup instructions reference old repo
  4. `tests/e2e/README.md` — Apps Script detection code references
  5. `.github/DEPLOYMENT_TEST.md` — Apps Script deployment references
  6. `CONTRIBUTING.md` — Code.gs reference
