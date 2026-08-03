#!/usr/bin/env bash
# check-cross-repo-imports.sh
#
# Enforces Invariant #22 (Cross-Repo Import Isolation — security_isolation
# group, order 6): no module-level imports may cross the OSE / WKRP / OAW
# repo boundary. The ONLY permitted cross-repo coupling is the OER aggregation
# boundary HTTP API seam at GET /api/events/:id/music (WKRP → OSE).
#
# Called from brain-contract-check.yml. Exits 1 on any violation.
#
# Permitted patterns (not violations):
#   - URL strings: https://ourwkrp.com, https://oursharedevents.com (fetch calls, CORS)
#   - Content strings: human-readable mentions of other products
#
# Prohibited patterns (violations):
#   - import ... from '@ourwkrp/...'
#   - import ... from '@oursharedevents/...'
#   - import ... from '@ourairwaves/...'
#   - require('ourwkrp/...'), require('oursharedevents/...')
#   - Any file: or workspace: path pointing to a sibling product repo

set -euo pipefail

REPO_ROOT="${1:-$(git rev-parse --show-toplevel)}"
SRC_DIR="$REPO_ROOT/workers"
VIOLATIONS=0

echo "=== Invariant #22 Cross-Repo Import Isolation Gate ==="
echo "Scanning: $SRC_DIR"
echo ""

# Patterns that indicate a cross-repo module import (not URL strings)
# Uses word-boundary-aware patterns to avoid false positives on URL strings
PROHIBITED_PATTERNS=(
  "from ['\"]@ourwkrp/"
  "from ['\"]@oursharedevents/"
  "from ['\"]@ourairwaves/"
  "require(['\"]ourwkrp/"
  "require(['\"]oursharedevents/"
  "require(['\"]ourairwaves/"
  "from ['\"].*ourwkrp\.com"
  "file:\.\./\.\./ourWKRP"
  "file:\.\./\.\./ourAirwaves"
  "workspace:.*ourWKRP"
  "workspace:.*ourAirwaves"
)

for pattern in "${PROHIBITED_PATTERNS[@]}"; do
  matches=$(grep -rn -E "$pattern" "$SRC_DIR" --include="*.ts" --include="*.js" --include="*.mjs" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    echo "VIOLATION — pattern: $pattern"
    echo "$matches"
    echo ""
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

# Also check package.json files for cross-repo dependency declarations
PACKAGE_PATTERNS=(
  "ourwkrp"
  "ourairwaves"
)
PACKAGE_FILES=(
  "$REPO_ROOT/package.json"
  "$REPO_ROOT/workers/oursharedevents/package.json"
)

echo "Checking package.json files for cross-repo dependency entries..."
for pkg_file in "${PACKAGE_FILES[@]}"; do
  if [ ! -f "$pkg_file" ]; then
    continue
  fi
  for pattern in "${PACKAGE_PATTERNS[@]}"; do
    matches=$(grep -n "$pattern" "$pkg_file" 2>/dev/null || true)
    if [ -n "$matches" ]; then
      echo "VIOLATION — cross-repo dep in $pkg_file (pattern: $pattern)"
      echo "$matches"
      echo ""
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done
done

echo ""
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "FAIL — $VIOLATIONS cross-repo isolation violation(s) detected."
  echo ""
  echo "Invariant #22 (Cross-Repo Import Isolation) prohibits module-level imports between"
  echo "OSE, WKRP, and OAW. The only permitted cross-repo coupling is the HTTP"
  echo "API seam at GET /api/events/:id/music (covered by Pact in OSE-423)."
  echo ""
  echo "See docs/security/INVARIANT_22_CROSS_REPO_IMPORT_ISOLATION.md for full spec."
  exit 1
else
  echo "PASS — no cross-repo isolation violations found."
  echo "Invariant #22 (Cross-Repo Import Isolation) is clean."
  exit 0
fi
