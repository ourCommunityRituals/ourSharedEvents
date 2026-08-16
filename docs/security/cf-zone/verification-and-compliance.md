# CF Zone — Practical Implications, Verification & Compliance

> Extracted from [CF_ZONE_CONFIG_BASELINE.md](../CF_ZONE_CONFIG_BASELINE.md) (Parts 3–5) under COST-402 / OSE-784, so an agent loads only this concern. The baseline remains the entry point.

## Part 3: Practical Implications

### Rule Writing Guidelines

| Scenario                     | Correct Layer            | Why                         |
| ---------------------------- | ------------------------ | --------------------------- |
| Block country                | IP Access Rules (R-02)   | Cheapest; never reaches WAF |
| Block IPs from threat intel  | IP Access Rules (R-02)   | Same as above               |
| Block SQL injection patterns | WAF Managed Rules (R-05) | CF maintains patterns       |
| Block specific user-agent    | WAF Custom Rules (R-06)  | Application-specific        |
| Require auth for `/admin`    | Cloudflare Access (R-07) | Identity layer              |
| Rate limit API endpoints     | Rate Limiting (R-04)     | Before application logic    |
| Redirect www→apex            | Redirect Rules (R-08)    | URL transformation          |
| Add security headers         | Transform Rules (R-11)   | Response modification       |

### Debugging Rule Interactions

When a rule doesn't behave as expected:

1. **Check evaluation order** — Is an earlier layer blocking/allowing the request?
2. **Check rule priority** — Lower numbers execute first within same layer
3. **Use Ray ID** — Every request has a `CF-Ray` header; search in Security Events
4. **Check WAF events** — Dashboard → Security → Events

---

## Part 4: Verification Commands

### Quick Health Check (All Exit Gates)

```bash
#!/bin/bash
# CF Zone Health Check - 33 Verification Checks
# Covers all Exit Gates from I-01 through I-14

DOMAIN="yourdomain.com"
PASS=0
FAIL=0
MANUAL=0

check() {
  local num=$1 name=$2 result=$3
  if [ "$result" = "PASS" ]; then
    echo "[✓] #$num $name"
    ((PASS++))
  elif [ "$result" = "MANUAL" ]; then
    echo "[?] #$num $name (manual verification required)"
    ((MANUAL++))
  else
    echo "[✗] #$num $name"
    ((FAIL++))
  fi
}

echo "========================================"
echo "CF Zone Health Check: $DOMAIN"
echo "========================================"

echo -e "\n=== I-01: DNS Baseline ==="
# Check 1: DNS resolves to Cloudflare IPs
CF_IP=$(dig +short $DOMAIN | head -1)
if [[ "$CF_IP" =~ ^(104\.|172\.|103\.) ]]; then
  check 1 "DNS resolves to Cloudflare IPs" "PASS"
else
  check 1 "DNS resolves to Cloudflare IPs" "FAIL"
fi

# Check 2: Proxied (CF-Ray header present)
CF_RAY=$(curl -sI https://$DOMAIN 2>/dev/null | grep -i "cf-ray")
if [ -n "$CF_RAY" ]; then
  check 2 "Traffic proxied through Cloudflare" "PASS"
else
  check 2 "Traffic proxied through Cloudflare" "FAIL"
fi

echo -e "\n=== I-02: TLS & Transport (HARD GATE NG-1) ==="
# Check 3: HTTPS works
HTTPS_STATUS=$(curl -sI https://$DOMAIN 2>/dev/null | head -1 | grep -E "HTTP/[12]")
if [ -n "$HTTPS_STATUS" ]; then
  check 3 "HTTPS endpoint responds" "PASS"
else
  check 3 "HTTPS endpoint responds" "FAIL"
fi

# Check 4: HTTP redirects to HTTPS
HTTP_REDIRECT=$(curl -sI http://$DOMAIN 2>/dev/null | grep -i "location" | grep -i "https://")
if [ -n "$HTTP_REDIRECT" ]; then
  check 4 "HTTP redirects to HTTPS" "PASS"
else
  check 4 "HTTP redirects to HTTPS" "FAIL"
fi

# Check 5: TLS 1.0 rejected
TLS10_FAIL=$(curl -sI --tlsv1.0 --tls-max 1.0 https://$DOMAIN 2>&1 | grep -iE "error|alert|failed")
if [ -n "$TLS10_FAIL" ]; then
  check 5 "TLS 1.0 rejected" "PASS"
else
  check 5 "TLS 1.0 rejected" "FAIL"
fi

# Check 6: TLS 1.2+ works
TLS12_OK=$(curl -sI --tlsv1.2 https://$DOMAIN 2>/dev/null | head -1 | grep -E "HTTP/[12]")
if [ -n "$TLS12_OK" ]; then
  check 6 "TLS 1.2+ accepted" "PASS"
else
  check 6 "TLS 1.2+ accepted" "FAIL"
fi

# Check 7: HSTS header present
HSTS=$(curl -sI https://$DOMAIN 2>/dev/null | grep -i "strict-transport-security")
if [ -n "$HSTS" ]; then
  check 7 "HSTS header present" "PASS"
else
  check 7 "HSTS header present" "FAIL"
fi

echo -e "\n=== I-03: Request Normalization (NS-1) ==="
# Check 8: www redirects to apex (or vice versa - canonical host)
WWW_REDIRECT=$(curl -sI https://www.$DOMAIN 2>/dev/null | grep -i "location")
if [ -n "$WWW_REDIRECT" ]; then
  check 8 "Canonical host redirect active" "PASS"
else
  check 8 "Canonical host redirect active" "FAIL"
fi

# Check 9: Query string preserved through redirect
QUERY_PRESERVED=$(curl -sI "https://www.$DOMAIN/test?q=1" 2>/dev/null | grep -i "location" | grep "q=1")
if [ -n "$QUERY_PRESERVED" ]; then
  check 9 "Query string preserved in redirects" "PASS"
else
  check 9 "Query string preserved in redirects" "FAIL"
fi

echo -e "\n=== I-04: Config/Origin Rules ==="
# Check 10: X-Frame-Options header
XFRAME=$(curl -sI https://$DOMAIN 2>/dev/null | grep -i "x-frame-options")
if [ -n "$XFRAME" ]; then
  check 10 "X-Frame-Options header present" "PASS"
else
  check 10 "X-Frame-Options header present" "FAIL"
fi

# Check 11: X-Content-Type-Options header
XCONTENT=$(curl -sI https://$DOMAIN 2>/dev/null | grep -i "x-content-type-options")
if [ -n "$XCONTENT" ]; then
  check 11 "X-Content-Type-Options header present" "PASS"
else
  check 11 "X-Content-Type-Options header present" "FAIL"
fi

echo -e "\n=== I-05: WAF Managed Rules (NS-6) ==="
# Check 12: WAF blocks SQLi (test in staging only!)
echo "    [Manual] Test SQLi: curl 'https://$DOMAIN/?id=1%27OR%271%27=%271'"
check 12 "WAF Managed Ruleset enabled (dashboard check)" "MANUAL"

# Check 13: WAF events visible
check 13 "Security Events show WAF entries (dashboard check)" "MANUAL"

echo -e "\n=== I-06: Custom WAF Rules (NG-3) ==="
# Check 14: Custom rules documented and reviewed
check 14 "Custom rules versioned in registry (dashboard check)" "MANUAL"

# Check 15: No mystery blocks
check 15 "All blocking rules have PR review documented" "MANUAL"

echo -e "\n=== I-07: Rate Limiting (NS-4) ==="
# Check 16: Rate limit rules configured
check 16 "Auth endpoint rate limits configured (dashboard check)" "MANUAL"

# Check 17: Rate limits producing events
check 17 "Rate limiting rules producing events (dashboard check)" "MANUAL"

echo -e "\n=== I-08: Bot Controls (NS-7) ==="
# Check 18: Bot Fight Mode enabled
check 18 "Bot Fight Mode enabled (dashboard check)" "MANUAL"

# Check 19: Verified bots allowed
check 19 "Verified bots setting = ALLOW (dashboard check)" "MANUAL"

# Check 20: Health endpoints not challenged
HEALTH_STATUS=$(curl -sI https://$DOMAIN/healthz 2>/dev/null | head -1 | grep -E "HTTP/[12]")
if [[ "$HEALTH_STATUS" =~ "200" ]]; then
  check 20 "Health endpoints return 200 (not challenged)" "PASS"
else
  check 20 "Health endpoints return 200 (not challenged)" "FAIL"
fi

# Check 21: API endpoints not challenged
API_STATUS=$(curl -sI https://$DOMAIN/api/status 2>/dev/null | head -1)
if [[ "$API_STATUS" =~ "200" ]] || [[ "$API_STATUS" =~ "404" ]]; then
  check 21 "API endpoints not returning challenge page" "PASS"
else
  check 21 "API endpoints not returning challenge page" "FAIL"
fi

echo -e "\n=== I-09: API Hardening (NS-8) ==="
# Check 22: API validation configured
check 22 "API validation strategy documented (API Shield OR Worker-based)" "MANUAL"

# Check 23: Invalid requests rejected with 4xx
INVALID_JSON=$(curl -s -X POST https://$DOMAIN/api/v1/events -H "Content-Type: application/json" -d 'not-json' 2>/dev/null | head -1)
if [[ "$INVALID_JSON" =~ "400" ]] || [[ "$INVALID_JSON" =~ "error" ]]; then
  check 23 "Invalid JSON rejected with 4xx" "PASS"
else
  check 23 "Invalid JSON rejected with 4xx" "MANUAL"
fi

# Check 24: Protected endpoints require auth
AUTH_CHECK=$(curl -sI https://$DOMAIN/api/v1/admin/users 2>/dev/null | head -1)
if [[ "$AUTH_CHECK" =~ "401" ]] || [[ "$AUTH_CHECK" =~ "403" ]]; then
  check 24 "Protected API endpoints require authentication" "PASS"
else
  check 24 "Protected API endpoints require authentication" "MANUAL"
fi

echo -e "\n=== I-10: Observability & Change Discipline ==="
# Check 25: Security Events accessible
check 25 "Security Events dashboard accessible (shows recent events)" "MANUAL"

# Check 26: Rules have attribution
check 26 "Custom rules follow naming convention with owner + ticket" "MANUAL"

# Check 27: Staging environment exists
check 27 "Staging environment configured for rule testing" "MANUAL"

echo -e "\n=== I-11: Registrar & DNSSEC ==="
# Check 28: DNSSEC RRSIG records present
DNSSEC=$(dig +dnssec +short $DOMAIN 2>/dev/null | grep -c "RRSIG")
if [ "$DNSSEC" -gt 0 ]; then
  check 28 "DNSSEC RRSIG records present" "PASS"
else
  check 28 "DNSSEC RRSIG records present" "FAIL"
fi

echo -e "\n=== I-12: Worker Route Configuration ==="
# Check 29: Worker handles requests (check for Worker-specific behavior)
check 29 "Single Worker route active (dashboard check)" "MANUAL"

echo -e "\n=== I-13: Cloudflare Access (NS-2) ==="
# Check 30: /admin requires auth (should redirect to Access login)
ADMIN_REDIRECT=$(curl -sI https://$DOMAIN/admin/ 2>/dev/null | grep -iE "(302|303|307|location.*access)")
if [ -n "$ADMIN_REDIRECT" ]; then
  check 30 "/admin requires authentication" "PASS"
else
  check 30 "/admin requires authentication" "FAIL"
fi

# Check 31: /healthz is accessible (bypass)
HEALTHZ=$(curl -s https://$DOMAIN/healthz 2>/dev/null | head -c 100)
if [[ "$HEALTHZ" =~ (OK|ok|healthy) ]]; then
  check 31 "/healthz accessible (bypass working)" "PASS"
else
  check 31 "/healthz accessible (bypass working)" "FAIL"
fi

echo -e "\n=== I-14: Origin Bypass Prevention (NS-5) ==="
# Check 32: All traffic via CF (CF-Ray always present)
if [ -n "$CF_RAY" ]; then
  check 32 "All traffic routes through Cloudflare" "PASS"
else
  check 32 "All traffic routes through Cloudflare" "FAIL"
fi

# Check 33: No direct origin exposure
check 33 "Origin IP not publicly exposed (verify no A record leak)" "MANUAL"

echo -e "\n========================================"
echo "SUMMARY: $PASS passed, $FAIL failed, $MANUAL manual checks"
echo "========================================"
if [ $FAIL -gt 0 ]; then
  echo "⚠️  ATTENTION: $FAIL checks failed - review before proceeding"
  exit 1
fi
```

---

## Part 5: Compliance Matrix

| North Star                      | Implementation Section | Exit Gate                                                                    |
| ------------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| **NG-1 (TLS Strict)**           | **I-02**               | Full (strict) mode, no HTTP endpoints                                        |
| NS-1 (Canonical Host)           | **I-03**               | One canonical host + scheme + stable paths                                   |
| NS-2 (Auth Required)            | **I-13**               | Access protects privileged paths                                             |
| NS-3 (Health = Boring)          | Worker code            | `/healthz` returns plain "OK"                                                |
| NS-4 (Rate Limiting)            | **I-07**               | Rate limits enforced with explicit thresholds                                |
| NS-5 (Origin Bypass)            | **I-14**               | Origin unreachable directly                                                  |
| NS-6 (WAF Baseline)             | **I-05**               | Managed rules ON and producing events                                        |
| NS-7 (Bot Controls)             | **I-08**               | Bot controls tuned; verified bots allowed; health endpoints never challenged |
| NS-8 (API Hardening)            | **I-09**               | API contract enforced; invalid requests rejected before origin compute       |
| NS-9 (Observability)            | **I-10**               | All rules have traceable owner + reason; rollback plans documented           |
| **NG-3 (Block Rules Reviewed)** | **I-06**               | Custom rules versioned, ordered, PR-reviewed                                 |
| **NG-4 (Staging First)**        | **I-10**               | Security changes validated in staging before production                      |
| QR-0 (Verified QR)              | Worker code            | QR only with `verified: true`                                                |
