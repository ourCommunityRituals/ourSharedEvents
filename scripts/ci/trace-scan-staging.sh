#!/usr/bin/env bash
# trace-scan-staging.sh — scan the Eagles Hall test poster on staging and
# confirm the scan was recorded at the poster's place (OSE-616, QR Path rung 5).
#
#   bash scripts/ci/trace-scan-staging.sh            # from the repo root
#
# Needs: STG_BASE_URL (default https://stg.oursharedevents.com), wrangler
# credentials for the staging D1 (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID),
# the Cloudflare Access service token (CF_ACCESS_CLIENT_ID,
# CF_ACCESS_CLIENT_SECRET), and OCR_CI_EDGE_TOKEN.
#
# Why OCR_CI_EDGE_TOKEN: /q/* on staging sits behind a Cloudflare managed
# challenge (bot protection), so a non-browser client gets a 403 "Just a
# moment..." page from the edge and the Worker never runs (OSE-939). A WAF
# custom rule on the zone skips that challenge only for requests to
# stg.oursharedevents.com/q/* that carry the header X-OCR-CI with this value.
# Real visitors and production stay challenged.
# The poster comes from tests/ui/smoke/fixtures/trace-eagles-poster.sql.
#
# What it proves, on the deployed Worker:
#   1. GET /q/<token> answers 302 (the scan path is live for this poster).
#   2. Within the wait window, a new scan_placement_events row exists for the
#      poster, and the poster it references sits at the Eagles res9 node
#      89266454447ffff with corridor res7 872664544ffffff.
#   3. The scan row itself carries no geography (its only place is the poster).
#
# The rest of the trace (aggregate -> corridor -> export, with the res9 strip)
# needs the nightly cron and runs in CI against the real code instead:
# workers/oursharedevents/tests/scan-to-export-trace.spec.ts.
set -euo pipefail

BASE="${STG_BASE_URL:-https://stg.oursharedevents.com}"
TOKEN="qrt_trace_eagles_616"
DEPLOYMENT="pd_trace_eagles_616"
RES9="89266454447ffff"
RES7="872664544ffffff"
WAIT_SECONDS="${TRACE_WAIT_SECONDS:-90}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKER_DIR="$ROOT/workers/oursharedevents"

d1() {
  (cd "$WORKER_DIR" && npx wrangler d1 execute DB --env staging --remote --json --command "$1")
}

# Count first, so a scan written by an earlier run cannot satisfy this one.
before=$(d1 "SELECT COUNT(*) AS n FROM scan_placement_events WHERE poster_deployment_id = '$DEPLOYMENT'" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].results[0].n))')
echo "scans recorded for the Eagles test poster before: $before"

if [ -z "${CF_ACCESS_CLIENT_ID:-}" ] || [ -z "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
  echo "::error::CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET are not set; staging is behind Cloudflare Access"
  exit 1
fi
if [ -z "${OCR_CI_EDGE_TOKEN:-}" ]; then
  echo "::error::OCR_CI_EDGE_TOKEN is not set; without it the Cloudflare managed challenge on /q/* answers 403 (OSE-939)"
  exit 1
fi

# The Worker answers a scan with 302 to /events/<id>. Access also answers with
# a 302 (to its login page), so check where the redirect goes, not only the code.
headers_file="$(mktemp)"
trap 'rm -f "$headers_file"' EXIT
read -r status location < <(curl -sS -o /dev/null -D "$headers_file" --max-redirs 0 \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "X-OCR-CI: $OCR_CI_EDGE_TOKEN" \
  -w '%{http_code} %{redirect_url}\n' "$BASE/q/$TOKEN")
if [ "$status" != "302" ]; then
  # cf-mitigated is set by Cloudflare when the edge challenged or blocked the
  # request, so the Worker never saw it.
  if grep -qi '^cf-mitigated:' "$headers_file"; then
    echo "::error::GET /q/$TOKEN returned $status from the Cloudflare edge ($(grep -i '^cf-mitigated:' "$headers_file" | tr -d '\r')), not the Worker. Check the WAF skip rule for X-OCR-CI on stg /q/* and that OCR_CI_EDGE_TOKEN matches it (OSE-939)."
  else
    echo "::error::GET /q/$TOKEN returned $status, expected 302"
  fi
  exit 1
fi
case "$location" in
  "$BASE"/events/*) ;;
  *)
    echo "::error::GET /q/$TOKEN redirected to '$location', expected $BASE/events/..."
    exit 1
    ;;
esac
echo "scan sent: GET /q/$TOKEN -> 302 $location"

# Staging writes scans through a queue, so the row lands a little later.
deadline=$((SECONDS + WAIT_SECONDS))
row=""
while [ $SECONDS -lt $deadline ]; do
  row=$(d1 "SELECT COUNT(*) AS n, MAX(pd.h3_res9) AS cell, MAX(pd.h3_res7) AS corridor
              FROM scan_placement_events spe
              JOIN poster_deployments pd ON pd.id = spe.poster_deployment_id
             WHERE spe.poster_deployment_id = '$DEPLOYMENT'" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s)[0].results[0];console.log([r.n,r.cell,r.corridor].join(" "))})')
  n=${row%% *}
  if [ "$n" -gt "$before" ]; then break; fi
  sleep 5
done

read -r n cell corridor <<<"$row"
if [ "$n" -le "$before" ]; then
  echo "::error::no new scan row for $DEPLOYMENT within ${WAIT_SECONDS}s (before=$before, now=$n)"
  exit 1
fi
if [ "$cell" != "$RES9" ] || [ "$corridor" != "$RES7" ]; then
  echo "::error::scan resolved to cell=$cell corridor=$corridor, expected $RES9 / $RES7"
  exit 1
fi

cols=$(d1 "SELECT name FROM pragma_table_info('scan_placement_events')" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].results.map(r=>r.name).join(" ")))')
if echo "$cols" | grep -Eiq 'lat|lon|lng|h3|geo|city|postal'; then
  echo "::error::scan_placement_events carries geography of its own: $cols"
  exit 1
fi

echo "OK: scan recorded ($before -> $n) at poster res9 $cell, corridor res7 $corridor; scan row has no geography"
