#!/bin/bash
# validate-clasp-setup.sh
# Validates local Clasp setup and CLASPRC_JSON before pushing to GitHub
# This helps catch configuration issues early

set -e

echo "🔍 Clasp Setup Validation Tool"
echo "================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Track validation status
WARNINGS=0
ERRORS=0

# Function to print success message
success() {
  echo -e "${GREEN}✅ $1${NC}"
}

# Function to print error message
error() {
  echo -e "${RED}❌ $1${NC}"
  ((ERRORS++))
}

# Function to print warning message
warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
  ((WARNINGS++))
}

# Function to print info message
info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

echo "Step 1: Checking Clasp Installation"
echo "------------------------------------"
if command -v clasp &> /dev/null; then
  CLASP_VERSION=$(clasp --version 2>/dev/null || echo "unknown")
  success "Clasp is installed (version: $CLASP_VERSION)"
else
  error "Clasp is not installed. Run: npm install -g @google/clasp"
  exit 1
fi
echo ""

echo "Step 2: Checking .clasprc.json (OAuth Credentials)"
echo "---------------------------------------------------"
CLASPRC_PATH="$HOME/.clasprc.json"
if [ -f "$CLASPRC_PATH" ]; then
  success "Found .clasprc.json at $CLASPRC_PATH"

  # Validate JSON format
  if jq empty "$CLASPRC_PATH" 2>/dev/null; then
    success "CLASPRC_JSON is valid JSON"
  else
    error "CLASPRC_JSON is NOT valid JSON!"
    echo "  Please run: clasp login"
    exit 1
  fi

  # Check for access_token (support all Clasp formats)
  if jq -e '.tokens.default.access_token // .token.access_token // .access_token' "$CLASPRC_PATH" >/dev/null 2>&1; then
    success "Found OAuth access_token field"
  else
    error "Missing OAuth access_token field!"
    echo "  Your .clasprc.json may be corrupted."
    echo "  Please run: clasp logout && clasp login"
    exit 1
  fi

  # Check for refresh_token (support all Clasp formats)
  if jq -e '.tokens.default.refresh_token // .token.refresh_token // .refresh_token' "$CLASPRC_PATH" >/dev/null 2>&1; then
    success "Found OAuth refresh_token field"
  else
    warning "Missing refresh_token field (may cause issues)"
  fi

  # Check token expiry (support all Clasp formats)
  EXPIRY=$(jq -r '.tokens.default.expiry_date // .token.expiry_date // .expiry_date // "null"' "$CLASPRC_PATH")
  if [ "$EXPIRY" != "null" ]; then
    CURRENT_TIME=$(date +%s)000  # milliseconds
    if [ "$EXPIRY" -lt "$CURRENT_TIME" ]; then
      warning "OAuth token has expired! Please run: clasp login"
    else
      success "OAuth token is not expired"
    fi
  else
    info "No expiry_date found in token (may not be required)"
  fi

  # Show file preview (redacted)
  echo ""
  info "Preview of .clasprc.json (credentials redacted):"
  jq -r 'walk(if type == "string" and (.|length) > 10 then .[0:4] + "..." + .[-4:] else . end)' "$CLASPRC_PATH" 2>/dev/null || echo "Failed to parse JSON - file may be corrupted"

else
  error ".clasprc.json not found at $CLASPRC_PATH"
  echo "  Please run: clasp login"
  exit 1
fi
echo ""

echo "Step 3: Checking .clasp.json (Project Configuration)"
echo "-----------------------------------------------------"
CLASP_JSON_PATH=".clasp.json"
if [ -f "$CLASP_JSON_PATH" ]; then
  success "Found .clasp.json in project directory"

  # Validate JSON format
  if jq empty "$CLASP_JSON_PATH" 2>/dev/null; then
    success ".clasp.json is valid JSON"
  else
    error ".clasp.json is NOT valid JSON!"
    exit 1
  fi

  # Check for scriptId
  SCRIPT_ID=$(jq -r '.scriptId // "null"' "$CLASP_JSON_PATH")
  if [ "$SCRIPT_ID" != "null" ] && [ -n "$SCRIPT_ID" ]; then
    success "Found Script ID: $SCRIPT_ID"
  else
    error "Missing scriptId in .clasp.json!"
    echo "  Create a new project: clasp create --title 'MVP Event Toolkit' --type webapp --rootDir ."
    echo "  Or add scriptId manually to .clasp.json"
    exit 1
  fi

  # Show .clasp.json content
  echo ""
  info "Content of .clasp.json:"
  cat "$CLASP_JSON_PATH"

else
  warning ".clasp.json not found in project directory"
  echo "  You may need to create it with: clasp create --title 'MVP Event Toolkit' --type webapp --rootDir ."
fi
echo ""

echo "Step 4: Testing Clasp Connection"
echo "---------------------------------"
info "Attempting to connect to Google Apps Script..."
if clasp status 2>&1 | grep -q "Logged in"; then
  success "Successfully connected to Google Apps Script"
else
  warning "Could not verify connection to Apps Script"
  echo "  This may be normal if you haven't logged in recently."
fi
echo ""

echo "Step 5: Preparing GitHub Secrets"
echo "---------------------------------"
info "To configure GitHub Actions, you need to set these secrets:"
echo ""
echo "📋 Secret 1: CLASPRC_JSON"
echo "  Copy the entire contents of ~/.clasprc.json"
echo "  Command: cat ~/.clasprc.json | pbcopy    (macOS)"
echo "  Command: cat ~/.clasprc.json | xclip -selection clipboard    (Linux)"
echo "  Command: type %USERPROFILE%\.clasprc.json | clip    (Windows)"
echo ""
echo "📋 Secret 2: SCRIPT_ID"
if [ -f "$CLASP_JSON_PATH" ]; then
  SCRIPT_ID=$(jq -r '.scriptId // "null"' "$CLASP_JSON_PATH")
  if [ "$SCRIPT_ID" != "null" ]; then
    echo "  Value: $SCRIPT_ID"
    success "Script ID found in .clasp.json"
  fi
else
  echo "  Get from: Apps Script Editor → Project Settings → Script ID"
fi
echo ""
echo "🔗 Configure secrets at:"
echo "  https://github.com/YOUR_USERNAME/YOUR_REPO/settings/secrets/actions"
echo ""

echo "Summary"
echo "======="
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  success "All validations passed! Your Clasp setup is ready for GitHub Actions."
elif [ $ERRORS -eq 0 ]; then
  warning "Validation completed with $WARNINGS warning(s). Review warnings above."
  exit 0
else
  error "Validation failed with $ERRORS error(s) and $WARNINGS warning(s)."
  echo "  Please fix the errors above before configuring GitHub Actions."
  exit 1
fi
