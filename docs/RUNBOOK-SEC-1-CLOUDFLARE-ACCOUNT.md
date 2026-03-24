# Runbook: Cloudflare Account Hardening

> **Epic SEC-1 — Cloudflare Account Hardening**
> Story SEC-1.1 — Enforce Strong MFA + Remove Unsafe Auth Paths
>
> Created: 2025-12-20
> Last Updated: 2025-12-20
> Status: Active

---

## Table of Contents

1. [Overview](#1-overview)
2. [Pre-Requisites](#2-pre-requisites)
3. [MFA Enforcement](#3-mfa-enforcement)
4. [Member Audit & Cleanup](#4-member-audit--cleanup)
5. [Session Management](#5-session-management)
6. [Audit Logging](#6-audit-logging)
7. [Verification Checklist](#7-verification-checklist)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Overview

### 1.1 Goal

Make Cloudflare account takeover difficult by:
- Requiring MFA for all members (hardware key preferred)
- Removing unused members and sessions
- Confirming audit logging is enabled/available

### 1.2 Why This Matters

The Cloudflare account is the root of trust for EventAngle infrastructure. If compromised:
- Attackers could redirect DNS to malicious servers
- Workers could be modified to exfiltrate data
- SSL/TLS certificates could be issued for phishing domains
- All secrets stored in Workers could be exposed

**If this isn't locked down, everything else is cosplay.**

### 1.3 Scope

| Component | In Scope |
|-----------|----------|
| Cloudflare Dashboard access | Yes |
| API token security | Yes (covered in SEC-1.2) |
| DNS management access | Yes |
| Worker deployment access | Yes |

---

## 2. Pre-Requisites

### 2.1 Required Access

- [ ] Cloudflare account owner or Super Administrator access
- [ ] Access to enrolled members' contact information
- [ ] Hardware security key (YubiKey, Titan, etc.) for owner account

### 2.2 Required Information

Before starting, gather:

| Information | Source | Status |
|-------------|--------|--------|
| List of expected members | Team roster | |
| Member email addresses | HR/Team records | |
| Last login dates | Cloudflare dashboard | |
| Account plan level | Cloudflare dashboard | |

---

## 3. MFA Enforcement

### 3.1 MFA Hierarchy (Strongest to Weakest)

| Tier | Method | Recommendation |
|------|--------|----------------|
| 1 | Hardware Security Key (FIDO2/WebAuthn) | **REQUIRED for Owner** |
| 2 | Hardware Security Key (U2F) | Acceptable |
| 3 | Authenticator App (TOTP) | Acceptable for non-admin members |
| 4 | SMS/Email OTP | **NOT ACCEPTABLE** |
| 5 | No MFA | **PROHIBITED** |

### 3.2 Enable MFA for Your Account

**Path:** Profile > Authentication > Two-Factor Authentication

#### Step 1: Access MFA Settings

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click your profile icon (top-right)
3. Select **My Profile**
4. Navigate to **Authentication** tab

#### Step 2: Add Hardware Security Key (Recommended)

1. Click **Manage** next to "Security Keys"
2. Click **Add Security Key**
3. Insert your hardware key (YubiKey, Titan, etc.)
4. Follow browser prompts to register the key
5. Name the key (e.g., "Primary YubiKey", "Backup Titan")
6. **CRITICAL:** Register at least 2 hardware keys for redundancy

#### Step 3: Add Backup TOTP (Secondary)

1. Click **Manage** next to "Authenticator App"
2. Scan QR code with authenticator app (Authy, 1Password, etc.)
3. Enter verification code
4. **Store backup codes securely** (password manager or secure offline storage)

### 3.3 Enforce MFA for All Members

**Path:** Account > Members

> **Note:** Cloudflare's MFA enforcement depends on your plan level:
> - **Free/Pro:** Cannot enforce MFA at account level; must educate members
> - **Business:** Can set MFA policy
> - **Enterprise:** Full MFA enforcement with SSO integration

#### For Free/Pro Plans (Manual Enforcement)

1. **Document MFA Requirement:**
   - Add MFA requirement to team security policy
   - Communicate requirement to all members

2. **Audit Each Member:**
   ```
   For each member in Account > Members:
   1. Request confirmation of MFA enrollment
   2. Verify MFA type (hardware key vs. TOTP)
   3. Document in member audit log below
   ```

3. **Follow Up:**
   - Members without MFA must enable within 24 hours
   - Non-compliant members should be removed

#### For Business/Enterprise Plans

1. Navigate to **Account** > **Settings**
2. Locate **Authentication Policy** section
3. Enable **Require two-factor authentication**
4. Set minimum MFA level (if available)

### 3.4 Member MFA Audit Log

Complete this table for each member:

| Member Email | Role | MFA Type | Hardware Key | Last Verified | Status |
|--------------|------|----------|--------------|---------------|--------|
| owner@example.com | Owner | HW Key + TOTP | Yes (2 keys) | YYYY-MM-DD | Compliant |
| admin@example.com | Admin | TOTP | No | YYYY-MM-DD | Action Required |
| | | | | | |
| | | | | | |

---

## 4. Member Audit & Cleanup

### 4.1 Access Member List

**Path:** Account > Members

### 4.2 Member Review Process

For each member, answer:

| Question | Yes Action | No Action |
|----------|------------|-----------|
| Is this person still on the team? | Continue review | Remove immediately |
| Do they need Cloudflare access for their role? | Continue review | Remove immediately |
| Is their access level appropriate? | Continue review | Adjust permissions |
| Have they logged in within 90 days? | Mark as active | Investigate / Remove |
| Is MFA enabled? | Mark as compliant | Require MFA or remove |

### 4.3 Remove Unused Members

**Warning:** Before removing, ensure:
- [ ] Member is confirmed as departed or no longer needing access
- [ ] Any API tokens created by this member are documented
- [ ] Critical configurations are not tied to their account

**Steps:**

1. Navigate to **Account** > **Members**
2. Find the member to remove
3. Click the **three dots** menu (...)
4. Select **Remove from Account**
5. Confirm removal
6. Document in removal log below

### 4.4 Member Removal Log

| Member Email | Role | Removal Date | Reason | Removed By |
|--------------|------|--------------|--------|------------|
| | | | | |
| | | | | |

### 4.5 Principle of Least Privilege

Review member roles and ensure appropriate access:

| Role | Access Level | Appropriate For |
|------|--------------|-----------------|
| Super Administrator | Full account control | Account owner only |
| Administrator | Most account settings | Senior DevOps only |
| Cloudflare Zero Trust | Access, Gateway | Security team |
| Cloudflare Stream/Images | Media features | Media team |
| Cloudflare Workers | Workers, Pages | Developers |
| Analytics | Read-only analytics | All team members |
| Audit Logs | View audit logs | Security/Compliance |
| Billing | Billing management | Finance only |

---

## 5. Session Management

### 5.1 View Active Sessions

**Path:** Profile > Sessions

### 5.2 Session Audit

Review each active session:

| Session | Device | Location | Last Active | Expected? |
|---------|--------|----------|-------------|-----------|
| | | | | Yes/No |
| | | | | Yes/No |
| | | | | Yes/No |

### 5.3 Revoke Suspicious Sessions

If you see unexpected sessions:

1. Click **Revoke** next to the suspicious session
2. Immediately change your password
3. Review API tokens for unauthorized access
4. Document incident and investigate

### 5.4 Force Session Logout (All Devices)

If compromise is suspected:

1. Navigate to Profile > Sessions
2. Click **Revoke All** (if available)
3. Change password immediately
4. Re-authenticate only from trusted devices
5. Review all API tokens and regenerate if needed

### 5.5 Session Timeout Recommendations

| Setting | Recommended Value |
|---------|-------------------|
| Session duration | 8 hours (work day) |
| Idle timeout | 30 minutes |
| Remember device | Disable for sensitive accounts |

---

## 6. Audit Logging

### 6.1 Cloudflare Audit Log Availability

| Plan | Audit Log Access | Retention |
|------|------------------|-----------|
| Free | Limited (recent only) | 24 hours |
| Pro | Limited | 72 hours |
| Business | Full | 7 days |
| Enterprise | Full | 18 months + export |

### 6.2 Access Audit Logs

**Path:** Account > Audit Log

### 6.3 Verify Audit Logging

1. Navigate to **Account** > **Audit Log**
2. Confirm you can see recent events
3. Test by making a benign change (e.g., add/remove a page rule)
4. Verify the change appears in audit log
5. Document log availability status below

### 6.4 Audit Log Status

| Item | Status | Notes |
|------|--------|-------|
| Audit log accessible | Yes/No | |
| Current plan level | Free/Pro/Business/Enterprise | |
| Log retention period | | |
| Export capability | Yes/No | |
| Last verified | YYYY-MM-DD | |

### 6.5 Critical Events to Monitor

Configure alerts (if available) for:

| Event Type | Severity | Alert |
|------------|----------|-------|
| Member added | High | Yes |
| Member removed | High | Yes |
| Member role changed | High | Yes |
| API token created | High | Yes |
| API token deleted | Medium | Yes |
| DNS record changed | Critical | Yes |
| Worker deployed | High | Yes |
| Page Rule changed | High | Yes |
| SSL certificate changed | Critical | Yes |
| MFA disabled | Critical | Yes |

### 6.6 Audit Log Export (Enterprise)

If on Enterprise plan, configure:

1. Regular export to SIEM (Splunk, Datadog, etc.)
2. Long-term retention in secure storage
3. Alert rules for critical events

---

## 7. Verification Checklist

### 7.1 Acceptance Criteria Verification

| Criterion | How to Verify | Status |
|-----------|---------------|--------|
| MFA enabled for owner | Profile > Authentication shows active MFA | [ ] Pass |
| MFA enabled for all members | All members confirmed MFA enabled | [ ] Pass |
| Hardware key for owner | Profile shows registered security key | [ ] Pass |
| No unknown members | Member list matches expected roster | [ ] Pass |
| No stale members (>90 days inactive) | All members logged in recently | [ ] Pass |
| No unknown sessions | All sessions recognized | [ ] Pass |
| Audit logging confirmed | Audit log accessible and working | [ ] Pass |

### 7.2 Login Without MFA Test

**Test:** Attempt login without completing MFA

**Expected Result:** Login should fail or be blocked

**Steps:**
1. Log out of Cloudflare
2. Start login with email/password
3. When prompted for MFA, do not complete
4. Verify access is denied

**Result:** [ ] Pass / [ ] Fail

### 7.3 Compromised Session Test

**Test:** Verify session can be revoked

**Steps:**
1. Log in from two different devices/browsers
2. From device A, revoke the session for device B
3. Verify device B is immediately logged out

**Result:** [ ] Pass / [ ] Fail

---

## 8. Troubleshooting

### 8.1 Lost Hardware Key

If hardware security key is lost:

1. Use backup hardware key (if registered)
2. Use backup TOTP codes
3. Contact Cloudflare support with identity verification

**Prevention:**
- Always register 2+ hardware keys
- Store backup codes securely
- Have TOTP as secondary backup

### 8.2 Member Cannot Enable MFA

Common issues:

| Issue | Solution |
|-------|----------|
| No compatible authenticator | Recommend Authy, 1Password, Google Authenticator |
| Browser doesn't support WebAuthn | Use Chrome, Firefox, Edge, Safari |
| Hardware key not recognized | Try different USB port, check key compatibility |

### 8.3 Locked Out of Account

If locked out:

1. Try backup codes
2. Try backup MFA method
3. Contact Cloudflare support: https://support.cloudflare.com
4. Provide identity verification documents

---

## Appendix A: Cloudflare Dashboard Quick Links

| Page | URL |
|------|-----|
| Profile Settings | https://dash.cloudflare.com/profile |
| Authentication/MFA | https://dash.cloudflare.com/profile/authentication |
| Active Sessions | https://dash.cloudflare.com/profile/sessions |
| Account Members | https://dash.cloudflare.com/{account_id}/members |
| Audit Log | https://dash.cloudflare.com/{account_id}/audit-log |
| API Tokens | https://dash.cloudflare.com/profile/api-tokens |

---

## Appendix B: Security Contacts

| Contact | Purpose |
|---------|---------|
| Cloudflare Support | https://support.cloudflare.com |
| Cloudflare Security | security@cloudflare.com |
| Cloudflare Status | https://www.cloudflarestatus.com |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2025-12-20 | Claude Code | Initial runbook (SEC-1.1) |
