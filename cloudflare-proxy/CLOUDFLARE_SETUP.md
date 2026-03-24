# Cloudflare Workers Setup Guide

Cloudflare Workers serves as the proxy layer to Google Apps Script for all environments.

## Why Cloudflare Workers?

| Feature | Cloudflare Workers |
|---------|-------------------|
| Cold start | ~0ms (edge computing) |
| Global CDN | 300+ edge locations |
| Free tier | 100,000 requests/day |
| Latency | <50ms globally |
| SSL | Automatic |
| Custom headers | Built-in |
| Analytics | Real-time dashboard |
| Deployment | CLI or CI/CD |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     DEPLOYMENT OPTIONS                               │
└─────────────────────────────────────────────────────────────────────┘

Option A: FULL SITE via Cloudflare
──────────────────────────────────
User → eventangle.com ────→ Cloudflare Worker ────→ Google Apps Script
       (custom domain)       (edge: <50ms)           (backend)

       Serves: HTML pages + API + All brands
       URLs:
         eventangle.com?page=admin&brand=root     (Admin page)
         eventangle.com?page=display&brand=abc    (Display page)
         eventangle.com?p=status&brand=cbc        (Status API)


Option B: API Subdomain Only
────────────────────────────
User → api.eventangle.com ──→ Cloudflare Worker ──→ Google Apps Script
       (API subdomain)         (edge: <50ms)         (backend)

       Serves: API responses only
       Main site: Can be on Squarespace or other origin


Option C: Events Path Only (Mixed Site)
───────────────────────────────────────
User → eventangle.com/events?page=admin ──→ Cloudflare Worker ──→ Apps Script
       (only /events* intercepted)           (edge: <50ms)         (backend)

       Serves: ONLY /events* paths
       Rest of site: Passes through to origin (Squarespace, etc.)
       URLs:
         eventangle.com/events?page=admin     → Admin.html
         eventangle.com/events?page=public    → Public.html
         eventangle.com/events?page=display   → Display.html
         eventangle.com/events                → Default page
         eventangle.com/about                 → Passes to origin (not intercepted)


Option D: Direct Apps Script (No Proxy)
───────────────────────────────────────
User → script.google.com/macros/s/.../exec ──→ Google Apps Script
       (Google's URL)                           (backend)

       No custom domain, long URL
```

## Deployment Commands

| Environment | Command | Routes |
|-------------|---------|--------|
| Development | `wrangler deploy` | `*.workers.dev` |
| Production (Full Site) | `wrangler deploy --env production` | `eventangle.com/*` |
| **Events Only** | `wrangler deploy --env events` | `eventangle.com/events*` |
| Staging | `wrangler deploy --env staging` | `staging.eventangle.com/*` |
| API Only | `wrangler deploy --env api-only` | `api.eventangle.com/*` |

### Recommended for eventangle.com

Use `--env events` to run tests against `eventangle.com/events` like it's the app:

```bash
# Deploy events-only route (recommended for mixed sites)
wrangler deploy --env events
```

This intercepts only `/events*` paths, allowing:
- `eventangle.com/events?page=admin` → Admin dashboard
- `eventangle.com/events?page=public` → Public event listing
- `eventangle.com/about` → Passes through to origin (not intercepted)

## Prerequisites

1. **Cloudflare Account** (free tier works)
2. **Domain** (optional - can use workers.dev subdomain)
3. **Node.js** (for Wrangler CLI)

## Quick Start

### Step 1: Install Wrangler CLI

```bash
npm install -g wrangler
```

### Step 2: Login to Cloudflare

```bash
wrangler login
```

This opens a browser for authentication.

### Step 3: Deploy Worker

```bash
cd cloudflare-proxy
wrangler deploy
```

Your worker is now live at:
```
https://eventangle.YOUR_SUBDOMAIN.workers.dev
```

### Step 4: Test the Proxy

```bash
# Test status endpoint
curl "https://eventangle.YOUR_SUBDOMAIN.workers.dev?p=status&brand=root"

# Should return:
# {"ok":true,"value":{"build":"triangle-extended-v1.5","brand":"root"}}
```

### Step 5: Deploy Events-Only Route (Recommended)

For `eventangle.com` with Squarespace or other origin:

```bash
# Deploy to intercept only /events* paths
wrangler deploy --env events
```

Test:
```bash
# Admin dashboard
curl "https://www.eventangle.com/events?page=admin"

# Public page
curl "https://www.eventangle.com/events?page=public"

# API status
curl "https://www.eventangle.com/events?p=status&brand=root"
```

## Custom Domain Setup

### Option A: Subdomain (Recommended)

1. **Add domain to Cloudflare** (if not already)
   - Go to Cloudflare Dashboard → Add Site
   - Update nameservers at your registrar

2. **Add route in wrangler.toml**:
   ```toml
   [env.production]
   routes = [
     { pattern = "api.eventangle.com/*", zone_name = "eventangle.com" }
   ]
   ```

3. **Deploy to production**:
   ```bash
   wrangler deploy --env production
   ```

### Option B: Workers.dev Subdomain (No Custom Domain)

Use the default workers.dev URL - no configuration needed:
```
https://eventangle-api.YOUR_SUBDOMAIN.workers.dev
```

## CI/CD Integration

### GitHub Actions - Auto-Update Deployment ID

Add to your `.github/workflows/stage1-deploy.yml`:

```yaml
- name: Update Cloudflare Worker
  if: success()
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
  run: |
    # Update wrangler.toml with new deployment ID
    DEPLOYMENT_ID="${{ steps.deploy.outputs.deployment_id }}"

    cd cloudflare-proxy

    # Update the deployment ID in wrangler.toml
    sed -i "s/DEPLOYMENT_ID = \"[^\"]*\"/DEPLOYMENT_ID = \"${DEPLOYMENT_ID}\"/" wrangler.toml

    # Deploy updated worker
    npx wrangler deploy

    echo "✅ Cloudflare Worker updated with deployment ID: $DEPLOYMENT_ID"
```

### Required GitHub Secrets

| Secret | Description | How to Get |
|--------|-------------|------------|
| `CLOUDFLARE_API_TOKEN` | API token with Workers permissions | Cloudflare Dashboard → My Profile → API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | Your account identifier | Cloudflare Dashboard → Workers → Account ID |

### Creating API Token

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click **Create Token**
3. Use template: **Edit Cloudflare Workers**
4. Set permissions:
   - Account: Workers Scripts: Edit
   - Zone: Workers Routes: Edit (if using custom domain)
5. Copy token to GitHub Secrets

## Environment Configuration

### Development (default)

```bash
wrangler deploy
# → https://eventangle-api.YOUR_SUBDOMAIN.workers.dev
```

### Production

```bash
wrangler deploy --env production
# → https://api.eventangle.com (custom domain)
```

### Staging

**Quick Setup (recommended):**
```bash
# Set your Cloudflare API token (get from https://dash.cloudflare.com/profile/api-tokens)
export CLOUDFLARE_API_TOKEN="your-api-token"

# Run the automated setup (creates DNS + deploys worker)
npm run staging:setup
```

**Manual Setup:**
```bash
# 1. Create DNS records (choose one method):
#    Option A: Use the script
export CLOUDFLARE_API_TOKEN="your-api-token"
npm run staging:dns

#    Option B: Manual in Cloudflare Dashboard
#    - Add A record: stg.eventangle.com → 192.0.2.1 (proxied/orange cloud)
#    - Add A record: api-stg.eventangle.com → 192.0.2.1 (proxied/orange cloud)

# 2. Deploy the staging worker
wrangler deploy --env staging
```

**Result:**
```
# → https://stg.eventangle.com
# → https://api-stg.eventangle.com
```

## Testing with Cloudflare URL

Update your test environment to use Cloudflare:

```bash
# Run tests against Cloudflare proxy
export BASE_URL=https://eventangle-api.YOUR_SUBDOMAIN.workers.dev
npm run test:api
npm run test:smoke
```

Or update `tests/config/environments.js`:

```javascript
cloudflare: {
  name: 'Cloudflare Workers',
  baseUrl: process.env.CLOUDFLARE_URL || 'https://api.eventangle.com',
  description: 'Cloudflare Workers proxy to Apps Script',
  brands: { root: 'root', abc: 'abc', cbc: 'cbc', cbl: 'cbl' }
}
```

## Worker Features

### CORS Support

The worker automatically handles CORS preflight requests:

```javascript
// Allowed methods
'GET, POST, PUT, DELETE, OPTIONS'

// Allowed headers
'Content-Type, Authorization, X-Requested-With'
```

### Error Handling

Proxy errors return standardized JSON:

```json
{
  "ok": false,
  "error": "PROXY_ERROR",
  "message": "Failed to proxy request to Apps Script"
}
```

### Request Forwarding

The worker forwards:
- Query parameters (`?p=status&brand=root`)
- Request body (for POST/PUT)
- Content-Type header
- User-Agent (for analytics)

## Monitoring

### Cloudflare Dashboard

View real-time metrics at:
```
https://dash.cloudflare.com → Workers → eventangle-api → Analytics
```

Available metrics:
- Request count
- Error rate
- Response time percentiles
- Geographic distribution

### Worker Logs

```bash
# Stream real-time logs
wrangler tail

# Filter by status
wrangler tail --status error
```

## Troubleshooting

### "Worker not found"

```bash
# Check deployment status
wrangler whoami
wrangler deployments list
```

### "Route not matching"

Ensure your domain is added to Cloudflare and nameservers are updated.

### "502 Bad Gateway"

Apps Script may be rate-limited or deployment ID is invalid:

```bash
# Test direct Apps Script URL
curl "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?p=status&brand=root"
```

### Update Deployment ID Manually

```bash
cd cloudflare-proxy

# Edit wrangler.toml
# Change DEPLOYMENT_ID = "..."

# Redeploy
wrangler deploy
```

## Cost

### Cloudflare Workers (Free Tier)
- 100,000 requests/day
- 10ms CPU time per request
- Unlimited bandwidth
- **Cost: $0/month**

### Cloudflare Workers (Paid)
- 10 million requests/month included
- Unlimited requests at $0.50/million
- **Cost: $5/month base**

## Setup Checklist

- [ ] Create Cloudflare account
- [ ] Install Wrangler CLI
- [ ] Deploy worker to workers.dev
- [ ] Test all endpoints via worker URL
- [ ] (Optional) Add custom domain
- [ ] Add GitHub Secrets for CI/CD
- [ ] Update CI/CD workflow
- [ ] Update test configuration
- [ ] Verify production traffic

## File Structure

```
cloudflare-proxy/
├── worker.js           # Main worker code
├── wrangler.toml       # Wrangler configuration
└── CLOUDFLARE_SETUP.md # This guide
```

## Next Steps

1. Run `wrangler login` to authenticate
2. Run `wrangler deploy` to deploy
3. Test with `curl` or browser
4. Update CI/CD if needed
5. Point DNS to Cloudflare (for custom domain)
