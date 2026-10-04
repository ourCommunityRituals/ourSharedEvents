# CCR: tracking plan (ourSharedEvents#802) and ADR-010 decisions note (OCR-docs#156)

**Date:** 2026-10-04. **Protocol:** `.claude/skills/ccr-protocol.md` v3.0, 3 loops as requested, loops run in sequence, findings fixed between loops.
**Team:** extended scrum (PO, Lead BE, Lead FE, Sr Design FE, Sr Automation QA, SRE/SDET, DevOps, plus Dr of Security, Sr SDET/SRE, DevOps Mgr, Sr Data Scientist).
**Story:** OSE-1614, epic OSE-1612.

## Verdict: NOT CLEARED

| Loop | Score as found | Score after that loop's corrections |
| ---- | -------------- | ----------------------------------- |
| 1    | 33.0%          | corrected, carried into loop 2      |
| 2    | 27.9%          | corrected, carried into loop 3      |
| 3    | 79.0%          | **85.0%**                           |

The gate is 95%, stable over two consecutive loops. Neither is met. What remains is two items, and neither is a defect in the text:

1. **Decision 4 is open and needs the PO** (below). It is documented in both PRs, so the documents are accurate, but the plan it feeds (OSE-1617) cannot proceed. Carried as Partial: 7.5.
2. **CI on the final commits of #802 has not finished.** Environmental assumption, Partial: 7.5. Mechanical; auto-fix watches both PRs.

Two further conditions the score does not capture:

- **#156 changes an ADR, which is a Tier 2 governance artifact** (protocol section 4.3: 5+ loops, human gate every loop, environment modifier 1.25). This run is 3 loops. #156 should not merge until two more loops are run after decision 4, or the PO accepts the deviation in writing. #802 is Tier 3 (a specification): 3+ loops, human gate on loops 1 and 3. This report is that gate.
- **One reviewer scored text the same reviewer wrote.** The protocol asks for peer review of near-threshold worksheets; this one is far from threshold but its inter-rater risk is real. A second reader of the six findings marked "found by the author" would be worth it.

## Loop 1: surface pass (score 33.0%)

Method: every factual claim in both documents was checked against the code (cookie sites, table columns, SQL, export code, ADR text) or against a named file. The claims that held are listed under Verification at the end. The findings below were corrected before loop 2.

| #   | Finding                                                                                                                                                                                                               | Role                 | Severity | Surfaces | State      | Deduction                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------- | -------- | ---------- | ------------------------ |
| F1  | Bucket rule "minus 4 hours" is ambiguous: subtracting from the instant and from the wall clock disagree by an hour on both daylight-saving days (computed: `2026-11-01T09:30Z` gives Nov 1 one way, Oct 31 the other) | BE, Data             | Medium   | 2        | Unverified | 5 x 1.58 = 7.9           |
| F2  | No rule for events missing a venue, cell or type (exports write `uec_code='unknown'`, `handlers/bigquery.ts:143`, so untyped events would share one bucket)                                                           | BE                   | Medium   | 2        | Unverified | 7.9                      |
|     | F1 and F2 correlated (one root: the key contract is under-specified)                                                                                                                                                  |                      |          |          |            | (7.9 + 7.9) x 1.5 = 23.8 |
| F3  | Security section claimed a key "reveals nothing the public event page does not say". False for draft, unlisted and archived events: an unkeyed hash is a confirmation oracle                                          | Dr of Security       | High     | 1        | Unverified | 10                       |
| F4  | No rule against recovering a withheld count by subtraction across cells (the league and chamber roll-ups add new sums)                                                                                                | Dr of Security, Data | High     | 2        | Unverified | 10 x 1.58 = 15.8         |
| F5  | League recipe assumed a consent-and-mapping step always applies; the founding case (the league owns its events) needs none, and venue tenancy in code was unverified                                                  | PO, Dr of Security   | Medium   | 2        | Unverified | 7.9                      |
| F6  | Two sessions on one night at one venue share an id                                                                                                                                                                    | Data                 | Low      | 1        | Unverified | 2                        |
| B1  | Environmental assumptions: `ourWKRP` not read, CI on final SHA pending                                                                                                                                                | QA, DevOps           | Base     |          | Partial    | 7.5                      |
|     | **Total**                                                                                                                                                                                                             |                      |          |          |            | **67.0, score 33.0%**    |

**Corrections applied between loop 1 and 2** (commit `836d1248` in #802, `c66121c` in #156):

- F1: rule pinned to the wall clock; six test vectors added (re-computed with a script, all six match). F6: named as a known limit.
- F2: "Missing inputs mean no key" paragraph.
- F3: keys stored for every event but exported and rolled up for listed events only.
- F4: "No back door by subtraction" rule in section 5.
- F5: league recipe split into case A (league owns events, no mapping) and case B (mapping with two-sided consent); venue tenancy marked unverified in code, supported by ADR-023.

## Loop 2: pressure pass (score 27.9%)

Method: the corrected plan was re-read end to end and each recipe was attacked: who reads what, across which tenant, through which boundary.

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                  | Role                   | Severity       | Surfaces | State      | Deduction               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | -------------- | -------- | ---------- | ----------------------- |
| G1  | **Venue-grain keys in exports contradict the boundary in force**: the OER boundary doc ("corridor-level only", line 57), the export guard header (`export-geography.ts:10-11`) and OSE-1460 ("The venue never leaves", `shared-report-export.ts:291-292`, `venue_id='corridor-aggregate'`). ADR-010 (Proposed) section 3 assumes the opposite. Decision 3 depends on it. | Dr of Security, BE, PO | Critical       | 2        | Unverified | 15 x 1.25 x 1.58 = 29.7 |
| G2  | "Hash" and "normalise" not exact enough for two products to agree (Unicode form, punctuation, hash function, field layout)                                                                                                                                                                                                                                               | BE                     | Medium         | 2        | Unverified | 5 x 1.25 x 1.58 = 9.9   |
| G3  | Chamber recipe let a chamber read per-venue numbers of other tenants with no consent (invariant #9, tenant isolation)                                                                                                                                                                                                                                                    | Dr of Security         | High           | 1        | Unverified | 10 x 1.25 = 12.5        |
| G4  | Three rules stated as current fact: the shortlink day series "follows the floor" (no read path exists: `by_day` is not read anywhere), the floor applies "on every surface", OW "stamps" the keys (no `ourWKRP` code reads either key). Three locations in one document, so promoted one tier by heuristic 4                                                             | QA, Dr of Security     | Medium to High | 1        | Unverified | 10 x 1.25 = 12.5        |
| B1  | CI on final SHA pending                                                                                                                                                                                                                                                                                                                                                  | DevOps                 | Base           |          | Partial    | 7.5                     |
|     | **Total**                                                                                                                                                                                                                                                                                                                                                                |                        |                |          |            | **72.1, score 27.9%**   |

The score fell from loop 1 (33.0 to 27.9). By protocol that means loop 2 found more risk than loop 1 did, so loop 1's confidence was too high. It is the protocol working, not a regression in the documents.

**Corrections applied between loop 2 and 3** (commit `9ccbc896` in #802, `829913d` in #156):

- G1: new **Decision 4 (open, needs PO)** with three options and a recommendation; OSE-1617 marked as waiting on it; the ADR note says it authorises no export of either key.
- G2: proposed defaults pinned (NFKC, `&` to `and`, non-alphanumerics to spaces, SHA-256, `|` separator, first 32 hex characters, `v1`), with fixtures to be published by OSE-1615.
- G3: chamber split into a no-consent corridor view and a per-venue view for opted-in venues only.
- G4: three claims reworded; OW recipe now says "design intent" and records the search of `ourWKRP`.

## Loop 3: confirmation pass (score 79.0%, 85.0% after corrections)

Method: each correction re-verified; all six bucket vectors re-run; each file and line citation re-read.

| #   | Finding                                                                        | Role   | Severity          | State      | Deduction             |
| --- | ------------------------------------------------------------------------------ | ------ | ----------------- | ---------- | --------------------- |
| H1  | ADR note said "Section 3 above"; section 3 is below the note                   | QA     | Low               | Unverified | 2 x 1.5 = 3           |
| H2  | Quote cited at `shared-report-export.ts:289`; the sentence is on lines 291-292 | QA     | Low               | Unverified | 3                     |
| B1  | CI on final SHA not finished                                                   | DevOps | Base, Partial     |            | 7.5                   |
| D4  | Decision 4 unresolved: needs the PO, so carried, not assumed                   | PO     | Critical, Partial |            | 7.5                   |
|     | **Total as found**                                                             |        |                   |            | **21.0, score 79.0%** |

H1 and H2 were fixed in this loop (the citation now reads `:291-292`, the ADR note reads "below"). Remaining after correction: B1 and D4, 15.0, **score 85.0%**.

Loop 3 found two new items, both Low. That is a confirmation pass that mostly confirmed, but not a clean one.

## What each role found

| Role                         | Finding                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PO                           | G1: Decision 3 collides with OSE-1460. F5: the founding league needs no mapping.                                                                                                                                                                                                                                                                                       |
| Lead BE                      | F1, F2, G2: the key contract was not exact enough to give OSE and OW the same id.                                                                                                                                                                                                                                                                                      |
| Sr Data Scientist            | F4 (subtraction), F6 (same-night merge), the venue-key weakness is documented and bounded.                                                                                                                                                                                                                                                                             |
| Sr Automation QA             | G4 (claims versus code), H1 and H2 (citations). All six vectors re-run.                                                                                                                                                                                                                                                                                                |
| SRE/SDET, DevOps, DevOps Mgr | No deploy surface (docs only). CI is the open item. A push cancels in-flight runs, so the three corrections were committed locally and pushed once.                                                                                                                                                                                                                    |
| Lead FE, Sr Design FE        | Not applicable: no UI change.                                                                                                                                                                                                                                                                                                                                          |
| Dr of Security               | F3 (oracle for unlisted events), G1, G3 (cross-tenant read). **Nothing in either document is Security Critical**: no exploitable code exists, since neither key is computed yet. F3, F4, G1 and G3 are how a future implementation could breach the invariants, so they were scored High or Critical. The sign-off in the plan stays PENDING; the role has not signed. |

## Pre-conditions

- [ ] PO decides Decision 4 (options A, B or C in the plan). OSE-1617 waits on it.
- [ ] CI green on the final commits of both PRs.
- [ ] Two more loops on #156 after decision 4 (Tier 2), or a written PO acceptance of the deviation.
- [ ] Dr of Security signs section 6 of the plan (story acceptance; separate from this score).
- [ ] OSE-1617 acceptance gets "listed events only" and the no-subtraction rule (not edited by this run).
- [ ] A story for the league mapping (case B) is written; none exists.

## Commit sequence

1. #802: `608a1dec` plan; `8391318c` decisions; `49570fdd` league mapping; `836d1248` loop 1; `9ccbc896` loop 2; loop 3 citation fix; this worksheet.
2. #156: decisions note; loop 1 `c66121c`; loop 2 `829913d`; loop 3 direction fix.

## Verification

- [x] Six bucket vectors re-computed by script: 6 of 6 match the table.
- [x] Cookie sites: `Set-Cookie` appears only in `qr-scan.ts` and `forms.ts`; none in the shortlink, display, poster or page handlers.
- [x] `email_signups` is not referenced by any export code.
- [x] No `ourWKRP` file mentions either key.
- [ ] CI green on both PRs (pending).
