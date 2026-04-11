#!/bin/bash
# SEC-4.2 Worker Routes Export Script
#
# Exports all current Cloudflare Worker routes to a backup file.
# Use this BEFORE making any route changes for safe rollback.
#
# Usage: ./scripts/export-worker-routes.sh
#
# Environment Variables:
#   CLOUDFLARE_ZONE_ID     - Zone ID (required)
#   CLOUDFLARE_API_TOKEN_OSE   - API token with Zone:Read permission (required)
#
# Output:
#   Creates timestamped backup in ./route-backups/
#
# See docs/RUNBOOK-SEC-4.2-SINGLE-WORKER-ROUTE.md for full documentation

set -e

# Configuration
ZONE_ID="${CLOUDFLARE_ZONE_ID:-}"
CF_API_TOKEN="${CLOUDFLARE_API_TOKEN_OSE:-}"
EXPORT_DIR="./route-backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
EXPORT_FILE="${EXPORT_DIR}/routes_backup_${TIMESTAMP}.json"

echo "============================================"
echo "SEC-4.2 Worker Routes Export"
echo "============================================"
echo ""

# Validate credentials
if [ -z "$ZONE_ID" ]; then
    echo "Error: CLOUDFLARE_ZONE_ID not set"
    echo ""
    echo "Usage:"
    echo "  export CLOUDFLARE_ZONE_ID=your-zone-id"
    echo "  export CLOUDFLARE_API_TOKEN_OSE=your-api-token"
    echo "  ./scripts/export-worker-routes.sh"
    exit 1
fi

if [ -z "$CF_API_TOKEN" ]; then
    echo "Error: CLOUDFLARE_API_TOKEN_OSE not set"
    echo ""
    echo "Usage:"
    echo "  export CLOUDFLARE_ZONE_ID=your-zone-id"
    echo "  export CLOUDFLARE_API_TOKEN_OSE=your-api-token"
    echo "  ./scripts/export-worker-routes.sh"
    exit 1
fi

# Create backup directory
mkdir -p "$EXPORT_DIR"

echo "Zone ID:   $ZONE_ID"
echo "Timestamp: $TIMESTAMP"
echo "Output:    $EXPORT_FILE"
echo ""

# Fetch routes from Cloudflare API
echo "Fetching routes from Cloudflare API..."
RESPONSE=$(curl -s -X GET \
    "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json")

# Check for API errors
SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
if [ "$SUCCESS" != "true" ]; then
    echo "Error: API request failed"
    echo "$RESPONSE" | jq '.errors'
    exit 1
fi

# Save to file
echo "$RESPONSE" | jq '.' > "$EXPORT_FILE"

# Count routes
ROUTE_COUNT=$(jq '.result | length' "$EXPORT_FILE")

echo ""
echo "Exported $ROUTE_COUNT routes"
echo ""

# List routes
echo "Routes exported:"
echo "----------------------------------------"
jq -r '.result[] | "  \(.pattern)\n    → Worker: \(.script)\n    → ID: \(.id)"' "$EXPORT_FILE"
echo "----------------------------------------"
echo ""

# Validate export
if [ "$ROUTE_COUNT" -eq 0 ]; then
    echo "WARNING: No routes exported. This may indicate:"
    echo "  - API token lacks permissions"
    echo "  - Zone ID is incorrect"
    echo "  - No Worker routes exist"
    exit 1
fi

# Create summary
SUMMARY_FILE="${EXPORT_DIR}/routes_summary_${TIMESTAMP}.txt"
{
    echo "SEC-4.2 Worker Routes Backup"
    echo "============================"
    echo ""
    echo "Timestamp: $(date)"
    echo "Zone ID:   $ZONE_ID"
    echo "Routes:    $ROUTE_COUNT"
    echo ""
    echo "Route List:"
    jq -r '.result[] | "  - \(.pattern) → \(.script)"' "$EXPORT_FILE"
    echo ""
    echo "To restore:"
    echo "  ./scripts/restore-worker-routes.sh $EXPORT_FILE"
} > "$SUMMARY_FILE"

echo "============================================"
echo "Export Complete"
echo "============================================"
echo ""
echo "Backup files:"
echo "  - JSON:    $EXPORT_FILE"
echo "  - Summary: $SUMMARY_FILE"
echo ""
echo "To restore routes if needed:"
echo "  ./scripts/restore-worker-routes.sh $EXPORT_FILE"
echo ""
echo "Next steps (SEC-4.2):"
echo "  1. Review exported routes"
echo "  2. Identify routes to remove (non-wildcard, legacy)"
echo "  3. Run: ./scripts/verify-sec-4.2.sh --current-state"
echo "  4. Follow RUNBOOK-SEC-4.2-SINGLE-WORKER-ROUTE.md"
