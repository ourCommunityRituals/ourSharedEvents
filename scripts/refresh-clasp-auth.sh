#!/bin/bash
# refresh-clasp-auth.sh
# Helper script to refresh Clasp authentication and prepare for GitHub secret update
# Run this when your OAuth tokens expire

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔄 Clasp Authentication Refresh Tool${NC}"
echo "========================================"
echo ""

# Function to print success message
success() {
  echo -e "${GREEN}✅ $1${NC}"
}

# Function to print error message
error() {
  echo -e "${RED}❌ $1${NC}"
}

# Function to print warning message
warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

# Function to print info message
info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if clasp is installed
if ! command -v clasp &> /dev/null; then
  error "Clasp is not installed!"
  echo "Install with: npm install -g @google/clasp"
  exit 1
fi

echo "Step 1: Logout from current session"
echo "------------------------------------"
if [ -f "$HOME/.clasprc.json" ]; then
  warning "Removing existing .clasprc.json..."
  clasp logout 2>/dev/null || true
  success "Logged out successfully"
else
  info "No existing session found"
fi
echo ""

echo "Step 2: Login to Clasp"
echo "----------------------"
info "A browser window will open for Google OAuth authentication"
echo "Please:"
echo "  1. Select the Google account that owns your Apps Script project"
echo "  2. Grant all requested permissions to Clasp"
echo "  3. Wait for the success message"
echo ""
read -p "Press Enter to open browser and login..."

if clasp login; then
  success "Login successful!"
else
  error "Login failed!"
  echo "Please try again or check your Google account permissions"
  exit 1
fi
echo ""

echo "Step 3: Validate new credentials"
echo "---------------------------------"
if [ -f "$HOME/.clasprc.json" ]; then
  success "Found .clasprc.json"

  # Validate JSON
  if jq empty "$HOME/.clasprc.json" 2>/dev/null; then
    success "JSON is valid"
  else
    error "JSON is invalid! This shouldn't happen."
    exit 1
  fi

  # Check for access_token
  if jq -e '.token.access_token // .access_token' "$HOME/.clasprc.json" >/dev/null 2>&1; then
    success "OAuth access_token found"
  else
    error "Missing access_token! Please try logging in again."
    exit 1
  fi
else
  error "Login succeeded but .clasprc.json not created!"
  exit 1
fi
echo ""

echo "Step 4: Get Script ID"
echo "---------------------"
if [ -f ".clasp.json" ]; then
  SCRIPT_ID=$(jq -r '.scriptId // "null"' .clasp.json)
  if [ "$SCRIPT_ID" != "null" ] && [ -n "$SCRIPT_ID" ]; then
    success "Found Script ID: $SCRIPT_ID"
  else
    warning "No Script ID found in .clasp.json"
    echo "You may need to create a project with: clasp create"
    SCRIPT_ID=""
  fi
else
  warning ".clasp.json not found in current directory"
  echo "Navigate to your project directory or create a new project"
  SCRIPT_ID=""
fi
echo ""

echo "Step 5: Prepare GitHub Secret Values"
echo "-------------------------------------"
echo ""

# Display CLASPRC_JSON
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}📋 Secret 1: CLASPRC_JSON${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Copy this ENTIRE value (including { and }):"
echo ""
cat "$HOME/.clasprc.json"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Offer to copy to clipboard
if command -v pbcopy &> /dev/null; then
  read -p "Copy CLASPRC_JSON to clipboard? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    cat "$HOME/.clasprc.json" | pbcopy
    success "Copied to clipboard!"
  fi
elif command -v xclip &> /dev/null; then
  read -p "Copy CLASPRC_JSON to clipboard? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    cat "$HOME/.clasprc.json" | xclip -selection clipboard
    success "Copied to clipboard!"
  fi
else
  info "Clipboard tool not found. Please copy manually."
fi
echo ""

# Display SCRIPT_ID
if [ -n "$SCRIPT_ID" ]; then
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}📋 Secret 2: SCRIPT_ID${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "Value: $SCRIPT_ID"
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
fi

echo ""
echo -e "${BLUE}Step 6: Update GitHub Secrets${NC}"
echo "------------------------------"
echo ""
echo "1. Go to your repository's secret settings:"
echo "   https://github.com/YOUR_USERNAME/YOUR_REPO/settings/secrets/actions"
echo ""
echo "2. Update or create these secrets:"
echo ""
echo "   Secret Name: CLASPRC_JSON"
echo "   Value: (paste the JSON from above - entire content including { and })"
echo ""
if [ -n "$SCRIPT_ID" ]; then
  echo "   Secret Name: SCRIPT_ID"
  echo "   Value: $SCRIPT_ID"
  echo ""
fi
echo "3. Click 'Update secret' or 'Add secret'"
echo ""

echo ""
echo -e "${GREEN}✅ Authentication refresh complete!${NC}"
echo ""
info "Next steps:"
echo "  1. Update GitHub secrets as shown above"
echo "  2. Test locally: npm run push"
echo "  3. Commit and push to trigger GitHub Actions"
echo "  4. Verify deployment succeeds"
echo ""
echo -e "${YELLOW}💡 Tip: Run ./scripts/validate-clasp-setup.sh to validate everything${NC}"
echo ""
