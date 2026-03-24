# Phase 3 – Firebase Integration

**Status:** Not started (begins after Phase 2 is stable)
**Prerequisite:** Phase 2 live (D1 as data store)
**Goal:** Integrate Firebase services. Scope depends on which Firebase capabilities are needed.

---

## Decision Point: What is Firebase for?

This phase has two independent tracks. Choose one or both.

| Track | Purpose | Effort |
|-------|---------|--------|
| **A – Firebase Auth** | End-user login (email/Google/SSO) instead of current admin Bearer token | Medium |
| **B – Firebase Hosting** | Serve frontend HTML/JS from Firebase CDN instead of embedding in Worker | Low |

---

## Track A – Firebase Auth

### Why

The current auth model (`ADMIN_KEY` bearer token + Cloudflare Access JWT) is operational for a single-tenant admin workflow. If `oursharedevents.com` needs:
- Multiple named user accounts
- End-user self-registration
- Social login (Google, GitHub, etc.)
- Role-based access (organizer vs. viewer)

…then Firebase Auth is the appropriate upgrade.

### Architecture

```
Browser
  │
  ├── GET /admin → Worker serves admin SPA
  │
  └── POST /api/auth/verify
        │
        └── Worker calls Firebase Auth REST API
              to verify the Firebase ID token
              (no Firebase SDK in Worker — REST only)
```

The Worker does **not** use the Firebase Admin SDK (Node.js only). It calls the Firebase Auth REST endpoint to verify ID tokens.

### Required Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable Authentication → Sign-in providers (Email/Password, Google, etc.)
3. Note the `FIREBASE_PROJECT_ID` and `FIREBASE_API_KEY`
4. Generate a Firebase service account key for token verification

### New Secrets
```bash
wrangler secret put FIREBASE_PROJECT_ID  --env staging
wrangler secret put FIREBASE_API_KEY     --env staging
```

### Worker Changes

New file `src/lib/firebase-auth.ts`:
```ts
// Verify a Firebase ID token via the Google Identity Toolkit REST API
export async function verifyFirebaseToken(
  token: string,
  projectId: string
): Promise<FirebaseTokenPayload | null> {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`;
  // ...
}
```

Replace `src/auth/admin.ts` → `src/auth/firebase.ts`:
- Remove Bearer token / CF Access JWT logic
- Validate Firebase ID token on every admin request

Frontend admin page:
- Add Firebase Auth JS SDK
- Handle sign-in flow, pass `idToken` to API calls

### Files Changed

| File | Action |
|------|--------|
| `src/lib/firebase-auth.ts` | Create |
| `src/auth/admin.ts` | Update (add Firebase token verification) |
| `src/handlers/pages.ts` | Update admin page to include Firebase Auth SDK |
| `wrangler.toml` | Add Firebase secrets reference |

---

## Track B – Firebase Hosting + React + Tailwind

### Why

Firebase Hosting is a globally distributed CDN optimized for static assets. If the HTML/JS/CSS for `oursharedevents.com` grows complex enough that embedding it in the Worker bundle becomes unwieldy, Firebase Hosting offloads that concern.

**Current approach** (Phase 1/2): 22,000+ lines of HTML embedded in the Worker bundle via `[[rules]] type = "Text"`. `Admin.html` alone is 5,690 lines. Every cold start carries this full payload.

**Track B approach**: HTML/JS/CSS deployed to Firebase CDN. Worker bundle drops to pure API + routing logic.

### Adding React + Tailwind (Recommended Extension)

Track B is the right moment to introduce React + Tailwind. The HTML templates are already logically split into pseudo-components (`AdminEvents.html`, `AdminForms.html`, `AdminDisplay.html`, etc.) — React formalizes that split.

**The core unlock: per-event custom sites**

With plain HTML templates, giving each event custom branding requires fragile string replacement. With React + D1:

```tsx
// D1 stores brandConfig per event
<EventPublicPage event={event} theme={event.brandConfig} />
// brandConfig = { primaryColor, logo, fontFamily, accentColor }
```

One component, infinite event skins — no template duplication.

#### Migration Order (lowest risk first)

| Step | File | Reason to go first |
|------|------|-------------------|
| 1 | `Public.html` (2,125 lines) | Customer-facing, most important for mobile + branding |
| 2 | `Display.html` (1,789 lines) | TV display, benefits most from theme props |
| 3 | `Poster.html` (832 lines) | Print page, simple structure |
| 4 | `Admin.html` + sub-templates | Already split logically; migrate card by card |

#### Folder Structure

```
frontend/
  src/
    components/
      EventPublicPage.tsx    ← replaces Public.html
      EventDisplay.tsx       ← replaces Display.html
      EventPoster.tsx        ← replaces Poster.html
      admin/
        AdminShell.tsx       ← replaces Admin.html
        cards/
          EventBasics.tsx    ← replaces AdminEvents.html
          AdminForms.tsx     ← replaces AdminForms.html
          AdminDisplay.tsx   ← replaces AdminDisplay.html
    lib/
      api.ts                 ← replaces src/frontend/apiClient/
  public/
    index.html               ← Vite entry
  vite.config.ts
  tailwind.config.ts
```

#### Worker Bundle Size Impact

| Metric | Now | After Track B |
|--------|-----|--------------|
| Worker bundle | ~200KB+ (HTML embedded) | ~30KB (API only) |
| Cold start | Carries all HTML | Lean JS only |
| HTML cache | None (per-request string) | Firebase CDN edge cache |
| Custom event themes | Requires template forks | `brandConfig` prop from D1 |

#### Build + Deploy Pipeline

```bash
# Frontend build
cd frontend && npm run build   # Vite → dist/

# Deploy to Firebase Hosting
firebase deploy --only hosting --project staging

# Worker deploy (unchanged)
wrangler deploy
```

CI/CD: add `firebase deploy` step after `wrangler deploy` passes.

### Architecture Option 1 – Proxy (recommended)

```
Browser → https://stg.zeventbooks.io/
  │
  └── Cloudflare Worker
        ├── /api/*          → D1 queries (stays in Worker)
        ├── /admin          → Firebase Hosting → React Admin SPA
        ├── /e/:slug        → Firebase Hosting → React EventPublicPage (themed via D1)
        ├── /e/:slug/display → Firebase Hosting → React EventDisplay
        └── /e/:slug/poster  → Firebase Hosting → React EventPoster
```

Worker proxies static requests to Firebase Hosting. One domain, clean separation. React components fetch event data from `/api/events/:slug` on load and apply `brandConfig` from D1.

### Architecture Option 2 – Split domain

```
https://api.zeventbooks.io/*   → Cloudflare Worker (D1)
https://app.zeventbooks.io/*   → Firebase Hosting (React + Tailwind)
```

Simpler but requires CORS configuration on the Worker.

### Required Setup

1. `npm install -g firebase-tools`
2. `firebase login`
3. `firebase init hosting` in `web/` or a new `frontend/` directory
4. `firebase deploy --only hosting`

### New Files

```
firebase.json              ← Firebase project config
.firebaserc                ← Project aliases (staging/prod)
frontend/
  src/
    components/
      EventPublicPage.tsx  ← replaces Public.html (2,125 lines)
      EventDisplay.tsx     ← replaces Display.html (1,789 lines)
      EventPoster.tsx      ← replaces Poster.html (832 lines)
      admin/
        AdminShell.tsx     ← replaces Admin.html (5,690 lines)
        cards/             ← replaces AdminEvents/Forms/Display.html
    lib/
      api.ts               ← typed wrappers for /api/* calls
  public/
    index.html             ← Vite entry point
    404.html
  vite.config.ts
  tailwind.config.ts
  package.json
```

### Worker Changes (Option 1 proxy)

Add `FIREBASE_HOSTING_URL` var to `wrangler.toml`:
```toml
[env.staging.vars]
FIREBASE_HOSTING_URL = "https://oursharedevents-stg.web.app"
```

In `src/handlers/pages.ts`:
```ts
// Instead of returning embedded HTML, proxy to Firebase Hosting
const res = await fetch(`${env.FIREBASE_HOSTING_URL}${pathname}`);
return new Response(res.body, res);
```

---

## Recommended Sequence

If you pursue both tracks:

1. **Track B first** — move HTML out of Worker bundle (low risk, independent of auth)
2. **Track A second** — add Firebase Auth once frontend is on Firebase Hosting (SDK already available)

---

## Acceptance Criteria

### Track A
- [ ] Admin user can sign in with email/password via Firebase Auth
- [ ] Firebase ID token is verified by Worker on every `/api/v2/admin/*` call
- [ ] `ADMIN_KEY` / `CF_ACCESS_*` secrets can be removed
- [ ] Unauthenticated requests to admin API return 401

### Track B
- [ ] `firebase deploy` succeeds for staging project
- [ ] `https://stg.zeventbooks.io/` loads from Firebase Hosting (via Worker proxy)
- [ ] Worker bundle size reduced (no embedded HTML templates)
- [ ] API calls (`/api/*`) still served by Cloudflare Worker + D1
- [ ] React SPA: `EventPublicPage`, `EventDisplay`, `EventPoster` components render correctly
- [ ] Admin SPA: all 7 admin cards function via `/api/v2/admin/*`
- [ ] `event.brandConfig` from D1 applies theme (primaryColor, logo) to public + display pages
- [ ] Tailwind build produces no unused CSS (purge configured for `frontend/src/**`)
- [ ] Vite build artifact < 200KB gzipped for public page bundle
