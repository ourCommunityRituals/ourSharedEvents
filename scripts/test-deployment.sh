#!/bin/bash
# Test deployment script to verify 302 redirect fix
# Run this locally after authenticating with: npx clasp login

set -e

echo "🧪 Test Deployment Script - Verify 302 Redirect Fix"
echo "========================================================"
echo ""

# Check if clasp is authenticated
if ! npx clasp login --status &>/dev/null; then
    echo "❌ Not authenticated with clasp"
    echo ""
    echo "Please run first:"
    echo "  npx clasp login"
    echo ""
    exit 1
fi

echo "✅ Authenticated with clasp"
echo ""

# Push the latest code
echo "📤 Pushing latest code to Apps Script..."
npx clasp push --force
echo ""

# List current deployments
echo "📋 Current deployments:"
npx clasp deployments
echo ""

# Ask user which deployment to update or create new
read -p "Enter deployment ID to update (@1, @2, etc.) or press Enter to create new: " DEPLOY_ID

if [ -n "$DEPLOY_ID" ]; then
    echo ""
    echo "🔄 Updating deployment $DEPLOY_ID..."
    npx clasp deploy -i "$DEPLOY_ID" -d "Test Deploy - Fix 302 redirects $(date -Iseconds)"
else
    echo ""
    echo "🆕 Creating new deployment..."
    npx clasp deploy -d "Test Deploy - Fix 302 redirects $(date -Iseconds)"
fi

echo ""
echo "📋 Updated deployments:"
DEPLOYMENTS=$(npx clasp deployments)
echo "$DEPLOYMENTS"
echo ""

# Extract web app URL
WEB_APP_URL=$(echo "$DEPLOYMENTS" | grep -oP 'https://script\.google\.com/macros/s/[^/]+/exec' | head -1)

if [ -z "$WEB_APP_URL" ]; then
    echo "⚠️ Could not automatically extract web app URL"
    echo "Please copy the URL from the deployments list above"
    exit 0
fi

echo "🌐 Web App URL: $WEB_APP_URL"
echo ""

# Test the deployment
echo "🧪 Testing deployment for 302 redirects - All Brands"
echo "========================================================"
echo ""

BRANDS=("root" "ABC" "CBC")
FAILED=0

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
        echo "   ❌ HTTP 302 - Still redirecting!"
        echo ""
        echo "   Response:"
        echo "$RESPONSE_BODY" | head -5
        echo ""
        echo "   🔍 Troubleshooting:"
        echo "   1. Make sure you deployed AFTER changing appsscript.json"
        echo "   2. Verify appsscript.json has: \"executeAs\": \"USER_DEPLOYING\""
        echo "   3. Try creating a brand new deployment instead of updating"
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

# Check if any tests failed
if [ $FAILED -eq 1 ]; then
    echo "========================================================"
    echo "❌ DEPLOYMENT TEST FAILED!"
    echo "Some brands returned 302 redirects"
    echo "========================================================"
    exit 1
fi

echo ""
echo "========================================================"
echo "🎉 SUCCESS! 302 redirects are FIXED!"
echo "========================================================"
echo ""
echo "All brands (root, ABC, CBC) are accessible without redirects!"
echo ""
echo "Your deployment is working correctly at:"
echo "  $WEB_APP_URL"
echo ""
echo "Brand URLs:"
echo "  Root:  $WEB_APP_URL?page=status&brand=root"
echo "  ABC:   $WEB_APP_URL?page=status&brand=ABC"
echo "  CBC:   $WEB_APP_URL?page=status&brand=CBC"
echo ""
echo "Next steps:"
echo "1. Save this deployment ID for GitHub secrets (optional)"
echo "2. Merge the PR to main"
echo "3. CI will deploy with the fixed configuration"
echo ""
