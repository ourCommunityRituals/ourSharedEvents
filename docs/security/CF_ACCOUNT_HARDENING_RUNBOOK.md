# CF_ACCOUNT_HARDENING_RUNBOOK.md — Cloudflare Account Hardening

> **PROMPTSPEC-SEC-1.1** — Cloudflare Account Hardening Runbook
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

This runbook locks down Cloudflare account access and eliminates common account takeover paths for the EventAngle production environment.

| Attribute | Value |
|-----------|-------|
| **Scope** | Cloudflare account security configuration |
| **Non-Goals** | API token creation (see SEC-1.2) |
| **Constraints** | No credentials stored in this document; no SMS-based MFA |

---

## 2. Prohibited Practices

These practices are **strictly prohibited** and must be remediated immediately if discovered.

| ID | Practice | Reason | Remediation |
|----|----------|--------|-------------|
| **P-1** | **Global API Key usage is prohibited** | Global keys grant full account access; cannot be scoped or rotated independently | Revoke and replace with scoped API tokens (SEC-1.2) |
| **P-2** | Shared account credentials | No individual attribution; impossible to revoke single user | Create individual member accounts |
| **P-3** | SMS-based MFA | Vulnerable to SIM swapping and SS7 attacks | Use hardware keys or TOTP only |
| **P-4** | Email-only authentication | Single factor is insufficient | Enable MFA immediately |
| **P-5** | Unrecognized active sessions | May indicate compromised account | Revoke and investigate |
| **P-6** | Multiple Super Administrator accounts | Increases attack surface | Reduce to single owner |

> **CRITICAL:** Global API Key is prohibited. Any automation using the Global API Key must be migrated to scoped API tokens immediately. See PROMPTSPEC-SEC-1.2 for token creation procedures.

---

## 3. MFA Policy

### 3.1 Requirements

| Role | MFA Requirement | Acceptable Methods |
|------|-----------------|-------------------|
| Super Administrator (Owner) | **MANDATORY** | Hardware security key (FIDO2/WebAuthn) |
| Administrator | **MANDATORY** | Hardware security key (preferred) or TOTP |
| All other members | **MANDATORY** | Hardware security key (preferred) or TOTP |

### 3.2 Hardware Key Preference Order

1. **FIDO2/WebAuthn hardware keys** (e.g., YubiKey 5 series) — Preferred
2. **TOTP authenticator app** (e.g., 1Password, Authy, Google Authenticator) — Acceptable
3. **SMS** — **PROHIBITED** (vulnerable to SIM swapping)

### 3.3 Hardware Key Configuration

Each privileged user SHOULD register **two hardware keys**:
- Primary key (daily use)
- Backup key (stored securely offline)

---

## 4. Owner/Member Policy

### 4.1 Owner Limit

| Requirement | Value |
|-------------|-------|
| Maximum Super Administrators | **1** |
| Owner account type | Individual (not shared) |
| Owner MFA | Hardware key required |

### 4.2 Role Assignment (Least Privilege)

| Use Case | Recommended Role | Permissions |
|----------|------------------|-------------|
| Full account control | Super Administrator | All (limit to 1 person) |
| DNS management only | DNS Administrator | DNS read/write only |
| Worker deployment (CI/CD) | **Use API Token** | Scoped to Workers only |
| Analytics viewing | Analytics Reader | Read-only analytics |
| Firewall rule management | Firewall Administrator | WAF/Firewall rules only |

### 4.3 Member Audit Requirements

| Check | Frequency | Action |
|-------|-----------|--------|
| Review all members | Monthly | Remove inactive/unknown members |
| Verify member roles | Monthly | Downgrade over-privileged accounts |
| Confirm MFA enabled | Monthly | Enforce MFA on any account without it |

---

## 5. Session Hygiene

### 5.1 Session Review

| Check | Action |
|-------|--------|
| Unknown device in active sessions | Revoke immediately, investigate |
| Session from unexpected geography | Revoke immediately, investigate |
| Session older than 30 days | Consider revoking |
| Multiple concurrent sessions | Verify legitimacy |

### 5.2 Session Revocation Procedure

1. Navigate to **My Profile** → **Sessions**
2. Review each active session for:
   - Recognized device/browser
   - Expected IP address/location
   - Reasonable last activity time
3. Click **Revoke** on any suspicious session
4. If compromise suspected: Change password immediately, then revoke all sessions

### 5.3 Post-Incident Actions

If an unknown session is discovered:

1. Revoke the session immediately
2. Rotate account password
3. Review audit logs for unauthorized changes
4. Check for new API tokens (revoke if unauthorized)
5. Verify DNS records unchanged
6. Verify Worker deployments unchanged
7. Document incident

---

## 6. Audit Log Review

### 6.1 Review Cadence

| Log Type | Review Frequency | Reviewer |
|----------|------------------|----------|
| Authentication events | Weekly | Security lead |
| Member changes | Weekly | Security lead |
| API token creation/deletion | Weekly | Security lead |
| DNS changes | After each change | DNS administrator |
| Worker deployments | After each deployment | DevOps lead |

### 6.2 Audit Log Access

1. Navigate to **Manage Account** → **Audit Log**
2. Filter by date range and action type
3. Export logs monthly for retention

### 6.3 Alert-Worthy Events

Immediately investigate these audit log entries:

| Event | Severity | Action |
|-------|----------|--------|
| New Super Administrator added | Critical | Verify authorization |
| Global API Key viewed/copied | Critical | Determine who and why |
| New API token created | High | Verify scope is minimal |
| MFA disabled on any account | High | Re-enable immediately |
| Member added from unknown email | High | Verify authorization |
| DNS record modified | Medium | Verify change was authorized |
| Password reset requested | Medium | Confirm user initiated |

---

## 7. UI Execution Checklist

Complete this checklist in the Cloudflare dashboard to harden the account.

### 7.1 Initial Hardening Checklist

Execute these steps in order:

```
[ ] 1. OWNER MFA
    Dashboard → My Profile → Authentication
    → Verify hardware key is registered
    → If not: Add hardware security key (WebAuthn)
    → Remove any SMS-based MFA methods

[ ] 2. MEMBER AUDIT
    Dashboard → Manage Account → Members
    → Count Super Administrators (must be exactly 1)
    → Remove any unknown or inactive members
    → Verify each member has appropriate role (least privilege)

[ ] 3. MEMBER MFA ENFORCEMENT
    Dashboard → Manage Account → Members
    → Check "2FA" column for each member
    → Contact any member without MFA to enable it
    → Consider enabling "Require 2FA for all members" if available

[ ] 4. SESSION REVIEW
    Dashboard → My Profile → Sessions
    → Review all active sessions
    → Revoke any unrecognized devices/locations
    → Revoke sessions older than 30 days

[ ] 5. API TOKEN AUDIT (preparation for SEC-1.2)
    Dashboard → My Profile → API Tokens
    → List all existing tokens
    → Note any using Global API Key (to be replaced)
    → Do NOT create new tokens yet (see SEC-1.2)

[ ] 6. GLOBAL API KEY STATUS
    Dashboard → My Profile → API Tokens → View Global API Key
    → Document if it has ever been viewed/copied
    → Plan migration to scoped tokens (SEC-1.2)
    → Note: Do not use Global API Key for any new automation

[ ] 7. AUDIT LOG BASELINE
    Dashboard → Manage Account → Audit Log
    → Export last 30 days of logs
    → Review for any suspicious activity
    → Bookmark for weekly review
```

### 7.2 Ongoing Maintenance Checklist (Monthly)

```
[ ] Review member list for inactive/unknown accounts
[ ] Verify all members have MFA enabled
[ ] Review audit logs for suspicious activity
[ ] Check for any new API tokens created
[ ] Verify session list contains only recognized devices
[ ] Confirm Super Administrator count is still 1
```

---

## 8. Verification

### 8.1 Manual Confirmation Checklist

A security reviewer can verify compliance by answering these questions:

| # | Question | Expected Answer | How to Verify |
|---|----------|-----------------|---------------|
| 1 | Is MFA enabled on the owner account? | Yes, hardware key | My Profile → Authentication |
| 2 | How many Super Administrators exist? | Exactly 1 | Manage Account → Members |
| 3 | Are all members using MFA? | Yes | Members list, 2FA column |
| 4 | Are there any unknown active sessions? | No | My Profile → Sessions |
| 5 | Is Global API Key in use? | No (prohibited) | Check CI/CD configs, API Token list |
| 6 | When was the last audit log review? | Within 7 days | Internal records |
| 7 | Are there any shared account credentials? | No | Member list shows individual emails |

### 8.2 Compliance Summary

| Control | Compliant | Non-Compliant |
|---------|-----------|---------------|
| Owner MFA | Hardware key registered | No MFA or SMS only |
| Member count | ≤5 with defined roles | Excessive members or shared accounts |
| Super Admin count | Exactly 1 | 0 or >1 |
| Session hygiene | All sessions recognized | Unknown sessions present |
| Global API Key | Never used | Any automation uses Global Key |
| Audit log review | Weekly | >30 days since last review |

---

## 9. Related Documents

| Document | Path | Relationship |
|----------|------|--------------|
| Security Baseline | `docs/security/SECURITY_BASELINE.md` | Parent security model |
| Scoped API Tokens | PROMPTSPEC-SEC-1.2 (pending) | Next step: token creation |
| Registrar Lock | PROMPTSPEC-SEC-2.1 (pending) | Domain protection |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-1.1 runbook |
