# CLAUDE.md: ourSharedEvents

@AGENTS.md

The contract every agent follows is `AGENTS.md`, imported above. This file adds only what is specific to Claude Code. Keep it under 6 KB (`tests/integration/agent-instructions-budget.test.js`).

## Session protocol

1. **One story or one review per session.** Use `/clear` between unrelated tasks, and start a fresh session rather than letting one run long. Every turn re-reads the whole conversation.
2. **Pick work from Linear** (team OSE), not STORIES.md, respecting prerequisites. Check `.claude/inputs/` for new intake items.
3. **Confirm direct source + test evidence** before treating any ticket, doc or role-state line as true.
4. Implement the complete story: route code, tests at both layers, migrations if needed, and every role view (`docs/brain/ROLE-STATE.md` lists the roles).
5. Open the PR (`Part of OSE-###`), then follow the two stages in AGENTS.md: Merged, then Done.
6. **After a merged PR**, set the story to In Progress with an evidence comment, then **update `docs/brain/ROLE-STATE.md`**, not this file. Record what changed for each affected role, with dates and evidence. This file and AGENTS.md change only when a rule changes.

## Models and effort

| Work                                                                                    | Model                          | Effort                        |
| --------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------- |
| CCR synthesis, architecture, security, cross-tenant or PII work, hard debugging         | Opus                           | high (xhigh when high stalls) |
| A story with clear acceptance criteria and born-red tests                               | Sonnet, or Opus at medium      | medium                        |
| Searching the codebase, ranking files, first-pass reading, CI log triage, Linear sweeps | Haiku (the `repo-scout` agent) | low                           |
| Stuck after xhigh                                                                       | Fable                          | high                          |

Set effort at the start of a session; changing it mid-session clears the cache. Never route security, auth, PII or count-floor work below Opus.

## Agents and skills

- **CCR:** the `ccr` skill (`.claude/skills/ccr/SKILL.md`). Loops run in order. Within one loop the role agents may run in parallel, then one synthesis.
- **Extended scrum team** as subagents in `.claude/agents/`: `dr-of-security` (Opus, always in an extended-team review), `role-backend-architect`, `role-frontend-integration`, `role-design-fe`, `role-qa-automation`, `role-sdet-sre`, `role-devops`, `role-data-scientist`, `role-product-owner`, `role-scrum-master`. Each reads its `.claude/skills/*.knowledge.md` where one exists.
- **`repo-scout`** (Haiku): give it a question and get back the few files that matter, so the main session reads those instead of whole folders.
- Other skills: `daily-scrum`, `story-intake`, `sync-status`.

Subagents are told in their prompts to stay read-only, but their `tools:` lists are **not** enforced at call time (spine `.claude/README.md`, verified 2026-09-01). When read-only matters, dispatch on a harness read-only agent type and ask each worker to list the commands it ran.

## Guardrails on this machine

- `.claude/hooks/policy-gate.mjs` blocks deploys, production changes, secret writes, force pushes, admin merges and credential reads. The owner installs it (`.claude/hooks/README.md`). Agents cannot change their own settings; auto mode refuses it.
- Never print a credential or config file to inventory it. Use names, sizes and key names only.

## Environment: staging, not the owner's computer

A standing order from the owner (2026-11-14) for every session.

- **Staging is the environment of record.** Work is run and checked against staging (`stg.oursharedevents.com`, `stg.ourwkrp.com`). A result counts when it is seen on staging, or in the CI that deploys to it.
- **Never the owner's own computer.** Do not ask the owner to run, build, seed or check anything on their machine, and do not plan work that depends on it. A throwaway worker inside a CI job or a session's own container is a test rig: it can support a result, and it does not stand in for staging.
- **One exception: a private showcase instance.** Its data file and built pages stay private. They are never committed, loaded into staging or published until the owner says the people named in them have agreed.
- **This grants nothing else.** Staging changes only through CI after a merge to `main`. Who merges, who deploys and who holds credentials are unchanged, and production is not staging.

## Compact instructions

When compacting, keep: the story or review id and its acceptance criteria; decisions and who made them; failing test names and exact error lines; files changed; open questions for the owner. Drop: tool output already acted on, file dumps, superseded plans.
