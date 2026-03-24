# CI_SECRET_NAMING.md — CI Secrets Naming and Storage Policy

> **PROMPTSPEC-SEC-1.2** — CI Secret Naming Conventions
> Role: Director of Security + DevOps Lead
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

This document defines consistent naming conventions and storage rules for CI/CD secrets across the EventAngle platform.

| Attribute | Value |
|-----------|-------|
| **Scope** | GitHub Actions secrets, Cloudflare Worker secrets |
| **Non-Goals** | Secret values, rotation procedures (see SEC-1.2 policy) |
| **Constraints** | No real secret values; naming must be unambiguous |

---

## 2. Naming Convention

### 2.1 Standard Pattern

```
{PROVIDER}_{PURPOSE}_{QUALIFIER}
```

| Component | Description | Examples |
|-----------|-------------|----------|
| **PROVIDER** | Service provider prefix (2-4 chars) | `CF`, `GCP`, `AWS`, `GH` |
| **PURPOSE** | What the secret does | `DEPLOY`, `DNS`, `AUDIT`, `SA` |
| **QUALIFIER** | Optional scope or variant | `TOKEN`, `KEY`, `ID`, `EMAIL` |

### 2.2 Naming Rules

| Rule | Requirement | Example |
|------|-------------|---------|
| **Case** | SCREAMING_SNAKE_CASE | `CF_DEPLOY_TOKEN` |
| **Separator** | Underscore only | `GCP_SA_PRIVATE_KEY` |
| **Length** | Max 40 characters | Keep concise |
| **Prefix** | Always include provider | `CF_`, `GCP_`, `AWS_` |
| **No Env Suffix** | Use GitHub Environments instead | No `_PROD` or `_STG` suffix |

### 2.3 Provider Prefixes

| Prefix | Provider | Use For |
|--------|----------|---------|
| `CF_` | Cloudflare | API tokens, account IDs, Access credentials |
| `GCP_` | Google Cloud Platform | Service accounts, API keys |
| `GOOGLE_` | Google (legacy) | OAuth, Sheets API (existing secrets) |
| `AWS_` | Amazon Web Services | IAM credentials, service keys |
| `GH_` | GitHub | PATs, App credentials |
| `ADMIN_` | Internal | Admin tokens, authentication keys |
| `SHEETS_` | Google Sheets | Spreadsheet IDs (existing convention) |

---

## 3. Secret Inventory

### 3.1 Cloudflare Secrets

| Secret Name | Type | Purpose | Storage Location | Required |
|-------------|------|---------|------------------|----------|
| `CF_DEPLOY_TOKEN` | API Token | Worker deployment | GitHub Secrets | Yes |
| `CF_ACCOUNT_ID` | Identifier | Account reference | GitHub Secrets | Yes |
| `CF_DNS_TOKEN` | API Token | DNS management | Password Manager | No |
| `CF_AUDIT_TOKEN` | API Token | Read-only monitoring | Password Manager | No |
| `CF_ACCESS_CLIENT_ID` | Access Service Token | Access API auth | GitHub Secrets | Optional |
| `CF_ACCESS_CLIENT_SECRET` | Access Service Token | Access API auth | GitHub Secrets | Optional |

**Legacy Names (Deprecated):**

| Legacy Name | New Name | Migration Status |
|-------------|----------|------------------|
| `CLOUDFLARE_API_TOKEN` | `CF_DEPLOY_TOKEN` | Alias supported |
| `CLOUDFLARE_ACCOUNT_ID` | `CF_ACCOUNT_ID` | Alias supported |

### 3.2 Google Cloud Secrets

| Secret Name | Type | Purpose | Storage Location | Required |
|-------------|------|---------|------------------|----------|
| `GOOGLE_SA_CLIENT_EMAIL` | Service Account | Sheets API auth | Cloudflare Worker | Yes |
| `GOOGLE_SA_PRIVATE_KEY_PEM` | Private Key | Sheets API auth | Cloudflare Worker | Yes |
| `GOOGLE_CLIENT_EMAIL` | Service Account | CI verification | GitHub Secrets | Yes |
| `GOOGLE_PRIVATE_KEY` | Private Key | CI verification | GitHub Secrets | Yes |
| `GOOGLE_CLIENT_ID` | OAuth | OAuth flow | GitHub Secrets | Optional |
| `GOOGLE_CLIENT_SECRET` | OAuth | OAuth flow | GitHub Secrets | Optional |

### 3.3 Application Secrets

| Secret Name | Type | Purpose | Storage Location | Required |
|-------------|------|---------|------------------|----------|
| `ADMIN_KEY_ROOT` | Auth Token | Root admin access | GitHub Secrets | Yes |
| `ADMIN_KEY_ABC` | Auth Token | Brand ABC admin | GitHub Secrets | Yes |
| `ADMIN_KEY_CBC` | Auth Token | Brand CBC admin | GitHub Secrets | Yes |
| `ADMIN_KEY_CBL` | Auth Token | Brand CBL admin | GitHub Secrets | Yes |
| `ADMIN_TOKEN` | Auth Token | Worker admin API | Cloudflare Worker | Yes |
| `SESSION_SECRET` | Encryption | Session cookies | Cloudflare Worker | Yes |
| `HMAC_SECRET` | Signing | Signed mutations | Cloudflare Worker | Yes |

### 3.4 Resource Identifiers

| Secret Name | Type | Purpose | Storage Location | Required |
|-------------|------|---------|------------------|----------|
| `SHEETS_SPREADSHEET_ID` | Identifier | Production database | Cloudflare Worker | Yes |
| `STAGING_SHEETS_SPREADSHEET_ID` | Identifier | Staging database | GitHub Secrets | Yes |

---

## 4. Storage Rules

### 4.1 Storage Location Decision Matrix

| Secret Type | Frequency of Use | Storage Location |
|-------------|------------------|------------------|
| CI/CD automation | Every deployment | GitHub Secrets |
| Worker runtime | Every request | Cloudflare Worker Secrets |
| Manual operations | Rarely | Password Manager |
| Shared across tools | Varies | GitHub Secrets + Worker |

### 4.2 GitHub Secrets Rules

| Rule | Description |
|------|-------------|
| **Repository Secrets** | Secrets specific to this repository |
| **Environment Secrets** | Secrets scoped to staging/production environments |
| **No Plaintext Backup** | Never store copies in plaintext files |
| **No Commit** | Never commit secret values to repository |
| **Access Audit** | Review who has access quarterly |

**Access Levels:**

| Role | Can View Secret Names | Can Read Values | Can Edit |
|------|----------------------|-----------------|----------|
| Admin | Yes | No (masked) | Yes |
| Maintainer | Yes | No (masked) | No |
| Contributor | No | No | No |

### 4.3 Cloudflare Worker Secrets Rules

| Rule | Description |
|------|-------------|
| **Environment Isolation** | Separate secrets per environment (staging/production) |
| **Secret List** | `wrangler secret list --env <env>` to verify |
| **No Local Storage** | Never store Worker secrets in local files |
| **Wrangler Only** | Use `wrangler secret put` for all updates |

### 4.4 Password Manager Rules

| Rule | Description |
|------|-------------|
| **Approved Manager** | Use team-approved password manager (1Password, Bitwarden, etc.) |
| **Shared Vault** | Store in shared team vault, not personal |
| **Access Control** | Limit access to token owners and Security team |
| **Audit Log** | Ensure manager has access logging enabled |

---

## 5. Environment Strategy

### 5.1 GitHub Environments

Use GitHub Environments to scope secrets by environment:

| Environment | Description | Secrets Scope |
|-------------|-------------|---------------|
| `staging` | Pre-production testing | Staging credentials |
| `production` | Live environment | Production credentials |

### 5.2 Environment-Specific Secrets

Instead of naming secrets with environment suffixes, use environment-scoped secrets:

**Correct Approach:**

```yaml
# In GitHub Actions workflow
jobs:
  deploy:
    environment: staging  # Scopes secrets to staging
    steps:
      - name: Deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_DEPLOY_TOKEN }}
          # Uses staging-scoped CF_DEPLOY_TOKEN
```

**Incorrect Approach:**

```yaml
# DON'T DO THIS
env:
  CF_DEPLOY_TOKEN_STAGING: ${{ secrets.CF_DEPLOY_TOKEN_STAGING }}
  CF_DEPLOY_TOKEN_PROD: ${{ secrets.CF_DEPLOY_TOKEN_PROD }}
```

### 5.3 Cloudflare Environments

Cloudflare Worker secrets are scoped by wrangler environment:

```bash
# Staging secrets
wrangler secret put ADMIN_TOKEN --env staging

# Production secrets
wrangler secret put ADMIN_TOKEN --env production
```

---

## 6. Prohibited Practices

| ID | Practice | Reason | Remediation |
|----|----------|--------|-------------|
| **P-1** | Secrets in code | Exposure in git history | Use secrets management |
| **P-2** | Secrets in logs | Exposure in CI logs | Mask all secret values |
| **P-3** | Secrets in comments | Accidental exposure | Remove and rotate |
| **P-4** | Secrets in `.env` files committed | Git history exposure | Add to `.gitignore` |
| **P-5** | Sharing secrets via chat/email | Exposure in message history | Use password manager sharing |
| **P-6** | Environment suffix in names | Confusion, duplication | Use GitHub Environments |
| **P-7** | Generic secret names | Unclear purpose | Use descriptive names |

---

## 7. Workflow Integration

### 7.1 Using Secrets in GitHub Actions

```yaml
name: Deploy Worker
on: push

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Cloudflare
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_DEPLOY_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
        run: |
          npx wrangler deploy --env staging
```

### 7.2 Secret Masking

GitHub automatically masks secrets in logs. Ensure custom scripts don't accidentally print secrets:

```bash
# Bad - might print secret
echo "Token: $CLOUDFLARE_API_TOKEN"

# Good - verify without printing
wrangler whoami
```

### 7.3 Secret Verification

```yaml
- name: Verify Secrets Configured
  run: |
    if [ -z "$CF_DEPLOY_TOKEN" ]; then
      echo "Error: CF_DEPLOY_TOKEN not configured"
      exit 1
    fi
  env:
    CF_DEPLOY_TOKEN: ${{ secrets.CF_DEPLOY_TOKEN }}
```

---

## 8. Secret Lifecycle

### 8.1 Creation Checklist

```
[ ] Name follows convention (PROVIDER_PURPOSE_QUALIFIER)
[ ] Purpose documented in this file
[ ] Storage location determined
[ ] Owner assigned
[ ] Rotation schedule set
[ ] Added to relevant workflow files
[ ] Tested in staging environment
```

### 8.2 Rotation Checklist

```
[ ] New secret value generated
[ ] Updated in GitHub Secrets / Cloudflare / Password Manager
[ ] Deployment verified with new secret
[ ] Old secret revoked (if applicable)
[ ] Rotation logged in tracking document
```

### 8.3 Deprecation Checklist

```
[ ] Confirm secret is no longer in use
[ ] Remove from workflow files
[ ] Remove from GitHub Secrets
[ ] Remove from Cloudflare Worker (if applicable)
[ ] Update documentation
[ ] Revoke at provider (if applicable)
```

---

## 9. Audit and Compliance

### 9.1 Quarterly Audit Checklist

```
[ ] Review all secrets in GitHub repository settings
[ ] Verify all secrets are documented in this file
[ ] Check for unused secrets (remove if unnecessary)
[ ] Verify rotation schedules are being followed
[ ] Review access permissions for secrets
[ ] Check for secrets in code commits (git-secrets scan)
```

### 9.2 Compliance Requirements

| Requirement | How Addressed |
|-------------|---------------|
| Secrets not in code | `.gitignore` patterns, git-secrets hook |
| Secrets rotated regularly | Rotation schedule per SEC-1.2 policy |
| Secrets access limited | GitHub repository permissions, environment protection |
| Secrets auditable | GitHub audit log, Cloudflare audit log |

---

## 10. Quick Reference

### 10.1 Adding a New Secret

1. Choose name following convention: `{PROVIDER}_{PURPOSE}_{QUALIFIER}`
2. Determine storage location (GitHub Secrets / Cloudflare / Password Manager)
3. Add to GitHub Secrets: `gh secret set SECRET_NAME --body "value"`
4. Add to Cloudflare: `wrangler secret put SECRET_NAME --env <env>`
5. Document in this file (Section 3)
6. Update workflow files if needed

### 10.2 Common Commands

```bash
# List GitHub Secrets
gh secret list

# Set GitHub Secret
gh secret set CF_DEPLOY_TOKEN --body "<token>"

# List Cloudflare Worker Secrets
wrangler secret list --env staging
wrangler secret list --env production

# Set Cloudflare Worker Secret
wrangler secret put ADMIN_TOKEN --env staging

# Delete Cloudflare Worker Secret
wrangler secret delete OLD_SECRET --env staging
```

---

## 11. Related Documents

| Document | Path | Relationship |
|----------|------|--------------|
| API Tokens Policy | `docs/security/CF_API_TOKENS_POLICY.md` | Token scope definitions |
| Security Baseline | `docs/security/SECURITY_BASELINE.md` | Overall security model |
| Secrets Runbook | `docs/RUNBOOK-SECRETS.md` | Rotation procedures |
| Cloudflare Secrets | `docs/CLOUDFLARE_SECRETS.md` | Full secrets reference |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-1.2 naming conventions |
