#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Post-execution injection detector — the object whose job is to go red (OSE-1056).
#
# WHY THIS EXISTS
#   During the execution phase (Gates 2-3: deploy + tests run untrusted code, npm
#   installs, Playwright, etc.) something could inject a backdoor into the working
#   tree. This script is the assertion that nothing did: it runs the S2 integrity
#   checks against the PRESERVED post-execution workspace.
#
# THE TRAP IT AVOIDS (proven in tests/unit/security/post-execution-integrity.test.js)
#   `actions/checkout@v7` runs `git checkout --force <sha>`, which RESETS tracked
#   files and lockfiles to the committed SHA — ERASING any tracked-file mutation or
#   lockfile tamper BEFORE a `git diff` could see it. So the caller MUST run this
#   against the workspace the execution phase left behind, WITHOUT a fresh checkout
#   in the same job. If you add `actions/checkout` before this, checks 1 & 3 go
#   vacuously green and the detector stops detecting. That regression is locked by
#   the born-red test above.
#
# CONTRACT
#   CWD = repo root of the preserved post-execution workspace.
#   Exits 0 iff no injection detected; non-zero (with ::error::) on any of:
#     1. a tracked source file mutated during execution
#     2. an untracked file injected under src/ or migrations/
#     3. package-lock.json changed (dependency drift / supply-chain injection)
#   Contract-bearing paths are parameterized (reconciliation-grade) so the born-red
#   test drives the SAME code the workflow runs.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

# Space-separated pathspecs; override in tests via env.
SRC_DIRS="${OCR_INTEGRITY_SRC_DIRS:-workers/oursharedevents/src workers/oursharedevents/migrations}"
LOCKFILES="${OCR_INTEGRITY_LOCKFILES:-package-lock.json workers/oursharedevents/package-lock.json}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

fail=0

# Guard: refuse to run in a re-checked-out / non-workspace context. If HEAD isn't
# resolvable we cannot compare, so FAIL CLOSED rather than pass silently.
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "::error::No git workspace present — cannot verify post-execution integrity (fail-closed)."
  exit 2
fi

echo "## S2 Post-Execution Integrity" >> "$SUMMARY"

# ── Check 1: no tracked source mutated during execution ──────────────────────
if git diff --exit-code --stat >/dev/null 2>&1; then
  echo "- **Tracked-source integrity:** clean (no post-execution mutation)" >> "$SUMMARY"
else
  echo "::error::Tracked source files were modified during the execution phase (Gates 2-3). Possible injection."
  git diff --stat || true
  echo "- **Tracked-source integrity:** ❌ MUTATED (possible injection)" >> "$SUMMARY"
  fail=1
fi

# ── Check 2: no files injected under src/ or migrations/ ─────────────────────
INJECTED=$(git ls-files --others --exclude-standard -- $SRC_DIRS 2>/dev/null || true)
if [ -n "$INJECTED" ]; then
  echo "::error::Untracked files appeared under src/ or migrations/ during execution. Possible injection:"
  echo "$INJECTED"
  echo "- **No injected source/migration files:** ❌ INJECTED" >> "$SUMMARY"
  fail=1
else
  echo "- **No injected source/migration files:** confirmed" >> "$SUMMARY"
fi

# ── Check 3: lockfile unchanged ──────────────────────────────────────────────
if git diff --exit-code -- $LOCKFILES >/dev/null 2>&1; then
  echo "- **Lockfile integrity:** unchanged" >> "$SUMMARY"
else
  echo "::error::A lockfile changed during the run — dependency drift / possible supply-chain injection."
  git diff --stat -- $LOCKFILES || true
  echo "- **Lockfile integrity:** ❌ CHANGED" >> "$SUMMARY"
  fail=1
fi

exit $fail
