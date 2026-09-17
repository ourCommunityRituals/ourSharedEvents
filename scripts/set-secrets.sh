#!/usr/bin/env bash
#
# Set Wrangler secrets for a given environment.
#
# Usage:
#   bash scripts/set-secrets.sh staging
#   bash scripts/set-secrets.sh production
#
# This script prompts you to paste each secret value interactively.
# It must be run from the repo root (or workers/oursharedevents).
#
# Prerequisites:
#   - wrangler CLI installed and authenticated (wrangler login)
#   - Cloudflare Worker already created for the target environment
#
# Required secrets:
#   ADMIN_KEY                    — Bearer token for /admin routes (openssl rand -hex 32)
#   FORMS_ENCRYPTION_KEY         — AES-GCM key for email signup encryption (min 32 chars)
#   SHARED_REPORT_SIGNING_SECRET — HMAC key for SharedReport + sponsor-home signed
#                                  links (>=32 chars). FAIL-CLOSED: unset -> the whole
#                                  /sponsor corner and every /sharedReport link is inert.
#
# Ref: E2E-LAUNCH.md Part 5

set -euo pipefail

ENV="${1:-}"

if [[ -z "$ENV" ]]; then
  echo "Usage: $0 <staging|production>"
  echo ""
  echo "Example:"
  echo "  $0 staging       # Set secrets for stg.oursharedevents.com"
  echo "  $0 production    # Set secrets for oursharedevents.com"
  exit 1
fi

if [[ "$ENV" != "staging" && "$ENV" != "production" ]]; then
  echo "Error: environment must be 'staging' or 'production', got '$ENV'"
  exit 1
fi

# Resolve worker directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$SCRIPT_DIR/../workers/oursharedevents"

if [[ ! -f "$WORKER_DIR/wrangler.toml" ]]; then
  echo "Error: wrangler.toml not found at $WORKER_DIR/wrangler.toml"
  echo "Run this script from the repo root: bash scripts/set-secrets.sh $ENV"
  exit 1
fi

SECRETS=(
  "ADMIN_KEY"
  "FORMS_ENCRYPTION_KEY"
  "SHARED_REPORT_SIGNING_SECRET"
)

echo "════════════════════════════════════════════════════════════"
echo "  Setting Wrangler secrets for: $ENV"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "You will be prompted to paste each secret value."
echo "Press Enter after pasting each one."
echo ""

cd "$WORKER_DIR"

for SECRET in "${SECRETS[@]}"; do
  echo "──────────────────────────────────────────────────────────"
  echo "Setting: $SECRET (--env $ENV)"
  echo "──────────────────────────────────────────────────────────"
  wrangler secret put "$SECRET" --env "$ENV"
  echo ""
done

echo "════════════════════════════════════════════════════════════"
echo "  Verifying secrets for: $ENV"
echo "════════════════════════════════════════════════════════════"
echo ""
wrangler secret list --env "$ENV"

echo ""
echo "Done. All ${#SECRETS[@]} secrets set for --env $ENV."
echo ""
echo "Next steps:"
if [[ "$ENV" == "staging" ]]; then
  echo "  npm run deploy:staging    # Deploy worker to stg.oursharedevents.com"
  echo "  curl https://stg.oursharedevents.com/health"
else
  echo "  git tag v1.0.0 && git push origin v1.0.0    # Trigger production CI deploy"
  echo "  curl https://oursharedevents.com/health"
fi
