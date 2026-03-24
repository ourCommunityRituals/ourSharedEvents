#!/bin/bash
# Create New Anonymous-Access Deployment
#
# This script creates a NEW Google Apps Script deployment with ANYONE_ANONYMOUS access.
# Updating an existing deployment WILL NOT work - the access level is immutable after creation.

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  CREATE NEW DEPLOYMENT WITH ANONYMOUS ACCESS"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if appsscript.json has the correct configuration
echo "Step 1: Verifying appsscript.json configuration"
echo "─────────────────────────────────────────────────────────────"
if grep -q '"access": "ANYONE_ANONYMOUS"' appsscript.json; then
    echo -e "${GREEN}✅ appsscript.json correctly configured with ANYONE_ANONYMOUS${NC}"
else
    echo -e "${RED}❌ appsscript.json is missing ANYONE_ANONYMOUS setting${NC}"
    echo ""
    echo "Please update appsscript.json to include:"
    echo '  "webapp": {'
    echo '    "executeAs": "USER_DEPLOYING",'
    echo '    "access": "ANYONE_ANONYMOUS"'
    echo '  }'
    exit 1
fi
echo ""

# Get script ID from .clasp.json
if [ ! -f ".clasp.json" ]; then
    echo -e "${RED}❌ .clasp.json not found${NC}"
    exit 1
fi

SCRIPT_ID=$(grep -oP '(?<="scriptId": ")[^"]*' .clasp.json)
echo -e "📋 Script ID: ${BLUE}$SCRIPT_ID${NC}"
echo ""

# Check if clasp is available
if ! command -v npx &> /dev/null; then
    echo -e "${RED}❌ npx not found. Please install Node.js and npm.${NC}"
    exit 1
fi

# Check if authenticated
echo "Step 2: Checking clasp authentication"
echo "─────────────────────────────────────────────────────────────"
if [ -f ~/.clasprc.json ]; then
    echo -e "${GREEN}✅ Found ~/.clasprc.json - already authenticated${NC}"
else
    echo -e "${YELLOW}⚠️  Not authenticated with clasp${NC}"
    echo ""
    echo "You need to authenticate first. Run:"
    echo "  npx clasp login"
    echo ""
    read -p "Press Enter after you've authenticated (or Ctrl+C to cancel)..." -r
    echo ""
fi
echo ""

# Push updated manifest
echo "Step 3: Pushing updated manifest to Apps Script"
echo "─────────────────────────────────────────────────────────────"
echo "This ensures the Apps Script project has the latest appsscript.json"
echo ""
read -p "Press Enter to push code (or Ctrl+C to cancel)..." -r
echo ""

if npx clasp push --force; then
    echo -e "${GREEN}✅ Code pushed successfully${NC}"
else
    echo -e "${RED}❌ Push failed. Make sure you're authenticated:${NC}"
    echo "   npx clasp login"
    exit 1
fi
echo ""

# Create new deployment
echo "Step 4: Creating NEW deployment with anonymous access"
echo "─────────────────────────────────────────────────────────────"
echo -e "${YELLOW}⚠️  IMPORTANT: We must create a NEW deployment (not update existing)${NC}"
echo "   The access level is set at deployment creation and CANNOT be changed."
echo ""

# Check deployment count first
DEPLOYMENTS_CHECK=$(npx clasp deployments 2>&1)
DEPLOYMENT_COUNT=$(echo "$DEPLOYMENTS_CHECK" | grep -E '^\s*@|^\s*-' | grep -v "Deployment Id" | grep -v "^--" | wc -l)

if [ "$DEPLOYMENT_COUNT" -ge 20 ]; then
    echo -e "${YELLOW}⚠️  You have $DEPLOYMENT_COUNT deployments (limit is 20)${NC}"
    echo "We need to clean up old deployments first."
    echo ""
    echo "Running deployment cleanup helper..."
    echo ""

    # Run the deployment manager
    if [ -f "./scripts/manage-deployments.sh" ]; then
        ./scripts/manage-deployments.sh
        exit $?
    else
        echo -e "${RED}❌ Deployment manager not found${NC}"
        echo ""
        echo "Please manually clean up old deployments:"
        echo "  npx clasp deployments  # List all deployments"
        echo "  npx clasp undeploy @1  # Remove old deployment (replace @1)"
        echo ""
        echo "Keep only the 3-5 most recent deployments."
        exit 1
    fi
fi

read -p "Press Enter to create new deployment (or Ctrl+C to cancel)..." -r
echo ""

DEPLOY_OUTPUT=$(npx clasp deploy -d "Anonymous Access Fix - $(date -Iseconds)" 2>&1)
echo "$DEPLOY_OUTPUT"
echo ""

# Check if we hit the limit
if echo "$DEPLOY_OUTPUT" | grep -q "may only have up to 20"; then
    echo -e "${RED}❌ Hit 20 deployment limit${NC}"
    echo ""
    echo "Running deployment cleanup helper..."
    echo ""

    if [ -f "./scripts/manage-deployments.sh" ]; then
        ./scripts/manage-deployments.sh
        exit $?
    else
        echo "Please manually clean up old deployments:"
        echo "  npx clasp deployments  # List all deployments"
        echo "  npx clasp undeploy @1  # Remove old deployment"
        exit 1
    fi
fi

# Extract deployment ID from output
if echo "$DEPLOY_OUTPUT" | grep -q "Created version"; then
    VERSION=$(echo "$DEPLOY_OUTPUT" | grep -oP 'Created version \K\d+')
    DEPLOYMENT_ID="@${VERSION}"
    echo -e "${GREEN}✅ New deployment created: $DEPLOYMENT_ID${NC}"
else
    echo -e "${RED}❌ Failed to create deployment${NC}"
    echo ""
    echo "Common issues:"
    echo "  1. Not authenticated - run: npx clasp login"
    echo "  2. No permission - check you own the Apps Script project"
    echo "  3. Deployment limit reached - clean up old deployments"
    echo ""
    exit 1
fi
echo ""

# Get deployment URL
echo "Step 5: Getting deployment URL"
echo "─────────────────────────────────────────────────────────────"
DEPLOYMENTS_OUTPUT=$(npx clasp deployments 2>&1)
echo "$DEPLOYMENTS_OUTPUT"
echo ""

# Extract web app URL for the latest deployment
WEB_APP_URL=$(echo "$DEPLOYMENTS_OUTPUT" | grep -oP 'https://script\.google\.com/macros/s/[^/]+/exec' | head -1)

if [ -n "$WEB_APP_URL" ]; then
    echo -e "${GREEN}✅ Deployment URL: $WEB_APP_URL${NC}"
else
    echo -e "${YELLOW}⚠️  Could not extract deployment URL${NC}"
    echo "Please check the deployments output above."
fi
echo ""

# Test the deployment
echo "Step 6: Testing the new deployment"
echo "─────────────────────────────────────────────────────────────"
if [ -n "$WEB_APP_URL" ]; then
    echo "Testing status endpoint..."
    echo "GET ${WEB_APP_URL}?page=status"
    echo ""

    RESPONSE=$(curl -s -w "\n%{http_code}" "${WEB_APP_URL}?page=status")
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
        echo "The deployment may not have picked up the ANYONE_ANONYMOUS setting."
        echo "This can happen if:"
        echo "  1. The manifest wasn't pushed before deployment"
        echo "  2. There's a caching issue (wait 1-2 minutes and retry)"
        echo ""
        echo "Try creating another new deployment or use the Apps Script UI."
    else
        echo -e "${YELLOW}⚠️  HTTP $HTTP_CODE${NC}"
        echo "$BODY"
    fi
else
    echo -e "${YELLOW}⚠️  Skipping test - no deployment URL available${NC}"
fi
echo ""

# Next steps
echo "═══════════════════════════════════════════════════════════════"
echo "  NEXT STEPS"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "1. Update GitHub Secrets (REQUIRED for CI/CD):"
echo "   ─────────────────────────────────────────────────────────"
echo "   Go to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions"
echo ""
if [ -n "$DEPLOYMENT_ID" ]; then
    echo -e "   Update ${BLUE}DEPLOYMENT_ID${NC} to: ${GREEN}$DEPLOYMENT_ID${NC}"
else
    echo "   Update DEPLOYMENT_ID to your new deployment ID (e.g., @2)"
fi
echo ""
echo "2. Verify the deployment works:"
echo "   ─────────────────────────────────────────────────────────"
if [ -n "$WEB_APP_URL" ]; then
    echo "   export BASE_URL='$WEB_APP_URL'"
else
    echo "   export BASE_URL='https://script.google.com/macros/s/YOUR_NEW_ID/exec'"
fi
echo "   ./verify-deployment.sh"
echo ""
echo "3. Expected results:"
echo "   ─────────────────────────────────────────────────────────"
echo -e "   ${GREEN}✅ Test 1: Status Endpoint - HTTP 200 (not 302)${NC}"
echo -e "   ${GREEN}✅ Test 2: Public Page - HTTP 200 (not 302)${NC}"
echo -e "   ${GREEN}✅ Test 3: Admin Page - HTTP 200 (not 302)${NC}"
echo -e "   ${GREEN}✅ Test 4: Display Page - HTTP 200 (not 302)${NC}"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "If you still see HTTP 302 redirects:"
echo "  • Wait 1-2 minutes for deployment to propagate"
echo "  • Verify in Apps Script UI: Deploy → Manage deployments"
echo "  • Ensure it shows: 'Who has access: Anyone, even anonymous'"
echo "  • If not, create another new deployment via the UI"
echo ""
echo "Apps Script UI: https://script.google.com/home/projects/$SCRIPT_ID/edit"
echo ""
