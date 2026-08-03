# SECURITY_RUNBOOK.md — Security Operations & Incident Response

> **PROMPTSPEC-SEC-9.1** — Security Runbook + Alerting Plan
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Operational readiness for detecting and responding to security incidents. This runbook provides step-by-step procedures for seeing attacks and responding fast.

| Attribute            | Value                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| **Scope**            | Production and staging environments                                          |
| **Prerequisites**    | Security Baseline (SEC-0.1), WAF Baseline (SEC-6.1), Rate Limiting (SEC-6.2) |
| **On-Call Rotation** | Security team + Engineering lead                                             |
| **Escalation Path**  | On-call → Security Lead → Engineering Lead → CTO                             |

---

## 2. Alerting Implementation Plan

### 2.1 Alert Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         ALERTING ARCHITECTURE                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Signal Sources                    Alert Pipeline              Response      │
│  ─────────────────                 ──────────────              ────────      │
│                                                                              │
│  ┌─────────────────┐              ┌────────────────┐                         │
│  │ Cloudflare Edge │──────────────│                │                         │
│  │ - WAF events    │              │                │         ┌────────────┐  │
│  │ - 429 responses │              │   Cloudflare   │────────▶│   Slack    │  │
│  │ - 401/403 codes │              │   Notifications│         │  #security │  │
│  │ - 5xx errors    │              │                │────────▶├────────────┤  │
│  └─────────────────┘              │                │         │  PagerDuty │  │
│                                   └────────────────┘         │  (P1/P2)   │  │
│  ┌─────────────────┐                                         └────────────┘  │
│  │ Worker Logs     │──────────────┐                                          │
│  │ - Auth failures │              │  ┌────────────────┐      ┌────────────┐  │
│  │ - Guard denials │              └──│   Logpush →    │─────▶│  Datadog/  │  │
│  │ - Audit events  │                 │   SIEM         │      │  Splunk    │  │
│  └─────────────────┘                 └────────────────┘      └────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Implementation Steps

#### Phase 1: Cloudflare Native Alerting (Week 1)

| Step | Action                          | Owner         | Status |
| ---- | ------------------------------- | ------------- | ------ |
| 1    | Enable Cloudflare Notifications | Security Lead |        |
| 2    | Configure alert thresholds      | Security Lead |        |
| 3    | Set up notification channels    | DevOps        |        |
| 4    | Test alert delivery             | Security Lead |        |

**Step 1: Enable Cloudflare Notifications**

```
Location: Cloudflare Dashboard → Notifications → Create

[ ] Navigate to Cloudflare Dashboard
[ ] Click "Notifications" in left sidebar
[ ] Click "Add" button
[ ] Select notification type (see Section 2.3)
[ ] Configure thresholds
[ ] Add notification recipients
[ ] Save and test
```

**Step 2: Configure Alert Thresholds**

See Section 3 for specific thresholds per signal type.

**Step 3: Set Up Notification Channels**

| Channel   | Purpose         | Setup Location                       |
| --------- | --------------- | ------------------------------------ |
| Email     | All alerts      | Cloudflare Notifications → Email     |
| Slack     | Real-time ops   | Cloudflare Notifications → Webhooks  |
| PagerDuty | P1/P2 incidents | Cloudflare Notifications → PagerDuty |

**Slack Webhook Setup:**

```
[ ] 1. Create Slack App at api.slack.com
[ ] 2. Enable Incoming Webhooks
[ ] 3. Create webhook URL for #security-alerts channel
[ ] 4. Copy webhook URL to Cloudflare Notifications
[ ] 5. Test with "Send test notification"
```

#### Phase 2: Log Pipeline (Week 2)

| Step | Action                    | Owner         | Status |
| ---- | ------------------------- | ------------- | ------ |
| 1    | Enable Cloudflare Logpush | DevOps        |        |
| 2    | Configure log destination | DevOps        |        |
| 3    | Set up SIEM dashboards    | Security Lead |        |
| 4    | Create correlation rules  | Security Lead |        |

**Logpush Configuration:**

```
Location: Cloudflare Dashboard → Analytics → Logpush

[ ] Navigate to Analytics → Logpush
[ ] Click "Create a Logpush job"
[ ] Select log type: HTTP requests, Firewall events
[ ] Configure destination (S3, Datadog, Splunk, etc.)
[ ] Set log fields to include:
    - ClientIP
    - ClientRequestHost
    - ClientRequestMethod
    - ClientRequestURI
    - EdgeResponseStatus
    - WAFAction
    - WAFRuleID
    - RayID
    - Timestamp
[ ] Enable job
[ ] Verify logs flowing to destination
```

#### Phase 3: Custom Alerting Rules (Week 3)

| Step | Action                      | Owner         | Status |
| ---- | --------------------------- | ------------- | ------ |
| 1    | Create SIEM alert rules     | Security Lead |        |
| 2    | Configure anomaly detection | Security Lead |        |
| 3    | Set up correlation alerts   | Security Lead |        |
| 4    | Test end-to-end             | Security Team |        |

### 2.3 Alert Types to Configure

| Alert Type           | Cloudflare Location             | Threshold              | Priority |
| -------------------- | ------------------------------- | ---------------------- | -------- |
| **DDoS Attack**      | Notifications → DDoS Protection | Auto-detected          | P1       |
| **WAF Block Spike**  | Notifications → Firewall        | >100 blocks/min        | P2       |
| **Rate Limit Spike** | Notifications → Rate Limiting   | >50 429s/min           | P2       |
| **5xx Error Spike**  | Notifications → HTTP/HTTPS      | >10 5xx/min            | P2       |
| **SSL Certificate**  | Notifications → SSL/TLS         | 14 days before expiry  | P3       |
| **Origin Health**    | Notifications → Health Checks   | 3 consecutive failures | P1       |

---

## 3. Security Signals

### 3.1 Signal: 401/403 Spikes (Authentication/Authorization Failures)

#### What It Indicates

| Pattern                  | Likely Cause                | Severity |
| ------------------------ | --------------------------- | -------- |
| Spike from single IP     | Credential stuffing attempt | Medium   |
| Spike from multiple IPs  | Distributed brute force     | High     |
| Spike on `/auth/*` paths | OAuth attack                | High     |
| Spike on `/api/admin/*`  | Admin endpoint probe        | High     |
| Gradual increase         | Misconfigured client        | Low      |

#### Thresholds

| Metric                  | Warning         | Critical         | Measurement Period |
| ----------------------- | --------------- | ---------------- | ------------------ |
| 401/403 count           | >50/min         | >200/min         | Rolling 1 minute   |
| 401/403 rate            | >5% of requests | >15% of requests | Rolling 5 minutes  |
| Unique IPs with 401/403 | >20/min         | >100/min         | Rolling 1 minute   |
| Single IP 401/403 count | >10/min         | >50/min          | Rolling 1 minute   |

#### Alert Configuration

```
Cloudflare Dashboard → Security → Events → Create Alert

Alert Name: Auth Failure Spike
Condition: HTTP Response Status = 401 OR 403
Threshold: > 50 events in 1 minute
Notification: Slack #security-alerts + PagerDuty (if >200)
```

#### Triage Steps

```
AUTH FAILURE SPIKE TRIAGE

Time Started: ___________  Triaged By: ___________

STEP 1: ASSESS SCOPE (2 minutes)
[ ] Open Cloudflare Dashboard → Security → Events
[ ] Filter: Response Code = 401 OR 403
[ ] Filter: Last 15 minutes
[ ] Document:
    - Total events: ___________
    - Unique IPs: ___________
    - Top targeted paths: ___________
    - Geographic distribution: ___________

STEP 2: IDENTIFY PATTERN (3 minutes)
[ ] Single IP or distributed?
    [ ] Single IP: ___________
    [ ] Multiple IPs: ___________ (count)
[ ] Targeted endpoint(s):
    [ ] /auth/* (OAuth)
    [ ] /api/admin/* (Admin API)
    [ ] /api/v2/admin/* (V2 Admin API)
    [ ] Other: ___________
[ ] User-Agent analysis:
    [ ] Known browser
    [ ] Automated/script
    [ ] Empty/suspicious

STEP 3: DETERMINE CAUSE (2 minutes)
[ ] Check for recent deployments (could cause auth changes)
[ ] Check for expired tokens/sessions
[ ] Check OAuth provider status (Google)
[ ] Check for known attack patterns in threat intel

STEP 4: TAKE ACTION (see Section 6 for rollback levers)
If single IP attack:
[ ] Block IP via Cloudflare Firewall Rules

If distributed attack:
[ ] Enable Under Attack Mode (if severe)
[ ] Enable additional rate limiting

If misconfiguration:
[ ] Identify and fix config issue
[ ] Communicate to affected users

STEP 5: DOCUMENT
[ ] Record incident in security log
[ ] Update threat intel if new pattern
```

---

### 3.2 Signal: WAF Events (Web Application Firewall Blocks)

#### What It Indicates

| Pattern                  | Likely Cause                      | Severity |
| ------------------------ | --------------------------------- | -------- |
| SQLi rule triggers       | SQL injection attempt             | High     |
| XSS rule triggers        | Cross-site scripting attempt      | High     |
| RCE rule triggers        | Remote code execution attempt     | Critical |
| Scanner detection        | Vulnerability scanner             | Medium   |
| Single rule spike        | False positive OR targeted attack | Medium   |
| Multiple rules/single IP | Active exploitation attempt       | High     |

#### Thresholds

| Metric                          | Warning | Critical | Measurement Period |
| ------------------------------- | ------- | -------- | ------------------ |
| WAF blocks total                | >50/min | >200/min | Rolling 1 minute   |
| Critical rule blocks (SQLi/RCE) | >5/min  | >20/min  | Rolling 1 minute   |
| Single IP WAF blocks            | >10/min | >50/min  | Rolling 1 minute   |
| New rule first trigger          | Any     | -        | Immediate          |

#### Alert Configuration

```
Cloudflare Dashboard → Security → WAF → Alerts

Alert Name: WAF Block Spike
Condition: WAF Action = Block
Threshold: > 50 events in 1 minute
Notification: Slack #security-alerts

Alert Name: Critical WAF Rule Trigger
Condition: WAF Rule Category IN (SQLi, RCE, Command Injection)
Threshold: > 5 events in 1 minute
Notification: Slack #security-alerts + PagerDuty
```

#### Triage Steps

```
WAF EVENT SPIKE TRIAGE

Time Started: ___________  Triaged By: ___________

STEP 1: ASSESS SCOPE (2 minutes)
[ ] Open Cloudflare Dashboard → Security → Events
[ ] Filter: Service = WAF
[ ] Filter: Last 15 minutes
[ ] Document:
    - Total WAF events: ___________
    - Blocks vs Logs: ___________
    - Top rule IDs: ___________
    - Top source IPs: ___________

STEP 2: ANALYZE TOP RULES (3 minutes)
For each top triggered rule:
[ ] Rule ID: ___________
    - Category: ___________
    - Sample payload: ___________
    - False positive? Y/N
[ ] Rule ID: ___________
    - Category: ___________
    - Sample payload: ___________
    - False positive? Y/N

STEP 3: DETERMINE IF ATTACK OR FALSE POSITIVE
Attack indicators:
[ ] Multiple attack categories from same IP
[ ] Payloads contain known exploit signatures
[ ] Sequential targeting of different endpoints
[ ] Unusual geographic origin

False positive indicators:
[ ] Single rule triggering
[ ] Legitimate user-generated content
[ ] Known application feature (e.g., code editor)
[ ] Recent application deployment

STEP 4: TAKE ACTION
If active attack:
[ ] Verify WAF is in BLOCK mode (not just LOG)
[ ] Consider IP block for persistent attackers
[ ] Enable challenge for suspicious traffic
[ ] Alert security team

If false positive:
[ ] Document rule ID and path
[ ] Create narrow exception (see WAF_BASELINE.md Section 5)
[ ] Monitor for legitimate traffic restoration

STEP 5: DOCUMENT
[ ] Record in WAF exception registry if applicable
[ ] Update attack patterns documentation
[ ] Create incident report if significant
```

---

### 3.3 Signal: 429 Rate Limit Events

#### What It Indicates

| Pattern                | Likely Cause                | Severity |
| ---------------------- | --------------------------- | -------- |
| Single IP 429 spike    | Aggressive client/bot       | Medium   |
| Distributed 429s       | DDoS attempt                | High     |
| 429s on `/api/admin/*` | Admin brute force           | High     |
| 429s on `/jserror`     | Error flood (bug or attack) | Low      |
| Monitoring IP 429s     | Threshold too low           | Low      |

#### Thresholds

| Metric                   | Warning | Critical | Measurement Period |
| ------------------------ | ------- | -------- | ------------------ |
| 429 responses total      | >50/min | >200/min | Rolling 1 minute   |
| Unique IPs receiving 429 | >10/min | >50/min  | Rolling 1 minute   |
| 429 on admin endpoints   | >5/min  | >20/min  | Rolling 1 minute   |

#### Alert Configuration

```
Cloudflare Dashboard → Security → Rate Limiting → Alerts

Alert Name: Rate Limit Spike
Condition: Response Status = 429
Threshold: > 50 events in 1 minute
Notification: Slack #security-alerts

Alert Name: Admin Rate Limit Exceeded
Condition: Response Status = 429 AND URI contains "/admin/"
Threshold: > 5 events in 1 minute
Notification: Slack #security-alerts + PagerDuty
```

#### Triage Steps

```
RATE LIMIT SPIKE TRIAGE

Time Started: ___________  Triaged By: ___________

STEP 1: ASSESS SCOPE (2 minutes)
[ ] Open Cloudflare Dashboard → Security → Events
[ ] Filter: Response Code = 429
[ ] Filter: Last 15 minutes
[ ] Document:
    - Total 429 events: ___________
    - Unique IPs: ___________
    - Top paths: ___________
    - Rate limit rule(s) triggered: ___________

STEP 2: IDENTIFY SOURCE (3 minutes)
[ ] Single IP or distributed?
    - If single IP: ___________
    - If distributed: ___________ unique IPs
[ ] Legitimate or malicious?
    [ ] Check if known monitoring IP
    [ ] Check if known API integration
    [ ] Check User-Agent for bot signatures
    [ ] Check request patterns for automation

STEP 3: DETERMINE CAUSE
[ ] Legitimate high-volume client exceeding limits
[ ] Misconfigured client/integration
[ ] Intentional abuse/attack
[ ] Rate limit threshold too aggressive

STEP 4: TAKE ACTION
If legitimate client:
[ ] Consider adding to rate limit exception list
[ ] Contact client to discuss rate limiting
[ ] Adjust threshold if appropriate

If attack:
[ ] Verify rate limiting is blocking (not just logging)
[ ] Consider IP block for persistent attackers
[ ] Enable additional protections

If threshold issue:
[ ] Review current thresholds
[ ] Adjust based on legitimate traffic patterns
[ ] Document change

STEP 5: DOCUMENT
[ ] Update rate limit exception registry if applicable
[ ] Record threshold adjustments
[ ] Create incident report if significant
```

---

### 3.4 Signal: 5xx Server Errors

#### What It Indicates

| Pattern                   | Likely Cause            | Severity |
| ------------------------- | ----------------------- | -------- |
| 500 Internal Server Error | Application bug         | High     |
| 502 Bad Gateway           | Worker crash or timeout | High     |
| 503 Service Unavailable   | Worker overloaded       | Critical |
| 520-527 (Cloudflare)      | Edge-to-origin issues   | High     |
| Single endpoint 5xx       | Handler bug             | Medium   |
| Global 5xx spike          | System-wide issue       | Critical |

#### Thresholds

| Metric              | Warning         | Critical        | Measurement Period |
| ------------------- | --------------- | --------------- | ------------------ |
| 5xx responses total | >5/min          | >20/min         | Rolling 1 minute   |
| 5xx rate            | >1% of requests | >5% of requests | Rolling 5 minutes  |
| 503 responses       | >2/min          | >10/min         | Rolling 1 minute   |
| Single endpoint 5xx | >5/min          | >20/min         | Rolling 1 minute   |

#### Alert Configuration

```
Cloudflare Dashboard → Notifications → Create

Alert Name: 5xx Error Spike
Event: HTTP 5xx error ratio
Threshold: > 1% over 5 minutes
Notification: Slack #security-alerts + PagerDuty

Alert Name: Service Unavailable (503)
Event: HTTP 503 responses
Threshold: > 10 responses in 1 minute
Notification: PagerDuty (P1)
```

#### Triage Steps

```
5XX ERROR SPIKE TRIAGE

Time Started: ___________  Triaged By: ___________

STEP 1: ASSESS SCOPE (2 minutes)
[ ] Open Cloudflare Dashboard → Analytics → Traffic
[ ] Filter: Response Code = 5xx
[ ] Filter: Last 15 minutes
[ ] Document:
    - Total 5xx events: ___________
    - Error code breakdown:
      - 500: ___________
      - 502: ___________
      - 503: ___________
      - 520-527: ___________
    - Affected endpoints: ___________

STEP 2: IDENTIFY ROOT CAUSE (5 minutes)
[ ] Check Worker deployment status
    - Recent deployment? Y/N
    - Deployment time: ___________
[ ] Check Worker logs (if available)
    - Error messages: ___________
[ ] Check backend health
    curl -s https://www.oursharedevents.com/api/health/backend | jq .
    - Status: ___________
[ ] Check Google Sheets API status
    - https://status.cloud.google.com/
    - Status: ___________
[ ] Check Cloudflare status
    - https://www.cloudflarestatus.com/
    - Status: ___________

STEP 3: DETERMINE CAUSE
[ ] Worker code bug (recent deployment)
[ ] Backend (Google Sheets) unavailable
[ ] Cloudflare infrastructure issue
[ ] Traffic spike causing overload
[ ] External dependency failure

STEP 4: TAKE ACTION (see Section 6 for rollback levers)
If worker bug:
[ ] Initiate rollback to previous version (Section 6.2)

If backend unavailable:
[ ] Enable degraded mode if available
[ ] Communicate outage status

If Cloudflare issue:
[ ] Monitor Cloudflare status page
[ ] Contact Cloudflare support if enterprise

If traffic overload:
[ ] Enable rate limiting
[ ] Enable Under Attack Mode

STEP 5: DOCUMENT
[ ] Record incident timeline
[ ] Identify root cause
[ ] Create incident report
[ ] Schedule post-mortem if significant
```

---

## 4. Combined Signal Analysis

### 4.1 Attack Pattern Correlation

When multiple signals occur together, they often indicate coordinated attacks:

| Signal Combination                   | Likely Attack                | Response                      |
| ------------------------------------ | ---------------------------- | ----------------------------- |
| 401/403 + WAF blocks from same IP    | Active exploitation attempt  | Block IP immediately          |
| 429 + 5xx spike                      | DDoS / application overload  | Enable Under Attack Mode      |
| WAF SQLi + 5xx on database endpoints | SQL injection causing errors | Block IP, investigate queries |
| 403 spike + scanner detection        | Vulnerability reconnaissance | Challenge mode, monitor       |
| Multiple 401s + credential check WAF | Credential stuffing          | Block IP, enable CAPTCHA      |

### 4.2 Combined Alert Matrix

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         ALERT CORRELATION MATRIX                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│              401/403   WAF Block   429      5xx      Action                  │
│              ────────  ─────────   ───      ───      ──────                  │
│                                                                              │
│  Single IP    HIGH      HIGH       MED      LOW      Block IP                │
│  +WAF Block                                                                  │
│                                                                              │
│  Distributed  HIGH      HIGH       HIGH     MED      Under Attack Mode       │
│  Attack                                                                      │
│                                                                              │
│  5xx Spike    LOW       LOW        LOW      HIGH     Rollback/Investigate    │
│  Only                                                                        │
│                                                                              │
│  All Signals  CRIT      CRIT       CRIT     CRIT     Full Incident Response │
│  Combined                                                                    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Triage Decision Tree

### 5.1 Initial Triage

```
ALERT RECEIVED
    │
    ▼
Is service down/unavailable?
    │
    ├─ YES → Go to Section 6.1 (Immediate Stabilization)
    │        Priority: P1
    │        Response time: < 5 minutes
    │
    └─ NO → What type of alert?
            │
            ├─ 401/403 spike → Section 3.1 Triage
            │
            ├─ WAF events → Section 3.2 Triage
            │
            ├─ 429 spike → Section 3.3 Triage
            │
            ├─ 5xx errors → Section 3.4 Triage
            │
            └─ Multiple signals → Section 4 (Combined Analysis)
```

### 5.2 Severity Classification

| Severity          | Criteria                                                 | Response Time | Escalation        |
| ----------------- | -------------------------------------------------------- | ------------- | ----------------- |
| **P1 - Critical** | Service down, data breach suspected, active exploitation | < 5 min       | Immediate         |
| **P2 - High**     | Significant attack, partial service degradation          | < 15 min      | Within 30 min     |
| **P3 - Medium**   | Suspicious activity, single attacker blocked             | < 1 hour      | Next business day |
| **P4 - Low**      | Informational, false positive investigation              | < 24 hours    | Weekly review     |

---

## 6. Rollback Levers

### 6.1 Immediate Stabilization (P1 Response)

#### Lever 1: Enable Under Attack Mode

**When:** DDoS suspected, massive traffic spike, service degradation

```
ENABLE UNDER ATTACK MODE

Time: ___________  Executed By: ___________

[ ] 1. Navigate to Cloudflare Dashboard
[ ] 2. Select domain (www.oursharedevents.com)
[ ] 3. Click "Under Attack Mode" toggle → ON
[ ] 4. Verify enabled (banner appears)
[ ] 5. Monitor traffic in Analytics

Impact: All visitors see JavaScript challenge (5-second delay)
Duration: Enable for minimum 15 minutes, maximum 2 hours

DISABLE UNDER ATTACK MODE

[ ] 1. Verify attack has subsided
[ ] 2. Click "Under Attack Mode" toggle → OFF
[ ] 3. Monitor for return of attack
[ ] 4. Document incident
```

#### Lever 2: Block Attacking IP(s)

**When:** Single IP or small set of IPs attacking

```
BLOCK IP ADDRESS

Time: ___________  Executed By: ___________

[ ] 1. Navigate to Security → WAF → Tools
[ ] 2. Click "IP Access Rules"
[ ] 3. Click "Create IP Access Rule"
[ ] 4. Enter:
      - IP Address: ___________
      - Action: Block
      - Notes: "Security incident [DATE] - [REASON]"
[ ] 5. Click "Save"
[ ] 6. Verify block in Security Events

To remove block later:
[ ] Navigate to IP Access Rules
[ ] Find rule and click Delete
[ ] Document removal reason
```

#### Lever 3: Enable Challenge for Region

**When:** Attack originating from specific geographic region

```
ENABLE CHALLENGE FOR REGION

Time: ___________  Executed By: ___________

[ ] 1. Navigate to Security → WAF → Firewall rules
[ ] 2. Click "Create a Firewall rule"
[ ] 3. Configure:
      - Name: "Challenge [COUNTRY] traffic - [DATE]"
      - Expression: (ip.geoip.country eq "[COUNTRY_CODE]")
      - Action: Challenge (CAPTCHA)
[ ] 4. Set priority: 1 (high)
[ ] 5. Deploy rule

Document:
- Country blocked: ___________
- Reason: ___________
- Review date: ___________ (within 24 hours)
```

### 6.2 Worker Rollback

**When:** 5xx errors after deployment, application bugs

#### Option A: Cloudflare Dashboard Rollback

```
ROLLBACK WORKER DEPLOYMENT

Time: ___________  Executed By: ___________

[ ] 1. Navigate to Workers & Pages → oursharedevents-prod
[ ] 2. Click "Deployments" tab
[ ] 3. Find last known good deployment
      - Version: ___________
      - Deployed: ___________
[ ] 4. Click deployment → "Rollback to this deployment"
[ ] 5. Confirm rollback
[ ] 6. Verify health:
      curl -s https://www.oursharedevents.com/api/status | jq .
[ ] 7. Verify backend:
      curl -s https://www.oursharedevents.com/api/health/backend | jq .

Previous Version: ___________
Current Version: ___________
Rollback Reason: ___________
```

#### Option B: Git Revert + Redeploy

```bash
# Only if dashboard rollback unavailable
git log --oneline -5  # Identify good commit
git revert HEAD       # Revert last commit
git push origin main  # Trigger CI/CD redeploy
```

### 6.3 WAF Emergency Actions

**When:** WAF causing widespread false positives

```
WAF EMERGENCY ACTIONS

Time: ___________  Executed By: ___________

OPTION A: Set Specific Rule to Log (Preferred)
[ ] 1. Navigate to Security → WAF → Managed rules
[ ] 2. Find triggering rule (from Security Events)
[ ] 3. Click rule → Change action to "Log"
[ ] 4. Document:
      - Rule ID: ___________
      - Previous action: ___________
      - Reason for change: ___________
[ ] 5. Set reminder to re-enable within 24 hours

OPTION B: Set Entire Ruleset to Log (Last Resort)
[ ] 1. Navigate to Security → WAF → Managed rules
[ ] 2. Click affected ruleset
[ ] 3. Use bulk action → Set all to "Log"
[ ] 4. Document:
      - Ruleset: ___________
      - Time disabled: ___________
      - Reason: ___________
[ ] 5. CRITICAL: Re-enable within 4 hours maximum

WARNING: Never fully disable WAF without explicit CTO approval
```

### 6.4 Rate Limiting Adjustments

**When:** Rate limits blocking legitimate traffic

```
RATE LIMIT ADJUSTMENT

Time: ___________  Executed By: ___________

[ ] 1. Navigate to Security → WAF → Rate limiting rules
[ ] 2. Identify triggering rule
[ ] 3. Adjust threshold:
      - Current threshold: ___________
      - New threshold: ___________
[ ] 4. OR add exception for IP:
      - IP/Range: ___________
      - Endpoint: ___________
      - Reason: ___________
[ ] 5. Save changes
[ ] 6. Monitor for intended effect
[ ] 7. Document in rate limit exception registry

Review date for change: ___________
```

### 6.5 Rollback Decision Matrix

| Symptom                 | Primary Lever     | Secondary Lever         | Escalation Trigger        |
| ----------------------- | ----------------- | ----------------------- | ------------------------- |
| Service down (5xx)      | Worker Rollback   | Enable maintenance mode | If not resolved in 15 min |
| DDoS attack             | Under Attack Mode | Block IP ranges         | If persists after 1 hour  |
| Active exploitation     | Block IP          | WAF to Block mode       | Any successful breach     |
| False positive blocking | WAF rule to Log   | Rate limit adjustment   | Business impact           |
| Auth system failure     | Worker Rollback   | Contact OAuth provider  | If auth fully broken      |

---

## 7. Communication Plan

### 7.1 Communication Matrix

| Incident Severity | Who to Notify                                        | When              | How                             |
| ----------------- | ---------------------------------------------------- | ----------------- | ------------------------------- |
| **P1 - Critical** | Security Lead, Engineering Lead, CTO, Affected Users | Immediately       | PagerDuty → Slack → Status Page |
| **P2 - High**     | Security Lead, Engineering Lead                      | < 15 min          | Slack #security-alerts → Email  |
| **P3 - Medium**   | Security Team                                        | < 1 hour          | Slack #security-alerts          |
| **P4 - Low**      | Security Log                                         | Next business day | Weekly report                   |

### 7.2 Stakeholder Contact List

```
SECURITY INCIDENT CONTACTS

Role                    Primary Contact         Backup Contact
─────────────────────   ─────────────────────   ─────────────────────
Security Lead           [NAME]                  [NAME]
                        [PHONE]                 [PHONE]
                        [EMAIL]                 [EMAIL]

Engineering Lead        [NAME]                  [NAME]
                        [PHONE]                 [PHONE]
                        [EMAIL]                 [EMAIL]

CTO                     [NAME]                  [NAME]
                        [PHONE]                 [PHONE]
                        [EMAIL]                 [EMAIL]

Cloudflare Support      support.cloudflare.com  [ACCOUNT_ID]
                        (Enterprise: dedicated contact)

Google Cloud Support    console.cloud.google.com/support
                        (If Sheets API issue)
```

### 7.3 Communication Templates

#### Internal Alert (Slack)

```
🚨 SECURITY ALERT - [SEVERITY]

Type: [401/403 Spike | WAF Event | 429 Spike | 5xx Error]
Time: [TIMESTAMP]
Impact: [Description of impact]

Signals:
- [Signal 1]: [Value]
- [Signal 2]: [Value]

Current Status: [Investigating | Mitigating | Resolved]
Assigned To: @[PERSON]

Thread for updates below ⬇️
```

#### Status Page Update (P1/P2)

```
[TIMESTAMP] - Investigating

We are investigating reports of [ISSUE_DESCRIPTION].

Affected Services: [LIST]
Impact: [USER_IMPACT]

We will provide an update within [TIMEFRAME].

---

[TIMESTAMP] - Update

We have identified the issue as [ROOT_CAUSE].
We are currently [ACTION_BEING_TAKEN].

---

[TIMESTAMP] - Resolved

The issue has been resolved. [BRIEF_EXPLANATION].

Duration: [START_TIME] to [END_TIME]
Root Cause: [EXPLANATION]
Resolution: [WHAT_WAS_DONE]

We apologize for any inconvenience.
```

#### Post-Incident Report (Email)

```
Subject: Security Incident Report - [DATE] - [SEVERITY]

INCIDENT SUMMARY
================
Incident ID: SEC-[YEAR]-[NUMBER]
Severity: P[1-4]
Duration: [START] to [END] ([DURATION])
Impact: [DESCRIPTION]

TIMELINE
========
[TIMESTAMP] - [EVENT]
[TIMESTAMP] - [EVENT]
[TIMESTAMP] - [EVENT]

ROOT CAUSE
==========
[DETAILED EXPLANATION]

RESOLUTION
==========
[WHAT WAS DONE TO RESOLVE]

FOLLOW-UP ACTIONS
=================
[ ] [ACTION_1] - Owner: [NAME] - Due: [DATE]
[ ] [ACTION_2] - Owner: [NAME] - Due: [DATE]

LESSONS LEARNED
===============
[WHAT CAN WE IMPROVE]
```

### 7.4 Communication Timing

```
INCIDENT COMMUNICATION TIMELINE

0 min    Alert received
         └─ Acknowledge in Slack/PagerDuty
         └─ Begin triage

5 min    Initial assessment complete
         └─ Severity determined
         └─ First internal notification sent

15 min   P1/P2: Status page updated (if customer-facing)
         └─ Stakeholders notified per matrix

30 min   Progress update
         └─ Update Slack thread
         └─ Update status page if applicable

1 hour   Detailed update
         └─ Root cause identified (or working theories)
         └─ ETA for resolution if possible

Resolution + 1 hour
         └─ Incident resolved notification
         └─ Status page updated
         └─ Begin post-incident documentation

Resolution + 24 hours
         └─ Post-incident report drafted

Resolution + 72 hours
         └─ Post-mortem meeting (P1/P2 only)
         └─ Final report distributed
```

---

## 8. UI Execution Checklist

### 8.1 Alert Setup Checklist

```
DOMAIN: _______________________  DATE: ___________

CLOUDFLARE NOTIFICATION SETUP

Authentication Alerts:
[ ] Create alert: "Auth Failure Spike"
    - Event: HTTP 401/403 responses
    - Threshold: > 50/min
    - Channels: Slack + Email
[ ] Create alert: "Admin Auth Failure"
    - Event: HTTP 401/403 on /admin paths
    - Threshold: > 10/min
    - Channels: Slack + PagerDuty

WAF Alerts:
[ ] Create alert: "WAF Block Spike"
    - Event: WAF blocks
    - Threshold: > 50/min
    - Channels: Slack + Email
[ ] Create alert: "Critical WAF Rule"
    - Event: SQLi/RCE blocks
    - Threshold: > 5/min
    - Channels: Slack + PagerDuty

Rate Limit Alerts:
[ ] Create alert: "Rate Limit Spike"
    - Event: 429 responses
    - Threshold: > 50/min
    - Channels: Slack + Email

Error Alerts:
[ ] Create alert: "5xx Error Spike"
    - Event: 5xx responses
    - Threshold: > 10/min
    - Channels: Slack + PagerDuty
[ ] Create alert: "Service Unavailable"
    - Event: 503 responses
    - Threshold: > 5/min
    - Channels: PagerDuty (P1)

Infrastructure Alerts:
[ ] Create alert: "SSL Expiry Warning"
    - Event: Certificate expiring
    - Threshold: 14 days
    - Channels: Email + Slack

TEST ALL ALERTS:
[ ] Send test notification for each alert
[ ] Verify delivery to all channels
[ ] Document test completion

Completed by: _______________  Date: _______________
```

### 8.2 Logpush Setup Checklist

```
DOMAIN: _______________________  DATE: ___________

LOGPUSH CONFIGURATION

[ ] 1. Navigate to Analytics → Logpush
[ ] 2. Create job: HTTP Requests
    - Destination: _______________
    - Fields selected:
      [ ] ClientIP
      [ ] ClientRequestHost
      [ ] ClientRequestMethod
      [ ] ClientRequestURI
      [ ] EdgeResponseStatus
      [ ] RayID
      [ ] SecurityLevel
      [ ] WAFAction
      [ ] WAFRuleID
      [ ] Timestamp
[ ] 3. Create job: Firewall Events
    - Destination: _______________
    - All fields selected
[ ] 4. Verify logs flowing
    - First log received: ___________
[ ] 5. Configure SIEM dashboards
[ ] 6. Create correlation rules

Completed by: _______________  Date: _______________
```

---

## 9. Acceptance Criteria

### 9.1 Runbook Acceptance Criteria

| ID       | Criterion                                 | Verification                                                   | Status |
| -------- | ----------------------------------------- | -------------------------------------------------------------- | ------ |
| **AC-1** | Runbook is step-by-step, not conceptual   | All procedures have numbered steps with checkboxes             |        |
| **AC-2** | All security signals documented           | 401/403, WAF, 429, 5xx covered                                 |        |
| **AC-3** | Thresholds defined for each signal        | Warning and critical thresholds specified                      |        |
| **AC-4** | Triage steps for each signal              | Each signal has specific triage procedure                      |        |
| **AC-5** | Rollback levers documented                | Under Attack Mode, IP blocks, Worker rollback, WAF adjustments |        |
| **AC-6** | Communication plan includes who/what/when | Contact matrix, templates, timing defined                      |        |
| **AC-7** | Alerting implementation plan provided     | Phased rollout with specific steps                             |        |

### 9.2 Operational Readiness Verification

```
OPERATIONAL READINESS CHECKLIST

Date: _______________
Verified By: _______________

DOCUMENTATION
[ ] Runbook accessible to all on-call personnel
[ ] Contact list current and verified
[ ] Escalation path documented and approved

ALERTING
[ ] All alert types configured
[ ] Test alerts sent and received
[ ] PagerDuty escalation policies configured
[ ] Slack channels created and monitored

TOOLING
[ ] Cloudflare dashboard access for on-call
[ ] Logpush configured and flowing
[ ] SIEM dashboards created

TRAINING
[ ] On-call personnel trained on runbook
[ ] Tabletop exercise completed
[ ] Escalation contacts aware of roles

Overall Status: READY / NOT READY

If not ready, gaps:
_______________________________________________
_______________________________________________
```

---

## 10. Related Documents

| Document             | Path                                            | Relationship              |
| -------------------- | ----------------------------------------------- | ------------------------- |
| Security Baseline    | `docs/security/SECURITY_BASELINE.md`            | Parent security model     |
| WAF Baseline         | `docs/security/WAF_BASELINE.md`                 | WAF configuration details |
| Rate Limiting        | `docs/security/RATE_LIMITING_SPEC.md`           | Rate limit configuration  |
| DNSSEC Runbook       | `docs/security/DNSSEC_RUNBOOK.md`               | DNS security operations   |
| CF Account Hardening | `docs/security/CF_ACCOUNT_HARDENING_RUNBOOK.md` | Account security          |
| TLS Strict Baseline  | `docs/security/TLS_STRICT_BASELINE.md`          | TLS configuration         |

---

## 11. Quick Reference Card

### 11.1 On-Call Quick Reference

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         SECURITY ON-CALL QUICK REFERENCE                      │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  IMMEDIATE ACTIONS                                                           │
│  ─────────────────                                                           │
│  Service Down?     → Enable Under Attack Mode → Investigate → Rollback      │
│  Active Attack?    → Block IP → Enable Challenge → Alert Team               │
│  5xx Spike?        → Check deployments → Rollback if recent → Check backend │
│  WAF Blocking All? → Set rules to Log → Investigate → Fix → Re-enable       │
│                                                                              │
│  KEY URLS                                                                    │
│  ────────                                                                    │
│  CF Dashboard:     dash.cloudflare.com                                       │
│  CF Status:        cloudflarestatus.com                                      │
│  Google Status:    status.cloud.google.com                                   │
│  Health Check:     www.oursharedevents.com/api/status                             │
│  Backend Health:   www.oursharedevents.com/api/health/backend                     │
│                                                                              │
│  THRESHOLDS (CRITICAL)                                                       │
│  ─────────────────────                                                       │
│  401/403:          > 200/min                                                 │
│  WAF Blocks:       > 200/min                                                 │
│  429s:             > 200/min                                                 │
│  5xx:              > 20/min                                                  │
│                                                                              │
│  ESCALATION                                                                  │
│  ──────────                                                                  │
│  P1: PagerDuty → Security Lead → CTO (< 5 min)                              │
│  P2: Slack → Security Lead (< 15 min)                                        │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 11.2 Emergency Commands

```bash
# Quick health checks
curl -s https://www.oursharedevents.com/api/status | jq .
curl -s https://www.oursharedevents.com/api/health/backend | jq .

# Check DNS (should return Cloudflare IPs)
dig +short www.oursharedevents.com

# Check TLS certificate
echo | openssl s_client -connect www.oursharedevents.com:443 2>/dev/null | openssl x509 -noout -dates

# Verify staging
curl -s https://stg.oursharedevents.com/api/status | jq .
```

---

## Document History

| Date       | Author      | Changes                                                     |
| ---------- | ----------- | ----------------------------------------------------------- |
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-9.1 security runbook + alerting plan |
