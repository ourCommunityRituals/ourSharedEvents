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
# The post-run JSON is obtained via PLAYWRIGHT_JSON_OUTPUT_NAME. Playwright's
# json reporter takes the config `outputFile` OVER this env var (env-var-wins
# was wrong — CI proved it, OSE-1170), so the env var cannot override a config
# from outside. Each guarded config therefore wires its json `outputFile` to
# `process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || '<default>'`, making the config
# value BE this temp file when we set it while leaving html/junit/line intact.
# A guarded config that does not honor the env var would write its result JSON
# elsewhere and this guard would false-red a green run — the ci-gate0-discovery
# class-invariant locks the wiring in.
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
SKIPPED_NAMES="$(mktemp)"
trap 'rm -f "$RESULTS_JSON" "$SKIPPED_NAMES"' EXIT
export PLAYWRIGHT_JSON_OUTPUT_NAME="$RESULTS_JSON"

npx playwright test "$@"
RUN_STATUS=$?

# ── Gate 0b: executed count (post-run) ──────────────────────────────────────
# Also collects the titles of skipped specs into SKIPPED_NAMES so Gate 0c can
# print WHAT was skipped, not just how many (OSE-834 Fix step 3).
COUNTS="$(SKIPPED_NAMES_FILE="$SKIPPED_NAMES" node -e '
const fs = require("node:fs");
let executed = 0, skipped = 0, ok = true;
const names = [];
try {
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  (function walk(suites) {
    for (const su of suites || []) {
      for (const sp of su.specs || []) {
        for (const t of sp.tests || []) {
          const ran = (t.results || []).some(r => r.status && r.status !== "skipped");
          if (ran) executed++;
          else { skipped++; if (sp.title) names.push((sp.file ? sp.file + " > " : "") + sp.title); }
        }
      }
      walk(su.suites);
    }
  })(j.suites);
} catch { ok = false; }
if (ok && names.length && process.env.SKIPPED_NAMES_FILE) {
  try { fs.writeFileSync(process.env.SKIPPED_NAMES_FILE, names.join("\n")); } catch {}
}
console.log(ok ? executed + " " + skipped : "-1 -1");
' "$RESULTS_JSON")"

EXECUTED="${COUNTS%% *}"
SKIPPED="${COUNTS##* }"

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

# ── Gate 0c: skipped-ratio ceiling (OSE-834) ────────────────────────────────
# Gate 0b already failed an ALL-skipped step; this catches a MOSTLY-skipped one.
# When PW_MAX_SKIP_RATIO is set (e.g. 0.2), a step whose skipped share exceeds it
# goes red even though ≥1 test executed — on a seeded environment a high skip
# share is an unmet-precondition / fixture gap, not a pass. Unset = no ceiling
# (backward compatible; the default guard behaviour is unchanged). A ratio outside
# [0,1] fails closed: a misconfigured ceiling must never silently pass a run.
if [ -n "${PW_MAX_SKIP_RATIO:-}" ]; then
  VERDICT="$(EXECUTED="$EXECUTED" SKIPPED="$SKIPPED" MAX="$PW_MAX_SKIP_RATIO" node -e '
    const e = +process.env.EXECUTED, s = +process.env.SKIPPED, m = Number(process.env.MAX);
    if (!Number.isFinite(m) || m < 0 || m > 1) { console.log("BADMAX 0"); process.exit(0); }
    const total = e + s, ratio = total ? s / total : 0;
    console.log((ratio > m ? "OVER " : "OK ") + ratio.toFixed(3));
  ')"
  VERD="${VERDICT%% *}"
  RATIO="${VERDICT##* }"
  if [ "$VERD" = "BADMAX" ]; then
    echo "::error::${LABEL}: PW_MAX_SKIP_RATIO='${PW_MAX_SKIP_RATIO}' is not a number in [0,1]. A misconfigured skip ceiling fails closed."
    echo "- ❌ **${LABEL}** — PW_MAX_SKIP_RATIO='${PW_MAX_SKIP_RATIO}' not in [0,1] (fail-closed)" >> "$SUMMARY"
    exit 1
  fi
  if [ "$VERD" = "OVER" ]; then
    echo "::error::${LABEL}: skip ratio ${RATIO} (skipped ${SKIPPED} of $((EXECUTED + SKIPPED))) exceeds PW_MAX_SKIP_RATIO=${PW_MAX_SKIP_RATIO}. Too many preconditions unmet — not a pass."
    echo "- ❌ **${LABEL}** — skip ratio **${RATIO}** > ${PW_MAX_SKIP_RATIO} (skipped **${SKIPPED}** of $((EXECUTED + SKIPPED)))" >> "$SUMMARY"
    if [ -s "$SKIPPED_NAMES" ]; then
      echo "${LABEL}: skipped specs:"
      sed 's/^/  - /' "$SKIPPED_NAMES"
    fi
    exit 1
  fi
  echo "${LABEL}: skip ratio ${RATIO} within PW_MAX_SKIP_RATIO=${PW_MAX_SKIP_RATIO}"
fi

exit "$RUN_STATUS"
