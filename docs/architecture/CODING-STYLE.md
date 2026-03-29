# Coding Style Guide

This document outlines the coding standards and ESLint configuration for the MVP Event Toolkit project.

## Story 2.2: ESLint Static Code Analysis

ESLint runs automatically on every push and pull request via the CI pipeline. Code that violates critical lint rules will fail the pipeline.

## Quick Start

```bash
# Run lint locally (same as CI)
npm run lint

# Auto-fix fixable issues
npm run lint:fix

# Strict mode - fail on any warnings (future CI behavior)
npm run lint:ci

# Generate JSON report
npm run lint:report
```

## ESLint Configuration

The project uses ESLint's flat config format (`eslint.config.js`) with rules tailored for:

- Google Apps Script (.gs files)
- Node.js scripts
- Cloudflare Workers
- Jest tests
- Playwright E2E tests

### Critical Rules (Errors - Fail CI)

| Rule | Description | Why |
|------|-------------|-----|
| `semi` | Require semicolons | Prevents ASI issues |

### Warning Rules (Tracked - Don't Fail CI Yet)

| Rule | Description | Status |
|------|-------------|--------|
| `no-unused-vars` | Unused variables | Many false positives in GAS due to cross-file refs |
| `no-undef` | Undefined variables | Many false positives in GAS due to cross-file refs |
| `no-console` | Console statements | Allowed in scripts/tests, warn in prod code |
| `no-var` | Prefer let/const | Gradual migration |
| `eqeqeq` | Strict equality | Use `===` instead of `==` |
| `curly` | Require braces | For multi-line blocks |

## Google Apps Script Specifics

GAS files (.gs) are concatenated by Google Apps Script at runtime, meaning:
- Functions defined in one file are available in all files
- Global variables are shared across files
- ESLint can't see cross-file references

This is why `no-unused-vars` and `no-undef` are set to `warn` for .gs files - many apparent violations are actually valid cross-file references.

### Naming Conventions for GAS

```javascript
// Public API functions - called from Code.gs router
function api_createEvent(req) { }
function api_getStatus(req) { }

// Service functions - called from other .gs files
function FormService_listTemplates() { }
function SecurityMiddleware_sanitizeInput(input) { }

// Internal helpers - underscore suffix
function findBrand_(brandId) { }
function getDb_() { }
function diag_(message) { }

// Constants - UPPER_SNAKE_CASE
const ERR = { NOT_FOUND: 'NOT_FOUND' };
const BRANDS = {};
```

## File-Specific Rules

### Production Code (src/mvp/*.gs)

```javascript
// DO: Use Logger instead of console in GAS
Logger.log('Processing event: ' + eventId);

// DON'T: Use console.log in GAS production code
console.log('This will work but Logger is preferred');

// DO: Use semicolons consistently
const result = processData();

// DON'T: Omit semicolons
const result = processData()  // Missing semicolon

// DO: Use const/let instead of var
const brandId = req.brandId;
let counter = 0;

// DON'T: Use var (legacy)
var brandId = req.brandId;  // Use const instead
```

### Scripts (scripts/*.js)

```javascript
// Console is allowed in scripts
console.log('Script starting...');

// Process.exit for CLI tools
if (!args.length) {
  console.error('Usage: node script.js <arg>');
  process.exit(1);
}
```

### Tests (tests/**/*.js)

```javascript
// Console is allowed in tests
console.log('Test data:', testData);

// Unused variables in mock setups are OK
const { unused, ...rest } = mockData;  // Destructuring for exclusion

// Use _ prefix for intentionally unused parameters
test('handles callback', (_unusedParam) => {
  // ...
});
```

### Cloudflare Workers (cloudflare-proxy/*.js)

```javascript
// Console is allowed for observability
console.log('Request received:', request.url);

// Use DEPRECATED suffix for deprecated code
const proxyRequest_DEPRECATED = () => { };  // Won't trigger unused warning
```

## Exceptions and Suppressions

### Inline Suppressions

Use sparingly and document why:

```javascript
// eslint-disable-next-line no-unused-vars -- Called by GAS runtime
function onOpen(e) {
  // ...
}

/* eslint-disable no-console -- CLI script requires console output */
console.log('Processing...');
/* eslint-enable no-console */
```

### Documented Exceptions

The following patterns are documented exceptions:

1. **GAS API Functions**: Functions prefixed with `api_` appear unused but are called by the Code.gs router
2. **Service Functions**: Functions prefixed with `Service_` or `Middleware_` are cross-file references
3. **Internal Helpers**: Functions with `_` suffix are intentionally non-exported utilities

## Reproducing CI Results Locally

The CI runs `npm run lint`. To get the exact same results locally:

```bash
# Install dependencies
npm install

# Run lint
npm run lint

# Expected output on success:
# ✖ 0 problems (0 errors, 0 warnings)
# or
# ✖ N problems (0 errors, N warnings)  # Warnings don't fail CI
```

## Gradual Improvement Plan

Current status: 0 errors, ~360 warnings

The warnings are tracked and will be addressed over time:
- Phase 1: Fix errors (DONE - CI now passes)
- Phase 2: Reduce `no-unused-vars` warnings in scripts
- Phase 3: Reduce `no-var` usage
- Phase 4: Enable `lint:ci` (--max-warnings 0) in CI

## Integration with IDE

### VS Code

Install the ESLint extension and add to `.vscode/settings.json`:

```json
{
  "eslint.validate": ["javascript"],
  "eslint.useFlatConfig": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  }
}
```

### WebStorm/IntelliJ

1. Go to Settings > Languages & Frameworks > JavaScript > Code Quality Tools > ESLint
2. Enable "Automatic ESLint configuration"
3. Check "Run eslint --fix on save"

## Related Documentation

- [CI/CD Architecture](ci-cd-architecture.md) - Pipeline overview
- [Architecture](ARCHITECTURE.md) - System architecture
- [MVP File Map](MVP-FILE-MAP.md) - Project structure
