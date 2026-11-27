#!/usr/bin/env bash
# Local vetting: S0-T3's API and smoke layers against THIS branch's code, on a local
# worker with a local D1. No deploy, no secrets, no network beyond npm.
#
#   T2  Bruno API contract + pages        (bruno/ose-api, bruno/ose-pages)
#   T3  Playwright smoke: security, iac, forms
#   T4k Playwright: the zoomed landing map, its place panels and links (the one T4
#       slice that needs only a local worker and its fixture), then a D1 read
#       that using the map moved no count (scripts/ci/map-counts-check.mjs)
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
# The voting switch follows staging's (OSE-2227): the Bruno run below uses the
# ose-staging environment, whose votingSwitch says which half of the voting folders
# to run, and tests/unit/ci/env-parity.test.js holds that copy equal to staging's
# VOTING_ENABLED. So the local worker reads the same word, and the two halves agree.
VOTING_LOCAL="$(sed -n '/- name: votingSwitch/{n;s/.*value: *"\([a-z]*\)".*/\1/p}' "$ROOT/bruno/ose-api/environments/ose-staging.yml")"
[ "$VOTING_LOCAL" = "on" ] || VOTING_LOCAL=off
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
    --var ANON_ID_HASH_PEPPER:local-anon-pepper-12345678901234567890 \
    --var PUBLISH_GRACE_MINUTES:1 --var "VOTING_ENABLED:${VOTING_LOCAL}") >"$WORKER_LOG" 2>&1 &
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
seed bruno/fixtures/opt-in-sponsors-seed.sql
seed bruno/fixtures/live-container-seed.sql
seed bruno/fixtures/sponsor-line-seed.sql
seed bruno/fixtures/sponsor-thumb-seed.sql
seed bruno/fixtures/attendance-mode-seed.sql
seed bruno/fixtures/declared-series-seed.sql
seed bruno/fixtures/core-values-draft-seed.sql
seed bruno/fixtures/go-live-evidence-seed.sql
seed bruno/fixtures/report-plan-cap-seed.sql
seed bruno/fixtures/ci-brand-seed.sql
seed bruno/fixtures/lakeside-brand-tree-seed.sql
seed bruno/fixtures/lakeside-league-competition-seed.sql
seed bruno/fixtures/campaigns-seed.sql
# Read by the Pages collection's landing ?zip=60655 / ?zip=60453 requests. On
# staging a later step unpublishes it again; this local D1 is thrown away.
seed bruno/fixtures/landing-zip-own-area-seed.sql
# The zoomed landing map (epic OSE-1880): read by the Pages folder "16. Landing Map
# Zoom" and by the T4k map specs below. Sets known tap and share-open counts.
seed bruno/fixtures/map-zoom-area-seed.sql
# OSE-2196: off-map, grace and listed events read by the Pages folder
# "17. Routable (OSE-2196)". After the map-zoom seed: its off-map pair sits in
# that area. On staging a later step unpublishes the listed ones; this local D1
# is thrown away.
seed bruno/fixtures/routable-seed.sql
echo "::endgroup::"

# ── T3: Playwright smoke ─────────────────────────────────────────────────────
# Counts come from Playwright's JSON report so a section that ran nothing is red.
pw_section() { # name config specs...   (PW_TIER names the tier; default T3)
  local name="$1" config="$2"; shift 2
  local tier="${PW_TIER:-T3}"
  local slug; slug="$(printf '%s' "$tier" | tr 'A-Z' 'a-z')"
  local json="$RESULTS/local-${slug}-${name}.json"
  echo "::group::${tier} ${name}"
  (cd "$ROOT" && BASE_URL="$BASE" ADMIN_KEY="$ADMIN_KEY_LOCAL" TEST_ENV=staging \
     PLAYWRIGHT_JSON_OUTPUT_NAME="$json" npx playwright test --config="$config" --reporter=line,json "$@") >"$PERSIST_DIR/${slug}-${name}.log" 2>&1
  local rc=$?
  tail -15 "$PERSIST_DIR/${slug}-${name}.log"
  echo "::endgroup::"
  local counts
  counts=$(node -e '
    const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).stats||{};
    console.log([r.expected||0,r.unexpected||0,r.skipped||0,r.flaky||0].join(" "));' "$json" 2>/dev/null || echo "0 0 0 0")
  set -- $counts
  local passed=$1 failed=$2 skipped=$3 flaky=$4
  if [ "$rc" -ne 0 ]; then record "${tier} ${name}" "failed" "${passed} passed, ${failed} failed, ${skipped} skipped"
  elif [ "$passed" -eq 0 ]; then record "${tier} ${name}" "vacuous" "0 tests ran; a gate that cannot fail is not green"
  else record "${tier} ${name}" "passed" "${passed} passed, ${skipped} skipped, ${flaky} flaky"; fi
}
# Sections come from scripts/ci/t3-sections.json, the same list the staging T3 runs.
while IFS=$'	' read -r t3name t3config t3specs; do
  t3name="${t3name%$'
'}"; t3specs="${t3specs%$'
'}"
  # shellcheck disable=SC2086
  pw_section "$t3name" "$t3config" $t3specs
done < <(node "$ROOT/scripts/ci/run-t3.mjs" --tsv)

# ── T4k: the zoomed landing map ──────────────────────────────────────────────
# The same two specs the staging step "T4k: Map Zoom, Place Panel and Map Links"
# names (tests/unit/ci/map-counts-check.test.js keeps the two lists equal). Here they
# run on this branch's code before merge. A local worker has no street tiles in its
# bucket, which is staging's state too: the zoom is the place list and the panels.
PW_TIER=T4k pw_section map-zoom playwright.e2e-smoke.config.ts \
  tests/e2e/3-flows/map-place-panel.spec.ts \
  tests/e2e/2-pages/map-place-panel-layout.spec.ts

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

# ── Map counts (OSE-1896) ────────────────────────────────────────────────────
# After the map specs followed every link and the Pages folder read the zoomed
# pages: taps, share opens and scans of the seeded events, read from the local D1,
# must still be what bruno/fixtures/map-zoom-area-seed.sql set.
echo "::group::Map counts unchanged"
(cd "$ROOT/workers/oursharedevents" &&
  node ../../scripts/ci/map-counts-check.mjs --local --persist-to "$PERSIST_DIR") >"$PERSIST_DIR/map-counts.log" 2>&1
MAP_COUNTS_RC=$?
tail -6 "$PERSIST_DIR/map-counts.log"
echo "::endgroup::"
if [ "$MAP_COUNTS_RC" -eq 0 ]; then record "Map counts (D1)" "passed" "taps, share opens and scans unchanged"
else record "Map counts (D1)" "failed" "a count moved, or the read failed (see log above)"; fi

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
