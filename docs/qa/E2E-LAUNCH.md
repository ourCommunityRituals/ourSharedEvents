# End-to-End Launch Checklist — ourSharedEvents

Everything needed to go from zero to a fully working live site at `oursharedevents.com`.
Work through each Part in order — each one unlocks the next.

> **SUPERSEDED (2026-04-09):** Parts 1-2 (Google Cloud + Sheets) are obsolete — Phase 2 replaced Sheets with D1.
> Use **`docs/deployment/INFRA-CHECKLIST.md`** for the corrected, D1-native infrastructure steps.
> Parts 3-9 (Cloudflare zone, secrets, deploy, sign-off) remain valid but INFRA-CHECKLIST.md consolidates them.

**Estimated time (first time through):** 2–3 hours
**Recurring deploys after setup:** ~2 minutes (CI/CD handles it automatically)

---

## How This Doc Connects to Stories

Each Part below fulfills one or more stories from `STORIES.md`. The sequence is:

```
Part 1  ─┐
Part 2   ├─► P1-6: Infra provisioning (Google + Cloudflare set up)
Part 3  ─┘         │
                   ▼
Part 4  ─┐
Part 5   ├─► P1-7: Secrets + first staging deploy
Part 6  ─┘         │
                   ▼
Part 7     ──────► P1-8: Staging sign-off (all checks pass)
                         │
                         ▼
Part 8     ──────► P1-9: Repo migration → ourCommunityRituals
                         │
                         ▼
Part 9     ──────► P1-10: Production launch (v1.0.0 live)
```

**Rule:** Don't move to the next Part until every checkbox in the current Part is checked.

---

## Part 1 — Google Cloud + Service Account

### _Fulfills: P1-6 (Infra provisioning)_

The Worker reads event data from Google Sheets using a Service Account — a special Google identity that authenticates without a human login.

- [ ] **1.1** Go to [console.cloud.google.com](https://console.cloud.google.com). Sign in with your Google account.
- [ ] **1.2** Create a new project:
  - Click the project dropdown (top left, next to "Google Cloud") → **New Project**
  - Name: `oursharedevents` → **Create**
  - Wait for it to create, then select it from the dropdown
- [ ] **1.3** Enable the **Google Sheets API**:
  - In the search bar at the top, type `Sheets API` → click **Google Sheets API** in results
  - Click **Enable**
- [ ] **1.4** Create a Service Account:
  - Left sidebar → **IAM & Admin** → **Service Accounts** → **+ Create Service Account**
  - Name: `oursharedevents-worker`
  - Click **Create and Continue**
  - Role: search for and select **Viewer**
  - Click **Continue** → **Done** (skip the optional steps)
- [ ] **1.5** Create a key for the Service Account:
  - Click the `oursharedevents-worker` service account you just created
  - Click the **Keys** tab → **Add Key** → **Create new key** → **JSON** → **Create**
  - A `.json` file downloads automatically — **save it somewhere safe**
- [ ] **1.6** Open that downloaded JSON file and note these two values:
  - `"client_email"` → looks like `oursharedevents-worker@oursharedevents.iam.gserviceaccount.com`
  - `"private_key"` → the full block starting with `-----BEGIN RSA PRIVATE KEY-----`

  > Keep this file secure. Anyone with it can read your Google Sheets data.

---

## Part 2 — Google Sheets Setup

### _Fulfills: P1-6 (Infra provisioning)_

- [ ] **2.1** Go to [sheets.google.com](https://sheets.google.com) → **+ New spreadsheet**
- [ ] **2.2** Name it: `ourSharedEvents — Events` (click the title at the top to rename)
- [ ] **2.3** Rename the sheet tab at the bottom from `Sheet1` to **`EVENTS`**

  > The tab name must be exactly `EVENTS` — the worker reads from `EVENTS!A2:K`

- [ ] **2.4** Add column headers in row 1. Click cell A1 and type each one across:

  | A   | B        | C           | D         | E          | F    | G          | H      | I          | J           |
  | --- | -------- | ----------- | --------- | ---------- | ---- | ---------- | ------ | ---------- | ----------- |
  | id  | brand_id | template_id | data_json | created_at | slug | updated_at | status | is_default | asset_state |

- [ ] **2.5** Add a test event in row 2 so you can verify the API returns data:

  | Column          | Value to type                                                                          |
  | --------------- | -------------------------------------------------------------------------------------- |
  | A — id          | `evt_001`                                                                              |
  | B — brand_id    | `root`                                                                                 |
  | C — template_id | _(leave blank)_                                                                        |
  | D — data_json   | `{"name":"Test Event","startDateISO":"2026-06-01T18:00:00Z","venue":"Community Hall"}` |
  | E — created_at  | `2026-01-01T00:00:00Z`                                                                 |
  | F — slug        | `test-event`                                                                           |
  | G — updated_at  | `2026-01-01T00:00:00Z`                                                                 |
  | H — status      | `active`                                                                               |
  | I — is_default  | `false`                                                                                |
  | J — asset_state | _(leave blank)_                                                                        |

- [ ] **2.6** Share the spreadsheet with your service account:
  - Click **Share** (top right) → paste the `client_email` from step 1.6
  - Set access to **Viewer** → **Send**

  > If you skip this step, the Worker gets a 403 error when it tries to read the sheet.

- [ ] **2.7** Copy the spreadsheet ID from the URL bar:
  ```
  https://docs.google.com/spreadsheets/d/  ← SPREADSHEET_ID →  /edit
  ```
  It's the long string of letters and numbers between `/d/` and `/edit`. Save it — this becomes `SHEETS_SPREADSHEET_ID`.

---

## Part 3 — Cloudflare Setup

### _Fulfills: P1-6 (Infra provisioning)_

**What Cloudflare does here:** Your domain (`oursharedevents.com`) points to Cloudflare instead of a traditional server. When someone visits the site, Cloudflare runs your TypeScript Worker at the edge — no server to manage, no cold starts, global.

A **zone** in Cloudflare is just their word for "a domain you've added to your Cloudflare account." Setting one up means telling your domain registrar to hand off DNS control to Cloudflare.

### 3a — Create Cloudflare account and add the zone

- [ ] **3.1** Go to [dash.cloudflare.com](https://dash.cloudflare.com). Create a free account if you don't have one.
- [ ] **3.2** Click **Add a site** (or **Websites** → **Add a site**):
  - Enter `oursharedevents.com` → **Continue**
  - Select the **Free** plan → **Continue**
  - Cloudflare scans for existing DNS records. Review them → **Continue**
- [ ] **3.3** Cloudflare shows you **two nameserver addresses** (e.g. `art.ns.cloudflare.com` and `bob.ns.cloudflare.com`). Copy both — you'll need them in the next step.

### 3b — Point your domain registrar to Cloudflare

This step is different depending on where you bought `oursharedevents.com`. Find yours below:

**GoDaddy:**

- My Products → find `oursharedevents.com` → **DNS** → scroll to **Nameservers** → **Change** → **Enter my own nameservers** → paste both Cloudflare nameservers → **Save**

**Google Domains / Squarespace Domains:**

- Select domain → **DNS** → **Custom name servers** → delete existing ones → add both Cloudflare ones → **Save**

**Namecheap:**

- Domain List → **Manage** → **Nameservers** dropdown → **Custom DNS** → enter both Cloudflare nameservers → ✓

**Other registrars:** Look for "Nameservers" or "DNS" settings and replace existing nameservers with the two Cloudflare ones.

- [ ] **3.4** Back in Cloudflare, click **Done, check nameservers**
  - Propagation takes 5 minutes to 48 hours. Cloudflare emails you when active.
  - To check manually: `dig oursharedevents.com NS` — should show Cloudflare nameservers when done

### 3c — Add DNS records for the Worker

Once the zone is active (you got the Cloudflare email), add these records:

- [ ] **3.5** In Cloudflare → your zone → **DNS** → **Records** → **Add record**:

  | Type | Name  | Content     | Proxy status               |
  | ---- | ----- | ----------- | -------------------------- |
  | A    | `@`   | `192.0.2.1` | **Proxied** (orange cloud) |
  | A    | `www` | `192.0.2.1` | **Proxied** (orange cloud) |
  | A    | `stg` | `192.0.2.1` | **Proxied** (orange cloud) |

  > **Why 192.0.2.1?** This IP never gets traffic. The orange cloud means Cloudflare intercepts all requests before they'd ever reach an origin server — your Worker handles everything. The IP is just a placeholder that satisfies the DNS record requirement.

  > **Critical:** Make sure all three are **Proxied** (orange cloud icon), NOT "DNS only" (grey cloud). If it's grey, the Worker won't run.

### 3d — Enable HTTPS

- [ ] **3.6** In Cloudflare → your zone → **SSL/TLS** → **Overview**:
  - Set encryption mode to **Full (strict)**

  > **Why Full (strict) and not Flexible?** Flexible means the connection between Cloudflare and your origin is unencrypted — but since Workers run inside Cloudflare itself, there's no origin to worry about. "Full (strict)" is simply the correct setting for Worker-only setups and avoids redirect loops.

- [ ] **3.7** In **SSL/TLS** → **Edge Certificates**:
  - Toggle **Always Use HTTPS** → **On**

### 3e — Get credentials for later steps

- [ ] **3.8** Find your **Account ID**:
  - Look at the URL when you're in the Cloudflare dashboard: `https://dash.cloudflare.com/**<ACCOUNT_ID>**/...`
  - Or: click on your zone (oursharedevents.com) → right sidebar under **API** shows **Account ID**

  > Don't confuse this with the **Zone ID** (also on that sidebar) — they're different. You need the Account ID.

  Save it — this becomes `CLOUDFLARE_ACCOUNT_ID`.

- [ ] **3.9** Create an **API Token** for deploying Workers:
  - Top right → your profile icon → **My Profile** → **API Tokens** tab → **Create Token**
  - Use the **Edit Cloudflare Workers** template (click **Use template**)
  - Under Account Resources: **Include → All accounts** (or select your specific account)
  - Under Zone Resources: **Include → All zones** (or select `oursharedevents.com`)
  - Click **Continue to summary** → **Create Token**
  - **Copy the token now** — Cloudflare only shows it once

  Save it — this becomes `CLOUDFLARE_API_TOKEN_OSE`.

  > To verify it works: `curl -H "Authorization: Bearer <your_token>" https://api.cloudflare.com/client/v4/user/tokens/verify` — should return `"status": "active"`

- [ ] **3.10** Generate your `ADMIN_KEY` (the password for the `/admin` route):
  ```bash
  openssl rand -hex 32
  ```
  Save the output — this becomes `ADMIN_KEY`. Store it somewhere secure (password manager).

---

## Part 4 — GitHub Repo + Actions Secrets

### _Fulfills: P1-7 (Secrets + first staging deploy)_

- [ ] **4.1** Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
- [ ] **4.2** Add these 3 secrets one at a time:

  | Secret name                | Value                         | Where you got it         |
  | -------------------------- | ----------------------------- | ------------------------ |
  | `CLOUDFLARE_API_TOKEN_OSE` | The token from step 3.9       | Cloudflare API Tokens    |
  | `CLOUDFLARE_ACCOUNT_ID`    | The ID from step 3.8          | Cloudflare dashboard URL |
  | `ADMIN_KEY`                | The hex string from step 3.10 | `openssl rand -hex 32`   |

  > These secrets are used by `.github/workflows/oursharedevents-ci.yml` each time CI runs.

---

## Part 5 — Wrangler Secrets (Worker Credentials)

### _Fulfills: P1-7 (Secrets + first staging deploy)_

These 4 secrets live inside Cloudflare's secret store — separate from GitHub. Set once per environment and never hardcoded in any file.

- [ ] **5.1** Install Wrangler CLI and log in:

  ```bash
  npm install -g wrangler
  wrangler login
  ```

  - A browser window opens → authorize with your Cloudflare account
  - Return to terminal — should show `Successfully logged in`
  - Verify: `wrangler whoami` → should show your Cloudflare account name and email

  > If `wrangler login` doesn't open a browser, try `wrangler login --browser`. If still stuck, use `wrangler config` and paste your API token directly.

- [ ] **5.2** Navigate to the worker directory:

  ```bash
  cd workers/oursharedevents
  ```

- [ ] **5.3** Set staging secrets (you'll be prompted to paste each value):

  ```bash
  wrangler secret put GOOGLE_SA_CLIENT_EMAIL --env staging
  # Paste: client_email from step 1.6 (e.g. oursharedevents-worker@yourproject.iam.gserviceaccount.com)

  wrangler secret put GOOGLE_SA_PRIVATE_KEY_PEM --env staging
  # Paste: the full private_key from step 1.6 — include the -----BEGIN RSA PRIVATE KEY----- and -----END----- lines

  wrangler secret put SHEETS_SPREADSHEET_ID --env staging
  # Paste: the spreadsheet ID from step 2.7

  wrangler secret put ADMIN_KEY --env staging
  # Paste: the ADMIN_KEY from step 3.10
  ```

- [ ] **5.4** Verify all 4 secrets are set:

  ```bash
  wrangler secret list --env staging
  ```

  Should show:

  ```
  GOOGLE_SA_CLIENT_EMAIL
  GOOGLE_SA_PRIVATE_KEY_PEM
  SHEETS_SPREADSHEET_ID
  ADMIN_KEY
  ```

- [ ] **5.5** Set production secrets now too (same values, different env — do it while you have them handy):
  ```bash
  wrangler secret put GOOGLE_SA_CLIENT_EMAIL --env production
  wrangler secret put GOOGLE_SA_PRIVATE_KEY_PEM --env production
  wrangler secret put SHEETS_SPREADSHEET_ID --env production
  wrangler secret put ADMIN_KEY --env production
  ```

---

## Part 6 — First Staging Deploy

### _Fulfills: P1-7 (Secrets + first staging deploy)_

- [ ] **6.1** Install dependencies and deploy to staging:

  ```bash
  cd workers/oursharedevents
  npm install
  npm run deploy:staging
  ```

  Expected output ends with: `Published oursharedevents-staging`

  _Or_ just push to `main` — the CI/CD pipeline deploys staging automatically.

- [ ] **6.2** Confirm health check returns OK:

  ```bash
  curl https://stg.oursharedevents.com/health
  ```

  Expected:

  ```json
  { "ok": true, "env": "staging", "version": "stg-2026.03.22", "timestamp": "..." }
  ```

- [ ] **6.3** Confirm events API returns your test row from Part 2:

  ```bash
  curl https://stg.oursharedevents.com/api/v2/events
  ```

  Expected:

  ```json
  { "ok": true, "items": [{ "id": "evt_001", "name": "Test Event", ... }] }
  ```

  > If `items` is empty but `ok` is true — check that row 2 in your sheet has `status = active`

---

## Part 7 — Staging Sign-Off

### _Fulfills: P1-8 (Staging sign-off — all checks pass)_

Every check here must pass before you migrate the repo or launch production.

- [ ] **7.1** Public page loads in browser:
  - Open `https://stg.oursharedevents.com` → event listing HTML appears

- [ ] **7.2** Admin rejects unauthenticated requests:

  ```bash
  curl -i https://stg.oursharedevents.com/admin
  ```

  Expected: `HTTP/2 401`

- [ ] **7.3** Admin accepts correct token:

  ```bash
  curl -H "Authorization: Bearer <YOUR_ADMIN_KEY>" https://stg.oursharedevents.com/admin
  ```

  Expected: `HTTP/2 200` with HTML admin dashboard

- [ ] **7.4** Public page loads correctly on a real mobile device (open in phone browser)

- [ ] **7.5** HTTPS padlock shows in browser — no mixed-content warnings in browser console

- [ ] **7.6** Unknown URL returns a graceful error (not Cloudflare's default error page):

  ```bash
  curl -i https://stg.oursharedevents.com/does-not-exist
  ```

  Expected: 404 with your worker's JSON or HTML error, not a Cloudflare 1000-series error

- [ ] **7.7** (Optional) Watch live logs while running the checks above:
  ```bash
  wrangler tail --env staging
  ```

**All 7 checks passed?** → Move to Part 8.

---

## Part 8 — Repo Migration to ourCommunityRituals

### _Fulfills: P1-9 (Repo migration)_

You've validated the product works. Now give it the right home before launching publicly.

- [ ] **8.1** Create the new repo on GitHub:
  - Go to `github.com/ourCommunityRituals` → **New repository**
  - Name: `ourSharedEvents`
  - Visibility: Public
  - **Do not** initialize with README, .gitignore, or license — leave it completely empty
  - Click **Create repository**

- [ ] **8.2** In your local clone, create a clean single-commit branch (no old zeventbooks history):

  ```bash
  git checkout --orphan clean-start
  git add -A
  git commit -m "Initial commit: ourSharedEvents platform"
  ```

- [ ] **8.3** Push to the new org repo:

  ```bash
  git remote add community https://github.com/ourCommunityRituals/ourSharedEvents
  git push community clean-start:main
  ```

- [ ] **8.4** In the new repo on GitHub → **Settings** → **General** → set **Default branch** to `main`

- [ ] **8.5** Re-add the 3 GitHub Actions secrets in the new repo (Settings → Secrets → Actions):
  - `CLOUDFLARE_API_TOKEN_OSE` (from step 3.9)
  - `CLOUDFLARE_ACCOUNT_ID` (from step 3.8)
  - `ADMIN_KEY` (from step 3.10)

- [ ] **8.6** Verify CI works in the new repo:
  - Push any small change to `main` → confirm the `oursharedevents-ci.yml` workflow runs and staging deploy succeeds

- [ ] **8.7** Archive the old repo:
  - Go to `zeventbooks/MVP-EVENT-TOOLKIT` → **Settings** → scroll to **Danger Zone** → **Archive this repository**

---

## Part 9 — Production Launch

### _Fulfills: P1-10 (Production launch — v1.0.0)_

Do this from the new `ourCommunityRituals/ourSharedEvents` repo.

- [ ] **9.1** Confirm production Worker secrets are set (you set these in step 5.5):

  ```bash
  wrangler secret list --env production
  ```

  Should show all 4: `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY_PEM`, `SHEETS_SPREADSHEET_ID`, `ADMIN_KEY`

- [ ] **9.2** Tag and push to trigger the production CI deploy:

  ```bash
  git tag v1.0.0
  git push origin v1.0.0
  ```

  CI runs the `deploy-production` job automatically and then E2E smoke tests.

  _Or deploy manually:_

  ```bash
  cd workers/oursharedevents
  npm run deploy:prod
  ```

- [ ] **9.3** Verify production health:

  ```bash
  curl https://oursharedevents.com/health
  ```

  Expected: `{ "ok": true, "env": "production", "version": "prod-2026.03.22", ... }`

- [ ] **9.4** Verify production events page in browser:
  - Open `https://oursharedevents.com` → event listing appears

- [ ] **9.5** Verify `www` works:
  - Open `https://www.oursharedevents.com` → same content (both routes are configured in `wrangler.toml`)

- [ ] **9.6** Verify production admin auth:

  ```bash
  curl -i https://oursharedevents.com/admin
  # Expected: HTTP 401

  curl -H "Authorization: Bearer <YOUR_ADMIN_KEY>" https://oursharedevents.com/admin
  # Expected: HTTP 200
  ```

- [ ] **9.7** Final mobile check — open `https://oursharedevents.com` on your phone

**All checks pass?** Phase 1 is complete. `ourSharedEvents` is live.

---

## Quick Reference — All Secrets

| Secret                      | Stored in                  | Step created | Value source                                          |
| --------------------------- | -------------------------- | ------------ | ----------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN_OSE`  | GitHub Actions             | 3.9          | Cloudflare → My Profile → API Tokens                  |
| `CLOUDFLARE_ACCOUNT_ID`     | GitHub Actions             | 3.8          | Cloudflare dashboard URL                              |
| `ADMIN_KEY`                 | GitHub Actions + Wrangler  | 3.10         | `openssl rand -hex 32`                                |
| `GOOGLE_SA_CLIENT_EMAIL`    | Wrangler (CF secret store) | 1.6          | Service account JSON → `client_email`                 |
| `GOOGLE_SA_PRIVATE_KEY_PEM` | Wrangler (CF secret store) | 1.6          | Service account JSON → `private_key`                  |
| `SHEETS_SPREADSHEET_ID`     | Wrangler (CF secret store) | 2.7          | Google Sheets URL — segment between `/d/` and `/edit` |

---

## Troubleshooting

| Symptom                                                            | Likely cause                          | Fix                                                                                |
| ------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------- |
| `curl /health` times out or connection refused                     | DNS not propagated yet                | Run `dig oursharedevents.com NS` — should show Cloudflare. Wait and retry.         |
| `{ "ok": false, "error": "Sheets API error: HTTP 403" }`           | Sheet not shared with service account | Step 2.6 — share sheet with `client_email` as Viewer                               |
| `{ "ok": false, "error": "SHEETS_SPREADSHEET_ID not configured" }` | Wrangler secret missing               | Step 5.3 — run `wrangler secret put SHEETS_SPREADSHEET_ID --env staging`           |
| `/health` → `{ "ok": true }` but `items: []`                       | Row 2 has wrong status                | Check cell H2 in EVENTS sheet — must be exactly `active`                           |
| Worker serves Cloudflare error page (1xxx)                         | DNS records not proxied               | Step 3.5 — check all A records show orange cloud, not grey                         |
| `wrangler deploy` fails: authentication error                      | Wrong API token                       | Step 3.9 — regenerate token with correct Worker permissions                        |
| `wrangler login` hangs                                             | Browser didn't open                   | Try `wrangler login --browser` or check firewall blocking port 8976                |
| `/admin` returns 200 without a token on staging                    | `ALLOW_ADMIN_KEY_FALLBACK=true`       | Expected staging behaviour — production does not have this flag                    |
| Worker shows old version after deploy                              | Browser cache                         | Test with `curl` instead of browser, or hard-refresh `Ctrl+Shift+R`                |
| Nameserver change not propagating                                  | Registrar caching                     | Some registrars take up to 48h — verify with `dig oursharedevents.com NS @8.8.8.8` |
