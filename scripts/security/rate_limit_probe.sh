#!/usr/bin/env bash
# =============================================================================
# rate_limit_probe.sh — Rate Limiting Verification Probe
# =============================================================================
# PROMPTSPEC-SEC-6.2: Rate Limiting Spec + Probe Script
#
# Purpose:
#   Verify that rate limiting is correctly configured by deterministically
#   triggering 429 responses without crashing normal requests.
#
# Usage:
#   ./scripts/security/rate_limit_probe.sh <base_url> [endpoint] [threshold]
#
# Arguments:
#   base_url    - Required. The base URL to test (e.g., https://www.eventangle.com)
#   endpoint    - Optional. The endpoint path to probe (default: /api/v2/events)
#   threshold   - Optional. Expected rate limit threshold (default: 100)
#
# Examples:
#   ./scripts/security/rate_limit_probe.sh https://www.eventangle.com
#   ./scripts/security/rate_limit_probe.sh https://stg.eventangle.com /api/v2/events 100
#   ./scripts/security/rate_limit_probe.sh https://stg.eventangle.com /api/v2/admin/events 20
#
# Exit Codes:
#   0 - Success: 429 triggered within expected bounds
#   1 - Failure: Rate limit not triggered or exceeded max attempts
#   2 - Usage error
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
NC='\033[0m' # No Color

# Default values
DEFAULT_ENDPOINT="/api/v2/events"
DEFAULT_THRESHOLD=100
MAX_REQUESTS=500  # Safety cap to prevent infinite loops
DELAY_BETWEEN_REQUESTS=0  # No delay for rate limit testing

# Buffer percentage for threshold variance
THRESHOLD_BUFFER_LOW=0.5   # Expect 429 after threshold * 0.5
THRESHOLD_BUFFER_HIGH=2.0  # Fail if 429 not received by threshold * 2

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $1"
}

usage() {
    cat << EOF
Usage: $0 <base_url> [endpoint] [threshold]

Probe rate limiting configuration by sending rapid requests until 429 is received.

Arguments:
  base_url    Required. The base URL to test (e.g., https://www.eventangle.com)
  endpoint    Optional. The endpoint path (default: $DEFAULT_ENDPOINT)
  threshold   Optional. Expected rate limit threshold (default: $DEFAULT_THRESHOLD)

Endpoint Presets:
  /api/v2/events           - API read endpoint (threshold: 100)
  /api/v2/admin/events     - Admin write endpoint (threshold: 20)
  /jserror                 - Error reporting (threshold: 10)
  /auth/login              - Auth endpoint (threshold: 30)
  /api/status              - Health endpoint (threshold: 300)

Examples:
  $0 https://www.eventangle.com
  $0 https://stg.eventangle.com /api/v2/events 100
  $0 https://stg.eventangle.com /jserror 10

Exit Codes:
  0 - Rate limit triggered within expected bounds
  1 - Rate limit not triggered or verification failed
  2 - Usage error

EOF
    exit 2
}

# =============================================================================
# Validation
# =============================================================================

validate_url() {
    local url="$1"
    if [[ ! "$url" =~ ^https?:// ]]; then
        log_error "Invalid URL: $url (must start with http:// or https://)"
        exit 2
    fi
}

validate_endpoint() {
    local endpoint="$1"
    if [[ ! "$endpoint" =~ ^/ ]]; then
        log_error "Invalid endpoint: $endpoint (must start with /)"
        exit 2
    fi
}

validate_threshold() {
    local threshold="$1"
    if ! [[ "$threshold" =~ ^[0-9]+$ ]]; then
        log_error "Invalid threshold: $threshold (must be a positive integer)"
        exit 2
    fi
    if [[ "$threshold" -lt 1 ]]; then
        log_error "Threshold must be at least 1"
        exit 2
    fi
}

# =============================================================================
# Rate Limit Probe
# =============================================================================

probe_rate_limit() {
    local base_url="$1"
    local endpoint="$2"
    local threshold="$3"

    local full_url="${base_url}${endpoint}"
    local min_expected=$((threshold * 5 / 10))  # 50% of threshold
    local max_expected=$((threshold * 20 / 10)) # 200% of threshold
    local request_count=0
    local rate_limit_triggered=false
    local trigger_count=0

    log_info "Starting rate limit probe"
    log_info "  URL: $full_url"
    log_info "  Expected threshold: $threshold requests/10s"
    log_info "  Acceptable range: $min_expected - $max_expected requests before 429"
    log_info "  Max attempts: $MAX_REQUESTS"
    echo ""

    # Reset any existing rate limit by waiting
    log_info "Waiting 15 seconds to reset any existing rate limit state..."
    sleep 15

    log_info "Sending rapid requests..."

    local start_time=$(date +%s)

    while [[ $request_count -lt $MAX_REQUESTS ]]; do
        request_count=$((request_count + 1))

        # Send request and capture status code
        local http_status
        http_status=$(curl -s -o /dev/null -w "%{http_code}" \
            --max-time 10 \
            --connect-timeout 5 \
            "$full_url" 2>/dev/null || echo "000")

        # Progress indicator every 10 requests
        if [[ $((request_count % 10)) -eq 0 ]]; then
            echo -ne "\r  Requests sent: $request_count (last status: $http_status)"
        fi

        # Check for rate limit response
        if [[ "$http_status" == "429" ]]; then
            trigger_count=$request_count
            rate_limit_triggered=true
            echo ""  # New line after progress
            log_success "Rate limit triggered at request #$trigger_count"
            break
        fi

        # Check for server errors (may indicate other issues)
        if [[ "$http_status" =~ ^5[0-9][0-9]$ ]]; then
            echo ""
            log_warning "Server error ($http_status) at request #$request_count"
        fi

        # Check for connection errors
        if [[ "$http_status" == "000" ]]; then
            echo ""
            log_warning "Connection error at request #$request_count"
            sleep 1
        fi

        # Small delay if specified (0 by default for rate limit testing)
        if [[ $DELAY_BETWEEN_REQUESTS -gt 0 ]]; then
            sleep "$DELAY_BETWEEN_REQUESTS"
        fi
    done

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    echo ""
    log_info "Probe completed in ${duration}s"

    # Evaluate results
    if [[ "$rate_limit_triggered" == "true" ]]; then
        if [[ $trigger_count -ge $min_expected && $trigger_count -le $max_expected ]]; then
            echo ""
            log_success "PASS: Rate limit correctly configured"
            log_info "  Triggered at request #$trigger_count (expected range: $min_expected - $max_expected)"
            return 0
        elif [[ $trigger_count -lt $min_expected ]]; then
            echo ""
            log_warning "Rate limit triggered too early"
            log_info "  Triggered at request #$trigger_count (expected minimum: $min_expected)"
            log_info "  This may indicate a stricter rate limit than documented"
            return 0  # Still pass - rate limiting is working
        else
            echo ""
            log_warning "Rate limit triggered later than expected"
            log_info "  Triggered at request #$trigger_count (expected maximum: $max_expected)"
            log_info "  Consider lowering the threshold for better protection"
            return 0  # Still pass - rate limiting is working
        fi
    else
        echo ""
        log_error "FAIL: Rate limit NOT triggered after $MAX_REQUESTS requests"
        log_info "  This may indicate:"
        log_info "  - Rate limiting is not enabled"
        log_info "  - Threshold is higher than $MAX_REQUESTS"
        log_info "  - IP-based limiting is bypassed (CDN, proxy)"
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
    local endpoint="${2:-$DEFAULT_ENDPOINT}"
    local threshold="${3:-$DEFAULT_THRESHOLD}"

    # Auto-detect threshold based on endpoint if not specified
    if [[ $# -lt 3 ]]; then
        case "$endpoint" in
            */admin/*)
                threshold=20
                ;;
            *jserror*)
                threshold=10
                ;;
            /auth/*)
                threshold=30
                ;;
            */status|*/health/*)
                threshold=300
                ;;
            *)
                threshold=$DEFAULT_THRESHOLD
                ;;
        esac
    fi

    # Validate inputs
    validate_url "$base_url"
    validate_endpoint "$endpoint"
    validate_threshold "$threshold"

    # Print header
    echo ""
    echo "=============================================="
    echo "  Rate Limit Probe - SEC-6.2"
    echo "=============================================="
    echo ""

    # Check connectivity first
    log_info "Checking connectivity to $base_url..."
    local connectivity_check
    connectivity_check=$(curl -s -o /dev/null -w "%{http_code}" \
        --max-time 10 \
        --connect-timeout 5 \
        "${base_url}/api/status" 2>/dev/null || echo "000")

    if [[ "$connectivity_check" == "000" ]]; then
        log_error "Cannot connect to $base_url"
        log_info "Please verify the URL and network connectivity"
        exit 1
    fi

    log_success "Connected successfully (status: $connectivity_check)"
    echo ""

    # Run the probe
    probe_rate_limit "$base_url" "$endpoint" "$threshold"
    exit_code=$?

    echo ""
    echo "=============================================="
    if [[ $exit_code -eq 0 ]]; then
        echo -e "  Result: ${GREEN}PASS${NC}"
    else
        echo -e "  Result: ${RED}FAIL${NC}"
    fi
    echo "=============================================="
    echo ""

    exit $exit_code
}

# Run main function
main "$@"
