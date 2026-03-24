# SECRETS_POLICY.md — Secrets Classification and Handling Policy

> **PROMPTSPEC-SEC-7.1** — Secrets Policy and Worker Vars Audit
> Role: Director of Security
> Created: 2026-01-05
> Status: **ACTIVE**

---

## 1. Purpose

Define the classification criteria for secrets versus plaintext configuration variables, and establish logging redaction requirements for sensitive data.

| Attribute | Value |
|-----------|-------|
| **Scope** | All Worker environment variables, CI/CD secrets, runtime credentials |
| **Prerequisites** | CI Secret Naming (SEC-1.2) |
| **Compliance** | This policy is mandatory for all new Worker deployments |

---

## 2. Secrets Definition

### 2.1 What Constitutes a Secret

A value **MUST** be classified and stored as a secret if it meets **ANY** of the following criteria:

| Category | Description | Examples |
|----------|-------------|----------|
| **Authentication Keys** | Any value used to prove identity | API tokens, bearer tokens, OAuth credentials |
| **Signing Secrets** | Keys used for cryptographic signatures | HMAC secrets, JWT signing keys, private keys |
| **Encryption Keys** | Keys used to encrypt/decrypt data | AES keys, KMS key material |
| **Tokens** | Short or long-lived access credentials | Session tokens, refresh tokens, PATs |
| **Behavior-Gating Values** | Any value that gates access or enables privileged behavior | Admin tokens, feature flags controlling security |
| **IDs Used for Gating** | Identifiers that grant access when known | Spreadsheet IDs for data stores, resource IDs that bypass auth |
| **Connection Strings** | Database or service connection details | Postgres URLs, Redis URLs with passwords |
| **Private Keys** | Asymmetric private key material | RSA/EC private keys, PEM files |

### 2.2 IDs Used for Gating — Critical Classification

> **⚠️ IMPORTANT:** Identifiers that gate access MUST be treated as secrets.

Many systems incorrectly classify resource IDs as non-sensitive. However, if knowledge of an ID is sufficient to access a resource, that ID is a secret.

| ID Type | Secret? | Rationale |
|---------|---------|-----------|
| `SHEETS_SPREADSHEET_ID` | **YES** | Knowledge of ID enables data access via authenticated Worker |
| `CF_ACCOUNT_ID` | NO | Required for API calls but insufficient alone (needs API token) |
| `KV_NAMESPACE_ID` | NO | Cannot access without Worker binding or API token |
| `USER_ID` | Context-dependent | Secret if it bypasses auth; not secret if already exposed in URLs |
| `EVENT_ID` | Context-dependent | Secret if required for admin access; not secret if public |

**Decision Rule:** If an identifier, when combined with existing system access, enables privileged operations that would otherwise require authentication, classify it as a secret.

### 2.3 What Is NOT a Secret

The following are **plaintext configuration** (stored in `[vars]` or environment variables):

| Category | Description | Examples |
|----------|-------------|----------|
| **Environment Identifiers** | Non-sensitive environment labels | `WORKER_ENV=staging`, `NODE_ENV=production` |
| **Feature Flags** | Non-security feature toggles | `ENABLE_DEBUG_ENDPOINTS=true` (staging only) |
| **Version Strings** | Build metadata | `WORKER_BUILD_VERSION=prod-2025.12.13` |
| **Timeouts/Limits** | Numeric configuration | `UPSTREAM_TIMEOUT_MS=30000` |
| **Public URLs** | Publicly accessible endpoints | `PUBLIC_CDN_URL=https://cdn.example.com` |
| **Sheet Names** | Tab names within a spreadsheet | `AUDIT_SHEET_NAME=AUDIT_LOGS` |
| **Debug Levels** | Logging verbosity | `DEBUG_LEVEL=error` |

---

## 3. Classification Decision Tree

```
┌─────────────────────────────────────────────────────────────────┐
│                  IS THIS VALUE A SECRET?                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
         ┌────────────────────────────────────────┐
         │ Does this value authenticate identity? │
         │ (tokens, keys, credentials)            │
         └────────────────────────────────────────┘
                      │                │
                     YES              NO
                      │                │
                      ▼                ▼
                 ┌────────┐   ┌────────────────────────────────┐
                 │ SECRET │   │ Does this value sign/encrypt?  │
                 └────────┘   │ (HMAC, JWT, AES keys)          │
                              └────────────────────────────────┘
                                      │                │
                                     YES              NO
                                      │                │
                                      ▼                ▼
                                 ┌────────┐   ┌────────────────────────────────┐
                                 │ SECRET │   │ Does knowing this ID alone     │
                                 └────────┘   │ enable privileged operations?  │
                                              └────────────────────────────────┘
                                                      │                │
                                                     YES              NO
                                                      │                │
                                                      ▼                ▼
                                                 ┌────────┐   ┌────────────────────────────────┐
                                                 │ SECRET │   │ Does this value gate behavior  │
                                                 └────────┘   │ (enable/disable features)?     │
                                                              └────────────────────────────────┘
                                                                      │                │
                                                                 YES (security)    NO/non-security
                                                                      │                │
                                                                      ▼                ▼
                                                                 ┌────────┐      ┌──────────────┐
                                                                 │ SECRET │      │ PLAINTEXT OK │
                                                                 └────────┘      └──────────────┘
```

---

## 4. Logging Redaction Requirements

### 4.1 Mandatory Redaction

All logging systems **MUST** redact the following patterns before writing to logs:

| Pattern Type | Detection Method | Redaction |
|--------------|------------------|-----------|
| **Bearer Tokens** | `Bearer\s+[A-Za-z0-9\-_]+` | `Bearer [REDACTED]` |
| **Authorization Headers** | Full `Authorization:` header value | `Authorization: [REDACTED]` |
| **API Keys** | Env vars ending in `_KEY`, `_TOKEN`, `_SECRET` | `[REDACTED]` |
| **Private Keys** | `-----BEGIN.*PRIVATE KEY-----` blocks | `[REDACTED_PRIVATE_KEY]` |
| **PEM Content** | Multi-line base64 between PEM markers | `[REDACTED_PEM]` |
| **JWT Tokens** | `eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` | `[REDACTED_JWT]` |
| **HMAC Signatures** | `X-Service-Signature:` header values | `[REDACTED]` |
| **Session Cookies** | `Cookie:` header containing session values | `Cookie: [REDACTED]` |

### 4.2 Environment Variable Redaction

The following environment variables **MUST NEVER** appear in logs:

```typescript
const REDACTED_ENV_VARS = [
  // Authentication
  'ADMIN_TOKEN',
  'ADMIN_KEY',
  'ADMIN_KEY_ROOT',
  'ADMIN_KEY_ABC',
  'ADMIN_KEY_CBC',
  'ADMIN_KEY_CBL',

  // Service Account Credentials
  'GOOGLE_SA_PRIVATE_KEY_PEM',
  'GOOGLE_PRIVATE_KEY',
  'GOOGLE_SA_CLIENT_EMAIL',
  'GOOGLE_CLIENT_EMAIL',
  'GOOGLE_CLIENT_SECRET',

  // Signing/Encryption
  'HMAC_SECRET',
  'SESSION_SECRET',
  'SERVICE_AUTH_SECRET',

  // Access Credentials
  'CF_ACCESS_CLIENT_SECRET',
  'CF_DEPLOY_TOKEN',
  'CF_DNS_TOKEN',
  'CF_AUDIT_TOKEN',

  // Resource IDs (Gating)
  'SHEETS_SPREADSHEET_ID',
  'STAGING_SHEETS_SPREADSHEET_ID',
];
```

### 4.3 Safe Logging Patterns

**DO:** Log these safely without redaction:

```typescript
// Environment identification (safe)
console.log(`[Worker] Environment: ${env.WORKER_ENV}`);
console.log(`[Worker] Version: ${env.WORKER_BUILD_VERSION}`);

// Operation status (safe)
console.log(`[Auth] Token validated for request ${requestId}`);
console.log(`[Sheets] Successfully read ${rowCount} rows`);

// Error codes without values (safe)
console.log(`[Auth] Authentication failed: INVALID_TOKEN`);
```

**DON'T:** Never log these patterns:

```typescript
// NEVER log token values
console.log(`Token: ${adminToken}`);  // ❌ NEVER

// NEVER log headers containing secrets
console.log(`Headers: ${JSON.stringify(request.headers)}`);  // ❌ NEVER

// NEVER log environment dump
console.log(`Env: ${JSON.stringify(env)}`);  // ❌ NEVER

// NEVER log request bodies that might contain secrets
console.log(`Body: ${await request.text()}`);  // ❌ NEVER (unfiltered)
```

### 4.4 Logging Implementation

Workers **SHOULD** implement a redaction helper:

```typescript
const REDACT_PATTERNS = [
  { pattern: /Bearer\s+[A-Za-z0-9\-_]+/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /-----BEGIN.*PRIVATE KEY-----[\s\S]*?-----END.*PRIVATE KEY-----/g, replacement: '[REDACTED_PRIVATE_KEY]' },
  { pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: '[REDACTED_JWT]' },
];

function redactSensitive(message: string): string {
  let redacted = message;
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}
```

---

## 5. Storage Requirements

### 5.1 Secret Storage Locations

| Storage Location | Use For | Access Pattern |
|------------------|---------|----------------|
| **Cloudflare Worker Secrets** | Runtime secrets (tokens, keys) | `wrangler secret put NAME --env ENV` |
| **GitHub Actions Secrets** | CI/CD secrets (deploy tokens) | Repository Settings → Secrets |
| **Password Manager** | Manual-use secrets (emergency tokens) | 1Password, Bitwarden vault |

### 5.2 Plaintext Variable Storage

| Storage Location | Use For | Access Pattern |
|------------------|---------|----------------|
| **wrangler.toml `[vars]`** | Non-sensitive config | Committed to repository |
| **GitHub Actions Variables** | Non-sensitive CI config | Repository Settings → Variables |
| **.env.example** | Documentation only | Template with placeholder values |

### 5.3 Prohibited Storage

| Storage | Prohibition | Remediation |
|---------|-------------|-------------|
| **.env files in repo** | Never commit actual values | Use `.gitignore`, rotate if exposed |
| **Code comments** | Never include secret values | Remove and rotate |
| **wrangler.toml [vars]** | Never store secrets | Move to `wrangler secret put` |
| **CI workflow files** | Never hardcode secrets | Use `${{ secrets.NAME }}` |

---

## 6. Secret Lifecycle

### 6.1 Creation

```
NEW SECRET CHECKLIST
────────────────────
[ ] Classified per Section 2 criteria
[ ] Named per SEC-1.2 convention (PROVIDER_PURPOSE_QUALIFIER)
[ ] Stored in appropriate location (Section 5.1)
[ ] Documented in WORKER_VARS_AUDIT.md
[ ] Logging redaction configured (Section 4.2)
[ ] Rotation schedule defined
```

### 6.2 Rotation

```
ROTATION CHECKLIST
──────────────────
[ ] New secret value generated (cryptographically random)
[ ] Updated in all storage locations
[ ] Deployment verified with new secret
[ ] Old secret revoked at provider
[ ] Rotation logged for audit trail
```

### 6.3 Deprecation

```
DEPRECATION CHECKLIST
─────────────────────
[ ] Confirmed no active usage
[ ] Removed from all storage locations
[ ] Removed from WORKER_VARS_AUDIT.md
[ ] Revoked at provider (if applicable)
[ ] Documented in change log
```

---

## 7. Compliance Verification

### 7.1 Automated Checks

| Check | Tool | Frequency |
|-------|------|-----------|
| Secrets in code | `git-secrets`, `gitleaks` | Every commit (pre-commit hook) |
| Secrets in logs | Log aggregator alerts | Continuous |
| Plaintext in wrangler.toml | CI script | Every PR |

### 7.2 Manual Audit

| Check | Owner | Frequency |
|-------|-------|-----------|
| WORKER_VARS_AUDIT.md review | Security team | Quarterly |
| Secret rotation compliance | DevOps | Monthly |
| Access permissions review | Security team | Quarterly |

---

## 8. Acceptance Criteria

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| **AC-1** | Policy defines secrets as auth keys, signing secrets, tokens, behavior-gating values | Document review (Section 2) |
| **AC-2** | Policy explicitly flags "IDs used for gating" as secrets | Document review (Section 2.2) |
| **AC-3** | Logging redaction requirements are documented | Document review (Section 4) |
| **AC-4** | Decision tree enables clear classification | Document review (Section 3) |
| **AC-5** | Storage requirements differentiate secrets from plaintext | Document review (Section 5) |

---

## 9. Related Documents

| Document | Path | Relationship |
|----------|------|--------------|
| CI Secret Naming | `docs/security/CI_SECRET_NAMING.md` | Naming conventions (SEC-1.2) |
| Worker Vars Audit | `docs/security/WORKER_VARS_AUDIT.md` | Audit template (SEC-7.1) |
| Service Auth Pattern | `docs/security/SERVICE_AUTH_PATTERN.md` | Service-to-service auth (SEC-5.3) |
| Security Baseline | `docs/security/SECURITY_BASELINE.md` | Overall security model |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-7.1 secrets policy |
