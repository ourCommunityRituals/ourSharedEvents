# UX Laws — Pass 2: Cross-Functional Synthesis

**Date:** 2026-09-04 · **Input:** `docs/audits/ux-laws-audit-2026-09-04.md` (pass 1, grading)
**Mode:** synthesis only. No re-grading, no code, no Linear issues.

---

## Constraint verification, before anything is built on it

Pass 2 was told to name every constraint by its real number or declare it unverified. Four corrections:

| Constraint as cited in the prompt                                          | Reality                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **OSE-322** UEC static gate                                                | **SHIPPED — my first reading was wrong.** OSE-322 is **Done** (2026-05-18, PR #238 _"substrate static gate — no UEC hex literals outside src/lib/uec/"_). The comments in `src/lib/uec/index.ts:4` and `uec-codes.ts:27` still say _"future"_ and _"will"_ — **they are stale**, written before the gate landed and never updated. Live enforcement: `tests/e2e/0-architecture/uec-poster-color.invariant.spec.ts` is in the **T0 invariants shard** and runs on every PR; `workers/oursharedevents/tests/uec-drift-check.spec.ts` (OSE-323) detects brain↔OSE `scan_hex` drift. **But see the scope note below — this changes the recommendation rather than cancelling it.** |
| **WALL-3b (OSE-835)** tier-keyed CSS lock                                  | **REAL and live.** Referenced in `tests/e2e/0-architecture/geo-resolution.invariant.spec.ts:17`, `sponsor-share-covenant.invariant.spec.ts:18`, and `display-sponsor-overlay.spec.ts:190` — _"reintroducing a tier accent or size detonates it."_                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **"the no-client-storage rule"** — constitutional                          | **UNVERIFIED as an invariant.** Not in `architectural-invariants.yaml`. No spec in `tests/e2e/0-architecture/` asserts it. The behaviour is real doctrine; the _gate_ could not be located.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **"the form-validation invariant"** — fail closed, size caps, pool routing | **UNVERIFIED as a registry invariant.** The behaviour is real and strong in code (`validateCategorySelections`, `sponsor-promotion.ts` re-validation with no partial write), but there is no named invariant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Registry invariants actually cited below, with live status:**

| #   | Name                          | Status    |
| --- | ----------------------------- | --------- |
| 1   | `anonymous_id`                | **live**  |
| 5   | `tier_equity`                 | _partial_ |
| 7   | `aggregate_only_reporting`    | _partial_ |
| 8   | `bounded_pii_retention`       | **live**  |
| 14  | `mobile_workability`          | _partial_ |
| 22  | `cross_repo_import_isolation` | **live**  |
| 25  | `sponsor_share_covenant`      | **live**  |

**This matters for Part C.** Two of the five things the Director of Security is said to hold veto over — no-client-storage and the form validators — are **not registry invariants**. They are real behaviours with weaker enforcement than the prompt assumes. The Director's veto still stands on judgement; it does not stand on a citation.

---

## PART A — The list back, unchanged

| #   | Law                      | Grade | Finding                                                                                                                                           | Stories proposed                                                                     |
| --- | ------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Hick's law               | C     | Attendee surfaces are one-choice by construction; template selection presents 24 seeded templates across 8 categories with no reduction strategy. | Category-first picker (M); surface recent/curated (S)                                |
| 2   | Fitts's law              | B     | 44px floor and above-fold CTA are asserted by five contracts, but the audit is informational and targets deployed staging, not PR code.           | Audit runs on PR code (M); promote Contract 2 to blocking (S)                        |
| 3   | Jakob's law              | B     | QR→form→inline-success is fully conventional; UEC is an invented convention with a grayscale fallback that is claimed but not asserted.           | Assert grayscale label fallback (S)                                                  |
| 4   | Law of proximity         | C     | Card grouping is correct throughout; the email capture and the data promise sit ~1500px apart on the landing page.                                | Separate legal from action group (S); colocate promise with capture (S)              |
| 5   | Miller's law             | B     | 7 core codes + 4 chunked extensions is real chunking, but the 7 is defended on colour psychology, never on working memory.                        | Assert ≤7 UEC codes per printed surface (S)                                          |
| 6   | Doherty threshold        | C     | Edge architecture and `stale-while-revalidate` are right; BigQuery reads are documented at 1–5s and nothing is measured.                          | Measure p50/p95 per surface (M); serve SharedReport from materialised aggregates (L) |
| 7   | Von Restorff effect      | B     | UEC is the isolation effect operationalised; the landing page runs seven competing saturated colours so nothing is isolated.                      | Reduce competing saturation (M); ΔE rule vs UEC hues (S)                             |
| 8   | Minimize target distance | C     | Width capped, no horizontal scroll, CTA above fold — but "above fold" permits y=800 and thumb zones are unmeasured.                               | Contract 4b: CTA in lower-third thumb zone (S)                                       |
| 9   | Serial position effect   | A−    | Already solved by a seeded shuffle (OSE-1138 / #25 / COST-101); residue is fixed within-event primacy and two co-existing orderings.              | Seed on (event_id, time_bucket) (M); rename `buildShareRotation` (S)                 |
| 10  | Peak-end rule            | C     | Deliberate success state with `data-testid="form-success"`; the survey's actual ending is 7 lines of GDPR prose.                                  | Thank-you is the last thing read (S); design the below-floor state (M)               |
| 11  | Zeigarnik effect         | D     | Attendee flows are single-step by design; sponsor drafts have a `status` column and no completion affordance anywhere.                            | Surface draft status to submitter (M); admin draft queue (S)                         |
| 12  | Law of Prägnanz          | B     | UEC and the form card are unambiguous; the landing hero resolves to two competing readings — directory or mailing list.                           | One primary reading above fold (M); consistent card icons (S)                        |
| 13  | Law of similarity        | A−    | `scan_hex`/`display_hex` typed apart with `getCode()` as sole accessor; a brand hue has already drifted toward SPONSOR navy.                      | Perceptual-distance check vs every `scan_hex` (S)                                    |
| 14  | Uniform connectedness    | C     | Cards used consistently and correctly, but they bind the wrong things — legal inside the form card, promise connected to nothing.                 | Disclosure outside the form card (S); connect promise to capture (S)                 |
| 15  | Tesler's law             | B     | Anonymity complexity is absorbed by the platform as thoroughly as any system graded; the cited ADR-003 does not exist.                            | Write or retract the operator-role decision (S)                                      |
| 16  | Postel's law             | C     | Conservative half enforced; the safe liberal half — trim, email casing, phone punctuation — is absent with no security benefit.                   | Pre-validation normalisation (S); assert it cannot widen the validator (S)           |
| 17  | Postel's law _(dup)_     | —     | Transcription error. 19 distinct laws; 18 distinct principles once item 8 folds into item 2.                                                      | —                                                                                    |
| 18  | Parkinson's law          | D     | The 10-second comprehension rule is stated on one surface family and measured nowhere; surfaces have grown to 15 fold elements.                   | Per-surface first-view element budget (M); make the rule measurable (S)              |
| 19  | Occam's Razor            | C     | Newest code is razor-clean; one concept exists in five representations and silently blocked the governance model.                                 | _(OSE-1220/1221)_; CI flag for same-name different-type columns (S)                  |
| 20  | Pareto principle         | C     | Vital few correctly identified in docs; investment went to the landing page, and two vital surfaces cannot even be audited.                       | Which templates/flags are used (M); restore auditability (M) _(OSE-1211)_            |

---

## PART B — Cross-cutting synthesis

### B1. Clusters — twenty findings are seven pieces of work

| Cluster                          | Laws                | Distinct work                                                                                                                       |
| -------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **C1 · Colour system integrity** | 7, 12 (partial), 13 | One ΔE rule + de-saturate the landing page. The UEC core needs nothing.                                                             |
| **C2 · Choice architecture**     | 1, 5, 19            | One progressive-disclosure pattern for the template picker; the consolidation half is already ticketed.                             |
| **C3 · First-view density**      | 4, 10, 12, 14, 18   | **One layout pass.** Legal out of the form card, promise beside the capture, thank-you last, element budget. Already OSE-1231/1232. |
| **C4 · Mobile measurement**      | 2, 8, 14 (partial)  | Point the existing audit at PR code and add a thumb-zone contract. No new test infrastructure.                                      |
| **C5 · Latency**                 | 6                   | Measure, then materialise. Standalone.                                                                                              |
| **C6 · Input tolerance**         | 16                  | Pre-validation normalisation. Standalone, security-adjacent.                                                                        |
| **C7 · Incompleteness**          | 11                  | Sponsor draft status. Standalone, smallest audience.                                                                                |

**Twenty findings are seven pieces of work.** C3 alone touches five laws.

Laws 3, 9, 15, 20 need no new cluster: 9 is nearly done, 15 needs a document written or retracted, 3 needs one assertion, 20 is a measurement question that C4 and C5 answer between them.

### B2. Conflicts, adjudicated

**1 · Postel (16) vs fail-closed validation and `bounded_pii_retention` (#8, live).**
Not a real conflict once the boundary is drawn. **Normalisation before the validator, validation unchanged.** Trimming whitespace, lowercasing an email domain, stripping phone punctuation — none widens the set of values the validator admits, and each is lossless in the direction that matters. The conflict would be real if normalisation ran _after_ validation or could expand field length past the cap. **Verdict: proceed, with a test asserting normalisation cannot widen admission.** The Director gets the final word in Part C.

**2 · Doherty (6) vs the no-client-storage rule.**
Real, and unresolvable on the client. But the rule is **unverified as an invariant** (see top), which changes the _escalation path_, not the answer: even if it were only doctrine, warm-caching an anonymous scan path on the device contradicts `anonymous_id` (#1, live) in spirit. **Verdict: the client-side fix stays off the table. Server-side is not a workaround, it is the correct answer** — `stale-while-revalidate` and materialised `scan_aggregates` already exist and are unexhausted.

**3 · Peak-end (10) vs K=5 suppression.**
Not a conflict. The tension is entirely in _presentation_. A suppressed count is the honest output; rendering it as an error state is the defect. **Verdict: K=5 is untouchable; the below-floor state gets designed as week one of a healthy campaign, not a failure.** This is the single cheapest brand-promise improvement in the audit — the suppression _is_ the proof the platform works.

**4 · Serial position (9) vs `sponsor_share_covenant` (#25, live).**
Already adjudicated in code, and correctly. The remaining question is narrow: **is fixed within-event primacy a covenant violation?** #25 forbids _buying_ position. A seeded shuffle sells nobody anything — position is arbitrary, not purchasable. **Verdict: not a violation.** Rotating the seed on a time bucket is an improvement, not a remediation, and must stay deterministic under COST-101.

**5 · Von Restorff (7) vs the OSE-322 static gate.**
**Corrected.** The gate is live, not future. But its scope is the decisive fact, and OSE-322's own acceptance criteria state it: _"Analyzer scopes to QR generation surface using the chosen strategy"_ and _"Analyzer **ignores CSS, theme files, design tokens**, and other surfaces that legitimately carry non-QR hex values."_

So the gate protects the **scannable** surface — where a wrong hue breaks a QR read — and deliberately leaves the **brand/CSS** surface open, correctly, because that is not what it is for.

**Verdict: no conflict, and the ΔE rule matters more than I first said.** `#4361EE` on the landing Ring drifting toward SPONSOR navy `#1A3A8A` is precisely the class of drift OSE-322 excludes by design. The gate cannot catch it and should not try. A perceptual-distance rule between brand tokens and every `scan_hex` is the missing complement to a gate that is already doing its half of the job correctly — not a substitute for a gate that does not exist.
**6 · Any aesthetic change vs WALL-3b (OSE-835).**
Real, live, and narrow. WALL-3b detonates on **tier-keyed** CSS — a tier accent or a tier-varying size on the sponsor render seam. **Verdict: no conflict with anything in this audit.** Nothing proposed here keys style to tier. It becomes a live constraint only if de-saturation were applied per-tier, which nobody wants. `tier_equity` (#5) is _partial_, so this is the stronger of the two protections.

### B3. Sequencing by leverage

| Rank  | Work                                     | Laws moved        | Why here                                                                                                 |
| ----- | ---------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| **1** | **C3 first-view density pass**           | 4, 10, 12, 14, 18 | **Five laws, one layout pass.** Nothing else comes close. Already scoped as OSE-1231/1232.               |
| **2** | **C4 point the mobile audit at PR code** | 2, 8, 14          | Converts an advisory measurement into a gate. Cheap, and it stops the C3 gains regressing.               |
| **3** | **C1 ΔE rule + landing de-saturation**   | 7, 12, 13         | Three laws; protects the platform's most valuable asset from erosion the audit already caught happening. |
| **4** | **C6 pre-validation normalisation**      | 16                | One law, but it is friction on every form submission on the platform.                                    |
| **5** | **C5 latency measurement**               | 6                 | Cannot fix what is unmeasured; the fix (materialisation) is L-sized and should not start blind.          |
| **6** | **C2 template picker**                   | 1, 5, 19          | Three laws, but on the admin surface — smallest audience, and gated behind CF Access for verification.   |
| **7** | **C7 sponsor draft status**              | 11                | Smallest audience of all.                                                                                |

**Grade-ranked order would have put C2 (a C) above C4 (a B). Leverage inverts that** — C4 protects five other laws from regressing and C2 serves the fewest users.

---

## PART C — The scrum round

**Product Manager.** I support C3 and C4 and I want them in that order, because C3 is the only item that moves five laws for one layout pass and C4 is what stops it decaying. I oppose starting C5 — measuring latency produces a number, not a shipped improvement, and we have two surfaces we cannot even reach to measure. **I will not compromise on C3 shipping as one unit;** splitting the density pass into per-surface stories is how it becomes six tickets that each half-land.

**Senior UX Researcher.** The PM's ordering is right for the wrong reason — C3 matters not because it is efficient but because peak-end (10) is the only law here that changes how someone _feels_ about the platform, and the survey's ending is currently a legal notice. I oppose treating item 18's element budget as a number to be chosen in a meeting; it should be derived from the 10-second rule that already exists. **I will not compromise on the below-floor state being designed as a normal early state** — every alternative teaches attendees that honesty looks like an error.

**Senior Backend Architect.** Neither of the previous two has said what I care about: five of the seven clusters touch no backend at all, which is the actual finding. C5 is mine and I disagree with the PM — the measurement is not optional, because "serve from materialised aggregates" is an L that will be scoped wrong without p95 data, and `scan_aggregates` and `shared-report-materialize.ts` already exist so the fix is plumbing, not invention. **I will not compromise on materialisation replacing live BigQuery reads** on any served-user path; 1–5 seconds is not a threshold miss, it is a different product.

**Director of Security.** I am going to be less obstructive than this roster expects, and more precise. **Postel (16) is approved** — normalisation strictly before validation, lossless, with an asserted test that it cannot widen what the validator admits; trimming a trailing space is not a security event and pretending otherwise costs us real users. **Doherty's client-side cache is vetoed**, permanently and without appeal: no warm cache, no `localStorage`, no IndexedDB on any anonymous surface. **I will not compromise on that** — and I will say plainly that it costs us the cheapest possible latency fix on exactly the surfaces where latency hurts most, which is the price of `anonymous_id` (#1) and I think it is worth paying. One correction for the record: two things this roster believes I hold veto over — no-client-storage and the form validators — are **not registry invariants**. I am enforcing doctrine, not citing a gate, and that gap should be closed.

**Senior Integration Frontend Engineer.** The Director just approved the only item I can ship this week, so I will take it. I oppose C1 landing before the ΔE rule is written down — de-saturating the landing page by eye, with OSE-322 unshipped, means the next person re-saturates it and we have no artifact to point at. **I will not compromise on the rule preceding the repaint;** otherwise C1 is a preference, not a standard.

**Senior Frontend Design Engineer.** The integration engineer has it backwards — the ΔE rule cannot be authored in the abstract, because the threshold has to be validated against the actual six ring hues and the seven `scan_hex` values, which means measuring first and codifying second. On C3 I want the disclosure pattern designed once, as one control with one behaviour, rather than per-surface. **I will not compromise on empty and below-floor states being designed before the happy path** — they are where the platform's honesty is either legible or looks broken.

**Senior Software Test Engineer.** Everyone is discussing what to build and nobody has said that pass 1's central finding is a _testing_ finding: both A− grades were withheld from A because nothing prevents regression. C4 is therefore the highest-value item on this board and the PM ranked it second. I oppose promoting Contract 2 to blocking in the same change that repoints the audit at PR code — do one, confirm the signal is clean, then the other. **I will not compromise on the born-red discipline:** every contract added here must be shown failing against today's behaviour first.

**Senior SDET/SRE.** The test engineer is right about sequencing and wrong about scope — repointing the audit at PR code is not a config change, it is standing up a preview target or running the surfaces in-process, and that is the real cost nobody has priced. On C5, I side with the architect over the PM: we have zero dashboards and zero alerting, so "measure" here means building the measurement, not reading it. **I will not compromise on a named CI job for anything this plan calls a gate** — per repo doctrine, done means exercised by a named job, and an informational comment is not that.

**Senior DevOps Engineer.** Nothing in this plan requires a migration, which makes it the first body of work this quarter that is not sequenced behind OSE-802 — that is worth stating out loud. My objection is to C4 as described: the mobile audit currently targets `STAGING_URL`, and two of the surfaces it should cover return 403 behind the Cloudflare challenge, so repointing it at PR code fixes the freshness problem and leaves the coverage hole. **I will not compromise on OSE-1211 being resolved before we call C4 done** — a gate with two unreachable surfaces is a gate with a hole in it.

**Senior Data Scientist / DB Engineer.** Everyone has skipped item 20, which is the only finding that asks a question we cannot currently answer: which of the 24 templates and 17 flags are actually used. We have no behavioural telemetry by design, so this must come from aggregate event rows, and that is a real query, not a dashboard. I support C5's measurement for a different reason than the architect — p95 per surface is the input to deciding _which_ aggregates to materialise. **I will not compromise on aggregate-only derivation:** answering "which templates are used" must never become a reason to log per-user behaviour.

**Community Manager / Customer Advocate.** I want to name what the roster keeps calling a layout problem and I call a trust problem: on the landing page we ask for an email 1500px before we explain what we do with data. That is item 4, and to a Southside host reading it on a phone it is not a proximity violation, it is the platform behaving like everything else they already distrust. **I will not compromise on the anonymity promise sitting beside the ask**, not below it, and not behind a tap — this is the one piece of text that must never be progressively disclosed.

**Sales Director.** The Community Manager just made my argument. What I sell is the SharedReport and the local covenant, and item 9 is the finding that matters commercially — I can now tell a sponsor that position is a seeded shuffle nobody can buy, and that is a differentiator no competitor can claim. I oppose deprioritising C2 to seventh: the template picker is what a prospect sees in a demo, and 24 undifferentiated options in one list is the moment a demo goes flat. **I will not compromise on being able to demo an event that is not four months old** — the seeding gap is a sales blocker before it is a UX one.

**Business Ops / Finance.** No one has costed anything. Six of the seven clusters are S or M and touch no infrastructure, so the marginal spend is engineering hours; C5's materialisation is the only L and the only item with a recurring cost implication, since it trades BigQuery reads for storage and a scheduled job. I oppose C5 starting before the measurement proves the read volume justifies it. **I will not compromise on this plan routing zero requests through a model at serve time** — everything proposed here is deterministic Workers compute, and it must stay that way.

**Technical Writer.** Three of pass 1's findings are documentation defects that everyone has treated as code defects: ADR-003 is cited for a decision it does not contain, ADR-010 says 32 templates where the migration seeds 24, and `UEC-CODES.md` maps to a `scans` table that migration 0062 dropped. Those cost more than they look — pass 1 nearly graded Tesler's law against a document that does not exist. **I will not compromise on the 10-second rule being made measurable or retired;** a stated standard that nothing checks is worse than no standard, because it lets everyone assume someone else is enforcing it.

**Scrum Master / Delivery Lead (recap).** Decisions, in order. **C3 ships first as one unit** — PM and UX aligned, Design owns the disclosure pattern and does empty states first. **C4 second, split in two** — repoint at PR code, confirm the signal, then promote to blocking; DevOps holds it open until OSE-1211 is resolved, and SDET requires a named CI job. **C1 third**, with the Design Engineer's sequencing: measure the hues, codify the ΔE rule, then repaint. **C6 fourth — the Director approved it** with a test asserting normalisation cannot widen admission. **C5 fifth, measurement only**, gated by Finance on read volume before the L lands. **C2 sixth**, over Sales' objection on ranking but with their seeding point escalated separately — the demo-data gap is not in this plan and needs its own path. **C7 seventh.** The Director's one veto is recorded in Part D with its cost stated. Two documentation defects from the Writer are folded into C3 and C1 rather than tracked apart.

---

## PART D — The compromise

Four constraints held: **Vision** (anonymous by default, never who only how many, the colour is the instruction, free-forever is structural), **Cost** (deterministic Workers compute, zero model tokens at request time), **Functionality** (no live invariant weakened without a stronger substitute), **Security** (the Director's veto stands).

### Ranked work packages

| #      | Package                                                                                                                                                                                                                                                                                                                            | Laws              | Grades moved     | Size  | Sign-off                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------- | ----- | -------------------------------------------------------------------------------------------- |
| **1**  | **First-view density pass** — legal out of the form card behind one disclosure control; anonymity promise beside the email capture; thank-you is the last thing read; per-surface element budget derived from the 10-second rule                                                                                                   | 4, 10, 12, 14, 18 | C→B ×4, D→B ×1   | **M** | Design Eng (owns pattern), UX (below-floor state), Community Mgr (promise placement), Writer |
| **2a** | **Repoint the mobile audit at PR code**                                                                                                                                                                                                                                                                                            | 2, 8, 14          | — _(enables 2b)_ | **M** | SDET (named job), DevOps                                                                     |
| **2b** | **Promote Contract 2 to blocking + add Contract 4b thumb zone**                                                                                                                                                                                                                                                                    | 2, 8              | B→A, C→B         | **S** | SDET, Test Eng (born-red)                                                                    |
| **3**  | **ΔE rule then landing de-saturation** — measure the six ring hues against the seven `scan_hex` values, codify a minimum perceptual distance, then repaint. **Complements OSE-322 rather than duplicating it**: that gate scopes to the QR surface and explicitly ignores CSS and design tokens, which is where the drift happened | 7, 12, 13         | B→A− ×1, A−→A ×1 | **M** | Design Eng (measure first), Integration Eng                                                  |
| **4**  | **Pre-validation normalisation** — trim, lowercase email domain, strip phone punctuation, with an asserted test that normalisation cannot widen what the validator admits                                                                                                                                                          | 16                | C→B              | **S** | **Director of Security (approved)**, Test Eng                                                |
| **5**  | **Latency measurement** — p50/p95 per surface against 400ms, named job                                                                                                                                                                                                                                                             | 6                 | C→B              | **M** | SRE, Architect, Finance (gate on the L)                                                      |
| **6**  | **Template picker: category-first**                                                                                                                                                                                                                                                                                                | 1, 5, 19          | C→B ×2           | **M** | PM, Sales, Design Eng                                                                        |
| **7**  | **Sponsor draft status affordance**                                                                                                                                                                                                                                                                                                | 11                | D→C              | **M** | PM, Integration Eng                                                                          |

**Not in this plan, escalated separately:** the demo-seeding gap (Sales), and OSE-1211 (DevOps holds 2a/2b open on it).

### Accepted losses

| Rejected improvement                                                                                                                            | Killed by                                                           | What would change it                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Client-side warm cache on anonymous surfaces** — the cheapest possible Doherty fix, and the one that would help most where latency hurts most | **Director's veto**, standing on `anonymous_id` (#1, live) doctrine | Nothing. This is permanent. The cost is real and is the price of the anonymity claim. Server-side materialisation is the substitute, and it is slower to build and more expensive to run. |
| **Sub-400ms SharedReport on first load**                                                                                                        | Physics + BigQuery at 1–5s                                          | Materialisation (package 5's successor). Deferred, not refused.                                                                                                                           |
| **Reducing the template menu**                                                                                                                  | ADR-010 Accepted (_"templates never gate"_) + `tier_equity` (#5)    | Only a new ADR. Package 6 reorders and discloses progressively; it removes nothing.                                                                                                       |
| **Per-impression sponsor rotation**                                                                                                             | COST-101 (no `Math.random` on any path)                             | Nothing needs to change — seed on `(event_id, time_bucket)` achieves it deterministically. Listed here only because the naive version is forbidden.                                       |
| **Progressive disclosure of the anonymity promise**                                                                                             | **Community Manager, hard line**                                    | Nothing should. Every other text on the platform may be collapsed; this one may not.                                                                                                      |
| **Auditing `/events/:id` and `/poster/:id`**                                                                                                    | Cloudflare challenge (OSE-1211)                                     | Resolution of OSE-1211. Until then packages 2a/2b ship with a known coverage hole, and DevOps will not call them done.                                                                    |

### Cheap wins

S-sized, violate nothing, need no sign-off beyond the frontend engineer:

1. **Move the survey's legal block outside the form card.** One container change. Fixes the worst uniform-connectedness violation (14) and improves peak-end (10) immediately.
2. **Consistent icon treatment across the three landing feature cards.** One of the three renders at a visibly different weight, breaking similarity (13) and Prägnanz (12).
3. **Rename `buildShareRotation`** to signal it is the allocation view, not the render order. Pure clarity; removes the trap of two co-existing orderings (9).
4. **Assert the UEC grayscale label fallback renders.** The deployment checklist already claims it; this makes the claim true (3).
5. **Fix the two documentation defects** — ADR-010's 32-vs-24, and `UEC-CODES.md`'s reference to the `scans` table dropped by migration 0062 (19).

Items 1 and 2 are visible to users the day they ship. Items 3–5 are the kind of thing that stops the next audit finding the same problem.

---

_Synthesis only. No re-grading, no code, no issues created. Every constraint named above was verified against the repository, or explicitly marked unverified at the top of this document._
