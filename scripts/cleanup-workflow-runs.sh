#!/bin/bash
# Cleanup Legacy Workflow Runs from GitHub Actions UI
#
# This script deletes all runs for archived/legacy workflows so they
# no longer appear in the GitHub Actions sidebar.
#
# Prerequisites:
#   - GitHub CLI (gh) authenticated, OR
#   - GITHUB_TOKEN environment variable set
#
# Usage:
#   ./scripts/cleanup-workflow-runs.sh
#
# What it does:
#   1. Lists all workflows in the repo
#   2. Identifies legacy workflows (not in the keep list)
#   3. Deletes all runs for legacy workflows
#   4. After all runs are deleted, workflows disappear from UI

set -e

REPO="zeventbooks/MVP-EVENT-TOOLKIT"

# Workflows to KEEP (these should remain visible)
KEEP_WORKFLOWS=(
  "Stage-1 Validation"
  "Stage-2 Orchestrator"
  "CodeQL Security Analysis"
  "Dependabot Updates"
)

# Check for authentication
if ! command -v gh &> /dev/null; then
  if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: Either 'gh' CLI or GITHUB_TOKEN is required"
    echo ""
    echo "Option 1: Install and authenticate GitHub CLI"
    echo "  brew install gh && gh auth login"
    echo ""
    echo "Option 2: Set GITHUB_TOKEN environment variable"
    echo "  export GITHUB_TOKEN=ghp_your_token_here"
    exit 1
  fi
  USE_CURL=true
else
  USE_CURL=false
fi

echo "=== GitHub Actions Workflow Cleanup ==="
echo "Repository: $REPO"
echo ""

# Function to check if workflow should be kept
should_keep() {
  local workflow_name="$1"
  for keep in "${KEEP_WORKFLOWS[@]}"; do
    if [[ "$workflow_name" == "$keep" ]]; then
      return 0
    fi
  done
  return 1
}

# Get all workflows
echo "Fetching workflows..."
if [ "$USE_CURL" = true ]; then
  WORKFLOWS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/repos/$REPO/actions/workflows" | \
    jq -r '.workflows[] | "\(.id)|\(.name)"')
else
  WORKFLOWS=$(gh api "repos/$REPO/actions/workflows" --jq '.workflows[] | "\(.id)|\(.name)"')
fi

echo ""
echo "=== Workflow Analysis ==="

# Process each workflow
while IFS='|' read -r workflow_id workflow_name; do
  if should_keep "$workflow_name"; then
    echo "✅ KEEP: $workflow_name (ID: $workflow_id)"
  else
    echo "🗑️  DELETE RUNS: $workflow_name (ID: $workflow_id)"

    # Get all runs for this workflow
    if [ "$USE_CURL" = true ]; then
      RUN_IDS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
        "https://api.github.com/repos/$REPO/actions/workflows/$workflow_id/runs?per_page=100" | \
        jq -r '.workflow_runs[].id')
    else
      RUN_IDS=$(gh api "repos/$REPO/actions/workflows/$workflow_id/runs?per_page=100" --jq '.workflow_runs[].id')
    fi

    # Delete each run
    run_count=0
    for run_id in $RUN_IDS; do
      if [ -n "$run_id" ]; then
        echo "   Deleting run $run_id..."
        if [ "$USE_CURL" = true ]; then
          curl -s -X DELETE -H "Authorization: token $GITHUB_TOKEN" \
            "https://api.github.com/repos/$REPO/actions/runs/$run_id"
        else
          gh api -X DELETE "repos/$REPO/actions/runs/$run_id" 2>/dev/null || true
        fi
        ((run_count++))
      fi
    done

    if [ $run_count -gt 0 ]; then
      echo "   Deleted $run_count runs"
    else
      echo "   No runs to delete"
    fi
  fi
done <<< "$WORKFLOWS"

echo ""
echo "=== Cleanup Complete ==="
echo ""
echo "Refresh your GitHub Actions page. Legacy workflows should now be hidden."
echo "Note: It may take a minute for the UI to update."
