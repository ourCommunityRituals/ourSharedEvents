# Performance Test Results Summary

Last updated: (run load test to populate)

## Latest Run

No load test results yet. Run the load test to populate:

```bash
./tests/load/run-load-test.sh
```

## SLO Targets

| Endpoint | p95 Target | Error Rate |
|----------|------------|------------|
| `api_getPublicBundle` | < 2000ms | < 1% |
| `api_getDisplayBundle` | < 2000ms | < 1% |
| `api_getPosterBundle` | < 2000ms | < 1% |
| `api_getSharedAnalytics` | < 2000ms | < 1% |

## SLO Definitions

See [PERFORMANCE_NOTES.md](../../PERFORMANCE_NOTES.md) for full SLO documentation.

| Status | Meaning |
|--------|---------|
| PASS | All endpoints under 1500ms p95, error rate < 0.5% |
| WARN | Some endpoints between 1500-2000ms p95 |
| FAIL | Any endpoint over 2000ms or error rate > 1% |

## Historical Results

See [perf-results.csv](./perf-results.csv) for full history.
