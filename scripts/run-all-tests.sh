#!/bin/bash
# Comprehensive Test Execution Script
# Runs Jest, Newman, and Playwright tests with detailed reporting

set -e  # Exit on error

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  MVP EVENT TOOLKIT - COMPREHENSIVE TEST SUITE              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Create reports directory
mkdir -p test-reports newman-reports playwright-report

# Track test results
JEST_PASSED=0
NEWMAN_PASSED=0
PLAYWRIGHT_PASSED=0

# ============================================================================
# 1. JEST TESTS (Unit + Contract)
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1️⃣  RUNNING JEST TESTS (Unit + Contract)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if npm run test:jest 2>&1 | tee test-reports/jest-output.txt; then
    JEST_PASSED=1
    echo "✅ Jest tests PASSED"
else
    echo "❌ Jest tests FAILED"
fi
echo ""

# ============================================================================
# 2. NEWMAN TESTS (API Testing)
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  RUNNING NEWMAN TESTS (API)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Note about deployment authorization
echo "⚠️  NOTE: Newman tests require web app to be deployed with 'Anyone' access"
echo "   If tests fail with 403, run: npm run open"
echo "   Then: Deploy → Manage deployments → Edit @2 → Who has access: Anyone"
echo ""

echo "Running Newman smoke tests..."
if npm run test:newman:smoke 2>&1 | tee test-reports/newman-smoke-output.txt; then
    echo "✅ Newman smoke tests PASSED"
else
    echo "❌ Newman smoke tests FAILED (check deployment authorization)"
fi
echo ""

echo "Running Newman flow tests..."
if npm run test:newman:flow 2>&1 | tee test-reports/newman-flow-output.txt; then
    NEWMAN_PASSED=1
    echo "✅ Newman flow tests PASSED"
else
    echo "❌ Newman flow tests FAILED"
fi
echo ""

# ============================================================================
# 3. PLAYWRIGHT TESTS (E2E Browser Testing)
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3️⃣  RUNNING PLAYWRIGHT TESTS (E2E)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "⚠️  NOTE: Playwright tests require internet access and proper DNS resolution"
echo "   Tests will open browser windows to test the deployed web app"
echo ""

echo "Running Playwright smoke tests..."
if BASE_URL="https://script.google.com/macros/s/AKfycby8kFVIiNl40hwlegMyHIA9XpOktseFP3svLU9zLoQ7V9H-2NPwFiAeS02u5RCAVP4iGQ/exec" npm run test:smoke 2>&1 | tee test-reports/playwright-smoke-output.txt; then
    echo "✅ Playwright smoke tests PASSED"
else
    echo "❌ Playwright smoke tests FAILED"
fi
echo ""

echo "Running Playwright security tests..."
if BASE_URL="https://script.google.com/macros/s/AKfycby8kFVIiNl40hwlegMyHIA9XpOktseFP3svLU9zLoQ7V9H-2NPwFiAeS02u5RCAVP4iGQ/exec" npm run test:security 2>&1 | tee test-reports/playwright-security-output.txt; then
    echo "✅ Playwright security tests PASSED"
else
    echo "❌ Playwright security tests FAILED"
fi
echo ""

echo "Running Playwright API contract tests..."
if BASE_URL="https://script.google.com/macros/s/AKfycby8kFVIiNl40hwlegMyHIA9XpOktseFP3svLU9zLoQ7V9H-2NPwFiAeS02u5RCAVP4iGQ/exec" npm run test:api 2>&1 | tee test-reports/playwright-api-output.txt; then
    echo "✅ Playwright API tests PASSED"
else
    echo "❌ Playwright API tests FAILED"
fi
echo ""

echo "Running Playwright pages tests..."
if BASE_URL="https://script.google.com/macros/s/AKfycby8kFVIiNl40hwlegMyHIA9XpOktseFP3svLU9zLoQ7V9H-2NPwFiAeS02u5RCAVP4iGQ/exec" npm run test:pages 2>&1 | tee test-reports/playwright-pages-output.txt; then
    echo "✅ Playwright pages tests PASSED"
else
    echo "❌ Playwright pages tests FAILED"
fi
echo ""

echo "Running Playwright flows tests..."
if BASE_URL="https://script.google.com/macros/s/AKfycby8kFVIiNl40hwlegMyHIA9XpOktseFP3svLU9zLoQ7V9H-2NPwFiAeS02u5RCAVP4iGQ/exec" npm run test:flows 2>&1 | tee test-reports/playwright-flows-output.txt; then
    PLAYWRIGHT_PASSED=1
    echo "✅ Playwright flows tests PASSED"
else
    echo "❌ Playwright flows tests FAILED"
fi
echo ""

# ============================================================================
# FINAL SUMMARY
# ============================================================================
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  TEST EXECUTION SUMMARY                                    ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

if [ $JEST_PASSED -eq 1 ]; then
    echo "✅ Jest Tests: PASSED"
else
    echo "❌ Jest Tests: FAILED"
fi

if [ $NEWMAN_PASSED -eq 1 ]; then
    echo "✅ Newman Tests: PASSED"
else
    echo "❌ Newman Tests: FAILED (may need deployment authorization)"
fi

if [ $PLAYWRIGHT_PASSED -eq 1 ]; then
    echo "✅ Playwright Tests: PASSED"
else
    echo "❌ Playwright Tests: FAILED"
fi

echo ""
echo "Test Reports Generated:"
echo "  - Jest: test-reports/jest-output.txt"
echo "  - Newman: newman-reports/flow-report.html"
echo "  - Playwright: playwright-report/index.html"
echo ""

if [ $JEST_PASSED -eq 1 ] && [ $NEWMAN_PASSED -eq 1 ] && [ $PLAYWRIGHT_PASSED -eq 1 ]; then
    echo "🎉 ALL TESTS PASSED!"
    exit 0
else
    echo "⚠️  Some tests failed. Check reports above for details."
    exit 1
fi
