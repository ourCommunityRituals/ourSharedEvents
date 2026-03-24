#!/bin/bash
# Deploy to Apps Script and output test URLs for all brands

set -e

echo "🚀 Deploying to Google Apps Script..."
echo ""

# Push latest code
echo "📤 Pushing code to Apps Script..."
npx @google/clasp push --force

echo ""
echo "✅ Code pushed successfully!"
echo ""

# Create new deployment
echo "📦 Creating new deployment..."
DEPLOY_OUTPUT=$(npx @google/clasp deploy --description "Deployment $(date '+%Y-%m-%d %H:%M:%S')" 2>&1)
echo "$DEPLOY_OUTPUT"

echo ""
echo "🔍 Getting deployment information..."

# Extract deployment ID from the deploy output
DEPLOYMENT_ID=$(echo "$DEPLOY_OUTPUT" | grep -oP 'AKfycb[a-zA-Z0-9_-]+' | head -1)

if [ -z "$DEPLOYMENT_ID" ]; then
    echo "⚠️  Could not extract deployment ID from output"
    echo "Trying to get it from deployments list..."
    DEPLOYMENTS=$(npx @google/clasp deployments 2>&1)
    DEPLOYMENT_ID=$(echo "$DEPLOYMENTS" | grep -oP 'AKfycb[a-zA-Z0-9_-]+' | head -1)
fi

# Construct the Web App URL
if [ -n "$DEPLOYMENT_ID" ]; then
    WEBAPP_URL="https://script.google.com/macros/s/${DEPLOYMENT_ID}/exec"
    echo "✅ Found deployment ID: ${DEPLOYMENT_ID}"
else
    echo "❌ Could not find deployment ID!"
    echo "Please run 'npx @google/clasp deployments' to see your deployments"
    exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 DEPLOYMENT SUCCESSFUL!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 BASE URL:"
echo "$WEBAPP_URL"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏢 ROOT BRAND (Zeventbook)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Admin Page:"
echo "${WEBAPP_URL}?page=admin&brand=root"
echo ""
echo "📊 Shared Analytics (NEW!):"
echo "${WEBAPP_URL}?page=report&brand=root"
echo ""
echo "Public Page:"
echo "${WEBAPP_URL}?page=public&brand=root"
echo ""
echo "Display Page (TV):"
echo "${WEBAPP_URL}?page=display&brand=root"
echo ""
echo "Poster Page (Print):"
echo "${WEBAPP_URL}?page=poster&brand=root"
echo ""
echo "Test Dashboard:"
echo "${WEBAPP_URL}?page=test&brand=root"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎯 ABC BRAND (American Bocce Co.)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Admin Page:"
echo "${WEBAPP_URL}?page=admin&brand=abc"
echo ""
echo "📊 Shared Analytics (NEW!):"
echo "${WEBAPP_URL}?page=report&brand=abc"
echo ""
echo "Public Page:"
echo "${WEBAPP_URL}?page=public&brand=abc"
echo ""
echo "Display Page (TV):"
echo "${WEBAPP_URL}?page=display&brand=abc"
echo ""
echo "Poster Page (Print):"
echo "${WEBAPP_URL}?page=poster&brand=abc"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏆 CBC BRAND (Chicago Bocce Club)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Admin Page:"
echo "${WEBAPP_URL}?page=admin&brand=cbc"
echo ""
echo "📊 Shared Analytics (NEW!):"
echo "${WEBAPP_URL}?page=report&brand=cbc"
echo ""
echo "Public Page:"
echo "${WEBAPP_URL}?page=public&brand=cbc"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚽ CBL BRAND (Chicago Bocce League)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Admin Page:"
echo "${WEBAPP_URL}?page=admin&brand=cbl"
echo ""
echo "📊 Shared Analytics (NEW!):"
echo "${WEBAPP_URL}?page=report&brand=cbl"
echo ""
echo "Public Page:"
echo "${WEBAPP_URL}?page=public&brand=cbl"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📚 API & DOCUMENTATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "API Documentation:"
echo "${WEBAPP_URL}?page=api"
echo ""
echo "System Status:"
echo "${WEBAPP_URL}?page=status"
echo ""
echo "Diagnostics:"
echo "${WEBAPP_URL}?page=diagnostics&brand=root"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 TESTING TIPS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Start with Admin page to create test events"
echo "2. Check the Shared Analytics page (NEW feature!)"
echo "3. Test mobile responsiveness (F12 → Toggle device)"
echo "4. Verify all TRIANGLE pages (Admin → Poster → Display → Public)"
echo ""
echo "📝 Save these URLs for easy testing!"
echo ""

# =============================================================================
# QUALITY GATE: Run E2E Tests Against Deployed URL
# =============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 QUALITY GATE: Running E2E Tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Testing deployed application at: $WEBAPP_URL"
echo ""

# Export environment variables for Playwright
export BASE_URL="$WEBAPP_URL"
export ADMIN_KEY="${ADMIN_KEY:-CHANGE_ME_root}"

# Track test results
SMOKE_PASSED=false
PAGES_PASSED=false
FLOWS_PASSED=false

echo "📊 Running test suite..."
echo ""

# Stage 1: Smoke Tests (Critical - Must Pass)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚨 Stage 1: Smoke Tests (Critical)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if npm run test:smoke; then
    echo "✅ Smoke tests PASSED"
    SMOKE_PASSED=true
else
    echo "❌ Smoke tests FAILED"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "❌ QUALITY GATE FAILED: Critical smoke tests did not pass"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Deployment URLs are available above, but application has critical issues."
    echo "Fix the failing tests before proceeding with manual testing."
    echo ""
    exit 1
fi
echo ""

# Stage 2: Page Tests (Component validation)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📄 Stage 2: Page Tests (Components)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if npm run test:pages; then
    echo "✅ Page tests PASSED"
    PAGES_PASSED=true
else
    echo "❌ Page tests FAILED"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "⚠️  QUALITY GATE WARNING: Page tests failed"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Some page components are not working correctly."
    echo "Fix the failing tests before proceeding with manual testing."
    echo ""
    exit 1
fi
echo ""

# Stage 3: Flow Tests (End-to-End scenarios including TRIANGLE)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 Stage 3: Flow Tests (End-to-End)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if npm run test:flows; then
    echo "✅ Flow tests PASSED"
    FLOWS_PASSED=true
else
    echo "❌ Flow tests FAILED"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "⚠️  QUALITY GATE WARNING: Flow tests failed"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "End-to-end workflows (including TRIANGLE and SharedReport) are not working."
    echo "Fix the failing tests before proceeding with manual testing."
    echo ""
    exit 1
fi
echo ""

# =============================================================================
# FINAL QUALITY GATE SUMMARY
# =============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ ALL QUALITY GATES PASSED!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Test Results Summary:"
echo "  🚨 Smoke Tests:  ✅ PASSED"
echo "  📄 Page Tests:   ✅ PASSED"
echo "  🔄 Flow Tests:   ✅ PASSED"
echo ""
echo "🎉 Deployment is ready for manual testing!"
echo ""
echo "Next steps:"
echo "  1. Use the URLs above to manually test the application"
echo "  2. Verify SharedReport analytics dashboard"
echo "  3. Test TRIANGLE framework (Admin → Poster → Display → Public)"
echo "  4. Check mobile responsiveness"
echo ""
echo "Deployed at: $(date)"
echo ""
