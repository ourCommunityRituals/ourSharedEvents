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

# ── Challenge mode (OSE-1418): WHICH Access app answers an unauthenticated probe.
check_ch() { # expected  curl_exit status probed_host login_url
  local expected="$1" got
  got=$(cf_access_challenge_classify "$2" "$3" "$4" "$5")
  if [ "$got" = "$expected" ]; then
    echo "ok   : challenge($3,$4,${5:-none}) → $got"
  else
    echo "FAIL : challenge($3,$4,${5:-none}) → $got (expected $expected)"; fail=1
  fi
}
TEAM="https://mzdano.cloudflareaccess.com/cdn-cgi/access/login"
# the probed host's own Access app → ok (case-insensitive host compare)
check_ch access_ok        0 302 oursharedevents.com     "$TEAM/oursharedevents.com?kid=abc&redirect_url=%2Fadmin"
check_ch access_ok        0 302 stg.oursharedevents.com "$TEAM/stg.oursharedevents.com?kid=abc"
check_ch access_ok        0 200 OurSharedEvents.com     "$TEAM/oursharedevents.com"
# OSE-1353: the production host challenged by the STAGING app
check_ch wrong_access_app 0 302 oursharedevents.com     "$TEAM/stg.oursharedevents.com?kid=abc&redirect_url=%2Fadmin"
# a lookalike suffix must not pass as the probed host
check_ch wrong_access_app 0 302 oursharedevents.com     "$TEAM/oursharedevents.com.evil.example"
# no Access at all: the Worker answered
check_ch no_access        0 401 oursharedevents.com     ""
check_ch no_access        0 404 oursharedevents.com     ""
check_ch no_access        0 200 oursharedevents.com     ""
# a redirect somewhere that is not an Access login
check_ch unexpected       0 302 oursharedevents.com     ""
check_ch unexpected       0 522 oursharedevents.com     ""
check_ch network          6 000 oursharedevents.com     ""

if [ "$fail" -ne 0 ]; then echo "== classifier test FAILED =="; exit 1; fi
echo "== classifier test PASSED =="
