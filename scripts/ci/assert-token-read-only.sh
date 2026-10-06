#!/usr/bin/env bash
# assert-token-read-only.sh — prove at run time that this job's token cannot
# push, comment or open issues (OSE-1466 item 0.6, ADR-012 Phase 0.6).
#
#   GH_TOKEN=<job token> GITHUB_REPOSITORY=<owner/repo> PROBE_ISSUE=<n> \
#     bash scripts/ci/assert-token-read-only.sh
#
# The static gate reads the `permissions:` a job is written with. This asks
# GitHub what the token is actually allowed to do. A job that runs PR code
# hands that code its token, so the token must be refused on every write.
#
# Nothing is ever created. Each probe is a request GitHub refuses for either
# reason, and the status says which:
#   - open an issue with an empty body      403 no permission | 422 would have been allowed
#   - comment with an empty body            403 no permission | 422 would have been allowed
#   - ask for the push (receive-pack) refs  403 no permission | 200 push allowed
# Checked against a write-capable token on 2026-10-06: 422, 422, 200.
#
# Only 403 passes. Any other status fails, so an outage or a changed API does
# not read as "safe". The token goes to curl on stdin, never on a command line.
# Exit 0 read-only, 1 a write was not refused, 2 bad usage.

set -uo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
API="${GITHUB_API_URL:-https://api.github.com}"
SERVER="${GITHUB_SERVER_URL:-https://github.com}"
ISSUE="${PROBE_ISSUE:-1}"

case "$ISSUE" in
  '' | *[!0-9]*)
    echo "::error::PROBE_ISSUE must be a number"
    exit 2
    ;;
esac

status=0

# probe <label> <curl config line for auth> <curl args...>
probe() {
  local label="$1" auth="$2" code
  shift 2
  code="$(printf '%s\n' "$auth" | curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -K - "$@" 2>/dev/null)" || code="000"
  if [ "$code" = "403" ]; then
    echo "[token-read-only] $label: refused (403)"
  else
    echo "::error title=job token can write::$label: expected 403, got $code"
    status=1
  fi
}

BEARER="header = \"Authorization: Bearer ${GH_TOKEN}\""
BASIC="user = \"x-access-token:${GH_TOKEN}\""

probe 'open an issue' "$BEARER" -X POST -H 'Accept: application/vnd.github+json' \
  -d '{}' "$API/repos/$GITHUB_REPOSITORY/issues"

probe 'comment on an issue or pull request' "$BEARER" -X POST -H 'Accept: application/vnd.github+json' \
  -d '{}' "$API/repos/$GITHUB_REPOSITORY/issues/$ISSUE/comments"

probe 'push' "$BASIC" "$SERVER/$GITHUB_REPOSITORY.git/info/refs?service=git-receive-pack"

exit "$status"
