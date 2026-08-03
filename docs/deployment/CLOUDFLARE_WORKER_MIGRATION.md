# Cloudflare Worker Migration Plan

**Status: COMPLETE - GAS RETIRED**
**Last Updated:** 2025-12-13
**Story:** 5.3 - Decommission Apps Script Project

---

## Migration Complete

The migration from Google Apps Script (GAS) to Cloudflare Workers is **complete**. All API traffic now flows through the Cloudflare Worker which connects directly to Google Sheets via the Sheets API.

### Phase Summary

| Phase   | Description    | Status                   |
| ------- | -------------- | ------------------------ |
| Phase 1 | Read-Only APIs | ✅ COMPLETE              |
| Phase 2 | Write APIs     | ✅ COMPLETE              |
| Phase 3 | GAS Retirement | ✅ COMPLETE (2025-12-13) |

---

## Implementation Status

**Phase 1 (Read-Only APIs): COMPLETE**

- [x] `/api/v2/status` - Worker-native health check
- [x] `/api/v2/events` - List events directly from Sheets
- [x] `/api/v2/events/:id` - Get single event from Sheets
- [x] `/api/v2/events/:id/bundle/public` - Public bundle
- [x] `/api/v2/events/:id/bundle/display` - Display bundle
- [x] `/api/v2/events/:id/bundle/poster` - Poster bundle

**Phase 2 (Write APIs): COMPLETE**

- [x] `POST /api/v2/events` - Create event (requires auth)
- [x] `PUT /api/v2/events/:id` - Update event (requires auth)

**Phase 3 (GAS Retirement): COMPLETE**

- [x] Archive GAS code to `archive/gas/`
- [x] Update clasp configurations (marked as archived)
- [x] Disable GAS deployment workflows
- [x] Update architecture documentation
- [x] Remove GAS as active backend

---

## Current Architecture

**Phase 1 (active — Sheets):**

```
Clients (Admin, Public, Display, Poster, SharedReport, Form QR pages)
    │
    ▼
Cloudflare Worker — workers/oursharedevents/src/
    ├── /health, /api/status        → Worker health check
    ├── /api/v2/events              → List events from Sheets
    ├── /api/v2/events/:id          → Get single event
    ├── /api/v2/admin/events        → Admin event list (auth required)
    ├── /api/v2/events/:id/forms/*  → Form submissions
    ├── /api/v2/admin/flags/*       → Feature flag management
    ├── /admin, /events, /forms/*   → Server-rendered HTML surfaces
    │
    ▼
Google Sheets API (via service account — lib/google-auth.ts, lib/sheets.ts)
    ├── EVENTS sheet        → Event data
    ├── ANALYTICS sheet     → Event tracking log
    ├── CONFIG sheet        → Brand configuration
    └── SHORTLINKS sheet    → URL shortening
```

**Phase 2 (D1 — schema written, infra pending):**

```
Cloudflare Worker
    ▼
D1 MAIN_DB   (ocr-db-staging)       → Anonymous event/scan data
D1 FORMS_DB  (ocr-forms-db-staging) → PII-bearing forms + feature flags
```

Migrations live in `workers/oursharedevents/migrations/` (MAIN_DB) and `migrations-forms/` (FORMS_DB).

**Key changes from GAS architecture:**

- ❌ No GAS in request path
- ✅ All APIs handled by Worker (`workers/oursharedevents/src/`)
- ✅ Direct Sheets API access (Phase 1)
- ✅ D1 edge SQLite replacing Sheets (Phase 2)
- ✅ Full control over error handling, auth, and PII lifecycle

---

## GAS Backend (Archived)

The GAS backend has been archived but preserved for emergency rollback scenarios.

**Archive Location:** `archive/gas/`
**Restoration Guide:** `archive/gas/README.md`

### Archived Files

- `Code.gs` - Router + API endpoints (doGet/doPost)
- `Config.gs` - Brands, environment, templates
- `TemplateService.gs` - Event templates
- `ApiSchemas.gs` - JSON Schema validation
- `FormService.gs` - Google Forms creation
- `SponsorService.gs` - Sponsor management
- And 7 other service files

### GAS Project IDs (For Reference)

| Environment | Script ID                                                   | Status   |
| ----------- | ----------------------------------------------------------- | -------- |
| Staging     | `1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ` | ARCHIVED |
| Production  | `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l` | ARCHIVED |

---

## API Reference (v2 Endpoints)

All endpoints use the `/api/v2/` prefix.

### GET /api/v2/status

Worker-native health check (no auth required).

```bash
curl https://stg.oursharedevents.com/api/v2/status
```

### GET /api/v2/ping

Simple ping endpoint for uptime monitoring.

```bash
curl https://stg.oursharedevents.com/api/v2/ping
```

### GET /api/v2/events

List all events for a brand.

**Query params:**

- `brand` (optional): Brand ID (root, abc, cbc, cbl). Defaults to "root"
- `full` (optional): Include full event data. Defaults to "false"

```bash
curl "https://stg.oursharedevents.com/api/v2/events?brand=root"
```

### GET /api/v2/events/:id

Get single event by ID or slug.

```bash
curl "https://stg.oursharedevents.com/api/v2/events/EVT_123?brand=root"
```

### GET /api/v2/events/:id/bundle/:type

Get bundle for specific surface (public, display, poster, admin).

**Bundle Types:**

- `public` - Full event data for public page
- `display` - Event data for TV/kiosk display
- `poster` - Event data with QR codes for printable poster
- `admin` - Full event data (requires auth)

```bash
curl "https://stg.oursharedevents.com/api/v2/events/EVT_123/bundle/public?brand=root"
```

### POST /api/v2/events

Create a new event (requires admin auth).

```bash
curl -X POST "https://stg.oursharedevents.com/api/v2/events" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Summer Tournament 2025", "startDateISO": "2025-07-15", "venue": "Main Arena", "brandId": "root"}'
```

### PUT /api/v2/events/:id

Update an existing event (requires admin auth).

```bash
curl -X PUT "https://stg.oursharedevents.com/api/v2/events/EVT_123" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Summer Tournament 2025 - Updated", "venue": "New Arena"}'
```

---

## Directory Structure

```
cloudflare-proxy/
├── worker.js           # Main entry point
├── src/
│   ├── sheets/
│   │   ├── client.js   # Google Sheets API client
│   │   ├── auth.js     # Service account JWT auth
│   │   └── events.js   # Event-specific Sheet operations
│   ├── api/
│   │   ├── status.js   # Health check handler
│   │   ├── events.js   # Events API handlers
│   │   └── bundles.js  # Bundle API handlers
│   ├── utils/
│   │   ├── qr.js       # QR code generation (native)
│   │   ├── jwt.js      # JWT utilities
│   │   └── brand.js    # Brand configuration
│   └── middleware/
│       ├── auth.js     # Admin auth middleware
│       └── cors.js     # CORS handling
├── templates/          # HTML templates
└── wrangler.toml       # Configuration
```

---

## Security & Auth

### Service Account (Worker → Sheets)

Worker holds these secrets (via `wrangler secret put`):

- `GOOGLE_CLIENT_EMAIL` - Service account email
- `GOOGLE_PRIVATE_KEY` - Service account private key (PEM format)
- `SHEETS_SPREADSHEET_ID` - Target spreadsheet ID

### Admin Auth (Client → Worker)

- Header: `Authorization: Bearer <ADMIN_TOKEN>`
- Token stored as Wrangler secret: `ADMIN_TOKEN`

---

## Wrangler Secrets

```bash
# Service account credentials
wrangler secret put GOOGLE_CLIENT_EMAIL --env staging
wrangler secret put GOOGLE_PRIVATE_KEY --env staging
wrangler secret put SHEETS_SPREADSHEET_ID --env staging

# Admin auth token
wrangler secret put ADMIN_TOKEN --env staging
```

---

## Testing Strategy

1. **Unit tests:** Jest tests for Sheets client, JWT auth, QR generation
2. **Contract tests:** Validate API responses against schemas
3. **Integration tests:** Test actual Sheets API calls (staging only)
4. **E2E tests:** Playwright tests for full user flows
5. **Smoke tests:** Critical path validation on deployment

---

## Emergency Rollback

If the Worker-only architecture encounters critical issues:

1. **Restore GAS code:**

   ```bash
   cp archive/gas/*.gs src/mvp/
   cp archive/gas/appsscript.json src/mvp/
   ```

2. **Restore clasp configs:**

   ```bash
   cp .clasp-production.json.archived .clasp-production.json
   ```

3. **Push to GAS and create deployment:**

   ```bash
   clasp login
   clasp push --force
   clasp deploy -d "Emergency restore"
   ```

4. **Update Worker to proxy to GAS:**
   - Re-add GAS proxy routes to `worker.js`
   - Update deployment ID in `wrangler.toml`
   - Deploy Worker

See `archive/gas/README.md` for detailed restoration instructions.

---

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Current Worker-only architecture
- [MIGRATION_EPICS.md](./MIGRATION_EPICS.md) - Full migration story map
- [archive/gas/README.md](../archive/gas/README.md) - GAS restoration guide

---

_Migration Complete - GAS Retired 2025-12-13_
