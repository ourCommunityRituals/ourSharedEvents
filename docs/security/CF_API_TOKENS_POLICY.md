# CF_API_TOKENS_POLICY.md — Scoped API Token Policy

> **PROMPTSPEC-SEC-1.2** — Scoped API Token Policy
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

This policy defines least-privilege Cloudflare API tokens for EventAngle, ensuring each token has constrained blast radius and clear ownership.

| Attribute       | Value                                                          |
| --------------- | -------------------------------------------------------------- |
| **Scope**       | Cloudflare API token configuration and lifecycle               |
| **Non-Goals**   | Account hardening (see SEC-1.1), CI workflow design            |
| **Constraints** | No real token values in this document; no Global API Key usage |

---

## 2. Prohibited Practices

| ID      | Practice                      | Reason                                | Remediation                             |
| ------- | ----------------------------- | ------------------------------------- | --------------------------------------- |
| **P-1** | Global API Key usage          | Full account access, cannot be scoped | Replace with scoped token per Section 3 |
| **P-2** | Shared tokens across purposes | Violates least privilege              | Create separate tokens per function     |
| **P-3** | Tokens without owner          | No accountability for rotation        | Assign owner per Section 5              |
| **P-4** | Tokens stored in plaintext    | Credential exposure risk              | Use GitHub Secrets or password manager  |
| **P-5** | Overly permissive scopes      | Excessive blast radius                | Follow exact scopes in Section 3        |

---

## 3. Token Types and Scopes

### 3.1 Token Inventory

| Token Name         | Secret Name       | Purpose                   | Blast Radius              |
| ------------------ | ----------------- | ------------------------- | ------------------------- |
| **WORKER_DEPLOY**  | `CF_DEPLOY_TOKEN` | CI/CD Worker deployments  | Worker code + routes only |
| **DNS_EDIT**       | `CF_DNS_TOKEN`    | DNS record management     | DNS records only          |
| **READONLY_AUDIT** | `CF_AUDIT_TOKEN`  | Compliance and monitoring | Read-only (no mutations)  |

### 3.2 WORKER_DEPLOY Token

**Purpose:** Automated Worker deployments from CI/CD pipelines.

| Permission         | Level    | Scope                  | Required    |
| ------------------ | -------- | ---------------------- | ----------- |
| Workers Scripts    | **Edit** | Account                | Yes         |
| Workers Routes     | **Edit** | Zone: `eventangle.com` | Yes         |
| Workers KV Storage | **Edit** | Account                | If using KV |
| Account Settings   | **Read** | Account                | Yes         |

**Zone Restrictions:**

- **Include:** `eventangle.com` (and all subdomains)
- **Exclude:** All other zones

**What This Token CAN Do:**

- Deploy Worker code to staging and production
- Create, update, and delete Worker routes
- Read and write KV namespaces
- View account settings

**What This Token CANNOT Do:**

- Edit DNS records
- Manage Cloudflare Access policies
- Configure SSL/TLS settings
- Manage WAF rules or firewall
- Access billing information
- Add or remove account members

---

### 3.3 DNS_EDIT Token

**Purpose:** DNS record management for infrastructure changes.

| Permission | Level    | Scope                  | Required |
| ---------- | -------- | ---------------------- | -------- |
| DNS        | **Edit** | Zone: `eventangle.com` | Yes      |

**Zone Restrictions:**

- **Include:** `eventangle.com` only
- **Exclude:** All other zones

**What This Token CAN Do:**

- Create, update, and delete DNS records (A, AAAA, CNAME, TXT, MX, etc.)
- Manage DNSSEC settings (if DNS Edit includes DNSSEC)

**What This Token CANNOT Do:**

- Deploy Workers
- Edit Worker routes
- Manage Cloudflare Access
- Configure SSL/TLS settings
- Manage WAF rules
- Access billing or account settings

**Storage Note:** This token should NOT be stored in GitHub Secrets unless DNS automation is required. Store in a secure password manager for manual operations.

---

### 3.4 READONLY_AUDIT Token

**Purpose:** Read-only access for compliance audits, monitoring dashboards, and security reviews.

| Permission                                            | Level    | Scope     | Required |
| ----------------------------------------------------- | -------- | --------- | -------- |
| Account Settings                                      | **Read** | Account   | Yes      |
| Analytics                                             | **Read** | Account   | Yes      |
| Audit Logs                                            | **Read** | Account   | Yes      |
| Zone                                                  | **Read** | All zones | Yes      |
| DNS                                                   | **Read** | All zones | Yes      |
| Workers Scripts                                       | **Read** | Account   | Yes      |
| Access: Organizations, Identity Providers, and Groups | **Read** | Account   | Optional |

**Zone Restrictions:**

- **Include:** All zones (read-only is safe)

**What This Token CAN Do:**

- View all account configuration
- Read analytics and audit logs
- View DNS records and zone settings
- View deployed Worker code
- Monitor Access policies (if permission granted)

**What This Token CANNOT Do:**

- Modify any configuration
- Deploy or delete Workers
- Edit DNS records
- Change Access policies
- Perform any write operation

**Safety Assurance:** This token is safe for audit purposes because all permissions are read-only. Even if exposed, an attacker can only view configuration—not modify it.

---

## 4. Token Capability Matrix

| Capability             | WORKER_DEPLOY | DNS_EDIT | READONLY_AUDIT   | Global Key       |
| ---------------------- | ------------- | -------- | ---------------- | ---------------- |
| Deploy Workers         | ✅            | ❌       | ❌               | ✅               |
| Edit Worker Routes     | ✅            | ❌       | ❌               | ✅               |
| Read/Write KV          | ✅            | ❌       | ❌               | ✅               |
| Edit DNS Records       | ❌            | ✅       | ❌               | ✅               |
| View Analytics         | ❌            | ❌       | ✅               | ✅               |
| View Audit Logs        | ❌            | ❌       | ✅               | ✅               |
| Manage Access Policies | ❌            | ❌       | ❌               | ✅               |
| Manage SSL/TLS         | ❌            | ❌       | ❌               | ✅               |
| Manage WAF/Firewall    | ❌            | ❌       | ❌               | ✅               |
| Manage Billing         | ❌            | ❌       | ❌               | ✅               |
| Add/Remove Members     | ❌            | ❌       | ❌               | ✅               |
| **Blast Radius**       | Worker code   | DNS only | None (read-only) | **FULL ACCOUNT** |

---

## 5. Token Ownership and Rotation

### 5.1 Ownership Matrix

| Token              | Primary Owner       | Backup Owner      | Rotation Authority              |
| ------------------ | ------------------- | ----------------- | ------------------------------- |
| **WORKER_DEPLOY**  | DevOps Lead         | Platform Engineer | DevOps Lead or Security         |
| **DNS_EDIT**       | Infrastructure Lead | DevOps Lead       | Infrastructure Lead or Security |
| **READONLY_AUDIT** | Security Lead       | DevOps Lead       | Security Lead                   |

### 5.2 Rotation Cadence

| Token              | Standard Rotation | Emergency Rotation Trigger         |
| ------------------ | ----------------- | ---------------------------------- |
| **WORKER_DEPLOY**  | Every 90 days     | Exposure, team departure, incident |
| **DNS_EDIT**       | Every 180 days    | Exposure, team departure, incident |
| **READONLY_AUDIT** | Every 180 days    | Exposure, team departure, incident |

### 5.3 Rotation Calendar

Set recurring calendar reminders:

| Token              | Frequency | Example Dates (Q1 2026)    |
| ------------------ | --------- | -------------------------- |
| **WORKER_DEPLOY**  | 90 days   | Jan 5, Apr 5, Jul 5, Oct 5 |
| **DNS_EDIT**       | 180 days  | Jan 5, Jul 5               |
| **READONLY_AUDIT** | 180 days  | Jan 5, Jul 5               |

---

## 6. Incident Response: Revoke/Rotate Process

### 6.1 Emergency Rotation Triggers

Immediately rotate if any of these occur:

| Trigger                               | Severity     | Response Time          |
| ------------------------------------- | ------------ | ---------------------- |
| Token exposed in git commit           | **CRITICAL** | Immediate (< 15 min)   |
| Token exposed in logs                 | **CRITICAL** | Immediate (< 15 min)   |
| Token exposed in error message        | **HIGH**     | < 1 hour               |
| Team member with token access departs | **MEDIUM**   | < 24 hours             |
| Suspicious API activity in audit logs | **HIGH**     | < 1 hour               |
| Routine rotation due                  | **LOW**      | Within rotation window |

### 6.2 Emergency Rotation Procedure

**Step 1: Revoke Immediately (< 5 minutes)**

```
1. Log in to Cloudflare Dashboard
2. Navigate to My Profile → API Tokens
3. Find the compromised token by name
4. Click "Revoke" immediately
5. Confirm revocation
```

**Step 2: Create Replacement Token (< 10 minutes)**

```
1. Click "Create Token"
2. Configure with EXACT permissions from Section 3
3. Apply zone restrictions per token type
4. Create and copy new token value
5. Store temporarily in password manager
```

**Step 3: Update Secrets (< 10 minutes)**

```bash
# For GitHub Secrets (WORKER_DEPLOY)
gh secret set CF_DEPLOY_TOKEN --body "<new-token-value>"

# For local verification
CLOUDFLARE_API_TOKEN_OSE=<new-token> wrangler whoami
```

**Step 4: Verify and Document (< 15 minutes)**

```bash
# Verify token works
wrangler whoami

# Run test deployment (staging)
wrangler deploy --env staging --dry-run
```

Document in incident log:

- Time of discovery
- Time of revocation
- Time of replacement
- Exposure scope assessment
- Root cause (if known)

### 6.3 Incident Notification

| Exposure Type         | Notify                                   |
| --------------------- | ---------------------------------------- |
| Token in public repo  | Security Lead + DevOps Lead + Management |
| Token in private repo | Security Lead + DevOps Lead              |
| Token in CI logs      | Security Lead + DevOps Lead              |
| Team member departure | Token Owner                              |

### 6.4 Post-Incident Actions

| Action                              | Timeline        |
| ----------------------------------- | --------------- |
| Review Cloudflare audit logs        | Within 24 hours |
| Check for unauthorized changes      | Within 24 hours |
| Root cause analysis                 | Within 72 hours |
| Process improvement recommendations | Within 1 week   |

---

## 7. Token Creation Checklist

### 7.1 WORKER_DEPLOY Token Checklist

Before deploying a new WORKER_DEPLOY token, verify:

```
[ ] PERMISSIONS
    [ ] Workers Scripts: Edit (Account scope)
    [ ] Workers Routes: Edit (Zone: eventangle.com)
    [ ] Workers KV Storage: Edit (Account scope) — if using KV
    [ ] Account Settings: Read (Account scope)

[ ] RESTRICTIONS
    [ ] Zone limited to eventangle.com only
    [ ] No DNS permissions granted
    [ ] No Access permissions granted
    [ ] No SSL/TLS permissions granted
    [ ] No WAF/Firewall permissions granted

[ ] STORAGE
    [ ] Token stored in GitHub Secrets as CF_DEPLOY_TOKEN
    [ ] Token NOT stored in plaintext files
    [ ] Token NOT committed to repository

[ ] OWNERSHIP
    [ ] Owner assigned (DevOps Lead)
    [ ] Rotation date set (90 days from creation)
    [ ] Calendar reminder created
```

### 7.2 DNS_EDIT Token Checklist

Before deploying a new DNS_EDIT token, verify:

```
[ ] PERMISSIONS
    [ ] DNS: Edit (Zone: eventangle.com)
    [ ] NO other permissions granted

[ ] RESTRICTIONS
    [ ] Zone limited to eventangle.com only
    [ ] No Workers permissions granted
    [ ] No Access permissions granted
    [ ] No account-level permissions granted

[ ] STORAGE
    [ ] Token stored in secure password manager
    [ ] Token NOT in GitHub Secrets (unless automation required)
    [ ] Token NOT stored in plaintext files

[ ] OWNERSHIP
    [ ] Owner assigned (Infrastructure Lead)
    [ ] Rotation date set (180 days from creation)
    [ ] Calendar reminder created
```

### 7.3 READONLY_AUDIT Token Checklist

Before deploying a new READONLY_AUDIT token, verify:

```
[ ] PERMISSIONS (ALL READ-ONLY)
    [ ] Account Settings: Read
    [ ] Analytics: Read
    [ ] Audit Logs: Read
    [ ] Zone: Read (All zones)
    [ ] DNS: Read (All zones)
    [ ] Workers Scripts: Read
    [ ] NO Edit/Write permissions

[ ] RESTRICTIONS
    [ ] All permissions are Read-only
    [ ] No mutation capabilities
    [ ] Safe for external audit use

[ ] STORAGE
    [ ] Token stored in secure password manager
    [ ] Token NOT in GitHub Secrets (unless automation required)
    [ ] Token NOT stored in plaintext files

[ ] OWNERSHIP
    [ ] Owner assigned (Security Lead)
    [ ] Rotation date set (180 days from creation)
    [ ] Calendar reminder created
```

---

## 8. Verification Tests

### 8.1 WORKER_DEPLOY Token Verification

**Test 1: Token CAN deploy Workers**

```bash
CLOUDFLARE_API_TOKEN_OSE=$CF_DEPLOY_TOKEN wrangler whoami
# Expected: Shows account email and account ID
```

**Test 2: Token CANNOT edit DNS**

```bash
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" \
  -H "Content-Type: application/json"
# Expected: 403 Forbidden or "does not have required permissions"
```

**Test 3: Token CANNOT manage Access**

```bash
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{account_id}/access/apps" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" \
  -H "Content-Type: application/json"
# Expected: 403 Forbidden or "does not have required permissions"
```

### 8.2 DNS_EDIT Token Verification

**Test 1: Token CAN read DNS records**

```bash
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records" \
  -H "Authorization: Bearer $CF_DNS_TOKEN" \
  -H "Content-Type: application/json"
# Expected: 200 OK with DNS records list
```

**Test 2: Token CANNOT deploy Workers**

```bash
CLOUDFLARE_API_TOKEN_OSE=$CF_DNS_TOKEN wrangler whoami
# Expected: Error or limited account info (no Worker permissions)
```

### 8.3 READONLY_AUDIT Token Verification

**Test 1: Token CAN read audit logs**

```bash
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{account_id}/audit_logs" \
  -H "Authorization: Bearer $CF_AUDIT_TOKEN" \
  -H "Content-Type: application/json"
# Expected: 200 OK with audit log entries
```

**Test 2: Token CANNOT modify anything**

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records" \
  -H "Authorization: Bearer $CF_AUDIT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"TXT","name":"test","content":"test"}'
# Expected: 403 Forbidden
```

---

## 9. Related Documents

| Document              | Path                                            | Relationship              |
| --------------------- | ----------------------------------------------- | ------------------------- |
| Account Hardening     | `docs/security/CF_ACCOUNT_HARDENING_RUNBOOK.md` | SEC-1.1 prerequisites     |
| Security Baseline     | `docs/security/SECURITY_BASELINE.md`            | Parent security model     |
| CI Secrets Naming     | `docs/security/CI_SECRET_NAMING.md`             | Secret naming conventions |
| Scoped Tokens Runbook | `docs/RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md`     | Operational procedures    |
| Secrets Inventory     | `docs/CLOUDFLARE_SECRETS.md`                    | Full secrets reference    |

---

## Document History

| Date       | Author      | Changes                                    |
| ---------- | ----------- | ------------------------------------------ |
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-1.2 policy document |
