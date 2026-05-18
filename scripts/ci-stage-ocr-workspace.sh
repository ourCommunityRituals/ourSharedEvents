#!/usr/bin/env bash
# Stage the adjacent @ocr/flags package at the path OSE's package.json
# expects (`file:../packages/flags`). On the self-hosted runner
# GITHUB_WORKSPACE lands at _work/ourSharedEvents/ourSharedEvents/, so
# `../packages/flags` resolves to _work/ourSharedEvents/packages/flags/ —
# the destination populated below.
#
# Idempotent: clones on first run, fast-forwards on subsequent runs.
# Cache directory (_ocr-workspace-cache) is one level above the OSE
# checkout; survives `clean: false` checkouts within the same runner.
#
# ── CREDENTIAL-FAILURE TOLERANCE (OSE-347, 2026-05-18) ─────────────────────
# When the runner's git credential cache is broken (the OSE-341 problem),
# the fetch step fails with `fatal: Unable to persist credentials with the
# 'wincredman' credential store`. Before this story, that aborted the
# entire pipeline. After OSE-347: if the local cache exists AND the fetch
# fails, the script falls back to using the existing cache as-is (stale
# but functional). The pipeline continues; a LOUD WARNING is printed so
# the operator knows OSE-341 is still pending. The cache's most recent
# commit is logged so reviewers can spot drift.
#
# The fallback does NOT apply to the first-clone case — without an
# existing cache there's nothing to fall back to, and the script must
# fail. New runners (or wiped caches) require OSE-341's auth model to
# be in place.
#
# Follow-up: publish @ocr/flags to a private GitHub Packages registry
# to eliminate the file: dance entirely. Until then, this script keeps
# CI jobs honest about the cross-repo dependency.
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail

WS_CACHE="${GITHUB_WORKSPACE:-$(pwd)}/../_ocr-workspace-cache"
TARGET_PARENT="${GITHUB_WORKSPACE:-$(pwd)}/../packages"
SOURCE_REPO="${OCR_WORKSPACE_REPO:-https://github.com/ourCommunityRituals/ourCommunityRituals.git}"

if [ ! -d "$WS_CACHE/.git" ]; then
  echo "[stage] cloning $SOURCE_REPO into $WS_CACHE"
  if ! git clone --depth 1 "$SOURCE_REPO" "$WS_CACHE"; then
    echo "[stage] ============================================================" >&2
    echo "[stage] ERROR: initial clone failed and no cache to fall back to" >&2
    echo "[stage] ============================================================" >&2
    echo "[stage] likely cause: runner lacks credentials for $SOURCE_REPO" >&2
    echo "[stage] fix: land OSE-341 (workspace token via repo secret)." >&2
    echo "[stage]      runner-machine cred priming is a temporary workaround only." >&2
    exit 1
  fi
else
  echo "[stage] updating existing clone at $WS_CACHE"
  # OSE-347: tolerate fetch failure when an existing cache is available.
  # If fetch + reset both succeed, we got fresh code (the happy path). If
  # either fails, we keep the existing cache and warn loudly. set -e is
  # suppressed inside the `if cmd && cmd; then` pattern, so failures here
  # do not abort the script — they fall through to the else branch.
  if git -C "$WS_CACHE" fetch --depth 1 origin main && \
     git -C "$WS_CACHE" reset --hard origin/main; then
    echo "[stage] cache updated from origin main"
  else
    echo "[stage] ============================================================"
    echo "[stage] WARNING: fetch from origin failed — using existing cache as-is"
    echo "[stage] ============================================================"
    echo "[stage] likely cause: runner lacks valid credentials for $SOURCE_REPO"
    echo "[stage] (wincredman / GCM cache empty — the OSE-341 determinism gap)"
    echo "[stage]"
    echo "[stage] FALLBACK BEHAVIOR: using cached clone without updating."
    echo "[stage] @ocr/flags will be at whatever version was cached on this"
    echo "[stage] runner the last time the fetch succeeded. This is STALE —"
    echo "[stage] acceptable only because @ocr/flags is intentionally stable"
    echo "[stage] per ADR-012 (build-time consumption, manually-synced module)."
    echo "[stage]"
    echo "[stage] cache's most recent commit:"
    git -C "$WS_CACHE" log --oneline -1 2>&1 || echo "[stage] (could not read cache log)"
    echo "[stage] ============================================================"
    echo "[stage] To restore fresh-fetch capability: land OSE-341 (auth determinism)."
    echo "[stage] ============================================================"
  fi
fi

if [ ! -d "$WS_CACHE/packages/flags" ]; then
  echo "[stage] ERROR: $WS_CACHE/packages/flags missing — even fallback cache lacks the package" >&2
  exit 1
fi

mkdir -p "$TARGET_PARENT"
rm -rf "$TARGET_PARENT/flags"
cp -r "$WS_CACHE/packages/flags" "$TARGET_PARENT/flags"
echo "[stage] @ocr/flags available at $TARGET_PARENT/flags"
