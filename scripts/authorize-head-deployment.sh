#!/bin/bash
# Guide user through authorizing @HEAD deployment
# This is the final step to unlock all test automation

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  AUTHORIZE @HEAD DEPLOYMENT                                ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "This will enable all 224+ automated tests to run."
echo ""

HEAD_URL="https://script.google.com/macros/s/AKfycbzu-U4UgdjdAiXHTg9TD5Y-1gDkc798YSTqQCdhOddG/exec"

echo "Step 1: Open Apps Script Editor"
echo "----------------------------------------"
echo "URL: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit"
echo ""
echo "Press ENTER when the editor is open..."
read

echo ""
echo "Step 2: Open Deployment Manager"
echo "----------------------------------------"
echo "In the Apps Script editor:"
echo "  1. Click the 'Deploy' button (top right)"
echo "  2. Select 'Manage deployments'"
echo ""
echo "Press ENTER when you see the deployments list..."
read

echo ""
echo "Step 3: Find and Edit @HEAD Deployment"
echo "----------------------------------------"
echo "In the deployments list:"
echo "  1. Find the deployment labeled '@HEAD'"
echo "  2. Click the pencil/edit icon on the @HEAD row"
echo ""
echo "Press ENTER when the edit dialog is open..."
read

echo ""
echo "Step 4: Change Access Settings"
echo "----------------------------------------"
echo "In the edit deployment dialog:"
echo "  1. Find the 'Who has access' dropdown"
echo "  2. Change from 'Only myself' to 'Anyone'"
echo "  3. Click 'Deploy' button"
echo ""
echo "Press ENTER after clicking Deploy..."
read

echo ""
echo "Step 5: Authorize Access (if prompted)"
echo "----------------------------------------"
echo "If you see an authorization prompt:"
echo "  1. Click 'Authorize access'"
echo "  2. Choose your Google account"
echo "  3. Click 'Allow' on the permissions screen"
echo "  4. Wait for 'Deployment updated' confirmation"
echo ""
echo "Press ENTER after seeing confirmation..."
read

echo ""
echo "Step 6: Testing @HEAD Authorization"
echo "----------------------------------------"
echo "Testing deployment access..."
echo ""

RESPONSE=$(curl -s "$HEAD_URL?p=status&brand=root" 2>&1)

if [[ $RESPONSE == *'"ok":true'* ]]; then
    echo "✅ SUCCESS! @HEAD deployment is authorized and working!"
    echo ""
    echo "Response preview:"
    echo "${RESPONSE:0:200}"
    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║  READY TO RUN ALL TESTS                                    ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""
    echo "You can now run:"
    echo "  npm run test:jest          # 94 unit/contract tests (~2s)"
    echo "  npm run test:newman:smoke  # Quick API tests (~30s)"
    echo "  npm run test:newman:flow   # Full 14-step flow (~2min)"
    echo "  npm run test:e2e           # Playwright E2E (~6hrs)"
    echo ""
    echo "Or run the complete deployment workflow:"
    echo "  ./scripts/dev-deploy.sh"
    echo ""
elif [[ $RESPONSE == *"Moved Temporarily"* ]]; then
    echo "❌ Still requires authorization"
    echo ""
    echo "The deployment is still private. Please verify:"
    echo "  1. You selected @HEAD (not a numbered version)"
    echo "  2. You changed 'Who has access' to 'Anyone'"
    echo "  3. You clicked 'Deploy' and saw confirmation"
    echo ""
    echo "Try running this script again: ./authorize-head-deployment.sh"
else
    echo "⚠️  Unexpected response:"
    echo "${RESPONSE:0:300}"
    echo ""
    echo "Please check the deployment settings and try again."
fi
