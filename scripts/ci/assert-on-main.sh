#!/usr/bin/env bash
# Refuse to ship a commit that is not on main (OSE-1662).
#
# deploy-production runs on any `v*.*.*` tag push or a manual dispatch, from any
# branch. Without this check a tag on a side branch ships whatever that branch
# holds. A release tag on main passes, including one on an older main commit.
#
# Reads only the local repository: the job checks out with fetch-depth: 0, so
# origin/main and the commit's history are both present. No network, no
# credential. Fails closed: if main or the commit cannot be read, it refuses.
#
#   SHIP_SHA  commit to be shipped (default: HEAD)
#   MAIN_REF  the main branch as checked out (default: origin/main)
#
# Exit 0: the commit is on main. Exit 1: it is not, or it cannot be checked.
# Held in place by tests/integration/assert-on-main-wired.test.js.

set -euo pipefail

SHIP_SHA="${SHIP_SHA:-HEAD}"
MAIN_REF="${MAIN_REF:-origin/main}"

if ! main_sha="$(git rev-parse --verify --quiet "${MAIN_REF}^{commit}")"; then
  echo "::error title=Cannot check the commit is on main::${MAIN_REF} is not in this checkout, so nothing ships. The checkout needs fetch-depth: 0."
  exit 1
fi

if ! ship_sha="$(git rev-parse --verify --quiet "${SHIP_SHA}^{commit}")"; then
  echo "::error title=Cannot check the commit is on main::${SHIP_SHA} is not a commit in this checkout, so nothing ships."
  exit 1
fi

if git merge-base --is-ancestor "$ship_sha" "$main_sha"; then
  echo "ON MAIN: ${ship_sha} is on ${MAIN_REF} (${main_sha})."
  exit 0
fi

echo "::error title=Not on main::${ship_sha} is not on ${MAIN_REF} (${main_sha}). Production ships only commits that are on main. Tag a commit on main, or merge this one first."
exit 1
