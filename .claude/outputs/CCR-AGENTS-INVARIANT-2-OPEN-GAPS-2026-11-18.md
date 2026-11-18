---
ccr: 1
class: governance
requested_loops: 5
loops_run: 5
team: base
gate: stop
cumulative_score: 0
system_score: 0
unresolved: { regulatory: 1, security_critical: 1, critical: 1, high: 6, medium: 8, low: 7 }
pr: 1436
subject_sha: '8f9a690dd46d4ed997f087ec82a7e72815eea91f' # pragma: allowlist secret (a git commit id, not a secret)
---

# CCR: the "Open gaps" sentence in AGENTS.md invariant 2 (PR #1436, OSE-2087)

Dates: 2026-11-16 to 2026-11-18. The owner said "start the review". Run by Claude Code, which also wrote the change under review and several of the defects the review found. The working notes, loop by loop, are `.claude/documents/REVIEW-NOTES-AGENTS-INVARIANT-2-OPEN-GAPS-2026-11-16.md`.

## Verdict

| Item             | Result                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Classification   | Governance (a change to AGENTS.md): 5 loops, base team, a human gate after every loop                          |
| Loops run        | 5 of 5: Critical, Conservative, Adversarial, Compliance, Recursive                                             |
| Loop results     | 31%, 0%, 0%, 0%, 36%                                                                                           |
| Cumulative       | **0%**                                                                                                         |
| System score now | **0%**: a Security Critical finding is open (F17, OSE-2136) and takes no partial credit                        |
| Gate             | **Stop.** The owner decides. This PR is not to merge on this worksheet                                         |
| Confidence       | Moderate. Most findings were read in source. Two were seen once in a scratch test that was deleted. See loop 5 |

In one sentence: the old sentence was false (it named two finished tickets), the new one is a pointer to a list that is true as far as I could check, and the list is long enough that the owner should rule on it before the instructions change.

## What was reviewed

- The sentence in `AGENTS.md` invariant 2: "Open gaps: OSE-1656 (some counts an admin still reads exactly), OSE-1652."
- The question behind it: after the work on OSE-1656 and OSE-2087, what is still open against "a published count below 5 is withheld"?
- At `subject_sha`, the sentence reads: "Open gaps: OSE-2087 and the list in `docs/brain/CONSTRAINTS.md`." and the list is the line under "They say less than is so" in that file.

Not reviewed: the org's `architectural-invariants.yaml` (not on disk here); a few admin handlers (F7); staging itself. Nothing here was checked on staging, because this PR changes documents only.

What loops 1 to 4 scored was the question "are the gaps closed", not the sentence as committed. Loop 5 is the only loop that read the committed text.

## Loop 1

Team: dr-of-security

Critical layer: what is true today, and what is only assumed. A source sweep of the admin read routes.

Found: the brand audit-log read returns one row per operator action (F1); `events.created_30d` is exact beside a floored figure (F2); the subscribers list returns people as rows (F3); the export's gate did not match the list's gate (F4, since corrected); server logs carry exact small counts (F5); the event-delete answer (F6); handlers not read (F7); the stale CONSTRAINTS line (F8).

Score: 31%

First written as 29%. The deductions add up to 69.

## Loop 2

Team: dr-of-security, role-data-scientist

Conservative layer: assume the worst case for each count a person can read.

Found: list rows were not the counted rows (F10, since corrected); every admin count is exact from 5 up, so two reads show one person's action (F11); an admin can pad a poster-hour with their own scans (F12); the recap's share (F14); the erase receipt (F15); the demo page (F16).

Score: 0%

## Loop 3

Team: dr-of-security

Adversarial layer: attack it. The main session ran four attacks in the workers test pool, in a scratch spec that was deleted afterwards.

Found: padding lifted a withheld poster-hour to 5; the brand audit-log read returned rows; a registrations count moved from 5 to 6 on one sign-up. From source only: the public email sign-up answers `duplicate: true` for an email already on the list (F17, Security Critical, invariant 1, filed as OSE-2136); AGENTS.md invariant 3 says no `CF-IP*` header is read while the rate limiter reads `CF-Connecting-IP` (F18).

Score: 0%

## Loop 4

Team: dr-of-security

Compliance layer: against the written rules and promises.

Found: two recorded decisions disagree on whether a count at 5 or more is exact or rounded (F19); the privacy page says 30 days where the landing sign-up list is kept 90 (F20, Regulatory); an undisclosed `ip_hash` on the landing sign-up (F21); threat-ledger TL-022 is marked tested by a test that only checks the constant (F22); a stale contract line (F23, since corrected); a briefing-page line against ADR-018 (F24); the review was not tied to a commit (F25); ADR-034 drops a row where the rule says "reads in words" (F26). The audit-log rows are against the owner's ruling of 2026-11-16, so my earlier suggestion to except them was wrong.

Score: 0%

## Loop 5

Team: dr-of-security

Recursive layer: audit the review itself and the committed text (commit `7c2afc2`, before the corrections in `subject_sha`).

Found: the CONSTRAINTS line I committed said the public event answer is rounded to a multiple of 5. That is false. The public event carries no count, rounding exists only in the BigQuery export, and the public recap prints the exact number from 5 up (L5-1). The six-word summary said too little (L5-2). "Run" findings cannot be run again (L5-3). Loop 1's sum (L5-4). The scoring method was applied loosely (L5-5). The notes said nothing changed between loops; three PRs did (L5-6). No gate question was answered (L5-7). The commit tie is form only (L5-8). A stale table cell (L5-9). Loop 1's "before shipping" list is not met (L5-10).

Score: 36%

## Findings register

"Read" means I opened the lines. "Sweep" means only the agent did. "Seen once" means it ran in a scratch spec that no longer exists.

| #     | Finding                                                                                              | Evidence        | Severity          | Status    |
| ----- | ---------------------------------------------------------------------------------------------------- | --------------- | ----------------- | --------- |
| F1    | Brand audit-log read returns one row per operator action; against the ruling of 2026-11-16           | read; seen once | Critical          | open      |
| F2    | `events.created_30d` is exact beside the floored `admin_activity_30d.created`                        | read            | Medium            | open      |
| F3    | Subscribers list returns people as rows (platform only)                                              | read            | High              | open      |
| F4    | Export gate differed from the list gate                                                              | test, PR 1373   | High              | closed    |
| F5    | Server logs record exact small counts                                                                | read            | Medium            | open      |
| F6    | Event delete 409 tells 0 registrations from 1 or more                                                | read            | Low               | open      |
| F7    | A few admin handlers not read (`lib/admin-settings.ts`, event-series ids, the batch report endpoint) | not read        | Low               | open      |
| F8    | Stale CONSTRAINTS line                                                                               | this PR         | Low               | fixed     |
| F9    | A loop 1 concern that did not hold                                                                   | read            | Low               | closed    |
| F10   | List rows were not the counted rows                                                                  | test, PR 1402   | High              | closed    |
| F11   | Counts are exact from 5 up (admin reads and the public recap), so two reads show one action          | read; seen once | Medium            | open      |
| F12   | An admin can pad a poster-hour with their own scans and lift a withheld figure to 5                  | read; seen once | High              | open      |
| F13   | Withdrawn in loop 3                                                                                  |                 | Low               | withdrawn |
| F14   | Recap share is a plain ratio (shown only when both numbers clear the floor)                          | read            | Low               | open      |
| F15   | Data-subject erase receipt gives exact row counts for one person                                     | sweep           | Low               | open      |
| F16   | Demo page prints a count under 5                                                                     | read            | Low               | open      |
| F17   | Public email sign-up tells anyone whether a named email signed up (invariant 1, OSE-2136)            | read; not run   | Security Critical | open      |
| F18   | AGENTS.md invariant 3 says no `CF-IP*` header is read; the rate limiter reads one                    | read            | Medium            | open      |
| F19   | Two recorded decisions disagree: exact at or over the floor, or every published count rounded        | read            | High              | open      |
| F20   | Privacy page says 30 days; the landing sign-up list is kept 90                                       | read            | Regulatory        | open      |
| F21   | Undisclosed `ip_hash` on the landing sign-up                                                         | sweep           | Medium            | open      |
| F22   | TL-022 is marked tested by a test that only checks the constant                                      | read            | High              | open      |
| F23   | Stale dashboard contract line                                                                        | PR 1428         | Low               | closed    |
| F24   | Briefing page line against ADR-018                                                                   | sweep           | Low               | open      |
| F25   | Review not tied to a commit                                                                          | this worksheet  | Medium            | fixed     |
| F26   | ADR-034 drops a row where the rule says "reads in words"                                             | sweep           | Low               | open      |
| L5-1  | Committed line falsely said the public event answer is rounded                                       | read            | High              | fixed     |
| L5-2  | The six-word summary understated the list                                                            | read            | High              | fixed     |
| L5-3  | "Run" findings stated as fact with no test kept                                                      | read            | Medium            | fixed     |
| L5-4  | Loop 1 sum was 31%, written as 29%                                                                   | read            | Low               | fixed     |
| L5-5  | Scoring method applied loosely (see Verification)                                                    | read            | Medium            | open      |
| L5-6  | Code and a contract line changed between loops (PRs 1373, 1402, 1428)                                | read            | High              | open      |
| L5-7  | No human gate question was answered; the wording is the agent's                                      | read            | High              | open      |
| L5-8  | The commit tie is form only; `ccr-gate` is in warn mode                                              | read            | Medium            | open      |
| L5-9  | Stale confidence cell in the notes                                                                   | read            | Low               | fixed     |
| L5-10 | Loop 1's "before shipping" list is not met                                                           | read            | Medium            | open      |

## Solutioning

Nothing here lifts the score. It is the order I would take, for the owner to accept or change.

1. **The sentence** (this PR). It only makes the instructions say what is so. It can merge once the owner accepts the wording, whatever is ruled on the rest.
2. **F17 (OSE-2136).** The one Security Critical item. It needs the owner's decision on what the sign-up page says to a repeat sign-up. Until it is closed, any review that includes it reads 0%.
3. **F1.** Either put the brand audit-log read under the floor, or record a new ruling that excepts it. Today it stands against the ruling of 2026-11-16.
4. **F19, then F11 and F12.** One ruling: does "every published count is rounded" reach admin reads and the public recap? Padding (F12) is only answered by rounding or by not counting an operator's own scans.
5. **F20.** A privacy page wording change, or a shorter retention window. Regulatory, so it caps any score at 60% while open.
6. **F22.** Replace the constant check with a test that can fail, or mark TL-022 untested.
7. **Tests for the two "seen once" findings**, so the next reader can run them.
8. The rest (F2, F3, F5, F6, F7, F14 to F16, F18, F21, F24, F26) as tickets under OSE-2087 or their own, at the owner's priority.

## What must be true before shipping

- The owner has accepted or replaced the wording (L5-7).
- The owner has seen the list in `docs/brain/CONSTRAINTS.md` and has not found it wrong.
- `tests/integration/agent-instructions-budget.test.js` and the close-guard pass on the PR.
- `AGENTS.md` at the PR head is the same as at `subject_sha`.

## Verification

- `AGENTS.md` is 12,271 bytes (limit 12,288). The budget test passed locally, 16 of 16.
- `node scripts/ci/ccr-worksheet-check.mjs` passed locally on this file.
- Opened by me at `subject_sha`: `lib/public-event-projection.ts:123` (no public count field), `lib/shared-report-export.ts:557-559` (the only live rounding), `lib/recap-stat-lines.ts:34-37` (exact from 5), `handlers/demo.ts:579-584`, `threat-ledger.yaml` TL-022 and its test.
- Not verified: anything on staging. The two "seen once" results. F15, F21, F24 and F26 beyond the sweep's reading.
- Method, stated plainly (L5-5): loop 4 used a × 1.5 weight the protocol does not define past loop 3; the non-correction penalty and the governance modifier were not applied; F1 and F2 were scored as linked, which is arguable. I have not recounted. Each of those would lower a score, not raise one, and the result is 0% either way.
- Process, stated plainly (L5-6, L5-7): the rule is five lenses on an unchanged subject with a human gate after each. Three PRs merged between loops (two closed defects the review found, one corrected a contract line), and no gate question was answered. A stricter reading would call this run void and run it again on a frozen commit.

## Risks accepted

None by the owner. Nothing in the register has been accepted. If this PR merged as it stands, the instructions would be true about the gaps, and every gap would still be open.

## Human gate

The gate is stop. These are the owner's to answer; none has been answered.

1. Is the wording right: "Open gaps: OSE-2087 and the list in `docs/brain/CONSTRAINTS.md`."?
2. Does the brand audit log go under the floor, or do you make a new ruling that excepts it (F1)?
3. Does the decision of 2026-10-01 ("every published count is rounded") reach admin reads and the public recap, or do exact counts from 5 up stand (F19, F11, F12)?
4. What should the public sign-up page say to an email that is already on the list (F17, OSE-2136)?
5. Privacy page: change "30 days" to match the 90-day list, or shorten the list (F20)?
6. Are the subscribers list (F3), the server logs (F5) and the erase receipt (F15) exceptions you want written down, or gaps to close?
7. Given L5-6 and L5-7, do you accept this run, or should it be run again on a frozen commit with your answer at each gate?
