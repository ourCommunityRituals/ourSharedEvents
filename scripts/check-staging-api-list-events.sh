#!/bin/bash
# =============================================================================
# check-staging-api-list-events.sh
# =============================================================================
# Story 2: Staging API smoke test script
#
# This script verifies that the staging GAS web app and Cloudflare Worker
# are correctly configured to accept API requests.
#
# Acceptance Criteria:
# 1. Direct GAS call returns 200 with valid JSON (no HTML, no permission message)
# 2. Worker proxy call (POST /api/rpc) returns 200 with same JSON structure
#
# Usage:
#   ./scripts/check-staging-api-list-events.sh
#
# Environment Variables (optional):
#   STAGING_WEB_APP_URL - Direct GAS URL (defaults to deployment ID URL)
#   STAGING_WORKER_URL  - Worker URL (defaults to https://stg.eventangle.com)
#
# =============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "=============================================="
echo "Story 2: Staging API Smoke Test"
echo "=============================================="
echo ""

# Configuration
STAGING_DEPLOYMENT_ID="${STAGING_DEPLOYMENT_ID:-AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm}"
GAS_URL="${STAGING_WEB_APP_URL:-https://script.google.com/macros/s/${STAGING_DEPLOYMENT_ID}/exec}"
WORKER_URL="${STAGING_WORKER_URL:-https://stg.eventangle.com}"

echo "Configuration:"
echo "  GAS URL:    $GAS_URL"
echo "  Worker URL: $WORKER_URL"
echo ""

# Test payload for api_list (list events)
API_PAYLOAD='{"action":"list","brand":"root"}'

# Track test results
TESTS_PASSED=0
TESTS_FAILED=0

# =============================================================================
# Test 1: Direct GAS Web App Call
# =============================================================================
echo "=============================================="
echo "Test 1: Direct GAS Web App (api_list)"
echo "=============================================="
echo "POST $GAS_URL"
echo "Body: $API_PAYLOAD"
echo ""

# Make the request
GAS_RESPONSE=$(curl -s -w "\n---HTTP_CODE:%{http_code}---" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Origin: https://stg.eventangle.com" \
  -d "$API_PAYLOAD" \
  "$GAS_URL" 2>&1)

# Extract HTTP code and body
GAS_HTTP_CODE=$(echo "$GAS_RESPONSE" | grep -o '---HTTP_CODE:[0-9]*---' | grep -o '[0-9]*')
GAS_BODY=$(echo "$GAS_RESPONSE" | sed 's/---HTTP_CODE:[0-9]*---$//')

echo "Response:"
echo "  HTTP Code: $GAS_HTTP_CODE"

# Check HTTP status
if [ "$GAS_HTTP_CODE" = "200" ]; then
  echo -e "  ${GREEN}HTTP 200 OK${NC}"
else
  echo -e "  ${RED}HTTP $GAS_HTTP_CODE (expected 200)${NC}"
  echo "  Response body: $GAS_BODY"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Check for HTML (permission denied page)
if echo "$GAS_BODY" | grep -qi '<!DOCTYPE\|<html\|Sorry, unable to open the file'; then
  echo -e "  ${RED}ERROR: Response is HTML (likely permission denied)${NC}"
  echo "  This means the GAS web app deployment needs proper permissions."
  echo "  Fix: Create new deployment with 'Anyone' access."
  TESTS_FAILED=$((TESTS_FAILED + 1))
elif echo "$GAS_BODY" | jq empty 2>/dev/null; then
  echo -e "  ${GREEN}Valid JSON response${NC}"

  # Check response structure
  OK_VALUE=$(echo "$GAS_BODY" | jq -r '.ok // "missing"')
  if [ "$OK_VALUE" = "true" ]; then
    echo -e "  ${GREEN}ok: true (success)${NC}"

    # Extract events count if available
    EVENTS_COUNT=$(echo "$GAS_BODY" | jq -r '.value | if type == "array" then length else "N/A" end')
    echo "  Events returned: $EVENTS_COUNT"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  elif [ "$OK_VALUE" = "false" ]; then
    CODE=$(echo "$GAS_BODY" | jq -r '.code // "unknown"')
    MSG=$(echo "$GAS_BODY" | jq -r '.message // "unknown"')
    echo -e "  ${RED}ok: false (error)${NC}"
    echo "  Error code: $CODE"
    echo "  Message: $MSG"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  else
    echo -e "  ${YELLOW}Warning: 'ok' field missing from response${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
else
  echo -e "  ${RED}Invalid JSON response${NC}"
  echo "  First 500 chars: ${GAS_BODY:0:500}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

echo ""

# =============================================================================
# Test 2: Worker Proxy (POST /api/rpc)
# =============================================================================
echo "=============================================="
echo "Test 2: Worker Proxy (/api/rpc)"
echo "=============================================="
echo "POST $WORKER_URL/api/rpc"

# RPC payload format
RPC_PAYLOAD='{"method":"api_list","payload":{"brand":"root"}}'
echo "Body: $RPC_PAYLOAD"
echo ""

# Make the request
WORKER_RESPONSE=$(curl -s -w "\n---HTTP_CODE:%{http_code}---" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "$RPC_PAYLOAD" \
  "$WORKER_URL/api/rpc" 2>&1)

# Extract HTTP code and body
WORKER_HTTP_CODE=$(echo "$WORKER_RESPONSE" | grep -o '---HTTP_CODE:[0-9]*---' | grep -o '[0-9]*')
WORKER_BODY=$(echo "$WORKER_RESPONSE" | sed 's/---HTTP_CODE:[0-9]*---$//')

echo "Response:"
echo "  HTTP Code: $WORKER_HTTP_CODE"

# Check HTTP status
if [ "$WORKER_HTTP_CODE" = "200" ]; then
  echo -e "  ${GREEN}HTTP 200 OK${NC}"
else
  echo -e "  ${RED}HTTP $WORKER_HTTP_CODE (expected 200)${NC}"
  echo "  Response body: $WORKER_BODY"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Check response format
if echo "$WORKER_BODY" | jq empty 2>/dev/null; then
  echo -e "  ${GREEN}Valid JSON response${NC}"

  OK_VALUE=$(echo "$WORKER_BODY" | jq -r '.ok // "missing"')
  if [ "$OK_VALUE" = "true" ]; then
    echo -e "  ${GREEN}ok: true (success)${NC}"

    EVENTS_COUNT=$(echo "$WORKER_BODY" | jq -r '.value | if type == "array" then length else "N/A" end')
    echo "  Events returned: $EVENTS_COUNT"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  elif [ "$OK_VALUE" = "false" ]; then
    CODE=$(echo "$WORKER_BODY" | jq -r '.code // "unknown"')
    MSG=$(echo "$WORKER_BODY" | jq -r '.message // "unknown"')
    echo -e "  ${RED}ok: false (error)${NC}"
    echo "  Error code: $CODE"
    echo "  Message: $MSG"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  else
    echo -e "  ${YELLOW}Warning: 'ok' field missing${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
else
  echo -e "  ${RED}Invalid JSON response${NC}"
  echo "  First 500 chars: ${WORKER_BODY:0:500}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

echo ""

# =============================================================================
# Test 3: Negative Path - Invalid Method Name
# =============================================================================
echo "=============================================="
echo "Test 3: Negative Path - Invalid Method"
echo "=============================================="
echo "POST $WORKER_URL/api/rpc with invalid method"

INVALID_PAYLOAD='{"method":"api_nonexistent_method","payload":{}}'
echo "Body: $INVALID_PAYLOAD"
echo ""

INVALID_RESPONSE=$(curl -s -w "\n---HTTP_CODE:%{http_code}---" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$INVALID_PAYLOAD" \
  "$WORKER_URL/api/rpc" 2>&1)

INVALID_HTTP_CODE=$(echo "$INVALID_RESPONSE" | grep -o '---HTTP_CODE:[0-9]*---' | grep -o '[0-9]*')
INVALID_BODY=$(echo "$INVALID_RESPONSE" | sed 's/---HTTP_CODE:[0-9]*---$//')

echo "Response:"
echo "  HTTP Code: $INVALID_HTTP_CODE"

if echo "$INVALID_BODY" | jq empty 2>/dev/null; then
  OK_VALUE=$(echo "$INVALID_BODY" | jq -r '.ok // "missing"')
  CODE=$(echo "$INVALID_BODY" | jq -r '.code // "none"')

  if [ "$OK_VALUE" = "false" ]; then
    echo -e "  ${GREEN}ok: false (expected for invalid method)${NC}"
    echo "  Error code: $CODE"
    echo "  Message: $(echo "$INVALID_BODY" | jq -r '.message // "none"')"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "  ${YELLOW}Unexpected ok: $OK_VALUE${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
else
  echo -e "  ${RED}Invalid JSON response${NC}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

echo ""

# =============================================================================
# Summary
# =============================================================================
echo "=============================================="
echo "Summary"
echo "=============================================="
echo ""
echo "Tests passed: $TESTS_PASSED"
echo "Tests failed: $TESTS_FAILED"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  echo ""
  echo "The staging API is correctly configured:"
  echo "  - GAS web app accepts anonymous HTTP requests"
  echo "  - Worker proxy forwards requests to GAS"
  echo "  - Invalid methods return proper error responses"
  exit 0
else
  echo -e "${RED}Some tests failed.${NC}"
  echo ""
  echo "Troubleshooting:"
  echo "  1. Verify GAS deployment has 'Anyone' access"
  echo "  2. Verify STAGING_WEB_APP_URL matches deployed version"
  echo "  3. Check Worker logs: wrangler tail --env staging"
  echo ""
  echo "Documentation: docs/STAGING_GAS_PERMISSIONS.md"
  exit 1
fi
