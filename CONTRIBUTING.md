# Contributing to Zeventbook MVP

## Before You Push

**You must be able to run `npm run ci:all` locally before pushing.**

This is a hard requirement. The CI pipeline will reject any code that fails `ci:all`.

```bash
# Run the full CI gate locally
npm run ci:all

# For detailed output on failures
npm run ci:all:verbose
```

## What ci:all Validates

The `ci:all` gate runs all contract guards that protect the codebase:

| Guard | Purpose |
|-------|---------|
| MVP Surfaces | Only 5 surfaces allowed: admin, public, display, poster, report |
| RPC Inventory | API inventory comment matches actual usage |
| API vs Schemas | All api_* functions have corresponding schemas |
| Event Schema | Event schema consistency validation |
| Service Tests | form-service, sponsor-service, security-middleware |
| Dead Exports | No unused api_* functions in Code.gs |
| Schema Fields | HTML surfaces only reference schema-defined fields |
| Analytics Schema | Analytics schema consistency |
| Banned Origins | No GAS URLs (`script.google.com`) in CI/runtime code |

## Origin Invariants

**All public traffic flows through Cloudflare Workers.** This is a first-class invariant.

### Allowed Origins (CI/Runtime)

| Environment | URL |
|-------------|-----|
| Staging | `https://stg.eventangle.com` |
| Production | `https://www.eventangle.com` |

### GAS Direct is BANNED

`script.google.com` URLs are **never** allowed in CI or runtime code.

GAS Direct may **only** be used for:
- Local, manual debugging
- Explicitly allowlisted files (archive, docs, schemas)

The `check-banned-origins` script enforces this as a **Stage-1 hard gate**:

```bash
npm run check:banned-origins
```

### Quick Check for New Features

Before any PR, ask yourself:

1. **Does this call any URL not under `eventangle.com`?** If yes, why?
2. **Any `script.google.com` references?** If yes, reject (unless allowlisted for local debug).

See [docs/origins.md](./docs/origins.md) for full details on origin invariants.

## Development Workflow

1. **Create a feature branch** from `main`
2. **Make your changes**
3. **Run `npm run ci:all`** - fix any failures before proceeding
4. **Commit your changes** with a descriptive message
5. **Push and create a PR** to `main`
6. **CI will run `ci:all`** - if it passes, the PR can be merged
7. **Deployment is automatic** - merging to `main` triggers deployment

## CI Pipeline

```
PR to main/release
        |
        v
   [ci:all gate]  <-- Blocks merge if failed
        |
        v (merge)
   [Stage 1: Build & Deploy]
        |
        +-- lint
        +-- unit-tests
        +-- contract-tests
        +-- mvp-guards
        +-- ci:all gate  <-- Blocks deployment if failed
        |
        v (deploy)
   [Stage 2: E2E Testing]
        |
        +-- API tests
        +-- Smoke tests
        +-- Flow tests
        +-- Page tests
        |
        v
   [Production Gate]
```

## Quick Commands

```bash
# REQUIRED before pushing
npm run ci:all

# Faster alternative (critical checks only)
npm run ci:all:fast

# Run with verbose output
npm run ci:all:verbose

# Run tests locally
npm run test:unit          # Unit tests
npm run test:contract      # Contract tests
npm run lint               # ESLint
```

## Getting Help

- Check existing tests for patterns
- Run `npm run ci:all:verbose` for detailed failure info
- See [tests/README.md](./tests/README.md) for test documentation
