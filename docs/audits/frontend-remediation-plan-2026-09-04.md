# Front-end remediation — concrete plan

**Date:** 2026-09-04 · **Basis:** UX laws audit (pass 1) + synthesis (pass 2), measured against the code
**Scope:** integration, rendering, performance, long-term maintenance

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

`packages/ui` (`@ocr/ui`) exports **14 partials**:

```
header()  bottomNav()  button()  card()  loading()  emptyState()
accessDenied()  formInput()  textarea()  formSelect()  checkbox()
radioGroup()  formGroup()  page()
```

…plus `esc()`, `escUrl()`, `contrastRatio()`, `styleTag()`, `ocrStylesheet()`, design tokens, a Tailwind preset, and — importantly — **`checkTemplate()` / `checkAll()`, a template drift detector** (`contract.ts`).

**Adoption in production surfaces: near zero.** The only import of the partials is `pages.ts:1466`, and it feeds a _preview_ section (`data-testid="preview-section-form-partials"`, `<h2>Form partials — @ocr/ui</h2>`). `demo.ts` imports `esc`/`escUrl` only.

The seven served templates are **standalone HTML documents imported as strings**:

```ts
import PUBLIC_HTML from '../templates/public.html';
import ADMIN_HTML from '../templates/admin.html';
```

There is **no layout function, no partial composition, no shared footer or header** in the render path. Each template carries its own `<style>` block — **14 of them across 7 files**.

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

| Path                      | What it actually is                                                 | Status                                         |
| ------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| `src/templates/`          | 7 served HTML templates                                             | ✅ the real templates                          |
| `web/shared/`             | `apiClient.js`, `assetState.js`, `errorStates.js`, **`testids.js`** | ❗ **live and load-bearing — do not touch**    |
| `src/frontend/apiClient/` | 7 TS modules (base, admin, poster, public, display, env)            | ⚠️ no importers found; last touched 2026-08-25 |

**`web/shared/` must not be deleted:**

- `web/shared/testids.js` is **generated by `scripts/gen-testids.mjs`** — the script whose `--check`
  mode gates CI (it blocked PR #454 in this session).
- `web/shared/assetState.js` is **served over HTTP** and asserted by smoke tests
  (`tests/smoke/asset-state.spec.ts` fetches `${BASE_URL}/web/shared/assetState.js`).
- Last touched **today**.

**`src/frontend/apiClient/` — investigate, do not assume.** No importer was found in the worker or
tests, but "no importer found" is not "dead." File a story to confirm and retire it deliberately.

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

| Rule                     | Stated in                                 | Enforced?                                                              |
| ------------------------ | ----------------------------------------- | ---------------------------------------------------------------------- |
| 10-second comprehension  | `QR-ROUTING.md`                           | ❌ nothing measures it                                                 |
| 480px max width          | `QR-ROUTING.md`                           | ❌                                                                     |
| 44px touch targets       | mobile-workability Contract 2             | ⚠️ **informational**, and targets deployed staging rather than PR code |
| ≤7 UEC codes per surface | `UEC-CODES.md`                            | ❌                                                                     |
| Grayscale label fallback | `UEC-CODES.md` deployment checklist `[x]` | ❌ claimed, never asserted                                             |

**The single highest-leverage maintenance change is making the mobile-workability audit run against PR code and block.** That is pass 2's package 2a/2b and it protects five other laws from regressing.

### 5.3 Keep the brain honest

This document opened with a 95% error in CLAUDE.md. Add front-end metrics to the brain-sync so the numbers are derived rather than remembered:

```
template bundle KB · per-template KB · inline style= count
@media max-width count · @ocr/ui partial adoption count
```

Cheap to compute, and it would have prevented the §0 error.

---

## 6. Next steps, in order

| #     | Step                                                                | Size  | Blocked by                                  | Moves                                           |
| ----- | ------------------------------------------------------------------- | ----- | ------------------------------------------- | ----------------------------------------------- |
| **1** | Correct `CLAUDE.md` §3 front-end current-state                      | **S** | —                                           | Nothing ships, but it stops misdirecting effort |
| **2** | Delete `web/` and `src/frontend/`                                   | **S** | —                                           | Removes the wrong-file hazard permanently       |
| **3** | Add `footer()` to `@ocr/ui`; adopt on 5 surfaces against `/privacy` | **S** | _(terms content is parallel, not blocking)_ | Laws 4, 10, 14 · OSE-1232                       |
| **4** | Mobile-workability audit → PR code, then blocking                   | **M** | OSE-1211 for full coverage                  | Laws 2, 8, 14 — **protects everything else**    |
| **5** | Server-render `/events`                                             | **M** | —                                           | Law 6 on the discovery surface                  |
| **6** | Wire `checkAll()` into the T0 invariants shard                      | **S** | —                                           | Maintenance floor                               |
| **7** | Measure the bundle's cold-start cost, then split admin              | **M** | step 7a is measurement                      | Law 6                                           |
| **8** | Adopt `emptyState()` and `header()`                                 | **M** | step 3 proves the pattern                   | Laws 10, 12 · OSE-1233                          |
| **9** | Consolidate `<style>` blocks into `/ui.css`, template by template   | **L** | steps 3 and 8                               | Law 13 · the ΔE drift surface                   |

**Steps 1–3 and 6 are all S-sized, block nothing, and need no sign-off beyond the front-end engineer.** They can land this week.

**Step 4 is the one that matters most long-term** — it is the difference between fixing these findings once and fixing them repeatedly.

---

## 7. What this plan deliberately does not do

- **No framework.** Nothing here introduces React, a build step for templates, or a client router. The Worker-renders-HTML model is correct for this product and the partials are plain string functions.
- **No `page()` adoption.** Wholesale template replacement is where this work dies.
- **No client-side caching.** Director's veto, stated in pass 2 with its cost.
- **No tier-keyed CSS.** WALL-3b (OSE-835) is live and detonates on it.
- **No new UEC hues.** OSE-322 is shipped and scoped to the QR surface; the ΔE rule is the complement for brand tokens, not a licence to add colours.
