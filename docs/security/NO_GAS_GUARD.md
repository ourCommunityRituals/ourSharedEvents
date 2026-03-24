# NO_GAS_GUARD - Google Apps Script Dependency Guard

## Overview

The `guard-no-gas` security guard is a CI-enforced mechanism that **FAILS the build** if any Google Apps Script (GAS) dependency or drift is introduced into the MVP codebase.

**Architectural Invariant**: This MVP uses a **Worker-only backend**. No GAS runtime dependencies are permitted in production code.

## Why This Guard Exists

This project has migrated from a Google Apps Script backend to a Cloudflare Worker-based architecture. The guard ensures:

1. **No regression**: Prevents accidental re-introduction of GAS dependencies
2. **Clean architecture**: Maintains the Worker-only backend invariant
3. **CI enforcement**: Catches violations early in the development cycle
4. **Explicit exceptions**: Any legacy references must be explicitly documented

> **If you add GAS dependencies, you are breaking the MVP architecture.**

## What It Scans

The guard scans the entire repository (excluding specific directories) for:

### Forbidden Domains/URLs
- `script.google.com` - GAS deployment URLs

### Forbidden Environment Variables
- `GAS_BASE_URL` - Legacy GAS configuration

### Forbidden Code Patterns
| Pattern | Description |
|---------|-------------|
| `doGet` | GAS HTTP handler function |
| `ContentService` | GAS content response API |
| `SpreadsheetApp` | GAS Sheets API |
| `PropertiesService` | GAS properties storage API |
| `ScriptApp` | GAS script management API |
| `UrlFetchApp` | GAS HTTP client API |
| `clasp` | GAS deployment tool |
| `action=api_` | Legacy GAS action parameter |
| `google.script.run` | GAS client-side API calls |

### Scanned File Types
- `.js`, `.ts`, `.tsx` - JavaScript/TypeScript
- `.json` - Configuration files
- `.yml`, `.yaml` - YAML configurations
- `.toml` - TOML configurations (Wrangler, etc.)
- `.md` - Markdown documentation
- `.html`, `.css` - Web assets
- `.env*` - Environment files

### Excluded Directories
- `node_modules/`
- `.git/`
- `dist/`, `build/`
- `.wrangler/`, `.turbo/`, `.next/`
- `coverage/`
- Test report directories

## How to Run Locally

```bash
# Run the guard
npm run guard:no-gas

# Run the guard tests
npm run test:guard-no-gas
```

## CI Integration

The guard runs in **both Stage-1 and Stage-2 CI workflows**:

- **Stage-1**: Runs before build/test steps (blocks merge)
- **Stage-2**: Runs before deploy steps (blocks deployment)

The CI job is named `guard-no-gas` and appears as a required status check.

## Adding an Allowlist Exception

Exceptions are managed in `scripts/guard-no-gas.allowlist.json`.

### When to Add an Exception

Only add exceptions for:
- Documentation files describing legacy architecture
- Specification documents referencing GAS patterns
- This guard's own code and tests

### When NOT to Add an Exception

Never add exceptions for:
- Production code
- Worker code
- Client-side code
- Configuration files that affect runtime

### Allowlist Format

```json
{
  "relative/path/to/file.md": ["SpreadsheetApp", "doGet"],
  "docs/legacy-architecture.md": ["*"]
}
```

- Keys are relative file paths from repository root
- Values are arrays of allowed tokens
- Use `["*"]` to allow all patterns in a file (use sparingly)

### Adding an Exception

1. Edit `scripts/guard-no-gas.allowlist.json`
2. Add the file path and specific tokens
3. Document WHY this exception is needed (in PR description)
4. Get security review approval

Example:
```json
{
  "docs/architecture/gas-migration-history.md": ["SpreadsheetApp", "doGet", "ContentService"]
}
```

## Examples of Typical Failures

### Failure: GAS Domain URL

```
   src/config.js
   Line 15: script.google.com (GAS deployment URL)
   const legacyUrl = "https://script.google.com/macros/s/xxx/exec";
```

**Fix**: Remove the URL or move to documentation with allowlist.

### Failure: GAS API Usage

```
   src/data.js
   Line 42: SpreadsheetApp (GAS SpreadsheetApp API)
   const sheet = SpreadsheetApp.getActiveSpreadsheet();
```

**Fix**: Replace with Worker-based Sheets API client.

### Failure: Legacy doGet Handler

```
   Code.gs
   Line 1: doGet (GAS HTTP handler function)
   function doGet(e) {
```

**Fix**: This file should not exist in MVP. Remove or archive.

### Failure: Client-Side GAS Call

```
   public/app.js
   Line 88: google.script.run (GAS client-side API call)
   google.script.run.withSuccessHandler(callback).getData();
```

**Fix**: Replace with Worker API fetch call.

## Guard Behavior

### Exit Codes
- `0` - Success (no forbidden patterns found)
- `1` - Failure (forbidden patterns detected OR guard error)

### Fail-Closed Design

The guard is designed to **fail-closed**:
- If the allowlist file is malformed: FAIL
- If a directory cannot be read: FAIL
- If a file cannot be read: FAIL

This ensures security violations are never silently ignored.

## Architecture Decision

This guard enforces **SEC-IAC-01**: The MVP backend is Worker-only.

Historical context:
- The original system used Google Apps Script
- Migration to Cloudflare Workers completed in v3.x
- This guard prevents any GAS drift or regression

## Related Files

- `scripts/guard-no-gas.js` - Main guard implementation
- `scripts/guard-no-gas.allowlist.json` - Allowlist configuration
- `scripts/guard-no-gas.test.js` - Unit tests
- `.github/workflows/stage1.yml` - Stage-1 CI integration
- `.github/workflows/stage2.yml` - Stage-2 CI integration

## Troubleshooting

### Guard fails but I need this code

1. First, confirm the code is truly necessary
2. If it's documentation, add to allowlist with justification
3. If it's production code, **refactor to use Worker APIs**
4. Never allowlist production code

### Guard fails on a dependency

Dependencies in `node_modules/` are excluded from scanning. If you see a failure mentioning `node_modules`, check:
- Is the path actually inside `node_modules`?
- Was a dependency accidentally copied outside?

### Guard is too slow

The guard scans all text files. If performance is an issue:
- Check for large auto-generated files
- Consider adding them to the excluded directories list
