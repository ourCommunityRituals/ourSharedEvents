#!/bin/bash
# ============================================================================
# cleanup-old-versions.sh
# ============================================================================
# Deletes old Google Apps Script versions to prevent hitting the 200 limit.
# Keeps the most recent N versions (default: 50) and deletes the rest.
#
# Usage:
#   ./scripts/cleanup-old-versions.sh [--keep N] [--dry-run]
#
# Requirements:
#   - ~/.clasprc.json with valid OAuth credentials
#   - .clasp.json with scriptId
#   - jq installed
#
# ============================================================================

set -e

# Configuration
KEEP_VERSIONS=${KEEP_VERSIONS:-50}  # Number of recent versions to keep
DRY_RUN=false
VERBOSE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --keep)
      KEEP_VERSIONS="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--keep N] [--dry-run] [--verbose]"
      exit 1
      ;;
  esac
done

echo "=============================================="
echo "🧹 Apps Script Version Cleanup"
echo "=============================================="
echo ""
echo "Configuration:"
echo "  Keep versions: $KEEP_VERSIONS"
echo "  Dry run: $DRY_RUN"
echo ""

# Get script ID from .clasp.json
if [ ! -f ".clasp.json" ]; then
  echo "❌ ERROR: .clasp.json not found"
  exit 1
fi

SCRIPT_ID=$(jq -r '.scriptId' .clasp.json)
if [ -z "$SCRIPT_ID" ] || [ "$SCRIPT_ID" == "null" ]; then
  echo "❌ ERROR: Could not read scriptId from .clasp.json"
  exit 1
fi
echo "📋 Script ID: $SCRIPT_ID"

# Get OAuth token from ~/.clasprc.json
if [ ! -f ~/.clasprc.json ]; then
  echo "❌ ERROR: ~/.clasprc.json not found"
  echo "   Run 'clasp login' first"
  exit 1
fi

# Extract access token - need to handle token refresh
ACCESS_TOKEN=$(jq -r '.token.access_token' ~/.clasprc.json)
REFRESH_TOKEN=$(jq -r '.token.refresh_token' ~/.clasprc.json)
CLIENT_ID=$(jq -r '.oauth2ClientSettings.clientId // .token.client_id // empty' ~/.clasprc.json)
CLIENT_SECRET=$(jq -r '.oauth2ClientSettings.clientSecret // .token.client_secret // empty' ~/.clasprc.json)
EXPIRY_DATE=$(jq -r '.token.expiry_date // empty' ~/.clasprc.json)

# Check if token is expired and refresh if needed
CURRENT_TIME=$(date +%s)000
if [ -n "$EXPIRY_DATE" ] && [ "$EXPIRY_DATE" -lt "$CURRENT_TIME" ]; then
  echo "⚠️  Access token expired, attempting refresh..."

  # Use clasp to refresh the token by running a simple command
  clasp list > /dev/null 2>&1 || true

  # Re-read the token
  ACCESS_TOKEN=$(jq -r '.token.access_token' ~/.clasprc.json)
fi

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" == "null" ]; then
  echo "❌ ERROR: Could not get access token"
  exit 1
fi

echo "✅ OAuth token loaded"
echo ""

# Function to make authenticated API calls
api_call() {
  local method=$1
  local endpoint=$2

  curl -s -X "$method" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    "https://script.googleapis.com/v1/projects/${SCRIPT_ID}${endpoint}"
}

# List all versions
echo "📋 Fetching all versions..."
VERSIONS_RESPONSE=$(api_call GET "/versions")

# Check for errors
if echo "$VERSIONS_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  ERROR_MSG=$(echo "$VERSIONS_RESPONSE" | jq -r '.error.message')
  ERROR_CODE=$(echo "$VERSIONS_RESPONSE" | jq -r '.error.code')
  echo "❌ ERROR: API error ($ERROR_CODE): $ERROR_MSG"

  if [ "$ERROR_CODE" == "401" ]; then
    echo ""
    echo "🔧 Token may have expired. Try running:"
    echo "   clasp login"
    echo "   Then update the OAUTH_CREDENTIALS secret"
  fi
  exit 1
fi

# Parse versions
VERSION_COUNT=$(echo "$VERSIONS_RESPONSE" | jq -r '.versions | length // 0')
echo "   Found $VERSION_COUNT version(s)"

if [ "$VERSION_COUNT" -eq 0 ]; then
  echo "✅ No versions to clean up"
  exit 0
fi

# Calculate how many to delete
DELETE_COUNT=$((VERSION_COUNT - KEEP_VERSIONS))

if [ "$DELETE_COUNT" -le 0 ]; then
  echo "✅ Version count ($VERSION_COUNT) is within limit ($KEEP_VERSIONS), no cleanup needed"
  exit 0
fi

echo ""
echo "🗑️  Need to delete $DELETE_COUNT version(s) to stay under limit"
echo ""

# Get version numbers sorted by version number (oldest first)
# Apps Script versions are numbered sequentially, so lower numbers are older
VERSIONS_TO_DELETE=$(echo "$VERSIONS_RESPONSE" | jq -r '.versions | sort_by(.versionNumber | tonumber) | .[0:'$DELETE_COUNT'] | .[].versionNumber')

if [ "$VERBOSE" = true ]; then
  echo "📋 Versions to delete:"
  echo "$VERSIONS_TO_DELETE" | sed 's/^/   - /'
  echo ""
fi

# Delete old versions
DELETED=0
FAILED=0

for VERSION_NUM in $VERSIONS_TO_DELETE; do
  if [ "$DRY_RUN" = true ]; then
    echo "   [DRY RUN] Would delete version $VERSION_NUM"
    continue
  fi

  echo -n "   Deleting version $VERSION_NUM... "

  # Attempt to delete the version
  DELETE_RESPONSE=$(curl -s -X DELETE \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -w "\n%{http_code}" \
    "https://script.googleapis.com/v1/projects/${SCRIPT_ID}/versions/${VERSION_NUM}")

  HTTP_CODE=$(echo "$DELETE_RESPONSE" | tail -n1)
  BODY=$(echo "$DELETE_RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "204" ]; then
    echo "✅"
    DELETED=$((DELETED + 1))
  elif [ "$HTTP_CODE" == "404" ]; then
    # Version already deleted or doesn't exist
    echo "⏭️ (already gone)"
    DELETED=$((DELETED + 1))
  else
    echo "❌ (HTTP $HTTP_CODE)"
    if [ "$VERBOSE" = true ]; then
      echo "      Response: $BODY"
    fi
    FAILED=$((FAILED + 1))
  fi

  # Small delay to avoid rate limiting
  sleep 0.2
done

echo ""
echo "=============================================="
echo "📊 Cleanup Summary"
echo "=============================================="
echo "   Versions before: $VERSION_COUNT"
echo "   Deleted: $DELETED"
echo "   Failed: $FAILED"
echo "   Versions after: $((VERSION_COUNT - DELETED))"
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo "⚠️  Some deletions failed. This may be because:"
  echo "   - The Google Apps Script API may not support version deletion"
  echo "   - Some versions may be in use by deployments"
  echo "   - Rate limiting"
  echo ""
  echo "💡 If this persists, you may need to manually delete versions at:"
  echo "   https://script.google.com/home/projects/${SCRIPT_ID}/versions"
  echo ""
  # Don't exit with error - we want deployment to continue
fi

if [ "$DRY_RUN" = true ]; then
  echo "ℹ️  This was a dry run. No versions were actually deleted."
  echo "   Run without --dry-run to perform actual cleanup."
fi

echo "✅ Cleanup complete"
