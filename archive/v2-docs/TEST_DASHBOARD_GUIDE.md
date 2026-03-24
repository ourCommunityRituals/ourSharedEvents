# Test History Dashboard Guide

## What Is This?

A **persistent test history dashboard** that tracks all test executions over time. Unlike Playwright's built-in HTML reporter (which only shows one run at a time), this dashboard:

✅ **Stores test results indefinitely** (configurable retention)
✅ **Tracks trends over time** (daily pass/fail rates)
✅ **Filters by date range** (1 day, 7 days, 30 days, custom)
✅ **Searches across all test runs** (by test name, error message, etc.)
✅ **Auto-refreshes in real-time** (30-second interval)
✅ **Works with ALL test types** (Jest unit/contract + Playwright API/smoke/pages/flows)

## Quick Start

### Step 1: Open the Dashboard

```bash
# Start the dashboard server
npm run test:dashboard
```

This will start a web server and print:

```
╔════════════════════════════════════════════════════════╗
║  🧪  Test Dashboard Server Running                     ║
╚════════════════════════════════════════════════════════╝

📊 Dashboard URL:  http://localhost:3000
```

**Open your browser to http://localhost:3000**

### Step 2: Run Tests (in another terminal)

```bash
# Run any test suite
npm run test:unit         # Unit tests
npm run test:contract     # Contract tests
npm run test:api          # API tests
npm run test:smoke        # Smoke tests
npm run test:quick        # Fast tests (unit+contract+api+smoke)
npm run test:all          # Everything
```

### Step 3: Watch Results Appear

- Results automatically save to `.test-results/test-history.json`
- Dashboard shows them immediately (or enable auto-refresh for 30s updates)
- All historical runs are preserved

## Dashboard Features

### 📊 Stats Cards

- **Total Runs**: Number of test executions
- **Success Rate**: Percentage of passing tests
- **Failed Tests**: Number of failures
- **Flaky Tests**: Tests that passed on retry
- **Avg Duration**: Average test execution time

### 📈 Trend Chart

- Visual timeline of passed/failed tests
- Grouped by day
- Shows trends over selected date range

### 📋 Test Runs Table

| Column | Description |
|--------|-------------|
| Suite | Test suite name (api, smoke, unit, etc.) |
| Date/Time | When the test ran |
| Tests | Pass/fail counts (e.g., "45/50" = 45 passed out of 50 total) |
| Pass Rate | Visual progress bar + percentage |
| Duration | How long the test took |
| Status | PASSED or FAILED badge |
| Branch | Git branch name |
| Report | Link to HTML report (if available) |

### 🔍 Filters

**Date Range:**
- Last 24 Hours
- Last 7 Days
- Last 30 Days (default)
- Last 90 Days
- Custom Range (pick from/to dates)

**Test Suite:**
- All Suites
- API Tests
- Smoke Tests
- Page Tests
- Flow Tests
- Unit Tests
- Contract Tests

**Search:**
- Full-text search across test names and error messages
- Updates table in real-time as you type

**Auto-Refresh:**
- Check the "Auto-refresh (30s)" box
- Dashboard polls for new results every 30 seconds
- Perfect for leaving open while running tests

### 📥 Export

Click "Export CSV" to download test results as a spreadsheet:

```csv
Suite,Start Time,Duration (s),Total Tests,Passed,Failed,Skipped,Flaky,Branch,Commit,Environment
api,2024-11-20T10:30:00.000Z,45.23,74,74,0,0,0,main,a4e259f,local
unit,2024-11-20T10:29:00.000Z,5.12,420,420,0,0,0,main,a4e259f,local
```

## How It Works

### Architecture

```
┌─────────────────┐
│  Run Tests      │
│  (Jest or PW)   │
└────────┬────────┘
         │
         ├──> Jest History Reporter
         │    (tests/shared/jest-history-reporter.js)
         │
         └──> Playwright History Reporter
              (tests/shared/history-reporter.js)
              │
              ▼
         ┌──────────────────────┐
         │  Test Database       │
         │  .test-results/      │
         │  test-history.json   │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │  Dashboard (HTML)    │
         │  http://localhost    │
         │  :3000               │
         └──────────────────────┘
```

### Data Storage

All test results are stored in:

```
.test-results/test-history.json
```

**Format:**

```json
{
  "runs": [
    {
      "id": "api-1700472600000",
      "suite": "api",
      "startTime": "2024-11-20T10:30:00.000Z",
      "endTime": "2024-11-20T10:30:45.000Z",
      "duration": 45230,
      "totalTests": 74,
      "passed": 74,
      "failed": 0,
      "skipped": 0,
      "flaky": 0,
      "failures": [],
      "reportPath": "playwright-report-api",
      "metadata": {
        "branch": "main",
        "commit": "a4e259f",
        "environment": "local",
        "baseUrl": "https://script.google.com/...",
        "ci": false,
        "platform": "linux",
        "node": "v18.17.0"
      }
    }
  ]
}
```

**Retention:** Automatically keeps last 1,000 runs (configurable in code).

### Custom Reporters

**Jest (Unit/Contract Tests):**

Configured in `jest.config.js`:

```javascript
reporters: [
  'default',
  './tests/shared/jest-history-reporter.js'
]
```

**Playwright (E2E Tests):**

Configured in `playwright.config.js`:

```javascript
reporter: [
  ['html', { ... }],
  ['json', { ... }],
  ['junit', { ... }],
  ['./tests/shared/history-reporter.js'],  // ← History tracking
  ['list']
]
```

Both reporters capture test results and append them to the database.

## CLI Commands

### View Dashboard

```bash
npm run test:dashboard
```

Opens the web server at http://localhost:3000.

### Query Test History (CLI)

```bash
# Get statistics for last 30 days
npm run test:history:stats

# Get last 20 test runs
npm run test:history:recent

# Clean up old runs (keep last 90 days)
npm run test:history:cleanup
```

**Advanced usage:**

```bash
# Stats for last 7 days, API suite only
node tests/shared/test-results-database.js stats 7 api

# Last 50 smoke test runs
node tests/shared/test-results-database.js recent 50 smoke

# Keep only last 30 days of history
node tests/shared/test-results-database.js cleanup 30

# Get trend data for charts
node tests/shared/test-results-database.js trend 14 unit
```

## Typical Workflow

### Local Development

```bash
# Terminal 1: Start the dashboard
npm run test:dashboard

# Terminal 2: Run tests as you code
npm run test:unit
npm run test:contract
npm run test:api

# Browser: Watch results appear in real-time
# http://localhost:3000
```

Enable "Auto-refresh" in the dashboard to see results update automatically every 30 seconds.

### QA Testing Session

```bash
# Terminal 1: Dashboard
npm run test:dashboard

# Terminal 2: Run full test suite
npm run test:all

# Browser: Monitor progress
# - See which suites are passing/failing
# - Identify flaky tests
# - Track test duration
# - Export results to share with team
```

### CI/CD Integration

The history reporters automatically capture results in CI too!

**GitHub Actions workflow:**

```yaml
- name: Run tests
  run: npm run test:all
  # History automatically saved to .test-results/test-history.json

- name: Upload test history
  uses: actions/upload-artifact@v4
  with:
    name: test-history
    path: .test-results/test-history.json
    retention-days: 90
```

You can download the history artifact and merge it with local history for comprehensive tracking.

## Use Cases

### 1. Monitor Test Health Over Time

**Question:** "Are my tests getting flakier?"

**How:**
- Open dashboard
- Set date range to "Last 90 Days"
- Check "Flaky Tests" stat card
- Look for upward trend in chart

### 2. Identify Problem Tests

**Question:** "Which tests fail most often?"

**How:**
- Use the database CLI:

```bash
node tests/shared/test-results-database.js stats 30
```

Output includes top 20 failing tests:

```json
{
  "failingTests": [
    {
      "suite": "events-crud-api",
      "test": "creates event with valid data",
      "count": 5,
      "lastSeen": "2024-11-20T10:30:00.000Z",
      "errors": ["Timeout exceeded", "Connection refused"]
    }
  ]
}
```

### 3. Compare Across Branches

**Question:** "Did my branch improve test reliability?"

**How:**
- Checkout main branch
- Run tests: `npm run test:quick`
- Note the success rate in dashboard
- Checkout your feature branch
- Run tests again: `npm run test:quick`
- Compare success rates

The dashboard shows git branch in the table, so you can filter results.

### 4. Track Test Duration

**Question:** "Are my tests getting slower?"

**How:**
- Dashboard shows "Avg Duration" stat
- Trend chart shows duration over time
- Table shows individual test run durations
- Export CSV to analyze in Excel/Google Sheets

### 5. Generate Reports for Stakeholders

**Question:** "How do I prove our test coverage is improving?"

**How:**
- Set date range to "Last 30 Days"
- Click "Export CSV"
- Open in Excel/Google Sheets
- Create pivot table showing:
  - Tests by suite
  - Pass rate trends
  - Total coverage increase

Share the CSV or take screenshots of the dashboard.

## Maintenance

### Clean Up Old Data

```bash
# Keep only last 90 days
npm run test:history:cleanup

# Or specify custom retention
node tests/shared/test-results-database.js cleanup 30
```

Database automatically limits to 1,000 runs to prevent unbounded growth.

### Backup History

```bash
# Copy the database file
cp .test-results/test-history.json backups/test-history-$(date +%Y%m%d).json

# Or commit to git (optional - excluded by default in .gitignore)
git add -f .test-results/test-history.json
git commit -m "chore: Backup test history"
```

### Reset History

```bash
# Delete all test history
rm .test-results/test-history.json

# Next test run will create a fresh database
npm run test:quick
```

## Troubleshooting

### Dashboard shows "No test data yet"

**Cause:** No tests have been run with the history reporters enabled.

**Fix:**
```bash
npm run test:unit   # Run any test suite
# Then refresh the dashboard
```

### Results not appearing in dashboard

**Cause:** Auto-refresh not enabled, or browser cache.

**Fix:**
1. Enable "Auto-refresh (30s)" checkbox
2. Or click "Refresh" button manually
3. Or hard-refresh browser (Ctrl+F5 / Cmd+Shift+R)

### Dashboard won't start (port in use)

**Cause:** Another process is using port 3000.

**Fix:**
```bash
# Use a different port
PORT=4000 npm run test:dashboard

# Or kill the process on port 3000
lsof -ti:3000 | xargs kill -9
```

### Test history file is huge

**Cause:** Too many runs stored (>1,000).

**Fix:**
```bash
# Clean up old runs
npm run test:history:cleanup
```

The database automatically limits to 1,000 runs, but cleanup removes old ones based on date.

## Advanced Features

### Custom Date Range

1. Select "Custom Range" from dropdown
2. "From Date" and "To Date" fields appear
3. Pick your desired range
4. Dashboard updates automatically

Perfect for:
- Sprint retrospectives ("show me the last 2 weeks")
- Release analysis ("show me tests from Oct 1 - Oct 15")
- Regression investigation ("when did this test start failing?")

### Programmatic Access

The database is just a JSON file, so you can build your own tools:

```javascript
const TestResultsDatabase = require('./tests/shared/test-results-database');
const db = new TestResultsDatabase();

// Get statistics
const stats = db.getStatistics(
  new Date('2024-11-01'),
  new Date('2024-11-30'),
  'api' // optional suite filter
);

console.log(stats.successRate);
console.log(stats.failingTests);

// Get trend data
const trend = db.getTrend(14, 'smoke'); // Last 14 days, smoke suite
console.log(trend);

// Get specific runs
const recent = db.getRecentRuns(10, 'unit');
console.log(recent);
```

### Integration with CI

**Save history as artifact:**

```yaml
- name: Run tests
  run: npm run test:all

- name: Upload test history
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: test-history-${{ github.run_number }}
    path: .test-results/test-history.json
    retention-days: 90
```

**Merge CI history with local:**

```bash
# Download artifact from GitHub Actions
# Then merge into local database
node -e "
  const fs = require('fs');
  const local = JSON.parse(fs.readFileSync('.test-results/test-history.json'));
  const ci = JSON.parse(fs.readFileSync('ci-test-history.json'));
  local.runs = [...ci.runs, ...local.runs];
  fs.writeFileSync('.test-results/test-history.json', JSON.stringify(local, null, 2));
"
```

## Comparison: Built-in Reports vs Dashboard

| Feature | Playwright HTML Report | Jest Output | Test Dashboard |
|---------|----------------------|-------------|----------------|
| Single run results | ✅ | ✅ | ✅ |
| Historical tracking | ❌ | ❌ | ✅ |
| Date range filtering | ❌ | ❌ | ✅ |
| Trend visualization | ❌ | ❌ | ✅ |
| Search all runs | ❌ | ❌ | ✅ |
| Auto-refresh | ❌ | ❌ | ✅ |
| Export to CSV | ❌ | ❌ | ✅ |
| Works with Jest | ❌ | ✅ | ✅ |
| Works with Playwright | ✅ | ❌ | ✅ |

**Use both together:**
- Dashboard for **trends and history**
- Built-in reports for **detailed single-run analysis**

## Summary

The Test History Dashboard gives you:

✅ **Persistent test results** - Never lose test data
✅ **Real-time monitoring** - Watch tests complete
✅ **Historical trends** - See quality improving over time
✅ **Flexible filtering** - Find exactly what you need
✅ **Easy exports** - Share data with stakeholders

**Start using it now:**

```bash
npm run test:dashboard     # Terminal 1: Dashboard
npm run test:quick         # Terminal 2: Run tests
```

**Open http://localhost:3000 and see the magic! 🧪✨**
