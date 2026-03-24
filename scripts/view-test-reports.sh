#!/bin/bash
# View Test Reports - Opens HTML reports for each test suite
# Usage: ./scripts/view-test-reports.sh [suite]
# Examples:
#   ./scripts/view-test-reports.sh api    # Open API test reports
#   ./scripts/view-test-reports.sh all    # Open all available reports
#   ./scripts/view-test-reports.sh        # Show available reports

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "🔍 Playwright Test Report Viewer"
echo "=================================="
echo ""

# Function to check if report exists and open it
open_report() {
    local suite=$1
    local report_dir="playwright-report-${suite}"

    if [ -d "$report_dir" ] && [ -f "$report_dir/index.html" ]; then
        echo -e "${GREEN}✅ Opening ${suite} test report...${NC}"
        npx playwright show-report "$report_dir"
        return 0
    else
        echo -e "${RED}❌ No ${suite} test report found${NC}"
        echo "   Run: npm run test:${suite}"
        return 1
    fi
}

# Function to list available reports
list_reports() {
    echo "📊 Available Test Reports:"
    echo ""

    local found_any=false

    for suite in api smoke pages flows; do
        local report_dir="playwright-report-${suite}"
        if [ -d "$report_dir" ] && [ -f "$report_dir/index.html" ]; then
            local test_count=$(grep -o '<div class="chip">[0-9]* passed' "$report_dir/index.html" | head -1 | grep -o '[0-9]*' || echo "?")
            echo -e "${GREEN}✅ ${suite}${NC} - ${test_count} tests"
            found_any=true
        else
            echo -e "${YELLOW}⚠️  ${suite}${NC} - not generated yet"
        fi
    done

    echo ""

    if [ "$found_any" = false ]; then
        echo -e "${YELLOW}No test reports found. Run tests first:${NC}"
        echo "  npm run test:api        # API tests"
        echo "  npm run test:smoke:all  # Smoke tests"
        echo "  npm run test:pages      # Page tests"
        echo "  npm run test:flows      # Flow tests"
        echo "  npm run test:e2e        # All E2E tests"
    else
        echo "Usage:"
        echo "  $0 api     # View API test report"
        echo "  $0 smoke   # View smoke test report"
        echo "  $0 pages   # View page test report"
        echo "  $0 flows   # View flow test report"
        echo "  $0 all     # Open all reports (sequential)"
    fi
}

# Main logic
if [ $# -eq 0 ]; then
    list_reports
    exit 0
fi

suite=$1

case "$suite" in
    api|smoke|pages|flows)
        open_report "$suite"
        ;;
    all)
        echo "Opening all available reports..."
        echo ""
        for s in api smoke pages flows; do
            open_report "$s" || true
        done
        ;;
    *)
        echo -e "${RED}Invalid suite: $suite${NC}"
        echo ""
        list_reports
        exit 1
        ;;
esac
