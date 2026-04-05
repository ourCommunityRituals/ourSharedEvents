#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# ourSharedEvents - Test Runner
# Runs Security + Contract (Newman) then Feature + E2E (Playwright)
# Usage: ./tests/run-tests.sh [staging|prod]
# ─────────────────────────────────────────────────────────────────────────────

ENV=${1:-staging}

if [ "$ENV" = "prod" ]; then
  BASE_URL="https://oursharedevents.com"
  WORKER_URL="https://subscribe.oursharedevents.com"
else
  BASE_URL="https://stg.oursharedevents.com"
  WORKER_URL="https://subscribe-stg.oursharedevents.com"
fi

echo "▶ Running against: $ENV ($BASE_URL)"
echo ""

# ─── Create report dir ───────────────────────────────────────────────────────
mkdir -p tests/reports/newman
mkdir -p tests/reports/playwright

# ─── Suite 1+2: Security + Contract (Newman) ─────────────────────────────────
echo "═══════════════════════════════════════"
echo "  SECURITY + CONTRACT  (Newman)"
echo "═══════════════════════════════════════"

npx newman run tests/postman/subscribe-worker.collection.json \
  --env-var "base_url=$WORKER_URL" \
  --reporters cli,json \
  --reporter-json-export tests/reports/newman/results.json \
  --color on

NEWMAN_EXIT=$?

echo ""

# ─── Suite 3+4+5: Feature + A11Y + Perf + E2E Smoke (Playwright) ─────────────
echo "═══════════════════════════════════════"
echo "  FEATURE + A11Y + PERF + E2E SMOKE  (Playwright)"
echo "═══════════════════════════════════════"

STAGING_URL=$BASE_URL npx playwright test \
  --config=tests/playwright.config.ts \
  --project=chromium \
  --project=mobile-chrome

PW_EXIT=$?

echo ""

# ─── Summary ─────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════"
echo "  RESULTS"
echo "═══════════════════════════════════════"
echo "Newman (Security/Contract): $([ $NEWMAN_EXIT -eq 0 ] && echo '✅ PASSED' || echo '❌ FAILED')"
echo "Playwright (Feature/E2E):   $([ $PW_EXIT -eq 0 ] && echo '✅ PASSED' || echo '❌ FAILED')"
echo ""

# ─── Reports ─────────────────────────────────────────────────────────────────
echo "Reports:"
echo "  Newman  → tests/reports/newman/results.json"
echo "  Playwright → tests/reports/playwright/index.html"
echo ""

# Exit 1 if either suite failed
[ $NEWMAN_EXIT -eq 0 ] && [ $PW_EXIT -eq 0 ] && exit 0 || exit 1
