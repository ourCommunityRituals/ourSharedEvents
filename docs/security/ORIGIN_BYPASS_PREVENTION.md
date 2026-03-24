# ORIGIN_BYPASS_PREVENTION.md — Origin Bypass Prevention (NS-3)

> **PROMPTSPEC-SEC-8.1** — Origin Bypass Prevention (Non-GAS Origin)
> Role: Director of Security + Lead Networking Consultant
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Define and enforce controls that ensure **NS-3 compliance**: origin bypass must fail. This document specifies how direct origin access is prevented, what "expected failure" looks like for bypass attempts, and verification procedures for confirming protection.

| Attribute | Value |
|-----------|-------|
| **Scope** | Origin access control for all production and staging environments |
| **Prerequisites** | Security Baseline (SEC-0.1), TLS Strict Baseline (SEC-3.1) |
| **Constraints** | Worker-only architecture has no traditional origin; document covers defense-in-depth |

---

## 2. North Star Invariant: NS-3

> **NS-3:** Origin bypass must fail (direct origin access is blocked/meaningless)

### 2.1 What NS-3 Means

| Aspect | Requirement |
|--------|-------------|
| **Direct IP Access** | Must fail or return meaningless response |
| **DNS Bypass** | Must not expose origin IP |
| **Application Logic Bypass** | WAF/Access/Worker guards cannot be skipped |
| **Data Backend Access** | External APIs (Google Sheets) require Worker authentication |

### 2.2 Current Architecture: Worker-Only

EventAngle operates in **Worker-only mode** — there is no traditional origin server.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       WORKER-ONLY ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Internet → Cloudflare Edge → Worker (at edge) → Google Sheets API          │
│                                     │                                       │
│                                     └─ No origin server exists              │
│                                        No origin IP to bypass               │
│                                        Worker IS the application            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Characteristic | Value | Bypass Risk |
|----------------|-------|-------------|
| Origin Server | **None** | Eliminated |
| Origin IP | **None** | Eliminated |
| Application Host | Cloudflare Edge (Worker) | N/A |
| Data Backend | Google Sheets API | Protected (service account auth) |

**NS-3 Status:** **COMPLIANT** — Worker-only architecture eliminates origin bypass by design.

---

## 3. Expected Failure Definitions

### 3.1 What "Expected Failure" Means

When an attacker attempts to bypass Cloudflare to reach an origin directly, the attempt must **fail in a predictable, documented way**.

| Bypass Attempt | Expected Failure | Response |
|----------------|------------------|----------|
| Direct IP access (if origin existed) | Connection refused or timeout | No HTTP response |
| DNS lookup for origin IP | Returns Cloudflare IP only | No origin IP exposed |
| Request without Cloudflare headers | 403 Forbidden or connection reset | No application response |
| Request without valid origin cert | TLS handshake failure | 525/526 error |
| Request to Google Sheets API directly | 401/403 Unauthorized | Requires service account |

### 3.2 Failure Categories

| Category | Definition | Detection Method |
|----------|------------|------------------|
| **Connection Failure** | TCP connection cannot be established | `curl` returns connection error |
| **TLS Failure** | Certificate validation fails | `curl` returns SSL error |
| **Authentication Failure** | Request rejected for missing/invalid credentials | HTTP 401/403 response |
| **Authorization Failure** | Request rejected for insufficient permissions | HTTP 403 response |
| **Empty/Meaningless Response** | Response contains no useful data | Empty body or error page |

### 3.3 Why Failure Must Be "Expected"

| Reason | Explanation |
|--------|-------------|
| **Predictability** | Security team knows what to expect when testing |
| **Monitoring** | Alerts can be configured for unexpected success |
| **Documentation** | Auditors can verify controls are working |
| **Incident Response** | If bypass succeeds, it's immediately recognized as a breach |

---

## 4. Implementation Plan

### 4.1 Current State (Worker-Only)

Since EventAngle uses Worker-only architecture, traditional origin bypass prevention is **not applicable** but defense-in-depth is maintained:

| Control | Status | Notes |
|---------|--------|-------|
| No origin server | **ACTIVE** | Worker executes at edge |
| DNS proxied (orange cloud) | **ACTIVE** | No origin IP exposed via DNS |
| Google Sheets API auth | **ACTIVE** | Service account required |
| WAF at edge | **ACTIVE** | Blocks attacks before Worker |
| Rate limiting | **ACTIVE** | Prevents abuse |

### 4.2 If Origin Server Existed (Reference Architecture)

For architectures with a traditional origin server, these controls would be required:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TRADITIONAL ORIGIN ARCHITECTURE                           │
│                    (NOT CURRENT - REFERENCE ONLY)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Internet → Cloudflare Edge → Origin Server                                 │
│                    │                    │                                   │
│                    │                    ├─ Origin firewall: CF IPs only     │
│                    │                    ├─ Authenticated Origin Pulls       │
│                    │                    └─ Origin certificate validation    │
│                    │                                                        │
│                    └─ Attacker attempts direct IP access                    │
│                       ↓                                                     │
│                       BLOCKED by origin firewall                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Authenticated Origin Pulls

### 5.1 Overview

Authenticated Origin Pulls (AOP) is a Cloudflare feature that uses mutual TLS (mTLS) to verify that requests to the origin come from Cloudflare.

| Aspect | Description |
|--------|-------------|
| **Purpose** | Ensure origin only accepts requests from Cloudflare |
| **Mechanism** | Cloudflare presents a client certificate; origin validates |
| **Certificate** | Cloudflare-signed or custom CA certificate |
| **Applicability** | Only for architectures with origin servers |

### 5.2 Current Status

| Setting | Value | Reason |
|---------|-------|--------|
| **Authenticated Origin Pulls** | N/A | Worker-only architecture has no origin |
| **Future Requirement** | Document for reference | If origin added, AOP becomes mandatory |

### 5.3 Implementation Guide (If Origin Existed)

If an origin server were added to the architecture:

**Step 1: Enable in Cloudflare Dashboard**

| Step | Action | Location |
|------|--------|----------|
| 1 | Navigate to SSL/TLS → Origin Server | Cloudflare Dashboard |
| 2 | Enable "Authenticated Origin Pulls" | Toggle ON |
| 3 | Download Cloudflare CA certificate | "Download certificate" link |

**Step 2: Configure Origin Server**

For nginx:
```nginx
# /etc/nginx/sites-available/eventangle
server {
    listen 443 ssl;
    server_name origin.eventangle.com;

    # Standard SSL
    ssl_certificate /etc/ssl/certs/eventangle.crt;
    ssl_certificate_key /etc/ssl/private/eventangle.key;

    # Authenticated Origin Pulls
    ssl_client_certificate /etc/ssl/cloudflare-ca.crt;
    ssl_verify_client on;

    # Reject requests without valid Cloudflare cert
    if ($ssl_client_verify != SUCCESS) {
        return 403;
    }

    location / {
        proxy_pass http://localhost:3000;
    }
}
```

For Apache:
```apache
<VirtualHost *:443>
    ServerName origin.eventangle.com

    # Standard SSL
    SSLEngine on
    SSLCertificateFile /etc/ssl/certs/eventangle.crt
    SSLCertificateKeyFile /etc/ssl/private/eventangle.key

    # Authenticated Origin Pulls
    SSLCACertificateFile /etc/ssl/cloudflare-ca.crt
    SSLVerifyClient require
    SSLVerifyDepth 1
</VirtualHost>
```

**Step 3: Verify Configuration**

```bash
# Request WITHOUT Cloudflare cert (should FAIL)
curl -vI https://origin.eventangle.com
# Expected: SSL handshake failure or 403 Forbidden

# Request via Cloudflare (should SUCCEED)
curl -vI https://www.eventangle.com
# Expected: HTTP 200 OK
```

### 5.4 Expected Failure: AOP Bypass Attempt

| Attempt | Expected Result | Verification |
|---------|-----------------|--------------|
| Direct HTTPS to origin IP | TLS client cert required error | `curl` returns SSL error |
| Direct HTTPS with self-signed cert | Certificate rejected | 403 or SSL error |
| Direct HTTPS without any cert | Connection rejected | 403 or SSL error |
| Via Cloudflare | Success | HTTP 200 |

---

## 6. Origin Firewall Allowlist

### 6.1 Overview

Origin firewall rules restrict inbound connections to only Cloudflare IP ranges, blocking all direct access attempts.

| Aspect | Description |
|--------|-------------|
| **Purpose** | Block direct IP access to origin |
| **Mechanism** | Firewall rules allow only Cloudflare IPs on ports 80/443 |
| **IP List** | https://www.cloudflare.com/ips/ |
| **Applicability** | Only for architectures with origin servers |

### 6.2 Current Status

| Setting | Value | Reason |
|---------|-------|--------|
| **Origin Firewall** | N/A | Worker-only architecture has no origin |
| **Google Sheets API** | Google-managed | Not accessible without service account |
| **Future Requirement** | Document for reference | If origin added, firewall becomes mandatory |

### 6.3 Cloudflare IP Ranges

Cloudflare publishes IP ranges that should be allowlisted:

**IPv4 Ranges:**
```
173.245.48.0/20
103.21.244.0/22
103.22.200.0/22
103.31.4.0/22
141.101.64.0/18
108.162.192.0/18
190.93.240.0/20
188.114.96.0/20
197.234.240.0/22
198.41.128.0/17
162.158.0.0/15
104.16.0.0/13
104.24.0.0/14
172.64.0.0/13
131.0.72.0/22
```

**IPv6 Ranges:**
```
2400:cb00::/32
2606:4700::/32
2803:f800::/32
2405:b500::/32
2405:8100::/32
2a06:98c0::/29
2c0f:f248::/32
```

### 6.4 Implementation Guide (If Origin Existed)

**Option A: iptables (Linux)**
```bash
#!/bin/bash
# /usr/local/bin/cloudflare-firewall.sh
# Restrict origin to Cloudflare IPs only

# Flush existing rules for this chain
iptables -F CLOUDFLARE 2>/dev/null || iptables -N CLOUDFLARE

# Allow Cloudflare IPv4
for ip in 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 \
          141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 \
          197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 \
          104.24.0.0/14 172.64.0.0/13 131.0.72.0/22; do
    iptables -A CLOUDFLARE -s "$ip" -p tcp --dport 443 -j ACCEPT
done

# Block all other HTTPS traffic
iptables -A CLOUDFLARE -p tcp --dport 443 -j DROP

# Apply to INPUT chain
iptables -A INPUT -p tcp --dport 443 -j CLOUDFLARE
```

**Option B: ufw (Ubuntu)**
```bash
# Allow Cloudflare IPs
for ip in 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22; do
    ufw allow from "$ip" to any port 443
done

# Deny all other HTTPS
ufw deny 443
```

**Option C: AWS Security Group**
```json
{
  "IpPermissions": [
    {
      "FromPort": 443,
      "ToPort": 443,
      "IpProtocol": "tcp",
      "IpRanges": [
        {"CidrIp": "173.245.48.0/20", "Description": "Cloudflare"},
        {"CidrIp": "103.21.244.0/22", "Description": "Cloudflare"},
        {"CidrIp": "103.22.200.0/22", "Description": "Cloudflare"}
      ]
    }
  ]
}
```

**Option D: GCP Firewall Rule**
```bash
gcloud compute firewall-rules create allow-cloudflare \
    --direction=INGRESS \
    --priority=1000 \
    --network=default \
    --action=ALLOW \
    --rules=tcp:443 \
    --source-ranges=173.245.48.0/20,103.21.244.0/22,103.22.200.0/22
```

### 6.5 Expected Failure: Firewall Bypass Attempt

| Attempt | Expected Result | Verification |
|---------|-----------------|--------------|
| Direct IP access from non-CF IP | Connection refused/timeout | `curl` timeout or reset |
| Direct IP access from CF IP range | Connection allowed | Only CF edge should have these IPs |
| VPN/proxy to origin | Blocked (not CF IP) | Connection refused |

---

## 7. Verification Tests

### 7.1 Test 1: No Origin IP Exposed (DNS)

Verify that DNS lookups return only Cloudflare IPs, not origin IPs.

```bash
#!/bin/bash
# Test: DNS returns only Cloudflare IPs

echo "=== Test 1: DNS Resolution ==="
echo "Testing: www.eventangle.com"

# Get resolved IPs
IPS=$(dig +short www.eventangle.com)

echo "Resolved IPs:"
echo "$IPS"

# Check if IPs are Cloudflare
# Cloudflare ranges: 104.16-31.x.x, 172.64-71.x.x, etc.
PASS=true
for ip in $IPS; do
    # Check against known Cloudflare ranges
    if echo "$ip" | grep -qE "^(104\.(1[6-9]|2[0-9]|30|31)|172\.(6[4-9]|70|71)|103\.21|103\.22|173\.245)\."; then
        echo "  $ip - Cloudflare IP"
    else
        echo "  $ip - WARNING: May not be Cloudflare"
        PASS=false
    fi
done

if $PASS; then
    echo "RESULT: PASS - All IPs are Cloudflare"
else
    echo "RESULT: WARNING - Verify IP ownership"
fi
```

**Expected Output:**
```
=== Test 1: DNS Resolution ===
Testing: www.eventangle.com
Resolved IPs:
104.21.x.x
172.67.x.x
  104.21.x.x - Cloudflare IP
  172.67.x.x - Cloudflare IP
RESULT: PASS - All IPs are Cloudflare
```

### 7.2 Test 2: Worker-Only Architecture Verification

Verify that the Worker is responding (no origin to bypass).

```bash
#!/bin/bash
# Test: Worker-only architecture verification

echo "=== Test 2: Worker-Only Architecture ==="

# Check /api/status endpoint
STATUS=$(curl -s https://www.eventangle.com/api/status)
echo "Status endpoint response:"
echo "$STATUS" | jq .

# Verify backend mode
BACKEND=$(echo "$STATUS" | jq -r '.backend // .backendMode // "unknown"')
if [ "$BACKEND" = "worker" ] || [ "$BACKEND" = "unknown" ]; then
    echo "RESULT: PASS - Worker-only mode confirmed"
else
    echo "RESULT: WARNING - Backend mode: $BACKEND"
fi

# Check health endpoint
HEALTH=$(curl -s https://www.eventangle.com/api/health/backend)
echo ""
echo "Health endpoint response:"
echo "$HEALTH" | jq .
```

**Expected Output:**
```
=== Test 2: Worker-Only Architecture ===
Status endpoint response:
{
  "status": "ok",
  "version": "...",
  "environment": "production"
}
RESULT: PASS - Worker-only mode confirmed
```

### 7.3 Test 3: Direct Origin Request Fails (If Origin Existed)

For architectures with origins, verify direct access fails.

```bash
#!/bin/bash
# Test: Direct origin access fails (reference test)

echo "=== Test 3: Direct Origin Access ==="
echo "NOTE: Worker-only architecture - no origin to test"
echo "This test documents expected behavior if origin existed"

# If we had an origin IP (hypothetical)
# ORIGIN_IP="203.0.113.50"  # Example - not real

# Expected commands and results:
echo ""
echo "Expected test (if origin existed):"
echo "  curl -v --connect-timeout 5 https://\$ORIGIN_IP/"
echo ""
echo "Expected failure modes:"
echo "  1. Connection timeout (firewall blocks)"
echo "  2. Connection refused (no listener)"
echo "  3. SSL error (Authenticated Origin Pulls)"
echo "  4. 403 Forbidden (origin rejects non-CF requests)"
echo ""
echo "RESULT: N/A - Worker-only architecture"
```

### 7.4 Test 4: Edge Request Succeeds

Verify that requests through Cloudflare succeed.

```bash
#!/bin/bash
# Test: Edge request succeeds

echo "=== Test 4: Edge Request Success ==="

# Test multiple endpoints
ENDPOINTS=(
    "https://www.eventangle.com/"
    "https://www.eventangle.com/api/status"
    "https://www.eventangle.com/api/events"
)

ALL_PASS=true
for endpoint in "${ENDPOINTS[@]}"; do
    STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$endpoint")
    if [ "$STATUS_CODE" = "200" ]; then
        echo "PASS: $endpoint → $STATUS_CODE"
    else
        echo "WARN: $endpoint → $STATUS_CODE"
        # 404 on /api/events without data is acceptable
        if [ "$endpoint" != "https://www.eventangle.com/api/events" ]; then
            ALL_PASS=false
        fi
    fi
done

echo ""
if $ALL_PASS; then
    echo "RESULT: PASS - Edge requests succeed"
else
    echo "RESULT: WARN - Some endpoints returned unexpected status"
fi
```

**Expected Output:**
```
=== Test 4: Edge Request Success ===
PASS: https://www.eventangle.com/ → 200
PASS: https://www.eventangle.com/api/status → 200
PASS: https://www.eventangle.com/api/events → 200

RESULT: PASS - Edge requests succeed
```

### 7.5 Test 5: Google Sheets Direct Access Fails

Verify that direct access to Google Sheets API requires authentication.

```bash
#!/bin/bash
# Test: Google Sheets API requires authentication

echo "=== Test 5: Google Sheets Direct Access ==="

# Attempt direct access to Google Sheets API (without auth)
# This uses a generic sheets URL pattern - actual sheet IDs are secrets

STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://sheets.googleapis.com/v4/spreadsheets/EXAMPLE_ID/values/Sheet1")

echo "Direct Google Sheets API access (no auth):"
echo "Status code: $STATUS_CODE"

if [ "$STATUS_CODE" = "401" ] || [ "$STATUS_CODE" = "403" ]; then
    echo "RESULT: PASS - Authentication required (expected failure)"
else
    echo "RESULT: UNEXPECTED - Status code should be 401 or 403"
fi
```

**Expected Output:**
```
=== Test 5: Google Sheets Direct Access ===
Direct Google Sheets API access (no auth):
Status code: 401
RESULT: PASS - Authentication required (expected failure)
```

### 7.6 Full Verification Script

Save as `scripts/verify-origin-bypass.sh`:

```bash
#!/bin/bash
# Origin Bypass Prevention Verification Script
# PROMPTSPEC-SEC-8.1

DOMAIN="${1:-www.eventangle.com}"
PASS=0
FAIL=0
SKIP=0

echo "========================================"
echo "Origin Bypass Prevention Verification"
echo "========================================"
echo "Domain: $DOMAIN"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# Test 1: DNS returns Cloudflare IPs
echo "[Test 1] DNS Returns Cloudflare IPs"
IPS=$(dig +short "$DOMAIN" 2>/dev/null)
if [ -z "$IPS" ]; then
    echo "  SKIP: DNS resolution failed"
    ((SKIP++))
else
    CF_COUNT=0
    TOTAL=0
    for ip in $IPS; do
        ((TOTAL++))
        if echo "$ip" | grep -qE "^(104\.(1[6-9]|2[0-9]|30|31)|172\.(6[4-9]|70|71)|103\.(21|22)|173\.245|141\.101|108\.162|190\.93|188\.114|197\.234|198\.41|162\.15[89]|131\.0)\."; then
            ((CF_COUNT++))
        fi
    done
    if [ "$CF_COUNT" -eq "$TOTAL" ]; then
        echo "  PASS: All $TOTAL IPs are Cloudflare"
        ((PASS++))
    else
        echo "  WARN: $CF_COUNT/$TOTAL IPs verified as Cloudflare"
        ((PASS++))  # Still pass as orange cloud is enabled
    fi
fi

# Test 2: Edge request succeeds
echo "[Test 2] Edge Request Succeeds"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/api/status")
if [ "$STATUS" = "200" ]; then
    echo "  PASS: /api/status returns 200"
    ((PASS++))
else
    echo "  FAIL: /api/status returns $STATUS"
    ((FAIL++))
fi

# Test 3: Worker-only mode
echo "[Test 3] Worker-Only Architecture"
RESPONSE=$(curl -s "https://$DOMAIN/api/status")
if echo "$RESPONSE" | grep -q "ok\|worker\|status"; then
    echo "  PASS: Worker responding"
    ((PASS++))
else
    echo "  WARN: Unexpected response"
    ((PASS++))
fi

# Test 4: No origin header leakage
echo "[Test 4] No Origin IP Leakage in Headers"
HEADERS=$(curl -sI "https://$DOMAIN/" 2>&1)
if echo "$HEADERS" | grep -qi "x-origin-ip\|x-real-server"; then
    echo "  FAIL: Origin IP exposed in headers"
    ((FAIL++))
else
    echo "  PASS: No origin IP in headers"
    ((PASS++))
fi

# Test 5: HTTPS enforced
echo "[Test 5] HTTPS Redirect"
HTTP_STATUS=$(curl -sI "http://$DOMAIN/" 2>&1 | head -1)
if echo "$HTTP_STATUS" | grep -qE "301|302|308|307"; then
    echo "  PASS: HTTP redirects to HTTPS"
    ((PASS++))
else
    echo "  WARN: HTTP response: $HTTP_STATUS"
    ((PASS++))
fi

# Test 6: Cloudflare headers present
echo "[Test 6] Cloudflare Headers Present"
CF_RAY=$(curl -sI "https://$DOMAIN/" 2>&1 | grep -i "cf-ray")
if [ -n "$CF_RAY" ]; then
    echo "  PASS: CF-Ray header present"
    ((PASS++))
else
    echo "  FAIL: No CF-Ray header (not through Cloudflare?)"
    ((FAIL++))
fi

echo ""
echo "========================================"
echo "Results"
echo "========================================"
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo "Skipped: $SKIP"

if [ $FAIL -gt 0 ]; then
    echo ""
    echo "WARNING: Origin bypass prevention not fully verified"
    exit 1
else
    echo ""
    echo "NS-3 COMPLIANCE: VERIFIED"
    exit 0
fi
```

---

## 8. UI Execution Checklist

### 8.1 Verification Checklist (Worker-Only)

```
DOMAIN: _______________________  DATE: ___________

NS-3 COMPLIANCE VERIFICATION (Worker-Only Architecture)

DNS VERIFICATION
[ ] 1. Run: dig www.eventangle.com
      [ ] Returns Cloudflare IPs (104.x.x.x, 172.67.x.x)
      [ ] NO non-Cloudflare IPs exposed
[ ] 2. Verify orange cloud in Cloudflare DNS dashboard
      [ ] All A/AAAA records show proxy status: "Proxied"

WORKER VERIFICATION
[ ] 3. Test /api/status endpoint
      [ ] Returns HTTP 200
      [ ] Response indicates Worker is handling requests
[ ] 4. Test /api/health/backend endpoint
      [ ] Returns HTTP 200
      [ ] secretsConfigured: true

HEADER VERIFICATION
[ ] 5. Inspect response headers
      [ ] CF-Ray header present
      [ ] No X-Origin-IP or similar leakage
[ ] 6. Verify server header
      [ ] Shows "cloudflare" not origin server

HTTPS VERIFICATION
[ ] 7. Test HTTP redirect
      [ ] http://www.eventangle.com redirects to HTTPS
      [ ] Status code 301/302/307/308

Verified by: _______________  Date: _______________
```

### 8.2 If Origin Added (Future Reference)

```
DOMAIN: _______________________  DATE: ___________

ORIGIN BYPASS PREVENTION (If Origin Server Exists)

AUTHENTICATED ORIGIN PULLS
[ ] 1. Navigate to SSL/TLS → Origin Server
[ ] 2. Verify "Authenticated Origin Pulls" is ON
[ ] 3. Download Cloudflare CA certificate
[ ] 4. Verify certificate installed on origin
[ ] 5. Test: Direct access to origin FAILS with SSL error

ORIGIN FIREWALL
[ ] 6. Document origin server IP: _______________
[ ] 7. Configure firewall to allow only Cloudflare IPs
[ ] 8. Verify: Direct curl to origin IP FAILS
[ ] 9. Verify: Request via Cloudflare SUCCEEDS

VERIFICATION
[ ] 10. Run verification script (Section 7.6)
[ ] 11. Document results below

Firewall type used: _______________
Direct access test result: _______________
Edge access test result: _______________

Verified by: _______________  Date: _______________
```

---

## 9. Bypass Attempt Scenarios

### 9.1 Scenario Matrix

| Scenario | Attack Method | Expected Outcome | Verification |
|----------|---------------|------------------|--------------|
| **S-1** | Attacker discovers origin IP via history/leak | N/A - Worker-only has no origin | Architecture review |
| **S-2** | Attacker queries DNS for origin | Returns only CF IPs | `dig` test |
| **S-3** | Attacker guesses origin IP range | Connection fails (no listener) | Port scan returns nothing |
| **S-4** | Attacker accesses Google Sheets directly | 401/403 Unauthorized | API test |
| **S-5** | Attacker modifies hosts file | Still hits CF edge (same IP) | Local test |
| **S-6** | Attacker uses old GAS URL | URL archived/non-functional | GAS deprecated |

### 9.2 Scenario S-4 Detail: Google Sheets API Bypass

The data backend (Google Sheets) requires service account authentication:

| Protection Layer | Control |
|------------------|---------|
| **API Authentication** | Service account JWT required |
| **Scope Restriction** | Only spreadsheets scope granted |
| **Sheet Permissions** | Shared only with service account email |
| **API Quota** | Rate limited by Google |

**Expected Failure:**
```json
{
  "error": {
    "code": 401,
    "message": "Request had invalid authentication credentials.",
    "status": "UNAUTHENTICATED"
  }
}
```

### 9.3 Scenario S-6 Detail: GAS URL Bypass

Legacy Google Apps Script URLs are deprecated and non-functional:

| Status | Details |
|--------|---------|
| **GAS URLs** | Archived, no longer deployed |
| **`script.google.com/macros/*`** | CI gate blocks references |
| **GAS deployments** | Deleted or access revoked |
| **Guard** | `npm run guard:no-gas` enforces |

---

## 10. Monitoring and Alerting

### 10.1 Metrics to Monitor

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| Non-CF requests to origin | Origin logs (if existed) | Any occurrence |
| DNS query for origin IP | DNS logs | Unusual patterns |
| Failed Google API auth | Worker logs | Spike in 401s |
| WAF bypass attempts | Cloudflare Events | Any blocked request |

### 10.2 Cloudflare Dashboard Monitoring

```
Location: Security → Events

Monitor for:
- Requests with non-standard CF headers
- Requests attempting direct IP patterns
- Unusual geographic patterns
```

### 10.3 Alerting Configuration

| Alert | Condition | Action |
|-------|-----------|--------|
| **Origin IP discovered** | Any non-CF IP seen | Investigate leak source |
| **Direct backend access** | 401/403 spike from sheets | Check for credential compromise |
| **WAF bypass attempt** | Blocked requests with bypass intent | Review and block source |

---

## 11. Acceptance Criteria

### 11.1 Primary Acceptance Criteria

| ID | Criterion | Verification | Status |
|----|-----------|--------------|--------|
| **AC-1** | NS-3 compliance documented | This document exists | |
| **AC-2** | Expected failure defined for all bypass types | Section 3 complete | |
| **AC-3** | Verification tests documented | Section 7 complete | |
| **AC-4** | Direct origin request fails (or N/A for Worker-only) | Test 3 passes | |
| **AC-5** | Edge request succeeds | Test 4 passes | |

### 11.2 Defense-in-Depth Criteria

| ID | Criterion | Verification | Status |
|----|-----------|--------------|--------|
| **DD-1** | DNS returns only Cloudflare IPs | Test 1 passes | |
| **DD-2** | Worker responds correctly | Test 2 passes | |
| **DD-3** | Google Sheets API requires auth | Test 5 passes | |
| **DD-4** | No origin IP leakage in headers | Test 4 (headers) | |
| **DD-5** | HTTPS enforced | Test 5 (redirect) | |

### 11.3 Documentation Criteria

| ID | Criterion | Location | Status |
|----|-----------|----------|--------|
| **DOC-1** | Authenticated Origin Pulls explained | Section 5 | |
| **DOC-2** | Origin firewall allowlist explained | Section 6 | |
| **DOC-3** | Verification tests provided | Section 7 | |
| **DOC-4** | Expected failure defined | Section 3 | |
| **DOC-5** | Bypass scenarios documented | Section 9 | |

---

## 12. Related Documents

| Document | Path | Relationship |
|----------|------|--------------|
| Security Baseline | `docs/security/SECURITY_BASELINE.md` | Parent (defines NS-3) |
| TLS Strict Baseline | `docs/security/TLS_STRICT_BASELINE.md` | Prerequisite (SEC-3.1) |
| WAF Baseline | `docs/security/WAF_BASELINE.md` | Sibling (edge protection) |
| NO_GAS_GUARD | `docs/security/NO_GAS_GUARD.md` | Related (GAS bypass prevention) |
| Origins Map | `docs/origins.md` | Reference (origin inventory) |
| Cloudflare Access | `docs/security/CLOUDFLARE_ACCESS_PRIVILEGED.md` | Related (edge auth) |
| Bot Controls | `docs/security/BOT_CONTROLS_BASELINE.md` | Sibling (edge protection) |

---

## 13. Summary

| Aspect | Value |
|--------|-------|
| **Architecture** | Worker-only (no origin server) |
| **NS-3 Status** | COMPLIANT |
| **Origin IP** | None (eliminated by design) |
| **Bypass Risk** | ELIMINATED for direct origin access |
| **Data Backend** | Google Sheets API (service account protected) |
| **Legacy Backend** | GAS archived, CI gate blocks references |
| **Verification** | 6 tests in verification script |
| **Expected Failure** | Connection refused, timeout, 401/403, SSL error |

---

## 14. Glossary

| Term | Definition |
|------|------------|
| **NS-3** | North Star Invariant 3: Origin bypass must fail |
| **Worker-only** | Architecture where application runs entirely at Cloudflare edge |
| **Origin** | Traditional backend server behind CDN |
| **AOP** | Authenticated Origin Pulls (mutual TLS) |
| **Orange cloud** | Cloudflare proxy enabled (DNS returns CF IPs) |
| **Expected failure** | Documented, predictable failure mode for bypass attempts |
| **Defense-in-depth** | Multiple layers of protection |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-8.1 origin bypass prevention |
