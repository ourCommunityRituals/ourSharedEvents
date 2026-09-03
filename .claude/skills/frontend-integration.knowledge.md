# Lead Frontend Integration — Knowledge Base

> **Reconciliation note (2026-09-03, code wins):** the surface table below is stale: all six surfaces (landing `/`, public `/events`, admin, display `/display`, poster `/poster`, shared report `/sharedReport`) are served by the canonical Worker; friendly/alias URLs ARE implemented (see the `router.ts` header). Trust root `CLAUDE.md` §1 and `docs/features/SURFACES.md` over the tables below until this file's truth pass.

> **Role:** Owns the 5 MVP surfaces, HTML/CSS/JS templates, client-side rendering, and Phase 3 React/Tailwind migration
> **Last Reconciled:** 2026-03-27

---

## Current State: Phase 1 — Embedded HTML in Worker

### Active Surfaces (in `workers/oursharedevents/src/handlers/pages.ts`)

| Surface       | Lines | Description                                                     | Route        |
| ------------- | ----- | --------------------------------------------------------------- | ------------ |
| `PUBLIC_HTML` | ~74   | Event listing — fetches `/api/v2/events`, renders cards         | `GET /`      |
| `ADMIN_HTML`  | ~65   | Admin dashboard — fetches `/api/v2/admin/events`, renders table | `GET /admin` |

**Missing from clean Worker (exist in `worker/` or `web/`):**

| Surface             | Location                                                 | Status                  |
| ------------------- | -------------------------------------------------------- | ----------------------- |
| `display.html`      | `web/display/` or `worker/src/handlers/displayBundle.ts` | Not in canonical Worker |
| `poster.html`       | `web/poster/` or `worker/src/handlers/posterBundle.ts`   | Not in canonical Worker |
| `sharedReport.html` | `worker/src/handlers/sharedReport.ts`                    | Not in canonical Worker |

### Architecture Pattern (Phase 1)

```
Worker serves HTML string
  → Browser loads page
  → Client JS calls fetch('/api/v2/events')
  → JSON response rendered into DOM
  → Pure CSS (no framework)
```

- No build step for frontend
- No bundler (Vite, webpack, etc.)
- No framework (React, Vue, etc.)
- No CSS framework (Tailwind, etc.)
- Inline `<style>` and `<script>` in HTML strings
- Content-Type: `text/html; charset=utf-8`

### Client-Side JavaScript Patterns

**Public page:**

```javascript
fetch('/api/v2/events')
  .then((r) => r.json())
  .then((data) => {
    // Renders event cards with title, date, location
    // Handles empty state
    // Handles error state
  });
```

**Admin page:**

```javascript
fetch('/api/v2/admin/events', {
  headers: { Authorization: 'Bearer ' + token },
})
  .then((r) => r.json())
  .then((data) => {
    // Renders table with id, title, status, brand
    // Token input field for auth
  });
```

### Legacy Frontend Assets

| Directory  | Contents                                           | Status                       |
| ---------- | -------------------------------------------------- | ---------------------------- |
| `web/`     | admin.html, public.html, display.html, poster.html | Legacy standalone HTML files |
| `public/`  | Static assets (images, icons)                      | Available                    |
| `display/` | Display-specific assets                            | Available                    |
| `poster/`  | Poster-specific assets                             | Available                    |
| `src/`     | Legacy GAS frontend source                         | Archived                     |

### Multi-Brand Theming

- `brandConfig` object carries brand-specific colors, logos, names
- Currently hardcoded in Worker responses
- Phase 3 target: Dynamic theming via `theme_config` column in D1 events table

### Video Embedding (documented in ARCHITECTURE.md)

- YouTube regex validation for embed URLs
- Vimeo regex validation
- Used in Public and Display surfaces
- Not yet implemented in clean Worker (exists in `worker/`)

---

## Phase 3 Target: React/Tailwind on Firebase Hosting

### Migration Order (lowest risk first, per STORIES.md P3-1)

1. `public.html` (2,125 lines in legacy) → `EventPublicPage.tsx`
2. `display.html` (1,789 lines) → `EventDisplay.tsx`
3. `poster.html` (832 lines) → `EventPoster.tsx`
4. `admin.html` → `AdminShell.tsx`

### Target Architecture

```
Firebase Hosting CDN serves React SPA
  → React app calls Worker API (oursharedevents.com/api/v2/*)
  → Worker returns JSON only (no HTML)
  → Worker bundle drops from ~200KB to <50KB
```

### Acceptance Criteria (P3-1)

- Worker bundle < 50KB
- Public events page looks identical to pre-migration
- Firebase Hosting serves pages (verify `x-firebase-hosting` header)
- Per-event theming via `brandConfig`

---

## Known Gaps

1. **Only 2 of 5 surfaces in canonical Worker:** display, poster, sharedReport not yet ported from `worker/` to `workers/oursharedevents/`

2. **No responsive/mobile testing:** Embedded HTML has basic CSS but no media queries or mobile-first design validation

3. **No accessibility:** No ARIA attributes, semantic HTML minimal, no keyboard navigation

4. **No error UI states:** Client JS has basic error handling but no user-friendly error screens

5. **No loading states:** No skeleton screens or spinners during API fetch

6. **Friendly URLs not implemented:** `docs/FRIENDLY_URLS.md` documents aliases (`/events`, `/display`, `/manage`) but router doesn't implement them

---

## File Map

| File                                             | What It Controls                       |
| ------------------------------------------------ | -------------------------------------- |
| `workers/oursharedevents/src/handlers/pages.ts`  | Active HTML templates (public + admin) |
| `workers/oursharedevents/src/handlers/events.ts` | JSON API consumed by frontend          |
| `web/`                                           | Legacy standalone HTML surfaces        |
| `docs/FRIENDLY_URLS.md`                          | URL alias spec (not yet implemented)   |
| `docs/MVP_SCOPE.md`                              | Scope lock — 5 surfaces, no more       |
