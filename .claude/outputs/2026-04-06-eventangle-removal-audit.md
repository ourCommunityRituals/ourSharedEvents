# Audit Trail: eventangle.com → oursharedevents.com URL Migration

**Date:** 2026-04-06
**Commit:** c5b13fa (`fix: consolidate URLs to oursharedevents.com + fix Tier 1 test failures`)
**Author:** bereasonable13 + Claude Opus 4.6

## Summary

All `eventangle.com` references were removed from config, environment, schema, and secret files. The canonical domain is now `oursharedevents.com` across all environments.

## Removals by File

### config/environments.js (14 removals)

| Line | Removed                                                                        | Replaced With                                                                            |
| ---- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 49   | `Production URL - eventangle.com via Cloudflare Workers`                       | `Production URL - oursharedevents.com via Cloudflare Workers`                            |
| 52   | `const PRODUCTION_URL = 'https://www.eventangle.com'`                          | `const PRODUCTION_URL = 'https://oursharedevents.com'`                                   |
| 55   | `Staging URL - stg.eventangle.com via Cloudflare Workers`                      | `Staging URL - stg.oursharedevents.com via Cloudflare Workers`                           |
| 58   | `const STAGING_URL = 'https://stg.eventangle.com'`                             | `const STAGING_URL = 'https://stg.oursharedevents.com'`                                  |
| 106  | `URL: https://www.eventangle.com`                                              | `URL: https://oursharedevents.com` (in ENVIRONMENTS.production)                          |
| 112  | `description: 'Production via Cloudflare Workers (eventangle.com)'`            | `description: 'Production via Cloudflare Workers (oursharedevents.com)'`                 |
| 121  | `URL: https://stg.eventangle.com`                                              | `URL: https://stg.oursharedevents.com` (in ENVIRONMENTS.staging)                         |
| 127  | `description: 'Staging via Cloudflare Workers (stg.eventangle.com)'`           | `description: 'Staging via Cloudflare Workers (stg.oursharedevents.com)'`                |
| 209  | `hostname === 'stg.eventangle.com' \|\| hostname === 'api-stg.eventangle.com'` | `hostname === 'stg.oursharedevents.com'`                                                 |
| 213  | `hostname === 'eventangle.com' \|\| hostname === 'www.eventangle.com'`         | `hostname === 'oursharedevents.com' \|\| hostname === 'www.oursharedevents.com'`         |
| 349  | `Check if current environment is production (eventangle.com)`                  | `Check if current environment is production (oursharedevents.com)`                       |
| 356  | `url.hostname === 'eventangle.com' \|\| url.hostname === 'www.eventangle.com'` | `url.hostname === 'oursharedevents.com' \|\| url.hostname === 'www.oursharedevents.com'` |
| 370  | `url.hostname === 'stg.eventangle.com'`                                        | `url.hostname === 'stg.oursharedevents.com'`                                             |

Also removed from this file:

- `OUR_SHARED_EVENTS_STAGING_URL` and `OUR_SHARED_EVENTS_PROD_URL` constants (redundant — staging/production now ARE oursharedevents.com)
- `ENVIRONMENTS.ourSharedEventsStaging` and `ENVIRONMENTS.ourSharedEvents` entries (merged into `staging` and `production`)
- All GAS deployment ID imports (`STAGING_SCRIPT_ID`, `STAGING_DEPLOYMENT_ID`, etc.)
- All GAS deployment ID exports
- Legacy aliases: `GAS_PRODUCTION_URL`, `GAS_STAGING_URL`, `APP_URL`, `DEFAULT_GAS_URL`, `DEFAULT_DEPLOYMENT_ID`, `DEFAULT_PRODUCTION_URL`, `DEFAULT_STAGING_URL`

### config/feature-flags.js (2 removals)

| Line | Removed                                                                                                       | Replaced With                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 80   | `hostname === 'stg.eventangle.com' \|\| hostname === 'api-stg.eventangle.com'`                                | `hostname === 'stg.oursharedevents.com'`                                         |
| 85   | `hostname === 'eventangle.com' \|\| hostname === 'www.eventangle.com' \|\| hostname === 'api.eventangle.com'` | `hostname === 'oursharedevents.com' \|\| hostname === 'www.oursharedevents.com'` |

### schemas/ (5 removals)

| File                          | Removed                                                               | Replaced With                                                              |
| ----------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `status.schema.json`          | `"$id": "https://eventangle.com/schemas/status.schema.json"`          | `"$id": "https://oursharedevents.com/schemas/status.schema.json"`          |
| `status-envelope.schema.json` | `"$id": "https://eventangle.com/schemas/status-envelope.schema.json"` | `"$id": "https://oursharedevents.com/schemas/status-envelope.schema.json"` |
| `setupcheck.schema.json`      | `"$id": "https://eventangle.com/schemas/setupcheck.schema.json"`      | `"$id": "https://oursharedevents.com/schemas/setupcheck.schema.json"`      |
| `status-mvp.schema.json`      | `"$id": "https://eventangle.com/schemas/status-mvp.schema.json"`      | `"$id": "https://oursharedevents.com/schemas/status-mvp.schema.json"`      |
| `deploy-manifest.schema.json` | `"$id": "https://eventangle.com/schemas/deploy-manifest.schema.json"` | `"$id": "https://oursharedevents.com/schemas/deploy-manifest.schema.json"` |

### .env.example (4 removals)

| Line | Removed                                                    | Replaced With                                                |
| ---- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| 10   | `Tests default to STAGING (https://stg.eventangle.com)`    | `Tests default to STAGING (https://stg.oursharedevents.com)` |
| 32   | `BASE_URL="https://www.eventangle.com" npm run test:smoke` | `BASE_URL="https://oursharedevents.com" npm run test:smoke`  |
| 48   | `# BASE_URL=https://stg.eventangle.com`                    | Removed (redundant with staging default)                     |
| 51   | `# BASE_URL=https://www.eventangle.com`                    | `# BASE_URL=https://oursharedevents.com`                     |

### .github-secrets-required.json (3 removals)

| Line | Removed                                  | Replaced With                                 |
| ---- | ---------------------------------------- | --------------------------------------------- |
| 40   | `"zoneRestrictions": ["eventangle.com"]` | `"zoneRestrictions": ["oursharedevents.com"]` |
| 128  | `"zoneRestrictions": ["eventangle.com"]` | `"zoneRestrictions": ["oursharedevents.com"]` |
| 138  | `"zoneRestrictions": ["eventangle.com"]` | `"zoneRestrictions": ["oursharedevents.com"]` |

## Remaining eventangle.com References (Not Changed)

These files still contain `eventangle.com` but are documentation, legacy tests, or non-config files:

| File                                       | Reason Not Changed   |
| ------------------------------------------ | -------------------- |
| `CONTRIBUTING.md`                          | Documentation        |
| `tests/e2e/README.md`                      | Test documentation   |
| `tests/e2e/scenarios/README.md`            | Test documentation   |
| `tests/e2e/qa-routes/README.md`            | Test documentation   |
| `tests/smoke/README.md`                    | Test documentation   |
| `specs/system/ROUTES.json`                 | System specification |
| `specs/system/SYSTEM_MAP.md`               | System specification |
| `specs/system/DEPENDENCY_GRAPH.mmd`        | System specification |
| `web/shared/apiClient.js`                  | Legacy web client    |
| `test/chaos/graceful-degradation.test.js`  | Legacy chaos test    |
| `scripts/read-manifest.js`                 | Legacy script        |
| `scripts/redeploy-with-permissions.sh`     | Legacy script        |
| `scripts/deploy-staging.js`                | Legacy script        |
| `scripts/compare-environments.js`          | Legacy script        |
| `scripts/check-staging-api-list-events.sh` | Legacy script        |

These can be addressed in a future docs/scripts cleanup pass.
