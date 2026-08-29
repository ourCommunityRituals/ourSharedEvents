#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Fail-closed Playwright runner — OSE-852 (MINE-0) Gate 0.
#
# A Playwright step that discovers zero tests is indistinguishable, from the
# outside, from a step whose tests all passed. That is the failure mode this
# guard exists to remove: discovery is counted BEFORE the run, a zero count is
# a hard error, and the count is published so a regression to zero is visible
# rather than inferred.
#
# The count is taken from `--list --reporter=json` rather than parsing human
# output, so it does not break when Playwright changes its summary formatting.
# A list that cannot be parsed is treated as failure, not as zero and not as
# success — unknown is never green.
#
# Usage:  PW_LABEL='T4e: Attendee Arc' scripts/pw-guarded.sh --config=<cfg> <paths...>
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

LABEL="${PW_LABEL:-playwright}"

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
  echo "- ❌ **${LABEL}** — discovery unparseable" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  exit 1
fi

if [ "$COUNT" -eq 0 ]; then
  echo "::error::${LABEL}: discovered 0 tests and would have exited green. Args: $*"
  echo "::error::A test runner that finds nothing is an error, not a pass. Check that the positional paths lie inside the config's testDir."
  echo "- ❌ **${LABEL}** — discovered **0** tests (Gate 0 failure)" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  exit 1
fi

echo "${LABEL}: discovered tests: ${COUNT}"
echo "- **${LABEL}** — discovered tests: **${COUNT}**" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

npx playwright test "$@"
