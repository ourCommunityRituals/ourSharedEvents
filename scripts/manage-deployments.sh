#!/bin/bash
# Deployment Management Helper
# Handles the 20-deployment limit by cleaning up old deployments automatically

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "═══════════════════════════════════════════════════════════════"
echo "  DEPLOYMENT MANAGEMENT HELPER"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Check clasp is available
if ! command -v npx &> /dev/null; then
    echo -e "${RED}❌ npx not found. Please install Node.js and npm.${NC}"
    exit 1
fi

# List current deployments
echo "Step 1: Checking current deployments"
echo "─────────────────────────────────────────────────────────────"
DEPLOYMENTS=$(npx clasp deployments 2>&1)
echo "$DEPLOYMENTS"
echo ""

# Count deployments (excluding header line)
DEPLOYMENT_COUNT=$(echo "$DEPLOYMENTS" | grep -E '^\s*@|^\s*-' | grep -v "Deployment Id" | grep -v "^--" | wc -l)
echo -e "📊 Current deployment count: ${BLUE}$DEPLOYMENT_COUNT / 20${NC}"
echo ""

# If we have 20 or more, we need to clean up
if [ "$DEPLOYMENT_COUNT" -ge 20 ]; then
    echo -e "${YELLOW}⚠️  You have $DEPLOYMENT_COUNT deployments (limit is 20)${NC}"
    echo "We need to clean up old deployments before creating a new one."
    echo ""

    # Extract deployment IDs (skip @HEAD which is special)
    DEPLOYMENT_IDS=$(echo "$DEPLOYMENTS" | grep -oP '@\d+' | grep -v '@HEAD' || true)

    if [ -z "$DEPLOYMENT_IDS" ]; then
        echo -e "${RED}❌ Could not extract deployment IDs${NC}"
        echo "Please manually clean up deployments using:"
        echo "  npx clasp undeploy <deployment-id>"
        exit 1
    fi

    # Convert to array and sort
    IFS=$'\n' read -rd '' -a DEPLOYMENT_ARRAY <<<"$DEPLOYMENT_IDS" || true

    # Keep the 3 most recent deployments, delete the rest
    KEEP_COUNT=3
    DELETE_COUNT=$((${#DEPLOYMENT_ARRAY[@]} - $KEEP_COUNT))

    if [ "$DELETE_COUNT" -le 0 ]; then
        echo -e "${YELLOW}⚠️  Not enough old deployments to clean up${NC}"
        echo "You may need to manually undeploy some versions."
        echo ""
        echo "To manually undeploy:"
        echo "  npx clasp undeploy @1  # Replace @1 with deployment ID"
        echo ""
        read -p "Press Enter after manually cleaning up, or Ctrl+C to cancel..." -r
    else
        echo -e "${YELLOW}We will keep the $KEEP_COUNT most recent deployments and remove $DELETE_COUNT old ones${NC}"
        echo ""
        echo "Deployments to remove:"

        # Show which ones will be deleted (oldest first)
        for (( i=0; i<$DELETE_COUNT; i++ )); do
            DEPLOY_ID="${DEPLOYMENT_ARRAY[$i]}"
            echo "  - $DEPLOY_ID"
        done
        echo ""

        echo "Deployments to keep:"
        for (( i=$DELETE_COUNT; i<${#DEPLOYMENT_ARRAY[@]}; i++ )); do
            DEPLOY_ID="${DEPLOYMENT_ARRAY[$i]}"
            echo "  - $DEPLOY_ID (recent)"
        done
        echo ""

        read -p "Press Enter to clean up old deployments (or Ctrl+C to cancel)..." -r
        echo ""

        # Undeploy old versions
        echo "Cleaning up old deployments..."
        for (( i=0; i<$DELETE_COUNT; i++ )); do
            DEPLOY_ID="${DEPLOYMENT_ARRAY[$i]}"
            echo -n "  Removing $DEPLOY_ID... "
            if npx clasp undeploy "$DEPLOY_ID" > /dev/null 2>&1; then
                echo -e "${GREEN}✓${NC}"
            else
                echo -e "${YELLOW}⚠ (may already be removed)${NC}"
            fi
        done
        echo ""
        echo -e "${GREEN}✅ Cleanup complete!${NC}"
        echo ""
    fi
fi

# Now create the new deployment
echo "Step 2: Creating new deployment"
echo "─────────────────────────────────────────────────────────────"
DESCRIPTION="Anonymous Access Fix - $(date -Iseconds)"
echo "Description: $DESCRIPTION"
echo ""
read -p "Press Enter to create new deployment (or Ctrl+C to cancel)..." -r
echo ""

DEPLOY_OUTPUT=$(npx clasp deploy -d "$DESCRIPTION" 2>&1)
echo "$DEPLOY_OUTPUT"
echo ""

# Extract deployment ID
if echo "$DEPLOY_OUTPUT" | grep -q "Created version"; then
    VERSION=$(echo "$DEPLOY_OUTPUT" | grep -oP 'Created version \K\d+')
    DEPLOYMENT_ID="@${VERSION}"
    echo -e "${GREEN}✅ New deployment created: $DEPLOYMENT_ID${NC}"
else
    echo -e "${RED}❌ Failed to create deployment${NC}"
    exit 1
fi
echo ""

# Get deployment URL
echo "Step 3: Getting deployment URL"
echo "─────────────────────────────────────────────────────────────"
DEPLOYMENTS_OUTPUT=$(npx clasp deployments 2>&1)

# Extract web app URL for @HEAD or latest
WEB_APP_URL=$(echo "$DEPLOYMENTS_OUTPUT" | grep -oP 'https://script\.google\.com/macros/s/[^/]+/exec' | head -1)

if [ -n "$WEB_APP_URL" ]; then
    echo -e "${GREEN}✅ Deployment URL: $WEB_APP_URL${NC}"
else
    echo -e "${YELLOW}⚠️  Could not extract deployment URL${NC}"
fi
echo ""

# Test the deployment
echo "Step 4: Testing the new deployment"
echo "─────────────────────────────────────────────────────────────"
if [ -n "$WEB_APP_URL" ]; then
    echo "Testing status endpoint..."
    echo "GET ${WEB_APP_URL}?page=status"
    echo ""

    RESPONSE=$(curl -s -w "\n%{http_code}" "${WEB_APP_URL}?page=status" 2>/dev/null || echo -e "\nERROR")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✅ HTTP 200 OK - Anonymous access working!${NC}"
        echo ""
        echo "Response:"
        echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
    elif [ "$HTTP_CODE" = "302" ]; then
        echo -e "${RED}❌ HTTP 302 - Still redirecting to login${NC}"
        echo ""
        echo "The deployment may need a few minutes to propagate."
        echo "Try testing again in 1-2 minutes:"
        echo "  export BASE_URL='$WEB_APP_URL'"
        echo "  ./verify-deployment.sh"
    else
        echo -e "${YELLOW}⚠️  HTTP $HTTP_CODE${NC}"
        echo "$BODY" | head -20
    fi
else
    echo -e "${YELLOW}⚠️  Skipping test - no deployment URL available${NC}"
fi
echo ""

# Summary
echo "═══════════════════════════════════════════════════════════════"
echo "  SUMMARY"
echo "═══════════════════════════════════════════════════════════════"
echo ""
if [ -n "$DEPLOYMENT_ID" ]; then
    echo -e "New Deployment ID: ${GREEN}$DEPLOYMENT_ID${NC}"
fi
if [ -n "$WEB_APP_URL" ]; then
    echo -e "Deployment URL: ${BLUE}$WEB_APP_URL${NC}"
fi
echo ""
echo "Next steps:"
echo "1. Update GitHub secret DEPLOYMENT_ID to: $DEPLOYMENT_ID"
echo "   https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions"
echo ""
echo "2. Test the deployment:"
echo "   export BASE_URL='$WEB_APP_URL'"
echo "   ./verify-deployment.sh"
echo ""
