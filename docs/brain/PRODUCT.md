# Product context (from CLAUDE.md §1–§2)

> Moved out of the root `CLAUDE.md` (2026-10-11) so it is read when needed instead of on every turn.
> Edit this file directly.

## 1. Architecture Decisions

### Phase Model (3 Phases)

| Phase       | Stack                                                | Status             |
| ----------- | ---------------------------------------------------- | ------------------ |
| **Phase 1** | Cloudflare Worker + D1 (migrated from Google Sheets) | Build ✅ / Ops 📋  |
| **Phase 2** | Cloudflare Worker + D1 (edge SQLite)                 | Code ✅ / Infra 📋 |
| **Phase 3** | Firebase Auth + React/Tailwind on Firebase Hosting   | Not started        |

**Key principle**: Code is written and tested NOW, infrastructure is the last step. CC writes Worker routes, tests, migrations, and PRs without needing a live staging URL. CI validates. Infrastructure deployment happens when ready.

### Brand Motif: Rings and Triangles

Two visual/conceptual frameworks define the platform. These are the signature brand elements.

#### Triangle Framework

```
         Events
        ╱  ·   ╲
       ╱   ·    ╲
      ╱  Shared  ╲
     ╱  Reports   ╲
    ╱       ·      ╲
Sponsors ──────── Customers
```

- **Events** (apex): Gatherings/occasions — the core entity, always on top
- **Sponsors** (bottom-left): Brands supporting events — placement + tracking
- **Customers** (bottom-right): Attendees — represented by QR codes and shortlinks
- **SharedReports** (center): The proof layer — validates value for all three vertices

#### Ring Framework (NCR: Node, Corridor, Ring)

```
          Ads
        ↙     ↘
SharedReports  Pre-Events
      ↑            ↓
 Post-Events ← Events
```

Five lifecycle stages in a clockwise flywheel — Ads at 12 o'clock:

- **Ads**: Visibility — getting the word out (starts the cycle)
- **Pre-Events**: Incubation — registration, QR generation, sponsor setup
- **Events**: Engagement — check-ins, scans, live interaction
- **Post-Events**: Analytics — surveys, email signups, data collection
- **SharedReports**: Proof — aggregate results feed back into the next Ads cycle

### 5 MVP Surfaces

1. `admin.html` — Event management control room
2. `public.html` — Mobile-first public event page
3. `display.html` — TV/kiosk live event display
4. `poster.html` — Printable poster with QR codes
5. `sharedReport.html` — Shareable analytics dashboard

### API Contract

```
Public:
  GET /health                → { ok, env, version }
  GET /api/v2/events         → { ok, items[] }
  GET /api/v2/events/:id     → { ok, item }
  GET /                      → 200 HTML (public page)

Admin (CF Access JWT; X-OCR-Internal / Bearer fallbacks are env-gated):
  GET /admin                 → 200 HTML (dashboard)
  GET /api/v2/admin/events   → { ok, items[] } (includes archived)
```

### Worker Structure

```
workers/oursharedevents/src/
├── index.ts              # Entry point + scheduled PII lifecycle job
├── router.ts             # Route table (~80 method+path pairs)
├── auth/admin.ts         # Admin auth guard (CF Access JWT + Bearer fallback)
├── handlers/
│   ├── health.ts         # Health check
│   ├── events.ts         # Events API (D1 queries)
│   ├── pages.ts          # HTML pages (public, admin, landing)
│   ├── forms.ts          # Form submissions (register, checkin, survey, email)
│   ├── form-pages.ts     # Mobile-first QR form landing pages
│   └── feature-flags.ts  # Admin flag management (8 endpoints)
└── lib/
    ├── forms-db.ts       # Privacy utilities (hash, encrypt, bucket)
    ├── feature-flags.ts  # Flag resolution (3-tier: free/mid/enterprise)
    └── cors.ts           # CORS allowlist
```

---

## 2. ourCommunityRituals Ecosystem

> **Source of truth**: `OCR-docs/docs/OCR_VISION.md` — all product repos derive from that document.

| Code | Product                 | Repo                                   | Purpose                                                         |
| ---- | ----------------------- | -------------------------------------- | --------------------------------------------------------------- |
| OCR  | OurCommunityRituals LLC | `ourCommunityRituals/OCR-docs`         | Holding company. Org brain. Governance.                         |
| OSE  | OurSharedEvents         | `ourCommunityRituals/ourSharedEvents`  | **This repo.** Core platform — event infrastructure, API, admin |
| OW   | OurWKRP                 | `ourCommunityRituals/ourWKRP`          | Community music curation. Named identity. White label tiers.    |
| OSG  | OurSharedGames          | `ourCommunityRituals/ourSharedGames`   | Founding activation format. Anchor game nights.                 |
| OSR  | OurSharedRecords        | `ourCommunityRituals/ourSharedRecords` | Music, story, and archive layer. Oral history.                  |
| OSP  | OurSharedPulse          | `ourCommunityRituals/ourSharedPulse`   | Pre-platform consulting. Human-delivered entry point.           |
| OSM  | OurSharedMagnets        | `ourCommunityRituals/ourSharedMagnets` | Developer and franchise layer. API and white label support.     |
| OER  | OurEventRings           | —                                      | Intelligence and analytics. Long horizon.                       |
| OA   | OurAirwaves             | `ourCommunityRituals/ourAirwaves`      | Deployment and white label layer. Client fork template.         |
