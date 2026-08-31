#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# CF Access service-token preflight probe — shared classifier (OSE-349).
#
# WHY THIS EXISTS
#   The T3 sponsor-covenant Newman seed keeps going red on `main` because the
#   CF Access service token drifts out of sync with the `CF_ACCESS_CLIENT_ID` /
#   `CF_ACCESS_CLIENT_SECRET` repo secrets (token rotated/expired in Cloudflare
#   without the secrets being updated). Occurrences: OSE-349 → 889 → 940 → 1112.
#   The failure is invisible-until-merged and looks like a covenant regression
#   when it is actually an edge-credential shadow (CF Access returns its HTML
#   login challenge, not JSON).
#
# WHAT IT DOES
#   Hits a read-only admin path with the exact credentials the covenant seed
#   uses, then CLASSIFIES the response (not the configuration — the doctrine
#   lesson from OSE-349: "config absent" ≠ "config invalid"). One enum, one
#   actionable diagnosis. This is the single source of the classifier logic,
#   consumed by BOTH the in-CI preflight step (diagnostic, non-gating) and the
#   scheduled canary (fail-closed tripwire). Two copies of the anti-drift tool
#   would themselves drift — so there is exactly one.
#
# CLASSIFICATIONS (stdout: "classification=<x>", also GITHUB_OUTPUT if set)
#   ok               200 + application/json — edge AND worker both accept.
#   cf_access_shadow HTML/redirect — CF Access rejected the service token.
#                    → CF_ACCESS_CLIENT_ID/SECRET stale, OR the Access policy no
#                      longer covers /api/v2/admin/* for this token, OR the token
#                      duration lapsed. See OSE-349.
#   worker_auth      401 + JSON — edge accepted, worker rejected ADMIN_KEY.
#   missing_secret   a required credential env var is empty (config ABSENT).
#   network          curl failed before any classification (transient).
#   unexpected       anything else — manual look, scrubbed body preview emitted.
#
# GATING
#   Default: always exit 0 (diagnostic; lets the real test stay source-of-truth).
#   --gate : exit 1 on a definitively-bad classification (cf_access_shadow /
#            worker_auth / missing_secret / unexpected). `network` stays exit 0
#            even under --gate (transient — a canary should not false-alarm on a
#            DNS blip). Use --gate for the proactive canary.
#
# SECURITY (Dr. of Security, OSE-349 CCR)
#   - Never echoes credential header VALUES.
#   - Emits a body preview only for `unexpected`, capped and token-scrubbed, so
#     an admin payload can't leak into a repo-readable Actions log.
#
# USAGE
#   CF_ACCESS_CLIENT_ID=… CF_ACCESS_CLIENT_SECRET=… ADMIN_KEY=… \
#     scripts/ci/cf-access-probe.sh [--gate] [--url=https://stg…/api/v2/admin/sponsors]
# ---------------------------------------------------------------------------
set -uo pipefail

# --- Pure classifier: (curl_exit, http_status, content_type) → enum. ----------
# No side effects, no network — this is the unit-tested heart of the probe
# (tests/ci/cf-access-probe.test.sh feeds synthetic tuples). Keep it pure.
cf_access_classify() {
  local curl_exit="$1" status="$2" content_type="$3"
  if [ "$curl_exit" -ne 0 ]; then echo network; return; fi
  if [ "$status" = "200" ] && echo "$content_type" | grep -qi "application/json"; then echo ok; return; fi
  if echo "$content_type" | grep -qi "text/html" || [ "$status" = "301" ] || [ "$status" = "302" ]; then echo cf_access_shadow; return; fi
  if [ "$status" = "401" ] && echo "$content_type" | grep -qi "application/json"; then echo worker_auth; return; fi
  echo unexpected
}

# When sourced (by the test), stop here — expose the classifier only.
[ "${BASH_SOURCE[0]:-$0}" != "${0}" ] && return 0

GATE=0
URL="${PROBE_URL:-https://stg.oursharedevents.com/api/v2/admin/sponsors}"
for arg in "$@"; do
  case "$arg" in
    --gate)   GATE=1 ;;
    --url=*)  URL="${arg#--url=}" ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo -e "$1" >> "$GITHUB_STEP_SUMMARY"; }
emit()    { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1" >> "$GITHUB_OUTPUT"; }

# --- Config-absent guard: classify BEFORE spending a network round-trip. ------
missing=()
[ -z "${CF_ACCESS_CLIENT_ID:-}" ]     && missing+=("CF_ACCESS_CLIENT_ID")
[ -z "${CF_ACCESS_CLIENT_SECRET:-}" ] && missing+=("CF_ACCESS_CLIENT_SECRET")
[ -z "${ADMIN_KEY:-}" ]               && missing+=("ADMIN_KEY")
if [ "${#missing[@]}" -gt 0 ]; then
  summary "## CF Access Preflight Probe\n\n❌ **Result:** \`missing_secret\` — required credential(s) empty in this job: \`${missing[*]}\`.\n\nThis is configuration **absent**, not invalid — the Doppler→GitHub sync did not populate these, or the job did not request them. Not the same as a stale token. See OSE-349."
  echo "::error title=CF Access probe: missing secret::empty in job: ${missing[*]}"
  emit "classification=missing_secret"
  emit "http_code=000"
  echo "classification=missing_secret (empty: ${missing[*]})"
  [ "$GATE" -eq 1 ] && exit 1 || exit 0
fi

# --- Probe. Credential values live only in headers, never printed. ------------
BODY_FILE="${RUNNER_TEMP:-/tmp}/cf-access-probe.body"
response=$(curl -sS -o "$BODY_FILE" -w '%{http_code}|%{content_type}|%{size_download}' \
  --max-time 30 \
  -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" \
  -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}" \
  -H "Authorization: Bearer ${ADMIN_KEY}" \
  "$URL")
curl_exit=$?
IFS='|' read -r status content_type size <<< "$response"

summary "## CF Access Preflight Probe\n\n| Field | Value |\n| --- | --- |\n| URL | \`$URL\` |\n| HTTP status | \`$status\` |\n| Content-Type | \`$content_type\` |\n| Body size | \`$size\` bytes |\n"

classification=$(cf_access_classify "$curl_exit" "$status" "$content_type")
case "$classification" in
  network)
    summary "⚠ **Result:** \`curl\` exited $curl_exit before the response classified (network/DNS). Transient — not a token verdict."
    echo "::warning title=CF Access probe: network::curl exit=$curl_exit" ;;
  ok)
    summary "✅ **Result:** Preflight OK — CF Access edge **and** worker \`ADMIN_KEY\` both accepting CI credentials." ;;
  cf_access_shadow)
    summary "❌ **Result:** **CF Access service-token rejected.** Response is an HTML/redirect login challenge, not JSON.\n\n**Fix path (OSE-349):**\n1. Confirm the OSE CI service token in Cloudflare Zero Trust → Access → Service Tokens is not expired (check **Duration**).\n2. Confirm the Access policy covers \`/api/v2/admin/*\` for this token.\n3. Update the source of truth (Doppler \`oursharedevents\`) → sync repopulates \`CF_ACCESS_CLIENT_ID\`/\`CF_ACCESS_CLIENT_SECRET\`.\n\n**Do not re-run blindly.** The covenant seed will fail on \`OSE-INV5\` until this clears."
    echo "::error title=CF Access rejected (OSE-349)::Service token shadowed — HTML/redirect (HTTP $status). Fix the token/policy; do not re-run blindly." ;;
  worker_auth)
    summary "❌ **Result:** CF Access accepted the service token, but the worker rejected the \`ADMIN_KEY\` Bearer (401 JSON).\n\nRotate/sync the \`ADMIN_KEY\` secret. Different cause from the CF Access shadow — file a sibling if persistent."
    echo "::error title=Worker auth rejected::ADMIN_KEY rejected by worker (401 JSON)." ;;
  *)
    # Scrub token-like blobs (≥20 char id/base64/hex runs) and cap length so an
    # admin payload cannot leak into a repo-readable log.
    body_preview=$(head -c 500 "$BODY_FILE" 2>/dev/null | tr -d '\r' | tr '\n' ' ' \
      | sed -E 's/[A-Za-z0-9_/+-]{20,}/[REDACTED]/g' | head -c 300)
    summary "⚠ **Result:** \`unexpected\` — manual investigation needed.\n\n**Scrubbed body preview:**\n\n\`\`\`\n$body_preview\n\`\`\`"
    echo "::warning title=CF Access probe: unexpected::status=$status content_type=$content_type" ;;
esac

emit "classification=$classification"
emit "http_code=$status"
echo "classification=$classification (HTTP $status, $content_type, ${size} bytes)"

if [ "$GATE" -eq 1 ]; then
  case "$classification" in
    ok|network) exit 0 ;;
    *)          exit 1 ;;
  esac
fi
exit 0
