#!/bin/bash

# DevOps Dashboard Startup Script
# This script starts the DevOps monitoring dashboard

echo "🚀 Starting DevOps Monitoring Dashboard..."
echo ""

# Check if we're in the correct directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the dashboard directory."
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Check for required dependencies (gh CLI)
if ! command -v gh &> /dev/null; then
    echo "⚠️  Warning: GitHub CLI (gh) is not installed."
    echo "   Some features may not work. Install it with: brew install gh"
    echo ""
fi

# Check for clasp
if ! command -v clasp &> /dev/null; then
    echo "⚠️  Warning: clasp is not installed."
    echo "   Some features may not work. Install it with: npm install -g @google/clasp"
    echo ""
fi

# Start the dashboard
echo "🎯 Starting dashboard server..."
echo "📊 Dashboard will be available at: http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

npm start
