# WAF_BASELINE.md — WAF Baseline + Exception Strategy

> **PROMPTSPEC-SEC-6.1** — WAF Baseline + Exception Strategy
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Enable Cloudflare Managed WAF rules safely with a structured rollout and a sane exception strategy that maintains security while accommodating legitimate application requirements.

| Attribute         | Value                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| **Scope**         | Cloudflare WAF configuration for all production and staging domains     |
| **Prerequisites** | Security Baseline (SEC-0.1), TLS Strict Baseline (SEC-3.1)              |
| **Constraints**   | Worker-only architecture; WAF operates at Cloudflare edge before Worker |

---

## 2. North Star Compliance

### 2.1 NS-1: Edge-First Security

> **NS-1:** Every public request hits Cloudflare first

WAF protection operates at the Cloudflare edge, providing defense-in-depth before requests reach the Worker. This specification ensures:

| Layer                    | Protection                  | Implementation               |
| ------------------------ | --------------------------- | ---------------------------- |
| **Edge (WAF)**           | Block known attack patterns | Managed rulesets (this spec) |
| **Edge (Rate Limiting)** | Prevent abuse/DoS           | SEC-EDGE-02 (future)         |
| **Worker (Guards)**      | Application-level auth      | `guardAdminOAuth()`, etc.    |

### 2.2 Defense-in-Depth Principle

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         REQUEST FLOW                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Internet → Cloudflare Edge → WAF Evaluation → Worker → Response             │
│                                    │                                         │
│                                    ├─ BLOCK: Known attack patterns           │
│                                    ├─ LOG: Suspicious but allowed            │
│                                    └─ ALLOW: Clean traffic                   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Managed Rulesets Overview

### 3.1 Available Cloudflare Managed Rulesets

| Ruleset                                  | Description                               | Recommendation  |
| ---------------------------------------- | ----------------------------------------- | --------------- |
| **Cloudflare Managed Ruleset**           | Core WAF rules for common vulnerabilities | **REQUIRED**    |
| **Cloudflare OWASP Core Ruleset**        | OWASP ModSecurity Core Rule Set           | **REQUIRED**    |
| **Cloudflare Exposed Credentials Check** | Detect compromised credentials            | **RECOMMENDED** |
| **Cloudflare Leaked Credentials Check**  | Block known leaked passwords              | **RECOMMENDED** |

### 3.2 Rule Categories

| Category                | Examples                         | Risk Level |
| ----------------------- | -------------------------------- | ---------- |
| **SQLi**                | SQL injection attacks            | Critical   |
| **XSS**                 | Cross-site scripting             | Critical   |
| **RCE**                 | Remote code execution            | Critical   |
| **LFI/RFI**             | Local/remote file inclusion      | High       |
| **Directory Traversal** | Path traversal attacks           | High       |
| **Protocol Attacks**    | HTTP protocol violations         | Medium     |
| **Scanner Detection**   | Automated vulnerability scanners | Medium     |

### 3.3 Default Actions

| Action                  | Description                  | Use Case                                     |
| ----------------------- | ---------------------------- | -------------------------------------------- |
| **Log**                 | Record match, allow request  | Initial rollout, monitoring                  |
| **Challenge (Managed)** | Present CAPTCHA/JS challenge | Suspected bot traffic                        |
| **Block**               | Reject request with 403      | Confirmed attack patterns                    |
| **Skip**                | Bypass rule (exception)      | Legitimate traffic triggering false positive |

---

## 4. Implementation Plan

### 4.1 Phased Rollout Strategy

> **CRITICAL:** Never enable blocking rules without a log-only observation period.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          WAF ROLLOUT PHASES                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Phase 1: LOG-ONLY (Minimum 7 days)                                         │
│  ├─ Enable all managed rulesets in LOG mode                                 │
│  ├─ Monitor Security Events dashboard                                       │
│  ├─ Identify false positives                                                │
│  └─ Create narrow exceptions as needed                                      │
│                                                                             │
│  Phase 2: SELECTIVE BLOCKING (Minimum 7 days)                               │
│  ├─ Enable BLOCK for high-confidence rules (SQLi, RCE)                      │
│  ├─ Keep LOG for medium-confidence rules                                    │
│  ├─ Continue monitoring                                                     │
│  └─ Refine exceptions                                                       │
│                                                                             │
│  Phase 3: FULL BLOCKING (Production)                                        │
│  ├─ Enable BLOCK for all recommended rules                                  │
│  ├─ Maintain narrow exceptions                                              │
│  └─ Ongoing monitoring and exception review                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Phase 1: Log-Only Mode

**Objective:** Observe WAF behavior without impacting users; identify false positives.

| Setting                        | Value          | Rationale                        |
| ------------------------------ | -------------- | -------------------------------- |
| **Cloudflare Managed Ruleset** | Enabled (Log)  | Observe matches                  |
| **OWASP Core Ruleset**         | Enabled (Log)  | Observe matches                  |
| **Duration**                   | Minimum 7 days | Capture diverse traffic patterns |
| **Action Override**            | Log all rules  | No blocking in Phase 1           |

**Implementation Steps:**

| Step | Action                                               | Location                |
| ---- | ---------------------------------------------------- | ----------------------- |
| 1    | Navigate to Security → WAF → Managed rules           | Cloudflare Dashboard    |
| 2    | Enable "Cloudflare Managed Ruleset"                  | Deploy button           |
| 3    | Click ruleset → Configure → Set all actions to "Log" | Action dropdown         |
| 4    | Enable "Cloudflare OWASP Core Ruleset"               | Deploy button           |
| 5    | Click ruleset → Configure → Set all actions to "Log" | Action dropdown         |
| 6    | Document deployment date                             | This document or ticket |

**Monitoring During Phase 1:**

```bash
# Daily review checklist
- [ ] Check Security → Events for WAF matches
- [ ] Export matches for analysis
- [ ] Identify legitimate requests flagged (false positives)
- [ ] Document false positives in exception tracking
- [ ] No user complaints about blocked requests
```

### 4.3 Phase 2: Selective Blocking

**Objective:** Enable blocking for high-confidence attack categories while continuing to log others.

| Category              | Action      | Rationale                                |
| --------------------- | ----------- | ---------------------------------------- |
| **SQLi**              | Block       | High confidence, low false-positive rate |
| **RCE**               | Block       | Critical severity, rarely false positive |
| **XSS (Reflected)**   | Block       | High confidence                          |
| **Protocol Attacks**  | Block       | Clear violations                         |
| **XSS (Stored)**      | Log → Block | May have false positives with rich text  |
| **LFI/RFI**           | Log → Block | May trigger on legitimate paths          |
| **Scanner Detection** | Challenge   | May catch legitimate security tools      |

**Implementation Steps:**

| Step | Action                                          | Location             |
| ---- | ----------------------------------------------- | -------------------- |
| 1    | Review Phase 1 logs for false positives         | Security → Events    |
| 2    | Create exceptions for confirmed false positives | See Section 5        |
| 3    | Navigate to Managed Ruleset configuration       | WAF → Managed rules  |
| 4    | Set SQLi rules to "Block"                       | Rule category filter |
| 5    | Set RCE rules to "Block"                        | Rule category filter |
| 6    | Set XSS (Reflected) rules to "Block"            | Rule category filter |
| 7    | Continue monitoring for 7 days                  | Security → Events    |

### 4.4 Phase 3: Full Blocking

**Objective:** Enable blocking for all recommended rules with documented exceptions.

| Category              | Action             | Notes                           |
| --------------------- | ------------------ | ------------------------------- |
| **All Critical**      | Block              | SQLi, RCE, XSS                  |
| **All High**          | Block              | LFI, RFI, Traversal             |
| **All Medium**        | Block or Challenge | Based on false-positive history |
| **Scanner Detection** | Challenge          | Allow with verification         |

**Transition Criteria:**

| Criterion                           | Required | Verification                  |
| ----------------------------------- | -------- | ----------------------------- |
| Phase 2 completed (7+ days)         | ✓        | Deployment log                |
| No legitimate traffic blocked       | ✓        | User reports, support tickets |
| All false positives have exceptions | ✓        | Exception registry            |
| Exception registry documented       | ✓        | Section 6                     |
| Monitoring alerts configured        | ✓        | Dashboard alerts              |

---

## 5. Exception Strategy

### 5.1 Exception Principles

> **CRITICAL:** Exceptions must be narrow, timeboxed, and documented. Blanket disabling of entire rulesets is **PROHIBITED**.

| Principle        | Description                                  | Enforcement                 |
| ---------------- | -------------------------------------------- | --------------------------- |
| **Narrow Scope** | Exceptions target specific paths AND methods | Required                    |
| **Timeboxed**    | Exceptions have expiration dates             | Required for new exceptions |
| **Documented**   | Every exception has a justification          | Exception registry          |
| **Reviewed**     | Exceptions reviewed quarterly                | Calendar reminder           |
| **Minimal**      | Disable single rules, not categories         | Acceptance criteria         |

### 5.2 Prohibited Exception Patterns

> **EXPLICITLY PROHIBITED:** These exception patterns are forbidden and will fail security review.

| Prohibited Pattern                          | Reason                      | Alternative                 |
| ------------------------------------------- | --------------------------- | --------------------------- |
| **Disable entire ruleset**                  | Removes all protection      | Disable specific rules only |
| **Disable entire category** (e.g., all XSS) | Too broad, high risk        | Disable specific rule IDs   |
| **Path: `/*`** (all paths)                  | Effectively disables WAF    | Specify exact paths         |
| **No expiration** (for new exceptions)      | Exceptions become permanent | Set review date             |
| **Undocumented exceptions**                 | Cannot audit                | Require justification       |
| **Method: `*`** (all methods)               | Too broad                   | Specify GET, POST, etc.     |

### 5.3 Exception Request Requirements

Every exception request must include:

```yaml
exception_request:
  # Required fields
  rule_id: '100001' # Specific rule ID being excepted
  rule_name: 'SQLi - SELECT' # Human-readable rule name
  path: '/api/v2/search' # Specific path (no wildcards to /*)
  methods: ['GET', 'POST'] # Specific HTTP methods
  reason: 'Search query contains SQL-like keywords in legitimate user input'
  requested_by: 'developer@oursharedevents.com'
  request_date: '2026-01-05'

  # Timeboxing
  expires: '2026-04-05' # Maximum 90 days for new exceptions
  review_date: '2026-03-15' # Review before expiration

  # Approval
  approved_by: '' # Security lead signature
  approval_date: ''
```

### 5.4 Exception Implementation

**Option A: Cloudflare Dashboard (Recommended for Simple Cases)**

| Step | Action                                     | Location        |
| ---- | ------------------------------------------ | --------------- |
| 1    | Navigate to Security → WAF → Managed rules | Dashboard       |
| 2    | Click the specific ruleset                 | Ruleset list    |
| 3    | Find the rule by ID or name                | Rule list       |
| 4    | Click "Add exception"                      | Rule row        |
| 5    | Configure path and method filters          | Exception form  |
| 6    | Set action to "Skip"                       | Action dropdown |
| 7    | Add comment with justification             | Notes field     |

**Option B: WAF Custom Rules (For Complex Exceptions)**

Create a custom rule that skips WAF for specific conditions:

```
Rule Name: Exception - Search API SQLi False Positive
Priority: 1 (evaluated first)

Expression:
  (http.request.uri.path eq "/api/v2/search") and
  (http.request.method eq "GET")

Action: Skip
Skip: Cloudflare Managed Ruleset - Rule ID 100001

Comment: Search endpoint accepts SQL-like operators in query.
         Expires: 2026-04-05
         Ticket: SEC-123
```

### 5.5 Exception Scope Examples

**GOOD: Narrow Exception**

```yaml
rule_id: '100015'
path: '/api/v2/events/{id}/description'
methods: ['PUT']
reason: 'Event descriptions may contain code examples in markdown'
```

**BAD: Too Broad**

```yaml
rule_id: '100015'
path: '/*' # ← PROHIBITED: Affects all paths
methods: ['*'] # ← PROHIBITED: Affects all methods
reason: 'Getting false positives' # ← INSUFFICIENT: No specifics
```

---

## 6. Exception Registry

### 6.1 Active Exceptions

Track all active exceptions in this registry. Review quarterly.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         EXCEPTION REGISTRY                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Last Review: [DATE]                                                          │
│ Next Review: [DATE + 90 days]                                                │
│ Reviewed By: [NAME]                                                          │
└──────────────────────────────────────────────────────────────────────────────┘

| ID | Rule ID | Rule Name | Path | Methods | Reason | Expires | Status |
|----|---------|-----------|------|---------|--------|---------|--------|
| E-001 | [EXAMPLE] | [EXAMPLE] | /api/v2/search | GET | Search query false positive | 2026-04-05 | Active |

Note: This table should be populated during Phase 1/2 as false positives are identified.
Current status: NO EXCEPTIONS REQUIRED (pending initial rollout)
```

### 6.2 Exception Lifecycle

```
Exception Request → Security Review → Approval → Implementation → Monitor → Review → Renew/Remove

Timeline:
├─ Request submitted
├─ Security review (SLA: 2 business days)
├─ Approval or rejection with feedback
├─ Implementation (if approved)
├─ Quarterly review (mandatory)
└─ Expiration (auto-disable or renew with re-approval)
```

### 6.3 Quarterly Exception Review

Every 90 days, review all active exceptions:

```
QUARTERLY EXCEPTION REVIEW CHECKLIST

Date: _______________
Reviewer: _______________

For each active exception:
[ ] Is the exception still needed?
    - If no: Remove exception
    - If yes: Continue to next question
[ ] Has the application changed?
    - If yes: Verify exception is still correctly scoped
[ ] Have there been security incidents related to this exception?
    - If yes: Consider removing or narrowing exception
[ ] Is the exception the minimum necessary?
    - If no: Narrow the scope
[ ] Update expiration date (max +90 days)

Summary:
- Exceptions reviewed: ___
- Exceptions removed: ___
- Exceptions renewed: ___
- Exceptions modified: ___

Signed: _______________ Date: _______________
```

---

## 7. Monitoring and Alerting

### 7.1 Security Events Dashboard

Monitor WAF activity in Cloudflare Dashboard:

```
Location: Security → Events

Key metrics to monitor:
- Total WAF blocks per day
- Top triggered rules
- Top blocked IPs
- Geographic distribution of blocks
- False positive indicators (e.g., blocks from known-good IPs)
```

### 7.2 Alert Configuration

| Alert                   | Threshold                              | Priority | Action                               |
| ----------------------- | -------------------------------------- | -------- | ------------------------------------ |
| **Block spike**         | >2x normal blocks/hour                 | High     | Investigate attack or false positive |
| **New rule triggering** | First block from recently enabled rule | Medium   | Verify not false positive            |
| **Exception expiring**  | 7 days before expiration               | Medium   | Review and renew/remove              |
| **Admin IP blocked**    | Known admin IP blocked                 | High     | Verify exception or investigate      |

### 7.3 Log Retention

| Environment | WAF Log Retention            | Notes                        |
| ----------- | ---------------------------- | ---------------------------- |
| Production  | 30 days (Cloudflare default) | Extend via Logpush if needed |
| Staging     | 7 days                       | Sufficient for development   |

---

## 8. UI Execution Checklist

### 8.1 Initial Deployment (Phase 1)

```
DOMAIN: _______________________  DATE: ___________

WAF MANAGED RULES DEPLOYMENT

[ ] 1. Navigate to Security → WAF → Managed rules
[ ] 2. Click "Deploy" for Cloudflare Managed Ruleset
[ ] 3. Configure all rules to "Log" action:
      [ ] Click ruleset → Browse Rules
      [ ] Use bulk action: Set all to Log
[ ] 4. Click "Deploy" for OWASP Core Ruleset
[ ] 5. Configure all rules to "Log" action
[ ] 6. Verify deployment in Security → Events
      [ ] Events page shows WAF as a source filter
[ ] 7. Set calendar reminder for Phase 2 (+7 days)
[ ] 8. Document deployment in change log

Deployed by: _______________  Date: _______________
```

### 8.2 Phase 2 Transition

```
DOMAIN: _______________________  DATE: ___________

PHASE 2: SELECTIVE BLOCKING

Pre-Transition Review:
[ ] Phase 1 ran for minimum 7 days
[ ] Security Events reviewed for false positives
[ ] False positives documented in Exception Registry
[ ] Exceptions implemented and tested

Blocking Enablement:
[ ] Navigate to Cloudflare Managed Ruleset
[ ] Filter by category: SQLi
    [ ] Set all SQLi rules to "Block"
[ ] Filter by category: Command Injection (RCE)
    [ ] Set all RCE rules to "Block"
[ ] Filter by category: XSS
    [ ] Set Reflected XSS rules to "Block"
    [ ] Keep Stored XSS on "Log" initially
[ ] Verify exceptions are still active after rule changes

Post-Transition:
[ ] Monitor Security → Events for blocked requests
[ ] Verify no legitimate traffic blocked
[ ] Set calendar reminder for Phase 3 (+7 days)

Transitioned by: _______________  Date: _______________
```

### 8.3 Phase 3 Completion

```
DOMAIN: _______________________  DATE: ___________

PHASE 3: FULL BLOCKING

Pre-Transition Review:
[ ] Phase 2 ran for minimum 7 days
[ ] No legitimate traffic blocked during Phase 2
[ ] Exception registry up to date
[ ] Monitoring alerts configured

Full Blocking Enablement:
[ ] Navigate to Cloudflare Managed Ruleset
[ ] Set remaining categories to "Block":
    [ ] Stored XSS
    [ ] File Inclusion (LFI/RFI)
    [ ] Directory Traversal
    [ ] Protocol Attacks
[ ] Set Scanner Detection to "Challenge"
[ ] Repeat for OWASP Core Ruleset

Post-Completion:
[ ] Document final configuration
[ ] Update this spec with "PRODUCTION" status
[ ] Set quarterly review reminder

Completed by: _______________  Date: _______________
```

---

## 9. Acceptance Criteria

### 9.1 Primary Acceptance Criteria

| ID       | Criterion                               | Verification                               | Status |
| -------- | --------------------------------------- | ------------------------------------------ | ------ |
| **AC-1** | Cloudflare Managed Ruleset is enabled   | Dashboard shows "Deployed"                 |        |
| **AC-2** | OWASP Core Ruleset is enabled           | Dashboard shows "Deployed"                 |        |
| **AC-3** | Rollout follows log-only → block phases | Deployment log shows phases                |        |
| **AC-4** | No entire ruleset is disabled           | Ruleset status shows "Enabled"             |        |
| **AC-5** | No entire category is disabled          | Category rules are individually configured |        |

### 9.2 Exception Acceptance Criteria

| ID       | Criterion                                    | Verification             | Status |
| -------- | -------------------------------------------- | ------------------------ | ------ |
| **EX-1** | All exceptions have specific path (not `/*`) | Exception registry audit |        |
| **EX-2** | All exceptions have specific method(s)       | Exception registry audit |        |
| **EX-3** | All new exceptions have expiration date      | Exception registry audit |        |
| **EX-4** | All exceptions have documented reason        | Exception registry audit |        |
| **EX-5** | Quarterly exception review is scheduled      | Calendar entry exists    |        |

### 9.3 Prohibited Configuration Audit

Run this audit to verify compliance:

```
PROHIBITED CONFIGURATION AUDIT

Date: _______________
Auditor: _______________

Check for prohibited patterns:
[ ] No ruleset is fully disabled
    How to verify: Security → WAF → All rulesets show "Enabled"

[ ] No category is fully disabled
    How to verify: Browse rules, no category shows 0 active rules

[ ] No exceptions use path "/*"
    How to verify: Review all WAF exceptions for path patterns

[ ] No exceptions use method "*"
    How to verify: Review all WAF exceptions for method filters

[ ] No undocumented exceptions exist
    How to verify: Cross-reference Dashboard exceptions with registry

Audit Result: PASS / FAIL
If FAIL, document violations: _______________

Audited by: _______________  Date: _______________
```

---

## 10. Verification Tests

### 10.1 WAF Block Verification

Test that WAF blocks known attack patterns:

```bash
# Test SQLi detection (should be blocked in Phase 2+)
curl -s -o /dev/null -w "%{http_code}" \
  "https://www.oursharedevents.com/?id=1' OR '1'='1"
# Expected: 403 (Forbidden) in blocking mode
# Expected: 200 with log entry in log-only mode

# Test XSS detection (should be blocked in Phase 2+)
curl -s -o /dev/null -w "%{http_code}" \
  "https://www.oursharedevents.com/?q=<script>alert(1)</script>"
# Expected: 403 (Forbidden) in blocking mode

# Test path traversal (should be blocked in Phase 3)
curl -s -o /dev/null -w "%{http_code}" \
  "https://www.oursharedevents.com/../../etc/passwd"
# Expected: 403 (Forbidden) in blocking mode

# Verify legitimate request is NOT blocked
curl -s -o /dev/null -w "%{http_code}" \
  "https://www.oursharedevents.com/api/events"
# Expected: 200 (OK)
```

### 10.2 Exception Verification

```bash
# If exception exists for /api/v2/search SQLi:
curl -s -o /dev/null -w "%{http_code}" \
  "https://www.oursharedevents.com/api/v2/search?q=SELECT"
# Expected: 200 (exception allows)

# Same pattern on different path (should be blocked):
curl -s -o /dev/null -w "%{http_code}" \
  "https://www.oursharedevents.com/other?q=SELECT * FROM users"
# Expected: 403 (no exception for this path)
```

### 10.3 Security Event Log Verification

```bash
# After running test attacks above, verify logs exist:
# Navigate to: Security → Events
# Filter: Service = WAF
# Verify: Recent entries show test requests

# Expected log entry fields:
# - Rule ID
# - Rule Name
# - Action (Log/Block)
# - Request URI
# - Client IP
# - Timestamp
```

---

## 11. Failure Modes and Rollback

### 11.1 Common Issues

| Issue                      | Symptom                       | Resolution                                   |
| -------------------------- | ----------------------------- | -------------------------------------------- |
| Legitimate traffic blocked | User reports, support tickets | Review Security Events, add narrow exception |
| All traffic blocked        | Site down, 403 everywhere     | Emergency: Set ruleset to Log or disable     |
| False positive spike       | Many blocks from same rule    | Investigate rule, consider exception         |
| Performance degradation    | Slow responses                | Check Cloudflare status, unlikely WAF cause  |

### 11.2 Emergency Rollback

If WAF is causing widespread blocking of legitimate traffic:

**Option A: Set to Log-Only (Recommended)**
| Step | Action |
|------|--------|
| 1 | Navigate to Security → WAF → Managed rules |
| 2 | Click affected ruleset |
| 3 | Use bulk action: Set all rules to "Log" |
| 4 | Investigate false positives |
| 5 | Add exceptions and re-enable blocking |

**Option B: Disable Specific Rules**
| Step | Action |
|------|--------|
| 1 | Identify blocking rule in Security → Events |
| 2 | Navigate to rule in Managed rules |
| 3 | Set action to "Log" for that specific rule |
| 4 | Monitor and investigate |

**Option C: Full Rollback (Last Resort)**
| Step | Action |
|------|--------|
| 1 | Navigate to Security → WAF → Managed rules |
| 2 | Click "Undeploy" for affected ruleset |
| 3 | **Document reason for emergency undeploy** |
| 4 | Re-deploy with corrected configuration |

> **WARNING:** Full ruleset disable should be temporary. Re-enable within 24 hours with corrected configuration.

---

## 12. Sensitive Data Protection

### 12.1 Sensitive Data Fields

WAF should not log full request bodies containing sensitive data.

| Field Type     | Protection | Implementation            |
| -------------- | ---------- | ------------------------- |
| Passwords      | Never log  | Cloudflare default        |
| API keys       | Never log  | Cloudflare default        |
| Credit cards   | Never log  | Cloudflare PCI compliance |
| Session tokens | Masked     | Cloudflare default        |

### 12.2 Log Sanitization

Cloudflare automatically sanitizes sensitive data in WAF logs. Verify:

- Password fields are not visible in Security Events
- API tokens are masked
- Only URI path and relevant attack pattern shown

---

## 13. Related Documents

| Document                     | Path                                            | Relationship                   |
| ---------------------------- | ----------------------------------------------- | ------------------------------ |
| Security Baseline            | `docs/security/SECURITY_BASELINE.md`            | Parent security model          |
| TLS Strict Baseline          | `docs/security/TLS_STRICT_BASELINE.md`          | Prerequisite (SEC-3.1)         |
| Route Classification         | `docs/security/ROUTE_CLASSIFICATION_POLICY.md`  | Path definitions (SEC-5.1)     |
| Cloudflare Access            | `docs/security/CLOUDFLARE_ACCESS_PRIVILEGED.md` | Edge auth (SEC-5.2)            |
| Rate Limiting                | Pending SEC-EDGE-02                             | Complementary abuse prevention |
| Cloudflare Account Hardening | `docs/security/CF_ACCOUNT_HARDENING_RUNBOOK.md` | Account security               |

---

## 14. Summary

| Aspect                    | Value                                                                     |
| ------------------------- | ------------------------------------------------------------------------- |
| **Managed Rulesets**      | Cloudflare Managed + OWASP Core (both required)                           |
| **Rollout Strategy**      | Log-only (7d) → Selective Block (7d) → Full Block                         |
| **Exception Requirement** | Narrow (path+method), Timeboxed, Documented                               |
| **Prohibited Patterns**   | Disable entire ruleset, Disable entire category, Path `/*`, No expiration |
| **Review Cadence**        | Quarterly exception review (mandatory)                                    |
| **Primary AC**            | No entire ruleset or category is disabled                                 |

---

## 15. Rollout Status

| Phase                     | Environment | Status  | Date | Notes |
| ------------------------- | ----------- | ------- | ---- | ----- |
| Phase 1 (Log-only)        | Staging     | PENDING |      |       |
| Phase 1 (Log-only)        | Production  | PENDING |      |       |
| Phase 2 (Selective Block) | Staging     | PENDING |      |       |
| Phase 2 (Selective Block) | Production  | PENDING |      |       |
| Phase 3 (Full Block)      | Staging     | PENDING |      |       |
| Phase 3 (Full Block)      | Production  | PENDING |      |       |

---

## Document History

| Date       | Author      | Changes                                                      |
| ---------- | ----------- | ------------------------------------------------------------ |
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-6.1 WAF baseline + exception strategy |
