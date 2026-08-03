# Runbook: Enforce Strict TLS Configuration

> **Epic SEC-3 — TLS/HTTPS Correctness (no "Flexible", no excuses)**
> Story SEC-3.1 — Enforce TLS "Full (strict)" + Minimum TLS 1.2+
>
> Created: 2025-12-20
> Last Updated: 2025-12-20
> Status: Active

---

## Table of Contents

1. [Overview](#1-overview)
2. [Pre-Requisites](#2-pre-requisites)
3. [SSL/TLS Encryption Mode](#3-ssltls-encryption-mode)
4. [Minimum TLS Version](#4-minimum-tls-version)
5. [Always Use HTTPS](#5-always-use-https)
6. [Verification Checklist](#6-verification-checklist)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Overview

### 1.1 Goal

Remove MITM-friendly configurations by:

- Setting SSL/TLS encryption mode to **Full (strict)**
- Enforcing minimum TLS 1.2 (preferring TLS 1.3)
- Enabling **Always Use HTTPS** to redirect all HTTP traffic

### 1.2 Why This Matters

Weak TLS configurations expose users to serious security risks:

| Configuration         | Risk                                                 | Impact                                      |
| --------------------- | ---------------------------------------------------- | ------------------------------------------- |
| **Flexible SSL**      | Traffic between Cloudflare and origin is unencrypted | MITM attacks at datacenter/ISP level        |
| **Full (non-strict)** | Invalid/expired origin certificates accepted         | Attacker with any certificate can intercept |
| **TLS 1.0/1.1**       | Known vulnerabilities (BEAST, POODLE)                | Session hijacking, data decryption          |
| **No HTTPS redirect** | Users may connect over HTTP                          | Credentials, cookies sent in plaintext      |

**Full (strict) SSL ensures end-to-end encryption with certificate validation.**

### 1.3 Threat Model

| Threat               | Attack Vector                                 | Without Strict TLS             | With Strict TLS |
| -------------------- | --------------------------------------------- | ------------------------------ | --------------- |
| MITM at Origin       | Attacker intercepts Cloudflare→Origin traffic | **VULNERABLE** (Flexible mode) | **PROTECTED**   |
| Certificate Spoofing | Attacker presents invalid certificate         | **VULNERABLE** (Full mode)     | **PROTECTED**   |
| Downgrade Attack     | Force connection to weaker TLS version        | **VULNERABLE** (TLS 1.0/1.1)   | **PROTECTED**   |
| Session Hijacking    | Capture cookies over HTTP                     | **VULNERABLE** (no redirect)   | **PROTECTED**   |
| SSL Stripping        | Intercept HTTP before upgrade                 | **VULNERABLE** (no HSTS)       | **PROTECTED**   |

### 1.4 SSL/TLS Mode Comparison

```
                    SSL/TLS Encryption Modes

┌─────────────────────────────────────────────────────────────────────────┐
│                           OFF (Not Secure)                               │
│   Browser ──────────────────────────────────────────────────► Origin    │
│                         HTTP (plaintext)                                 │
│   ⚠️  NO encryption anywhere - all traffic visible                      │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                        FLEXIBLE (Insecure)                               │
│   Browser ──── HTTPS ────► Cloudflare ──── HTTP ────► Origin            │
│                            (encrypted)      (plaintext!)                 │
│   ⚠️  Traffic between Cloudflare and origin is UNENCRYPTED              │
│   ⚠️  MITM possible at datacenter, cloud provider, or ISP               │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                        FULL (Partially Secure)                           │
│   Browser ──── HTTPS ────► Cloudflare ──── HTTPS ────► Origin           │
│                            (encrypted)      (encrypted)                  │
│   ⚠️  Origin certificate NOT validated (self-signed accepted)           │
│   ⚠️  Attacker with ANY certificate can intercept                       │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                    FULL (STRICT) ✅ Required                             │
│   Browser ──── HTTPS ────► Cloudflare ──── HTTPS ────► Origin           │
│                            (encrypted)      (encrypted + validated)      │
│   ✅  End-to-end encryption                                              │
│   ✅  Origin certificate validated against trusted CA                    │
│   ✅  Protects against MITM at all points                                │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.5 Scope

| Component                             | In Scope |
| ------------------------------------- | -------- |
| SSL/TLS encryption mode setting       | Yes      |
| Minimum TLS version enforcement       | Yes      |
| Always Use HTTPS setting              | Yes      |
| HSTS (HTTP Strict Transport Security) | Yes      |
| Origin certificate validation         | Yes      |
| Mixed content prevention              | Yes      |

---

## 2. Pre-Requisites

### 2.1 Required Access

- [ ] Cloudflare account with domain management access (Super Administrator or Administrator)
- [ ] Origin server with valid SSL certificate installed
- [ ] DNS properly configured in Cloudflare (proxied through Cloudflare)

### 2.2 Required Information

Before starting, gather:

| Information                   | Source                              | Status |
| ----------------------------- | ----------------------------------- | ------ |
| Domain name(s)                | Cloudflare dashboard                |        |
| Current SSL/TLS mode          | Cloudflare → SSL/TLS → Overview     |        |
| Origin certificate type       | Origin server configuration         |        |
| Origin certificate expiration | Origin server or certificate issuer |        |

### 2.3 Origin Certificate Requirements

For **Full (strict)** mode, the origin server MUST have a valid SSL certificate:

| Certificate Type                        | Valid for Full (strict) | Notes                                         |
| --------------------------------------- | ----------------------- | --------------------------------------------- |
| Cloudflare Origin CA                    | ✅ Yes                  | Free, trusted by Cloudflare, 15-year validity |
| Let's Encrypt                           | ✅ Yes                  | Free, 90-day validity, auto-renewal           |
| Commercial CA (DigiCert, Sectigo, etc.) | ✅ Yes                  | Paid, 1-2 year validity                       |
| Self-signed                             | ❌ No                   | Not trusted, use "Full" mode only             |
| Expired certificate                     | ❌ No                   | Connection will fail                          |

### 2.4 Pre-Flight Checks

Before changing SSL/TLS settings, verify:

- [ ] Origin has a valid, non-expired SSL certificate
- [ ] Origin certificate is issued by a trusted CA (or Cloudflare Origin CA)
- [ ] Origin certificate covers all required hostnames (including www)
- [ ] HTTPS works directly on origin (bypass Cloudflare to test)
- [ ] No critical pages rely on HTTP-only resources

> **Warning:** Switching to Full (strict) without a valid origin certificate will cause your site to become inaccessible.

---

## 3. SSL/TLS Encryption Mode

### 3.1 Current SSL Modes in Cloudflare

| Mode              | Description                         | Security Level | Use Case                |
| ----------------- | ----------------------------------- | -------------- | ----------------------- |
| **Off**           | No encryption                       | ❌ None        | Never use               |
| **Flexible**      | Browser→Cloudflare encrypted only   | ❌ Insecure    | Never use               |
| **Full**          | End-to-end encrypted, no validation | ⚠️ Partial     | Legacy/self-signed only |
| **Full (strict)** | End-to-end encrypted + validated    | ✅ **Secure**  | **Required**            |

### 3.2 Check Current Mode

#### Via Cloudflare Dashboard

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your account and domain
3. Navigate to **SSL/TLS** → **Overview**
4. View the current encryption mode

**Current Mode:** [ ] Off / [ ] Flexible / [ ] Full / [ ] Full (strict)

#### Via Cloudflare API

```bash
# Check SSL/TLS settings
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/ssl" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json"

# Expected response for Full (strict):
# {"result":{"id":"ssl","value":"strict"}}
```

### 3.3 Set SSL/TLS Mode to Full (strict)

#### Via Cloudflare Dashboard

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your account and domain
3. Navigate to **SSL/TLS** → **Overview**
4. Under **SSL/TLS encryption mode**, select **Full (strict)**
5. The change takes effect immediately

#### Via Cloudflare API

```bash
# Set SSL/TLS mode to strict
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/ssl" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"value":"strict"}'
```

### 3.4 Cloudflare Origin Certificates

If your origin doesn't have a valid certificate, create a free Cloudflare Origin Certificate:

1. Go to **SSL/TLS** → **Origin Server**
2. Click **Create Certificate**
3. Configure:
   - Hostnames: `oursharedevents.com, *.oursharedevents.com`
   - Certificate validity: 15 years (recommended)
4. Click **Create**
5. Copy the **Origin Certificate** and **Private Key**
6. Install on your origin server

> **Note:** Cloudflare Origin CA certificates are only trusted by Cloudflare. Traffic must proxy through Cloudflare.

---

## 4. Minimum TLS Version

### 4.1 TLS Version Security

| Version | Status     | Known Vulnerabilities | Recommendation        |
| ------- | ---------- | --------------------- | --------------------- |
| SSL 3.0 | Deprecated | POODLE                | **Never use**         |
| TLS 1.0 | Deprecated | BEAST, multiple CVEs  | **Never use**         |
| TLS 1.1 | Deprecated | Multiple CVEs         | **Never use**         |
| TLS 1.2 | Supported  | None critical         | ✅ Minimum acceptable |
| TLS 1.3 | Current    | None                  | ✅ **Preferred**      |

### 4.2 Check Current Minimum TLS Version

#### Via Cloudflare Dashboard

1. Navigate to **SSL/TLS** → **Edge Certificates**
2. Find **Minimum TLS Version** setting
3. View current setting

**Current Minimum:** [ ] TLS 1.0 / [ ] TLS 1.1 / [ ] TLS 1.2 / [ ] TLS 1.3

#### Via Cloudflare API

```bash
# Check minimum TLS version
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/min_tls_version" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json"
```

### 4.3 Set Minimum TLS Version to 1.2

#### Via Cloudflare Dashboard

1. Navigate to **SSL/TLS** → **Edge Certificates**
2. Find **Minimum TLS Version**
3. Select **TLS 1.2** from the dropdown
4. Change takes effect immediately

#### Via Cloudflare API

```bash
# Set minimum TLS version to 1.2
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/min_tls_version" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"value":"1.2"}'
```

### 4.4 Browser Compatibility

Setting minimum TLS 1.2 may affect very old browsers:

| Browser         | TLS 1.2 Support | Market Share |
| --------------- | --------------- | ------------ |
| Chrome 30+      | ✅ Yes          | 99.9%+       |
| Firefox 27+     | ✅ Yes          | 99.9%+       |
| Safari 7+       | ✅ Yes          | 99.9%+       |
| Edge (all)      | ✅ Yes          | 100%         |
| IE 11 (Win 7+)  | ✅ Yes          | Declining    |
| IE 10 and below | ❌ No           | <0.1%        |

> **Note:** TLS 1.2 is supported by 99%+ of internet users. The remaining users are on extremely outdated systems.

### 4.5 Enable TLS 1.3 (Recommended)

TLS 1.3 provides improved security and performance. To enable:

1. Navigate to **SSL/TLS** → **Edge Certificates**
2. Find **TLS 1.3** toggle
3. Ensure it is **Enabled**

> **Note:** TLS 1.3 is enabled by default in Cloudflare. Verify it hasn't been disabled.

---

## 5. Always Use HTTPS

### 5.1 What This Does

**Always Use HTTPS** redirects all HTTP requests to HTTPS:

```
HTTP Request:  http://oursharedevents.com/page
                           │
                           ▼
                  301 Redirect (Cloudflare)
                           │
                           ▼
HTTPS Response: https://oursharedevents.com/page
```

This ensures:

- Users typing `example.com` get redirected to `https://example.com`
- Links using `http://` get upgraded automatically
- Bookmarks using old HTTP URLs continue to work

### 5.2 Check Current Status

#### Via Cloudflare Dashboard

1. Navigate to **SSL/TLS** → **Edge Certificates**
2. Find **Always Use HTTPS** toggle
3. Check current status: [ ] On / [ ] Off

#### Via Cloudflare API

```bash
# Check Always Use HTTPS status
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/always_use_https" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json"
```

### 5.3 Enable Always Use HTTPS

#### Via Cloudflare Dashboard

1. Navigate to **SSL/TLS** → **Edge Certificates**
2. Find **Always Use HTTPS**
3. Toggle to **On**
4. Change takes effect immediately

#### Via Cloudflare API

```bash
# Enable Always Use HTTPS
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/always_use_https" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"value":"on"}'
```

### 5.4 HTTP Strict Transport Security (HSTS)

HSTS adds an additional layer of protection by instructing browsers to always use HTTPS:

#### Enable HSTS

1. Navigate to **SSL/TLS** → **Edge Certificates**
2. Find **HTTP Strict Transport Security (HSTS)**
3. Click **Enable HSTS**
4. Configure settings:
   - **Max Age:** 12 months (recommended: 31536000 seconds)
   - **Include subdomains:** Yes (if all subdomains use HTTPS)
   - **Preload:** Yes (optional, enables browser preloading)
   - **No-Sniff:** Yes (recommended)
5. Acknowledge the warning and enable

> **Warning:** HSTS is cached by browsers. Only enable after confirming HTTPS works for all content. Misconfiguration can lock users out.

### 5.5 HSTS Preload (Optional)

To have your domain included in browser HSTS preload lists:

1. Ensure HSTS is enabled with:
   - `max-age` of at least 31536000 (1 year)
   - `includeSubDomains` enabled
   - `preload` directive enabled
2. Verify at [hstspreload.org](https://hstspreload.org)
3. Submit domain for inclusion

> **Note:** HSTS preload is permanent and difficult to reverse. Only enable if you're certain about HTTPS-only forever.

---

## 6. Verification Checklist

### 6.1 Acceptance Criteria Verification

| Criterion                         | How to Verify                   | Status   |
| --------------------------------- | ------------------------------- | -------- |
| **SSL/TLS mode is Full (strict)** | Dashboard shows "Full (strict)" | [ ] Pass |
| **Minimum TLS 1.2 enforced**      | Dashboard shows TLS 1.2 minimum | [ ] Pass |
| **TLS 1.3 enabled**               | Dashboard shows TLS 1.3 enabled | [ ] Pass |
| **Always Use HTTPS enabled**      | Dashboard toggle is On          | [ ] Pass |
| **HTTP redirects to HTTPS**       | `curl -I http://...` shows 301  | [ ] Pass |
| **No mixed content warnings**     | Browser console clean           | [ ] Pass |

### 6.2 Command-Line Verification

#### Test HTTP to HTTPS Redirect

```bash
# Test HTTP redirect
curl -I http://oursharedevents.com 2>/dev/null | head -5

# Expected output:
# HTTP/1.1 301 Moved Permanently
# Location: https://oursharedevents.com/
```

**Result:** [ ] Pass (301 redirect) / [ ] Fail (200 OK or other)

#### Test HTTPS Connection

```bash
# Test HTTPS and view certificate
curl -vI https://oursharedevents.com 2>&1 | grep -E "(SSL|TLS|subject|issuer|expire)"

# Expected: Valid certificate, TLS 1.2 or 1.3
```

#### Test TLS Version Support

```bash
# Test that TLS 1.3 works
curl --tlsv1.3 -I https://oursharedevents.com 2>/dev/null && echo "TLS 1.3: OK" || echo "TLS 1.3: FAIL"

# Test that TLS 1.2 works
curl --tlsv1.2 -I https://oursharedevents.com 2>/dev/null && echo "TLS 1.2: OK" || echo "TLS 1.2: FAIL"

# Test that TLS 1.1 is rejected (should fail)
curl --tlsv1.1 --tls-max 1.1 -I https://oursharedevents.com 2>/dev/null && echo "TLS 1.1: ALLOWED (BAD)" || echo "TLS 1.1: Rejected (GOOD)"

# Test that TLS 1.0 is rejected (should fail)
curl --tlsv1.0 --tls-max 1.0 -I https://oursharedevents.com 2>/dev/null && echo "TLS 1.0: ALLOWED (BAD)" || echo "TLS 1.0: Rejected (GOOD)"
```

### 6.3 SSL Labs Test

Run a comprehensive SSL/TLS test:

1. Go to [SSL Labs Server Test](https://www.ssllabs.com/ssltest/)
2. Enter your domain: `oursharedevents.com`
3. Wait for analysis (2-3 minutes)
4. Review results

**Expected Results:**

- Overall rating: **A** or **A+**
- Protocol support: TLS 1.2, TLS 1.3 only
- No warnings for weak configurations

**Result:** [ ] A/A+ / [ ] B or lower (needs improvement)

### 6.4 Mixed Content Check

Mixed content occurs when HTTPS pages load HTTP resources (images, scripts, etc.):

#### Browser Console Check

1. Open your website in Chrome/Firefox
2. Open Developer Tools (F12)
3. Go to Console tab
4. Look for mixed content warnings:
   - "Mixed Content: The page was loaded over HTTPS, but requested an insecure..."

**Result:** [ ] No warnings / [ ] Warnings present (fix required)

#### Automated Check

```bash
# Use curl to check for HTTP resources in page source
curl -s https://oursharedevents.com | grep -E "http://" | grep -v "https://" | head -20
```

If output shows HTTP URLs (not protocol-relative or https), fix the content.

### 6.5 Verification Test Script

```bash
#!/bin/bash
# TLS Configuration Verification Script
DOMAIN="oursharedevents.com"

echo "=== TLS Configuration Verification for $DOMAIN ==="
echo ""

# Test 1: HTTP Redirect
echo "1. Testing HTTP to HTTPS redirect..."
REDIRECT=$(curl -s -o /dev/null -w "%{http_code}" -I "http://$DOMAIN")
if [ "$REDIRECT" = "301" ] || [ "$REDIRECT" = "302" ]; then
    echo "   ✅ PASS: HTTP redirects to HTTPS ($REDIRECT)"
else
    echo "   ❌ FAIL: HTTP does not redirect (got $REDIRECT)"
fi
echo ""

# Test 2: HTTPS Works
echo "2. Testing HTTPS connection..."
HTTPS_CODE=$(curl -s -o /dev/null -w "%{http_code}" -I "https://$DOMAIN")
if [ "$HTTPS_CODE" = "200" ]; then
    echo "   ✅ PASS: HTTPS returns 200 OK"
else
    echo "   ❌ FAIL: HTTPS returned $HTTPS_CODE"
fi
echo ""

# Test 3: TLS 1.2 Works
echo "3. Testing TLS 1.2 support..."
if curl -s --tlsv1.2 -o /dev/null -I "https://$DOMAIN" 2>/dev/null; then
    echo "   ✅ PASS: TLS 1.2 supported"
else
    echo "   ❌ FAIL: TLS 1.2 not working"
fi
echo ""

# Test 4: TLS 1.3 Works
echo "4. Testing TLS 1.3 support..."
if curl -s --tlsv1.3 -o /dev/null -I "https://$DOMAIN" 2>/dev/null; then
    echo "   ✅ PASS: TLS 1.3 supported"
else
    echo "   ⚠️ WARNING: TLS 1.3 not supported (may be OK)"
fi
echo ""

# Test 5: TLS 1.1 Rejected
echo "5. Testing TLS 1.1 is rejected..."
if curl -s --tlsv1.1 --tls-max 1.1 -o /dev/null -I "https://$DOMAIN" 2>/dev/null; then
    echo "   ❌ FAIL: TLS 1.1 is still allowed"
else
    echo "   ✅ PASS: TLS 1.1 correctly rejected"
fi
echo ""

# Test 6: Certificate Valid
echo "6. Testing certificate validity..."
CERT_INFO=$(echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -dates 2>/dev/null)
if [ -n "$CERT_INFO" ]; then
    echo "   ✅ PASS: Certificate valid"
    echo "$CERT_INFO" | sed 's/^/      /'
else
    echo "   ❌ FAIL: Could not verify certificate"
fi
echo ""

echo "=== Verification Complete ==="
```

---

## 7. Troubleshooting

### 7.1 Site Not Loading After Enabling Full (strict)

| Symptom                     | Cause                              | Solution                                  |
| --------------------------- | ---------------------------------- | ----------------------------------------- |
| 525 SSL Handshake Failed    | Origin has no SSL certificate      | Install origin certificate                |
| 526 Invalid SSL Certificate | Origin certificate expired/invalid | Renew or replace certificate              |
| 526 Invalid SSL Certificate | Self-signed certificate            | Use Cloudflare Origin CA or Let's Encrypt |
| 526 Invalid SSL Certificate | Hostname mismatch                  | Ensure cert covers the hostname           |

**Emergency Recovery:**
If site is down, temporarily switch to **Full** mode while fixing origin certificate:

1. SSL/TLS → Overview → Select **Full**
2. Fix origin certificate
3. Return to **Full (strict)**

### 7.2 TLS Connection Errors

| Error                              | Likely Cause               | Solution                         |
| ---------------------------------- | -------------------------- | -------------------------------- |
| ERR_SSL_VERSION_OR_CIPHER_MISMATCH | Old browser/client         | User needs to update browser     |
| SSL_ERROR_NO_CYPHER_OVERLAP        | Incompatible cipher suites | Check Cloudflare cipher settings |
| TLSV1_ALERT_PROTOCOL_VERSION       | Client using TLS 1.0/1.1   | Client needs to upgrade          |

### 7.3 Mixed Content Issues

| Content Type                             | How to Fix                                  |
| ---------------------------------------- | ------------------------------------------- |
| Images (`<img src="http://...">`)        | Update to HTTPS or protocol-relative (`//`) |
| Scripts (`<script src="http://...">`)    | Update to HTTPS                             |
| Stylesheets (`<link href="http://...">`) | Update to HTTPS                             |
| iframes                                  | Update to HTTPS or remove                   |
| Third-party resources                    | Use HTTPS version or find alternative       |

**Quick Fix for Cloudflare:**
Enable **Automatic HTTPS Rewrites** to automatically fix mixed content:

1. SSL/TLS → Edge Certificates
2. Enable **Automatic HTTPS Rewrites**

> **Note:** This only fixes links in HTML. CSS/JS may need manual updates.

### 7.4 HSTS Issues

| Issue                   | Solution                                |
| ----------------------- | --------------------------------------- |
| Locked out of HTTP      | Wait for HSTS cache to expire (max-age) |
| Browser cached bad HSTS | Clear browser cache/HSTS settings       |
| Want to disable HSTS    | Set max-age to 0, wait for propagation  |

**Clear HSTS in Chrome:**

1. Navigate to `chrome://net-internals/#hsts`
2. Enter domain in "Delete domain security policies"
3. Click "Delete"

### 7.5 Origin Certificate Issues

| Issue                     | Solution                                      |
| ------------------------- | --------------------------------------------- |
| Certificate expired       | Renew certificate (Let's Encrypt auto-renews) |
| Wrong hostname            | Generate new certificate with correct SANs    |
| Certificate not installed | Install certificate on web server             |
| Private key mismatch      | Regenerate certificate and key                |

**Verify Origin Certificate:**

```bash
# Check certificate directly on origin (bypassing Cloudflare)
openssl s_client -connect origin.example.com:443 -servername oursharedevents.com </dev/null 2>/dev/null | openssl x509 -noout -text | grep -E "(Subject:|Issuer:|Not Before:|Not After:)"
```

---

## Appendix A: Cloudflare API Reference

### Settings Endpoints

| Setting          | Endpoint                                     | Values                      |
| ---------------- | -------------------------------------------- | --------------------------- |
| SSL Mode         | `/zones/{zone_id}/settings/ssl`              | off, flexible, full, strict |
| Min TLS Version  | `/zones/{zone_id}/settings/min_tls_version`  | 1.0, 1.1, 1.2, 1.3          |
| Always Use HTTPS | `/zones/{zone_id}/settings/always_use_https` | on, off                     |
| TLS 1.3          | `/zones/{zone_id}/settings/tls_1_3`          | on, off, zrt                |
| HSTS             | `/zones/{zone_id}/settings/security_header`  | (complex object)            |

### Example: Full Configuration Script

```bash
#!/bin/bash
# Configure strict TLS settings for a zone
ZONE_ID="your-zone-id"
TOKEN="your-api-token"

# Set SSL to strict
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/ssl" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"value":"strict"}'

# Set minimum TLS version
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/min_tls_version" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"value":"1.2"}'

# Enable Always Use HTTPS
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/always_use_https" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"value":"on"}'

echo "TLS configuration complete"
```

---

## Appendix B: SSL/TLS Quick Reference

### Check Current Configuration

```bash
# All TLS settings at once (requires jq)
curl -s "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings" \
  -H "Authorization: Bearer $TOKEN" | \
  jq '.result[] | select(.id | test("ssl|tls|https")) | {id, value}'
```

### Cipher Suites (Advanced)

Cloudflare uses strong cipher suites by default. To restrict further:

1. SSL/TLS → Edge Certificates → Cipher Suites
2. Review available suites
3. Disable weak ciphers if any are enabled

Recommended cipher suites:

- `TLS_AES_256_GCM_SHA384` (TLS 1.3)
- `TLS_CHACHA20_POLY1305_SHA256` (TLS 1.3)
- `TLS_AES_128_GCM_SHA256` (TLS 1.3)
- `ECDHE-RSA-AES128-GCM-SHA256` (TLS 1.2)
- `ECDHE-RSA-AES256-GCM-SHA384` (TLS 1.2)

---

## Appendix C: Compliance Requirements

### PCI-DSS

PCI-DSS 3.2.1+ requires:

- TLS 1.1 minimum (TLS 1.2+ recommended)
- Strong cipher suites only
- No SSL 3.0

**Full (strict) + TLS 1.2 minimum satisfies PCI-DSS requirements.**

### HIPAA

HIPAA requires encryption of ePHI in transit:

- TLS 1.2+ recommended
- Strong authentication of endpoints

**Full (strict) + TLS 1.2 minimum satisfies HIPAA encryption requirements.**

### SOC 2

SOC 2 requires:

- Encryption of data in transit
- Protection against unauthorized access

**Full (strict) mode with HTTPS enforcement satisfies SOC 2 requirements.**

---

## Document History

| Date       | Author      | Changes                   |
| ---------- | ----------- | ------------------------- |
| 2025-12-20 | Claude Code | Initial runbook (SEC-3.1) |

---

## Related Documentation

- [RUNBOOK-SEC-2.1-REGISTRAR-LOCK-MFA.md](./RUNBOOK-SEC-2.1-REGISTRAR-LOCK-MFA.md) - Domain Hijack Prevention (SEC-2.1)
- [RUNBOOK-SEC-2.2-DNSSEC.md](./RUNBOOK-SEC-2.2-DNSSEC.md) - DNSSEC Configuration (SEC-2.2)
- [RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md](./RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md) - Scoped API Tokens (SEC-1.2)
- [Cloudflare SSL/TLS Documentation](https://developers.cloudflare.com/ssl/)
- [SSL Labs Best Practices](https://github.com/ssllabs/research/wiki/SSL-and-TLS-Deployment-Best-Practices)
