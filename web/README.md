# Web Surfaces

This directory contains the version-controlled HTML surfaces for EventAngle.

## Story 4.1 - Move HTML Surfaces to Cloudflare

All HTML surfaces are now served directly from Cloudflare Workers without any Google Apps Script dependencies.

## Directory Structure

```
web/
├── admin/
│   └── index.html      # Redirects to /admin (Admin Dashboard)
├── public/
│   └── index.html      # Redirects to /public (Public Events)
├── display/
│   └── index.html      # Redirects to /display (TV Display)
├── poster/
│   └── index.html      # Redirects to /poster (Poster Generator)
└── README.md           # This file
```

## How It Works

1. **Template Source**: HTML templates are maintained in `src/mvp/` directory
2. **Template Bundling**: `npm run bundle:templates` processes and bundles templates
3. **Worker Serving**: Templates are embedded in the Worker bundle and served via `worker/src/handlers/staticAssets.ts`
4. **No GAS Fetch**: All pages load from Cloudflare Worker - no Google Apps Script roundtrip

## Route Aliases

Each surface can be accessed via multiple URL paths:

| Surface | Routes |
|---------|--------|
| Public  | `/public`, `/events`, `/schedule`, `/calendar`, `/` |
| Admin   | `/admin`, `/manage`, `/dashboard`, `/create` |
| Display | `/display`, `/tv`, `/kiosk`, `/screen` |
| Poster  | `/poster`, `/posters`, `/flyers` |
| Report  | `/report`, `/analytics`, `/reports`, `/insights` |

## Brand Support

Surfaces support brand prefixes:
- `/abc/public` - ABC brand public page
- `/cbc/admin` - CBC brand admin page
- `/cbl/display` - CBL brand display page

## Verification

Run Stage-2 Playwright tests to verify:

```bash
npx playwright test tests/e2e/stage-2/html-surfaces.spec.ts
```

## Headers

All surfaces include these headers:

| Header | Description |
|--------|-------------|
| `X-Served-By: cloudflare-worker` | Confirms Worker serving |
| `X-Page-Type` | Surface type (admin, public, etc.) |
| `X-Brand` | Brand identifier |
| `X-Router-Version` | Router version |
