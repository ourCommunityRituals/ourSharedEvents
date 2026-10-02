# Cloudflare Setup – oursharedevents.com

**Org:** `ourCommunityRituals` → **Repo:** `ourSharedEvents`
**Stories:** P1-1 (Worker), P1-3 (CI/CD), P1-5 (Secrets + first staging deploy)

Step-by-step instructions to get the domain live from scratch.

---

## GitHub Secrets (required for CI/CD)

Set these in **GitHub → repo Settings → Secrets and variables → Actions**:

| Secret                     | Description                                                           |
| -------------------------- | --------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN_OSE` | Cloudflare API token with Worker deploy permissions                   |
| `CLOUDFLARE_ACCOUNT_ID`    | Your Cloudflare account ID (dashboard URL: `.../accounts/<id>`)       |
| `ADMIN_KEY`                | Bearer token for admin route auth (generate a random 32+ char string) |

These are used by `.github/workflows/oursharedevents-ci.yml` on every push to `main`.

---

## Step 1 – Add the domain as a Cloudflare zone

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **Add a site** → enter `oursharedevents.com` → **Continue**
3. Choose the **Free** plan (or paid if you need it) → **Continue**
4. Cloudflare scans your existing DNS. Review, then **Continue**
5. Copy the two **Cloudflare nameservers** shown (e.g. `art.ns.cloudflare.com`)
6. Log in to your domain registrar (GoDaddy / Namecheap / Google Domains / etc.)
7. Replace the current nameservers with the two Cloudflare ones
8. Back in Cloudflare, click **Done, check nameservers**
9. Wait 5–30 minutes for propagation. You'll get an email when active.

---

## Step 2 – Add DNS records

Once the zone is active, add these records in **Cloudflare → DNS → Records**:

| Type | Name | Content   | Proxy | TTL  |
| ---- | ---- | --------- | ----- | ---- |
| A    | @    | 192.0.2.1 | Yes   | Auto |
| A    | www  | 192.0.2.1 | Yes   | Auto |
| A    | stg  | 192.0.2.1 | Yes   | Auto |

> **Note:** The IP `192.0.2.1` is a dummy — the Worker intercepts all requests
> before they ever reach an origin server. The A record just needs to exist so
> Cloudflare can proxy traffic.

---

## Step 3 – Deploy the worker (staging first)

```bash
cd workers/oursharedevents
npm install

# Staging
npm run deploy:staging
# → publishes as "oursharedevents-stg"
# → serves stg.oursharedevents.com

# Production (after staging is verified)
npm run deploy:prod
# → publishes as "oursharedevents-prod"
# → serves oursharedevents.com and www.oursharedevents.com
```

---

## Step 4 – Set secrets

Run these for each environment. You'll be prompted to enter the value securely.

**Staging:**

```bash
cd workers/oursharedevents
wrangler secret put ADMIN_TOKEN --env staging
```

**Production:** do not set `ADMIN_TOKEN`; never on production: production admin is Cloudflare Access only, and the production deploy gate refuses ADMIN_KEY, X_OCR_INTERNAL and ADMIN_TOKEN (ADR-012 R2).

---

## Step 5 – Verify

```bash
# Staging health check
curl https://stg.oursharedevents.com/health

# Production health check
curl https://oursharedevents.com/health
```

Expected response:

```json
{ "ok": true, "env": "staging", "version": "stg-2026.03.22", "timestamp": "..." }
```

---

## Optional – Enable HTTPS redirect

In Cloudflare dashboard:

- **SSL/TLS → Overview** → set mode to **Full (strict)**
- **SSL/TLS → Edge Certificates** → enable **Always Use HTTPS**

---

## Troubleshooting

| Symptom              | Fix                                                                       |
| -------------------- | ------------------------------------------------------------------------- |
| Worker not triggered | Check route pattern in wrangler.toml matches exactly                      |
| 1101 error           | Worker threw an unhandled exception — check `wrangler tail --env staging` |
| DNS not resolving    | Nameserver change may still be propagating (up to 48h)                    |
| Secrets not found    | Run `wrangler secret list --env staging` to confirm they're set           |
