#!/bin/bash
# Fix Anonymous Access for Deployed Web App
#
# This script helps you create a NEW deployment with the correct
# anonymous access settings after fixing appsscript.json

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  FIX ANONYMOUS ACCESS - DEPLOYMENT GUIDE                   ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check if appsscript.json has the fix
echo "1️⃣  Verifying appsscript.json configuration..."
if grep -q '"access": "ANYONE_ANONYMOUS"' appsscript.json; then
    echo "✅ appsscript.json has correct access setting: ANYONE_ANONYMOUS"
else
    echo "❌ appsscript.json is missing the fix"
    echo ""
    echo "Expected configuration in appsscript.json:"
    echo '  "webapp": {'
    echo '    "executeAs": "USER_DEPLOYING",'
    echo '    "access": "ANYONE_ANONYMOUS"'
    echo '  }'
    echo ""
    exit 1
fi
echo ""

# Verify .clasp.json exists
if [ ! -f ".clasp.json" ]; then
    echo "❌ .clasp.json not found!"
    echo "Please run: clasp login"
    exit 1
fi

SCRIPT_ID=$(grep -oP '(?<="scriptId": ")[^"]*' .clasp.json)
echo "📋 Script ID: $SCRIPT_ID"
echo ""

# Step 1: Push updated manifest
echo "2️⃣  Pushing updated appsscript.json to Apps Script..."
echo ""
echo "⚠️  IMPORTANT: This requires clasp to be installed and authenticated"
echo ""
read -p "Press Enter to push code (or Ctrl+C to cancel)..." -r
echo ""

npm run push || {
    echo "❌ Push failed. Make sure you're authenticated:"
    echo "   npm install -g @google/clasp"
    echo "   clasp login"
    exit 1
}

echo "✅ Code pushed successfully"
echo ""

# Step 2: Instructions for creating new deployment
echo "3️⃣  Creating NEW deployment with anonymous access..."
echo ""
echo "⚠️  CRITICAL: You MUST create a NEW deployment for the manifest changes to take effect."
echo "              Updating an existing deployment will NOT apply the access level changes."
echo ""
echo "Option A: Create deployment via Apps Script UI (Recommended)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Open: https://script.google.com/home/projects/$SCRIPT_ID/edit"
echo ""
echo "2. Click: Deploy → New deployment"
echo ""
echo "3. Click the gear icon ⚙️  next to 'Select type'"
echo ""
echo "4. Select: Web app"
echo ""
echo "5. Configure:"
echo "   • Description: Anonymous Access Fix $(date +%Y-%m-%d)"
echo "   • Execute as: Me ($USER)"
echo "   • Who has access: Anyone, even anonymous ⭐"
echo ""
echo "6. Click: Deploy"
echo ""
echo "7. If prompted to authorize, click: Authorize access → Allow"
echo ""
echo "8. Copy the 'Web app URL' (looks like: https://script.google.com/macros/s/XXXXX/exec)"
echo ""
echo "9. Save the Deployment ID from the deployments list"
echo ""
echo ""
echo "Option B: Create deployment via clasp (Advanced)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Note: clasp deployments may not respect manifest settings correctly."
echo "      The UI method (Option A) is more reliable."
echo ""
echo ""
echo "4️⃣  After deployment, update GitHub secrets..."
echo ""
echo "Update these GitHub secrets:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Go to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions"
echo ""
echo "2. Update DEPLOYMENT_ID:"
echo "   • Find your new deployment in the Apps Script UI"
echo "   • Copy the deployment ID (e.g., @1, @2, @HEAD)"
echo "   • Update the secret value"
echo ""
echo "3. The BASE_URL secret (if it exists) will be auto-detected from clasp deployments"
echo ""
echo ""
echo "5️⃣  Test the deployment..."
echo ""
echo "After deployment, test it works:"
echo ""
echo "  # Set your new URL"
echo "  export BASE_URL='https://script.google.com/macros/s/XXXXX/exec'"
echo ""
echo "  # Run verification"
echo "  ./verify-deployment.sh"
echo ""
echo ""
echo "🎯 Expected Results:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Test 1: Status Endpoint - HTTP 200 (not 302)"
echo "✅ Test 2: Public Page - HTTP 200 (not 302)"
echo "✅ Test 3: Admin Page - HTTP 200 (not 302)"
echo "✅ Test 4: Display Page - HTTP 200 (not 302)"
echo ""
echo "If you still see HTTP 302 redirects, the deployment may not have"
echo "picked up the anonymous access setting. Try creating another new"
echo "deployment and ensure 'Anyone, even anonymous' is selected."
echo ""
