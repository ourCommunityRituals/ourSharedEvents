# CI_DEPLOY_HARDENING.md — CI Deploy Least Privilege Policy

> **PROMPTSPEC-SEC-7.2** — CI Deploy Hardening (Least Privilege)
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Define least-privilege boundaries for CI/CD deployment pipelines, ensuring that a compromised deploy token cannot modify DNS records, Cloudflare Access policies, or account-level settings.

| Attribute         | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| **Scope**         | GitHub Actions workflows, Cloudflare API tokens used in CI     |
| **Objective**     | CI can deploy Workers but cannot modify DNS/Access/account     |
| **Prerequisites** | CF_API_TOKENS_POLICY.md (SEC-1.2), SECRETS_POLICY.md (SEC-7.1) |
| **Compliance**    | Mandatory for all CI/CD pipelines with Cloudflare access       |

---

## 2. Threat Model

### 2.1 Attack Scenarios

| Scenario                  | Description                                     | Impact Without Hardening                |
| ------------------------- | ----------------------------------------------- | --------------------------------------- |
| **Leaked Deploy Token**   | Token exposed in logs, commit, or error message | Full Worker + DNS + Access control      |
| **Compromised CI Runner** | Attacker gains shell on GitHub Actions runner   | Exfiltration of all secrets in workflow |
| **Malicious PR**          | Attacker submits PR with modified workflow      | Token used to deploy malicious code     |
| **Supply Chain Attack**   | Compromised GitHub Action                       | Token exfiltration via malicious action |

### 2.2 Protection Goals

| Goal                       | Mechanism                      | Section   |
| -------------------------- | ------------------------------ | --------- |
| **Token Scope Limitation** | Cloudflare scoped API tokens   | Section 3 |
| **Branch Protection**      | GitHub branch protection rules | Section 4 |
| **Required Checks**        | Status checks before merge     | Section 4 |
| **Token Rotation**         | Regular and emergency rotation | Section 5 |
| **Incident Response**      | Rapid revoke procedures        | Section 6 |

---

## 3. Deploy Token Scope Boundaries

### 3.1 Permitted Capabilities (Whitelist)

The CI deploy token (`CF_DEPLOY_TOKEN`) **MAY** perform:

| Capability               | API Permission           | Scope                     | Justification             |
| ------------------------ | ------------------------ | ------------------------- | ------------------------- |
| Deploy Worker code       | Workers Scripts: Edit    | Account                   | Core deployment function  |
| Update Worker routes     | Workers Routes: Edit     | Zone: oursharedevents.com | Route traffic to Workers  |
| Read/Write KV namespaces | Workers KV Storage: Edit | Account                   | Application data storage  |
| View account settings    | Account Settings: Read   | Account                   | Verify deployment context |

### 3.2 Prohibited Capabilities (Denylist)

The CI deploy token **MUST NOT** be able to:

| Capability               | Why Prohibited                           | Verification         |
| ------------------------ | ---------------------------------------- | -------------------- |
| Edit DNS records         | DNS hijacking enables phishing           | Test 1 (Section 7.1) |
| Manage Cloudflare Access | Access bypass enables unauthorized entry | Test 2 (Section 7.2) |
| Configure SSL/TLS        | Certificate manipulation enables MITM    | Test 3 (Section 7.3) |
| Manage WAF rules         | WAF bypass exposes vulnerabilities       | Test 4 (Section 7.4) |
| Modify account members   | Privilege escalation risk                | Test 5 (Section 7.5) |
| Access billing           | Financial data exposure                  | Token scope design   |
| Create new zones         | Infrastructure sprawl                    | Token scope design   |
| Manage Page Rules        | Traffic redirection risk                 | Token scope design   |

### 3.3 Token Configuration Specification

When creating the CI deploy token in Cloudflare Dashboard:

```
TOKEN NAME: CI-Deploy-Workers-Only

PERMISSIONS:
  Account | Workers Scripts        | Edit
  Zone    | Workers Routes         | Edit     (Zone: oursharedevents.com)
  Account | Workers KV Storage     | Edit     (if using KV)
  Account | Account Settings       | Read

ZONE RESOURCES:
  Include | Specific zone | oursharedevents.com

ACCOUNT RESOURCES:
  Include | [Your Account] | [Account ID]

CLIENT IP FILTERING: (Optional - highly recommended)
  Include | GitHub Actions IP ranges
  See: https://api.github.com/meta (actions key)

TTL: (Optional)
  Set expiration date aligned with rotation schedule
```

### 3.4 Blast Radius Comparison

| Token Type                | Compromised Impact                                            | Recovery Time    |
| ------------------------- | ------------------------------------------------------------- | ---------------- |
| **Global API Key**        | Full account compromise: DNS, Access, WAF, billing, all zones | Days to weeks    |
| **Over-scoped Token**     | DNS hijacking + Access bypass + Worker malware                | Hours to days    |
| **Properly Scoped Token** | Worker code modification only (this policy)                   | Minutes to hours |

**Properly scoped token impact is limited to:**

- Malicious code in Worker (mitigated by code review, branch protection)
- Worker route manipulation within allowed zone
- KV data modification (if KV permission granted)

**Properly scoped token CANNOT:**

- Redirect DNS to attacker-controlled servers
- Create Access policies granting attacker entry
- Disable WAF protections
- Add attacker accounts to Cloudflare

---

## 4. Protected Branches and Required Checks

### 4.1 Branch Protection Rules

Configure the following on the default branch (`main` or `master`):

| Setting                            | Value                | Purpose                         |
| ---------------------------------- | -------------------- | ------------------------------- |
| **Require pull request reviews**   | Enabled, 1+ approval | Prevent direct pushes           |
| **Dismiss stale approvals**        | Enabled              | Require re-review after changes |
| **Require status checks**          | Enabled              | Enforce CI passes               |
| **Require branches be up to date** | Enabled              | Prevent merge conflicts         |
| **Restrict pushes**                | Enabled              | Only merge via PR               |
| **Include administrators**         | Enabled              | No bypass for admins            |
| **Allow force pushes**             | Disabled             | Prevent history rewriting       |
| **Allow deletions**                | Disabled             | Prevent branch deletion         |

### 4.2 Required Status Checks

Configure these checks as required before merge:

| Check Name      | Purpose                     | Blocks Deploy If Failed |
| --------------- | --------------------------- | ----------------------- |
| `test`          | Unit and integration tests  | Yes                     |
| `lint`          | Code quality and formatting | Yes                     |
| `typecheck`     | TypeScript type validation  | Yes                     |
| `security-scan` | Vulnerability detection     | Yes                     |
| `build`         | Verify code compiles        | Yes                     |

### 4.3 GitHub Environments

Configure deployment environments with protection rules:

**Staging Environment:**

```yaml
Environment: staging
Protection rules:
  - Required reviewers: 0 (auto-deploy from main)
  - Wait timer: 0 minutes
  - Deployment branches: main only
```

**Production Environment:**

```yaml
Environment: production
Protection rules:
  - Required reviewers: 1+ (manual approval)
  - Wait timer: 5 minutes (cancel window)
  - Deployment branches: main only
  - Allowed deployments: Last successful staging deploy
```

### 4.4 Workflow File Protection

Prevent unauthorized workflow modifications:

```yaml
# .github/CODEOWNERS
# Require security review for workflow changes
/.github/workflows/ @security-team @devops-lead
```

Add workflow file to branch protection:

| Setting                                | Configuration                                |
| -------------------------------------- | -------------------------------------------- |
| **Restrict changes to workflow files** | Require PR approval for .github/workflows/\* |

---

## 5. Token Rotation Schedule

### 5.1 Standard Rotation

| Token             | Rotation Frequency | Next Rotation         | Owner       |
| ----------------- | ------------------ | --------------------- | ----------- |
| `CF_DEPLOY_TOKEN` | Every 90 days      | Per calendar schedule | DevOps Lead |

### 5.2 Rotation Procedure

**Step 1: Create New Token (Pre-rotation)**

```
1. Log in to Cloudflare Dashboard
2. Navigate to My Profile → API Tokens
3. Click "Create Token"
4. Configure EXACTLY per Section 3.3
5. Copy new token value (shown once)
6. Store temporarily in password manager
```

**Step 2: Update GitHub Secrets**

```bash
# Update repository secret
gh secret set CF_DEPLOY_TOKEN --body "<new-token-value>"

# If using environment-scoped secrets
gh secret set CF_DEPLOY_TOKEN --env staging --body "<new-token-value>"
gh secret set CF_DEPLOY_TOKEN --env production --body "<new-token-value>"
```

**Step 3: Verify New Token**

```bash
# Trigger test deployment
gh workflow run deploy.yml -f environment=staging

# Monitor workflow
gh run watch
```

**Step 4: Revoke Old Token**

```
1. Navigate to Cloudflare Dashboard → My Profile → API Tokens
2. Find OLD token (by creation date or name suffix)
3. Click "Revoke"
4. Confirm revocation
```

**Step 5: Document Rotation**

```
Record in rotation log:
- Date: YYYY-MM-DD
- Rotated by: [Name]
- Old token revoked: Yes/No
- Verification: Staging deploy successful
- Next rotation due: YYYY-MM-DD (90 days)
```

---

## 6. Incident Revoke Procedure

### 6.1 Emergency Triggers

Immediately revoke and rotate if ANY of these occur:

| Trigger                             | Severity     | Response Time |
| ----------------------------------- | ------------ | ------------- |
| Token exposed in git commit         | **CRITICAL** | < 15 minutes  |
| Token exposed in CI logs            | **CRITICAL** | < 15 minutes  |
| Token exposed in error message      | **HIGH**     | < 1 hour      |
| Suspicious Cloudflare API activity  | **HIGH**     | < 1 hour      |
| CI runner compromise suspected      | **HIGH**     | < 1 hour      |
| Team member with access departs     | **MEDIUM**   | < 24 hours    |
| GitHub security advisory on Actions | **MEDIUM**   | < 24 hours    |

### 6.2 Emergency Revocation Steps

**IMMEDIATE (< 5 minutes):**

```bash
# 1. Revoke token immediately via Cloudflare Dashboard
#    My Profile → API Tokens → [Token Name] → Revoke

# 2. If you have the Cloudflare CLI:
curl -X DELETE "https://api.cloudflare.com/client/v4/user/tokens/{token_id}" \
  -H "Authorization: Bearer {admin-token}" \
  -H "Content-Type: application/json"
```

**ASSESSMENT (< 15 minutes):**

```bash
# 3. Check Cloudflare audit logs for unauthorized activity
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{account_id}/audit_logs" \
  -H "Authorization: Bearer {audit-token}" \
  -H "Content-Type: application/json" \
  | jq '.result[] | select(.action.type | contains("worker"))'
```

**Review audit logs for:**

- Unexpected Worker deployments
- Worker route modifications
- KV namespace changes
- Any activity outside normal deployment windows

**REPLACEMENT (< 30 minutes):**

```bash
# 4. Create new token per Section 3.3
# 5. Update GitHub Secrets
gh secret set CF_DEPLOY_TOKEN --body "<new-token-value>"

# 6. Verify new token works
CLOUDFLARE_API_TOKEN_OSE="<new-token>" wrangler whoami
```

**VERIFICATION (< 1 hour):**

```bash
# 7. Run staging deployment
gh workflow run deploy.yml -f environment=staging

# 8. Verify production unchanged (if not compromised)
curl -sf "https://oursharedevents.com/?page=status"
```

### 6.3 Incident Notification Matrix

| Exposure Type              | Notify Immediately                     | Notify Within 24h     |
| -------------------------- | -------------------------------------- | --------------------- |
| Token in public repo       | Security Lead, DevOps Lead, Management | Full engineering team |
| Token in private repo/logs | Security Lead, DevOps Lead             | Relevant team members |
| Suspected CI compromise    | Security Lead, DevOps Lead, Management | Full engineering team |
| Team departure             | DevOps Lead                            | —                     |

### 6.4 Post-Incident Checklist

```
INCIDENT RESPONSE CHECKLIST
───────────────────────────
[ ] Token revoked immediately
[ ] Audit logs reviewed for unauthorized activity
[ ] New token created with correct scope (Section 3.3)
[ ] GitHub Secrets updated
[ ] Staging deployment verified
[ ] Production deployment verified (if applicable)
[ ] Incident documented in security log
[ ] Root cause identified
[ ] Remediation actions documented
[ ] Process improvements proposed (if applicable)
```

---

## 7. Verification Tests

Run these tests after token creation or rotation to verify scope boundaries.

### 7.1 Test: Token CANNOT Edit DNS

```bash
# Attempt to list DNS records
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" \
  -H "Content-Type: application/json"

# EXPECTED: 403 Forbidden or error containing "does not have required permissions"
# FAILURE: 200 OK with DNS records list (TOKEN IS OVER-SCOPED)
```

### 7.2 Test: Token CANNOT Manage Access

```bash
# Attempt to list Access applications
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{account_id}/access/apps" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" \
  -H "Content-Type: application/json"

# EXPECTED: 403 Forbidden or error containing "does not have required permissions"
# FAILURE: 200 OK with Access apps list (TOKEN IS OVER-SCOPED)
```

### 7.3 Test: Token CANNOT Modify SSL/TLS

```bash
# Attempt to get SSL settings
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/ssl" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" \
  -H "Content-Type: application/json"

# EXPECTED: 403 Forbidden
# FAILURE: 200 OK (TOKEN IS OVER-SCOPED)
```

### 7.4 Test: Token CANNOT Modify WAF

```bash
# Attempt to list WAF rules
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/firewall/rules" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" \
  -H "Content-Type: application/json"

# EXPECTED: 403 Forbidden
# FAILURE: 200 OK (TOKEN IS OVER-SCOPED)
```

### 7.5 Test: Token CANNOT Manage Account Members

```bash
# Attempt to list account members
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{account_id}/members" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" \
  -H "Content-Type: application/json"

# EXPECTED: 403 Forbidden
# FAILURE: 200 OK with members list (TOKEN IS OVER-SCOPED)
```

### 7.6 Test: Token CAN Deploy Workers

```bash
# Verify Worker deployment capability
CLOUDFLARE_API_TOKEN_OSE=$CF_DEPLOY_TOKEN wrangler whoami

# EXPECTED: Shows account email and account ID
# This confirms the token has the necessary Worker permissions

# Dry-run deployment test
CLOUDFLARE_API_TOKEN_OSE=$CF_DEPLOY_TOKEN wrangler deploy --env staging --dry-run

# EXPECTED: Deployment preview without errors
```

### 7.7 Automated Verification Script

```bash
#!/bin/bash
# verify-deploy-token-scope.sh
# Run after token creation/rotation to verify least-privilege

set -e

TOKEN="${CF_DEPLOY_TOKEN:-}"
ZONE_ID="${CF_ZONE_ID:-}"
ACCOUNT_ID="${CF_ACCOUNT_ID:-}"

if [ -z "$TOKEN" ] || [ -z "$ZONE_ID" ] || [ -z "$ACCOUNT_ID" ]; then
  echo "ERROR: Set CF_DEPLOY_TOKEN, CF_ZONE_ID, CF_ACCOUNT_ID"
  exit 1
fi

echo "=== Verifying Deploy Token Scope ==="

# Test DNS (should fail)
echo -n "DNS Edit permission: "
DNS_RESULT=$(curl -s -o /dev/null -w "%{http_code}" \
  -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $TOKEN")
if [ "$DNS_RESULT" = "403" ]; then
  echo "BLOCKED (correct)"
else
  echo "ALLOWED (SECURITY ISSUE!)"
  exit 1
fi

# Test Access (should fail)
echo -n "Access permission: "
ACCESS_RESULT=$(curl -s -o /dev/null -w "%{http_code}" \
  -X GET "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
  -H "Authorization: Bearer $TOKEN")
if [ "$ACCESS_RESULT" = "403" ]; then
  echo "BLOCKED (correct)"
else
  echo "ALLOWED (SECURITY ISSUE!)"
  exit 1
fi

# Test Workers (should succeed)
echo -n "Workers permission: "
WORKERS_RESULT=$(CLOUDFLARE_API_TOKEN_OSE=$TOKEN wrangler whoami 2>&1)
if echo "$WORKERS_RESULT" | grep -q "Account"; then
  echo "ALLOWED (correct)"
else
  echo "BLOCKED (configuration issue)"
  exit 1
fi

echo "=== All scope checks passed ==="
```

---

## 8. Workflow Hardening Checklist

### 8.1 Deployment Workflow Requirements

```yaml
# Required security measures in deploy workflows

name: Deploy Worker

on:
  push:
    branches: [main] # Only deploy from protected branch
  workflow_dispatch:
    inputs:
      environment:
        required: true
        type: choice
        options: [staging, production]

# Limit workflow permissions
permissions:
  contents: read # Minimal permissions

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment || 'staging' }}

    steps:
      - uses: actions/checkout@v4

      # Pin action versions to SHA for supply chain security
      - name: Deploy Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_DEPLOY_TOKEN }}
          accountId: ${{ vars.CF_ACCOUNT_ID }} # Use vars for non-secret
```

### 8.2 Security Checklist

```
WORKFLOW SECURITY CHECKLIST
───────────────────────────
[ ] Workflow only triggers on protected branches (main)
[ ] Environment protection rules configured
[ ] Permissions block limits workflow capabilities
[ ] Actions pinned to specific versions or SHA
[ ] Secrets accessed via ${{ secrets.NAME }} only
[ ] No secrets printed to logs
[ ] No secrets passed to untrusted actions
[ ] CODEOWNERS protects workflow files
[ ] Dependabot enabled for action updates
```

---

## 9. Acceptance Criteria

| #        | Criterion                                    | Verification Method   | Status |
| -------- | -------------------------------------------- | --------------------- | ------ |
| **AC-1** | Compromised deploy token cannot alter DNS    | Test 7.1 returns 403  |        |
| **AC-2** | Compromised deploy token cannot alter Access | Test 7.2 returns 403  |        |
| **AC-3** | Protected branches require PR review         | GitHub settings audit |        |
| **AC-4** | Required checks block merge on failure       | GitHub settings audit |        |
| **AC-5** | Token rotation procedure documented          | Section 5 review      |        |
| **AC-6** | Emergency revoke procedure documented        | Section 6 review      |        |
| **AC-7** | Verification tests executable                | Run Section 7 tests   |        |

---

## 10. Related Documents

| Document          | Path                                            | Relationship                      |
| ----------------- | ----------------------------------------------- | --------------------------------- |
| API Tokens Policy | `docs/security/CF_API_TOKENS_POLICY.md`         | Token scope definitions (SEC-1.2) |
| Secrets Policy    | `docs/security/SECRETS_POLICY.md`               | Secret classification (SEC-7.1)   |
| CI Secret Naming  | `docs/security/CI_SECRET_NAMING.md`             | Naming conventions                |
| Account Hardening | `docs/security/CF_ACCOUNT_HARDENING_RUNBOOK.md` | Account-level security (SEC-1.1)  |
| Security Baseline | `docs/security/SECURITY_BASELINE.md`            | Overall security model            |

---

## Document History

| Date       | Author      | Changes                                               |
| ---------- | ----------- | ----------------------------------------------------- |
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-7.2 CI deploy hardening policy |
