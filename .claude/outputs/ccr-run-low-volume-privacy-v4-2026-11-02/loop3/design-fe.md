# Loop 3 (Adversarial), Sr Design FE lens, epic OSE-1766, subject v4 frozen

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim.

No score and no gate decision. Basis tags: **source-read** (opened in this run), **arithmetic**, **inferred**. **Nothing here is proven at runtime.** I ran no server, no browser and no test. I could not run `oseEventView` or a staging curl.

Code paths are under `C:\Users\mzdan\dev\ourCommunityRituals\ose-clock-gate\workers\oursharedevents\`. The design-system files are under `C:\Users\mzdan\dev\ourCommunityRituals\packages\ui\design-system\`.

Design-system read: HANDOFF.md and README.md. The rules I judged against:

- Colour from tokens only.
- One `<h1>` per page.
- Touch targets at least 44 px (the spine targets 48).
- Input text at least 16 px.
- Nothing below 13 px.
- Both themes.
- 320 px with no sideways scroll.
- "Details behind a tap", with plain, warm, short-word copy.

I found no raw hex in `privacy.ts`, `never-who.ts` or `live-monitor.ts`. All three use `var(--…)` tokens.

---

## 1. Attack cards

### Card R1-03: withheld words, hover-only `title`, the 1 px spark bar (S4 shows the open hour in withheld words)

- **Actor.** A hostile organizer who has no wish to read the leak (the leak is OSE-1780's). They want a false-statement lever. Their sponsor's lawyer reads the sponsor home. A bot swarm is not needed.
- **Goal.** Show that a published word ("Held", "fewer than 5", "Scans fewer than 5") is false while an open hour holds at least 5 scans. Show that the guidance copy is false too. Or, for the organizer, use the false "held" to claim the platform hides their reach.
- **Steps (all source-read).**
  1. Put 80 scans at one poster in the current hour. Under S4, `readEventScanCells` stops counting the open hour (subject C.10).
  2. The live view renders the tile through `live-monitor.ts:121-125`. A suppressed value draws `'Held'`. Its only explanation is `b.setAttribute('title', 'Fewer than ' + v.floor + ' so far')` at `:125`. A `title` on a non-focusable `<b>` is mouse-only: touch has no hover and keyboard users never reach it. S4 AC4 puts "Scan counts show each hour about 15 minutes after it ends" in the sub-line. But `live-monitor.ts:188` and `:192` rewrite the `role="status" aria-live="polite"` line every 30 s (R2-20). The static `lv-note` at `:106` ("Counts only…") is where the lag copy belongs.
  3. The day cards (`live-monitor.ts:164-168`) read "Held" or a number. Under S4 today's card is a sum of sealed hours only, with no label saying so (R1-03 as registered).
  4. The admin pre-event card (`src/templates/admin.html:8431-8461`): a held day is `held: n === null`, and `count || 0` turns it into a 1-unit bar. The SVG viewBox is 40 high and the SVG is 48 px, so 1 unit is 1.2 px (arithmetic). It is drawn at `opacity .3` of `currentColor` (`:8456`). A 30%-opacity 1.2 px bar on a card ground is far below the 3:1 non-text contrast floor (inferred from the opacity; I did not measure the pair). Its only "held" label is an SVG `<title>` child (`:8457-8458`). That is hover-only. `role="img"` plus `aria-label` (`:8447`) hides the child titles from assistive tech. The label says "N on the days shown, M today". Held days are summed as 0 (`:8439-8443`), so that "total" is an understatement presented as a total. Under S4, "today" is sealed hours only. The label is not touched by any S4 AC (AC4 and AC5 name the live status line and the timeline detail only).
  5. The sponsor home says "So far: … · fewer than 5 poster scans" (`src/lib/sponsor-home-render.ts:115-117`, `:132`). That is a paying sponsor reading a false word, with no lag copy on that surface. `src/handlers/live-monitor.ts` and `admin.html` are the two surfaces S4 AC4 and AC5 cover. I count at least 8 surfaces that print the withheld state.
  6. The timeline step "Report" reads "Fills in once people start scanning" (`admin.html:8176-8177`). The next step stays "share the link" while an active event shows no published scan figure (`anyScans` ticks only on a published count). S4 AC5 changes only the "People scanning" detail.
- **What the attacker needs.** An event and a poster. No access beyond a normal organizer or sponsor login. Cost: 80 `/q` hits.
- **What the criterion shows while the attack runs.** S4 AC4 (jsdom asserts the sentence in the live view), AC5 (jsdom asserts the timeline sentence) and AC2 (registry values unchanged for an unsealed row) all pass. They are all satisfied by the sealed-hours fix itself.
- **Success condition.** The attacker holds a screenshot per surface of the statement "fewer than 5" printed while the raw count is 80, plus 75 or more minutes of wrong "next step" guidance. The floor and never-who are not broken (every figure is still a sum of floored cells). The harm is a false statement and false guidance. **No criterion in the subject goes red.** The positive control in the staging step is the raw D1 count (12), which does not look at words.
- **Verdict.** Works after the subject ships. S4 creates the false word on every surface except the two it names. The description in the subject ("covers 2 of 8+") is correct and unchanged.
- **Severity.** Stays High. I propose no change.

### Card R1-04: the recap label as copy (S15 "so a group under 5 cannot be worked out")

- **Actor.** A public recap reader (an attendee, a journalist, a sponsor). No account.
- **Goal.** Learn that exactly one registered attendee checked in, or that a group is of size 1 to 4. The exact recovery belongs to OSE-1783 (recorded out of scope, never rated here). My attack is on the words.
- **Steps (source-read).**
  1. Read `pages.ts:1757-1762`. A published walk-in count that is nested-nulled shows the literal string "Walked in: held, so a group under 5 cannot be worked out". That string prints only when `floorNestedCounts` nulls the nested value (gap 1 to 4). The loop-2 fact (a) shows the consequence: at 6 check-ins with the label shown, walk-ins = 5 and registered check-ins = exactly 1.
  2. The same page renders S15's new sentence. `ANONYMITY_AFFORDANCE` is rendered on the post-event page at `pages.ts:1824` (and 1282, 1479, 1515 for the other phases). S15 will put "Counts say how many, never who." and "A count is shown only when at least 5 scans were counted at one poster in one hour" in that disclosure, on the page whose card text states "a group under 5 cannot be worked out" next to a recoverable group.
  3. The string is pinned by a test: `tests/withheld-counts-in-words.spec.ts:329` matches `Walked in: held`. S15 AC3 lists pinned tests to update but only `tests/never-who-disclosure.spec.ts:120` and the language-layer goldens. Nothing makes the S15 author touch this one.
  4. S15 AC1 scans `never-who.ts`, `privacy.ts` and `docs/` (C.4 AC1). It never opens `pages.ts`. A grep for the banned phrases ("single click", "indistinguishable", "impossible to identify", "no risk", "verified presence", "never linked", "not linked", "profile of you") finds nothing in the label, so the AC stays green.
- **What the attacker needs.** Nothing: the public recap page.
- **What the criterion shows.** S15 AC1 and AC2 stay green. The staging step curls `/privacy` and "one fixture event page"; I could not tell from the subject which phase that fixture is in. If it is pre-event, the post-event page is never fetched.
- **Success condition.** The attacker holds an exact group of 1 (OSE-1783's leak). Under-5 floor broken on main, and not by this epic. In S15 terms, the new sentence "Counts say how many, never who" is false on the same page. **No criterion goes red.**
- **Verdict.** Works on main (the leak). The false notice works after the subject ships (S15 adds true-sounding sentences beside it).
- **Severity.** Stays High for the in-scope half (words), per loop-2 section 2.1. I agree with the loop-2 decision that the exact recovery is out of scope.

### Card R1-05 and R1-06: the privacy notice, read by a regulator and by a Spanish-speaking attendee on a 320 px phone

I combine the two Highs, because one attendee path serves both and the root is the same notice. The actor is a regulator or privacy researcher for R1-05, and a Spanish-speaking attendee with a screen reader for R1-06.

**R1-05 steps (the regulator, source-read).**

1. Read `src/handlers/privacy.ts:55`: "We collect only what is needed for the specific form you submit". Then `:58`: "Check-in: an anonymous attendance count only — no personal data is stored". Then `:62`: legal basis "consent" for all but check-in, "legitimate interest" for check-in. Then `:69`: "Check-in counts: anonymous aggregate numbers". Then `:126`: "Last updated: 2026-04-23 — Phase 1 baseline".
2. Compare with the code the notice must describe. ADR-001 `:52` says a keyed scan id is "the same for one browser at every event". `qr-scan.ts:261` sets `ose_anon`, with a one-year lifetime (AGENTS invariant 4). The forms tables hold a per-event keyed id (AGENTS invariant 9). A keyed, stable identifier is pseudonymous. The notice's "no personal data" is the regulator's first exhibit. I make no legal ruling (that is loop 4's job; inferred).
3. S15 adds a section "QR codes and short links" that says scan counts are "never who". It does not name the cookie, its one-year life, the dedup key or the cross-event key (that key is S5's open spike). It leaves `:55`, `:58`, `:62` and `:126` as they are. After S15 the notice contradicts itself at three places and carries a section whose premise ("we count scans") has no stated basis, retention or controller route (R2-04).
4. Headings read "(GDPR Art. 13(1)(a))" and so on. That is jargon for the 50-75 reader the design system names as its first reader. Inline links in the body (mailto and three external links) are 15 px text links with no 44 px target (the privacy page has one 44 px control, the `.back` link at `:34`).
5. Layout at 320 px (inferred from CSS, not rendered): the header has 2rem side padding, `main` has 1.5rem. Text should wrap with no sideways scroll. I did not measure it.

**R1-06 steps (the Spanish-speaking attendee, source-read unless noted).**

1. The attendee scans a poster. `/q` sets `ose_anon` (`qr-scan.ts:177-187,261`). The event page is served under `/es/` or by `Accept-Language` negotiation (`src/lib/i18n/path-prefix.ts` header comment: "a bare URL still negotiates by header"; I did not trace what `/q` redirects to).
2. The page is Spanish. The only privacy statement on it is `ANONYMITY_AFFORDANCE`, a module-level English constant (`pages.ts:1067`, `renderNeverWho('event')`). Its summary ("Never who, only how many." / "How this works") and its body are English literals with no `lang="en"` wrapper (`never-who.ts:49-54, 73-81`). A Spanish screen reader will read English text with a Spanish voice.
3. It is a collapsed `<details>` (`never-who.ts:73-81`), at 15 px (`.95rem`) in `--text-muted`, so one tap hides it. The body says "nothing about your device, location, or identity was collected to display this page" (`never-who.ts:53-55`). The visitor now holds a one-year cookie.
4. The settings page (an organizer's own reading of the promise) says "Public pages set no cookies and run no tracking" (`src/lib/admin-settings.ts:178-179`), and "Any count under 5 is hidden, so a small number can never point at someone" (`:170-171`).
5. There is no way to read `/privacy` in Spanish. `matchLanguagePage` lists the event and share pages only (`path-prefix.ts:46-62`), so `/es/privacy` is unmatched (inferred 404 from the file's own header comment). The privacy page is `<html lang="en">` (`privacy.ts:15`). The event page has no link to `/privacy` (grep: the only `href="/privacy"` outside the footer partial is `form-pages.ts:162`; `pages.ts` has the footer marker only in the error template at `:303`; the event page does not call `injectLegalFooter`).
6. S15's own AC4 states the `/es/` event page keeps rendering the English paragraph, "now the new one". So the Spanish reader gets a longer English notice.
7. At 320 px: the new four-sentence paragraph sits in the details body, at about 15 px in muted ink. Inferred, not measured.

- **What each attacker needs.** Nothing: a phone and a `/q` scan.
- **What the criterion shows.** S15 AC1 (substring list on 2 files and docs), AC2 (matches "can still tell whether anyone else scanned" in `privacy.ts`), AC4 (asserts no new es key), AC5 (one `<h1>`, a11y suite) all pass. The staging step passes: it fetches `/privacy` and one event page, and finds the new sentences and no "single click".
- **What the S15 staging step cannot see** (it curls words):
  1. **Hidden or collapsed text.** The new event-page sentences are in a closed `<details>`. A curl finds them. A human does not see them without a tap, which is exactly the "wall of text behind a tap" the design rules ask for, but a regulator asks whether the notice is prominent.
  2. **`Set-Cookie`.** It never calls `/q`, so it never sees the cookie that the page's "nothing was collected" clause sits beside.
  3. **Language.** It sends no `Accept-Language: es` and fetches no `/es/` page, so the English-in-Spanish page is never examined. There is no `lang` check.
  4. **Reach.** It fetches the two pages separately and asserts nothing about a link from one to the other (R2-05).
  5. **Rendered facts.** Contrast, size, 320 px overflow, light and dark themes. A curl asserts none of these. The existing a11y suite (AC5) covers axe on pages it already visits. Axe contrast on content inside a closed `<details>` and on fixed layers is "incomplete", not a pass (see the memory note on axe and fixed layers; inferred for `<details>`).
  6. **Phase.** One fixture event, so one of the four render paths (pre, live, minimal, post).
- **Success condition.** The researcher holds a dated record of: a one-year `Set-Cookie`, `privacy.ts:58` and `:62`, the English-only text on `/es/`, and the missing link. The floor and never-who are not broken. A notice that is false in several places is the harm (and a regulatory one, if loop 4 reads it so). **No criterion goes red.**
- **Verdict.** Works on main, and works after the subject ships. S15 leaves the contradictions, adds a cookie-silent section, and puts the new words only in English.
- **Severity.** Stays High for both. I propose no change; loop 4 tests Regulatory.

### Card R2-02: the map's two vocabularies ("Neighborhood Preview" versus "Corridor Scan Map" / "Map hidden")

- **Actor.** A report-token holder (a sponsor, or the organizer) at a one-poster event. Also a colluding pair: an organizer who injects scans and a sponsor who reads.
- **Goal.** Learn whether anyone at all scanned the poster (0 versus 1 to 4), with no injection and no count.
- **Steps (source-read, not run).**
  1. Read `shared-report-builder.ts:836-880`. The branch is `shownCells.length > 0` → live; `else if (cellData.length > 0)` → `source: 'suppressed'` with `cell_count: 0`; `else if (event.h3_res7 …)` → `source: 'fallback'`. The writer keeps a 0 row for a sub-5 cell-hour on purpose (`shared-report.ts:866-871`).
  2. `shared-report.html:1247-1262` draws four different things for the two cases:
     - heading: "Neighborhood Preview" (fallback) versus "Corridor Scan Map" (suppressed);
     - body: "Neighborhood estimate — scan density fills in as events accumulate." versus "Map hidden to keep things anonymous — not enough scan density yet.";
     - the chip beside the heading: `cm.cell_count` is `cells.length` = 7 in fallback (the hex plus its six ring cells, `shared-report-builder.ts:884-890`) and 0 in suppressed (`:879`), so the page reads "7 cells" versus "0 cells". "0 cells" beside "Map hidden" is also literally false: cells exist, they are below the floor;
     - the `suppression` array in the JSON: suppressed carries "areas with fewer than 5 scans are not shown" (`:865` area), fallback carries "some areas not shown — fewer than 5 scans recorded" (`:822-826`), two different strings.
  3. The attacker reads the report after the nightly materializer run (03:00 UTC cron). Zero real scans reads fallback. Any real scan, even one, reads suppressed.
- **What the attacker needs.** A report token (mid tier). One night of timing. No injection for the passive version.
- **What the criterion shows while the attack runs.** S4's staging seed has 6 rows in a past hour and 6 at a future hour and asserts the map shows only the past-hour cell. It never seeds the 1-to-4 case or the 0 case. S15's sentence "below that it reads 'fewer than 5'" is false for the map. The S15 AC and staging step cover words on `/privacy` and the event page only.
- **Success condition.** At a one-poster event the attacker holds an event-level presence bit (an exact "0 versus 1 to 4"). That is the none-versus-small distinction invariant 2 forbids on the count side, here on the place side. The floor holds as a letter. **No criterion goes red.** S4's change to the stored-hour bound could flip which branch a row falls into, and nothing tests it.
- **Verdict.** Works on main. Works after the subject ships (S4 edits this read).
- **Severity.** Stays High. I add that there are at least four channels (heading, body, chip number, suppression string), so "one state" must fix all four. Loop 2's closed-when names the pinning by seeding 0 and 1 scans and comparing responses; that is the right test, and it must compare the whole response, not only `source`.

### Highs outside my lens (left to other lenses)

R1-01, R1-02, R1-07, R1-08, R1-09, R1-10, R1-16, R1-23, R2-01. For R1-02 I note only the copy: it is the notice's "one-grain" claim, which appears in S16's ADR text, not in a surface I can read. R1-16's visible side is two different figures on one page (the corridor map and the poster attribution); that is the Backend and Data Scientist lens.

---

## 2. Attacks on the subject's own controls (criteria that cannot catch their own failure)

For each I give the injected fault that leaves the criterion green.

1. **S15 AC2** (matches "can still tell whether anyone else scanned" in `privacy.ts`). Fault: wrap the sentence in `<p hidden>`, `style="display:none"`, an HTML comment, or a 1 px font. The substring is present. AC2 and the staging curl pass. The non-promise is invisible to every reader. Related fault: put the sentence in a collapsed `<details>` on `/privacy` under a heading named "Phase 5 events". Also green.
2. **S15 AC1** (banned-phrase list over `never-who.ts`, `privacy.ts`, `docs/`; R2-22 already covers wrap and double space). Faults that pass with the same root (a literal over source text):
   - entity or character variants: `single&nbsp;click`, `no&#8209;risk`, a non-breaking hyphen;
   - new overclaims not on the list: "completely anonymous", "cannot be identified", "nobody can tell who", "never collected", "no data about you";
   - the same words in a file AC1 does not open: `admin-settings.ts:170-179` ("a small number can never point at someone", "Public pages set no cookies") and `pages.ts:1762`.
3. **S15 staging step** (curl, fixture title as positive control). Fault: serve the new paragraph with `lang="es"` on an English page, or the English paragraph on `/es/` with no `lang`. The sentences are present and the title is present, so green. Fault 2: remove the `Set-Cookie` from `/q`. Green, since `/q` is never called.
4. **S4 AC4** (jsdom asserts one sentence in the live view). Fault: put the lag copy only in the `role="status"` line that is rewritten every 30 s and cleared on error (R2-20). The test finds the sentence on first render and passes. In use it is announced every 30 s and is lost during an outage (the catch sets a different string at `live-monitor.ts:192`).
5. **S4 AC5** (timeline "People scanning" detail). Fault: leave the "Report" step's "Fills in once people start scanning" and the next step "share the link" in place (`admin.html:8176-8177`). AC5 passes (it tests one detail line). The guidance stays false for 75 or more minutes.
6. **S4 staging step** (6 rows past, 6 rows at a future hour, two cell rows). Fault: a bound that is wrong by whole hours still puts the future hour out of view. Green (R1-46 and R1-15 name this). Fault 2, which I add: a bound that drops a 0 row (the sub-5 cell-hour). The map flips from "Map hidden" to "Neighborhood Preview" for a one-poster event. The seed has no 1-to-4 case, so it stays green, while the R2-02 bit changes meaning silently.
7. **S4 AC2** (registries). Fault: leave the spark bar's aria-label ("N today") on a value that is now sealed-hours only. The label is in no registry. Green. Related: `.lv-days` cards, which are sums with no label.

---

## 3. Cluster tests

### C2, withheld vocabulary (R1-03, R1-13, R2-02): combining two rows gives more than either alone

Vocabulary I counted by grep over `src/` (source-read): "Held" and "held" (live view, admin, shared report), "Fewer than 5" and "fewer than 5" (admin, pages, shared-report.html:1646, sponsor home), "<5" (admin), "Withheld" and "WITHHELD" (CSV export, `bigquery.ts`, shared-report-builder), "Map hidden", "Neighborhood Preview", and "Fewer than N so far" (S4's hover title). No surface says "No scans"; the code was written to avoid it (`shared-report-builder.ts:847,861,878`). The map is the exception (R2-02).

Worked example combining R1-03 and R2-02, for a sponsor at one poster: during the event they read the sponsor home "fewer than 5 poster scans" (which, under S4, is the word for both "0 to 4" and "the hour has not ended"). Next morning they read the map: fallback (0 scans, "7 cells") or suppressed (at least one scan, "0 cells"). S4 makes the first word uninformative for an hour. That makes the morning map the only surface that tells 0 from 1 to 4, and the sponsor now has an unambiguous prior (the word is unreliable, so only the map is read). Each row alone is weaker: the word alone is ambiguous by design, and the map alone could be dismissed as a rendering quirk. Together, the sponsor learns which of the two surfaces carries the bit and when it flips. This is the combination I rate as worse than either alone. The combination also adds R1-13's hover-only `title`: the one place the word "so far" would tell an attendee-side reader the hour was open is invisible to touch and keyboard.

Copy-level inference from S4 AC4's sentence: "Check-ins and link taps update live." That tells an organizer which channels stay live (the family R1-17 and OSE-1780's tap probe). It advertises the live side-channel in plain words while S4 closes the other. Not a new root; it belongs in R1-17's wording.

### C5, the privacy notice (R1-02, R1-05, R1-06, R2-04): combining gives more than either alone

Worked example. A regulator reads S15's new event-page text ("a count is shown only when at least 5 scans were counted at one poster in one hour; counts say how many, never who") and the unchanged recap card beside it on the same page ("Walked in: held, so a group under 5 cannot be worked out"). They compare the pair with the report: R1-02's arithmetic (poster A 7, poster B 3, `distinct_scanners` 10 beside A's 7 gives B = 3). Result: the notice makes an unbounded promise ("never who", "at least 5") and the surface, and the report beside it, falsify it with one subtraction each. Add R1-06: the page that makes the promise sits behind a one-year cookie it never names. A notice false in four ways reads as bad faith; a notice false in one way reads as a drafting error. So the cluster multiplier (2.0) is supported.

Two members I would split out: R1-12 and R2-05 are "reach and language" (the notice is not on the page and not in Spanish); the others are "content". The fix for content is a truth pass; the fix for reach is a link and an `es` route. S15 does neither as drafted.

### C1, C3, C6

Left to the Backend, Data Scientist and DevOps lenses. I add no design evidence to C1 (scan order), C3 (scans are not people) or C6 (staging evidence).

---

## 4. New findings

| id      | sev    | slice      | claim                                                                                                                                                                                               | evidence                                                                                                             | basis       | root cause                                                        | why not already a row                                                                                                                                                                                                                                         |
| ------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L3-FE-1 | Medium | S15        | The event-page disclosure is a collapsed `<details>` at 15 px in muted ink, so the S15 sentences are present in the DOM but not in view. The staging step and AC2 treat DOM presence as disclosure. | `never-who.ts:73-81`, `:62` (`font-size: 0.95rem; color: var(--text-muted)`), `:62` summary is the only visible line | source-read | The test target is "the words exist", not "the words are shown"   | R1-06 is the cookie text and R2-05 is reach. Neither is about prominence, and no AC states a prominence rule. If the owner reads this as part of R2-05, fold it in.                                                                                           |
| L3-FE-2 | Medium | S15, R2-02 | The map has four channels that differ between 0 scans and 1 to 4 (heading, body, chip number, `suppression` string), and the chip "0 cells" is literally false beside "Map hidden".                 | `shared-report.html:1247-1262`; `shared-report-builder.ts:822-826, 865, 879, 884-890`                                | source-read | A presence bit carried by a number and a string, not only a state | R2-02 names the heading and body. The chip and the two suppression strings are extra channels, so its "closed when" test must compare whole responses. I list it as a widening of R2-02, same root; if the scorer insists on one root per row, drop this row. |

I found no genuinely new root cause in the spark-bar and aria-label points. Those are inside R1-03 and R1-13.

Out-of-scope records (once, never rated):

- the recap's exact recovery (OSE-1783, already record 8);
- the walk-in test pin `tests/withheld-counts-in-words.spec.ts:329` (OSE-1783);
- `/q` cookie signing (OSE-1496).

---

## 5. Re-rates with reasons

- **R1-03:** stays High.
- **R1-04:** stays High (in scope: words). The exact leak is out of scope.
- **R1-05, R1-06:** stay High. Loop 4 tests Regulatory. My evidence that makes Regulatory plausible: the notice contradicts itself at `privacy.ts:55/58/62/126`, and the cookie is never named. I make no legal call.
- **R2-02:** stays High. I propose no change in tier. I widen the closed-when to the four channels in L3-FE-2.
- **R2-29** (the `javascript:history.back()` link, `privacy.ts:46`): stays Low. The page's own CSP is `script-src 'none'` (`privacy.ts:135`), so the link is probably dead (inferred; I did not test a browser). It matters more than Low for the visitor in card R1-06, who arrives with no history. The tier is unchanged.

---

## 6. Not checked, and why

- **Nothing was run.** No server, no browser, no Playwright, no axe, no staging, no curl. So no rendered contrast, no 320 px overflow measurement, no light or dark theme screenshot. Every layout and contrast claim above is from CSS reading or arithmetic. In particular: the 0.3-opacity spark bar contrast, the privacy page and disclosure at 320 px, and the 44 px target on the new `/privacy` link S15 would add.
- **`--accent` versus `--accent-text`.** README says links use `--accent-text`. I found no `accent-text` in `packages/ui/src` or `packages/tokens/src` (grep returned nothing), and `privacy.ts:33` and `never-who.ts:67,72` use `var(--accent)`. I recorded no finding: the README looks stale against the pinned code (or the pin predates it). Checking contrast for `--accent` as ink on creme and charcoal is a job for the token tests.
- **Where `/q` redirects for a Spanish `Accept-Language`**, and whether the fixture event used by S15's staging step is pre-, live- or post-event. I did not trace either.
- **`footer()` partial from `@ocr/ui`** (the legal footer's link target size): not read. If R2-05's cure uses it, its 44 px target needs a check.
- **Platform facts (none settled by my lens).** KV listing expiry, Workers Logs for `/q`, DLQ retention, the staging token's scope, the production migration level. None of these is decidable from copy or design files.
- **`language-layer` goldens** (8 files): I did not recount the "3 hits in each" Design FE counted in loop 3. I read `post.es.golden.txt` lines 95-108 only.
- **Other lenses' Highs** (R1-01, R1-02's arithmetic, R1-07 to R1-10, R1-16, R1-23, R2-01) and clusters C1, C3, C6.

---

## 7. Commands run (all read-only; none refused)

Read tool:

- `ccr-run/loop3/BRIEF-loop3.md`
- `packages/ui/design-system/HANDOFF.md` (full)
- `packages/ui/design-system/README.md` (first 200 lines, the whole file)
- `ccr-run/subject-v4-frozen.md` (lines 1-205, 291-322, 538-567)
- `ccr-run/loop2/MERGED-loop2.md` (full)

Grep tool:

- heading lines (`^#{2,3} `) of the frozen subject

Bash (all `cat`, `sed -n`, `grep`, `ls`, `wc`; no writes), from the worktree `ose-clock-gate/workers/oursharedevents` unless noted:

- `ls src; wc -l` on `never-who.ts`, `privacy.ts`, `pages.ts`, `live-monitor.ts`; `cat src/lib/never-who.ts`
- `cat -n src/handlers/privacy.ts`
- `grep -rn "/privacy" src`; `head -80 src/lib/legal-footer.ts`
- `sed -n 1,80p src/lib/i18n/path-prefix.ts`; `grep` on `catalog.ts`
- `grep` for `injectLegalFooter|OCR_LEGAL_FOOTER` and for `never-who|renderNeverWho|injectNeverWho|NEVER_WHO` over `src`
- `sed -n 2728,2745p src/handlers/pages.ts`; `grep -n "ANONYMITY_AFFORDANCE|<h1|<footer|lang="` on `pages.ts`
- `sed -n 1725,1830p src/handlers/pages.ts`
- `sed -n` on `src/templates/admin.html` (8425-8470, 8160-8185, 8120-8135), `shared-report.html` (1240-1270)
- `sed -n` on `src/handlers/live-monitor.ts` (50-70, 100-110, 180-200); `grep -n` on the same file
- `grep` on `packages/ui/src/tokens.ts` and `packages/ui/src` and `packages/tokens/src` for `accent-text`, `--focus-ring`, `--warn`
- `sed -n 170-185p src/lib/admin-settings.ts`; `grep` for cookie wording
- `grep -rnoi` for the withheld vocabulary over `src` (`fewer than`, `Held`, `Map hidden`, `withheld`); `grep -rnoi` for "no scans" and similar
- `sed -n` on `tests/__golden__/language-layer/post.es.golden.txt`; `grep` in `tests/` for the walk-in string
- `sed -n 828-900p` and `800-828p src/lib/shared-report-builder.ts`
- `sed -n 124-140p src/lib/sponsor-home-render.ts`
- `grep -rniE "no cookies|…"` over `src` for cookie claims; `sed -n 150-166p src/handlers/form-pages.ts`
- `grep -nE "#[0-9a-fA-F]{3,8}"` on `privacy.ts`, `never-who.ts`, `live-monitor.ts` (no raw hex found)

No file was written. No network call. No test, no branch, no commit, no stash.
