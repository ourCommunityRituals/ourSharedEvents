# Runbook: Registrar Lock + MFA + Recovery Hygiene

> **Epic SEC-2 — Domain Control (DNS/Registrar Takeover Prevention)**
> Story SEC-2.1 — Registrar Lock + MFA + Recovery Hygiene
>
> Created: 2025-12-20
> Last Updated: 2025-12-20
> Status: Active

---

## Table of Contents

1. [Overview](#1-overview)
2. [Pre-Requisites](#2-pre-requisites)
3. [Registrar Lock](#3-registrar-lock)
4. [Registrar MFA](#4-registrar-mfa)
5. [Recovery Methods](#5-recovery-methods)
6. [Verification Checklist](#6-verification-checklist)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Overview

### 1.1 Goal

Prevent domain hijacking by:
- Enabling registrar lock to prevent unauthorized transfers
- Requiring MFA for all registrar account access
- Verifying and securing recovery email, phone, and backup codes

### 1.2 Why This Matters

The domain registrar is the ultimate root of trust for any web property. If compromised:
- Attackers can transfer the domain to their control
- DNS records can be modified to redirect all traffic
- SSL certificates can be issued for the stolen domain
- Email (MX records) can be redirected to intercept sensitive communications
- Brand reputation can be permanently damaged

**Domain hijacking is often irreversible or extremely costly to recover from.**

### 1.3 Threat Model

| Threat | Attack Vector | Impact |
|--------|--------------|--------|
| Social engineering | Attacker convinces registrar support to transfer domain | Complete domain loss |
| Account takeover | Weak password or credential stuffing | Complete domain loss |
| Email compromise | Password reset via compromised recovery email | Complete domain loss |
| SIM swap | MFA bypass via phone number takeover | Account access |
| Insider threat | Malicious employee at registrar | Domain modification |
| Expired domain | Failure to renew, domain purchased by attacker | Complete domain loss |

### 1.4 Scope

| Component | In Scope |
|-----------|----------|
| Domain registrar account security | Yes |
| Registrar lock (clientTransferProhibited) | Yes |
| Registrar MFA configuration | Yes |
| Recovery email/phone verification | Yes |
| Backup codes storage | Yes |
| Domain auto-renewal settings | Yes |
| WHOIS privacy settings | Yes |

---

## 2. Pre-Requisites

### 2.1 Required Access

- [ ] Domain registrar account owner access
- [ ] Access to recovery email account
- [ ] Access to recovery phone number
- [ ] Hardware security key (recommended for MFA)
- [ ] Secure location for backup codes (password manager or physical safe)

### 2.2 Required Information

Before starting, gather:

| Information | Source | Status |
|-------------|--------|--------|
| Registrar name | Domain registration records | |
| Domain(s) managed | Registrar dashboard | |
| Current account email | Registrar account settings | |
| Current recovery email | Registrar account settings | |
| Current recovery phone | Registrar account settings | |
| Domain expiration date(s) | Registrar dashboard | |
| Current lock status | Registrar/WHOIS | |

### 2.3 Registrar Identification

Common registrars and their security features:

| Registrar | Registrar Lock | MFA Options | Registry Lock |
|-----------|----------------|-------------|---------------|
| Cloudflare Registrar | Yes | TOTP, HW Key | No (uses CF account MFA) |
| Google Domains | Yes | Google Account MFA | No |
| Namecheap | Yes | TOTP, U2F | Yes (premium) |
| GoDaddy | Yes | TOTP, SMS | Yes (premium) |
| Porkbun | Yes | TOTP | No |
| Name.com | Yes | TOTP | No |
| Gandi | Yes | TOTP, U2F | No |

---

## 3. Registrar Lock

### 3.1 What is Registrar Lock?

Registrar lock (also called "Domain Lock" or "Transfer Lock") sets the EPP status code `clientTransferProhibited` on the domain, preventing:
- Domain transfers to another registrar
- Unauthorized changes to WHOIS/registration data
- Domain hijacking via transfer requests

### 3.2 Lock Status Hierarchy

| Lock Type | Protection Level | Who Can Remove |
|-----------|-----------------|----------------|
| **Registrar Lock** (clientTransferProhibited) | Standard | Domain owner via dashboard |
| **Registry Lock** | Enhanced | Registrar + manual verification |
| **DNSSEC** | Integrity | Prevents DNS response tampering |

### 3.3 Check Current Lock Status

#### Via WHOIS Lookup

```bash
# Check domain status
whois eventangle.com | grep -i "status"

# Expected output for locked domain:
# Domain Status: clientTransferProhibited
```

#### Via Registrar Dashboard

1. Log in to your registrar
2. Navigate to domain management
3. Look for "Transfer Lock", "Domain Lock", or "Registrar Lock" setting
4. Document current status

### 3.4 Enable Registrar Lock

#### General Steps (Most Registrars)

1. Log in to registrar dashboard
2. Navigate to **Domain Management** or **My Domains**
3. Select the domain (e.g., `eventangle.com`)
4. Find **Domain Lock** or **Transfer Lock** section
5. Toggle lock to **ON** or **Enabled**
6. Confirm the change

#### Cloudflare Registrar

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your account
3. Go to **Domain Registration** > **Manage Domains**
4. Select the domain
5. Under **Configuration**, find **Registrar Lock**
6. Ensure it shows **Locked**

> **Note:** Cloudflare Registrar locks domains by default.

#### Namecheap

1. Log in to Namecheap dashboard
2. Go to **Domain List**
3. Click **Manage** next to the domain
4. In the **Domain** tab, find **Domain Lock**
5. Toggle to **ON**

#### GoDaddy

1. Log in to GoDaddy account
2. Go to **My Products** > **Domains**
3. Select the domain
4. Click **Domain Settings**
5. Find **Domain Lock** and toggle to **On**

### 3.5 Registrar Lock Audit Log

| Domain | Registrar | Lock Status | Last Verified | Verified By |
|--------|-----------|-------------|---------------|-------------|
| eventangle.com | | [ ] Locked / [ ] Unlocked | YYYY-MM-DD | |
| | | | | |

---

## 4. Registrar MFA

### 4.1 MFA Hierarchy (Strongest to Weakest)

| Tier | Method | Recommendation |
|------|--------|----------------|
| 1 | Hardware Security Key (FIDO2/WebAuthn) | **REQUIRED for domain owner** |
| 2 | Hardware Security Key (U2F) | Acceptable |
| 3 | Authenticator App (TOTP) | Acceptable as backup |
| 4 | SMS/Voice OTP | **NOT ACCEPTABLE** (SIM swap risk) |
| 5 | Email OTP | **NOT ACCEPTABLE** (email compromise risk) |
| 6 | No MFA | **PROHIBITED** |

### 4.2 Enable Registrar MFA

#### General Steps

1. Log in to registrar dashboard
2. Navigate to **Account Settings** or **Security**
3. Find **Two-Factor Authentication** or **2FA**
4. Choose authentication method (hardware key preferred)
5. Complete enrollment
6. **Save backup codes securely**

#### Cloudflare Registrar

Cloudflare Registrar uses your Cloudflare account authentication. Follow [RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md](./RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md) for MFA setup.

#### Namecheap

1. Go to **Account** > **Profile** > **Security**
2. Click **Enable** under Two-Factor Authentication
3. Choose **Google Authenticator** or **U2F Security Key**
4. Follow the prompts to complete setup
5. Save backup codes

#### GoDaddy

1. Go to **Account Settings** > **Login & PIN**
2. Under **2-Step Verification**, click **Add verification**
3. Choose **Authenticator app** (avoid SMS)
4. Scan QR code and verify
5. Save backup codes

### 4.3 MFA Verification Test

After enabling MFA:

1. Log out of registrar account
2. Attempt to log in with password only
3. Verify MFA is required to complete login
4. Test backup code (optional - regenerate after testing)

### 4.4 Registrar MFA Audit Log

| Registrar Account | MFA Type | Hardware Key | Backup Codes Saved | Last Verified |
|-------------------|----------|--------------|-------------------|---------------|
| | HW Key / TOTP / SMS | Yes / No | Yes / No | YYYY-MM-DD |

---

## 5. Recovery Methods

### 5.1 Recovery Email

#### Requirements

- [ ] Recovery email is **different** from registrar login email
- [ ] Recovery email account has strong MFA enabled
- [ ] Recovery email is accessible (not expired, not compromised)
- [ ] Recovery email is not a shared/team mailbox (for individual ownership)

#### Verification Steps

1. Locate current recovery email in registrar settings
2. Send test email to recovery address
3. Confirm receipt of test email
4. Verify recovery email account has MFA enabled

#### Update Recovery Email

1. Navigate to registrar account security settings
2. Find **Recovery Email** or **Backup Email**
3. Enter new recovery email address
4. Complete verification (usually email confirmation link)
5. Verify old email is removed if necessary

### 5.2 Recovery Phone

#### Requirements

- [ ] Recovery phone is a **personal mobile** (not VoIP or Google Voice)
- [ ] SIM is secured with PIN (contact carrier)
- [ ] Phone number is not publicly associated with domain WHOIS
- [ ] Consider using a dedicated phone for critical accounts

#### SIM Swap Protection

Contact your mobile carrier to enable:

| Protection | Description | Carrier Support |
|------------|-------------|-----------------|
| **SIM PIN** | 4-8 digit PIN required to use SIM | All carriers |
| **Account PIN** | PIN required for account changes | Most carriers |
| **Port freeze** | Prevent number porting | Some carriers |
| **Extra verification** | In-person ID for SIM changes | Premium feature |

#### Verification Steps

1. Locate current recovery phone in registrar settings
2. Trigger a test SMS or call (if registrar supports)
3. Confirm receipt of test message
4. Verify carrier-level SIM protection is enabled

### 5.3 Backup Codes

#### Requirements

- [ ] Backup codes are generated and saved
- [ ] Backup codes are stored in password manager OR physical safe
- [ ] Backup codes are **NOT** stored in:
  - Plain text files on computer
  - Email drafts
  - Cloud notes without encryption
  - Same location as password

#### Best Practices for Backup Code Storage

| Method | Security Level | Recovery Speed |
|--------|---------------|----------------|
| Password manager (1Password, Bitwarden) | High | Fast |
| Physical safe (printed) | Very High | Medium |
| Encrypted USB drive | High | Medium |
| Bank safe deposit box | Very High | Slow |

#### Generate and Save Backup Codes

1. Navigate to registrar MFA settings
2. Find **Backup Codes** or **Recovery Codes**
3. Click **Generate** or **View** codes
4. **Immediately** save codes to secure location
5. Verify codes are saved before closing

### 5.4 Recovery Methods Audit Log

| Account | Recovery Email | Email MFA | Recovery Phone | SIM Protected | Backup Codes |
|---------|---------------|-----------|----------------|---------------|--------------|
| | verified@... | Yes / No | +1... | Yes / No | Saved / Not Saved |

---

## 6. Verification Checklist

### 6.1 Acceptance Criteria Verification

| Criterion | How to Verify | Status |
|-----------|---------------|--------|
| **Registrar lock enabled** | WHOIS shows `clientTransferProhibited` | [ ] Pass |
| **MFA enabled** | Login requires MFA completion | [ ] Pass |
| **Recovery email verified** | Test email received, MFA on recovery account | [ ] Pass |
| **Recovery phone verified** | Test SMS/call received | [ ] Pass |
| **SIM protection enabled** | Carrier confirms PIN/freeze | [ ] Pass |
| **Backup codes saved** | Codes accessible in secure storage | [ ] Pass |

### 6.2 Lock Verification Test

**Test:** Verify domain cannot be transferred without explicit unlock

1. Log in to registrar
2. Navigate to domain transfer/unlock settings
3. Verify **Registrar Lock** shows as **Enabled**
4. Check WHOIS for `clientTransferProhibited` status

**Result:** [ ] Pass / [ ] Fail

### 6.3 MFA Login Test

**Test:** Verify login fails without MFA

1. Log out of registrar
2. Enter username and password
3. At MFA prompt, do NOT complete MFA
4. Verify access is denied

**Result:** [ ] Pass / [ ] Fail

### 6.4 Recovery Test (Optional)

**Test:** Verify account recovery works

1. Initiate password reset flow
2. Confirm recovery options are displayed correctly
3. **Do NOT complete** if only testing availability
4. If testing full flow, complete recovery and re-enable MFA

**Result:** [ ] Pass / [ ] Fail

### 6.5 Domain Expiration Audit

| Domain | Expiration Date | Auto-Renew | Days Until Expiry | Status |
|--------|-----------------|------------|-------------------|--------|
| eventangle.com | YYYY-MM-DD | Yes / No | | |

> **Critical:** Enable auto-renewal and ensure payment method is current.

---

## 7. Troubleshooting

### 7.1 Cannot Enable Registrar Lock

| Issue | Cause | Solution |
|-------|-------|----------|
| Lock option greyed out | Recent transfer (60 day lock period) | Wait until transfer lock expires |
| Lock not available | Registrar limitation | Contact support or consider premium lock |
| Lock immediately unlocks | Pending transfer request | Cancel transfer request first |

### 7.2 MFA Issues

| Issue | Solution |
|-------|----------|
| Lost authenticator app | Use backup codes, then re-enroll MFA |
| Lost hardware key | Use backup key or TOTP backup |
| Lost all MFA methods | Contact registrar support with identity verification |
| Authenticator time drift | Sync device clock automatically (NTP) |

### 7.3 Recovery Access Issues

| Issue | Solution |
|-------|----------|
| Recovery email bounces | Update recovery email before it's needed |
| Recovery phone changed | Update immediately after carrier change |
| Cannot access recovery email | Use backup codes and update recovery info |
| SIM swapped | Report to carrier immediately, use backup codes |

### 7.4 Domain Expired

If domain expires:

1. **Grace Period (0-30 days):** Renew at normal price
2. **Redemption Period (30-60 days):** Renew at penalty price ($100+)
3. **Pending Delete (60-75 days):** May be too late, contact registrar
4. **Released:** Domain available for anyone to register

**Prevention:**
- Enable auto-renewal
- Add payment method backup
- Set calendar reminders 90, 60, 30 days before expiry
- Use registrar email notifications

---

## Appendix A: WHOIS Status Codes

| Status Code | Meaning |
|-------------|---------|
| `clientTransferProhibited` | Registrar lock - transfer blocked |
| `clientDeleteProhibited` | Deletion blocked at registrar |
| `clientUpdateProhibited` | Updates blocked at registrar |
| `serverTransferProhibited` | Registry lock - transfer blocked |
| `serverDeleteProhibited` | Registry lock - deletion blocked |
| `pendingTransfer` | Transfer in progress |
| `redemptionPeriod` | Expired, pending deletion |

---

## Appendix B: Registrar Security Quick Reference

### Cloudflare Registrar

- **Lock:** Auto-enabled, manage in Domain Registration settings
- **MFA:** Uses Cloudflare account (Profile > Authentication)
- **Support:** https://support.cloudflare.com

### Namecheap

- **Lock:** Domain List > Manage > Domain Lock
- **MFA:** Account > Profile > Security
- **Support:** https://www.namecheap.com/support

### GoDaddy

- **Lock:** My Products > Domains > Domain Settings
- **MFA:** Account Settings > Login & PIN
- **Support:** https://www.godaddy.com/help

### Google Domains (now Squarespace)

- **Lock:** My Domains > Domain > Security
- **MFA:** Google Account security settings
- **Support:** https://support.squarespace.com/hc/en-us/articles/16988566994189

---

## Appendix C: Emergency Response

### Domain Hijack Response Checklist

If you suspect domain hijacking:

1. [ ] **Immediately** contact registrar abuse/security team
2. [ ] Document evidence (screenshots, logs, WHOIS changes)
3. [ ] Report to law enforcement (FBI IC3 for US)
4. [ ] Contact original registrar's security team
5. [ ] File ICANN complaint if registrar unresponsive
6. [ ] Engage legal counsel for UDRP if necessary
7. [ ] Notify users/customers of potential phishing risk

### Emergency Contacts

| Entity | Purpose | Contact |
|--------|---------|---------|
| Registrar Security | Primary contact | [From registrar dashboard] |
| ICANN Complaints | Registrar disputes | https://www.icann.org/complaints |
| FBI IC3 | Cybercrime reporting | https://www.ic3.gov |
| Legal Counsel | UDRP proceedings | [Your attorney] |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2025-12-20 | Claude Code | Initial runbook (SEC-2.1) |

---

## Related Documentation

- [RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md](./RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md) - MFA Enforcement (SEC-1.1)
- [RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md](./RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md) - Scoped API Tokens (SEC-1.2)
- [SECURITY_BASELINE.md](../SECURITY_BASELINE.md) - Security baseline inventory
