#!/usr/bin/env bash
# install-playwright-browsers.sh — install Playwright browsers and their system
# packages without letting a slow Ubuntu mirror decide the job.
#
#   bash scripts/ci/install-playwright-browsers.sh chromium [webkit]
#
# `playwright install --with-deps` asks apt for the system packages a browser
# needs. For WebKit on ubuntu-24.04 that is 181 packages, 126 MB, from the
# runner's mirror (azure.archive.ubuntu.com). On 2026-10-07 that mirror served
# them at 30-100 kB/s: T0 Gate (component) was cancelled at its 15 minute
# ceiling and the phone audit timed out twice, all before a test started.
#
# Three steps, in order:
#   1. Restore. Package files saved by an earlier run (actions/cache restores
#      $PW_APT_CACHE_DIR) are copied into apt's own cache, so apt downloads only
#      what the mirror has updated since. apt checks each file against the
#      signed index before using it.
#   2. Download, with a limit. apt runs in download-only mode, so it can be
#      stopped at any point without leaving a half-installed package. The first
#      attempt uses the runner's mirror. If it does not finish in time, the slow
#      mirror is dropped from the runner's mirror list and the next attempt uses
#      the mirror listed after it; files already downloaded are kept. If no
#      attempt finishes, the script fails and says the mirror was the cause.
#      The downloaded files are then copied back to $PW_APT_CACHE_DIR.
#   3. Install. The same `playwright install --with-deps` as before; every
#      package file is already on disk.
#
# PW_APT_ATTEMPT_SECONDS: one limit per download attempt (default "150 150").
# Exit 0 installed, 1 the packages could not be downloaded in time, 2 bad usage.

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "::error::usage: install-playwright-browsers.sh <browser>..."
  exit 2
fi

PW_BIN="${PW_BIN:-node_modules/.bin/playwright}"
CACHE="${PW_APT_CACHE_DIR:-$HOME/.cache/pw-apt-archives}"
ARCHIVES="${PW_APT_ARCHIVES_DIR:-/var/cache/apt/archives}"
MIRRORS="${PW_APT_MIRRORS_FILE:-/etc/apt/apt-mirrors.txt}"
PREFETCH_CONF="${PW_APT_CONF_DIR:-/etc/apt/apt.conf.d}/99-playwright-prefetch"
SLOW_MIRROR="${PW_APT_SLOW_MIRROR:-azure.archive.ubuntu.com}"
read -r -a LIMITS <<< "${PW_APT_ATTEMPT_SECONDS:-150 150}"
# Unset means sudo; set but empty means "already root" (and the tests).
SUDO="${PW_SUDO-sudo}"

# Not an apt machine: there is no mirror to wait for.
if ! command -v apt-get > /dev/null 2>&1; then
  exec "$PW_BIN" install --with-deps "$@"
fi

count_debs() { find "$1" -maxdepth 1 -name '*.deb' 2> /dev/null | wc -l | tr -d ' '; }

# Drop the slow mirror from the list, but only when another one is listed.
use_next_mirror() {
  [ -f "$MIRRORS" ] || return 1
  grep -qF -- "$SLOW_MIRROR" "$MIRRORS" || return 1
  grep -vF -- "$SLOW_MIRROR" "$MIRRORS" | grep -q . || return 1
  $SUDO sed -i "/$SLOW_MIRROR/d" "$MIRRORS"
}

# ── 1. Restore ───────────────────────────────────────────────────────────────
mkdir -p "$CACHE"
restored="$(count_debs "$CACHE")"
if [ "$restored" -gt 0 ]; then
  $SUDO cp "$CACHE"/*.deb "$ARCHIVES"/
fi
echo "System packages restored from cache: $restored"

# ── 2. Download, with a limit ────────────────────────────────────────────────
remove_prefetch_conf() { $SUDO rm -f "$PREFETCH_CONF"; }
trap remove_prefetch_conf EXIT
echo 'APT::Get::Download-Only "true";' | $SUDO tee "$PREFETCH_CONF" > /dev/null

downloaded=''
attempt=0
for limit in "${LIMITS[@]}"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 1 ]; then
    if use_next_mirror; then
      echo "Dropped $SLOW_MIRROR from $MIRRORS; attempt $attempt uses the next mirror listed."
    else
      echo "No other mirror is listed in $MIRRORS; attempt $attempt uses the same one."
    fi
  fi
  started=$SECONDS
  rc=0
  # As root, so `timeout` can stop apt (Playwright would otherwise start it
  # through its own sudo, out of reach). PATH is passed for node.
  $SUDO env "PATH=$PATH" timeout --kill-after=10 "$limit" "$PW_BIN" install-deps "$@" || rc=$?
  took=$((SECONDS - started))
  if [ "$rc" -eq 0 ]; then
    downloaded=1
    echo "System packages downloaded in ${took}s (attempt $attempt of ${#LIMITS[@]})"
    break
  fi
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    echo "::warning::System package download did not finish in ${limit}s (attempt $attempt of ${#LIMITS[@]})."
  else
    echo "::warning::System package download failed with exit $rc after ${took}s (attempt $attempt of ${#LIMITS[@]})."
  fi
done
remove_prefetch_conf

if [ -z "$downloaded" ]; then
  echo "::error title=Ubuntu package mirror too slow::The system packages for '$*' were not downloaded in ${#LIMITS[@]} attempts (limits: ${LIMITS[*]} seconds). No test ran. The cause is the runner's package mirror, not this change: re-run the job."
  exit 1
fi

# Keep only files the index still lists, then save them for the next run.
$SUDO apt-get autoclean
rm -f "$CACHE"/*.deb
saved="$(count_debs "$ARCHIVES")"
if [ "$saved" -gt 0 ]; then
  cp "$ARCHIVES"/*.deb "$CACHE"/
fi
echo "System packages saved to cache: $saved"

# ── 3. Install ───────────────────────────────────────────────────────────────
started=$SECONDS
"$PW_BIN" install --with-deps "$@"
echo "Browsers and system packages installed in $((SECONDS - started))s"
