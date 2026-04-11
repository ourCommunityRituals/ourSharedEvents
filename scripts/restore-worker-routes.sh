#!/bin/bash
# SEC-4.2 Worker Routes Restore Script
#
# Restores Worker routes from a backup file created by export-worker-routes.sh
# Use this to rollback after route cleanup if issues occur.
#
# Usage: ./scripts/restore-worker-routes.sh <backup-file.json>
#
# Environment Variables:
#   CLOUDFLARE_ZONE_ID     - Zone ID (required)
#   CLOUDFLARE_API_TOKEN_OSE   - API token with Workers Routes:Edit permission (required)
#
# See docs/RUNBOOK-SEC-4.2-SINGLE-WORKER-ROUTE.md for full documentation

set -e

# Configuration
BACKUP_FILE="$1"
ZONE_ID="${CLOUDFLARE_ZONE_ID:-}"
CF_API_TOKEN="${CLOUDFLARE_API_TOKEN_OSE:-}"

echo "============================================"
echo "SEC-4.2 Worker Routes Restore"
echo "============================================"
echo ""

# Validate arguments
if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: $0 <backup-file.json>"
    echo ""
    echo "Example:"
    echo "  $0 route-backups/routes_backup_20251221_120000.json"
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Validate credentials
if [ -z "$ZONE_ID" ]; then
    echo "Error: CLOUDFLARE_ZONE_ID not set"
    exit 1
fi

if [ -z "$CF_API_TOKEN" ]; then
    echo "Error: CLOUDFLARE_API_TOKEN_OSE not set"
    exit 1
fi

echo "Backup file: $BACKUP_FILE"
echo "Zone ID:     $ZONE_ID"
echo ""

# Count routes to restore
ROUTE_COUNT=$(jq '.result | length' "$BACKUP_FILE")
echo "Routes to restore: $ROUTE_COUNT"
echo ""

# Confirmation
read -p "Are you sure you want to restore these routes? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Restore cancelled."
    exit 0
fi

echo ""
echo "Restoring routes..."
echo ""

SUCCESS_COUNT=0
SKIP_COUNT=0
FAIL_COUNT=0

# Read and restore each route
jq -c '.result[]' "$BACKUP_FILE" | while read -r route; do
    PATTERN=$(echo "$route" | jq -r '.pattern')
    SCRIPT=$(echo "$route" | jq -r '.script')

    echo "Restoring: $PATTERN → $SCRIPT"

    RESULT=$(curl -s -X POST \
        "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        --data "{\"pattern\": \"$PATTERN\", \"script\": \"$SCRIPT\"}")

    API_SUCCESS=$(echo "$RESULT" | jq -r '.success')
    if [ "$API_SUCCESS" = "true" ]; then
        echo "  ✓ Restored"
        ((SUCCESS_COUNT++)) || true
    else
        # Check if already exists
        ERROR_MSG=$(echo "$RESULT" | jq -r '.errors[0].message // "unknown"')
        if echo "$ERROR_MSG" | grep -qi "already exists"; then
            echo "  ⚠️ Already exists (skipped)"
            ((SKIP_COUNT++)) || true
        else
            echo "  ✗ Failed: $ERROR_MSG"
            ((FAIL_COUNT++)) || true
        fi
    fi

    # Small delay to avoid rate limiting
    sleep 0.5
done

echo ""
echo "============================================"
echo "Restore Complete"
echo "============================================"
echo ""

# Verify final state
echo "Verifying final route state..."
FINAL_COUNT=$(curl -s -X GET \
    "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" | jq '.result | length')

echo "Routes now configured: $FINAL_COUNT"
echo ""
echo "Next steps:"
echo "  1. Verify routes: wrangler route list --env production"
echo "  2. Test application: ./scripts/verify-sec-4.2.sh"
echo "  3. Monitor for issues"
