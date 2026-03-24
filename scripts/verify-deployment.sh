#!/bin/bash
# Deployment Verification Script
# Tests your Apps Script deployment before running E2E tests

set -e  # Exit on error

echo "🔍 MVP Event Toolkit - Deployment Verification"
echo "=============================================="
echo ""

# Check if BASE_URL is set
if [ -z "$BASE_URL" ]; then
    echo "❌ BASE_URL environment variable not set"
    echo ""
    echo "Please set it first:"
    echo "  export BASE_URL=\"https://script.google.com/macros/s/YOUR_ID/exec\""
    echo ""
    exit 1
fi

echo "✅ BASE_URL set: $BASE_URL"
echo ""

# Test 1: Status Endpoint
echo "📋 Test 1: Status Endpoint"
echo "   GET $BASE_URL?page=status"
echo ""

STATUS_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL?page=status")
HTTP_CODE=$(echo "$STATUS_RESPONSE" | tail -n 1)
RESPONSE_BODY=$(echo "$STATUS_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ HTTP 200 OK"

    # Check if response is valid JSON
    if echo "$RESPONSE_BODY" | jq empty 2>/dev/null; then
        echo "✅ Valid JSON response"

        # Extract build version
        BUILD=$(echo "$RESPONSE_BODY" | jq -r '.value.build // "unknown"')
        CONTRACT=$(echo "$RESPONSE_BODY" | jq -r '.value.contract // "unknown"')
        DB_OK=$(echo "$RESPONSE_BODY" | jq -r '.value.db.ok // false')

        echo "   Build: $BUILD"
        echo "   Contract: $CONTRACT"
        echo "   Database: $([ "$DB_OK" = "true" ] && echo "✅ Connected" || echo "❌ Error")"
    else
        echo "❌ Invalid JSON response"
        echo "$RESPONSE_BODY"
        exit 1
    fi
else
    echo "❌ HTTP $HTTP_CODE (expected 200)"
    echo "$RESPONSE_BODY"
    exit 1
fi

echo ""

# Test 2: Public Page
echo "📋 Test 2: Public Page"
echo "   GET $BASE_URL?p=events&brand=root"
echo ""

PUBLIC_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL?p=events&brand=root")
HTTP_CODE=$(echo "$PUBLIC_RESPONSE" | tail -n 1)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ HTTP 200 OK"
    echo "✅ Public page accessible"
else
    echo "❌ HTTP $HTTP_CODE (expected 200)"
    exit 1
fi

echo ""

# Test 3: Admin Page
echo "📋 Test 3: Admin Page"
echo "   GET $BASE_URL?page=admin&brand=root"
echo ""

ADMIN_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL?page=admin&brand=root")
HTTP_CODE=$(echo "$ADMIN_RESPONSE" | tail -n 1)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ HTTP 200 OK"
    echo "✅ Admin page accessible"
else
    echo "❌ HTTP $HTTP_CODE (expected 200)"
    exit 1
fi

echo ""

# Test 4: Display Page
echo "📋 Test 4: Display Page"
echo "   GET $BASE_URL?page=display&brand=root&tv=1"
echo ""

DISPLAY_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL?page=display&brand=root&tv=1")
HTTP_CODE=$(echo "$DISPLAY_RESPONSE" | tail -n 1)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ HTTP 200 OK"
    echo "✅ Display page accessible"
else
    echo "❌ HTTP $HTTP_CODE (expected 200)"
    exit 1
fi

echo ""
echo "=============================================="
echo "🎉 All deployment checks passed!"
echo ""
echo "Next steps:"
echo "  1. Set your admin key:"
echo "     export ADMIN_KEY=\"your_admin_secret\""
echo ""
echo "  2. Run E2E tests:"
echo "     npm run test:e2e"
echo ""
echo "  3. View test report:"
echo "     npx playwright show-report"
echo ""
