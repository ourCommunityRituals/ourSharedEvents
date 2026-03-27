#!/bin/bash
# Bulk delete GitHub Actions artifacts
# Usage: GITHUB_TOKEN=your_token ./scripts/cleanup-artifacts.sh

REPO="oursharedevents/MVP-EVENT-TOOLKIT"
API="https://api.github.com/repos/$REPO/actions/artifacts"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: Set GITHUB_TOKEN environment variable"
  echo "Create one at: https://github.com/settings/tokens (needs 'repo' scope)"
  exit 1
fi

echo "Fetching artifacts..."
ARTIFACTS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" "$API?per_page=100" | jq -r '.artifacts[] | "\(.id) \(.name) \(.size_in_bytes) \(.created_at)"')

if [ -z "$ARTIFACTS" ]; then
  echo "No artifacts found or API error"
  exit 1
fi

echo ""
echo "Found artifacts:"
echo "$ARTIFACTS" | while read id name size created; do
  size_mb=$(echo "scale=2; $size / 1048576" | bc 2>/dev/null || echo "?")
  echo "  $id: $name (${size_mb}MB) - $created"
done

echo ""
read -p "Delete ALL artifacts? (y/N): " confirm

if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
  echo "$ARTIFACTS" | while read id name size created; do
    echo "Deleting $id ($name)..."
    curl -s -X DELETE -H "Authorization: token $GITHUB_TOKEN" "$API/$id"
  done
  echo "Done!"
else
  echo "Aborted"
fi
