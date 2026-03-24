#!/bin/bash
# Helper script to get the deployment ID from your Apps Script project
# This deployment ID should be added as a GitHub secret: DEPLOYMENT_ID

echo "🔍 Getting deployment ID from Apps Script..."
echo ""

# Check if clasp is authenticated
if [ ! -f ~/.clasprc.json ]; then
    echo "❌ Error: Not authenticated with clasp"
    echo ""
    echo "Please run: npx clasp login"
    exit 1
fi

# Get deployments
echo "📋 Fetching deployments..."
npx clasp deployments

echo ""
echo "=============================================="
echo "📝 Next Steps:"
echo "=============================================="
echo ""
echo "1. Find the deployment ID from the list above"
echo "   - Look for the @HEAD or @1, @2, etc."
echo "   - Use the deployment that has 'Execute as: USER_DEPLOYING'"
echo ""
echo "2. Add it as a GitHub secret:"
echo "   - Go to: Settings → Secrets → Actions"
echo "   - Create secret: DEPLOYMENT_ID"
echo "   - Value: The deployment ID (e.g., @HEAD or @1)"
echo ""
echo "3. Push your changes and the CI will update that deployment"
echo ""
