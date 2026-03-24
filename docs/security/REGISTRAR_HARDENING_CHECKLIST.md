# REGISTRAR_HARDENING_CHECKLIST.md — Domain Registrar Security

> **PROMPTSPEC-SEC-2.1** — Registrar Hardening Checklist
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## Purpose

Prevent domain hijacking through registrar-level controls. A compromised domain = complete loss of control over DNS, email, and services.

---

## 1. Registrar Lock

Enable ALL available locks on production domains.

| Lock Type | What It Prevents | Where to Enable |
|-----------|------------------|-----------------|
| **Registrar Lock** (clientTransferProhibited) | Unauthorized transfers to another registrar | Registrar dashboard → Domain Settings |
| **Registry Lock** (serverTransferProhibited) | Bypasses registrar-level compromise | Contact registrar to enable (may require verification call) |
| **Update Lock** (clientUpdateProhibited) | Nameserver/contact changes | Registrar dashboard → Domain Settings |

**Verification:**
```bash
whois yourdomain.com | grep -i "status"
# Expected: clientTransferProhibited, clientUpdateProhibited
```

---

## 2. MFA Requirements

| Account Type | MFA Requirement | Acceptable Methods |
|--------------|-----------------|-------------------|
| Registrar account owner | **MANDATORY** | Hardware key (FIDO2) or TOTP |
| Any user with domain access | **MANDATORY** | Hardware key (FIDO2) or TOTP |
| API access (if used) | **MANDATORY** | IP allowlist + API key rotation |

**Prohibited:** SMS-based MFA (SIM swap vulnerable)

---

## 3. Recovery Method Audit

Audit and secure ALL recovery paths quarterly.

| Recovery Vector | Risk | Remediation |
|-----------------|------|-------------|
| Email address on file | Compromised email = account takeover | Use dedicated admin email with hardware MFA |
| Phone number | SIM swap attack | Remove or use VoIP with strong auth |
| Security questions | Easily researched/guessed | Disable or use random answers stored in password manager |
| Backup codes | If leaked, full bypass | Store in password manager, regenerate annually |
| Support PIN/passphrase | Social engineering target | Set strong PIN, document who knows it |

**Checklist:**
```
[ ] Recovery email uses hardware key MFA
[ ] Recovery phone removed or secured
[ ] Security questions disabled or randomized
[ ] Backup codes stored in password manager
[ ] Support PIN set and documented (not guessable)
```

---

## 4. Alerts Configuration

Enable ALL available notifications.

| Alert Type | Action |
|------------|--------|
| Login from new device/location | Enable → route to security alias |
| Domain unlock request | Enable → route to security alias |
| Transfer request initiated | Enable → route to security alias |
| Nameserver change | Enable → route to security alias |
| Contact info change | Enable → route to security alias |
| Expiration warning (90/60/30 days) | Enable → route to owner + security |

**Additional Monitoring:**
- Set calendar reminders 90 days before domain expiration
- Configure external WHOIS monitoring (e.g., DomainTools, Gandi alerts)

---

## 5. Emergency: Transfer Initiated Without Authorization

**Time-critical.** You typically have 5 days to stop a transfer.

### Immediate Actions (within 1 hour)

| Step | Action | Contact |
|------|--------|---------|
| 1 | **Reject transfer** in registrar dashboard | Self-service if still logged in |
| 2 | **Call registrar support** — request transfer freeze | Use phone, not email |
| 3 | **Lock the domain** if not already locked | Registrar dashboard or support |
| 4 | **Change registrar password** and revoke all sessions | Registrar account settings |
| 5 | **Check recovery email** for compromise | Review email account access logs |

### Registrar Emergency Contacts

Document these BEFORE an incident:

| Registrar | Emergency Phone | Notes |
|-----------|-----------------|-------|
| Cloudflare Registrar | Use dashboard chat (24/7) | Requires account access |
| GoDaddy | +1-480-505-8877 | Ask for Security team |
| Namecheap | +1-323-301-1280 | Mention domain security |
| Google Domains | N/A (transferred to Squarespace) | Use Squarespace support |
| Gandi | +33 1 70 37 76 61 | EU hours |

### If Transfer Completes

1. Contact ICANN: [compliance@icann.org](mailto:compliance@icann.org)
2. File UDRP complaint if trademark applies
3. Contact new registrar with proof of ownership
4. Preserve all evidence (emails, logs, screenshots)

---

## 6. Hardening Checklist

Execute on each production domain:

```
DOMAIN: _______________________  DATE: ___________

REGISTRAR LOCK
[ ] clientTransferProhibited enabled (verify via WHOIS)
[ ] clientUpdateProhibited enabled
[ ] Registry lock requested (if available)

ACCOUNT SECURITY
[ ] Hardware key or TOTP MFA enabled
[ ] No SMS-based MFA
[ ] Strong unique password in password manager
[ ] Only authorized users have access

RECOVERY AUDIT
[ ] Recovery email secured with hardware MFA
[ ] Phone number removed or secured
[ ] Security questions disabled/randomized
[ ] Backup codes stored securely
[ ] Support PIN documented

ALERTS
[ ] Transfer request alerts enabled
[ ] Login alerts enabled
[ ] Nameserver change alerts enabled
[ ] Expiration warnings enabled

DOCUMENTATION
[ ] Registrar emergency contact documented
[ ] Domain expiration date in team calendar
[ ] This checklist completed and filed

Completed by: _____________  Verified by: _____________
```

---

## Related Documents

| Document | Path | Relationship |
|----------|------|--------------|
| Cloudflare Account Hardening | `docs/security/CF_ACCOUNT_HARDENING_RUNBOOK.md` | DNS provider security |
| Security Baseline | `docs/security/SECURITY_BASELINE.md` | Parent security model |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-2.1 checklist |
