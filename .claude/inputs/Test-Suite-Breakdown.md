npm run test:e2e # all 79
npm run test:smoke # 1-smoke/ only
npm run test:pages # 2-pages/ only
npm run test:flows # 3-flows/ only
npm run test:negative # 4-negative/ only
npm run test:scenarios # scenarios/ only

● That's already the case. The CI pipeline only runs:

- Security Gate: Vitest (50 files, local)
- Quality Smoke: security-smoke.spec.js + sec-iac-07-smoke.spec.ts (2 files, live)
- Functional Smoke: test:api:smoke + test:ui:smoke (36 files, live)

Test Suite Breakdown

Vitest (runs locally, no deployment needed) — 50 files, 2182 tests

┌──────────────────────┬───────┬───────┬─────────┬─────────┬───────────────────────────────────────────────────────────────────────────────┐
│ Category │ Files │ Tests │ Passing │ Skipped │ What They Test │
├──────────────────────┼───────┼───────┼─────────┼─────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Mock Unit │ 22 │ ~680 │ 680 │ 0 │ Mocked behavior: XSS, validation, forms, sponsors, templates, privacy, config │
├──────────────────────┼───────┼───────┼─────────┼─────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Mock Contract │ 18 │ ~780 │ 780 │ 0 │ API shape contracts, schema validation, envelope format, bundle structure │
├──────────────────────┼───────┼───────┼─────────┼─────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Source-Reading (IAC) │ 7 │ ~400 │ 95 │ 305 │ Read source files, assert security patterns exist (3 files @planned skipped) │
├──────────────────────┼───────┼───────┼─────────┼─────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Integration │ 3 │ ~130 │ 130 │ 0 │ Schema validation, analytics, concurrency │
└──────────────────────┴───────┴───────┴─────────┴─────────┴───────────────────────────────────────────────────────────────────────────────┘

Playwright — Live API (needs deployed staging/prod) — 26 files

┌─────────────────────────────────┬────────────────────────────────────────┐
│ File │ What It Tests │
├─────────────────────────────────┼────────────────────────────────────────┤
│ api-health.spec.ts │ Health endpoint responds 200 │
├─────────────────────────────────┼────────────────────────────────────────┤
│ status.spec.ts │ Status endpoint contract │
├─────────────────────────────────┼────────────────────────────────────────┤
│ events-v2.spec.ts │ Events list/get API │
├─────────────────────────────────┼────────────────────────────────────────┤
│ events.spec.ts │ Legacy events endpoint │
├─────────────────────────────────┼────────────────────────────────────────┤
│ bundles.spec.ts │ Public/display/poster bundle endpoints │
├─────────────────────────────────┼────────────────────────────────────────┤
│ brand-routing.spec.ts │ Multi-brand URL routing │
├─────────────────────────────────┼────────────────────────────────────────┤
│ whoami.spec.ts │ Auth identity endpoint │
├─────────────────────────────────┼────────────────────────────────────────┤
│ env-alignment.spec.ts │ Staging/prod env parity │
├─────────────────────────────────┼────────────────────────────────────────┤
│ fail-fast-gates.spec.ts │ Critical path gates │
├─────────────────────────────────┼────────────────────────────────────────┤
│ sec-iac-07-smoke.spec.ts │ Security: 401/403/404 enforcement │
├─────────────────────────────────┼────────────────────────────────────────┤
│ prod-sanity.spec.ts │ Production post-deploy sanity │
├─────────────────────────────────┼────────────────────────────────────────┤
│ stage2-critical-smoke.spec.ts │ Stage 2 critical checks │
├─────────────────────────────────┼────────────────────────────────────────┤
│ staging-data-validation.spec.ts │ Staging data integrity │
├─────────────────────────────────┼────────────────────────────────────────┤
│ story\*.spec.ts (8 files) │ Story-specific API acceptance │
├─────────────────────────────────┼────────────────────────────────────────┤
│ qr.spec.ts │ QR code endpoint │
├─────────────────────────────────┼────────────────────────────────────────┤
│ sharedreport.spec.ts │ SharedReport API │
└─────────────────────────────────┴────────────────────────────────────────┘

Playwright — Live Frontend (needs deployed staging/prod) — 10 files

┌──────────────────────────────────────┬────────────────────────────────────┐
│ File │ What It Tests │
├──────────────────────────────────────┼────────────────────────────────────┤
│ admin.smoke.spec.ts │ Admin surface loads, cards visible │
├──────────────────────────────────────┼────────────────────────────────────┤
│ public.smoke.spec.ts │ Public events page renders │
├──────────────────────────────────────┼────────────────────────────────────┤
│ display.smoke.spec.ts │ TV/kiosk display renders │
├──────────────────────────────────────┼────────────────────────────────────┤
│ poster.smoke.spec.ts │ Poster with QR codes renders │
├──────────────────────────────────────┼────────────────────────────────────┤
│ sharedreport.smoke.spec.ts │ Analytics dashboard renders │
├──────────────────────────────────────┼────────────────────────────────────┤
│ events.smoke.spec.ts │ Events management surface │
├──────────────────────────────────────┼────────────────────────────────────┤
│ manage.smoke.spec.ts │ Admin management surface │
├──────────────────────────────────────┼────────────────────────────────────┤
│ comprehensive-surfaces.smoke.spec.ts │ All 5 MVP surfaces in one run │
├──────────────────────────────────────┼────────────────────────────────────┤
│ admin-diagnostics.smoke.spec.ts │ Admin diagnostics panel │
├──────────────────────────────────────┼────────────────────────────────────┤
│ story-e3-error-states.smoke.spec.ts │ Error state UI handling │
└──────────────────────────────────────┴────────────────────────────────────┘

Playwright — E2E (needs deployed staging/prod) — 79 files

┌─────────────┬───────┬───────────────────────────────────────────────────────────────────────┐
│ Category │ Files │ What They Test │
├─────────────┼───────┼───────────────────────────────────────────────────────────────────────┤
│ 1-smoke/ │ 13 │ Surface loads, security smoke, brand branding, coverage matrix │
├─────────────┼───────┼───────────────────────────────────────────────────────────────────────┤
│ 2-pages/ │ 10 │ Page-level: admin, display, poster, public, sponsor, shared report │
├─────────────┼───────┼───────────────────────────────────────────────────────────────────────┤
│ 3-flows/ │ 14 │ User journeys: admin flows, sponsor flows, forms, shared reporting │
├─────────────┼───────┼───────────────────────────────────────────────────────────────────────┤
│ 4-negative/ │ 10 │ Negative paths: errors, missing data, network failures, worker errors │
├─────────────┼───────┼───────────────────────────────────────────────────────────────────────┤
│ api/ │ 7 │ CRUD operations: events, sponsors, system, portfolio analytics │
├─────────────┼───────┼───────────────────────────────────────────────────────────────────────┤
│ scenarios/ │ 4 │ Real-world scenarios: first-time admin, mobile user, TV display │
├─────────────┼───────┼───────────────────────────────────────────────────────────────────────┤
│ qa-routes/ │ 5 │ QA route chains: analytics, sponsor, poster print, offline │
├─────────────┼───────┼───────────────────────────────────────────────────────────────────────┤
│ Misc │ 16 │ Auth, accessibility, mobile perf, admin polish, diagnostics │
└─────────────┴───────┴───────────────────────────────────────────────────────────────────────┘

Summary Table

┌──────────────────────┬────────────┬───────┬────────────────────┬───────────────┐
│ Layer │ Framework │ Files │ Tests │ Needs Deploy? │
├──────────────────────┼────────────┼───────┼────────────────────┼───────────────┤
│ Mock Unit │ Vitest │ 22 │ ~680 │ No │
├──────────────────────┼────────────┼───────┼────────────────────┼───────────────┤
│ Mock Contract │ Vitest │ 18 │ ~780 │ No │
├──────────────────────┼────────────┼───────┼────────────────────┼───────────────┤
│ Source-Reading (IAC) │ Vitest │ 7 │ ~400 (305 skipped) │ No │
├──────────────────────┼────────────┼───────┼────────────────────┼───────────────┤
│ Live API Smoke │ Playwright │ 26 │ ~200+ │ Yes (staging) │
├──────────────────────┼────────────┼───────┼────────────────────┼───────────────┤
│ Live UI Smoke │ Playwright │ 10 │ ~80+ │ Yes (staging) │
├──────────────────────┼────────────┼───────┼────────────────────┼───────────────┤
│ Live E2E │ Playwright │ 79 │ ~500+ │ Yes (staging) │
├──────────────────────┼────────────┼───────┼────────────────────┼───────────────┤
│ Total │ — │ 162 │ ~2600+ │ — │
└──────────────────────┴────────────┴───────┴────────────────────┴───────────────┘

The CI pipeline runs Vitest (all 50 files) in the Security Gate, then Live API + UI Smoke (36 files) post-deploy. The 79 E2E files are available for manual/staging runs but not wired into CI yet — that's a
future test pyramid story.
