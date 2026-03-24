#!/bin/bash
# Quick script to get your test link

echo "🔍 Getting your test link..."
echo ""

# Method 1: Try to get from existing deployments
echo "Method 1: Checking existing deployments..."
clasp deployments 2>/dev/null | grep -E "AKfyc|@" || echo "❌ Need to re-authenticate"

echo ""
echo "Method 2: Direct URL from Script ID"
echo "Your Script ID: 1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l"
echo ""
echo "📝 Manual Steps to Get Test Link:"
echo ""
echo "1. Open Apps Script Editor:"
echo "   https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit"
echo ""
echo "2. Click: Deploy > Test deployments"
echo ""
echo "3. Copy the URL that appears (starts with https://script.google.com/macros/s/...)"
echo ""
echo "4. Or create a new deployment:"
echo "   - Click: Deploy > New deployment"
echo "   - Select type: Web app"
echo "   - Execute as: Me"
echo "   - Who has access: Anyone"
echo "   - Click: Deploy"
echo "   - Copy the Web app URL"
echo ""
