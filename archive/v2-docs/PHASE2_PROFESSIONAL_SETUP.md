# Phase 2: Professional Setup - Cloudflare Automation

## 🎯 Goal

Fully automate the deployment pipeline so Stage 1 automatically updates environment URLs and Stage 2 runs seamlessly.

**Time estimate:** 4-6 hours (one-time setup)

---

## Why Cloudflare?

**vs. Hostinger Redirects:**

| Feature             | Hostinger Redirects        | Cloudflare Workers                 |
| ------------------- | -------------------------- | ---------------------------------- |
| **Automation**      | Limited API                | Full API support                   |
| **URL in Browser**  | Changes to Apps Script URL | Stays as your domain               |
| **Performance**     | Single redirect            | Global CDN                         |
| **SSL/TLS**         | Basic                      | Free + Auto-renew                  |
| **DDoS Protection** | None                       | Included                           |
| **Rate Limiting**   | None                       | Programmable                       |
| **Analytics**       | Basic                      | Advanced                           |
| **Cost**            | Included                   | **FREE** (up to 100k requests/day) |

**Bottom line:** Cloudflare gives you a production-grade infrastructure for free.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  GitHub Actions (Stage 1)                                │
│  ├─ Build & Test                                         │
│  ├─ Deploy to Apps Script                                │
│  ├─ Get Deployment URL (AKfycb...)                       │
│  └─ ✨ Update Cloudflare KV Store                        │
│       └─ "qa_url" = "https://script.google.com/.../exec" │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Cloudflare (Edge)                                       │
│  ├─ DNS: qa.zeventbooks.com → Cloudflare Worker         │
│  ├─ Worker reads KV Store for current "qa_url"          │
│  └─ Proxies request to Apps Script                      │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Google Apps Script Deployment                           │
│  https://script.google.com/macros/s/AKfycb.../exec      │
└─────────────────────────────────────────────────────────┘
```

**User Experience:**

- User visits: `https://qa.zeventbooks.com`
- Cloudflare Worker proxies to: latest deployment URL
- Browser URL stays: `https://qa.zeventbooks.com` (clean!)

---

## Implementation Steps

### 1. Set Up Cloudflare Account (15 min)

1. **Create account:** https://dash.cloudflare.com/sign-up (free)
2. **Add domain:**
   - Click **Add a Site**
   - Enter: `zeventbooks.com`
   - Select: **Free Plan**
3. **Update nameservers in Hostinger:**
   - Cloudflare will show you 2 nameservers (e.g., `clark.ns.cloudflare.com`)
   - Go to Hostinger → **zeventbooks.com** → **DNS / Name Servers**
   - Change nameservers to Cloudflare's
   - **Wait 15-60 minutes** for DNS propagation
4. **Verify in Cloudflare:**
   - Cloudflare will email you when the domain is active

---

### 2. Create Cloudflare Worker (30 min)

1. **Go to Workers:**
   - In Cloudflare dashboard → **Workers & Pages**
   - Click **Create Worker**
   - Name it: `zeventbooks-env-router`

2. **Paste this code:**

```javascript
/**
 * Zeventbooks Environment Router
 *
 * Routes environment subdomains to their corresponding Apps Script deployments.
 * URLs are stored in KV store and updated by CI/CD pipeline.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const hostname = url.hostname;

    // Determine environment from hostname
    let kvKey = null;
    if (hostname === 'qa.zeventbooks.com') {
      kvKey = 'qa_deployment_url';
    } else if (hostname === 'dev.zeventbooks.com') {
      kvKey = 'dev_deployment_url';
    } else if (hostname === 'app.zeventbooks.com') {
      kvKey = 'prod_deployment_url';
    } else {
      return new Response('Unknown environment', { status: 404 });
    }

    // Get deployment URL from KV store
    const deploymentUrl = await env.DEPLOYMENT_URLS.get(kvKey);

    if (!deploymentUrl) {
      return new Response(`Environment not configured. KV key: ${kvKey}`, { status: 503 });
    }

    // Build target URL with original query parameters
    const targetUrl = deploymentUrl + url.search;

    // Proxy the request to Apps Script
    const targetRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'follow',
    });

    // Fetch from Apps Script
    const response = await fetch(targetRequest);

    // Return response (preserving all headers and body)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },
};
```

3. **Save and Deploy**

---

### 3. Create KV Namespace (10 min)

KV = Key-Value store for configuration data.

1. **In Cloudflare dashboard:**
   - Go to **Workers & Pages** → **KV**
   - Click **Create a namespace**
   - Name: `DEPLOYMENT_URLS`
   - Click **Add**

2. **Bind KV to Worker:**
   - Go to **Workers & Pages** → **zeventbooks-env-router**
   - Click **Settings** → **Variables**
   - Under **KV Namespace Bindings**, click **Add binding**:
     - Variable name: `DEPLOYMENT_URLS`
     - KV namespace: `DEPLOYMENT_URLS`
   - Click **Save**

3. **Add initial values:**
   - Go to **KV** → **DEPLOYMENT_URLS**
   - Click **Add entry**:
     - Key: `qa_deployment_url`
     - Value: `https://script.google.com/macros/s/YOUR_ACTUAL_DEPLOYMENT_ID/exec`
   - Click **Add entry** again for dev and prod (when ready)

---

### 4. Set Up DNS Routes (5 min)

1. **In Cloudflare DNS:**
   - Go to **DNS** → **Records**

2. **Add routes for each environment:**

   **QA:**
   - Type: `CNAME`
   - Name: `qa`
   - Target: `zeventbooks-env-router.YOUR_SUBDOMAIN.workers.dev`
   - Proxy status: **Proxied** (orange cloud)

   **Dev (future):**
   - Type: `CNAME`
   - Name: `dev`
   - Target: `zeventbooks-env-router.YOUR_SUBDOMAIN.workers.dev`
   - Proxy status: **Proxied**

   **Prod (future):**
   - Type: `CNAME`
   - Name: `app`
   - Target: `zeventbooks-env-router.YOUR_SUBDOMAIN.workers.dev`
   - Proxy status: **Proxied**

3. **Test:**
   ```bash
   curl https://qa.zeventbooks.com?p=events&brand=root
   ```

---

### 5. Get Cloudflare API Credentials (5 min)

1. **Create API Token:**
   - Go to **My Profile** → **API Tokens**
   - Click **Create Token**
   - Use template: **Edit Cloudflare Workers**
   - Customize:
     - Permissions: `Workers KV Storage:Edit`
     - Account Resources: `Include` → Your account
     - Zone Resources: `Include` → `zeventbooks.com`
   - Click **Continue to summary** → **Create Token**
   - **COPY THE TOKEN** (you won't see it again!)

2. **Add to GitHub Secrets:**
   - Go to GitHub repo → **Settings** → **Secrets and variables** → **Actions**
   - Click **New repository secret**:
     - Name: `CLOUDFLARE_API_TOKEN_OSE`
     - Value: [paste token]
   - Click **Add secret**

3. **Get Account ID:**
   - In Cloudflare dashboard, the URL shows your account ID:
     ```
     https://dash.cloudflare.com/[ACCOUNT_ID]/workers
     ```
   - Add to GitHub secrets:
     - Name: `CLOUDFLARE_ACCOUNT_ID`
     - Value: [your account ID]

4. **Get KV Namespace ID:**
   - Go to **Workers & Pages** → **KV** → **DEPLOYMENT_URLS**
   - Copy the **Namespace ID** (shows at top)
   - Add to GitHub secrets:
     - Name: `CLOUDFLARE_KV_NAMESPACE_ID`
     - Value: [namespace ID]

---

### 6. Update Stage 1 Workflow (15 min)

Add this step to `.github/workflows/stage1-deploy.yml` after deployment:

```yaml
- name: Update QA environment URL in Cloudflare
  if: github.ref == 'refs/heads/main' && github.event_name == 'push'
  run: |
    echo "🔄 Updating qa.zeventbooks.com to point to new deployment..."

    DEPLOYMENT_URL="${{ steps.deploy.outputs.url }}"

    # Update Cloudflare KV with new deployment URL
    curl -X PUT \
      "https://api.cloudflare.com/client/v4/accounts/${{ secrets.CLOUDFLARE_ACCOUNT_ID }}/storage/kv/namespaces/${{ secrets.CLOUDFLARE_KV_NAMESPACE_ID }}/values/qa_deployment_url" \
      -H "Authorization: Bearer ${{ secrets.CLOUDFLARE_API_TOKEN_OSE }}" \
      -H "Content-Type: text/plain" \
      -d "$DEPLOYMENT_URL"

    echo "✅ QA environment updated!"
    echo "🌐 Test at: https://qa.zeventbooks.com"
```

---

### 7. Update Stage 2 Workflow (Already Done!)

Stage 2 already defaults to `https://qa.zeventbooks.com`, so no changes needed!

---

## Testing the Complete Flow

### End-to-End Test:

1. **Make a code change:**

   ```bash
   git add .
   git commit -m "test: Verify Phase 2 automation"
   git push origin main
   ```

2. **Stage 1 runs automatically:**
   - ✅ Unit tests pass
   - ✅ Contract tests pass
   - ✅ Deploys to Apps Script
   - ✅ Updates `qa.zeventbooks.com` via Cloudflare API

3. **Verify QA URL:**

   ```bash
   curl https://qa.zeventbooks.com?p=events&brand=root
   ```

4. **Trigger Stage 2:**
   - Go to Actions → Stage 2 - Testing & QA
   - Click Run workflow
   - Default URL is already `https://qa.zeventbooks.com`
   - Click Run workflow
   - ✅ All tests run against stable URL

---

## Benefits Achieved

✅ **Zero Manual URL Handling:** Stage 1 auto-updates, Stage 2 auto-uses
✅ **Professional URLs:** `qa.zeventbooks.com` instead of Google's long URLs
✅ **Clean Browser URLs:** Proxying keeps your domain visible
✅ **Multi-Environment Ready:** Easy to add `dev` and `app` environments
✅ **Global CDN:** Cloudflare edge network for fast access worldwide
✅ **DDoS Protection:** Included with Cloudflare
✅ **SSL/TLS:** Free certificates, auto-renewed
✅ **Analytics:** Built-in traffic analytics
✅ **Future-Proof:** Can add auth, rate limiting, custom logic

---

## Cost Analysis

| Service           | Free Tier         | Your Usage   | Cost         |
| ----------------- | ----------------- | ------------ | ------------ |
| Cloudflare Worker | 100k requests/day | ~1k/day      | **$0**       |
| Cloudflare KV     | 100k reads/day    | ~500/day     | **$0**       |
| Cloudflare DNS    | Unlimited         | 3 subdomains | **$0**       |
| Cloudflare SSL    | Unlimited         | 1 domain     | **$0**       |
| **TOTAL**         |                   |              | **$0/month** |

**Even at scale (10k users):** Still free tier!

---

## Next Steps After Phase 2

Once fully automated, you can:

1. **Add Development environment:**
   - `dev.zeventbooks.com` for feature branches
   - Auto-deploy on push to `develop` branch

2. **Add Production environment:**
   - `app.zeventbooks.com` for production
   - Manual promotion from QA → Prod

3. **Add API subdomain:**
   - `api.zeventbooks.com` for REST API
   - Separate from web app for better architecture

4. **Add monitoring:**
   - Cloudflare Analytics
   - Sentry error tracking
   - Uptime monitoring

5. **Add custom auth layer:**
   - Cloudflare Workers can add auth before proxying
   - Rate limiting per user
   - API key validation

---

## Troubleshooting

### Worker not routing correctly

- Check KV binding name matches code (`DEPLOYMENT_URLS`)
- Verify KV key exists: `qa_deployment_url`
- Check Worker logs in Cloudflare dashboard

### DNS not resolving

- Wait for DNS propagation (up to 24 hours, usually <1 hour)
- Check: https://dnschecker.org/#CNAME/qa.zeventbooks.com
- Verify nameservers updated in Hostinger

### Cloudflare API failing

- Verify API token has correct permissions
- Check Account ID and KV Namespace ID are correct
- Look at GitHub Actions logs for error details

### Apps Script returning errors

- Verify deployment URL in KV is correct
- Test Apps Script URL directly (bypass Cloudflare)
- Check Apps Script quota limits

---

## Support Resources

- **Cloudflare Workers Docs:** https://developers.cloudflare.com/workers/
- **KV Store Docs:** https://developers.cloudflare.com/kv/
- **Cloudflare API Docs:** https://api.cloudflare.com/

---

**Ready to implement Phase 2?** Let me know when you're ready to start!
