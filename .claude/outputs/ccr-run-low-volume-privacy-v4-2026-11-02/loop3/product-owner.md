# Loop 3 (Adversarial) report: product-owner lens, epic OSE-1766, subject v4 frozen (sha256 dd9b8522...b7f4)

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim.

No score and no gate decision are given. Nothing was changed. Code was read in `C:\Users\mzdan\dev\ourCommunityRituals\ose-clock-gate` (`src/` equals `origin/main` 39a63d67 per the loop-2 register). Paths are under `workers/oursharedevents/` unless they start with `.github/`.

Basis key:

- **source-read** means I opened the lines this loop.
- **register** means taken from the loop-2 merge and not re-opened by me.
- **inferred** means reasoned, not observed.
- Nothing here is proven at runtime.

## Short reading for the owner

1. **The notice words are false in more places than S15 touches.** `/privacy` says check-in stores "no personal data" and never mentions the one-year cookie. Settings text says "no cookies". The public recap's "held, so a group under 5 cannot be worked out" labels a group under 5. S15's five ACs scan `never-who.ts`, `privacy.ts` and `docs/` for eight phrases and would all pass with every one of these still live.
2. **A hostile organizer needs only the product's own pages for R1-04.** The recap walk-in label gives an organizer a split of check-ins that the admin floor hides. At 6 check-ins it gives an exact count of 1.
3. **A sponsor who compares pages already sees a contradiction on main.** The sponsor home says "fewer than 5 poster scans" while the SharedReport can print a larger `distinct_scanners`. S15 puts a sentence on the public page that this pair makes untrue.
4. **Several ACs can be green while the owner's first goal (no risk of identification) is unmet.** Section 2b names them: S2 AC1 with S3 AC1, S4 AC2, S6 AC1, S15 AC1 to AC5, S16 AC1 to AC3.

## 1. Attack cards

### R1-02 (High): the one-grain rule is stated as true before OSE-1784

- **Actor.** A sponsor with a report token, plus a sponsor's lawyer who reads the notice.
- **Goal.** Show the published sentence false on a dated page, and recover a withheld group of 3.
- **Steps.**
  1. The sponsor opens `/sponsor`. `renderPreEventReach` prints "N poster scans" from floored poster-hour cells, or "fewer than 5 poster scans" when withheld (`src/lib/sponsor-home-render.ts:115-118, 134`; source-read).
  2. The sponsor opens the SharedReport. `distinct_scanners` sums event-hour `scan_aggregates` rows with `floorTotalOfParts` (`src/lib/shared-report-builder.ts:327-347`; source-read). That is per event-hour, not per poster-hour.
  3. Worked case, arithmetic: poster A has 7 people and poster B has 3 in one hour.
     - Poster A's cell prints 7. Poster B's cell is withheld.
     - The event-hour distinct figure is 10 (`:346-347`).
     - 10 - 7 = 3, so B's withheld group is recovered.
  4. Separately, `sample_size` is `distinctAnonsHere`, a whole-event distinct count, once it is at least 5 (`:354-364`; source-read). It sits beside the cells on the same page.
  5. S15's planned sentence reads "We show a scan count only when at least 5 scans were counted at one poster in one hour". That sentence is false for `distinct_scanners` and `sample_size`.
  6. The sponsor's lawyer then holds one `/privacy` page and one report that disagree.
- **Needs.** A report token, one event with two posters, one hour. No injection and no cost.
- **While it runs, the criteria show:** S15 AC1 and AC2 are green (text grep). The staging step "T4 S15" curls two pages for words. S16 AC1 to AC3 are green (they check that ADR text exists).
- **Success condition.** The attacker holds a recovered group of 3 beside the new sentence. The floor is broken on main through OSE-1784's figures. No criterion in the subject goes red; I say so in those words.
- **Verdict.** Works on main. It still works after the subject ships if OSE-1784 slips. What stays in scope is the ordering: S15 and S16 sit in Wave 1 (E.2) with no edge to OSE-1784.
- **Severity.** Stays High. I note it is the clearest candidate for loop 4's Regulatory test.

### R1-05 (High): `/privacy` says check-in stores "no personal data"

- **Actor.** A privacy researcher, or a customer's lawyer.
- **Goal.** Show the public notice contradicts the code and itself.
- **Steps.**
  1. `src/handlers/privacy.ts:58` reads "an anonymous attendance count only — no personal data is stored" (source-read).
  2. The code stores a per-event keyed id on every check-in: `INSERT INTO checkin_counts (..., last_anonymous_id)` and `ON CONFLICT ... last_anonymous_id = ?` (`src/handlers/forms.ts:443-448`; source-read). It also sets the cookie (`:468`).
  3. The same page, at `:62`, names check-in's legal basis as legitimate interest under GDPR Art. 6(1)(f).
     - A basis for processing personal data is claimed beside a statement that none is stored.
     - `:69` calls the retained counts "anonymous aggregate numbers".
     - `:126` is dated "Last updated: 2026-04-23 — Phase 1 baseline".
  4. S15 adds a new "QR codes and short links" section and keeps "the other sentences stay" (subject C.4 Design). The contradiction is on the page S15 edits.
  5. The lexicon word "attendance" (banned by OSE-1201) is also on `:58`.
- **Needs.** Read access to a public page.
- **While it runs, the criteria show:** S15 AC1's ban list does not include "no personal data". AC2 only checks for the added non-promise sentence. Both green.
- **Success condition.** A dated page with a self-contradicting basis, retention list and promise. This is a published-notice truth failure, not a data leak. No criterion goes red.
- **Verdict.** Works on main. It works after the subject ships. It is not blocked by any AC, because S15's AC set never reads that line.
- **Severity.** Stays High. The legal reading is inferred, not read. It is the second Regulatory candidate for loop 4.

### R1-06 (High): the cookie and identification text is false and S15 adds a new section that omits it

- **Actor.** A privacy researcher, or a Spanish-speaking visitor.
- **Goal.** A dated record of three contradictions on the deployed pages.
- **Steps.**
  1. A `/q` scan on a new browser returns `Set-Cookie: ose_anon=...; HttpOnly; Secure; SameSite=Lax; Max-Age=` one year (`src/lib/anonymous-id.ts:14, 43-48`; `src/handlers/qr-scan.ts:260-261`; source-read).
  2. The scan then lands on the event page. That page carries the never-who disclosure (`src/handlers/pages.ts:1067, 1282, 1479, 1515, 1824`; source-read).
  3. Its body reads "nothing about your device, location, or identity was collected to display this page" (`src/lib/never-who.ts:53-55`; source-read). The `events` (plural) body at `:44-49` has the same sentence. S15 edits only the `event` body, so the `events` sentence stays.
  4. Settings text says "Public pages set no cookies and run no tracking." (`src/lib/admin-settings.ts:178-179`; source-read) and "a small number can never point at someone" (`:171`). An organizer sees it, and may repeat it to attendees or sponsors.
  5. `/privacy` has no "cookie" word and no scan section today. S15's new section says what is counted and what is shown, and still omits the cookie that the scan sets.
  6. On `/es/` the same English block shows with no `lang` (R1-12). No link to `/privacy` exists on that page (R2-05).
- **Needs.** One browser. No cost.
- **While it runs, the criteria show:** S15 AC1, AC2, AC3 (goldens), AC4 (no es key) and AC5 (one h1, tokens) are all green. AC1 scans two source files, not `admin-settings.ts`.
- **Success condition.** The notice is incomplete on a cookie that lasts a year. That is a cookie-notice duty candidate for loop 4. No criterion goes red.
- **Verdict.** Works on main. It works after the subject ships; S15's own new section makes it worse, because a partial disclosure about scans leaves out the cookie the scans set.
- **Severity.** Stays High. I add that invariant 4 (owner ruling 2026-10-22) already blesses the cookie, so the defect is words, not behaviour.

### R1-03 (High): S4 puts the open hour in the withheld wording

- **Actor.** An organizer at a busy event, and a sponsor who pays.
- **Goal.** Document a false statement per surface, and use the lag as guidance.
- **Steps.**
  1. 80 scans arrive at one poster in the open hour. After S4, every read adds a sealed-hours bound (subject C.10 Rule).
  2. The sponsor home prints `floored(r.scans)`, so it reads "fewer than 5 poster scans" (`src/lib/sponsor-home-render.ts:115-118, 134`; source-read). The cause is a lag, but the words say a count.
  3. The subject adds lag copy on two surfaces only: the live view line and the admin timeline detail (S4 AC4, AC5). The sponsor line, admin poster cards, event stats, pre-event card and the three dashboards stay unlabelled. They show 8 or more surfaces in total (register R1-03; FE run proven on `admin.html`).
  4. The sponsor home also says "Your name shows only if the organizer says yes" and "Nothing new right now" with no lag note.
  5. AC4's copy says scan counts show "each hour about 15 minutes after it ends"; the stated lag is up to 1 h 15 min (C.10 "Product cost").
  6. The organizer sees the 80 scans in the next sealed hour and nothing before. The organizer reading "fewer than 5" for 75 minutes may add scans or give up.
- **Needs.** An open event. No cost.
- **While it runs, the criteria show:** S4 AC2 (registry walk), AC4 and AC5 are green. No AC asserts the sponsor line.
- **Success condition.** A false statement on a paid-for surface. The floor holds (every figure is still a sum of floored cells); the harm is false guidance. The two AC copy lines contradict each other (AC4 "about 15 minutes", AC5 "after the first full hour").
- **Verdict.** Works after the subject ships. It is not on main, because S4 creates it. No AC blocks it.
- **Severity.** Stays High, since S4 itself creates the false statement. This is the same cause as cluster C2. The sponsor is the party who is asked to pay.

### R1-04 (High, in-scope half: S15's words) and the exact leak (OSE-1783)

- **Actor.** A hostile organizer, using only the recap, the admin check-in count and their own registration list.
- **Goal.** An exact count of 1 to 4 registered-path check-ins, which the admin view hides.
- **Steps.**
  1. The public recap prints a walk-in line from `floorNestedCounts([checkinCount, walkInCount])` (`src/handlers/pages.ts:1756`; source-read).
  2. If check-ins clear 5 and the nested walk-in is null but the walk-in count alone clears 5, the page prints "Walked in: held, so a group under 5 cannot be worked out" (`:1757-1762`).
  3. From `count-floor.ts:98-121`, that label appears exactly when the gap between check-ins and walk-ins is 1 to 4. At a gap of 0 the exact walk-in count prints.
  4. The organizer's own admin check-in count is floored: `applyCountFloor(count)` (`src/handlers/forms.ts:741-745`; source-read). The walk-in split is not shown in admin at all. The recap is therefore the only place the organizer learns the split.
  5. With 6 check-ins published and the label shown, walk-ins are 5 and registered-path check-ins are exactly 1. With 7, the split is 1 or 2.
  6. The "arrival path" is only the button the attendee pressed. It is declared by the client, never matched to a registration (`forms.ts:398-417`, comment at `:404-407`). An organizer with one invited registrant and a recap at 6 learns that one person pressed the "registered" button. Whether that identifies the invitee is inferred.
  7. Injection variant: the check-in route has no dedup. A repeat tap adds 1 (`forms.ts:443-448`), guarded only by `guardTurnstile` (`:429`). An organizer adds 5 walk-in check-ins and then reads the label as a bit: label shown means 1 to 4 real registered-path check-ins; label absent with an exact walk-in count means none. That is a presence bit.
- **Needs.** The public recap page, plus a Turnstile solve per injected check-in for the variant.
- **While it runs, the criteria show:** S15 AC1 scans `never-who.ts`, `privacy.ts` and `docs/` only. The label text lives in `pages.ts`, so the string "so a group under 5 cannot be worked out" would pass AC1 with the label present. I checked this directly: the label is not in any file S15 scans. The staging step curls a fixture event page, but that page prints the label only at a gap of 1 to 4.
- **Success condition.** The floor is broken on a public page: invariant 2 says "no exceptions" and the code's own OSE-1657 comment (`pages.ts:1746-1750`) forbids this bit. No criterion goes red.
- **Verdict.** Works on main. It works after the subject ships. S15 does not block it.
- **Out of scope.** The leak itself belongs to OSE-1783 (register 2.1, recorded once, not rated here). The in-scope half stays: S15 says "public words say only what holds" and leaves a false line on a public page next to its new section.
- **Severity.** Stays High for the in-scope half. I add a product note: the owner's decision to hold the leak out of this epic leaves no known ticket. The register says "no ticket is known to hold it".

### R2-01 (High): shared staging has no cross-run lock

- **Actor.** Two honest developers, or one developer and the nightly rollback drill.
- **Goal.** Green evidence for a build T4 did not test, or a false red that blocks the production tag.
- **Steps.**
  1. The CI `concurrency` group is `ose-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}` with `cancel-in-progress` only for pull requests (`.github/workflows/oursharedevents-ci.yml:150-158`; source-read).
  2. A `full-pipeline/*` pull request deploys its branch to the same staging Worker and D1 (`:1177, 1191`; source-read). Its group key is the pull request number, so it never cancels or waits for main's group (`ose-push-refs/heads/main`).
  3. `staging-rollback-drill.yml` has its own group `staging-rollback-drill` with `cancel-in-progress: false` (`:40-42`; source-read), so it is a third unlocked writer.
  4. Deploy-freshness is asserted once, at the start of T4 (`:2001`; source-read).
  5. Timeline: main's T4 starts and passes freshness; a `full-pipeline/*` push then deploys its branch; main's T4 steps 2 to 6 run against the other build. The S2 set difference over the `scan:dedup:` KV prefix also picks up the other run's keys.
- **Needs.** Two pull requests or a pull request and a main push inside one T4 window. No privilege.
- **While it runs, the criteria show:** every new S2 to S15 staging step goes green or red on the wrong build. Done evidence for a merge SHA can be false.
- **Success condition.** No attacker data is gained. A gate is bypassed by accident: the Done bar (`T4 Functional → Staging` for the merge SHA) rests on a build it did not test. No criterion goes red.
- **Verdict.** Works on main. It works after the subject ships. The subject's own R1-09 cure (born red on `full-pipeline/*` runs) creates more of these collisions (cluster C6).
- **Severity.** Stays High. Product reading: a false Done is a statement to the owner and the next client.

## 2. Attacks on the subject's own controls

### 2a. Fault passes, AC stays green (loop-2 list, my lens)

1. **S15 AC1 (R1-06, R2-22).**
   - Fault: add "Public pages set no cookies" to `privacy.ts`, or "We store no personal data of any kind" to the event page body in `never-who.ts`.
   - AC1's eight-phrase list does not contain them, so it stays green.
   - Fault 2: break "single click" across a line break, as `never-who.ts:53-54` already does. A literal substring check misses a wrapped phrase (R2-22).
2. **S15 staging step "T4 S15".** It checks that the two pages contain new sentences and lack "single click".
   - Fault: leave the new sentence on `/privacy` but keep the false cookie line in settings (`admin-settings.ts:179`).
   - Step stays green, because it never loads the settings surface.
   - Fault 2: remove the only path to `/privacy` from the event page. The step still passes because the pages are checked separately (R2-05).
3. **S4 AC4 and AC5 (R1-03).**
   - Fault: ship the lag copy on the live view and admin timeline only. Both ACs are green.
   - The sponsor line, admin poster cards and event stats still read "fewer than 5" for an open hour.
4. **S16 AC1 to AC3 (R2-10, R2-15).**
   - Fault: ship ADR-025 with RA-1's exact sentence but with conditions 1 and 2 silently unmet.
   - AC1 and AC2 are green (they check the text). AC3 is green because the owner marker is removable in the same PR.
5. **S2 staging step (R1-07).**
   - Fault: KV `put` never called.
   - The D1 control still rises (counted scan), K1 minus K0 is empty, and the assertion is "no key contains the place". It passes.

### 2b. Goal-unmet test: an AC met as written while the owner's first goal (no risk of identification, 2026-10-31) is unmet

For each, the way the AC is met leaves the goal unmet.

- **S2 AC1 plus S3 AC1.**
  - How: the marker key is hashed (AC1 m1 to m4 green) and logs lose their fields (S3 AC1 green).
  - Why the goal is unmet: the marker is still written with `expirationTtl: 3600` at scan time (`src/handlers/qr-scan.ts:185`; source-read), so its expiry carries the scan second. Whether a KV listing returns the expiry is an unsettled platform fact. If it does, a KV holder ranks markers by expiry against `scan_placement_events` rowid order (R1-01, R1-10). S3's title says "no clock finer than the hour" and no S3 AC covers KV expiry.
  - The subject's own comment at `qr-scan.ts:184` states the key "names its hour", which supports the point that the expiry is the only second-grain value.
- **S4 AC2 (R1-16).**
  - How: seed stored cells and raw rows, add a row at a future hour, and the figures do not move.
  - Why the goal is unmet: the staging seed writes stored cells directly, without the materializer. The 03:00 UTC cron stores the open hour early (register fact (e), merge-verified; reach inferred). A poster-hour stored at 5 and finished at 7 later publishes 7 from raw `poster_attribution` and 5 from the stored corridor cell in one response. A difference of 2 identifies a group of 1 to 4 with no injection, on a busy US evening event.
  - S4's sealed bound is satisfied (the hour is sealed by 04:15) while the discrepancy persists until the next night's rebuild.
- **S6 AC1 and AC2 (R1-10).**
  - How: a spec measures and records a result; the injected shared column goes red.
  - Why the goal is unmet: the measurement is recorded whether the result is "linked" or "not linked", and the DS model says rank alignment held for 12 of 12. S6 records a negative or positive claim and, if positive, files a follow-up with no ticket (C.6 Outcome). The goal needs the rebuild, which the epic does not own.
- **S15 AC1 to AC5, all green (R1-02, R1-04, R1-05, R1-06).**
  - How: the new words are on `never-who.ts` and `privacy.ts`, the banned phrases are gone, the goldens are updated.
  - Why the goal is unmet: the public statements stay false on `pages.ts`, `admin-settings.ts`, the line at `privacy.ts:58`, and for who-side figures until OSE-1784.
- **S16 AC1 to AC3 (R2-10).**
  - How: ADR-025 records RA-1 verbatim plus the "not accepted and not bounded" sentence.
  - Why the goal is unmet: the ADR can read as accepted while RA-1 conditions 1 and 2 are unmet. A reader of the ADR cannot tell the state without the ticket history.

## 3. Cluster tests

- **C1 (scan order as a join key). Combining gives more than either row alone.**
  - Worked example: a D1 export plus one known (poster, hour) leaves at most 4 candidates by rowid rank (R1-10). A KV listing with expiry (if it returns it) adds the second. FORMS_DB `source_placement_id` plus hour then names a registrant.
  - Without the clock row, rank alone gives (browser, poster). With it, the trail gains seconds, and the join to a registration needs only that hour.
  - From the product side, this matters because the owner's goal is identification risk, and the three rows together reach a name.
  - I did not run it; basis arithmetic and register.
- **C2 (withheld vocabulary). Combining gives more.**
  - Worked example: R1-03 plus R2-02. An organizer at a one-poster event sees "fewer than 5" for the whole open hour (R1-03).
  - After the hour seals, the SharedReport map branches on the presence of any stored cell row (R2-02; register fact (b), lead-verified).
  - The two together give a timeline: unlabelled "fewer than 5" while open, then "Neighborhood Preview" (any scan stored) versus "Map hidden" (none). Either alone is a vocabulary defect; together they are a presence bit with a timestamp.
  - Each vocabulary is also false for a different reason, which a sponsor reads as inconsistency.
- **C3 (scans are not people).**
  - R1-07, R1-08 and R2-03 are three ways the dedup fails. Combining them gives the attacker nothing more than R1-08 alone in kind.
  - The product statement is what combines: S15 says "at least 5 scans counted at one poster in one hour" and the label in `admin.html` says "People scanning". With R2-06 (the figure is a lower bound labelled as people) a sponsor reads 5 scans as 5 people.
- **C5 (privacy notice). Combining gives a regulator more than any row alone.**
  - R1-02, R1-05, R1-06 and R2-04 together: a single page set (`/privacy`, event page, settings, recap) contradicts itself on basis, cookie, personal data and group size.
  - A regulator needs one false line; a customer's lawyer needs the contradiction between two. The set gives the lawyer four.
  - Worked example: `privacy.ts:58` (no personal data) against `:62` (legitimate interest) against `forms.ts:443-448` (keyed id stored) against `qr-scan.ts:261` (one-year cookie).
- **C6 (staging evidence). Combining gives more.** R1-09's cure creates R2-01's race (register 3). A wrong step on main closes the CI route out of a production incident (register R1-09). So the owner's rollback path depends on a lock nobody owns.

## 4. New findings

| id      | sev    | slice | claim                                                                                                                               | evidence                                                                                                        | basis       | root cause                                                                                   | why not already a row                                                                                                                                                            |
| ------- | ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L3-PO-1 | High   | S15   | The recap's walk-in split is shown publicly and hidden from admin, so the recap gives the organizer more than the admin floor does. | `src/handlers/forms.ts:741-745` floors admin check-in count; `src/handlers/pages.ts:1756-1763` prints the label | source-read | The public recap is a more exact surface than the admin it is meant to be no more exact than | R1-04 and R2-01 (register 2.1) cover the 6-gives-1 leak, not the admin-versus-recap asymmetry. I propose it as an addition to R1-04, not a new row, if the lead prefers one root |
| L3-PO-2 | Medium | S15   | The check-in route has no repeat dedup, so a hostile organizer controls the walk-in label as a bit with 5 injected check-ins.       | `forms.ts:443-448` (unconditional increment); `:429` Turnstile only                                             | source-read | Injection by the organizer, who is in the threat model as an adversary                       | It belongs with OSE-1780's presence-bit family on the who side. I record it there and do not rate it, per the brief                                                              |

Both are recorded; I do not claim either is a new root cause strictly. I found no additional root cause outside R1, R2 and the out-of-scope list.

Out of scope, recorded once and not rated:

- OSE-1780: the presence bit by injected check-ins in L3-PO-2.
- OSE-1783: the exact recap recovery.
- OSE-1784: `distinct_scanners` and `sample_size` against the cells.

## 5. Re-rates with reasons

- **R1-04:** keep the in-scope half High. I do not propose Critical. The exact recovery is out of scope, and the register already marks it Critical in substance.
- **R1-05 and R1-06:** keep High. I agree they go to loop 4 for Regulatory. The legal reading is inferred, not read, and I did not settle it.
- **R1-03:** keep High. I add the sponsor-paying angle as the reason. The sponsor home reads "fewer than 5 poster scans" for an hour of 80 scans.
- **R2-01:** keep High. No change.
- No row raised or lowered.

## 6. Not checked, and why

- Staging and production behaviour: the brief forbids it. Every "works on main" is source-read or register, none proven at runtime.
- R1-16's cron timing: taken from register fact (e). I did not open `shared-report.ts:860-905` or `shared-report-builder.ts:835-845` myself. The 03:00 job timing relative to nine jobs is an open platform fact (item 6 in the loop-2 list).
- R2-02's map branch: taken from register fact (b). I did not open `shared-report-builder.ts:836-862` or `shared-report.html:1247-1262`.
- The legal readings (GDPR Art. 5, 12-13; ePrivacy Art. 5(3); FTC s.5): inferred. A lawyer would settle them.
- The goldens under `tests/__golden__/language-layer/`: not opened.
- Open platform facts I could not settle from docs or repo config:
  - KV listing expiry, Workers Logs for `/q`, DLQ retention, the staging token's scope and the secret level of `CLOUDFLARE_API_TOKEN_OSE`.
  - Production migration level (77 versus 104).
  - Each needs a Cloudflare or GitHub read by the owner, or the vendor documentation. None is in the repo.
- Whether the `/sponsor` and SharedReport figures were ever read together by a real sponsor: no evidence in the repo.
- The next client date and cost-against-date: the brief asks for attack cards, not planning. One note only, from the subject itself: E.3 says "No date is proposed", and Done for the epic waits on OSE-1496 and OSE-1784, which are not scheduled. I did not re-cost it.

## 7. Commands run (all read-only; none refused)

I used the Read and Grep tools only. I ran no Bash or PowerShell command and wrote nothing.

- **Read:**
  - The brief and `.claude/skills/product-director.knowledge.md` (stale, last reconciled 2026-03-27; not used as evidence).
  - The frozen subject (lines 1-669).
  - `MERGED-loop1.md` (lines 1-120).
  - `MERGED-loop2.md` (all).
  - `src/handlers/privacy.ts` (30-139).
  - `src/lib/never-who.ts` (20-80).
  - `src/handlers/pages.ts` (1725-1785).
  - `src/handlers/forms.ts` (395-485 and 722-762).
  - `src/lib/sponsor-home-render.ts` (100-160).
  - `src/lib/poster-reach.ts` (170-235).
  - `src/handlers/qr-scan.ts` (160-262).
  - `src/lib/shared-report-builder.ts` (322-372).
  - `src/lib/count-floor.ts` (1-140).
- **Grep:**
  - `walkInCount|walk_in` over `src`.
  - `set no cookies|can never point at someone` over `src`.
  - `fewer than 5|Fewer than|Held|held` in `sponsor-home-render.ts`.
  - `renderNeverWho(` over `src`.
  - `ANONYMITY_AFFORDANCE|/privacy` in `pages.ts`.
  - `Set-Cookie|ose_anon|HttpOnly|Max-Age` in `anonymous-id.ts`.
  - `checkin_counts|total_count` over `src/handlers`.
  - `Gather|exact|OSE-1656|OSE-1652` in `event-stats.ts`.
  - `concurrency:|cancel-in-progress|group:|full-pipeline/|assert-deploy-freshness` in `oursharedevents-ci.yml`.
  - `concurrency|group:|cancel-in-progress|cron|workflow_dispatch|deploy` in `staging-rollback-drill.yml`.
- One Grep call failed on a wrong path (`src/handlers/admin-settings.ts`; the file is `src/lib/admin-settings.ts`). It changed nothing.

Lead's note (not the agent's text): the agent's R1-04 card says "no ticket is known to hold it"; that was true at loop 2's merge. The lead filed OSE-1787 (child of OSE-1783) after the loop-2 merge and before loop 3 launched. The merge should read the leak as ticketed.
