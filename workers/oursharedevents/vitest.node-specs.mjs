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
  // OSE-1782 — derived gate: no count published except through count-floor.ts
  // (reads the projection's field list and the src/ tree; no runtime).
  'tests/count-floor-publication.derived.spec.ts',
  // OSE-1751 — the report's corridor baseline is one chain, shared with the export
  'tests/corridor-baseline-publication.spec.ts',
  // OSE-1752 — the recap's walk-in line reads the same however it is withheld
  'tests/recap-stat-lines.spec.ts',
  'tests/event-price.spec.ts',
  // CCR-PR567 re-run item 8 — XSS lock over the pure /sponsor render (sponsor
  // name + placement fields). Imports the render module, no runtime.
  'tests/sponsor-home-xss.spec.ts',
  // Owner 2026-10-11: less text on the sponsor page (pure render + template).
  'tests/sponsor-home-less-text.spec.ts',
  // OSE-1900 — derived gate: every statement in src/ that carries the sponsor
  // consent rule also carries the event's opt-in gate (reads src/; no runtime).
  'tests/sponsor-opt-in-readers.spec.ts',
  // Toast adoption in admin and sponsor home: the pages' scripts and the
  // @ocr/ui toast script in jsdom, plus one handler called directly. No runtime.
  'tests/toast-adoption.spec.ts',
  'tests/event-phase.spec.ts',
  'tests/event-state.spec.ts',
  'tests/report-depth.spec.ts',
  // OSE-1266 — outcome preview: pure composition over report-depth + sponsor-allocation.
  'tests/sponsor-preview.spec.ts',
  // OSE-714 — read-handler enforcement-state guard for the depth filter. Mocks
  // the D1 builder + audit log and mints a real signed-link token, so it binds
  // no runtime (no cloudflare:test / SELF.fetch) and runs node-clean.
  'tests/shared-report-read-depth-wiring.spec.ts',
  // OSE-682 — the paid-report plan lookup fails closed. A fake D1 stands in.
  'tests/paid-report-plan-lookup.spec.ts',
  // OSE-682 — who × plan: pure plan module, plan read fails closed, sponsor home totals.
  'tests/report-plan.spec.ts',

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
  'tests/form-submit-once.spec.ts',
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
  'tests/withheld-counts-in-words.spec.ts',
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
  // OSE-1800 — the staging CI service actor (brand admin, never platform). Real RSA tokens, JWKS stubbed.
  'tests/red-team/ci-service-actor.spec.ts',

  // OSE-1278 slice 2 (G1 authZ mutation) — the behavioural kill loop over
  // src/auth/admin.ts (requireAdmin/extractAdminActor + the private helpers).
  // Node-clean: hand-built Requests/env + a stubbed fetch for the JWKS path;
  // Date faked with toFake:['Date'] only. Drives admin.ts mutation to break:95.
  'tests/red-team/auth-guard-mutation.spec.ts',
  'tests/admin-actor-memo.spec.ts',

  // Architecture review 2026-10-01 — per-request CF Access signature memo in
  // src/auth/admin.ts (one RSA pass per admin request). Node-clean: hand-built
  // Requests, stubbed JWKS fetch, a spy on crypto.subtle.verify. Kills the memo
  // mutants for Stryker; the route() wiring half stays in the workers pool
  // (tests/admin-jwt-verify-memo.spec.ts).
  'tests/red-team/auth-jwt-verify-memo.spec.ts',

  // OSE-1273 (G1 follow-on) — node-clean L2 crypto coverage for src/lib/pii.ts
  // (hashEmail/encryptEmail/decryptEmail), so Stryker mutation runs on the PII
  // guard off the workerd pool. Uses only crypto.subtle + TextEncoder (both
  // node-available); the workers-bound pii.spec.ts keeps its D1 L1 block.
  'tests/pii-crypto.spec.ts',

  // OSE-1312 slice 2 — landing area renderer. Pure function over the enriched
  // event shape; asserts the CSS-filter tags (window/type/product/modality) and
  // the default-view rule. No DOM / cloudflare:test / D1 — node-clean.
  'tests/landing-area.spec.ts',
  // OSE-1824 — the Type row by category: catalog read (fake D1), the landing
  // handler's use of it, the admin picker endpoint, edge + fat-finger renders.
  // Mocks the data provider and the catalog read; no cloudflare:test.
  'tests/landing-category-scenarios.spec.ts',
  'tests/attendee-map.spec.ts',
  // Street map under the hexagons — PMTiles reader, vector tile decoder and the
  // server-drawn layer over in-memory archives and a fake R2 bucket (no runtime).
  'tests/pmtiles.spec.ts',
  'tests/mvt.spec.ts',
  'tests/street-map.spec.ts',
  'tests/street-map-landing.spec.ts',
  'tests/map-zoom.spec.ts',
  'tests/map-place-links.spec.ts',
  // WHAT external link — event-page render fns emit the optional outbound link
  // on all three phases. Pure unit over renderPre/Live/PostEventHtml (no
  // cloudflare:test / D1); node-clean like the other pages.ts render specs.
  'tests/what-external-link.spec.ts',
  // OSE-1358 Add to calendar — pure Google-link builder (lib/calendar-links.ts)
  // and the <details> menu render over renderPre/LiveEventHtml. No cloudflare:test.
  'tests/calendar-links.spec.ts',
  'tests/calendar-action.spec.ts',
  // OSE-1760 — golden renders of the three phase pages in English and Spanish:
  // the language layer must change no byte. Pure over the exported renderers.
  'tests/language-layer-golden.spec.ts',
  // A Spanish event page, every phase and every optional part, shows no English
  // of ours (catalog values or common English words). Pure over the renderers.
  'tests/event-page-spanish.spec.ts',
  // OSE-1762 — /events and the landing: golden renders in English and Spanish,
  // and the Spanish render shows no English of ours. Pure over the handlers,
  // with the data provider replaced.
  'tests/list-landing-language-golden.spec.ts',
  'tests/list-landing-spanish.spec.ts',
  // OSE-1760 — the Accept-Language resolver and the string catalog. Pure, no runtime.
  'tests/i18n-resolve-language.spec.ts',
  'tests/i18n-catalog.spec.ts',
  'tests/i18n-path-prefix.spec.ts',
  // The header Language menu (owner 2026-11-10). Pure over the renderers.
  'tests/language-menu.spec.ts',
  'tests/language-menu-third-language.spec.ts',
  'tests/language-menu-close.spec.ts',
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
  // TV display pane rotation (ported from the GAS display's rotation engine):
  // the pure engine with fake timers + the display.html script run in jsdom
  // with a stubbed fetch; no cloudflare:test / D1.
  'tests/display-pane-rotation.spec.ts',
  // TV display settings (order, seconds per screen, league links) — pure over
  // lib/event-settings.ts.
  'tests/display-settings.spec.ts',
  'tests/log-never-who.spec.ts',
  // Admin TV display card — its script run in jsdom with a stubbed fetch.
  'tests/admin-tv-display-card.spec.ts',
  'tests/admin-card-order.spec.ts',
  // A stale status panel: Undo returns to where the server says the event was
  // (the events script run in jsdom against an in-memory status endpoint).
  'tests/admin-stale-panel-undo.spec.ts',
  'tests/event-screen-route-read.spec.ts',
  'tests/admin-wizard-step1.spec.ts',
  // Landing "where are you?" (2026-10-10): zip table, rough box, the location script's limits.
  'tests/landing-where-unit.spec.ts',
  // Search by town name first, then zip; one name can be many places (owner 2026-11-06).
  'tests/place-search.spec.ts',
  // The landing doors name their action in ?start= and the admin front door steps aside (owner, 2026-10-27).
  'tests/admin-start-param.spec.ts',
  'tests/admin-surface-links-not-live.spec.ts',
  // OSE-1560 - the map setting: wizard default, status panel control (jsdom + extracted helpers).
  'tests/admin-map-setting.spec.ts',
  // OSE-1900 - the sponsors switch in the sponsors card (jsdom + extracted helpers).
  'tests/admin-sponsors-switch.spec.ts',
  'tests/admin-create-core-values.spec.ts',
  'tests/admin-wizard-tv.spec.ts',
  'tests/admin-wizard-uniform.spec.ts',
  'tests/admin-wizard-preview-review.spec.ts',
  'tests/admin-wizard-what-and-missing.spec.ts',
  'tests/poster-preview-mode.spec.ts',
  // display-config ETag computed before QR generation (handler called directly,
  // stub DB, lib/qr mocked to count encoder calls).
  'tests/display-config-etag.spec.ts',
  // OSE-1357 part 2 — poster codes: pure rules (lib/poster-codes.ts) and the
  // admin card + /poster scripts run in jsdom with a stubbed fetch.
  'tests/poster-codes-parse.spec.ts',
  'tests/poster-multi-code-ui.spec.ts',
  // OSE-1516 - the poster layout rules (pure, extracted from poster.html) and the
  // page script in jsdom at 0..8 codes, with and without artwork.
  'tests/poster-layout.spec.ts',
  // OSE-1357 poster tiers — REGISTER/SPONSOR codes, venue vs community
  // placements and the pre-event Reach section, run in jsdom (stubbed fetch).
  'tests/poster-tiers-ui.spec.ts',
  // OSE-1316 / OSE-1317 — admin Create Sponsor form + /display side rail, run
  // in jsdom from the template Text imports with a stubbed fetch.
  'tests/sponsor-create-fields-ui.spec.ts',
  // 0082 — sponsor public card + OSE default image: admin image choice and the
  // /events sponsor banner, run in jsdom with a stubbed fetch.
  'tests/sponsor-public-card-ui.spec.ts',
  // SharedReport corridor map: mountCorridorSvg run in jsdom (CodeQL, PR #691).
  'tests/corridor-map-mount.spec.ts',
  // OSE-1410 follow-up — the five template findings the CodeQL gate reported:
  // poster-art + poster-deployment card scripts run in jsdom, the rest by script text.
  'tests/codeql-template-findings.spec.ts',
  // OSE-1360 / OSE-1361 — run the pure oseEventView / oseFormsSection blocks
  // extracted from the admin.html template string; no DOM / cloudflare:test.
  'tests/admin-event-status-phase-consistency.spec.ts',
  'tests/admin-organizer-inbox.spec.ts',
  'tests/admin-events-upcoming-cursor.spec.ts',
  'tests/public-projection-routing.spec.ts',
  'tests/admin-forms-single-row.spec.ts',
  'tests/event-form-link-writers.spec.ts',
  // OSE-1684 last rule: the route table keeps every event screen under /events/<id>/.
  'tests/event-address-route-table.spec.ts',

  // Scan write-buffer (Cloudflare Queues) — producer (enqueueOrWriteScan) +
  // consumer (handleScanBatch) tested in isolation with a fake D1 + fake Queue.
  // No cloudflare:test / SELF.fetch / D1 runtime — node-clean by construction.
  'tests/scan-buffer.spec.ts',
  // OSE-1347 deploy D1 canonical-shape verifier. Pure parser/diff/query-builder
  // tests over the migration SQL + fake D1 query runner; no cloudflare:test.
  'tests/d1-canonical-shape.spec.ts',
  // Owner 2026-10-11: nothing in FORMS_DB outlives 90 days (reads migration SQL + wrangler.toml).
  'tests/forms-retention-ceiling.spec.ts',
  // OSE-1313 event date+time+timezone → UTC. Pure Intl/Date math over
  // lib/event-datetime.ts (zone/DST/round-trip matrix); no cloudflare:test / DOM.
  'tests/event-datetime.spec.ts',
  'tests/spine-keys.spec.ts',
  'tests/spine-keys-writers.spec.ts',
  // OSE-474 pre-event countdown: pure text over lib/event-countdown.ts and its
  // browser tick run in jsdom with fake timers. No cloudflare:test.
  'tests/event-countdown.spec.ts',
  // OSE-1363 date-only off-by-one on the public listing. renderEventList over
  // lib/event-list.ts (imports only html-escape + inject-marker); node-clean.
  'tests/event-list.spec.ts',
  // OSE-1363 shared-report client-JS date formatters force UTC. Imports
  // shared-report.html as Text (node loader) and asserts the template source.
  'tests/shared-report-date-utc.spec.ts',
  // OSE-1531 — the report's action row + Repeat this event, run in jsdom over the
  // real template with a stubbed fetch. No cloudflare:test.
  'tests/shared-report-actions.spec.ts',
  // A public page's admin probe never follows the Access login redirect (T4 hang).
  'tests/public-page-admin-probe.spec.ts',
  // The Return Rate card when the API withholds the rate on its own: the same
  // jsdom-over-the-real-template shape as the spec above. No cloudflare:test.
  'tests/shared-report-return-rate-card.spec.ts',
  // Locked sections on a sponsor link: the real read handler (builder and audit
  // log replaced, as in shared-report-read-depth-wiring) feeds the real template
  // in jsdom. No cloudflare:test.
  'tests/shared-report-locked-sections.spec.ts',

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
  // OSE-1447 follow-up — rate-limit KV keys are HMAC under RATE_LIMIT_KEY_PEPPER.
  // Pure module + in-memory KV fake + node:fs source reads; no runtime.
  'tests/rate-limit-pepper.spec.ts',
  // Logs + Settings pages: each page's script run in jsdom with a stubbed fetch
  // (tabs, filters, honest empty/error states, text-only rendering).
  'tests/admin-logs-settings-ui.spec.ts',
  // Signed links leave the address bar: the /sponsor and /sharedReport page
  // scripts run in jsdom over the real templates with a stubbed fetch.
  'tests/signed-link-url-scrub.spec.ts',
  // The admin Shared Report Links panel: the page's own scripts run in jsdom as
  // classic scripts, with a stubbed fetch that answers the way the mint route does.
  'tests/admin-mint-report-link.spec.ts',
  // Owner 2026-10-11: copy registrants' emails (jsdom, the page's own scripts).
  'tests/admin-registrant-contacts.spec.ts',
  // Every name a template's inline script uses is declared where that script
  // can see it: the TypeScript checker over each template's scripts (node:fs).
  'tests/template-script-names.spec.ts',
  // Typed text on the SharedReport page stays text: the page script run in jsdom
  // with plain and hostile values, plus a parse of its attribute writes.
  'tests/shared-report-attribute-escaping.spec.ts',
  // The same for the poster page: the served page run in jsdom (print and
  // digital, with and without artwork, picker and draft preview), plus the same
  // parse of its attribute writes (tests/helpers/markup-attribute-check.ts).
  'tests/poster-attribute-escaping.spec.ts',
  // OSE-1825 - the digital poster's When / Where / Share block: the served
  // page in jsdom (address line, button actions, Web Share and its fallback).
  'tests/poster-digital-actions.spec.ts',
  // OSE-1826 - the digital poster's sponsor header block: the served page in
  // jsdom (header image through the proxy, text, fallback, print row).
  'tests/poster-sponsor-header.spec.ts',
  // OSE-1441 - the /poster picker drops a late bundle answer for the event it
  // left: the page script in jsdom with one answer held back.
  'tests/poster-picker-stale-response.spec.ts',
  // F5.3 — the form page's confirmation: handleFormPage called directly with a
  // stub DB, its scripts run in jsdom with a stubbed fetch; no cloudflare:test.
  'tests/form-next-step-dom.spec.ts',
  // Form pages, less text (owner 2026-10-11): the same jsdom render as above.
  'tests/form-pages-less-text.spec.ts',
  // The error label a log line may carry: a pure function, no runtime.
  'tests/error-label.spec.ts',
];
