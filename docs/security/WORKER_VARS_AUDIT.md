# WORKER_VARS_AUDIT.md — Worker Environment Variables Audit Template

> **PROMPTSPEC-SEC-7.1** — Secrets Policy and Worker Vars Audit
> Role: Director of Security + DevOps Lead
> Created: 2026-01-05
> Status: **ACTIVE**
> Last Audit: 2026-01-05
> Last Updated: 2026-04-09 (D1 migration — removed stale Google Sheets secrets)

---

## 1. Purpose

This document provides a structured audit template for reviewing all Worker environment variables to ensure sensitive values are stored as secrets, not plaintext vars.

| Attribute           | Value                                                  |
| ------------------- | ------------------------------------------------------ |
| **Scope**           | All `wrangler.toml` vars and Cloudflare Worker secrets |
| **Prerequisites**   | Secrets Policy (SEC-7.1), CI Secret Naming (SEC-1.2)   |
| **Audit Frequency** | Quarterly or when adding new variables                 |

---

## 2. Audit Template

### 2.1 Column Definitions

| Column              | Description                                         |
| ------------------- | --------------------------------------------------- |
| **Var Name**        | Environment variable or secret name                 |
| **Purpose**         | What the variable is used for                       |
| **Secret?**         | YES if must be stored as secret; NO if plaintext OK |
| **Current Storage** | Where the value is currently stored                 |
| **Action**          | Required remediation (if any)                       |

### 2.2 Action Codes

| Code        | Meaning                                   | Priority |
| ----------- | ----------------------------------------- | -------- |
| ✅          | Correctly classified and stored           | None     |
| ⚠️ MIGRATE  | Currently plaintext, must move to secrets | High     |
| 🔄 ROTATE   | Secret may be exposed, rotate immediately | Critical |
| 📝 DOCUMENT | Add to documentation                      | Low      |
| 🗑️ REMOVE   | Deprecated, should be deleted             | Medium   |

---

## 3. Production Worker Audit (`cloudflare-proxy/wrangler.toml`)

### 3.1 Plaintext Variables (`[env.production.vars]`)

| Var Name               | Purpose                       | Secret? | Current Storage    | Action |
| ---------------------- | ----------------------------- | ------- | ------------------ | ------ |
| `WORKER_ENV`           | Environment identifier        | NO      | wrangler.toml vars | ✅     |
| `WORKER_BUILD_VERSION` | Build version string          | NO      | wrangler.toml vars | ✅     |
| `DEBUG_LEVEL`          | Logging verbosity             | NO      | wrangler.toml vars | ✅     |
| `BACKEND_MODE`         | Backend routing mode          | NO      | wrangler.toml vars | ✅     |
| `AUDIT_ENABLED`        | Enable/disable audit logs     | NO      | wrangler.toml vars | ✅     |
| `AUDIT_SHEET_NAME`     | Sheet tab name for audit logs | NO      | wrangler.toml vars | ✅     |

### 3.2 Secrets (Cloudflare Worker Secrets)

| Var Name                        | Purpose                         | Secret? | Current Storage   | Action                                                                            |
| ------------------------------- | ------------------------------- | ------- | ----------------- | --------------------------------------------------------------------------------- |
| `ADMIN_TOKEN`                   | Bearer token for admin API auth | **YES** | Cloudflare Secret | ✅                                                                                |
| ~~`GOOGLE_SA_CLIENT_EMAIL`~~    | ~~Service account email~~       | —       | —                 | 🗑️ Removed (D1 migration) — previously used in Phase 1 for Google Sheets auth     |
| ~~`GOOGLE_SA_PRIVATE_KEY_PEM`~~ | ~~Service account private key~~ | —       | —                 | 🗑️ Removed (D1 migration) — previously used in Phase 1 for Google Sheets auth     |
| ~~`SHEETS_SPREADSHEET_ID`~~     | ~~Spreadsheet ID~~              | —       | —                 | 🗑️ Removed (D1 migration) — previously used in Phase 1 to gate Sheets data access |
| `FORMS_ENCRYPTION_KEY`          | AES-GCM key for PII encryption  | **YES** | Cloudflare Secret | ✅                                                                                |
| `HMAC_SECRET`                   | HMAC signing key for mutations  | **YES** | Cloudflare Secret | ✅                                                                                |
| `SESSION_SECRET`                | Session cookie encryption       | **YES** | Cloudflare Secret | ✅                                                                                |

---

## 4. Staging Worker Audit (`wrangler.toml` root)

### 4.1 Plaintext Variables (`[env.staging.vars]`)

| Var Name                 | Purpose                            | Secret? | Current Storage    | Action |
| ------------------------ | ---------------------------------- | ------- | ------------------ | ------ |
| `WORKER_ENV`             | Environment identifier             | NO      | wrangler.toml vars | ✅     |
| `WORKER_BUILD_VERSION`   | Build version string               | NO      | wrangler.toml vars | ✅     |
| `DEBUG_LEVEL`            | Logging verbosity                  | NO      | wrangler.toml vars | ✅     |
| `BACKEND_MODE`           | Backend routing mode               | NO      | wrangler.toml vars | ✅     |
| `ENABLE_DEBUG_ENDPOINTS` | Enable debug routes (staging only) | NO      | wrangler.toml vars | ✅     |
| `UPSTREAM_TIMEOUT_MS`    | Upstream request timeout           | NO      | wrangler.toml vars | ✅     |
| `AUDIT_ENABLED`          | Enable/disable audit logs          | NO      | wrangler.toml vars | ✅     |
| `AUDIT_SHEET_NAME`       | Sheet tab name for audit logs      | NO      | wrangler.toml vars | ✅     |

### 4.2 Secrets (Cloudflare Worker Secrets)

| Var Name                        | Purpose                         | Secret? | Current Storage   | Action                                                                            |
| ------------------------------- | ------------------------------- | ------- | ----------------- | --------------------------------------------------------------------------------- |
| `ADMIN_TOKEN`                   | Bearer token for admin API auth | **YES** | Cloudflare Secret | ✅                                                                                |
| ~~`GOOGLE_SA_CLIENT_EMAIL`~~    | ~~Service account email~~       | —       | —                 | 🗑️ Removed (D1 migration) — previously used in Phase 1 for Google Sheets auth     |
| ~~`GOOGLE_SA_PRIVATE_KEY_PEM`~~ | ~~Service account private key~~ | —       | —                 | 🗑️ Removed (D1 migration) — previously used in Phase 1 for Google Sheets auth     |
| ~~`SHEETS_SPREADSHEET_ID`~~     | ~~Spreadsheet ID~~              | —       | —                 | 🗑️ Removed (D1 migration) — previously used in Phase 1 to gate Sheets data access |
| `FORMS_ENCRYPTION_KEY`          | AES-GCM key for PII encryption  | **YES** | Cloudflare Secret | ✅                                                                                |
| `HMAC_SECRET`                   | HMAC signing key for mutations  | **YES** | Cloudflare Secret | ✅                                                                                |
| `UPSTREAM_WEBAPP_URL`           | Upstream health check URL       | NO      | Cloudflare Secret | ⚠️ Could be plaintext var                                                         |

---

## 5. Router Worker Audit (`worker/wrangler.toml`)

### 5.1 Plaintext Variables

| Var Name                 | Purpose                | Secret? | Current Storage    | Action |
| ------------------------ | ---------------------- | ------- | ------------------ | ------ |
| `WORKER_ENV`             | Environment identifier | NO      | wrangler.toml vars | ✅     |
| `WORKER_NAME`            | Worker name identifier | NO      | wrangler.toml vars | ✅     |
| `WORKER_BUILD_VERSION`   | Build version string   | NO      | wrangler.toml vars | ✅     |
| `DEBUG_LEVEL`            | Logging verbosity      | NO      | wrangler.toml vars | ✅     |
| `ENABLE_DEBUG_ENDPOINTS` | Enable debug routes    | NO      | wrangler.toml vars | ✅     |

### 5.2 Secrets (Cloudflare Worker Secrets)

| Var Name                        | Purpose                         | Secret? | Current Storage   | Action                                                                            |
| ------------------------------- | ------------------------------- | ------- | ----------------- | --------------------------------------------------------------------------------- |
| `ADMIN_TOKEN`                   | Bearer token for admin API auth | **YES** | Cloudflare Secret | ✅                                                                                |
| ~~`GOOGLE_SA_CLIENT_EMAIL`~~    | ~~Service account email~~       | —       | —                 | 🗑️ Removed (D1 migration) — previously used in Phase 1 for Google Sheets auth     |
| ~~`GOOGLE_SA_PRIVATE_KEY_PEM`~~ | ~~Service account private key~~ | —       | —                 | 🗑️ Removed (D1 migration) — previously used in Phase 1 for Google Sheets auth     |
| ~~`SHEETS_SPREADSHEET_ID`~~     | ~~Spreadsheet ID~~              | —       | —                 | 🗑️ Removed (D1 migration) — previously used in Phase 1 to gate Sheets data access |
| `FORMS_ENCRYPTION_KEY`          | AES-GCM key for PII encryption  | **YES** | Cloudflare Secret | ✅                                                                                |
| `UPSTREAM_WEBAPP_URL`           | Upstream health check URL       | NO      | Cloudflare Secret | ⚠️ Could be plaintext var                                                         |
| `HMAC_SECRET`                   | HMAC signing key for mutations  | **YES** | Cloudflare Secret | ✅                                                                                |

---

## 6. GitHub Actions Secrets Audit

### 6.1 Repository Secrets

| Secret Name                         | Purpose                              | Secret? | Current Storage | Action                                                                              |
| ----------------------------------- | ------------------------------------ | ------- | --------------- | ----------------------------------------------------------------------------------- |
| `CF_DEPLOY_TOKEN`                   | Cloudflare API token for deployments | **YES** | GitHub Secrets  | ✅                                                                                  |
| `CF_ACCOUNT_ID`                     | Cloudflare account identifier        | NO      | GitHub Secrets  | ⚠️ Could be plaintext var                                                           |
| ~~`GOOGLE_CLIENT_EMAIL`~~           | ~~CI verification service account~~  | —       | —               | 🗑️ Removed (D1 migration) — previously used in Phase 1 CI for Sheets verification   |
| ~~`GOOGLE_PRIVATE_KEY`~~            | ~~CI verification private key~~      | —       | —               | 🗑️ Removed (D1 migration) — previously used in Phase 1 CI for Sheets verification   |
| `ADMIN_KEY_ROOT`                    | Root brand admin key                 | **YES** | GitHub Secrets  | ✅                                                                                  |
| `ADMIN_KEY_ABC`                     | ABC brand admin key                  | **YES** | GitHub Secrets  | ✅                                                                                  |
| `ADMIN_KEY_CBC`                     | CBC brand admin key                  | **YES** | GitHub Secrets  | ✅                                                                                  |
| `ADMIN_KEY_CBL`                     | CBL brand admin key                  | **YES** | GitHub Secrets  | ✅                                                                                  |
| ~~`STAGING_SHEETS_SPREADSHEET_ID`~~ | ~~Staging spreadsheet (gates data)~~ | —       | —               | 🗑️ Removed (D1 migration) — previously used in Phase 1 CI for staging Sheets access |

### 6.2 Environment Secrets (Staging/Production)

| Secret Name       | Environment | Purpose                     | Secret? | Action |
| ----------------- | ----------- | --------------------------- | ------- | ------ |
| `CF_DEPLOY_TOKEN` | staging     | Staging deployment token    | **YES** | ✅     |
| `CF_DEPLOY_TOKEN` | production  | Production deployment token | **YES** | ✅     |

---

## 7. IDs Used for Gating — Special Attention

Per SECRETS_POLICY.md Section 2.2, IDs that gate access must be classified as secrets.

| ID Variable                         | Gates Access To                      | Secret Classification   | Action                                                                                |
| ----------------------------------- | ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------- |
| ~~`SHEETS_SPREADSHEET_ID`~~         | ~~Production event data~~            | —                       | 🗑️ Removed (D1 migration) — data now in Cloudflare D1, previously gated Sheets access |
| ~~`STAGING_SHEETS_SPREADSHEET_ID`~~ | ~~Staging event data~~               | —                       | 🗑️ Removed (D1 migration) — data now in Cloudflare D1, previously gated Sheets access |
| `CF_ACCOUNT_ID`                     | Cloudflare account (requires token)  | NO - insufficient alone | ⚠️ Could move to plaintext                                                            |
| `HMAC_NONCE_KV` namespace ID        | KV storage (requires Worker binding) | NO - insufficient alone | ✅ Plaintext in wrangler.toml                                                         |

**~~Rationale for SHEETS_SPREADSHEET_ID as Secret~~ (Historical — Phase 1 only):**

- ~~The spreadsheet contains all event data (public and admin)~~
- ~~Worker authenticates via service account (already configured)~~
- ~~Knowledge of spreadsheet ID + authenticated Worker = full data access~~
- ~~Must be classified as secret per "IDs used for gating" rule~~
- **Phase 2 (D1 migration):** All event data now stored in Cloudflare D1. Google Sheets secrets removed. D1 access is governed by Worker bindings in `wrangler.toml` — no external secret required.

---

## 8. Audit Checklist

### 8.1 Pre-Audit Preparation

```
[ ] Export current wrangler.toml vars from all environments
[ ] Export GitHub Secrets list: gh secret list
[ ] Export Cloudflare Worker secrets: wrangler secret list --env <env>
[ ] Review recent PRs for new variables
```

### 8.2 Classification Review

```
[ ] All auth tokens stored as secrets
[ ] All signing keys stored as secrets
[ ] All private keys stored as secrets
[ ] All gating IDs stored as secrets
[ ] No secrets in wrangler.toml [vars] sections
[ ] No secrets in code or comments
```

### 8.3 Post-Audit Actions

```
[ ] Migrate any misclassified values to secrets
[ ] Rotate any potentially exposed secrets
[ ] Update this audit document
[ ] Document changes in audit log (Section 10)
```

---

## 9. Adding New Variables

When adding a new environment variable, complete this checklist:

```
NEW VARIABLE CHECKLIST: _______________
───────────────────────────────────────
[ ] Variable name follows SEC-1.2 convention
[ ] Classified using SECRETS_POLICY.md decision tree
[ ] Added to appropriate audit table in this document

If SECRET:
[ ] Added via: wrangler secret put NAME --env ENV
[ ] Added to logging redaction list
[ ] Documented rotation schedule

If PLAINTEXT:
[ ] Added to wrangler.toml [env.*.vars]
[ ] Verified no sensitive data in value
```

---

## 10. Audit History

| Date       | Auditor     | Scope                       | Findings                    | Actions Taken                                                        |
| ---------- | ----------- | --------------------------- | --------------------------- | -------------------------------------------------------------------- |
| 2026-01-05 | Claude Code | Full audit                  | Initial baseline            | Created audit template                                               |
| 2026-04-09 | Claude Code | D1 migration reconciliation | Google Sheets secrets stale | Marked GOOGLE*SA*_, SHEETS\__ as removed; added FORMS_ENCRYPTION_KEY |

---

## 11. Blank Audit Template

Copy this template for ad-hoc audits:

```markdown
## Variable Audit: [COMPONENT NAME]

| Var Name | Purpose | Secret? | Current Storage | Action |
| -------- | ------- | ------- | --------------- | ------ |
|          |         |         |                 |        |
|          |         |         |                 |        |
|          |         |         |                 |        |

### Findings:

-

### Actions Required:

-
```

---

## 12. Related Documents

| Document             | Path                                    | Relationship                      |
| -------------------- | --------------------------------------- | --------------------------------- |
| Secrets Policy       | `docs/security/SECRETS_POLICY.md`       | Classification criteria (SEC-7.1) |
| CI Secret Naming     | `docs/security/CI_SECRET_NAMING.md`     | Naming conventions (SEC-1.2)      |
| Service Auth Pattern | `docs/security/SERVICE_AUTH_PATTERN.md` | Service-to-service auth (SEC-5.3) |
| Cloudflare Secrets   | `docs/CLOUDFLARE_SECRETS.md`            | Full secrets reference            |

---

## Document History

| Date       | Author      | Changes                                                                           |
| ---------- | ----------- | --------------------------------------------------------------------------------- |
| 2026-01-05 | Claude Code | Initial PROMPTSPEC-SEC-7.1 audit template                                         |
| 2026-04-09 | Claude Code | D1 migration: marked Google Sheets secrets as removed, added FORMS_ENCRYPTION_KEY |
