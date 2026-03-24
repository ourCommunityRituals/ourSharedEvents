#!/bin/bash
# Tag Staging Release and Update Environment

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: ./tag-staging.sh <version> <deployment-url>"
    echo "Example: ./tag-staging.sh 1.4.0 https://script.google.com/macros/s/AKfyc.../exec"
    exit 1
fi

VERSION=$1
DEPLOYMENT_URL=$2

echo "Tagging v$VERSION-staging and updating environment..."
echo ""

# Create/update staging environment file
echo "1️⃣  Creating staging environment file..."
cp postman/environments/mvp-event-toolkit-local.json postman/environments/mvp-event-toolkit-staging.json

# Update URL in staging environment
sed -i "s|https://script.google.com/macros/s/[^\"]*|$DEPLOYMENT_URL|g" postman/environments/mvp-event-toolkit-staging.json

# Update name
sed -i 's/"name": "MVP Event Toolkit - Local Testing"/"name": "MVP Event Toolkit - Staging"/' postman/environments/mvp-event-toolkit-staging.json

echo "✅ Created postman/environments/mvp-event-toolkit-staging.json"
echo ""

# Create git tag
echo "2️⃣  Creating git tag v$VERSION-staging..."
git add postman/environments/mvp-event-toolkit-staging.json
git commit -m "chore: Create staging v$VERSION"
git tag "v$VERSION-staging"
git push origin main
git push origin "v$VERSION-staging"
echo "✅ Tagged v$VERSION-staging"
echo ""

# Test staging deployment
echo "3️⃣  Testing staging deployment..."
if npm run test:newman:smoke -- -e postman/environments/mvp-event-toolkit-staging.json; then
    echo ""
    echo "✅ Staging v$VERSION is live and working!"
    echo ""
    echo "Staging URL: $DEPLOYMENT_URL"
    echo ""
    echo "Next steps:"
    echo "  - Share staging URL with QA team"
    echo "  - Run full test suite: npm run test:e2e"
    echo "  - Manual testing and sign-off"
    echo "  - When ready: ./scripts/promote-to-production.sh $VERSION"
else
    echo ""
    echo "❌ Staging tests failed"
    exit 1
fi
