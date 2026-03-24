# Load Tests

Performance and load testing for MVP Event Toolkit API using k6.

## Quick Start

```bash
# Install k6 (one-time)
# Linux: sudo apt-get install k6
# macOS: brew install k6
# Windows: choco install k6

# Set environment variables
export BASE_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
export ADMIN_KEY="your-admin-key"

# Run tests
npm run test:load:smoke      # Quick baseline (30s)
npm run test:load:average    # Normal load (2m)
npm run test:load:stress     # Heavy load (4m)
npm run test:load:spike      # Traffic spike (~80s)
```

## Test Files

| File | Description | VUs | Duration | Use Case |
|------|-------------|-----|----------|----------|
| `bundle-load.js` | **Bundle endpoints + SLO tracking** | 5 | 60s | Primary SLO verification |
| `smoke-load.js` | Baseline verification | 1 | 30s | Verify deployment works |
| `average-load.js` | Normal usage simulation | 10 | 2m | Benchmark typical load |
| `stress-load.js` | Heavy sustained load | 0→50→0 | 4m | Find system limits |
| `spike-load.js` | Sudden traffic spike | 1→100→1 | 80s | Test resilience |
| `helpers.js` | Shared utilities | - | - | API helpers & thresholds |
| `run-load-test.sh` | SLO test runner | - | - | Run bundle test with CSV logging |

## What Gets Tested

- ✅ System status API
- ✅ Events CRUD operations
- ✅ Sponsors CRUD operations
- ✅ Multi-brand support
- ✅ Response times
- ✅ Error rates
- ✅ Concurrent request handling

## Documentation

See [LOAD_TESTING.md](../../LOAD_TESTING.md) for:
- Complete setup instructions
- Detailed test descriptions
- Performance targets
- Troubleshooting guide
- Best practices
- CI/CD integration

## GitHub Actions

Run via **Actions** tab → **Load Testing** workflow:
- Choose test type (smoke/average/stress/spike/all)
- Optionally specify custom BASE_URL
- View results in workflow summary
- Download detailed metrics as artifacts

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BASE_URL` | ✅ Yes | - | Deployment URL to test |
| `ADMIN_KEY` | ⚠️ CRUD tests | - | Admin authentication key |
| `BRAND_ID` | No | `root` | Brand to test |
| `ENVIRONMENT` | No | `production` | Environment tag |

## SLO Targets (Service Level Objectives)

See [PERFORMANCE_NOTES.md](../../PERFORMANCE_NOTES.md) for full SLO documentation.

| Endpoint | p95 Target | Error Rate |
|----------|------------|------------|
| `api_getPublicBundle` | < 2000ms | < 1% |
| `api_getDisplayBundle` | < 2000ms | < 1% |
| `api_getPosterBundle` | < 2000ms | < 1% |
| `api_getSharedAnalytics` | < 2000ms | < 1% |

### SLO Status Levels

| Status | p95 Latency | Error Rate | Action |
|--------|-------------|------------|--------|
| PASS | < 1500ms | < 0.5% | No action needed |
| WARN | 1500-2000ms | 0.5-1% | Investigate before deploy |
| FAIL | > 2000ms | > 1% | Do not deploy |

## Running Bundle Load Test with SLO Tracking

```bash
# Using the SLO test runner (recommended)
./tests/load/run-load-test.sh              # Against staging
./tests/load/run-load-test.sh staging root # Specify brand

# Using npm
npm run test:load:bundles

# Direct k6 command
BASE_URL=https://stg.eventangle.com k6 run tests/load/bundle-load.js
```

Results are automatically appended to `tests/load/results/perf-results.csv`.

## General Performance Targets

| Metric | Target |
|--------|--------|
| Average response | < 1.5s |
| p95 response | < 2s |
| Error rate | < 1% |
| Concurrent users | 50+ |

## Example Output

```
✓ status: status is 200
✓ status: response time < 5s
✓ list events: has ok:true

checks.........................: 100.00% ✓ 150  ✗ 0
http_req_duration..............: avg=1.2s min=200ms med=1s max=3.5s p(95)=2.8s
http_req_failed................: 0.00%   ✓ 0    ✗ 150
http_reqs......................: 150     5/s
```

## Tips

- Start with smoke test before larger tests
- Test QA environment before production
- Monitor Google Apps Script logs during tests
- Expect some rate limiting at high VU counts
- CRUD tests auto-cleanup created test data

## Support

- [k6 Documentation](https://k6.io/docs/)
- [Project Load Testing Guide](../../LOAD_TESTING.md)
- [GitHub Actions Workflow](../../.github/workflows/load-testing.yml)
