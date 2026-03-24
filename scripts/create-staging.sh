#!/bin/bash
# Create Staging Release
# Run full test suite and prepare for staging deployment

set -e

if [ -z "$1" ]; then
    echo "Usage: ./create-staging.sh <version>"
    echo "Example: ./create-staging.sh 1.4.0"
    exit 1
fi

VERSION=$1

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  CREATE STAGING RELEASE v$VERSION                          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Ensure on main branch
echo "1️⃣  Checking git branch..."
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
    echo "⚠️  Not on main branch (currently on: $BRANCH)"
    echo "   Switch to main? (y/n)"
    read -r SWITCH
    if [ "$SWITCH" = "y" ]; then
        git checkout main
        git pull origin main
    else
        echo "Aborted"
        exit 1
    fi
fi
echo "✅ On main branch"
echo ""

# Step 2: Run full test suite
echo "2️⃣  Running full test suite..."
echo ""

echo "  Running Jest tests..."
if ! npm run test:jest; then
    echo "❌ Jest tests failed"
    exit 1
fi
echo ""

# Step 3: Push to @HEAD
echo "3️⃣  Deploying to @HEAD for testing..."
npm run push
sleep 30
./use-head-deployment.sh
echo ""

echo "4️⃣  Running Newman tests..."
if ! npm run test:newman:smoke; then
    echo "❌ Newman tests failed"
    exit 1
fi
echo ""

echo "5️⃣  Running Playwright E2E tests (this takes ~6 hours)..."
echo "   Skip E2E tests? (y/n)"
read -r SKIP_E2E
if [ "$SKIP_E2E" != "y" ]; then
    if ! npm run test:e2e; then
        echo "❌ E2E tests failed"
        exit 1
    fi
fi
echo ""

# Step 4: Ready to create deployment
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  READY TO CREATE STAGING DEPLOYMENT                       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "All tests passed! Now create the deployment:"
echo ""
echo "1. Open Apps Script:"
echo "   https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit"
echo ""
echo "2. Click: Deploy → New deployment"
echo "3. Settings:"
echo "   - Description: v$VERSION - Staging"
echo "   - Execute as: Me"
echo "   - Who has access: Anyone"
echo "4. Click: Deploy → Authorize → Allow"
echo "5. Copy the deployment URL"
echo ""
echo "Then run:"
echo "  ./scripts/tag-staging.sh $VERSION <DEPLOYMENT_URL>"
echo ""
