# WORKER_ROUTE_COLLAPSE_RUNBOOK.md — Single Worker Entrypoint Migration

> **PROMPTSPEC-SEC-4.2** — Worker Route Migration
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Collapse route sprawl into `eventangle.com/*` as the single Worker route entrypoint. This consolidation reduces attack surface, simplifies routing logic, and provides a single point of control for all traffic.

| Attribute | Value |
|-----------|-------|
| **Scope** | Production and staging Worker route configuration |
| **Prerequisites** | Cloudflare Workers deployed, API subdomain traffic analysis complete |
| **Constraints** | Zero-downtime migration required; all critical paths must remain functional |

---

## 2. Current State Analysis

### 2.1 Existing Route Configuration

**Production Routes (cloudflare-proxy/wrangler.toml, worker/wrangler.toml):**

| Route Pattern | Zone | Purpose |
|---------------|------|---------|
| `eventangle.com/*` | eventangle.com | Main domain - all traffic (canonical) |
| `api.eventangle.com/*` | eventangle.com | API subdomain (redundant) |

**Staging Routes:**

| Route Pattern | Zone | Purpose |
|---------------|------|---------|
| `stg.eventangle.com/*` | eventangle.com | Staging main domain |
| `api-stg.eventangle.com/*` | eventangle.com | Staging API subdomain (redundant) |

### 2.2 Why Consolidation is Needed

```
CURRENT STATE (Multiple Routes):
┌─────────────────┐         ┌─────────────────────────┐
│   Client        │ ──────▶ │ eventangle.com/*        │───┐
└─────────────────┘         └─────────────────────────┘   │
                            ┌─────────────────────────┐   │
┌─────────────────┐ ──────▶ │ api.eventangle.com/*    │───┤  Same Worker
│   Client        │         └─────────────────────────┘   │
└─────────────────┘                                       ▼
                                              ┌─────────────────┐
                                              │  Worker Router  │
                                              └─────────────────┘

ISSUES:
- Route sprawl increases configuration complexity
- Multiple entrypoints complicate security auditing
- api.eventangle.com is redundant (all /api/* routes work on main domain)
- Potential for route drift between configurations

TARGET STATE (Single Route):
┌─────────────────┐         ┌─────────────────────────┐
│   All Traffic   │ ──────▶ │ eventangle.com/*        │──▶ Worker Router
└─────────────────┘         └─────────────────────────┘

BENEFITS:
- Single point of control for all traffic
- Simplified security auditing
- Reduced configuration drift risk
- Clearer canonical URL structure
```

### 2.3 API Subdomain Analysis

The `api.eventangle.com` subdomain routes to the same Worker and all endpoints are accessible via the main domain:

| API Endpoint | Main Domain | API Subdomain | Status |
|--------------|-------------|---------------|--------|
| `/api/status` | `eventangle.com/api/status` | `api.eventangle.com/api/status` | Both work |
| `/api/v2/events` | `eventangle.com/api/v2/events` | `api.eventangle.com/api/v2/events` | Both work |
| `/api/health/backend` | `eventangle.com/api/health/backend` | `api.eventangle.com/api/health/backend` | Both work |

**Conclusion:** The API subdomain provides no additional functionality and can be removed.

---

## 3. Implementation Plan

### Phase 1: Export Route Snapshot

**Time Required:** 10 minutes
**Risk Level:** None (read-only)

Document existing routes before any changes.

#### 3.1.1 Export via Cloudflare API

```bash
# Set your API credentials
export CF_API_TOKEN="your-cloudflare-api-token"
export CF_ZONE_ID="your-zone-id"

# Export current Worker routes
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/workers/routes" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" | jq '.' > worker_routes_snapshot_$(date +%Y%m%d_%H%M%S).json

# Verify snapshot was created
cat worker_routes_snapshot_*.json | jq '.result[] | {id, pattern, script}'
```

#### 3.1.2 Export via Dashboard

| Step | Action | Location |
|------|--------|----------|
| 1 | Log into Cloudflare dashboard | dash.cloudflare.com |
| 2 | Select eventangle.com zone | Zone dropdown |
| 3 | Navigate to Workers & Pages → Routes | Left sidebar |
| 4 | Screenshot or document all routes | Routes table |
| 5 | Save to incident response folder | Local documentation |

#### 3.1.3 Document Route Snapshot

```
ROUTE SNAPSHOT - DATE: ___________

PRODUCTION ROUTES:
[ ] Route 1: pattern=_______________ script=_______________ id=_______________
[ ] Route 2: pattern=_______________ script=_______________ id=_______________

STAGING ROUTES:
[ ] Route 1: pattern=_______________ script=_______________ id=_______________
[ ] Route 2: pattern=_______________ script=_______________ id=_______________

Snapshot file location: _______________
Captured by: _______________
```

---

### Phase 2: Pre-Migration Verification

**Time Required:** 15 minutes
**Risk Level:** None (read-only)

Verify all critical paths are working before migration.

#### 3.2.1 Critical Path Verification Checklist

Run these tests against the **main domain** to confirm all functionality exists without the API subdomain:

```bash
DOMAIN="eventangle.com"  # Use stg.eventangle.com for staging

echo "=== Critical Path Verification ==="
echo "Domain: $DOMAIN"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# HTML Pages
echo "[1/10] Events Page (Public)"
curl -sI "https://$DOMAIN/events" | head -1
# Expected: HTTP/2 200

echo "[2/10] Poster Page"
curl -sI "https://$DOMAIN/poster" | head -1
# Expected: HTTP/2 200

echo "[3/10] Admin Page"
curl -sI "https://$DOMAIN/admin" | head -1
# Expected: HTTP/2 200 (or redirect if OAuth enabled)

echo "[4/10] Display Page"
curl -sI "https://$DOMAIN/display" | head -1
# Expected: HTTP/2 200

# API Endpoints
echo "[5/10] API Status"
curl -s "https://$DOMAIN/api/status" | jq '.ok'
# Expected: true

echo "[6/10] API V2 Events"
curl -s "https://$DOMAIN/api/v2/events?brand=root" | jq '.ok'
# Expected: true

echo "[7/10] API Health Backend"
curl -s "https://$DOMAIN/api/health/backend" | jq '.ok'
# Expected: true

# Health Endpoints
echo "[8/10] Health Origin"
curl -s "https://$DOMAIN/health/origin" | jq '.ok'
# Expected: true

# API Bundles (require valid eventId)
echo "[9/10] Public Bundle (placeholder test)"
curl -sI "https://$DOMAIN/api/events/test-event-id/publicBundle" | head -1
# Expected: HTTP/2 200 or 404 (depending on event existence)

# Root path
echo "[10/10] Root Path"
curl -sI "https://$DOMAIN/" | head -1
# Expected: HTTP/2 200

echo ""
echo "=== Verification Complete ==="
```

#### 3.2.2 Pre-Migration Checklist

```
PRE-MIGRATION VERIFICATION - DATE: ___________
DOMAIN: _______________

MAIN DOMAIN TESTS (eventangle.com):
[ ] /events returns HTTP 200
[ ] /poster returns HTTP 200
[ ] /admin returns HTTP 200 (or OAuth redirect)
[ ] /display returns HTTP 200
[ ] /api/status returns ok: true
[ ] /api/v2/events returns ok: true
[ ] /api/health/backend returns ok: true
[ ] /health/origin returns ok: true
[ ] / (root) returns HTTP 200

API SUBDOMAIN TRAFFIC ANALYSIS:
[ ] Reviewed access logs for api.eventangle.com
[ ] Identified any external integrations using api. subdomain
[ ] Notified integration owners of upcoming change (if any)
[ ] No critical dependencies on api. subdomain confirmed

Verified by: _______________
```

---

### Phase 3: Add Redirect Rule for API Subdomain

**Time Required:** 10 minutes
**Risk Level:** Low

Before removing the API subdomain route, add a redirect to preserve any existing links.

#### 3.3.1 Create Redirect Rule via Dashboard

| Step | Action | Location |
|------|--------|----------|
| 1 | Log into Cloudflare dashboard | dash.cloudflare.com |
| 2 | Select eventangle.com zone | Zone dropdown |
| 3 | Navigate to Rules → Redirect Rules | Left sidebar |
| 4 | Click **Create rule** | Top right |
| 5 | Configure rule (see below) | Rule editor |
| 6 | Deploy | Save and deploy |

**Redirect Rule Configuration:**

```
Rule Name: SEC-4.2 API Subdomain to Main Domain Redirect

When incoming requests match:
  Field: Hostname
  Operator: equals
  Value: api.eventangle.com

Then:
  Type: Dynamic
  Expression: concat("https://eventangle.com", http.request.uri.path)
  Status code: 301 (Permanent Redirect)
  Preserve query string: ON
```

#### 3.3.2 Create Redirect Rule via API

```bash
# Create redirect rule for api.eventangle.com → eventangle.com
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/rulesets/phases/http_request_dynamic_redirect/entrypoint" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "SEC-4.2 API Subdomain Redirect",
    "kind": "zone",
    "phase": "http_request_dynamic_redirect",
    "rules": [
      {
        "action": "redirect",
        "action_parameters": {
          "from_value": {
            "status_code": 301,
            "target_url": {
              "expression": "concat(\"https://eventangle.com\", http.request.uri.path)"
            },
            "preserve_query_string": true
          }
        },
        "expression": "(http.host eq \"api.eventangle.com\")",
        "description": "Redirect api.eventangle.com to main domain"
      }
    ]
  }'
```

#### 3.3.3 Verify Redirect

```bash
# Test redirect
curl -sI "https://api.eventangle.com/api/status" 2>&1 | grep -E "^(HTTP|Location)"
# Expected:
# HTTP/2 301
# location: https://eventangle.com/api/status

# Verify redirect resolves correctly
curl -sIL "https://api.eventangle.com/api/status" 2>&1 | grep -E "^HTTP"
# Expected:
# HTTP/2 301 (redirect)
# HTTP/2 200 (final destination)
```

---

### Phase 4: Remove Old Routes Incrementally

**Time Required:** 30 minutes
**Risk Level:** Medium

Remove redundant routes one at a time with verification between each.

#### 3.4.1 Update wrangler.toml Files

**File: `cloudflare-proxy/wrangler.toml`**

Before:
```toml
[env.production]
routes = [
  { pattern = "eventangle.com/*", zone_name = "eventangle.com" },
  { pattern = "api.eventangle.com/*", zone_name = "eventangle.com" }
]
```

After:
```toml
[env.production]
# SEC-4.2: Single Worker entrypoint - api.eventangle.com redirected at edge
routes = [
  { pattern = "eventangle.com/*", zone_name = "eventangle.com" }
]
```

**File: `worker/wrangler.toml`**

Before:
```toml
[env.production]
routes = [
  { pattern = "eventangle.com/*", zone_name = "eventangle.com" },
  { pattern = "api.eventangle.com/*", zone_name = "eventangle.com" }
]
```

After:
```toml
[env.production]
# SEC-4.2: Single Worker entrypoint - api.eventangle.com redirected at edge
routes = [
  { pattern = "eventangle.com/*", zone_name = "eventangle.com" }
]
```

**File: `wrangler.toml` (root - staging)**

Before:
```toml
routes = [
  { pattern = "stg.eventangle.com/*", zone_name = "eventangle.com" },
  { pattern = "api-stg.eventangle.com/*", zone_name = "eventangle.com" }
]
```

After:
```toml
# SEC-4.2: Single Worker entrypoint - api-stg.eventangle.com redirected at edge
routes = [
  { pattern = "stg.eventangle.com/*", zone_name = "eventangle.com" }
]
```

#### 3.4.2 Deployment Order

Execute in this order with verification between each step:

```
DEPLOYMENT SEQUENCE:

Step 1: Deploy staging changes
[ ] Update wrangler.toml (root)
[ ] Update worker/wrangler.toml [env.staging]
[ ] Deploy: wrangler deploy --env staging
[ ] Verify staging (see Phase 5)
[ ] Wait 15 minutes, monitor for errors

Step 2: Deploy production changes
[ ] Update cloudflare-proxy/wrangler.toml [env.production]
[ ] Update worker/wrangler.toml [env.production]
[ ] Deploy: wrangler deploy --env production
[ ] Verify production (see Phase 5)
[ ] Monitor for 30 minutes

Step 3: Remove API subdomain route via API (if not auto-removed)
[ ] List current routes: curl workers/routes
[ ] Identify api.eventangle.com route ID
[ ] Delete route: curl -X DELETE workers/routes/{id}
[ ] Verify route removed
```

#### 3.4.3 Route Removal via API

```bash
# List all routes to find the api.eventangle.com route ID
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/workers/routes" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" | jq '.result[] | select(.pattern | contains("api.")) | {id, pattern}'

# Delete the API subdomain route (replace ROUTE_ID)
ROUTE_ID="the-route-id-from-above"
curl -X DELETE "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/workers/routes/${ROUTE_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json"

# Verify route was deleted
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/workers/routes" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" | jq '.result[] | {pattern}'
```

---

### Phase 5: Post-Migration Verification

**Time Required:** 15 minutes
**Risk Level:** None (read-only)

#### 3.5.1 Critical Path Verification Script

Save as `scripts/verify-route-collapse.sh`:

```bash
#!/bin/bash
# SEC-4.2 Route Collapse Verification Script
# Usage: ./verify-route-collapse.sh [domain]

DOMAIN="${1:-eventangle.com}"
PASS=0
FAIL=0

echo "=== SEC-4.2 Route Collapse Verification ==="
echo "Domain: $DOMAIN"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# Function to check HTTP status
check_status() {
    local url="$1"
    local expected="$2"
    local name="$3"

    status=$(curl -sI "$url" 2>/dev/null | head -1 | awk '{print $2}')
    if [ "$status" = "$expected" ]; then
        echo "  [PASS] $name: HTTP $status"
        ((PASS++))
    else
        echo "  [FAIL] $name: Expected HTTP $expected, got HTTP $status"
        ((FAIL++))
    fi
}

# Function to check JSON ok field
check_json_ok() {
    local url="$1"
    local name="$2"

    ok=$(curl -s "$url" 2>/dev/null | jq -r '.ok' 2>/dev/null)
    if [ "$ok" = "true" ]; then
        echo "  [PASS] $name: ok=true"
        ((PASS++))
    else
        echo "  [FAIL] $name: ok=$ok (expected true)"
        ((FAIL++))
    fi
}

echo "=== HTML Pages ==="
check_status "https://$DOMAIN/events" "200" "/events"
check_status "https://$DOMAIN/poster" "200" "/poster"
check_status "https://$DOMAIN/admin" "200" "/admin"
check_status "https://$DOMAIN/display" "200" "/display"
check_status "https://$DOMAIN/report" "200" "/report"
check_status "https://$DOMAIN/" "200" "/ (root)"

echo ""
echo "=== API Endpoints ==="
check_json_ok "https://$DOMAIN/api/status" "/api/status"
check_json_ok "https://$DOMAIN/api/v2/events?brand=root" "/api/v2/events"
check_json_ok "https://$DOMAIN/api/health/backend" "/api/health/backend"

echo ""
echo "=== Health Endpoints ==="
check_json_ok "https://$DOMAIN/health/origin" "/health/origin"

echo ""
echo "=== API Subdomain Redirect ==="
# Check that api.eventangle.com redirects properly
api_redirect=$(curl -sI "https://api.$DOMAIN/api/status" 2>/dev/null | grep -i "^location:" | awk '{print $2}' | tr -d '\r')
if [[ "$api_redirect" == "https://$DOMAIN/api/status" ]]; then
    echo "  [PASS] api.$DOMAIN redirects to $DOMAIN"
    ((PASS++))
else
    echo "  [FAIL] api.$DOMAIN redirect: got '$api_redirect'"
    ((FAIL++))
fi

# Verify redirect status code
redirect_status=$(curl -sI "https://api.$DOMAIN/api/status" 2>/dev/null | head -1 | awk '{print $2}')
if [ "$redirect_status" = "301" ]; then
    echo "  [PASS] api.$DOMAIN returns 301 Permanent Redirect"
    ((PASS++))
else
    echo "  [FAIL] api.$DOMAIN status: Expected 301, got $redirect_status"
    ((FAIL++))
fi

echo ""
echo "=== Route Configuration ==="
# Verify only one Worker route exists (requires API token)
if [ -n "$CF_API_TOKEN" ] && [ -n "$CF_ZONE_ID" ]; then
    route_count=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/workers/routes" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" | jq '.result | length')
    echo "  Worker routes configured: $route_count"

    if [ "$route_count" = "1" ]; then
        echo "  [PASS] Single route configured (target state)"
        ((PASS++))
    else
        echo "  [WARN] Multiple routes still configured: $route_count"
    fi
else
    echo "  [SKIP] Route count check (CF_API_TOKEN/CF_ZONE_ID not set)"
fi

echo ""
echo "=== Results ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"

if [ $FAIL -gt 0 ]; then
    echo ""
    echo "WARNING: Some checks failed - review before proceeding"
    exit 1
else
    echo ""
    echo "SUCCESS: All critical paths verified"
    exit 0
fi
```

#### 3.5.2 Post-Migration Checklist

```
POST-MIGRATION VERIFICATION - DATE: ___________
DOMAIN: _______________

MAIN DOMAIN FUNCTIONALITY:
[ ] /events returns HTTP 200 with correct content
[ ] /poster returns HTTP 200 with correct content
[ ] /admin returns HTTP 200 (or OAuth redirect)
[ ] /display returns HTTP 200 with correct content
[ ] /api/status returns ok: true
[ ] /api/v2/events returns ok: true with event data
[ ] /api/health/backend returns ok: true
[ ] /health/origin returns ok: true

API SUBDOMAIN REDIRECT:
[ ] api.eventangle.com/api/status returns 301 redirect
[ ] Redirect location is https://eventangle.com/api/status
[ ] Following redirect returns correct response

ROUTE CONFIGURATION:
[ ] Only eventangle.com/* route exists in Cloudflare
[ ] No api.eventangle.com/* route in Workers Routes
[ ] wrangler.toml files updated with SEC-4.2 comments

MONITORING:
[ ] No spike in 5xx errors in last 15 minutes
[ ] No spike in 4xx errors in last 15 minutes
[ ] Response times within normal range

Verified by: _______________
Timestamp: _______________
```

---

## 4. Rollback Plan

### 4.1 When to Rollback

Rollback if any of these occur:
- Critical path returns 5xx errors
- Redirect loop detected
- User reports of broken functionality
- Significant increase in error rate (>1%)

### 4.2 Rollback Steps

**Time Required:** 5 minutes

#### 4.2.1 Restore API Subdomain Route via API

```bash
# Re-add the api.eventangle.com route
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/workers/routes" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "pattern": "api.eventangle.com/*",
    "script": "eventangle-prod"
  }'

# Verify route was added
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/workers/routes" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '.result[] | {pattern, script}'
```

#### 4.2.2 Disable Redirect Rule

| Step | Action | Location |
|------|--------|----------|
| 1 | Navigate to Rules → Redirect Rules | Cloudflare Dashboard |
| 2 | Find "SEC-4.2 API Subdomain Redirect" rule | Rules list |
| 3 | Toggle rule to **Disabled** | Rule toggle |
| 4 | Verify api.eventangle.com serves directly | curl test |

#### 4.2.3 Revert wrangler.toml Files

```bash
# Revert changes
git checkout -- wrangler.toml
git checkout -- cloudflare-proxy/wrangler.toml
git checkout -- worker/wrangler.toml

# Redeploy with original routes
wrangler deploy --env production
```

#### 4.2.4 Rollback Verification

```bash
# Verify API subdomain serves directly (not redirect)
curl -sI "https://api.eventangle.com/api/status" | head -1
# Expected: HTTP/2 200 (not 301)

# Verify response is from Worker
curl -s "https://api.eventangle.com/api/status" | jq '.ok'
# Expected: true
```

### 4.3 Rollback Checklist

```
ROLLBACK CHECKLIST - DATE: ___________

TRIGGER:
[ ] Documented reason for rollback: _______________

ROLLBACK ACTIONS:
[ ] Re-added api.eventangle.com/* route via API
[ ] Disabled redirect rule in dashboard
[ ] Reverted wrangler.toml files
[ ] Redeployed Worker (if needed)

VERIFICATION:
[ ] api.eventangle.com/api/status returns HTTP 200 directly
[ ] api.eventangle.com/api/status returns ok: true
[ ] eventangle.com/api/status returns ok: true
[ ] No 301 redirect from api.eventangle.com

POST-ROLLBACK:
[ ] Incident documented
[ ] Root cause analysis scheduled
[ ] Re-attempt planned with fixes

Rolled back by: _______________
Timestamp: _______________
```

---

## 5. Failure Modes

### 5.1 Common Issues

| Symptom | Likely Cause | Resolution |
|---------|--------------|------------|
| api.eventangle.com returns 522 | Route removed but redirect not added | Add redirect rule (Phase 3) |
| Redirect loop | Redirect rule misconfigured | Verify redirect target doesn't include api. subdomain |
| 404 on api.eventangle.com | Route removed, redirect not propagated | Wait 5 minutes for propagation |
| 5xx errors after deployment | wrangler.toml syntax error | Check deployment logs, revert if needed |
| External integration broken | Third party using api. subdomain | Contact integration owner, 301 should be followed |

### 5.2 Redirect Loop Prevention

The redirect rule must NOT:
- Redirect api.eventangle.com to api.eventangle.com (loop)
- Include the api. prefix in the target URL

**Correct:**
```
api.eventangle.com/api/status → eventangle.com/api/status
```

**Incorrect:**
```
api.eventangle.com/api/status → api.eventangle.com/api/status (loop!)
```

### 5.3 DNS Considerations

If api.eventangle.com has a separate DNS record:
- Record can remain (will hit Cloudflare proxy)
- Redirect rule handles routing to main domain
- No DNS changes required for this migration

---

## 6. Compliance Verification

### 6.1 Success Criteria

| # | Criterion | How to Verify |
|---|-----------|---------------|
| 1 | Single Worker route exists | Cloudflare Dashboard → Workers Routes shows only `eventangle.com/*` |
| 2 | API subdomain redirects | `curl -sI api.eventangle.com/api/status` returns 301 to main domain |
| 3 | All critical paths work | Run verification script (Phase 5) |
| 4 | wrangler.toml updated | Files show single route with SEC-4.2 comment |
| 5 | No errors in monitoring | Cloudflare Analytics shows normal error rates |

### 6.2 Final Verification Summary

```
SEC-4.2 COMPLIANCE VERIFICATION - DATE: ___________

SINGLE ENTRYPOINT:
[ ] Only eventangle.com/* route configured
[ ] api.eventangle.com/* route removed
[ ] Redirect rule active for api. subdomain

CRITICAL PATHS FUNCTIONAL:
[ ] /events - Public events page
[ ] /poster - Poster generation page
[ ] /admin - Admin dashboard
[ ] /api/* - All API endpoints
[ ] /health/* - Health check endpoints

DOCUMENTATION:
[ ] wrangler.toml files updated with comments
[ ] Route snapshot archived
[ ] Runbook followed completely

SIGN-OFF:
Completed by: _______________
Verified by: _______________
Date: _______________
```

---

## 7. Quick Reference

### 7.1 Key Commands

```bash
# Export route snapshot
curl -s "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/workers/routes" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '.'

# Test redirect
curl -sIL "https://api.eventangle.com/api/status" | grep -E "^(HTTP|[Ll]ocation)"

# Verify critical paths
./scripts/verify-route-collapse.sh eventangle.com

# Delete a route
curl -X DELETE "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/workers/routes/${ROUTE_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

### 7.2 Key URLs

| Resource | URL |
|----------|-----|
| Cloudflare Dashboard | https://dash.cloudflare.com |
| Workers Routes | Dashboard → Workers & Pages → Routes |
| Redirect Rules | Dashboard → Rules → Redirect Rules |
| Workers API Docs | https://developers.cloudflare.com/workers/configuration/routing/routes/ |

### 7.3 Decision Tree

```
Has the route snapshot been exported?
│
├─ NO → Export snapshot (Phase 1)
│
└─ YES → Are all critical paths working on main domain?
         │
         ├─ NO → Debug main domain issues first
         │
         └─ YES → Is redirect rule configured?
                  │
                  ├─ NO → Add redirect rule (Phase 3)
                  │
                  └─ YES → Safe to remove old routes (Phase 4)
                           │
                           └─ After removal: Verify all paths (Phase 5)
                                             │
                                             ├─ PASS → Migration complete
                                             │
                                             └─ FAIL → Rollback (Section 4)
```

---

## 8. Related Documents

| Document | Path | Relationship |
|----------|------|--------------|
| TLS Strict Baseline | `docs/security/TLS_STRICT_BASELINE.md` | TLS requirements for all routes |
| HSTS Rollout | `docs/security/HSTS_ROLLOUT.md` | HSTS header configuration |
| Canonical Host Runbook | `docs/RUNBOOK-SEC-4.1-CANONICAL-HOST.md` | www → apex redirect (related) |
| Cloudflare Account Hardening | `docs/security/CF_ACCOUNT_HARDENING_RUNBOOK.md` | Account security |
| Security Baseline | `docs/security/SECURITY_BASELINE.md` | Parent security model |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-4.2 runbook |
