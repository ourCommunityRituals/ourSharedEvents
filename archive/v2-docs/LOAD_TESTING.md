# 🔥 Load Testing Guide

**Implemented:** 2025-11-14
**Priority:** P1 (High)
**Status:** ✅ Active

---

## Overview

Load testing infrastructure using **k6** to ensure the MVP Event Toolkit API can handle expected traffic loads and identify performance bottlenecks before they impact users.

### Why k6?

- ✅ **JavaScript-based** - Same language as project (easy for team to maintain)
- ✅ **Developer-friendly CLI** - Simple to use and integrate
- ✅ **Modern tooling** - Built for cloud and CI/CD environments
- ✅ **Lightweight** - Go binary, no heavy runtime dependencies
- ✅ **Excellent metrics** - Built-in performance reporting
- ✅ **Cloud integration** - Optional k6 Cloud for advanced analytics

---

## Load Test Types

### 🧪 Smoke Test (`smoke-load.js`)

**Purpose:** Baseline test to verify system works under minimal load

**Load Profile:**
- 1 Virtual User (VU)
- 30 seconds duration
- Tests all API endpoints sequentially

**Use When:**
- Verifying deployment didn't break anything
- Establishing baseline performance metrics
- Quick sanity check before larger tests

**Command:**
```bash
npm run test:load:smoke
```

---

### 📊 Average Load Test (`average-load.js`)

**Purpose:** Simulate normal/average usage patterns

**Load Profile:**
- 10 concurrent Virtual Users (VUs)
- 2 minutes duration
- Mix of read (70%) and write (30%) operations
- Realistic think time between requests

**Simulates:**
- 10 concurrent users browsing events and sponsors
- Occasional admin operations (creating/updating)
- Typical user behavior patterns

**Use When:**
- Testing typical daily traffic
- Verifying performance under normal load
- Benchmarking average response times

**Command:**
```bash
npm run test:load:average
```

---

### 💪 Stress Test (`stress-load.js`)

**Purpose:** Test system behavior under sustained heavy load

**Load Profile:**
- Ramp up: 0 → 50 VUs over 1 minute
- Hold: 50 VUs for 2 minutes
- Ramp down: 50 → 0 VUs over 1 minute
- Total: 4 minutes

**Simulates:**
- Event going viral (gradual increase)
- Sustained peak usage (conference in session)
- Traffic returning to normal (gradual decrease)

**Use When:**
- Finding system limits and breaking points
- Testing stability under sustained load
- Capacity planning for expected growth

**Command:**
```bash
npm run test:load:stress
```

---

### ⚡ Spike Test (`spike-load.js`)

**Purpose:** Test resilience to sudden traffic spikes

**Load Profile:**
- Baseline: 1 VU for 10 seconds
- **Spike:** Instant jump to 100 VUs
- Hold: 100 VUs for 30 seconds
- **Drop:** Instant drop to 1 VU
- Recovery: 1 VU for 30 seconds

**Simulates:**
- Viral social media post
- Breaking news announcement
- Sudden event registration opening
- System recovery after spike

**Use When:**
- Testing system resilience
- Verifying graceful degradation
- Testing auto-scaling (if implemented)
- Understanding rate limiting behavior

**Command:**
```bash
npm run test:load:spike
```

---

## Installation

### Option 1: Local Development (Linux/Mac)

**Install k6:**

```bash
# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# macOS (Homebrew)
brew install k6

# Verify installation
k6 version
```

### Option 2: Local Development (Windows)

**Install k6:**

```powershell
# Using Chocolatey
choco install k6

# Or download from: https://dl.k6.io/msi/k6-latest-amd64.msi

# Verify installation
k6 version
```

### Option 3: Docker

```bash
# Run without installation
docker run --rm -i grafana/k6 run - <tests/load/smoke-load.js

# Or use docker-compose
docker-compose run k6 run /tests/load/smoke-load.js
```

### Option 4: GitHub Actions (CI/CD)

Load tests run via GitHub Actions workflow - **no local installation needed**.

---

## Usage

### Local Testing

**1. Set environment variables:**

```bash
export BASE_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
export ADMIN_KEY="your-admin-key-here"
export BRAND_ID="root"
```

**2. Run load tests:**

```bash
# Smoke test (quick, 30 seconds)
npm run test:load:smoke

# Average load (2 minutes)
npm run test:load:average

# Stress test (4 minutes)
npm run test:load:stress

# Spike test (~80 seconds)
npm run test:load:spike

# Run smoke + average
npm run test:load:all
```

**3. View results:**

k6 outputs real-time metrics to console:

```
     ✓ status: status is 200
     ✓ status: response time < 5s
     ✓ status: has ok:true

     checks.........................: 100.00% ✓ 150       ✗ 0
     data_received..................: 45 kB   1.5 kB/s
     data_sent......................: 12 kB   400 B/s
     http_req_blocked...............: avg=50ms    min=1ms   med=2ms    max=500ms
     http_req_connecting............: avg=20ms    min=1ms   med=1ms    max=200ms
     http_req_duration..............: avg=1.2s    min=200ms med=1s     max=3.5s
     http_req_failed................: 0.00%   ✓ 0         ✗ 150
     http_req_receiving.............: avg=10ms    min=1ms   med=5ms    max=50ms
     http_req_sending...............: avg=5ms     min=1ms   med=2ms    max=20ms
     http_req_tls_handshaking.......: avg=30ms    min=1ms   med=1ms    max=300ms
     http_req_waiting...............: avg=1.18s   min=180ms med=980ms  max=3.4s
     http_reqs......................: 150     5/s
     iteration_duration.............: avg=2.5s    min=1s    med=2.2s   max=5s
     iterations.....................: 50      1.66/s
     vus............................: 1       min=1       max=1
     vus_max........................: 1       min=1       max=1
```

**Key Metrics:**
- `http_req_duration` - Response time (avg, min, med, max, p95, p99)
- `http_req_failed` - Error rate (should be < 1%)
- `checks` - Assertion pass rate (should be > 95%)
- `http_reqs` - Total requests and requests per second

---

### GitHub Actions (CI/CD)

**Trigger manually via GitHub UI:**

1. Go to **Actions** tab
2. Select **Load Testing** workflow
3. Click **Run workflow**
4. Choose test type:
   - `smoke` - Quick baseline test
   - `average` - Normal load simulation
   - `stress` - Heavy sustained load
   - `spike` - Sudden traffic spike
   - `all` - Run smoke + average
5. (Optional) Enter custom BASE_URL to test
6. Click **Run workflow**

**View results:**

1. Wait for workflow to complete
2. Click on workflow run
3. View **Summary** for quick metrics
4. Download **Artifacts** for detailed JSON results

**Artifacts contain:**
- `*-results.json` - Full test data with all metrics
- `*-summary.json` - High-level summary statistics

---

## Configuration

### Environment Variables

All load tests support these environment variables:

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `BASE_URL` | Deployment URL to test | (none) | ✅ Yes |
| `ADMIN_KEY` | Admin key for write operations | (none) | ⚠️ For CRUD tests |
| `BRAND_ID` | Brand to test | `root` | No |
| `ENVIRONMENT` | Environment tag for metrics | `production` | No |

**Example:**

```bash
BASE_URL="https://script.google.com/macros/s/AKfycb.../exec" \
ADMIN_KEY="your-admin-key" \
BRAND_ID="root" \
k6 run tests/load/average-load.js
```

### Performance Thresholds

Each test defines pass/fail thresholds in `helpers.js`:

```javascript
export const thresholds = {
  // HTTP errors should be less than 1%
  http_req_failed: ['rate<0.01'],

  // 95% of requests should be below 5 seconds
  http_req_duration: ['p(95)<5000'],

  // 99% of requests should be below 10 seconds
  'http_req_duration{p:0.99}': ['<10000'],

  // Average response time should be below 3 seconds
  'http_req_duration{avg}': ['<3000'],

  // Check success rate should be at least 95%
  checks: ['rate>0.95']
};
```

**Threshold failures cause test to fail** (non-zero exit code).

Adjust thresholds based on:
- Google Apps Script performance characteristics
- User experience requirements
- SLA targets

---

## Test Scenarios

### What Gets Tested

Each load test exercises these API operations:

**System APIs:**
- ✅ Status endpoint (`GET /status`)
- ✅ Diagnostics endpoint (`POST /diagnostics`) - requires admin key

**Events APIs (CRUD):**
- ✅ List events (`GET /api?action=list&scope=events`)
- ✅ Get event (`GET /api?action=get&scope=events&id=...`)
- ✅ Create event (`POST /api?action=create&scope=events`) - requires admin key
- ✅ Update event (`POST /api?action=update&scope=events`) - requires admin key
- ✅ Delete event (`POST /api?action=delete&scope=events`) - requires admin key

**Sponsors APIs (CRUD):**
- ✅ List sponsors (`GET /api?action=list&scope=sponsors`)
- ✅ Get sponsor (`GET /api?action=get&scope=sponsors&id=...`)
- ✅ Create sponsor (`POST /api?action=create&scope=sponsors`) - requires admin key
- ✅ Update sponsor (`POST /api?action=update&scope=sponsors`) - requires admin key
- ✅ Delete sponsor (`POST /api?action=delete&scope=sponsors`) - requires admin key

### User Workflows

**Read-Only User (70% of traffic):**
1. Check system status
2. List all events
3. View specific event details
4. List all sponsors
5. Browse sponsor details

**Admin User (30% of traffic):**
1. Check system status
2. Create new event
3. Update event details
4. Create new sponsor
5. Update sponsor details
6. Delete test data (cleanup)

---

## Interpreting Results

### Response Time Metrics

**Google Apps Script Benchmarks:**

| Metric | Good | Acceptable | Concerning |
|--------|------|------------|------------|
| **Average** | < 1s | < 3s | > 3s |
| **p95** | < 2s | < 5s | > 5s |
| **p99** | < 3s | < 10s | > 10s |

**Note:** Google Apps Script typically has:
- Initial cold start: 2-5 seconds
- Warm responses: 200ms - 2s
- Rate limiting after ~100 req/min per IP

### Error Rates

| Error Rate | Status | Action |
|------------|--------|--------|
| **< 0.1%** | ✅ Excellent | No action needed |
| **0.1% - 1%** | ⚠️ Acceptable | Monitor trends |
| **1% - 5%** | ⚠️ Warning | Investigate causes |
| **> 5%** | ❌ Critical | Fix immediately |

### Common Error Patterns

**HTTP 403 - Forbidden:**
- Google Apps Script rate limiting
- Too many requests from same IP
- **Action:** Reduce load or implement rate limiting

**HTTP 500 - Internal Server Error:**
- Backend script error
- Database operation failed
- **Action:** Check Apps Script logs

**HTTP 429 - Too Many Requests:**
- Explicit rate limit hit
- **Action:** Implement exponential backoff

---

## Best Practices

### ✅ DO:

1. **Test QA First**
   - Run load tests against QA environment before production
   - Verify deployment works under load
   - Don't surprise production with traffic spikes

2. **Start Small**
   - Begin with smoke test
   - Progress to average load
   - Only run stress/spike when confident

3. **Monitor During Tests**
   - Watch Google Apps Script execution logs
   - Monitor error rates in real-time
   - Stop test if critical errors occur

4. **Clean Up Test Data**
   - Load tests create and delete test entities
   - Verify cleanup completed successfully
   - Check for orphaned test data

5. **Document Baselines**
   - Record baseline performance metrics
   - Compare each test run to baseline
   - Track performance trends over time

6. **Schedule Appropriately**
   - Don't run load tests during peak production hours
   - Consider rate limits and quotas
   - Coordinate with team before major tests

### ❌ DON'T:

1. **Don't Test Production Unannounced**
   - Load tests can impact real users
   - Always notify team before production load tests
   - Prefer QA environment for testing

2. **Don't Use Real Data**
   - Load tests use generated test data
   - Never point load tests at production database
   - Keep test and production data separate

3. **Don't Ignore Failures**
   - Failed thresholds indicate problems
   - Investigate root cause before retrying
   - Fix issues, don't just re-run

4. **Don't Run Continuously**
   - Load tests consume quota
   - Can trigger rate limiting
   - Run strategically, not on every commit

5. **Don't Test Without ADMIN_KEY**
   - CRUD tests require admin authentication
   - Read-only tests work without admin key
   - Set ADMIN_KEY env var for full testing

---

## Troubleshooting

### k6 Not Installed

**Problem:** `k6: command not found`

**Solution:**
```bash
# Check installation
k6 version

# Reinstall k6 (see Installation section)

# Or use Docker
docker run --rm -i grafana/k6 version
```

### BASE_URL Not Set

**Problem:** Load test fails immediately with URL errors

**Solution:**
```bash
# Set environment variable
export BASE_URL="https://script.google.com/macros/s/YOUR_ID/exec"

# Or pass inline
BASE_URL="https://..." k6 run tests/load/smoke-load.js
```

### High Error Rates (> 5%)

**Problem:** Many requests failing during load test

**Possible Causes:**
1. **Rate Limiting** - Too many requests from same IP
2. **Cold Start** - Google Apps Script warming up
3. **Backend Error** - Script bug or database issue
4. **Authentication** - Missing or invalid ADMIN_KEY

**Solutions:**
- Check Google Apps Script execution logs
- Reduce concurrent VUs
- Add delays between requests
- Verify ADMIN_KEY is correct
- Check status endpoint manually

### Slow Response Times

**Problem:** Average > 5s, p95 > 10s

**Possible Causes:**
1. **Cold Start** - Apps Script hasn't warmed up
2. **Heavy Database Operations** - Large spreadsheet scans
3. **Network Latency** - Slow connection to Google servers
4. **High Load** - Too many concurrent requests

**Solutions:**
- Run warm-up requests before test
- Optimize database queries
- Reduce concurrent VUs
- Check from different network location

### CRUD Tests Skipped

**Problem:** "ADMIN_KEY not set - skipping CRUD tests"

**Solution:**
```bash
# Set admin key environment variable
export ADMIN_KEY="your-admin-key-here"

# Run test again
npm run test:load:smoke
```

---

## Advanced Topics

### Custom Test Scenarios

Create custom load tests by copying an existing test:

```bash
# Copy template
cp tests/load/smoke-load.js tests/load/custom-load.js

# Edit test configuration
# Modify VUs, duration, scenarios
# Add custom workflow logic

# Run custom test
k6 run tests/load/custom-load.js
```

### Cloud Integration (k6 Cloud)

For advanced analytics and historical tracking:

1. Sign up at https://app.k6.io/
2. Get API token
3. Run with cloud output:

```bash
K6_CLOUD_TOKEN=your-token k6 cloud tests/load/smoke-load.js
```

**Benefits:**
- Historical trend analysis
- Team collaboration
- Advanced metrics and dashboards
- Distributed load testing from multiple regions

### Output to InfluxDB + Grafana

For local metric storage and visualization:

```bash
# Start InfluxDB + Grafana
docker-compose up -d influxdb grafana

# Run k6 with InfluxDB output
k6 run --out influxdb=http://localhost:8086/k6 tests/load/smoke-load.js

# View in Grafana at http://localhost:3000
```

### Distributed Load Testing

Run tests from multiple locations simultaneously:

```bash
# Machine 1 (US East)
BASE_URL="..." k6 run --tag location=us-east tests/load/stress-load.js

# Machine 2 (EU West)
BASE_URL="..." k6 run --tag location=eu-west tests/load/stress-load.js

# Combine results for global load simulation
```

---

## Performance Targets

### Current Targets (Google Apps Script)

Based on platform limitations and user expectations:

| Metric | Target | Rationale |
|--------|--------|-----------|
| **Availability** | 99.5% | 5 errors per 1000 requests |
| **Average Response Time** | < 2s | Good user experience |
| **p95 Response Time** | < 5s | Acceptable for 95% of users |
| **p99 Response Time** | < 10s | Acceptable for 99% of users |
| **Error Rate** | < 0.5% | High reliability |
| **Concurrent Users** | 50+ | Handles typical conference traffic |

### Future Targets (If Migrating)

If moving off Google Apps Script:

| Metric | Target | Improvement |
|--------|--------|-------------|
| **Availability** | 99.9% | 1 error per 1000 requests |
| **Average Response Time** | < 500ms | 4x faster |
| **p95 Response Time** | < 1s | 5x faster |
| **p99 Response Time** | < 2s | 5x faster |
| **Error Rate** | < 0.1% | 5x more reliable |
| **Concurrent Users** | 500+ | 10x more scalable |

---

## Integration with CI/CD

### When Load Tests Run

**Automatic:** Never (to avoid quota consumption)

**Manual Trigger:**
- Via GitHub Actions UI
- Before major releases
- After performance optimizations
- During capacity planning

### Load Testing Strategy

**Before Major Release:**
1. Deploy to QA environment
2. Run smoke test (verify deployment)
3. Run average load test (verify normal performance)
4. Run stress test (verify can handle expected load)
5. Review results and fix issues
6. Deploy to production

**After Performance Changes:**
1. Deploy to QA
2. Run baseline tests (compare to previous)
3. Verify improvements/no regressions
4. Deploy to production

**Quarterly Capacity Planning:**
1. Run stress test on production (off-peak hours)
2. Identify current limits
3. Project future growth
4. Plan scaling if needed

---

## Metrics Dashboard (Future)

### Recommended Setup

For comprehensive performance monitoring:

```yaml
Tools:
  - k6: Load testing execution
  - InfluxDB: Metric storage
  - Grafana: Visualization
  - Prometheus: Real-time monitoring (optional)

Dashboards:
  - Response Time Trends
  - Error Rate Over Time
  - Throughput (requests/second)
  - VU Performance (per user metrics)
  - Endpoint Breakdown (which APIs are slow)
```

---

## FAQ

### Q: When should I run load tests?

**A:**
- Before major production deployments
- After performance optimizations
- During capacity planning
- When investigating performance issues
- **Not** on every commit (too resource-intensive)

### Q: Can I run load tests against production?

**A:** Yes, but with caution:
- Only during off-peak hours
- Notify team beforehand
- Start with smoke test
- Monitor for impact on real users
- **Prefer QA environment** when possible

### Q: What if my tests fail thresholds?

**A:**
1. Check Google Apps Script execution logs
2. Review error messages in k6 output
3. Verify BASE_URL and ADMIN_KEY are correct
4. Reduce concurrent VUs and retry
5. Investigate backend performance
6. Fix issues before re-running

### Q: How do I test multi-brand functionality?

**A:** Set different BRAND_ID for each test:

```bash
BRAND_ID="root" k6 run tests/load/smoke-load.js
BRAND_ID="abc" k6 run tests/load/smoke-load.js
BRAND_ID="cbc" k6 run tests/load/smoke-load.js
```

### Q: Can I run tests without ADMIN_KEY?

**A:** Yes - read-only operations work fine:
- Status checks
- List events/sponsors
- Get specific items

CRUD operations (create/update/delete) will be skipped.

### Q: How much does k6 Cloud cost?

**A:**
- **Free tier:** 50 cloud test runs/month
- **Team plan:** $49/month (unlimited tests, 5 users)
- **Business plan:** $199/month (advanced features)
- **Local k6 is free forever**

---

## Resources

### Documentation
- [k6 Official Docs](https://k6.io/docs/)
- [k6 API Reference](https://k6.io/docs/javascript-api/)
- [Google Apps Script Quotas](https://developers.google.com/apps-script/guides/services/quotas)

### Tools
- [k6 Download](https://k6.io/docs/get-started/installation/)
- [k6 Cloud](https://app.k6.io/)
- [Grafana k6 Extension](https://k6.io/docs/results-output/real-time/grafana/)

### Learning
- [k6 Tutorial](https://k6.io/docs/examples/)
- [Load Testing Best Practices](https://k6.io/docs/testing-guides/)
- [Performance Testing Fundamentals](https://k6.io/blog/performance-testing-fundamentals/)

---

## Summary

✅ **Load Testing with k6** - Modern, developer-friendly performance testing
✅ **4 Test Types** - Smoke, Average, Stress, Spike
✅ **CI/CD Integrated** - Manual GitHub Actions workflow
✅ **Comprehensive Metrics** - Response times, error rates, throughput
✅ **Best Practices** - Test QA first, monitor during tests, document baselines
✅ **Future Ready** - Cloud integration, distributed testing, metrics dashboards

**Load testing ensures the MVP Event Toolkit can handle expected traffic and provides early warning of performance issues.**

---

**Document Version:** 1.0
**Last Updated:** 2025-11-14
**Next Review:** 2025-12-14
