# Runbook: HSTS Phased Rollout

> **Epic SEC-3 — TLS/HTTPS Correctness**
> Story SEC-3.2 — Enable HSTS (Phased Rollout)
>
> Created: 2025-12-20
> Last Updated: 2025-12-20
> Status: Active

---

## Table of Contents

1. [Overview](#1-overview)
2. [Pre-Requisites](#2-pre-requisites)
3. [Phase 1: Conservative (5 Minutes)](#3-phase-1-conservative-5-minutes)
4. [Phase 2: Extended (1 Week)](#4-phase-2-extended-1-week)
5. [Phase 3: Standard (6 Months)](#5-phase-3-standard-6-months)
6. [Phase 4: Production (1 Year)](#6-phase-4-production-1-year)
7. [Phase 5: Preload (Permanent)](#7-phase-5-preload-permanent)
8. [Verification Checklist](#8-verification-checklist)
9. [Rollback Procedures](#9-rollback-procedures)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Overview

### 1.1 Goal

Enable HTTP Strict Transport Security (HSTS) with a phased rollout approach:

- Start with conservative `max-age` to minimize risk
- Gradually increase `max-age` after verified stability
- Only consider preload after extended stability period

### 1.2 What is HSTS?

HSTS instructs browsers to **only** use HTTPS for a domain, even if the user types `http://`:

```
Browser Request: http://oursharedevents.com
                           │
                           ▼
                  Browser checks HSTS cache
                           │
              ┌────────────┴────────────┐
              │                         │
        HSTS cached               No HSTS cached
              │                         │
              ▼                         ▼
     Internal 307 redirect      Normal HTTP request
     to https://...             (server redirects)
              │                         │
              └──────────┬──────────────┘
                         ▼
               https://oursharedevents.com
                         │
                         ▼
              Response includes HSTS header
              Strict-Transport-Security: max-age=...
                         │
                         ▼
              Browser caches HSTS policy
              for max-age seconds
```

### 1.3 Why Phased Rollout?

HSTS misconfiguration can **lock users out** of your site:

| Scenario                                      | Risk                                 | Impact                             |
| --------------------------------------------- | ------------------------------------ | ---------------------------------- |
| HTTPS breaks after HSTS enabled               | Users cannot access HTTP fallback    | Site completely inaccessible       |
| Subdomain without HTTPS + `includeSubDomains` | All subdomains forced to HTTPS       | Non-HTTPS subdomains break         |
| Preload with configuration issues             | Browsers refuse HTTP for years       | Cannot easily undo                 |
| Long max-age with broken HTTPS                | Users locked out for extended period | Recovery requires user cache clear |

**Conservative max-age = Fast recovery if issues arise**

### 1.4 HSTS Header Breakdown

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
                           │                  │                  │
                           │                  │                  └─ Submit to browser preload list
                           │                  └─ Apply to all subdomains
                           └─ Time in seconds to remember this policy
```

| Directive           | Purpose                               | Caution Level                        |
| ------------------- | ------------------------------------- | ------------------------------------ |
| `max-age`           | How long browsers remember HTTPS-only | Start small, increase gradually      |
| `includeSubDomains` | Apply to all subdomains               | Only if ALL subdomains use HTTPS     |
| `preload`           | Browser ships with HTTPS-only         | **ONE-WAY DOOR** - very hard to undo |

### 1.5 Rollout Timeline

```
Phase 1          Phase 2         Phase 3          Phase 4         Phase 5
5 min            1 week          6 months         1 year          Preload
│                │               │                │               │
├────Day 1───────┼───Week 2──────┼───Week 4───────┼───Month 3─────┼───Month 6+──►
│                │               │                │               │
└─ Quick         └─ Verify       └─ Confidence    └─ Standard     └─ Permanent
   recovery         stability       building         production      (optional)
```

### 1.6 Scope

| Component                    | In Scope |
| ---------------------------- | -------- |
| HSTS header configuration    | Yes      |
| max-age staged increases     | Yes      |
| includeSubDomains assessment | Yes      |
| Preload decision criteria    | Yes      |
| Subdomain HTTPS audit        | Yes      |
| Rollback procedures          | Yes      |

---

## 2. Pre-Requisites

### 2.1 Required Before Enabling HSTS

- [ ] **SEC-3.1 Complete**: Full (strict) TLS mode enabled
- [ ] **HTTPS verified working**: Site loads correctly over HTTPS
- [ ] **Always Use HTTPS enabled**: HTTP redirects to HTTPS
- [ ] **No mixed content**: All resources load over HTTPS
- [ ] **Valid certificates**: Origin certificates are valid and not expiring soon

### 2.2 Subdomain Audit (for includeSubDomains)

Before enabling `includeSubDomains`, audit ALL subdomains:

| Subdomain                     | HTTPS Working | Certificate Valid | Include in HSTS |
| ----------------------------- | ------------- | ----------------- | --------------- |
| `www.oursharedevents.com`     | [ ] Yes       | [ ] Valid         | [ ] Yes         |
| `api.oursharedevents.com`     | [ ] Yes       | [ ] Valid         | [ ] Yes         |
| `stg.oursharedevents.com`     | [ ] Yes       | [ ] Valid         | [ ] Yes         |
| `api-stg.oursharedevents.com` | [ ] Yes       | [ ] Valid         | [ ] Yes         |

**Warning:** If ANY subdomain doesn't support HTTPS, do NOT enable `includeSubDomains`.

### 2.3 Stability Requirements Per Phase

| Phase | Minimum Stability Period | Before Advancing                        |
| ----- | ------------------------ | --------------------------------------- |
| 1 → 2 | 24-48 hours stable       | No HTTPS issues reported                |
| 2 → 3 | 7-14 days stable         | Zero certificate or TLS errors          |
| 3 → 4 | 30+ days stable          | Full confidence in HTTPS infrastructure |
| 4 → 5 | 90+ days stable          | Business decision to commit permanently |

---

## 3. Phase 1: Conservative (5 Minutes)

### 3.1 Configuration

| Setting             | Value           | Rationale                |
| ------------------- | --------------- | ------------------------ |
| `max-age`           | 300 (5 minutes) | Quick recovery if issues |
| `includeSubDomains` | No              | Test main domain first   |
| `preload`           | No              | Never in early phases    |

### 3.2 Enable via Cloudflare Dashboard

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your account and domain (oursharedevents.com)
3. Navigate to **SSL/TLS** → **Edge Certificates**
4. Scroll to **HTTP Strict Transport Security (HSTS)**
5. Click **Enable HSTS**
6. Configure:
   - **Enable HSTS (Strict-Transport-Security)**: On
   - **Max Age Header (max-age)**: 5 minutes (300 seconds)
   - **Apply HSTS policy to subdomains (includeSubDomains)**: Off
   - **Preload**: Off
   - **No-Sniff Header (X-Content-Type-Options: nosniff)**: On
7. Acknowledge the warning and **Save**

### 3.3 Enable via Cloudflare API

```bash
# Set HSTS with 5-minute max-age (Phase 1)
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/security_header" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "value": {
      "strict_transport_security": {
        "enabled": true,
        "max_age": 300,
        "include_subdomains": false,
        "preload": false,
        "nosniff": true
      }
    }
  }'
```

### 3.4 Verification

```bash
# Verify HSTS header is present
curl -I https://oursharedevents.com 2>/dev/null | grep -i strict-transport

# Expected output:
# strict-transport-security: max-age=300

# Verify max-age value
curl -sI https://oursharedevents.com | grep -i "strict-transport" | grep -oP 'max-age=\K[0-9]+'
# Expected: 300
```

### 3.5 Monitoring Checklist (24-48 hours)

- [ ] Site accessible over HTTPS: Yes
- [ ] No SSL/TLS errors in logs: Yes
- [ ] No user-reported access issues: Yes
- [ ] HSTS header present in responses: Yes
- [ ] Browser enforcing HTTPS: Yes (test in incognito)

### 3.6 Phase 1 Success Criteria

- [ ] 24+ hours with zero HTTPS-related issues
- [ ] Site loads correctly from multiple browsers
- [ ] No certificate warnings or errors
- [ ] API endpoints working over HTTPS

**Advance to Phase 2 when all criteria met.**

---

## 4. Phase 2: Extended (1 Week)

### 4.1 Configuration

| Setting             | Value           | Rationale                          |
| ------------------- | --------------- | ---------------------------------- |
| `max-age`           | 604800 (1 week) | Meaningful protection, recoverable |
| `includeSubDomains` | Optional        | Only if ALL subdomains verified    |
| `preload`           | No              | Still too early                    |

### 4.2 Update via Cloudflare Dashboard

1. Navigate to **SSL/TLS** → **Edge Certificates** → **HSTS**
2. Update **Max Age Header**: 1 week (604800 seconds)
3. Optionally enable **includeSubDomains** if subdomain audit passed
4. **Save**

### 4.3 Update via Cloudflare API

```bash
# Set HSTS with 1-week max-age (Phase 2)
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/security_header" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "value": {
      "strict_transport_security": {
        "enabled": true,
        "max_age": 604800,
        "include_subdomains": false,
        "preload": false,
        "nosniff": true
      }
    }
  }'

# OR with includeSubDomains (only if all subdomains verified):
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/security_header" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "value": {
      "strict_transport_security": {
        "enabled": true,
        "max_age": 604800,
        "include_subdomains": true,
        "preload": false,
        "nosniff": true
      }
    }
  }'
```

### 4.4 Verification

```bash
# Verify updated max-age
curl -sI https://oursharedevents.com | grep -i "strict-transport"
# Expected: strict-transport-security: max-age=604800

# If includeSubDomains enabled:
# Expected: strict-transport-security: max-age=604800; includeSubDomains
```

### 4.5 Monitoring Checklist (7-14 days)

- [ ] Main site accessible: Yes
- [ ] All subdomains accessible (if includeSubDomains): Yes
- [ ] API endpoints working: Yes
- [ ] Zero TLS errors in monitoring: Yes
- [ ] No user complaints: Yes

### 4.6 Phase 2 Success Criteria

- [ ] 7-14 days with zero HTTPS-related issues
- [ ] All subdomains verified (if using includeSubDomains)
- [ ] Certificate renewals working (if any occurred)
- [ ] No downtime related to TLS

**Advance to Phase 3 when all criteria met.**

---

## 5. Phase 3: Standard (6 Months)

### 5.1 Configuration

| Setting             | Value               | Rationale                 |
| ------------------- | ------------------- | ------------------------- |
| `max-age`           | 15768000 (6 months) | Strong protection         |
| `includeSubDomains` | Recommended         | Should be enabled by now  |
| `preload`           | No                  | Evaluate after this phase |

### 5.2 Update via Cloudflare API

```bash
# Set HSTS with 6-month max-age (Phase 3)
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/security_header" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "value": {
      "strict_transport_security": {
        "enabled": true,
        "max_age": 15768000,
        "include_subdomains": true,
        "preload": false,
        "nosniff": true
      }
    }
  }'
```

### 5.3 Verification

```bash
# Verify 6-month max-age
curl -sI https://oursharedevents.com | grep -i "strict-transport"
# Expected: strict-transport-security: max-age=15768000; includeSubDomains
```

### 5.4 Phase 3 Success Criteria

- [ ] 30+ days with zero HTTPS-related issues
- [ ] Confidence in HTTPS infrastructure
- [ ] Certificate management processes proven
- [ ] Ready to consider longer commitment

**Advance to Phase 4 when all criteria met.**

---

## 6. Phase 4: Production (1 Year)

### 6.1 Configuration

| Setting             | Value             | Rationale                          |
| ------------------- | ----------------- | ---------------------------------- |
| `max-age`           | 31536000 (1 year) | Industry standard                  |
| `includeSubDomains` | Yes               | Required for preload consideration |
| `preload`           | No (yet)          | Final decision pending             |

### 6.2 Update via Cloudflare API

```bash
# Set HSTS with 1-year max-age (Phase 4 - Production)
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/security_header" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "value": {
      "strict_transport_security": {
        "enabled": true,
        "max_age": 31536000,
        "include_subdomains": true,
        "preload": false,
        "nosniff": true
      }
    }
  }'
```

### 6.3 Verification

```bash
# Verify 1-year max-age
curl -sI https://oursharedevents.com | grep -i "strict-transport"
# Expected: strict-transport-security: max-age=31536000; includeSubDomains

# Test with SSL Labs
# Visit: https://www.ssllabs.com/ssltest/analyze.html?d=oursharedevents.com
# HSTS should show as enabled
```

### 6.4 Phase 4 Success Criteria

- [ ] 90+ days stable at 1-year max-age
- [ ] Full confidence in HTTPS-only operation
- [ ] Business stakeholder approval for permanence
- [ ] Preload decision made

---

## 7. Phase 5: Preload (Permanent)

### 7.1 ⚠️ CRITICAL WARNING ⚠️

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   PRELOAD IS A ONE-WAY DOOR                                               ║
║                                                                            ║
║   Once your domain is in browser preload lists:                           ║
║   • Removal takes MONTHS (browser release cycles)                         ║
║   • Users with cached browsers cannot access HTTP for YEARS               ║
║   • ALL subdomains MUST support HTTPS forever                             ║
║   • You cannot easily test or develop on HTTP                             ║
║                                                                            ║
║   ONLY enable preload if you are 100% committed to HTTPS-only forever    ║
║                                                                            ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

### 7.2 Preload Requirements

Before submitting to preload list:

- [ ] `max-age` is at least 31536000 (1 year)
- [ ] `includeSubDomains` is enabled
- [ ] `preload` directive is present
- [ ] Served over HTTPS (not just redirected)
- [ ] All subdomains support HTTPS
- [ ] HTTPS-only for the foreseeable future
- [ ] Business/legal approval obtained

### 7.3 Preload Eligibility Check

```bash
# Check if domain meets preload requirements
# Visit: https://hstspreload.org/?domain=oursharedevents.com
```

### 7.4 Enable Preload (ONLY IF CERTAIN)

```bash
# Set HSTS with preload (PERMANENT - Phase 5)
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/security_header" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "value": {
      "strict_transport_security": {
        "enabled": true,
        "max_age": 31536000,
        "include_subdomains": true,
        "preload": true,
        "nosniff": true
      }
    }
  }'
```

### 7.5 Submit to Preload List

1. Verify header includes preload:

   ```bash
   curl -sI https://oursharedevents.com | grep -i "strict-transport"
   # Expected: strict-transport-security: max-age=31536000; includeSubDomains; preload
   ```

2. Visit [hstspreload.org](https://hstspreload.org)
3. Enter domain: `oursharedevents.com`
4. Verify all requirements met
5. Submit for inclusion
6. Wait for browser updates (Chrome, Firefox, Safari, Edge)

### 7.6 Preload Removal (If Ever Needed)

**This is difficult and slow:**

1. Remove `preload` directive from HSTS header
2. Submit removal request at [hstspreload.org/removal](https://hstspreload.org/removal/)
3. Wait for browser release cycles (2-4 months per browser)
4. Users must update their browsers
5. Old browser versions will still enforce HSTS

---

## 8. Verification Checklist

### 8.1 HSTS Verification Script

```bash
#!/bin/bash
# HSTS Verification Script for SEC-3.2
DOMAIN="oursharedevents.com"

echo "=== HSTS Verification for $DOMAIN ==="
echo ""

# Test 1: HSTS Header Present
echo "1. Checking HSTS header..."
HSTS=$(curl -sI "https://$DOMAIN" | grep -i "strict-transport-security")
if [ -n "$HSTS" ]; then
    echo "   ✅ PASS: HSTS header present"
    echo "   Header: $HSTS"
else
    echo "   ❌ FAIL: HSTS header missing"
fi
echo ""

# Test 2: Extract max-age
echo "2. Checking max-age value..."
MAX_AGE=$(echo "$HSTS" | grep -oP 'max-age=\K[0-9]+')
if [ -n "$MAX_AGE" ]; then
    if [ "$MAX_AGE" -ge 300 ]; then
        echo "   ✅ PASS: max-age=$MAX_AGE seconds"

        # Convert to human readable
        if [ "$MAX_AGE" -lt 3600 ]; then
            echo "   Duration: $((MAX_AGE / 60)) minutes (Phase 1)"
        elif [ "$MAX_AGE" -lt 86400 ]; then
            echo "   Duration: $((MAX_AGE / 3600)) hours"
        elif [ "$MAX_AGE" -lt 604800 ]; then
            echo "   Duration: $((MAX_AGE / 86400)) days"
        elif [ "$MAX_AGE" -lt 2592000 ]; then
            echo "   Duration: $((MAX_AGE / 604800)) weeks (Phase 2)"
        elif [ "$MAX_AGE" -lt 15768000 ]; then
            echo "   Duration: $((MAX_AGE / 2592000)) months"
        elif [ "$MAX_AGE" -lt 31536000 ]; then
            echo "   Duration: ~6 months (Phase 3)"
        else
            echo "   Duration: 1 year (Phase 4/5)"
        fi
    else
        echo "   ⚠️  WARNING: max-age is very short ($MAX_AGE seconds)"
    fi
else
    echo "   ❌ FAIL: Could not parse max-age"
fi
echo ""

# Test 3: includeSubDomains
echo "3. Checking includeSubDomains..."
if echo "$HSTS" | grep -qi "includesubdomains"; then
    echo "   ✅ ENABLED: includeSubDomains is set"
else
    echo "   ⚠️  NOT SET: includeSubDomains not enabled"
    echo "   (OK for Phase 1-2, should be enabled by Phase 3)"
fi
echo ""

# Test 4: Preload
echo "4. Checking preload directive..."
if echo "$HSTS" | grep -qi "preload"; then
    echo "   ⚠️  ENABLED: preload is set (permanent commitment!)"
else
    echo "   ℹ️  NOT SET: preload not enabled (recommended for early phases)"
fi
echo ""

# Test 5: HTTP redirect still works
echo "5. Verifying HTTP redirects to HTTPS..."
HTTP_STATUS=$(curl -sI "http://$DOMAIN" -o /dev/null -w "%{http_code}")
if [ "$HTTP_STATUS" = "301" ] || [ "$HTTP_STATUS" = "302" ]; then
    REDIRECT_URL=$(curl -sI "http://$DOMAIN" | grep -i "location" | head -1)
    echo "   ✅ PASS: HTTP redirects ($HTTP_STATUS)"
    echo "   $REDIRECT_URL"
else
    echo "   ⚠️  WARNING: HTTP returned $HTTP_STATUS (expected 301/302)"
fi
echo ""

# Test 6: HTTPS working
echo "6. Verifying HTTPS connection..."
HTTPS_STATUS=$(curl -sI "https://$DOMAIN" -o /dev/null -w "%{http_code}")
if [ "$HTTPS_STATUS" = "200" ]; then
    echo "   ✅ PASS: HTTPS returns 200 OK"
else
    echo "   ❌ FAIL: HTTPS returned $HTTPS_STATUS"
fi
echo ""

echo "=== Verification Complete ==="
```

### 8.2 Current Phase Status

| Check               | Result                     | Notes         |
| ------------------- | -------------------------- | ------------- |
| HSTS header present | [ ] Pass                   |               |
| max-age value       | [ ] **\_** seconds         | Phase: \_\_\_ |
| includeSubDomains   | [ ] Enabled / [ ] Disabled |               |
| preload             | [ ] Enabled / [ ] Disabled |               |
| HTTP redirects      | [ ] Pass                   |               |
| HTTPS working       | [ ] Pass                   |               |

### 8.3 Phase Advancement Criteria

| From    | To      | Minimum Wait | Stability Required |
| ------- | ------- | ------------ | ------------------ |
| None    | Phase 1 | Immediate    | Pre-requisites met |
| Phase 1 | Phase 2 | 24-48 hours  | Zero issues        |
| Phase 2 | Phase 3 | 7-14 days    | Zero issues        |
| Phase 3 | Phase 4 | 30+ days     | Zero issues        |
| Phase 4 | Phase 5 | 90+ days     | Business decision  |

---

## 9. Rollback Procedures

### 9.1 Emergency Disable (All Phases Except Preload)

If HTTPS issues arise and users are locked out:

```bash
# Disable HSTS entirely
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/security_header" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "value": {
      "strict_transport_security": {
        "enabled": false,
        "max_age": 0,
        "include_subdomains": false,
        "preload": false,
        "nosniff": true
      }
    }
  }'
```

**Note:** Users with cached HSTS will still be affected until cache expires.

### 9.2 Reduce max-age (Step-Down)

For controlled rollback:

```bash
# Reduce to 5 minutes for quick cache expiry
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/security_header" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "value": {
      "strict_transport_security": {
        "enabled": true,
        "max_age": 300,
        "include_subdomains": false,
        "preload": false,
        "nosniff": true
      }
    }
  }'
```

### 9.3 Clear Browser HSTS Cache

For individual users experiencing issues:

**Chrome:**

1. Navigate to `chrome://net-internals/#hsts`
2. Under "Delete domain security policies"
3. Enter: `oursharedevents.com`
4. Click **Delete**

**Firefox:**

1. Navigate to `about:config`
2. Search for `network.stricttransportsecurity.preloadlist`
3. Or clear all site data for the domain

**Safari:**

1. Quit Safari
2. Delete `~/Library/Cookies/HSTS.plist`
3. Reopen Safari

### 9.4 Rollback from Preload

**This is SLOW and DIFFICULT:**

1. Remove `preload` from HSTS header immediately
2. Set max-age to 0:
   ```bash
   curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/security_header" \
     -H "Authorization: Bearer $CF_API_TOKEN" \
     -H "Content-Type: application/json" \
     --data '{
       "value": {
         "strict_transport_security": {
           "enabled": true,
           "max_age": 0,
           "include_subdomains": false,
           "preload": false,
           "nosniff": true
         }
       }
     }'
   ```
3. Submit removal request at [hstspreload.org/removal](https://hstspreload.org/removal/)
4. Wait for browser release cycles (months)
5. Users must update browsers to get removal

---

## 10. Troubleshooting

### 10.1 Common Issues

| Issue                                 | Cause                                             | Solution                                            |
| ------------------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| Site inaccessible after enabling HSTS | HTTPS not working properly                        | Disable HSTS, fix HTTPS, re-enable                  |
| Subdomain broken                      | includeSubDomains enabled without subdomain HTTPS | Disable includeSubDomains or add HTTPS to subdomain |
| Users report locked out               | HSTS cached in browser                            | Direct users to clear HSTS cache                    |
| HSTS header not appearing             | Cloudflare setting not saved                      | Re-enable in dashboard or via API                   |
| Mixed content warnings                | HTTP resources on HTTPS page                      | Update all resources to HTTPS                       |

### 10.2 Debugging Commands

```bash
# Full HTTPS handshake details
curl -vI https://oursharedevents.com 2>&1 | grep -E "(SSL|TLS|strict)"

# Check all security headers
curl -sI https://oursharedevents.com | grep -iE "(strict|x-content|x-frame|x-xss)"

# Test from specific location (via Cloudflare)
curl -sI https://oursharedevents.com --resolve oursharedevents.com:443:$(dig +short oursharedevents.com | head -1) | grep -i strict

# Verify Cloudflare is serving the header
curl -sI https://oursharedevents.com | grep -i "cf-ray"
```

### 10.3 SSL Labs Test

For comprehensive HSTS verification:

1. Visit [SSL Labs](https://www.ssllabs.com/ssltest/analyze.html?d=oursharedevents.com)
2. Check "Strict Transport Security (HSTS)" section
3. Verify:
   - HSTS: Yes
   - max-age: Matches expected value
   - includeSubDomains: If expected
   - preload: If enabled

---

## Appendix A: Configuration Quick Reference

### Cloudflare API Endpoint

```
PATCH https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/security_header
```

### Phase Configurations

```bash
# Phase 1: 5 minutes
{"max_age": 300, "include_subdomains": false, "preload": false}

# Phase 2: 1 week
{"max_age": 604800, "include_subdomains": false, "preload": false}

# Phase 2b: 1 week + subdomains
{"max_age": 604800, "include_subdomains": true, "preload": false}

# Phase 3: 6 months
{"max_age": 15768000, "include_subdomains": true, "preload": false}

# Phase 4: 1 year
{"max_age": 31536000, "include_subdomains": true, "preload": false}

# Phase 5: 1 year + preload (PERMANENT)
{"max_age": 31536000, "include_subdomains": true, "preload": true}
```

### max-age Reference

| Duration  | Seconds  | Use Case             |
| --------- | -------- | -------------------- |
| 5 minutes | 300      | Testing/Phase 1      |
| 1 hour    | 3600     | Debug                |
| 1 day     | 86400    | Short-term           |
| 1 week    | 604800   | Phase 2              |
| 1 month   | 2592000  | Intermediate         |
| 6 months  | 15768000 | Phase 3              |
| 1 year    | 31536000 | Production/Phase 4-5 |
| 2 years   | 63072000 | Maximum (some use)   |

---

## Appendix B: Decision Matrix for Preload

Use this matrix to decide if preload is appropriate:

| Question                                          | Required Answer |
| ------------------------------------------------- | --------------- |
| Has HTTPS been stable for 90+ days?               | Yes             |
| Are ALL subdomains HTTPS-enabled?                 | Yes             |
| Will you NEVER need HTTP access?                  | Yes             |
| Is certificate management fully automated?        | Yes             |
| Do you have monitoring for certificate expiry?    | Yes             |
| Is there business/legal approval?                 | Yes             |
| Are you prepared for months-long removal process? | Yes             |

**If ANY answer is "No" or "Unsure", do NOT enable preload.**

---

## Document History

| Date       | Author      | Changes                   |
| ---------- | ----------- | ------------------------- |
| 2025-12-20 | Claude Code | Initial runbook (SEC-3.2) |

---

## Related Documentation

- [RUNBOOK-SEC-3.1-STRICT-TLS.md](./RUNBOOK-SEC-3.1-STRICT-TLS.md) - Strict TLS Configuration (prerequisite)
- [RUNBOOK-SEC-2.2-DNSSEC.md](./RUNBOOK-SEC-2.2-DNSSEC.md) - DNSSEC Configuration
- [RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md](./RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md) - Scoped API Tokens
- [HSTS Preload Submission](https://hstspreload.org) - Official preload list
- [Cloudflare HSTS Documentation](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/)
- [Mozilla HSTS Guidelines](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security)
