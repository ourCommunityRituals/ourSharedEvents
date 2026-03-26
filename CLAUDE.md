# CLAUDE.md — ourSharedEvents

## Project overview

ourSharedEvents is the core events platform under the ourCommunityRituals ecosystem. It serves public event listings, admin dashboards, and a JSON API. The platform is migrating from Google Apps Script + Sheets to Cloudflare Workers + D1.

## Tech stack

- **Runtime:** Cloudflare Workers (TypeScript), Google Apps Script (legacy)
- **Data:** Google Sheets (Phase 1) → Cloudflare D1 (Phase 2)
- **Frontend:** Embedded HTML templates (Phase 1) → React + Tailwind on Firebase Hosting (Phase 3)
- **CI/CD:** GitHub Actions → Wrangler deploy
- **Testing:** Jest (unit/contract), Playwright (E2E/API), k6 (load)

## Key directories

- `src/mvp/` — Google Apps Script source (HTML, JS)
- `cloudflare-proxy/` — Cloudflare Worker code (router, middleware)
- `workers/oursharedevents/` — New Worker source (Phase 1 build)
- `tests/` — All tests: `unit/`, `contract/`, `e2e/`, `integration/`
- `schemas/` — JSON schemas for events and analytics
- `docs/` — Architecture docs, migration plans
- `archive/` — Legacy code

## Environments

- **Staging:** `stg.oursharedevents.com`
- **Production:** `oursharedevents.com`
- Env vars prefixed `STAGING_*` / `PROD_*`

## Testing

```bash
npm test              # Unit tests (Jest)
npm run test:contract # Contract tests
npm run test:e2e      # E2E tests (Playwright)
```

Tests are organized by story ID (e.g., Story 1.1, Story 2.3).

## Project tracking

- **Stories:** `STORIES.md` — single source of truth for all work
- **Linear:** Team `OUR` (OurSharedEvents) — see `.claude/sync/LINEAR-MAP.md` for story ↔ issue mapping
- **Phases:** P1 Build (done) → P1 Ops (current) → P2 D1 Database → P3 Firebase

## Conventions

- Commit messages include story ID: `feat: add health endpoint (P1-1)`
- API endpoints under `/api/v2/`
- Admin routes require Bearer token auth (Phase 1) → Firebase Auth (Phase 3)
- Keep Worker bundle lean — HTML templates will move to Firebase Hosting CDN

## Key docs

- `E2E-LAUNCH.md` — Step-by-step launch checklist
- `API_CONTRACT.md` — API contracts and endpoints
- `DEPLOYMENT.md` — Deployment strategy
- `openapi.yaml` — OpenAPI spec
