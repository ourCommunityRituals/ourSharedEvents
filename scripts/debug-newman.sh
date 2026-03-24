#!/bin/bash
# Quick Newman Test Debug Script

echo "🔍 Newman Test Diagnostics"
echo "=========================="
echo ""

# 1. Check admin key in Config.gs
echo "1️⃣  Checking admin key in Config.gs..."
CONFIG_KEY=$(grep "adminSecret" Config.gs | head -1 | grep -o "'[^']*'" | tr -d "'")
echo "   Config.gs adminSecret: $CONFIG_KEY"
echo ""

# 2. Check admin key in local environment
echo "2️⃣  Checking admin key in local environment file..."
if [ -f "postman/environments/mvp-event-toolkit-local.json" ]; then
    ENV_KEY=$(cat postman/environments/mvp-event-toolkit-local.json | grep -A1 '"key": "adminKey"' | grep '"value"' | grep -o '": "[^"]*"' | cut -d'"' -f3)
    echo "   Local env adminKey: $ENV_KEY"
else
    echo "   ❌ Local environment file not found!"
fi
echo ""

# 3. Check if keys match
echo "3️⃣  Comparing keys..."
if [ "$CONFIG_KEY" = "$ENV_KEY" ]; then
    echo "   ✅ Keys match!"
else
    echo "   ❌ Keys DON'T match!"
    echo "   This is why tests are failing!"
    echo ""
    echo "   Fix: Update Config.gs or local environment file so keys match"
fi
echo ""

# 4. Check deployment base URL
echo "4️⃣  Checking deployment URL..."
BASE_URL=$(cat postman/environments/mvp-event-toolkit-local.json | grep -A1 '"key": "baseUrl"' | grep '"value"' | grep -o 'https://[^"]*')
echo "   Base URL: $BASE_URL"
echo ""

# 5. Test health endpoint
echo "5️⃣  Testing health endpoint..."
if command -v curl &> /dev/null; then
    HEALTH_RESPONSE=$(curl -s "$BASE_URL?action=health" 2>&1)
    echo "   Response: $HEALTH_RESPONSE"
    if [[ $HEALTH_RESPONSE == *'"ok":true'* ]]; then
        echo "   ✅ API is reachable!"
    else
        echo "   ❌ API not responding correctly"
        echo "   Make sure you've deployed with: ./clasp-deploy.sh"
    fi
else
    echo "   ⚠️  curl not available, skipping health check"
fi
echo ""

# 6. Check if newman is installed
echo "6️⃣  Checking Newman installation..."
if command -v newman &> /dev/null; then
    NEWMAN_VERSION=$(newman --version)
    echo "   ✅ Newman installed: $NEWMAN_VERSION"
else
    echo "   ❌ Newman not installed!"
    echo "   Fix: Run 'npm install'"
fi
echo ""

# 7. Check for required collections
echo "7️⃣  Checking test collections..."
if [ -f "postman/collections/mvp-event-toolkit-flows.json" ]; then
    echo "   ✅ Flow collection found"
else
    echo "   ❌ Flow collection missing!"
fi
if [ -f "postman/collections/mvp-event-toolkit-api.json" ]; then
    echo "   ✅ API collection found"
else
    echo "   ❌ API collection missing!"
fi
echo ""

# 8. Summary
echo "📋 Summary"
echo "=========="
if [ "$CONFIG_KEY" = "$ENV_KEY" ] && [[ $HEALTH_RESPONSE == *'"ok":true'* ]]; then
    echo "✅ Everything looks good! Try running tests:"
    echo "   npm run test:newman:smoke"
    echo "   npm run test:newman:flow"
else
    echo "⚠️  Issues detected. Review the output above."
    echo ""
    echo "Common fixes:"
    echo "1. Deploy code: ./clasp-deploy.sh"
    echo "2. Wait 30 seconds for deployment to propagate"
    echo "3. Ensure admin keys match in Config.gs and local environment"
    echo "4. Run: npm install (if Newman is missing)"
fi
echo ""
