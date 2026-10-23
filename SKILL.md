# SKILL.md — OurSharedEvents (OSE)

Skills for working in the OurSharedEvents repo.

---

## Product identity

| Field             | Value                                                    |
| ----------------- | -------------------------------------------------------- |
| Code              | OSE                                                      |
| Full name         | OurSharedEvents                                          |
| Type              | Core platform — event infrastructure, API, admin         |
| Stack             | Cloudflare Workers, Wrangler, D1 (edge SQLite)           |
| Hosting           | Firebase Hosting (Phase 3)                               |
| CI/CD             | GitHub Actions (5-stage pipeline, staging + prod)        |
| Observability     | Datadog (synthetic tests, dashboards — planned)          |
| Working directory | `C:\Users\mzdan\dev\ourCommunityRituals\ourSharedEvents` |
| Domain            | oursharedevents.com                                      |
| Data model        | Anonymous ID architecture — no PII in database           |

---

## Skill: CCR MVP Audit

### When to Use

User says: "ccr", "ccr audit", "ccr mvp", "run ccr", "production readiness", "pressure test"

### Steps

1. Read `.claude/skills/ccr-mvp.md` for full CCR-gated sprint story protocol
2. Follow the 7-step process: Chunk → Batch → Chain → Cache → CCR Process Gate → CCR Impact Gate → Discipline Pass → Human Approval → Commit

---

## Skill: Story Implementation

### When to Use

User says: "next story", "implement", "start story", "pick up"

### Steps

1. Read `CLAUDE.md` for full project context and role POVs
2. Read `STORIES.md` for current sprint state and find next unstarted story
3. Respect prerequisites — do not skip ahead
4. Implement complete solution satisfying all 6 role POVs:
   - Worker route code
   - Tests (Vitest + Playwright)
   - D1 migrations (if applicable)
5. Create PR — CI runs automatically
6. Update `STORIES.md` — mark IN PROGRESS

---

## Skill: Frontend Surface Audit

### When to Use

User says: "frontend audit", "surface audit", "ui check", "admin audit", "kaizen"

### Steps

1. Read `CLAUDE.md` for the 5 MVP surfaces
2. For each surface (admin, public, display, poster, sharedReport, doc, config):
   - Check current state of HTML
   - Catalog inline styles, test-ID coverage, breakpoint direction
   - Check touch targets (44px+), color token adoption, mobile-first compliance
3. Report per-surface findings with Kaizen improvement priorities

---

## Skill: API Smoke Test

### When to Use

User says: "smoke test", "api test", "health check", "endpoint check"

### Steps

1. Read `CLAUDE.md` for API contract
2. Run health check: `GET /health`
3. Run public endpoints: `GET /api/v2/events`, `GET /`
4. Run admin endpoints (with Bearer token): `GET /admin`, `GET /api/v2/admin/events`
5. Report pass/fail per endpoint

---

## Skill: D1 Migration

### When to Use

User says: "migration", "d1", "schema", "database"

### Steps

1. Read existing migrations in `workers/oursharedevents/migrations/`
2. Create new migration file with next sequence number
3. Write SQL — D1 is SQLite, not Postgres
4. Test with `wrangler d1 migrations apply`
5. Update schema verification tests

---

## Skill: Feature Flag Management

### When to Use

User says: "feature flag", "flag", "tier", "free tier", "enterprise"

### Steps

1. Read `workers/oursharedevents/src/lib/feature-flags.ts` for current flag logic
2. Read `workers/oursharedevents/src/handlers/feature-flags.ts` for admin endpoints
3. 3-tier model: Free (default) → Mid (global overrides) → Enterprise (event-level overrides)
4. Implement flag changes respecting the tier hierarchy
5. Test flag resolution across all tiers

---

## Cross-product references

| Product                | Integration point                                                        |
| ---------------------- | ------------------------------------------------------------------------ |
| OW (OurWKRP)           | Separate data model — named identity. Privacy boundary is architectural. |
| OSG (OurSharedGames)   | Game events created and tracked through OSE                              |
| OSR (OurSharedRecords) | Archive records link to OSE event IDs                                    |
| OSP (OurSharedPulse)   | Onboarded programs migrate to OSE-managed events                         |
| OSM (OurSharedMagnets) | Postman collections mirror OSE API routes                                |
| OA (OurAirwaves)       | OSE is the source that OA forks for white label clients                  |
| OER (OurEventRings)    | OSE event data feeds BigQuery → RAG analytics                            |

Vision lives in OCR-docs `docs/OCR_VISION.md` only.

---

_Derived from OCR-docs/docs/OCR_VISION.md_
_Last updated: April 5 2026_
_Owner: Matt_
_Status: ACTIVE_
