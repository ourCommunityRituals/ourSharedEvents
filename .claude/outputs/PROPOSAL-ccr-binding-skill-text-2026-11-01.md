# Proposal (not applied): make CCR binding, and write down how a run goes

Status: DRAFT for the owner. Nothing in this file is applied. It reflects the owner's ruling of 2026-11-02 on how a run goes, which differs from `ccr/SKILL.md` and `ccr-protocol.md` as they stand.

## The owner's ruling (2026-11-02)

- Each loop is one lens on the same subject: loop 1 the Critical run, loop 2 the Conservative run, loop 3 the Recursive run.
- All the specified loops run. Nothing is changed between them.
- The results are taken together as one cumulative score.
- Under 95%, the scrum team works out the solutions to reach 95%. The loops are not a place to stop and act.
- The point: whatever is assessed stays honest from each point of view, critically, conservatively, then recursively.

## Why the text must change

`scripts/ci/ccr-worksheet-check.mjs` (new; runs in `npm test` through `tests/integration/ccr-worksheet-check.test.js`, so inside the required `T0 Gate (tests)`) fails the build on a CCR worksheet in the tree that breaks the contract. It already follows the ruling. `SKILL.md`, `ccr-template.md` and the protocol do not, so an agent following them writes a worksheet the checker rejects. The texts and the checker have to land together.

## Proposed changes to `.claude/skills/ccr/SKILL.md`

Replace section 2 with:

> ## 2. A run
>
> Each loop is one lens on the same subject, and nothing is changed between loops:
>
> 1. **Loop 1, the Critical run:** what is the most dangerous assumption? What is true versus assumed?
> 2. **Loop 2, the Conservative run:** assume the worst case. Does the floor still hold?
> 3. **Loop 3, the Recursive run:** was the assessment itself honest? What did the first two runs rationalise, miss or over-state?
>
> Loops past 3 repeat that order. Run every specified loop, then take the results together as one cumulative score. Loops never run in parallel; each reads the earlier loops' results. Inside one loop, role lenses may fan out to subagents and be merged once.

Replace section 4 with:

> ## 4. Under 95%
>
> Under 95%, the scrum team works out the solutions that reach 95%, and the worksheet says what closes each finding and who does it. A stop is only for what the team cannot close itself: write the exact question, the information that would close it, and who holds it. A CCR score is a signal, never permission. Merging and deploying still need required checks and the PO.

In section 1, the "human gate every loop" wording for governance and compliance becomes "the owner ratifies the result".

Add to section 6:

> Begin the worksheet with this frontmatter, on line 1. CI (`scripts/ci/ccr-worksheet-check.mjs`; run it before you commit) fails a worksheet that breaks it. The values are an example; replace all of them.
>
> ```yaml
> ---
> ccr: 1
> class: bug-fix # lite | bug-fix | security-fix | upgrade | architecture | governance | compliance
> requested_loops: 3 # what the owner asked for; if they named no number, the class minimum
> loops_run: 3
> team: extended # extended | base
> gate: stop # stop | pass
> cumulative_score: 40 # all the loops' results together, before solutioning
> system_score: 40 # after solutioning; the 95% gate reads this
> unresolved: { regulatory: 0, security_critical: 1, critical: 0, high: 2, medium: 0, low: 0 }
> ---
> ```
>
> Governance and compliance also need `owner_ratified: YYYY-MM-DD` before `gate: pass`.
>
> Keep the run in one worksheet, as `## Loop N` sections in order. Each holds these lines, outside code fences:
>
> - `Team:` one line of agent ids only, from `.claude/agents/`. For `extended`: `dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner`. List only the lenses that ran.
> - The layer for that loop, with text: `Critical layer:` on loop 1, `Conservative layer:` on loop 2, `Recursive layer:` on loop 3. CCR Lite is one loop with all three.
> - Exactly one `Score: NN%`, that loop's own result.
>
> The worksheet has `##` sections for: verdict, what was reviewed, findings register, what must be true before shipping, verification, risks accepted, human gate, and `Solutioning` when a score is under 95%. A `gate: stop` worksheet puts at least one question to the owner, on a line ending in `?`.

## Open point for the owner

`SKILL.md`, AGENTS.md and the checker say governance and compliance need 5 loops or more. The ruling names three loops. The checker still requires 5 for those classes until the owner says otherwise.

## Also needed to land with it

- `ccr-template.md` and protocol sections 2, 3 (reactive correction between loops) and 6.2: the same run model and worksheet shape.
- `CLAUDE.md`, one line in Agents and skills, pointing at the checker. AGENTS.md has 8 bytes of headroom, and its "human gate after every loop" sentence needs the owner.
- A Linear story and its CI/CD testing ticket; the PR says `Part of OSE-###`.

## Proposed: how the owner asks for a CCR (new SKILL.md section 0, owner request 2026-11-02)

The owner states a run as one sentence, like a command with parameters:

> **run ccr** [_N_ **loop**[**s**]] [**with** _team_ **team**] **for** _subject_

| Part      | Meaning                                                                                                                                                                                                           | If left out                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| _N_ loops | How many loops. The class minimum still applies: the owner may ask for more, never fewer.                                                                                                                         | The class minimum for the subject (governance and compliance: 5). |
| _team_    | `extended` (the nine roles, Dr of Security always) or `base`.                                                                                                                                                     | Not yet ruled by the owner; proposed default `extended`.          |
| _subject_ | What is assessed: quoted text (`"definition of task"`), `release` (the release candidate: the diff since the last tag), `pr 123`, `story OSE-123`, `branch`, `last commit`, a file path, or a class word (below). | Required. The agent asks.                                         |

A class word as the subject sets the class, and with it the default loop count (owner, 2026-11-02: "run ccr loop for compliance ... would come with the 5 loop run be default"):

| Class word                | Loops when no number is given | Loop order                                                                 |
| ------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| `compliance`              | 5                             | Critical, Conservative, Adversarial, Compliance, Recursive                 |
| `governance`              | 5                             | the same                                                                   |
| `architecture`            | 5                             | the same                                                                   |
| `security` (security fix) | 3                             | Critical, Conservative, Recursive                                          |
| `bug fix`                 | 3                             | the same                                                                   |
| `rollback`                | 3                             | the same (owner, 2026-11-02: "rollback should also be added for a 3 loop") |
| `upgrade`                 | 4                             | not yet ruled for 4 loops                                                  |
| `lite`                    | 1                             | all three layers in one loop                                               |

The class minimums are today's (`SKILL.md` section 1). `compliance` at 5 is the owner's own example; the owner agreed the whole table on 2026-11-02 ("agreed"). A 4-loop order is still not ruled. When the subject is not a class word, the agent states the class it inferred in the echo, so the owner can correct it before loop 1.

Examples:

- `run ccr loop for compliance`: no number, class compliance, so 5 loops: Critical, Conservative, Adversarial, Compliance, Recursive.
- `run ccr 3 loop for "definition of task"`: 3 loops (Critical, Conservative, Recursive) on that text. If the text is governance-class, the agent says the minimum is 5 and runs 5.
- `run ccr loop for release`: no number, so the class minimum for the release's class, which the agent states in the echo; subject is the release candidate.
- `run ccr 5 loops with extended team for pr 1064`.

Loop order by count, as the owner ruled: 3 loops are Critical, Conservative, Recursive; 5 loops are Critical, Conservative, Adversarial, Compliance, Recursive. Other counts are not ruled.

Before loop 1 the agent echoes the parsed request in one line and freezes the subject, for example: `CCR: 5 loops (Critical, Conservative, Adversarial, Compliance, Recursive), extended team, subject: release (v1.3..HEAD, frozen at <sha>).` The worksheet records the owner's sentence verbatim (`invocation:` in the frontmatter) beside the parsed values, and the checker fails a worksheet whose `requested_loops` does not match its invocation.

What this does and does not fix: it records the owner's ask in the owner's words, so a reviewer can compare the worksheet with the chat (finding C2, "the owner's request is recorded nowhere"). The agent still writes the worksheet, so the record can still be forged; only the owner's own check or an identity the agent cannot use closes that.
