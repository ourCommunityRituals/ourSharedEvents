# QA Observability Infrastructure

## Overview

**Observability-focused** testing infrastructure for MVP Event Toolkit. This is NOT a smart automation system that skips tests. All tools provide **visibility and context**, not automated decision-making.

## 🎯 Core Principle

> **All tests run. Historical data provides context, not automation.**

This infrastructure helps you:
- ✅ See test trends over time
- ✅ Identify flaky or slow tests
- ✅ Get fast feedback (prioritization, not selection)
- ✅ Visualize test health with dashboards

It does **NOT**:
- ❌ Skip tests based on history
- ❌ Make automated decisions to exclude tests
- ❌ Reduce test coverage

## 📁 Components

```
tests/
├── shared/
│   ├── test-data-manager.js        # Test data seeding & cleanup
│   ├── test-results-tracker.js     # Results aggregation & metrics
│   ├── test-prioritizer.js         # Prioritize order (NOT select subset)
│   └── generate-dashboard.js       # Visual dashboards
├── .test-data/                     # Test data storage
│   ├── snapshots/                  # Data snapshots
│   └── seeds/                      # Seed data
├── .test-results/                  # Results storage
│   ├── runs/                       # Test run results
│   ├── metrics/                    # Metrics data
│   └── trends/                     # Trend data
└── test-dashboard/                 # Generated dashboards
    └── index.html                  # Main dashboard
```

## 🧩 What Each Component Does

### 1. **Test Data Manager** ✅ KEEP
**Purpose**: Seed and cleanup test data

```bash
# Seed test data
npm run qa:seed                    # Standard (3 events + sponsors)
npm run qa:seed:comprehensive      # All scenarios
npm run qa:seed:triangle:before    # Before event phase
npm run qa:seed:triangle:during    # During event phase
npm run qa:seed:triangle:after     # After event phase

# Cleanup
npm run qa:cleanup

# View snapshots
npm run qa:snapshots
```

**Strategies**:
- `minimal`: 1 event (quick testing)
- `standard`: 3 events + sponsors (default)
- `comprehensive`: All scenarios
- `triangleBefore`: Pre-event setup data
- `triangleDuring`: Live event data
- `triangleAfter`: Completed event data

### 2. **Test Results Tracker** ✅ KEEP
**Purpose**: Track test results and calculate metrics (for observability, not automation)

```bash
# View results
npm run qa:results:summary     # Latest run summary
npm run qa:results:trends      # Historical trends
npm run qa:results:anomalies   # Detect anomalies
npm run qa:results:history     # Show test history
npm run qa:results:export      # Export to CSV
```

**What it tracks**:
- Success rates over time
- Test duration trends
- Flaky test detection
- Anomalies (with context, not decisions)

**Example anomaly output**:
```
⚠️ "admin-page.spec.js" was stable for 30 runs but is now failing
→ This indicates a real regression
```

### 3. **Test Prioritizer** ✅ KEEP (Refactored)
**Purpose**: Reorder tests for fast feedback (does NOT skip tests)

```bash
# Prioritize tests (all tests still run)
npm run qa:prioritize

# Analyze test history
npm run qa:analyze

# Find flaky tests
npm run qa:flaky

# Get optimization recommendations
npm run qa:recommendations
```

**How it works**:
- Analyzes test history
- Calculates risk scores
- **Reorders tests** (high-risk first)
- All tests still run, just in priority order

**Example output**:
```
⚠️ ALL 50 TESTS WILL RUN

Execution Phases (for fast feedback):
   Critical: 6 tests (run first) - recently failed, flaky, critical path
   High:     8 tests
   Medium:   12 tests
   Low:      24 tests (stable, run last)

⚠️ Note: This does NOT skip tests. All tests run, just in priority order.
```

### 4. **Dashboard Generator** ✅ KEEP
**Purpose**: Visual dashboards for test health

```bash
npm run qa:dashboard
```

Opens: `test-dashboard/index.html`

**Features**:
- Success rate charts
- Duration trends
- Anomaly alerts
- Test history tables
- Recommendations

## 🚀 How to Use This Infrastructure

### Quick Start

1. **Seed test data**:
   ```bash
   npm run qa:seed
   ```

2. **Run your tests** (unchanged):
   ```bash
   npm run test:e2e
   ```

3. **View results**:
   ```bash
   npm run qa:results:summary
   npm run qa:dashboard
   ```

4. **Cleanup**:
   ```bash
   npm run qa:cleanup
   ```

### In CI/CD (GitHub Actions)

Your existing Stage 2 workflow already runs all tests. Add observability:

```yaml
# .github/workflows/stage2-testing.yml

# After running tests
- name: Generate dashboard
  if: always()
  run: npm run qa:dashboard

- name: Check for anomalies
  if: always()
  run: npm run qa:results:anomalies
```

**Don't change the test execution**. Stage 2 already has a good strategy:
1. Health check
2. Critical tests (API + Smoke) - for fast feedback
3. Failure gate (based on CURRENT run, not history) - good!
4. Expensive tests (if critical passed)
5. Quality gate
6. Deploy

### Prioritization (Optional)

If you want to reorder tests (all still run):

```bash
# Get prioritized test order
npm run qa:prioritize

# Manually run in that order
# (or use the phases output to structure your CI/CD)
```

**But be careful**: Your existing parallel execution is probably better for total time.

## 📊 Example Workflows

### Workflow 1: Identify Flaky Tests

```bash
# Run tests
npm run test:e2e

# Find flaky tests
npm run qa:flaky

# Output:
# ⚠️  Flaky Tests:
#   - admin-flows.spec.js
#   - sponsor-page.spec.js
```

### Workflow 2: Investigate Performance Degradation

```bash
# View trends
npm run qa:results:trends

# Get recommendations
npm run qa:recommendations

# Output:
# 💡 Test Optimization Recommendations:
# [HIGH] 3 slow test(s) detected (>5s)
#   - advanced-display-features.spec.js
#   - poster-maps-integration.spec.js
# Action: Optimize or split these tests
```

### Workflow 3: Anomaly Detection

```bash
# After tests fail unexpectedly
npm run qa:results:anomalies

# Output:
# ⚠️ "api-contract.spec.js" was stable for 30 runs but is now failing
# → This indicates a real regression
```

## 🔍 Observability, Not Automation

| Component | Purpose | Decision Making |
|-----------|---------|-----------------|
| **Test Data Manager** | Seed/cleanup | Manual |
| **Results Tracker** | Metrics & trends | Informational only |
| **Test Prioritizer** | Reorder (all run) | Suggests order, you decide |
| **Dashboard** | Visualization | Display only |

**Key point**: All components are **informational**. They don't skip tests or make automated decisions.

## 🎯 Best Practices

### DO ✅

1. **Use test data manager** for consistent test data
2. **Track all test results** for visibility
3. **Generate dashboards** after CI/CD runs
4. **Investigate anomalies** when stable tests fail
5. **Fix flaky tests** when detected
6. **Run all tests** in CI/CD

### DON'T ❌

1. **Don't skip tests** based on historical patterns
2. **Don't use prioritization to reduce coverage**
3. **Don't trust history** to predict new bugs
4. **Don't add the orchestrator** (removed - too complex)
5. **Don't break parallel execution** for prioritization

## 📝 NPM Scripts Reference

### Test Data
```bash
npm run qa:seed                    # Seed standard data
npm run qa:seed:comprehensive      # Seed all scenarios
npm run qa:seed:triangle:before    # Before event phase
npm run qa:seed:triangle:during    # During event phase
npm run qa:seed:triangle:after     # After event phase
npm run qa:cleanup                 # Cleanup test data
npm run qa:snapshots               # List snapshots
```

### Test Analysis (Observability)
```bash
npm run qa:prioritize              # Show prioritized test order (all run)
npm run qa:analyze                 # Analyze test history
npm run qa:flaky                   # List flaky tests
npm run qa:recommendations         # Get optimization tips
```

### Results & Metrics
```bash
npm run qa:results:summary         # Latest run summary
npm run qa:results:trends          # Historical trends
npm run qa:results:anomalies       # Detect anomalies
npm run qa:results:history         # Show test history
npm run qa:results:export          # Export to CSV
npm run qa:dashboard               # Generate visual dashboard
```

## 🔧 Integration with Existing Pipeline

Your current Stage 1 & Stage 2 workflows are **already robust**. Don't change them. This infrastructure adds **observability**, not automation.

### Stage 1 (Build & Deploy)
- ✅ Keep as-is
- ✅ Lint, Unit Tests, Contract Tests, Deploy
- Optional: Add `npm run qa:results:summary` at end

### Stage 2 (Testing & QA)
- ✅ Keep progressive testing strategy (it's good!)
- ✅ Keep failure gate (it's based on current run, not history)
- Optional: Add `npm run qa:dashboard` after tests
- Optional: Add `npm run qa:results:anomalies` for context

**Don't change test execution logic**. Stage 2 already has:
- Fast feedback (critical tests first)
- Cost optimization (failure gate)
- Parallel execution
- Quality gates

## ⚠️ What We Removed

1. **Intelligent Test Selector** → **Test Prioritizer**
   - Before: Skipped tests based on history
   - Now: Reorders tests (all still run)

2. **Automation Orchestrator** → Removed
   - Too complex
   - Defeated concurrency
   - Use individual components in CI/CD instead

3. **Historical Decision Making** → Observability
   - Before: History used to skip/change tests
   - Now: History provides context for humans

## 🔗 Related Documentation

- [Triangle Test Organization](./docs/TRIANGLE_TEST_ORGANIZATION.md)
- [Stage 1 Workflow](../.github/workflows/stage1-deploy.yml)
- [Stage 2 Workflow](../.github/workflows/stage2-testing.yml)
- [Playwright Config](../playwright.config.js)
- [Jest Config](../jest.config.js)

## 📞 Summary

This infrastructure provides:

✅ **Test Data Management**: Consistent seeding/cleanup
✅ **Results Tracking**: Metrics and trends over time
✅ **Test Prioritization**: Reorder for fast feedback (all tests run)
✅ **Visual Dashboards**: Beautiful charts and insights
✅ **Anomaly Detection**: Context when stable tests fail
✅ **Flaky Test Detection**: Identify tests needing attention

It does **NOT**:
❌ Skip tests based on history
❌ Make automated decisions
❌ Reduce test coverage
❌ Replace human judgment

**Use it for visibility, not automation.**

---

**Version**: 1.3.1 (Refactored - Observability Focus)
**Built for**: MVP Event Toolkit (Zeventbooks)
**Environments**: qa.zeventbooks.com & zeventbooks.com
