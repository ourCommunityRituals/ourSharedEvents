# Cloudflare Zone Configuration Baseline

> **PROMPTSPEC-SEC-10.3: CF-ORDER-BASELINE.v1**
> Role: Security/SRE Lead
> Created: 2026-01-05
> Status: DOCUMENTED
> Audience: Devs + SRE + QA/SDET
> Run Mode: DOC-ONLY (planning + configuration sequencing)

## Purpose

This document establishes:

1. **Implementation Order** — The dependency-safe sequence for configuring Cloudflare zone settings
2. **Request Evaluation Order** — How Cloudflare evaluates incoming requests through its security stack
3. **Exit Gates** — Verification criteria before proceeding to the next configuration phase

Ensures security/reliability policies behave **deterministically** and prevents configuration drift.

---

## Non-Negotiables (Hard Gates)

| ID       | Gate                                                                         | Rationale                                                                                  |
| -------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **NG-1** | TLS must be **Full (strict)** before claiming any "serious" security posture | Without strict TLS, MITM attacks between CF edge and origin remain possible. **See I-02.** |
| **NG-2** | Never display a QR unless verified (`verified: true`)                        | North-star invariant QR-0; prevents fraudulent ticket presentation                         |
| **NG-3** | Rules that **Block** must be explicitly ordered and reviewed                 | No "random rule sprawl" — blocking rules require PR review. **See I-06.**                  |
| **NG-4** | Staging-first for all security policy changes                                | No direct-to-prod security rewrites; validate in staging first                             |
| **NG-5** | Origin must never be directly accessible                                     | Worker-only architecture; no public origin IP exposure. **See I-14.**                      |

### Staging-First Policy (NG-4)

All security configuration changes MUST follow this workflow:

```
1. Document change in PR (what + why)
2. Apply to staging environment first
3. Verify exit gates pass in staging
4. Observation period (minimum: 24h for non-breaking, 7d for blocking rules)
5. Apply to production with explicit approval
6. Verify exit gates pass in production
```

**Prohibited:** Direct-to-production security policy changes without staging validation.

---

## Part 1: Implementation Order

Configure Cloudflare in this exact sequence. Each phase has an **Exit Gate** that must pass before proceeding.

### [I-01] Zone & DNS Baseline (Foundation)

**Intent:** Ensure traffic is actually behind Cloudflare and your control plane isn't weak.

#### Checklist

| Item              | Action                                                  | Reference               |
| ----------------- | ------------------------------------------------------- | ----------------------- |
| Zone created      | Zone exists in Cloudflare dashboard with correct domain | —                       |
| NS records        | Nameservers point to Cloudflare-assigned NS             | `dig NS yourdomain.com` |
| DNS records       | All intended hosts exist with correct IPs/CNAMEs        | Dashboard → DNS         |
| Proxy status      | Production hosts are **proxied** (orange cloud)         | Required for WAF/Access |
| Non-proxied audit | Document any DNS-only (gray cloud) records and justify  | Exception register      |

#### Account & Change Control

| Item              | Action                                             | Reference                                          |
| ----------------- | -------------------------------------------------- | -------------------------------------------------- |
| MFA enforced      | All account members have MFA enabled               | [SEC-1](../RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md)    |
| Least privilege   | Members assigned minimum required roles            | Dashboard → Members                                |
| Audit log enabled | Activity log retained and monitored                | Enterprise feature                                 |
| API tokens scoped | No global API keys; use scoped tokens per use-case | [SEC-1.2](../RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md) |

**Exit Gate I-01:**

```
Can you answer "Which hostnames are behind Cloudflare?" with zero ambiguity.
Verify: `dig +short yourdomain.com` returns Cloudflare IPs (104.x.x.x or 172.x.x.x range)
```

---

### [I-02] TLS & Transport Security (Foundation)

> **Everything assumes this.** No security claims are valid until TLS is properly configured.

**Intent:** Prevent downgrade/MITM attacks and eliminate "Flexible SSL" footguns. This is the foundational layer that all other security controls depend on.

#### Why I-02? (Before DNSSEC)

TLS Full (strict) is more immediately critical than DNSSEC because:

1. **Active MITM prevention** — Without strict TLS, edge-to-origin traffic is vulnerable NOW
2. **Practical attack surface** — Flexible mode is a common footgun that attackers actively exploit
3. **Prerequisite for HSTS** — Cannot safely enable HSTS until HTTPS works everywhere
4. **Blocking gate** — All other security configurations assume encrypted transport

#### Origin TLS Requirements

| Item                     | Action                                                 | Reference                                          |
| ------------------------ | ------------------------------------------------------ | -------------------------------------------------- |
| SSL Mode                 | Set to **Full (strict)** — non-negotiable              | [TLS_STRICT_BASELINE.md](./TLS_STRICT_BASELINE.md) |
| Origin certificate       | Cloudflare Origin CA cert OR valid public CA on origin | Required for strict mode                           |
| Certificate validity     | Not expiring within 30 days                            | Monitor via dashboard                              |
| Minimum TLS              | TLS 1.2 minimum (1.3 preferred)                        | Dashboard → SSL/TLS → Edge Certificates            |
| TLS 1.3                  | Enabled for modern clients                             | Dashboard → SSL/TLS                                |
| Always Use HTTPS         | Enabled — no HTTP endpoints permitted                  | Dashboard → SSL/TLS → Edge Certificates            |
| Automatic HTTPS Rewrites | Enabled — fix mixed content                            | Dashboard → SSL/TLS → Edge Certificates            |

#### Prohibited Configurations (from TLS_STRICT_BASELINE.md)

| ❌ BANNED               | Reason                                          | Risk Level |
| ----------------------- | ----------------------------------------------- | ---------- |
| **Off** (no encryption) | All traffic exposed in plaintext                | CRITICAL   |
| **Flexible** SSL mode   | Allows MITM between Cloudflare and origin       | CRITICAL   |
| **Full** (not strict)   | No origin certificate validation                | HIGH       |
| TLS 1.0 or 1.1          | Deprecated protocols with known vulnerabilities | HIGH       |
| HTTP without redirect   | Allows unencrypted connections                  | HIGH       |

> **CRITICAL:** Flexible SSL mode is **BANNED**. Any zone discovered in Flexible mode must be immediately migrated to Full (strict). There is no acceptable use case for Flexible mode.

#### HSTS (After TLS Verified)

HSTS instructs browsers to always use HTTPS. **Only configure after confirming no HTTP dependencies remain.**

| Phase | max-age           | includeSubDomains | preload | Observation                       |
| ----- | ----------------- | ----------------- | ------- | --------------------------------- |
| 1     | 300 (5 min)       | No                | No      | 1 week — rapid recovery if issues |
| 2     | 86400 (1 day)     | No                | No      | 1 week                            |
| 3     | 2592000 (30 days) | Yes               | No      | 2 weeks — affects all subdomains  |
| 4     | 31536000 (1 year) | Yes               | Yes     | Permanent — **one-way door**      |

Reference: [HSTS_ROLLOUT.md](./HSTS_ROLLOUT.md)

> ⚠️ **Preload is a one-way door.** Do not add `preload` directive without explicit Director-level approval and 6+ months of stable Stage 2 operation.

#### Verification Commands

```bash
# Confirm Full (strict) mode active (CF-Ray header proves Cloudflare proxy)
curl -sI https://yourdomain.com | grep -i "cf-ray"

# Confirm HTTPS redirect
curl -sI http://yourdomain.com | grep -E "^(HTTP|Location)"
# Expected: 301/302 → https://

# Confirm TLS 1.0/1.1 rejected
curl -sI --tlsv1.0 --tls-max 1.0 https://yourdomain.com 2>&1 | grep -i "error\|alert"
# Expected: Connection failure

# Confirm TLS 1.2+ works
curl -sI --tlsv1.2 https://yourdomain.com | head -1
# Expected: HTTP/2 200

# Check HSTS header (after HSTS enabled)
curl -sI https://yourdomain.com | grep -i "strict-transport-security"
```

**Exit Gate I-02:**

```
✓ No endpoint requires HTTP (all redirect to HTTPS)
✓ No TLS mode other than Full (strict) in use
✓ Dashboard → SSL/TLS shows "Full (strict)" with green checkmark
✓ TLS 1.0 and 1.1 connections rejected
✓ Origin certificate valid (if origin exists)
```

**HARD GATE (NG-1):** Do not proceed past I-02 until TLS is Full (strict). No "serious" security posture can be claimed without this foundation.

---

### [I-03] Request Normalization (Routing + Canonicalization)

> **Intent:** Make the request shape stable so policies aren't bypassed by alternate paths/hosts.

Request normalization ensures that all incoming requests are transformed to a canonical form **before** security policies evaluate them. Without normalization, attackers can bypass rules using:

- HTTP instead of HTTPS
- `www.` vs apex hostname
- Trailing slash variants (`/path` vs `/path/`)
- Mixed case paths (`/Admin` vs `/admin`)
- Legacy path aliases

#### Why I-03? (Before DNSSEC)

Request normalization is more operationally critical than DNSSEC because:

1. **Policy bypass prevention** — Rules written for `/admin` can be bypassed via `/Admin/` without normalization
2. **SEO and analytics integrity** — Duplicate URLs dilute metrics and page rank
3. **Cookie scope issues** — Cookies set on `www.` may not be visible on apex
4. **Cache fragmentation** — CDN caches `www.` and apex separately without redirect

#### Cloudflare Layers Involved

Request normalization happens at multiple points in the [Request Evaluation Pipeline](#r-00-cloudflare-request-pipeline):

| Layer           | Stage              | Purpose                                                 |
| --------------- | ------------------ | ------------------------------------------------------- |
| **R-02** (I-02) | "Always Use HTTPS" | HTTP → HTTPS upgrade                                    |
| **R-08**        | Redirect Rules     | Host canonicalization (www→apex), legacy path redirects |
| **R-09**        | Transform Rules    | Path normalization, header modification                 |

#### I-03.1: Scheme Normalization (HTTP→HTTPS)

**Status:** Handled by I-02 — "Always Use HTTPS" setting.

All HTTP requests are redirected to HTTPS before any other processing. This is foundational and **must be active** before proceeding.

| Verification            | Command                                              |
| ----------------------- | ---------------------------------------------------- |
| HTTP redirects to HTTPS | `curl -sI http://yourdomain.com \| grep -i location` |
| Expected                | `location: https://yourdomain.com/`                  |

#### I-03.2: Host Canonicalization (www↔apex)

**Decision Required:** Choose ONE canonical hostname. All others redirect to it.

| Option                  | Example                   | Recommendation                  |
| ----------------------- | ------------------------- | ------------------------------- |
| **Apex (naked domain)** | `oursharedevents.com`     | ✅ Modern, shorter, recommended |
| **WWW subdomain**       | `www.oursharedevents.com` | Legacy convention               |

**Implementation:**

| Item                    | Action                                               | Reference                                          |
| ----------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| Canonical host decision | Document in ADR or this baseline                     | [CANONICAL_HOST_SPEC.md](./CANONICAL_HOST_SPEC.md) |
| Redirect Rule           | Create rule: `www.domain.com` → 301 → `domain.com`   | Dashboard → Rules → Redirect Rules                 |
| Preserve path           | Use `concat("https://domain.com", http.request.uri)` | Dynamic redirect expression                        |
| Preserve query          | Expression above handles this automatically          | Implicit                                           |
| Worker route cleanup    | Remove worker route for non-canonical host           | wrangler.toml                                      |

**Redirect Rule Configuration:**

```
When: http.host eq "www.yourdomain.com"
Then: 301 → concat("https://yourdomain.com", http.request.uri)
```

Reference: [RUNBOOK-SEC-4.1-CANONICAL-HOST.md](../RUNBOOK-SEC-4.1-CANONICAL-HOST.md)

#### I-03.3: Path Normalization (Trailing Slashes + Case)

**Policy Decision Required:** Choose trailing slash convention.

| Convention              | Example    | Pros                    | Cons                                    |
| ----------------------- | ---------- | ----------------------- | --------------------------------------- |
| **No trailing slash**   | `/events`  | Cleaner URLs, most APIs | May need config for static file servers |
| **With trailing slash** | `/events/` | Directory convention    | Extra character                         |
| **No enforcement**      | Both work  | No redirects            | Duplicate content, cache fragmentation  |

**Recommended:** Enforce ONE convention via Transform Rules.

| Item                          | Action                                           | Reference                           |
| ----------------------------- | ------------------------------------------------ | ----------------------------------- |
| Trailing slash policy         | Document decision                                | This section                        |
| Transform Rule (if enforcing) | Strip or add trailing slash                      | Dashboard → Rules → Transform Rules |
| Case sensitivity              | Usually preserve (most paths are case-sensitive) | Default behavior                    |

**Example Transform Rule (strip trailing slash):**

```
When: ends_with(http.request.uri.path, "/") and http.request.uri.path ne "/"
Rewrite path: regex_replace(http.request.uri.path, "/$", "")
```

> **Note:** If not actively enforcing trailing slash normalization, document this as intentional to avoid future confusion.

#### I-03.4: Legacy Path Redirects

Map deprecated paths to current equivalents. This prevents 404s for old bookmarks and maintains SEO value.

| Legacy Path    | Current Path | Status Code |
| -------------- | ------------ | ----------- |
| `/old-admin`   | `/admin`     | 301         |
| `/api/v1/*`    | `/api/v2/*`  | 301 or 308  |
| `/legacy-page` | `/new-page`  | 301         |

**Implementation:**

- **Few redirects:** Create individual Redirect Rules in Dashboard
- **Many redirects:** Use Bulk Redirects feature
- **Complex logic:** Handle in Worker (last resort — prefer edge rules)

| Item                  | Action                                        | Reference      |
| --------------------- | --------------------------------------------- | -------------- |
| Identify legacy paths | Audit analytics/logs for 404s on old URLs     | —              |
| Create redirect rules | Dashboard → Rules → Redirect Rules            | Per-path rules |
| Document redirects    | Maintain list in this document or linked spec | —              |

#### I-03.5: Query String Handling

Query strings should be **preserved by default** through all redirects and normalizations.

| Scenario                 | Expected Behavior                                           |
| ------------------------ | ----------------------------------------------------------- |
| Canonical redirect       | Query preserved: `/path?a=1` → `https://canonical/path?a=1` |
| Path redirect            | Query preserved: `/old?b=2` → `/new?b=2`                    |
| Trailing slash normalize | Query preserved: `/path/?c=3` → `/path?c=3`                 |

**Special Cases:**

- **Stripping tracking params:** If intentionally removing `utm_*`, `fbclid`, etc., use Transform Rules
- **Sorting query params:** Generally not needed; only for cache normalization

> **Default:** Preserve all query strings unless explicitly documented otherwise.

#### Checklist

| Item                  | Action                                       | Reference                                          |
| --------------------- | -------------------------------------------- | -------------------------------------------------- |
| Scheme normalization  | Verify "Always Use HTTPS" enabled (I-02)     | Dashboard → SSL/TLS                                |
| Canonical host        | Create www→apex redirect rule                | [CANONICAL_HOST_SPEC.md](./CANONICAL_HOST_SPEC.md) |
| Worker route cleanup  | Remove non-canonical host from wrangler.toml | wrangler.toml                                      |
| Trailing slash policy | Document decision (enforce/ignore)           | This section                                       |
| Legacy path audit     | Review 404s, create redirects as needed      | Analytics/logs                                     |
| Query preservation    | Verify redirects preserve query strings      | Test commands                                      |

#### Verification Commands

```bash
# I-03.2: Canonical host redirect
curl -sI https://www.yourdomain.com/test/path?query=value | grep -iE "^(HTTP|location)"
# Expected: HTTP/2 301, location: https://yourdomain.com/test/path?query=value

# I-03.3: Trailing slash behavior (test current behavior)
curl -sI https://yourdomain.com/path/ | head -1
curl -sI https://yourdomain.com/path | head -1
# Document which returns 200 vs 301/404

# I-03.4: Legacy path redirect (if configured)
curl -sI https://yourdomain.com/old-path | grep -iE "^(HTTP|location)"

# I-03.5: Query preservation
curl -sI "https://www.yourdomain.com/page?a=1&b=2" | grep -i location
# Expected: location includes ?a=1&b=2
```

**Exit Gate I-03:**

```
✓ One canonical host: all alternate hosts redirect (301) to canonical
✓ One canonical scheme: HTTP redirects to HTTPS (enforced by I-02)
✓ Stable paths: trailing slash policy documented and consistent
✓ Query strings preserved through all redirects
✓ No worker routes for non-canonical hosts
```

> **Exit Gate Summary:** The request shape is deterministic. Given any variant URL, we know exactly what canonical form it will be normalized to before security policies evaluate it.

---

### [I-04] Config/Origin Rules (Behavior Knobs)

> **Intent:** Define per-path behavior early so later security/caching aligns with it. These are **behavior knobs**, not "security theater."

Configuration Rules and Origin Rules allow you to specify how requests are handled at the edge level—before security policies evaluate them. By defining these behaviors early, you ensure that WAF rules, Access policies, and caching all operate on well-understood request contexts.

#### Why I-04? (After Request Normalization, Before DNSSEC)

Config/Origin Rules come after request normalization because:

1. **Normalized input** — The request is already in canonical form (I-03), so rules match consistently
2. **Behavior foundation** — Origin routing and path behaviors affect how security rules apply
3. **No security dependency** — These are operational settings, not protection mechanisms; DNSSEC/WAF can wait
4. **Cache alignment** — Caching decisions need to know which origin serves which path

#### I-04.1: Configuration Rules

Configuration Rules (Beta) let you modify Cloudflare feature settings on a per-request basis.

| Use Case                  | Setting                 | Example                                          |
| ------------------------- | ----------------------- | ------------------------------------------------ |
| Disable security for path | Browser Integrity Check | Disable for `/api/webhooks/*` (external callers) |
| Adjust cache behavior     | Cache Level             | Bypass cache for `/api/*`, aggressive for static |
| Disable features for API  | Email Obfuscation       | Disable for `/api/*` (breaks JSON responses)     |
| Development paths         | All security features   | Reduced enforcement for `/dev/*` in staging      |

**Configuration:** Dashboard → Rules → Configuration Rules

**Example Rule (Disable email obfuscation for API):**

```
When: starts_with(http.request.uri.path, "/api/")
Then:
  - Email Obfuscation: Off
  - Automatic HTTPS Rewrites: Off (API handles redirects)
```

> **Warning:** Configuration Rules can disable security features. Each rule must be documented with justification.

#### I-04.2: Origin Rules (Multi-Origin Routing)

Origin Rules define which origin server handles specific paths. Essential for architectures with multiple backends.

| Scenario      | Path Pattern | Origin Override            |
| ------------- | ------------ | -------------------------- |
| API backend   | `/api/*`     | `api-origin.internal:8080` |
| Static assets | `/static/*`  | `cdn-origin.internal`      |
| Legacy system | `/legacy/*`  | `legacy.internal:3000`     |
| Default       | `*`          | Worker handles (no origin) |

**Configuration:** Dashboard → Rules → Origin Rules

**Example Rule (Route API to dedicated backend):**

```
When: starts_with(http.request.uri.path, "/api/v2/")
Then:
  - Host Header: api-backend.internal
  - Override destination port: 8080
```

#### I-04.3: Security Header Injection (Response)

While Transform Rules (R-11) handle response headers, you may need to configure security headers at specific layers:

| Header                   | Purpose                  | Configuration Layer        |
| ------------------------ | ------------------------ | -------------------------- |
| `X-Frame-Options`        | Clickjacking prevention  | Transform Rules (Response) |
| `X-Content-Type-Options` | MIME sniffing prevention | Transform Rules (Response) |
| `X-XSS-Protection`       | Legacy XSS filter        | Transform Rules (Response) |
| `Referrer-Policy`        | Referrer leakage control | Transform Rules (Response) |
| `Permissions-Policy`     | Feature restrictions     | Transform Rules (Response) |

> **Note:** HSTS is configured via SSL/TLS settings (I-02), not Transform Rules.

**Reference:** These headers may also be set by the Worker. Ensure no conflicts—last writer wins.

#### I-04.4: Path-Based Routing Documentation

**Exit Gate Requirement:** You must be able to explain "Which origin serves which path?" without hand-waving.

Document your routing architecture:

| Path Pattern | Origin/Handler                    | Notes                 |
| ------------ | --------------------------------- | --------------------- |
| `/*`         | Worker (`event-toolkit-worker`)   | Default handler       |
| `/api/*`     | Worker → (internal logic)         | API endpoints         |
| `/static/*`  | Worker → R2/KV or pass-through    | Static assets         |
| `/admin/*`   | Worker (behind Access — see I-13) | Admin dashboard       |
| `/healthz`   | Worker (bypass Access)            | Health check endpoint |

> **Key Insight:** In a Worker-only architecture (NS-5), the Worker IS the origin. Origin Rules are only needed if you have a true multi-origin setup with distinct backend servers.

#### Checklist

| Item                          | Action                                        | Reference                           |
| ----------------------------- | --------------------------------------------- | ----------------------------------- |
| Configuration Rules audit     | Document any feature overrides per path       | This section                        |
| Origin Rules (if applicable)  | Document multi-origin routing                 | This section                        |
| Security headers              | Verify response headers via Transform Rules   | Dashboard → Rules → Transform Rules |
| Routing documentation         | Update table in I-04.4 for your architecture  | This section                        |
| Feature disable justification | Document why any security feature is disabled | PR review required                  |

#### Verification Commands

```bash
# Check security headers in response
curl -sI https://yourdomain.com | grep -iE "^(x-frame|x-content|x-xss|referrer-policy|permissions-policy)"

# Verify API path doesn't have email obfuscation artifacts
curl -s https://yourdomain.com/api/v1/status | grep -c "data-cfemail" || echo "No obfuscation: OK"

# Confirm path routing (if multi-origin)
curl -sI https://yourdomain.com/api/v1/status | grep -i "cf-ray"
curl -sI https://yourdomain.com/static/test.css | grep -i "cf-ray"
# Both should have CF-Ray (behind Cloudflare)
```

**Exit Gate I-04:**

```
✓ Can explain "Which origin serves which path?" without ambiguity
✓ Configuration Rules documented (or confirmed: none needed)
✓ Origin Rules documented (or confirmed: Worker-only architecture)
✓ Security header response verified
✓ Any disabled security features have documented justification
```

---

### [I-05] WAF Managed Rules (Baseline Coverage)

> **Intent:** Turn on the "known bad" detection **before** hand-rolling clever custom rules. Let Cloudflare's threat intelligence do the heavy lifting.

WAF Managed Rulesets are pre-built, continuously updated rule collections maintained by Cloudflare's security team. Enabling these first provides immediate protection against known attack patterns while you develop project-specific custom rules.

#### Why I-05? (After Config/Origin Rules, Before DNSSEC)

Managed rulesets should be enabled early because:

1. **Immediate protection** — Known SQLi, XSS, RCE patterns blocked from day one
2. **Low false-positive baseline** — Cloudflare tunes these rules across millions of sites
3. **Foundation for custom rules** — Understand what managed rules catch before writing custom ones
4. **Threat intelligence included** — Automatic updates as new attack patterns emerge
5. **No config required** — Enable and observe; tuning is optional refinement

#### I-05.1: Available Managed Rulesets

| Ruleset                                  | Purpose                                            | Recommendation               |
| ---------------------------------------- | -------------------------------------------------- | ---------------------------- |
| **Cloudflare Managed Ruleset**           | Common attack patterns (SQLi, XSS, LFI, RFI, etc.) | ✅ Enable (required)         |
| **Cloudflare OWASP Core Ruleset**        | OWASP Top 10 protection with paranoia levels       | ✅ Enable (recommended)      |
| **Cloudflare Leaked Credentials Check**  | Blocks requests using known breached credentials   | ✅ Enable for auth endpoints |
| **Cloudflare Exposed Credentials Check** | Similar to above, different detection method       | Consider for auth endpoints  |

**Configuration:** Dashboard → Security → WAF → Managed rules

#### I-05.2: Cloudflare Managed Ruleset

The primary defense layer. Covers:

- SQL Injection (SQLi)
- Cross-Site Scripting (XSS)
- Local File Inclusion (LFI)
- Remote File Inclusion (RFI)
- Remote Code Execution (RCE)
- Common CVEs and exploit patterns

**Initial Configuration:**

| Setting        | Initial Value               | Rationale                              |
| -------------- | --------------------------- | -------------------------------------- |
| Ruleset status | **Enabled**                 | Non-negotiable baseline                |
| Default action | **Managed** (let CF decide) | Defer to Cloudflare's tuning initially |
| Sensitivity    | **High**                    | Start strict; loosen only if FPs occur |

> **Staging-First (NG-4):** Enable in staging environment first. Monitor for 7 days before production deployment.

#### I-05.3: OWASP Core Ruleset

Implements OWASP ModSecurity Core Rule Set (CRS) logic. Provides defense-in-depth for OWASP Top 10 vulnerabilities.

**Paranoia Levels:**

| Level              | Coverage      | False Positives | Use Case                                        |
| ------------------ | ------------- | --------------- | ----------------------------------------------- |
| **PL1** (Low)      | Basic attacks | Low             | Starting point; general web apps                |
| **PL2** (Medium)   | More patterns | Moderate        | After tuning PL1; security-sensitive apps       |
| **PL3** (High)     | Aggressive    | Higher          | High-security environments with tuning budget   |
| **PL4** (Paranoid) | Maximum       | Very High       | Specialized use only; expect significant tuning |

**Initial Configuration:**

| Setting                 | Initial Value    | Rationale                                      |
| ----------------------- | ---------------- | ---------------------------------------------- |
| Ruleset status          | **Enabled**      | Defense-in-depth with managed ruleset          |
| Paranoia Level          | **PL1**          | Start conservative; increase after observation |
| Anomaly Score Threshold | **Medium (25+)** | Default; lower if too permissive               |

> **Warning:** PL3+ generates significant false positives on legitimate traffic. Only increase paranoia after thorough staging observation.

#### I-05.4: Leaked Credentials Check

Detects login attempts using credentials from known data breaches. Applies to authentication endpoints.

**Configuration:**

| Setting | Value                              | Notes                          |
| ------- | ---------------------------------- | ------------------------------ |
| Status  | **Enabled**                        | Essential for user-facing auth |
| Paths   | `/api/auth/*`, `/login`, `/signin` | Scope to auth endpoints only   |
| Action  | **Log** initially, then **Block**  | Start observational            |

> **Privacy Note:** Cloudflare does not log credentials; detection uses k-anonymity hashing.

#### I-05.5: Deploying Managed Rules (Staging-First)

Follow this workflow per **NG-4**:

```
Week 1 (Staging):
1. Enable Cloudflare Managed Ruleset → Action: Log
2. Enable OWASP CRS at PL1 → Action: Log
3. Monitor Security Events dashboard daily

Week 2 (Staging - Blocking):
4. Change Managed Ruleset → Action: Block (or Managed)
5. Keep OWASP at Log; review events
6. Document any false positives; create exceptions as needed

Week 3 (Production):
7. Deploy same configuration to production
8. Enable OWASP → Action: Block after 7-day observation
9. Review Security Events; tune exceptions
```

#### I-05.6: Handling False Positives

When legitimate requests trigger managed rules:

| Approach               | When to Use                   | How                                                                     |
| ---------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| **Skip specific rule** | Single rule fires incorrectly | Dashboard → WAF → Managed rules → Override rule to "Log" or "Skip"      |
| **Path exception**     | Rule fires on specific path   | Create WAF Custom Rule: Skip managed ruleset when `path = /api/webhook` |
| **Global exception**   | Trusted source                | IP allowlist (R-02) or WAF Custom Rule skip                             |

**Exception Documentation:**

Every managed rule exception MUST be documented:

```markdown
| Rule ID | Ruleset    | Path/Trigger | Reason                                           | Date       | Reviewer  |
| ------- | ---------- | ------------ | ------------------------------------------------ | ---------- | --------- |
| 100001  | CF Managed | /api/webhook | Stripe webhook sends suspicious payload patterns | 2026-01-05 | @security |
```

> **NG-3 Compliance:** Even exception rules (skips) require PR review. No random exception sprawl.

#### Checklist

| Item                    | Action                                        | Reference                     |
| ----------------------- | --------------------------------------------- | ----------------------------- |
| CF Managed Ruleset      | Enable with default/managed action            | Dashboard → Security → WAF    |
| OWASP Core Ruleset      | Enable at PL1 with medium threshold           | Dashboard → Security → WAF    |
| Leaked Credentials      | Enable for auth endpoints                     | Dashboard → Security → WAF    |
| Staging observation     | Minimum 7 days before blocking                | NG-4 requirement              |
| Security Events review  | Confirm rules are triggering (even just logs) | Dashboard → Security → Events |
| Exception documentation | Document any rule overrides/skips             | Exception register            |

#### Verification Commands

```bash
# Confirm WAF is evaluating requests (look for rule matches)
# Use Dashboard: Security → Events → Filter by "Service: WAF"

# Test SQLi detection (should be blocked or challenged)
curl -sI "https://yourdomain.com/?id=1'%20OR%20'1'='1" | grep -E "^HTTP"
# Expected: 403 Forbidden (if blocking) or challenge page

# Test XSS detection
curl -sI "https://yourdomain.com/?q=<script>alert(1)</script>" | grep -E "^HTTP"
# Expected: 403 Forbidden (if blocking) or challenge page

# Check WAF is active via Ray ID lookup
curl -sI https://yourdomain.com | grep "cf-ray"
# Use this Ray ID in Security Events to trace rule evaluation
```

> **Note:** Test attacks should be performed in staging only, with team awareness.

**Exit Gate I-05:**

```
✓ Cloudflare Managed Ruleset: Enabled and producing events
✓ OWASP Core Ruleset: Enabled at PL1 and producing events
✓ Security Events dashboard shows WAF-triggered entries
✓ Staging observation period completed (minimum 7 days)
✓ Any exceptions documented with justification
```

> **Exit Gate Summary:** Managed rules are ON and producing observable events (even if mostly "log" at first). You have baseline coverage before writing custom rules.

---

### [I-06] Custom WAF Rules (Application-Specific Policy)

> **Intent:** Enforce YOUR invariants: admin protection, allowlists, strict blocks. Custom rules extend baseline protection for threats specific to your application's threat model.

Custom WAF rules should be written **after** I-05 (Managed Rules) is active. This ensures you're not duplicating what Cloudflare already detects and allows you to focus on application-specific patterns.

#### Why I-06? (After Managed Rules, Before DNSSEC)

Custom WAF rules come immediately after managed rules because:

1. **Foundation in place** — Managed rules (I-05) handle generic attack patterns; custom rules extend them
2. **No duplication** — You've observed what managed rules catch before writing custom ones
3. **Defense-in-depth** — Custom rules add application-specific protection before request reaches Worker
4. **Deterministic behavior** — Rules evaluated top-down; order must be explicit and reviewed

#### I-06.1: Prerequisites

| Prerequisite             | Status   | Notes                                 |
| ------------------------ | -------- | ------------------------------------- |
| I-05 complete            | Required | Managed rulesets enabled and observed |
| 7-day observation        | Required | Understand what managed rules catch   |
| Security Events reviewed | Required | Baseline understanding established    |

#### I-06.2: When to Write Custom Rules

| Scenario                     | Example                                       | Managed Rule Coverage    |
| ---------------------------- | --------------------------------------------- | ------------------------ |
| **Path-based blocking**      | Block `/api/internal/*` without service token | ❌ Not covered           |
| **Admin protection**         | Require specific headers for `/admin/*`       | ❌ Not covered           |
| **Business logic guards**    | Block concurrent session creation             | ❌ Not covered           |
| **Known scanner User-Agent** | Block specific scanning tools                 | Partial (Bot Fight Mode) |
| **Country + path combo**     | Block non-US access to `/api/admin/*`         | ❌ Not covered           |
| **SQLi pattern**             | Generic SQL injection                         | ✅ Use managed rules     |

> **Principle:** Let managed rules handle generic attacks. Custom rules are for YOUR application's specific threat model.

#### I-06.3: Protected Path Categories

Define custom rules for these path categories:

| Path Pattern        | Protection Intent                | Rule Priority  |
| ------------------- | -------------------------------- | -------------- |
| `/admin/*`          | Admin dashboard protection       | High (1-10)    |
| `/api/admin/*`      | Admin API endpoints              | High (1-10)    |
| `/api/internal/*`   | Internal service endpoints       | High (11-20)   |
| `/auth/*`           | Authentication endpoints         | High (21-30)   |
| `/api/verify/*`     | Sensitive verification endpoints | Medium (31-40) |
| `/api/*` (general)  | General API protection           | Medium (41-50) |
| Expensive endpoints | Resource-intensive operations    | Medium (51-60) |

#### I-06.4: Rule Priority and Ordering

> **CRITICAL:** WAF custom rules are evaluated **top-down by priority number**. Lower numbers execute first.

| Priority Range | Purpose                          | Examples                           |
| -------------- | -------------------------------- | ---------------------------------- |
| **1-10**       | Critical blocks (admin/internal) | Block unauthenticated admin access |
| **11-20**      | Allowlists (trusted sources)     | Skip WAF for monitoring IPs        |
| **21-30**      | Authentication path protection   | Rate limit auth endpoints          |
| **31-50**      | Application-specific blocks      | Block specific User-Agents         |
| **51+**        | Logging/observation rules        | Log suspicious patterns            |

**Rule Evaluation Flow:**

```
Request arrives
    │
    ├─ Priority 1 rule: Match? → Action (block/skip/allow)
    │                    No match ↓
    ├─ Priority 2 rule: Match? → Action
    │                    No match ↓
    ├─ ... continue down priority list ...
    │
    └─ No rule matched → Request proceeds
```

#### I-06.5: Standard Custom Rule Templates

**Template A: Admin Path Protection**

```
Rule Name: Block unauthenticated admin access
Priority: 5
Expression:
  (starts_with(http.request.uri.path, "/admin")) and
  (not http.request.headers["cf-access-authenticated-user-email"][0] ne "")
Action: Block
Response: 403 Forbidden

Justification: Admin paths require Cloudflare Access authentication.
               Double-defense in case Access misconfiguration.
```

**Template B: Internal API Protection**

```
Rule Name: Block external internal API access
Priority: 10
Expression:
  (starts_with(http.request.uri.path, "/api/internal/")) and
  (not cf.bot_management.verified_bot) and
  (not ip.src in $INTERNAL_IPS)
Action: Block
Response: 403 Forbidden

Justification: Internal APIs should only be accessible from known sources.
```

**Template C: Auth Endpoint Hardening**

```
Rule Name: Auth endpoint suspicious pattern block
Priority: 25
Expression:
  (starts_with(http.request.uri.path, "/auth/")) and
  (
    (http.request.headers["user-agent"][0] contains "curl") or
    (http.request.headers["user-agent"][0] contains "python-requests") or
    (http.request.headers["user-agent"][0] eq "")
  )
Action: Challenge (Managed)
Response: JS Challenge

Justification: Auth endpoints should not be accessed by scripts;
               challenge to verify human interaction.
```

**Template D: Expensive Endpoint Protection**

```
Rule Name: Protect expensive endpoints
Priority: 40
Expression:
  (http.request.uri.path eq "/api/v2/reports/generate") or
  (http.request.uri.path eq "/api/v2/export/bulk")
Action: Challenge (Managed)
Response: JS Challenge

Justification: Resource-intensive endpoints; challenge to prevent abuse.
```

**Template E: Allowlist for Monitoring**

```
Rule Name: Skip WAF for monitoring
Priority: 1
Expression:
  (ip.src in $MONITORING_IPS) and
  (http.request.uri.path eq "/healthz")
Action: Skip
Skip: All remaining custom rules

Justification: Health check monitoring must not be blocked or challenged.
```

#### I-06.6: IP Lists and Variables

Use Cloudflare IP Lists for maintainable rules:

| List Name         | Purpose                            | Update Frequency |
| ----------------- | ---------------------------------- | ---------------- |
| `$INTERNAL_IPS`   | Known internal service IPs         | As needed        |
| `$MONITORING_IPS` | Uptime monitoring services         | Quarterly        |
| `$BLOCKED_IPS`    | Known malicious IPs                | As needed        |
| `$ADMIN_IPS`      | Admin user IPs (if IP-restricting) | As needed        |

**Configuration:** Dashboard → Manage Account → Configurations → Lists

#### I-06.7: Rule Documentation Requirements

> **NG-3 (Hard Gate):** Rules that **Block** must be explicitly ordered and reviewed. No "random rule sprawl."

Every custom rule MUST have:

| Field         | Required                | Example                              |
| ------------- | ----------------------- | ------------------------------------ |
| Rule Name     | ✅                      | `Block unauthenticated admin access` |
| Priority      | ✅                      | `5`                                  |
| Expression    | ✅                      | Full wirefilter expression           |
| Action        | ✅                      | `Block`, `Challenge`, `Skip`, `Log`  |
| Justification | ✅                      | Why this rule exists                 |
| Created Date  | ✅                      | `2026-01-06`                         |
| Author        | ✅                      | `@security-lead`                     |
| Review Date   | ✅                      | `2026-04-06` (quarterly)             |
| PR Reference  | ✅ (for blocking rules) | `PR #123`                            |

#### I-06.8: Custom Rule Registry

Maintain a registry of all custom rules:

```markdown
## Custom WAF Rule Registry

| ID      | Priority | Rule Name                   | Action    | Path Pattern     | Created    | Review Date | PR  |
| ------- | -------- | --------------------------- | --------- | ---------------- | ---------- | ----------- | --- |
| CWR-001 | 1        | Skip WAF for monitoring     | Skip      | /healthz         | 2026-01-06 | 2026-04-06  | —   |
| CWR-002 | 5        | Block unauth admin          | Block     | /admin/\*        | 2026-01-06 | 2026-04-06  | #XX |
| CWR-003 | 10       | Block external internal API | Block     | /api/internal/\* | 2026-01-06 | 2026-04-06  | #XX |
| CWR-004 | 25       | Auth endpoint challenge     | Challenge | /auth/\*         | 2026-01-06 | 2026-04-06  | #XX |
```

#### I-06.9: Staging-First Deployment (NG-4)

All custom WAF rules MUST follow staging-first deployment:

```
1. Write rule with Action: Log
2. Deploy to staging environment
3. Monitor Security Events for 7 days minimum
4. Review matches — verify no false positives
5. Change Action to Block/Challenge
6. Monitor staging for 3 days
7. Deploy to production with Action: Log (24h)
8. Change production Action to Block/Challenge
9. Document in Custom Rule Registry
```

**For blocking rules:**

- Minimum 7-day staging observation before production
- PR review required before production deployment
- Must document rollback procedure

#### I-06.10: Rule Review Cadence

| Review Type   | Frequency         | Actions                              |
| ------------- | ----------------- | ------------------------------------ |
| **New rule**  | Before deployment | PR review, staging test              |
| **Quarterly** | Every 90 days     | Audit all rules, verify still needed |
| **Incident**  | As needed         | After false positive or missed block |

**Quarterly Review Checklist:**

```markdown
QUARTERLY CUSTOM WAF RULE REVIEW

Date: ******\_\_\_******
Reviewer: ******\_\_\_******

For each rule:
[ ] Is this rule still needed?
[ ] Is the priority still appropriate?
[ ] Are there false positives in Security Events?
[ ] Should the expression be narrowed or expanded?
[ ] Is documentation up to date?

Summary:

- Rules reviewed: \_\_\_
- Rules removed: \_\_\_
- Rules modified: \_\_\_
- Rules added: \_\_\_

Next review: ******\_\_\_******
```

#### Checklist

| Item                    | Action                               | Reference     |
| ----------------------- | ------------------------------------ | ------------- |
| I-05 complete           | Verify managed rulesets active       | Prerequisite  |
| Custom rules documented | Each rule has required fields        | Rule Registry |
| Priority ordering       | Lower priority = evaluated first     | I-06.4        |
| Staging tested          | All blocking rules tested in staging | NG-4          |
| PR reviewed             | Blocking rules have PR approval      | NG-3          |
| Registry updated        | All rules in Custom Rule Registry    | I-06.8        |

#### Verification Commands

```bash
# List all custom WAF rules (requires API token with WAF read)
# Use Dashboard: Security → WAF → Custom rules

# Test admin path protection (should be blocked or challenged)
curl -sI https://yourdomain.com/admin/ | grep -E "^HTTP"
# Expected: 302 (Access redirect) or 403 (if no Access auth)

# Test internal API protection
curl -sI https://yourdomain.com/api/internal/status | grep -E "^HTTP"
# Expected: 403 (blocked for external IPs)

# Test monitoring allowlist (from monitoring IP)
curl -sI https://yourdomain.com/healthz | grep -E "^HTTP"
# Expected: 200 (allowed)

# Verify rule is logging (use Security Events dashboard)
# Filter: Service = Custom rules, Rule name = [your rule]
```

**Exit Gate I-06:**

```
✓ Custom rules are versioned in registry (I-06.8)
✓ Rules are ordered by explicit priority (no random sprawl)
✓ All blocking rules have PR review documented
✓ Staging observation completed for all rules
✓ No "mystery blocks" — every block traceable to documented rule
```

> **Exit Gate Summary:** Custom rules are versioned, explicitly ordered, and reviewed. You can explain what every custom rule does and why it exists. No mystery blocks.

---

### [I-07] Rate Limiting (Abuse + Cost Control)

> **Intent:** RAG and AI endpoints are expensive; rate limits are cost + uptime protection. Prevent abuse that causes financial harm or resource exhaustion before requests reach expensive compute.

Rate limiting should be configured early in the request evaluation pipeline (R-04) to catch abuse before it consumes downstream resources. This is especially critical for endpoints that trigger:

- LLM/RAG inference calls
- Database-heavy queries
- External API calls with per-request billing
- CPU-intensive computations

#### Why I-07? (After Custom WAF Rules)

Rate limiting is positioned after WAF rule configuration because:

1. **WAF catches attacks first** — SQLi/XSS blocked before counting against rate limits
2. **Rate limits are business logic** — Thresholds depend on your cost model, not attack patterns
3. **Complementary protection** — WAF blocks bad actors; rate limits throttle heavy users
4. **Cost ceiling** — Prevents "legitimate" abuse from driving up compute bills

#### I-07.1: Endpoint Categories for Rate Limiting

| Category                       | Risk Profile                     | Why Rate Limit                                   |
| ------------------------------ | -------------------------------- | ------------------------------------------------ |
| **Auth endpoints**             | Credential stuffing target       | Prevent brute force; protect identity providers  |
| **Token endpoints**            | API key generation/refresh       | Prevent token farming; audit trail               |
| **Search/retrieval endpoints** | High compute (RAG/vector search) | Expensive upstream calls; protect embedding APIs |
| **Export/bulk endpoints**      | Memory + I/O intensive           | Resource exhaustion; timeout risk                |
| **AI/LLM endpoints**           | Highest cost per request         | $$$ per token; must throttle aggressively        |

#### I-07.2: Standard Rate Limit Configuration

Define limits based on **legitimate user behavior** plus safety margin:

| Endpoint Pattern   | Threshold | Window | Action    | Rationale                   |
| ------------------ | --------- | ------ | --------- | --------------------------- |
| `/auth/login`      | 5 req     | 1 min  | Block     | Prevent credential stuffing |
| `/auth/callback`   | 10 req    | 1 min  | Block     | OAuth callback abuse        |
| `/api/token/*`     | 10 req    | 1 min  | Block     | Token endpoint protection   |
| `/api/search/*`    | 30 req    | 1 min  | Challenge | RAG queries are expensive   |
| `/api/v2/search/*` | 30 req    | 1 min  | Challenge | Vector search protection    |
| `/api/*/export`    | 5 req     | 5 min  | Block     | Bulk export protection      |
| `/api/*/generate`  | 10 req    | 1 min  | Block     | AI generation endpoints     |
| `/api/*` (general) | 100 req   | 1 min  | Challenge | Baseline API protection     |
| `/admin/*`         | 50 req    | 1 min  | Log       | Behind Access; log only     |
| Static assets      | Exempt    | —      | —         | Cache layer handles         |

> **Principle:** Auth and token endpoints get strict limits. AI/search endpoints get moderate limits with challenge (not block). General API gets high threshold as safety net.

#### I-07.3: Rate Limiting Rule Configuration

**Configuration:** Dashboard → Security → WAF → Rate limiting rules

**Rule Structure:**

```
Rule Name: [Category] - [Endpoint Pattern] - [Threshold]
Expression: (http.request.uri.path matches "[pattern]")
Characteristics:
  - Counting expression: ip.src (per-IP limiting)
  - Period: 60 seconds (or as specified)
  - Requests: [threshold]
Mitigation:
  - Action: Block / Challenge / Log
  - Timeout: 60 seconds (blocked period)
```

**Example: Auth Endpoint Rate Limit**

```
Rule Name: AUTH-001 - Login rate limit - 5/min
Expression:
  (http.request.uri.path eq "/auth/login") or
  (http.request.uri.path eq "/api/auth/login")
Characteristics:
  - Count per: ip.src
  - Period: 60 seconds
  - Requests: 5
Mitigation:
  - Action: Block
  - Timeout: 60 seconds
```

**Example: Search/RAG Rate Limit**

```
Rule Name: SEARCH-001 - RAG query rate limit - 30/min
Expression:
  (http.request.uri.path matches "^/api/.*/search") or
  (http.request.uri.path matches "^/api/.*/query") or
  (http.request.uri.path matches "^/api/.*/retrieve")
Characteristics:
  - Count per: ip.src
  - Period: 60 seconds
  - Requests: 30
Mitigation:
  - Action: Managed Challenge
  - Timeout: 60 seconds
```

**Example: AI/Generation Rate Limit**

```
Rule Name: AI-001 - Generation endpoint rate limit - 10/min
Expression:
  (http.request.uri.path matches "^/api/.*/generate") or
  (http.request.uri.path matches "^/api/.*/completion") or
  (http.request.uri.path matches "^/api/.*/inference")
Characteristics:
  - Count per: ip.src
  - Period: 60 seconds
  - Requests: 10
Mitigation:
  - Action: Block
  - Timeout: 120 seconds (longer cool-off for expensive endpoints)
```

#### I-07.4: Advanced Rate Limiting Techniques

**Per-User Rate Limiting (Authenticated Users)**

For endpoints behind authentication, rate limit by user identity instead of IP:

```
Expression:
  (http.request.uri.path matches "^/api/v2/admin/")
Characteristics:
  - Count per: http.request.headers["cf-access-authenticated-user-email"]
  - Period: 60 seconds
  - Requests: 100
```

> **Note:** Per-user limits require Cloudflare Access or custom header injection.

**Tiered Rate Limiting**

Apply multiple rules with increasing severity:

| Tier   | Threshold     | Action    | Purpose                         |
| ------ | ------------- | --------- | ------------------------------- |
| Tier 1 | 80% of limit  | Log       | Early warning (dashboard alert) |
| Tier 2 | 100% of limit | Challenge | Soft enforcement                |
| Tier 3 | 200% of limit | Block     | Hard enforcement                |

**Burst Protection**

For endpoints that can handle occasional bursts but not sustained load:

```
Rule Name: BURST-001 - Sustained abuse protection
Expression: (http.request.uri.path matches "^/api/")
Characteristics:
  - Count per: ip.src
  - Period: 10 seconds
  - Requests: 50
Mitigation:
  - Action: Managed Challenge
```

#### I-07.5: Rate Limit Exemptions

Some sources should bypass rate limits:

| Source                    | Exemption Method                 | Justification       |
| ------------------------- | -------------------------------- | ------------------- |
| Health check monitoring   | Skip for `/healthz` path         | Must always succeed |
| CI/CD pipelines           | Service token + IP allowlist     | Automated testing   |
| Verified bots (Googlebot) | `cf.bot_management.verified_bot` | SEO/indexing        |
| Internal services         | IP list `$INTERNAL_IPS`          | Service-to-service  |

**Exemption Rule (Priority 1):**

```
Rule Name: RATELIMIT-EXEMPT - Monitoring bypass
Expression:
  (http.request.uri.path eq "/healthz") or
  (http.request.uri.path eq "/api/status") or
  (ip.src in $MONITORING_IPS)
Action: Skip (all rate limiting rules)
```

#### I-07.6: Rate Limit Registry

Document all rate limiting rules:

```markdown
## Rate Limiting Rule Registry

| ID     | Endpoint Pattern  | Threshold | Window | Action    | Created    | Review Date |
| ------ | ----------------- | --------- | ------ | --------- | ---------- | ----------- |
| RL-001 | /auth/login       | 5         | 1 min  | Block     | 2026-01-06 | 2026-04-06  |
| RL-002 | /auth/callback    | 10        | 1 min  | Block     | 2026-01-06 | 2026-04-06  |
| RL-003 | /api/token/\*     | 10        | 1 min  | Block     | 2026-01-06 | 2026-04-06  |
| RL-004 | /api/\*/search    | 30        | 1 min  | Challenge | 2026-01-06 | 2026-04-06  |
| RL-005 | /api/\*/generate  | 10        | 1 min  | Block     | 2026-01-06 | 2026-04-06  |
| RL-006 | /api/\* (general) | 100       | 1 min  | Challenge | 2026-01-06 | 2026-04-06  |
| RL-EX1 | Monitoring bypass | —         | —      | Skip      | 2026-01-06 | 2026-04-06  |
```

#### I-07.7: Staging-First Deployment (NG-4)

All rate limiting rules MUST follow staging-first deployment:

```
1. Deploy rule to staging with Action: Log
2. Run load tests to establish baseline (see I-07.9)
3. Monitor Security Events for 7 days
4. Adjust thresholds based on legitimate traffic patterns
5. Change Action to Block/Challenge in staging
6. Run load tests again — verify 429 responses
7. Deploy to production with Action: Log (24h observation)
8. Enable enforcement (Block/Challenge) in production
9. Document in Rate Limit Registry
```

#### I-07.8: Monitoring and Alerting

| Metric              | Dashboard Location                        | Alert Threshold               |
| ------------------- | ----------------------------------------- | ----------------------------- |
| Rate limit triggers | Security → Events → Filter: Rate limiting | > 100/hour on any single rule |
| 429 response rate   | Analytics → Traffic                       | > 1% of total requests        |
| Per-rule hit counts | Security → WAF → Rate limiting rules      | Establish baseline first      |

**Log Analysis Queries:**

```bash
# Find rate-limited IPs (via Security Events export)
grep "ratelimit" security-events.json | jq '.clientIP' | sort | uniq -c | sort -rn | head -20

# Monitor rate limit triggers in real-time (if log streaming enabled)
tail -f /var/log/cloudflare-events.log | grep "rate_limit"
```

#### I-07.9: Load Testing Verification

> **Exit Gate Requirement:** You must demonstrate rate limits triggering under controlled load tests.

**Load Test Script (staging only):**

```bash
#!/bin/bash
# Rate limit verification - RUN IN STAGING ONLY
DOMAIN="stg.yourdomain.com"
ENDPOINT="/api/search/test"
THRESHOLD=30

echo "Testing rate limit: $THRESHOLD requests to $ENDPOINT"
echo "Expecting 429 after threshold exceeded"

for i in $(seq 1 $((THRESHOLD + 10))); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN$ENDPOINT")
  echo "Request $i: HTTP $STATUS"
  if [ "$STATUS" = "429" ]; then
    echo "✓ Rate limit triggered at request $i"
    exit 0
  fi
done

echo "✗ Rate limit did NOT trigger after $((THRESHOLD + 10)) requests"
exit 1
```

**Load Test Evidence Requirements:**

| Evidence                                    | Source           | Retention                 |
| ------------------------------------------- | ---------------- | ------------------------- |
| Load test output showing 429                | Script output    | Attach to deployment PR   |
| Security Events showing rate limit triggers | Dashboard export | Screenshot or JSON export |
| Timestamp of test                           | Script output    | Include in documentation  |

#### Checklist

| Item                          | Action                                         | Reference |
| ----------------------------- | ---------------------------------------------- | --------- |
| Auth endpoint limits          | Configure `/auth/*` rate limits                | I-07.3    |
| Token endpoint limits         | Configure `/api/token/*` rate limits           | I-07.3    |
| Search/RAG endpoint limits    | Configure search/query/retrieve rate limits    | I-07.3    |
| AI/generation endpoint limits | Configure generate/completion/inference limits | I-07.3    |
| General API fallback          | Configure `/api/*` catch-all rate limit        | I-07.3    |
| Exemptions configured         | Monitoring/health check bypass                 | I-07.5    |
| Registry updated              | All rules documented                           | I-07.6    |
| Staging tested                | Load tests show 429 triggers                   | I-07.9    |
| Production enabled            | Rules active with enforcement                  | NG-4      |

#### Verification Commands

```bash
# Check rate limit headers in response
curl -sI https://yourdomain.com/api/search/test | grep -iE "^(cf-ray|retry-after|x-ratelimit)"

# Trigger rate limit intentionally (staging only!)
for i in {1..50}; do curl -s -o /dev/null -w "%{http_code}\n" "https://stg.yourdomain.com/auth/login"; done
# Expected: 200s followed by 429s after threshold

# Check Security Events for rate limit triggers
# Dashboard: Security → Events → Filter: Service = "Rate limiting"

# Verify specific endpoint has rate limiting (check rule exists)
# Dashboard: Security → WAF → Rate limiting rules → Find rule for endpoint
```

**Exit Gate I-07:**

```
✓ Explicit rate limits defined for auth endpoints (5-10 req/min)
✓ Explicit rate limits defined for token endpoints (10 req/min)
✓ Explicit rate limits defined for search/retrieval endpoints (30 req/min)
✓ Explicit rate limits defined for AI/expensive compute endpoints (10 req/min)
✓ General API fallback rate limit configured (100 req/min)
✓ Exemptions documented (monitoring, health checks)
✓ Load tests demonstrate 429 responses when limits exceeded
✓ Security Events show rate limit triggers in logs
```

> **Exit Gate Summary:** You have explicit rate limits documented and can see them triggering in logs under load tests. No endpoint with expensive upstream compute is unprotected.

---

### [I-08] Bot Controls (Automation Pressure Relief)

> **Intent:** Reduce junk traffic before it hits app logic. Enable bot controls appropriate to plan (SBFM/Bot Management), tuning challenge vs block based on UX needs.

Bot controls operate at R-03 in the [Request Evaluation Pipeline](#r-00-cloudflare-request-pipeline), **before** rate limiting (R-04) and WAF rules (R-05/R-06). This means bot mitigation happens early, reducing load on downstream security layers.

#### Why I-08? (After Rate Limiting Configuration)

Bot controls are positioned after rate limiting configuration because:

1. **WAF foundation required** — Managed rulesets (I-05) handle attack patterns; bot controls handle automation
2. **Rate limits complement** — Bot controls reduce junk; rate limits cap legitimate automated access
3. **UX-sensitive** — Bot challenges affect real users; configure after understanding traffic patterns
4. **Plan-dependent** — Features vary by Cloudflare plan; need to assess available tools

> **CRITICAL WARNING: Avoid Self-DoS** — Overly aggressive bot controls are a common cause of self-inflicted denial of service. Never challenge "everything" — this breaks monitoring, APIs, and mobile apps. See [BOT_CONTROLS_BASELINE.md](./BOT_CONTROLS_BASELINE.md) Section 2 for detailed self-DoS prevention.

#### I-08.1: Prerequisites

| Prerequisite     | Status   | Notes                                  |
| ---------------- | -------- | -------------------------------------- |
| I-05 complete    | Required | WAF managed rulesets active            |
| I-06 complete    | Required | Custom WAF rules configured            |
| I-07 complete    | Required | Rate limiting in place                 |
| Traffic baseline | Required | Understand normal bot traffic patterns |

#### I-08.2: Plan-Aware Feature Matrix

Bot control features depend on your Cloudflare plan:

| Feature                         | Free  | Pro      | Business | Enterprise |
| ------------------------------- | ----- | -------- | -------- | ---------- |
| **Bot Fight Mode**              | Basic | Enhanced | Enhanced | Enhanced   |
| **Super Bot Fight Mode (SBFM)** | ❌    | ✅       | ✅       | ✅         |
| **Bot Score** (in rules)        | ❌    | ❌       | ✅       | ✅         |
| **Bot Analytics**               | Basic | Basic    | ✅       | ✅         |
| **Custom Bot Rules**            | ❌    | ❌       | Limited  | Full       |
| **Bot Management**              | ❌    | ❌       | ❌       | ✅         |

> **Action Required:** Identify your Cloudflare plan and configure features accordingly.

#### I-08.3: Bot Classification Categories

Cloudflare classifies traffic into these categories:

| Classification           | Bot Score Range   | Default Action | Rationale                               |
| ------------------------ | ----------------- | -------------- | --------------------------------------- |
| **Verified Bots**        | — (explicit list) | **ALLOW**      | Googlebot, Bingbot, monitoring services |
| **Likely Human**         | 80-99             | Allow          | High confidence human traffic           |
| **Uncertain**            | 50-79             | Allow          | Insufficient signal                     |
| **Likely Automated**     | 30-49             | Log            | Suspicious but uncertain                |
| **Definitely Automated** | 1-29              | Challenge      | High confidence bot traffic             |

> **Principle:** Start with `Log` actions and observe before enabling `Challenge` or `Block`.

#### I-08.4: Endpoints to NEVER Challenge

> **CRITICAL:** Challenging these endpoints causes self-DoS.

| Endpoint Category      | Path Patterns                          | Why                                             |
| ---------------------- | -------------------------------------- | ----------------------------------------------- |
| **Health/Monitoring**  | `/healthz`, `/api/status`, `/health/*` | Breaks uptime monitoring                        |
| **Display Surfaces**   | `/display`, `/tv`, `/kiosk`, `/screen` | Digital signage has no human to solve challenge |
| **API Read Endpoints** | `/api/v2/events`, `/api/events/*`      | Breaks third-party integrations                 |
| **Static Assets**      | `*.js`, `*.css`, `*.png`, `*.woff2`    | Performance impact, cache breakage              |
| **CI/CD Endpoints**    | `/api/v2/monetization/inert`           | Breaks deployment pipelines                     |

**Skip Rule (Priority 1):**

```
Rule Name: BOT-SKIP-001 - Never challenge protected endpoints
Priority: 1
Expression:
  (http.request.uri.path eq "/healthz") or
  (http.request.uri.path eq "/api/status") or
  (http.request.uri.path matches "^/health/") or
  (http.request.uri.path matches "^/display") or
  (http.request.uri.path matches "^/api/v2/events") or
  (http.request.uri.path matches "\\.(js|css|png|jpg|svg|woff2)$")
Action: Skip (all remaining bot checks)

Justification: These endpoints must remain accessible to automated clients.
```

#### I-08.5: Endpoints Where Challenges Are Appropriate

| Endpoint Category                    | Challenge Type    | Trigger Condition | Rationale                      |
| ------------------------------------ | ----------------- | ----------------- | ------------------------------ |
| **Auth Endpoints** (`/auth/*`)       | Managed Challenge | Bot score < 30    | Credential stuffing prevention |
| **Admin Write API** (`/api/admin/*`) | JS Challenge      | Non-verified bots | High-value target              |
| **Public Forms**                     | Managed Challenge | Bot score < 30    | Spam prevention                |
| **Token Endpoints** (`/api/token/*`) | Managed Challenge | Bot score < 30    | Prevent token farming          |

**Challenge Rule Example:**

```
Rule Name: BOT-AUTH-001 - Challenge suspicious bots on auth
Priority: 20
Expression:
  (http.request.uri.path matches "^/auth/") and
  (not cf.bot_management.verified_bot) and
  (cf.bot_management.score lt 30)
Action: Managed Challenge

Justification: Auth endpoints are credential stuffing targets;
               challenge low-score traffic while allowing verified bots.
```

#### I-08.6: Super Bot Fight Mode Configuration

For Pro plans and above, configure SBFM in Dashboard → Security → Bots:

| Setting                        | Recommended Value     | Rationale                                                     |
| ------------------------------ | --------------------- | ------------------------------------------------------------- |
| **Definitely Automated**       | Managed Challenge     | Challenge, not block — some legitimate tools appear automated |
| **Likely Automated**           | Log (initially)       | High false-positive rate; observe before challenging          |
| **Verified Bots**              | **ALLOW** (mandatory) | Never block search engines, monitoring                        |
| **Static Resource Protection** | **OFF**               | Performance penalty, no security benefit                      |
| **JavaScript Detection**       | ON for auth only      | Via custom rule, not globally                                 |

> **CRITICAL:** Never set "Definitely Automated" to "Block" — use "Challenge" instead. Blocking causes self-DoS for legitimate automation.

#### I-08.7: Custom Bot Rules (Business+)

For Business plans with bot score access, create surgical rules:

**Rule Registry:**

| ID            | Priority | Rule Name                           | Expression                | Action    | Path Pattern             |
| ------------- | -------- | ----------------------------------- | ------------------------- | --------- | ------------------------ |
| BOT-SKIP-001  | 1        | Never challenge protected endpoints | (see I-08.4)              | Skip      | Health, API read, static |
| BOT-AUTH-001  | 20       | Challenge suspicious bots on auth   | (see I-08.5)              | Challenge | `/auth/*`                |
| BOT-ADMIN-001 | 25       | Challenge bots on admin write       | (admin + POST/PUT/DELETE) | Challenge | `/api/admin/*`           |
| BOT-FORM-001  | 30       | Challenge bots on form submission   | (form paths + score < 30) | Challenge | Form endpoints           |

#### I-08.8: Verified Bot Handling

> **Non-Negotiable:** Verified bots must ALWAYS be allowed.

Cloudflare maintains a verified bot list including:

| Category           | Examples                             | Action                         |
| ------------------ | ------------------------------------ | ------------------------------ |
| **Search Engines** | Googlebot, Bingbot, DuckDuckBot      | ALLOW (SEO critical)           |
| **Social Media**   | Facebook, Twitter, LinkedIn crawlers | ALLOW (link previews)          |
| **Monitoring**     | Pingdom, UptimeRobot, Datadog        | ALLOW (operational visibility) |
| **Academic**       | Internet Archive, research crawlers  | ALLOW (typically benign)       |

**Verification:**

```bash
# Check that verified bots are not challenged
# In Security Events, filter for:
# - cf.bot_management.verified_bot = true
# - Action != Allow
# Expected: 0 results (verified bots should never be challenged/blocked)
```

#### I-08.9: Phased Rollout (NG-4 Compliance)

All bot controls MUST follow staging-first deployment:

```
Phase 1: OBSERVE (Minimum 7 days)
├─ Enable Bot Analytics (if available)
├─ Log all bot classifications
├─ Identify baseline traffic patterns
├─ Document verified bots accessing your site
└─ DO NOT enable any challenges or blocks

Phase 2: SELECTIVE CHALLENGE (Minimum 7 days)
├─ Enable Bot Fight Mode (basic)
├─ Create skip rules for protected endpoints (I-08.4)
├─ Challenge auth endpoints only (I-08.5)
├─ Keep verified bot bypass ON
├─ Monitor for user complaints
└─ Create bypass rules for false positives

Phase 3: EXPANDED PROTECTION (Production)
├─ Enable Super Bot Fight Mode (if available)
├─ Challenge admin write endpoints
├─ Challenge public form submissions
├─ NEVER challenge API read or health endpoints
└─ Ongoing monitoring and exception management
```

#### I-08.10: Monitoring and Validation

**Pre-Deployment Validation:**

```markdown
NORMAL USER VALIDATION CHECKLIST

Desktop Browser (Chrome, Firefox, Safari, Edge):
[ ] Can access homepage without challenge
[ ] Can browse /events without challenge
[ ] Can view /display page without challenge
[ ] Can complete auth flow (/auth/login → callback)
[ ] Admin pages work after authentication

Mobile Browser (iOS Safari, Android Chrome):
[ ] Homepage loads without challenge
[ ] Events page works
[ ] Auth flow completes successfully
[ ] No "Access Denied" errors

API Integrations:
[ ] API endpoints return JSON (not challenge HTML)
[ ] No 403 responses on read endpoints
[ ] Webhooks still receiving data
```

**Ongoing Monitoring Metrics:**

| Metric              | Threshold               | Alert                |
| ------------------- | ----------------------- | -------------------- |
| Challenge rate      | < 1% of total traffic   | High if exceeded     |
| Block rate          | < 0.1% of total traffic | Critical if exceeded |
| User complaints     | 0 per day               | Investigate any      |
| Verified bot blocks | 0                       | Critical if any      |

#### I-08.11: Rollback Procedure

If bot controls cause issues:

| Severity                | Action                          | Recovery Time |
| ----------------------- | ------------------------------- | ------------- |
| **Single rule issue**   | Disable specific rule           | Immediate     |
| **SBFM causing issues** | Set all categories to "Log"     | Immediate     |
| **Widespread problems** | Disable Bot Fight Mode entirely | < 5 minutes   |

> **WARNING:** Disabling bot controls removes protection against automated attacks. Re-enable with corrections within 24 hours.

#### Checklist

| Item                     | Action                               | Reference |
| ------------------------ | ------------------------------------ | --------- |
| Identify Cloudflare plan | Document available features          | I-08.2    |
| Create skip rules        | Protected endpoints never challenged | I-08.4    |
| Create challenge rules   | Auth/admin endpoints protected       | I-08.5    |
| Configure SBFM (Pro+)    | Settings per I-08.6                  | Dashboard |
| Verified bots allowed    | Setting confirmed ON                 | I-08.8    |
| Phase 1 observation      | Minimum 7 days baseline              | I-08.9    |
| Phase 2 selective        | Auth endpoint challenges tested      | I-08.9    |
| Phase 3 production       | Full rollout with monitoring         | I-08.9    |
| Validation passed        | User checklist completed             | I-08.10   |

#### Verification Commands

```bash
# Verify health endpoint is NOT challenged
curl -sI https://yourdomain.com/healthz | grep -E "^HTTP"
# Expected: 200 (not 403 or challenge redirect)

# Verify API endpoint is NOT challenged
curl -sI https://yourdomain.com/api/v2/events | grep -E "^HTTP"
# Expected: 200 (not challenge page)

# Check Bot Fight Mode status via dashboard
# Dashboard: Security → Bots → Verify "Bot Fight Mode: ON"

# Check SBFM settings (Pro+)
# Dashboard: Security → Bots → Configure Super Bot Fight Mode
# Verify: "Verified Bots: Allow"

# Review bot events
# Dashboard: Security → Events → Filter: Service = "Bot Management"
# Check: No verified bots are being challenged
```

**Exit Gate I-08:**

```
✓ Bot Fight Mode enabled (appropriate to plan)
✓ Skip rules in place for health/monitoring/API read endpoints
✓ Verified bots setting = ALLOW (never block/challenge)
✓ Challenge rules target only auth/admin write endpoints
✓ No user complaints or false positive reports
✓ Bot analytics show expected classification distribution
✓ Known bot traffic gets challenged/filtered without breaking real users
```

> **Exit Gate Summary:** Bot controls are tuned for surgical precision — junk traffic is challenged while legitimate users, APIs, and verified bots are never impacted. You can demonstrate that health endpoints return 200 without challenge.

---

### [I-09] API Hardening (Contract Enforcement)

**Intent:** Make API behavior contractual and harder to abuse. Invalid requests are rejected at the edge before consuming origin compute.

API hardening ensures that only well-formed, authenticated requests reach your Worker code. This is a high-leverage control because:

1. **Shift-left rejection** — Malformed requests die at edge, not in your code
2. **Bandwidth savings** — Invalid payloads never consume egress
3. **Attack surface reduction** — Schema violations can't trigger backend bugs
4. **Contract enforcement** — API consumers get clear feedback on violations

#### Why I-09? (After Bot Controls)

API hardening comes after bot controls because:

1. Bot controls filter out automated abuse first
2. Remaining traffic is more likely legitimate but may still be malformed
3. Schema validation is expensive; apply it to pre-filtered traffic
4. JWT/mTLS validation assumes baseline transport security (I-02)

#### I-09.1: Plan-Aware Feature Matrix

| Feature                        | Free | Pro | Business | Enterprise |
| ------------------------------ | ---- | --- | -------- | ---------- |
| API Shield (schema validation) | ❌   | ❌  | ❌       | ✓          |
| JWT Validation (CF-native)     | ❌   | ❌  | ❌       | ✓          |
| mTLS (client certificates)     | ❌   | ❌  | ✓        | ✓          |
| Worker-based validation        | ✓    | ✓   | ✓        | ✓          |
| Custom WAF rules for API       | ✓    | ✓   | ✓        | ✓          |

> **Note:** Most features require Enterprise. For Free/Pro/Business plans, implement validation in your Worker code (see I-09.5).

#### I-09.2: API Shield / Schema Validation (Enterprise)

API Shield validates requests against an OpenAPI schema **before** they reach your Worker.

**Checklist (Enterprise only):**

| Item                      | Action                                           | Reference                                             |
| ------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| OpenAPI spec uploaded     | Upload your API schema (OpenAPI 3.0/3.1)         | Dashboard → Security → API Shield                     |
| Schema validation enabled | Enable validation for target endpoints           | Dashboard → Security → API Shield → Schema Validation |
| Action on violation       | Set to **Block** or **Log** (staging: Log first) | Dashboard → Security → API Shield                     |
| Endpoints covered         | All `/api/*` routes have schema definitions      | Your OpenAPI spec                                     |

**Schema Validation Actions:**

| Action    | Use Case                                     | Staging          | Production  |
| --------- | -------------------------------------------- | ---------------- | ----------- |
| **Log**   | Observation period, identify false positives | ✓ (Phase 1)      | Temporarily |
| **Block** | Reject non-conforming requests               | After validation | ✓           |

**Example: OpenAPI Schema Requirements**

```yaml
# Minimum schema elements for API Shield
paths:
  /api/v1/events/{eventId}:
    get:
      parameters:
        - name: eventId
          in: path
          required: true
          schema:
            type: string
            format: uuid # Enforced at edge
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/EventCreate'
              # Max properties, required fields enforced at edge
```

**Exit Gate I-09.2 (Enterprise):**

```
✓ OpenAPI schema uploaded and active
✓ Schema validation enabled for /api/* endpoints
✓ Violation action = Block (after staging observation)
✓ Dashboard shows schema validation events (confirms active)
```

#### I-09.3: JWT Validation (Enterprise or Worker-based)

JWT validation ensures that API requests carry valid, non-expired tokens.

**Enterprise (Cloudflare-native):**

| Item                | Action                                     | Reference                                          |
| ------------------- | ------------------------------------------ | -------------------------------------------------- |
| JWT validation rule | Create rule in API Shield                  | Dashboard → Security → API Shield → JWT Validation |
| JWKS endpoint       | Configure public key source                | Your IdP's `.well-known/jwks.json`                 |
| Required claims     | Enforce `iss`, `aud`, `exp` at minimum     | JWT rule configuration                             |
| Token location      | Header (`Authorization: Bearer`) or cookie | JWT rule configuration                             |

**Worker-based (All Plans):**

```javascript
// Worker JWT validation pattern (all plans)
import { verify } from '@tsndr/cloudflare-worker-jwt';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Skip JWT for public endpoints
    const publicPaths = ['/api/v1/health', '/api/v1/events'];
    if (publicPaths.some((p) => url.pathname.startsWith(p) && request.method === 'GET')) {
      return handleRequest(request, env);
    }

    // Require JWT for protected endpoints
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.slice(7);
    try {
      const isValid = await verify(token, env.JWT_SECRET);
      if (!isValid) {
        return new Response(JSON.stringify({ error: 'Invalid token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Token verification failed' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return handleRequest(request, env);
  },
};
```

**Exit Gate I-09.3:**

```
✓ JWT validation active for protected endpoints
✓ Missing/invalid tokens return 401 (not 500)
✓ Public endpoints remain accessible without token
✓ Token expiration enforced (expired tokens rejected)
```

#### I-09.4: mTLS / Client Certificates (Business+)

mTLS provides mutual authentication — the client proves identity via certificate.

**Use Cases:**

- Service-to-service authentication
- High-security API access
- Partner/vendor integrations

**Checklist (Business+):**

| Item                 | Action                                  | Reference                                 |
| -------------------- | --------------------------------------- | ----------------------------------------- |
| Client CA uploaded   | Upload CA that signs client certs       | Dashboard → SSL/TLS → Client Certificates |
| mTLS enabled         | Enable for target hostnames             | Dashboard → SSL/TLS → Client Certificates |
| Hostname association | Associate CA with specific hostnames    | Dashboard → SSL/TLS → Client Certificates |
| WAF rule             | Create rule requiring valid client cert | `cf.tls_client_auth.cert_verified = true` |

**Example WAF Rule (mTLS Enforcement):**

| Rule Name          | Expression                                                                                   | Action |
| ------------------ | -------------------------------------------------------------------------------------------- | ------ |
| `MTLS-REQUIRE-001` | `(http.request.uri.path matches "^/api/internal/") and not cf.tls_client_auth.cert_verified` | Block  |

**Exit Gate I-09.4:**

```
✓ Client CA uploaded and active
✓ mTLS enabled for internal API hostnames
✓ Requests without valid client cert return 403
✓ Valid client certs allow access
```

#### I-09.5: Worker-Based API Validation (All Plans)

For plans without API Shield, implement validation in your Worker:

**Request Validation Pattern:**

```javascript
// Worker-based request validation (all plans)
const API_SCHEMAS = {
  'POST /api/v1/events': {
    required: ['name', 'date', 'venue'],
    maxBodySize: 10240, // 10KB
    contentType: 'application/json',
  },
  'POST /api/v1/tickets': {
    required: ['eventId', 'email'],
    maxBodySize: 5120,
    contentType: 'application/json',
  },
};

async function validateRequest(request) {
  const url = new URL(request.url);
  const key = `${request.method} ${url.pathname}`;
  const schema = API_SCHEMAS[key];

  if (!schema) return { valid: true }; // No schema = allow

  // Content-Type check
  const contentType = request.headers.get('Content-Type');
  if (schema.contentType && !contentType?.includes(schema.contentType)) {
    return { valid: false, error: 'Invalid Content-Type', status: 415 };
  }

  // Body size check (before parsing)
  const contentLength = parseInt(request.headers.get('Content-Length') || '0');
  if (contentLength > schema.maxBodySize) {
    return { valid: false, error: 'Payload too large', status: 413 };
  }

  // Parse and validate body
  try {
    const body = await request.json();
    for (const field of schema.required) {
      if (!(field in body)) {
        return { valid: false, error: `Missing required field: ${field}`, status: 400 };
      }
    }
  } catch (e) {
    return { valid: false, error: 'Invalid JSON', status: 400 };
  }

  return { valid: true };
}
```

**Exit Gate I-09.5:**

```
✓ Worker validates Content-Type before processing
✓ Worker enforces body size limits
✓ Worker validates required fields
✓ Invalid requests return 4xx (not 500)
```

#### I-09.6: API Endpoint Inventory

Document all API endpoints and their validation requirements:

| Endpoint              | Method | Auth Required | Schema Validation | Rate Limit | Notes              |
| --------------------- | ------ | ------------- | ----------------- | ---------- | ------------------ |
| `/api/v1/health`      | GET    | No            | No                | 100/min    | Health check       |
| `/api/v1/events`      | GET    | No            | No                | 60/min     | Public listing     |
| `/api/v1/events`      | POST   | Yes (JWT)     | Yes               | 10/min     | Create event       |
| `/api/v1/events/{id}` | GET    | No            | Param (UUID)      | 60/min     | Event details      |
| `/api/v1/tickets`     | POST   | Yes (JWT)     | Yes               | 5/min      | Purchase ticket    |
| `/api/v1/admin/*`     | ALL    | Yes (Access)  | Yes               | 30/min     | Admin endpoints    |
| `/api/internal/*`     | ALL    | Yes (mTLS)    | Yes               | 100/min    | Service-to-service |

> **Requirement:** Maintain this inventory in your API documentation. Every endpoint must have explicit validation decisions documented.

#### I-09.7: Phased Rollout (NG-4 Compliance)

**Phase 1: Observation (7 days minimum)**

```
├─ Enable API Shield in LOG mode (Enterprise)
├─ Deploy Worker validation with logging (all plans)
├─ Collect baseline of validation failures
├─ Identify false positives (legitimate requests failing validation)
└─ Exit: < 0.1% false positive rate on known-good traffic
```

**Phase 2: Selective Enforcement (7 days minimum)**

```
├─ Enable blocking for highest-confidence rules
├─ Start with: Content-Type validation, body size limits
├─ Monitor 4xx error rates
├─ Document any client-side fixes needed
└─ Exit: Client errors are genuine violations, not false positives
```

**Phase 3: Full Enforcement**

```
├─ Enable all validation rules in Block mode
├─ Schema validation fully active
├─ JWT validation enforced
├─ mTLS required for internal APIs (if applicable)
└─ Exit: All API contract violations rejected at edge
```

#### I-09.8: Monitoring and Validation

**Dashboard Checks:**

```bash
# API Shield events (Enterprise)
# Dashboard: Security → Events → Filter: Service = "API Shield"
# Verify: Schema validation producing events

# JWT validation failures
# Dashboard: Security → Events → Filter: Action = "Block" AND Rule contains "JWT"
# Verify: Only invalid tokens blocked, no valid token rejections

# Worker validation metrics
# Dashboard: Workers → your-worker → Metrics
# Check: 4xx error rate, request latency
```

**Manual Validation Checklist:**

| Check                   | Method                                                      | Expected Result            |
| ----------------------- | ----------------------------------------------------------- | -------------------------- |
| Missing required field  | `curl -X POST /api/v1/events -d '{}'`                       | 400 Bad Request            |
| Invalid Content-Type    | `curl -X POST /api/v1/events -H "Content-Type: text/plain"` | 415 Unsupported Media Type |
| Oversized payload       | `curl -X POST /api/v1/events -d @large_file.json`           | 413 Payload Too Large      |
| Invalid JSON            | `curl -X POST /api/v1/events -d 'not json'`                 | 400 Bad Request            |
| Missing JWT (protected) | `curl /api/v1/admin/users`                                  | 401 Unauthorized           |
| Expired JWT             | `curl -H "Authorization: Bearer <expired>"`                 | 401 Unauthorized           |
| Invalid path param      | `curl /api/v1/events/not-a-uuid`                            | 400 Bad Request            |

**Exit Gate I-09:**

```
✓ API validation strategy documented (Enterprise API Shield OR Worker-based)
✓ All API endpoints have explicit validation requirements
✓ Invalid requests rejected with appropriate 4xx status codes
✓ Protected endpoints require authentication (JWT/mTLS)
✓ Validation failures logged for monitoring
✓ No valid requests incorrectly rejected (false positive rate < 0.1%)
```

> **Exit Gate Summary:** Requests that violate API contract are rejected **before origin compute**. Malformed requests return clear error messages; valid requests pass through without delay.

---

### [I-10] Observability + Change Discipline (Prove It, Don't Assume It)

> **Intent:** SRE-grade operations means you can explain "what happened" quickly. Every block, challenge, and rate limit must have a traceable reason and owner.

#### Why I-10? (After Security Rules, Before Infrastructure)

Observability comes after all active security rules (WAF, rate limiting, bots, API hardening) because:

1. **You need something to observe** — Rules I-05 through I-09 generate the security events you'll monitor
2. **Change discipline requires baselines** — Cannot establish "staging → prod" rhythm without understanding what "normal" looks like
3. **Rollback requires visibility** — Cannot confidently rollback a change if you can't see what it broke
4. **NG-4 enforcement** — Staging-first policy (Non-Negotiable #4) depends on observable differences between environments

#### I-10.1: Logging Visibility Requirements

**Dashboard Logging (All Plans):**

| Log Type          | Location            | Minimum Retention             | Purpose                                  |
| ----------------- | ------------------- | ----------------------------- | ---------------------------------------- |
| Security Events   | Security → Events   | 30 days (Pro+)                | WAF matches, bot challenges, rate limits |
| Firewall Events   | Security → Events   | 30 days (Pro+)                | Rule triggers, actions taken             |
| HTTP Requests     | Analytics → Traffic | 7 days (Free), 30 days (Pro+) | Request patterns, error rates            |
| Workers Analytics | Workers → Metrics   | 7 days                        | Worker performance, errors               |

**Enterprise Logging (If Available):**

| Log Type          | Integration           | Purpose                                |
| ----------------- | --------------------- | -------------------------------------- |
| Logpush           | S3/GCS/Splunk/Datadog | Long-term retention, correlation       |
| GraphQL Analytics | Custom queries        | Advanced aggregation, trending         |
| Audit Logs        | SIEM                  | Account-level changes, API token usage |

**Minimum Viable Observability (All Plans):**

```bash
# Security Events - Required checks after any rule change
# Dashboard: Security → Events → Filter by date range

# 1. Check WAF rule matches
# Filter: Service = "WAF" AND Action = "Block" OR "Challenge"
# Expected: See events matching your rules, not false positives

# 2. Check rate limiting triggers
# Filter: Service = "Rate Limiting" AND Action = "Block"
# Expected: Events cluster around abuse patterns, not legitimate traffic

# 3. Check bot management events
# Filter: Service = "Bot Management"
# Expected: Challenge events for suspicious bots, allow for verified bots
```

#### I-10.2: Event Attribution Requirements

Every security event must answer: **Who owns this rule and why does it exist?**

**Rule Naming Convention:**

```
[LAYER]-[ACTION]-[SCOPE]-[TICKET]
```

Examples:

- `WAF-BLOCK-ADMIN-SEC-123` — WAF rule blocking admin paths, tracked in SEC-123
- `RL-LIMIT-AUTH-SEC-456` — Rate limit on auth endpoints, tracked in SEC-456
- `BOT-CHALLENGE-SCRAPE-OPS-789` — Bot challenge for scraping, tracked in OPS-789

**Required Rule Metadata:**

| Field              | Requirement                          | Example                                           |
| ------------------ | ------------------------------------ | ------------------------------------------------- |
| Description        | Purpose + ticket reference           | "Block admin paths without Access auth (SEC-123)" |
| Expression comment | Inline explanation for complex logic | `# Match /admin/* but not /admin/public/*`        |
| Owner              | Team/person responsible              | `security-team@` or `@sre-oncall`                 |

**Rule Registry (Maintain in Version Control):**

```markdown
<!-- docs/security/RULE_REGISTRY.md -->

| Rule ID | Layer       | Action    | Scope       | Owner    | Ticket  | Last Review |
| ------- | ----------- | --------- | ----------- | -------- | ------- | ----------- |
| WAF-001 | Custom WAF  | Block     | /admin/\*   | Security | SEC-123 | 2026-01-05  |
| RL-001  | Rate Limit  | Block     | /api/auth   | SRE      | SEC-456 | 2026-01-05  |
| BOT-001 | Bot Control | Challenge | High-threat | Security | OPS-789 | 2026-01-05  |
```

#### I-10.3: Staging → Production Promotion Rhythm

**Environments (Required):**

| Environment    | Zone                     | Purpose                                |
| -------------- | ------------------------ | -------------------------------------- |
| **Staging**    | `staging.yourdomain.com` | Rule testing, false positive detection |
| **Production** | `yourdomain.com`         | Live traffic, verified rules only      |

**Promotion Workflow:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. DOCUMENT (PR opened)                                               │
│    └─ What: Rule definition + expression                             │
│    └─ Why: Threat model or incident reference                        │
│    └─ Who: Owner assigned                                            │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. STAGING DEPLOY                                                     │
│    └─ Apply rule to staging zone                                     │
│    └─ Verify: Rule appears in Security → WAF → Custom rules          │
│    └─ Test: Confirm rule triggers on expected traffic                │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. OBSERVATION PERIOD                                                 │
│    ├─ Log-only rules: 24 hours minimum                               │
│    ├─ Challenge rules: 48 hours minimum                              │
│    ├─ Block rules: 7 days minimum                                    │
│    └─ Check: Security Events → No unexpected triggers                │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. PRODUCTION DEPLOY                                                  │
│    └─ Requires: PR approval + staging verification                   │
│    └─ Apply: Identical rule to production zone                       │
│    └─ Verify: Rule active + events generating                        │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. POST-DEPLOY MONITORING                                             │
│    └─ 1 hour: Check for spike in blocks/challenges                   │
│    └─ 24 hours: Review Security Events for false positives           │
│    └─ 7 days: Confirm steady-state metrics                           │
└─────────────────────────────────────────────────────────────────────┘
```

**Prohibited:**

- ❌ Direct-to-production rule deployment without staging validation
- ❌ Skipping observation period for "urgent" changes (use Log mode first)
- ❌ Rules without ticket/owner attribution

#### I-10.4: Rollback Plans

**Every Ruleset Change Requires:**

1. **Documented rollback procedure** — How to undo this specific change
2. **Verified rollback capability** — Can you actually execute it in an incident?
3. **Rollback owner** — Who has permission and is on-call?

**Standard Rollback Procedures:**

| Change Type                    | Rollback Method                   | Time to Effect |
| ------------------------------ | --------------------------------- | -------------- |
| New WAF rule                   | Delete rule                       | Immediate      |
| Rule action change (Log→Block) | Revert action to previous         | Immediate      |
| Rate limit threshold change    | Revert threshold value            | Immediate      |
| Managed ruleset override       | Remove override                   | Immediate      |
| Bot Management toggle          | Toggle off                        | Immediate      |
| Multiple changes (batch)       | Use rule export → import previous | < 5 minutes    |

**Pre-Deployment Rollback Checklist:**

```markdown
## Rollback Plan for: [Rule/Change Name]

**Change Summary:** [What you're deploying]
**Deploy Date:** [Date]
**Owner:** [Name/Team]

### Rollback Steps:

1. [ ] Navigate to Security → WAF → Custom rules
2. [ ] Locate rule: [RULE-ID]
3. [ ] Action: [Delete / Disable / Revert to Log mode]
4. [ ] Verify: Security Events show no new triggers from this rule

### Rollback Decision Criteria:

- [ ] False positive rate > 1% of requests
- [ ] Customer complaints related to blocking
- [ ] Error rate spike in Workers metrics
- [ ] Legitimate traffic patterns affected

### Emergency Contact:

- Primary: [Name, @handle, phone]
- Secondary: [Name, @handle, phone]
```

#### I-10.5: Change Audit Trail

**Required for Compliance:**

| Event                | Capture Method                       | Retention |
| -------------------- | ------------------------------------ | --------- |
| Rule created         | Audit Log (Enterprise) OR PR history | 1 year    |
| Rule modified        | Audit Log (Enterprise) OR PR history | 1 year    |
| Rule deleted         | Audit Log (Enterprise) OR PR history | 1 year    |
| Deploy to staging    | CI/CD logs + PR merge                | 1 year    |
| Deploy to production | CI/CD logs + PR merge                | 1 year    |
| Rollback executed    | Incident ticket + audit log          | 1 year    |

**Non-Enterprise Change Tracking:**

If you don't have Enterprise Audit Logs, maintain a manual changelog:

```markdown
<!-- docs/security/CHANGE_LOG.md -->

## Security Rule Change Log

| Date       | Change   | Rule    | Action         | Owner     | Ticket  | Rollback      |
| ---------- | -------- | ------- | -------------- | --------- | ------- | ------------- |
| 2026-01-06 | Created  | WAF-001 | Block /admin   | @security | SEC-123 | Delete rule   |
| 2026-01-06 | Modified | RL-001  | 100→50 req/min | @sre      | SEC-456 | Revert to 100 |
```

#### I-10.6: Monitoring Dashboards

**Recommended Alerts (Configure in Your Monitoring System):**

| Metric              | Threshold                           | Severity | Response                   |
| ------------------- | ----------------------------------- | -------- | -------------------------- |
| WAF Block rate      | > 5% of requests (sustained 5 min)  | P2       | Investigate rules          |
| Challenge rate      | > 10% of requests (sustained 5 min) | P2       | Check bot settings         |
| Rate limit triggers | > 1000/minute (any endpoint)        | P3       | Review threshold           |
| 403 error rate      | > 2% (sustained 5 min)              | P2       | Check recent rule changes  |
| 5xx error rate      | > 1% (sustained 1 min)              | P1       | Check origin/worker health |

**Dashboard Queries (Security Events):**

```
# High-level health (check daily)
# Dashboard: Security → Overview
# Look for: Unusual spikes, new attack patterns, rule effectiveness

# Rule effectiveness (check weekly)
# Dashboard: Security → Events → Group by Rule
# Look for: Rules with zero matches (dead rules), rules with high matches (tune or confirm)

# False positive hunting (check after any rule change)
# Dashboard: Security → Events → Filter: Action = Block AND Status = 200
# Look for: Requests that were blocked but would have succeeded
```

#### I-10.7: Verification Commands

```bash
# Verify logging is capturing events
# After deploying a new rule, trigger it deliberately:

# 1. Create a test request that should match your rule
curl -v https://staging.yourdomain.com/admin/test-block \
  -H "User-Agent: TestBot/1.0"

# 2. Wait 30 seconds for event propagation

# 3. Check Security Events dashboard
# Filter: Last 5 minutes, Action = Block
# Expected: See your test request with rule attribution

# 4. Verify rule attribution shows:
#    - Rule ID (your naming convention)
#    - Action taken (Block/Challenge/Log)
#    - Ray ID for correlation
```

**Exit Gate I-10:**

```
✓ Security Events accessible and showing rule matches
✓ All custom rules follow naming convention with owner + ticket reference
✓ Staging environment exists and is used for rule testing
✓ Observation periods defined and enforced (24h/48h/7d by action type)
✓ Rollback plan documented for every active rule
✓ Change log maintained (Enterprise Audit Log OR manual changelog)
✓ Monitoring alerts configured for block rate, challenge rate, error rate
```

> **Exit Gate Summary:** Every block, challenge, and rate limit has a traceable reason, an owner, and a documented rollback procedure. You can explain "what happened" to any security event within 5 minutes.

---

### [I-11] Registrar & DNSSEC (Domain Protection)

**Intent:** Prevent domain hijacking and DNS spoofing at the registrar/resolver level.

#### Checklist

| Item            | Action                                               | Reference                                           |
| --------------- | ---------------------------------------------------- | --------------------------------------------------- |
| Registrar lock  | Domain lock enabled at registrar                     | [SEC-2.1](../RUNBOOK-SEC-2.1-REGISTRAR-LOCK-MFA.md) |
| Registrar MFA   | Registrar account has MFA enabled                    | [SEC-2.1](../RUNBOOK-SEC-2.1-REGISTRAR-LOCK-MFA.md) |
| DNSSEC enabled  | DNSSEC active in Cloudflare + DS record at registrar | [DNSSEC_RUNBOOK.md](./DNSSEC_RUNBOOK.md)            |
| DNSSEC verified | `dig +dnssec yourdomain.com` shows RRSIG records     | Verification command                                |

**Exit Gate I-11:**

```
DNSSEC chain validates end-to-end.
Verify: https://dnssec-analyzer.verisignlabs.com/yourdomain.com shows all green
```

> **Note:** Canonical host enforcement (www→apex redirect) is now covered in **I-03: Request Normalization**.

---

### [I-12] Worker Route Configuration (NS-4)

**Intent:** Single Worker route handles all traffic; no route sprawl or gaps.

#### Checklist

| Item             | Action                                         | Reference                                            |
| ---------------- | ---------------------------------------------- | ---------------------------------------------------- |
| Single route     | One Worker route: `*yourdomain.com/*`          | [SEC-4.2](../RUNBOOK-SEC-4.2-SINGLE-WORKER-ROUTE.md) |
| No orphan routes | Audit and remove legacy/unused routes          | Dashboard → Workers → Routes                         |
| Route priority   | Understand route matching (most specific wins) | CF Docs                                              |

**Exit Gate I-12:**

```
Single Worker route covers all traffic.
Verify: Dashboard shows exactly one active route matching "*domain.com/*"
```

---

### [I-13] Cloudflare Access (Identity Layer)

**Intent:** Protect privileged routes with identity verification before they reach the Worker.

#### Checklist

| Item               | Action                                     | Reference                                                            |
| ------------------ | ------------------------------------------ | -------------------------------------------------------------------- |
| Access application | Create Access app for privileged paths     | [CLOUDFLARE_ACCESS_PRIVILEGED.md](./CLOUDFLARE_ACCESS_PRIVILEGED.md) |
| Identity provider  | Configure IdP (Google, GitHub, OIDC, etc.) | Dashboard → Access → Login Methods                                   |
| Policy rules       | Allow/Block/Bypass policies defined        | Dashboard → Access → Applications                                    |
| Service tokens     | Create for CI/automation (if needed)       | Dashboard → Access → Service Auth                                    |

**Protected Paths (Minimum):**

```
/admin/*          — Admin dashboard
/api/admin/*      — Admin API endpoints
/api/internal/*   — Internal service endpoints
/healthz          — Health check (Bypass for monitoring)
```

**Exit Gate I-13:**

```
Privileged paths require authentication before Worker execution.
Verify (NS-2): curl https://yourdomain.com/admin/ returns 302 → Access login
```

---

### [I-14] Origin Bypass Prevention (NS-3/NS-5)

**Intent:** Ensure origin is never directly accessible; all traffic must traverse Cloudflare.

#### Checklist

| Item                | Action                                             | Reference                                                    |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| No public origin IP | Origin has no DNS A record pointing to it          | Worker-only architecture                                     |
| Origin auth         | If origin exists, require CF-connecting-IP or mTLS | [ORIGIN_BYPASS_PREVENTION.md](./ORIGIN_BYPASS_PREVENTION.md) |
| Firewall rules      | Origin firewall allows only Cloudflare IP ranges   | CF IP ranges                                                 |

**Exit Gate I-14:**

```
Origin is unreachable without traversing Cloudflare.
Verify: Direct origin IP access fails or returns 403
```

---

## Parts 2–5 — split for single-concern loading

To keep this baseline focused on the implementation sequence, the remaining parts were extracted into concern-scoped files (COST-402 / OSE-784). The full evaluation→verification flow is preserved; load only what you need:

- **Part 2 — Request Evaluation Order** → [cf-zone/request-evaluation-order.md](./cf-zone/request-evaluation-order.md) — how Cloudflare evaluates an incoming request through the security stack (R-00…R-11).
- **Parts 3–5 — Practical Implications, Verification & Compliance** → [cf-zone/verification-and-compliance.md](./cf-zone/verification-and-compliance.md) — practical implications, verification commands, and the compliance matrix.

---

## Document History

| Version | Date       | Author            | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ---------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-01-05 | Security/SRE Lead | Initial baseline document                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 1.1     | 2026-01-05 | Security/SRE Lead | Reordered implementation sequence: TLS & Transport (I-02) now precedes DNSSEC (I-03); combined TLS+HSTS into unified I-02 section; added staging-first workflow details                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1.2     | 2026-01-05 | Security/SRE Lead | Added I-03 Request Normalization (routing + canonicalization); moved DNSSEC to I-04; consolidated canonical host enforcement into I-03; updated compliance matrix                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1.3     | 2026-01-05 | Security/SRE Lead | Added I-04 Config/Origin Rules (behavior knobs); covers Configuration Rules, Origin Rules, security header injection, path-based routing documentation; renumbered I-05 through I-11; updated all cross-references                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 1.4     | 2026-01-06 | Security/SRE Lead | Added I-05 WAF Managed Rules (baseline coverage); covers Cloudflare Managed Ruleset, OWASP CRS, Leaked Credentials Check, staging-first deployment workflow, false positive handling; renamed I-08 to I-09 WAF Custom Rules; renumbered I-05→I-06 through I-11→I-12; added NS-6 to compliance matrix                                                                                                                                                                                                                                                                                                                                      |
| 1.5     | 2026-01-06 | Security/SRE Lead | Added I-06 Custom WAF Rules (application-specific policy); covers admin/auth/api/internal path protection, rule priority ordering, standard templates, IP lists, rule documentation requirements, custom rule registry, staging-first deployment; removed redundant old I-09; renumbered I-06→I-07 through I-08→I-09; added NG-3 to compliance matrix; updated health check script to 23 checks                                                                                                                                                                                                                                           |
| 1.6     | 2026-01-06 | Security/SRE Lead | Added I-07 Rate Limiting (abuse + cost control); covers endpoint categories (auth, token, search/RAG, AI/LLM), standard rate limit configuration, advanced techniques (per-user, tiered, burst protection), exemptions, rate limit registry, load testing verification; removed old minimal I-10 Rate Limiting section; renumbered I-07→I-08 DNSSEC through I-12; updated compliance matrix; updated health check script to 24 checks                                                                                                                                                                                                     |
| 1.7     | 2026-01-06 | Security/SRE Lead | Added I-08 Bot Controls (automation pressure relief); covers plan-aware feature matrix, bot classification categories, endpoints to never challenge (health/monitoring/API read/static), endpoints where challenges are appropriate (auth/admin write), Super Bot Fight Mode configuration, custom bot rules (Business+), verified bot handling, phased rollout (observe→selective→expanded), monitoring/validation checklists, rollback procedure; removed redundant I-11 Bot Management section; renumbered I-08→I-09 DNSSEC through I-11→I-12 Origin Bypass; added NS-7 to compliance matrix; updated health check script to 27 checks |
| 1.8     | 2026-01-06 | Security/SRE Lead | Added I-09 API Hardening (contract enforcement, high leverage); covers plan-aware feature matrix (API Shield, JWT validation, mTLS), schema validation via API Shield (Enterprise) or Worker-based validation (all plans), JWT validation patterns, mTLS for internal APIs, Worker-based request validation code examples, API endpoint inventory template, phased rollout (observe→selective→full enforcement), monitoring/validation checklists; renumbered I-09→I-10 Registrar & DNSSEC through I-12→I-13 Origin Bypass; added NS-8 to compliance matrix; updated health check script to 30 checks                                     |
| 1.9     | 2026-01-06 | Security/SRE Lead | Added I-10 Observability + Change Discipline (prove it, don't assume it); covers logging visibility requirements (dashboard + Enterprise Logpush), event attribution (rule naming convention, rule registry), staging→production promotion workflow with observation periods (24h/48h/7d by action type), rollback plans template, change audit trail, monitoring dashboards and alerts; renumbered I-10→I-11 Registrar & DNSSEC through I-13→I-14 Origin Bypass; added NS-9 (Observability) and NG-4 (Staging First) to compliance matrix; updated health check script to 33 checks                                                      |
| 1.10    | 2026-01-06 | Security/SRE Lead | Added [R-ORDER] Request Execution Order Quick Reference in Part 2; provides memorizable high-level phase flow (API Gateway Early → Custom WAF → Rate Limiting → API Gateway Late → Managed WAF → Bot Mitigation → Cache → Origin/Worker), rule-of-thumb mapping for layer selection, acceptance criteria (ordering correctness, determinism, reliability alignment), minimal validation checklist with automated sanity script, phase→implementation section mapping                                                                                                                                                                      |

---

## Related Documents

- [SEC-10.1: Security Regression Gate](../../scripts/security/security_regression.sh)
- [SEC-10.2: Settings as Code Plan](./SETTINGS_AS_CODE_PLAN.md)
- [Security Baseline (North Star)](./SECURITY_BASELINE.md)
- [WAF Baseline](./WAF_BASELINE.md)
- [Rate Limiting Spec](./RATE_LIMITING_SPEC.md)
- [Cloudflare Access Privileged](./CLOUDFLARE_ACCESS_PRIVILEGED.md)
- [Origin Bypass Prevention](./ORIGIN_BYPASS_PREVENTION.md)

**Split sub-documents (COST-402 / OSE-784):**

- [Part 2 — Request Evaluation Order](./cf-zone/request-evaluation-order.md)
- [Parts 3–5 — Practical Implications, Verification & Compliance](./cf-zone/verification-and-compliance.md)
