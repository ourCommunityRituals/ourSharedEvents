# Runbook: Enable DNSSEC End-to-End

> **Epic SEC-2 — Domain Control (DNS/Registrar Takeover Prevention)**
> Story SEC-2.2 — Enable DNSSEC End-to-End
>
> Created: 2025-12-20
> Last Updated: 2025-12-20
> Status: Active

---

## Table of Contents

1. [Overview](#1-overview)
2. [Pre-Requisites](#2-pre-requisites)
3. [Enable DNSSEC in Cloudflare](#3-enable-dnssec-in-cloudflare)
4. [Publish DS Record at Registrar](#4-publish-ds-record-at-registrar)
5. [Verification Checklist](#5-verification-checklist)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Overview

### 1.1 Goal

Prevent DNS poisoning and spoofing attacks by:

- Enabling DNSSEC signing in Cloudflare
- Publishing the DS (Delegation Signer) record at the domain registrar
- Verifying end-to-end DNSSEC validation is active

### 1.2 Why This Matters

DNS is the foundation of all internet traffic routing. Without DNSSEC:

- Attackers can forge DNS responses (cache poisoning)
- Man-in-the-middle attacks can redirect users to malicious servers
- Phishing sites can appear to be on legitimate domains
- SSL/TLS is undermined if DNS is compromised (attacker controls where traffic goes)
- Users have no way to verify DNS responses are authentic

**DNSSEC provides cryptographic proof that DNS responses are authentic and unmodified.**

### 1.3 Threat Model

| Threat                       | Attack Vector                                      | Impact                            | DNSSEC Protection                        |
| ---------------------------- | -------------------------------------------------- | --------------------------------- | ---------------------------------------- |
| DNS Cache Poisoning          | Attacker injects false records into resolver cache | Traffic redirected to attacker    | **BLOCKED** - Signatures fail validation |
| Man-in-the-Middle            | Attacker intercepts and modifies DNS responses     | Traffic redirected to attacker    | **BLOCKED** - Signatures fail validation |
| BGP Hijacking + DNS          | Attacker hijacks route and spoofs DNS              | Traffic redirected to attacker    | **BLOCKED** - Signatures fail validation |
| Authoritative DNS Compromise | Attacker compromises Cloudflare                    | Legitimate-looking signed records | **NOT PROTECTED** (upstream compromise)  |
| Registrar Compromise         | Attacker changes DS records                        | New keys trusted by resolvers     | **NOT PROTECTED** (see SEC-2.1)          |

### 1.4 How DNSSEC Works

```
                    Trust Chain (Root → TLD → Domain)

┌──────────────────────────────────────────────────────────────────────────┐
│                           ROOT (.)                                        │
│   Root servers hold public keys that sign TLD information                │
│   ► Resolver trusts root keys (built-in trust anchors)                   │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ DS record (hash of .com public key)
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           TLD (.com)                                      │
│   .com servers hold public keys that sign domain information             │
│   ► Verified by DS record from root                                       │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ DS record (hash of your domain's key)
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    DOMAIN (eventangle.com)                                │
│   Cloudflare signs all DNS records with domain's private key             │
│   ► Verified by DS record published at registrar                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Key Components:**

| Component                  | Purpose                              | Location                  |
| -------------------------- | ------------------------------------ | ------------------------- |
| **ZSK (Zone Signing Key)** | Signs individual DNS records         | Cloudflare (DNS provider) |
| **KSK (Key Signing Key)**  | Signs the ZSK (key rotation)         | Cloudflare (DNS provider) |
| **DS (Delegation Signer)** | Hash of KSK, establishes trust chain | Registrar                 |
| **RRSIG**                  | Signature on each DNS record         | Cloudflare (DNS provider) |
| **DNSKEY**                 | Public keys for verification         | Cloudflare (DNS provider) |

### 1.5 Scope

| Component                        | In Scope |
| -------------------------------- | -------- |
| Enable DNSSEC in Cloudflare      | Yes      |
| Generate DS record in Cloudflare | Yes      |
| Publish DS record at registrar   | Yes      |
| Verify DNSSEC chain of trust     | Yes      |
| Monitor DNSSEC status            | Yes      |
| Key rotation procedures          | Yes      |

---

## 2. Pre-Requisites

### 2.1 Required Access

- [ ] Cloudflare account with domain management access (Super Administrator or DNS Administrator)
- [ ] Domain registrar account with ability to add DS records
- [ ] Registrar must support DNSSEC DS record submission

### 2.2 Required Information

Before starting, gather:

| Information                 | Source                      | Status |
| --------------------------- | --------------------------- | ------ |
| Domain name(s)              | Cloudflare dashboard        |        |
| Registrar name              | Domain registration records |        |
| Registrar login credentials | Password manager            |        |
| Cloudflare zone ID          | Cloudflare dashboard        |        |

### 2.3 Registrar DNSSEC Support

Common registrars and their DNSSEC support:

| Registrar                    | DS Record Support | Interface             | Notes                    |
| ---------------------------- | ----------------- | --------------------- | ------------------------ |
| Cloudflare Registrar         | Yes (automatic)   | Dashboard             | Auto-publishes DS record |
| Namecheap                    | Yes               | Domain > Advanced DNS | Manual DS entry          |
| GoDaddy                      | Yes               | Domain > DNS > DNSSEC | Manual DS entry          |
| Google Domains (Squarespace) | Yes               | Security > DNSSEC     | Manual DS entry          |
| Porkbun                      | Yes               | Domain > DNSSEC       | Manual DS entry          |
| Gandi                        | Yes               | Domain > DNSSEC       | Manual DS entry          |
| Name.com                     | Yes               | DNS > DNSSEC          | Manual DS entry          |

### 2.4 Pre-Flight Checks

Before enabling DNSSEC, verify:

- [ ] DNS is fully managed by Cloudflare (no external DNS servers)
- [ ] All DNS records are correctly configured and working
- [ ] No pending DNS changes or propagation in progress
- [ ] TTL on critical records is not excessively long (recommended: 300-3600 seconds)

> **Warning:** Enabling DNSSEC with misconfigured DS records will cause domain resolution to fail for DNSSEC-validating resolvers (including major providers like Google, Cloudflare, and Quad9).

---

## 3. Enable DNSSEC in Cloudflare

### 3.1 Navigate to DNSSEC Settings

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your account
3. Select the domain (e.g., `eventangle.com`)
4. In the left sidebar, click **DNS** > **Settings**
5. Scroll to the **DNSSEC** section

### 3.2 Enable DNSSEC

1. Click **Enable DNSSEC**
2. Cloudflare will generate the following:
   - Zone Signing Key (ZSK)
   - Key Signing Key (KSK)
   - DS record for registrar

3. Cloudflare will display the DS record information:

```
DS Record Information
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Key Tag:        [5-digit number, e.g., 12345]
Algorithm:      13 (ECDSA Curve P-256 with SHA-256)
Digest Type:    2 (SHA-256)
Digest:         [64-character hex string]

DS Record (full):
eventangle.com. 3600 IN DS 12345 13 2 [digest...]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

4. **Copy and save these values** - you will need them for the registrar

### 3.3 DNSSEC Record Values

Record the DS record information:

| Field          | Value |
| -------------- | ----- |
| Domain         |       |
| Key Tag        |       |
| Algorithm      | 13    |
| Digest Type    | 2     |
| Digest         |       |
| Full DS Record |       |

### 3.4 Cloudflare DNSSEC Status

After enabling, Cloudflare will show:

| Status       | Meaning                                            |
| ------------ | -------------------------------------------------- |
| **Pending**  | DNSSEC enabled, waiting for DS record at registrar |
| **Active**   | DS record detected, DNSSEC fully operational       |
| **Disabled** | DNSSEC not enabled                                 |
| **Error**    | Configuration issue (check DS record)              |

---

## 4. Publish DS Record at Registrar

### 4.1 General Steps (Most Registrars)

1. Log in to your domain registrar
2. Navigate to domain management for your domain
3. Find **DNSSEC** or **DS Records** section
4. Add a new DS record with values from Cloudflare:
   - Key Tag: [from Cloudflare]
   - Algorithm: 13 (or select "ECDSA Curve P-256 with SHA-256")
   - Digest Type: 2 (or select "SHA-256")
   - Digest: [64-character hex string from Cloudflare]
5. Save the DS record
6. Wait for propagation (up to 24-48 hours, typically faster)

### 4.2 Cloudflare Registrar (Automatic)

If your domain is registered with Cloudflare Registrar:

1. DNSSEC DS record is **automatically published** when you enable DNSSEC
2. No manual action required at registrar level
3. Status will show "Active" within minutes

> **Note:** This is a key advantage of using Cloudflare for both DNS and registration.

### 4.3 Namecheap

1. Log in to Namecheap dashboard
2. Go to **Domain List**
3. Click **Manage** next to your domain
4. Select **Advanced DNS** tab
5. Scroll to **DNSSEC** section
6. Click **ADD NEW RECORD**
7. Enter:
   - Key Tag: [from Cloudflare]
   - Algorithm: 13 - ECDSAP256SHA256
   - Digest Type: 2 - SHA-256
   - Digest: [from Cloudflare]
8. Click **SAVE ALL CHANGES**

### 4.4 GoDaddy

1. Log in to GoDaddy account
2. Go to **My Products** > **Domains**
3. Click on your domain
4. Select **DNS** tab
5. Scroll to **DNSSEC** section
6. Click **Add**
7. Enter:
   - Key Tag: [from Cloudflare]
   - Algorithm: 13
   - Digest Type: 2
   - Digest: [from Cloudflare]
8. Click **Save**

### 4.5 Google Domains (Squarespace)

1. Log in to Google Domains / Squarespace Domains
2. Select your domain
3. Go to **Security** (or **DNS** > **DNSSEC**)
4. Click **Manage DNSSEC**
5. Click **Add record**
6. Enter:
   - Key Tag: [from Cloudflare]
   - Algorithm: 13
   - Digest Type: 2
   - Digest: [from Cloudflare]
7. Save changes

### 4.6 Porkbun

1. Log in to Porkbun
2. Go to **Domain Management**
3. Click the domain
4. Expand **DNSSEC** section
5. Click **Add DNSSEC Record**
6. Enter:
   - Key Tag: [from Cloudflare]
   - Algorithm: 13
   - Digest Type: 2
   - Digest: [from Cloudflare]
7. Click **Add**

### 4.7 DS Record Publication Audit Log

| Domain         | Registrar | DS Published     | Key Tag | Status | Date       |
| -------------- | --------- | ---------------- | ------- | ------ | ---------- |
| eventangle.com |           | [ ] Yes / [ ] No |         |        | YYYY-MM-DD |

---

## 5. Verification Checklist

### 5.1 Acceptance Criteria Verification

| Criterion                                     | How to Verify                                      | Status   |
| --------------------------------------------- | -------------------------------------------------- | -------- |
| **DNSSEC status active in Cloudflare**        | Dashboard > DNS > Settings > DNSSEC shows "Active" | [ ] Pass |
| **DS record present at registrar**            | Registrar dashboard shows DS record                | [ ] Pass |
| **DNSSEC validation tools show signed/valid** | External tools confirm chain of trust              | [ ] Pass |

### 5.2 Cloudflare Dashboard Verification

1. Go to Cloudflare Dashboard
2. Select domain > **DNS** > **Settings**
3. Verify DNSSEC section shows:
   - Status: **Active** (green)
   - DS record detected

**Result:** [ ] Pass / [ ] Fail

### 5.3 Command-Line Verification

#### Check DS Record at Parent (TLD)

```bash
# Query the .com TLD servers for DS record
dig DS eventangle.com @a.gtld-servers.net +short

# Expected output (example):
# 12345 13 2 ABC123...
```

#### Check DNSKEY at Domain

```bash
# Query Cloudflare for DNSKEY records
dig DNSKEY eventangle.com +short

# Expected output: Multiple DNSKEY records (ZSK and KSK)
```

#### Verify RRSIG (Signatures)

```bash
# Query for A record with DNSSEC data
dig A eventangle.com +dnssec +short

# Expected output: IP address plus RRSIG signature
```

#### Full DNSSEC Validation

```bash
# Use delv (DNSSEC lookup and validation)
delv @8.8.8.8 eventangle.com A +rtrace

# Expected output should include:
# ; fully validated
```

### 5.4 Online Verification Tools

Use these external tools to verify DNSSEC is properly configured:

| Tool                         | URL                                                     | What It Checks                  |
| ---------------------------- | ------------------------------------------------------- | ------------------------------- |
| **DNSViz**                   | https://dnsviz.net/                                     | Full DNSSEC chain visualization |
| **Verisign DNSSEC Debugger** | https://dnssec-debugger.verisignlabs.com/               | Chain of trust validation       |
| **ICANN DNSSEC Analyzer**    | https://dnsviz.net/d/[domain]/analyze/                  | Comprehensive analysis          |
| **Cloudflare DNSSEC Test**   | https://www.cloudflare.com/dns/dnssec/how-dnssec-works/ | Quick validation                |
| **Google DNS Test**          | dig @8.8.8.8 +dnssec +cd                                | Compare with/without validation |

### 5.5 DNSViz Verification Steps

1. Go to https://dnsviz.net/
2. Enter your domain: `eventangle.com`
3. Click **Analyze**
4. Review the visualization:
   - **Green**: Valid signatures and chain
   - **Yellow**: Warnings (investigate)
   - **Red**: Errors (requires action)

**Expected Result:**

- All nodes should be green
- Chain should trace from your domain → .com → root
- No broken signature warnings

**Result:** [ ] Pass / [ ] Fail

### 5.6 DNSSEC Verification Test Script

```bash
#!/bin/bash
# DNSSEC Verification Script
DOMAIN="eventangle.com"

echo "=== DNSSEC Verification for $DOMAIN ==="
echo ""

# Check if DS record exists at parent
echo "1. Checking DS record at TLD..."
DS_RECORD=$(dig DS $DOMAIN +short)
if [ -z "$DS_RECORD" ]; then
    echo "   ❌ FAIL: No DS record found at parent"
else
    echo "   ✅ PASS: DS record found"
    echo "   $DS_RECORD"
fi
echo ""

# Check if DNSKEY records exist
echo "2. Checking DNSKEY records..."
DNSKEY_COUNT=$(dig DNSKEY $DOMAIN +short | wc -l)
if [ "$DNSKEY_COUNT" -lt 2 ]; then
    echo "   ❌ FAIL: Missing DNSKEY records (found $DNSKEY_COUNT)"
else
    echo "   ✅ PASS: DNSKEY records found ($DNSKEY_COUNT keys)"
fi
echo ""

# Check DNSSEC validation via Google
echo "3. Validating via Google DNS (8.8.8.8)..."
RESULT=$(dig @8.8.8.8 $DOMAIN A +dnssec +short 2>&1)
if echo "$RESULT" | grep -q "SERVFAIL"; then
    echo "   ❌ FAIL: DNSSEC validation failed (SERVFAIL)"
else
    echo "   ✅ PASS: DNSSEC validation successful"
fi
echo ""

# Check AD (Authenticated Data) flag
echo "4. Checking AD flag (Authenticated Data)..."
AD_FLAG=$(dig @8.8.8.8 $DOMAIN A +dnssec | grep -c "flags:.*ad")
if [ "$AD_FLAG" -eq 0 ]; then
    echo "   ⚠️ WARNING: AD flag not set (may not be validating)"
else
    echo "   ✅ PASS: AD flag present"
fi
echo ""

echo "=== Verification Complete ==="
```

### 5.7 Propagation Timeline

DNSSEC changes may take time to propagate:

| Stage                     | Typical Time  | Maximum Time              |
| ------------------------- | ------------- | ------------------------- |
| Cloudflare enables DNSSEC | Immediate     | 5 minutes                 |
| DS record at registrar    | 5-30 minutes  | 2 hours                   |
| TLD zone update           | 15-60 minutes | 24 hours                  |
| Global resolver cache     | 1-4 hours     | 48 hours (depends on TTL) |

> **Note:** During propagation, some resolvers may see DNSSEC as active while others do not. This is normal.

---

## 6. Troubleshooting

### 6.1 DNSSEC Status Shows "Pending"

| Cause                                | Solution                                                            |
| ------------------------------------ | ------------------------------------------------------------------- |
| DS record not published at registrar | Add DS record at registrar (Section 4)                              |
| DS record incorrect                  | Verify Key Tag, Algorithm, Digest Type, and Digest match Cloudflare |
| Propagation delay                    | Wait up to 24-48 hours for TLD zone update                          |
| Registrar doesn't support DNSSEC     | Contact registrar or transfer to DNSSEC-supporting registrar        |

### 6.2 DNSSEC Validation Failing (SERVFAIL)

| Cause                              | Solution                                         |
| ---------------------------------- | ------------------------------------------------ |
| DS record mismatch                 | Re-copy DS record values from Cloudflare exactly |
| Stale DS record after key rotation | Update DS record at registrar with new values    |
| Multiple conflicting DS records    | Remove old DS records, keep only current         |
| Algorithm mismatch                 | Ensure Algorithm 13 is selected at registrar     |

**Emergency Recovery:**
If DNSSEC validation is failing and blocking access:

1. Remove DS record from registrar (disables DNSSEC validation)
2. Wait for propagation (1-4 hours)
3. Re-configure correctly
4. Re-add DS record

### 6.3 Website Inaccessible After DNSSEC

**Symptoms:**

- Site loads for some users but not others
- `SERVFAIL` errors in DNS queries
- Works with `dig +cd` (checking disabled) but fails with `dig +dnssec`

**Immediate Action:**

```bash
# Test if DNSSEC is the issue
dig @8.8.8.8 eventangle.com +cd    # Should work (CD = Checking Disabled)
dig @8.8.8.8 eventangle.com +dnssec # Fails if DNSSEC broken
```

**Resolution:**

1. Log in to registrar
2. Remove/delete the DS record
3. Wait for propagation (check with dig)
4. Investigate root cause
5. Re-enable correctly

### 6.4 DS Record Format Issues

Different registrars may require different formats:

| Format              | Example                                                 |
| ------------------- | ------------------------------------------------------- |
| **Separate fields** | Key Tag: 12345, Alg: 13, Digest Type: 2, Digest: abc... |
| **Single line**     | 12345 13 2 abc123def456...                              |
| **Full DNS format** | eventangle.com. 3600 IN DS 12345 13 2 abc123...         |

Ensure you're using the format your registrar expects.

### 6.5 Key Rotation Issues

Cloudflare automatically rotates DNSSEC keys. When rotation occurs:

1. Cloudflare will display new DS record values
2. You must update the DS record at the registrar
3. Keep old and new DS records during transition
4. Remove old DS record after propagation (24-48 hours)

> **Note:** If using Cloudflare Registrar, key rotation is automatic.

### 6.6 Common Error Messages

| Error                     | Meaning                                | Solution                                                |
| ------------------------- | -------------------------------------- | ------------------------------------------------------- |
| `SERVFAIL`                | DNSSEC validation failed               | Check DS record matches, or disable and reconfigure     |
| `no DS record`            | DS not published                       | Add DS record at registrar                              |
| `DNSKEY not found`        | DNSSEC not enabled at DNS provider     | Enable DNSSEC in Cloudflare                             |
| `signature expired`       | RRSIG expired                          | Usually auto-resolved; if persistent, disable/re-enable |
| `algorithm not supported` | Registrar doesn't support Algorithm 13 | Use Algorithm 8 if available, or change registrar       |

---

## Appendix A: DNSSEC Record Types

| Record Type    | Purpose                              | Managed By                 |
| -------------- | ------------------------------------ | -------------------------- |
| **DNSKEY**     | Public keys for zone signing         | Cloudflare (automatic)     |
| **DS**         | Hash of DNSKEY, links to parent zone | Registrar (manual or auto) |
| **RRSIG**      | Digital signature on each record     | Cloudflare (automatic)     |
| **NSEC/NSEC3** | Authenticated denial of existence    | Cloudflare (automatic)     |

---

## Appendix B: DNSSEC Algorithms

| Algorithm Number | Name                         | Status                               |
| ---------------- | ---------------------------- | ------------------------------------ |
| 5                | RSA/SHA-1                    | Deprecated                           |
| 7                | RSASHA1-NSEC3-SHA1           | Deprecated                           |
| 8                | RSA/SHA-256                  | Acceptable                           |
| 10               | RSA/SHA-512                  | Acceptable                           |
| **13**           | **ECDSA P-256 with SHA-256** | **Recommended** (Cloudflare default) |
| 14               | ECDSA P-384 with SHA-384     | Acceptable                           |
| 15               | Ed25519                      | Future                               |

> **Note:** Cloudflare uses Algorithm 13 by default for its efficiency and security.

---

## Appendix C: Quick Reference Commands

```bash
# Check DS record at parent TLD
dig DS eventangle.com +short

# Check DNSKEY records
dig DNSKEY eventangle.com +short

# Validate with Google DNS
dig @8.8.8.8 eventangle.com +dnssec +short

# Full validation trace
delv eventangle.com +rtrace

# Check without validation (troubleshooting)
dig @8.8.8.8 eventangle.com +cd +short

# Check NSEC3 (authenticated denial)
dig NSEC3PARAM eventangle.com +short

# Query specific record with DNSSEC
dig @8.8.8.8 www.eventangle.com A +dnssec
```

---

## Appendix D: DNSSEC Monitoring

### Recommended Monitoring Setup

| Check                               | Frequency | Alert Threshold    |
| ----------------------------------- | --------- | ------------------ |
| DNSSEC status in Cloudflare         | Daily     | Status != Active   |
| DS record presence at registrar     | Weekly    | Missing DS record  |
| DNSSEC validation via external tool | Daily     | Validation failure |
| Key rotation notification           | On change | New DS required    |

### External Monitoring Services

- **DNSViz** - Free, on-demand analysis
- **Cloudflare** - Built-in status in dashboard
- **UptimeRobot/Pingdom** - Can alert on DNS failures
- **ThousandEyes** - Enterprise DNS monitoring

---

## Document History

| Date       | Author      | Changes                   |
| ---------- | ----------- | ------------------------- |
| 2025-12-20 | Claude Code | Initial runbook (SEC-2.2) |

---

## Related Documentation

- [RUNBOOK-SEC-2.1-REGISTRAR-LOCK-MFA.md](./RUNBOOK-SEC-2.1-REGISTRAR-LOCK-MFA.md) - Registrar Lock + MFA (SEC-2.1)
- [RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md](./RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md) - Cloudflare Account Hardening (SEC-1.1)
- [RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md](./RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md) - Scoped API Tokens (SEC-1.2)
- [SECURITY_BASELINE.md](../SECURITY_BASELINE.md) - Security baseline inventory
