#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Fail-closed Playwright runner — OSE-852 (MINE-0) Gate 0 + OSE-1170 Gate 0b.
#
# A Playwright step can report green two dishonest ways, and this guard closes
# both:
#
#   Gate 0a — ZERO DISCOVERY (OSE-852). A step that discovers zero tests is
#   indistinguishable, from the outside, from one whose tests all passed.
#   Discovery is counted BEFORE the run (from `--list --reporter=json`, not
#   human output, so it survives summary-format changes); zero is a hard error;
#   the count is published. A list that cannot be parsed is failure, never zero
#   and never success — unknown is never green.
#
#   Gate 0b — ALL SKIPPED (OSE-1170). A step that DISCOVERS tests but EXECUTES
#   none of them — every test hit `test.skip()` because a precondition (a seed,
#   a fixture, a flag) was not met — also exits green today. That is the exact
#   shape the OSE-554 chain kept producing: a cascading runtime skip reads as a
#   pass. So after the run the JSON result is parsed and `executed == 0 while
#   discovered > 0` is a hard error: a precondition was not met, and an
#   all-skipped step is not green. The executed/skipped split is published so a
#   partial-skip is visible rather than silent.
#
# The post-run JSON is obtained via PLAYWRIGHT_JSON_OUTPUT_NAME, which each
# config's `json` reporter honors (env var wins over the config `outputFile`),
# so the config's own reporters — html, junit, line — are preserved untouched.
#
# NOTE on the split: Playwright reports both an intentional `test.skip()` and a
# precondition-unmet skip as status "skipped"; it does not distinguish them.
# This guard therefore reports the skipped COUNT (so partial skips are visible)
# and enforces the one thing that is unambiguous — a gate step that executes
# zero of its discovered tests has proven nothing and must go red.
#
# Usage:  PW_LABEL='T4e: Attendee Arc' scripts/pw-guarded.sh --config=<cfg> <paths...>
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

LABEL="${PW_LABEL:-playwright}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

# ── Gate 0a: discovery (pre-run) ────────────────────────────────────────────
LIST_JSON="$(npx playwright test --list --reporter=json "$@" 2>/dev/null)"

COUNT="$(printf '%s' "$LIST_JSON" | node -e '
let s = "";
process.stdin.on("data", d => (s += d)).on("end", () => {
  let n = -1;
  try {
    const j = JSON.parse(s);
    n = 0;
    (function walk(suites) {
      for (const su of suites || []) {
        n += (su.specs || []).length;
        walk(su.suites);
      }
    })(j.suites);
  } catch { n = -1; }
  console.log(n);
});')"

if [ "$COUNT" = "-1" ]; then
  echo "::error::${LABEL}: could not parse Playwright discovery output. Treating as FAILURE — an unknown test count must never report green."
  echo "- ❌ **${LABEL}** — discovery unparseable" >> "$SUMMARY"
  exit 1
fi

if [ "$COUNT" -eq 0 ]; then
  echo "::error::${LABEL}: discovered 0 tests and would have exited green. Args: $*"
  echo "::error::A test runner that finds nothing is an error, not a pass. Check that the positional paths lie inside the config's testDir."
  echo "- ❌ **${LABEL}** — discovered **0** tests (Gate 0 failure)" >> "$SUMMARY"
  exit 1
fi

echo "${LABEL}: discovered tests: ${COUNT}"

# ── Run — config reporters preserved; json result captured for Gate 0b ──────
RESULTS_JSON="$(mktemp)"
export PLAYWRIGHT_JSON_OUTPUT_NAME="$RESULTS_JSON"

npx playwright test "$@"
RUN_STATUS=$?

# ── Gate 0b: executed count (post-run) ──────────────────────────────────────
COUNTS="$(node -e '
const fs = require("node:fs");
let executed = 0, skipped = 0, ok = true;
try {
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  (function walk(suites) {
    for (const su of suites || []) {
      for (const sp of su.specs || []) {
        for (const t of sp.tests || []) {
          const ran = (t.results || []).some(r => r.status && r.status !== "skipped");
          if (ran) executed++; else skipped++;
        }
      }
      walk(su.suites);
    }
  })(j.suites);
} catch { ok = false; }
console.log(ok ? executed + " " + skipped : "-1 -1");
' "$RESULTS_JSON")"

EXECUTED="${COUNTS%% *}"
SKIPPED="${COUNTS##* }"
rm -f "$RESULTS_JSON"

if [ "$EXECUTED" = "-1" ]; then
  # The run produced no parseable result JSON. If the run itself already failed,
  # surface that. If it "passed", we still cannot confirm a single test ran —
  # unknown is never green.
  if [ "$RUN_STATUS" -eq 0 ]; then
    echo "::error::${LABEL}: run produced no parseable result JSON — cannot confirm any test executed. Unknown is never green."
    echo "- ❌ **${LABEL}** — result JSON unparseable (executed count unknown)" >> "$SUMMARY"
    exit 1
  fi
  echo "- ❌ **${LABEL}** — run failed (exit ${RUN_STATUS})" >> "$SUMMARY"
  exit "$RUN_STATUS"
fi

if [ "$EXECUTED" -eq 0 ]; then
  echo "::error::${LABEL}: discovered ${COUNT} test(s) but executed 0 — every test was skipped. A precondition was not met; an all-skipped gate step is not green."
  echo "- ❌ **${LABEL}** — discovered **${COUNT}**, executed **0**, skipped **${SKIPPED}** (all-skipped: precondition unmet)" >> "$SUMMARY"
  exit 1
fi

echo "${LABEL}: discovered ${COUNT}, executed ${EXECUTED}, skipped ${SKIPPED}"
echo "- **${LABEL}** — discovered **${COUNT}**, executed **${EXECUTED}**, skipped **${SKIPPED}**" >> "$SUMMARY"

exit "$RUN_STATUS"
