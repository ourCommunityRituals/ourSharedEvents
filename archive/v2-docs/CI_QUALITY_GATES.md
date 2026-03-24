# CI Quality Gates & Cost Control

> **MVP SRE Policy**: Minimize CI minutes while maintaining quality gates.

---

## Pipeline Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           STAGE 1 - Build & Deploy                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  Triggers: push to main, push to release/*, PRs to main                     │
│                                                                             │
│  Jobs (parallel):                                                           │
│    ├─ lint (ESLint)                                                         │
│    ├─ unit-tests (Jest)                                                     │
│    └─ contract-tests (Jest - API contracts)                                 │
│                                                                             │
│  Gate: ALL must pass to proceed to deploy                                   │
│                                                                             │
│  Deploy: Only on push to main/release (not PRs)                             │
│    └─ Apps Script (clasp push)                                              │
│    └─ Cloudflare Worker (optional)                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ workflow_run (on success)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STAGE 2 - Sequential Progressive Testing                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Triggers:                                                                  │
│    ├─ workflow_run: main, release/* (auto after Stage 1)                    │
│    └─ workflow_dispatch: manual "I want full regression"                    │
│                                                                             │
│  NOT triggered on: feature branches (cost control)                          │
│                                                                             │
│  Sequence:                                                                  │
│    1. API Tests (Playwright) ─────────────┐                                 │
│                                           │                                 │
│    2. Gate 1: API passed? ────────────────┤                                 │
│       │ NO  → STOP (save expensive tests) │                                 │
│       │ YES → continue                    │                                 │
│                                           ▼                                 │
│    3. Smoke Tests (Playwright) ───────────┐                                 │
│                                           │                                 │
│    4. Gate 2: Smoke passed? ──────────────┤                                 │
│       │ NO  → STOP (save expensive tests) │                                 │
│       │ YES → continue                    │                                 │
│                                           ▼                                 │
│    5. Expensive Tests (Flow + Page)                                         │
│       └─ Only run if Smoke passed                                           │
│                                                                             │
│  Final Quality Gate: All stages must pass                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## When Tests Run

| Event | Stage 1 | Stage 2 |
|-------|---------|---------|
| PR to main | lint + unit + contract | **NO** (cost control) |
| Push to main | lint + unit + contract + **deploy** | **YES** (full Playwright) |
| Push to release/* | lint + unit + contract + **deploy** | **YES** (full Playwright) |
| Push to feature/* | **NO** | **NO** |
| Manual dispatch | - | **YES** (any URL) |

---

## Cost Control Strategy

### Feature Branches
- **No Playwright tests** - feature branches only run lint + Jest locally
- PRs to main run Stage 1 (lint + unit + contract) but NOT Stage 2
- This saves 10-15 minutes of Playwright time per feature branch

### Progressive Failure Gates
- API tests fail → Skip Smoke + Expensive tests
- Smoke tests fail → Skip Expensive tests
- This prevents wasting minutes on downstream tests when upstream fails

### Test Minutes Budget (Estimate)

| Test Suite | ~Minutes | When Runs |
|------------|----------|-----------|
| lint | 1 | Every PR + push |
| unit-tests | 2 | Every PR + push |
| contract-tests | 2 | Every PR + push |
| API tests (Playwright) | 3 | main/release only |
| Smoke tests (Playwright) | 5 | main/release only |
| Expensive tests (Playwright) | 8 | main/release only |

**Per PR**: ~5 minutes (Stage 1 only)
**Per main push**: ~21 minutes (Stage 1 + Stage 2)

---

## Separate Workflows (Not MVP Gates)

These run independently and don't block deploys:

| Workflow | Purpose | Triggers |
|----------|---------|----------|
| `codeql-analysis.yml` | Security scanning | Weekly + PRs |
| `load-testing.yml` | Performance testing | Manual |

---

## Quality Gate Checklist

### Stage 1 (Required for Deploy)
- [ ] ESLint passes (0 errors)
- [ ] Jest unit tests pass
- [ ] Jest contract tests pass

### Stage 2 (Required for Release)
- [ ] Playwright API tests pass
- [ ] Playwright Smoke tests pass
- [ ] Playwright Expensive tests pass (flows + pages)

---

## Commands

### Local = CI (same commands)

```bash
# Stage 1: lint + unit + contract (no BASE_URL needed)
npm run test:ci:stage1

# Stage 2: api + fe (requires BASE_URL)
BASE_URL=https://eventangle.com npm run test:ci:stage2
```

### Individual Test Suites

```bash
# Lint only
npm run lint

# Unit tests only
npm run test:unit

# Contract tests only
npm run test:contract

# API tests (Playwright)
BASE_URL=https://eventangle.com npm run test:api

# Frontend tests (smoke + pages + flows)
BASE_URL=https://eventangle.com npm run test:fe

# Individual suites
BASE_URL=https://eventangle.com npm run test:smoke
BASE_URL=https://eventangle.com npm run test:pages
BASE_URL=https://eventangle.com npm run test:flows
```

### Quick Validation

```bash
# Quick check before PR (lint + unit + api + smoke)
BASE_URL=https://eventangle.com npm run test:quick

# Full CI locally
npm run test:ci:stage1 && BASE_URL=https://eventangle.com npm run test:ci:stage2
```

---

*Last updated: 2025-11-22*
