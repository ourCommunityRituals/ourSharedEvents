#!/bin/bash
# Quick test script to check if a URL has 302 redirect issues
# Tests all brands: root, ABC, CBC
# Usage: ./scripts/test-url.sh <URL>

if [ -z "$1" ]; then
    echo "Usage: $0 <WEB_APP_URL>"
    echo ""
    echo "Example:"
    echo "  $0 https://script.google.com/macros/s/YOUR_ID/exec"
    exit 1
fi

WEB_APP_URL="$1"
BRANDS=("root" "ABC" "CBC")
FAILED=0

echo "🧪 Testing URL for 302 redirects - All Brands"
echo "========================================================"
echo "URL: $WEB_APP_URL"
echo ""

# Function to test a brand
test_brand() {
    local BRAND=$1
    local TEST_NUM=$2

    echo "📋 Test $TEST_NUM: Status Endpoint - Brand: $BRAND"
    echo "   GET $WEB_APP_URL?page=status&brand=$BRAND"

    STATUS_RESPONSE=$(curl -s -w "\n%{http_code}" "$WEB_APP_URL?page=status&brand=$BRAND")
    HTTP_CODE=$(echo "$STATUS_RESPONSE" | tail -n 1)
    RESPONSE_BODY=$(echo "$STATUS_RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "200" ]; then
        echo "   ✅ HTTP 200 - No redirect!"

        # Check if response is valid JSON
        if echo "$RESPONSE_BODY" | jq empty 2>/dev/null; then
            BUILD=$(echo "$RESPONSE_BODY" | jq -r '.value.build // "unknown"')
            CONTRACT=$(echo "$RESPONSE_BODY" | jq -r '.value.contract // "unknown"')
            DB_OK=$(echo "$RESPONSE_BODY" | jq -r '.value.db.ok // false')

            echo "   📦 Build: $BUILD | Contract: $CONTRACT | DB: $DB_OK"
        else
            echo "   ⚠️ Response is not JSON (might be HTML error)"
            echo "$RESPONSE_BODY" | head -3
        fi
    elif [ "$HTTP_CODE" = "302" ]; then
        echo "   ❌ HTTP 302 - Redirecting to login!"
        echo ""
        echo "   Response:"
        echo "$RESPONSE_BODY" | head -5
        FAILED=1
    else
        echo "   ⚠️ HTTP $HTTP_CODE (unexpected)"
        echo "$RESPONSE_BODY" | head -3
        FAILED=1
    fi

    echo ""
}

# Test each brand
for i in "${!BRANDS[@]}"; do
    test_brand "${BRANDS[$i]}" $((i+1))
done

# Test public events page for root brand
echo "📋 Test 4: Public Events Page - Brand: root"
echo "   GET $WEB_APP_URL?p=events&brand=root"

PUBLIC_RESPONSE=$(curl -s -w "\n%{http_code}" "$WEB_APP_URL?p=events&brand=root")
HTTP_CODE=$(echo "$PUBLIC_RESPONSE" | tail -n 1)

if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ HTTP 200 - Public page accessible!"
elif [ "$HTTP_CODE" = "302" ]; then
    echo "   ❌ HTTP 302 - Redirecting to login!"
    FAILED=1
else
    echo "   ⚠️ HTTP $HTTP_CODE"
    FAILED=1
fi

echo ""
echo "========================================================"

if [ $FAILED -eq 0 ]; then
    echo "🎉 SUCCESS! All brands accessible - No 302 redirects!"
    echo ""
    echo "Tested brands: root, ABC, CBC"
    echo "All endpoints returned HTTP 200"
else
    echo "❌ FAILED! Some tests returned 302 redirects"
    echo ""
    echo "This means the deployment has: \"executeAs\": \"USER_ACCESSING\""
    echo "It needs to be changed to: \"executeAs\": \"USER_DEPLOYING\""
    echo ""
    echo "Then redeploy with:"
    echo "  npx clasp push --force"
    echo "  npx clasp deploy -i @YOUR_DEPLOYMENT_ID"
    exit 1
fi

echo "========================================================"
