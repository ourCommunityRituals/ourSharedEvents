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
#   FORMS_HASH_PEPPER            — HMAC-SHA256 pepper for email hashing (min 32 chars).
#                                  FAIL-CLOSED: unset -> register + email-signup return
#                                  CONFIG_ERROR 503 (OSE-1343). Added to this required
#                                  list because it was never provisioned on staging in
#                                  the first place — nothing here ever prompted for it.
#   SHARED_REPORT_SIGNING_SECRET — HMAC key for SharedReport + sponsor-home signed
#                                  links (>=32 chars). FAIL-CLOSED: unset -> the whole
#                                  /sponsor corner and every /sharedReport link is inert.
#   RATE_LIMIT_KEY_PEPPER        — HMAC key for rate-limit / beacon-dedup KV keys (>=32
#                                  chars, own secret; OSE-1447). The deploy gate refuses
#                                  without it. At runtime an unset pepper falls back to
#                                  bare SHA-256 (reversible to the IP) and logs
#                                  RATE_LIMIT_PEPPER_MISSING, so rate limiting never stops.
#                                  Rotate freely: rate-limit buckets live 60 s, beacon
#                                  dedup keys 300 s (old keys age out within 5 minutes).
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
  "FORMS_HASH_PEPPER"
  "SHARED_REPORT_SIGNING_SECRET"
  "RATE_LIMIT_KEY_PEPPER"
)

echo "════════════════════════════════════════════════════════════"
echo "  Setting Wrangler secrets for: $ENV"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "You will be prompted to paste each secret value."
echo "Press Enter after pasting each one."
echo ""

cd "$WORKER_DIR"

# All three are crypto keys/tokens; enforce a shared minimum length. A signing
# secret under 32 chars fail-closes the /sponsor + /sharedReport corner just as
# an unset one does.
MIN_LEN=32

for SECRET in "${SECRETS[@]}"; do
  echo "──────────────────────────────────────────────────────────"
  echo "Setting: $SECRET (--env $ENV, min ${MIN_LEN} chars)"
  echo "──────────────────────────────────────────────────────────"
  # CCR-PR567 re-run item 5 — read + length-check the value HERE, the one place
  # it exists in the clear, then pipe it in. `wrangler secret list` can only
  # confirm PRESENCE afterward, so a fat-fingered short/empty paste that would
  # ship the fail-closed corner inert must be rejected at provisioning time.
  while true; do
    printf 'Paste value for %s, then Enter: ' "$SECRET"
    IFS= read -rs VALUE
    echo ""
    VALUE="$(printf '%s' "$VALUE" | tr -d '[:space:]')" # strip stray paste whitespace
    if [[ "${#VALUE}" -lt "$MIN_LEN" ]]; then
      echo "  ✗ Too short (${#VALUE} chars, need >= ${MIN_LEN}). Try again."
      continue
    fi
    break
  done
  printf '%s' "$VALUE" | wrangler secret put "$SECRET" --env "$ENV"
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
