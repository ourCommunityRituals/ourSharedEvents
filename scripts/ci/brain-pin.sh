#!/usr/bin/env bash
# brain-pin.sh: move a full checkout of OCR-docs main to the commit this repo pins
# in .ocr-brain-ref (CCR F3, owner decision 2026-11-26: pilot in ourWKRP, then the hub and OSE).
#
# Before, CI read the brain at OCR-docs main, so a change merged there ran in
# this repo's CI on the next PR without a review here. Now the brain changes
# only through a PR that bumps .ocr-brain-ref, the way .ocr-hub-ref pins the hub.
#
# Refuses, with ::error:: and exit 1:
#   - a pin that is not a full 40-hex commit id;
#   - a pin that is not on OCR-docs main (an unmerged branch commit);
#   - a pin older than the base branch's pin (a PR may not roll the brain back).
# Warns when the pin is behind OCR-docs main, with the number of commits.
#
# Usage: brain-pin.sh <ocr-docs checkout of main, full history> <pin file> [base pin]
set -euo pipefail

BRAIN_DIR="$1"
PIN_FILE="$2"
BASE_PIN="${3:-}"

fail() { echo "::error title=Brain pin (CCR F3)::$1"; exit 1; }

[ -f "$PIN_FILE" ] || fail "$PIN_FILE is missing; this repo must pin the OCR-docs commit it checks against."
PIN="$(tr -d '[:space:]' < "$PIN_FILE")"
[[ "$PIN" =~ ^[0-9a-f]{40}$ ]] || fail "$PIN_FILE must hold one full 40-character commit id, not '$PIN'."

MAIN="$(git -C "$BRAIN_DIR" rev-parse HEAD)"
git -C "$BRAIN_DIR" cat-file -e "${PIN}^{commit}" 2>/dev/null \
  || fail "the pinned commit $PIN is not in OCR-docs."
git -C "$BRAIN_DIR" merge-base --is-ancestor "$PIN" "$MAIN" \
  || fail "the pinned commit $PIN is not on OCR-docs main."

if [ -n "$BASE_PIN" ] && [ "$BASE_PIN" != "$PIN" ]; then
  [[ "$BASE_PIN" =~ ^[0-9a-f]{40}$ ]] || fail "the base branch pin '$BASE_PIN' is not a full commit id."
  git -C "$BRAIN_DIR" merge-base --is-ancestor "$BASE_PIN" "$PIN" \
    || fail "the pin moves the brain back from the base branch's $BASE_PIN to $PIN."
fi

git -C "$BRAIN_DIR" -c advice.detachedHead=false checkout -q "$PIN"
BEHIND="$(git -C "$BRAIN_DIR" rev-list --count "$PIN..$MAIN")"
if [ "$BEHIND" -gt 0 ]; then
  echo "::warning title=Brain pin behind OCR-docs main::The pin is $BEHIND commit(s) behind OCR-docs main. Bump .ocr-brain-ref in a PR to adopt them."
fi
echo "brain pinned at $PIN ($BEHIND commit(s) behind OCR-docs main)"
