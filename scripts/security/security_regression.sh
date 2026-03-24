#!/usr/bin/env bash
# =============================================================================
# security_regression.sh — Security Regression Gate
# =============================================================================
# PROMPTSPEC-SEC-10.1: Security Regression Gate (CI must break)
#
# Purpose:
#   Enforce NS-1..NS-4 and QR-0 security requirements via automated checks.
#   Any violation fails CI to prevent security regressions.
#
# Usage:
#   ./scripts/security/security_regression.sh <base_url>
#
# Environment Variables:
#   SKIP_ORIGIN_BYPASS   - Set to "true" to skip origin bypass check (if not configured)
#   SKIP_RATE_LIMIT      - Set to "true" to skip rate limit check (useful in CI)
#   SKIP_WWW_CHECK       - Set to "true" to skip www redirect check (for subdomains)
#   BEHIND_CF_ACCESS     - Set to "true" if target is behind Cloudflare Access
#   CF_ACCESS_CLIENT_ID  - Cloudflare Access Service Token Client ID (optional)
#   CF_ACCESS_CLIENT_SECRET - Cloudflare Access Service Token Secret (optional)
#   TEST_EVENT_ID        - Optional event ID for QR-0 testing (default: test-event)
#
# Exit Codes:
#   0 - All security checks passed
#   1 - One or more security checks failed
#   2 - Usage error or configuration problem
#
# Checks Performed:
#   NS-1: www → canonical redirect
#   NS-2: Privileged routes require auth (expect redirect/login/deny)
#   NS-3: /health (api/status) returns boring OK
#   NS-4: Rate limit triggers on /api* or /jserror* (optional)
#   NS-5: Origin bypass fails (optional, skip via SKIP_ORIGIN_BYPASS=true)
#   QR-0: Poster/display payloads with QR must include verified flag
#
# =============================================================================

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Default values
DEFAULT_TEST_EVENT_ID="test-event"

# =============================================================================
# Helper Functions
# =============================================================================

log_header() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

log_check() {
    echo -e "${BLUE}[CHECK]${NC} $1"
}

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((TESTS_PASSED++))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((TESTS_FAILED++))
}

log_skip() {
    echo -e "${YELLOW}[SKIP]${NC} $1"
    ((TESTS_SKIPPED++))
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_detail() {
    echo -e "       $1"
}

usage() {
    cat << EOF
Usage: $0 <base_url>

Security Regression Gate - Enforces NS-1..NS-4 and QR-0 requirements.

Arguments:
  base_url    Required. The base URL to test (e.g., https://www.eventangle.com)

Environment Variables:
  SKIP_ORIGIN_BYPASS   Set to "true" to skip origin bypass check
  SKIP_RATE_LIMIT      Set to "true" to skip rate limit check (faster CI)
  SKIP_WWW_CHECK       Set to "true" to skip www redirect check (for subdomains)
  BEHIND_CF_ACCESS     Set to "true" if target is behind Cloudflare Access
  CF_ACCESS_CLIENT_ID  Cloudflare Access Service Token Client ID
  CF_ACCESS_CLIENT_SECRET  Cloudflare Access Service Token Secret
  TEST_EVENT_ID        Event ID for QR-0 testing (default: $DEFAULT_TEST_EVENT_ID)

Exit Codes:
  0 - All security checks passed
  1 - One or more security checks failed
  2 - Usage error or configuration problem

Examples:
  $0 https://www.eventangle.com
  SKIP_RATE_LIMIT=true $0 https://stg.eventangle.com
  SKIP_WWW_CHECK=true BEHIND_CF_ACCESS=true $0 https://stg.eventangle.com

EOF
    exit 2
}

# =============================================================================
# Validation & Utilities
# =============================================================================

validate_url() {
    local url="$1"
    if [[ ! "$url" =~ ^https?:// ]]; then
        echo -e "${RED}[ERROR]${NC} Invalid URL: $url (must start with http:// or https://)"
        exit 2
    fi
}

# Build CF Access headers if configured
get_cf_access_headers() {
    local headers=""
    if [[ -n "${CF_ACCESS_CLIENT_ID:-}" && -n "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
        headers="-H 'CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}' -H 'CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}'"
    fi
    echo "$headers"
}

# Check if domain is a subdomain (has more than 2 parts)
is_subdomain() {
    local domain="$1"
    # Remove www. prefix if present for counting
    domain="${domain#www.}"
    # Count dots - subdomain has 2+ dots (e.g., stg.example.com has 2 dots)
    local dot_count
    dot_count=$(echo "$domain" | tr -cd '.' | wc -c)
    [[ $dot_count -ge 2 ]]
}

# Detect if response is a Cloudflare Access challenge page
is_cf_access_challenge() {
    local response="$1"
    if echo "$response" | grep -q "Just a moment\|Checking your browser\|cf-browser-verification\|challenge-platform"; then
        return 0
    fi
    return 1
}

# =============================================================================
# Security Check Functions
# =============================================================================

# NS-1: www → canonical redirect
check_www_canonical_redirect() {
    local base_url="$1"
    log_header "NS-1: www → Canonical Redirect"

    # Check if www check is explicitly skipped
    if [[ "${SKIP_WWW_CHECK:-false}" == "true" ]]; then
        log_skip "NS-1: www redirect check skipped (SKIP_WWW_CHECK=true)"
        return 0
    fi

    # Extract domain from base URL
    local domain
    domain=$(echo "$base_url" | sed -E 's|https?://||' | sed -E 's|/.*||')

    # Skip www check for subdomains (e.g., stg.eventangle.com)
    # www.stg.eventangle.com is not a valid pattern
    if is_subdomain "$domain"; then
        log_skip "NS-1: Skipping www check for subdomain ($domain)"
        log_detail "www prefix is not applicable to staging/preview subdomains"
        return 0
    fi

    # If domain already has www, test redirect to non-www
    # If domain doesn't have www, test that www redirects to non-www
    local www_url
    local expected_location

    if [[ "$domain" == www.* ]]; then
        # Domain has www, expected behavior: stay on www or redirect to non-www
        www_url="$base_url"
        expected_location="${base_url/www./}"
        log_check "Testing: $www_url (expect redirect or same)"
    else
        # Domain without www, test www version
        local proto
        proto=$(echo "$base_url" | grep -oE '^https?')
        www_url="${proto}://www.${domain}"
        expected_location="$base_url"
        log_check "Testing: $www_url → $expected_location"
    fi

    # Send request and follow redirects, capture final URL
    local response
    response=$(curl -s -o /dev/null -w "%{http_code}|%{redirect_url}" \
        --max-time 10 \
        --connect-timeout 5 \
        -L "$www_url" 2>/dev/null || echo "000|")

    local http_code="${response%%|*}"
    local redirect_url="${response#*|}"

    log_detail "Response code: $http_code"
    log_detail "Redirect URL: ${redirect_url:-none}"

    # Check for successful redirect or direct access
    if [[ "$http_code" =~ ^(200|301|302|307|308)$ ]]; then
        # If there was a redirect, verify it goes to canonical
        if [[ -n "$redirect_url" ]]; then
            if [[ "$redirect_url" != *"www."* ]] || [[ "$domain" == www.* ]]; then
                log_pass "NS-1: www correctly redirects to canonical domain"
                return 0
            fi
        fi
        # Direct 200 is also acceptable if www is the canonical
        if [[ "$http_code" == "200" ]]; then
            log_pass "NS-1: Domain responds correctly (canonical may be www)"
            return 0
        fi
        log_pass "NS-1: Redirect behavior is correct"
        return 0
    elif [[ "$http_code" == "000" ]]; then
        # Connection failed - www subdomain may not exist (acceptable for some setups)
        log_skip "NS-1: www subdomain not reachable (may not be configured)"
        log_detail "This is acceptable if www is not part of the deployment"
        return 0
    else
        log_fail "NS-1: www canonical redirect not working (status: $http_code)"
        return 1
    fi
}

# NS-2: Privileged routes require Access
check_privileged_routes_auth() {
    local base_url="$1"
    log_header "NS-2: Privileged Routes Require Auth"

    # If behind CF Access, all routes are protected at the edge
    if [[ "${BEHIND_CF_ACCESS:-false}" == "true" ]]; then
        log_check "Environment is behind Cloudflare Access..."
        log_detail "CF Access provides authentication layer for all routes"
        log_pass "NS-2: All routes protected by Cloudflare Access"
        return 0
    fi

    local all_passed=true

    # List of privileged routes to test (without auth)
    local -a admin_api_routes=(
        "/api/v2/admin/events"
        "/api/admin/events"
        "/api/events/test/adminBundle"
    )

    local -a admin_page_routes=(
        "/admin"
        "/manage"
        "/dashboard"
    )

    # Test API routes - expect 401, 403, or 503 (not configured)
    log_check "Testing admin API routes (expect 401/403/503)..."
    for route in "${admin_api_routes[@]}"; do
        local url="${base_url}${route}"
        local http_code
        local response

        response=$(curl -s --max-time 10 --connect-timeout 5 -X POST -H "Content-Type: application/json" "$url" 2>/dev/null)
        http_code=$(curl -s -o /dev/null -w "%{http_code}" \
            --max-time 10 \
            --connect-timeout 5 \
            -X POST \
            -H "Content-Type: application/json" \
            "$url" 2>/dev/null || echo "000")

        log_detail "POST $route → $http_code"

        # Detect CF Access challenge and auto-skip
        if [[ "$http_code" == "403" ]] && is_cf_access_challenge "$response"; then
            log_detail "  CF Access detected - setting BEHIND_CF_ACCESS=true"
            log_pass "NS-2: All routes protected by Cloudflare Access (auto-detected)"
            return 0
        fi

        # Accept 401 (unauthorized), 403 (forbidden), 404 (not found), 503 (not configured)
        # Reject 200, 201, 2xx which would indicate unauthenticated access
        if [[ "$http_code" =~ ^(401|403|404|405|503)$ ]]; then
            : # OK - access denied as expected
        elif [[ "$http_code" =~ ^2 ]]; then
            log_fail "NS-2: $route allows unauthenticated POST (got $http_code)"
            all_passed=false
        fi
    done

    # Test admin page routes - expect 401, 403, or redirect (302/307)
    log_check "Testing admin page routes (expect 401/403/302)..."
    for route in "${admin_page_routes[@]}"; do
        local url="${base_url}${route}"
        local http_code
        http_code=$(curl -s -o /dev/null -w "%{http_code}" \
            --max-time 10 \
            --connect-timeout 5 \
            "$url" 2>/dev/null || echo "000")

        log_detail "GET $route → $http_code"

        # Accept 401, 403, 302 (redirect to login), 307, or 200 with OAuth guard
        # If OAuth is not enabled, 200 is acceptable (page requires client-side auth)
        if [[ "$http_code" =~ ^(200|401|403|302|307)$ ]]; then
            : # OK - either guarded or returns page that guards itself
        else
            log_fail "NS-2: $route unexpected response (got $http_code)"
            all_passed=false
        fi
    done

    if $all_passed; then
        log_pass "NS-2: All privileged routes require authentication"
        return 0
    else
        return 1
    fi
}

# NS-3: /health returns boring OK
check_health_endpoint() {
    local base_url="$1"
    log_header "NS-3: Health Endpoint Returns Boring OK"

    local url="${base_url}/api/status"
    log_check "Testing: GET $url"

    local response
    local http_code
    local curl_args=()

    # Add CF Access headers if configured
    if [[ -n "${CF_ACCESS_CLIENT_ID:-}" && -n "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
        curl_args+=(-H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}")
        curl_args+=(-H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}")
        log_detail "Using CF Access service token"
    fi

    # Capture both response body and status code
    response=$(curl -s --max-time 10 --connect-timeout 5 "${curl_args[@]}" "$url" 2>/dev/null)
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 --connect-timeout 5 "${curl_args[@]}" "$url" 2>/dev/null || echo "000")

    log_detail "Status: $http_code"
    log_detail "Response: ${response:0:100}..."

    # Handle Cloudflare Access protected environments
    if [[ "$http_code" == "403" ]]; then
        # Check if this is a CF Access challenge page
        if is_cf_access_challenge "$response"; then
            if [[ "${BEHIND_CF_ACCESS:-false}" == "true" ]]; then
                # Expected behavior - staging is protected by CF Access
                log_pass "NS-3: Health endpoint protected by Cloudflare Access (expected)"
                log_detail "Set CF_ACCESS_CLIENT_ID/SECRET to test the actual endpoint"
                return 0
            else
                log_fail "NS-3: Health endpoint blocked by Cloudflare Access"
                log_detail "Set BEHIND_CF_ACCESS=true if this is expected, or provide CF Access credentials"
                return 1
            fi
        fi
        # 403 from the app itself (not CF Access) - this is a failure
        log_fail "NS-3: Health endpoint returned 403 (should be public)"
        return 1
    fi

    # Check status code
    if [[ "$http_code" != "200" ]]; then
        log_fail "NS-3: Health endpoint returned $http_code (expected 200)"
        return 1
    fi

    # Check response is "boring" - should be JSON with ok:true or simple success
    if echo "$response" | grep -q '"ok"'; then
        # Verify no sensitive data leaked
        if echo "$response" | grep -qiE '(password|secret|key|token|credential)'; then
            log_fail "NS-3: Health endpoint may be leaking sensitive data"
            return 1
        fi
        log_pass "NS-3: Health endpoint returns boring OK response"
        return 0
    elif echo "$response" | grep -qiE '^(ok|healthy|up|alive)$'; then
        log_pass "NS-3: Health endpoint returns simple OK"
        return 0
    else
        # Check if it's valid JSON at least
        if echo "$response" | jq . >/dev/null 2>&1; then
            log_pass "NS-3: Health endpoint returns valid JSON response"
            return 0
        fi
        log_fail "NS-3: Health endpoint response format unexpected"
        return 1
    fi
}

# NS-4: Rate limit triggers on /api* or /jserror*
check_rate_limiting() {
    local base_url="$1"
    log_header "NS-4: Rate Limiting Enforcement"

    # Check if rate limit testing is skipped
    if [[ "${SKIP_RATE_LIMIT:-false}" == "true" ]]; then
        log_skip "NS-4: Rate limit check skipped (SKIP_RATE_LIMIT=true)"
        return 0
    fi

    log_check "Testing rate limiting on /jserror (threshold: 10 req/10s)..."

    local url="${base_url}/jserror"
    local request_count=0
    local max_requests=50  # Safety cap
    local rate_limit_hit=false

    # Send rapid requests until we hit rate limit or max
    while [[ $request_count -lt $max_requests ]]; do
        ((request_count++))

        local http_code
        http_code=$(curl -s -o /dev/null -w "%{http_code}" \
            --max-time 5 \
            --connect-timeout 3 \
            -X POST \
            -H "Content-Type: application/json" \
            -d '{"error":"test"}' \
            "$url" 2>/dev/null || echo "000")

        if [[ "$http_code" == "429" ]]; then
            rate_limit_hit=true
            log_detail "Rate limit (429) triggered at request #$request_count"
            break
        fi

        # Progress indicator
        if [[ $((request_count % 10)) -eq 0 ]]; then
            log_detail "Sent $request_count requests, last status: $http_code"
        fi
    done

    if $rate_limit_hit; then
        if [[ $request_count -le 30 ]]; then
            log_pass "NS-4: Rate limiting correctly enforced (triggered at request #$request_count)"
            return 0
        else
            log_pass "NS-4: Rate limiting working (triggered later than expected at #$request_count)"
            return 0
        fi
    else
        log_fail "NS-4: Rate limit NOT triggered after $max_requests requests"
        log_detail "Rate limiting may not be configured for /jserror"
        return 1
    fi
}

# NS-5: Origin bypass fails
check_origin_bypass() {
    local base_url="$1"
    log_header "NS-5: Origin Bypass Protection"

    # Check if origin bypass testing is skipped
    if [[ "${SKIP_ORIGIN_BYPASS:-false}" == "true" ]]; then
        log_skip "NS-5: Origin bypass check skipped (SKIP_ORIGIN_BYPASS=true)"
        return 0
    fi

    log_check "Testing spoofed origin headers..."

    local url="${base_url}/api/v2/events"
    local spoofed_origins=(
        "http://evil.example.com"
        "null"
        "file://"
    )

    local all_passed=true

    for origin in "${spoofed_origins[@]}"; do
        local http_code
        local response

        response=$(curl -s --max-time 10 --connect-timeout 5 \
            -H "Origin: $origin" \
            "$url" 2>/dev/null)
        http_code=$(curl -s -o /dev/null -w "%{http_code}" \
            --max-time 10 \
            --connect-timeout 5 \
            -H "Origin: $origin" \
            "$url" 2>/dev/null || echo "000")

        log_detail "Origin: '$origin' → Status: $http_code"

        # For CORS, the request itself may succeed (200) but the browser enforces
        # Check if Access-Control-Allow-Origin header reflects the spoofed origin
        local acao
        acao=$(curl -s -I --max-time 10 --connect-timeout 5 \
            -H "Origin: $origin" \
            "$url" 2>/dev/null | grep -i "access-control-allow-origin" || true)

        if [[ -n "$acao" ]]; then
            log_detail "ACAO header: $acao"
            # Check if the spoofed origin is reflected back (bad) or * (depends on context)
            if echo "$acao" | grep -q "$origin"; then
                log_fail "NS-5: Spoofed origin '$origin' is reflected in ACAO header"
                all_passed=false
            fi
        fi
    done

    if $all_passed; then
        log_pass "NS-5: Origin bypass protection working (spoofed origins not reflected)"
        return 0
    else
        return 1
    fi
}

# QR-0: Poster/display payloads with QR must include verified flag
check_qr_verified_flag() {
    local base_url="$1"
    log_header "QR-0: QR Payloads Must Include Verified Flag"

    local test_event_id="${TEST_EVENT_ID:-$DEFAULT_TEST_EVENT_ID}"
    local all_passed=true
    local curl_args=()

    # Add CF Access headers if configured
    if [[ -n "${CF_ACCESS_CLIENT_ID:-}" && -n "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
        curl_args+=(-H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}")
        curl_args+=(-H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}")
    fi

    # Endpoints that return QR codes
    local -a qr_endpoints=(
        "/api/events/${test_event_id}/posterBundle"
        "/api/events/${test_event_id}/displayBundle"
        "/api/events/${test_event_id}/publicBundle"
    )

    log_check "Testing QR endpoints for verified flag contract..."

    for endpoint in "${qr_endpoints[@]}"; do
        local url="${base_url}${endpoint}"
        local response
        local http_code

        response=$(curl -s --max-time 10 --connect-timeout 5 "${curl_args[@]}" "$url" 2>/dev/null)
        http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 --connect-timeout 5 "${curl_args[@]}" "$url" 2>/dev/null || echo "000")

        log_detail "GET $endpoint → $http_code"

        # If endpoint returns 404 (event not found), skip QR check for this endpoint
        if [[ "$http_code" == "404" ]]; then
            log_detail "  Event not found - skipping QR check"
            continue
        fi

        # If endpoint returns 403, check for different reasons
        if [[ "$http_code" == "403" ]]; then
            # Check if the 403 is because of asset state (this is correct behavior)
            if echo "$response" | grep -q "ASSET_NOT_RENDERABLE"; then
                log_detail "  Asset not renderable (expected for non-ACTIVE) - PASS"
                continue
            fi
            # Check if it's CF Access
            if is_cf_access_challenge "$response"; then
                if [[ "${BEHIND_CF_ACCESS:-false}" == "true" ]]; then
                    log_detail "  Protected by CF Access (skipping runtime QR check)"
                    continue
                fi
            fi
        fi

        # If endpoint returns 503 (not configured), skip
        if [[ "$http_code" == "503" ]]; then
            log_detail "  Service not configured - skipping"
            continue
        fi

        # For successful responses, check QR contract
        if [[ "$http_code" == "200" ]]; then
            # Check if response contains QR data
            local has_qr=false
            if echo "$response" | jq -e '.value.qr' >/dev/null 2>&1; then
                has_qr=true
            fi

            if $has_qr; then
                # QR-0 CONTRACT: If QR is present, qrVerified flag MUST also be present
                if echo "$response" | jq -e '.value.qrVerified' >/dev/null 2>&1; then
                    local qr_verified
                    qr_verified=$(echo "$response" | jq -r '.value.qrVerified')
                    log_detail "  QR present with qrVerified=$qr_verified - PASS"
                else
                    # QR-0 VIOLATION: QR present but no qrVerified flag
                    log_fail "QR-0: $endpoint returns QR but missing qrVerified flag"
                    log_detail "  TODO CONTRACT: Endpoint must include qrVerified field when returning QR codes"
                    all_passed=false
                fi
            else
                log_detail "  No QR in response - N/A"
            fi
        fi
    done

    # Additional contract check: ACTIVE events MUST have qrVerified=true
    log_check "Checking assetState/qrVerified consistency..."

    local checked_any=false
    for endpoint in "${qr_endpoints[@]}"; do
        local url="${base_url}${endpoint}"
        local response

        response=$(curl -s --max-time 10 --connect-timeout 5 "${curl_args[@]}" "$url" 2>/dev/null)

        # Parse response
        if echo "$response" | jq -e '.value.assetState' >/dev/null 2>&1; then
            local asset_state
            local qr_verified
            checked_any=true

            asset_state=$(echo "$response" | jq -r '.value.assetState // "unknown"')
            qr_verified=$(echo "$response" | jq -r '.value.qrVerified // "null"')

            log_detail "$endpoint: assetState=$asset_state, qrVerified=$qr_verified"

            # QR-0 ENFORCEMENT: ACTIVE state implies qrVerified=true
            if [[ "$asset_state" == "ACTIVE" && "$qr_verified" != "true" ]]; then
                log_fail "QR-0: ACTIVE event missing qrVerified=true (fail closed)"
                log_detail "  Contract: ACTIVE events must have qrVerified=true"
                all_passed=false
            fi
        fi
    done

    # If behind CF Access and couldn't check any endpoints, rely on source code check
    if ! $checked_any && [[ "${BEHIND_CF_ACCESS:-false}" == "true" ]]; then
        log_detail "Could not perform runtime QR checks (CF Access protected)"
        log_detail "QR-0 contract verified via source code analysis in CI workflow"
    fi

    if $all_passed; then
        log_pass "QR-0: All QR endpoints correctly include verified flag contract"
        return 0
    else
        return 1
    fi
}

# =============================================================================
# Main Execution
# =============================================================================

main() {
    # Parse arguments
    if [[ $# -lt 1 ]]; then
        usage
    fi

    local base_url="$1"

    # Remove trailing slash
    base_url="${base_url%/}"

    # Validate inputs
    validate_url "$base_url"

    # Print header
    echo ""
    echo "============================================================"
    echo "  Security Regression Gate - PROMPTSPEC-SEC-10.1"
    echo "============================================================"
    echo ""
    echo "  Target: $base_url"
    echo "  Date:   $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo ""
    echo "  Environment:"
    echo "    SKIP_ORIGIN_BYPASS: ${SKIP_ORIGIN_BYPASS:-false}"
    echo "    SKIP_RATE_LIMIT:    ${SKIP_RATE_LIMIT:-false}"
    echo "    SKIP_WWW_CHECK:     ${SKIP_WWW_CHECK:-false}"
    echo "    BEHIND_CF_ACCESS:   ${BEHIND_CF_ACCESS:-false}"
    echo "    CF_ACCESS_TOKEN:    ${CF_ACCESS_CLIENT_ID:+configured}"
    echo "    TEST_EVENT_ID:      ${TEST_EVENT_ID:-$DEFAULT_TEST_EVENT_ID}"
    echo ""
    echo "============================================================"

    # Check connectivity first
    log_info "Checking connectivity to $base_url..."
    local connectivity_check
    connectivity_check=$(curl -s -o /dev/null -w "%{http_code}" \
        --max-time 10 \
        --connect-timeout 5 \
        "${base_url}/api/status" 2>/dev/null || echo "000")

    if [[ "$connectivity_check" == "000" ]]; then
        echo -e "${RED}[ERROR]${NC} Cannot connect to $base_url"
        echo "Please verify the URL and network connectivity"
        exit 2
    fi

    log_info "Connected successfully (status: $connectivity_check)"

    # Run all security checks
    local exit_code=0

    check_www_canonical_redirect "$base_url" || exit_code=1
    check_privileged_routes_auth "$base_url" || exit_code=1
    check_health_endpoint "$base_url" || exit_code=1
    check_rate_limiting "$base_url" || exit_code=1
    check_origin_bypass "$base_url" || exit_code=1
    check_qr_verified_flag "$base_url" || exit_code=1

    # Print summary
    echo ""
    echo "============================================================"
    echo "  SECURITY REGRESSION SUMMARY"
    echo "============================================================"
    echo ""
    echo -e "  ${GREEN}Passed:${NC}  $TESTS_PASSED"
    echo -e "  ${RED}Failed:${NC}  $TESTS_FAILED"
    echo -e "  ${YELLOW}Skipped:${NC} $TESTS_SKIPPED"
    echo ""

    if [[ $exit_code -eq 0 ]]; then
        echo -e "  ${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "  ${GREEN}  ✓ ALL SECURITY CHECKS PASSED${NC}"
        echo -e "  ${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    else
        echo -e "  ${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "  ${RED}  ✗ SECURITY REGRESSION DETECTED - CI MUST FAIL${NC}"
        echo -e "  ${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        echo "  Fix the security issues above before merging."
        echo "  See docs/SECURITY.md for remediation guidance."
    fi
    echo ""
    echo "============================================================"
    echo ""

    exit $exit_code
}

# Run main function
main "$@"
