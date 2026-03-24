#!/bin/bash
#
# Redeploy GAS with Correct Permissions and Update Worker
#
# This script fixes the GAS permission issue by:
# 1. Verifying appsscript.json has ANYONE_ANONYMOUS
# 2. Pushing code to GAS (which includes the manifest)
# 3. Creating a NEW deployment (permissions are set at creation time)
# 4. Updating wrangler.toml with the new deployment ID
# 5. Deploying the Cloudflare Worker
# 6. Verifying the deployment works
#
# Usage:
#   ./scripts/redeploy-with-permissions.sh [staging|production]
#
# Requirements:
#   - clasp authenticated (~/.clasprc.json or OAUTH_CREDENTIALS env)
#   - wrangler authenticated (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID)
#
# The root cause of "permission denied" errors on POST requests is that
# GAS deployments have IMMUTABLE access settings. Once created with wrong
# permissions, they CANNOT be fixed - you must create a NEW deployment.

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
ENVIRONMENT="${1:-staging}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Environment-specific config
if [ "$ENVIRONMENT" = "production" ]; then
    CLASP_CONFIG=".clasp-production.json"
    WRANGLER_ENV="production"
    EXPECTED_SCRIPT_ID="1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l"
    DEPLOYMENT_VAR="PROD_DEPLOYMENT_ID"
    WEB_APP_VAR="PROD_WEB_APP_URL"
    VERIFY_URL="https://www.eventangle.com"
else
    CLASP_CONFIG=".clasp-staging.json"
    WRANGLER_ENV="staging"
    EXPECTED_SCRIPT_ID="1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ"
    DEPLOYMENT_VAR="STAGING_DEPLOYMENT_ID"
    WEB_APP_VAR="STAGING_WEB_APP_URL"
    VERIFY_URL="https://stg.eventangle.com"
fi

echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  REDEPLOY GAS WITH CORRECT PERMISSIONS - ${ENVIRONMENT^^}${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Environment: ${BLUE}$ENVIRONMENT${NC}"
echo -e "  Script ID:   ${BLUE}$EXPECTED_SCRIPT_ID${NC}"
echo -e "  Verify URL:  ${BLUE}$VERIFY_URL${NC}"
echo ""

cd "$ROOT_DIR"

# ============================================================================
# STEP 1: Verify appsscript.json has correct permissions
# ============================================================================
echo -e "${CYAN}Step 1: Verifying appsscript.json configuration${NC}"
echo "────────────────────────────────────────────────────────────────────"

APPSSCRIPT_PATH="src/mvp/appsscript.json"

if [ ! -f "$APPSSCRIPT_PATH" ]; then
    echo -e "${RED}❌ appsscript.json not found at $APPSSCRIPT_PATH${NC}"
    exit 1
fi

# Check for ANYONE_ANONYMOUS
if grep -q '"access": "ANYONE_ANONYMOUS"' "$APPSSCRIPT_PATH"; then
    echo -e "${GREEN}✓ appsscript.json has ANYONE_ANONYMOUS access${NC}"
else
    echo -e "${RED}❌ appsscript.json missing ANYONE_ANONYMOUS setting${NC}"
    echo ""
    echo "Current webapp config:"
    grep -A 3 '"webapp"' "$APPSSCRIPT_PATH" || echo "(not found)"
    echo ""
    echo -e "${YELLOW}Fixing appsscript.json...${NC}"

    # Use jq if available, otherwise sed
    if command -v jq &> /dev/null; then
        jq '.webapp.access = "ANYONE_ANONYMOUS" | .webapp.executeAs = "USER_DEPLOYING"' "$APPSSCRIPT_PATH" > "$APPSSCRIPT_PATH.tmp"
        mv "$APPSSCRIPT_PATH.tmp" "$APPSSCRIPT_PATH"
    else
        # Fallback to ensure the webapp block exists with correct values
        echo -e "${RED}Please manually update $APPSSCRIPT_PATH to include:${NC}"
        echo '  "webapp": {'
        echo '    "executeAs": "USER_DEPLOYING",'
        echo '    "access": "ANYONE_ANONYMOUS"'
        echo '  }'
        exit 1
    fi

    echo -e "${GREEN}✓ Fixed appsscript.json${NC}"
fi

# Check executeAs
if grep -q '"executeAs": "USER_DEPLOYING"' "$APPSSCRIPT_PATH"; then
    echo -e "${GREEN}✓ appsscript.json has USER_DEPLOYING executeAs${NC}"
else
    echo -e "${YELLOW}⚠ executeAs may not be set correctly${NC}"
fi

echo ""

# ============================================================================
# STEP 2: Verify clasp authentication
# ============================================================================
echo -e "${CYAN}Step 2: Verifying clasp authentication${NC}"
echo "────────────────────────────────────────────────────────────────────"

# Check for OAUTH_CREDENTIALS (CI mode)
if [ -n "${OAUTH_CREDENTIALS:-}" ]; then
    echo "CI mode detected - using OAUTH_CREDENTIALS"
    mkdir -p ~/.clasprc.json 2>/dev/null || true
    echo "$OAUTH_CREDENTIALS" > ~/.clasprc.json
    echo -e "${GREEN}✓ Credentials written from OAUTH_CREDENTIALS${NC}"
elif [ -f ~/.clasprc.json ]; then
    echo -e "${GREEN}✓ Found ~/.clasprc.json${NC}"
else
    echo -e "${RED}❌ No clasp credentials found${NC}"
    echo ""
    echo "Please authenticate:"
    echo "  npx clasp login"
    exit 1
fi

echo ""

# ============================================================================
# STEP 3: Swap to environment-specific clasp config
# ============================================================================
echo -e "${CYAN}Step 3: Setting up clasp for $ENVIRONMENT${NC}"
echo "────────────────────────────────────────────────────────────────────"

if [ ! -f "$CLASP_CONFIG" ]; then
    echo -e "${RED}❌ $CLASP_CONFIG not found${NC}"
    exit 1
fi

# Backup main .clasp.json
if [ -f ".clasp.json" ]; then
    cp .clasp.json .clasp.json.backup
fi

# Copy environment config
cp "$CLASP_CONFIG" .clasp.json
echo -e "${GREEN}✓ Using $CLASP_CONFIG${NC}"

# Verify Script ID
ACTUAL_SCRIPT_ID=$(grep -oP '"scriptId":\s*"\K[^"]+' .clasp.json)
if [ "$ACTUAL_SCRIPT_ID" = "$EXPECTED_SCRIPT_ID" ]; then
    echo -e "${GREEN}✓ Script ID matches expected: $ACTUAL_SCRIPT_ID${NC}"
else
    echo -e "${YELLOW}⚠ Script ID mismatch:${NC}"
    echo "  Expected: $EXPECTED_SCRIPT_ID"
    echo "  Found:    $ACTUAL_SCRIPT_ID"
fi

echo ""

# ============================================================================
# STEP 4: Push code to GAS
# ============================================================================
echo -e "${CYAN}Step 4: Pushing code to Google Apps Script${NC}"
echo "────────────────────────────────────────────────────────────────────"

MAX_RETRIES=3
RETRY_DELAY=5

for attempt in $(seq 1 $MAX_RETRIES); do
    echo "Push attempt $attempt of $MAX_RETRIES..."

    if npx clasp push --force 2>&1; then
        echo -e "${GREEN}✓ Code pushed successfully${NC}"
        break
    fi

    if [ $attempt -lt $MAX_RETRIES ]; then
        echo -e "${YELLOW}⚠ Push failed, retrying in ${RETRY_DELAY}s...${NC}"
        sleep $RETRY_DELAY
        RETRY_DELAY=$((RETRY_DELAY * 2))
    else
        echo -e "${RED}❌ Push failed after $MAX_RETRIES attempts${NC}"
        # Restore backup
        [ -f .clasp.json.backup ] && mv .clasp.json.backup .clasp.json
        exit 1
    fi
done

echo ""

# ============================================================================
# STEP 5: Create NEW deployment
# ============================================================================
echo -e "${CYAN}Step 5: Creating NEW deployment with ANYONE_ANONYMOUS access${NC}"
echo "────────────────────────────────────────────────────────────────────"
echo -e "${YELLOW}Note: Permissions are IMMUTABLE after deployment creation.${NC}"
echo "      We must create a NEW deployment to fix permissions."
echo ""

DEPLOY_DESCRIPTION="Permission fix - $(date -Iseconds)"
DEPLOYMENT_ID=""

# Clean up old deployments if at limit
cleanup_old_deployments() {
    echo "Checking deployment count..."
    DEPLOYMENTS=$(npx clasp deployments 2>&1)
    DEPLOYMENT_IDS=$(echo "$DEPLOYMENTS" | grep -oP 'AKfycb[a-zA-Z0-9_-]+' || true)

    if [ -z "$DEPLOYMENT_IDS" ]; then
        echo "No deployments found"
        return 0
    fi

    readarray -t DEPLOYMENT_ARRAY <<< "$DEPLOYMENT_IDS"
    TOTAL_COUNT=${#DEPLOYMENT_ARRAY[@]}

    if [ "$TOTAL_COUNT" -ge 18 ]; then
        echo "Found $TOTAL_COUNT deployments (limit is 20), cleaning up..."
        KEEP_COUNT=5
        DELETE_COUNT=$((TOTAL_COUNT - KEEP_COUNT))

        for (( i=0; i<DELETE_COUNT; i++ )); do
            DEPLOY_ID="${DEPLOYMENT_ARRAY[$i]}"
            echo -n "Removing $DEPLOY_ID... "
            if npx clasp undeploy "$DEPLOY_ID" 2>&1 >/dev/null; then
                echo "OK"
            else
                echo "SKIP"
            fi
            sleep 1
        done
        echo "Cleanup complete"
    fi
}

cleanup_old_deployments

for attempt in $(seq 1 $MAX_RETRIES); do
    echo "Deploy attempt $attempt of $MAX_RETRIES..."

    DEPLOY_OUTPUT=$(npx clasp deploy -d "$DEPLOY_DESCRIPTION" 2>&1) || true
    echo "$DEPLOY_OUTPUT"

    # Check for 20-deployment limit
    if echo "$DEPLOY_OUTPUT" | grep -q "20 versioned deployments"; then
        echo "Hit deployment limit, cleaning up..."
        cleanup_old_deployments
        continue
    fi

    # Extract deployment ID
    DEPLOYMENT_ID=$(echo "$DEPLOY_OUTPUT" | grep -oP 'AKfycb[a-zA-Z0-9_-]+' | head -1)

    if [ -n "$DEPLOYMENT_ID" ]; then
        echo ""
        echo -e "${GREEN}✓ NEW deployment created: $DEPLOYMENT_ID${NC}"
        break
    fi

    if [ $attempt -lt $MAX_RETRIES ]; then
        echo -e "${YELLOW}⚠ Deploy failed, retrying...${NC}"
        sleep $RETRY_DELAY
    else
        echo -e "${RED}❌ Deploy failed after $MAX_RETRIES attempts${NC}"
        [ -f .clasp.json.backup ] && mv .clasp.json.backup .clasp.json
        exit 1
    fi
done

WEB_APP_URL="https://script.google.com/macros/s/${DEPLOYMENT_ID}/exec"
echo "Web App URL: $WEB_APP_URL"
echo ""

# Restore original .clasp.json
[ -f .clasp.json.backup ] && mv .clasp.json.backup .clasp.json

# ============================================================================
# STEP 6: Update wrangler.toml
# ============================================================================
echo -e "${CYAN}Step 6: Updating wrangler.toml with new deployment ID${NC}"
echo "────────────────────────────────────────────────────────────────────"

WRANGLER_TOML="cloudflare-proxy/wrangler.toml"

if [ ! -f "$WRANGLER_TOML" ]; then
    echo -e "${RED}❌ wrangler.toml not found at $WRANGLER_TOML${NC}"
    exit 1
fi

# Backup
cp "$WRANGLER_TOML" "$WRANGLER_TOML.backup"

# Update the deployment ID and URL
sed -i "s|${DEPLOYMENT_VAR} = \"[^\"]*\"|${DEPLOYMENT_VAR} = \"${DEPLOYMENT_ID}\"|g" "$WRANGLER_TOML"
sed -i "s|${WEB_APP_VAR} = \"[^\"]*\"|${WEB_APP_VAR} = \"${WEB_APP_URL}\"|g" "$WRANGLER_TOML"

# Also update legacy variables in staging section
if [ "$ENVIRONMENT" = "staging" ]; then
    # Update DEPLOYMENT_ID in [env.staging.vars] section
    sed -i "/\[env.staging.vars\]/,/\[env\.[^s]/ s|DEPLOYMENT_ID = \"[^\"]*\"|DEPLOYMENT_ID = \"${DEPLOYMENT_ID}\"|" "$WRANGLER_TOML"
    sed -i "/\[env.staging.vars\]/,/\[env\.[^s]/ s|GAS_DEPLOYMENT_BASE_URL = \"[^\"]*\"|GAS_DEPLOYMENT_BASE_URL = \"${WEB_APP_URL}\"|" "$WRANGLER_TOML"
fi

echo -e "${GREEN}✓ Updated wrangler.toml${NC}"
echo ""
echo "New configuration:"
grep -E "${DEPLOYMENT_VAR}|${WEB_APP_VAR}" "$WRANGLER_TOML" | head -4

echo ""

# ============================================================================
# STEP 7: Deploy Cloudflare Worker
# ============================================================================
echo -e "${CYAN}Step 7: Deploying Cloudflare Worker${NC}"
echo "────────────────────────────────────────────────────────────────────"

# Check for Cloudflare credentials
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    echo -e "${YELLOW}⚠ Cloudflare credentials not set${NC}"
    echo ""
    echo "To deploy the Worker, set these environment variables:"
    echo "  export CLOUDFLARE_API_TOKEN=your_token"
    echo "  export CLOUDFLARE_ACCOUNT_ID=your_account_id"
    echo ""
    echo "Or run wrangler manually:"
    echo "  cd cloudflare-proxy && wrangler deploy --env $WRANGLER_ENV"
    echo ""
    WORKER_DEPLOYED=false
else
    cd cloudflare-proxy

    if npx wrangler deploy --env "$WRANGLER_ENV" 2>&1; then
        echo -e "${GREEN}✓ Worker deployed to $WRANGLER_ENV${NC}"
        WORKER_DEPLOYED=true
    else
        echo -e "${RED}❌ Worker deployment failed${NC}"
        WORKER_DEPLOYED=false
    fi

    cd "$ROOT_DIR"
fi

echo ""

# ============================================================================
# STEP 8: Verify deployment
# ============================================================================
echo -e "${CYAN}Step 8: Verifying deployment${NC}"
echo "────────────────────────────────────────────────────────────────────"

# Wait for propagation
echo "Waiting 10s for edge propagation..."
sleep 10

# Test 1: Direct GAS GET
echo ""
echo "Test 1: Direct GAS GET (ping)..."
GAS_RESPONSE=$(curl -sL -w "\n%{http_code}" "${WEB_APP_URL}?p=ping" 2>/dev/null || echo -e "\n000")
GAS_HTTP=$(echo "$GAS_RESPONSE" | tail -1)
GAS_BODY=$(echo "$GAS_RESPONSE" | sed '$d')

if [ "$GAS_HTTP" = "200" ] && echo "$GAS_BODY" | grep -q '"status"'; then
    echo -e "${GREEN}✓ GAS GET works: HTTP $GAS_HTTP${NC}"
else
    echo -e "${RED}❌ GAS GET failed: HTTP $GAS_HTTP${NC}"
    echo "  Response: $GAS_BODY"
fi

# Test 2: Direct GAS POST
echo ""
echo "Test 2: Direct GAS POST (api_list)..."
GAS_POST_RESPONSE=$(curl -sL -X POST \
    -H "Content-Type: application/json" \
    -d '{"action":"list","brandId":"root","scope":"events"}' \
    -w "\n%{http_code}" \
    "$WEB_APP_URL" 2>/dev/null || echo -e "\n000")
GAS_POST_HTTP=$(echo "$GAS_POST_RESPONSE" | tail -1)
GAS_POST_BODY=$(echo "$GAS_POST_RESPONSE" | sed '$d')

if [ "$GAS_POST_HTTP" = "200" ]; then
    if echo "$GAS_POST_BODY" | grep -q '"ok"'; then
        echo -e "${GREEN}✓ GAS POST works: HTTP $GAS_POST_HTTP${NC}"
        echo "  Response preview: ${GAS_POST_BODY:0:100}..."
    elif echo "$GAS_POST_BODY" | grep -q "permission"; then
        echo -e "${RED}❌ GAS POST still has permission error${NC}"
        echo "  This means the deployment still has wrong access settings."
        echo "  The NEW deployment may not have been picked up."
    else
        echo -e "${YELLOW}⚠ GAS POST returned unexpected response${NC}"
        echo "  Response: ${GAS_POST_BODY:0:200}"
    fi
else
    echo -e "${RED}❌ GAS POST failed: HTTP $GAS_POST_HTTP${NC}"
fi

# Test 3: Worker endpoint (if deployed)
if [ "$WORKER_DEPLOYED" = true ]; then
    echo ""
    echo "Test 3: Worker endpoint (via friendly URL)..."
    WORKER_RESPONSE=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -H "Origin: $VERIFY_URL" \
        -d '{"method":"api_list","payload":{"brandId":"root","scope":"events"}}' \
        -w "\n%{http_code}" \
        "${VERIFY_URL}/api/rpc" 2>/dev/null || echo -e "\n000")
    WORKER_HTTP=$(echo "$WORKER_RESPONSE" | tail -1)
    WORKER_BODY=$(echo "$WORKER_RESPONSE" | sed '$d')

    if [ "$WORKER_HTTP" = "200" ] && echo "$WORKER_BODY" | grep -q '"ok":true'; then
        echo -e "${GREEN}✓ Worker RPC works: HTTP $WORKER_HTTP${NC}"
    elif echo "$WORKER_BODY" | grep -q "GAS_UPSTREAM_NON_JSON"; then
        echo -e "${RED}❌ Worker still getting GAS permission error${NC}"
        echo "  The Worker may still be pointing to old deployment ID."
        echo "  Try redeploying: cd cloudflare-proxy && wrangler deploy --env $WRANGLER_ENV"
    else
        echo -e "${YELLOW}⚠ Worker returned: HTTP $WORKER_HTTP${NC}"
        echo "  Response: ${WORKER_BODY:0:200}"
    fi
fi

echo ""

# ============================================================================
# Summary
# ============================================================================
echo -e "${CYAN}════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  SUMMARY${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Environment:    $ENVIRONMENT"
echo "  Deployment ID:  $DEPLOYMENT_ID"
echo "  Web App URL:    $WEB_APP_URL"
echo "  Friendly URL:   $VERIFY_URL"
echo ""

if [ "$WORKER_DEPLOYED" = true ]; then
    echo -e "${GREEN}✓ Full deployment complete${NC}"
else
    echo -e "${YELLOW}⚠ GAS deployed, Worker deployment pending${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Set Cloudflare credentials:"
    echo "     export CLOUDFLARE_API_TOKEN=xxx"
    echo "     export CLOUDFLARE_ACCOUNT_ID=xxx"
    echo ""
    echo "  2. Deploy Worker:"
    echo "     cd cloudflare-proxy && wrangler deploy --env $WRANGLER_ENV"
    echo ""
    echo "  3. OR commit changes and push to trigger CI:"
    echo "     git add cloudflare-proxy/wrangler.toml"
    echo "     git commit -m 'fix: update $ENVIRONMENT deployment ID with correct permissions'"
    echo "     git push"
fi

echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════════════════${NC}"
