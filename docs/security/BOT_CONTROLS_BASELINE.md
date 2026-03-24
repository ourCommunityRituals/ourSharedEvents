# BOT_CONTROLS_BASELINE.md — Bot Controls Baseline

> **PROMPTSPEC-SEC-6.3** — Bot Controls Baseline
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Reduce bot noise and automated abuse without inadvertently blocking legitimate users (self-DoS). This document defines a measured, plan-aware approach to bot mitigation that prioritizes user experience while maintaining security.

| Attribute | Value |
|-----------|-------|
| **Scope** | Cloudflare Bot Management configuration for all production and staging domains |
| **Prerequisites** | Security Baseline (SEC-0.1), WAF Baseline (SEC-6.1), Rate Limiting Spec (SEC-6.2) |
| **Constraints** | Worker-only architecture; bot controls operate at Cloudflare edge before Worker |

---

## 2. Critical Warning: Avoid Self-DoS

> **CRITICAL WARNING: DO NOT CHALLENGE EVERYTHING**
>
> Overly aggressive bot controls are a common cause of self-inflicted denial of service. Challenging or blocking all automated traffic will:
>
> - Block legitimate monitoring systems (uptime, APM, synthetic tests)
> - Break API integrations and webhooks
> - Frustrate mobile app users (apps often appear as bots)
> - Block search engine crawlers (SEO damage)
> - Prevent accessibility tools from functioning
> - Block legitimate preview generators (Slack, Twitter, Facebook)
> - Interfere with CI/CD pipelines and deployment tools
>
> **The goal is surgical precision, not blanket blocking.**

### 2.1 Self-DoS Symptoms

| Symptom | Likely Cause | Resolution |
|---------|--------------|------------|
| Users report "Access Denied" on mobile | Mobile SDK detection false positive | Whitelist mobile user agents or reduce challenge |
| Search rankings drop | Crawlers blocked | Verify SEO bots are not challenged |
| Slack/Twitter previews broken | Link unfurlers blocked | Whitelist known preview bots |
| Monitoring alerts fire false positives | Synthetic monitors blocked | Add monitoring IPs to allowlist |
| API integrations failing | Automated clients challenged | Use API-specific bypass rules |
| Pages load slowly | Excessive challenges on every request | Reduce challenge scope |

### 2.2 Principle: Challenge Judiciously

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     BOT CONTROL DECISION PYRAMID                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                        ┌─────────────┐                                       │
│                        │   BLOCK     │  ← Only confirmed malicious bots      │
│                        │   (rare)    │    (credential stuffing, DDoS)        │
│                        └──────┬──────┘                                       │
│                    ┌──────────┴──────────┐                                   │
│                    │     CHALLENGE       │  ← Suspicious automated traffic   │
│                    │   (selective)       │    on sensitive endpoints          │
│                    └──────────┬──────────┘                                   │
│               ┌───────────────┴───────────────┐                              │
│               │           LOG                 │  ← Monitor before acting     │
│               │        (observe)              │    Understand traffic first   │
│               └───────────────┬───────────────┘                              │
│          ┌────────────────────┴────────────────────┐                         │
│          │              ALLOW                       │  ← Most traffic         │
│          │           (default)                      │    Verified + unknown   │
│          └──────────────────────────────────────────┘                        │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. North Star Compliance

### 3.1 NS-1: Edge-First Security

> **NS-1:** Every public request hits Cloudflare first

Bot controls operate at the Cloudflare edge, providing automated traffic filtering before requests reach the Worker:

| Layer | Protection | Implementation |
|-------|------------|----------------|
| **Edge (Bot Management)** | Identify and classify bots | Bot Fight Mode, Super Bot Fight Mode (this spec) |
| **Edge (WAF)** | Block attack patterns | Managed rulesets (SEC-6.1) |
| **Edge (Rate Limiting)** | Prevent abuse/DoS | Rate limiting rules (SEC-6.2) |
| **Worker (Guards)** | Application-level auth | `guardAdminOAuth()`, etc. |

### 3.2 Defense Layering

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         REQUEST FLOW                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Internet → CF Edge → Bot Check → Rate Limit → WAF → Worker → Response      │
│                          │                                                   │
│                          ├─ VERIFIED: Known good bot (Googlebot, etc.)       │
│                          ├─ LIKELY HUMAN: Pass through                       │
│                          ├─ LIKELY BOT: Challenge (if configured)            │
│                          ├─ AUTOMATED: Allow or challenge based on rules     │
│                          └─ DEFINITELY BOT: Block (if configured)            │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Cloudflare Bot Classification

### 4.1 Bot Score Categories

Cloudflare assigns a bot score (1-99) to each request:

| Score Range | Classification | Description | Default Action |
|-------------|----------------|-------------|----------------|
| **1-29** | Likely Bot | High confidence automated traffic | Challenge or Block |
| **30-49** | Likely Automated | Suspicious but uncertain | Log only |
| **50-79** | Uncertain | Could be human or bot | Allow |
| **80-99** | Likely Human | High confidence human traffic | Allow |

### 4.2 Verified Bot Categories

Cloudflare maintains a list of verified bots that should generally be allowed:

| Category | Examples | Recommended Action |
|----------|----------|-------------------|
| **Search Engines** | Googlebot, Bingbot, DuckDuckBot | **ALLOW** (critical for SEO) |
| **Social Media** | Facebook, Twitter, LinkedIn crawlers | **ALLOW** (link previews) |
| **Monitoring** | Pingdom, UptimeRobot, Datadog | **ALLOW** (operational visibility) |
| **Academic** | Internet Archive, research crawlers | **ALLOW** (typically benign) |
| **Aggregators** | Feedly, other RSS readers | **ALLOW** (user-initiated) |

> **IMPORTANT:** Never block verified bots unless you have a specific, documented reason.

---

## 5. Plan-Aware Bot Features

### 5.1 Current Plan Capabilities

Bot control features depend on your Cloudflare plan:

| Feature | Free | Pro | Business | Enterprise |
|---------|------|-----|----------|------------|
| **Bot Fight Mode** | Basic | Enhanced | Enhanced | Enhanced |
| **Super Bot Fight Mode** | No | **Yes** | **Yes** | **Yes** |
| **Bot Score** (in rules) | No | No | **Yes** | **Yes** |
| **Bot Analytics** | Basic | Basic | **Yes** | **Yes** |
| **Custom Bot Rules** | No | No | Limited | **Full** |
| **Verified Bots List** | Read-only | Read-only | Read-only | Customizable |
| **Bot Management** | No | No | No | **Yes** |

### 5.2 Recommended Configuration by Plan

#### Free Plan

| Setting | Value | Rationale |
|---------|-------|-----------|
| **Bot Fight Mode** | ON (Managed Challenge) | Basic protection, minimal configuration |
| **Security Level** | Medium | Balance protection vs false positives |
| **Challenge Passage** | 30 minutes | Reduce repeat challenges for real users |

#### Pro Plan

| Setting | Value | Rationale |
|---------|-------|-----------|
| **Bot Fight Mode** | ON | Basic bot protection |
| **Super Bot Fight Mode** | ON (Configure carefully) | See Section 6 |
| **JavaScript Detection** | Challenge suspicious requests | Detect headless browsers |
| **Challenge Passage** | 30 minutes | User experience |

#### Business Plan (Recommended)

| Setting | Value | Rationale |
|---------|-------|-----------|
| **Bot Fight Mode** | ON | Baseline protection |
| **Super Bot Fight Mode** | ON with exclusions | Granular control |
| **Custom Rules with Bot Score** | Enabled | Surgical precision |
| **Bot Analytics** | Enabled | Understand traffic patterns |

#### Enterprise Plan

| Setting | Value | Rationale |
|---------|-------|-----------|
| **Bot Management** | Enabled | Full ML-based detection |
| **Custom Bot Categories** | Configured | Tailored to application needs |
| **Bot Score in WAF** | Enabled | Integrated protection |
| **Real-time Analytics** | Enabled | Immediate visibility |

### 5.3 Plan Unknown Placeholders

If your Cloudflare plan is unknown, start with these conservative defaults:

```yaml
# Conservative defaults - adjust based on actual plan
bot_fight_mode: "ON"
super_bot_fight_mode: "CHECK_PLAN"  # Only available Pro+
bot_score_rules: "CHECK_PLAN"       # Only available Business+
verified_bot_bypass: true           # Always allow verified bots
challenge_action: "managed_challenge"  # Prefer challenge over block
challenge_passage: "30m"            # 30-minute session after passing
```

---

## 6. Where to Challenge vs Where NOT to Challenge

### 6.1 Challenge Decision Matrix

> **CRITICAL: This matrix prevents self-DoS by explicitly defining what NOT to challenge.**

| Endpoint Type | Challenge Bots? | Rationale |
|---------------|-----------------|-----------|
| **Public Pages** (`/`, `/events`, `/schedule`) | **SELECTIVE** | Only challenge clearly suspicious traffic |
| **Display Surfaces** (`/display`, `/tv`, `/kiosk`) | **NO** | Digital signage uses automated clients |
| **API Read Endpoints** (`/api/v2/events`) | **NO** | Breaks legitimate integrations |
| **API Write Endpoints** (`/api/v2/admin/*`) | **YES** | High-value target, auth protected anyway |
| **Auth Endpoints** (`/auth/*`) | **YES** | Credential stuffing prevention |
| **Health Endpoints** (`/api/status`, `/health/*`) | **NO** | Breaks monitoring systems |
| **Static Assets** (`/web/shared/*.js`) | **NO** | Performance impact, caching issues |
| **Error Reporting** (`/jserror`) | **SELECTIVE** | Rate limit instead |

### 6.2 Endpoints to NEVER Challenge

> **EXPLICITLY PROHIBITED: Challenging these endpoints will cause self-DoS.**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     NEVER CHALLENGE THESE ENDPOINTS                           │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Health & Monitoring:                                                        │
│  - /api/status                (uptime monitors)                              │
│  - /api/health/backend        (synthetic tests)                              │
│  - /health/origin             (infrastructure checks)                        │
│                                                                              │
│  Display Surfaces:                                                           │
│  - /display, /tv, /kiosk, /screen  (digital signage - no human present)     │
│                                                                              │
│  API Endpoints:                                                              │
│  - /api/v2/events             (third-party integrations)                     │
│  - /api/events/:id/*Bundle    (client applications)                          │
│                                                                              │
│  Static Assets:                                                              │
│  - /web/shared/*.js           (cached by CDN)                                │
│  - All static file extensions (.css, .js, .png, .jpg, .svg, .woff2)          │
│                                                                              │
│  CI/CD:                                                                      │
│  - /api/v2/monetization/inert (deployment gates)                             │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Endpoints Where Challenges Are Appropriate

| Endpoint Category | Challenge Type | Trigger Condition |
|-------------------|----------------|-------------------|
| **Auth Endpoints** | Managed Challenge | Bot score < 30 |
| **Admin API (write)** | JS Challenge | All non-verified bots |
| **Public Pages** | Managed Challenge | Bot score < 20 (very suspicious only) |
| **Forms/Submissions** | Managed Challenge | Bot score < 30 |

### 6.4 Implementation Rules

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     SUPER BOT FIGHT MODE CONFIGURATION                        │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Definitely Automated: Challenge (NOT Block)                                 │
│  ├─ Why not block? Some legitimate tools appear definitely automated        │
│  └─ Challenge allows real users through, blocks only actual bots             │
│                                                                              │
│  Likely Automated: Log only (initially)                                      │
│  ├─ High false-positive rate in this category                               │
│  └─ Move to challenge only after analyzing traffic patterns                 │
│                                                                              │
│  Verified Bots: ALWAYS Allow                                                 │
│  ├─ Search engines (Googlebot, Bingbot)                                     │
│  ├─ Social media (Facebook, Twitter, LinkedIn)                              │
│  └─ Monitoring services (verified by Cloudflare)                            │
│                                                                              │
│  Static Resources: NEVER Challenge                                           │
│  ├─ Performance penalty too high                                            │
│  ├─ CDN caching breaks                                                      │
│  └─ No security benefit (read-only, public)                                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Implementation Plan

### 7.1 Phased Rollout Strategy

> **CRITICAL:** Never enable blocking without an observation period. Bot controls have high false-positive potential.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      BOT CONTROL ROLLOUT PHASES                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Phase 1: OBSERVE ONLY (Minimum 7 days)                                     │
│  ├─ Enable Bot Analytics (if available on plan)                             │
│  ├─ Log all bot classifications                                             │
│  ├─ Identify baseline traffic patterns                                      │
│  ├─ Document verified bots that access your site                            │
│  └─ DO NOT enable any challenges or blocks                                  │
│                                                                             │
│  Phase 2: SELECTIVE CHALLENGES (Minimum 7 days)                             │
│  ├─ Enable Bot Fight Mode (basic)                                           │
│  ├─ Challenge auth endpoints only                                           │
│  ├─ Keep verified bot bypass ON                                             │
│  ├─ Monitor for user complaints                                             │
│  └─ Create bypass rules for false positives                                 │
│                                                                             │
│  Phase 3: EXPANDED PROTECTION (Production)                                  │
│  ├─ Enable Super Bot Fight Mode (if available)                              │
│  ├─ Challenge admin write endpoints                                         │
│  ├─ Challenge public forms/submissions                                      │
│  ├─ NEVER challenge API read or health endpoints                            │
│  └─ Ongoing monitoring and exception management                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Phase 1: Observation Mode

**Objective:** Understand your traffic before making changes.

| Task | Location | Duration |
|------|----------|----------|
| Review Bot Analytics | Security > Bots | 7+ days |
| Export bot classifications | Security > Analytics | End of phase |
| Document regular bot visitors | This document | Before Phase 2 |
| Identify high-value endpoints | Route Classification | Before Phase 2 |

**Key Metrics to Collect:**

```
PHASE 1 OBSERVATION CHECKLIST

Traffic Distribution:
[ ] What % of traffic is "Verified Bots"?
[ ] What % of traffic is "Likely Automated"?
[ ] What % of traffic is "Likely Human"?

Bot Types Observed:
[ ] List all verified bots accessing the site
[ ] Identify any monitoring systems in traffic
[ ] Note any API integrations appearing as bots

Baseline Metrics:
[ ] Total requests per day
[ ] Requests per endpoint category
[ ] Geographic distribution of bot traffic

Date: _______________
Collected by: _______________
```

### 7.3 Phase 2: Selective Challenges

**Objective:** Protect high-risk endpoints without impacting users.

| Setting | Value | Location |
|---------|-------|----------|
| **Bot Fight Mode** | ON | Security > Bots |
| **Challenge Auth Endpoints** | Managed Challenge | WAF Custom Rule |
| **Verified Bot Bypass** | ON | Super Bot Fight Mode settings |

**WAF Custom Rule for Auth Challenges:**

```
Rule Name: Challenge Bots on Auth Endpoints
Priority: 10

Expression:
  (http.request.uri.path starts_with "/auth/") and
  (not cf.client.bot) and
  (cf.bot_management.score lt 30)

Action: Managed Challenge
```

### 7.4 Phase 3: Expanded Protection

**Objective:** Full bot protection with documented exceptions.

| Endpoint Category | Action | Rule |
|-------------------|--------|------|
| Auth endpoints | Challenge (score < 30) | Rule 1 |
| Admin write endpoints | Challenge (non-verified bots) | Rule 2 |
| Public forms | Challenge (score < 30) | Rule 3 |
| Health endpoints | Allow all | Skip rule |
| API read endpoints | Allow all | Skip rule |
| Static assets | Allow all | Skip rule |

---

## 8. Custom Rules by Plan

### 8.1 Pro Plan (Super Bot Fight Mode)

Navigate to: Security > Bots > Configure Super Bot Fight Mode

| Setting | Recommended Value |
|---------|-------------------|
| **Definitely Automated** | Managed Challenge |
| **Likely Automated** | Log (do NOT challenge) |
| **Verified Bots** | Allow |
| **Static Resource Protection** | OFF |
| **JavaScript Detection** | ON (for auth endpoints only) |

### 8.2 Business Plan (Bot Score Rules)

Create WAF Custom Rules using bot score:

**Rule 1: Challenge Suspicious Bots on Sensitive Endpoints**
```
Expression:
  (cf.bot_management.score lt 30) and
  (
    (http.request.uri.path starts_with "/auth/") or
    (http.request.uri.path contains "/admin/" and http.request.method ne "GET")
  ) and
  (not cf.bot_management.verified_bot)

Action: Managed Challenge
```

**Rule 2: Skip Bot Checks for Protected Endpoints**
```
Expression:
  (http.request.uri.path eq "/api/status") or
  (http.request.uri.path starts_with "/health/") or
  (http.request.uri.path starts_with "/api/v2/events") or
  (http.request.uri.path matches "\\.(css|js|png|jpg|svg|woff2)$")

Action: Skip (all bot checks)
```

### 8.3 Enterprise Plan (Full Bot Management)

| Feature | Configuration |
|---------|---------------|
| **Bot Categories** | Custom categories for your use case |
| **Machine Learning** | Enable anomaly detection |
| **Bot Score Thresholds** | Tune based on observed traffic |
| **Real-time Dashboard** | Monitor bot trends |

---

## 9. Validation Steps for Normal Users

### 9.1 Pre-Deployment Validation

Before enabling any bot controls, verify these user scenarios work:

```
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

Mobile Apps (if applicable):
[ ] API endpoints return data (not challenge HTML)
[ ] No 403 responses on read endpoints
[ ] Auth flows work

Accessibility Tools:
[ ] Screen readers can access content
[ ] Keyboard navigation works
[ ] No CAPTCHA required for basic browsing

Date: _______________
Tested by: _______________
```

### 9.2 Post-Deployment Validation

After each phase, verify no regression:

```
POST-DEPLOYMENT VALIDATION (Run after each phase)

User Experience:
[ ] No user complaints about blocked access
[ ] No reports of repeated challenges
[ ] Mobile users not seeing challenges on public pages
[ ] Social media previews still work (check Slack, Twitter)

Monitoring Systems:
[ ] Uptime monitors still receiving 200 responses
[ ] APM tools (if any) still collecting data
[ ] Synthetic tests passing

Search & Crawlers:
[ ] Google Search Console shows no crawl errors
[ ] Bing Webmaster Tools shows no access issues
[ ] Site still appears in search results

API Integrations:
[ ] All known integrations still working
[ ] No 403 responses in API logs
[ ] Webhooks (if any) still receiving data

Date: _______________
Validated by: _______________
```

### 9.3 Ongoing Monitoring

| Metric | Threshold | Alert |
|--------|-----------|-------|
| Challenge rate | < 1% of total traffic | High if exceeded |
| Block rate | < 0.1% of total traffic | Critical if exceeded |
| User complaints | 0 per day | Investigate any |
| Verified bot blocks | 0 | Critical if any |

---

## 10. Bypass Rules for Known-Good Traffic

### 10.1 Monitoring System Bypass

If your monitoring system is being challenged, create a bypass:

```
Rule Name: Skip Bot Checks for Monitoring
Priority: 1 (evaluated first)

Expression:
  (ip.src in {MONITORING_IP_RANGE}) or
  (http.user_agent contains "UptimeRobot") or
  (http.user_agent contains "Pingdom") or
  (http.user_agent contains "Datadog")

Action: Skip (all bot checks)
```

### 10.2 Known Integration Bypass

For API integrations that appear as bots:

```
Rule Name: Skip Bot Checks for Known Integrations
Priority: 2

Expression:
  (http.request.uri.path starts_with "/api/") and
  (
    (http.request.headers["x-api-key"] exists) or
    (ip.src in {KNOWN_INTEGRATION_IPS})
  )

Action: Skip (bot challenges)
```

### 10.3 Exception Registry

| ID | Bypass Type | Target | Reason | Added | Expires |
|----|-------------|--------|--------|-------|---------|
| BOT-EX-001 | IP Allow | (monitoring IP) | Uptime monitoring | (date) | Permanent |
| BOT-EX-002 | User Agent | "IntegrationBot/1.0" | Partner integration | (date) | Review annually |

---

## 11. Failure Modes and Rollback

### 11.1 Signs of Excessive Bot Protection

| Symptom | Cause | Immediate Action |
|---------|-------|------------------|
| Users reporting challenges | False positives | Reduce challenge scope |
| Mobile app failures | App traffic classified as bot | Create app bypass rule |
| API integration errors | Automated clients challenged | Whitelist integration |
| SEO traffic drop | Crawlers blocked | Verify verified bot settings |
| Monitoring alerts | Synthetic tests blocked | Add monitoring bypass |

### 11.2 Emergency Rollback Procedure

If bot controls are causing widespread issues:

**Option A: Disable Specific Rules**
| Step | Action |
|------|--------|
| 1 | Security > WAF > Custom rules |
| 2 | Disable offending rule |
| 3 | Monitor for resolution |

**Option B: Disable Bot Fight Mode**
| Step | Action |
|------|--------|
| 1 | Security > Bots |
| 2 | Toggle "Bot Fight Mode" OFF |
| 3 | Document reason for disable |
| 4 | Re-enable with corrections within 24 hours |

**Option C: Full Disable (Last Resort)**
| Step | Action |
|------|--------|
| 1 | Security > Bots > All bot features OFF |
| 2 | Security > WAF > Disable all bot-related custom rules |
| 3 | Investigate root cause |
| 4 | Re-enable with corrections |

> **WARNING:** Disabling all bot controls removes protection against automated attacks. Re-enable within 24 hours.

---

## 12. UI Execution Checklist

### 12.1 Phase 1 Deployment (Observation)

```
DOMAIN: _______________________  DATE: ___________

PHASE 1: OBSERVATION MODE

[ ] 1. Navigate to Security > Bots
[ ] 2. Review current Bot Fight Mode status
[ ] 3. Navigate to Security > Analytics
[ ] 4. Note baseline metrics:
      - Daily requests: _______________
      - Bot traffic %: _______________
      - Verified bot %: _______________
[ ] 5. Set calendar reminder for Phase 2 (+7 days)
[ ] 6. Create monitoring dashboard (if Business+)
[ ] 7. Document observed bot traffic patterns

Observed by: _______________  Date: _______________
```

### 12.2 Phase 2 Deployment (Selective Challenges)

```
DOMAIN: _______________________  DATE: ___________

PHASE 2: SELECTIVE CHALLENGES

Pre-Deployment:
[ ] Phase 1 ran for minimum 7 days
[ ] Baseline metrics documented
[ ] Known bots identified and documented
[ ] Bypass rules prepared for known integrations

Deployment:
[ ] Enable Bot Fight Mode (if not already)
      Security > Bots > Bot Fight Mode: ON
[ ] Create WAF rule for auth endpoint challenges
      Security > WAF > Custom Rules > Create
[ ] Verify "Verified Bots: Allow" is enabled
      Security > Bots > Configure
[ ] Test: Can access /auth/login without challenge (from clean browser)

Post-Deployment:
[ ] Monitor Security > Analytics for challenge events
[ ] Check for user complaints (support channels)
[ ] Verify monitoring systems still working
[ ] Set calendar reminder for Phase 3 (+7 days)

Deployed by: _______________  Date: _______________
```

### 12.3 Phase 3 Deployment (Expanded Protection)

```
DOMAIN: _______________________  DATE: ___________

PHASE 3: EXPANDED PROTECTION

Pre-Deployment:
[ ] Phase 2 ran for minimum 7 days
[ ] No user complaints during Phase 2
[ ] Bypass rules tested and working

Deployment:
[ ] Enable Super Bot Fight Mode (if available)
      Security > Bots > Configure Super Bot Fight Mode
      [ ] Definitely Automated: Managed Challenge
      [ ] Likely Automated: Log only
      [ ] Verified Bots: Allow
      [ ] Static Resources: OFF
[ ] Create admin endpoint challenge rule
[ ] Create health endpoint skip rule
[ ] Test all user validation scenarios (Section 9)

Post-Deployment:
[ ] Document final configuration
[ ] Update this spec with "PRODUCTION" status
[ ] Set quarterly review reminder

Completed by: _______________  Date: _______________
```

---

## 13. Acceptance Criteria

### 13.1 Primary Acceptance Criteria

| ID | Criterion | Verification | Status |
|----|-----------|--------------|--------|
| **AC-1** | Document explicitly warns against challenging everything | Section 2 exists | |
| **AC-2** | Health endpoints are NEVER challenged | Skip rules in place | |
| **AC-3** | API read endpoints are NEVER challenged | Skip rules in place | |
| **AC-4** | Verified bots are ALWAYS allowed | Verified bot setting ON | |
| **AC-5** | Challenge scope is selective, not blanket | Rules target specific endpoints | |
| **AC-6** | Rollback procedure is documented | Section 11 exists | |

### 13.2 User Experience Acceptance Criteria

| ID | Criterion | Verification | Status |
|----|-----------|--------------|--------|
| **UX-1** | Normal users can browse without challenges | Manual test | |
| **UX-2** | Mobile users are not challenged on public pages | Mobile test | |
| **UX-3** | Social media previews work | Test Slack/Twitter links | |
| **UX-4** | Monitoring systems receive 200 responses | Check monitoring dashboard | |
| **UX-5** | API integrations function normally | Check API logs | |

### 13.3 Prohibited Configuration Audit

```
PROHIBITED CONFIGURATION AUDIT

Date: _______________
Auditor: _______________

Check for prohibited patterns:
[ ] Bot Fight Mode is NOT set to "Block all automated traffic"
    How to verify: Security > Bots shows "Challenge" not "Block"

[ ] Health endpoints have skip rules
    How to verify: /api/status returns 200, not challenge

[ ] API endpoints are not blanket-challenged
    How to verify: /api/v2/events returns JSON, not challenge HTML

[ ] Verified bots are allowed
    How to verify: Security > Bots shows "Allow verified bots"

[ ] No rules challenge static assets
    How to verify: .js/.css files load without challenge

[ ] Challenge rate is below 1%
    How to verify: Security > Analytics

Audit Result: PASS / FAIL
If FAIL, document violations: _______________

Audited by: _______________  Date: _______________
```

---

## 14. Related Documents

| Document | Path | Relationship |
|----------|------|--------------|
| Security Baseline | `docs/security/SECURITY_BASELINE.md` | Parent security model |
| WAF Baseline | `docs/security/WAF_BASELINE.md` | Complementary edge protection (SEC-6.1) |
| Rate Limiting Spec | `docs/security/RATE_LIMITING_SPEC.md` | Complementary abuse prevention (SEC-6.2) |
| Route Classification | `docs/security/ROUTE_CLASSIFICATION_POLICY.md` | Endpoint definitions (SEC-5.1) |
| Cloudflare Access | `docs/security/CLOUDFLARE_ACCESS_PRIVILEGED.md` | Identity gating (SEC-5.2) |

---

## 15. Summary

| Aspect | Value |
|--------|-------|
| **Primary Warning** | DO NOT challenge everything — causes self-DoS |
| **Default Action** | Allow (challenge selectively) |
| **Verified Bots** | ALWAYS allow |
| **Health Endpoints** | NEVER challenge |
| **API Read Endpoints** | NEVER challenge |
| **Auth Endpoints** | Challenge suspicious bots |
| **Admin Write Endpoints** | Challenge non-verified bots |
| **Rollout Strategy** | Observe (7d) → Selective (7d) → Expanded |

---

## 16. Rollout Status

| Phase | Environment | Status | Date | Notes |
|-------|-------------|--------|------|-------|
| Phase 1 (Observe) | Staging | PENDING | | |
| Phase 1 (Observe) | Production | PENDING | | |
| Phase 2 (Selective) | Staging | PENDING | | |
| Phase 2 (Selective) | Production | PENDING | | |
| Phase 3 (Expanded) | Staging | PENDING | | |
| Phase 3 (Expanded) | Production | PENDING | | |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-6.3 bot controls baseline |
