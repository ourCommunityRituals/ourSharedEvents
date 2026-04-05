# Runbook: Canonical Host Redirect (www to apex)

> **Epic SEC-4 — Route Hygiene (kill the route sprawl)**
> Story SEC-4.1 — Canonical Host Decision + www Redirect Rule
>
> Created: 2025-12-21
> Last Updated: 2025-12-21
> Status: Active

---

## Table of Contents

1. [Overview](#1-overview)
2. [Pre-Requisites](#2-pre-requisites)
3. [Canonical Host Decision](#3-canonical-host-decision)
4. [Configure Redirect Rule](#4-configure-redirect-rule)
5. [Remove Worker Route for www](#5-remove-worker-route-for-www)
6. [Verification](#6-verification)
7. [Rollback](#7-rollback)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Overview

### 1.1 Goal

Establish **one canonical host** for the production site and redirect the non-canonical variant:

```
www.eventangle.com/* ──── 301 ────► eventangle.com/*
```

### 1.2 Why This Matters

Having both `www` and non-www hosts active creates problems:

| Issue                      | Impact                                                                      |
| -------------------------- | --------------------------------------------------------------------------- |
| **SEO dilution**           | Search engines treat www and non-www as separate sites, splitting page rank |
| **Cookie confusion**       | Cookies set on one host may not be visible on the other                     |
| **Cache fragmentation**    | CDN caches content separately for each host                                 |
| **Analytics split**        | Traffic is counted separately, making metrics harder to interpret           |
| **SSL certificate sprawl** | Both hosts need certificates (though Cloudflare handles this)               |

**One host, one truth.**

### 1.3 Architecture Decision

| Option                               | Chosen  | Rationale                                   |
| ------------------------------------ | ------- | ------------------------------------------- |
| `eventangle.com` (apex/naked domain) | **YES** | Shorter, modern, avoids www prefix          |
| `www.eventangle.com`                 | No      | Legacy convention, requires extra subdomain |

### 1.4 Redirect Mechanism

We use **Cloudflare Redirect Rules** (not Worker code) because:

1. **Performance**: Redirects happen at the edge before reaching Workers
2. **Simplicity**: No code changes needed, just dashboard configuration
3. **Reliability**: Cloudflare's redirect engine is battle-tested
4. **Route cleanup**: Worker no longer needs to handle www traffic

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Request Flow (Before SEC-4.1)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   www.eventangle.com ────► Cloudflare ────► Worker ────► Response           │
│   eventangle.com     ────► Cloudflare ────► Worker ────► Response           │
│                                                                              │
│   Both hosts hit the Worker (unnecessary route sprawl)                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    Request Flow (After SEC-4.1)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   www.eventangle.com ────► Cloudflare Redirect Rule ────► 301               │
│                                              │                               │
│                                              ▼                               │
│   eventangle.com     ────► Cloudflare ────► Worker ────► Response           │
│                                                                              │
│   Only canonical host reaches Worker; www redirected at edge                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.5 Scope

| Component                              | In Scope | Notes                                            |
| -------------------------------------- | -------- | ------------------------------------------------ |
| Cloudflare Redirect Rule configuration | Yes      | Main change                                      |
| Worker route removal for www           | Yes      | wrangler.toml updates                            |
| DNS records                            | No       | Both A/AAAA records remain (needed for redirect) |
| SSL certificates                       | No       | Cloudflare handles automatically                 |
| CORS configuration                     | No       | Keep www in allowed origins for safety           |

### 1.6 Subdomain Policy

**Subdomains do NOT get www prefixes.** This is intentional route hygiene:

| Host                     | Status               | Rationale              |
| ------------------------ | -------------------- | ---------------------- |
| `eventangle.com`         | ✅ Canonical         | Production site        |
| `www.eventangle.com`     | 🔄 Redirects to apex | Legacy support         |
| `stg.eventangle.com`     | ✅ Direct            | Staging (internal use) |
| `www.stg.eventangle.com` | ❌ Not supported     | Unnecessary sprawl     |
| `api.eventangle.com`     | ✅ Direct            | API subdomain          |
| `www.api.eventangle.com` | ❌ Not supported     | Unnecessary sprawl     |
| `api-stg.eventangle.com` | ✅ Direct            | Staging API            |

**Why no www on subdomains?**

1. Subdomains are already namespaced (`stg.`, `api.`) - www adds nothing
2. Staging/API are for developers, not end users sharing bookmarks
3. Each www variant doubles DNS records, certs, and route complexity
4. SEC-4's goal is to **reduce** route sprawl, not maintain it

**Friendly URLs work without www:**

- `https://stg.eventangle.com/manage` ✅
- `https://stg.eventangle.com/admin` ✅
- `https://stg.eventangle.com/public?brand=abc` ✅

---

## 2. Pre-Requisites

### 2.1 Required Access

- [ ] Cloudflare account with domain management access (Super Administrator or Administrator)
- [ ] Access to modify DNS settings (to verify proxied status)
- [ ] Access to modify Redirect Rules

### 2.2 Required Information

| Information    | Value                       | Status           |
| -------------- | --------------------------- | ---------------- |
| Domain         | `eventangle.com`            |                  |
| Zone ID        | (from Cloudflare dashboard) |                  |
| Canonical host | `eventangle.com`            | Chosen           |
| Redirect host  | `www.eventangle.com`        | To be redirected |

### 2.3 Pre-Flight Checks

Before configuring the redirect:

- [ ] Verify `www.eventangle.com` DNS record exists and is proxied (orange cloud)
- [ ] Verify `eventangle.com` DNS record exists and is proxied (orange cloud)
- [ ] Verify SSL certificate covers both hosts (Cloudflare Universal SSL does this automatically)
- [ ] Confirm no critical functionality depends on www-specific behavior
- [ ] Back up current Redirect Rules configuration (screenshot or export)

---

## 3. Canonical Host Decision

### 3.1 Decision Record

| Attribute               | Value                                                |
| ----------------------- | ---------------------------------------------------- |
| Decision                | Use `eventangle.com` (apex domain) as canonical host |
| Date                    | 2025-12-21                                           |
| Rationale               | Shorter URL, modern convention, no www prefix needed |
| Alternatives considered | `www.eventangle.com` (rejected - legacy convention)  |

### 3.2 Implications

| Area              | Impact                                                  |
| ----------------- | ------------------------------------------------------- |
| **URLs**          | All canonical URLs use `eventangle.com`                 |
| **Links**         | Update external links to use apex domain where possible |
| **Documentation** | Reference `eventangle.com` in all docs                  |
| **Email**         | MX records unaffected (mail.eventangle.com or external) |
| **API**           | `api.eventangle.com` remains unchanged                  |
| **Staging**       | `stg.eventangle.com` remains unchanged                  |

---

## 4. Configure Redirect Rule

### 4.1 Via Cloudflare Dashboard (Recommended)

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your account and the `eventangle.com` domain
3. Navigate to **Rules** → **Redirect Rules**
4. Click **Create rule**
5. Configure the rule:

**Rule Name:** `SEC-4.1: www to apex redirect`

**When incoming requests match...**

- Field: `Hostname`
- Operator: `equals`
- Value: `www.eventangle.com`

**Then...**

- Type: `Dynamic`
- Expression: `concat("https://eventangle.com", http.request.uri.path)`
- Status code: `301` (Permanent Redirect)
- Preserve query string: `Yes` (checked)

6. Click **Deploy**

### 4.2 Via Cloudflare API

```bash
# Set your credentials
ZONE_ID="your-zone-id"
CF_API_TOKEN="your-api-token"

# Create the redirect rule
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_dynamic_redirect/entrypoint" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "rules": [
      {
        "expression": "(http.host eq \"www.eventangle.com\")",
        "description": "SEC-4.1: www to apex redirect",
        "action": "redirect",
        "action_parameters": {
          "from_value": {
            "status_code": 301,
            "target_url": {
              "expression": "concat(\"https://eventangle.com\", http.request.uri.path)"
            },
            "preserve_query_string": true
          }
        }
      }
    ]
  }'
```

### 4.3 Rule Configuration Details

| Setting                   | Value                                                     | Rationale                                       |
| ------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| **Status code**           | 301 (Permanent)                                           | Tells browsers/search engines this is permanent |
| **Preserve query string** | Yes                                                       | Maintains `?page=admin&brand=root` etc.         |
| **Dynamic expression**    | `concat("https://eventangle.com", http.request.uri.path)` | Preserves full path                             |

### 4.4 What the Redirect Covers

| Request                                       | Redirects To                                                 |
| --------------------------------------------- | ------------------------------------------------------------ |
| `https://www.eventangle.com/`                 | `https://eventangle.com/`                                    |
| `https://www.eventangle.com/admin`            | `https://eventangle.com/admin`                               |
| `https://www.eventangle.com/api/v2/events`    | `https://eventangle.com/api/v2/events`                       |
| `https://www.eventangle.com/public?brand=abc` | `https://eventangle.com/public?brand=abc`                    |
| `http://www.eventangle.com/`                  | `https://eventangle.com/` (via Always Use HTTPS + this rule) |

---

## 5. Remove Worker Route for www

### 5.1 Why Remove the Worker Route

After the Cloudflare Redirect Rule is active:

1. **No www traffic reaches the Worker** - it's redirected before routing
2. **Worker route is dead code** - keeping it adds confusion
3. **Cleaner configuration** - explicit about what the Worker handles

### 5.2 Update wrangler.toml Files

Two files need updates:

#### worker/wrangler.toml

Change from:

```toml
[env.production]
routes = [
  { pattern = "eventangle.com/*", zone_name = "eventangle.com" },
  { pattern = "www.eventangle.com/*", zone_name = "eventangle.com" },
  { pattern = "api.eventangle.com/*", zone_name = "eventangle.com" }
]
```

To:

```toml
[env.production]
routes = [
  { pattern = "eventangle.com/*", zone_name = "eventangle.com" },
  # www.eventangle.com/* removed - SEC-4.1: redirected at edge via Cloudflare Redirect Rule
  { pattern = "api.eventangle.com/*", zone_name = "eventangle.com" }
]
```

#### cloudflare-proxy/wrangler.toml

Same change in the `[env.production]` section.

### 5.3 Deploy After Redirect Rule is Active

**Important:** Only remove the Worker route AFTER verifying the Redirect Rule works:

1. Configure Redirect Rule (Section 4)
2. Verify redirect works (Section 6.1)
3. Remove Worker routes
4. Deploy Workers: `wrangler deploy --env production`
5. Verify again (Section 6.2)

---

## 6. Verification

### 6.1 Verify Redirect Rule (Before Worker Route Removal)

#### Browser Test

1. Open browser (incognito/private mode recommended)
2. Navigate to `https://www.eventangle.com/`
3. **Expected**: Redirected to `https://eventangle.com/`
4. Check address bar shows `eventangle.com`

#### curl Test

```bash
# Test basic redirect
curl -I https://www.eventangle.com/
# Expected output includes:
# HTTP/2 301
# location: https://eventangle.com/

# Test path preservation
curl -I https://www.eventangle.com/admin
# Expected:
# HTTP/2 301
# location: https://eventangle.com/admin

# Test query string preservation
curl -I "https://www.eventangle.com/public?brand=abc"
# Expected:
# HTTP/2 301
# location: https://eventangle.com/public?brand=abc
```

### 6.2 Verify After Worker Route Removal

```bash
# Run full verification
./scripts/verify-sec-4.1.sh
```

Or manually:

```bash
#!/bin/bash
# SEC-4.1 Verification Script
DOMAIN="eventangle.com"

echo "=== SEC-4.1 Canonical Host Verification ==="
echo ""

# Test 1: www redirects to apex
echo "1. Testing www → apex redirect..."
REDIRECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -I "https://www.$DOMAIN/")
REDIRECT_LOCATION=$(curl -s -I "https://www.$DOMAIN/" 2>/dev/null | grep -i "^location:" | tr -d '\r')
if [ "$REDIRECT_STATUS" = "301" ]; then
    echo "   ✅ PASS: www returns 301"
    echo "   Location: $REDIRECT_LOCATION"
else
    echo "   ❌ FAIL: www returned $REDIRECT_STATUS (expected 301)"
fi
echo ""

# Test 2: Canonical host works
echo "2. Testing canonical host (eventangle.com)..."
CANONICAL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -I "https://$DOMAIN/")
if [ "$CANONICAL_STATUS" = "200" ]; then
    echo "   ✅ PASS: Canonical host returns 200 OK"
else
    echo "   ❌ FAIL: Canonical host returned $CANONICAL_STATUS"
fi
echo ""

# Test 3: Path preservation
echo "3. Testing path preservation..."
REDIRECT_PATH=$(curl -s -I "https://www.$DOMAIN/admin" 2>/dev/null | grep -i "^location:" | tr -d '\r')
if echo "$REDIRECT_PATH" | grep -q "/admin"; then
    echo "   ✅ PASS: Path preserved in redirect"
    echo "   $REDIRECT_PATH"
else
    echo "   ❌ FAIL: Path not preserved"
fi
echo ""

# Test 4: Query string preservation
echo "4. Testing query string preservation..."
REDIRECT_QS=$(curl -s -I "https://www.$DOMAIN/public?brand=abc" 2>/dev/null | grep -i "^location:" | tr -d '\r')
if echo "$REDIRECT_QS" | grep -q "brand=abc"; then
    echo "   ✅ PASS: Query string preserved"
    echo "   $REDIRECT_QS"
else
    echo "   ❌ FAIL: Query string not preserved"
fi
echo ""

# Test 5: API subdomain unaffected
echo "5. Testing API subdomain (api.eventangle.com)..."
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -I "https://api.$DOMAIN/api/status")
if [ "$API_STATUS" = "200" ]; then
    echo "   ✅ PASS: API subdomain returns 200 OK"
else
    echo "   ⚠️ WARNING: API returned $API_STATUS (may be expected)"
fi
echo ""

echo "=== Verification Complete ==="
```

### 6.3 Acceptance Criteria Checklist

| Criterion                                       | Verification Method                  | Status   |
| ----------------------------------------------- | ------------------------------------ | -------- |
| `www.eventangle.com/*` 301 → `eventangle.com/*` | curl -I shows 301 + correct location | [ ] Pass |
| Path preserved in redirect                      | `/admin` → `/admin`                  | [ ] Pass |
| Query string preserved                          | `?brand=abc` → `?brand=abc`          | [ ] Pass |
| No Worker routes for www                        | Check wrangler.toml                  | [ ] Pass |
| Browser follows redirect                        | Manual test                          | [ ] Pass |

---

## 7. Rollback

### 7.1 If Redirect Breaks Something

**Immediate rollback** (disable redirect rule):

1. Go to **Rules** → **Redirect Rules**
2. Find the "SEC-4.1: www to apex redirect" rule
3. Toggle off (or delete)
4. Changes take effect within seconds

### 7.2 If Worker Route Removal Causes Issues

Re-add the Worker route:

1. Edit `worker/wrangler.toml` and `cloudflare-proxy/wrangler.toml`
2. Add back: `{ pattern = "www.eventangle.com/*", zone_name = "eventangle.com" }`
3. Deploy: `wrangler deploy --env production`

### 7.3 Rollback Decision Tree

```
Is www.eventangle.com returning errors?
├── Yes → Is the error a 301/302 loop?
│   ├── Yes → Disable redirect rule immediately
│   └── No → Check if redirect rule is misconfigured
└── No → Is eventangle.com working?
    ├── Yes → Redirect is working, investigate other issues
    └── No → Check Worker health, DNS, SSL settings
```

---

## 8. Troubleshooting

### 8.1 Common Issues

| Symptom                            | Likely Cause                                 | Solution                                |
| ---------------------------------- | -------------------------------------------- | --------------------------------------- |
| Redirect loop (too many redirects) | Redirect rule also catches apex domain       | Fix rule expression to only match `www` |
| 404 after redirect                 | Worker route removed but Worker not deployed | Deploy Worker                           |
| www still hits Worker              | Redirect rule not active or misconfigured    | Check rule status in dashboard          |
| Mixed HTTP/HTTPS in redirect       | Always Use HTTPS not enabled                 | Enable Always Use HTTPS (SEC-3.1)       |

### 8.2 Debug Redirect Rule

```bash
# Check what Cloudflare is returning
curl -vI https://www.eventangle.com/ 2>&1 | grep -E "(HTTP|location|cf-ray)"

# Check redirect chain
curl -L -v https://www.eventangle.com/ 2>&1 | grep -E "(< HTTP|< location)"
```

### 8.3 Verify DNS Setup

```bash
# Both should resolve and be proxied
dig +short www.eventangle.com
dig +short eventangle.com

# Check if proxied (should show Cloudflare IPs)
dig +short www.eventangle.com A
dig +short eventangle.com A
```

### 8.4 Check Redirect Rule in API

```bash
# List redirect rules
curl -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_dynamic_redirect/entrypoint" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result.rules'
```

---

## Appendix A: SEO Considerations

### A.1 Search Engine Handling

When search engines see the 301 redirect:

1. **Google**: Will consolidate www and non-www URLs
2. **Bing**: Will follow the redirect and update index
3. **Others**: Generally follow 301 semantics

### A.2 Search Console Configuration

After implementing the redirect:

1. Go to [Google Search Console](https://search.google.com/search-console)
2. Add `eventangle.com` as a property (if not already)
3. Request indexing of the canonical version
4. Monitor for crawl errors

### A.3 Canonical Link Tags

Ensure HTML pages include:

```html
<link rel="canonical" href="https://eventangle.com/page-path" />
```

This reinforces the canonical host choice.

---

## Appendix B: Related Documentation

- [RUNBOOK-SEC-3.1-STRICT-TLS.md](./RUNBOOK-SEC-3.1-STRICT-TLS.md) - TLS configuration (SEC-3.1)
- [RUNBOOK-SEC-3.2-HSTS-PHASED.md](./RUNBOOK-SEC-3.2-HSTS-PHASED.md) - HSTS configuration (SEC-3.2)
- [Cloudflare Redirect Rules](https://developers.cloudflare.com/rules/url-forwarding/)
- [Cloudflare Dynamic Redirects](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/)

---

## Document History

| Date       | Author      | Changes                   |
| ---------- | ----------- | ------------------------- |
| 2025-12-21 | Claude Code | Initial runbook (SEC-4.1) |
