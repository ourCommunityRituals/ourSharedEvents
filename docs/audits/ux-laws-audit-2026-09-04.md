# UX Laws Audit — ourSharedEvents

**Date:** 2026-09-04 · **Mode:** read-only reconnaissance · **Pass:** 1 of 2 (grading only)
**Staging probed:** `stg-84d5802-20260904`

> Pass 2 does synthesis and recommendations. This document grades only.

---

## Grade summary

| #   | Law                        | Grade  |
| --- | -------------------------- | ------ |
| 1   | Hick's law                 | **C**  |
| 2   | Fitts's law                | **B**  |
| 3   | Jakob's law                | **B**  |
| 4   | Law of proximity           | **C**  |
| 5   | Miller's law               | **B**  |
| 6   | Doherty threshold          | **C**  |
| 7   | Von Restorff effect        | **B**  |
| 8   | Minimize target distance   | **C**  |
| 9   | Serial position effect     | **A−** |
| 10  | Peak-end rule              | **C**  |
| 11  | Zeigarnik effect           | **D**  |
| 12  | Law of Prägnanz            | **B**  |
| 13  | Law of similarity          | **A−** |
| 14  | Uniform connectedness      | **C**  |
| 15  | Tesler's law               | **B**  |
| 16  | Postel's law               | **C**  |
| 17  | Postel's law _(duplicate)_ | **—**  |
| 18  | Parkinson's law            | **D**  |
| 19  | Occam's Razor              | **C**  |
| 20  | Pareto principle           | **C**  |

---

## Step 1 — Files actually read

**Read in full or in substantial part:**

- `docs/features/QR-ROUTING.md` (123 lines) — 10-second comprehension, 480px max width, 44px targets, the full `data-testid` table, feature-flag gating table
- `docs/features/UEC-CODES.md` (244 lines) — 7 core codes + 4 extensions, hex values, colour-psychology audit, deployment checklist, platform mapping
- `docs/features/TIERS.md` (171 lines)
- `docs/adr/ADR-010-templates-breadth-tiers-depth.md` (73 lines) — 32 templates / 8 categories, "templates never gate, tiers gate"
- `tests/playwright/_helpers/mobile-workability-assertions.ts` (249 lines) — the five contracts, `MOBILE_VIEWPORT 375×812`, `MIN_TOUCH_TARGET_PX = 44`
- `tests/playwright/mobile-workability.spec.ts` (401 lines)
- `workers/oursharedevents/src/lib/sponsor-resolver.ts` (521) — `buildShareRotation()`, the seeded-shuffle block
- `workers/oursharedevents/src/lib/sponsor-allocation.ts` (306) — surface allocation rules, slot floors
- `workers/oursharedevents/src/lib/uec/uec-codes.ts` (275) — `scan_hex` / `display_hex` split, `requires_alt_print`
- `workers/oursharedevents/src/handlers/form-pages.ts` — success state markup
- `.claude/brand-voice-guidelines.md`
- `OCR-docs/ocr-docs-brain/architectural-invariants.yaml`
- Live staging: `/`, `/events`, `/display`, four `/forms/:id?type=…`, `/sharedReport`, `/admin` rendered at 390px

**Two prompt citations are wrong — reported rather than worked around:**

1. **ADR-003 is not the operator-role ADR.** `OCR-docs/docs/adr/ADR-003-self-checking-infrastructure.md` exists and is about self-checking infrastructure. No document in either repo describes "per-night identity and operator role." Tesler's law (15) is graded against what exists, and the citation is flagged as unverified.
2. **`docs/adr/ADR-003-*` does not exist in the OSE repo at all.** The OSE ADR series runs 001, 002, 006, 009–016.

**Surfaces not reachable for live grading:**

- `/events/:id` — Cloudflare challenge (403). OSE-1211.
- `/poster/:id` — Cloudflare challenge (403). Newly observed this session.
- `/api/v2/uec/resolve` — not probed; graded from source only.

**One prompt premise corrected by evidence:** ADR-010 states 32 templates. Migration `0057_seed_template_event_types.sql` states _"the 24 event_templates seeded by 0015 (VERIFIED: 0015 seeds 24, not the ~32 the design assumed)."_ The doc and the seed disagree. Hick's law is graded against 24.

---

## 1. Hick's law

**Grade: C**

**What the law says.** Decision time grows with the number and complexity of choices. Fewer options, faster decisions.

**Where OSE already satisfies it.** The four QR form pages present exactly one action each. `QR-ROUTING.md` states the design principle explicitly: _"10-second comprehension: user sees event name, one action, done."_ Measured live at 390px: check-in form = 6 fold elements, one button. The URL `type` parameter pre-selects the form, so the attendee never chooses a form type — the QR colour did it.

**Where OSE violates or ignores it.** Template selection at event creation. ADR-010: _"Every event template is available to every user regardless of tier… the full menu."_ 8 categories × 24 seeded templates presented at once is a Hick's-law worst case, and ADR-010 explicitly rejected narrowing it (_"artificially restricts the platform's appeal"_). Its only mitigation is item 5, brand-level curation — _"a bocce-focused brand shows bocce first"_ — which is ordering, not reduction. The admin surface was not gradeable (CF Access).

**Constraints that limit the fix.** ADR-010 is Accepted and states "templates never gate." Invariant #5 tier_equity forbids restricting platform access by tier, so progressive disclosure must not become tier-keyed. WALL-3b (OSE-835, cited in the prompt — **unverified**, I did not locate this gate) reportedly detonates on tier-keyed CSS.

**Stories required.**

- `OSE-XXX [Admin] — Template picker: category-first, then templates within category` (M)
- `OSE-XXX [Admin] — Surface recently-used and brand-curated templates above the full menu` (S)

**Grading rationale.** Not B: the one surface with real choice load has no reduction strategy in the shipped design. Not D: the attendee-facing surfaces — which are the majority of traffic — are genuinely one-choice by construction, and that is deliberate, documented, and enforced by the URL contract.

---

## 2. Fitts's law

**Grade: B**

**What the law says.** Time to acquire a target is a function of its distance and size. Big, close targets are fast.

**Where OSE already satisfies it.** `MIN_TOUCH_TARGET_PX = 44` in `mobile-workability-assertions.ts`, asserted by Contract 2 with a documented WCAG 2.5.5 inline-text exemption and `Math.round()` precision handling. `QR-ROUTING.md` specifies _"Full-width, 44px+ touch target"_ for form submits. Contract 3 enforces `font-size >= 16px` on inputs to prevent iOS auto-zoom — a Fitts-adjacent target-stability protection. Contract 4 asserts the primary CTA is above the fold at 375×812.

**Where OSE violates or ignores it.** The audit is **informational, not blocking**. `.github/workflows/mobile-workability-audit.yml` posts a comment reading _"This PR is NOT blocked — PR-event audits are informational,"_ and it targets `STAGING_URL`, i.e. deployed staging rather than the PR's own code. So a PR cannot fail on a Fitts regression, and the audit cannot see a regression until after it ships. Drain stories OSE-294–300 track existing violations.

**Constraints that limit the fix.** Making the audit blocking requires it to run against PR code, not staging — which is a workflow rewrite, not a threshold change. `/events/:id` and `/poster/:id` are behind the Cloudflare challenge (OSE-1211), so two surfaces cannot be audited at all.

**Stories required.**

- `OSE-XXX [CI] — Mobile workability audit runs against PR code, not deployed staging` (M)
- `OSE-XXX [CI] — Promote Contract 2 to blocking once the drain stories close` (S)

**Grading rationale.** Not A: nothing mechanically prevents regression — the gate is advisory and points at the wrong target. Not C: the contract exists, the threshold is correct (44px is WCAG 2.5.5 AAA), the exemptions are principled, and it is measured on a schedule.

---

## 3. Jakob's law

**Grade: B**

**What the law says.** Users spend most of their time on other sites and expect yours to work the same way.

**Where OSE already satisfies it.** The QR→form flow is the conventional pattern end to end: camera scan → browser → mobile form → `fetch()` submit → inline success without page reload (`QR-ROUTING.md`). Field types, a single full-width submit, and a card layout are standard mobile-checkout furniture. `getCode()` accepting both id and label case-insensitively matches the tolerance users expect from a lookup.

**Where OSE violates or ignores it.** The UEC colour system is, by design, _not_ a convention users arrive with — _"the color is the instruction"_ asks the attendee to learn a 7-colour vocabulary OSE invented. `UEC-CODES.md` mitigates with _"System works in grayscale — label text backup for accessibility,"_ which is the Jakob-compliant fallback, but the deployment checklist marks it `[x]` without a test I could locate.

**Constraints that limit the fix.** UEC is a foundational pillar; the colour semantics are not negotiable. ADR-012 makes `getCode()` the only sanctioned read path.

**Stories required.**

- `OSE-XXX [Poster] — Assert the grayscale label fallback renders for every UEC code` (S)

**Grading rationale.** Not A: the grayscale-fallback claim is a checklist tick, not an asserted behaviour. Not C: every surface an attendee actually touches uses conventional patterns, and the one invented convention ships with a documented fallback.

---

## 4. Law of proximity

**Grade: C**

**What the law says.** Things placed near each other are perceived as related.

**Where OSE already satisfies it.** The form card groups label → input → submit tightly, and the event name sits in a distinct dark header, so identity and action read as separate groups. On `/events`, each event's title, `WRAPPED` tag, date, venue and CTA sit in one bordered card.

**Where OSE violates or ignores it.** On the survey form, the ~7-line legal block sits immediately below the Submit button with no separating treatment, so it reads as part of the action group rather than as ancillary disclosure (OSE-1232). On the landing page, the anonymity block is separated from everything it qualifies — it explains the platform's data behaviour at 2027px of a 2318px page, nowhere near the email capture at ~500px that actually collects data.

**Constraints that limit the fix.** None architectural. This is layout.

**Stories required.**

- `OSE-XXX [Forms] — Separate the legal disclosure from the action group` (S)
- `OSE-XXX [Landing] — Colocate the anonymity promise with the data-collecting element` (S)

**Grading rationale.** Not B: the single most important proximity relationship on the site — "we ask for your email" next to "here is what we do with data" — is 1500px apart. Not D: card-level grouping is consistently correct everywhere else.

---

## 5. Miller's law

**Grade: B**

**What the law says.** Working memory holds roughly 7±2 items. Chunk beyond that.

**Where OSE already satisfies it.** UEC ships exactly **7 core codes**, and `UEC-CODES.md` opens with _"7 colors. One meaning each."_ The four extensions are explicitly chunked away from the core: _"The core codes handle 95% of all event scenarios."_ That is textbook chunking — a 7-item primary set with a secondary set behind a stated threshold.

**Hypothesis check — is 7 deliberate or coincidence?** **Deliberate as a set size, but not justified by Miller.** Every per-code rationale in the doc is semantic or perceptual (colour psychology, contrast, cultural universality). No passage cites working memory or 7±2. The v1.0→v1.1 changelog shows the set was _edited to stay at 7_ — White removed, Pink added — which is set-size discipline, but the stated reasons are scannability and an ADA gap. **Verdict: the number is defended, but never on Miller's grounds.**

**Where OSE violates or ignores it.** Core + extensions = 11, above the 9 ceiling, if a surface ever presents all of them. I found no surface that does. The `/display` and form surfaces measured 8 and 6–15 fold elements; the survey's 15 exceeds the bound, though most are form furniture rather than choices.

**Constraints that limit the fix.** The 7 is fixed. ADR-012 forbids reading hex outside `src/lib/uec/`.

**Stories required.**

- `OSE-XXX [Poster] — Assert no single printed surface carries more than 7 UEC codes` (S)

**Grading rationale.** Not A: nothing enforces the 7-at-once limit on a rendered surface — it holds by current practice. Not C: the chunking is real, documented, and survived a revision.

---

## 6. Doherty threshold

**Grade: C**

**What the law says.** Below ~400ms of system response, attention holds and productivity rises. Above it, the user disengages.

**Where OSE already satisfies it.** Cloudflare Workers + D1 at the edge is the right architecture for sub-400ms. The events read path carries `private, max-age=60, stale-while-revalidate=300` (per the prompt; I confirmed cache headers exist but did not measure the events endpoint's exact directive). `stale-while-revalidate` is precisely the Doherty-preserving pattern — serve stale instantly, refresh behind.

**Where OSE violates or ignores it.** `no-store` is set on `shared-report-read.ts` (two paths), `shortlink-resolve.ts` and `portfolio-rollup.ts`. Every one of those is a _repeat-visit_ surface with no client-side caching permitted. BigQuery-backed reads are documented at 1–5 seconds — **an order of magnitude over threshold**. No dashboards or alerting exist (repo's own SRE current-state), so no surface's real latency is measured against 400ms.

**Hypothesis check — does no-client-storage prevent the usual fix?** **Yes, on anonymous surfaces.** The constitutional rule (born-red E2E negative assertion) forbids writing anything to the device on a scan path, so `localStorage`/IndexedDB warm caches are unavailable exactly where latency matters most. The available levers are server-side: edge cache, `stale-while-revalidate`, materialised aggregates. `scan_aggregates` and `shared-report-materialize.ts` already exist and are that lever.

**Constraints that limit the fix.** No-client-storage is constitutional and not negotiable. `no-store` on SharedReport is a deliberate consumer-cache decision (`shared-report-read.ts:16`).

**Stories required.**

- `OSE-XXX [SRE] — Measure p50/p95 per surface against the 400ms threshold` (M)
- `OSE-XXX [SharedReport] — Serve from materialised aggregates, never a live BigQuery read` (L)

**Grading rationale.** Not B: nothing is measured, so compliance is asserted rather than known, and the one documented number (1–5s) is a failure. Not D: the architecture and the `stale-while-revalidate` choice are correct, and the materialisation path exists.

---

## 7. Von Restorff effect

**Grade: B**

**What the law says.** The item that differs is the item remembered.

**Where OSE already satisfies it.** The entire UEC premise is Von Restorff operationalised — seven maximally-distinct hues, each with one meaning, so the odd-one-out is _always_ the one you need. The colour-psychology audit assigns each code a distinct cultural basis. `#1A3A8A` SPONSOR is described as _"the most valuable pixel in the system."_

**Where OSE violates or ignores it.** The isolation effect requires the highlighted item to be rare. On the landing page the primary CTA (`#0057D6`) and the six Neighborhood Ring circles (`#4361EE`, `#6D28D9`, `#059669`, `#B45309`, `#B91C1C`, `#0891B2`) are all saturated, so nothing is isolated — seven competing colour events above the fold. `#4361EE` is also perceptually adjacent to UEC SPONSOR navy without being it, which risks diluting the one colour the system says is most valuable.

**Constraints that limit the fix.** The UEC static gate (OSE-322, cited in the prompt — **I verified `getCode()` is the sanctioned path and `scan_hex`/`display_hex` are separate fields, but did not locate the gate script itself**) forbids hex literals outside `src/lib/uec/`, so no surface may introduce a new highlight colour. Any de-saturation must come from the existing token set.

**Stories required.**

- `OSE-XXX [Landing] — Reduce competing saturated colour so one element can be the isolate` (M)
- `OSE-XXX [Design] — Rule: no non-UEC hue may sit within a stated ΔE of a UEC scan_hex` (S)

**Grading rationale.** Not A: the effect is designed into UEC but actively diluted on the highest-traffic marketing surface. Not C: the core system is exemplary and the dilution is confined to one page.

---

## 8. Minimize target distance

**Grade: C**

_(Corollary of Fitts's law, item 2. Graded separately as listed, per instruction. The collapse is noted in Step 1.)_

**What the law says.** Related targets should be close together; sequential targets should not require long travel.

**Where OSE already satisfies it.** The form card is ≤480px wide (`QR-ROUTING.md`), so horizontal travel is bounded. Contract 4 keeps the primary CTA above the fold, bounding vertical travel. Contract 1 forbids horizontal scroll at 375px — verified live: no horizontal scroll on any reachable surface.

**Where OSE violates or ignores it.** Nothing measures thumb-reach zones. Contract 4 asserts "above the fold" (y < 812), which on a 812px-tall viewport permits a CTA at y=800 — technically visible, and in the hardest-to-reach region of a one-handed grip. The landing page's only action sits at y≈495 with the field label and input above it, which is reachable; but the measurement does not distinguish y=200 from y=800.

**Constraints that limit the fix.** Same as item 2 — the audit is informational and targets staging.

**Stories required.**

- `OSE-XXX [CI] — Contract 4b: primary CTA within the lower-third thumb zone, not merely above the fold` (S)

**Grading rationale.** Not B: "above the fold" is a weaker guarantee than target distance, and the distinction is unmeasured. Not D: bounded width, no horizontal scroll, and above-the-fold CTAs are all enforced and passing.

---

## 9. Serial position effect

**Grade: A−**

**What the law says.** First and last items in a series are recalled better than the middle.

**Hypothesis check — the prompt predicted this would be the sharpest tension. It is not. It was already solved, and the prompt's premise is out of date.**

**Where OSE already satisfies it.** `sponsor-resolver.ts` contains an explicit seeded-shuffle block, tagged `OSE-1138 · Invariant #25 · COST-101`:

> _"The display ORDER must carry no tier/share meaning — a fixed first/top slot is position-prominence, and #25 forbids buying size/slot/position. So sponsors are SHUFFLED, never share-sorted, on the rendered surfaces. But the runtime is deterministic by doctrine (COST-101 — no Math.random on any path)… We therefore shuffle with a PRNG SEEDED off the event id — 'randomly displayed,' but a seeded, verifiable random."_

Someone identified the exact perceptual-versus-structural gap the prompt anticipated, named it, and resolved it without breaking determinism. `xmur3` is the seed hash.

**Where OSE violates or ignores it.** One residue. `buildShareRotation()` _does_ sort share-descending with an id tie-break — that function is the allocation view, not the render order, but two orderings for one concept is a trap for the next reader. And the shuffle seed is the **event id**, which is constant per event: within a single event, one sponsor is first for every viewer, every render, for the event's whole life. Across events the seed varies, so no sponsor gains systematic platform-wide advantage — but a single-event sponsor either won primacy or did not, permanently.

**Constraints that limit the fix.** COST-101 forbids `Math.random` on any path, so per-render reshuffling must stay seeded. Invariant #25 forbids position from carrying meaning. Any per-impression rotation must remain deterministic and reproducible.

**Stories required.**

- `OSE-XXX [Sponsor] — Seed the shuffle on (event_id, time_bucket) so within-event primacy rotates` (M)
- `OSE-XXX [Sponsor] — Rename buildShareRotation to signal it is allocation, not render order` (S)

**Grading rationale.** Not A: within-event primacy is still fixed, and two co-existing orderings invite regression. Not B: this is enforced in code, reasoned from the invariant, deterministic by doctrine, and documented at the site of the decision — the strongest law-to-code linkage in the audit.

---

## 10. Peak-end rule

**Grade: C**

**What the law says.** An experience is judged by its most intense moment and its ending, not its average.

**Where OSE already satisfies it.** `form-pages.ts` renders a deliberate terminal state: `<div class="success" data-testid="form-success">` with a checkmark glyph, a headline, and _"You can close this page."_ — an explicit ending rather than a silent one. The prompt notes silent success was ruled a bug; the fix is present. On `/events`, a past event ends on _"See how it went"_ — a recap invitation rather than a dead row.

**Where OSE violates or ignores it.** The survey's last impression is not the thank-you — it is ~7 lines of GDPR prose beneath the button, including _"lodge a complaint with your local data protection supervisory authority."_ That is the end-state for the feedback surface, and it is the coldest text on the platform (OSE-1232). K=5 suppression showing _"too small alone"_ is honest, but I found it only in `mock-data.ts` comments — I could not confirm the live rendered treatment on a suppressed SharedReport, because `/sharedReport` returns 403 (feature off) and `/events/:id` is challenged.

**Constraints that limit the fix.** K=5 suppression cannot be relaxed. The honesty lexicon bars inflating a suppressed count. The legal disclosure must remain reachable pre-submit (see OSE-1232's constraint).

**Stories required.**

- `OSE-XXX [Forms] — The last thing a user reads is the thank-you, not the disclosure` (S)
- `OSE-XXX [SharedReport] — Design the below-floor state as a normal early state, not an error` (M)

**Grading rationale.** Not B: the ending is actively undermined on the one surface whose entire purpose is how the user _felt_. Not D: the success-state treatment is real, deliberate, test-id'd, and consistent across all four form types.

---

## 11. Zeigarnik effect

**Grade: D**

**What the law says.** Incomplete tasks are remembered and create tension toward completion. Progress indication exploits this.

**Where OSE already satisfies it.** Almost nothing, and largely by design. Every attendee-facing flow is single-step by construction — the URL selects the form, the form has one action, submission ends it. There is no multi-step wizard to abandon.

**Where OSE violates or ignores it.** No progress affordance exists anywhere I could find. The one genuinely multi-step, resumable flow is **sponsor onboarding** — `sponsor_business_draft` and `sponsor_asset_draft` (migrations 0053, 0065–0066) with a `status` column and a draft→promote lifecycle. A draft is by definition an incomplete task, and nothing surfaces its incompleteness to the person who started it. The admin surface was not gradeable (CF Access).

**Constraints that limit the fix.** No-client-storage forbids resuming an anonymous flow from the device. Sponsor onboarding is not anonymous, so the constraint does not bind there.

**Stories required.**

- `OSE-XXX [Sponsor] — Surface draft status and remaining steps to the submitter` (M)
- `OSE-XXX [Admin] — Show pending sponsor drafts as an actionable queue` (S)

**Grading rationale.** Not C: the one flow where the law applies has a draft state in the schema and no completion affordance in the UI. Not F: single-step-by-construction is a legitimate and deliberate way to make the law inapplicable to the attendee path.

---

## 12. Law of Prägnanz

**Grade: B**

**What the law says.** People perceive ambiguous images in the simplest form available.

**Where OSE already satisfies it.** The UEC system is the strongest instance: one colour, one meaning, zero ambiguity — _"Each code has exactly one meaning — zero ambiguity across the set"_ is an explicit deployment-checklist item. The form card is the simplest possible interpretation of its content: header, card, one action. The Neighborhood Ring renders six named circles in a ring — an immediately-parsed figure.

**Where OSE violates or ignores it.** The landing hero resolves to two competing simple readings: a place statement (h1) and a signup form (the only interactive element). A visitor cannot tell in one glance whether the page is a directory or a mailing-list capture. The three feature cards below are visually identical containers with different icon treatments — a calendar emoji, a handshake emoji, and a building glyph rendering at a visibly different weight — which breaks the simplest reading of "these are three of the same thing."

**Constraints that limit the fix.** The UEC static gate bounds colour changes. No constraint on layout or icon treatment.

**Stories required.**

- `OSE-XXX [Landing] — One primary reading above the fold, not two` (M)
- `OSE-XXX [Landing] — Consistent icon treatment across the three feature cards` (S)

**Grading rationale.** Not A: the marketing surface has a genuine figure/ground ambiguity about its own purpose. Not C: the product surfaces — which are the ones that matter operationally — are unambiguous by construction.

---

## 13. Law of similarity

**Grade: A−**

**What the law says.** Elements that look alike are perceived as related or as having the same function.

**Where OSE already satisfies it.** UEC is a similarity system in its purest form: same colour ⇒ same function, across every vertical and every event type. `UEC-CODES.md`'s vertical matrix asserts _"Every core code works across all verticals — no vertical requires a different system"_ — similarity held constant across contexts, which is what makes the learned association transfer. `scan_hex` and `display_hex` are separate typed fields so the scannable colour and the marketing colour cannot silently diverge, and `getCode()` is the single sanctioned read path (ADR-012).

**Where OSE violates or ignores it.** `#4361EE` on the landing Ring is close enough to SPONSOR navy `#1A3A8A` to weaken the association without being it. Nothing prevents a future surface picking another near-UEC hue from the general token set.

**Constraints that limit the fix.** ADR-012 and the UEC static gate already prevent the worst case — a surface cannot introduce a _new_ UEC-like colour by literal. The gap is non-UEC brand colours drifting toward UEC hues.

**Stories required.**

- `OSE-XXX [Design] — Perceptual-distance check between brand tokens and every scan_hex` (S)

**Grading rationale.** Not A: no mechanical check stops a brand colour drifting into UEC perceptual space, and one already has. Not B: the type-level separation of `scan_hex`/`display_hex` plus a single sanctioned accessor is enforcement most systems never achieve.

---

## 14. Uniform connectedness

**Grade: C**

**What the law says.** Elements visually connected — by a container, a border, a shared background — are perceived as more related than elements merely near each other.

**Where OSE already satisfies it.** Cards are used consistently and correctly: the form card, each event card on `/events`, and the three landing feature cards are all bordered containers that bind their contents. The dark header band on the form pages connects the wordmark and event name into one identity region.

**Where OSE violates or ignores it.** The survey's legal block is _inside_ the same white card as the form, so uniform connectedness actively works against comprehension — the container says "this is all one thing," binding a 7-line legal notice to a 2-field form. On the landing page, the anonymity block sits in a bordered card at the very bottom, connected to nothing it describes. Nothing visually connects the email field to the promise about what happens to that email.

**Constraints that limit the fix.** None architectural.

**Stories required.**

- `OSE-XXX [Forms] — Move the disclosure outside the form card or into a disclosure container` (S)
- `OSE-XXX [Landing] — Connect the data promise to the data-collecting element` (S)

**Grading rationale.** Not B: the containers are used correctly as a pattern but bind the wrong things on the two surfaces that matter most. Not D: card usage is consistent and deliberate everywhere, which is more than most codebases manage.

---

## 15. Tesler's law

**Grade: B**

**What the law says.** Every system has irreducible complexity. The only question is who absorbs it — the system, the developer, or the user.

**Where OSE already satisfies it.** The clearest case is the anonymity architecture. The complexity of "count the room without knowing the room" is absorbed by the platform — two-database separation, hour-bucketed `scan_bucket`, K=5 suppression, `getCode()` — and the attendee absorbs none of it. They scan a colour. Equally, `phaseToPool()`, `template-clearance.ts` and the `NULL`-is-never-selectable fail-safe absorb regulatory complexity into code rather than into an operator checklist. The item-tracking doctrine (`OCR_STANDARD_declinedRegimes.md`) is conservation of complexity stated as policy: the institution keeps the card, OCR keeps the item.

**Where OSE violates or ignores it.** **The prompt's citation is wrong.** ADR-003 is `self-checking-infrastructure`, not "per-night identity and operator role," and no document in either repo describes moving who-is-in-the-room into a human operator. I cannot grade that decision because I cannot find it. What I _can_ see: the rec-centre operator currently absorbs sponsor-category screening by hand, outside the tool, because no surface lets a host express "not these categories" (OSE-1222). That is complexity pushed to the user **without** the deliberation Tesler requires.

**Constraints that limit the fix.** Absorbing that complexity requires the WHERE-axis wiring, which is blocked on the `legal_clearance_tier` type collision (OSE-1221).

**Stories required.**

- `OSE-XXX [Docs] — Write the operator-role decision the prompt assumes exists, or retract the citation` (S)
- _(Absorption of sponsor-category screening is already OSE-1222.)_

**Grading rationale.** Not A: one identified case of undeliberate offloading, and the ADR that would document the deliberate case does not exist. Not C: the platform's central complexity — anonymity — is absorbed by the system as thoroughly as any system I have graded.

---

## 16. Postel's law

**Grade: C**

**What the law says.** Be conservative in what you send, liberal in what you accept.

**Where OSE already satisfies it.** `getCode()` accepts both id and label, case-insensitively — liberal acceptance at the safest possible boundary, since the output is a closed enum of 11 known codes. `validateCategorySelections` accepts a JSON array and validates membership against `category_registry` rather than requiring exact prior knowledge. ADR-016 fixes a single response contract, which is the "conservative in what you send" half and is genuinely enforced.

**Where OSE violates or ignores it.** Liberal acceptance is deliberately absent on the form validators, and correctly so: they cap field sizes, fail closed on missing required fields, and route to a regulatory pool. `sponsor-promotion.ts` re-validates at promotion with _"malformed JSON fails closed with NO partial write."_ I did **not** find evidence of the cheap, safe liberalisations: trimming leading/trailing whitespace, normalising email casing, or accepting common phone formats. Those are input _normalisation_, not validation relaxation, and their absence is a real UX cost with no security benefit.

**The adjudication this needs (pass two).** Liberal acceptance is safe where the accepted set is closed and the normalisation is lossless and pre-validation: whitespace, casing, phone punctuation. Fail-closed must win wherever acceptance widens the _set of values that reach storage_ — field length, required-field presence, regulatory-pool routing, JSON shape. The dividing line is whether normalisation happens **before** the validator and cannot expand what the validator admits.

**Constraints that limit the fix.** The form-validation invariant (fail-closed, size-capped, pool-routed) is live. The PII invariant bounds what may be stored. Both are Director-of-Security territory.

**Stories required.**

- `OSE-XXX [Forms] — Pre-validation normalisation: trim, lowercase email, strip phone punctuation` (S)
- `OSE-XXX [Forms] — Assert normalisation cannot widen what the validator admits` (S)

**Grading rationale.** Not B: the safe half of Postel is simply not implemented, and the omission is invisible to the user as anything but friction. Not D: the conservative half is enforced properly, and the one liberal accessor that exists (`getCode()`) is at exactly the right boundary.

---

## 17. Postel's law _(duplicate)_

**Grade: —**

**Not gradeable.** This is a transcription error in the source list, identical to item 16. Per instruction, no replacement law was invented and items 16 and 17 were not silently merged.

**Consequence for the audit's arithmetic:** the list contains **19 distinct laws**, not 20. Item 8 is additionally a corollary of item 2 rather than an independent principle, so the list represents **18 distinct principles**. Both collapses are reported here rather than absorbed.

---

## 18. Parkinson's law

**Grade: D**

**What the law says.** Work expands to fill the time available. Corollary for UX: if you give a task more time or space, it takes it — so constrain deliberately.

**Where OSE already satisfies it.** One explicit constraint exists and it is a good one: the **10-second comprehension rule** in `QR-ROUTING.md`, paired with a 480px max width. That is a deliberate time budget on the attendee's attention.

**Where OSE violates or ignores it.** The rule is stated and **never measured**. No test asserts a 10-second comprehension budget; no CI gate bounds the number of elements on a form; nothing prevents a surface growing. And the surfaces have grown — the survey form carries 15 fold elements at 390px, and the landing page runs 2318px (2.7 screens) with its central promise at 87% scroll. Feature-flag count (17) and template count (24 seeded vs 32 documented) are both unbounded by any stated ceiling.

**Constraints that limit the fix.** None. This is the least constrained finding in the audit — nothing architectural prevents adding a density budget.

**Stories required.**

- `OSE-XXX [CI] — Assert a per-surface first-view element budget` (M)
- `OSE-XXX [Docs] — Make the 10-second rule measurable, or retire it` (S)

**Grading rationale.** Not C: the rule is documented on exactly one surface family and enforced nowhere, which is the definition of D. Not F: the rule exists, is specific, is correct, and one surface family (check-in, 6 elements) still honours it.

---

## 19. Occam's Razor

**Grade: C**

**What the law says.** Among competing designs, prefer the one with fewest assumptions and moving parts.

**Where OSE already satisfies it.** Several genuinely razor-clean choices: one URL pattern routes all four form types; `phaseToPool()` is a pure function; `getCode()` is a single accessor; the honesty lexicon replaces a whole class of inflated metrics with counts that are literally true; item-tracking replaces a consent-management system with "don't take the data."

**Where OSE violates or ignores it.** Genuine multiplication of entities, found in this session: `legal_clearance_tier` exists with the same name and two incompatible types across two axes (OSE-1221); the same three regulatory regimes exist in **five** representations (TEXT enum, INTEGER tier, `REGULATORY_POOLS` TS union, BigQuery datasets, brain JSON schemas); `buildShareRotation` and the seeded shuffle are two orderings of one concept. Each was individually reasonable; together they are exactly what the razor forbids.

**Constraints that limit the fix.** OSE-802 gates schema reconciliation. The declined-regimes standard (ratified 2026-09-04) removes two of the five representations by making them refuse rather than route.

**Stories required.**

- _(Consolidation is already OSE-1220 and OSE-1221.)_
- `OSE-XXX [CI] — Flag a new column sharing a name with an existing column of different type` (S)

**Grading rationale.** Not B: five representations of one concept is a serious violation and it silently blocked the governance model for months. Not D: the razor is visibly applied in the newest code, and the violations are documented and ticketed rather than unknown.

---

## 20. Pareto principle

**Grade: C**

**What the law says.** Roughly 80% of effects come from 20% of causes. Find the vital few.

**Where OSE already satisfies it.** The architecture identifies its vital few correctly. The **four QR form pages** are where nearly all attendee interaction happens, and they receive the most design discipline in the codebase: the 10-second rule, 480px cap, 44px targets, a 16-entry `data-testid` table, and per-type feature-flag gating. `UEC-CODES.md` makes the Pareto call explicitly: _"The core codes handle 95% of all event scenarios"_ — 7 codes carry 95% of cases, 4 extensions carry the rest.

**Where OSE violates or ignores it.** Investment does not track the identified vital few. The landing page — 2.7 screens, six ring circles, three feature cards — has received more surface area than the survey form, which is where an attendee's final impression is actually formed. 17 feature flags and 24 templates exist without any stated evidence about which are used. And two of the highest-value surfaces, `/events/:id` and `/poster/:id`, are unreachable behind the Cloudflare challenge (OSE-1211) — the vital few cannot even be _audited_, let alone measured.

**Constraints that limit the fix.** No usage analytics exist by design on anonymous surfaces, so "which templates are used" must be answered from aggregate event rows, not behavioural telemetry.

**Stories required.**

- `OSE-XXX [Data] — Which of the 24 templates and 17 flags are actually used` (M)
- `OSE-XXX [Ops] — Restore auditability of /events/:id and /poster/:id` (M) _(overlaps OSE-1211)_

**Grading rationale.** Not B: the vital few are correctly named in docs but not where effort has gone, and two of them are currently unmeasurable. Not D: the identification is explicit and correct, and the form pages genuinely do carry the deepest design investment.

---

## Raw grade count

| Grade             | Count | Items                                                                                                                                      |
| ----------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **A**             | 0     | —                                                                                                                                          |
| **A−**            | 2     | 9 (serial position), 13 (similarity)                                                                                                       |
| **B**             | 6     | 2 (Fitts), 3 (Jakob), 5 (Miller), 7 (Von Restorff), 12 (Prägnanz), 15 (Tesler)                                                             |
| **C**             | 9     | 1 (Hick), 4 (proximity), 6 (Doherty), 8 (target distance), 10 (peak-end), 14 (uniform connectedness), 16 (Postel), 19 (Occam), 20 (Pareto) |
| **D**             | 2     | 11 (Zeigarnik), 18 (Parkinson)                                                                                                             |
| **F**             | 0     | —                                                                                                                                          |
| **Not gradeable** | 1     | 17 (duplicate of 16)                                                                                                                       |

**Total graded: 19.** Distinct principles represented: **18** (item 8 is a corollary of item 2).

**No A grades.** Two A− grades were withheld from A for the same reason: the behaviour is correct in code but no mechanical gate prevents regression. That is the single most repeated observation in this audit — the codebase reasons well and gates unevenly.
