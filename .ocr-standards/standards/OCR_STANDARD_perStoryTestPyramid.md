# OCR_STANDARD — Per-Story Test Pyramid

**Status:** Active — applies to every story in every product repo
**Date:** 2026-05-15
**Owner:** mzdan
**Triggered by:** Founder reframe (2026-05-15) — _"For every story, write Postman and Playwright tests"_
**Revised:** 2026-08-16 — added the **L0 architectural floor** (runtime stays LLM-free) as a standing fleet-wide assertion (COST-504 / OSE-789; enforced by COST-101 / OSE-770).

---

## The rule

**Every story-scope PR ships tests at all three pyramid layers before it moves to QA:**

1. **Unit / Worker-binding** — vitest (`tests/*.spec.ts`)
2. **API contract** — Postman/Newman (`postman/collections/*.json`)
3. **UI / browser flow** — Playwright (`tests/playwright/*.spec.ts`)

A PR that ships code without all three layers is not "code review ready." It's "developer slop being thrown over the wall to the tester."

---

## L0 — the architectural floor (runtime stays LLM-free)

The three layers above verify **behavior**. Beneath them sits an **L0 architectural floor**: structural invariants that must hold for the product to exist at all, enforced as `tests/e2e/0-architecture/*.invariant.spec.ts` — the executable source of truth the org brain mirrors (see `CLAUDE.md` § "The ten invariants"). L0 specs are not customer-flow scenario tests; they read the source tree and fail the build when a structural property is violated. They run in the blocking L0/T0 gate **before** lint, before the three behavior layers — security and architecture gate first (`feedback_security_first_gate.md`).

### The standing fleet-wide L0 assertion — runtime stays LLM-free

**Every product repo inherits this floor: runtime request-handling code must not import a model SDK or call an LLM.** The only sanctioned AI seam is a single build/ops-time sanitization module, allowlisted as the sole exception.

**Why it is a standing standard, not a repo-local choice.** Free-forever is structurally sustainable **only while runtime stays LLM-free** — runtime ops cost ≈ 0 tokens, so a live model call is the one change that would flip a product from structurally-free to metered-per-request. Making the assertion executable turns "we intend to stay free" into "the build fails if we don't." Because every OCR product makes the same free-forever promise, the assertion belongs at fleet level, inherited by construction — not re-decided per repo. (Decision recorded: **promote to standing standard**, not repo-local. Rationale in ADR-006.)

**Reference implementation (COST-101 / OSE-770).** `ourSharedEvents/tests/e2e/0-architecture/runtime-llm-free.invariant.spec.ts` fails CI on any runtime model-SDK / LLM-client import under `src/`; the allowlist is exactly one file, the sanctioned sanitization seam `src/lib/ai-sanitization.ts` (ratified in OSE `ADR-014`). It is wired into the blocking T0 invariants gate, and the OSE-350 enforcement-continuity meta-test requires every structural spec be registered there — so the assertion cannot be silently dropped.

**How a spoke inherits it.** Each product repo adds an equivalent `runtime-llm-free.invariant.spec.ts` to its own `tests/e2e/0-architecture/`, registered in its L0/T0 gate — or, if the repo has no runtime surface (e.g. a docs/governance repo like OCR-docs, or a human-delivered product like OSP), records that it carries no runtime and is therefore vacuously compliant. Named-identity platforms (OW) and OSE-derived repos (OSG) inherit the same floor; the sanctioned-seam allowlist is per-repo but must stay an explicit allowlist-of-few, never an open door.

**L0 naming.** L0 invariant specs follow the existing `*.invariant.spec.ts` convention at `tests/e2e/0-architecture/`, **not** the four-segment pipe format above — they assert a structural property of the tree, not a `<method + path>` scenario. The pipe format governs the three behavior layers only.

---

## Why the standard exists

The static refinement audit (2026-05-15) surfaced 50 customer-flow defects across 6 surfaces in OSE. Every defect was something a human user would hit on first interaction — and every one was code that had passed unit tests, merged to main, and reached "feature complete" status without a single click-through.

Cause: vitest catches code-shape errors but doesn't catch:

- Routes that return JSON when the user expects HTML
- DOM that renders correctly in isolation but breaks in a real browser
- Network responses that pass schema validation but include dev jargon
- A11y violations that only surface in screen readers
- Mobile layouts that look fine at 1080p and break at 375px

Postman tests catch the network-contract layer; Playwright tests catch the browser-rendering layer. Together with vitest, all three close the customer-experience loop **before** a human ever has to drive the flow manually.

---

## What "per-story" means

| Layer | Per story you ship | Test file lives at |
|---|---|---|
| **Unit / Worker** | At least one `*.spec.ts` whose name names the story or refinement ID | `<repo>/workers/<svc>/tests/<feature>.spec.ts` |
| **API contract** | At least one entry in the relevant Postman collection naming the story or refinement ID | `<repo>/postman/collections/<surface>.json` |
| **UI / browser** | At least one `*.spec.ts` in the Playwright tree naming the story or refinement ID | `<repo>/tests/playwright/<surface>.spec.ts` |

**"At least one"** — not "every assertion duplicated three times." Different layers test different things:

- Unit tests: function behavior, edge cases, internal invariants
- Postman: response shape, headers, status codes, content negotiation
- Playwright: DOM elements present, click flows, mobile viewports, real-browser behavior

If a story changes both an API and a UI surface, it ships tests on BOTH surfaces' collections (Postman) AND files (Playwright).

---

## Test naming — the unified format

**A reader 6 months from now must be able to read a test name once and know what it does.** Therefore Postman items, Playwright tests, AND vitest tests use one format:

```
<PRODUCT-PREFIXED-STORY-ID> | <LAYER> | <method + path> (<condition>) | <assertion>
```

Four pipe-delimited segments. **Same string in every runner that tests the same scenario at the same layer** — vitest and Postman both test `API` layer, so their names match exactly when the scenario is identical. Playwright tests `FE` layer, so its name differs only by the qualifier. The matching name across runners (same layer) and the differing-by-qualifier name (across layers) is the feature — it lets you cross-reference any scenario across runners AND distinguish which layer of behavior is being verified.

### Anatomy

| Segment | Answers | Examples |
|---------|---------|----------|
| **`<PRODUCT-PREFIXED-STORY-ID>`** | Which product + which story | `OSE-272`, `OSE-R-001`, `OW-15`, `OA-7`, `OSM-12` |
| **`<LAYER>`** | Which layer of behavior is tested (framework-agnostic) | `API`, `FE` |
| **`<method + path> (<condition>)`** | What surface + in what state | `GET /admin (unauthenticated)`, `POST /api/v2/events/shared-reports/batch (WKRP service token)`, `GET /forms/:eventId (mobile 375px viewport)` |
| **`<assertion>`** | What should be true | `401 HTML sign-in page`, `returns 200 with reports map`, `card fits within viewport width`, `a11y skip-link + semantic main + focus` |

### Layer qualifiers

The qualifier names **the layer of behavior being tested, not the runner**. A vitest test that calls `SELF.fetch('/admin')` is `API` because it's exercising the HTTP contract — even though vitest is the runner. A Playwright test that opens a browser to `/admin` is `FE` because it's exercising browser-rendered behavior. **Framework-agnostic.**

| Qualifier | What it tests | Runners that typically produce it |
|---|---|---|
| **`API`** | HTTP endpoint contract — request goes in, response comes out, no rendering | Postman/Newman, curl, vitest with `SELF.fetch()`, Playwright API mode, supertest |
| **`FE`** | Browser-rendered behavior — DOM, navigation, viewport, accessibility, click flows | Playwright, Cypress, Puppeteer, real-browser smoke checks |
| _(no qualifier)_ | Pure unit test of an internal function — no HTTP, no DOM | Vitest direct function calls (`expect(phaseToPool(4)).toBe('hipaa')`); use sparingly; if a test maps to `API` or `FE` behavior, prefer those qualifiers |

When a scenario is verifiable at both layers (e.g., `GET /admin (unauthenticated)` produces a 401 — both the API contract AND the browser experience), ship two tests with the same product+story+surface+condition+assertion but different qualifiers:

```
OSE-R-001 | API | GET /admin (unauthenticated) | 401 HTML sign-in page
OSE-R-001 | FE  | GET /admin (unauthenticated) | 401 HTML sign-in page
```

The API test verifies the response shape. The FE test verifies the browser renders the response correctly. Both are necessary; both are explicitly different by the layer qualifier.

### Why product-prefixed IDs are non-negotiable

OCR is a 7-product fleet. A test name like `R-001 | GET /admin | ...` is ambiguous the moment it shows up outside its home repo — CI dashboards, fleet-wide log aggregation, cross-product audits, fleet `STATUS.md`. **Every test name must self-identify the product.**

| Story type | ID shape | Why |
|---|---|---|
| Linear story (already product-prefixed) | unchanged | `OSE-272`, `OW-30`, `OA-15` |
| Refinement / audit ID | product-prefixed | `OSE-R-001` (not bare `R-001`), `OW-R-005` |
| Cross-product story | always product-prefixed | `OSE-272`, never `STORY-272` |

This matches the existing OCR naming spine (`OSE_UNIT_...`, `OW_MIGRATION_...`) where product comes first.

### Rules

- **Product-prefixed story ID first** — non-negotiable; see above
- **Layer qualifier second** — `API` or `FE` (or omitted for pure unit tests); names the layer of behavior, not the runner
- **Present tense in the assertion**: "returns 401 HTML sign-in page" / "card fits within viewport width" — not "should return" / "tries to" / "will display"
- **Condition in parens after the surface** — keep the surface + state as a single recognizable token: `GET /admin (unauthenticated)`
- **No abbreviations that don't tell the story**: write "unauthenticated" not "unauth"; write "authenticated" not "authed"
- **Plain English in the assertion**: not raw codes (`UNAUTH`, `INVALID_BODY`) and not implementation detail (`returns null`, `throws`)
- **One scenario per test**: if you find yourself writing "and" twice on either side, split into separate tests
- **No `-PW-NN` / numeric suffixes**: ordering is irrelevant; the name itself disambiguates. Two tests can never have the same name (within a layer); if they would, your condition or assertion is wrong
- **No arrows** (`→`, `=>`, `-->`): some CI dashboards, log aggregators, and grep tools don't render Unicode arrows cleanly. The pipe + parens carry the same semantics portably

### Reference implementation (OSE-R-001)

API-layer tests (vitest with `SELF.fetch()` + Postman items) share **identical name strings** when they test the same scenario — only the runner differs. FE-layer tests (Playwright) differ from the API-layer test of the same scenario only by the qualifier (`API` vs `FE`).

| Layer | Test name | Runners |
|---|---|---|
| API | `OSE-R-001 \| API \| GET /admin (unauthenticated) \| 401 HTML sign-in page` | Vitest, Postman/Newman |
| FE | `OSE-R-001 \| FE \| GET /admin (unauthenticated) \| 401 HTML sign-in page` | Playwright |
| API | `OSE-R-001 \| API \| GET /admin (Accept: application/json) \| 401 JSON error` | Vitest, Postman |
| API | `OSE-R-001 \| API \| GET /manage (unauthenticated) \| 401 HTML sign-in page (alias)` | Vitest, Postman |
| FE | `OSE-R-001 \| FE \| GET /manage (unauthenticated) \| 401 HTML sign-in page (alias)` | Playwright |
| API | `OSE-R-001 \| API \| POST /api/v2/admin/events (unauthenticated) \| 401 JSON (no HTML leak)` | Postman |
| FE | `OSE-R-001 \| FE \| GET /admin (unauthenticated) \| heading + lede + CTAs render` | Playwright |
| FE | `OSE-R-001 \| FE \| GET /admin (unauthenticated) \| brand matches landing (logo + nav)` | Playwright |
| FE | `OSE-R-001 \| FE \| GET /admin (unauthenticated) \| a11y skip-link + semantic main + focus` | Playwright |
| FE | `OSE-R-001 \| FE \| GET /admin (unauthenticated) \| robots noindex meta present` | Playwright |
| FE | `OSE-R-001 \| FE \| GET /admin (mobile 375px viewport) \| card fits within viewport width` | Playwright |
| FE | `OSE-R-001 \| FE \| GET /admin (unauthenticated) \| no admin dashboard content leaked` | Playwright |

**Cross-runner contract**: when a scenario is verifiable in BOTH vitest (`SELF.fetch`) AND Postman (Newman) at the API layer, the test name string is **byte-identical** across the two runners.

**Cross-layer contract**: when a scenario is verifiable at BOTH API and FE layers (the same outcome appears in the response AND in the rendered DOM), ship two tests with the same product+story+surface+condition+assertion but different qualifiers (`API` vs `FE`).

### Vitest variant

Vitest is just a runner — the qualifier is determined by what the test exercises. Most OSE vitest tests use `SELF.fetch()` and therefore carry the `API` qualifier. Pure-function unit tests carry no qualifier (or carry one explicitly only if the team adopts a `UNIT` convention later).

```typescript
describe('OSE-R-001 admin front-door', () => {
  test('OSE-R-001 | API | GET /admin (unauthenticated) | 401 HTML sign-in page', async () => {
    const res = await SELF.fetch('https://test.local/admin', {
      headers: { Accept: 'text/html' },
    });
    expect(res.status).toBe(401);
    // ...
  });
});
```

### What about non-HTTP tests?

For tests that exercise a pure function, a DB helper, or a UI component in isolation (no HTTP, no browser), substitute the surface for the method+path slot and omit the layer qualifier:

- `OSE-R-NNN | mintSignedLinkToken() (valid event ID + secret) | returns HMAC token`
- `OSE-R-NNN | escapeHtml() (string with < > & quotes) | returns entity-encoded string`
- `OW-R-NNN | <EventCard> component (event in pre_event phase) | renders RSVP CTA`

The surface slot adapts; the product-prefixed ID and the assertion structure hold. If pure-unit testing becomes common enough to warrant its own qualifier, add `UNIT` to the layer list in a future revision.

---

## When the three layers are NOT all required

The rule is "every **customer-facing** story." Carve-outs:

| Story type | Required layers | Why |
|---|---|---|
| Customer-facing HTTP endpoint or page | All 3 | The thing customers actually use |
| Internal cron / scheduled job | Vitest only | Not user-facing; Postman/Playwright provide no value |
| Migration-only PR | Vitest only (schema drift gate) | Not user-facing |
| Docs-only PR (this file, ADRs, READMEs) | None | No code to test |
| Brain contract YAML change | Brain conformance check (existing CI) | Per-repo CI handles this |
| CI / tooling-only PR | None (or CI dry-run) | Self-evident |

When in doubt, ask: **"could a customer see this change?"** If yes, all three layers.

**The L0 architectural floor is orthogonal to these carve-outs.** The runtime-LLM-free assertion (and any other `0-architecture` invariant) applies to *every* PR in a runtime-bearing repo, whether or not the three behavior layers are required — a docs-only or cron-only PR still must not introduce a runtime LLM import. L0 is a property of the tree, not of the story type.

---

## What the audit / refinement workflow looks like in practice

For every refinement story (R-NNN in `REFINEMENT-BACKLOG-YYYY-MM-DD.md`):

1. **Branch** off `main`: `<repo>/r-NNN-<short-description>`
2. **Fix the code** — surgical, single concern, no scope creep
3. **Vitest spec** — `tests/r-NNN-<feature>.spec.ts` (or extend an existing spec with a `describe('R-NNN ...')` block)
4. **Postman update** — add named items to the relevant collection JSON, using the unified naming format (see § Test naming)
5. **Playwright spec** — `tests/playwright/<feature>.spec.ts` with the unified naming format — same string as the matching Postman item
6. **Run all three locally** before pushing:
   - `npx vitest run tests/r-NNN-*.spec.ts` → pass
   - `newman run postman/collections/<surface>.json -e postman/environments/staging.json` → pass (or doc'd skip)
   - `npx playwright test tests/playwright/<feature>.spec.ts --list` → enumerated; `--reporter=line` against staging → pass when deployed
7. **PR** title: `fix(R-NNN): <short description>` or `feat(STORY-NNN): <short description>`
8. **PR description** lists the three test artifacts explicitly under a `## Tests` heading

CI runs vitest. Newman runs on staging deploy. Playwright runs on staging post-deploy or in the smoke pipeline. Each layer fails independently — no single layer can mask another's failure.

---

## Anti-patterns

- ❌ **"The unit test covers it"** — unit tests don't catch content-negotiation, real-browser rendering, or DOM-level a11y. They MUST be paired with Postman + Playwright for customer-facing changes.
- ❌ **"It's a small fix, skipping Postman"** — small fixes are exactly when regressions sneak in. Postman test takes 5 min to add; saves hours of post-deploy "why is staging broken" investigation.
- ❌ **"Playwright is flaky, I'll skip it"** — Playwright tests against a stable surface are not flaky. If you find one is flaky, that's a defect in the surface or the test; fix the cause, don't skip.
- ❌ **Postman/Playwright tests that exercise mocks instead of the real surface** — these layers exist to catch what unit tests can't. If you mock, you're back to unit testing.
- ❌ **One Playwright test per refinement that just does `goto + expect(200)`** — that's a smoke check, not a flow test. The pyramid requires the test to exercise the actual user interaction.

---

## Examples in repo

Reference implementations of the standard, post-R-001 ship (2026-05-15):

- **Vitest:** `ourSharedEvents/workers/oursharedevents/tests/admin-signin-page.spec.ts` (7 cases)
- **Postman:** `ourSharedEvents/postman/collections/ose-pages.json` — search `"R-001 |"` for the 4 new entries
- **Playwright:** `ourSharedEvents/tests/playwright/admin-signin-page.spec.ts` (9 cases)

Each layer tests something the other two layers cannot. Use these as the template for R-002 onward.

---

## Pre-existing infrastructure (no new tools required)

| Tool | Where | Used by |
|---|---|---|
| **vitest** | `<repo>/workers/<svc>/vitest.config.mts` | All OSE worker tests |
| **Newman** | `<repo>/newman.config.json`, `<repo>/postman/` | Existing OSE Postman collections (ose-api.json, ose-pages.json, ose-api-sharedreport.json) |
| **Playwright** | `<repo>/playwright.*.config.ts`, `<repo>/tests/playwright/` + `<repo>/tests/e2e/` | Existing OSE landing-page Playwright |

This standard does NOT require new tooling. It requires writing tests in the existing layers.

---

## How this lives long-term

- **Standard is fleet-wide** — every OCR product repo follows this. Sibling repos (ourWKRP, ourAirwaves, etc.) inherit the pattern when they engage customer surfaces.
- **CI enforcement** — a future story may add a CI check that fails a customer-facing PR missing any of the three layers (detected via PR diff: did the code change a `handle*Page` / route / form? if yes, are Postman + Playwright deltas in the PR?). Until that check exists, this is **review discipline** — the reviewer's job is to refuse a customer-facing PR that ships only vitest tests.
- **Routing** — per `OPERATING_SYSTEM.md §3`, this standard lives at `OCR-docs/docs/standards/`. ADRs reference it; per-repo CLAUDE.md should pin it.

---

## Related artifacts

- `OPERATING_SYSTEM.md §3` — routing matrix (where each test layer lives per repo)
- `OCR_STANDARD_testNaming.md` — naming convention (file + test names)
- `OCR_STANDARD_d1Migration.md` — migration-test exemption rule
- `feedback_security_first_gate.md` — pyramid principle (security gates BEFORE lint); the L0 floor gates first
- `REFINEMENT-BACKLOG-YYYY-MM-DD.md` in each repo's `docs/qa/` — the per-story IDs this standard references
- `docs/adr/ADR-006-cost-sustainability-free-forever-guardrails.md` — why the runtime-LLM-free floor exists (free-forever as a structural property)
- `ourSharedEvents/tests/e2e/0-architecture/runtime-llm-free.invariant.spec.ts` — the executable L0 assertion (COST-101 / OSE-770)
- `ourSharedEvents/docs/adr/ADR-014-ai-sanitization-sanctioned-seam.md` — the single sanctioned AI seam the allowlist permits

---

_If you're shipping a customer-facing change and you only have vitest tests, you're not done. The standard exists because every defect found in the 2026-05-15 audit was code that had vitest coverage and still broke for users. Vitest is necessary; it is not sufficient._
