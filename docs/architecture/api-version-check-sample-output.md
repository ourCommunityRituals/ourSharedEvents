# API Version Check - Sample Output (Story 3.2)

This document shows example output from the API version comparison tool.

## Console Output (Pass - All Identical)

```
======================================================================
API VERSION COMPATIBILITY REPORT (Story 3.2)
======================================================================

SUMMARY
----------------------------------------
Status:        PASS
Timestamp:     2024-12-11T10:30:00.000Z
Duration:      2345ms
Endpoints:     3
Compared:      3
Identical:     3
Compatible:    3
Mismatches:    0
Fetch Errors:  0

ENVIRONMENTS
----------------------------------------
Staging:    https://api-stg.eventangle.com
Production: https://api.eventangle.com

ENDPOINT RESULTS
----------------------------------------

[status]
  Path: /exec?p=status&brand=root
  Description: System health status (flat format)
  Staging: OK (HTTP 200)
  Production: OK (HTTP 200)
  Contract: IDENTICAL

[statusmvp]
  Path: /exec?p=statusmvp&brand=root
  Description: MVP analytics health status (flat format)
  Staging: OK (HTTP 200)
  Production: OK (HTTP 200)
  Contract: IDENTICAL

[getEventTemplates]
  Path: /exec?p=getEventTemplates&brand=root
  Description: Event templates list
  Staging: OK (HTTP 200)
  Production: OK (HTTP 200)
  Contract: IDENTICAL

======================================================================
Overall Status: PASS
======================================================================
```

## Console Output (Warning - Compatible with Differences)

```
======================================================================
API VERSION COMPATIBILITY REPORT (Story 3.2)
======================================================================

SUMMARY
----------------------------------------
Status:        WARNING
Timestamp:     2024-12-11T10:30:00.000Z
Duration:      2567ms
Endpoints:     3
Compared:      3
Identical:     2
Compatible:    3
Mismatches:    0
Fetch Errors:  0

ENVIRONMENTS
----------------------------------------
Staging:    https://api-stg.eventangle.com
Production: https://api.eventangle.com

ENDPOINT RESULTS
----------------------------------------

[status]
  Path: /exec?p=status&brand=root
  Description: System health status (flat format)
  Staging: OK (HTTP 200)
  Production: OK (HTTP 200)
  Contract: COMPATIBLE (1 warnings)
    - [warning] db: field_missing_production

[statusmvp]
  Path: /exec?p=statusmvp&brand=root
  Description: MVP analytics health status (flat format)
  Staging: OK (HTTP 200)
  Production: OK (HTTP 200)
  Contract: IDENTICAL

[getEventTemplates]
  Path: /exec?p=getEventTemplates&brand=root
  Description: Event templates list
  Staging: OK (HTTP 200)
  Production: OK (HTTP 200)
  Contract: IDENTICAL

======================================================================
Overall Status: WARNING
======================================================================
```

## Console Output (Fail - Contract Mismatch)

```
======================================================================
API VERSION COMPATIBILITY REPORT (Story 3.2)
======================================================================

SUMMARY
----------------------------------------
Status:        FAIL
Timestamp:     2024-12-11T10:30:00.000Z
Duration:      2890ms
Endpoints:     3
Compared:      3
Identical:     1
Compatible:    2
Mismatches:    1
Fetch Errors:  0

ENVIRONMENTS
----------------------------------------
Staging:    https://api-stg.eventangle.com
Production: https://api.eventangle.com

ENDPOINT RESULTS
----------------------------------------

[status]
  Path: /exec?p=status&brand=root
  Description: System health status (flat format)
  Staging: OK (HTTP 200)
  Production: OK (HTTP 200)
  Contract: MISMATCH (1 errors, 0 warnings)
    - [error] ok: type_mismatch
      Staging: boolean
      Production: string

[statusmvp]
  Path: /exec?p=statusmvp&brand=root
  Description: MVP analytics health status (flat format)
  Staging: OK (HTTP 200)
  Production: OK (HTTP 200)
  Contract: IDENTICAL

[getEventTemplates]
  Path: /exec?p=getEventTemplates&brand=root
  Description: Event templates list
  Staging: OK (HTTP 200)
  Production: OK (HTTP 200)
  Contract: IDENTICAL

======================================================================
Overall Status: FAIL
======================================================================
```

## JSON Output (for CI)

```json
{
  "status": "pass",
  "summary": {
    "timestamp": "2024-12-11T10:30:00.000Z",
    "duration": "2345ms",
    "totalEndpoints": 3,
    "successfulComparisons": 3,
    "failedFetches": 0,
    "identicalContracts": 3,
    "compatibleContracts": 3,
    "contractMismatches": 0
  },
  "results": [
    {
      "name": "status",
      "path": "/exec?p=status&brand=root",
      "description": "System health status (flat format)",
      "timestamp": "2024-12-11T10:30:00.000Z",
      "staging": {
        "success": true,
        "error": null,
        "response": {
          "status": 200,
          "body": {
            "ok": true,
            "buildId": "stg-v1.3.0-abc123",
            "brandId": "root",
            "time": "2024-12-11T10:30:00.000Z"
          }
        }
      },
      "production": {
        "success": true,
        "error": null,
        "response": {
          "status": 200,
          "body": {
            "ok": true,
            "buildId": "prod-v1.3.0-def456",
            "brandId": "root",
            "time": "2024-12-11T10:30:00.123Z"
          }
        }
      },
      "comparison": {
        "endpoint": "status",
        "identical": true,
        "compatible": true,
        "differences": [],
        "summary": {
          "total": 0,
          "errors": 0,
          "warnings": 0
        }
      }
    }
  ],
  "environments": {
    "staging": {
      "name": "Staging",
      "baseUrl": "https://api-stg.eventangle.com"
    },
    "production": {
      "name": "Production",
      "baseUrl": "https://api.eventangle.com"
    }
  }
}
```

## Markdown Output (for GitHub Issues)

```markdown
# API Version Compatibility Report :white_check_mark:

**Story 3.2**: Staging/Production API Contract Comparison

## Summary

| Metric | Value |
|--------|-------|
| Status | **PASS** |
| Timestamp | 2024-12-11T10:30:00.000Z |
| Duration | 2345ms |
| Endpoints Tested | 3 |
| Successful Comparisons | 3 |
| Identical Contracts | 3 |
| Contract Mismatches | 0 |

## Environments

- **Staging**: https://api-stg.eventangle.com
- **Production**: https://api.eventangle.com

## Endpoint Results

### :white_check_mark: status

- **Path**: `/exec?p=status&brand=root`
- **Description**: System health status (flat format)
- **Staging**: OK
- **Production**: OK
- **Contract**: Identical :white_check_mark:

### :white_check_mark: statusmvp

- **Path**: `/exec?p=statusmvp&brand=root`
- **Description**: MVP analytics health status (flat format)
- **Staging**: OK
- **Production**: OK
- **Contract**: Identical :white_check_mark:

### :white_check_mark: getEventTemplates

- **Path**: `/exec?p=getEventTemplates&brand=root`
- **Description**: Event templates list
- **Staging**: OK
- **Production**: OK
- **Contract**: Identical :white_check_mark:
```

## Usage Examples

### Run basic comparison
```bash
npm run compare:api-versions
```

### Save JSON report for CI
```bash
npm run compare:api-versions:json > api-version-report.json
```

### Generate Markdown for GitHub issue
```bash
npm run compare:api-versions:markdown > api-version-report.md
```

### Run with specific endpoints
```bash
node scripts/compare-api-versions.mjs --endpoints status,statusmvp
```

### Run Jest tests (unit tests only, no network)
```bash
npm run test:story3.2
```

### Run Jest tests with live API comparison
```bash
npm run test:story3.2:live
```

## CI/CD Integration

The API version check runs:
1. **Nightly** (2 AM UTC) via GitHub Actions schedule
2. **On-demand** via manual workflow dispatch
3. **After production deployments** via workflow_run trigger

When mismatches are detected:
- A GitHub issue is automatically created with the `api-contract-mismatch` label
- The workflow exits with code 1
- The full report is attached as an artifact

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All contracts identical or compatible |
| 1 | Contract mismatches detected (errors) |
| 2 | Fetch errors occurred |
| 3 | Invalid arguments |
