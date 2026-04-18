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
# Follow-up: publish @ocr/flags to a private GitHub Packages registry
# to eliminate the file: dance entirely. Until then, this script keeps
# CI jobs honest about the cross-repo dependency.
set -euo pipefail

WS_CACHE="${GITHUB_WORKSPACE:-$(pwd)}/../_ocr-workspace-cache"
TARGET_PARENT="${GITHUB_WORKSPACE:-$(pwd)}/../packages"
SOURCE_REPO="${OCR_WORKSPACE_REPO:-https://github.com/ourCommunityRituals/ourCommunityRituals.git}"

if [ ! -d "$WS_CACHE/.git" ]; then
  echo "[stage] cloning $SOURCE_REPO into $WS_CACHE"
  git clone --depth 1 "$SOURCE_REPO" "$WS_CACHE"
else
  echo "[stage] updating existing clone at $WS_CACHE"
  git -C "$WS_CACHE" fetch --depth 1 origin main
  git -C "$WS_CACHE" reset --hard origin/main
fi

if [ ! -d "$WS_CACHE/packages/flags" ]; then
  echo "[stage] ERROR: $WS_CACHE/packages/flags missing after clone" >&2
  exit 1
fi

mkdir -p "$TARGET_PARENT"
rm -rf "$TARGET_PARENT/flags"
cp -r "$WS_CACHE/packages/flags" "$TARGET_PARENT/flags"
echo "[stage] @ocr/flags available at $TARGET_PARENT/flags"
