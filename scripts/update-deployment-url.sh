#!/bin/bash
# Update deployment URL in all configuration files

if [ -z "$1" ]; then
    echo "Usage: ./update-deployment-url.sh <NEW_URL>"
    echo ""
    echo "Example:"
    echo "  ./update-deployment-url.sh https://script.google.com/macros/s/AKfycbxXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/exec"
    exit 1
fi

NEW_URL="$1"

echo "Updating deployment URL to: $NEW_URL"
echo ""

# Update postman local environment
if [ -f "postman/environments/mvp-event-toolkit-local.json" ]; then
    sed -i "s|https://script.google.com/macros/s/[^\"]*|$NEW_URL|g" postman/environments/mvp-event-toolkit-local.json
    echo "✅ Updated: postman/environments/mvp-event-toolkit-local.json"
fi

# Update .env file
if [ -f ".env" ]; then
    sed -i "s|BASE_URL=.*|BASE_URL=$NEW_URL|g" .env
    echo "✅ Updated: .env"
fi

echo ""
echo "Testing new URL..."
RESPONSE=$(curl -s "$NEW_URL?p=status&brand=root" 2>&1)

if [[ $RESPONSE == *'"ok":true'* ]]; then
    echo "✅ SUCCESS! Deployment is working!"
    echo "Response: $RESPONSE"
    echo ""
    echo "You can now run tests:"
    echo "  npm run test:newman:smoke"
    echo "  npm run test:e2e"
else
    echo "❌ Still not working. Response:"
    echo "${RESPONSE:0:300}"
    echo ""
    echo "Make sure you:"
    echo "  1. Set 'Who has access' to 'Anyone'"
    echo "  2. Clicked 'Authorize access'"
    echo "  3. Allowed all permissions"
fi
