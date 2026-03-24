#!/bin/bash
# Fix Google Apps Script Deployment Authorization
# This script helps troubleshoot and fix deployment issues

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  FIX DEPLOYMENT AUTHORIZATION                              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Show current deployments
echo "1️⃣  Current Deployments:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
clasp deployments
echo ""

# Step 2: Get current URL
CURRENT_URL=$(grep -o 'https://script.google.com/macros/s/[^"]*' postman/environments/mvp-event-toolkit-local.json | head -1)
echo "2️⃣  Current URL in environment file:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$CURRENT_URL"
echo ""

# Step 3: Test current URL
echo "3️⃣  Testing current deployment:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESPONSE=$(curl -s "$CURRENT_URL?action=health" 2>&1)

if [[ $RESPONSE == *'"ok":true'* ]]; then
    echo "✅ Deployment is working!"
    echo "Response: $RESPONSE"
    echo ""
    echo "🎉 Your deployment is properly configured!"
    echo "You can run tests now: npm run test:newman:smoke"
    exit 0
else
    echo "❌ Deployment is NOT working"
    echo "Response preview: ${RESPONSE:0:200}..."
    echo ""
fi

# Step 4: Instructions to fix
echo "4️⃣  How to Fix:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "The deployment needs authorization. Follow these steps:"
echo ""
echo "  A. Open Apps Script Editor:"
echo "     clasp open"
echo ""
echo "  B. In the Apps Script editor:"
echo "     1. Click: Deploy → New deployment"
echo "     2. Click the gear icon ⚙️ next to 'Select type'"
echo "     3. Choose: Web app"
echo "     4. Set:"
echo "        • Execute as: Me"
echo "        • Who has access: Anyone"
echo "     5. Click: Deploy"
echo "     6. Click: Authorize access"
echo "     7. Review permissions and click: Allow"
echo "     8. Copy the Web app URL that appears"
echo ""
echo "  C. Update environment with new URL:"
echo "     ./update-deployment-url.sh <NEW_URL>"
echo ""
echo "  D. Test again:"
echo "     ./fix-deployment.sh"
echo ""

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  COMMON ISSUES                                             ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Issue: Get HTML/redirect instead of JSON"
echo "Fix: Make sure 'Who has access' is set to 'Anyone'"
echo ""
echo "Issue: 403 Forbidden"
echo "Fix: Click 'Authorize access' and allow all permissions"
echo ""
echo "Issue: Old deployment won't work"
echo "Fix: Create a NEW deployment (Deploy → New deployment)"
echo ""
