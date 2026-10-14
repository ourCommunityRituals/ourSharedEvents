#!/usr/bin/env bash
# Stage the hub's shared packages next to the OSE checkout, at the ONE hub
# commit this repo is pinned to (ADR-008 Phase 0).
#
#   @ocr/ui     REQUIRED    -> $GITHUB_WORKSPACE/../packages/ui
#                              (workers/oursharedevents/package.json:
#                               "@ocr/ui": "file:../../../packages/ui")
#   @ocr/flags  best-effort -> $GITHUB_WORKSPACE/../packages/flags
#                              (root package.json: "file:../packages/flags")
#
# ── PIN (ADR-008 Phase 0, 2026-09-29) ───────────────────────────────────────
# @ocr/ui used to live in this repo as packages/ui — a fork of the hub copy.
# It now lives ONLY in the hub (ourCommunityRituals/ourCommunityRituals,
# packages/ui), and this repo consumes exactly the hub commit named in
# `.ocr-hub-ref` (a full 40-hex SHA). The script fetches THAT commit and checks
# it out detached. It never tracks origin/main: a hub change reaches OSE only
# when a PR here bumps `.ocr-hub-ref`, so the design system this repo builds,
# tests and deploys is reviewable and reproducible.
#
# Because the Worker bundles @ocr/ui (partials, /ui.css, tokens), a run that
# cannot stage the pinned @ocr/ui cannot build or test the Worker. So @ocr/ui
# staging FAILS the step with an ::error:: annotation and exit 1, and call
# sites for jobs that install/build/test/deploy the Worker must NOT mark this
# step continue-on-error. (@ocr/flags keeps its historical best-effort
# posture: a missing packages/flags in the pinned hub commit only warns.)
#
# ── CACHE ───────────────────────────────────────────────────────────────────
# The hub clone lives in _ocr-workspace-cache, one level above the checkout
# (outside what actions/checkout cleans). Hosted runners are fresh per job;
# the cache matters for local and future reuse. OSE-347's stale-cache
# fallback survives in pinned form: if the fetch fails but the cache ALREADY
# contains the pinned commit, that commit is used (it is by definition the
# right content). A cache that lacks the pinned commit is never used.
#
# ── WORKSPACE TOKEN AUTH (OSE-341, 2026-09-20) ──────────────────────────────
# Every job starts with zero git credentials for the private hub repo. Call
# sites pass the read-only org secret OCR_HUB_READ (Contents read on the hub
# and OCR-docs; the same secret the hub / OCR-docs checkouts use, OSE-1695) as
# an env var of the same name. There is deliberately NO fallback to the old
# variable name OCR_PROPAGATE_TOKEN (the write-capable PAT): if only that is
# set, the script runs unauthenticated and fails like a missing token. When
# OCR_HUB_READ is present, it authenticates the fetch
# via a transient `-c http.extraheader=...` — never a token embedded in the
# remote URL, so it is never written to $WS_CACHE/.git/config at rest (same
# posture as conformance-report.yml's `persist-credentials: false`). When it
# is absent (a step that does not set it; a Dependabot run reads it from the
# Dependabot secret of the same name, never from Actions secrets) the fetch
# is attempted unauthenticated, which fails for the private hub — and, since
# @ocr/ui is now required, the step fails with an ::error:: naming the cause.
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail

WORKSPACE="${GITHUB_WORKSPACE:-$(pwd)}"
WS_CACHE="$WORKSPACE/../_ocr-workspace-cache"
TARGET_PARENT="$WORKSPACE/../packages"
SOURCE_REPO="${OCR_WORKSPACE_REPO:-https://github.com/ourCommunityRituals/ourCommunityRituals.git}"
REF_FILE="$WORKSPACE/.ocr-hub-ref"

fail() {
  # $1 = short title, $2 = detail. Annotation + non-zero exit: @ocr/ui is required.
  echo "::error title=@ocr/ui staging failed (ADR-008 pin)::$2"
  echo "[stage] FATAL: $1" >&2
  exit 1
}

[ -f "$REF_FILE" ] || fail "no pin file" "$REF_FILE is missing — this repo must pin the hub commit it consumes @ocr/ui from."
REF="$(tr -d '[:space:]' < "$REF_FILE")"
[[ "$REF" =~ ^[0-9a-f]{40}$ ]] || fail "bad pin" ".ocr-hub-ref must hold a full 40-hex hub commit SHA (got '$REF')."
echo "[stage] hub pin: $REF (from .ocr-hub-ref)"

# Transient auth: only ever passed as a per-invocation `-c` override, never
# persisted into $WS_CACHE/.git/config. Empty array (no auth) when the token
# env var isn't set.
AUTH_ARGS=()
if [ -n "${OCR_HUB_READ:-}" ]; then
  AUTH_HEADER="AUTHORIZATION: basic $(printf '%s' "x-access-token:${OCR_HUB_READ}" | base64 | tr -d '\n')"
  AUTH_ARGS=(-c "http.extraheader=${AUTH_HEADER}")
fi

if [ ! -d "$WS_CACHE/.git" ]; then
  echo "[stage] initialising hub cache at $WS_CACHE"
  rm -rf "$WS_CACHE"
  git init -q "$WS_CACHE"
  git -C "$WS_CACHE" remote add origin "$SOURCE_REPO"
else
  git -C "$WS_CACHE" remote set-url origin "$SOURCE_REPO"
fi

echo "[stage] fetching $REF from $SOURCE_REPO"
if git -C "$WS_CACHE" ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} fetch -q --depth 1 origin "$REF" && \
   git -C "$WS_CACHE" -c advice.detachedHead=false checkout -q --force --detach FETCH_HEAD; then
  echo "[stage] checked out pinned hub commit"
elif git -C "$WS_CACHE" cat-file -e "${REF}^{commit}" 2>/dev/null && \
     git -C "$WS_CACHE" -c advice.detachedHead=false checkout -q --force --detach "$REF"; then
  echo "::warning title=hub fetch failed — using cached pinned commit::fetch of $REF failed, but the local cache already holds that exact commit, so it was used."
else
  if [ -z "${OCR_HUB_READ:-}" ]; then
    CAUSE="OCR_HUB_READ is not available in this run context (the step must set env OCR_HUB_READ from secrets.OCR_HUB_READ), so the fetch from the private hub was unauthenticated"
  else
    CAUSE="OCR_HUB_READ is present but the fetch still failed (revoked/expired token, network error, token lacks access to $SOURCE_REPO, or the pinned commit does not exist on the hub)"
  fi
  fail "could not fetch pinned hub commit" "could not fetch hub commit $REF (.ocr-hub-ref) from $SOURCE_REPO: $CAUSE. The Worker cannot be built or tested without the pinned @ocr/ui."
fi

HEAD_SHA="$(git -C "$WS_CACHE" rev-parse HEAD)"
[ "$HEAD_SHA" = "$REF" ] || fail "pin mismatch" "hub cache HEAD is $HEAD_SHA, expected pinned $REF."
echo "[stage] hub HEAD = $HEAD_SHA ($(git -C "$WS_CACHE" log -1 --format=%s 2>/dev/null || echo '?'))"

# ── MERGED-ONLY (OSE-1394, CCR OSE-1393 H1) ─────────────────────────────────
# `git fetch <sha>` also serves commits that exist only on unmerged hub
# branches or refs/pull/*/head, so a 40-hex pin proves nothing about review.
# (It happened: a39acc6 pinned 14f3ed71, a PR-branch commit never on hub
# main.) Require the pin to be an ancestor of hub main. The main fetch is
# blobless (commit graph only), so it stays cheap.
HUB_MAIN="${OCR_HUB_MAIN_BRANCH:-main}"
if git -C "$WS_CACHE" ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} fetch -q --filter=blob:none origin \
     "+refs/heads/$HUB_MAIN:refs/remotes/origin/$HUB_MAIN"; then
  git -C "$WS_CACHE" merge-base --is-ancestor "$REF" "refs/remotes/origin/$HUB_MAIN" || \
    fail "pin not on hub $HUB_MAIN" "hub commit $REF (.ocr-hub-ref) is not reachable from hub $HUB_MAIN — pin only merged hub commits (an unmerged branch or PR commit is unreviewed and can be garbage-collected)."
  echo "[stage] pin is on hub $HUB_MAIN"
elif [ -z "${GITHUB_ACTIONS:-}" ]; then
  echo "::warning title=pin ancestry unverified::could not fetch hub $HUB_MAIN (local run) — ancestry of $REF not checked."
else
  fail "could not fetch hub $HUB_MAIN" "could not fetch hub $HUB_MAIN from $SOURCE_REPO to verify $REF is merged."
fi

mkdir -p "$TARGET_PARENT"

[ -f "$WS_CACHE/packages/ui/package.json" ] || fail "pinned hub has no @ocr/ui" "hub commit $REF has no packages/ui/package.json — bump .ocr-hub-ref to a hub commit that carries @ocr/ui."
rm -rf "$TARGET_PARENT/ui"
cp -r "$WS_CACHE/packages/ui" "$TARGET_PARENT/ui"
echo "[stage] @ocr/ui available at $TARGET_PARENT/ui (hub $REF)"

if [ -d "$WS_CACHE/packages/flags" ]; then
  rm -rf "$TARGET_PARENT/flags"
  cp -r "$WS_CACHE/packages/flags" "$TARGET_PARENT/flags"
  echo "[stage] @ocr/flags available at $TARGET_PARENT/flags (hub $REF)"
else
  echo "::warning title=@ocr/flags staging skipped (OSE-341)::hub commit $REF has no packages/flags. npm ci is documented to tolerate @ocr/flags' absence, so this run continues without it."
fi
