#!/usr/bin/env bash
# Checks the client test site after a deploy or a rollback (OSE-2211).
#
#   1. Private: a visitor with no Access sign-in is NOT served the site. Access
#      answers with a redirect to its sign-in page (302) or a refusal (401/403).
#      A 200 means the site is open to the world, and the job fails.
#   2. Up: with the CI service token, /health answers 200 and says "staging"
#      (the test site runs as a staging-class Worker), and the landing and /map
#      pages answer 200.
#
#   TEST_BASE_URL            default https://test.oursharedevents.com
#   CF_ACCESS_CLIENT_ID      the CI Access service token (repo secret)
#   CF_ACCESS_CLIENT_SECRET
#   EXPECT_BUILD             optional: the build stamp /health must report
#
# Held in place by tests/unit/ci/client-test-site.test.js.
set -euo pipefail

BASE="${TEST_BASE_URL:-https://test.oursharedevents.com}"

status_of() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$@" || echo 000
}

# A new route can take a few seconds to reach every location.
for attempt in 1 2 3 4 5 6; do
  ANON="$(status_of "$BASE/")"
  [ "$ANON" != "000" ] && [ "$ANON" != "522" ] && [ "$ANON" != "530" ] && break
  sleep 10
done

case "$ANON" in
  302 | 401 | 403)
    echo "✓ Private: an anonymous visit gets HTTP $ANON (Access sign-in), not the site."
    ;;
  200)
    echo "::error title=The client test site is public::An anonymous visit to $BASE/ got HTTP 200. The Cloudflare Access app must cover the whole host (runbook step 2). Roll back or switch the route off until it does."
    exit 1
    ;;
  *)
    echo "::error title=The client test site did not answer::An anonymous visit to $BASE/ got HTTP $ANON. Is the DNS record for the test host in place (runbook step 1)?"
    exit 1
    ;;
esac

AUTH=(-H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID:?}" -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET:?}")

HEALTH="$(curl -s --max-time 30 "${AUTH[@]}" "$BASE/health" || true)"
ENV_NAME="$(printf '%s' "$HEALTH" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).env||'')}catch{console.log('')}})")"
if [ "$ENV_NAME" != "staging" ]; then
  echo "::error title=Health check failed::$BASE/health did not answer as the staging-class test Worker (env='${ENV_NAME}'). Is the CI service token allowed by the test site's Access app (runbook step 2)?"
  exit 1
fi
echo "✓ /health answers, env=staging"

if [ -n "${EXPECT_BUILD:-}" ]; then
  VERSION="$(printf '%s' "$HEALTH" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).version||'')}catch{console.log('')}})")"
  if [ "$VERSION" != "$EXPECT_BUILD" ]; then
    echo "::warning title=Build stamp::/health reports '$VERSION', expected '$EXPECT_BUILD' (an old instance may still be answering)."
  else
    echo "✓ /health reports build $VERSION"
  fi
fi

for path in / /map /events; do
  CODE="$(status_of "${AUTH[@]}" "$BASE$path")"
  if [ "$CODE" != "200" ]; then
    echo "::error title=Page check failed::$BASE$path answered HTTP $CODE"
    exit 1
  fi
  echo "✓ $path answers 200"
done
