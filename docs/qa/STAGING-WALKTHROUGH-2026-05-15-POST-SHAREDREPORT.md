# Staging Walkthrough — Post-SharedReport Pre-Launch Pass

**Date:** 2026-05-15
**Target environment:** `https://stg.oursharedevents.com`
**Executor:** mzdan
**Estimated time:** 2–2.5 hours
**Purpose:** Validate the actual customer experience after OSE-272 SharedReport feature shipped (Sessions 1-5 all merged 2026-05-15). The static audit (`REFINEMENT-BACKLOG-2026-05-15.md`) surfaces structural defects; **this walkthrough surfaces experience defects only a human user can find.**

---

## Why this doc exists separately from `STAGING-WALKTHROUGH-2026-05-14.md`

The 2026-05-14 walkthrough was Pulse-1 era. Since then:

- ✅ Sessions 3-5 of OSE-272 merged — SharedReport feature now lives end-to-end
- ✅ Routing matrix (`OCR-docs/OPERATING_SYSTEM.md`) ratified
- ✅ ADR-011 — WKRP consumer boundary pattern locked in
- ✅ Gates 4-6 added (cron-only materialize, cron-only export, read-only read API)

What changed for the customer experience: the new `GET /api/v2/events/:id/shared-report` and `POST /api/v2/events/shared-reports/batch` endpoints exist on prod after deploy. The existing 7 Pulse-1 flows still need re-walking because the architectural underpinning shifted; defects from the 2026-05-14 pass need re-verification.

**Pair with:** `REFINEMENT-BACKLOG-2026-05-15.md` (static audit findings produced by Co-Architect agent in parallel). This walkthrough surfaces experience defects; the backlog surfaces structural defects. **Both lists triage together post-walkthrough.**

---

## How to use this document

Same pattern as 2026-05-14:

- **Open this file in one tab. Open staging in another.** Work top-to-bottom.
- **Don't fix as you go.** Log findings; triage after the full pass.
- **Anonymize** any real attendee data captured during the walkthrough.

### Scorecard symbols

- ✅ **Works.** Behaves as expected.
- ⚠️ **Partial.** Works but with friction (capture the friction in notes).
- ❌ **Broken.** Flow fails for a real user.
- 🆕 **New defect.** Not in the static audit; this walkthrough surfaced it.
- 🚧 **Not yet shipped.** Surface or feature isn't on staging yet.
- ❓ **Couldn't test.** Missing precondition or unclear; capture why.

### Triage labels (apply AFTER the full walk)

- **SHIP-STOPPER**: blocks OSE-15 production launch. Must fix before merge to prod.
- **TRUST-BREAKER**: completes but with friction. Fix before public sponsor/bar-owner outreach.
- **POLISH**: minor. Can ship without; backlog for Phase 1.5.

---

## Preconditions

Before starting, confirm these are TRUE on staging:

| #   | Item                                                                                                               | Source of truth                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 1   | `wrangler.toml [env.staging]` reflects current intent                                                              | Manual check                                                                                                       |
| 2   | `ANON_ID_HASH_PEPPER` is set in Doppler `staging` config                                                           | `doppler secrets get ANON_ID_HASH_PEPPER --project ourcommunityrituals --config staging --plain` returns non-empty |
| 3   | `SHARED_REPORT_SIGNING_SECRET` is set in Doppler `staging`                                                         | Same pattern                                                                                                       |
| 4   | `WKRP_SERVICE_TOKEN` is set in Doppler `staging` (or accept that the batch flow is untestable)                     | Same pattern                                                                                                       |
| 5   | BigQuery datasets `oureventring_general`, `oureventring_hipaa`, `oureventring_coppa` exist in the GCP project      | `bq ls --project=project-7cc9adcd-ed55-47aa-958` shows all three                                                   |
| 6   | At least one event with `status='active'` exists on staging                                                        | Admin events list                                                                                                  |
| 7   | At least one event with `status='archived'` (post-event) exists on staging — needed for SharedReport delivery flow | Admin events list                                                                                                  |
| 8   | The daily cron has run at least once since Sessions 3-5 deployed                                                   | Check cron log; verify `scan_aggregates` and/or `anon_id_returns` has rows                                         |

If any precondition fails: **stop and resolve before continuing.** The walkthrough's signal-to-noise drops to zero if you're testing against an under-provisioned environment.

---

## Flow 1 — Bar-owner activation (NEW critical-path flow)

The bar owner's first-time path: landing → understand product → enter admin → create first event → generate poster. **If this flow has friction, nothing else matters.**

### Steps

| #   | Action                                                                  | What to look for                                                                                                                       | Score | Notes |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| 1.1 | Open `https://stg.oursharedevents.com/` in incognito                    | Landing renders. Hero copy clear. Subscribe form visible. Ring visualization renders correctly. Mobile layout works (resize to 375px). |       |       |
| 1.2 | Click "Admin" in header                                                 | Lands on admin page. Auth gate clear if not logged in. If logged in: dashboard renders.                                                |       |       |
| 1.3 | Create a new event with minimum required fields (title, date, location) | Form submits. Success state shows. Event appears in list.                                                                              |       |       |
| 1.4 | Open the event from the list and inspect it                             | Detail page loads. All entered data visible. Edit affordances clear.                                                                   |       |       |
| 1.5 | Generate poster from the event detail page                              | Poster page renders. QR code visible. Print-preview correct on Chrome+Firefox.                                                         |       |       |
| 1.6 | Print the poster (or print-preview)                                     | Print stylesheet works. QR code crisp at print resolution. No "Admin nav bar" leaks into print.                                        |       |       |
| 1.7 | Walk away. Come back tomorrow. Find your event.                         | (Mental model check) — can you find your way back without bookmarks? Is the URL guessable?                                             |       |       |

### Notes (Flow 1)

_Capture any specific friction here. Examples: "Step 1.3 — the date input format wasn't clear, I tried `5/15/26` and got `Invalid date` with no help text"._

---

## Flow 2 — Attendee conversion (the QR scan + form flow)

Walk into a venue, see a poster, scan the QR with your phone, complete the form.

### Steps

| #   | Action                                                                                | What to look for                                                                                                                                  | Score | Notes |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| 2.1 | On a mobile device, scan the poster QR code from Flow 1.5                             | Lands on form page. Form is mobile-readable without zooming. Touch targets ≥44px.                                                                 |       |       |
| 2.2 | Submit the registration form with valid data                                          | Success state shows immediately. Clear "what happens next" copy. No raw JSON visible.                                                             |       |       |
| 2.3 | Submit the same form again with the same email                                        | Duplicate handling clear. User isn't told "internal error" — they get specific feedback.                                                          |       |       |
| 2.4 | Submit the form with an obviously invalid email (`abc`)                               | Validation fires before submit. Error copy clear. Field highlighted.                                                                              |       |       |
| 2.5 | Disable JavaScript, refresh the form, submit                                          | Form still functional (or shows a clear "JS required" message — not a blank page)                                                                 |       |       |
| 2.6 | Re-scan after submitting — does the form remember you, or invite you to submit again? | Behavior matches your intent. If invite-again: that's per-event-anonymous, OK. If "remembers" via cookie: confirm anon_id is the only identifier. |       |       |

### Notes (Flow 2)

---

## Flow 3 — Sponsor visibility

Sponsors paid for surfaces. Confirm their impressions render.

### Steps

| #   | Action                                                         | What to look for                                                                   | Score | Notes |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----- | ----- |
| 3.1 | View the public event page for an event with assigned sponsors | Sponsor strip renders. Logos load (not broken images). Click destinations correct. |       |       |
| 3.2 | View the same event on a form page                             | Sponsor strip on form page. Impression logged in DB.                               |       |       |
| 3.3 | View the same event in the poster page                         | Sponsor branding integrated into poster. Print preview keeps it.                   |       |       |
| 3.4 | Click a sponsor link                                           | Click logged. Destination opens in new tab. Original page state preserved.         |       |       |

### Notes (Flow 3)

---

## Flow 4 — Public event page phase transitions

The same event URL renders differently in pre/live/post phases. Verify each.

### Steps

| #   | Action                                                                                            | What to look for                                                                | Score | Notes |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----- | ----- |
| 4.1 | View an event whose start_date is >24h in the future                                              | "Pre-event" render: full 5W content, RSVP CTA, anonymity affordance at bottom   |       |       |
| 4.2 | View an event whose start_date is past but end_date is in the future                              | "Live" render: hero shows "LIVE NOW", CTA flips to Check-in                     |       |       |
| 4.3 | View an event whose end_date is in the past                                                       | "Post-event" render: minimal "this event has ended" stub                        |       |       |
| 4.4 | View an event in `draft` status                                                                   | 404 (not renderable per state machine) — and the 404 is friendly, not JSON dump |       |       |
| 4.5 | Anonymity affordance appears on pre + live; verify copy is what you'd want a bar customer to read | Copy passes the "would a 65-year-old bar regular understand this?" test         |       |       |

### Notes (Flow 4)

---

## Flow 5 — SharedReport delivery (the value-delivery flow — NEW post Session 5)

This is the moment a bar owner sees what they paid for. **Highest-leverage flow for product validation.**

### Steps

| #   | Action                                                                                                                                                         | What to look for                                                                                              | Score | Notes |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| 5.1 | Mint a signed-link token for an archived event you own (see `OCR_PROMPT_storyRunnerPrecheck.md` for the CLI; or use the admin → "Send report" UI if it exists) | Token mints successfully. Link is shareable.                                                                  |       |       |
| 5.2 | Open the signed link in incognito                                                                                                                              | SharedReport page renders. **Not** raw JSON. Aggregate fields visible.                                        |       |       |
| 5.3 | Inspect the response: does it contain `anon_id_hash` anywhere?                                                                                                 | Must NOT. Gate 6 enforces this; verify visually.                                                              |       |       |
| 5.4 | Check the suppression copy when a field is null                                                                                                                | "Corridor density: still building baseline (3 of 10 events)" — readable, not "below_min_sample_size" raw code |       |       |
| 5.5 | Try the same link in a different browser session                                                                                                               | Still works (signed link doesn't bind to a single session)                                                    |       |       |
| 5.6 | Try opening the link 7 days from now                                                                                                                           | Still works if within token TTL (7d default)                                                                  |       |       |
| 5.7 | Try the wrong event ID with the same token                                                                                                                     | 403 with friendly copy ("This link is for a different event")                                                 |       |       |
| 5.8 | If the SharedReport page exists at `/sharedReport` (handleSharedReportPage) — does it match the read API response shape, or are they two different surfaces?   | **Critical question for Phase 1**: there should be ONE bar-owner-facing report surface, not two.              |       |       |

### Notes (Flow 5)

_If 5.8 reveals two surfaces, that's a structural defect worth ADR-013. Capture the gap; don't try to fix in walkthrough._

---

## Flow 6 — Admin signed-link generation (the bar-owner-onboarding moment)

How does a bar owner actually GET their signed link to view a report?

### Steps

| #   | Action                                                         | What to look for                                                                                 | Score | Notes |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----- | ----- |
| 6.1 | In admin, find the event whose report you want to send         | Event findable. Filtered/sorted as you'd expect.                                                 |       |       |
| 6.2 | Generate a signed link for the bar owner                       | UI exists? Or CLI-only? If CLI-only, this is a TRUST-BREAKER for launch — bars can't self-serve. |       |       |
| 6.3 | Verify the link has the right TTL and role claim (`bar_owner`) | Inspect the token; confirm shape                                                                 |       |       |
| 6.4 | Send to the bar owner (email? text? copy-paste?)               | What's the actual delivery channel? Is there UI for it?                                          |       |       |

### Notes (Flow 6)

_This flow most likely exposes the gap between "we shipped the API" and "bar owners can use it." Highest probability of finding a launch-blocker._

---

## Flow 7 — Negative + edge cases

The flows that break customers when they're testing the platform's edges.

### Steps

| #   | Action                                                               | What to look for                                                                  | Score | Notes |
| --- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----- | ----- |
| 7.1 | Hit `/api/v2/events/:id/shared-report` with no token                 | 401 with `WWW-Authenticate` header; body is friendly JSON, not "UNAUTH" code dump |       |       |
| 7.2 | Hit `/api/v2/events/shared-reports/batch` with `{ids:[]}`            | 400 with clear error                                                              |       |       |
| 7.3 | Hit `/api/v2/events/shared-reports/batch` with 51 IDs                | 400 with the cap stated in the error                                              |       |       |
| 7.4 | Submit a form with whitespace-only fields                            | Validation rejects; field-level error                                             |       |       |
| 7.5 | Trigger a 500 deliberately (e.g., malformed JSON to a POST endpoint) | Response is JSON `{ok:false, error:"..."}` — not an HTML stack trace              |       |       |
| 7.6 | View a route that doesn't exist (`/foo/bar`)                         | 404 with friendly copy + nav link back to landing — not JSON                      |       |       |

### Notes (Flow 7)

---

## Triage after the walkthrough

When you've worked through all 7 flows:

1. **Tally** the ❌ and ⚠️ count per flow. Highest counts = highest-leverage refinement target.
2. **Compare** with `REFINEMENT-BACKLOG-2026-05-15.md` static-audit findings. Defects in BOTH lists are ship-stoppers. Defects in only one are triage-on-context.
3. **Filter** by triage label: SHIP-STOPPER → must fix before OSE-15 launch. TRUST-BREAKER → fix before sponsor outreach. POLISH → Phase 1.5.
4. **Hand back** to Co-Architect: the SHIP-STOPPER list is what we iterate on first. Each fix gets its own focused PR (per `OPERATING_SYSTEM.md` cadence).

---

## What this walkthrough is NOT

- ❌ **Not** a unit / integration test suite — those live in `tests/*.spec.ts`
- ❌ **Not** the cron / BigQuery export operational check — those live in `STAGING-SMOKE.md`
- ❌ **Not** the contract verification check — Newman handles that (Flow 7 of 2026-05-14 walkthrough)
- ✅ **IS** a real-human "would I, as a bar owner, get value from this and not get frustrated?" check

Once Flow 1-7 are complete and triaged, the engineering refinement work begins.

---

## References

- Pulse-1 baseline: [`STAGING-WALKTHROUGH-2026-05-14.md`](./STAGING-WALKTHROUGH-2026-05-14.md)
- Companion static audit: [`REFINEMENT-BACKLOG-2026-05-15.md`](./REFINEMENT-BACKLOG-2026-05-15.md) _(generated in parallel)_
- Smoke checks: [`STAGING-SMOKE.md`](./STAGING-SMOKE.md)
- Routing rule for this doc: `OCR-docs/OPERATING_SYSTEM.md §3` — per-repo QA → `<repo>/docs/qa/`
