#!/usr/bin/env bash
# Local vetting: S0-T3's API and smoke layers against THIS branch's code, on a local
# worker with a local D1. No deploy, no secrets, no network beyond npm.
#
#   T2  Bruno API contract + pages        (bruno/ose-api, bruno/ose-pages)
#   T3  Playwright smoke: security, iac, forms
#
# Runs every section even when an earlier one fails, so one run names every red
# section. Exits non-zero if any section failed OR proved nothing (zero tests ran:
# a gate that cannot fail is absent, not green).
#
# Usage (repo root):  bash scripts/ci/run-local-vetting.sh
# Env: WORKER_ALREADY_RUNNING=1 skips migrate+boot (a worker you started with the same
# vars, ADMIN_KEY_LOCAL and OCR_INTERNAL_LOCAL; used on Windows where a worker started
# from a bash background job can hang). PORT (default 8791), PERSIST_DIR (default a fresh temp dir; keep it SHORT on
# Windows, miniflare's D1 files fail under very long paths).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-8791}"
PERSIST_DIR="${PERSIST_DIR:-$(mktemp -d 2>/dev/null || echo /tmp/ose-local-vetting)}"
BASE="http://127.0.0.1:${PORT}"
ADMIN_KEY_LOCAL="${ADMIN_KEY_LOCAL:-local-admin-key-$$}"
OCR_INTERNAL_LOCAL="${OCR_INTERNAL_LOCAL:-local-ocr-internal-$$}"
RESULTS="${ROOT}/.test-results"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
WORKER_LOG="${PERSIST_DIR}/worker.log"
mkdir -p "$RESULTS" "$PERSIST_DIR"

WORKER_PID=""
cleanup() { [ -n "$WORKER_PID" ] && kill "$WORKER_PID" 2>/dev/null; pkill -P "$WORKER_PID" 2>/dev/null; true; }
trap cleanup EXIT

declare -a NAMES STATES NOTES
record() { NAMES+=("$1"); STATES+=("$2"); NOTES+=("$3"); }

if [ "${WORKER_ALREADY_RUNNING:-0}" != "1" ]; then
echo "::group::Migrate local D1 (DB + FORMS_DB)"
(cd "$ROOT/workers/oursharedevents" &&
  npx wrangler d1 migrations apply DB --local --persist-to "$PERSIST_DIR" &&
  npx wrangler d1 migrations apply FORMS_DB --local --persist-to "$PERSIST_DIR") >"$PERSIST_DIR/migrate.log" 2>&1 \
  || { cat "$PERSIST_DIR/migrate.log"; echo "::error::local migrations failed"; exit 1; }
echo "::endgroup::"

echo "::group::Start local worker on ${BASE}"
# Same vars as playwright.mobile.config.ts, plus WORKER_ENV=staging (so /health and the
# CORS allowlist match the staging-shaped tests) and the internal-auth pair the Bruno
# collections use. All values are local and random-per-run; none is a real secret.
(cd "$ROOT/workers/oursharedevents" &&
  exec npx wrangler dev --local --persist-to "$PERSIST_DIR" --port "$PORT" \
    --var "ADMIN_KEY:${ADMIN_KEY_LOCAL}" --var ALLOW_ADMIN_KEY_FALLBACK:true \
    --var ALLOW_OCR_INTERNAL:true --var "X_OCR_INTERNAL:${OCR_INTERNAL_LOCAL}" \
    --var ADMIN_SCOPE_ALL:true --var WORKER_ENV:staging \
    --var SHARED_REPORT_SIGNING_SECRET:local-signing-secret-1234567890 \
    --var FORMS_ENCRYPTION_KEY:local-forms-key-1234567890123456789 \
    --var FORMS_HASH_PEPPER:local-pepper-1234567890 \
    --var PUBLISH_GRACE_MINUTES:1) >"$WORKER_LOG" 2>&1 &
WORKER_PID=$!
for _ in $(seq 1 60); do
  curl -fsS -m 3 "${BASE}/health" 2>/dev/null | grep -q '"db":"ok"' && break
  sleep 2
done
if ! curl -fsS -m 3 "${BASE}/health" 2>/dev/null | grep -q '"db":"ok"'; then
  tail -30 "$WORKER_LOG"; echo "::error::local worker did not become healthy"; exit 1
fi
echo "::endgroup::"
fi

echo "::group::Seed fixtures (same files CI seeds on staging)"
seed() {
  (cd "$ROOT/workers/oursharedevents" &&
    npx wrangler d1 execute DB --local --persist-to "$PERSIST_DIR" --file "../../$1") >"$PERSIST_DIR/seed.log" 2>&1 \
    || { cat "$PERSIST_DIR/seed.log"; echo "::error::seed failed: $1"; exit 1; }
}
seed tests/ui/smoke/fixtures/test-event-001.sql
seed bruno/fixtures/covenant-event-geo.sql
seed bruno/fixtures/covenant-sponsors-reset.sql
seed bruno/fixtures/covenant-sponsors-seed.sql
seed bruno/fixtures/sponsor-public-card-seed.sql
seed bruno/fixtures/core-values-draft-seed.sql
seed bruno/fixtures/report-plan-cap-seed.sql
echo "::endgroup::"

# ── T3: Playwright smoke ─────────────────────────────────────────────────────
# Counts come from Playwright's JSON report so a section that ran nothing is red.
pw_section() { # name config specs...
  local name="$1" config="$2"; shift 2
  local json="$RESULTS/local-t3-${name}.json"
  echo "::group::T3 ${name}"
  (cd "$ROOT" && BASE_URL="$BASE" ADMIN_KEY="$ADMIN_KEY_LOCAL" TEST_ENV=staging \
     PLAYWRIGHT_JSON_OUTPUT_NAME="$json" npx playwright test --config="$config" --reporter=line,json "$@") >"$PERSIST_DIR/t3-${name}.log" 2>&1
  local rc=$?
  tail -15 "$PERSIST_DIR/t3-${name}.log"
  echo "::endgroup::"
  local counts
  counts=$(node -e '
    const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).stats||{};
    console.log([r.expected||0,r.unexpected||0,r.skipped||0,r.flaky||0].join(" "));' "$json" 2>/dev/null || echo "0 0 0 0")
  set -- $counts
  local passed=$1 failed=$2 skipped=$3 flaky=$4
  if [ "$rc" -ne 0 ]; then record "T3 ${name}" "failed" "${passed} passed, ${failed} failed, ${skipped} skipped"
  elif [ "$passed" -eq 0 ]; then record "T3 ${name}" "vacuous" "0 tests ran; a gate that cannot fail is not green"
  else record "T3 ${name}" "passed" "${passed} passed, ${skipped} skipped, ${flaky} flaky"; fi
}
# Sections come from scripts/ci/t3-sections.json, the same list the staging T3 runs.
while IFS=$'	' read -r t3name t3config t3specs; do
  t3name="${t3name%$''}"; t3specs="${t3specs%$''}"
  # shellcheck disable=SC2086
  pw_section "$t3name" "$t3config" $t3specs
done < <(node "$ROOT/scripts/ci/run-t3.mjs" --tsv)

# ── T2: Bruno ────────────────────────────────────────────────────────────────
# `bru run` prints "Tests 0/0" for these scripts, so the JUnit file is the only honest
# count. It also exits 2 if the report dir is missing (created above).
bru_section() { # name collection-dir
  local name="$1" dir="$2" junit="$RESULTS/local-t2-${1}.xml"
  echo "::group::T2 ${name}"
  (cd "$ROOT/$dir" && npx bru run . -r --env ose-staging \
     --env-var "baseUrl=${BASE}" --env-var "adminKey=${ADMIN_KEY_LOCAL}" \
     --env-var "ocrInternalSecret=${OCR_INTERNAL_LOCAL}" \
     --env-var cfAccessClientId=local --env-var cfAccessClientSecret=local \
     --reporter-junit "$junit") >"$PERSIST_DIR/t2-${name}.log" 2>&1
  local rc=$?
  tail -12 "$PERSIST_DIR/t2-${name}.log"
  echo "::endgroup::"
  local counts
  counts=$(node -e '
    const x=require("fs").readFileSync(process.argv[1],"utf8");
    const cases=(x.match(/<testcase /g)||[]).length;
    const bad=(x.match(/<(failure|error)[ >]/g)||[]).length;
    console.log(cases+" "+bad);' "$junit" 2>/dev/null || echo "0 0")
  set -- $counts
  local cases=$1 bad=$2
  if [ "$rc" -ne 0 ] || [ "$bad" -ne 0 ]; then record "T2 ${name}" "failed" "${cases} checks, ${bad} failed"
  elif [ "$cases" -eq 0 ]; then record "T2 ${name}" "vacuous" "0 checks ran; a gate that cannot fail is not green"
  else record "T2 ${name}" "passed" "${cases} checks"; fi
}
bru_section api bruno/ose-api
bru_section pages bruno/ose-pages

# ── Report ───────────────────────────────────────────────────────────────────
{
  echo "## Local vetting (this branch's code, local worker)"
  echo
  echo "| Section | State | Detail |"
  echo "|---|---|---|"
} >>"$SUMMARY"
BAD=0
for i in "${!NAMES[@]}"; do
  glyph="✅"; [ "${STATES[$i]}" != "passed" ] && { glyph="❌"; BAD=1; }
  echo "${glyph} ${NAMES[$i]}: ${STATES[$i]} (${NOTES[$i]})"
  echo "| ${NAMES[$i]} | ${glyph} ${STATES[$i]} | ${NOTES[$i]} |" >>"$SUMMARY"
done
if [ "$BAD" -ne 0 ]; then echo "::error::local vetting failed (see sections above)"; exit 1; fi
echo "local vetting: all sections passed"
