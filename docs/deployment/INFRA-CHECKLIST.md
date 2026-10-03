# Infrastructure Checklist — P1-6 / P1-7 / P1-8

> **Purpose:** Step-by-step, copy-paste-ready commands to go from zero infrastructure to a live `stg.oursharedevents.com` with a green CI pipeline.
>
> **Updated:** 2026-05-09 — reflects D1-native architecture, WIF/BigQuery, CF Access JWT, AES-GCM PII encryption, rate limiter, event state machine, 27 migrations.

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
- If still pending: `dig oursharedevents.com NS` — should show Cloudflare nameservers

### A4. Add DNS records

In **DNS > Records**, add three A records:

| Type | Name  | Content   | Proxy                  |
| ---- | ----- | --------- | ---------------------- |
| A    | `@`   | 192.0.2.1 | Proxied (orange cloud) |
| A    | `www` | 192.0.2.1 | Proxied (orange cloud) |
| A    | `stg` | 192.0.2.1 | Proxied (orange cloud) |

> `192.0.2.1` is a dummy IP — Cloudflare Workers intercept before it hits the origin. All three records **must** be Proxied (orange cloud), not DNS-only (grey cloud).

### A5. SSL/TLS settings

1. **SSL/TLS > Overview** > set mode to **Full (strict)**
2. **SSL/TLS > Edge Certificates** > enable **Always Use HTTPS**

### A6. Collect credentials

1. **Account ID**: dashboard URL or zone Overview sidebar → copy it → becomes `CLOUDFLARE_ACCOUNT_ID`
2. **API Token**: **My Profile > API Tokens > Create Token**
   - Template: **Edit Cloudflare Workers**
   - Account Resources: your account
   - Zone Resources: `oursharedevents.com`
   - Copy token → becomes `CLOUDFLARE_API_TOKEN_OSE`
3. **Generate ADMIN_TOKEN** (bearer token for `/admin`):
   ```bash
   openssl rand -hex 32
   ```
4. **Generate FORMS_ENCRYPTION_KEY** (AES-GCM key for PII email encryption):
   ```bash
   openssl rand -hex 32
   ```
5. **Generate X_OCR_INTERNAL** (shared secret for CI automation / internal requests):
   ```bash
   openssl rand -hex 32
   ```

### A7. Provision D1 databases

```bash
cd workers/oursharedevents

# Main database
wrangler d1 create ocr-db-staging
# → copy the database_id into wrangler.toml [env.staging]

wrangler d1 create ocr-db-production
# → copy the database_id into wrangler.toml [env.production]

# Forms database
wrangler d1 create ocr-forms-db-staging
wrangler d1 create ocr-forms-db-production
```

Then update `wrangler.toml` with the real IDs (replace any `<placeholder-id>` values).

### A8. Provision R2 bucket (staging)

```bash
wrangler r2 bucket create ose-uploads-staging
wrangler r2 bucket create ose-uploads-production
```

> R2 must be enabled on your Cloudflare account before this works (requires payment method on file, free tier available). See `project_r2_deferred.md` if blocked.

**P1-6 gate**: Zone active + DNS records + SSL + credentials collected + D1 + R2 provisioned.

---

## Phase B: Secrets + First Deploy (P1-7, ~20 min)

### B1. GitHub Actions secrets

**GitHub repo > Settings > Secrets and variables > Actions > New repository secret**:

| Secret name                | Value          | Purpose                     |
| -------------------------- | -------------- | --------------------------- |
| `CLOUDFLARE_API_TOKEN_OSE` | From step A6.2 | CI deploys worker           |
| `CLOUDFLARE_ACCOUNT_ID`    | From step A6.1 | CI targets correct account  |
| `ADMIN_TOKEN`              | From step A6.3 | CI smoke tests authenticate |

### B2. Wrangler login

```bash
npm install -g wrangler
wrangler login    # opens browser — authorize with your Cloudflare account
wrangler whoami   # verify: shows your account name
```

### B3. Set Wrangler secrets (staging)

These live in Cloudflare's secret store — separate from GitHub. Set once per environment.

**Required secrets (staging fails without these):**

```bash
cd workers/oursharedevents

# Admin bearer token — same value as GitHub secret ADMIN_TOKEN
wrangler secret put ADMIN_TOKEN --env staging

# AES-GCM key for PII email encryption (32-byte hex from step A6.4)
wrangler secret put FORMS_ENCRYPTION_KEY --env staging

# Internal CI automation header secret (from step A6.5)
wrangler secret put X_OCR_INTERNAL --env staging
```

**CF Access JWT secrets (production-critical; staging uses bearer-token fallback):**

```bash
# Comma-separated list of allowed admin email addresses
wrangler secret put ALLOWED_ADMIN_EMAILS --env staging
# e.g. paste: ourcommunityrituals@gmail.com

# Comma-separated allowed admin domains (optional, leave blank if using email list)
wrangler secret put ALLOWED_ADMIN_DOMAINS --env staging
```

**BigQuery / WIF secrets (optional — graceful no-op if omitted):**

```bash
# Workload Identity Federation private key PEM
wrangler secret put WIF_PRIVATE_KEY_PEM --env staging

# WIF pool, provider, issuer IDs (from GCP console)
wrangler secret put WIF_POOL_ID --env staging
wrangler secret put WIF_PROVIDER_ID --env staging
wrangler secret put WIF_ISSUER --env staging

# GCP project
wrangler secret put GCP_PROJECT_ID --env staging
wrangler secret put GCP_PROJECT_NUMBER --env staging

# BigQuery dataset (default: oursharedevents_backup)
wrangler secret put BIGQUERY_DATASET_ID --env staging
```

**Google Maps secret (optional — graceful no-op if omitted):**

```bash
wrangler secret put GOOGLE_MAPS_API_KEY --env staging
```

**Verify required secrets are set:**

```bash
wrangler secret list --env staging
# Must include: ADMIN_TOKEN, FORMS_ENCRYPTION_KEY, X_OCR_INTERNAL, ALLOWED_ADMIN_EMAILS
```

### B4. Apply D1 migrations (27 migrations as of 2026-05-09)

```bash
cd workers/oursharedevents

# Main database — 27 migrations (0001 through 0027)
wrangler d1 migrations apply DB --env staging --remote

# Forms database
wrangler d1 migrations apply FORMS_DB --env staging --remote
```

Verify migrations applied:

```bash
wrangler d1 execute DB --env staging --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
# Should list: events, sponsors, poster_deployments, scans, checkins, registrations,
#              scan_aggregates, subscribers, corridors, rings, event_templates,
#              event_type_registry, corridor_regulatory_status, sponsor_impressions,
#              admin_audit_log + indexes
```

### B5. Deploy to staging

```bash
cd workers/oursharedevents
npm install
npm run deploy:staging
# Expected: "Published oursharedevents-stg (stg.oursharedevents.com)"
```

Or just push to `main` — CI deploys staging automatically on every merge.

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

**P1-7 gate**: Health check passes + D1 migrations applied + required secrets set.

---

## Phase C: Staging Sign-Off (P1-8)

Run every check. All must pass. See `docs/qa/STAGING-SMOKE.md` for the full surface-by-surface checklist.

**Quick sign-off (8 core checks):**

```bash
STG=https://stg.oursharedevents.com
ADMIN_TOKEN=<your-admin-token>

# 1. Health
curl -s $STG/health | jq .
# → { "ok": true, "env": "staging", "d1": "ok" }

# 2. Events API
curl -s $STG/api/v2/events | jq '.ok, (.items | length)'
# → true, <N>

# 3. Public page
curl -s -o /dev/null -w "%{http_code}" $STG/
# → 200

# 4. Admin rejects unauthenticated
curl -s -o /dev/null -w "%{http_code}" $STG/admin
# → 401

# 5. Admin accepts token (bearer fallback — staging only)
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $ADMIN_TOKEN" $STG/admin
# → 200

# 6. Public mutations blocked (SEC-7 — read-only guard)
curl -s -o /dev/null -w "%{http_code}" -X POST $STG/api/v2/events
# → 405

# 7. Privacy route
curl -s -o /dev/null -w "%{http_code}" $STG/privacy
# → 200

# 8. Unknown route — graceful 404 (not CF 1xxx error)
curl -s -o /dev/null -w "%{http_code}" $STG/does-not-exist
# → 404
```

**Full smoke test:** Run `docs/qa/STAGING-SMOKE.md` — covers all 9 surfaces, feature flag tiers, security model, and domain state machine.

**P1-8 gate**: All 8 core checks pass + full smoke checklist signed off.

---

## Phase D: CI Pipeline Validation

After Phase B, push any commit to `main`. The GitHub Actions pipeline should:

1. **S0 Security** — Semgrep, gitleaks, detect-secrets, axe-core WCAG
2. **T0 Gate** — lint, typecheck, unit tests, flag seed parity (22 flags)
3. **T1 Deploy** — staging deploy + D1 migrations
4. **T2 Quality** — integration tests, E2E organizer flow (QA-4)
5. **T3 Smoke** — API + surface smoke tests
6. **T4 Notify** — completion signal

Check the Actions tab — all tiers green = CI is real.

> **Note:** CodeQL runs in S0 with `ram: 8192 / threads: 8` (explicit cap, PR #145). This prevents the JVM commit-limit failure on Bloodraven at 32 GB physical RAM.

---

## Troubleshooting

| Symptom                            | Fix                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------ |
| Zone still "Pending"               | NS propagation up to 48h — `dig oursharedevents.com NS`                  |
| `wrangler deploy` auth error       | Verify `wrangler login` completed; API token has Workers:Edit permission |
| Health returns `{ "d1": "error" }` | Migrations not applied — run B4 again                                    |
| 1101 Worker error                  | Worker threw — `wrangler tail --env staging` to see logs                 |
| 522/523 error                      | DNS not proxied (orange cloud) or zone not active                        |
| CI deploy fails                    | Check GitHub Actions secrets have no trailing whitespace                 |
| `/admin` returns 403 (not 401)     | `ALLOWED_ADMIN_EMAILS` not set — staging CF Access JWT enforcement       |
| Form submissions return 500        | `FORMS_ENCRYPTION_KEY` not set — required for AES-GCM PII encryption     |
| Rate limiter fires in testing      | Limits (OSE-1509): 60 per 10 s per IP at the edge (per event for forms), 360/min per IP behind it. Stay at or under ~5 requests/s per IP; a stress run should expect 429s |
| `assertRenderable` error in logs   | Event is in DRAFT state — create/transition a test event to ACTIVE       |
| BigQuery backup silently skipped   | WIF secrets not set — expected in staging unless GCP is configured       |

---

## Secrets Reference (2026-05-09)

### GitHub Actions secrets (repo-level)

| Secret                     | Purpose            | Generate                  |
| -------------------------- | ------------------ | ------------------------- |
| `CLOUDFLARE_API_TOKEN_OSE` | CI deploys worker  | CF Dashboard > API Tokens |
| `CLOUDFLARE_ACCOUNT_ID`    | CI targets account | CF Dashboard > Overview   |
| `ADMIN_TOKEN`              | CI smoke test auth | `openssl rand -hex 32`    |

### Wrangler secrets (per-environment, set via `wrangler secret put`)

| Secret                  | Required | Purpose                                      | Generate                 |
| ----------------------- | -------- | -------------------------------------------- | ------------------------ |
| `ADMIN_TOKEN`           | ✅       | Bearer token for `/admin`                    | `openssl rand -hex 32`   |
| `FORMS_ENCRYPTION_KEY`  | ✅       | AES-GCM key for PII email fields             | `openssl rand -hex 32`   |
| `X_OCR_INTERNAL`        | ✅       | CI automation internal header                | `openssl rand -hex 32`   |
| `ALLOWED_ADMIN_EMAILS`  | ✅ prod  | CF Access email allowlist                    | comma-separated emails   |
| `ALLOWED_ADMIN_DOMAINS` | optional | CF Access domain allowlist                   | comma-separated domains  |
| `WIF_PRIVATE_KEY_PEM`   | optional | Workload Identity Federation key             | GCP service account JSON |
| `WIF_POOL_ID`           | optional | WIF pool ID                                  | GCP console              |
| `WIF_PROVIDER_ID`       | optional | WIF provider ID                              | GCP console              |
| `WIF_ISSUER`            | optional | WIF issuer URL                               | GCP console              |
| `GCP_PROJECT_ID`        | optional | GCP project identifier                       | GCP console              |
| `GCP_PROJECT_NUMBER`    | optional | GCP project number                           | GCP console              |
| `BIGQUERY_DATASET_ID`   | optional | BQ dataset (default: oursharedevents_backup) | your choice              |
| `GOOGLE_MAPS_API_KEY`   | optional | Static Maps API for venue display            | Google Cloud console     |

### wrangler.toml vars (not secrets — committed to repo)

| Var                        | Staging value    | Production value             |
| -------------------------- | ---------------- | ---------------------------- |
| `WORKER_ENV`               | `staging`        | `production`                 |
| `WORKER_BUILD_VERSION`     | `stg-2026.03.22` | `prod-2026.03.22`            |
| `ALLOW_ADMIN_KEY_FALLBACK` | `true`           | _(not set — CF Access only)_ |
| `ALLOW_OCR_INTERNAL`       | `true`           | `true`                       |

### Removed secrets (no longer used)

- ~~`GOOGLE_SA_CLIENT_EMAIL`~~ — replaced by WIF (Workload Identity Federation)
- ~~`GOOGLE_SA_PRIVATE_KEY_PEM`~~ — replaced by WIF
- ~~`SHEETS_SPREADSHEET_ID`~~ — D1 is the data layer
- ~~`FORMS_DB_ID`~~ — set via wrangler.toml binding
