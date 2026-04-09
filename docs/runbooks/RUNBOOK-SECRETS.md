# Runbook: Rotating Secrets and Verifying Environment Alignment

> **Purpose:** Procedures for rotating secrets and verifying environment configuration.
> **Last Updated:** 2026-04-09 | **Architecture:** D1-native (Phase 2 complete)
> **Supersedes:** Previous version referencing Google Sheets/GAS secrets

---

## Quick Reference

| Action               | Command                                                |
| -------------------- | ------------------------------------------------------ |
| List Worker secrets  | `wrangler secret list --env staging`                   |
| Check backend health | `curl -s https://stg.oursharedevents.com/health \| jq` |
| Deploy staging       | `cd workers/oursharedevents && npm run deploy:staging` |
| Deploy production    | Tag `vX.Y.Z` → CI auto-deploys                         |

---

## Secrets Inventory (D1-Native)

### GitHub Actions Secrets

| Secret                  | Purpose                    | Rotation Period |
| ----------------------- | -------------------------- | --------------- |
| `CLOUDFLARE_API_TOKEN`  | Worker deployment (scoped) | 90 days         |
| `CLOUDFLARE_ACCOUNT_ID` | Account identifier         | Static          |
| `ADMIN_KEY`             | Admin API authentication   | 90 days         |

### Cloudflare Worker Secrets (set via `wrangler secret put`)

| Secret                 | Purpose                          | Rotation Period |
| ---------------------- | -------------------------------- | --------------- |
| `ADMIN_KEY`            | Bearer token for `/admin` routes | 90 days         |
| `FORMS_ENCRYPTION_KEY` | AES-GCM key for PII encryption   | 90 days         |

### Removed Secrets (Phase 2 D1 Migration)

These secrets were required when Google Sheets was the data layer. They are **no longer needed**:

| Secret (Removed)                    | Reason                            |
| ----------------------------------- | --------------------------------- |
| ~~`GOOGLE_SA_CLIENT_EMAIL`~~        | D1 replaced Sheets — no SA needed |
| ~~`GOOGLE_SA_PRIVATE_KEY_PEM`~~     | D1 replaced Sheets — no SA needed |
| ~~`SHEETS_SPREADSHEET_ID`~~         | D1 replaced Sheets                |
| ~~`GOOGLE_CLIENT_EMAIL`~~           | Legacy GitHub Actions variant     |
| ~~`GOOGLE_PRIVATE_KEY`~~            | Legacy GitHub Actions variant     |
| ~~`STAGING_SHEETS_SPREADSHEET_ID`~~ | Legacy staging variant            |

---

## Rotating Admin Key

### Step 1: Generate New Key

```bash
openssl rand -hex 32
```

### Step 2: Update GitHub Actions Secret

1. GitHub repo > Settings > Secrets and variables > Actions
2. Update `ADMIN_KEY` with new value

### Step 3: Update Cloudflare Worker Secrets

```bash
cd workers/oursharedevents

# Staging
wrangler secret put ADMIN_KEY --env staging
# Paste new key

# Production
wrangler secret put ADMIN_KEY --env production
# Paste same new key
```

### Step 4: Redeploy

```bash
# Staging (immediate)
npm run deploy:staging

# Production (via CI — tag a release)
```

### Step 5: Verify

```bash
# Test admin endpoint with new key
curl -s -H "Authorization: Bearer <NEW_KEY>" \
  https://stg.oursharedevents.com/api/v2/admin/events | jq '.ok'
# Expected: true

# Verify old key is rejected
curl -s -H "Authorization: Bearer <OLD_KEY>" \
  https://stg.oursharedevents.com/admin
# Expected: 401
```

---

## Rotating FORMS_ENCRYPTION_KEY

> **WARNING:** Rotating this key means previously encrypted PII data cannot be decrypted.
> Only rotate if the key is compromised. Plan for data migration if needed.

### Step 1: Generate New Key

```bash
openssl rand -hex 32
```

### Step 2: Update Cloudflare Worker Secrets

```bash
cd workers/oursharedevents

wrangler secret put FORMS_ENCRYPTION_KEY --env staging
wrangler secret put FORMS_ENCRYPTION_KEY --env production
```

### Step 3: Redeploy and Verify

```bash
npm run deploy:staging
# Submit a test form, verify it encrypts correctly
```

### Disaster Recovery Note

If FORMS_ENCRYPTION_KEY is lost:

- Encrypted email fields in `email_signups` table become unrecoverable
- Registration and survey data (hashed, not encrypted) is unaffected
- The daily PII cron job will still scrub data on schedule
- Generate a new key and accept data loss on previously encrypted fields

---

## Rotating Cloudflare API Token

### Step 1: Create New Scoped Token

1. [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens) > Create Token
2. Use "Edit Cloudflare Workers" template:
   - Workers Scripts: Edit
   - Workers Routes: Edit
   - Account Settings: Read
3. Zone restriction: `oursharedevents.com` only
4. Copy the new token

### Step 2: Update GitHub Secret

1. GitHub repo > Settings > Secrets > `CLOUDFLARE_API_TOKEN`
2. Paste new token

### Step 3: Verify

```bash
export CLOUDFLARE_API_TOKEN=<new_token>
wrangler whoami
# Should show account info
```

### Step 4: Revoke Old Token

1. Cloudflare API Tokens page > find old token > Delete

---

## Verifying Environment Alignment

### Health Check (D1-Native)

```bash
# Staging
curl -s https://stg.oursharedevents.com/health | jq
# Expected:
# {
#   "ok": true,
#   "env": "staging",
#   "version": "stg-YYYY.MM.DD",
#   "d1": "ok"
# }

# Production
curl -s https://oursharedevents.com/health | jq
```

### List Current Secrets

```bash
wrangler secret list --env staging
# Expected: ADMIN_KEY, FORMS_ENCRYPTION_KEY

wrangler secret list --env production
# Expected: ADMIN_KEY, FORMS_ENCRYPTION_KEY
```

### Verify D1 Connectivity

```bash
# Events API (proves D1 main DB is alive)
curl -s https://stg.oursharedevents.com/api/v2/events | jq '.ok'
# Expected: true

# Admin auth (proves ADMIN_KEY is set)
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer <ADMIN_KEY>" \
  https://stg.oursharedevents.com/admin
# Expected: 200
```

---

## Troubleshooting

### Error: D1 query failed / "d1": "error"

**Cause:** D1 migrations not applied or database not provisioned
**Fix:**

```bash
cd workers/oursharedevents
wrangler d1 migrations apply DB --env staging --remote
wrangler d1 migrations apply FORMS_DB --env staging --remote
```

### Error: 401 on admin routes

**Cause:** ADMIN_KEY not set or mismatched between GitHub and Wrangler
**Fix:**

```bash
wrangler secret put ADMIN_KEY --env staging
# Re-paste the same value used in GitHub Actions
```

### Error: Form encryption fails

**Cause:** FORMS_ENCRYPTION_KEY not set or invalid
**Fix:**

```bash
wrangler secret put FORMS_ENCRYPTION_KEY --env staging
# Paste a 32+ character hex string
```

### Authentication Failures After Rotation

1. Verify secret updated in **both** GitHub Actions AND Wrangler
2. Redeploy worker after secret changes
3. Check `wrangler secret list` confirms the secret exists
4. Use `wrangler tail --env staging` to see real-time error logs

---

## Related Documentation

- [INFRA-CHECKLIST.md](../deployment/INFRA-CHECKLIST.md) — Full infrastructure setup
- [CLOUDFLARE_SECRETS.md](../deployment/CLOUDFLARE_SECRETS.md) — Secrets reference
- [DISASTER-RECOVERY.md](../runbooks/DISASTER-RECOVERY.md) — DR procedures
- [.github-secrets-required.json](../../.github-secrets-required.json) — Canonical secrets schema
