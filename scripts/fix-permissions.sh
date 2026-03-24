#!/bin/bash
# Quick wrapper script for fix-deployment-permissions.js

set -e

echo "🔧 MVP Event Toolkit - Permission Fixer"
echo ""

# Check if node is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "Please install Node.js first: https://nodejs.org/"
    exit 1
fi

# Check if in correct directory
if [ ! -f "package.json" ]; then
    echo "❌ Please run this script from the project root directory"
    exit 1
fi

# Run the permission fixer
node scripts/fix-deployment-permissions.js "$@"
