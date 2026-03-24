# TLS_STRICT_BASELINE.md — TLS/HTTPS Strict Configuration

> **PROMPTSPEC-SEC-3.1** — TLS Strict Baseline
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Define and enforce strict TLS/HTTPS configuration to protect all traffic between clients and Cloudflare edge, and optionally between Cloudflare and origin servers.

| Attribute | Value |
|-----------|-------|
| **Scope** | TLS configuration for all production domains |
| **Prerequisites** | Domain using Cloudflare proxy (orange cloud) |
| **Constraints** | Worker-only architecture has no origin; origin cert section applies only if origin exists |

---

## 2. TLS Mode Overview

### 2.1 Cloudflare SSL/TLS Modes

| Mode | Client → Edge | Edge → Origin | Security Level | Status |
|------|---------------|---------------|----------------|--------|
| **Off** | HTTP only | HTTP only | **UNACCEPTABLE** | 🚫 PROHIBITED |
| **Flexible** | HTTPS | HTTP | **DANGEROUS** | 🚫 PROHIBITED |
| **Full** | HTTPS | HTTPS (any cert) | **INSUFFICIENT** | ⚠️ NOT RECOMMENDED |
| **Full (Strict)** | HTTPS | HTTPS (valid cert) | **REQUIRED** | ✅ MANDATORY |
| **Strict (SSL-Only Origin Pull)** | HTTPS | HTTPS (CF origin cert) | **IDEAL** | ✅ RECOMMENDED |

### 2.2 Why Full (Strict) is Required

```
FLEXIBLE MODE (PROHIBITED):
┌─────────┐    HTTPS     ┌───────────┐    HTTP      ┌────────┐
│ Browser │ ──────────▶  │ Cloudflare│ ──────────▶  │ Origin │
└─────────┘   (secure)   └───────────┘  (INSECURE!) └────────┘
                                              ▲
                                              │
                               Man-in-the-middle attack possible!

FULL (STRICT) MODE (REQUIRED):
┌─────────┐    HTTPS     ┌───────────┐    HTTPS     ┌────────┐
│ Browser │ ──────────▶  │ Cloudflare│ ──────────▶  │ Origin │
└─────────┘   (secure)   └───────────┘   (secure)   └────────┘
                                              ▲
                                              │
                               Certificate validated!
```

---

## 3. Prohibited Practices

These configurations are **strictly prohibited** and must be remediated immediately if discovered.

| ID | Practice | Reason | Risk | Remediation |
|----|----------|--------|------|-------------|
| **P-1** | **Flexible SSL mode is prohibited** | Allows MITM between Cloudflare and origin | **CRITICAL** | Switch to Full (Strict) immediately |
| **P-2** | **Off (no encryption) is prohibited** | All traffic exposed in plaintext | **CRITICAL** | Enable Full (Strict) immediately |
| **P-3** | TLS 1.0 or 1.1 enabled | Deprecated protocols with known vulnerabilities | **HIGH** | Set Minimum TLS Version to 1.2 |
| **P-4** | HTTP allowed without redirect | Allows unencrypted connections | **HIGH** | Enable "Always Use HTTPS" |
| **P-5** | Self-signed origin certs with Full mode | No certificate validation | **MEDIUM** | Use Full (Strict) with valid origin cert |
| **P-6** | Expired origin certificates | Full (Strict) will fail, may tempt Flexible fallback | **MEDIUM** | Renew origin cert or use Cloudflare Origin CA |

> **CRITICAL:** Flexible SSL mode is **BANNED**. Any zone configured with Flexible mode must be immediately migrated to Full (Strict). This is non-negotiable — Flexible mode provides a false sense of security while allowing origin traffic interception.

---

## 4. Required Settings

### 4.1 Mandatory Configuration

| Setting | Required Value | Location |
|---------|----------------|----------|
| **SSL/TLS encryption mode** | Full (Strict) | SSL/TLS → Overview |
| **Minimum TLS Version** | TLS 1.2 | SSL/TLS → Edge Certificates |
| **Always Use HTTPS** | ON | SSL/TLS → Edge Certificates |
| **Automatic HTTPS Rewrites** | ON | SSL/TLS → Edge Certificates |
| **TLS 1.3** | ON | SSL/TLS → Edge Certificates |

### 4.2 Recommended Configuration

| Setting | Recommended Value | Location | Notes |
|---------|-------------------|----------|-------|
| **Opportunistic Encryption** | ON | SSL/TLS → Edge Certificates | HTTP/2 upgrade |
| **Authenticated Origin Pulls** | ON | SSL/TLS → Origin Server | Mutual TLS (if origin exists) |
| **Certificate Transparency Monitoring** | ON | SSL/TLS → Edge Certificates | Monitor for mis-issuance |

### 4.3 Worker-Only Architecture Note

For systems using **Worker-only architecture** (no origin server):

| Setting | Value | Notes |
|---------|-------|-------|
| SSL/TLS Mode | Full (Strict) | Still required — applies to any fetch() to external origins |
| Origin certificates | N/A | No origin to protect |
| Authenticated Origin Pulls | N/A | No origin to authenticate |

> Even in Worker-only mode, maintain Full (Strict) to ensure any future origin additions inherit correct settings and to prevent accidental misconfiguration.

---

## 5. Origin Certificate Expectations

### 5.1 If Origin Exists

Origins behind Cloudflare with Full (Strict) mode must use one of:

| Certificate Type | Validity | Best For | Notes |
|------------------|----------|----------|-------|
| **Cloudflare Origin CA** | 15 years | Cloudflare-only origins | Free, long-lived, only trusted by CF |
| **Public CA (Let's Encrypt, etc.)** | 90 days | Multi-CDN or direct access | Requires renewal automation |
| **Commercial CA** | 1-2 years | Compliance requirements | May require purchase |

### 5.2 Cloudflare Origin CA Setup (Recommended)

If origin exists, use Cloudflare Origin CA certificates:

| Step | Action | Location |
|------|--------|----------|
| 1 | Navigate to SSL/TLS → Origin Server | Cloudflare Dashboard |
| 2 | Click **Create Certificate** | Origin Certificates section |
| 3 | Select RSA (2048) or ECDSA | Key type dropdown |
| 4 | Enter hostnames (e.g., `*.example.com, example.com`) | Hostnames field |
| 5 | Select validity period (15 years max) | Certificate Validity dropdown |
| 6 | Download certificate and private key | **Save immediately — key shown once!** |
| 7 | Install on origin server | See origin server documentation |

### 5.3 Origin Certificate Validation

Full (Strict) mode requires the origin certificate to:

| Requirement | Check |
|-------------|-------|
| Valid (not expired) | Certificate dates cover current time |
| Matching hostname | CN or SAN matches requested hostname |
| Trusted chain | Signed by CA in Cloudflare trust store (or CF Origin CA) |
| Correct key usage | Server authentication EKU |

### 5.4 If No Origin Exists (Worker-Only)

| Requirement | Status |
|-------------|--------|
| Origin certificates | **Not applicable** — Workers execute at edge |
| Authenticated Origin Pulls | **Not applicable** — No origin to authenticate |
| SSL Mode setting | **Still required** — Set to Full (Strict) for defense in depth |

---

## 6. UI Execution Checklist

Complete this checklist in the Cloudflare dashboard to enforce TLS strict baseline.

### 6.1 Initial Configuration

```
DOMAIN: _______________________  DATE: ___________

SSL/TLS OVERVIEW
[ ] 1. Navigate to SSL/TLS → Overview
[ ] 2. Verify SSL/TLS encryption mode is "Full (strict)"
      → If "Flexible" or "Off": Change immediately (CRITICAL)
      → If "Full" (not strict): Upgrade to "Full (strict)"
[ ] 3. Document current mode: ___________

EDGE CERTIFICATES
[ ] 4. Navigate to SSL/TLS → Edge Certificates
[ ] 5. Verify "Always Use HTTPS" is ON
      → If OFF: Toggle ON
[ ] 6. Verify "Minimum TLS Version" is 1.2 or higher
      → If 1.0 or 1.1: Change to 1.2
[ ] 7. Verify "TLS 1.3" is ON (if available)
      → If OFF: Toggle ON (recommended)
[ ] 8. Verify "Automatic HTTPS Rewrites" is ON
      → If OFF: Toggle ON

ORIGIN SERVER (if origin exists)
[ ] 9. Navigate to SSL/TLS → Origin Server
[ ] 10. Verify origin certificate is installed and valid
[ ] 11. Verify "Authenticated Origin Pulls" is ON (recommended)
      → If OFF: Enable for mutual TLS
[ ] 12. If no origin certificate: Create Cloudflare Origin CA cert

VERIFICATION
[ ] 13. Run curl tests (Section 7)
[ ] 14. Document test results: PASS / FAIL
```

### 6.2 Configuration Summary

After completing the checklist, your settings should be:

| Setting | Expected Value |
|---------|----------------|
| SSL/TLS Mode | Full (strict) |
| Always Use HTTPS | ON |
| Minimum TLS Version | TLS 1.2 |
| TLS 1.3 | ON |
| Automatic HTTPS Rewrites | ON |

---

## 7. Verification Tests

### 7.1 HTTPS Redirect Test

Verify HTTP requests redirect to HTTPS:

```bash
# Test HTTP → HTTPS redirect
curl -sI http://www.eventangle.com 2>&1 | head -20

# Expected output should include:
# HTTP/1.1 301 Moved Permanently
# Location: https://www.eventangle.com/
# (or HTTP/2 301 with same Location header)

# Verify the redirect with follow
curl -sIL http://www.eventangle.com 2>&1 | grep -E "^(HTTP|Location:)"

# Expected: First response 301/302, final response 200 on HTTPS
```

### 7.2 TLS Version Test

Verify minimum TLS version enforcement:

```bash
# Test TLS 1.0 (should FAIL if properly configured)
curl -sI --tlsv1.0 --tls-max 1.0 https://www.eventangle.com 2>&1

# Expected: Connection failure or SSL error
# Example: "error:1409442E:SSL routines:ssl3_read_bytes:tlsv1 alert protocol version"

# Test TLS 1.1 (should FAIL if properly configured)
curl -sI --tlsv1.1 --tls-max 1.1 https://www.eventangle.com 2>&1

# Expected: Connection failure or SSL error

# Test TLS 1.2 (should SUCCEED)
curl -sI --tlsv1.2 https://www.eventangle.com 2>&1 | head -5

# Expected: HTTP/2 200 (or HTTP/1.1 200)

# Test TLS 1.3 (should SUCCEED if enabled)
curl -sI --tlsv1.3 https://www.eventangle.com 2>&1 | head -5

# Expected: HTTP/2 200 (or HTTP/1.1 200)
```

### 7.3 Certificate Information

Verify certificate details:

```bash
# Check certificate details
curl -vI https://www.eventangle.com 2>&1 | grep -E "(subject:|issuer:|expire|SSL connection)"

# Expected output includes:
# * SSL connection using TLSv1.3 / ...
# * subject: CN=eventangle.com (or similar)
# * issuer: C=US; O=Cloudflare, Inc.; CN=Cloudflare Inc ECC CA-3 (or similar)
# * expire date: [future date]

# Alternative: OpenSSL for detailed check
echo | openssl s_client -connect www.eventangle.com:443 -servername www.eventangle.com 2>/dev/null | openssl x509 -noout -dates -subject -issuer

# Expected: Valid certificate with future expiry
```

### 7.4 Full Verification Script

Save as `scripts/verify-tls-baseline.sh`:

```bash
#!/bin/bash
# TLS Strict Baseline Verification Script
# Usage: ./verify-tls-baseline.sh [domain]

DOMAIN="${1:-www.eventangle.com}"
PASS=0
FAIL=0

echo "=== TLS Strict Baseline Verification ==="
echo "Domain: $DOMAIN"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# Test 1: HTTPS redirect
echo "[Test 1] HTTP → HTTPS Redirect"
REDIRECT=$(curl -sI "http://$DOMAIN" 2>&1 | head -1)
if echo "$REDIRECT" | grep -qE "301|302|308"; then
    echo "  ✓ PASS: HTTP redirects to HTTPS"
    ((PASS++))
else
    echo "  ✗ FAIL: HTTP does not redirect (got: $REDIRECT)"
    ((FAIL++))
fi

# Test 2: TLS 1.0 blocked
echo "[Test 2] TLS 1.0 Blocked"
TLS10=$(curl -sI --tlsv1.0 --tls-max 1.0 "https://$DOMAIN" 2>&1)
if echo "$TLS10" | grep -qiE "(error|alert|failed|refused)"; then
    echo "  ✓ PASS: TLS 1.0 rejected"
    ((PASS++))
else
    echo "  ✗ FAIL: TLS 1.0 accepted (should be blocked)"
    ((FAIL++))
fi

# Test 3: TLS 1.1 blocked
echo "[Test 3] TLS 1.1 Blocked"
TLS11=$(curl -sI --tlsv1.1 --tls-max 1.1 "https://$DOMAIN" 2>&1)
if echo "$TLS11" | grep -qiE "(error|alert|failed|refused)"; then
    echo "  ✓ PASS: TLS 1.1 rejected"
    ((PASS++))
else
    echo "  ✗ FAIL: TLS 1.1 accepted (should be blocked)"
    ((FAIL++))
fi

# Test 4: TLS 1.2 works
echo "[Test 4] TLS 1.2 Accepted"
TLS12=$(curl -sI --tlsv1.2 "https://$DOMAIN" 2>&1 | head -1)
if echo "$TLS12" | grep -qE "HTTP.*200"; then
    echo "  ✓ PASS: TLS 1.2 works"
    ((PASS++))
else
    echo "  ✗ FAIL: TLS 1.2 failed (got: $TLS12)"
    ((FAIL++))
fi

# Test 5: TLS 1.3 works (if supported by curl)
echo "[Test 5] TLS 1.3 Accepted"
TLS13=$(curl -sI --tlsv1.3 "https://$DOMAIN" 2>&1 | head -1)
if echo "$TLS13" | grep -qE "HTTP.*200"; then
    echo "  ✓ PASS: TLS 1.3 works"
    ((PASS++))
elif echo "$TLS13" | grep -qE "option.*tlsv1.3"; then
    echo "  ⊘ SKIP: curl does not support TLS 1.3 flag"
else
    echo "  ✗ FAIL: TLS 1.3 failed (got: $TLS13)"
    ((FAIL++))
fi

# Test 6: Valid certificate
echo "[Test 6] Valid Certificate"
CERT_CHECK=$(echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -checkend 86400 2>&1)
if [ $? -eq 0 ]; then
    echo "  ✓ PASS: Certificate valid for at least 24 hours"
    ((PASS++))
else
    echo "  ✗ FAIL: Certificate expires within 24 hours or is invalid"
    ((FAIL++))
fi

echo ""
echo "=== Results ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"

if [ $FAIL -gt 0 ]; then
    echo ""
    echo "⚠️  BASELINE NOT MET - Review failed tests"
    exit 1
else
    echo ""
    echo "✓ TLS BASELINE VERIFIED"
    exit 0
fi
```

### 7.5 Quick Verification Commands

```bash
# One-liner HTTPS redirect check
curl -sI http://www.eventangle.com | grep -E "^(HTTP|Location)"

# One-liner TLS version check
curl -sI --tlsv1.2 https://www.eventangle.com | head -1

# One-liner certificate check
echo | openssl s_client -connect www.eventangle.com:443 2>/dev/null | openssl x509 -noout -dates
```

---

## 8. Failure Modes

### 8.1 Common Issues

| Symptom | Likely Cause | Resolution |
|---------|--------------|------------|
| 525 SSL Handshake Failed | Origin cert invalid/expired/missing | Install valid origin cert; use Cloudflare Origin CA |
| 526 Invalid SSL Certificate | Origin cert not trusted by Cloudflare | Use Cloudflare Origin CA or public CA cert |
| HTTP works but no redirect | "Always Use HTTPS" is OFF | Enable "Always Use HTTPS" in Edge Certificates |
| TLS 1.0/1.1 still accepted | Minimum TLS Version not set | Set Minimum TLS Version to 1.2 in Edge Certificates |
| Mixed content warnings | Automatic HTTPS Rewrites OFF | Enable Automatic HTTPS Rewrites |
| ERR_SSL_VERSION_OR_CIPHER_MISMATCH | Client uses deprecated TLS | This is expected — old clients should upgrade |

### 8.2 Error 525/526 Resolution

If Full (Strict) causes 525/526 errors:

```
DO NOT SWITCH TO FLEXIBLE MODE!

Instead:
1. Check origin certificate validity
2. Verify origin certificate matches hostname
3. Verify origin certificate chain is complete
4. Install Cloudflare Origin CA certificate
5. Verify origin server is listening on 443
```

### 8.3 Rollback Considerations

> **WARNING:** There is no safe rollback to Flexible mode. If Full (Strict) is failing, the solution is to fix the origin certificate, not to weaken TLS security.

If you must temporarily access the origin during certificate issues:

1. Create a Cloudflare Origin CA certificate (immediate)
2. Install on origin (may require brief downtime)
3. Verify with curl to origin directly (if accessible)
4. Test via Cloudflare

---

## 9. Compliance Verification

### 9.1 Manual Confirmation Checklist

A security reviewer can verify compliance by answering these questions:

| # | Question | Expected Answer | How to Verify |
|---|----------|-----------------|---------------|
| 1 | What is the SSL/TLS mode? | Full (strict) | SSL/TLS → Overview |
| 2 | Is Flexible mode in use? | **NO** | SSL/TLS → Overview (not showing "Flexible") |
| 3 | Is "Always Use HTTPS" enabled? | Yes | SSL/TLS → Edge Certificates |
| 4 | What is the minimum TLS version? | 1.2 or higher | SSL/TLS → Edge Certificates |
| 5 | Is TLS 1.3 enabled? | Yes | SSL/TLS → Edge Certificates |
| 6 | Do curl tests pass? | All tests pass | Run Section 7 verification |

### 9.2 Compliance Summary

| Control | Compliant | Non-Compliant |
|---------|-----------|---------------|
| SSL/TLS Mode | Full (strict) | Off, Flexible, or Full (not strict) |
| HTTPS Redirect | Always Use HTTPS: ON | Redirect disabled |
| Minimum TLS | 1.2 or higher | 1.0 or 1.1 allowed |
| TLS 1.3 | Enabled | Disabled (allowed but not recommended) |
| Origin Certificate | Valid, trusted | Expired, self-signed without strict mode |

---

## 10. Related Documents

| Document | Path | Relationship |
|----------|------|--------------|
| Security Baseline | `docs/security/SECURITY_BASELINE.md` | Parent security model |
| Cloudflare Account Hardening | `docs/security/CF_ACCOUNT_HARDENING_RUNBOOK.md` | Account security |
| HSTS Policy | PROMPTSPEC-SEC-3.2 (pending) | Complementary (HSTS headers) |
| Registrar Hardening | `docs/security/REGISTRAR_HARDENING_CHECKLIST.md` | Domain protection |
| DNSSEC Runbook | `docs/security/DNSSEC_RUNBOOK.md` | DNS integrity |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-3.1 TLS strict baseline |
