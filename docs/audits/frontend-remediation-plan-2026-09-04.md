# Front-end remediation — concrete plan

**Date:** 2026-09-04 · **Basis:** UX laws audit (pass 1) + synthesis (pass 2), measured against the code
**Scope:** integration, rendering, performance, long-term maintenance
**Execution log:** §7 (steps 1–4 landed 2026-09-05)

---

## 0. First: the docs are wrong, and they are wrong in a demoralising direction

`CLAUDE.md` §3 describes the front end as:

> _"345 admin inline styles, 58 wrong-direction breakpoints, test-ID coverage 3-80%"_

Measured today:

| Claim                          | Actual                       | Delta |
| ------------------------------ | ---------------------------- | ----- |
| 345 admin inline styles        | **17**                       | −95%  |
| 58 wrong-direction breakpoints | **9** across all 7 templates | −84%  |

**Someone did that drain work and the brain never recorded it.** This matters beyond tidiness: anyone reading CLAUDE.md to decide where to spend front-end effort is being pointed at a problem that no longer exists, and away from the ones that do.

**Action: correct `CLAUDE.md` §3 before anything else.** It is a five-minute edit and it changes what the next contributor believes.

---

## 1. The finding that reframes everything else

**A component system already exists, is well-built, and is essentially unadopted.**

`packages/ui` (`@ocr/ui`) exports **15 partials** (14 when this was written; `footer()` landed as step 3):

```
header()  footer()  bottomNav()  button()  card()  loading()  emptyState()
accessDenied()  formInput()  textarea()  formSelect()  checkbox()
radioGroup()  formGroup()  page()
```

…plus `esc()`, `escUrl()`, `contrastRatio()`, `styleTag()`, `ocrStylesheet()`, design tokens, a Tailwind preset, and — importantly — **`checkTemplate()` / `checkAll()`, a template drift detector** (`contract.ts`).

**Adoption in production surfaces: near zero.** The only import of the partials is `pages.ts:1466`, and it feeds a _preview_ section (`data-testid="preview-section-form-partials"`, `<h2>Form partials — @ocr/ui</h2>`). `demo.ts` imports `esc`/`escUrl` only.

> **Updated 2026-09-05.** `footer()` is now adopted on five served surfaces via
> `src/lib/legal-footer.ts` — the first partial in the real render path. One
> more thing this step turned up: **`packages/ui` had no vitest config**, so
> `vitest` walked up to the root config, whose include
> (`tests/{unit,contract,integration}/**`) cannot match `packages/ui/tests/`.
> All four suites reported _"No test files found"_ and CI never ran them. The
> package's `"test": "vitest run tests/"` script was correct and inert; config
> resolution was the gap. **A component library nobody adopts is one problem; a
> component library whose 90 tests do not execute is a different and worse
> one** — and it is most of why "well-built" above was an inference from
> reading the code rather than a fact anything checked.

The seven served templates are **standalone HTML documents imported as strings**:

```ts
import PUBLIC_HTML from '../templates/public.html';
import ADMIN_HTML from '../templates/admin.html';
```

There is **no layout function, no partial composition, and (until step 3) no shared footer or header** in the render path. Each template carries its own `<style>` block — **14 of them across 7 files**.

**This is why the footer problem (OSE-1232) looks harder than it is.** The answer is not "build a footer." It is "adopt the composition layer that already exists, and the footer is its first partial."

---

## 2. Integration

### 2.1 Add `footer()` to `@ocr/ui` and adopt it — this is package 1a

The shape follows the 14 existing partials exactly, so there is no new pattern to invent:

```ts
// packages/ui/src/partials.ts
export interface FooterOpts {
  legalLinks: Array<{ href: string; label: string }>;
  year?: number;
  subtitle?: boolean; // "Never who, only how many" — OSE-1230
}
export function footer(o: FooterOpts): string {
  /* … */
}
```

Ship it against `/privacy` alone. `/terms`, `/legal`, `/accessibility` do not exist yet (verified: `src/router.ts:1452` routes `/privacy` and `/privacy-policy`, and nothing else). **The partial takes a link array, so pages are added as data, not as code changes.**

Surfaces: `public`, `shared-report`, `admin`, `admin-signin`, `landing`. **Not `display`** (a TV at ten feet; `display-consent` already does the contextual job). **`poster` is a separate decision** — print legal rules differ.

### 2.2 Adopt the partials that already exist, in this order

| Order | Partial                         | Replaces                        | Why first                                                                                                     |
| ----- | ------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1     | `footer()` _(new)_              | 4 divergent inline legal blocks | Ships OSE-1232 and OSE-1231 together                                                                          |
| 2     | `emptyState()`                  | ad-hoc "No events scheduled."   | The below-floor / empty state is a **brand-promise surface** (peak-end, law 10) and must not read as an error |
| 3     | `header()`                      | 6 bare wordmark renders         | Carries the OSE-1230 subtitle and fixes the `h1` semantics defect (OSE-1233) in one place instead of four     |
| 4     | `formInput/textarea/formSelect` | the four form bodies            | Already used in the preview; proven, just not adopted                                                         |

**Do not attempt `page()` adoption in this pass.** Wholesale template replacement is where this kind of work dies.

### 2.3 The "three parallel copies" claim is wrong — do NOT delete them

> **Corrected 2026-09-04 by the §9.1 doc-impact traversal, which caught this in an earlier draft of
> this very document.** That draft said _"delete `web/` — 4 stale HTML files"_ and _"delete
> `src/frontend/` — empty."_ **Both are false, and acting on the first would have broken CI.**

`CLAUDE.md` describes _"three parallel frontend copies (`src/templates/`, `web/`, `src/frontend/`)."_
Only one of the three is a template copy. Measured:

| Path                      | What it actually is                                                   | Status                                                  |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| `src/templates/`          | 7 served HTML templates                                               | ✅ the real templates                                   |
| `web/shared/`             | `apiClient.js`, `assetState.js`, `errorStates.js`, **`testids.js`**   | ❗ **live and load-bearing — do not touch**             |
| `src/frontend/apiClient/` | 7 TS modules (base, admin, poster, public, display, env), 2,439 lines | ⚠️ **OSE-1235 filed 2026-09-05** — confirm, then retire |

**`web/shared/` must not be deleted:**

- `web/shared/testids.js` is **generated by `scripts/gen-testids.mjs`** — the script whose `--check`
  mode gates CI (it blocked PR #454 in this session).
- `web/shared/assetState.js` is **served over HTTP** and asserted by smoke tests
  (`tests/smoke/asset-state.spec.ts` fetches `${BASE_URL}/web/shared/assetState.js`).
- Last touched **today**.

**`src/frontend/apiClient/` — investigate, do not assume.** No importer was found in the worker or
tests, but "no importer found" is not "dead." **Filed as OSE-1235** (2026-09-05) to confirm, then
retire deliberately.

One thing the story turned up that strengthens the case: the only references to these files anywhere
in the repo are **five entries in `scripts/guard-no-gas.allowlist.json`** (lines 103–107), and the
`script.google.com` strings they allow are _comments saying the files do not call it_
(`admin.ts:21`, `env.ts:114`). So retiring them also removes five rows from the Deprecation Lock's
allowlist — a smaller allowlist is a tighter lock (Invariant #10).

**Correct `CLAUDE.md`'s characterisation** — it is one template directory, one live shared-JS
directory, and one candidate for retirement. Calling them "three parallel frontend copies" is what
produced the bad advice.

## 3. Rendering

### 3.1 `/events` is client-rendered and should not be

The served HTML contains a `<script>` template literal (`${safeName}${wrappedTag}`) and a `data-testid="public-loading"` state. The sequence is:

```
HTML  →  parse  →  JS  →  fetch /api/v2/events  →  render
```

**Two round trips before an attendee sees an event.** That is the Doherty finding (law 6) in its most avoidable form, and it is on the discovery surface — the one that answers _"there's nothing to do around here."_

The Worker already has the data. **Server-render the list and keep the client script only for interactions.** This is a Worker-side template change, not a framework decision.

_(Note: it also caused a real error in this session — the empty-state string was in the served HTML while the rendered page showed a card. Server-rendering makes the served HTML the truth.)_

### 3.2 Consolidate 14 `<style>` blocks

`/ui.css` is already linked from **10 places** across the templates, and `@ocr/ui` exports `ocrStylesheet()` and `styleTag()`. The per-template `<style>` blocks are the drift surface — they are where `#4361EE` drifted toward SPONSOR navy `#1A3A8A` (law 13).

**Move shared rules into `/ui.css`; leave only genuinely page-specific rules inline.** Do it template by template, not in one sweep.

---

## 4. Performance

### 4.1 `admin.html` is 55% of the bundle and almost nobody loads it

| Template           | Size         | Share   |
| ------------------ | ------------ | ------- |
| **admin.html**     | **162.7 KB** | **55%** |
| shared-report.html | 46.8 KB      | 16%     |
| poster.html        | 26.9 KB      | 9%      |
| landing.html       | 20.8 KB      | 7%      |
| display.html       | 20.1 KB      | 7%      |
| public.html        | 14.0 KB      | 5%      |
| admin-signin.html  | 5.5 KB       | 2%      |
| **Total**          | **297 KB**   |         |

The bundle has grown ~17% since CLAUDE.md recorded ~253 KB.

Every Worker invocation carries admin's 162.7 KB — including every anonymous QR scan, which is the highest-volume, most latency-sensitive path on the platform, and which can never reach that template (CF Access).

**Options, cheapest first:**

1. **Split admin onto its own Worker route/script.** Cleanest; admin already has a separate auth boundary, so the seam exists.
2. **Move admin's inline `<script>` and `<style>` to `/admin.js` + `/admin.css`** served as static assets. Cuts the string constant substantially with no architectural change.
3. Dynamic `import()` of the admin template — Workers support it, but verify against the bundler before committing.

**Measure before choosing.** Bundle size affects cold start; nobody has measured cold start (law 6 graded C precisely because nothing is measured).

### 4.2 Do not reach for the client-side cache

Per pass 2, the Director of Security's veto stands: no `localStorage`, no IndexedDB, no warm cache on anonymous surfaces. The Doherty fix is **server-side only** — `stale-while-revalidate`, and materialised `scan_aggregates` for SharedReport. Both already exist and are unexhausted.

---

## 5. Long-term maintenance

### 5.1 Wire the drift detector that already exists

`@ocr/ui` exports `checkTemplate()` / `checkAll()` returning `DriftFinding[]`. **It is not in the T0 Gate.** A drift detector nobody runs is documentation.

**Add it to the `invariants` shard file list in `.github/workflows/oursharedevents-ci.yml`.** Note the trap: a spec not named in that list _does not run_ — that is how `uec-codes.invariant.spec.ts` ended up outside the shard.

### 5.2 The regression pattern this audit kept finding

Pass 1's grade distribution had **zero A grades**, and both A− grades were withheld for the same reason: _correct in code, no gate against regression_. Front-end specifics:

| Rule                     | Stated in                                 | Enforced?                                                                                               |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 10-second comprehension  | `QR-ROUTING.md`                           | ❌ nothing measures it                                                                                  |
| 480px max width          | `QR-ROUTING.md`                           | ❌                                                                                                      |
| 44px touch targets       | mobile-workability Contract 2             | ✅ **blocking on PR code** since 2026-09-05 (step 4) — was informational, and targeted deployed staging |
| ≤7 UEC codes per surface | `UEC-CODES.md`                            | ❌                                                                                                      |
| Grayscale label fallback | `UEC-CODES.md` deployment checklist `[x]` | ❌ claimed, never asserted                                                                              |

**The single highest-leverage maintenance change is making the mobile-workability audit run against PR code and block.** That is pass 2's package 2a/2b and it protects five other laws from regressing.

> **Done 2026-09-05 — and it paid for itself on the first run.** See §7, step 4.
> The claim above was the right call for the wrong reason: the audit did not
> merely _fail to block_, it was auditing the wrong artifact entirely. Pointed
> at PR code it immediately found violations in `admin.html` and in `@ocr/ui`'s
> own form controls — including a class collision that had been rendering the
> component showcase invisible, and therefore unmeasurable, for as long as it
> existed.

### 5.3 Keep the brain honest

This document opened with a 95% error in CLAUDE.md. Add front-end metrics to the brain-sync so the numbers are derived rather than remembered:

```
template bundle KB · per-template KB · inline style= count
@media max-width count · @ocr/ui partial adoption count
```

Cheap to compute, and it would have prevented the §0 error.

---

## 6. Next steps, in order

| #     | Step                                                                                                                                                                                                                           | Size  | Blocked by                | Moves                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------------------------- | ---------------------------------------------------------- |
| **1** | Correct `CLAUDE.md` §3 front-end current-state                                                                                                                                                                                 | **S** | —                         | Nothing ships, but it stops misdirecting effort            |
| **2** | ~~Delete `web/` and `src/frontend/`~~ → **confirm and retire `src/frontend/apiClient/` only** (OSE-1235)                                                                                                                       | **S** | —                         | Retracted and rewritten — see §2.3. `web/` is load-bearing |
| **3** | ~~Add `footer()` to `@ocr/ui`; adopt on 5 surfaces against `/privacy`~~ ✅ **DONE 2026-09-05**                                                                                                                                 | **S** | —                         | Laws 4, 10, 14 · OSE-1232                                  |
| **4** | ~~Mobile-workability audit → PR code, then blocking~~ ✅ **DONE 2026-09-05**                                                                                                                                                   | **M** | —                         | Laws 2, 8, 14 — **protects everything else**               |
| **5** | ~~Server-render `/events`~~ ✅ **DONE 2026-09-05**                                                                                                                                                                             | **M** | —                         | Law 6 on the discovery surface · OSE-1243                  |
| **6** | Wire `checkAll()` into the T0 invariants shard                                                                                                                                                                                 | **S** | —                         | Maintenance floor                                          |
| **7** | ~~Measure the bundle's cold-start cost~~ ✅ **7a MEASURED 2026-09-30** → admin costs ~0 ms at startup; `h3-js` is ~85% (see `workers/oursharedevents/docs/ops/STARTUP-COST-2026-09-30.md`). Re-scope 7b to **lazy-load h3-js** | **M** | 7b needs a decision       | Law 6                                                      |
| **8** | Adopt `emptyState()` and `header()`                                                                                                                                                                                            | **M** | step 3 proves the pattern | Laws 10, 12 · OSE-1233                                     |
| **9** | Consolidate `<style>` blocks into `/ui.css`, template by template                                                                                                                                                              | **L** | steps 3 and 8             | Law 13 · the ΔE drift surface                              |

**Steps 1–3 and 6 are all S-sized, block nothing, and need no sign-off beyond the front-end engineer.** They can land this week.

**Step 4 is the one that matters most long-term** — it is the difference between fixing these findings once and fixing them repeatedly.

---

## 7. What this plan deliberately does not do

- **No framework.** Nothing here introduces React, a build step for templates, or a client router. The Worker-renders-HTML model is correct for this product and the partials are plain string functions.
- **No `page()` adoption.** Wholesale template replacement is where this work dies.
- **No client-side caching.** Director's veto, stated in pass 2 with its cost.
- **No tier-keyed CSS.** WALL-3b (OSE-835) is live and detonates on it.
- **No new UEC hues.** OSE-322 is shipped and scoped to the QR surface; the ΔE rule is the complement for brand tokens, not a licence to add colours.

---

## 7. Execution log

Written under the write-clearance rule
([[OCR_STANDARD_reconciliationLoop]] §9.5): each entry is recorded **after**
the change merged with tests named and passing and the §9.1 doc traversal
closed — never as a plan, never as a placeholder. An entry here asserts
something that was true when it was written and cites how to re-derive it.

### Step 1 — Correct `CLAUDE.md` §3 front-end current-state · ✅ 2026-09-04

`345 admin inline styles` → **17**. `58 wrong-direction breakpoints` → **9**.
Both were true when written in 2026-08 and had been drained by work nobody
recorded. Corrected at its home in `CLAUDE.md:151`, with the superseded figures
kept inline so the next reader can see the delta rather than wonder whether the
new number is a typo.

### Step 2 — The "three parallel frontend copies" claim · ✅ 2026-09-05

The claim was wrong, and it was wrong in a direction that produced **dangerous
advice**: an earlier draft of this document recommended deleting `web/`, which
would have broken CI. Caught by the §9.1 traversal, not by review. See §2.3.

- `CLAUDE.md` §4 rewritten — one template directory, one live shared-JS
  directory, one retirement candidate.
- **OSE-1235** filed for the one genuine candidate, `src/frontend/apiClient/`.
  It is a _confirm-then-retire_ story, not a delete: "no importer found" is not
  "dead," and that distinction is precisely what the bad draft got wrong.

### Step 3 — `footer()` in `@ocr/ui`, adopted on five surfaces · ✅ 2026-09-05

**What was actually broken.** Not the markup — the _reachability_. The privacy
policy was linked from exactly one surface, `admin-signin`, whose readers are
staff. Two public surfaces linked it from nowhere; `admin` and `shared-report`
had no footer at all. On a product whose promise is "Never who, only how many,"
the page that explains that promise was unreachable from the pages that make it.

**What shipped.**

|             |                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Partial     | `packages/ui/src/partials.ts` → `footer()`, the 15th                                                                             |
| Composition | `workers/oursharedevents/src/lib/legal-footer.ts`                                                                                |
| Mechanism   | `<!--OCR_LEGAL_FOOTER-->` marker, replaced at serve time                                                                         |
| Adopted     | `landing`, `public`, `admin`, `admin-signin`, `shared-report`                                                                    |
| Not adopted | `display` (TV at ten feet), `poster` (print legal differs)                                                                       |
| Styling     | `.ocr-footer` in `componentStyles`; all 7 templates already link `/ui.css`, so it reached every surface with no per-template CSS |

**Three design decisions worth keeping.**

1. **The opt-out is silence.** A template with no marker is returned
   byte-identical. `display` and `poster` opt out by saying nothing rather than
   by a negative check somebody has to remember to maintain.
2. **Links are data.** `/terms`, `/legal` and `/accessibility` **do not exist** —
   verified against `src/router.ts`, which routes `/privacy` and
   `/privacy-policy` and nothing else. They are therefore not linked, and a test
   asserts every href in `LEGAL_LINKS` is routable, so a link added ahead of its
   page fails CI. **A dead link is at its worst in the one place people go
   looking for their rights.** When Terms is written it is one array entry.
3. **Position is not an identity.** Two E2E specs addressed the landing link as
   `[data-testid="landing-footer"] a`, which resolved uniquely _only because_
   that footer had exactly one link. Adding Privacy would have turned both into
   Playwright strict-mode violations. Every link now carries its own test-id.
   The copyright assertion moved off the literal `'2026'` for the same class of
   reason: the year is derived at render time, so a literal would have passed
   all year and failed at midnight on 1 January, for a reason nobody would
   connect to this change.

**Two things the step turned up that were not on the list.**

- **`packages/ui` tests never ran.** No vitest config, so `vitest` walked up to
  the root config whose include cannot match `packages/ui/tests/`. All four
  suites reported _"No test files found, exiting with code 1."_ Fixed with
  `packages/ui/vitest.config.ts`; **90 tests now execute.** `react.test.tsx` is
  excluded rather than deleted — React is Phase 3 and is not installed at the
  root, so it fails at resolve time, which is a red that says nothing about the
  code.
- **A registry coverage gap, recorded not papered over.** Footer test-ids are
  now built from a surface prefix, so they are dynamic by `gen-testids.mjs`'s
  existing rule and correctly drop out of `web/shared/testids.js`. The registry
  stays **truthful** (it claims nothing the app does not emit) but is no longer
  **complete** for composed markup — and completeness is what makes `t()`
  useful. Closing it means deriving from rendered output rather than template
  source, which needs a TS loader that plain-node script does not have.
  Documented at the generator, where the next reader will be, and it gets more
  valuable with every partial adopted (step 8).

**Verification.** 13 partial unit tests + 19 in-process worker tests, born-red
both ways: dropping per-link ids fails the id test; reverting the landing
injection fails three, _including the marker-leak guard_. Full worker suite
**3134/3134** (219 files), root suite **1853**, a11y **9/9**, `gen-testids
--check` clean, `tsc` clean, lint 0 errors.

**What step 3 does NOT cover.** §2.2's table called this "4 divergent inline
legal blocks." Three were footers and are now one. The fourth is the **~7 lines
of GDPR prose beneath the survey's Submit button** (UX audit laws 4 and 10) —
that is form-body copy in `form-pages.ts`, not a footer, and it is a separate
fix. Naming it here so the ✅ above is not read as covering it.

### Step 4 — Mobile-workability audit against PR code, blocking · ✅ 2026-09-05

**What was actually broken — not what §5.2 said.** §5.2 called the audit
"informational, and targets deployed staging rather than PR code," which reads
as two settings to flip. It was one defect with a cause neither line names:

```ts
// tests/playwright/mobile-workability.spec.ts, before
const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';
await page.goto(`${BASE_URL}${surface.path}`);
```

The spec built **absolute** URLs, so it ignored Playwright's `baseURL` and could
not be pointed anywhere — the exact trap `playwright.component.config.ts`
documents in its own header (_"navigates to the absolute URL
`http://poster.test/poster`, so it ignores baseURL entirely and would NOT follow
this config"_). No new config would have redirected it. **Navigation is relative
now; the config decides the target.** That one-line change is what made the rest
possible.

**Two jobs, two questions.** They are different questions and both are worth
asking; only one can gate a PR.

| Job               | Target                                   | Browsers                | Blocks  |
| ----------------- | ---------------------------------------- | ----------------------- | ------- |
| `pr-code`         | local `wrangler dev` worker, this branch | Chromium                | **yes** |
| `nightly-staging` | `STAGING_URL`                            | Chromium **and WebKit** | yes     |

**The nightly was red every night, for a non-reason.** Runs 187, 188, 189 and
192 — every `schedule` event since 2026-09-01 — failed on:

```
browserType.launch: Executable doesn't exist at .../webkit-2336/pw_run.sh
```

Three of `playwright.config.ts`'s four projects are WebKit device descriptors
and the workflow installed `chromium` only. **A gate that is always red teaches
people to ignore it exactly as fast as one that is always green**, and this repo
had one of each: a PR check that could not fail and a nightly that could not
pass.

**The trigger paths could not see the files that break this.** The old `paths:`
list named two handlers and the spec. Every violation found below lives in
`src/templates/admin.html` or `packages/ui/src/styles.ts` — neither was listed.
Widened to templates, handlers, and `packages/ui/src/**`.

#### What the gate found the moment it looked at the right artifact

**1. The component showcase rendered an `<h1>` and nothing else.**
`@ocr/ui` hides `.preview-section` as part of its **file-upload** family — a CSV
import preview revealed by adding `.visible`. The showcase reused that class
name for "component preview section" and never adds `.visible`. 40KB of markup,
every section `display:none`. The showcase is the newcomer, so the showcase
renamed to `.ui-preview-section`.

**2. That collision had been hiding real violations in the design system.**
Nothing can measure a page that renders nothing:

|                      | Was                   | Now                |
| -------------------- | --------------------- | ------------------ |
| `.input` font-size   | `.85rem` → **13.6px** | `16px`             |
| `.input` height      | 41px                  | `min-height: 44px` |
| `.search-bar` height | 40px                  | `min-height: 44px` |

Below 16px, iOS Safari auto-zooms on focus **and does not zoom back out** — the
person is left on a zoomed, horizontally-scrolling form mid-entry. Every form
partial renders `.input`, so one rule was the library's entire form contract,
and every partial inherited 13.6px.

**3. `/admin` had never been audited. On any run. Ever.** Its skip is
conditioned on `OSE_ADMIN_BEARER`, unset since May (OSE-302). The blocking job
hands a local key to a local worker — `wrangler dev --local` with an empty D1,
so this grants access nowhere — and the largest surface in the bundle
(`admin.html`, 162.7KB, **55% of all template bytes**) rendered for the first
time:

| Control                       | Was                                              | Fix        |
| ----------------------------- | ------------------------------------------------ | ---------- |
| `.create-form input`/`select` | 34px, 14.4px                                     | 44px, 16px |
| `.create-form textarea`       | **no font-size rule at all** → 13.3px UA default | 44px, 16px |
| `.create-btn`                 | 35px                                             | 44px       |
| `.add-spon-btn`               | 43px                                             | 44px       |
| `.surface-card a`             | 72×15                                            | 44px tall  |
| `.copy-btn`                   | 73×22                                            | 44px tall  |

The textarea row is the one worth pausing on: **the smallest text on the surface
was on its two longest fields** (`who-story`, `why-purpose`), because nobody had
written a rule and the UA default won.

> Getting `/admin` to render took two vars, not one. `ALLOW_ADMIN_KEY_FALLBACK`
> lives under `[env.staging.vars]` in `wrangler.toml`, not top-level `[vars]`, so
> `wrangler dev` with no `--env` leaves the Bearer path switched off entirely and
> `/admin` answers 401 whatever key you send.

#### Three defects in the audit itself, exposed by the same run

- **Selector priority was inverted, on every surface.**
  `page.locator('a, b').first()` returns the first match in **document order**,
  not the first list entry that matches. Every surface declares its selector as
  a priority list — "the real CTA, then progressively looser fallbacks" — and
  that intent was silently reversed. On `/admin` the entry chooser sits _after_
  the create wizard in the DOM, so `.first()` always resolved to a `[hidden]`
  element and the contract failed no matter which CTA was named first.
  Resolution is entry-by-entry now, preferring a rendered candidate.

- **WCAG 2.5.5 sizes the _target_, not the painted control.** A 18×18 checkbox
  inside a ≥44px `<label>` has a 44px target: tapping the row toggles it. That
  is how every design system ships a checkbox, and `@ocr/ui`'s
  `.checkbox-label` already carries `min-height:44px`. The audit reported four
  already-compliant controls, and **the only way to satisfy it would have been
  to paint a 44px checkbox — worse for everyone.** Added as a narrow exemption,
  conditional on the label actually meeting the floor, in the same shape as the
  existing inline-text one.

- **`/admin`'s CTA selector named a button that the entry view deliberately does
  not render.** `create-submit` lives on step 5 of the create wizard —
  progressive disclosure working correctly — so the above-the-fold contract
  could only ever fail. Measured at 375×812, the only things above the fold on
  entry are the path chooser's two buttons (`admin-path-wizard` 300×72 at
  y=223, `admin-path-advanced` 300×87 at y=307). That is the entry CTA.

#### Verification

**55/55 passing, zero skips, all 11 surfaces, ~48s** against this branch's code.
Full worker suite **3134/3134** (219 files), root **1853**, `@ocr/ui` **90**,
`gen-testids --check` clean, `tsc` clean, lint 0 errors.

The regression guard in `tests/unit/post-ocr-42-refinement-state.test.ts` caught
a real thing on the way through: a long comment I added pushed `/admin`'s
`skipReason` declaration outside the 400-character window the guard checks. The
guard was right and the comment moved — **a guard is not loosened to accommodate
prose.**

#### What step 4 does NOT cover

The blocking job runs **Chromium only**. Engine-specific layout bugs are real,
which is why the nightly keeps all four projects; but the spec forces 375×812 on
every surface, so the viewport — the thing invariant 14 is actually about — is
identical across projects, and quadrupling the cost of a gate that runs on every
push does not pay for itself. If a WebKit-only regression ever reaches
production, that trade is the thing to revisit.

---

### Step 5 — Server-render `/events` · ✅ 2026-09-05

**What was actually broken.** §3.1 named the round trip; the cost was worse than
the round trip. `/events` shipped a `Loading events…` paragraph and fetched its
own list, so an attendee waited `HTML → parse → JS → fetch → render` to learn
whether anything was happening near them — on the surface whose entire job is
answering that question. The Worker had the rows in hand when it served the
shell.

**What shipped.**

|            |                                                                                       |
| ---------- | ------------------------------------------------------------------------------------- |
| Renderer   | `workers/oursharedevents/src/lib/event-list.ts` → `renderEventList()`                 |
| Escaping   | `src/lib/html-escape.ts` → `escapeHtml()`, replacing three near-copies and a fourth   |
| Enrichment | `src/lib/event-enrich.ts` → `enrichWithPhase`, extracted from `handlers/events.ts`    |
| Mechanism  | `<!--OCR_EVENT_LIST-->` / `<!--OCR_EVENT_COUNT-->`, replaced at serve time            |
| Handler    | `handlePublicPage(env, ctx)` reads the same DataProvider seam as `GET /api/v2/events` |
| Retired    | 68 lines of client script, the loading state, and the `public-loading` test-id        |

**Three things the step fixed that were not on the list.**

1. **The client escaper was weaker than the three server ones.** It used
   `div.textContent → innerHTML`, which covers `& < >` but **not `"` or `'`** —
   and it interpolated into attribute values (`data-event-id="${safeId}"`). A
   quote in an id would have closed the attribute. There is now one escaper,
   covering all five, with a test that feeds it `x" onmouseover="alert(1)` and
   asserts the parser builds no handler from it.
2. **Dates were rendered in the reader's timezone.** `toLocaleDateString` with
   no `timeZone`, so a `02:00Z` start was the previous evening across most of
   the Americas and the same gathering showed different dates to different
   people. The list projection already carried `timezone`; an event's date is
   now **the local date where it happens**, UTC when the row has no zone.
3. **Failure was deferred, not reported.** A Worker that could not reach D1 still
   returned `200` with a loading paragraph, and the reader only learned
   otherwise once their own fetch also failed. The error state is now rendered
   into the response.

**The bug this step introduced, and why the tests that passed did not catch it.**

The first cut read `dp.listEvents()` and rendered the rows straight, skipping
`enrichWithPhase`. `listEvents` returns **raw D1 rows** — `title` /
`start_date` / `location` — while the renderer reads `name` / `startDateISO` /
`venue`. Every test-id was present, the markup was well-formed, the count said
`1 upcoming event`, and **every assertion passed** while the cards said nothing
at all and offered registration for events that had already happened.

`enrichWithPhase` was private to `handlers/events.ts` despite its own comment
promising that _"surfaces don't re-derive phase locally."_ That promise held
only while the JSON API was the sole consumer. It is now a shared module.

What found it was not a test — it was reading a stale test name. `public-to-
registration.spec.ts` had a describe block called **"D1 Field Compatibility"**
asserting that `title` renders when `name` is absent. That assertion described
the exact mapping the new code path was skipping.

**The lesson, stated as the gate that now enforces it.** Asserting an element
**exists** is not asserting it **says something**. Three tests were added that
fail without the enrichment while the five structural assertions stay green in
both states — verified by reverting the fix and watching precisely those three
go red.

**What the step turned up about the test suite itself.**

Four E2E suites covering the public discovery surface — **98 tests** — drove
the page by intercepting `**/api/v2/events`. That interception _was_ their
input. Server-rendering removed the seam, so every one of them would have
**passed vacuously** rather than failed loudly.

They were also already dead. CI runs an explicit allowlist through
`playwright.e2e-smoke.config.ts`, and none of these four files is on it;
`npm run test:e2e:negative` and `test:e2e:all` exist and **no workflow calls
them**. The proof is in what they asserted: two tests demanded `"Untitled
Event"` for a missing name and three demanded the `title`/`start_date`/
`location` dual-reads — behaviour **OSE-871 deleted**. Those assertions could
only stay green by never executing.

| Suite                                    | Before | After | Disposition                            |
| ---------------------------------------- | ------ | ----- | -------------------------------------- |
| `4-negative/public-events-errors`        | 22     | 6     | cases → unit; browser-only remains     |
| `3-flows/public-events-rendering`        | 7      | 4     | its first test asserted the round trip |
| `3-flows/public-to-registration`         | 22     | 7     | markup → unit; journey stays           |
| `2-pages/public-events`                  | 47     | 27    | 4 mocked describes removed             |
| `tests/unit/public-events-phase.test.ts` | 4      | 27    | the cases, at 1/1000 the cost          |

The unit file was itself a symptom: it read `public.html`, pulled the script out
with a regex, ran it in jsdom against a stubbed `fetch`, and waited two
microtask turns — the only way to reach logic that existed only inside a string
inside a template. It now calls a function.

**Filed:** OSE-1244 — wire these suites into CI, or delete them. A test that
cannot run is not coverage; it is a claim of coverage, which is worse, because
the claim is what stopped anyone looking.

**Tests named and passing:** worker `3155`; root `1876` passed / `322` skipped;
CSP static gate `11`; test-id drift gate green; all four E2E suites enumerate
under `playwright.e2e.config.ts`.
