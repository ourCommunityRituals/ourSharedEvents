#!/usr/bin/env bash
# L1 unit test for the CF Access probe classifier (OSE-349).
# Sources the probe script (which returns early when sourced) and feeds the
# pure cf_access_classify() synthetic (curl_exit, status, content_type) tuples.
# No network. Pins the enum so the in-CI probe and the canary agree forever.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/../../scripts/ci/cf-access-probe.sh"

fail=0
check() { # expected  curl_exit status content_type
  local expected="$1" got
  got=$(cf_access_classify "$2" "$3" "$4")
  if [ "$got" = "$expected" ]; then
    echo "ok   : ($2,$3,$4) → $got"
  else
    echo "FAIL : ($2,$3,$4) → $got (expected $expected)"; fail=1
  fi
}

# happy path
check ok               0 200 "application/json"
check ok               0 200 "application/json; charset=utf-8"
# the recurrence: CF Access HTML challenge, both the historical 200/html and today's 302
check cf_access_shadow 0 200 "text/html"
check cf_access_shadow 0 200 "text/html; charset=UTF-8"
check cf_access_shadow 0 302 "text/html; charset=UTF-8"
check cf_access_shadow 0 301 "text/plain"          # bare redirect, no body type
check cf_access_shadow 0 302 ""                     # redirect with empty type
# worker rejected the bearer (different fix path)
check worker_auth      0 401 "application/json"
# transient
check network          7 000 ""
# anything else needs eyes
check unexpected       0 500 "application/json"
check unexpected       0 403 "application/json"
check unexpected       0 200 "application/xml"

if [ "$fail" -ne 0 ]; then echo "== classifier test FAILED =="; exit 1; fi
echo "== classifier test PASSED =="
