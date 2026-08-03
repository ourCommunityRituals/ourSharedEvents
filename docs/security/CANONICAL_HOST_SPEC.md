# CANONICAL_HOST_SPEC.md — Canonical Host + Redirect Specification

> **PROMPTSPEC-SEC-4.1** — Canonical Host + Redirect Spec
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Define the canonical hostname for the application and enforce HTTP 301 redirects at the Cloudflare edge to consolidate all traffic to a single hostname. This prevents SEO dilution, cookie scope issues, and duplicate worker route complexity.

| Attribute         | Value                                                        |
| ----------------- | ------------------------------------------------------------ |
| **Scope**         | All production hostnames for oursharedevents.com zone        |
| **Prerequisites** | TLS Strict Baseline (SEC-3.1), HSTS Rollout (SEC-3.2)        |
| **Constraints**   | Worker routes must NOT be configured for non-canonical hosts |

---

## 2. Canonical Host Decision

### 2.1 Chosen Canonical Host

| Attribute                           | Value                     |
| ----------------------------------- | ------------------------- |
| **Canonical Host**                  | `oursharedevents.com`     |
| **Non-Canonical (Redirect Source)** | `www.oursharedevents.com` |
| **Redirect Direction**              | www → apex                |

### 2.2 Rationale

| Factor                     | Apex (`oursharedevents.com`) | WWW (`www.oursharedevents.com`)              | Decision  |
| -------------------------- | ---------------------------- | -------------------------------------------- | --------- |
| **URL Length**             | Shorter, cleaner             | Longer                                       | Apex wins |
| **Modern Preference**      | Industry trend toward apex   | Traditional/legacy                           | Apex wins |
| **Cookie Scope**           | Limited to apex only         | Can scope to apex via `.oursharedevents.com` | Tie       |
| **Subdomain Flexibility**  | Any subdomain works          | `www` is "used"                              | Apex wins |
| **HSTS includeSubDomains** | Works naturally              | Works naturally                              | Tie       |
| **Historical Links**       | May have some                | May have some                                | Tie       |

**Conclusion:** `oursharedevents.com` (apex) is the canonical host.

### 2.3 Hostname Inventory

| Hostname                      | Purpose                 | Canonical?    | Action               |
| ----------------------------- | ----------------------- | ------------- | -------------------- |
| `oursharedevents.com`         | Primary web application | **YES**       | Serve via Worker     |
| `www.oursharedevents.com`     | Legacy/alternative      | NO            | 301 redirect to apex |
| `api.oursharedevents.com`     | API endpoint            | **YES (API)** | Serve via Worker     |
| `api-stg.oursharedevents.com` | Staging API             | YES (Staging) | Serve via Worker     |
| `stg.oursharedevents.com`     | Staging environment     | YES (Staging) | Serve via Worker     |

---

## 3. Redirect Behavior Specification

### 3.1 Redirect Requirements

| Requirement                   | Specification                                             |
| ----------------------------- | --------------------------------------------------------- |
| **Source Host**               | `www.oursharedevents.com`                                 |
| **Target Host**               | `oursharedevents.com`                                     |
| **Path Preservation**         | **REQUIRED** — Full path must be preserved                |
| **Query String Preservation** | **REQUIRED** — All query parameters must be preserved     |
| **Fragment Preservation**     | Browser handles (not sent to server)                      |
| **Protocol**                  | Always redirect to HTTPS (combined with Always Use HTTPS) |

### 3.2 Redirect Examples

| Request URL                                                  | Redirects To                                             |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| `http://www.oursharedevents.com/`                            | `https://oursharedevents.com/`                           |
| `https://www.oursharedevents.com/`                           | `https://oursharedevents.com/`                           |
| `https://www.oursharedevents.com/events/abc123`              | `https://oursharedevents.com/events/abc123`              |
| `https://www.oursharedevents.com/public?id=xyz&tab=schedule` | `https://oursharedevents.com/public?id=xyz&tab=schedule` |
| `https://www.oursharedevents.com/admin?token=secret`         | `https://oursharedevents.com/admin?token=secret`         |
| `http://www.oursharedevents.com/path?query=value`            | `https://oursharedevents.com/path?query=value`           |

### 3.3 Redirect Expression (Cloudflare)

The redirect preserves path and query using Cloudflare's expression syntax:

```
Target URL: concat("https://oursharedevents.com", http.request.uri.path, "?", http.request.uri.query)
```

For requests without query string:

```
Target URL: concat("https://oursharedevents.com", http.request.uri.path)
```

Or using dynamic reference:

```
Target URL: concat("https://oursharedevents.com", http.request.uri)
```

> **Note:** `http.request.uri` includes both path and query string (e.g., `/path?query=value`).

---

## 4. Status Code Recommendation

### 4.1 Recommended Status Code

| Status Code | **301 Moved Permanently** |
| ----------- | ------------------------- |

### 4.2 Status Code Comparison

| Status Code | Name               | Caching                                 | SEO Impact                    | Use Case                         |
| ----------- | ------------------ | --------------------------------------- | ----------------------------- | -------------------------------- |
| **301**     | Moved Permanently  | Cached indefinitely by browsers/proxies | Transfers SEO value to target | **Permanent canonical redirect** |
| 302         | Found              | Not cached                              | No SEO transfer               | Temporary redirects              |
| 307         | Temporary Redirect | Not cached                              | No SEO transfer               | Method-preserving temporary      |
| 308         | Permanent Redirect | Cached                                  | Transfers SEO value           | Method-preserving permanent      |

### 4.3 Why 301 (Not 308)

| Consideration       | 301                    | 308                  |
| ------------------- | ---------------------- | -------------------- |
| Browser Support     | Universal              | Modern only          |
| Method Preservation | May convert POST→GET   | Preserves method     |
| Use Case            | GET-based redirects    | POST-based redirects |
| Our Traffic         | Primarily GET requests | N/A                  |

**Decision:** Use **301** because:

1. Universal browser compatibility
2. Our www→apex redirect applies to browser navigation (GET requests)
3. POST requests go directly to API endpoints (not www)
4. Maximum SEO value transfer

> **Note:** If you have POST traffic to www that must preserve method, consider 308. For typical www→apex redirect, 301 is correct.

---

## 5. Implementation Plan

### 5.1 Implementation Method: Cloudflare Redirect Rules

Redirect at the Cloudflare edge using **Redirect Rules** (not Page Rules, which are deprecated).

| Method             | Recommendation  | Notes                             |
| ------------------ | --------------- | --------------------------------- |
| **Redirect Rules** | **RECOMMENDED** | Modern, fast, configurable        |
| Page Rules         | Deprecated      | Limited to 3 free rules           |
| Worker Redirect    | Not recommended | Unnecessary complexity/cost       |
| Bulk Redirects     | Overkill        | Designed for large redirect lists |

### 5.2 UI Implementation Steps

```
IMPLEMENTATION CHECKLIST — SEC-4.1 Canonical Host Redirect

DOMAIN: oursharedevents.com                    DATE: ___________

PRE-IMPLEMENTATION
[ ] 1. Verify TLS Strict Baseline (SEC-3.1) is active
[ ] 2. Verify "Always Use HTTPS" is enabled
[ ] 3. Verify www.oursharedevents.com resolves (DNS A/AAAA or CNAME exists)
[ ] 4. Verify www.oursharedevents.com is proxied (orange cloud)
[ ] 5. Document current www behavior: ___________

CREATE REDIRECT RULE
[ ] 6. Navigate to: Rules → Redirect Rules
[ ] 7. Click "Create rule"
[ ] 8. Rule name: "SEC-4.1: www to apex canonical redirect"
[ ] 9. When incoming requests match:
      Field: Hostname
      Operator: equals
      Value: www.oursharedevents.com
[ ] 10. Then:
       Type: Dynamic
       Expression: concat("https://oursharedevents.com", http.request.uri)
       Status code: 301
       Preserve query string: Yes (handled by expression)
[ ] 11. Click "Deploy"

VERIFICATION
[ ] 12. Run verification tests (Section 6)
[ ] 13. Document test results: PASS / FAIL

WORKER ROUTE CLEANUP
[ ] 14. Verify NO worker route exists for www.oursharedevents.com
       Location: Workers & Pages → oursharedevents-router-prod → Triggers
[ ] 15. If www route exists, REMOVE IT (not edit, REMOVE)

Implemented by: _____________  Date: _____________
```

### 5.3 Terraform/Pulumi Implementation (Optional)

If using Infrastructure as Code:

```hcl
# Terraform example
resource "cloudflare_ruleset" "redirect_www_to_apex" {
  zone_id     = var.zone_id
  name        = "Redirect Rules"
  description = "SEC-4.1: Canonical host redirects"
  kind        = "zone"
  phase       = "http_request_dynamic_redirect"

  rules {
    action = "redirect"
    action_parameters {
      from_value {
        status_code = 301
        target_url {
          expression = "concat(\"https://oursharedevents.com\", http.request.uri)"
        }
        preserve_query_string = true
      }
    }
    expression  = "(http.host eq \"www.oursharedevents.com\")"
    description = "SEC-4.1: www to apex canonical redirect"
    enabled     = true
  }
}
```

---

## 6. Test Matrix

### 6.1 Redirect Verification Tests

| Test ID | Request                                                    | Expected Response | Expected Location Header                       |
| ------- | ---------------------------------------------------------- | ----------------- | ---------------------------------------------- |
| **T-1** | `curl -sI http://www.oursharedevents.com/`                 | 301               | `https://oursharedevents.com/`                 |
| **T-2** | `curl -sI https://www.oursharedevents.com/`                | 301               | `https://oursharedevents.com/`                 |
| **T-3** | `curl -sI https://www.oursharedevents.com/events/abc`      | 301               | `https://oursharedevents.com/events/abc`       |
| **T-4** | `curl -sI "https://www.oursharedevents.com/public?id=xyz"` | 301               | `https://oursharedevents.com/public?id=xyz`    |
| **T-5** | `curl -sI "https://www.oursharedevents.com/path?a=1&b=2"`  | 301               | `https://oursharedevents.com/path?a=1&b=2`     |
| **T-6** | `curl -sI https://oursharedevents.com/`                    | 200               | N/A (no redirect)                              |
| **T-7** | `curl -sI http://oursharedevents.com/`                     | 301               | `https://oursharedevents.com/` (HTTPS upgrade) |

### 6.2 Canonical Host Verification Tests

| Test ID  | Request                                               | Expected Response | Notes                     |
| -------- | ----------------------------------------------------- | ----------------- | ------------------------- |
| **T-8**  | `curl -sI https://oursharedevents.com/api/status`     | 200               | API responds on apex      |
| **T-9**  | `curl -sI https://api.oursharedevents.com/status`     | 200               | API subdomain works       |
| **T-10** | `curl -sI https://www.oursharedevents.com/api/status` | 301               | www API redirects to apex |

### 6.3 Verification Script

Save as `scripts/verify-canonical-host.sh`:

```bash
#!/bin/bash
# SEC-4.1 Canonical Host Redirect Verification Script
# Usage: ./verify-canonical-host.sh

CANONICAL="oursharedevents.com"
NON_CANONICAL="www.oursharedevents.com"
PASS=0
FAIL=0

echo "=== SEC-4.1 Canonical Host Verification ==="
echo "Canonical: $CANONICAL"
echo "Non-Canonical: $NON_CANONICAL"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# Test function
test_redirect() {
    local test_id="$1"
    local url="$2"
    local expected_status="$3"
    local expected_location="$4"

    echo "[$test_id] Testing: $url"

    response=$(curl -sI "$url" 2>&1)
    status=$(echo "$response" | head -1 | grep -oE "[0-9]{3}")
    location=$(echo "$response" | grep -i "^location:" | sed 's/location: //i' | tr -d '\r')

    if [ "$status" == "$expected_status" ]; then
        if [ -n "$expected_location" ]; then
            if [ "$location" == "$expected_location" ]; then
                echo "  ✓ PASS: Status $status, Location: $location"
                ((PASS++))
            else
                echo "  ✗ FAIL: Expected Location: $expected_location"
                echo "         Got Location: $location"
                ((FAIL++))
            fi
        else
            echo "  ✓ PASS: Status $status (no redirect expected)"
            ((PASS++))
        fi
    else
        echo "  ✗ FAIL: Expected status $expected_status, got $status"
        ((FAIL++))
    fi
}

# T-1: HTTP www root
test_redirect "T-1" "http://$NON_CANONICAL/" "301" "https://$CANONICAL/"

# T-2: HTTPS www root
test_redirect "T-2" "https://$NON_CANONICAL/" "301" "https://$CANONICAL/"

# T-3: HTTPS www with path
test_redirect "T-3" "https://$NON_CANONICAL/events/abc" "301" "https://$CANONICAL/events/abc"

# T-4: HTTPS www with query
test_redirect "T-4" "https://$NON_CANONICAL/public?id=xyz" "301" "https://$CANONICAL/public?id=xyz"

# T-5: HTTPS www with multiple query params
test_redirect "T-5" "https://$NON_CANONICAL/path?a=1&b=2" "301" "https://$CANONICAL/path?a=1&b=2"

# T-6: HTTPS canonical root (should NOT redirect)
test_redirect "T-6" "https://$CANONICAL/" "200" ""

# T-7: HTTP canonical root (should upgrade to HTTPS only)
echo "[T-7] Testing: http://$CANONICAL/"
response=$(curl -sI "http://$CANONICAL/" 2>&1)
status=$(echo "$response" | head -1 | grep -oE "[0-9]{3}")
location=$(echo "$response" | grep -i "^location:" | sed 's/location: //i' | tr -d '\r')

if [ "$status" == "301" ] && [[ "$location" == "https://$CANONICAL/"* ]]; then
    # Should redirect to HTTPS on same host, NOT to www
    if [[ "$location" != *"www"* ]]; then
        echo "  ✓ PASS: HTTP upgrades to HTTPS on canonical host"
        ((PASS++))
    else
        echo "  ✗ FAIL: Redirected to www instead of staying on canonical"
        ((FAIL++))
    fi
else
    echo "  ⚠ WARN: Status $status - verify HTTPS upgrade behavior"
    ((PASS++))  # May be handled differently
fi

echo ""
echo "=== Results ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"

if [ $FAIL -gt 0 ]; then
    echo ""
    echo "⚠️  CANONICAL HOST REDIRECT NOT PROPERLY CONFIGURED"
    exit 1
else
    echo ""
    echo "✓ SEC-4.1 CANONICAL HOST REDIRECT VERIFIED"
    exit 0
fi
```

### 6.4 Quick Verification Commands

```bash
# One-liner: Verify www redirects to apex with path preserved
curl -sI "https://www.oursharedevents.com/test/path?query=value" | grep -iE "^(HTTP|Location)"

# Expected output:
# HTTP/2 301
# location: https://oursharedevents.com/test/path?query=value

# Verify canonical host serves content (no redirect)
curl -sI https://oursharedevents.com/ | head -1
# Expected: HTTP/2 200

# Follow redirects and show chain
curl -sIL http://www.oursharedevents.com/path 2>&1 | grep -iE "^(HTTP|Location)"
# Expected: Shows 301 chain ending in 200
```

---

## 7. Worker Route Requirements

### 7.1 Critical Constraint: No Duplicate Worker Routes

> **EXPLICITLY STATED:** Worker routes must NOT be configured for the non-canonical host (`www.oursharedevents.com`).

| Requirement                                         | Status       |
| --------------------------------------------------- | ------------ |
| **No worker route for `www.oursharedevents.com/*`** | **REQUIRED** |

### 7.2 Rationale

| Issue                         | Problem If www Route Exists                    |
| ----------------------------- | ---------------------------------------------- |
| **Request Handling Conflict** | Worker may handle request before redirect rule |
| **Duplicate Processing**      | Same logic executed on both hostnames          |
| **Inconsistent Behavior**     | Different response on www vs apex              |
| **Wasted Resources**          | Worker invocations for redirectable traffic    |
| **SEO/Analytics Confusion**   | Traffic split across hostnames                 |

### 7.3 Correct Worker Route Configuration

**Production routes should be:**

```toml
# worker/wrangler.toml [env.production]
routes = [
  { pattern = "oursharedevents.com/*", zone_name = "oursharedevents.com" },
  { pattern = "api.oursharedevents.com/*", zone_name = "oursharedevents.com" }
]

# EXPLICITLY: NO www.oursharedevents.com/* route
# www traffic is redirected at edge BEFORE reaching Worker
```

### 7.4 Verification

```bash
# Check wrangler.toml for www routes (should find nothing)
grep -r "www.oursharedevents.com" worker/wrangler.toml

# Expected: No output (no www routes configured)

# If output exists, the www route must be REMOVED
```

---

## 8. DNS Requirements

### 8.1 Required DNS Records

Both apex and www must have DNS records pointing to Cloudflare (proxied) for the redirect to work.

| Hostname                  | Record Type | Value                            | Proxied                |
| ------------------------- | ----------- | -------------------------------- | ---------------------- |
| `oursharedevents.com`     | A           | Cloudflare IP (or placeholder)   | **Yes (orange cloud)** |
| `oursharedevents.com`     | AAAA        | Cloudflare IPv6 (or placeholder) | **Yes (orange cloud)** |
| `www.oursharedevents.com` | CNAME       | `oursharedevents.com`            | **Yes (orange cloud)** |

### 8.2 DNS Verification

```bash
# Verify www resolves and is proxied
dig +short www.oursharedevents.com

# Should return Cloudflare IP addresses (not origin IPs)
# Example: 104.21.x.x, 172.67.x.x (Cloudflare IPs)

# Verify apex resolves
dig +short oursharedevents.com
```

---

## 9. Failure Modes and Troubleshooting

### 9.1 Common Issues

| Symptom             | Likely Cause                  | Resolution                                  |
| ------------------- | ----------------------------- | ------------------------------------------- |
| www returns 522/523 | www DNS not proxied           | Enable proxy (orange cloud) for www         |
| www returns 404     | Worker route exists for www   | Remove www worker route                     |
| www not redirecting | Redirect rule not deployed    | Create/deploy redirect rule (Section 5.2)   |
| Path not preserved  | Incorrect redirect expression | Use `http.request.uri` in expression        |
| Query string lost   | Incorrect redirect expression | Verify expression includes query string     |
| Redirect loop       | Multiple conflicting rules    | Audit all redirect rules; remove duplicates |
| 308 instead of 301  | Wrong status code selected    | Edit rule, change to 301                    |

### 9.2 Debugging Commands

```bash
# Check what www returns (headers only)
curl -sI https://www.oursharedevents.com/

# Check full redirect chain
curl -sIL https://www.oursharedevents.com/path?query=value

# Verbose output for debugging
curl -v https://www.oursharedevents.com/ 2>&1 | head -50

# Check DNS resolution
dig +short www.oursharedevents.com
nslookup www.oursharedevents.com
```

### 9.3 Rollback Procedure

If canonical redirect causes issues:

| Step | Action                                         |
| ---- | ---------------------------------------------- |
| 1    | Navigate to Rules → Redirect Rules             |
| 2    | Find "SEC-4.1: www to apex canonical redirect" |
| 3    | Toggle rule to **Disabled** (don't delete)     |
| 4    | Verify www now serves content directly         |
| 5    | Investigate root cause before re-enabling      |

---

## 10. Compliance Verification

### 10.1 Manual Confirmation Checklist

| #   | Question                         | Expected Answer       | How to Verify                               |
| --- | -------------------------------- | --------------------- | ------------------------------------------- |
| 1   | What is the canonical host?      | `oursharedevents.com` | This document                               |
| 2   | Does www redirect to apex?       | Yes, 301              | `curl -sI https://www.oursharedevents.com/` |
| 3   | Is path preserved in redirect?   | Yes                   | Test with path, verify Location header      |
| 4   | Is query string preserved?       | Yes                   | Test with query, verify Location header     |
| 5   | What status code is used?        | 301                   | Check response headers                      |
| 6   | Are there worker routes for www? | **NO**                | Check wrangler.toml                         |
| 7   | Is www DNS proxied?              | Yes                   | Check Cloudflare DNS dashboard              |

### 10.2 Acceptance Criteria Summary

| Criterion                               | Required | Verification Method  |
| --------------------------------------- | -------- | -------------------- |
| Canonical host is `oursharedevents.com` | ✓        | Documentation        |
| www redirects to apex                   | ✓        | Test T-1, T-2        |
| Redirect uses 301 status                | ✓        | Test T-1 through T-5 |
| Path is preserved                       | ✓        | Test T-3             |
| Query string is preserved               | ✓        | Test T-4, T-5        |
| Apex serves content (no redirect)       | ✓        | Test T-6             |
| No worker route for www                 | ✓        | grep wrangler.toml   |

---

## 11. Related Documents

| Document             | Path                                   | Relationship           |
| -------------------- | -------------------------------------- | ---------------------- |
| TLS Strict Baseline  | `docs/security/TLS_STRICT_BASELINE.md` | Prerequisite (SEC-3.1) |
| HSTS Rollout         | `docs/security/HSTS_ROLLOUT.md`        | Related (SEC-3.2)      |
| Security Baseline    | `docs/security/SECURITY_BASELINE.md`   | Parent security model  |
| Worker Configuration | `worker/wrangler.toml`                 | Route configuration    |

---

## 12. Summary

| Attribute                 | Value                            |
| ------------------------- | -------------------------------- |
| **Canonical Host**        | `oursharedevents.com`            |
| **Redirect Source**       | `www.oursharedevents.com`        |
| **Redirect Status**       | 301 Moved Permanently            |
| **Path Preservation**     | Yes                              |
| **Query Preservation**    | Yes                              |
| **Implementation**        | Cloudflare Redirect Rule         |
| **Worker Routes for www** | **NONE** (explicitly prohibited) |

---

## Document History

| Date       | Author      | Changes                                                 |
| ---------- | ----------- | ------------------------------------------------------- |
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-4.1 canonical host specification |
