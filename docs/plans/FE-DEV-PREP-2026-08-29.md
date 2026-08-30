# OSE Front-End Dev-Prep & Consolidated Test Matrix

**Date:** 2026-08-29 · **Status:** Ratified (Phase A in progress) · **Owner:** PO (Matt)
**Decision:** Two paths, one admin — a new guided **wizard** path is built as a real
native-JS surface for first-timers; the existing dashboard becomes the **advanced** path.
Both are covered by ONE parameterized E2E matrix.

---

## 0. Framing

The repo is already in the target stack: native JS, no React, no Tailwind, vanilla
design tokens (`@ocr/ui`), Worker-served HTML templates, live staging + D1 + demo
harness. This plan is therefore **consolidation + one new wizard surface + a clarity
pass** — not a greenfield build.

Constraints honored throughout (doctrine, non-negotiable):

- **Runtime stays LLM-free** (COST-101) — everything here is deterministic FE + tests.
- **`is_local` (geo) ⟂ `tier` (pricing)** — asserted independently in every matrix cell.
- **Honesty lexicon** — on-screen copy says "display", never "impressions".
- **Provenance self-declaration** — demo/mock data structurally declares itself.
- **K-anon / reporting floors** hold on every sponsor-facing readout.

### Tier vocabulary (do NOT invent a fourth)

Three tier vocabularies exist in code; `src/handlers/demo.ts` is the ONLY translation
point. The matrix uses the same mapping:

| Matrix name (this doc) | Flag tier (`getFlagsForTier`) | Report depth (`report-depth.ts`) | Demo slug |
| ---------------------- | ----------------------------- | -------------------------------- | --------- |
| **local**              | `free`                        | `local`                          | `free`    |
| **mid**                | `mid`                         | `mid`                            | `mid`     |
| **enterprise**         | `enterprise`                  | `premium`                        | `premium` |

---

## 1. The consolidated test matrix (core deliverable)

**Key insight:** `scenario` (wizard | advanced) is the _admin creation path_;
`tier` parameterizes what the other three screens must render. One parameterized
journey — not 4×2×3 hand-written specs.

| Screen                  | wizard × local                                | wizard × mid                   | advanced × local             | advanced × mid       | advanced × enterprise                  |
| ----------------------- | --------------------------------------------- | ------------------------------ | ---------------------------- | -------------------- | -------------------------------------- |
| **Admin** (create path) | guided steps, plain language, free-tier gates | guided + mid features unlocked | full dashboard, all controls | + survey/email forms | + enterprise features                  |
| **Sponsor card/page**   | local sponsor (`is_local` badge)              | mid sponsor                    | local                        | mid                  | enterprise (branding may vary per #25) |
| **Public page**         | event + local sponsor block                   | + mid features                 | local                        | mid                  | enterprise                             |
| **Display page**        | sponsor overlay, local                        | mid overlay                    | local                        | mid                  | enterprise carousel                    |

**Applicability rules:**

- **wizard × enterprise is out of scope by design** — enterprise is provisioned
  (OA layer), never self-serve through a first-timer wizard.
- Every cell asserts `is_local` independently of tier (covenant floor).

**Spec home:** `tests/e2e/3-flows/sponsor-lifecycle.matrix.spec.ts`
**Fixture home:** `tests/e2e/fixtures/scenario-tier-matrix.ts` (mirrors `demo.ts` mapping).

Each journey: reset via demo harness → create through the chosen path → assert the
SAME sponsor truth on card → public → display (reconciled-pyramid: layers corroborate
one truth; never mask a cross-layer disagreement to go green).

---

## 2. FE dev-prep standards (2026 targets)

| Concern             | Target                                                                                                                    | Where                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Componentization    | Repeated UI blocks become `@ocr/ui` partials (sponsor card, tier badge, wizard step, empty/error states)                  | `packages/ui/src/partials.ts`                        |
| Design tokenization | Kill the 345 admin inline styles; all styling via CSS-var tokens                                                          | `packages/ui/src/tokens.ts`                          |
| Test-id grammar     | `screen-region-element`, kebab, ≥3 chars; raise display/poster/public toward admin parity; extend the existing drift gate | `scripts/lint-testids.js` + baseline                 |
| Performance         | Skeleton/prefetch on data screens; polling ≤10s hard ceiling (longer = defect); edge-cache template shells                | templates + `web/shared/apiClient.js`                |
| First-read clarity  | No technical terms on screen; one vocabulary per persona; never reuse a word across axes                                  | driven by `docs/audits/FRONTEND_AUDIT_2025-11-23.md` |
| Test pyramid        | Touched code gets its rung (L0→L6); push assertions earlier (impossible-by-construction) before adding E2E                | `tests/` tree                                        |

---

## 3. Build phases (queue — one active at a time)

- **Phase A — Consolidation harness** _(this branch)_: scenario×tier fixture +
  parameterized matrix spec, **born-red observed** for wizard cells.
- **Phase B — Wizard surface** _(SHIPPED 2026-08-29)_: guided native-JS admin path
  in `admin.html`; dashboard stays as "advanced". Wizard + advanced admin-path
  cells green on chromium AND mobile (15/20 matrix; the 5 remaining reds are the
  Phase C sponsor-card testids, observed-red by design).
  **Adopted the archived wizard's existing testid contract** already in the drift
  baseline (`launch-wizard`, `wizard-step-1..5`, `wizard-event-name/date/venue`,
  `wizard-next-btn`, `wizard-finish-btn`, `wizard-link-*`) — the contract predates
  this plan; no parallel names (one vocabulary per axis). Baseline pruned 66→51
  (those 15 are now emitted for real).
  Phase B build notes:
  - Uses ONLY existing APIs: `POST /api/v2/admin/events` (same endpoint as the
    dashboard form) + `GET /api/v2/events/:id/poster-bundle` (QR data URIs).
    Template step = deterministic prefill of the existing 5W fields; sign-ups
    step offers only what truly exists (built-in form page | none) — no
    pretend-saved external URLs (honesty/provenance doctrine).
  - The S08 GAS-era contract (`admin-wizard-flow.spec.js`) never ran (`.js` not
    matched by `playwright.e2e.config.ts`); its essentials are ported to a LIVE
    spec: `tests/e2e/3-flows/admin-wizard-journey.spec.ts` (5-step journey,
    validation gate, back-nav preserves input, skip path, links+QR render).
  - **Deviation:** `@ocr/ui` wizard-step partial extraction deferred to Phase C
    (templates are static HTML today; extraction belongs with tokenization).
  - **Finding (ticket-worthy):** the admin page's nonce CSP (`pages.ts`) blocks
    inline `onclick=` attributes — the wizard uses `addEventListener` only, but
    admin.html has MANY pre-existing inline `onclick=` handlers (ecb-nav,
    forms retry, mint-link, sponsors) that are silently dead on the served
    page. Needs its own story; not fixed here to keep the diff scoped.
- **Phase C — Tokenize + test-id parity**: strip inline styles; raise thin-surface
  test-id coverage.
- **Phase D — First-read clarity pass**: plain-language copy across the four screens.

## 4. Runnable sequence (ME vs YOU)

```bash
# STEP 0 — [YOU, one-time] local Worker for a live target
cd workers/oursharedevents && npx wrangler dev   # → localhost:8787

# STEP 1 — [ME] matrix spec born-red (Phase A)
npx playwright test sponsor-lifecycle.matrix --config playwright.e2e.config.ts
# expect: wizard cells RED (surface not built) — proves the test bites

# STEP 2 — [ME] Phase B wizard surface → wizard cells green
# STEP 3 — [ME] Phase C tokens + testid parity → npm run lint:testids clean
# STEP 4 — [ME] Phase D copy pass → full matrix green
```
