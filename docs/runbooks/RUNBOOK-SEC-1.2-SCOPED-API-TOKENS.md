# Runbook: Replace Global API Key Usage with Scoped Tokens

> **Epic SEC-1 — Cloudflare Account Hardening**
> Story SEC-1.2 — Replace Global API Key Usage with Scoped Tokens
>
> Created: 2025-12-20
> Last Updated: 2025-12-20
> Status: Active

---

## Table of Contents

1. [Overview](#1-overview)
2. [Current State Assessment](#2-current-state-assessment)
3. [Token Scope Matrix](#3-token-scope-matrix)
4. [CI Secret Naming Conventions](#4-ci-secret-naming-conventions)
5. [Token Creation Guide](#5-token-creation-guide)
6. [Token Rotation Plan](#6-token-rotation-plan)
7. [Migration Steps](#7-migration-steps)
8. [Verification Checklist](#8-verification-checklist)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Overview

### 1.1 Goal

Eliminate "God mode" API key risk by:

- Removing any usage of Global API Keys (legacy `CF_API_KEY` or `CLOUDFLARE_API_KEY`)
- Implementing least-privilege scoped API tokens
- Documenting token ownership and rotation schedules
- Centralizing token management in CI secrets

### 1.2 Why This Matters

**Global API Keys are dangerous because they:**

- Have full account access (can modify DNS, Workers, SSL, billing, etc.)
- Cannot be scoped to specific resources
- Cannot be individually revoked without affecting all integrations
- Appear in Cloudflare audit logs as "API Key" (not distinguishable)

**Scoped API Tokens provide:**

- Least-privilege access (only permissions needed)
- Individual revocation capability
- Clear audit trail (each token has a unique name)
- Expiration dates (optional but recommended)
- IP allowlisting (optional security enhancement)

### 1.3 Scope

| Component                  | Status                       |
| -------------------------- | ---------------------------- |
| CI/CD Worker deployments   | Use scoped `CF_DEPLOY_TOKEN` |
| DNS management             | Use scoped `CF_DNS_TOKEN`    |
| Read-only audit/monitoring | Use scoped `CF_AUDIT_TOKEN`  |
| Legacy global API key      | **PROHIBITED**               |

---

## 2. Current State Assessment

### 2.1 Audit Results

**Global API Key Usage:** ✅ NOT FOUND

After comprehensive codebase review, no legacy global API key patterns were found:

- `CF_API_KEY`: Not present
- `CLOUDFLARE_API_KEY`: Not present
- `X-Auth-Key` header usage: Not present

**Current Token Usage:**

- `CLOUDFLARE_API_TOKEN_ESE`: Used in stage1.yml and stage2.yml for Worker deployments
- Token scoping: Needs verification and documentation

### 2.2 Files Using Cloudflare Credentials

| File                              | Secret Used                | Purpose             |
| --------------------------------- | -------------------------- | ------------------- |
| `.github/workflows/stage1.yml`    | `CLOUDFLARE_API_TOKEN_ESE` | Worker deployment   |
| `.github/workflows/stage2.yml`    | `CLOUDFLARE_API_TOKEN_ESE` | Worker verification |
| `.github/workflows/archive/*.yml` | `CLOUDFLARE_API_TOKEN_ESE` | Legacy (archived)   |

---

## 3. Token Scope Matrix

### 3.1 Required Tokens

The following scoped tokens must be created in Cloudflare:

| Token Name          | GitHub Secret     | Purpose                 | Required Permissions                             |
| ------------------- | ----------------- | ----------------------- | ------------------------------------------------ |
| **CI Deploy Token** | `CF_DEPLOY_TOKEN` | Worker/Pages deployment | Workers Scripts: Edit, Workers Routes: Edit      |
| **DNS Token**       | `CF_DNS_TOKEN`    | DNS record management   | DNS: Edit (zone-specific)                        |
| **Audit Token**     | `CF_AUDIT_TOKEN`  | Read-only monitoring    | Account: Read, Analytics: Read, Audit Logs: Read |

### 3.2 Detailed Permission Matrix

#### CI Deploy Token (`CF_DEPLOY_TOKEN`)

**Purpose:** CI/CD pipeline Worker deployments only

| Permission         | Level | Scope                | Justification           |
| ------------------ | ----- | -------------------- | ----------------------- |
| Workers Scripts    | Edit  | Account              | Deploy Worker code      |
| Workers Routes     | Edit  | Zone: eventangle.com | Configure Worker routes |
| Workers KV Storage | Edit  | Account              | (If using KV)           |
| Account Settings   | Read  | Account              | Verify account ID       |

**Zone Restrictions:**

- Zone: `eventangle.com` (and subdomains)

**IP Restrictions (Optional):**

- GitHub Actions IP ranges (see [GitHub Meta API](https://api.github.com/meta))

**Token TTL:** No expiration (rotated manually per schedule)

---

#### DNS Token (`CF_DNS_TOKEN`)

**Purpose:** DNS record management for infrastructure changes

| Permission | Level | Scope                | Justification      |
| ---------- | ----- | -------------------- | ------------------ |
| DNS        | Edit  | Zone: eventangle.com | Manage DNS records |

**Zone Restrictions:**

- Zone: `eventangle.com` only

**Use Cases:**

- Updating A/AAAA records
- Managing CNAME records
- TXT record updates (SPF, DKIM, etc.)

**Token TTL:** No expiration (rotated manually per schedule)

> **Note:** This token should NOT be stored in GitHub Secrets unless DNS automation is required. Store in a secure password manager for manual operations only.

---

#### Audit Token (`CF_AUDIT_TOKEN`)

**Purpose:** Read-only monitoring, analytics, and compliance reporting

| Permission       | Level | Scope     | Justification              |
| ---------------- | ----- | --------- | -------------------------- |
| Account Settings | Read  | Account   | View account configuration |
| Analytics        | Read  | Account   | Access analytics data      |
| Audit Logs       | Read  | Account   | View audit trail           |
| Zone             | Read  | All zones | View zone configuration    |
| DNS              | Read  | All zones | View DNS records           |
| Workers Scripts  | Read  | Account   | View deployed Workers      |

**Zone Restrictions:** None (read-only across all zones)

**Token TTL:** No expiration (rotated manually per schedule)

> **Note:** This token is for monitoring dashboards and compliance checks. Should be stored in secure password manager, not CI secrets (unless automation requires it).

---

### 3.3 Token Comparison Summary

| Capability       | Deploy Token | DNS Token | Audit Token | Global Key       |
| ---------------- | ------------ | --------- | ----------- | ---------------- |
| Deploy Workers   | ✅           | ❌        | ❌          | ✅               |
| Edit DNS         | ❌           | ✅        | ❌          | ✅               |
| View Analytics   | ❌           | ❌        | ✅          | ✅               |
| Manage SSL/TLS   | ❌           | ❌        | ❌          | ✅               |
| Manage Firewall  | ❌           | ❌        | ❌          | ✅               |
| Access Billing   | ❌           | ❌        | ❌          | ✅               |
| Add Members      | ❌           | ❌        | ❌          | ✅               |
| **Blast Radius** | Worker code  | DNS only  | Read-only   | **FULL ACCOUNT** |

---

## 4. CI Secret Naming Conventions

### 4.1 Standard Naming Pattern

```
{PROVIDER}_{PURPOSE}_{SCOPE}
```

**Components:**

- `PROVIDER`: Service provider (CF, GCP, AWS, etc.)
- `PURPOSE`: What the secret does (DEPLOY, DNS, AUDIT, etc.)
- `SCOPE`: Optional environment or resource scope

### 4.2 Cloudflare Token Naming

| Current Name               | New Name (Recommended) | Status           |
| -------------------------- | ---------------------- | ---------------- |
| `CLOUDFLARE_API_TOKEN_ESE` | `CF_DEPLOY_TOKEN`      | Migrate          |
| `CLOUDFLARE_ACCOUNT_ID`    | `CF_ACCOUNT_ID`        | Keep (shorter)   |
| (new)                      | `CF_DNS_TOKEN`         | Create if needed |
| (new)                      | `CF_AUDIT_TOKEN`       | Create if needed |

### 4.3 Full Secret Inventory

| Secret Name               | Provider   | Purpose              | Required | Stage   |
| ------------------------- | ---------- | -------------------- | -------- | ------- |
| `CF_DEPLOY_TOKEN`         | Cloudflare | Worker deployment    | Yes      | Stage-1 |
| `CF_ACCOUNT_ID`           | Cloudflare | Account identifier   | Yes      | Stage-1 |
| `CF_DNS_TOKEN`            | Cloudflare | DNS management       | No\*     | Manual  |
| `CF_AUDIT_TOKEN`          | Cloudflare | Read-only monitoring | No\*     | Manual  |
| `CF_ACCESS_CLIENT_ID`     | Cloudflare | Access service auth  | No       | Stage-2 |
| `CF_ACCESS_CLIENT_SECRET` | Cloudflare | Access service auth  | No       | Stage-2 |

\*Only add to GitHub Secrets if CI/CD automation requires the token.

### 4.4 Naming Rules

1. **Use underscores** for word separation (not hyphens)
2. **Use SCREAMING_SNAKE_CASE** for all secret names
3. **Prefix with provider** for easy identification
4. **Keep names descriptive** but concise (max 30 characters)
5. **Avoid environment suffixes** in secret names (use GitHub Environments instead)

**Good Examples:**

- `CF_DEPLOY_TOKEN` ✅
- `GCP_SA_PRIVATE_KEY` ✅
- `ADMIN_KEY_ROOT` ✅

**Bad Examples:**

- `cloudflare-api-token` ❌ (wrong case, hyphens)
- `TOKEN` ❌ (too generic)
- `CF_DEPLOY_TOKEN_PROD` ❌ (use environments instead)

---

## 5. Token Creation Guide

### 5.1 Access Token Management

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click profile icon (top-right) → **My Profile**
3. Navigate to **API Tokens** tab
4. Click **Create Token**

### 5.2 Create CI Deploy Token

#### Step 1: Start with Template

1. Click **Create Token**
2. Select **Edit Cloudflare Workers** template (or Custom)

#### Step 2: Configure Permissions

```
Permissions:
├── Account
│   └── Workers Scripts: Edit
│   └── Account Settings: Read
└── Zone
    └── eventangle.com
        └── Workers Routes: Edit
```

#### Step 3: Zone Resources

- **Include:** Specific zone → `eventangle.com`
- **Exclude:** All other zones

#### Step 4: Client IP Filtering (Optional)

Add GitHub Actions IP ranges for additional security:

```
# Fetch current GitHub Actions IPs
curl -s https://api.github.com/meta | jq -r '.actions[]'
```

#### Step 5: TTL

- Leave blank for no expiration (manually rotated)
- Or set to 1 year for automatic expiration reminder

#### Step 6: Create and Save

1. Click **Continue to Summary**
2. Click **Create Token**
3. **COPY THE TOKEN IMMEDIATELY** (shown only once)
4. Store in password manager temporarily
5. Add to GitHub Secrets as `CF_DEPLOY_TOKEN`

### 5.3 Create DNS Token

#### Permissions

```
Permissions:
└── Zone
    └── eventangle.com
        └── DNS: Edit
```

#### Zone Resources

- **Include:** Specific zone → `eventangle.com`

### 5.4 Create Audit Token

#### Permissions

```
Permissions:
├── Account
│   └── Account Settings: Read
│   └── Analytics: Read
│   └── Audit Logs: Read
└── Zone
    └── All zones
        └── Zone: Read
        └── DNS: Read
        └── Workers Scripts: Read
```

---

## 6. Token Rotation Plan

### 6.1 Rotation Schedule

| Token             | Rotation Period | Trigger             | Owner               |
| ----------------- | --------------- | ------------------- | ------------------- |
| `CF_DEPLOY_TOKEN` | 90 days         | Manual + Compromise | DevOps Lead         |
| `CF_DNS_TOKEN`    | 180 days        | Manual + Compromise | Infrastructure Lead |
| `CF_AUDIT_TOKEN`  | 180 days        | Manual + Compromise | Security Lead       |

### 6.2 Rotation Triggers

**Scheduled Rotation:**

- Follow the rotation period in the table above
- Set calendar reminders for rotation dates

**Emergency Rotation (Immediate):**

- Token exposure in logs or commits
- Team member departure with token access
- Suspicious API activity in audit logs
- Security incident response

### 6.3 Rotation Procedure

#### Step 1: Create New Token

1. Follow [Token Creation Guide](#5-token-creation-guide)
2. Name with date suffix temporarily: `CI Deploy Token (2025-Q1)`
3. Create token and copy value

#### Step 2: Update GitHub Secrets

1. Go to Repository → Settings → Secrets and variables → Actions
2. Edit the existing secret (e.g., `CF_DEPLOY_TOKEN`)
3. Paste new token value
4. Click **Update secret**

#### Step 3: Verify New Token

```bash
# Test Worker deployment (dry run)
cd worker
CLOUDFLARE_API_TOKEN_ESE=<new-token> wrangler whoami

# Run a test deployment to staging
CLOUDFLARE_API_TOKEN_ESE=<new-token> wrangler deploy --env staging --dry-run
```

#### Step 4: Revoke Old Token

1. Go to Cloudflare → Profile → API Tokens
2. Find the old token (by name or creation date)
3. Click **Revoke**
4. Confirm revocation

#### Step 5: Document Rotation

Update the rotation log:

| Token             | Previous Rotation | Current Rotation | Next Due   | Rotated By |
| ----------------- | ----------------- | ---------------- | ---------- | ---------- |
| `CF_DEPLOY_TOKEN` | 2025-09-20        | 2025-12-20       | 2026-03-20 | @username  |

### 6.4 Rotation Calendar

Set up recurring reminders:

```
# Example: Google Calendar reminder
Title: [SEC] Rotate CF_DEPLOY_TOKEN
Recurrence: Every 90 days
Description:
  1. Create new token in Cloudflare
  2. Update GitHub Secret
  3. Verify with test deployment
  4. Revoke old token
  5. Update rotation log in RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md
```

---

## 7. Migration Steps

### 7.1 Migration Checklist

- [ ] Create new scoped `CF_DEPLOY_TOKEN` in Cloudflare
- [ ] Add `CF_DEPLOY_TOKEN` to GitHub Secrets
- [ ] Update workflows to use new secret name (or keep `CLOUDFLARE_API_TOKEN_ESE` as alias)
- [ ] Verify staging deployment works
- [ ] Verify production deployment works
- [ ] Revoke old token (if different)
- [ ] Update documentation
- [ ] Communicate changes to team

### 7.2 Workflow Updates (Optional)

If renaming secrets, update the workflow files:

**Before:**

```yaml
env:
  CLOUDFLARE_API_TOKEN_ESE: ${{ secrets.CLOUDFLARE_API_TOKEN_ESE }}
```

**After:**

```yaml
env:
  CLOUDFLARE_API_TOKEN_ESE: ${{ secrets.CF_DEPLOY_TOKEN }}
```

> **Note:** The environment variable name `CLOUDFLARE_API_TOKEN_ESE` is used by wrangler CLI and should remain unchanged. Only the secret name changes.

### 7.3 Backward Compatibility

During migration, you can keep both secrets pointing to the same token:

- `CLOUDFLARE_API_TOKEN_ESE` → Legacy workflows
- `CF_DEPLOY_TOKEN` → New standard name

After all workflows are updated, remove the legacy secret.

---

## 8. Verification Checklist

### 8.1 Acceptance Criteria

| Criterion                      | How to Verify                                                              | Status   |
| ------------------------------ | -------------------------------------------------------------------------- | -------- |
| No global API key usage        | Grep codebase for `CF_API_KEY`, `X-Auth-Key`                               | [ ] Pass |
| Scoped deploy token created    | Cloudflare → API Tokens shows token with correct permissions               | [ ] Pass |
| Token stored in GitHub Secrets | Repository → Settings → Secrets shows `CF_DEPLOY_TOKEN`                    | [ ] Pass |
| Workflows use scoped token     | Grep shows `secrets.CF_DEPLOY_TOKEN` or `secrets.CLOUDFLARE_API_TOKEN_ESE` | [ ] Pass |
| Token permissions documented   | This runbook has complete permission matrix                                | [ ] Pass |
| Token ownership documented     | Rotation schedule has owner column                                         | [ ] Pass |
| Rotation plan documented       | Section 6 complete                                                         | [ ] Pass |

### 8.2 Security Verification

#### Test 1: Verify Token Cannot Access DNS

```bash
# Should fail with permissions error
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected:** `403 Forbidden` or `error: "This API Token does not have the required permissions"`

#### Test 2: Verify Token Can Deploy Workers

```bash
# Should succeed
CLOUDFLARE_API_TOKEN_ESE=$CF_DEPLOY_TOKEN wrangler whoami
```

**Expected:** Shows account email and account ID

#### Test 3: Verify No Global Key in Codebase

```bash
# Should return no matches
grep -r "CF_API_KEY\|CLOUDFLARE_API_KEY\|X-Auth-Key" \
  --include="*.yml" --include="*.yaml" --include="*.json" \
  .github/ scripts/ worker/
```

**Expected:** No output (no matches)

---

## 9. Troubleshooting

### 9.1 Token Not Working

| Symptom            | Cause                   | Solution                                       |
| ------------------ | ----------------------- | ---------------------------------------------- |
| `403 Forbidden`    | Missing permissions     | Add required permissions in Cloudflare         |
| `Invalid token`    | Token typo or expired   | Regenerate and update secret                   |
| `Zone not found`   | Zone restrictions wrong | Update zone resources in token                 |
| `Account mismatch` | Wrong account ID        | Verify `CF_ACCOUNT_ID` matches token's account |

### 9.2 Workflow Fails After Migration

1. **Check secret name matches workflow:**

   ```bash
   grep -n "secrets\." .github/workflows/stage1.yml | grep -i cloud
   ```

2. **Verify secret is set:**
   - Go to Repository → Settings → Secrets
   - Confirm secret exists and has value

3. **Test token locally:**
   ```bash
   export CLOUDFLARE_API_TOKEN_ESE="<paste-token>"
   wrangler whoami
   ```

### 9.3 Cannot Find Old Token to Revoke

1. Go to Cloudflare → Profile → API Tokens
2. Check **All Tokens** (not just active)
3. Look for tokens created around the time of CI setup
4. If multiple tokens exist, use last-used date to identify

---

## Appendix A: GitHub Secret Configuration

### Adding Secrets via CLI

```bash
# Using GitHub CLI
gh secret set CF_DEPLOY_TOKEN --body "<token-value>"
gh secret set CF_ACCOUNT_ID --body "<account-id>"

# Verify secrets are set
gh secret list
```

### Adding Secrets via Web UI

1. Repository → Settings → Secrets and variables → Actions
2. Click **New repository secret**
3. Name: `CF_DEPLOY_TOKEN`
4. Secret: `<paste-token-value>`
5. Click **Add secret**

---

## Appendix B: Token Permission Reference

### Cloudflare Permission Levels

| Level | Description                       |
| ----- | --------------------------------- |
| Read  | View resource configuration       |
| Edit  | Create, update, delete resources  |
| Purge | Clear cache (specific to caching) |

### Zone vs Account Permissions

| Scope   | Applies To               |
| ------- | ------------------------ |
| Account | All zones in the account |
| Zone    | Specific zone(s) only    |

---

## Appendix C: Audit Log Queries

### View Token Usage

In Cloudflare dashboard:

1. Account → Audit Log
2. Filter by "Actor Type: API Token"
3. Search for your token name

### Export Audit Logs (Enterprise)

```bash
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{account_id}/audit_logs" \
  -H "Authorization: Bearer $CF_AUDIT_TOKEN" \
  -H "Content-Type: application/json"
```

---

## Document History

| Date       | Author      | Changes                   |
| ---------- | ----------- | ------------------------- |
| 2025-12-20 | Claude Code | Initial runbook (SEC-1.2) |

---

## Related Documentation

- [RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md](./RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md) - MFA Enforcement (SEC-1.1)
- [CLOUDFLARE_SECRETS.md](./CLOUDFLARE_SECRETS.md) - Full secrets inventory
- [SECURITY_BASELINE.md](../SECURITY_BASELINE.md) - Security baseline inventory
- [Cloudflare API Token Documentation](https://developers.cloudflare.com/api/tokens/)
