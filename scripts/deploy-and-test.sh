#!/bin/bash
# Complete Deployment Fix - Systematic Approach
# This ensures code sync between local, GitHub, Apps Script, and deployment

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  SYSTEMATIC DEPLOYMENT FIX                                 ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Verify local code has the fix
echo "1️⃣  Verifying local Config.gs has hard-coded spreadsheet ID..."
if grep -q "spreadsheetId: '1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l'" Config.gs; then
    echo "✅ Local code has the fix"
else
    echo "❌ Local code is missing the fix"
    echo "   Run: git pull origin claude/e2e-playwright-testing-011CUzuxDzMBaNQrs2xcK1NG"
    exit 1
fi
echo ""

# Step 2: Push code to Apps Script
echo "2️⃣  Pushing latest code to Apps Script..."
npm run push
echo ""

# Step 3: Wait for propagation
echo "3️⃣  Waiting 30 seconds for Apps Script to process..."
sleep 30
echo ""

# Step 4: Create NEW deployment with latest code
echo "4️⃣  Next: Create new deployment in Apps Script"
echo ""
echo "Open this URL:"
echo "https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit"
echo ""
echo "Then:"
echo "  1. Deploy → New deployment"
echo "  2. Gear icon → Web app"
echo "  3. Execute as: Me"
echo "  4. Who has access: Anyone"
echo "  5. Deploy → Authorize (if prompted) → Allow"
echo "  6. Copy the Web app URL"
echo ""
echo "Then run:"
echo "  ./update-deployment-url.sh \"PASTE_URL\""
echo ""
echo "OR use @HEAD deployment (auto-updates with every push):"
echo "  ./use-head-deployment.sh"
echo ""
