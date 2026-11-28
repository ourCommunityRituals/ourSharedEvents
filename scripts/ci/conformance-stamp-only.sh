#!/usr/bin/env bash
# Exit 0 when the working-tree change to the conformance report is only its
# stamp (date, commit, run link), so no refresh PR is opened for it.
# Exit 1 when any other line changed (a real coverage change).
# Every merge to main moves the stamp, so without this check each merge that
# touches a spec opened a refresh PR that changed nothing but the stamp, and
# two close merges raced on the one refresh branch (PR 1617, 28 Nov 2026).
set -euo pipefail
RPT="${1:?usage: conformance-stamp-only.sh <report dir>}"
changed=$(git diff -U0 -- "$RPT/CONFORMANCE.md" "$RPT/conformance.json" \
  | grep -E '^[+-]' \
  | grep -vE '^(\+\+\+|---) ' \
  | grep -vE '^[+-]> \*\*Generated:\*\* ' \
  | grep -vE '^[+-][[:space:]]*"(generated_at|commit|run_url)":' \
  || true)
[ -z "$changed" ]
