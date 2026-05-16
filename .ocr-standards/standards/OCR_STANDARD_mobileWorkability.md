# OCR Standard — Mobile workability

**Status:** Live · **Owner:** OCR governance · **Effective:** 2026-05-16 · **Refined:** 2026-05-16 via OCR-42 (inline-text-link exemption + page-state model + error-page sub-contract)

## Rule

Every customer-facing surface in every OCR product MUST be fully usable
on a 375×812 viewport (iPhone 13 Mini / iPhone X — the modern small-phone
baseline). "Usable" is defined by five concrete contracts:

1. **No horizontal scroll.** `document.documentElement.scrollWidth ≤
   document.documentElement.clientWidth` at 375 px wide. The customer
   should never have to scroll sideways to see any content.
2. **Touch targets ≥ 44×44 px.** Every interactive element (button,
   link styled as button, checkbox, form input) must have a bounding
   box of at least 44 px in both dimensions. (WCAG 2.5.5 Target Size +
   Apple Human Interface Guidelines.)

   **Exception — inline text-flow links (WCAG 2.5.5 "Inline"
   exemption).** Anchors that are children of text-flow containers
   (`<p>`, `<li>`, `<dt>`, `<dd>`, `<span>`, `<em>`, `<strong>`,
   `<label>`) AND have a computed `display: inline` are NOT subject
   to the 44×44 floor. Per WCAG 2.5.5 Note: *"Where the target is in
   a sentence or block of text, the size of the target is not
   constrained."* The audit MUST detect this case (via
   `getComputedStyle(el).display === 'inline'` plus a parent-element
   check) and exclude it from the violation list. This exemption
   applies only to anchors styled inline within text flow; primary
   CTAs styled as buttons or block-level links remain subject to the
   44×44 floor regardless of containing element.

3. **Input font-size ≥ 16 px.** Any `<input>`, `<textarea>`, or
   `<select>` must compute to at least 16 px font-size. Smaller values
   trigger iOS Safari's automatic pinch-zoom on focus, which interrupts
   the customer's flow and is widely perceived as broken.
4. **Primary CTA above the fold.** The surface's main call-to-action
   (register button, submit button, share link) must be visible without
   scrolling on initial page load at 375×812. The customer should not
   have to discover the action.

   **Page-state model.** Contract (4) applies to the **steady-state
   rendered page**, not the initial DOM at `domcontentloaded`.
   Surfaces with async data loading (e.g., `/sharedReport` where
   export buttons start disabled until the report bundle resolves)
   often render the primary CTA in a disabled-but-visible state
   during loading. A disabled-but-visible primary CTA satisfies
   contract (4) if it would be enabled in the happy-path state —
   what matters is whether the customer can see WHERE the action
   lives, not whether they can immediately tap it. The audit MUST
   wait for one of these signals before measuring CTA visibility:

   - `aria-busy="false"` on the surface root
   - A configurable `data-ready="true"` signal on `<body>`
   - A 3-second steady-state timeout (fallback)

   A surface that never reaches steady state in 3 seconds at 375×812
   is itself a workability failure (applied in the spirit of "no
   unbounded wait required" — the audit reports it as a steady-state
   timeout violation against contract 4).
5. **No pinch-zoom required for form submit.** Every form on every
   surface must be fully completable using normal taps and the on-screen
   keyboard — no manual zoom needed to read labels or hit targets.

## Why

A bar owner pulls out their phone to check on their event mid-shift. An
investor opens the demo URL on their iPhone in a meeting. A bar customer
scans the QR poster and the form loads. In every one of those moments,
the platform either works or it doesn't. "Workable on mobile" is a
contract with the customer, not a refinement.

This standard makes that contract concrete + measurable + automated.

## Scope

**In scope** — every customer-facing surface across the OCR product
fleet. For OurSharedEvents, the canonical 7 surfaces are:

| Surface | Path |
|---|---|
| Landing | `/` |
| Public events listing | `/events` |
| Public event page | `/events/:id` |
| Form pages (4 types) | `/forms/:id?type={register,checkin,survey,email-signup}` |
| Admin dashboard | `/admin` |
| SharedReport | `/sharedReport` |
| Poster preview UI (not the print artifact) | `/poster` |

For OurWKRP, OurSharedMagnets, OurAirwaves, OurSharedGames,
OurSharedRecords, OurSharedPulse — the same rule applies to whatever
customer-facing surfaces those products ship.

**Out of scope (documented exemptions):**

- **`/display`** — venue TV surface, designed for landscape kiosk
  display on a 1080p+ screen. The 375 px viewport assumption does not
  apply to this form factor.
- **`/briefing`** — internal CEO briefing tool, explicitly scoped out
  of customer-facing reviews per the OCR briefing-scope feedback
  (`feedback_briefing_scope.md`). If `/briefing` ever becomes customer-
  facing, the exemption is removed.

Additional exemptions for future surfaces must be documented inline in
this file AND added to invariant 14's `exceptions:` list in
`ocr-docs-brain/architectural-invariants.yaml`. The audit honors that
list.

## What counts as a violation

For each surface, a violation is recorded if any of the five contracts
fails. The audit (per-product Playwright suite that loads the surface
at 375×812 + measures via DOM APIs) reports one violation per
(surface, contract) tuple.

Examples of real violations the audit will surface:

- `/admin` — header `<h1>` with inline tier badge + phase badge + "Admin"
  subtitle wraps and overflows below 360 px wide. Event table uses 6
  columns with no `@media` reorg → horizontal scroll required.
  Violations: **horizontal scroll** on /admin.
- `/sharedReport` — `.report-table` and `.funnel-table` are fixed-width
  6-column layouts. Below 768 px they overflow. Violation:
  **horizontal scroll** on /sharedReport.
- Any form input declared at `font-size: 14px` triggers iOS Safari
  pinch-zoom on focus. Violation: **input font-size** on whichever form
  ships that input.

## Error pages count as customer surfaces

When a customer-facing URL is requested for a resource that doesn't
exist (404), is forbidden (403), or fails (5xx), the rendered error
page is itself a customer surface and must satisfy contracts (1),
(2), (3), (5) at the same threshold as the happy-path surface.

Contract (4) ("primary CTA above the fold") is satisfied by the error
page's **recovery action** — the link or button that gives the
customer a clear next step (e.g., "Browse upcoming events" linking
back to `/events` from a 404). The audit's per-surface CTA selector
list MUST accept either the happy-path primary CTA OR the error-page
recovery action as a valid match.

**Detection.** The audit MUST recognize when it's measuring an error
page (via HTTP status >= 400 OR a `data-testid="error-main"` /
`data-testid^="error-"` signal in the rendered DOM) and apply the
error-page primary-CTA selector. This prevents a "primary CTA
selector matched 0 elements" failure on surfaces where the test
fixture (e.g. `evt_test_2026`) doesn't exist in the deployed
environment — the audit correctly recognizes it's measuring the 404
recovery flow and validates THAT.

**OSE implementation.** `renderErrorPage` (OSE-R-004 branded error
pages) emits `data-testid="error-main"`, `data-testid="error-title"`,
`data-testid="error-cta"`. The audit's `/events/:id` surface CTA
selector lists `error-cta` alongside `event-rsvp` + `event-checkin`
so both happy-path and 404 renders pass contract (4).

## How this rule is enforced

1. **Per-product Playwright audit** — each OCR product repo ships a
   `tests/playwright/mobile-workability.spec.ts` that exercises its
   surface list against the five contracts above. The OSE
   implementation lives at
   `ourSharedEvents/tests/playwright/mobile-workability.spec.ts`.
2. **Nightly + on-PR workflow** — same pattern as
   `brain-location-audit.yml`. On PR runs the audit is informational
   (does not block); on schedule + manual dispatch it blocks and opens
   a Linear ticket on violation.
3. **Architectural invariant 14** — encoded in
   `ocr-docs-brain/architectural-invariants.yaml` so compliance tooling
   can read the contract programmatically.
4. **Propagated standard** — this document propagates to every product
   repo's `docs/standards/` via the OCR-docs standards propagator. Every
   developer working in any OCR repo sees the rule locally.

## Why 375×812 specifically

375×812 is the iPhone 13 Mini / iPhone X / iPhone 11 Pro viewport. It's
the smallest modern iPhone viewport in significant active use. Designing
to this floor covers:

- iPhone 13/14/15 Mini (375×812)
- iPhone X/XS/11 Pro (375×812)
- iPhone 12/13/14 (390×844) — passes by virtue of being wider
- iPhone 13/14/15 Pro Max (430×932) — passes
- Most modern Android (360–414 px width range) — passes if 375 passes,
  with one edge case: 360 px Android devices may need separate
  verification for Drain stories that cluster tight CTAs

We do NOT design for 320 px (iPhone 5 / SE 1st gen) because that
viewport represents a deprecated user segment and would force
sacrifices on the modern-phone baseline.

## When this rule conflicts with print or kiosk surfaces

The rule applies to the **on-screen, customer-touchable** view of every
surface. If a surface has print or kiosk modes (e.g. `/poster` has both
a web preview UI AND a `@media print` rule for the printed artifact),
mobile workability applies to the **web preview UI only**. The print
artifact is governed separately (see OSE-R-006 + the print-color-adjust
contract).

For `/display` (venue TV), mobile workability does not apply at all —
the surface is designed for a landscape kiosk and is documented as an
exemption above.

## History

- **2026-05-16** — Standard authored after the OSE-R-027 trust-breaker
  surfaced as the visible tip of a fleet-wide gap. The founder stated
  the expectation explicitly: *"The entire site should be workable
  from your mobile. This is the expectation."* This standard plus
  invariant 14 plus the per-surface drain stories (OSE-292 epic + 9
  children) operationalize that expectation.
- **2026-05-16** — First full validation cycle of invariant 14 (OSE
  audit run 25951483089) revealed three standard-debt items that the
  initial draft was too coarse to handle cleanly. OCR-42 refined the
  standard with: (a) WCAG 2.5.5 inline-text-link exemption added to
  contract (2), (b) page-state steady-state model added to contract
  (4), (c) error-page sub-contract requiring (1)(2)(3)(5) at
  happy-path threshold plus the recovery action satisfying (4).
  OSE-301 aligns the audit implementation to the refined standard.
  This is the post-validation refinement pass that the initial GOVERN
  PR couldn't anticipate — the pattern future invariant arcs should
  expect to follow.

## Pattern precedent

Mirrors the brain-enforcement-location arc that landed 2026-05-15:
standard doc + invariant + audit workflow + per-surface enforcement.
That arc proved out the three-tier enforcement model (strong: nightly
audit; medium: propagated doc; soft: invariant for compliance
reporting). This standard re-runs that exact playbook for the mobile
contract.
