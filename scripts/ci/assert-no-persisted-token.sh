#!/usr/bin/env bash
# assert-no-persisted-token.sh — fail if a checkout left a credential where
# later steps can read it (OSE-1466 item 0.1, ADR-012 Phase 0.1).
#
#   bash scripts/ci/assert-no-persisted-token.sh <checkout-dir>...
#
# The static gate (scripts/check-pr-secret-exposure.mjs) proves each token
# checkout is WRITTEN with persist-credentials: false. This is the runtime half:
# it looks at what the checkout actually left behind. The steps after a token
# checkout run PR code (npm ci, tests), which can read anything on disk.
#
# For each directory it reads git's EFFECTIVE config, so it sees a credential
# whether it sits in .git/config or in a file pulled in by includeIf (where
# newer actions/checkout versions keep it, under $RUNNER_TEMP):
#   - any http.*.extraheader entry
#   - any remote URL that carries userinfo (a user or token before the host)
#
# Prints the config key or remote name, never a value.
# Exit 0 clean, 1 credential found, 2 bad usage or not a git checkout.

set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: assert-no-persisted-token.sh <checkout-dir>..." >&2
  exit 2
fi

status=0

for dir in "$@"; do
  # A path that is not a checkout would otherwise pass without checking anything.
  if ! git -C "$dir" rev-parse --git-dir >/dev/null 2>&1; then
    echo "::error title=no checkout to check::$dir is not a git checkout"
    [ "$status" -eq 1 ] || status=2
    continue
  fi

  found=0

  while IFS= read -r key; do
    [ -n "$key" ] || continue
    echo "::error title=persisted credential::$dir: git config key '$key' is set"
    found=1
  done < <(git -C "$dir" config --name-only --get-regexp 'extraheader' 2>/dev/null || true)

  while IFS=' ' read -r key value; do
    [ -n "$key" ] || continue
    if printf '%s' "$value" | grep -Eq '^[a-z+]+://[^/@]+@'; then
      echo "::error title=persisted credential::$dir: '$key' carries credentials in the URL"
      found=1
    fi
  done < <(git -C "$dir" config --get-regexp '^remote\..*url$' 2>/dev/null || true)

  if [ "$found" -eq 1 ]; then
    status=1
  else
    echo "[no-persisted-token] $dir: clean"
  fi
done

exit "$status"
