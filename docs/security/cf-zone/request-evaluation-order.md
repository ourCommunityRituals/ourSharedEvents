# Cloudflare Request Evaluation Order

> Extracted from [CF_ZONE_CONFIG_BASELINE.md](../CF_ZONE_CONFIG_BASELINE.md) (Part 2) under COST-402 / OSE-784, so an agent loads only this concern. The baseline remains the entry point; the full sequence is unchanged.

## Part 2: Request Evaluation Order

Understanding how Cloudflare evaluates requests is critical for writing correct rules.

---

### [R-ORDER] Request Execution Order Quick Reference

> **Why you care:** This is the "truth" of what happens per request. If you write policies assuming a different order, you'll get bypasses or unexpected blocks. Policy authors must be able to state this order from memory.

#### High-Level Phase Flow (Memorize This)

```
1. API Gateway Early     (API Shield early validation)
         ↓
2. Firewall Custom Rules (custom WAF rules - YOUR policy decisions)
         ↓
3. Rate Limiting         (abuse/cost throttling)
         ↓
4. API Gateway Late      (API Shield late - schema enforcement)
         ↓
5. Firewall Managed Rules (managed WAF - OWASP, CF rulesets)
         ↓
6. Bot Mitigation        (SBFM / Bot tools)
         ↓
7. Cache Settings        (cache rules - late, after security)
         ↓
8. Origin / Worker       (if request allowed to proceed)
```

#### Rule-of-Thumb Mapping

| If you need...                                       | Use this layer   | Why                                                |
| ---------------------------------------------------- | ---------------- | -------------------------------------------------- |
| **Allow/Block decisions you must control precisely** | Custom WAF Rules | Your rules run early; explicit control over action |
| **Cost and abuse throttling**                        | Rate Limiting    | Stops expensive requests before compute            |
| **Contract enforcement / API identity constraints**  | API Shield       | Schema validation, JWT, mTLS                       |
| **General exploit coverage**                         | Managed WAF      | CF-maintained patterns; broad coverage             |
| **Automation suppression**                           | Bot Controls     | Identifies and challenges automated traffic        |
| **Performance acceleration**                         | Cache Rules      | Runs late, after security decides request is safe  |

#### Acceptance Criteria (Definition of Done)

##### Ordering Correctness

| ✓   | Criterion                                                                |
| --- | ------------------------------------------------------------------------ |
| ☐   | Implementation changes are applied in Implementation Order (I-01 → I-10) |
| ☐   | Policy authors can state the Request Execution Order from memory         |
| ☐   | Each rule type is placed in the correct phase for its purpose            |

##### Determinism

| ✓   | Criterion                                                           |
| --- | ------------------------------------------------------------------- |
| ☐   | Custom WAF rules are explicitly ordered (priority numbers assigned) |
| ☐   | Custom WAF rules have been reviewed (no "random rule sprawl")       |
| ☐   | **Block** rules are never introduced without:                       |
|     | • Staging validation (NG-4 compliance)                              |
|     | • Logging/observability confirmation                                |
|     | • Rollback notes documented                                         |

##### Reliability Alignment (RAG/SRE Posture)

| ✓   | Criterion                                                        |
| --- | ---------------------------------------------------------------- |
| ☐   | Expensive endpoints have rate limiting in place                  |
| ☐   | Security events are observable and searchable (Ray ID traceable) |
| ☐   | Rollback procedure documented and tested                         |

#### Minimal Validation Checklist (Run Every Change)

Execute these checks after **every** security configuration change:

| #   | Check                    | Command / Action                  | Expected                                                |
| --- | ------------------------ | --------------------------------- | ------------------------------------------------------- |
| 1   | **TLS sanity**           | Dashboard → SSL/TLS               | Full (strict) confirmed                                 |
| 2   | **Routing sanity**       | `curl -sI https://www.domain.com` | Canonical host redirect + HTTPS                         |
| 3   | **Custom WAF sanity**    | Test admin/API protections        | Expected rules trigger (check Security Events)          |
| 4   | **Rate limiting sanity** | Controlled load test              | Rate limit events appear in logs                        |
| 5   | **False positive scan**  | Exercise top user flows           | No unexpected blocks/challenges                         |
| 6   | **Rollback ready**       | Verify export/undo steps          | Previous ruleset export exists OR undo steps documented |

```bash
# Quick sanity script (subset of full verification)
DOMAIN="yourdomain.com"

echo "=== Minimal Validation Checklist ==="

# 1. TLS sanity (CF-Ray proves proxy + HTTPS)
echo -n "1. TLS sanity: "
curl -sI https://$DOMAIN 2>/dev/null | grep -q "cf-ray" && echo "PASS" || echo "FAIL"

# 2. Routing sanity (canonical host redirect)
echo -n "2. Routing sanity: "
curl -sI https://www.$DOMAIN 2>/dev/null | grep -qi "location.*https://$DOMAIN" && echo "PASS" || echo "FAIL"

# 3. Custom WAF sanity (admin blocked without auth - adjust path as needed)
echo -n "3. WAF sanity (admin protection): "
STATUS=$(curl -sI https://$DOMAIN/admin 2>/dev/null | head -1 | grep -oE "[0-9]{3}")
[[ "$STATUS" == "403" || "$STATUS" == "401" ]] && echo "PASS ($STATUS)" || echo "CHECK ($STATUS)"

# 4. Rate limiting sanity (manual - requires controlled load test)
echo "4. Rate limiting sanity: [MANUAL - run controlled load test]"

# 5. False positive scan (manual - exercise user flows)
echo "5. False positive scan: [MANUAL - test top user flows]"

# 6. Rollback ready (manual verification)
echo "6. Rollback ready: [MANUAL - verify ruleset export exists]"
```

#### Phase → Implementation Section Mapping

| Request Phase     | Implementation Section     | Purpose                                |
| ----------------- | -------------------------- | -------------------------------------- |
| API Gateway Early | I-09 (API Hardening)       | Early schema/JWT validation            |
| Custom WAF Rules  | I-06 (Custom WAF)          | Application-specific blocking/allowing |
| Rate Limiting     | I-07 (Rate Limiting)       | Abuse and cost control                 |
| API Gateway Late  | I-09 (API Hardening)       | Contract enforcement                   |
| Managed WAF       | I-05 (WAF Managed Rules)   | Baseline exploit coverage              |
| Bot Mitigation    | I-08 (Bot Controls)        | Automation suppression                 |
| Cache Rules       | (not in security baseline) | Performance (after security)           |
| Origin/Worker     | I-14 (Worker Routes)       | Application layer                      |

---

### [R-00] Cloudflare Request Pipeline

Requests flow through Cloudflare's security stack in this order:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     INCOMING REQUEST                                 │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ [R-01] DDoS Protection (Always-on)                                   │
│        └─ L3/L4 mitigation, TCP/UDP flood protection                │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ [R-02] IP Access Rules (Firewall Rules - IP layer)                   │
│        └─ IP allowlist/blocklist, ASN blocks, country blocks        │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ [R-03] Bot Fight Mode / Super Bot Fight Mode                         │
│        └─ Known bad bots blocked, JS challenge for suspicious       │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ [R-04] Rate Limiting Rules                                           │
│        └─ Request rate thresholds, sliding window evaluation        │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ [R-05] WAF Managed Rulesets                                          │
│        ├─ Cloudflare Managed Ruleset                                │
│        ├─ OWASP Core Ruleset                                        │
│        └─ Cloudflare Leaked Credentials Check                       │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ [R-06] WAF Custom Rules                                              │
│        └─ Project-specific rules (ordered by priority)              │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ [R-07] Cloudflare Access (Zero Trust)                                │
│        ├─ Application matching (path/domain)                        │
│        ├─ Policy evaluation (Allow/Block/Bypass)                    │
│        └─ Identity verification (if required)                       │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ [R-08] Page Rules / Redirect Rules                                   │
│        └─ URL rewrites, redirects, cache settings                   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ [R-09] Transform Rules (Request Header Modification)                 │
│        └─ Add/modify/remove headers before Worker                   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ [R-10] Worker Routes (Application Layer)                             │
│        ├─ Route matching (most specific wins)                       │
│        └─ Worker execution                                          │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ [R-11] Transform Rules (Response Header Modification)                │
│        └─ Add/modify/remove headers in response                     │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     RESPONSE TO CLIENT                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

### [R-01] DDoS Protection

**When:** Always-on, first line of defense
**What:** Mitigates volumetric attacks (TCP floods, UDP floods, DNS amplification)
**Action:** Automatic; no configuration required for basic protection
**Note:** Advanced DDoS settings available for fine-tuning

---

### [R-02] IP Access Rules

**When:** After DDoS, before any application logic
**What:** IP-level allow/block based on:

- Individual IPs
- IP ranges (CIDR)
- Autonomous Systems (ASN)
- Countries

**Configuration:** Dashboard → Security → WAF → Tools → IP Access Rules

**Implication:** Blocked IPs never reach WAF rules, Access, or Workers

---

### [R-03] Bot Management

**When:** After IP filtering
**What:**

- Identifies request source (human, verified bot, unverified bot, automated)
- Bot Fight Mode challenges/blocks known bad bots
- Super Bot Fight Mode (Enterprise) detects sophisticated bots

**Configuration:** Dashboard → Security → Bots

---

### [R-04] Rate Limiting

**When:** Before WAF rule evaluation
**What:** Counts requests against defined thresholds

**Key Insight:** Rate limits apply **before** WAF rules. A request blocked by rate limiting never triggers WAF rule evaluation.

**Configuration:** Dashboard → Security → WAF → Rate limiting rules

---

### [R-05] WAF Managed Rulesets

**When:** After rate limiting passes
**What:** Pre-built rulesets maintained by Cloudflare:

- **Cloudflare Managed Ruleset** — Common attack patterns
- **OWASP Core Ruleset** — OWASP Top 10 protection
- **Cloudflare Leaked Credentials** — Checks against breached credential databases

**Configuration:** Dashboard → Security → WAF → Managed rules

---

### [R-06] WAF Custom Rules

**When:** After managed rulesets
**What:** Project-specific rules you define

**Evaluation Order:** Rules evaluated top-to-bottom by priority number (lower = first)

**Actions (in precedence order):**

1. `skip` — Skips remaining rules (dangerous; use sparingly)
2. `block` — Terminates request with 403
3. `challenge` — Presents JS challenge or CAPTCHA
4. `managed_challenge` — Adaptive challenge
5. `log` — Logs but allows (for testing)
6. `allow` — Explicitly allows (implicit if no match)

**Configuration:** Dashboard → Security → WAF → Custom rules

---

### [R-07] Cloudflare Access

**When:** After all WAF evaluation passes
**What:** Zero Trust identity verification

**Evaluation:**

1. Does request match an Access Application? (by path/hostname)
2. If yes, evaluate policies:
   - **Bypass** — Skip authentication (for monitoring endpoints)
   - **Allow** — Require identity matching policy criteria
   - **Block** — Deny regardless of identity

**Key Insight:** Access runs **after** WAF. A request blocked by WAF never reaches Access.

**Headers Added (if authenticated):**

- `Cf-Access-Authenticated-User-Email`
- `Cf-Access-Jwt-Assertion`

**Configuration:** Dashboard → Zero Trust → Access → Applications

---

### [R-08] Page Rules / Redirect Rules

**When:** After Access (if applicable)
**What:** URL-level transformations:

- Redirects (301/302)
- Cache settings
- SSL mode overrides (per-path)
- Forwarding rules

**Configuration:** Dashboard → Rules → Page Rules / Redirect Rules

---

### [R-09] Transform Rules (Request)

**When:** Immediately before Worker execution
**What:** Modify request headers sent to origin/Worker

**Use Cases:**

- Add `X-Request-ID` header
- Normalize `Host` header
- Add security context headers

**Configuration:** Dashboard → Rules → Transform Rules → Modify Request Header

---

### [R-10] Worker Execution

**When:** After all Cloudflare-level processing
**What:** Your application code runs

**Input Available:**

- Original request (possibly modified by Transform Rules)
- `CF-*` headers (e.g., `CF-Connecting-IP`, `CF-IPCountry`)
- Access headers (if authenticated)

**Key Insight:** By the time a request reaches your Worker, it has passed:

- DDoS protection
- IP access rules
- Bot management
- Rate limiting
- All WAF rules
- Access authentication (if applicable)

---

### [R-11] Transform Rules (Response)

**When:** After Worker response, before client receives
**What:** Modify response headers

**Use Cases:**

- Add security headers (`X-Frame-Options`, `X-Content-Type-Options`)
- Add CORS headers
- Remove internal debugging headers

**Configuration:** Dashboard → Rules → Transform Rules → Modify Response Header
