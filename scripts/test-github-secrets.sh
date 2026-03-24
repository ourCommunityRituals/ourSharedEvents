#!/bin/bash

# Test script to verify GitHub Actions will work with the current secrets
# This simulates what GitHub Actions does

echo "════════════════════════════════════════════════════════"
echo "  Testing GitHub Actions Deployment Locally"
echo "════════════════════════════════════════════════════════"
echo ""

# Check if we have the required environment variables
if [ -z "$SERVICE_ACCOUNT_JSON" ]; then
  echo "❌ Missing SERVICE_ACCOUNT_JSON"
  echo ""
  echo "To test, export your GitHub secrets:"
  echo "  export SERVICE_ACCOUNT_JSON='<paste GitHub secret value>'"
  echo "  export SCRIPT_ID='<paste GitHub secret value>'"
  echo "  export IMPERSONATE_USER='zeventbook@gmail.com'"
  echo ""
  exit 1
fi

if [ -z "$SCRIPT_ID" ]; then
  echo "❌ Missing SCRIPT_ID"
  exit 1
fi

echo "✅ Environment variables are set"
echo ""
echo "Testing with:"
echo "  SCRIPT_ID: $SCRIPT_ID"
if [ -n "$IMPERSONATE_USER" ]; then
  echo "  IMPERSONATE_USER: $IMPERSONATE_USER"
fi
echo ""

# Run the diagnostic first
echo "════════════════════════════════════════════════════════"
echo "  Step 1: Running Diagnostics"
echo "════════════════════════════════════════════════════════"
echo ""

node scripts/diagnose-apps-script-access.js

DIAG_EXIT=$?

if [ $DIAG_EXIT -eq 0 ]; then
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  Step 2: Attempting Deployment"
  echo "════════════════════════════════════════════════════════"
  echo ""

  npm run deploy

  if [ $? -eq 0 ]; then
    echo ""
    echo "════════════════════════════════════════════════════════"
    echo "  ✅ SUCCESS - GitHub Actions will work!"
    echo "════════════════════════════════════════════════════════"
  else
    echo ""
    echo "════════════════════════════════════════════════════════"
    echo "  ❌ DEPLOYMENT FAILED"
    echo "════════════════════════════════════════════════════════"
    echo ""
    echo "See error messages above for details."
  fi
else
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  ⚠️  DIAGNOSTICS FAILED - Fix issues above first"
  echo "════════════════════════════════════════════════════════"
fi
