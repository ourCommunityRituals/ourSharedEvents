#!/bin/bash
# ============================================================================
# cleanup-cloudflare-deployments.sh
# ============================================================================
# Bulk delete old Cloudflare Pages deployments to stay under the 200 limit.
# Keeps the most recent N deployments (default: 20) and deletes the rest.
#
# Usage:
#   ./scripts/cleanup-cloudflare-deployments.sh [OPTIONS]
#
# Options:
#   --project NAME    Cloudflare Pages project name (required or set CF_PAGES_PROJECT)
#   --keep N          Number of recent deployments to keep (default: 20)
#   --env ENV         Environment filter: 'production', 'preview', or 'all' (default: all)
#   --dry-run         Show what would be deleted without actually deleting
#   --verbose         Show detailed output
#   --force           Skip confirmation prompt
#
# Environment Variables:
#   CLOUDFLARE_API_TOKEN_OSE   - API token with Pages permissions (required)
#   CLOUDFLARE_ACCOUNT_ID  - Cloudflare account ID (required)
#   CF_PAGES_PROJECT       - Default project name (optional, can use --project instead)
#
# Examples:
#   # Dry run - see what would be deleted
#   ./scripts/cleanup-cloudflare-deployments.sh --project my-site --dry-run
#
#   # Keep only 10 most recent, delete rest
#   ./scripts/cleanup-cloudflare-deployments.sh --project my-site --keep 10
#
#   # Delete only old preview deployments
#   ./scripts/cleanup-cloudflare-deployments.sh --project my-site --env preview --keep 5
#
#   # Force delete without confirmation
#   ./scripts/cleanup-cloudflare-deployments.sh --project my-site --keep 20 --force
#
# API Token Permissions Required:
#   - Cloudflare Pages: Edit
#   - Account: Read
#
# ============================================================================

set -e

# Configuration defaults
KEEP_DEPLOYMENTS=${KEEP_DEPLOYMENTS:-20}
PROJECT_NAME="${CF_PAGES_PROJECT:-}"
ENV_FILTER="all"
DRY_RUN=false
VERBOSE=false
FORCE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --project)
      PROJECT_NAME="$2"
      shift 2
      ;;
    --keep)
      KEEP_DEPLOYMENTS="$2"
      shift 2
      ;;
    --env)
      ENV_FILTER="$2"
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
    --force)
      FORCE=true
      shift
      ;;
    --help|-h)
      head -50 "$0" | grep "^#" | sed 's/^# //' | sed 's/^#//'
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Usage: $0 --project NAME [--keep N] [--env ENV] [--dry-run] [--verbose] [--force]"
      exit 1
      ;;
  esac
done

echo "=============================================="
echo -e "${BLUE}🧹 Cloudflare Pages Deployment Cleanup${NC}"
echo "=============================================="
echo ""

# Validate required environment variables
if [ -z "$CLOUDFLARE_API_TOKEN_OSE" ]; then
  echo -e "${RED}❌ ERROR: CLOUDFLARE_API_TOKEN_OSE environment variable is required${NC}"
  echo ""
  echo "Set it with:"
  echo "  export CLOUDFLARE_API_TOKEN_OSE=your_token"
  echo ""
  echo "Create a token at: https://dash.cloudflare.com/profile/api-tokens"
  echo "Required permissions: Cloudflare Pages (Edit), Account (Read)"
  exit 1
fi

if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
  echo -e "${RED}❌ ERROR: CLOUDFLARE_ACCOUNT_ID environment variable is required${NC}"
  echo ""
  echo "Find your Account ID at: https://dash.cloudflare.com"
  echo "(Click on any domain → Overview → right sidebar shows Account ID)"
  exit 1
fi

if [ -z "$PROJECT_NAME" ]; then
  echo -e "${RED}❌ ERROR: Project name is required${NC}"
  echo ""
  echo "Specify with --project NAME or set CF_PAGES_PROJECT environment variable"
  echo ""
  echo "To list your Pages projects:"
  echo "  curl -s -H 'Authorization: Bearer \$CLOUDFLARE_API_TOKEN_OSE' \\"
  echo "    'https://api.cloudflare.com/client/v4/accounts/\$CLOUDFLARE_ACCOUNT_ID/pages/projects' | jq '.result[].name'"
  exit 1
fi

# Check for required tools
if ! command -v jq &> /dev/null; then
  echo -e "${RED}❌ ERROR: jq is required but not installed${NC}"
  echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
  exit 1
fi

echo "Configuration:"
echo "  Project: $PROJECT_NAME"
echo "  Keep deployments: $KEEP_DEPLOYMENTS"
echo "  Environment filter: $ENV_FILTER"
echo "  Dry run: $DRY_RUN"
echo ""

# API base URL
API_BASE="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT_NAME}"

# Function to make authenticated API calls
api_call() {
  local method=$1
  local endpoint=$2

  curl -s -X "$method" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN_OSE" \
    -H "Content-Type: application/json" \
    "${API_BASE}${endpoint}"
}

# Verify project exists
echo -e "${BLUE}📋 Verifying project...${NC}"
PROJECT_RESPONSE=$(api_call GET "")

if ! echo "$PROJECT_RESPONSE" | jq -e '.success' > /dev/null 2>&1 || \
   [ "$(echo "$PROJECT_RESPONSE" | jq -r '.success')" != "true" ]; then
  ERROR_MSG=$(echo "$PROJECT_RESPONSE" | jq -r '.errors[0].message // "Unknown error"')
  echo -e "${RED}❌ ERROR: Could not access project '$PROJECT_NAME'${NC}"
  echo "   API error: $ERROR_MSG"
  echo ""
  echo "Make sure:"
  echo "  1. The project name is correct"
  echo "  2. Your API token has 'Cloudflare Pages: Edit' permission"
  echo "  3. Your account ID is correct"
  exit 1
fi

SUBDOMAIN=$(echo "$PROJECT_RESPONSE" | jq -r '.result.subdomain // "unknown"')
echo -e "   ${GREEN}✅ Found project: ${PROJECT_NAME}.pages.dev${NC}"
echo ""

# Fetch all deployments (paginated)
echo -e "${BLUE}📋 Fetching deployments...${NC}"
ALL_DEPLOYMENTS="[]"
PAGE=1
PER_PAGE=25

while true; do
  RESPONSE=$(api_call GET "/deployments?page=${PAGE}&per_page=${PER_PAGE}")

  if ! echo "$RESPONSE" | jq -e '.success' > /dev/null 2>&1 || \
     [ "$(echo "$RESPONSE" | jq -r '.success')" != "true" ]; then
    ERROR_MSG=$(echo "$RESPONSE" | jq -r '.errors[0].message // "Unknown error"')
    echo -e "${RED}❌ ERROR: Failed to fetch deployments: $ERROR_MSG${NC}"
    exit 1
  fi

  DEPLOYMENTS=$(echo "$RESPONSE" | jq '.result')
  COUNT=$(echo "$DEPLOYMENTS" | jq 'length')

  if [ "$COUNT" -eq 0 ]; then
    break
  fi

  ALL_DEPLOYMENTS=$(echo "$ALL_DEPLOYMENTS $DEPLOYMENTS" | jq -s 'add')

  TOTAL_COUNT=$(echo "$RESPONSE" | jq -r '.result_info.total_count // 0')
  FETCHED=$((PAGE * PER_PAGE))

  if [ "$FETCHED" -ge "$TOTAL_COUNT" ]; then
    break
  fi

  PAGE=$((PAGE + 1))
done

TOTAL=$(echo "$ALL_DEPLOYMENTS" | jq 'length')
echo "   Found $TOTAL total deployment(s)"

if [ "$TOTAL" -eq 0 ]; then
  echo -e "${GREEN}✅ No deployments to clean up${NC}"
  exit 0
fi

# Filter by environment if specified
if [ "$ENV_FILTER" != "all" ]; then
  echo "   Filtering to '$ENV_FILTER' environment..."
  ALL_DEPLOYMENTS=$(echo "$ALL_DEPLOYMENTS" | jq --arg env "$ENV_FILTER" '[.[] | select(.environment == $env)]')
  FILTERED_COUNT=$(echo "$ALL_DEPLOYMENTS" | jq 'length')
  echo "   Found $FILTERED_COUNT '$ENV_FILTER' deployment(s)"
fi

# Sort by created_on (newest first) and separate keepers from deleters
SORTED=$(echo "$ALL_DEPLOYMENTS" | jq 'sort_by(.created_on) | reverse')
TO_KEEP=$(echo "$SORTED" | jq --argjson keep "$KEEP_DEPLOYMENTS" '.[:$keep]')
TO_DELETE=$(echo "$SORTED" | jq --argjson keep "$KEEP_DEPLOYMENTS" '.[$keep:]')

KEEP_COUNT=$(echo "$TO_KEEP" | jq 'length')
DELETE_COUNT=$(echo "$TO_DELETE" | jq 'length')

echo ""
echo "Summary:"
echo "   Deployments to keep: $KEEP_COUNT"
echo "   Deployments to delete: $DELETE_COUNT"
echo ""

if [ "$DELETE_COUNT" -eq 0 ]; then
  echo -e "${GREEN}✅ Deployment count ($TOTAL) is within limit ($KEEP_DEPLOYMENTS), no cleanup needed${NC}"
  exit 0
fi

# Show what will be deleted
echo -e "${YELLOW}🗑️  Deployments to be deleted:${NC}"
echo ""

echo "$TO_DELETE" | jq -r '.[] | "   \(.id[:8])... | \(.environment) | \(.created_on[:10]) | \(.deployment_trigger.metadata.branch // "manual")"' | head -20

if [ "$DELETE_COUNT" -gt 20 ]; then
  echo "   ... and $((DELETE_COUNT - 20)) more"
fi

echo ""

# Confirm deletion
if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}ℹ️  DRY RUN: No deployments were deleted${NC}"
  echo "   Run without --dry-run to perform actual cleanup"
  exit 0
fi

if [ "$FORCE" != true ]; then
  echo -e "${YELLOW}⚠️  This will permanently delete $DELETE_COUNT deployment(s)${NC}"
  read -p "Continue? (y/N): " CONFIRM

  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Aborted"
    exit 0
  fi
fi

# Delete deployments
echo ""
echo -e "${BLUE}🗑️  Deleting old deployments...${NC}"

DELETED=0
FAILED=0
DEPLOYMENT_IDS=$(echo "$TO_DELETE" | jq -r '.[].id')

for DEPLOY_ID in $DEPLOYMENT_IDS; do
  if [ "$VERBOSE" = true ]; then
    echo -n "   Deleting $DEPLOY_ID... "
  else
    echo -n "."
  fi

  DELETE_RESPONSE=$(curl -s -X DELETE \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN_OSE" \
    -H "Content-Type: application/json" \
    -w "\n%{http_code}" \
    "${API_BASE}/deployments/${DEPLOY_ID}")

  HTTP_CODE=$(echo "$DELETE_RESPONSE" | tail -n1)
  BODY=$(echo "$DELETE_RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "204" ]; then
    [ "$VERBOSE" = true ] && echo -e "${GREEN}✅${NC}"
    DELETED=$((DELETED + 1))
  elif [ "$HTTP_CODE" == "404" ]; then
    [ "$VERBOSE" = true ] && echo -e "${YELLOW}⏭️ (already gone)${NC}"
    DELETED=$((DELETED + 1))
  else
    [ "$VERBOSE" = true ] && echo -e "${RED}❌ (HTTP $HTTP_CODE)${NC}"
    FAILED=$((FAILED + 1))
    if [ "$VERBOSE" = true ]; then
      echo "      Response: $(echo "$BODY" | jq -r '.errors[0].message // "Unknown error"' 2>/dev/null || echo "$BODY")"
    fi
  fi

  # Rate limiting: Cloudflare has 1200 requests/5 minutes for API
  # Being conservative with 100ms delay
  sleep 0.1
done

[ "$VERBOSE" != true ] && echo "" # Newline after dots

echo ""
echo "=============================================="
echo -e "${BLUE}📊 Cleanup Summary${NC}"
echo "=============================================="
echo "   Deployments before: $TOTAL"
echo "   Deleted: $DELETED"
echo "   Failed: $FAILED"
echo "   Deployments after: $((TOTAL - DELETED))"
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  Some deletions failed. This may be because:${NC}"
  echo "   - The deployment is currently active (aliased)"
  echo "   - Rate limiting"
  echo "   - Network issues"
  echo ""
  echo "Tip: Run again to retry failed deletions"
  echo ""
fi

echo -e "${GREEN}✅ Cleanup complete${NC}"
