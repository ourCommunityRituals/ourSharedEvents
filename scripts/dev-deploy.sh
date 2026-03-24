#!/bin/bash
# Daily Development Deployment Script
# Pushes code to @HEAD, waits for propagation, runs smoke tests

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  DEVELOPMENT DEPLOYMENT (@HEAD)                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Run unit tests first
echo "1️⃣  Running Jest unit tests..."
if npm run test:jest; then
    echo "✅ Unit tests passed"
else
    echo "❌ Unit tests failed - fix before deploying"
    exit 1
fi
echo ""

# Step 2: Push to Apps Script
echo "2️⃣  Pushing code to Apps Script @HEAD..."
npm run push
echo ""

# Step 3: Wait for propagation
echo "3️⃣  Waiting 30 seconds for propagation..."
sleep 30
echo ""

# Step 4: Verify @HEAD is configured
echo "4️⃣  Verifying @HEAD deployment..."
./use-head-deployment.sh
echo ""

# Step 5: Run smoke tests
echo "5️⃣  Running Newman smoke tests..."
if npm run test:newman:smoke; then
    echo ""
    echo "✅ SUCCESS! @HEAD deployment complete and verified"
    echo ""
    echo "Next steps:"
    echo "  - Test manually in browser"
    echo "  - Commit your changes: git add . && git commit -m '...'"
    echo "  - Push to GitHub: git push origin <branch>"
else
    echo ""
    echo "⚠️  Smoke tests failed - check deployment"
    exit 1
fi
