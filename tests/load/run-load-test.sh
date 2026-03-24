#!/bin/bash
#
# Run Bundle Load Test with SLO Tracking
#
# Usage:
#   ./run-load-test.sh                    # Run against staging (default)
#   ./run-load-test.sh production         # Run against production (requires confirmation)
#   ./run-load-test.sh staging root       # Specify brand ID
#
# Results are appended to tests/load/results/perf-results.csv
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_FILE="$SCRIPT_DIR/results/perf-results.csv"

# Parse arguments
ENVIRONMENT="${1:-staging}"
BRAND_ID="${2:-root}"

# Set BASE_URL based on environment
if [ "$ENVIRONMENT" = "production" ]; then
  if [ "$CONFIRM_PRODUCTION" != "true" ]; then
    echo "WARNING: Running against production requires CONFIRM_PRODUCTION=true"
    echo "Example: CONFIRM_PRODUCTION=true ./run-load-test.sh production"
    exit 1
  fi
  BASE_URL="https://www.eventangle.com"
else
  BASE_URL="https://stg.eventangle.com"
fi

echo "============================================================"
echo "Bundle Load Test - SLO Tracking"
echo "============================================================"
echo "Environment: $ENVIRONMENT"
echo "Base URL: $BASE_URL"
echo "Brand ID: $BRAND_ID"
echo "Results file: $RESULTS_FILE"
echo "============================================================"
echo ""

# Ensure results file exists with headers
if [ ! -f "$RESULTS_FILE" ]; then
  echo "date,environment,public_p95,display_p95,poster_p95,analytics_p95,error_rate,status" > "$RESULTS_FILE"
fi

# Run k6 and capture output
OUTPUT=$(BASE_URL="$BASE_URL" BRAND_ID="$BRAND_ID" ENVIRONMENT="$ENVIRONMENT" \
  k6 run "$SCRIPT_DIR/bundle-load.js" 2>&1) || true

echo "$OUTPUT"

# Extract CSV line from output and append to results file
CSV_LINE=$(echo "$OUTPUT" | sed -n '/===PERF_RESULTS_CSV===/,/===END_CSV===/p' | grep -v '===' | head -1)

if [ -n "$CSV_LINE" ]; then
  echo "$CSV_LINE" >> "$RESULTS_FILE"

  # Extract individual values from CSV line
  DATE=$(echo "$CSV_LINE" | cut -d',' -f1)
  ENV=$(echo "$CSV_LINE" | cut -d',' -f2)
  PUBLIC_P95=$(echo "$CSV_LINE" | cut -d',' -f3)
  DISPLAY_P95=$(echo "$CSV_LINE" | cut -d',' -f4)
  POSTER_P95=$(echo "$CSV_LINE" | cut -d',' -f5)
  ANALYTICS_P95=$(echo "$CSV_LINE" | cut -d',' -f6)
  ERROR_RATE=$(echo "$CSV_LINE" | cut -d',' -f7)
  STATUS=$(echo "$CSV_LINE" | cut -d',' -f8)

  # Generate markdown summary
  SUMMARY_FILE="$SCRIPT_DIR/results/RESULTS_SUMMARY.md"
  cat > "$SUMMARY_FILE" << EOF
# Performance Test Results Summary

Last updated: $(date -Iseconds)

## Latest Run

| Metric | Value | SLO Target | Status |
|--------|-------|------------|--------|
| **Date** | $DATE | - | - |
| **Environment** | $ENV | - | - |
| **Public Bundle p95** | ${PUBLIC_P95}ms | < 2000ms | $([ "$PUBLIC_P95" -lt 2000 ] && echo "PASS" || echo "FAIL") |
| **Display Bundle p95** | ${DISPLAY_P95}ms | < 2000ms | $([ "$DISPLAY_P95" -lt 2000 ] && echo "PASS" || echo "FAIL") |
| **Poster Bundle p95** | ${POSTER_P95}ms | < 2000ms | $([ "$POSTER_P95" -lt 2000 ] && echo "PASS" || echo "FAIL") |
| **Analytics p95** | ${ANALYTICS_P95}ms | < 2000ms | $([ "$ANALYTICS_P95" -lt 2000 ] && echo "PASS" || echo "FAIL") |
| **Error Rate** | $ERROR_RATE | < 1% | - |
| **Overall Status** | **$STATUS** | - | - |

## SLO Definitions

See [PERFORMANCE_NOTES.md](../../PERFORMANCE_NOTES.md) for full SLO documentation.

| Status | Meaning |
|--------|---------|
| PASS | All endpoints under 1500ms p95, error rate < 0.5% |
| WARN | Some endpoints between 1500-2000ms p95 |
| FAIL | Any endpoint over 2000ms or error rate > 1% |

## Historical Results

See [perf-results.csv](./perf-results.csv) for full history.

Last 5 runs:
\`\`\`
$(tail -6 "$RESULTS_FILE" | head -6)
\`\`\`
EOF

  echo ""
  echo "============================================================"
  echo "Results appended to: $RESULTS_FILE"
  echo "Summary updated: $SUMMARY_FILE"
  echo ""
  echo "Latest Results:"
  echo "  Public Bundle p95:  ${PUBLIC_P95}ms"
  echo "  Display Bundle p95: ${DISPLAY_P95}ms"
  echo "  Poster Bundle p95:  ${POSTER_P95}ms"
  echo "  Analytics p95:      ${ANALYTICS_P95}ms"
  echo "  Error Rate:         $ERROR_RATE"
  echo "  Overall Status:     $STATUS"
  echo "============================================================"
else
  echo ""
  echo "WARNING: Could not extract CSV results from test output"
fi
