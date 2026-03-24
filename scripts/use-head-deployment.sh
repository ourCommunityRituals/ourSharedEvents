#!/bin/bash
# Use @HEAD deployment which auto-updates with every push
# This avoids version locking issues

set -e

echo "Using @HEAD deployment (auto-updates with code pushes)"
echo ""

HEAD_URL="https://script.google.com/macros/s/AKfycbwqhDGZMqfXSKOV12mHW8XgxYF8QBdQXqhCu9kcxC6-ZqedTBkMb_NmEG2GO64-ZuSf/exec"

# Update environment files
if [ -f "postman/environments/mvp-event-toolkit-local.json" ]; then
    # Match any Google Apps Script URL (deployment or editor URL)
    sed -i "s|https://script.google.com/[^\"]*|$HEAD_URL|g" postman/environments/mvp-event-toolkit-local.json
    echo "✅ Updated: postman/environments/mvp-event-toolkit-local.json"
fi

if [ -f ".env" ]; then
    sed -i "s|BASE_URL=.*|BASE_URL=$HEAD_URL|g" .env
    echo "✅ Updated: .env"
fi

echo ""
echo "Testing @HEAD deployment..."
RESPONSE=$(curl -s "$HEAD_URL?p=status&brand=root" 2>&1)

if [[ $RESPONSE == *'"ok":true'* ]]; then
    echo "✅ SUCCESS! @HEAD deployment is working!"
    echo ""
    echo "You can now run tests:"
    echo "  npm run test:newman:smoke"
    echo "  npm run test:e2e"
    echo ""
    echo "Note: @HEAD auto-updates when you run 'npm run push'"
elif [[ $RESPONSE == *'"ok":false'* ]] && [[ $RESPONSE == *"getId"* ]]; then
    echo "⚠️  @HEAD has old code. Push latest code:"
    echo "  npm run push"
    echo "  sleep 30"
    echo "  ./use-head-deployment.sh"
elif [[ $RESPONSE == *"Moved Temporarily"* ]]; then
    echo "❌ @HEAD requires authorization"
    echo ""
    echo "In Apps Script editor:"
    echo "  1. Deploy → Manage deployments"
    echo "  2. Find @HEAD"
    echo "  3. Edit → Who has access: Anyone → Deploy"
else
    echo "❌ Unexpected response:"
    echo "${RESPONSE:0:300}"
fi
