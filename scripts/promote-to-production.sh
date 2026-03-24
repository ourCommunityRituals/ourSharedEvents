#!/bin/bash
# Promote Staging to Production
# Creates production deployment and runs final verification

set -e

if [ -z "$1" ]; then
    echo "Usage: ./promote-to-production.sh <version>"
    echo "Example: ./promote-to-production.sh 1.4.0"
    exit 1
fi

VERSION=$1

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  PROMOTE v$VERSION TO PRODUCTION                           ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Verify staging exists
if [ ! -f "postman/environments/mvp-event-toolkit-staging.json" ]; then
    echo "❌ Staging environment not found"
    echo "   Run: ./scripts/create-staging.sh $VERSION"
    exit 1
fi

# Check for tag
if ! git tag | grep -q "v$VERSION-staging"; then
    echo "❌ Staging tag v$VERSION-staging not found"
    echo "   Run: ./scripts/tag-staging.sh $VERSION <URL>"
    exit 1
fi

echo "Pre-flight checks:"
echo ""

# 1. All tests passed on staging?
echo "1️⃣  Have all tests passed on staging?"
echo "   - Jest unit tests"
echo "   - Newman API tests"
echo "   - Playwright E2E tests"
echo "   - Manual QA sign-off"
echo ""
echo "   Proceed to production? (yes/no)"
read -r PROCEED

if [ "$PROCEED" != "yes" ]; then
    echo "Aborted"
    exit 1
fi

# 2. CHANGELOG updated?
echo ""
echo "2️⃣  Is CHANGELOG.md updated with v$VERSION changes? (yes/no)"
read -r CHANGELOG_UPDATED

if [ "$CHANGELOG_UPDATED" != "yes" ]; then
    echo "Please update CHANGELOG.md first"
    exit 1
fi

# 3. Documentation updated?
echo ""
echo "3️⃣  Is documentation updated (README, API docs)? (yes/no)"
read -r DOCS_UPDATED

if [ "$DOCS_UPDATED" != "yes" ]; then
    echo "Please update documentation first"
    exit 1
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  CREATE PRODUCTION DEPLOYMENT                              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Open Apps Script and create production deployment:"
echo ""
echo "1. Open:"
echo "   https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit"
echo ""
echo "2. Click: Deploy → New deployment"
echo "3. Settings:"
echo "   - Description: v$VERSION - Production"
echo "   - Execute as: Me"
echo "   - Who has access: Anyone (or 'Only myself' if private)"
echo "4. Click: Deploy → Authorize → Allow"
echo "5. Copy the deployment URL"
echo ""
echo "Enter the production deployment URL:"
read -r PROD_URL

if [ -z "$PROD_URL" ]; then
    echo "No URL provided, aborted"
    exit 1
fi

# Create production environment
echo ""
echo "Creating production environment file..."
cp postman/environments/mvp-event-toolkit-staging.json postman/environments/mvp-event-toolkit-prod.json

# Update URL
sed -i "s|https://script.google.com/macros/s/[^\"]*|$PROD_URL|g" postman/environments/mvp-event-toolkit-prod.json

# Update name
sed -i 's/"name": "MVP Event Toolkit - Staging"/"name": "MVP Event Toolkit - Production"/' postman/environments/mvp-event-toolkit-prod.json

echo "✅ Created postman/environments/mvp-event-toolkit-prod.json"
echo ""

# Update VERSION file
echo "$VERSION" > VERSION
echo "✅ Updated VERSION file"
echo ""

# Test production
echo "Testing production deployment..."
if npm run test:newman:smoke -- -e postman/environments/mvp-event-toolkit-prod.json; then
    echo ""
    echo "✅ Production smoke tests passed!"
else
    echo ""
    echo "❌ Production smoke tests failed"
    echo "   Review and fix before continuing"
    exit 1
fi

# Tag production release
echo ""
echo "Creating production git tag..."
git add postman/environments/mvp-event-toolkit-prod.json VERSION CHANGELOG.md
git commit -m "chore: Release v$VERSION to production"
git tag "v$VERSION"
git push origin main
git push origin "v$VERSION"

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  PRODUCTION RELEASE COMPLETE                               ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "✅ v$VERSION is now in production!"
echo ""
echo "Production URL: $PROD_URL"
echo "Git tag: v$VERSION"
echo ""
echo "Next steps:"
echo "  - Monitor production for issues"
echo "  - Announce release to stakeholders"
echo "  - Update any external documentation"
echo "  - Celebrate! 🎉"
echo ""
