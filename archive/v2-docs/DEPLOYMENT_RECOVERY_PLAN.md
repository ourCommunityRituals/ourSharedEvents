# Deployment Recovery Plan

This document outlines what information should be stored where for disaster recovery scenarios.

## 🟢 SAFE Information (Can Store in Spreadsheet)

Create a `DEPLOYMENT_INFO` sheet in your Google Spreadsheet with:

| Field | Example | Notes |
|-------|---------|-------|
| **Script ID** | `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l` | Public info, needed to access Apps Script project |
| **Spreadsheet ID** | `1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ` | Public info, already in code |
| **Current Deployment ID** | `AKfycbzu-U4UgdjdAiXHTg9TD5Y-1gDkc798YSTqQCdhOddG` | Semi-public (in URLs) |
| **Current Web App URL** | `https://script.google.com/macros/s/AKfycbzu.../exec` | Public URL |
| **Last Deployment Date** | `2025-01-15 14:30 UTC` | Audit trail |
| **Build Version** | `triangle-extended-v1.3` | Version tracking |
| **Deploying User** | `zeventbook@gmail.com` | Who deployed it |
| **GitHub Repo** | `https://github.com/zeventbooks/MVP-EVENT-TOOLKIT` | Recovery source |
| **GitHub Branch** | `main` | Which branch is deployed |
| **Git Commit Hash** | `104b9a3` | Exact code version |

### Quick Access Links
- Apps Script Project: `https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`
- Manage Deployments: `https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/deployments`
- GitHub Actions: `https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions`

### Recovery Contacts
- Primary Admin: `zeventbook@gmail.com`
- GitHub Account: `zeventbooks`
- Emergency Docs: See `docs/` folder in GitHub repo

---

## 🔴 SENSITIVE Information (NEVER Store in Spreadsheet)

These should ONLY be stored in secure locations:

| Secret | Where to Store | Access Method |
|--------|---------------|---------------|
| **Admin Keys** | 1. GitHub Secrets<br>2. Apps Script Properties<br>3. Password Manager | GitHub: Settings → Secrets<br>Apps Script: Project Settings → Script Properties |
| **OAuth Credentials** | GitHub Secrets | `OAUTH_CREDENTIALS` secret |
| **Service Account Keys** | GitHub Secrets | `SERVICE_ACCOUNT_JSON` secret |
| **FTP Passwords** | GitHub Secrets | `HOSTINGER_FTP_PASSWORD` secret |
| **API Tokens** | GitHub Secrets | Repository Settings → Secrets |

---

## 🛡️ Better Security Alternatives

### 1. **Apps Script Properties** (Recommended for Secrets)

**Already implemented in your code** (Config.gs line 327):

```javascript
// Store admin secrets in Script Properties
// Access via: PropertiesService.getScriptProperties().setProperty('ADMIN_SECRET_ROOT', 'your-secret')
```

**Why it's better:**
- ✅ Encrypted by Google
- ✅ Not visible in spreadsheet
- ✅ Not included in code exports
- ✅ Survives deployments
- ✅ Audit-logged by Google

**How to access:**
1. Open Apps Script project
2. Project Settings (gear icon)
3. Script Properties tab
4. View/edit properties

### 2. **GitHub Repository Secrets** (For CI/CD)

**Already using for:**
- `OAUTH_CREDENTIALS`
- `ADMIN_KEY_ROOT`
- `DEPLOYMENT_ID`
- Hostinger FTP credentials

**Benefits:**
- ✅ Encrypted at rest
- ✅ Never exposed in logs
- ✅ Access-controlled
- ✅ Audit-logged

### 3. **Password Manager** (For Human Access)

**Recommended: Store in 1Password/LastPass/Bitwarden:**

```
Entry: "Zeventbook Production Secrets"
├── Admin Key (Root)
├── Admin Key (ABC)
├── Admin Key (CBC)
├── Admin Key (CBL)
├── GitHub Personal Access Token
├── Hostinger FTP Password
└── Notes: Links to GitHub, Apps Script, etc.
```

**Benefits:**
- ✅ Encrypted vault
- ✅ Team sharing capability
- ✅ Audit logging
- ✅ Recovery codes
- ✅ Emergency access

### 4. **Separate Private Google Doc** (For Recovery Info)

Create a **private** Google Doc (not in the main spreadsheet):

```
Title: "Zeventbook Deployment Recovery Guide - PRIVATE"

Access: Only zeventbook@gmail.com (no public link)

Contents:
1. Where secrets are stored (GitHub Secrets, Script Properties)
2. Emergency recovery procedures
3. Contact information
4. Links to password manager
5. Deployment history
```

**Benefits:**
- ✅ Separate from production data
- ✅ Access-controlled
- ✅ Version history
- ✅ Not exposed to API users

---

## 📋 Recommended Multi-Layer Approach

### Layer 1: Public Info → Spreadsheet `DEPLOYMENT_INFO` Sheet
- Deployment IDs, URLs, Script IDs
- Last deployment dates
- Build versions
- GitHub links

### Layer 2: Secrets → Apps Script Properties
- Admin keys
- Internal API tokens
- Configuration passwords

### Layer 3: CI/CD Secrets → GitHub Secrets
- OAuth credentials
- Service account keys
- Deployment secrets

### Layer 4: Human Access → Password Manager
- Master list of all credentials
- Emergency recovery info
- Team access

### Layer 5: Recovery Docs → Private Google Doc
- Procedures
- Contacts
- Links to other layers

---

## 🚨 Disaster Recovery Scenarios

### Scenario 1: "Can't Access Apps Script Project"
**Recovery:**
1. Check GitHub → `.clasp.json` has Script ID
2. Open: `https://script.google.com/home/projects/{SCRIPT_ID}`
3. If still locked out, check password manager for account credentials

### Scenario 2: "Lost Deployment ID"
**Recovery:**
1. Check `DEPLOYMENT_INFO` sheet in spreadsheet
2. OR: Open Apps Script → Deploy → Manage deployments
3. OR: Check GitHub Actions last successful run logs
4. OR: Check `DEPLOYMENT_ID` secret in GitHub

### Scenario 3: "Lost Admin Keys"
**Recovery:**
1. Check Apps Script → Project Settings → Script Properties
2. OR: Check GitHub Secrets → `ADMIN_KEY_ROOT`
3. OR: Check password manager entry
4. Last resort: Regenerate keys (requires updating in all 3 locations)

### Scenario 4: "GitHub Account Locked Out"
**Recovery:**
1. All code is in Apps Script project (use Script ID to access)
2. Can manually deploy via Apps Script UI
3. Can recreate GitHub repo from Apps Script export
4. Critical: Password manager has GitHub recovery codes

### Scenario 5: "Google Account Compromised"
**Recovery:**
1. Use Google account recovery
2. Check password manager for backup codes
3. Emergency contact: [Add backup admin email]
4. All code backed up in GitHub

### Scenario 6: "Everything Lost - Nuclear Recovery"
**Recovery Path:**
1. GitHub repo is source of truth (clone it)
2. Create new Apps Script project
3. Use `clasp push` to upload code
4. Update Script ID in `.clasp.json`
5. Reset all secrets (Apps Script Properties + GitHub Secrets)
6. Create new deployment
7. Update `DEPLOYMENT_INFO` sheet

---

## 🎯 Action Items

### Immediate (Do Now):
- [ ] Create `DEPLOYMENT_INFO` sheet with safe information
- [ ] Verify Admin Keys are in Apps Script Properties
- [ ] Verify GitHub Secrets are up to date
- [ ] Document current deployment ID

### Short-term (This Week):
- [ ] Set up password manager entry for Zeventbook
- [ ] Create private recovery Google Doc
- [ ] Add emergency contact email as backup admin
- [ ] Test recovery procedure (can you access everything?)

### Long-term (Ongoing):
- [ ] Update `DEPLOYMENT_INFO` sheet after each deployment
- [ ] Rotate admin keys quarterly
- [ ] Review access permissions monthly
- [ ] Keep password manager updated

---

## 🔒 Security Best Practices

### DO:
✅ Store deployment metadata in spreadsheet
✅ Use Apps Script Properties for secrets
✅ Use GitHub Secrets for CI/CD
✅ Use password manager for team access
✅ Document recovery procedures
✅ Test recovery procedures regularly
✅ Keep multiple backup copies of critical info

### DON'T:
❌ Store admin keys in spreadsheet
❌ Store passwords in code comments
❌ Share secrets via email/Slack
❌ Rely on "password protected" sheets
❌ Store everything in one place
❌ Forget to update after changes

---

## 📞 Emergency Contacts

**Primary:** zeventbook@gmail.com
**GitHub:** https://github.com/zeventbooks
**Support:** [Add support contact]

**Last Updated:** 2025-01-18
**Next Review:** [Add quarterly review date]
