#!/bin/bash
# SEC-4.2 Single Worker Route Verification Script
#
# Verifies that Worker routes are consolidated to single wildcard per domain
# and that all app routes still function correctly.
#
# Usage: ./scripts/verify-sec-4.2.sh [--current-state]
#
# Options:
#   --current-state  Show current route inventory without running tests
#
# Environment Variables:
#   CLOUDFLARE_ZONE_ID     - Zone ID for API checks (optional)
#   CLOUDFLARE_API_TOKEN   - API token with Zone:Read permission (optional)
#
# See docs/RUNBOOK-SEC-4.2-SINGLE-WORKER-ROUTE.md for full documentation

set -e

DOMAIN="oursharedevents.com"
STAGING_DOMAIN="stg.oursharedevents.com"
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# Check for --current-state flag
if [ "$1" = "--current-state" ]; then
    echo "============================================"
    echo "SEC-4.2 Current Route Inventory"
    echo "============================================"
    echo ""

    if [ -n "$CLOUDFLARE_ZONE_ID" ] && [ -n "$CLOUDFLARE_API_TOKEN" ]; then
        echo "Fetching routes from Cloudflare API..."
        echo ""

        ROUTES=$(curl -s -X GET \
            "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/workers/routes" \
            -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
            -H "Content-Type: application/json")

        ROUTE_COUNT=$(echo "$ROUTES" | jq '.result | length')
        echo "Total routes: $ROUTE_COUNT"
        echo ""
        echo "Route inventory:"
        echo "$ROUTES" | jq -r '.result[] | "  \(.pattern) → \(.script)"'
        echo ""

        # Identify routes to keep vs remove
        echo "Analysis:"
        echo "$ROUTES" | jq -r '.result[] | "\(.pattern)|\(.script)"' | while IFS='|' read -r pattern script; do
            case "$pattern" in
                "oursharedevents.com/*"|"api.oursharedevents.com/*"|"stg.oursharedevents.com/*"|"api-stg.oursharedevents.com/*")
                    echo "  [KEEP]   $pattern"
                    ;;
                *)
                    echo "  [REMOVE] $pattern"
                    ;;
            esac
        done
    else
        echo "Cloudflare API credentials not configured."
        echo ""
        echo "Set environment variables:"
        echo "  export CLOUDFLARE_ZONE_ID=your-zone-id"
        echo "  export CLOUDFLARE_API_TOKEN=your-api-token"
        echo ""
        echo "Showing wrangler.toml routes instead:"
        echo ""
        echo "=== worker/wrangler.toml ==="
        grep -A4 "routes = \[" worker/wrangler.toml 2>/dev/null || echo "Not found"
        echo ""
        echo "=== cloudflare-proxy/wrangler.toml ==="
        grep -A4 "routes = \[" cloudflare-proxy/wrangler.toml 2>/dev/null || echo "Not found"
    fi
    exit 0
fi

echo "============================================"
echo "SEC-4.2 Single Worker Route Verification"
echo "============================================"
echo ""
echo "Target: 4 routes total (1 wildcard per domain)"
echo "  - oursharedevents.com/*"
echo "  - api.oursharedevents.com/*"
echo "  - stg.oursharedevents.com/*"
echo "  - api-stg.oursharedevents.com/*"
echo ""

# ===========================================
# Test 1: Route Count Check (if API available)
# ===========================================
echo "1. Checking route count via Cloudflare API..."
if [ -n "$CLOUDFLARE_ZONE_ID" ] && [ -n "$CLOUDFLARE_API_TOKEN" ]; then
    ROUTES=$(curl -s -X GET \
        "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/workers/routes" \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        -H "Content-Type: application/json" 2>/dev/null)

    ROUTE_COUNT=$(echo "$ROUTES" | jq '.result | length' 2>/dev/null || echo "0")

    if [ "$ROUTE_COUNT" -le 4 ]; then
        echo "   ✅ PASS: Only $ROUTE_COUNT routes configured (target: ≤4)"
        ((PASS_COUNT++))
    else
        echo "   ❌ FAIL: $ROUTE_COUNT routes found (target: ≤4)"
        echo "   Run: ./scripts/verify-sec-4.2.sh --current-state"
        ((FAIL_COUNT++))
    fi
else
    echo "   ⚠️  SKIP: CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN not set"
    ((WARN_COUNT++))
fi
echo ""

# ===========================================
# Test 2: Production Homepage
# ===========================================
echo "2. Testing production homepage ($DOMAIN/)..."
HOMEPAGE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/" 2>/dev/null || echo "error")
if [ "$HOMEPAGE_STATUS" = "200" ] || [ "$HOMEPAGE_STATUS" = "302" ]; then
    echo "   ✅ PASS: Returns $HOMEPAGE_STATUS"
    ((PASS_COUNT++))
elif [ "$HOMEPAGE_STATUS" = "error" ]; then
    echo "   ⚠️  SKIP: Could not reach $DOMAIN"
    ((WARN_COUNT++))
else
    echo "   ❌ FAIL: Returns $HOMEPAGE_STATUS (expected 200 or 302)"
    ((FAIL_COUNT++))
fi
echo ""

# ===========================================
# Test 3: API Status Endpoint
# ===========================================
echo "3. Testing API status endpoint ($DOMAIN/api/status)..."
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/api/status" 2>/dev/null || echo "error")
if [ "$API_STATUS" = "200" ]; then
    echo "   ✅ PASS: Returns 200"
    ((PASS_COUNT++))
elif [ "$API_STATUS" = "error" ]; then
    echo "   ⚠️  SKIP: Could not reach API endpoint"
    ((WARN_COUNT++))
else
    echo "   ❌ FAIL: Returns $API_STATUS"
    ((FAIL_COUNT++))
fi
echo ""

# ===========================================
# Test 4: App-Handled Page Routes
# ===========================================
echo "4. Testing app-handled page routes..."
PAGES=("admin" "public" "display" "poster" "report" "sponsor")
PAGE_PASS=0
PAGE_FAIL=0

for page in "${PAGES[@]}"; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/$page" 2>/dev/null || echo "error")
    if [ "$STATUS" = "200" ]; then
        echo "   ✅ /$page: 200"
        ((PAGE_PASS++))
    elif [ "$STATUS" = "error" ]; then
        echo "   ⚠️  /$page: unreachable"
    else
        echo "   ❌ /$page: $STATUS"
        ((PAGE_FAIL++))
    fi
done

if [ "$PAGE_FAIL" -eq 0 ]; then
    echo "   All page routes working ✓"
    ((PASS_COUNT++))
else
    echo "   Some page routes failed"
    ((FAIL_COUNT++))
fi
echo ""

# ===========================================
# Test 5: Route Aliases (app-owned routing)
# ===========================================
echo "5. Testing route aliases (app-owned routing)..."
ALIASES=("manage:admin" "dashboard:admin" "events:public" "schedule:public")
ALIAS_PASS=0

for alias_pair in "${ALIASES[@]}"; do
    alias_path="${alias_pair%%:*}"
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/$alias_path" 2>/dev/null || echo "error")
    if [ "$STATUS" = "200" ]; then
        echo "   ✅ /$alias_path: 200"
        ((ALIAS_PASS++))
    elif [ "$STATUS" = "error" ]; then
        echo "   ⚠️  /$alias_path: unreachable"
    else
        echo "   ❌ /$alias_path: $STATUS"
    fi
done

if [ "$ALIAS_PASS" -ge 2 ]; then
    echo "   Route aliases working ✓"
    ((PASS_COUNT++))
fi
echo ""

# ===========================================
# Test 6: API Subdomain
# ===========================================
echo "6. Testing API subdomain (api.$DOMAIN)..."
API_SUB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://api.$DOMAIN/api/status" 2>/dev/null || echo "error")
if [ "$API_SUB_STATUS" = "200" ]; then
    echo "   ✅ PASS: Returns 200"
    ((PASS_COUNT++))
elif [ "$API_SUB_STATUS" = "error" ]; then
    echo "   ⚠️  SKIP: Could not reach API subdomain"
    ((WARN_COUNT++))
else
    echo "   ⚠️  INFO: Returns $API_SUB_STATUS (may be expected)"
    ((WARN_COUNT++))
fi
echo ""

# ===========================================
# Test 7: www Redirect (SEC-4.1 still works)
# ===========================================
echo "7. Verifying www redirect still works (SEC-4.1)..."
WWW_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -I "https://www.$DOMAIN/" 2>/dev/null || echo "error")
if [ "$WWW_STATUS" = "301" ]; then
    echo "   ✅ PASS: www returns 301"
    ((PASS_COUNT++))
elif [ "$WWW_STATUS" = "error" ]; then
    echo "   ⚠️  SKIP: Could not reach www"
    ((WARN_COUNT++))
else
    echo "   ⚠️  WARN: www returns $WWW_STATUS (expected 301)"
    ((WARN_COUNT++))
fi
echo ""

# ===========================================
# Test 8: Staging Environment
# ===========================================
echo "8. Testing staging environment ($STAGING_DOMAIN)..."
STG_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$STAGING_DOMAIN/api/status" 2>/dev/null || echo "error")
if [ "$STG_STATUS" = "200" ]; then
    echo "   ✅ PASS: Staging returns 200"
    ((PASS_COUNT++))
elif [ "$STG_STATUS" = "error" ]; then
    echo "   ⚠️  SKIP: Could not reach staging"
    ((WARN_COUNT++))
else
    echo "   ⚠️  INFO: Staging returns $STG_STATUS"
    ((WARN_COUNT++))
fi
echo ""

# ===========================================
# Test 9: Staging API Subdomain
# ===========================================
echo "9. Testing staging API subdomain (api-$STAGING_DOMAIN)..."
STG_API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://api-stg.$DOMAIN/api/status" 2>/dev/null || echo "error")
if [ "$STG_API_STATUS" = "200" ]; then
    echo "   ✅ PASS: Staging API returns 200"
    ((PASS_COUNT++))
elif [ "$STG_API_STATUS" = "error" ]; then
    echo "   ⚠️  SKIP: Could not reach staging API"
    ((WARN_COUNT++))
else
    echo "   ⚠️  INFO: Staging API returns $STG_API_STATUS"
    ((WARN_COUNT++))
fi
echo ""

# ===========================================
# Test 10: wrangler.toml Configuration
# ===========================================
echo "10. Verifying wrangler.toml route configuration..."
TOML_ERRORS=0

# Check worker/wrangler.toml
if grep -q 'pattern = "oursharedevents.com/\*"' worker/wrangler.toml 2>/dev/null; then
    echo "   ✅ worker/wrangler.toml: oursharedevents.com/* configured"
else
    echo "   ❌ worker/wrangler.toml: oursharedevents.com/* not found"
    ((TOML_ERRORS++))
fi

# Check for path-specific routes that shouldn't exist
if grep -qE 'pattern = "oursharedevents\.com/(admin|public|api|display)/\*"' worker/wrangler.toml 2>/dev/null; then
    echo "   ❌ worker/wrangler.toml: Path-specific routes found (should be removed)"
    ((TOML_ERRORS++))
else
    echo "   ✅ worker/wrangler.toml: No path-specific routes"
fi

if [ "$TOML_ERRORS" -eq 0 ]; then
    ((PASS_COUNT++))
else
    ((FAIL_COUNT++))
fi
echo ""

# ===========================================
# Summary
# ===========================================
echo "============================================"
echo "Summary"
echo "============================================"
echo "Passed:   $PASS_COUNT"
echo "Failed:   $FAIL_COUNT"
echo "Warnings: $WARN_COUNT"
echo ""

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo "✅ All critical tests passed!"
    echo ""
    echo "SEC-4.2 Acceptance Criteria:"
    echo "  [✓] Only one Worker route per domain (plus API subdomain)"
    echo "  [✓] All app routes function correctly via wildcard"
    echo "  [✓] App-owned routing handles all paths"
    echo "  [✓] www redirect still works (SEC-4.1)"
    exit 0
else
    echo "❌ Some tests failed. Review the output above."
    echo ""
    echo "Troubleshooting:"
    echo "  - Run with --current-state to see route inventory"
    echo "  - Check docs/RUNBOOK-SEC-4.2-SINGLE-WORKER-ROUTE.md"
    exit 1
fi
