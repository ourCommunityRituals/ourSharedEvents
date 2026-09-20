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
# Originally written for the self-hosted runner's broken git credential
# cache (`fatal: Unable to persist credentials with the 'wincredman'
# credential store`). OSE-341 (below) has since given the clone/fetch a
# real auth path, so this branch should now be rare — but it remains the
# safety net for any context where OCR_PROPAGATE_TOKEN is absent or the
# fetch fails for some other transient reason. If the local cache exists
# AND the fetch fails, the script falls back to using the existing cache
# as-is (stale but functional). The pipeline continues; a LOUD WARNING is
# printed so the operator can tell staging drifted. The cache's most
# recent commit is logged so reviewers can spot drift.
#
# The fallback does NOT apply to the first-clone case — without an
# existing cache there's nothing to fall back to. @ocr/flags/@ocr/ui
# simply won't be staged this run.
#
# Follow-up: publish @ocr/flags to a private GitHub Packages registry
# to eliminate the file: dance entirely. Until then, this script keeps
# CI jobs honest about the cross-repo dependency.
#
# ── ANNOTATION-NOISE CLEANUP (OSE-1344, 2026-09-20) ─────────────────────────
# Every call site sets `continue-on-error: true` on this step (staging is
# explicitly documented as best-effort, and npm ci is documented to
# tolerate @ocr/flags' absence) — so a hard `exit 1` here never actually
# blocks a job. It only produced a misleading red "failure" annotation
# (GitHub auto-attaches "Process completed with exit code 1" to any step
# that exits non-zero) on every single job of every workflow, run after
# run, for a condition the pipeline already treats as non-fatal. That
# drowned out real failures in the Annotations panel. Now: still print
# the same loud, ticket-referencing diagnostic, but as a GitHub
# `::warning::` annotation and `exit 0`, so the step is correctly shown
# as "succeeded (with a known, tracked, tolerated gap)" instead of a
# false "failed". This changes zero pass/fail behavior anywhere it's
# called — continue-on-error already made the step's own exit code moot.
# ───────────────────────────────────────────────────────────────────────────
#
# ── WORKSPACE TOKEN AUTH (OSE-341, 2026-09-20) ──────────────────────────────
# Runners moved to ephemeral, GitHub-hosted ubuntu-latest a while back, so
# there is no persistent credential store to "prime" — every job starts
# with zero git credentials for the private ourCommunityRituals/
# ourCommunityRituals repo, which is why the clone/fetch below failed on
# effectively every run. The org already has OCR_PROPAGATE_TOKEN (used for
# the exact same private cross-repo checkout in inv22-cross-repo-gate.yml,
# brain-contract-check.yml and conformance-report.yml), so call sites now
# pass it through as an env var of the same name and this script uses it,
# when present, to authenticate the clone/fetch via a transient
# `-c http.extraheader=...` — never a token embedded in the remote URL, so
# it is never written to $WS_CACHE/.git/config at rest (same posture as
# conformance-report.yml's `persist-credentials: false`).
#
# The token is optional at the script level: dependabot-triggered runs
# (and any other context without repo-secret access) still see it absent,
# and fall straight through to the pre-existing unauthenticated attempt —
# which the OSE-347/OSE-1344 tolerance paths already handle gracefully.
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail

WS_CACHE="${GITHUB_WORKSPACE:-$(pwd)}/../_ocr-workspace-cache"
TARGET_PARENT="${GITHUB_WORKSPACE:-$(pwd)}/../packages"
SOURCE_REPO="${OCR_WORKSPACE_REPO:-https://github.com/ourCommunityRituals/ourCommunityRituals.git}"

# Transient auth: only ever passed as a per-invocation `-c` override, never
# persisted into $WS_CACHE/.git/config. Empty array (no auth) when the
# token env var isn't set — git ignores an empty -c list.
AUTH_ARGS=()
if [ -n "${OCR_PROPAGATE_TOKEN:-}" ]; then
  AUTH_HEADER="AUTHORIZATION: basic $(printf '%s' "x-access-token:${OCR_PROPAGATE_TOKEN}" | base64 | tr -d '\n')"
  AUTH_ARGS=(-c "http.extraheader=${AUTH_HEADER}")
fi

if [ ! -d "$WS_CACHE/.git" ]; then
  echo "[stage] cloning $SOURCE_REPO into $WS_CACHE"
  if ! git "${AUTH_ARGS[@]}" clone --depth 1 "$SOURCE_REPO" "$WS_CACHE"; then
    echo "::warning title=@ocr/flags staging skipped (OSE-341)::initial clone of $SOURCE_REPO failed and no cache to fall back to — likely cause: OCR_PROPAGATE_TOKEN is unavailable in this run context (e.g. dependabot) or the token lacks access. npm ci is documented to tolerate @ocr/flags' absence, so this run continues without it."
    exit 0
  fi
else
  echo "[stage] updating existing clone at $WS_CACHE"
  # OSE-347: tolerate fetch failure when an existing cache is available.
  # If fetch + reset both succeed, we got fresh code (the happy path). If
  # either fails, we keep the existing cache and warn loudly. set -e is
  # suppressed inside the `if cmd && cmd; then` pattern, so failures here
  # do not abort the script — they fall through to the else branch.
  if git -C "$WS_CACHE" "${AUTH_ARGS[@]}" fetch --depth 1 origin main && \
     git -C "$WS_CACHE" reset --hard origin/main; then
    echo "[stage] cache updated from origin main"
  else
    echo "[stage] ============================================================"
    echo "[stage] WARNING: fetch from origin failed — using existing cache as-is"
    echo "[stage] ============================================================"
    if [ -z "${OCR_PROPAGATE_TOKEN:-}" ]; then
      echo "[stage] likely cause: OCR_PROPAGATE_TOKEN is unavailable in this run"
      echo "[stage] context (e.g. dependabot), so the fetch was unauthenticated."
    else
      echo "[stage] likely cause: OCR_PROPAGATE_TOKEN is present but the fetch"
      echo "[stage] still failed (revoked/expired token, network blip, or the"
      echo "[stage] token no longer has access to $SOURCE_REPO)."
    fi
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
  fi
fi

if [ ! -d "$WS_CACHE/packages/flags" ]; then
  echo "::warning title=@ocr/flags staging skipped (OSE-341)::$WS_CACHE/packages/flags is missing — even the fallback cache lacks the package. npm ci is documented to tolerate @ocr/flags' absence, so this run continues without it."
  exit 0
fi

mkdir -p "$TARGET_PARENT"
rm -rf "$TARGET_PARENT/flags"
cp -r "$WS_CACHE/packages/flags" "$TARGET_PARENT/flags"
echo "[stage] @ocr/flags available at $TARGET_PARENT/flags"

if [ -d "$WS_CACHE/packages/ui" ]; then
  rm -rf "$TARGET_PARENT/ui"
  cp -r "$WS_CACHE/packages/ui" "$TARGET_PARENT/ui"
  echo "[stage] @ocr/ui available at $TARGET_PARENT/ui"
fi
