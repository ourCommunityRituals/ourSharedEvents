#!/usr/bin/env bash
# scan-artifacts-for-secrets.sh — refuse to upload a CI artifact that carries a
# credential (OSE-1470 / OSE-1499).
#
#   bash scripts/ci/scan-artifacts-for-secrets.sh <path>...
#
# Why: Playwright traces, videos and HTML reports record request headers. The
# staging/production suites send CF-Access-Client-Secret, Authorization: Bearer
# <ADMIN_KEY> and X-OCR-Internal, and mint a CF_Authorization cookie. The
# artifacts are kept 14-90 days and anyone with read access to the repo can
# download them. The configs now turn trace + video off; this scan is the
# backstop that keeps a future config change (or a new reporter) from leaking.
#
# What it looks for, in every file under the given paths:
#   1. the value of each secret env var named in SCAN_SECRET_VARS (default list
#      below) that is set and non-empty, as a fixed string;
#   2. the literal `CF_Authorization=` (a minted Access session cookie);
#   3. `Bearer ` followed by 20+ token characters.
# Archives are opened before scanning: every *.zip (Playwright traces) and the
# base64 zip Playwright embeds in an HTML report's index.html. An archive it
# cannot open fails the scan (fail closed).
#
# Output names only the file and the pattern (the env var NAME for a secret),
# never a value. Exit 0 = clean (or nothing to scan), 1 = a hit or an archive
# that could not be inspected, 2 = usage error.
#
# The workflow passes the secret values through the step's `env:`; they are
# never interpolated into this command line.
set -uo pipefail
set +x # never trace: a traced `grep -- "$v"` would print the value

# ADMIN_TOKEN is the legacy alias src/auth/admin.ts still accepts for ADMIN_KEY.
# The SMOKE_RPT_*_TOKEN values are SharedReport signed links minted at run time
# (scripts/mint-t4-report-tokens.mjs → $GITHUB_ENV) and stay valid for a day.
DEFAULT_SECRET_VARS="ADMIN_KEY ADMIN_TOKEN CF_ACCESS_CLIENT_SECRET X_OCR_INTERNAL STAGING_ADMIN_KEY OSE_ADMIN_BEARER OCR_CI_EDGE_TOKEN SMOKE_RPT_ADMIN_TOKEN SMOKE_RPT_LOCAL_TOKEN SMOKE_RPT_MID_TOKEN SMOKE_RPT_OTHER_EVENT_TOKEN"  # pragma: allowlist secret (variable NAMES only, no values)
SECRET_VARS="${SCAN_SECRET_VARS:-$DEFAULT_SECRET_VARS}"
# A value shorter than this would match by accident (and is not a real secret).
MIN_SECRET_LEN=8

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <path>..." >&2
  exit 2
fi

roots=()
for p in "$@"; do
  if [ -e "$p" ]; then roots+=("$p"); fi
done
if [ "${#roots[@]}" -eq 0 ]; then
  echo "scan-artifacts-for-secrets: none of the given paths exist — nothing to scan"
  exit 0
fi

# The set, non-trivial secret values. Collected up front so every path this
# script prints can be redacted first (a value can be part of a file NAME).
SECRET_NAMES=()
SECRET_VALUES=()
for var in $SECRET_VARS; do
  v="${!var:-}"
  [ -z "$v" ] && continue
  if [ "${#v}" -lt "$MIN_SECRET_LEN" ]; then
    echo "::warning::scan-artifacts-for-secrets: $var is shorter than $MIN_SECRET_LEN chars; not scanned for it"
    continue
  fi
  SECRET_NAMES+=("$var")
  SECRET_VALUES+=("$v")
done
unset v

# redact <text> -> text with every secret value replaced by [REDACTED]
redact() {
  local s="$1" i
  for i in "${!SECRET_VALUES[@]}"; do
    s="${s//"${SECRET_VALUES[$i]}"/[REDACTED]}"
  done
  printf '%s\n' "$s"
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
: >"$work/map" # "<expanded dir>\t<origin file>" per opened archive
failed=0
n=0
opened=0

# origin_of <file under an expanded dir> -> the artifact file it came from
origin_of() {
  local f="$1" dir origin
  while IFS=$'\t' read -r dir origin; do
    case "$f" in
      "$dir"/*) redact "$origin (inside archive)"; return ;;
    esac
  done <"$work/map"
  redact "$f"
}

open_zip() { # open_zip <zip file> <origin label>
  local src="$1" origin="$2" dest rc
  n=$((n + 1))
  dest="$work/x$n"
  mkdir -p "$dest"
  if ! command -v unzip >/dev/null 2>&1; then
    echo "::error::scan-artifacts-for-secrets: unzip not installed, cannot inspect archive: $origin"
    failed=1
    return
  fi
  unzip -qq -o "$src" -d "$dest" >/dev/null 2>&1
  rc=$?
  # unzip exit 1 = warnings only; anything higher means it could not be read.
  if [ "$rc" -gt 1 ]; then
    echo "::error::scan-artifacts-for-secrets: cannot inspect archive: $origin"
    failed=1
  fi
  opened=$((opened + 1))
  printf '%s\t%s\n' "$dest" "$origin" >>"$work/map"
}

# Open archives, including archives found inside archives (bounded depth).
scan_dirs=("${roots[@]}")
pending=("${roots[@]}")
unopened_level=1 # cleared when a level opens nothing new
for _depth in 1 2 3; do
  next=()
  for r in "${pending[@]}"; do
    while IFS= read -r -d '' z; do
      before=$n
      open_zip "$z" "$(origin_of "$z")"
      if [ "$n" -gt "$before" ]; then next+=("$work/x$n"); fi
    done < <(find "$r" -type f -name '*.zip' -print0 2>/dev/null)
    while IFS= read -r -d '' h; do
      n=$((n + 1))
      b64="$work/b64-$n"
      sed -n 's/.*data:application\/zip;base64,\([A-Za-z0-9+\/=]*\).*/\1/p' "$h" | tr -d '\n' >"$b64"
      if [ -s "$b64" ]; then
        if base64 -d "$b64" >"$work/emb-$n.zip" 2>/dev/null; then
          before=$n
          open_zip "$work/emb-$n.zip" "$(origin_of "$h")"
          if [ "$n" -gt "$before" ]; then next+=("$work/x$n"); fi
        else
          echo "::error::scan-artifacts-for-secrets: cannot decode embedded report in: $(origin_of "$h")"
          failed=1
        fi
      fi
    done < <(find "$r" -type f -name '*.html' -print0 2>/dev/null | xargs -0 -r grep -lZ 'data:application/zip;base64,' 2>/dev/null)
  done
  if [ "${#next[@]}" -eq 0 ]; then
    unopened_level=0
    break
  fi
  scan_dirs+=("${next[@]}")
  pending=("${next[@]}")
done

# Fail closed past the depth cap: anything still nested in the last level
# extracted would only be searched as compressed bytes, which can hide a value.
if [ "$unopened_level" -eq 1 ]; then
  for r in "${pending[@]}"; do
    while IFS= read -r -d '' z; do
      echo "::error::scan-artifacts-for-secrets: archive nested deeper than 3 levels, refusing to upload: $(origin_of "$z")"
      failed=1
    done < <(find "$r" -type f -name '*.zip' -print0 2>/dev/null)
    while IFS= read -r -d '' h; do
      echo "::error::scan-artifacts-for-secrets: embedded report nested deeper than 3 levels, refusing to upload: $(origin_of "$h")"
      failed=1
    done < <(find "$r" -type f -name '*.html' -print0 2>/dev/null | xargs -0 -r grep -lZ 'data:application/zip;base64,' 2>/dev/null)
  done
fi

report() { # report <pattern name> <file>...
  local name="$1" f
  shift
  for f in "$@"; do
    echo "::error::credential pattern '$name' found in artifact file: $(origin_of "$f")"
    failed=1
  done
}

# 1. Secret values, as fixed strings, in file contents and in path names
#    (Playwright derives output paths from test titles). `--` so a value
#    starting with '-' is not an option; values are never echoed.
for i in "${!SECRET_VALUES[@]}"; do
  var="${SECRET_NAMES[$i]}"
  v="${SECRET_VALUES[$i]}"
  mapfile -t hits < <(grep -rlF -- "$v" "${scan_dirs[@]}" 2>/dev/null)
  [ "${#hits[@]}" -gt 0 ] && report "secret:$var" "${hits[@]}"
  while IFS= read -r -d '' path; do
    case "$path" in
      *"$v"*) report "secret:$var (in the path name)" "$path" ;;
    esac
  done < <(find "${scan_dirs[@]}" -print0 2>/dev/null)
done
unset v

# 2. A minted Cloudflare Access session cookie.
mapfile -t hits < <(grep -rlF -- 'CF_Authorization=' "${scan_dirs[@]}" 2>/dev/null)
[ "${#hits[@]}" -gt 0 ] && report "CF_Authorization cookie" "${hits[@]}"

# 3. A bearer token of real length.
mapfile -t hits < <(grep -rlE -- 'Bearer [A-Za-z0-9._~+/=-]{20,}' "${scan_dirs[@]}" 2>/dev/null)
[ "${#hits[@]}" -gt 0 ] && report "Bearer token" "${hits[@]}"

if [ "$failed" -ne 0 ]; then
  echo "scan-artifacts-for-secrets: FAILED — the artifact will not be uploaded."
  exit 1
fi
echo "scan-artifacts-for-secrets: clean (${#roots[@]} path(s), $opened archive(s) opened)"
exit 0
