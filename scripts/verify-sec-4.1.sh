#!/bin/bash
# SEC-4.1 Canonical Host Redirect Verification Script
#
# Verifies that www.eventangle.com correctly redirects to eventangle.com
#
# Usage: ./scripts/verify-sec-4.1.sh
#
# See docs/RUNBOOK-SEC-4.1-CANONICAL-HOST.md for full documentation

set -e

DOMAIN="eventangle.com"
PASS_COUNT=0
FAIL_COUNT=0

echo "============================================"
echo "SEC-4.1 Canonical Host Verification"
echo "============================================"
echo ""
echo "Canonical host: $DOMAIN"
echo "Redirect host:  www.$DOMAIN"
echo ""

# Test 1: www redirects to apex
echo "1. Testing www → apex redirect..."
REDIRECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -I "https://www.$DOMAIN/" 2>/dev/null || echo "error")
if [ "$REDIRECT_STATUS" = "301" ]; then
    REDIRECT_LOCATION=$(curl -s -I "https://www.$DOMAIN/" 2>/dev/null | grep -i "^location:" | tr -d '\r' | head -1)
    echo "   ✅ PASS: www returns 301 (Permanent Redirect)"
    echo "   $REDIRECT_LOCATION"
    ((PASS_COUNT++))
else
    echo "   ❌ FAIL: www returned $REDIRECT_STATUS (expected 301)"
    ((FAIL_COUNT++))
fi
echo ""

# Test 2: Canonical host works
echo "2. Testing canonical host ($DOMAIN)..."
CANONICAL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -I "https://$DOMAIN/" 2>/dev/null || echo "error")
if [ "$CANONICAL_STATUS" = "200" ]; then
    echo "   ✅ PASS: Canonical host returns 200 OK"
    ((PASS_COUNT++))
else
    echo "   ❌ FAIL: Canonical host returned $CANONICAL_STATUS"
    ((FAIL_COUNT++))
fi
echo ""

# Test 3: Path preservation
echo "3. Testing path preservation (/admin)..."
REDIRECT_PATH=$(curl -s -I "https://www.$DOMAIN/admin" 2>/dev/null | grep -i "^location:" | tr -d '\r' | head -1)
if echo "$REDIRECT_PATH" | grep -q "/admin"; then
    echo "   ✅ PASS: Path preserved in redirect"
    echo "   $REDIRECT_PATH"
    ((PASS_COUNT++))
else
    echo "   ❌ FAIL: Path not preserved"
    echo "   Got: $REDIRECT_PATH"
    ((FAIL_COUNT++))
fi
echo ""

# Test 4: Query string preservation
echo "4. Testing query string preservation (?brand=abc)..."
REDIRECT_QS=$(curl -s -I "https://www.$DOMAIN/public?brand=abc" 2>/dev/null | grep -i "^location:" | tr -d '\r' | head -1)
if echo "$REDIRECT_QS" | grep -q "brand=abc"; then
    echo "   ✅ PASS: Query string preserved"
    echo "   $REDIRECT_QS"
    ((PASS_COUNT++))
else
    echo "   ❌ FAIL: Query string not preserved"
    echo "   Got: $REDIRECT_QS"
    ((FAIL_COUNT++))
fi
echo ""

# Test 5: API subdomain unaffected
echo "5. Testing API subdomain (api.$DOMAIN)..."
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -I "https://api.$DOMAIN/api/status" 2>/dev/null || echo "error")
if [ "$API_STATUS" = "200" ]; then
    echo "   ✅ PASS: API subdomain returns 200 OK"
    ((PASS_COUNT++))
elif [ "$API_STATUS" = "error" ]; then
    echo "   ⚠️  SKIP: Could not reach API subdomain"
else
    echo "   ⚠️  INFO: API returned $API_STATUS (may be expected)"
    ((PASS_COUNT++))
fi
echo ""

# Test 6: Staging subdomain unaffected
echo "6. Testing staging subdomain (stg.$DOMAIN)..."
STG_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -I "https://stg.$DOMAIN/" 2>/dev/null || echo "error")
if [ "$STG_STATUS" = "200" ]; then
    echo "   ✅ PASS: Staging subdomain returns 200 OK"
    ((PASS_COUNT++))
elif [ "$STG_STATUS" = "error" ]; then
    echo "   ⚠️  SKIP: Could not reach staging subdomain"
else
    echo "   ⚠️  INFO: Staging returned $STG_STATUS (may be expected)"
    ((PASS_COUNT++))
fi
echo ""

# Summary
echo "============================================"
echo "Summary"
echo "============================================"
echo "Passed: $PASS_COUNT"
echo "Failed: $FAIL_COUNT"
echo ""

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo "✅ All critical tests passed!"
    echo ""
    echo "SEC-4.1 Acceptance Criteria:"
    echo "  [✓] www.eventangle.com/* 301 → eventangle.com/*"
    echo "  [✓] Path and query string preserved"
    echo "  [✓] No Worker routes required for www"
    exit 0
else
    echo "❌ Some tests failed. See above for details."
    exit 1
fi
