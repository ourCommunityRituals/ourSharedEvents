# CCR — PR #700 (TRIANGLE next slices) · extended scrum team · 3 loops

**Date:** 2026-09-30 · **Target:** `ourCommunityRituals/ourSharedEvents#700`, branch `claude/exciting-volta-2t92o2` @ `2dcd275` (10 commits, 37 files, +2886/−67) · **Method:** five independent read-only reviewers, each covering two roles:

- Security + Lead BE
- Lead FE Integration + Sr Design FE
- Sr Automation QA + SRE/SDET
- DevOps + PO
- Data Scientist, on the never-who protocol

Every finding below marked **VERIFIED** was re-checked against the code by the coordinating session. CI on `2dcd275` was fully green at review time. The staging T1–T4 stages were skipped, as they are for every feature branch.

**Verdict: HELD.** The consent model and never-who invariants hold, and nothing here breaks deploy. The holds are listed at the end. They are: one CSRF regression on the consent write, request-lifecycle dead ends, a pre-existing landing colour bug that the new map now depends on, a label race, test and CI gaps, and governance (ADR-019, STORIES, Linear, doc accuracy). Two of the holds are PO decisions.

---

## Loop 1 — Critical (what would break this?)

### Security and consent

1. **High (VERIFIED). CSRF defence missing on the organizer's consent write.** `handleAdminAnswerSponsorRequest` (`handlers/sponsor-home.ts`) calls `request.json()` with no `application/json` Content-Type check. Its sibling admin writes (`sponsors.ts parseBody → isValidContentType`) do check. A cross-site `<form enctype="text/plain">` can carry a JSON-shaped body. If the CF Access cookie rides a cross-site POST, a sponsor could get an organizer to approve the sponsor's own request, which defeats ADR-019's two-sided consent. Fix: reuse the content-type check and add a body cap.
2. **Medium (VERIFIED). ADR-019 is extended in code but the ADR itself is unchanged.**
   - The ADR justifies organizer-side permissiveness, `COALESCE(organizer_accepted,1)=1`, on the grounds that "the organizer created the placement". Sponsor requests are the first placements the organizer did not create.
   - Today their consent rests only on `is_active = 0`. Any future writer that sets `is_active = 1` would publish a request with `organizer_accepted = NULL`.
   - The CLAUDE.md ADR alignment rule requires the ADR to be amended in the same change set. Defence in depth: the public resolvers should also require `organizer_accepted = 1` when `source = 'sponsor_request'`.
3. **Medium (VERIFIED). Request lifecycle dead ends.**
   - The organizer's normal attach (`PUT … INSERT OR IGNORE`, `sponsors.ts`) silently no-ops and returns 200 when a request row already holds the `UNIQUE(sponsor, event)` slot, whether waiting or declined.
   - A decline cannot be reversed.
   - Waiting requests on events that are later archived, unpublished or over still count toward `MAX_OPEN_REQUESTS`, so a sponsor can be locked out of discovery permanently. There is also no withdraw path and no expiry.
4. **Low (VERIFIED).**
   - The open-request cap is count-then-insert, not atomic. It is bounded by the per-IP route limit.
   - The admin SharedReport sponsor mint (`shared-report-read.ts:432`) treats any placement row, including a waiting or declined request, as proof of membership.
   - Declining does not bust the sponsors cache.
   - A leaked sponsor link now carries a write capability for 30 days, with no per-link revocation.

### Never-who (Data Scientist)

5. **Launch requirement (VERIFIED; the PO made this a launch blocker).** Sponsor discovery and the landing map read event fields without going through the public projection allowlist (`toPublicEvent`). This is harmless today, but OSE-1245's location-precision policy (for example, hiding a private-home address) would not reach these paths. **Resolved during review:** both now go through `toPublicEvent`, and a test replaces the projection with a stricter policy to prove both surfaces follow it.
6. **Low (VERIFIED).** "Your requests" keeps showing an event after it is unpublished or archived. The sponsor already saw that event, so nothing new leaks about a person, but it is stale.
   - **Invariants checked and holding:**
     - #1: two-DB separation, no FORMS_DB join.
     - #7: aggregate-only and the K=5 floor. No new attendee-derived number appears; sponsor reach is still floored.
     - Never-who: the map counts events, not people, and draws only res-7 cells.
     - Sponsor-signal never-who.
     - Cost-metric never-who: `OPERATION_COST` is untouched.
     - #9: tenant isolation.
     - #5: tier-blind.

### Front end and design

7. **High (VERIFIED, pre-existing since #640, 2026-09-22). The landing page's colour tokens refer to themselves** (`landing.html`: `--accent: var(--accent, …)`, and likewise for `--bg`, `--surface`, `--text` and `--on-accent`). That is a cycle, so all of them compute to nothing:
   - The attendee map renders black on black, and its shading, which encodes density, is lost.
   - The selected filter pill loses its highlight.
   - Dark mode shows a white page.
   - The map is the first feature to depend on these tokens for meaning.
8. **Medium (VERIFIED).**
   - Approve/Decline does not reload on a 409 ("already answered"), so stale buttons remain, and both buttons are not disabled while a request is in flight.
   - Focus is lost after an answer.
   - The buttons use `.spon-action-btn`, which has no 44px minimum, and the phone audit does not measure this card.
9. **Medium (VERIFIED).**
   - The hex numbers render at about 10px at 375px width.
   - The map ignores the landing's type, modality and date filters, and the caption does not say so.
   - Sponsor-home section titles are `<p>`, not headings, so screen readers cannot navigate the new sections.
10. **Low (VERIFIED).**
    - A new attribute sink uses `esc` instead of `escAttr`. Ids are server-minted, so it is not exploitable.
    - The "Near you" pill reuses the "Live" colour.
    - `<figcaption>` sits in the wrong position.
    - A waiting request on a deactivated sponsor shows contradictory row text.

### QA and SRE

11. **Medium (VERIFIED). Admin list label race.** A filter or sort change made during a load is now queued (ae8ed05), but the in-flight response still renders once under the new label ("Published" or "soonest first") over rows fetched for the old query. That can also make the new Soonest-first browser test flaky. Fix: snapshot `{status, mine, sort}` for each request and drop stale responses.
12. **Medium (VERIFIED). Gaps in the tests and in CI triggers.**
    - The cap test cannot catch an off-by-one: the 5th status is never asserted.
    - `mobile-workability-audit.yml` paths omit `lib/sponsor-discovery.ts`, `lib/admin-events-upcoming.ts` and other `lib/` renderers, so "PR-gating E2E" is overstated.
    - No test targets the reset race deliberately.
    - The attendee-map SVG state is never rendered in a browser, because CI's seeded events have no coordinates.
13. **Medium (VERIFIED). `measure-startup.mjs` and the startup-cost doc.**
    - The script restores `admin.html` only on SIGINT or normal exit. Temp stub and config files sit un-ignored in cwd, and the temp dir is never removed.
    - The doc over-claims:
      - "−0.1 ms" is inside a 15 ms noise band. Say "not measurable locally", backed by the mechanism: text modules are never parsed as code.
      - The 32 MB reservation is measured locally, not on Cloudflare.
      - The lazy-load advice omits that the landing page now calls h3 through the map.
14. **Low.**
    - The new routes appear in cost-metric labels as `:x`, because their segments are not in `STATIC_SEGMENTS`.
    - Refused sponsor asks are not audited.
    - The INV9 exemption is keyed to a line number. This is its 5th shift.

### DevOps and PO

15. **Medium (VERIFIED). Governance and traceability.**
    - STORIES.md is untouched: TRI-3, TRI-4 and TRI-5 are still unchecked, and sponsor discovery has no story.
    - The PR body lacks `Part of OSE-1245` (the Epic TRIANGLE convention), so nothing links it to Linear.
    - The title says "admin split", which was measured, not done.
    - CLAUDE.md §4 still has the old "case for splitting got stronger" bullet beside the new "maintainability only" bullet.
16. **Medium (VERIFIED; PO decision). The attendee map's density gate departs from §6.2b** as the codebase records it (`corridor-readiness.ts`, `events-map.ts`).
    - It counts across the whole brand, not per corridor, so 5 events in 5 corridors draws 5 lone hexes.
    - It does not latch, so the landing flips between map and "thin" as events wrap up.
    - The landing has no reader corridor, so a global gate may be intended, but the decision must be recorded.

**Verified sound (no action needed):**

- The upcoming keyset SQL: ordering and continuation match for all three bands, bind order is correct, and no cursor value is spliced into SQL.
- Every public `sponsor_placement` reader requires `sp.is_active = 1`.
- No schema or migration risk from `source = 'sponsor_request'`: the column has no CHECK constraint and no enumerating validator.
- The design-check baseline drop removed a phantom measurement, not real CSS.
- The signing secret is random per run.
- Playwright 1.62 runs webServer before globalSetup.

## Loop 2 — Conservative (smallest version that still ships value)

1. **Keep:**
   - The organizer inbox, Soonest first and the reset-race fix: admin-only and low risk.
   - Sponsor discovery with two-sided approval, once holds 1–3 are done. This is the core of the sponsor corner.
   - The `/sponsor` browser E2E and the audit seeding. This is the biggest gain in test coverage.
   - The startup measurement, with softened wording. It re-scopes step 7 on evidence.
2. **Keep, but gated on a PO decision:** the attendee map. Either:
   - (a) the per-corridor gate plus a latch, or
   - (b) ship the global gate labelled as interim in `attendee-map.ts` and the screen map, or
   - (c) hold the SVG and ship only the legend and the thin state.

   It also needs the landing token fix (#7) before it can mean anything.
3. **Defer:**
   - Sponsor withdraw and request expiry, beyond scoping the cap count to live events.
   - An index-friendly UNION ALL ordering.
   - A map that redraws under the landing's filters. Change the caption instead.
   - Paging for discovery.
   - Keying the INV9 exemption to a marker instead of a line number.
   - A distinct "Near you" style.
4. **Cut:** "admin split" from the PR title. The lazy-h3 recommendation stays open, not advised, until the landing caveat is written in.
5. **Split the PR?** The per-slice commits make a split cheap. The DevOps/PO seat recommends splitting by risk profile. The alternative is to keep one PR, since CI is green on the whole and review can go commit by commit. **This is a PO decision.**

## Loop 3 — Recursive (what this implies we should also do)

1. **Required:**
   - Amend ADR-019 for sponsor-initiated placements.
   - Update STORIES.md (TRI-3/4/5, plus a sponsor discovery story).
   - Add `Part of OSE-1245` to the PR body.
   - Fix the stale CLAUDE.md §4 bullet.
   - Add Bruno cases for `POST /api/v2/sponsor/requests`, `POST /api/v2/admin/sponsor-requests/:id/respond` and `?sort=` (CLAUDE.md §5 done-gate level 6).
   - Widen the workflow paths.
2. **Recommended:**
   - A browser test that delays `/api/v2/admin/events` to exercise the reset race.
   - Seed a map-state landing page in the phone audit.
   - Status asserts on the negative "not public" checks.
   - Cost-label segments for the new routes.
   - Audit refused sponsor asks.
   - Make the SharedReport sponsor mint require an active, organizer-accepted placement.
   - Update the `source` enumeration comments (`0067`, `sponsor-resolver.ts:208`, `seed-sponsor.ts:53`).
   - Register the new audit actions in the brain.
   - Note on OSE-1245 that every event read path must go through `toPublicEvent` (now enforced for these two by test).
   - Add a structural 0-architecture assertion that `attendee-map.ts` never reads `lat`/`lon`.
3. **Nice to have:**
   - A per-link revocation list (jti) for sponsor-home tokens.
   - Hash the IP in the rate-limit KV key, and correct the "never stored" comment in `public-read-limit.ts`.
   - Handle the antimeridian in the map bounding box.
   - A site-wide `/favicon.ico`.
   - A computed-style contrast assertion for the map. Its absence is why #7 passed CI.

---

## Synthesis

**Verdict: HELD.**

**Top three concerns:**

1. The CSRF gap on the consent write (L1 #1).
2. The landing token cycle, which makes the new map meaningless and has broken the landing's accent and dark mode since 2026-09-22 (L1 #7).
3. The request lifecycle dead ends: a silent attach no-op, irreversible declines, and stale requests locking sponsors out (L1 #3).

**Top three follow-ons:** amend ADR-019 · Bruno cases for the new endpoints · a map computed-style/contrast gate.

**Holds (HELD → PASS once all resolve):**

1. CSRF: content-type check and body cap on the admin answer route.
2. ADR-019 amendment, plus the strict resolver clause for `source = 'sponsor_request'`.
3. Request lifecycle: the attach reports a waiting request instead of silently doing nothing, the organizer can reverse a decline, and the cap counts only live-event requests.
4. The landing token cycle is fixed.
5. Approve/Decline: reload on 409, disable both buttons in flight, 44px minimum.
6. The admin list label race: per-request state snapshot and dropping stale responses.
7. The cap test asserts the exact status sequence, and the workflow paths are widened.
8. `measure-startup.mjs`: SIGTERM/SIGHUP restore and gitignored temp files; the doc and CLAUDE.md §4 wording softened, plus the landing caveat.
9. Governance: STORIES.md, `Part of OSE-1245`, the PR title, and the stale CLAUDE.md §4 bullet.
10. Bruno cases for the new endpoints.
11. ✅ The launch requirement: discovery and the map go through `toPublicEvent`. Done in review, with a test.
12. **PO decision:** the attendee map gate (per-corridor plus latch, labelled interim global, or legend only).
13. **PO decision:** split the PR or keep it whole.
