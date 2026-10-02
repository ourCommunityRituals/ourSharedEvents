# CCR — PR #754 "See it before you publish" (2026-10-02)

**Target:** ourCommunityRituals/ourSharedEvents#754, branch `claude/ecstatic-ride-ibzx2r`.

- Assessed head: `6965bcd`.
- Corrected head: `44100ec`.

**Protocol:** CCR v3.0 (`.claude/skills/ccr-protocol.md`), 5 loops, gate 95%.

- Weights: Critical 15 · High 10 · Medium 5 · Low 2.
- Deductions apply only to unresolved findings _in this change_. A pre-existing behaviour this change does not alter goes to a follow-on, not a deduction.

**PO frame:** an organizer who is not a web designer sees the event page, poster and TV while the event is a draft. They can go back and forth, fat-finger, publish, decide they don't like it, unpublish, change, and republish, over and over.

**Lenses:** PO · BE · FD · Sr Design FE · Sr QA Automation · SRE/SDET · DevOps · Security · **Data Scientist** (never-who, counting and attribution integrity, aggregate effects).

## Evidence gathered before scoring

- **`poster.html` sends no impression, click or beacon calls.** `grep -nE "impression|sendBeacon|/click"` finds nothing. A poster preview cannot add sponsor impressions.
- **Previews write nothing.** Both preview specs assert that `status` and `is_published` are unchanged after opening the page and the bundle (`admin-draft-preview.spec.ts`, `admin-poster-preview.spec.ts`).
- **Publish and Undo are plain status updates, with no emissions.**
  - `handlers/qr-verify.ts:21`: `UPDATE events SET status='active', qr_verified=1`.
  - `handlers/qr-verify.ts:53`: `status='ready', qr_verified=0`.
  - The wizard drives these through the same `moveEventTo` router the dashboard uses.
- **Form submissions to a non-active event return 410** (`router.ts`, public forms guard). A scan of a draft's test print can store no PII.
- **CI on `9a4709e`/`6965bcd`.** The only reds were on superseded heads (the T0 Back-rule assertion, already updated) and one CodeQL test-regex alert, fixed in `6965bcd`.
- **Full workers pool, local:** 3514/3515. The one failure was a print-rule assertion written before the CSS was compacted; it passes now (7/7).

## Loop 1 — Critical (what would break this?) · score 82

| #   | Lens                | Finding                                                                                                                                                                                                                                | Sev        | Status                        |
| --- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------- |
| C1  | PO / FD             | **The publish loop could strand the organizer.** For a live event kept off the map (`is_published=0`), the event preview 303'd to `/events/:id`, which 404s by design. So Preview after Publish said "We couldn't find that event".    | Medium (5) | Fixed `44100ec`               |
| C2  | Sr Design FE        | **The wizard's Copy, Preview and Pause controls were about 30px tall**, under the repo's 44px floor (OSE-1236). The phone audit does not reach wizard step 4.                                                                          | Medium (5) | Fixed `44100ec`               |
| C3  | Data Scientist / PO | **A test print of a draft poster looks exactly like the real one.** The preview bar is hidden in print by design. Its QR codes are real but carry no placement, so scans of a test print hung early are not attributed to a placement. | Low (2)    | Open → OSE-1508 (PO decision) |
| C4  | SRE / PO            | **Unpublish has a lag:** the TV drops the event at its next 5-minute refresh, and a guest's browser may keep the public JSON for up to 60 s plus 300 s of stale-while-revalidate.                                                      | Low (2)    | Pre-existing → OSE-1508       |
| C5  | Data Scientist      | **The corridor readiness latch is permanent** (`lib/corridor-latch.ts`, INSERT OR IGNORE). A mistaken publish still live at the nightly cron can latch a corridor. This PR makes publish/undo easier, so it raises the odds.           | Low (2)    | Pre-existing → OSE-1508       |
| C6  | Security / SRE      | **The new admin poster-bundle is unthrottled**, drawing QR PNGs on every call. It sits behind Access, `requireAdmin` and the object-scope guard.                                                                                       | Low (2)    | Open → OSE-1508               |

The serialized-save race (High) and the `aria-pressed` contradiction (Medium) were found by Copilot and fixed in `9a4709e`, before this CCR's head. They are recorded, not scored.

**Gate:** 82 < 95. Stop and correct C1 and C2 (reactive correction), then re-score.

## Loop 2 — Conservative (smallest version that still ships value?) · score 96

- **Keep the TV demo, the previews and the loop.** Together they are the PO's stated differentiator. Cutting any one leaves "see before you publish" half-true.
- **Keep the 44px fix on all `.wizard-copy-btn`.** It also lifts the existing Copy buttons; scoping it to only the new controls would leave known debt beside new code.
- **Defer the browser journey** (OSE-1508). jsdom runs the real wizard script end to end, and Workers tests run the real routes. A browser adds layout and tap measurement, not new logic.
- **Reclassify C4 and C5 as follow-ons:** both behaviours predate this PR, which does not change them. No deduction.
- **Open in this change:** C3 and C6 (Low, 2 each).

**Score:** 100 − 4 = **96 ≥ 95.** Advance.

## Loop 3 — Recursive (what does this imply we haven't done?) · score 96

| Item                                                                                                                                                                                               | Tag                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Browser journey in the blocking phone audit: create → previews → TV → publish/back/undo/republish, with 44px measured on step 4 (OSE-1508)                                                         | **required** (tracked)   |
| Root `CLAUDE.md` §3 FD/BE current-state lines for the new routes, wizard previews and loop. This is a governance edit and needs human review; do it after merge, per §5.                           | **required** after merge |
| Feed into the end-to-end flows map the PO asked for: Create Event, Create Sponsor, list, map, OSE/OW/Hybrid, Back flows, sponsors between titles and content, poster → public with address and map | recommended (next work)  |
| PO decisions: test-print mark (C3), latch rule (C5), admin bundle limit (C6), unpublish lag text (C4)                                                                                              | recommended (OSE-1508)   |
| Data Scientist: the audit log gains one row per status hop, so publish/undo loops leave a full trail. That is good for accountability; no aggregate count is affected.                             | nice-to-have note        |

**Confidence check:** no new defect _in this change_ surfaced (the coverage gap is tracked), so the score holds at **96**.

## Loop 4 — Verification of the corrections (evidence, not assertion) · score 96

**C1, fixed (`pages.ts`):**

- Live and listed still redirects to `/events/:id`.
- Live but unlisted renders the preview in place: "Live, unlisted", no Publish button.
- Tests in `admin-draft-preview.spec.ts`:
  - +2 tests: live listed returns 303; live unlisted returns 200 and asserts the public page itself is 404.
  - Red on the previous `pages.ts` (1 failed / 5).

**C2, fixed (`admin.html`):**

- `.wizard-copy-btn` gets `display:inline-flex; align-items:center; min-height:44px`.
- Tests in `admin-wizard-tv.spec.ts`: +1, red on the previous `admin.html` (1 failed / 18).

**Regression evidence at `44100ec`:**

| Check                                             | Result                   |
| ------------------------------------------------- | ------------------------ |
| `tsc --noEmit`                                    | clean                    |
| node project                                      | 1492/1492                |
| workers specs touching admin/poster/preview/pages | 1904/1904                |
| invariants shard                                  | 202/202                  |
| testids `--check`, embedded-JS lint               | clean                    |
| design check vs main baseline                     | OK (admin 63925 → 63503) |

**Earlier deliberate breaks, all still red-proven:**

- unscoped TV link;
- league dropped;
- last-screen guard removed;
- pause ignored;
- step-5 Back removed;
- preview flag ignored;
- archived made previewable;
- poster on the public bundle;
- wizard QR codes on the public bundle;
- parallel saves;
- `aria-pressed` restored.

## Loop 5 — Stability (has confidence held, honestly?) · score 96

Trajectory: 82 → (corrected) 96 → 96 → 96. Nothing decayed after the correction. The two remaining deductions are Low, introduced by this change, and need a PO decision rather than code. Both are filed with owners and done criteria (OSE-1508).

**Not yet verified here:**

- CI on `44100ec`, including the blocking phone audit, T0 and CodeQL.
- A human review of the PR.

## Final synthesis

**Verdict: HELD.** The work is sound at 96%. It passes only once CI is green on the corrected head.

**Holds (convert HELD → PASS):**

1. CI green on `44100ec`: T0 Gate, the blocking phone audit, CodeQL, the reconciler.

**Top three concerns:**

1. The publish loop stranding unlisted events on a 404 (C1, fixed).
2. Below-floor tap targets on the new wizard controls (C2, fixed).
3. Draft test prints that look live and carry unattributed QR codes (C3, PO decision).

**Top three follow-ons:**

1. The browser journey for the full loop in the blocking phone audit (OSE-1508).
2. The `CLAUDE.md` §3 update after merge (governance; needs human review).
3. The PO decisions on the latch rule and unpublish lag, so "take it back" leaves no trace (OSE-1508).
