# Story A2: Observability + Runtime Evidence (Playwright & Logs)

## Purpose / Business Value

> When staging breaks, we answer why in minutes, not hours.
> No more "503 but ¯\_(ツ)\_/¯".

## What This Story Delivers

### 1. Playwright Runtime Logging

Every UI smoke test now logs comprehensive runtime information:

```
============================================================
[REQUEST LOGGER] TEST SUMMARY (Story A2)
============================================================
  BASE_URL:             https://stg.oursharedevents.com
  First Navigation:     https://stg.oursharedevents.com/manage?brand=root
  First API Host:       stg.oursharedevents.com
  Total Requests:       42
  API Requests:         5
  Banned Origin Calls:  0
  API Failures:         0

  Hosts contacted:
    - stg.oursharedevents.com
    - fonts.googleapis.com
============================================================
```

### 2. Origin Safety Assertions

Browser NEVER calls Google origins:

- `script.google.com`
- `script.googleusercontent.com`
- `*.googleapis.com/macros`
- Any GAS deployment URL (`/macros/s/.../exec`)

If violated, tests fail with clear error message:

```
[ORIGIN VIOLATION] Browser made 1 request(s) to banned Google origins:
  - GET https://script.google.com/macros/s/.../exec

This violates the "same-origin only" browser rule (Story A2).
All API calls must go through the Cloudflare Worker at https://stg.oursharedevents.com.
```

### 3. API Failure Logging

When API calls fail, CI logs show:

- **Status code** (e.g., 503, 500, 401)
- **Request ID** (X-Request-Id or cf-ray)
- **Error body snippet** (first 500 characters)

```
============================================================
[REQUEST LOGGER] API FAILURE DETECTED
============================================================
  URL:        https://stg.oursharedevents.com/?page=events
  Method:     GET
  Status:     503 Service Unavailable
  Request ID: abc123-xyz789
  Error Body:
    {"ok":false,"error":"Backend unavailable","code":"UPSTREAM_ERROR"}
============================================================
```

## Files Added/Modified

### New Files

- `tests/shared/helpers/request-logger.ts` - Request logging utility
- `tests/ui/smoke/manage.smoke.spec.ts` - /manage page smoke tests
- `docs/STORY-A2-OBSERVABILITY.md` - This documentation

### Modified Files

- `tests/ui/smoke/events.smoke.spec.ts` - Added Story A2 origin safety tests
- `.github/workflows/e2e-staging-stable.yml` - Updated CI logging
- `package.json` - Added Story A2 test scripts

## How to Run

### Run All Story A2 Tests

```bash
npm run test:storyA2
```

### Run Against Staging

```bash
npm run test:storyA2:staging
```

### Run Only Origin Safety Tests

```bash
npm run test:storyA2:origin-safety
```

### Run Individual Page Tests

```bash
npm run test:ui:smoke:manage
npm run test:ui:smoke:events
```

## CI/CD Integration

### Stage-2 STAGING GATE

The E2E staging workflow now includes Story A2 checks:

1. Deploy to staging
2. Run Playwright smoke tests
3. **Story A2 Assertions:**
   - Browser never calls Google origins
   - First API host matches staging origin
   - API failures logged with request IDs
4. Pass/fail gates promotion

### Failure Behavior

If staging tests fail, CI logs will show:

- **What broke**: Page name and test name
- **Why it broke**: Status code, request ID, error body
- **Who to blame**: Origin violations clearly identified

## Acceptance Criteria

| Criteria                                           | Status |
| -------------------------------------------------- | ------ |
| Playwright logs show BASE_URL                      | ✅     |
| Playwright logs show first navigation URL          | ✅     |
| Playwright logs show first API host                | ✅     |
| If API fails: status code printed                  | ✅     |
| If API fails: requestId printed                    | ✅     |
| If API fails: error body snippet printed           | ✅     |
| CI fails if browser calls Google origin            | ✅     |
| CI fails if /manage fails to load core UI elements | ✅     |

## Definition of Done - Mini-Release A

The team can answer YES to all:

| Question                                    | Answer                       |
| ------------------------------------------- | ---------------------------- |
| Can GAS accidentally re-enter the system?   | **No** - CI blocks it        |
| Do we know what backend /manage is calling? | **Yes** - logs prove it      |
| If staging fails, do we know why?           | **Yes** - from CI logs alone |

## Related Stories

- Story 3.3: Origin Invariants Documentation
- Story A1: Banned Origins CI Check
- Story 6: Events Page Tests
