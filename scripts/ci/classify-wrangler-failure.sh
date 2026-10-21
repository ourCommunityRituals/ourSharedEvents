#!/usr/bin/env bash
# Say what a failed `wrangler secret list` was, instead of "the secret is not set".
#
#   OUT="$(npx wrangler secret list --env staging 2>&1)" && RC=0 || RC=$?
#   bash ../../scripts/ci/classify-wrangler-failure.sh "$RC" "$OUT" staging
#
# Exit 0 when wrangler succeeded (RC = 0) and nothing is printed. Otherwise print
# ONE ::error:: line that names the failure class (auth, network, other) and exit 1.
#
# Why: the secrets gate used `... 2>&1 || true`, so any wrangler failure (a rejected
# token, a missing permission, a Cloudflare 5xx) read as "<SECRET> is not set ...
# Provision it: bash scripts/set-secrets.sh <env>". That script puts the encryption
# key and the peppers without checking for a value that is already there, so the
# wrong-cause message could lead to replacing keys that were fine (OSE-1731, found
# during OSE-1730). The gate stays fail-closed; only the diagnosis changes.
#
# The wrangler output is repeated only after header lines and long token-like runs
# are removed. Nothing here reads or prints a credential.
set -euo pipefail

RC="${1:-}"
OUT="${2:-}"
ENVIRONMENT="${3:-unknown}"

if [[ ! "$RC" =~ ^[0-9]+$ ]]; then
  echo "::error::classify-wrangler-failure.sh: first argument must be wrangler's exit code" >&2
  exit 2
fi
if [[ "$RC" -eq 0 ]]; then
  exit 0
fi

AUTH='Authentication error|Invalid access token|Unable to authenticate|Too many authentication failures|\[code: (10000|10001|10502|9106|9107|9108|9109)\]|Unauthorized|Forbidden'
NET='ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|Bad Gateway|Service Unavailable|Gateway Time-?out'

if printf '%s' "$OUT" | grep -qiE "$AUTH"; then
  CLASS='authentication failure'
  HINT='CLOUDFLARE_API_TOKEN_OSE is rejected, belongs to another account than CLOUDFLARE_ACCOUNT_ID, or lacks a permission. Check it from your own terminal with GET /accounts/<id>/tokens/verify (OSE-1730).'
elif printf '%s' "$OUT" | grep -qiE "$NET"; then
  CLASS='network failure'
  HINT='Cloudflare was unreachable from the runner. Re-run once; if it repeats, check Cloudflare status.'
else
  CLASS='failure'
  HINT='Read the wrangler output below.'
fi

echo "::error::Cloudflare ${CLASS} while listing secrets on ${ENVIRONMENT} (wrangler exit ${RC}). This is NOT a missing-secret finding. ${HINT} Do NOT run scripts/set-secrets.sh for this: it overwrites existing keys."

# Repeat the output for the log with header lines and token-like runs removed.
printf '%s\n' "$OUT" \
  | { grep -viE 'authorization|bearer|x-auth' || true; } \
  | sed -E 's/[A-Za-z0-9_-]{32,}/***/g'
exit 1
