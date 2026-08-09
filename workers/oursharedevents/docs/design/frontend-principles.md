# Front-End Design-Principles Brief (OSE-653)

> **Status:** forward constraints for the front-end deep dive / redesign — **not a fix list.**
> The current codebase is cited only as *evidence of what to avoid* or *patterns to carry forward*.
> Fixing happens **inside** the redesign, applying these principles — never before it.
>
> **Phase 0 (invariant constitution) and Phase 3 (adversarial critique) ran by default.**
> **Verifier boundary:** the human designer + the deep dive dispose. Nothing here is fixed/verified/done.
>
> Evidence surfaces: `public.html`, `admin.html`, `display.html`, `landing.html`, `form-pages.ts`,
> `pages.ts`, `shared-report.html`/builder, `@ocr/ui` tokens, `sponsors.ts`/`forms.ts`, `index.ts`, wrangler.
> Derived from the 2026-08-07 FE perf/quality audit + the OSE-654/OSE-658 builds.

---

## Cluster A — Quality / UX / Accessibility

### A1 · Skeletons load the honest *shape*, suppression-aware
- **Constraint:** every async surface renders a skeleton of the *final shape*. A cell whose value may be floored resolves to a **suppression label**, never a number-shaped shimmer that snaps to "suppressed."
- **Constitutional check:** #7 `aggregate_only_reporting` (K≥5). A numeric skeleton on a suppressible cell is a wall trap.
- **Future AC:** DOM test fails if a numeric animated skeleton appears on a stat cell whose suppression state is unknown pre-fetch; a neutral text/em-dash loader passes.
- **Evidence:** `shared-report.html` already does this (text "Loading…"/`—` → number *or* suppression note) — **carry forward.** Public/forms surfaces show blank/frozen states — avoid.

### A2 · Role tokens only; a palette is a theme object
- **Constraint:** components consume role tokens (`--surface/--card/--text-*/--accent/--success/--warn/--info/--danger`), never raw hex; a client palette is a theme object applied via `[data-brand]`, within days.
- **Constitutional check:** #3 `uec_encoding` (palette-agnostic/color-swappable; UEC hues theme-invariant).
- **Future AC:** token-lint (zero raw hex outside `src/lib/uec`) + per-theme `contrastRatio()` AA gate across light/dark/brand.
- **Evidence:** OSE-654 shipped the vocabulary + `brandThemes` + AA gate — **carry forward.** Avoid: `admin.html` ~172 raw hex, `landing.html` green-success-vs-red-error (deuteranopia hazard), `public.html` `color:#000` on swappable `--accent`.

### A3 · Density budget per surface; ambient, not modal
- **Constraint:** every surface has an explicit density budget (bounded element count, one primary action per view). Sponsor presence is **ambient bands, never modal/interstitial**; post-event is **recap-first** (recap dominant *by layout*, suggestions marginal).
- **Constitutional check:** tasteful-not-bombardment (mission) + #25 (spend-blind — no purchased prominence, only frequency).
- **Future AC:** layout-invariant test (recap area ≥ N× suggestions; sponsor is an inline band, not a dialog; element-count cap).
- **Evidence:** focus-stealing `confirm()`/`alert()` modals were replaced with inline aria-live confirms — **carry forward that pattern.**

### A4 · Accessibility is an acceptance criterion, *per theme*
- **Constraint:** screen-reader semantics, keyboard nav, focus management (`:focus-visible`, dialog focus-trap), `aria-live` for async, and **per-theme contrast** are ACs on every component. An inaccessible theme is a failed theme — the palette-swap automation *includes* the contrast gate.
- **Constitutional check:** #14 `mobile_workability` (AA, tap ≥44, text ≥16).
- **Future AC:** a11y CI shard (axe) + AA across every theme set + 375px computed-style assertion (text ≥16px, tap ≥44px) + aria-live on async feedback.
- **Evidence:** `@ocr/ui` enforces AA; admin aria-live region exists — **carry forward.** Avoid: admin sub-16px badges (0.7–0.85rem) on 375px.

---

## Cluster B — Architecture / Performance

### B1 · Optimistic rendering — display-state only, never wall-derived values
- **Constraint:** actions render the expected result immediately and reconcile on response — **but optimism is boolean/visual state only.** Never fabricate/increment a count or recompute a server-derived value (attendance count, rotation share).
- **Constitutional check:** #1 never-who + #7 aggregate-only/floor + #25 (share-of-voice server-derived). A predicted count is a wall breach.
- **Future AC:** test fails if any numeric count changes before the fetch resolves; optimistic path flips only visual state; #25 share never client-recomputed.
- **Evidence:** admin deactivate blocks then full-list-refetches (avoid → single-row optimistic dim); check-in count is fully server-blocked (**correct** — ACK affordance optimistic, count server-authoritative).

### B2 · Static/edge-first host model — suppression-aware, phase-expiring
- **Constraint:** design surfaces to be edge-cacheable from the start via a **count-free cacheable shell + a per-user count hydrate.** Caches are `private`-or-count-free and **hard-expire at phase pivots**; only count-free/anon-free bodies may be shared-`public`-cached.
- **Constitutional check:** #7 (no sub-floor count in a shared cache) + #1 (no identifying data cached) + #15/#17 + OSE-658 (phase-pivot expiry).
- **Future AC:** test fails if any `public` body carries a numeric count (esp. 1–4) or an anon field; cache expires at the phase pivot.
- **Evidence:** event page rebuilt per user, no cache — OSE-658 now sends `private` + phase-expiring (**carry forward**); `css.ts`/`events.ts`/shared-report already phase-aware cache — **carry forward the pattern.**

### B3 · Compressed, lean payloads by design
- **Constraint:** responses are compressed (rely on/verify CF edge auto-compression; never re-stream a body in a way that could strip it), and payload *shape* is lean (lists project only what the UI uses; no token/secret columns in lists).
- **Constitutional check:** #16/#21 schema stability (lean ≠ breaking — projections verified against required-field specs).
- **Future AC:** real-edge `Content-Encoding` smoke test on large responses; schema-diff test that a list projection drops no required field and leaks no token column. *(Compression impact is instrument-first — measure before crediting.)*
- **Evidence:** no compression assertion in-repo; list endpoints carry unused `click_token`/`impression_token`.

### B4 · Batched, single-binding writes
- **Constraint:** the write path batches (`env.DB.batch` / `UPSERT … RETURNING` / sub-select), never row-at-a-time — and every batch stays within **one** DB binding (`DB` xor `FORMS_DB`). No cross-DB batch or JOIN.
- **Constitutional check:** #1 dual-DB no-FK + #17 emission boundary; maps≠H3 (res7-only, never res9).
- **Future AC:** query-count assertions (1 statement/write path); isolation test forbidding `FORMS_DB` inside a `DB` batch; res7-only column-precision test.
- **Evidence:** check-in write-then-read, impression/click SELECT-then-INSERT, cron per-row UPSERT loops (avoid); `sponsors.ts` already uses `env.DB.batch` — **carry forward.**

### B5 · Round-trip economy — parallelize independent, order the dependent
- **Constraint:** an action fans into the *minimum* sequential dependency levels; independent reads run concurrently; dependent reads (suppression math after the distinct-anon count) stay ordered.
- **Constitutional check:** #7 (suppression labels byte-identical regardless of read order) + #1/#17 (parallelizing introduces no cross-DB JOIN).
- **Future AC:** dependency-depth budget; golden-output test proving suppression results byte-identical regardless of fetch order.
- **Evidence:** `buildSharedReport` ~10 sequential D1 reads; event page serial event-row → nextEvent → 5-way social (avoid → group into `Promise.all`/`allSettled`).

---

## Critique / kill pass (Phase 3)
- **Sharpened:** "static/edge host" ≠ "cache everything" → **"count-free cacheable shell + per-user count hydrate"** (a naive whole-page `public` cache ships a sub-floor count, #7). B2 carries its wall clause inline.
- **Wall-clauses embedded:** B1 (display-only optimism) and B2 (count-free/private cache) are stated *with* their constraints so they can't be "optimized" into a breach.
- **A11y-under-swap holds:** A2/A4 include the per-theme contrast gate — a11y principles that *hold* under a palette swap.
- **No disguised fixes:** each item is a forward constraint with evidence-of-what-to-avoid; the current per-user rebuild, raw hex, and row-at-a-time writes are **evidence, not tickets.**
- **No REJECTs:** no surviving principle trades a wall for speed. A naive "cache the page" or "predict the count" *would* be rejected — which is why B1/B2 forbid them.

## Event content model — the complete question set (canonical, 2026-08-07)
The event page answers **seven** questions; the pre-event funnel orders them
curiosity → connection → logistics → decision → commitment:

| # | Question | Meaning | Field | Funnel position |
|---|----------|---------|-------|-----------------|
| 1 | WHAT | main subject/event | `what_short` | curiosity |
| 2 | WHO | people/audience (conversion engine) | `who_host` | connection |
| 3 | WHY | goal/reason/motivation | `why_purpose` | connection |
| 4 | WHEN | time/date/schedule | `start_date`/`end_date`/`timezone` | logistics |
| 5 | WHERE | physical location | `where_address`/`location`/lat-lon | logistics |
| 6 | **HOW MUCH** | cost/price/amount | **`how_much` (proposed, free-text)** | decision |
| 7 | HOW | method/steps to join | `how_details` | commitment |

- **HOW MUCH is the one missing field.** Today cost is conflated into HOW
  ("Free entry" lives in `how_details`). Give it its own dimension.
- **Constitutional check:** HOW MUCH is the *event's own price* (organizer↔attendee),
  NOT platform billing — #6 `inert_monetization_hooks` holds **only** while it is a
  display string with no charge/processing logic. Keep it **free-text** ("Free" /
  "$10 at the door" / "Sliding scale / pay-what-you-can") — fits the hyperlocal-equity
  mission and stays a label, never a payment primitive. #25 spend-blind (sponsors) is
  unaffected.
- **To land it:** a monotonic migration (`how_much` column, #19), a funnel card
  positioned *before* HOW, admin authoring (OSE-664), and the pre-event/recap renders.
- **Funnel order is locked** by `tests/pre-event-funnel-order.spec.ts` (WHO before WHERE).

## Already-seated seams (redesign inherits for free)
- **A2/A4** — OSE-654 role tokens + AA contrast gate (`@ocr/ui`).
- **B2 phase-expiry** — OSE-658 `publicEventCacheControl` (`private` + phase-pivot expiry).
- **A3 inline-confirm/aria-live** — admin dialog-removal pattern.
- **B4 batch pattern** — `sponsors.ts env.DB.batch`.
