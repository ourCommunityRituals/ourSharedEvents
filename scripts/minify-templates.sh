#!/bin/bash
# Minify HTML templates for production Worker bundle
# Strips comments, blank lines, and console.log statements
# Source files stay readable — this runs before deploy only
#
# Usage: bash scripts/minify-templates.sh
# Output: cloudflare-proxy/templates-min/ (gitignored)

set -e

SRC="cloudflare-proxy/templates"
OUT="cloudflare-proxy/templates-min"

mkdir -p "$OUT"

echo "Minifying templates..."

for file in admin.html display.html public.html poster.html report.html; do
  if [ -f "$SRC/$file" ]; then
    # Strip: HTML comments, JS single-line comments (not URLs), blank lines, console.log/debug/info
    sed \
      -e '/<!--/,/-->/d' \
      -e '/^\s*\/\//d' \
      -e '/^\s*$/d' \
      -e '/console\.\(log\|debug\|info\)/d' \
      "$SRC/$file" > "$OUT/$file"

    SRC_LINES=$(wc -l < "$SRC/$file")
    OUT_LINES=$(wc -l < "$OUT/$file")
    SRC_SIZE=$(wc -c < "$SRC/$file")
    OUT_SIZE=$(wc -c < "$OUT/$file")
    SAVED=$(( SRC_SIZE - OUT_SIZE ))
    PCT=$(( SAVED * 100 / SRC_SIZE ))

    echo "  $file: $SRC_LINES → $OUT_LINES lines (-${PCT}%, saved ${SAVED} bytes)"
  fi
done

echo ""
echo "Minified templates in $OUT/"
echo "To use: update worker.js imports to point to templates-min/"
