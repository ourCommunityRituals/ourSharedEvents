// ─────────────────────────────────────────────────────────────────────────────
// vitest.node-specs.mjs — the single source of truth for which worker specs run
// in the NODE project (OSE-946). The node project INCLUDES this list; the
// workers project EXCLUDES it. One list, imported by both configs, guarantees
// every spec runs in exactly one project — no double-run, no silent drop.
//
// MIGRATION DISCIPLINE (OSE-946 child 3, see docs/testing/vitest-pool-triage.md):
// specs move here ONE assertion-reviewed batch at a time, derived from the triage
// manifest's node-clean bucket and RUN GREEN in the node project before landing.
// Never add by name/intuition and never widen to a glob — a spec that only looks
// portable file-level can still bind to the runtime and go green while no longer
// testing what it was written for (`tier-equity-sort.spec.ts` reads as pure sort
// logic but seeds D1 + hits SELF.fetch; the manifest correctly buckets it
// workerd and a node run fails at its `cloudflare:test` import).
// ─────────────────────────────────────────────────────────────────────────────
export const NODE_SPECS = [
  // Batch 1 — pure-logic units (import a src/ module, assert its output; no DOM,
  // no axe, no cloudflare:test, no fs). Proven green in the node project.
  'tests/count-floor.spec.ts',
  'tests/event-price.spec.ts',
  // CCR-PR567 re-run item 8 — XSS lock over the pure /sponsor render (sponsor
  // name + placement fields). Imports the render module, no runtime.
  'tests/sponsor-home-xss.spec.ts',
  'tests/event-phase.spec.ts',
  'tests/event-state.spec.ts',
  'tests/report-depth.spec.ts',
  // OSE-1266 — outcome preview: pure composition over report-depth + sponsor-allocation.
  'tests/sponsor-preview.spec.ts',
  // OSE-714 — read-handler enforcement-state guard for the depth filter. Mocks
  // the D1 builder + audit log and mints a real signed-link token, so it binds
  // no runtime (no cloudflare:test / SELF.fetch) and runs node-clean.
  'tests/shared-report-read-depth-wiring.spec.ts',

  // Batch 2 (OSE-946 c3) — manifest node-clean bucket, then GREEN-FILTERED in the
  // node project: added all 43 non-review node candidates, ran the node project,
  // kept the 27 that passed. Of the 16 then excluded, 11 were only blocked by the
  // `.html` transform and moved here in Batch 3 once the loader landed. The 5 that
  // remain in the workers pool: `uec-fixtures-example` (transitive `cloudflare:test`
  // via helpers/uec) and the four that need a real DOM — `a11y-axe`, `keyboard-nav`,
  // `as-keyboard-nav`, `screen-reader` (axe/document); a jsdom batch is a follow-up.
  'tests/admin-brand-scope.spec.ts',
  'tests/admin-servicetoken-fallthrough.spec.ts',
  'tests/codeql-src-findings.spec.ts',
  'tests/corridor-map.spec.ts',
  'tests/demo-ci-gate.spec.ts',
  'tests/demo-registry.spec.ts',
  'tests/demo-site.spec.ts',
  'tests/dev-open-admin-guard.spec.ts',
  'tests/fat-finger.property.spec.ts',
  'tests/forbidden-join-boundary.spec.ts',
  'tests/form-page-email-signup-dispatch.spec.ts',
  'tests/form-sponsor-ui.spec.ts',
  'tests/forms-pepper-preflight.spec.ts',
  'tests/geo-link-maps-not-h3.spec.ts',
  'tests/geo.spec.ts',
  'tests/ncr-pipeline.spec.ts',
  'tests/ops/payment-links-guard.spec.ts',
  'tests/phase-cache.spec.ts',
  'tests/riph-brain-conformance.spec.ts',
  'tests/riph-demo-dataset.spec.ts',
  'tests/schema-guard.spec.ts',
  'tests/shared-report-auth.spec.ts',
  'tests/signed-link-token-forgery.spec.ts',
  'tests/sponsor-frequency-rotation.spec.ts',
  'tests/sponsor-logo.spec.ts',
  'tests/sponsor-share-covenant.spec.ts',
  'tests/sponsor-share-rotation.spec.ts',
  'tests/uec-module.spec.ts',

  // Batch 3 (OSE-946 c3) — unlocked by the `.html`-as-Text loader added to
  // vitest.node.config.mts. These transitively import src/handlers/pages.ts (via
  // the router), which does `import PUBLIC_HTML from '../templates/public.html'`;
  // they never touched the runtime, they just couldn't transform the template in
  // node. Green-filtered in the node project like batch 2.
  'tests/advanced-metrics.spec.ts',
  'tests/as-display-public-admin.spec.ts',
  'tests/briefing.spec.ts',
  'tests/color-contrast.spec.ts',
  'tests/demo-banner.spec.ts',
  'tests/pdf-export.spec.ts',
  'tests/poster-mobile-workability.spec.ts',
  'tests/poster-spon4-as2-spon10.spec.ts',
  'tests/poster-sponsor.spec.ts',
  'tests/poster-tier-css-ose219.spec.ts',
  'tests/shared-report-mobile-workability.spec.ts',

  // OSE-1263 (OSE-217 slice) — net-new L1 authored node-clean: maps.ts binds no
  // D1/SELF (only fetch/Response/URLSearchParams), so it runs in the node project
  // and stubs `fetch` for the upstream branches. Proven green in the node project.
  'tests/maps.spec.ts',

  // OSE-1186 G4 — net-new negative-auth specs. Call requireAdmin() directly with
  // hand-built Requests/env; no cloudflare:test, no SELF.fetch, no D1 (the
  // fail-closed path takes no JWKS fetch), so they run node-clean like the
  // sibling admin-servicetoken-fallthrough / signed-link-token-forgery specs.
  // Green-filtered in the node project before landing.
  'tests/red-team/auth-env-gating.spec.ts',
  'tests/red-team/auth-jwt-fuzz.property.spec.ts',

  // OSE-1278 (G1 follow-on) — node-clean coverage for the CF Access JWT signature
  // path (verifyCfAccessJWT/_fetchJwks/_getJwks): generates an RSA keypair, signs
  // a JWT, stubs fetch to serve the JWKS. Re-imports admin.ts per test to reset the
  // module-level JWKS cache. No cloudflare:test/D1 — runs node-clean for Stryker.
  'tests/red-team/auth-jwks-verify.spec.ts',

  // OSE-1278 slice 2 (G1 authZ mutation) — the behavioural kill loop over
  // src/auth/admin.ts (requireAdmin/extractAdminActor + the private helpers).
  // Node-clean: hand-built Requests/env + a stubbed fetch for the JWKS path;
  // Date faked with toFake:['Date'] only. Drives admin.ts mutation to break:95.
  'tests/red-team/auth-guard-mutation.spec.ts',

  // OSE-1273 (G1 follow-on) — node-clean L2 crypto coverage for src/lib/pii.ts
  // (hashEmail/encryptEmail/decryptEmail), so Stryker mutation runs on the PII
  // guard off the workerd pool. Uses only crypto.subtle + TextEncoder (both
  // node-available); the workers-bound pii.spec.ts keeps its D1 L1 block.
  'tests/pii-crypto.spec.ts',

  // OSE-1312 slice 2 — landing area renderer. Pure function over the enriched
  // event shape; asserts the CSS-filter tags (window/type/product/modality) and
  // the default-view rule. No DOM / cloudflare:test / D1 — node-clean.
  'tests/landing-area.spec.ts',
  // WHAT external link — event-page render fns emit the optional outbound link
  // on all three phases. Pure unit over renderPre/Live/PostEventHtml (no
  // cloudflare:test / D1); node-clean like the other pages.ts render specs.
  'tests/what-external-link.spec.ts',
  // OSE-1358 Add to calendar — pure Google-link builder (lib/calendar-links.ts)
  // and the <details> menu render over renderPre/LiveEventHtml. No cloudflare:test.
  'tests/calendar-links.spec.ts',
  'tests/calendar-action.spec.ts',
  // H1 (CCR-PR567) — marker-injection $-splice guard. Pure over the exported
  // inject* functions + the injectMarker helper (no DOM / cloudflare:test / D1).
  'tests/inject-marker.spec.ts',
  // M1 (CCR-PR567) — admin sponsor aria-label attribute escaping. Imports the
  // admin.html template as Text and asserts the client-JS escaper shape.
  'tests/admin-sponsor-attr-escape.spec.ts',
  // L1 (CCR-PR567) — admin go-live transitions honour VALID_TRANSITIONS
  // (archived->active is direct; only draft hops via ready). Pure over the
  // admin.html template string + the event-state domain module.
  'tests/admin-golive-transitions.spec.ts',
  // OSE-1357 — admin poster card (address default, geocode-then-create, row
  // order). Runs the card's script from the admin.html Text import in a jsdom
  // window with a stubbed fetch; no cloudflare:test / D1.
  'tests/poster-deployment-address-ui.spec.ts',
  // OSE-1357 part 2 — poster codes: pure rules (lib/poster-codes.ts) and the
  // admin card + /poster scripts run in jsdom with a stubbed fetch.
  'tests/poster-codes-parse.spec.ts',
  'tests/poster-multi-code-ui.spec.ts',
  // OSE-1316 / OSE-1317 — admin Create Sponsor form + /display side rail, run
  // in jsdom from the template Text imports with a stubbed fetch.
  'tests/sponsor-create-fields-ui.spec.ts',
  // SharedReport corridor map: mountCorridorSvg run in jsdom (CodeQL, PR #691).
  'tests/corridor-map-mount.spec.ts',
  // OSE-1410 follow-up — the five template findings the CodeQL gate reported:
  // poster-art + poster-deployment card scripts run in jsdom, the rest by script text.
  'tests/codeql-template-findings.spec.ts',
  // OSE-1360 / OSE-1361 — run the pure oseEventView / oseFormsSection blocks
  // extracted from the admin.html template string; no DOM / cloudflare:test.
  'tests/admin-event-status-phase-consistency.spec.ts',
  'tests/admin-forms-single-row.spec.ts',

  // Scan write-buffer (Cloudflare Queues) — producer (enqueueOrWriteScan) +
  // consumer (handleScanBatch) tested in isolation with a fake D1 + fake Queue.
  // No cloudflare:test / SELF.fetch / D1 runtime — node-clean by construction.
  'tests/scan-buffer.spec.ts',
  // OSE-1347 deploy D1 canonical-shape verifier. Pure parser/diff/query-builder
  // tests over the migration SQL + fake D1 query runner; no cloudflare:test.
  'tests/d1-canonical-shape.spec.ts',
  // OSE-1313 event date+time+timezone → UTC. Pure Intl/Date math over
  // lib/event-datetime.ts (zone/DST/round-trip matrix); no cloudflare:test / DOM.
  'tests/event-datetime.spec.ts',
  // OSE-1363 date-only off-by-one on the public listing. renderEventList over
  // lib/event-list.ts (imports only html-escape + inject-marker); node-clean.
  'tests/event-list.spec.ts',
  // OSE-1363 shared-report client-JS date formatters force UTC. Imports
  // shared-report.html as Text (node loader) and asserts the template source.
  'tests/shared-report-date-utc.spec.ts',

  // OSE-1390 mint-link sub-day TTL. Pure resolveMintTtlSeconds over lib/mint-ttl.ts;
  // no cloudflare:test / DOM. Born-red per floor/ceiling/both-provided clauses.
  'tests/mint-ttl.spec.ts',

  // L4 Turnstile-dark (OSE-1378) — pure lib guardTurnstile over a stubbed global
  // fetch; no cloudflare:test / SELF.fetch / D1. Born-red per guard clause. Node-clean.
  'tests/turnstile.spec.ts',
  // L4 Slice 2 — client render helpers + handleFormPage widget/CSP wiring. Pure
  // render over a fake env (no DB / cloudflare:test). Node-clean.
  'tests/turnstile-render.spec.ts',

  // L7 observability (OSE-1380) — Cloudflare GraphQL Analytics baseline tool. Pure
  // query/aggregate/never-who fns imported from the .mjs script; no network / D1.
  'tests/observability-cf-analytics.spec.ts',
  // L7 observability (OSE-1380) — runbook↔code drift guard: every structured-log
  // tag OBSERVABILITY.md tells operators to consume must be emitted by src/.
  // Reads files via node:fs (like d1-canonical-shape); node-clean, no runtime.
  'tests/observability-runbook-tags.spec.ts',
];
