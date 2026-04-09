# Infrastructure Checklist — P1-6 / P1-7 / P1-8

> **Purpose:** Step-by-step, copy-paste-ready commands to go from zero infrastructure to a live `stg.oursharedevents.com` with a green CI pipeline.
>
> **Updated:** 2026-04-09 — corrected for D1-native architecture (no Google Sheets dependency).

---

## Phase A: Cloudflare Zone Activation (P1-6, ~30 min + DNS propagation)

### A1. Add the domain

1. Log in: [dash.cloudflare.com](https://dash.cloudflare.com)
2. **Websites > Add a site** > enter `oursharedevents.com` > **Free plan**
3. Cloudflare assigns two nameservers — copy them

### A2. Update registrar nameservers

1. Go to your domain registrar (wherever `oursharedevents.com` was purchased)
2. Replace current nameservers with the two Cloudflare assigned
3. Save — propagation takes 5 min to 48 hours (usually <30 min)

### A3. Verify zone is active

- Cloudflare dashboard: zone status should show **Active** (green)
- If still pending, wait for NS propagation

### A4. Add DNS records

In **DNS > Records**, add three A records:

| Type | Name  | Content   | Proxy                  |
| ---- | ----- | --------- | ---------------------- |
| A    | `@`   | 192.0.2.1 | Proxied (orange cloud) |
| A    | `www` | 192.0.2.1 | Proxied (orange cloud) |
| A    | `stg` | 192.0.2.1 | Proxied (orange cloud) |

> `192.0.2.1` is a dummy IP — Cloudflare Workers intercept before it hits the origin.

### A5. SSL/TLS settings

1. **SSL/TLS > Overview** > set mode to **Full (strict)**
2. **SSL/TLS > Edge Certificates** > enable **Always Use HTTPS**

### A6. Collect credentials

1. **Account ID**: visible in the dashboard URL or zone Overview sidebar — copy it
2. **API Token**: **My Profile > API Tokens > Create Token**
   - Template: **Edit Cloudflare Workers**
   - Account Resources: your account only
   - Zone Resources: `oursharedevents.com` only
   - Copy token immediately (shown once)
3. **Generate ADMIN_KEY**:
   ```bash
   openssl rand -hex 32
   ```
   Copy the output — this is your admin bearer token.
4. **Generate FORMS_ENCRYPTION_KEY**:
   ```bash
   openssl rand -hex 32
   ```
   Copy the output — this is the AES-GCM key for PII encryption.

### A7. Provision production D1 databases

```bash
cd workers/oursharedevents

# Main database
wrangler d1 create ocr-db-production
# Output: database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
# Copy the ID

# Forms database
wrangler d1 create ocr-forms-db-production
# Output: database_id = "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy"
# Copy the ID
```

Then update `wrangler.toml` — replace the placeholder IDs:

```
<production-db-id>       → paste actual main DB ID
<production-forms-db-id> → paste actual forms DB ID
```

**P1-6 gate**: Zone active + DNS records + SSL + credentials collected + prod D1 provisioned.

---

## Phase B: Secrets + First Deploy (P1-7, ~15 min)

### B1. GitHub Actions secrets

Go to **GitHub repo > Settings > Secrets and variables > Actions > New repository secret**:

| Secret Name             | Value          |
| ----------------------- | -------------- |
| `CLOUDFLARE_API_TOKEN`  | From step A6.2 |
| `CLOUDFLARE_ACCOUNT_ID` | From step A6.1 |
| `ADMIN_KEY`             | From step A6.3 |

### B2. Wrangler login

```bash
npm install -g wrangler   # if not already installed
wrangler login            # opens browser, authorize
```

### B3. Set Wrangler secrets (staging)

```bash
cd workers/oursharedevents

# Interactive — paste value when prompted
wrangler secret put ADMIN_KEY --env staging
wrangler secret put FORMS_ENCRYPTION_KEY --env staging

# Verify
wrangler secret list --env staging
# Should show: ADMIN_KEY, FORMS_ENCRYPTION_KEY
```

### B4. Apply D1 migrations to staging

```bash
cd workers/oursharedevents

# Main database (17 migrations)
wrangler d1 migrations apply DB --env staging --remote

# Forms database
wrangler d1 migrations apply FORMS_DB --env staging --remote
```

### B5. Deploy to staging

```bash
cd workers/oursharedevents
npm install
npm run deploy:staging
# Expected output: "Published oursharedevents-staging"
```

### B6. Health check

```bash
curl -s https://stg.oursharedevents.com/health | jq .
```

Expected:

```json
{
  "ok": true,
  "env": "staging",
  "version": "stg-2026.03.22",
  "d1": "ok"
}
```

If this returns a valid response, **stg.oursharedevents.com is alive**.

**P1-7 gate**: Health check passes, D1 migrations applied, secrets set.

---

## Phase C: Staging Sign-Off (P1-8, ~10 min)

Run each check. All must pass.

```bash
# 1. Health endpoint
curl -s https://stg.oursharedevents.com/health | jq .
# → { "ok": true, "env": "staging" }

# 2. Events API
curl -s https://stg.oursharedevents.com/api/v2/events | jq .
# → { "ok": true, "items": [...] }

# 3. Public page
curl -s -o /dev/null -w "%{http_code}" https://stg.oursharedevents.com/
# → 200

# 4. Admin rejects unauthenticated
curl -s -o /dev/null -w "%{http_code}" https://stg.oursharedevents.com/admin
# → 401

# 5. Admin accepts token
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer <YOUR_ADMIN_KEY>" https://stg.oursharedevents.com/admin
# → 200

# 6. Unknown route returns graceful error (not CF 1xxx)
curl -s -o /dev/null -w "%{http_code}" https://stg.oursharedevents.com/nonexistent
# → 404

# 7. HTTPS — open in browser, verify padlock, no mixed-content warnings
# 8. Mobile — load on real device, verify public page renders
```

**P1-8 gate**: All 8 checks pass → staging is signed off → P1-9 (repo migration) unblocked.

---

## Phase D: CI Pipeline Validation (bonus — confirms automation works)

After Phase B, push any commit to `main`:

```bash
git push origin main
```

The GitHub Actions workflow (`oursharedevents-ci.yml`) should:

1. Run security gate (lint, typecheck, unit tests)
2. Deploy to staging automatically
3. Run quality smoke tests
4. Run functional smoke tests (API + UI + Newman)

Check the Actions tab — all stages green = CI is real.

---

## Troubleshooting

| Symptom                                 | Fix                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------- |
| Zone still "Pending"                    | NS propagation can take up to 48h — check with `dig oursharedevents.com NS` |
| `wrangler deploy` fails with auth error | Verify `wrangler login` completed, API token has Workers:Edit permission    |
| Health returns `{ "d1": "error" }`      | Migrations not applied — run B4 again                                       |
| 1101 Worker error                       | Worker threw exception — run `wrangler tail --env staging` to see logs      |
| 522/523 error                           | DNS not proxied (orange cloud) or zone not active                           |
| CI deploy fails                         | Check GitHub Actions secrets match exactly (no trailing whitespace)         |

---

## Secrets Summary (D1-Native)

| Secret                  | Where                     | Purpose                    | Generate                  |
| ----------------------- | ------------------------- | -------------------------- | ------------------------- |
| `CLOUDFLARE_API_TOKEN`  | GitHub Actions            | CI deploys worker          | CF Dashboard > API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions            | CI targets correct account | CF Dashboard > Overview   |
| `ADMIN_KEY`             | GitHub Actions + Wrangler | Bearer token for `/admin`  | `openssl rand -hex 32`    |
| `FORMS_ENCRYPTION_KEY`  | Wrangler only             | AES-GCM for PII fields     | `openssl rand -hex 32`    |

**Removed** (Phase 2 D1 migration):

- ~~`GOOGLE_SA_CLIENT_EMAIL`~~ — no Sheets dependency
- ~~`GOOGLE_SA_PRIVATE_KEY_PEM`~~ — no Sheets dependency
- ~~`SHEETS_SPREADSHEET_ID`~~ — D1 is the data layer
