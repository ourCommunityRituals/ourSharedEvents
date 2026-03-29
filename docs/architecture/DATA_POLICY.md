# Data Retention & Archiving Policy

This document describes the retention policy for diagnostic logs and telemetry data in the MVP Event Toolkit.

## Overview

The system generates three types of operational data:

| Sheet | Purpose | Retention Strategy |
|-------|---------|-------------------|
| `DIAG` | General diagnostic logs (info, warn, error, debug) | Rolling 10k rows + monthly archive |
| `LOG_ERRORS` | Structured error traces with correlation IDs | Rolling 5k rows + monthly archive |
| `ANALYTICS` | User/sponsor metrics (impressions, clicks, signups) | Permanent (business data) |

## DIAG Sheet

### What Gets Logged

- API errors and exceptions
- Schema validation failures
- CSRF token events
- Cache misses and rebuilds
- Security middleware events
- General diagnostic info/debug messages

### Columns

| Column | Description |
|--------|-------------|
| `ts` | ISO 8601 timestamp |
| `level` | Log level: `error`, `warn`, `info`, `debug` |
| `where` | Function or endpoint name |
| `msg` | Human-readable message |
| `meta` | JSON-serialized metadata (sanitized) |

### Retention Rules

1. **Active Sheet Limit**: Keep the most recent **10,000 rows** in the main `DIAG` sheet
2. **Daily Burst Limit**: Maximum **800 rows per day** to prevent runaway logging
3. **Archive Cadence**: Monthly archives created on the 1st of each month (or on-demand)

### Archive Naming

Archives are named with the pattern: `DIAG_ARCHIVE_YYYY_MM`

Example: `DIAG_ARCHIVE_2025_11` contains all DIAG entries from November 2025.

## LOG_ERRORS Sheet

### What Gets Logged

- Structured API errors with full context
- Stack traces
- Correlation IDs for request tracing
- Request parameters (sanitized)
- User agent information

### Columns

| Column | Description |
|--------|-------------|
| `ts` | ISO 8601 timestamp |
| `corrId` | Correlation ID for tracing |
| `endpoint` | API endpoint name |
| `method` | HTTP method (GET/POST) |
| `eventId` | Associated event ID |
| `errorName` | Error type/name |
| `message` | Error message |
| `stack` | Stack trace |
| `params` | Request parameters (sanitized JSON) |
| `postData` | POST body (sanitized JSON) |
| `userAgent` | Browser/client info |
| `severity` | ERROR, WARN, INFO |

### Retention Rules

1. **Active Sheet Limit**: Keep the most recent **5,000 rows**
2. **Archive Cadence**: Monthly archives alongside DIAG

### Archive Naming

Archives are named: `LOG_ERRORS_ARCHIVE_YYYY_MM`

## ANALYTICS Sheet

The ANALYTICS sheet contains business metrics and is **not subject to automatic archiving**.

- Impressions, clicks, QR scans, and signups are retained indefinitely
- Manual cleanup may be performed after events conclude
- SharedReport reads from this sheet for real-time dashboards

## Running the Archiver

### Manual Execution

From the Google Apps Script editor, run:

```javascript
rotateDiagLogs_()
```

This will:
1. Archive rows older than 30 days from `DIAG` to the current month's archive sheet
2. Archive rows older than 30 days from `LOG_ERRORS` to its archive sheet
3. Enforce the 10k/5k row limits on active sheets
4. Log completion status to the active DIAG sheet

### Scheduled Execution (Timer Trigger)

To set up automatic monthly archiving:

```javascript
// Run once to install the trigger
installDiagArchiveTrigger_()
```

This creates a monthly trigger that runs on the 1st of each month at 2 AM.

To remove the trigger:

```javascript
uninstallDiagArchiveTrigger_()
```

### Viewing Trigger Status

```javascript
listDiagArchiveTriggers_()
```

## Inspecting Archives

### Finding Archives

Archive sheets appear in the spreadsheet with names like:
- `DIAG_ARCHIVE_2025_11`
- `LOG_ERRORS_ARCHIVE_2025_11`

### Querying Archives

Archives maintain the same column structure as active sheets. You can:

1. **Filter by date range**: Sort by `ts` column
2. **Search by correlation ID**: Use Ctrl+F to find `corrId` values
3. **Filter by level/severity**: Filter column B for `error`, `warn`, etc.

### Archive Retention

- Archives are retained for **12 months** by default
- After 12 months, archives may be deleted or exported to external storage
- The `purgeOldArchives_()` function removes archives older than the retention period

## Configuration Constants

These values can be adjusted in `Code.gs`:

```javascript
const DIAG_SHEET = 'DIAG';
const DIAG_MAX = 3000;           // Hard cap for active sheet (inline cleanup)
const DIAG_PER_DAY = 800;        // Daily burst limit
const LOG_ERRORS_SHEET = 'LOG_ERRORS';
const LOG_ERRORS_MAX = 5000;     // Hard cap for error log sheet
```

Archive-specific configuration in `DiagArchiver.gs`:

```javascript
const DIAG_ARCHIVE_THRESHOLD = 10000;  // Archive when exceeding this
const DIAG_ARCHIVE_KEEP_DAYS = 30;     // Keep last 30 days in active sheet
const ARCHIVE_RETENTION_MONTHS = 12;   // Keep archives for 12 months
```

## Security Considerations

- All metadata is sanitized before logging (secrets, tokens stripped)
- Archive sheets inherit the same access controls as the parent spreadsheet
- No PII should be logged; if found, it should be reported and purged

## Troubleshooting

### "Sheet is slow to load"

Run `rotateDiagLogs_()` to archive old entries. If the sheet has grown beyond 10k rows, this will move older entries to archives.

### "Missing logs from last month"

Check the archive sheet for that month: `DIAG_ARCHIVE_YYYY_MM`

### "Archive trigger not running"

1. Run `listDiagArchiveTriggers_()` to verify trigger exists
2. Check Apps Script dashboard for execution errors
3. Reinstall with `installDiagArchiveTrigger_()`

### "Too many archive sheets"

Run `purgeOldArchives_()` to remove archives older than 12 months.
