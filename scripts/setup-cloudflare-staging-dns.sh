#!/bin/bash
#
# Cloudflare Staging DNS Setup Script
#
# This script creates the necessary DNS records in Cloudflare for the staging environment:
#   - stg.eventangle.com    -> Proxied to Cloudflare Worker
#   - api-stg.eventangle.com -> Proxied to Cloudflare Worker
#
# Prerequisites:
#   1. CLOUDFLARE_API_TOKEN environment variable set (with Zone:DNS:Edit permission)
#   2. CLOUDFLARE_ZONE_ID environment variable set (optional, will be auto-detected)
#
# Usage:
#   export CLOUDFLARE_API_TOKEN="your-api-token"
#   ./scripts/setup-cloudflare-staging-dns.sh
#
#   Or with explicit zone ID:
#   CLOUDFLARE_ZONE_ID="your-zone-id" ./scripts/setup-cloudflare-staging-dns.sh
#
# The script is idempotent - running it multiple times is safe.
#

set -e

ZONE_NAME="eventangle.com"
API_BASE="https://api.cloudflare.com/client/v4"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to extract JSON value (no jq dependency)
# Usage: extract_json_value "$json" "key"
extract_json_value() {
    local json="$1"
    local key="$2"
    echo "$json" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*:.*"\([^"]*\)".*/\1/'
}

# Function to extract first result id from Cloudflare API response
extract_result_id() {
    local json="$1"
    # Match "result":[{"id":"xxx" pattern
    echo "$json" | grep -o '"result":\[{"id":"[^"]*"' | head -1 | sed 's/.*"id":"\([^"]*\)".*/\1/'
}

echo "========================================"
echo "  Cloudflare Staging DNS Setup"
echo "========================================"
echo ""

# Check for API token
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo -e "${RED}Error: CLOUDFLARE_API_TOKEN environment variable is not set${NC}"
    echo ""
    echo "To create an API token:"
    echo "  1. Go to https://dash.cloudflare.com/profile/api-tokens"
    echo "  2. Click 'Create Token'"
    echo "  3. Use template: 'Edit zone DNS'"
    echo "  4. Select zone: eventangle.com"
    echo "  5. Copy the token and set:"
    echo "     export CLOUDFLARE_API_TOKEN='your-token'"
    echo ""
    exit 1
fi

# Get Zone ID if not provided
if [ -z "$CLOUDFLARE_ZONE_ID" ]; then
    echo "Looking up Zone ID for ${ZONE_NAME}..."

    ZONE_RESPONSE=$(curl -s -X GET "${API_BASE}/zones?name=${ZONE_NAME}" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json")

    # Check for errors
    if echo "$ZONE_RESPONSE" | grep -q '"success":false'; then
        echo -e "${RED}Error: Failed to lookup zone${NC}"
        echo "$ZONE_RESPONSE"
        exit 1
    fi

    CLOUDFLARE_ZONE_ID=$(extract_result_id "$ZONE_RESPONSE")

    if [ -z "$CLOUDFLARE_ZONE_ID" ]; then
        echo -e "${RED}Error: Could not find zone for ${ZONE_NAME}${NC}"
        echo "Make sure the domain is added to your Cloudflare account."
        echo "Response: $ZONE_RESPONSE"
        exit 1
    fi

    echo -e "${GREEN}Found Zone ID: ${CLOUDFLARE_ZONE_ID}${NC}"
else
    echo "Using provided Zone ID: ${CLOUDFLARE_ZONE_ID}"
fi

echo ""

# Function to create or update DNS record
create_dns_record() {
    local subdomain=$1
    local record_name="${subdomain}.${ZONE_NAME}"

    echo "Setting up DNS record for ${record_name}..."

    # Check if record already exists
    EXISTING=$(curl -s -X GET "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=A&name=${record_name}" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json")

    EXISTING_ID=$(extract_result_id "$EXISTING")

    # DNS record configuration
    # Using 192.0.2.1 (RFC 5737 TEST-NET-1) as a placeholder IP
    # The Cloudflare Worker route will intercept all traffic, so this IP is never actually reached
    local DNS_DATA=$(cat <<EOF
{
    "type": "A",
    "name": "${subdomain}",
    "content": "192.0.2.1",
    "ttl": 1,
    "proxied": true,
    "comment": "Staging subdomain - proxied to Cloudflare Worker"
}
EOF
)

    if [ -z "$EXISTING_ID" ]; then
        # Create new record
        echo "  Creating new DNS record..."
        RESPONSE=$(curl -s -X POST "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
            -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data "$DNS_DATA")
    else
        # Update existing record
        echo "  Updating existing DNS record (ID: ${EXISTING_ID})..."
        RESPONSE=$(curl -s -X PUT "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${EXISTING_ID}" \
            -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data "$DNS_DATA")
    fi

    # Check response
    if echo "$RESPONSE" | grep -q '"success":true'; then
        echo -e "  ${GREEN}Success: ${record_name} is now proxied through Cloudflare${NC}"
        return 0
    else
        echo -e "  ${RED}Error creating DNS record:${NC}"
        echo "  $RESPONSE"
        return 1
    fi
}

# Create DNS records for staging subdomains
echo "Creating staging DNS records..."
echo ""

ERRORS=0

create_dns_record "stg" || ERRORS=$((ERRORS + 1))
echo ""

create_dns_record "api-stg" || ERRORS=$((ERRORS + 1))
echo ""

# Summary
echo "========================================"
echo "  Setup Complete"
echo "========================================"
echo ""

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}All DNS records created successfully!${NC}"
    echo ""
    echo "DNS Records configured:"
    echo "  - stg.eventangle.com     -> Proxied (Cloudflare Worker)"
    echo "  - api-stg.eventangle.com -> Proxied (Cloudflare Worker)"
    echo ""
    echo "Next steps:"
    echo "  1. Deploy the staging worker:"
    echo "     cd cloudflare-proxy && wrangler deploy --env staging"
    echo ""
    echo "  2. Verify staging is working:"
    echo "     curl https://stg.eventangle.com/status"
    echo ""
    echo "Note: DNS propagation may take a few minutes."
else
    echo -e "${YELLOW}Completed with ${ERRORS} error(s)${NC}"
    echo "Please check the error messages above and retry."
fi
