# HSTS_ROLLOUT.md — HTTP Strict Transport Security Rollout Plan

> **PROMPTSPEC-SEC-3.2** — HSTS Rollout Plan
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Deploy HSTS (HTTP Strict Transport Security) safely and incrementally to enforce HTTPS connections without risking user lockout. This plan provides a staged rollout with conservative initial settings, stability monitoring windows, and clear rollback procedures.

| Attribute | Value |
|-----------|-------|
| **Scope** | HSTS configuration for all production domains |
| **Prerequisites** | TLS Strict Baseline (SEC-3.1) fully implemented and verified |
| **Constraints** | Preload is a one-way door; do not preload without explicit approval |

---

## 2. HSTS Overview

### 2.1 What HSTS Does

| Without HSTS | With HSTS |
|--------------|-----------|
| Browser may attempt HTTP first | Browser automatically uses HTTPS |
| SSL stripping attacks possible | SSL stripping blocked |
| User can bypass certificate warnings | Certificate errors are fatal (no bypass) |
| Redirect from HTTP → HTTPS visible to attacker | No HTTP request occurs at all |

### 2.2 HSTS Header Format

```
Strict-Transport-Security: max-age=<seconds>; includeSubDomains; preload
```

| Directive | Purpose | Risk Level |
|-----------|---------|------------|
| `max-age` | Duration browsers remember to use HTTPS | Proportional to value |
| `includeSubDomains` | Apply HSTS to all subdomains | Medium — affects all subdomains |
| `preload` | Request inclusion in browser preload lists | **CRITICAL — ONE-WAY DOOR** |

### 2.3 Why Staged Rollout is Critical

```
DANGER: HSTS Misconfiguration

┌─────────────────────────────────────────────────────────────────────┐
│  If HTTPS becomes unavailable after HSTS is set:                    │
│                                                                     │
│  • Browsers WILL NOT connect via HTTP                               │
│  • Browsers WILL NOT allow certificate bypasses                     │
│  • Users are LOCKED OUT until:                                      │
│    - max-age expires, OR                                            │
│    - User manually clears HSTS state (technical users only), OR     │
│    - HTTPS is restored                                              │
│                                                                     │
│  With max-age=31536000 (1 year): Users locked out for UP TO 1 YEAR  │
│  With max-age=300 (5 min): Users recover within 5 MINUTES           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Pre-Rollout Checklist

Complete these prerequisites before enabling HSTS:

```
DOMAIN: _______________________  DATE: ___________

TLS BASELINE (REQUIRED)
[ ] TLS Strict Baseline (SEC-3.1) fully implemented
[ ] SSL/TLS mode is Full (strict) in Cloudflare
[ ] "Always Use HTTPS" is enabled
[ ] Minimum TLS version is 1.2 or higher
[ ] All curl verification tests pass (TLS baseline Section 7)

CERTIFICATE HEALTH
[ ] Edge certificate is valid and not expiring within 30 days
[ ] Origin certificate (if applicable) is valid and not expiring within 30 days
[ ] Certificate monitoring/alerting is in place
[ ] Renewal process is automated or documented

SUBDOMAIN AUDIT (if using includeSubDomains)
[ ] All subdomains inventoried: _______________________
[ ] All subdomains serve valid HTTPS
[ ] No subdomains require HTTP access
[ ] No subdomains have certificate issues

MIXED CONTENT CHECK
[ ] No mixed content warnings in browser console
[ ] All resources load over HTTPS
[ ] Automatic HTTPS Rewrites enabled in Cloudflare

ROLLBACK READINESS
[ ] Understand how to set max-age=0 (Section 7)
[ ] Access to Cloudflare dashboard confirmed
[ ] On-call/responsible party identified

Pre-flight verified by: _____________  Date: _____________
```

---

## 4. Stage 1 — Conservative max-age

**Objective:** Enable HSTS with minimal risk; allow rapid recovery if issues discovered.

### 4.1 Stage 1 Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| `max-age` | 300 (5 minutes) | Rapid recovery if problems found |
| `includeSubDomains` | **NO** | Test on apex first |
| `preload` | **NO** | Never in Stage 1 |

**Header Value:**
```
Strict-Transport-Security: max-age=300
```

### 4.2 Implementation via Cloudflare

**Option A: Transform Rules (Recommended)**

| Step | Action |
|------|--------|
| 1 | Navigate to Rules → Transform Rules → Modify Response Header |
| 2 | Create new rule |
| 3 | Rule name: "HSTS Stage 1 - Conservative" |
| 4 | When: All incoming requests (or specific hostname) |
| 5 | Then: Set static header |
| 6 | Header name: `Strict-Transport-Security` |
| 7 | Header value: `max-age=300` |
| 8 | Deploy |

**Option B: Workers (If Already Using Workers)**

```javascript
// Add to existing worker response handling
response.headers.set('Strict-Transport-Security', 'max-age=300');
```

### 4.3 Stage 1 Verification

```bash
# Verify HSTS header is present
curl -sI https://www.example.com | grep -i strict-transport-security

# Expected output:
# strict-transport-security: max-age=300

# Verify max-age value
curl -sI https://www.example.com | grep -i strict-transport-security | grep "max-age=300"

# Full header inspection
curl -sI https://www.example.com | grep -iE "(strict-transport|location|http/)"
```

### 4.4 Stage 1 Monitoring Period

| Duration | Minimum | Recommended |
|----------|---------|-------------|
| Monitoring period | 48 hours | 7 days |

**Monitoring Checklist:**

```
STAGE 1 MONITORING - Day ___

[ ] Website accessible via HTTPS
[ ] No user reports of access issues
[ ] Certificate status healthy
[ ] No mixed content errors in console
[ ] Error rate normal (no 5xx spike)
[ ] HSTS header still present (verify daily)

Checked by: _____________  Time: _____________
```

### 4.5 Stage 1 Success Criteria

Proceed to Stage 2 only if ALL conditions met for entire monitoring period:

| Criterion | Required |
|-----------|----------|
| Zero access issues reported | ✓ |
| Certificate remained valid | ✓ |
| No HTTPS errors observed | ✓ |
| HSTS header consistently present | ✓ |
| Monitoring period complete (48h minimum) | ✓ |

---

## 5. Stage 2 — Production max-age

**Objective:** Increase max-age to production value after stability confirmed.

### 5.1 Stage 2 Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| `max-age` | 31536000 (1 year) | Standard production value |
| `includeSubDomains` | Optional — see 5.2 | Only if all subdomains verified |
| `preload` | **NO** | See Section 6 |

**Header Value (without includeSubDomains):**
```
Strict-Transport-Security: max-age=31536000
```

**Header Value (with includeSubDomains):**
```
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### 5.2 includeSubDomains Decision

> **WARNING:** `includeSubDomains` applies HSTS to ALL subdomains, including those you haven't created yet.

**Enable includeSubDomains only if:**

| Requirement | Verified |
|-------------|----------|
| All current subdomains audited | [ ] |
| All current subdomains serve HTTPS with valid certificates | [ ] |
| No plans for HTTP-only subdomains | [ ] |
| Wildcard certificate or automation covers new subdomains | [ ] |

**Do NOT enable includeSubDomains if:**
- Any subdomain serves HTTP only
- Any subdomain has certificate issues
- Third-party services use subdomains you don't control
- Internal/dev subdomains may not have valid certificates

### 5.3 Stage 2 Implementation

Update the Transform Rule or Worker from Stage 1:

| Step | Action |
|------|--------|
| 1 | Navigate to existing HSTS rule |
| 2 | Update header value to production setting |
| 3 | Rename rule: "HSTS Stage 2 - Production" |
| 4 | Deploy |

### 5.4 Stage 2 Verification

```bash
# Verify production max-age
curl -sI https://www.example.com | grep -i strict-transport-security

# Expected output:
# strict-transport-security: max-age=31536000

# Or with includeSubDomains:
# strict-transport-security: max-age=31536000; includeSubDomains
```

### 5.5 Stage 2 Monitoring

| Duration | Minimum | Recommended |
|----------|---------|-------------|
| Intensive monitoring | 7 days | 14 days |
| Ongoing monitoring | Continuous | Continuous |

After Stage 2, HSTS is in production. Continue monitoring certificate health and HTTPS availability indefinitely.

---

## 6. Preload — One-Way Door

> **CRITICAL WARNING: PRELOAD IS EFFECTIVELY IRREVERSIBLE**

### 6.1 What is HSTS Preload?

HSTS Preload is a list maintained by browser vendors (Chrome, Firefox, Safari, Edge) of domains that should ALWAYS use HTTPS, even on first visit.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PRELOAD: ONE-WAY DOOR                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ADDING to preload list:                                            │
│  • Submit at hstspreload.org                                        │
│  • Inclusion within weeks                                           │
│  • Ships with browser updates                                       │
│                                                                     │
│  REMOVING from preload list:                                        │
│  • Submit removal request                                           │
│  • Removal takes 6-12+ MONTHS                                       │
│  • Users on old browsers: NEVER removed                             │
│  • Some browsers may not honor removal                              │
│                                                                     │
│  IF YOU NEED HTTP ACCESS AFTER PRELOAD:                             │
│  • You cannot have it for months/years                              │
│  • Legacy users may be locked out permanently                       │
│  • There is NO technical workaround                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 Preload Requirements

To be eligible for preload submission:

| Requirement | Details |
|-------------|---------|
| Valid certificate | Must not be self-signed |
| Redirect HTTP → HTTPS | On same host, before HSTS header |
| HSTS header on HTTPS | Must be served on HTTPS responses |
| `max-age` ≥ 31536000 | At least 1 year |
| `includeSubDomains` | **Required** for preload |
| `preload` directive | Must be present in header |
| All subdomains HTTPS | Including www (if used) |

### 6.3 Do NOT Preload Unless

All of the following conditions are met AND have been stable for 6+ months:

| Condition | Status | Verified Date |
|-----------|--------|---------------|
| HSTS at max-age=31536000 for 6+ months | [ ] | |
| Zero HTTPS issues in production | [ ] | |
| No plans to ever need HTTP | [ ] | |
| All subdomains certified HTTPS-only | [ ] | |
| Certificate automation fully reliable | [ ] | |
| Explicit written approval from security lead | [ ] | |
| Business accepts permanent HTTPS commitment | [ ] | |

### 6.4 Preload Header (Only When Ready)

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

### 6.5 Preload Submission (Only After All Approvals)

| Step | Action |
|------|--------|
| 1 | Verify all 6.3 conditions are met |
| 2 | Obtain written approval from Director of Security |
| 3 | Add `preload` directive to HSTS header |
| 4 | Verify at https://hstspreload.org (check, don't submit yet) |
| 5 | Document decision and approvals |
| 6 | Submit at https://hstspreload.org |
| 7 | Monitor for inclusion (weeks to months) |

### 6.6 Current Recommendation

| Status | Recommendation |
|--------|----------------|
| **Current** | **DO NOT PRELOAD** |
| Rationale | Insufficient production history; one-way door risk not justified |
| Revisit | After 6 months of stable Stage 2 operation |

---

## 7. Rollback and Failure Handling

### 7.1 Rollback Methods by Stage

| Stage | Issue Discovered | Rollback Method | Recovery Time |
|-------|------------------|-----------------|---------------|
| Stage 1 (max-age=300) | Any | Remove HSTS header | 5 minutes |
| Stage 2 (max-age=31536000) | Any | Set max-age=0 | Up to 1 year (cached) |
| Preloaded | Any | Submit removal + max-age=0 | 6-12+ months |

### 7.2 Non-Preloaded Rollback Procedure

**Step 1: Set max-age=0**

This instructs browsers to immediately forget the HSTS policy.

```
Strict-Transport-Security: max-age=0
```

| Step | Action |
|------|--------|
| 1 | Update Transform Rule or Worker |
| 2 | Set header to `max-age=0` |
| 3 | Deploy immediately |
| 4 | Verify header: `curl -sI https://example.com \| grep -i strict` |

**Step 2: Understand Limitations**

```
┌─────────────────────────────────────────────────────────────────────┐
│  max-age=0 LIMITATIONS                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ✓ HELPS: Users who visit HTTPS and receive max-age=0              │
│           → Their browser forgets HSTS immediately                  │
│                                                                     │
│  ✗ DOES NOT HELP:                                                   │
│    • Users who cannot reach HTTPS (the problem you're fixing)       │
│    • Users who don't visit during rollback window                   │
│    • Preloaded domains (preload is separate from header)            │
│                                                                     │
│  RECOVERY TIMELINE:                                                 │
│    • Users who visit: Immediate                                     │
│    • Users who don't visit: Up to original max-age                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Step 3: If HTTPS Completely Broken**

If users cannot reach HTTPS at all:

| Scenario | Action |
|----------|--------|
| Certificate expired | Renew certificate immediately; HTTPS will resume |
| Origin down | Restore origin; Cloudflare may serve cached if available |
| Cloudflare misconfiguration | Fix configuration; HTTPS will resume |
| Complete outage | Wait for restoration; users will remain locked out until then |

> **There is no way to send max-age=0 to users who cannot reach your HTTPS endpoint.** Prevention (staged rollout) is the only protection.

### 7.3 Preloaded Rollback Procedure

If domain is preloaded and needs HTTP access:

| Step | Action | Timeline |
|------|--------|----------|
| 1 | Remove `preload` directive from header | Immediate |
| 2 | Set `max-age=0` | Immediate |
| 3 | Submit removal at https://hstspreload.org/removal/ | Immediate |
| 4 | Wait for removal from Chrome source | 1-3 months |
| 5 | Wait for browser releases to propagate | 3-6 months |
| 6 | Legacy browser users remain affected | Indefinitely |

> **There is no faster option.** This is why preload is a one-way door.

### 7.4 Rollback Decision Tree

```
HSTS Issue Detected
        │
        ▼
Is HTTPS accessible?
        │
        ├─ YES → Set max-age=0 immediately
        │        └─ Visitors will recover as they visit
        │
        └─ NO → What's broken?
                │
                ├─ Certificate issue
                │   └─ Renew/fix certificate (priority 1)
                │       └─ Once HTTPS works, set max-age=0
                │
                ├─ Server/origin down
                │   └─ Restore service (priority 1)
                │       └─ Once HTTPS works, set max-age=0
                │
                └─ Complete disaster
                    └─ No immediate fix available
                        └─ Users locked out until HTTPS restored
                            └─ Duration: up to original max-age
```

---

## 8. Verification Tests

### 8.1 HSTS Header Test

```bash
#!/bin/bash
# Test HSTS header presence and configuration

DOMAIN="${1:-www.example.com}"

echo "=== HSTS Verification for $DOMAIN ==="
echo ""

# Get HSTS header
HSTS=$(curl -sI "https://$DOMAIN" 2>&1 | grep -i "strict-transport-security")

if [ -z "$HSTS" ]; then
    echo "✗ FAIL: No HSTS header found"
    exit 1
fi

echo "Header: $HSTS"
echo ""

# Parse max-age
MAX_AGE=$(echo "$HSTS" | grep -oP 'max-age=\K[0-9]+')
echo "max-age: $MAX_AGE seconds ($(echo "$MAX_AGE / 86400" | bc) days)"

# Check for includeSubDomains
if echo "$HSTS" | grep -qi "includeSubDomains"; then
    echo "includeSubDomains: YES"
else
    echo "includeSubDomains: NO"
fi

# Check for preload
if echo "$HSTS" | grep -qi "preload"; then
    echo "preload: YES ⚠️  (one-way door active)"
else
    echo "preload: NO (safe)"
fi

echo ""
echo "✓ HSTS header present"
```

### 8.2 Full HSTS Compliance Test

```bash
# Test HTTP redirect (required for preload eligibility)
curl -sI http://www.example.com | grep -E "^(HTTP|Location)"
# Expected: 301/302 redirect to HTTPS

# Test HSTS on HTTPS
curl -sI https://www.example.com | grep -i strict-transport-security
# Expected: Strict-Transport-Security header present

# Test HSTS on bare domain (if using includeSubDomains)
curl -sI https://example.com | grep -i strict-transport-security
# Expected: Same HSTS header

# Check preload eligibility (without submitting)
# Visit: https://hstspreload.org/?domain=example.com
```

---

## 9. Implementation Timeline

### 9.1 Recommended Rollout Schedule

| Week | Stage | Configuration | Action |
|------|-------|---------------|--------|
| 1 | Pre-flight | N/A | Complete Section 3 checklist |
| 1 | Stage 1 | max-age=300 | Deploy conservative HSTS |
| 1-2 | Monitoring | max-age=300 | Monitor for 7 days minimum |
| 3 | Stage 2 | max-age=31536000 | Increase to production |
| 3-4 | Monitoring | max-age=31536000 | Intensive monitoring |
| 5+ | Production | max-age=31536000 | Ongoing monitoring |
| 6mo+ | Evaluate | — | Consider includeSubDomains if needed |
| 12mo+ | Evaluate | — | Consider preload only if business requires |

### 9.2 Stage Transition Approval

| Transition | Required Approval |
|------------|-------------------|
| Pre-flight → Stage 1 | Security team lead |
| Stage 1 → Stage 2 | Security team lead + monitoring confirmation |
| Stage 2 → includeSubDomains | Director of Security + subdomain audit |
| Any → Preload | **Director of Security + written business justification** |

---

## 10. Quick Reference

### 10.1 HSTS Header Values by Stage

| Stage | Header Value |
|-------|--------------|
| Stage 1 (Test) | `Strict-Transport-Security: max-age=300` |
| Stage 2 (Production) | `Strict-Transport-Security: max-age=31536000` |
| With Subdomains | `Strict-Transport-Security: max-age=31536000; includeSubDomains` |
| Preload (Not Recommended) | `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` |
| Rollback | `Strict-Transport-Security: max-age=0` |

### 10.2 Key max-age Values

| Seconds | Human Readable | Use Case |
|---------|----------------|----------|
| 300 | 5 minutes | Stage 1 testing |
| 86400 | 1 day | Extended testing |
| 604800 | 1 week | Cautious production |
| 31536000 | 1 year | Standard production |
| 63072000 | 2 years | Maximum recommended |
| 0 | Immediate | Rollback |

### 10.3 Emergency Contacts

| Role | Responsibility |
|------|----------------|
| Security Lead | Approve stage transitions |
| On-call Engineer | Execute rollback if needed |
| Cloudflare Support | Escalation for platform issues |

---

## 11. Related Documents

| Document | Path | Relationship |
|----------|------|--------------|
| TLS Strict Baseline | `docs/security/TLS_STRICT_BASELINE.md` | Prerequisite (SEC-3.1) |
| Security Baseline | `docs/security/SECURITY_BASELINE.md` | Parent security model |
| Cloudflare Account Hardening | `docs/security/CF_ACCOUNT_HARDENING_RUNBOOK.md` | Account security |
| DNSSEC Runbook | `docs/security/DNSSEC_RUNBOOK.md` | Complementary DNS security |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-3.2 HSTS rollout plan |
