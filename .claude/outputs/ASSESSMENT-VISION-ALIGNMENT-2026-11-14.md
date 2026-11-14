# Assessment: how closely the build matches the vision and the documentation

> **What this is, and is not.** [Claude] This follows the owner's assessment template: nine reviewer roles working independently, then one reconciliation pass. It is **not** a CCR worksheet under this repo's protocol (`.claude/skills/ccr/SKILL.md`), which needs the loops run in order (Critical, Conservative, Recursive, or five for architecture) and is checked by `scripts/ci/ccr-worksheet-check.mjs`. Only the first round was run. The file was first committed under a `CCR-` name; the worksheet gate correctly refused it, and it was renamed instead of being given a header it had not earned. To make it a binding CCR, the remaining loops have to be run.

Date: 2026-11-14. Pass 1 of 3. Written by [Claude]; findings are tagged [Agent] with the role that raised them.
Scope: OurSharedEvents (OSE), OurWKRP (OW), OCR-docs and the hub, each read at `origin/main`.
Nothing in code, config or Linear was changed for this assessment.

## Verdict

| Area | Intentions checked | Met | Percent | Floor 80% |
|---|---|---|---|---|
| 1. Design | 20 | 11 | 55% | below |
| 2. Code | 25 | 15 | 60% | below |
| 3. YAML and CI/CD | 25 | 11 | 44% | below |
| 4. Test pyramid | 23 | 13 | 57% | below |
| 5. Reporting | 18 | 7 | 39% | below |
| **Overall (equal weight)** | 111 | 57 | **51%** | **fails the 95% threshold** |

- Overall = mean of the five area percentages (55 + 60 + 44 + 56.5 + 38.9) / 5 = 50.9%. Pooled, 57 of 111 = 51.4%.
- Score by the CCR weights, for comparison only (100 minus weighted open findings): 10 High findings × 10 already reach 100, so the score is 0. No Security Critical or Regulatory finding was raised.
- Assessment confidence: about 75%. Reasons are under "What was not checked".
- **Read this number with care.** "Met" means fully met. A partly met intention counts as not met. The sample leans toward places a reviewer found a problem, so the true figure is probably higher than 51% and is certainly well under 95%.

## The owner's words (verbatim)

> "The Market/Fair work is the actual work where as think of the showcase work of the extreme custom ideal of where the work can go based on dedicated effort."

> "Pass threshold: 95% overall, and no single area below [80%]."

> "Do not change code, config, or Linear until the assessment report is written."

> "Flag every assumption instead of guessing."

## Assumptions [Claude]

The template arrived with its placeholders unfilled. I filled them as follows; each is a guess to confirm.

1. Vision document: `OCR-docs/docs/OCR_VISION.md`. Documentation: each repo's `CLAUDE.md` and `AGENTS.md`, the brain (`ocr-docs-brain/architectural-invariants.yaml`), ADRs, standards, and the owner's stated priority on Linear OSE-1996.
2. Weights: equal across the five areas.
3. Area floor: 80%. Pass limit: 3.
4. Follow-through: option A (create only the missing Linear items, then stop and show the list). Nothing is created yet.
5. A partly met intention counts as not met. An intention nobody could verify is left out of the count and listed below.
6. Where one fact touches two areas it is counted once, in the area named in the table. Example: OW security tests not being required is charged to CI/CD, not to each control in Code.
7. Some "intentions" are implied, not written as a rule (an alert when staging goes red; an accessibility check on the OW app). They are marked "implied".
8. The owner's own framing ("50+ event types at launch", sites seen by map, hyperlocal economies) is treated as vision although `OCR_VISION.md` does not state it. That gap is itself listed as a conflict.

## Reviewers

Nine [Agent] lenses worked independently in Loop 1: Design FE, SDET/SRE, Product Owner, Backend Architect, FE Integration, Data Scientist, DevOps, Dr of Security, Sr Automation QA. [Claude] ran the reconciliation pass: eight findings were re-read against the files, one was refuted (the showcase does have a raw-hex gate), and one was lowered (the "32 templates" line in OSE ADR-010 describes the older platform).

---

## Area 1. Design: 11 of 20 (55%)

Met:
1. OSE design check blocks a PR. `oursharedevents ci.yml:722-735` [Agent: Design FE]
2. OW design check blocks, against main's baseline. OW `ci.yml:158-170` [Agent: Design FE]
3. OW hub pin matches its doc (b039d2f) and its baseline is empty. [Agent: Design FE]
4. OSE hub pin is current (4a82902). [Agent: Design FE]
5. Showcase accessibility gate. `showcase.yml:260` [Agent: Design FE]
6. OSE axe jobs. `ci.yml:788, 939` [Agent: Design FE]
7. One `<h1>` per page, gated over the route table. `tests/page-surfaces-one-h1.spec.ts` [Agent: FE Integration]
8. Sponsor strip order tested on poster, admin preview, display, phone and countdown. [Agent: FE Integration]
9. Showcase refuses raw hex (`hexProblems`, with a planted fault). [Claude, reconciliation]
10. Security is never tier-gated. Tier-equity spec, `ci.yml:874` [Agent: Dr of Security]
11. The only public cookie is `ose_anon`. `cookie-setters.invariant.spec.ts`, `ci.yml:888` [Agent: Dr of Security]

Not met:
12. Colours only from tokens (OSE). 33 raw hex values in 4 templates, baseline of 13 entries; `corridor-map.ts:65, 70, 106`. F-D2, F-D3 Medium [Agent: Design FE]
13. Spokes track the hub. OW pin is 6 hub commits behind. F-D1 Medium [Agent: Design FE]
14. Accessibility checked on the OW app pages (implied). No axe job outside the showcase. F-D7 Medium [Agent: Design FE]
15. "Mockups for every screen are in canvas". None for OW catalog, create, import, dashboard, stats; none found for a stall or fair floor (not confirmed). F-D9, F-D10 [Agent: Design FE]
16. HANDOFF says where things stand. It still lists the map colour as open. F-D6 Low [Agent: Design FE]
17. Sponsor strip order on every page with a title. No test found for the public event page, SharedReport or sponsor home. F-F3 Medium [Agent: FE Integration]
18. The display shows no counts. Checked per pane, not by one assertion over all panes. F-F3 Medium [Agent: FE Integration]
19. Place, not person. See conflicts 8 and 9. F-SEC-7, F-SEC-8 Low [Agent: Dr of Security]
20. One map for attendees. `GET /api/v2/map/areas` shipped (OSE-2039) and nothing uses it; the showcase draws its own. F-F1 Medium [Agent: FE Integration]

## Area 2. Code: 15 of 25 (60%)

Met:
1. Runtime is LLM-free. `runtime-llm-free.invariant.spec.ts:118`, `ci.yml:867` [Agent: Dr of Security]
2. Admin write guard runs before every admin route. `router.ts:915` [Agent: Dr of Security]
3. Brand scope on by-id routes. `admin-object-scope.ts:83-117` [Agent: Dr of Security]
4. Public event answer is an allowlist. `public-event-projection.spec.ts:45-80` [Agent: Dr of Security]
5. PII encrypted, pepper required. `pii.ts`; deploy gate `ci.yml:1268, 2875` [Agent: Dr of Security]
6. Per-event keyed id. `event-anon-key.ts`, `migrations-forms/0016` [Agent: Dr of Security]
7. Migrations kept apart (109 and 18) with discipline. [Agent: Backend Architect]
8. OW music seam is aggregate-only and fails closed. `src/lib/privacy.ts:10-31` [Agent: Backend Architect]
9. OW session limits, 30 days absolute and 7 idle. `session.ts:15-17, 47` [Agent: Dr of Security]
10. OW production has its own KV and D1. `env-isolation.invariant.test.ts:94-111` [Agent: DevOps]
11. OW pages use per-request CSP nonces. `security-headers.ts:27-28` (note: `style-src` keeps `'unsafe-inline'`) [Agent: Dr of Security]
12. Event types are locked by a test at 48. `tests/reg1-event-types.spec.ts:39-43` [Agent: Backend Architect]
13. Market codes exist and map to a template. Migration `0057:78` [Agent: Product Owner]
14. Sponsors show only with two-sided consent. Seen against a real OSE worker this session. [Claude]
15. Series, campaign, calendar and attendance mode match the vision. [Agent: Product Owner]

Not met:
16. Two databases never crossed. The code check names three files; a new handler using both would pass. F-SEC-6 Low [Agent: Dr of Security]
17. Every public read is rate-limited. No test covers all public routes. Medium [Agent: Dr of Security]
18. One count-floor for the fleet. OW keeps its own copy without the rate helpers (OSE-1782). F-DS3 Medium [Agent: Data Scientist]
19. The router header is the canonical route list. Six routes are missing (`router.ts:1025, 1078, 1470, 2004, 2211`, and `maps/venue-image`). F-B3 Medium [Agent: Backend Architect]
20. "50+ event types at launch". 48 are active. F-P2 High [Agent: Product Owner]
21. Template count. 25 seeded; documents say 32. F-B1 Low after reconciliation [Agent: Backend Architect]
22. Markets and fairs as first-class things. No stall, vendor, programme-in-event, paid table or floor entity. Paid tables also meet the regulatory phasing (migration `0023:10`). F-P3 High, F-B4 Medium [Agent: Product Owner, Backend Architect]
23. OW tokens encrypted at rest. With no key set they are written as plain text, and nothing checks the key is set. `crypto.ts:75-78`. F-SEC-3 Medium, see conflict 5 [Agent: Dr of Security]
24. The product registry. OSG, OSR, OSP, OSM and OA exist as documents only. F-P4 Medium [Agent: Product Owner]
25. OW production runs what is on main. It is a June build (OW-183, known).

## Area 3. YAML and CI/CD: 11 of 25 (44%)

Met:
1. OSE merges are blocked by 11 required checks, for everyone. Read live from GitHub. [Agent: Dr of Security]
2. OSE committed-secret gate and SAST fail the job. `ci.yml:262-300` [Agent: Dr of Security]
3. OSE T1 to T4 staging chain. `ci.yml:1179, 1844, 2014, 2739` [Agent: Sr Automation QA]
4. A push to main is never cancelled by the next (OSE `ci.yml:154-158`, OW `ci.yml:55-62`). [Agent: SDET/SRE]
5. OW "All Checks Passed" needs success. `ci.yml:414-418` [Agent: SDET/SRE]
6. OSE refuses a deploy ahead of its database. `ci.yml:1363` [Agent: SDET/SRE]
7. OSE staging watch opens an issue when red. `stg-watch.yml:15-16, 109` [Agent: SDET/SRE]
8. OW deploy key kept apart from runtime secrets. `wrangler-ci.sh:25-60` [Agent: DevOps]
9. OSE production deploy must be on main and migrates first. `ci.yml:2919-2987` [Agent: DevOps]
10. OSE environment differences are named. `env-parity.mjs:37-81` [Agent: DevOps]
11. OW staging deploy waits for all checks. `ci.yml:515` [Agent: Dr of Security]

Not met:
12. OW invariant specs "blocking on PR". OW main requires only `S0 Security` and the brain check. A red security test does not block a merge. F-SEC-1 High, read live [Agent: Dr of Security]
13. OW SAST can fail a PR. CodeQL uploads and prints "passed" either way. `ci.yml:101-122`. F-SEC-2 Medium, inferred [Agent: Dr of Security]
14. CODEOWNERS binds governance files and the AI seam. `tools/ci/main-branch-protection.json` sets no required review. F-SEC-5 Medium, inferred [Agent: Dr of Security]
15. PR jobs hold no long-lived secret. The hub read token reaches a script the PR can edit. F-SEC-4 Medium, see conflict 6 [Agent: Dr of Security]
16. Someone is told when the staging chain goes red on main (implied). No notify step. F-S1 High [Agent: SDET/SRE]
17. OW's summary checks cover the deploy. The reconciler is advisory and the list leaves deploy jobs out. `ci.yml:424-451`. F-S2 High [Agent: SDET/SRE]
18. Staging and production in sync. Config only; migration level and deployed SHA are not compared; OW has no parity script. F-S3, F-O6 Medium [Agent: SDET/SRE, DevOps]
19. No gate that cannot fail. `continue-on-error` or `|| true` on OCR-docs checks (`phantom-scan.yml:94`, `brain-location-audit.yml:147`, `docs-ci.yml:50-56`), OW brain pyramid (`brain-contract-check.yml:63`), OW mobile check (`mobile-workability.yml:61`). F-S4, F-S5, F-QA-4, F-QA-5 Medium
20. OSE rollback practised. `docs/runbooks/ROLLBACK.md:5` says "Not yet practised". F-O1 High [Agent: DevOps]
21. OW rollback. None written or rehearsed. F-O2 High [Agent: DevOps]
22. One Cloudflare token per environment (OSE). One token serves both. `ci.yml:1261, 2985`. F-O3 Medium [Agent: DevOps]
23. OW staging answers. See "Staging today" below (OW-114, known).
24. OSE production closed. Held, not closed (OSE-1353, OSE-1377, known).
25. Production only through CI. Wired, but environment rules could not be read. Partial [Agent: Dr of Security]

## Area 4. Test pyramid: 13 of 23 (57%)

Met:
1. OSE security, lint, unit, integration before merge. `ci.yml:178, 384, 954`
2. OSE T1 to T4 all present.
3. OSE Bruno on staging blocks. `ci.yml:1749`
4. All 44 OSE architecture specs are named in CI. `ci.yml:840, 2281`
5. OSE ratchet on skips and `continue-on-error`. `ci.yml:745`
6. OW unit, integration, contract, security, fuzz, performance all run. `ci.yml:198-393`
7. OW Playwright blocks; zero tests is a failure. `ci.yml:266`
8. OW Bruno with a case-count guard. `ci.yml:335`
9. OW invariant specs run in the security job. (inferred)
10. OW showcase born-red harness. `showcase.yml:134`
11. OW showcase layers 0 to 4 plus e2e. `showcase.yml:233`
12. OW mutation testing on PR and nightly. (inferred)
13. Showcase checked against a real OSE worker at a pinned commit. [Agent: FE Integration]
(1 to 12: [Agent: Sr Automation QA])

Not met:
14. "A spec counts only if a workflow names it". 97 OSE e2e specs are named in no workflow. `.ci-integrity-baseline.json`. F-QA-1 High
15. "A gate that cannot fail counts as absent". OSE has 364 conditional and 30 unconditional skips. F-QA-2 High
16. Bruno counts only if its test names print. No zero-case guard in OSE. F-QA-7 Medium, inferred
17. Born red. Mechanised only for OSE covenant guards and the OW showcase. F-QA-6 Medium
18. Every case at two layers. Of 5 sampled routes, `/near` and `/events/:id/calendar.ics` are thin. F-QA-8 Low, by grep
19. OW staging tests gate something. They run after the deploy and gate only the production dispatch. F-QA-3 Medium
20. OW brain gate blocks. See conflict 7. F-QA-4 Medium
21. OW mobile workability blocks. `mobile-workability.yml:61`. F-QA-5 Medium
22. OW test counts in CLAUDE.md. About 1,178 blocks in 118 files today against "≈1,131 / 116". F-QA-8 Low
23. OSE locks the sponsor-bundle shape the showcase reads. No shape test found on the OSE side. F-F2 Medium [Agent: FE Integration]
(14 to 22: [Agent: Sr Automation QA])

## Area 5. Reporting: 7 of 18 (39%)

Met:
1. The floor library. `count-floor.ts:53-60, 72-81, 150, 225, 249`
2. SharedReport builder uses the helpers. `shared-report-builder.ts:398, 983, 1036`
3. OW music seam is floored. `events.ts:83-87`
4. BigQuery grain guard.
5. Depth gated by leaving fields out.
(1 to 5: [Agent: Data Scientist])
6. Both pipelines draw a board per run. [Agent: SDET/SRE]
7. A withheld count reads "Fewer than 5" on the showcase, seen against a real worker. [Claude]

Not met:
8. Campaign sponsor count. It adds one per sponsor per surface, so it overstates. `shared-report-builder.ts:702`. F-DS1 Medium [Agent: Data Scientist]
9. Campaign summary under the floor. No "Fewer than 5" path and no test. F-DS2 Medium [Agent: Data Scientist]
10. The floor has no exceptions. Some counts an admin still reads exactly (OSE-1656, OSE-1652, known).
11. OW DJ count is exact beside a floored listener count. `events.ts:109`. F-DS4 Medium [Agent: Data Scientist]
12. OER answers across products. Only a daily OSE backup to BigQuery exists. F-DS5 Low [Agent: Data Scientist]
13. Fair reporting. Not expressible without a stall entity. F-DS6 Low [Agent: Data Scientist]
14. Numbers in documents carry their method. "47" event types stands in four documents and one test comment; 48 is true. F-B2 Medium [Agent: Backend Architect]
15. The vision is current. `OCR_VISION.md` is a draft last updated 2026-04-14; six open decisions have no recorded answer. F-P5 Medium [Agent: Product Owner]
16. Role state and knowledge files are current. `ROLE-STATE.md` says its counts are old; the frontend knowledge file describes two surfaces. F-F4, F-F5 Low [Agent: FE Integration]
17. Work follows the stated priority. 72 OSE commits since 2026-11-01, one on markets and fairs. F-P1 High [Agent: Product Owner]
18. Lasting evidence of Done for OW. The board is per run only. F-S7 Low [Agent: SDET/SRE]

---

## Conflicts between documents (no winner picked)

1. Event types: the owner says "50+ at launch"; code has 48; four documents say 47; `OCR_VISION.md` gives no number.
2. Templates: 25 seeded; OSE ADR-010 line 9 and `OCR_DECISION_mockDataProvider.md:34` say 32.
3. MVP surfaces: `OCR_VISION.md` says 5, `docs/brain/PRODUCT.md` says 6.
4. OER: `OCR_VISION.md` §6.6 describes it as existing; the code has a backup only.
5. OW token encryption: `wrangler.toml` documents "unset = plain text" as a planned rollout; `OCR_STANDARD_secretsAndTokens.md:63, 247` (status PROPOSED) forbids plain text.
6. Hub read token: OW `CLAUDE.md:73` treats step-scoping as the control; the same proposed standard (`:26, :167`) says PR jobs hold no long-lived secret.
7. OW `CLAUDE.md:123` says both invariant mechanisms are "blocking on PR"; the workflow has `continue-on-error` on one, and GitHub requires only two checks.
8. `AGENTS.md:30` says "location is an H3 cell"; `events.lat/lon` and `sponsors.lat/lon` are stored (venue coordinates, migrations 0021, 0045).
9. "No `CF-IP*` header is read": `CF-Connecting-IP` is read for rate limits, Turnstile and a masked audit entry. Whether the rule covers it is unclear.
10. `ci.yml:743` describes an admin merge over a red step; `AGENTS.md` forbids `--admin` merges.
11. OW `CLAUDE.md` test total "≈1,131" against its own rows (about 1,121) and today's count (about 1,178).
12. The owner's framing (map, hyperlocal economies, 50+) is not in `OCR_VISION.md`.

## Findings register

High (10): F-P1, F-P2, F-P3, F-S1, F-S2, F-O1, F-O2, F-QA-1, F-QA-2, F-SEC-1.
Medium (32): F-D1, F-D2, F-D3, F-D7, F-D9, F-S3, F-S4, F-S5, F-P4, F-P5, F-B2, F-B3, F-B4, F-F1, F-F2, F-F3, F-DS1, F-DS2, F-DS3, F-DS4, F-O3, F-O4, F-O6, F-QA-3, F-QA-4, F-QA-5, F-QA-6, F-QA-7, F-SEC-2, F-SEC-3, F-SEC-4, F-SEC-5.
Low (21): F-D6, F-D8, F-D10, F-S6, F-S7, F-P6, F-B1, F-B6, F-F4, F-F5, F-DS5, F-DS6, F-O8, F-O9, F-QA-8, F-QA-9, F-SEC-6 to F-SEC-10.
Arithmetic: High alone is 10 × 10 = 100, so 100 − 100 = 0 before Medium and Low are added.

## Staging today [Claude]

The merge of ourWKRP #117 deployed `stg.ourwkrp.com (custom domain)` at 05:55:52 UTC (run 43563291006). The live check ran 0.3 s later and failed on the TLS handshake. At 06:14 UTC the host still refused the handshake. Not fixed until it answers.

## What was not checked

- Branch protection review rules, environment rules and default token permissions (GitHub answered 403).
- Whether staging and production hold each secret.
- No suite was run for this assessment; no gate was watched failing.
- OSE `dashboards.ts`, `live-monitor.ts`, `forms.ts`, `pages.ts` count sites were not traced.
- The hub's own `packages/ui` checks; the `policy-gate` hook (installed per user).
- Linear was not searched in this pass. That is the first step of the follow-through.

## Proposed grouping for the follow-through (nothing created yet)

Existing items to link, not duplicate: OSE-1996 and OSE-1997 (market and fair), OW-114, OW-183, OSE-1353, OSE-1377, OSE-1656, OSE-1652, OSE-1782, OSE-2039, OSE-2022, OCR-211.

| Proposed epic | Covers |
|---|---|
| A. Markets and fairs as first-class (under OSE-1996) | F-P1, F-P3, F-B4, F-DS6, F-D9, the event-type count |
| B. OW merge and deploy gates bind | F-SEC-1, F-SEC-2, F-S2, F-QA-3, F-QA-4, F-QA-5, OW-114 |
| C. OSE tests that cannot fail | F-QA-1, F-QA-2, F-QA-6, F-QA-7, F-F2, F-F3 |
| D. Rollback and environment parity | F-O1, F-O2, F-O3, F-O4, F-O6, F-S3, F-S1 |
| E. Counts and reports | F-DS1 to F-DS4, OSE-1656, OSE-1652 |
| F. Documents that agree | conflicts 1 to 12, F-B2, F-B3, F-P5, F-P6, F-F4, F-F5, F-QA-8 |
| G. Design debt | F-D1, F-D2, F-D3, F-D7, F-D10, F-F1 |
| H. Secrets and review | F-SEC-3, F-SEC-4, F-SEC-5 |

## Human-gate questions for the owner

1. A or B for the follow-through?
2. Are the weights (equal), the floor (80%) and the pass limit (3) right?
3. "50+ event types": add two types, or change the stated number?
4. Should a partly met intention count as half? It would lift the overall figure and not past 80%.
