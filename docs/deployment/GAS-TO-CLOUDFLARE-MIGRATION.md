# GAS to Cloudflare Worker Migration Map

> **HISTORICAL DOCUMENT — D1 ERA**
> This map was written when migration from GAS targeted `cloudflare-proxy/` (now retired).
> The canonical worker is `workers/oursharedevents/src/` (TypeScript, Hono-style router).
> See `docs/architecture/ARCHITECTURE.md` for the current architecture.
> This document is preserved for migration history only — do not use it as a reference for new development.

**Purpose:** Reference guide mapping Google Apps Script (GAS) structure to the (then-new) Cloudflare Worker architecture.

---

## Configuration Files

| GAS File                      | Cloudflare Equivalent      | Purpose                         | Notes                             |
| ----------------------------- | -------------------------- | ------------------------------- | --------------------------------- |
| `Config.gs` → `ZEB` object    | `config/deployment-ids.js` | Script IDs, deployment URLs     | Reads from `deploy-manifest.json` |
| `Config.gs` → `FEATURE_FLAGS` | `config/feature-flags.js`  | Feature toggles                 | Same flag names preserved         |
| `Config.gs` → URLs            | `config/environments.js`   | Environment URLs (stg/prod)     |                                   |
| `Config.gs` → Branding        | `config/brand-config.js`   | Brand/app configuration         |                                   |
| `Config.gs` → Admin keys      | Cloudflare secrets         | `ADMIN_KEY_ROOT`, etc.          | Set via `wrangler secret put`     |
| `appsscript.json`             | `wrangler.toml`            | Project/deployment config       |                                   |
| N/A                           | `deploy-manifest.json`     | Centralized deployment manifest | Single source of truth            |

---

## Backend Code

> **Note (D1 era):** The "Cloudflare Equivalent" paths below map to `cloudflare-proxy/` which is retired.
> The current canonical equivalents live in `workers/oursharedevents/src/handlers/` and `src/lib/`.

| GAS File                | Historical CF Equivalent (retired)           | Current Canonical Location                       | Purpose              |
| ----------------------- | -------------------------------------------- | ------------------------------------------------ | -------------------- |
| `Code.gs`               | `cloudflare-proxy/src/handlers/*.js`         | `workers/oursharedevents/src/handlers/`          | Main backend logic   |
| `Code.gs` → `doGet()`   | `cloudflare-proxy/src/index.js` → `fetch()`  | `workers/oursharedevents/src/index.ts`           | Request handler      |
| `ApiSchemas.gs`         | `cloudflare-proxy/src/schemas/*.js`          | `workers/oursharedevents/src/handlers/events.ts` | API response schemas |
| `SecurityMiddleware.gs` | `cloudflare-proxy/src/middleware/auth.js`    | `workers/oursharedevents/src/auth/admin.ts`      | Authentication       |
| `TemplateService.gs`    | `cloudflare-proxy/src/services/templates.js` | `workers/oursharedevents/src/handlers/pages.ts`  | Template management  |
| `FormService.gs`        | `cloudflare-proxy/src/services/forms.js`     | `workers/oursharedevents/src/handlers/forms.ts`  | Form submissions     |
| `SponsorService.gs`     | `cloudflare-proxy/src/services/sponsors.js`  | (not yet implemented)                            | Sponsor management   |
| `AnalyticsService.gs`   | `cloudflare-proxy/src/services/analytics.js` | (not yet implemented)                            | Analytics            |

---

## Frontend / HTML Surfaces

| GAS Location                | Cloudflare Location         | Purpose                      |
| --------------------------- | --------------------------- | ---------------------------- |
| `src/mvp/Admin.html`        | `src/mvp/Admin.html`        | **No change** - still served |
| `src/mvp/Public.html`       | `src/mvp/Public.html`       | **No change**                |
| `src/mvp/Display.html`      | `src/mvp/Display.html`      | **No change**                |
| `src/mvp/Poster.html`       | `src/mvp/Poster.html`       | **No change**                |
| `src/mvp/SharedReport.html` | `src/mvp/SharedReport.html` | **No change**                |

**Note:** HTML surfaces are bundled via `npm run bundle:templates` and served by the Worker.

---

## API Routing

| GAS Pattern                 | Cloudflare Pattern                | Example             |
| --------------------------- | --------------------------------- | ------------------- |
| `?page=admin`               | `/admin` or `?page=admin`         | Surface routing     |
| `?page=public&event=xxx`    | `/public?event=xxx`               | Event pages         |
| `?p=status`                 | `/api/status` or `/api/v2/status` | API endpoints       |
| `?p=getEvents`              | `/api/events` or `/api/v2/events` |                     |
| RPC via `google.script.run` | RPC via `fetch('/api/...')`       | Client-server calls |

---

## Data Storage

| GAS                         | Cloudflare           | Purpose            |
| --------------------------- | -------------------- | ------------------ |
| Google Sheets               | Cloudflare D1 / KV   | Primary data store |
| `SpreadsheetApp.openById()` | D1 SQL queries       | Database access    |
| PropertiesService           | KV namespace         | Key-value storage  |
| CacheService                | Cloudflare Cache API | Caching            |

---

## Authentication & Secrets

| GAS Method                                | Cloudflare Method                          | Example                  |
| ----------------------------------------- | ------------------------------------------ | ------------------------ |
| `PropertiesService.getScriptProperties()` | `env.SECRET_NAME`                          | Access secrets           |
| URL parameter `?key=xxx`                  | `CF-Access-*` headers                      | Cloudflare Access tokens |
| `ADMIN_KEY_ROOT` in Config.gs             | `wrangler secret put ADMIN_KEY_ROOT`       | Admin authentication     |
| Service Account JSON                      | `wrangler secret put SERVICE_ACCOUNT_JSON` | GCP service account      |

### Setting Cloudflare Secrets

```bash
# Set a secret
wrangler secret put ADMIN_KEY_ROOT

# List secrets
wrangler secret list

# Delete a secret
wrangler secret delete ADMIN_KEY_ROOT
```

---

## Deployment

| GAS Command      | Cloudflare Command                 | Purpose           |
| ---------------- | ---------------------------------- | ----------------- |
| `clasp push`     | `wrangler deploy`                  | Deploy code       |
| `clasp deploy`   | `wrangler deploy --env production` | Create deployment |
| `clasp versions` | `wrangler deployments list`        | List versions     |
| `clasp open`     | Cloudflare Dashboard               | Open project      |

### Environment-Specific Deployment

```bash
# Staging (stg.oursharedevents.com)
wrangler deploy --env staging

# Production (oursharedevents.com)
wrangler deploy --env production
```

---

## CI/CD Workflows

| GAS CI               | Cloudflare CI                     | File            |
| -------------------- | --------------------------------- | --------------- |
| `clasp push` in CI   | `wrangler deploy`                 | `stage1.yml`    |
| Service account auth | `CLOUDFLARE_API_TOKEN_ESE` secret | GitHub Secrets  |
| Script ID            | Account ID + Worker name          | `wrangler.toml` |

---

## File Structure Comparison

> **Note (D1 era):** The "Cloudflare Structure" below reflects the intermediate `cloudflare-proxy/` era (now retired).
> Current canonical structure is `workers/oursharedevents/src/` — see `docs/architecture/ARCHITECTURE.md`.

```
GAS Structure:                    Historical CF Structure (retired):
├── Code.gs                       ├── cloudflare-proxy/          ← retired; use workers/oursharedevents/src/
├── Config.gs                     │   ├── src/
├── ApiSchemas.gs                 │   │   ├── index.js (entry point)
├── SecurityMiddleware.gs         │   │   ├── handlers/
├── TemplateService.gs            │   │   ├── middleware/
├── FormService.gs                │   │   ├── services/
├── SponsorService.gs             │   │   ├── schemas/
├── AnalyticsService.gs           │   │   └── config/
├── appsscript.json               │   └── wrangler.toml
│                                 │
├── Admin.html                    ├── src/mvp/                   ← legacy; templates now in workers/oursharedevents/src/
├── Public.html                   │   ├── Admin.html
├── Display.html                  │   ├── Public.html
├── Poster.html                   │   ├── Display.html
└── SharedReport.html             │   ├── Poster.html
                                  │   └── SharedReport.html
                                  │
                                  ├── config/
                                  │   ├── deployment-ids.js
                                  │   ├── environments.js
                                  │   ├── feature-flags.js
                                  │   └── brand-config.js
                                  │
                                  └── deploy-manifest.json
```

---

## Key Differences

### 1. Entry Point

- **GAS:** `doGet(e)` function handles all requests
- **Cloudflare:** `fetch(request, env, ctx)` in `index.js`

### 2. Environment Variables

- **GAS:** `PropertiesService.getScriptProperties().getProperty('KEY')`
- **Cloudflare:** `env.KEY` (bound in wrangler.toml or via secrets)

### 3. HTML Templating

- **GAS:** `HtmlService.createTemplateFromFile('Admin').evaluate()`
- **Cloudflare:** Pre-bundled HTML served via Worker

### 4. Client-Server Communication

- **GAS:** `google.script.run.withSuccessHandler().functionName()`
- **Cloudflare:** `fetch('/api/endpoint')` with JSON responses

### 5. Logging

- **GAS:** `Logger.log()`, `console.log()`
- **Cloudflare:** `console.log()` (visible in `wrangler tail`)

---

## Migration Checklist

When migrating a GAS feature to Cloudflare:

- [ ] Identify the GAS file(s) involved
- [ ] Find the equivalent Cloudflare location (see tables above)
- [ ] Update API endpoints to use `/api/` prefix
- [ ] Replace `google.script.run` with `fetch()` calls
- [ ] Move secrets to Cloudflare (via `wrangler secret put`)
- [ ] Update feature flags in `config/feature-flags.js`
- [ ] Test in staging (`stg.oursharedevents.com`)
- [ ] Deploy to production

---

## Archived GAS Files

All original GAS files are preserved in `archive/gas/`:

```
archive/gas/
├── Code.gs
├── Config.gs
├── ApiSchemas.gs
├── SecurityMiddleware.gs
├── TemplateService.gs
├── FormService.gs
├── SponsorService.gs
├── AnalyticsService.gs
├── BackupService.gs
├── DiagArchiver.gs
├── DataHealthChecker.gs
├── AnalyticsRollup.gs
└── SharedReporting.gs
```

These are kept for reference but are **not deployed**.

---

## Related Documentation

- `docs/ci-cd-architecture.md` - CI/CD pipeline documentation
- `cloudflare-proxy/README.md` - Worker-specific docs
- `deploy-manifest.json` - Deployment configuration
- `wrangler.toml` - Cloudflare Worker config
