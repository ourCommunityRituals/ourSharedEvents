# Runbook: Collapse to Single Worker Route

> **Epic SEC-4 — Route Hygiene (kill the route sprawl)**
> Story SEC-4.2 — Collapse to Single Worker Route (eventangle.com/\*)
>
> Created: 2025-12-21
> Last Updated: 2025-12-21
> Status: Active

---

## Table of Contents

1. [Overview](#1-overview)
2. [Pre-Requisites](#2-pre-requisites)
3. [Export Current Routes (Rollback Backup)](#3-export-current-routes-rollback-backup)
4. [Route Consolidation Plan](#4-route-consolidation-plan)
5. [Implementation Steps](#5-implementation-steps)
6. [Verification](#6-verification)
7. [Rollback](#7-rollback)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Overview

### 1.1 Goal

Reduce all Worker routes to **one edge entrypoint** per domain, with the app owning internal routing:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TARGET STATE (SEC-4.2)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Production:                                                                │
│   └─ eventangle.com/*         (single canonical route)                       │
│   └─ api.eventangle.com/*     (API subdomain, optional separation)           │
│                                                                              │
│   Staging:                                                                   │
│   └─ stg.eventangle.com/*     (single staging route)                         │
│   └─ api-stg.eventangle.com/* (staging API subdomain)                        │
│                                                                              │
│   TOTAL: 4 routes (2 prod + 2 staging)                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Problem Statement

Worker routes can accumulate over time, creating "route sprawl":

| Problem                   | Example                           | Impact                              |
| ------------------------- | --------------------------------- | ----------------------------------- |
| **Path-specific routes**  | `/admin/*`, `/public/*`, `/api/*` | 60+ fragments instead of 1 wildcard |
| **Legacy test routes**    | `test.eventangle.com/*`           | Dead routes consuming quota         |
| **Duplicate www routes**  | `www.eventangle.com/*`            | Redundant after SEC-4.1 redirect    |
| **Environment confusion** | Mixed staging/prod patterns       | Deployment errors                   |

### 1.3 Benefits of Single Route

| Benefit                | Description                                     |
| ---------------------- | ----------------------------------------------- |
| **Simpler deployment** | One route per domain to manage                  |
| **Clear ownership**    | App router handles all paths internally         |
| **Easier debugging**   | No route precedence confusion                   |
| **Lower config drift** | Single source of truth in wrangler.toml         |
| **Reduced API quota**  | Fewer routes = fewer API calls to manage routes |

### 1.4 Architecture: App-Owned Routing

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Request Flow (After SEC-4.2)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                              ┌─────────────────────────┐                     │
│                              │     Cloudflare Edge     │                     │
│                              │  (Single Worker Route)  │                     │
│                              │   eventangle.com/*      │                     │
│                              └───────────┬─────────────┘                     │
│                                          │                                   │
│                                          ▼                                   │
│                              ┌─────────────────────────┐                     │
│                              │   Worker Router (TS)    │                     │
│                              │   /worker/src/router.ts │                     │
│                              └───────────┬─────────────┘                     │
│                                          │                                   │
│          ┌───────────────────────────────┼───────────────────────────────┐   │
│          │                               │                               │   │
│          ▼                               ▼                               ▼   │
│   ┌─────────────┐               ┌─────────────┐               ┌─────────────┐│
│   │  /api/*     │               │  /admin     │               │  /public    ││
│   │  API Routes │               │  /manage    │               │  /events    ││
│   │  (JSON)     │               │  /dashboard │               │  /schedule  ││
│   └─────────────┘               └─────────────┘               └─────────────┘│
│                                                                              │
│   App router handles all path-based routing internally                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.5 Scope

| Component                        | In Scope | Notes                        |
| -------------------------------- | -------- | ---------------------------- |
| Cloudflare Worker Routes cleanup | Yes      | Remove legacy fragments      |
| wrangler.toml route definitions  | Yes      | Already consolidated         |
| Internal app routing             | No       | Already handled by router.ts |
| DNS records                      | No       | Unchanged                    |
| Redirect Rules                   | No       | Configured in SEC-4.1        |

---

## 2. Pre-Requisites

### 2.1 Required Access

- [ ] Cloudflare account with Worker Routes access (Administrator or Workers Admin)
- [ ] Cloudflare API token with `Zone:Read`, `Workers Routes:Edit` permissions
- [ ] Git repository access for wrangler.toml updates
- [ ] Access to run `wrangler` CLI commands

### 2.2 Required Information

| Information       | Value                       | Status |
| ----------------- | --------------------------- | ------ |
| Domain            | `eventangle.com`            |        |
| Zone ID           | (from Cloudflare dashboard) |        |
| Account ID        | (from Cloudflare dashboard) |        |
| API Token         | (scoped for Worker Routes)  |        |
| Production Worker | `eventangle-router-prod`    |        |
| Staging Worker    | `eventangle-router-staging` |        |

### 2.3 Pre-Flight Checks

Before making any changes:

- [ ] SEC-4.1 (Canonical Host Redirect) is complete and verified
- [ ] All app routes are functioning on current configuration
- [ ] CI/CD pipeline is green
- [ ] Export current routes (Section 3) completed
- [ ] Rollback plan reviewed and understood

### 2.4 Risk Assessment

| Risk                            | Likelihood | Impact | Mitigation                        |
| ------------------------------- | ---------- | ------ | --------------------------------- |
| Route removal breaks traffic    | Low        | High   | Export first, incremental removal |
| App routing doesn't handle path | Low        | Medium | Test all routes before removal    |
| Wrong route deleted             | Medium     | High   | Use route IDs, not patterns       |
| Cloudflare propagation delay    | Low        | Low    | Wait 60s between changes          |

---

## 3. Export Current Routes (Rollback Backup)

### 3.1 Why Export First

Before removing any routes, create a complete backup:

1. **Rollback capability** - Can restore exact previous state
2. **Audit trail** - Document what existed
3. **Verification** - Compare before/after
4. **Compliance** - Change management record

### 3.2 Export via Cloudflare API

```bash
#!/bin/bash
# export-worker-routes.sh
# Run before SEC-4.2 route cleanup

# Configuration
ZONE_ID="${CLOUDFLARE_ZONE_ID:-your-zone-id}"
CF_API_TOKEN="${CLOUDFLARE_API_TOKEN_OSE:-your-api-token}"
EXPORT_DIR="./route-backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
EXPORT_FILE="${EXPORT_DIR}/routes_backup_${TIMESTAMP}.json"

# Create backup directory
mkdir -p "$EXPORT_DIR"

echo "=== Exporting Cloudflare Worker Routes ==="
echo "Zone ID: $ZONE_ID"
echo "Timestamp: $TIMESTAMP"
echo ""

# Export all routes
echo "Fetching routes from Cloudflare API..."
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | jq '.' > "$EXPORT_FILE"

# Count routes
ROUTE_COUNT=$(jq '.result | length' "$EXPORT_FILE")
echo "Exported $ROUTE_COUNT routes to: $EXPORT_FILE"
echo ""

# List routes for verification
echo "Routes exported:"
jq -r '.result[] | "  - \(.pattern) -> \(.script)"' "$EXPORT_FILE"
echo ""

# Validate export
if [ "$ROUTE_COUNT" -eq 0 ]; then
    echo "WARNING: No routes exported. Check API token and Zone ID."
    exit 1
fi

echo "=== Export Complete ==="
echo "Backup saved to: $EXPORT_FILE"
echo ""
echo "To restore routes, run: ./scripts/restore-worker-routes.sh $EXPORT_FILE"
```

### 3.3 Export via wrangler CLI

```bash
# Alternative: Use wrangler to list current routes
wrangler route list --env production
wrangler route list --env staging

# Save to file
wrangler route list --env production --json > route-backups/prod_routes_$(date +%Y%m%d).json
wrangler route list --env staging --json > route-backups/stg_routes_$(date +%Y%m%d).json
```

### 3.4 Expected Route Inventory

Before cleanup, typical route sprawl might include:

| Pattern                    | Worker                    | Status               |
| -------------------------- | ------------------------- | -------------------- |
| `eventangle.com/*`         | eventangle-router-prod    | KEEP                 |
| `www.eventangle.com/*`     | eventangle-router-prod    | REMOVE (SEC-4.1)     |
| `eventangle.com/admin/*`   | eventangle-router-prod    | REMOVE (redundant)   |
| `eventangle.com/public/*`  | eventangle-router-prod    | REMOVE (redundant)   |
| `eventangle.com/api/*`     | eventangle-router-prod    | REMOVE (redundant)   |
| `api.eventangle.com/*`     | eventangle-router-prod    | KEEP (API subdomain) |
| `stg.eventangle.com/*`     | eventangle-router-staging | KEEP                 |
| `api-stg.eventangle.com/*` | eventangle-router-staging | KEEP                 |
| `test.eventangle.com/*`    | (various)                 | REMOVE (legacy)      |

---

## 4. Route Consolidation Plan

### 4.1 Target Routes (Production)

After SEC-4.2, production should have exactly:

```toml
# worker/wrangler.toml [env.production]
routes = [
  { pattern = "eventangle.com/*", zone_name = "eventangle.com" },
  { pattern = "api.eventangle.com/*", zone_name = "eventangle.com" }
]
```

### 4.2 Target Routes (Staging)

```toml
# worker/wrangler.toml [env.staging]
routes = [
  { pattern = "stg.eventangle.com/*", zone_name = "eventangle.com" },
  { pattern = "api-stg.eventangle.com/*", zone_name = "eventangle.com" }
]
```

### 4.3 Routes to Remove

Any route matching these patterns should be removed:

| Pattern                          | Reason                        |
| -------------------------------- | ----------------------------- |
| `www.eventangle.com/*`           | Redirected at edge (SEC-4.1)  |
| `eventangle.com/admin/*`         | Covered by `eventangle.com/*` |
| `eventangle.com/public/*`        | Covered by `eventangle.com/*` |
| `eventangle.com/api/*`           | Covered by `eventangle.com/*` |
| `eventangle.com/display/*`       | Covered by `eventangle.com/*` |
| `eventangle.com/poster/*`        | Covered by `eventangle.com/*` |
| `eventangle.com/report/*`        | Covered by `eventangle.com/*` |
| `*.eventangle.com/specific-path` | Any path-specific routes      |
| `test.*`, `dev.*`, `preview.*`   | Legacy/test subdomains        |

### 4.4 Decision Matrix

```
Is the route a wildcard covering an entire (sub)domain?
├── Yes → Is it one of the 4 target routes?
│   ├── Yes → KEEP
│   └── No  → REMOVE (legacy subdomain)
└── No  → REMOVE (path-specific, redundant with wildcard)
```

---

## 5. Implementation Steps

### 5.1 Phase 1: Preparation (Day 0)

```bash
# Step 1: Export current routes
./scripts/export-worker-routes.sh

# Step 2: Verify wrangler.toml is correct
cat worker/wrangler.toml | grep -A5 "routes ="

# Step 3: Run verification script to confirm current state
./scripts/verify-sec-4.2.sh --current-state
```

### 5.2 Phase 2: Verify App Handles All Routes (Day 0)

Before removing routes, verify the app router handles all paths:

```bash
# Test all known routes against the canonical host
DOMAIN="eventangle.com"

# API routes
curl -s "https://$DOMAIN/api/status" | jq '.ok'
curl -s "https://$DOMAIN/api/v2/events" | head -c 100

# Page routes
for path in admin public display poster report sponsor manage dashboard events schedule calendar; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/$path")
    echo "$path: $STATUS"
done

# Brand routes
for brand in root abc cbc cbl; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/public?brand=$brand")
    echo "brand=$brand: $STATUS"
done
```

### 5.3 Phase 3: Identify Routes to Delete (Day 1)

```bash
#!/bin/bash
# identify-routes-to-delete.sh

ZONE_ID="${CLOUDFLARE_ZONE_ID}"
CF_API_TOKEN="${CLOUDFLARE_API_TOKEN_OSE}"

# Target routes to KEEP
KEEP_PATTERNS=(
    "eventangle.com/*"
    "api.eventangle.com/*"
    "stg.eventangle.com/*"
    "api-stg.eventangle.com/*"
)

echo "=== Routes to DELETE ==="
echo ""

# Fetch all routes
ROUTES=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json")

# Check each route
echo "$ROUTES" | jq -r '.result[] | "\(.id)|\(.pattern)|\(.script)"' | while IFS='|' read -r id pattern script; do
    KEEP=false
    for keep_pattern in "${KEEP_PATTERNS[@]}"; do
        if [ "$pattern" = "$keep_pattern" ]; then
            KEEP=true
            break
        fi
    done

    if [ "$KEEP" = true ]; then
        echo "[KEEP]   $pattern -> $script"
    else
        echo "[DELETE] $pattern -> $script (ID: $id)"
    fi
done
```

### 5.4 Phase 4: Delete Redundant Routes (Day 1)

```bash
#!/bin/bash
# delete-redundant-routes.sh
# CAUTION: Review output of identify-routes-to-delete.sh first!

ZONE_ID="${CLOUDFLARE_ZONE_ID}"
CF_API_TOKEN="${CLOUDFLARE_API_TOKEN_OSE}"

# Route IDs to delete (from identify script)
# IMPORTANT: Populate this array with actual route IDs
ROUTES_TO_DELETE=(
    # "route-id-1"
    # "route-id-2"
    # etc.
)

echo "=== Deleting Redundant Routes ==="
echo "Routes to delete: ${#ROUTES_TO_DELETE[@]}"
echo ""

for route_id in "${ROUTES_TO_DELETE[@]}"; do
    echo "Deleting route: $route_id"

    RESULT=$(curl -s -X DELETE \
        "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes/$route_id" \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json")

    SUCCESS=$(echo "$RESULT" | jq -r '.success')
    if [ "$SUCCESS" = "true" ]; then
        echo "  ✓ Deleted successfully"
    else
        echo "  ✗ Failed: $(echo "$RESULT" | jq -r '.errors[0].message')"
    fi

    # Wait for propagation
    sleep 2
done

echo ""
echo "=== Deletion Complete ==="
```

### 5.5 Phase 5: Deploy and Verify (Day 1)

```bash
# Deploy workers to ensure routes are synced
cd worker
wrangler deploy --env production
wrangler deploy --env staging

# Verify final state
./scripts/verify-sec-4.2.sh
```

---

## 6. Verification

### 6.1 Verification Script

```bash
#!/bin/bash
# verify-sec-4.2.sh
# SEC-4.2: Single Worker Route Verification

set -e

DOMAIN="${1:-eventangle.com}"
STAGING_DOMAIN="stg.eventangle.com"
ZONE_ID="${CLOUDFLARE_ZONE_ID:-}"
CF_API_TOKEN="${CLOUDFLARE_API_TOKEN_OSE:-}"

echo "========================================"
echo "SEC-4.2 Single Worker Route Verification"
echo "========================================"
echo ""

# ===========================================
# Test 1: Route Count Check
# ===========================================
echo "1. Checking route count..."

if [ -n "$ZONE_ID" ] && [ -n "$CF_API_TOKEN" ]; then
    ROUTE_COUNT=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
      -H "Authorization: Bearer $CF_API_TOKEN" \
      -H "Content-Type: application/json" | jq '.result | length')

    if [ "$ROUTE_COUNT" -le 4 ]; then
        echo "   ✅ PASS: Only $ROUTE_COUNT routes configured (expected ≤4)"
    else
        echo "   ❌ FAIL: $ROUTE_COUNT routes found (expected ≤4)"
        echo "   Run: ./scripts/identify-routes-to-delete.sh"
    fi
else
    echo "   ⚠️ SKIP: CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN_OSE not set"
fi
echo ""

# ===========================================
# Test 2: Production Routes Work
# ===========================================
echo "2. Testing production routes..."

# Homepage
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/")
if [ "$STATUS" = "200" ] || [ "$STATUS" = "302" ]; then
    echo "   ✅ PASS: $DOMAIN/ returns $STATUS"
else
    echo "   ❌ FAIL: $DOMAIN/ returns $STATUS (expected 200 or 302)"
fi

# API status
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/api/status")
if [ "$STATUS" = "200" ]; then
    echo "   ✅ PASS: $DOMAIN/api/status returns 200"
else
    echo "   ❌ FAIL: $DOMAIN/api/status returns $STATUS"
fi

# API subdomain
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://api.$DOMAIN/api/status")
if [ "$STATUS" = "200" ]; then
    echo "   ✅ PASS: api.$DOMAIN/api/status returns 200"
else
    echo "   ⚠️ WARN: api.$DOMAIN/api/status returns $STATUS"
fi
echo ""

# ===========================================
# Test 3: App-Handled Routes
# ===========================================
echo "3. Testing app-handled routes (should all work via wildcard)..."

ROUTES=("admin" "public" "display" "poster" "report" "sponsor" "manage" "dashboard" "events" "schedule")
ALL_PASS=true

for route in "${ROUTES[@]}"; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/$route")
    if [ "$STATUS" = "200" ]; then
        echo "   ✅ /$route: 200"
    else
        echo "   ❌ /$route: $STATUS"
        ALL_PASS=false
    fi
done

if [ "$ALL_PASS" = true ]; then
    echo "   All app routes working ✓"
fi
echo ""

# ===========================================
# Test 4: www Redirect Still Works (SEC-4.1)
# ===========================================
echo "4. Verifying www redirect (SEC-4.1)..."

WWW_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -I "https://www.$DOMAIN/")
if [ "$WWW_STATUS" = "301" ]; then
    echo "   ✅ PASS: www.$DOMAIN returns 301"
else
    echo "   ⚠️ WARN: www.$DOMAIN returns $WWW_STATUS (expected 301)"
fi
echo ""

# ===========================================
# Test 5: Staging Routes (Optional)
# ===========================================
echo "5. Testing staging routes..."

STAGING_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$STAGING_DOMAIN/api/status")
if [ "$STAGING_STATUS" = "200" ]; then
    echo "   ✅ PASS: $STAGING_DOMAIN/api/status returns 200"
else
    echo "   ⚠️ WARN: $STAGING_DOMAIN/api/status returns $STAGING_STATUS"
fi
echo ""

# ===========================================
# Summary
# ===========================================
echo "========================================"
echo "Verification Complete"
echo "========================================"
echo ""
echo "Acceptance Criteria:"
echo "  [ ] Only one Worker route per domain (plus API subdomain)"
echo "  [ ] All app routes function correctly"
echo "  [ ] www redirect still works (SEC-4.1)"
echo ""
```

### 6.2 Acceptance Criteria Checklist

| Criterion                                             | Verification Method | Status   |
| ----------------------------------------------------- | ------------------- | -------- |
| Only 4 Worker routes total                            | API route count ≤4  | [ ] Pass |
| `eventangle.com/*` works                              | curl returns 200    | [ ] Pass |
| `api.eventangle.com/*` works                          | curl returns 200    | [ ] Pass |
| `stg.eventangle.com/*` works                          | curl returns 200    | [ ] Pass |
| `api-stg.eventangle.com/*` works                      | curl returns 200    | [ ] Pass |
| All page routes work (`/admin`, `/public`, etc.)      | curl returns 200    | [ ] Pass |
| All API routes work (`/api/status`, `/api/v2/events`) | curl returns 200    | [ ] Pass |
| No path-specific routes exist                         | API route list      | [ ] Pass |
| www redirect still works                              | curl returns 301    | [ ] Pass |

### 6.3 wrangler.toml Verification

```bash
# Verify wrangler.toml has correct routes
echo "=== worker/wrangler.toml routes ==="
grep -A4 '\[env.production\]' worker/wrangler.toml | head -10
grep -A4 '\[env.staging\]' worker/wrangler.toml | head -10

echo ""
echo "=== cloudflare-proxy/wrangler.toml routes ==="
grep -A4 '\[env.production\]' cloudflare-proxy/wrangler.toml | head -10
grep -A4 '\[env.staging\]' cloudflare-proxy/wrangler.toml | head -10
```

---

## 7. Rollback

### 7.1 Restore Routes from Backup

```bash
#!/bin/bash
# restore-worker-routes.sh
# Usage: ./restore-worker-routes.sh route-backups/routes_backup_20251221_120000.json

BACKUP_FILE="$1"
ZONE_ID="${CLOUDFLARE_ZONE_ID}"
CF_API_TOKEN="${CLOUDFLARE_API_TOKEN_OSE}"

if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: $0 <backup-file.json>"
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "=== Restoring Worker Routes ==="
echo "From: $BACKUP_FILE"
echo ""

# Read routes from backup
ROUTES=$(jq -c '.result[]' "$BACKUP_FILE")

echo "$ROUTES" | while read -r route; do
    PATTERN=$(echo "$route" | jq -r '.pattern')
    SCRIPT=$(echo "$route" | jq -r '.script')

    echo "Restoring: $PATTERN -> $SCRIPT"

    RESULT=$(curl -s -X POST \
        "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        --data "{\"pattern\": \"$PATTERN\", \"script\": \"$SCRIPT\"}")

    SUCCESS=$(echo "$RESULT" | jq -r '.success')
    if [ "$SUCCESS" = "true" ]; then
        echo "  ✓ Restored"
    else
        # May already exist, which is fine
        ERROR=$(echo "$RESULT" | jq -r '.errors[0].message // "unknown"')
        echo "  ⚠️ $ERROR"
    fi
done

echo ""
echo "=== Restore Complete ==="
echo "Verify with: wrangler route list --env production"
```

### 7.2 Quick Rollback via wrangler

If you need to quickly add back a specific route:

```bash
# Add back www route (if SEC-4.1 redirect fails)
wrangler route create "www.eventangle.com/*" \
  --zone "eventangle.com" \
  --script "eventangle-router-prod"

# Add back path-specific route (emergency)
wrangler route create "eventangle.com/admin/*" \
  --zone "eventangle.com" \
  --script "eventangle-router-prod"
```

### 7.3 Rollback Decision Tree

```
Is a specific route returning errors?
├── Yes → What's the error code?
│   ├── 404 → App router not handling path
│   │   └── Fix router.ts, redeploy worker
│   ├── 522/523 → Worker not running
│   │   └── Check wrangler deploy status
│   └── 301 loop → Redirect misconfigured
│       └── Check SEC-4.1 redirect rule
└── No → Is overall traffic affected?
    ├── Yes → Restore all routes from backup
    └── No → Investigate specific issue
```

---

## 8. Troubleshooting

### 8.1 Common Issues

| Symptom                             | Likely Cause                 | Solution                                          |
| ----------------------------------- | ---------------------------- | ------------------------------------------------- |
| 404 on `/admin` after route removal | App router not deployed      | Deploy worker: `wrangler deploy --env production` |
| Route still exists after deletion   | Cloudflare propagation delay | Wait 60s, check again                             |
| Cannot delete route (403)           | API token lacks permission   | Check token has `Workers Routes:Edit`             |
| Wrong worker serving route          | Multiple routes overlap      | Delete more specific routes first                 |
| wrangler.toml changes not reflected | Need to redeploy             | Run `wrangler deploy --env <env>`                 |

### 8.2 Debug Route Configuration

```bash
# Check which worker handles a specific URL
curl -I https://eventangle.com/admin 2>&1 | grep -i "cf-ray\|server"

# List all routes via API
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[] | {pattern, script}'

# Check wrangler configuration
wrangler route list --env production
```

### 8.3 Verify App Router Coverage

```bash
# Check router.ts handles expected paths
grep -E "case '/" worker/src/router.ts

# Run local router tests
npm run test:unit -- --grep "router"
```

### 8.4 Route Precedence Rules

Cloudflare evaluates routes in this order:

1. **Most specific first** - `/admin/*` before `/*`
2. **Longer patterns** - More path segments win
3. **First match wins** - Order matters for equal specificity

After SEC-4.2, this is simplified: only wildcards exist, so no precedence conflicts.

---

## Appendix A: Route Migration History

### A.1 Before SEC-4 (Legacy State)

Typical pre-SEC-4 route configuration:

```
eventangle.com/*                    (main)
www.eventangle.com/*                (www variant)
eventangle.com/admin/*              (admin pages)
eventangle.com/public/*             (public pages)
eventangle.com/api/*                (API endpoints)
eventangle.com/display/*            (display pages)
api.eventangle.com/*                (API subdomain)
stg.eventangle.com/*                (staging)
stg.eventangle.com/admin/*          (staging admin)
test.eventangle.com/*               (test environment)
... (60+ total routes)
```

### A.2 After SEC-4.1

```
eventangle.com/*                    (canonical - KEEP)
api.eventangle.com/*                (API - KEEP)
stg.eventangle.com/*                (staging - KEEP)
api-stg.eventangle.com/*            (staging API - KEEP)
www.eventangle.com/*                (REMOVED - redirected at edge)
... (path-specific routes still exist)
```

### A.3 After SEC-4.2 (Target)

```
eventangle.com/*                    (canonical - KEEP)
api.eventangle.com/*                (API - KEEP)
stg.eventangle.com/*                (staging - KEEP)
api-stg.eventangle.com/*            (staging API - KEEP)
```

**Total: 4 routes** (down from 60+)

---

## Appendix B: Related Documentation

- [RUNBOOK-SEC-4.1-CANONICAL-HOST.md](./RUNBOOK-SEC-4.1-CANONICAL-HOST.md) - www redirect (SEC-4.1)
- [CLOUDFLARE_WORKER_MIGRATION.md](./CLOUDFLARE_WORKER_MIGRATION.md) - Worker architecture
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment procedures
- [Cloudflare Workers Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)

---

## Document History

| Date       | Author      | Changes                   |
| ---------- | ----------- | ------------------------- |
| 2025-12-21 | Claude Code | Initial runbook (SEC-4.2) |
