#!/bin/bash
# ============================================================================
# cleanup-cloudflare-workers.sh
# ============================================================================
# Bulk delete old Cloudflare Workers deployments using wrangler CLI.
# Keeps the most recent N deployments and deletes the rest.
#
# Usage:
#   ./scripts/cleanup-cloudflare-workers.sh [OPTIONS]
#
# Options:
#   --env ENV         Wrangler environment: 'staging' or 'production' (required)
#   --keep N          Number of recent deployments to keep (default: 10)
#   --dry-run         Show what would be deleted without actually deleting
#   --verbose         Show detailed output
#   --force           Skip confirmation prompt
#
# Environment Variables:
#   CLOUDFLARE_API_TOKEN_OSE   - API token with Workers permissions (required)
#   CLOUDFLARE_ACCOUNT_ID  - Cloudflare account ID (required)
#
# Examples:
#   # Dry run - see what would be deleted from staging
#   ./scripts/cleanup-cloudflare-workers.sh --env staging --dry-run
#
#   # Keep only 5 most recent staging deployments
#   ./scripts/cleanup-cloudflare-workers.sh --env staging --keep 5
#
#   # Clean production deployments
#   ./scripts/cleanup-cloudflare-workers.sh --env production --keep 10 --force
#
# Worker Names (from wrangler.toml):
#   - staging: oursharedevents-stg
#   - production: oursharedevents-prod
#
# ============================================================================

set -e

# Configuration defaults
KEEP_DEPLOYMENTS=${KEEP_DEPLOYMENTS:-10}
WRANGLER_ENV=""
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
    --env)
      WRANGLER_ENV="$2"
      shift 2
      ;;
    --keep)
      KEEP_DEPLOYMENTS="$2"
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
      echo "Usage: $0 --env ENV [--keep N] [--dry-run] [--verbose] [--force]"
      exit 1
      ;;
  esac
done

echo "=============================================="
echo -e "${BLUE}🧹 Cloudflare Workers Deployment Cleanup${NC}"
echo "=============================================="
echo ""

# Validate required parameters
if [ -z "$WRANGLER_ENV" ]; then
  echo -e "${RED}❌ ERROR: --env is required (staging or production)${NC}"
  exit 1
fi

# Validate environment variables
if [ -z "$CLOUDFLARE_API_TOKEN_OSE" ]; then
  echo -e "${RED}❌ ERROR: CLOUDFLARE_API_TOKEN_OSE environment variable is required${NC}"
  echo ""
  echo "Set it with:"
  echo "  export CLOUDFLARE_API_TOKEN_OSE=your_token"
  exit 1
fi

if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
  echo -e "${RED}❌ ERROR: CLOUDFLARE_ACCOUNT_ID environment variable is required${NC}"
  exit 1
fi

# Check for required tools
if ! command -v wrangler &> /dev/null; then
  echo -e "${RED}❌ ERROR: wrangler CLI is required but not installed${NC}"
  echo "Install with: npm install -g wrangler@3"
  exit 1
fi

if ! command -v jq &> /dev/null; then
  echo -e "${RED}❌ ERROR: jq is required but not installed${NC}"
  echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
  exit 1
fi

# Determine worker name from environment
case $WRANGLER_ENV in
  staging)
    WORKER_NAME="oursharedevents-stg"
    ;;
  production)
    WORKER_NAME="oursharedevents-prod"
    ;;
  *)
    echo -e "${RED}❌ ERROR: Unknown environment '$WRANGLER_ENV'${NC}"
    echo "Valid environments: staging, production"
    exit 1
    ;;
esac

echo "Configuration:"
echo "  Environment: $WRANGLER_ENV"
echo "  Worker: $WORKER_NAME"
echo "  Keep deployments: $KEEP_DEPLOYMENTS"
echo "  Dry run: $DRY_RUN"
echo ""

# Change to cloudflare-proxy directory for wrangler context
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT/cloudflare-proxy"

# List deployments using wrangler
echo -e "${BLUE}📋 Fetching deployments...${NC}"

DEPLOYMENTS_OUTPUT=$(wrangler deployments list --env "$WRANGLER_ENV" 2>&1) || {
  echo -e "${RED}❌ ERROR: Failed to list deployments${NC}"
  echo "$DEPLOYMENTS_OUTPUT"
  exit 1
}

# Parse wrangler output (format: ID | Created | Author | Source)
# Skip header lines and parse deployment IDs
DEPLOYMENT_IDS=$(echo "$DEPLOYMENTS_OUTPUT" | grep -E '^[a-f0-9-]{36}' | awk '{print $1}')
TOTAL=$(echo "$DEPLOYMENT_IDS" | grep -c . || echo 0)

echo "   Found $TOTAL deployment(s)"

if [ "$TOTAL" -eq 0 ]; then
  echo -e "${GREEN}✅ No deployments to clean up${NC}"
  exit 0
fi

if [ "$VERBOSE" = true ]; then
  echo ""
  echo "Deployments:"
  echo "$DEPLOYMENTS_OUTPUT" | head -20
  echo ""
fi

# Calculate how many to delete
DELETE_COUNT=$((TOTAL - KEEP_DEPLOYMENTS))

if [ "$DELETE_COUNT" -le 0 ]; then
  echo -e "${GREEN}✅ Deployment count ($TOTAL) is within limit ($KEEP_DEPLOYMENTS), no cleanup needed${NC}"
  exit 0
fi

# Get the IDs to delete (oldest ones - last in the list since wrangler shows newest first)
TO_DELETE=$(echo "$DEPLOYMENT_IDS" | tail -n "$DELETE_COUNT")
KEEP_COUNT=$((TOTAL - DELETE_COUNT))

echo ""
echo "Summary:"
echo "   Deployments to keep: $KEEP_COUNT"
echo "   Deployments to delete: $DELETE_COUNT"
echo ""

# Show what will be deleted
echo -e "${YELLOW}🗑️  Deployments to be deleted:${NC}"
echo "$TO_DELETE" | head -10 | sed 's/^/   /'
if [ "$DELETE_COUNT" -gt 10 ]; then
  echo "   ... and $((DELETE_COUNT - 10)) more"
fi
echo ""

# Dry run check
if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}ℹ️  DRY RUN: No deployments were deleted${NC}"
  echo "   Run without --dry-run to perform actual cleanup"
  exit 0
fi

# Confirm deletion
if [ "$FORCE" != true ]; then
  echo -e "${YELLOW}⚠️  This will permanently delete $DELETE_COUNT deployment(s)${NC}"
  read -p "Continue? (y/N): " CONFIRM

  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Aborted"
    exit 0
  fi
fi

# Delete deployments using Cloudflare API
echo ""
echo -e "${BLUE}🗑️  Deleting old deployments...${NC}"

API_BASE="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/deployments"

DELETED=0
FAILED=0

for DEPLOY_ID in $TO_DELETE; do
  if [ "$VERBOSE" = true ]; then
    echo -n "   Deleting $DEPLOY_ID... "
  else
    echo -n "."
  fi

  # Use Cloudflare API to delete deployment
  DELETE_RESPONSE=$(curl -s -X DELETE \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN_OSE" \
    -H "Content-Type: application/json" \
    -w "\n%{http_code}" \
    "${API_BASE}/${DEPLOY_ID}")

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
      ERROR_MSG=$(echo "$BODY" | jq -r '.errors[0].message // "Unknown error"' 2>/dev/null || echo "$BODY")
      echo "      Response: $ERROR_MSG"
    fi
  fi

  # Rate limiting delay
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
  echo -e "${YELLOW}⚠️  Some deletions failed. Note:${NC}"
  echo "   - Cloudflare Workers deployment history may not support deletion via API"
  echo "   - Active deployments cannot be deleted"
  echo "   - Consider using 'wrangler rollback' for specific version management"
  echo ""
fi

echo -e "${GREEN}✅ Cleanup complete${NC}"
