# Loop 1 (Critical), Scrum Master lens, v4 frozen subject

## 1. Five most dangerous assumptions

1. **"A staging step cannot be born red against a branch" (C.0): FALSE in part.** `ci.yml:1180-1190` (job `deploy-staging`) runs T1-T4 on a PR whose head is `full-pipeline/*`. The subject never mentions it. Only the migrating slices (S3, S7) have the remote-D1 objection. Six new staging steps (S2, S3, S4, S6, S7, S15) therefore ship "red on main" by argument, not by watching. That breaks AGENTS "Born red" ("a gate that cannot fail counts as absent").
2. **Wave 0 item 1, "re-raise the clock gate; OSE-1778 Backlog": FALSE (stale).** PR #1069 is open (draft, "Part of OSE-1778"). The spec is `tests/e2e/0-architecture/timestamp-precision.invariant.spec.ts`, listed at `ci.yml:885`. The subject's cites hold: `shortlinks.last_clicked_at` at `:134` has kinds `['sql-write']`, and `PENDING_D4` is at `:74`. S3 and S7 gate on an unmerged draft that still lacks CCR, a CI/CD ticket and D4. `origin/main` is already `206c91ed` (docs-only #1068).
3. **"S4 blocked by OSE-1784": self-contradicted, and ASSUMED schedule.** B.1, E.3 and F-16 say blocked. C.10 says that if OSE-1784 has not merged, S4 "bounds only the readers listed and says so". So the block is a rebase collision, not a dependency. If applied in Linear as a hard block, the epic's Done (E: every slice Done) waits on OSE-1784, which waits on OSE-1782 and OSE-1751. I could not read their state. If S4 ships first, the report's who-side figures still include the open hour.
4. **"The staging layer is a bash step per slice" meets the Done pyramid: FALSE as a fit.** AGENTS names Bruno and Playwright; STORY-FORMAT says "ALL 7 levels, no partial pyramids". S5 has no CI job at all. AGENTS requires, at Merged, "a named CI job goes red if it regresses". S16, S5 and part of S3 (logs) have no staging layer. These are stated as gaps, but they are not resolved against the rule.
5. **Prerequisites are ASSUMED.**
   - Staging has `ANON_ID_HASH_PEPPER`. `ci.yml:1267` only warns today, so it may be unset.
   - `CLOUDFLARE_API_TOKEN_OSE` can run `wrangler kv key list` (S2). Today the token is used only for D1 (`:2039`).
   - Once S2's AC5 lands, T1 refuses every staging deploy until the owner sets the pepper. A red T1 or T4 blocks Done for S3, S4 and S7 too (acknowledged in C.0).

## 2. Findings

| id       | Sev     | Slice         | Claim                            | Evidence                                                                                                                                          | Basis       | Root cause                         | Out of scope |
| -------- | ------- | ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------- | ------------ |
| L1-SM-1  | High 10 | S2,3,4,6,7,15 | Staging steps cannot be born red | `ci.yml:1180-1190` full-pipeline route omitted                                                                                                    | source-read | Born-red route overlooked          | -            |
| L1-SM-2  | High 10 | S3,S7         | Clock gate unbuilt, Backlog      | PR #1069 open draft; `gh pr view 1069`                                                                                                            | proven      | Wave 0 stale vs #1069              | -            |
| L1-SM-3  | High 10 | S4            | Blocked by external OSE-1784     | C.10 vs E.3; no date                                                                                                                              | source-read | Block is collision, not dependency | OSE-1784     |
| L1-SM-4  | High 10 | S5,S16,S2-7   | Bash steps meet two-stage Done   | AGENTS DoD; STORY-FORMAT:60; C.5 "None in CI"                                                                                                     | source-read | Pyramid rule vs bash substitute    | -            |
| L1-SM-5  | Med 5   | S2            | Token scope, pepper present      | `ci.yml:1267,2039`; F-10                                                                                                                          | inferred    | Owner prerequisites unverified     | -            |
| L1-SM-6  | Med 5   | All           | "Resolvable test_ref" in DoD     | `born-red-harness.spec.ts:79-90` presence only; header `:13` claims more; E4 defers to a story whose AC8 premise B.2 calls false                  | proven      | No test_ref resolution gate        | -            |
| L1-SM-7  | Med 5   | S3,S4,S2      | Sizes S/M, one PR                | S3: migration + guard + plan + pin + allowlist + logs + step. S4: 7 ACs, 8+ read sites, ADR-026, two UI copies, T0 spec                           | source-read | Under-sized multi-surface slices   | -            |
| L1-SM-8  | Low 2   | All           | Close-guard covered              | C.0 omits "no ids in branch or title" and the commit-wording rule (`check-pr-linear-close.mjs:28-34`)                                             | source-read | Partial restatement of rule        | -            |
| L1-SM-9  | Low 2   | S2-7          | TL-084..089 reserved             | TL-083 is highest (`threat-ledger.ts:1770`); duplicates test `born-red-harness.spec.ts:60-69` fails the second merge; TL-084 for OSE-1784 ASSUMED | source-read | Pre-assigned ids race              | OSE-1784     |
| L1-SM-10 | Low 2   | B.4           | Linear map safe                  | OSE-1778 row stale; OSE-1767 cancel orphans S3's "v1 slice 1 (part)" lineage; "10 slices, ~17 issues" (D L3-40) vs 9 and ~15 (B.1, B.4)           | source-read | Counts and lineage inconsistent    | -            |
| L1-SM-11 | Low 2   | S5,S14,S16    | Opus high/medium                 | CLAUDE.md models table routes searching to Haiku; ROLE-STATE listed in G only for S2,3,4,7, not S5,6,14,15,16 (CLAUDE.md step 6)                  | source-read | Per-slice session plan absent      | -            |
| L1-SM-12 | Low 2   | S5,S16        | Done via own SHA                 | Push paths (`ci.yml:107-125`) exclude `docs/` and `.claude/`: no chain on their SHA; Done waits for an unrelated later code merge                 | source-read | Docs-only Done timing unstated     | -            |

TRUE (checked): migrations top at 0104 and forms 0018; `REQUIRED_*` 104 and 18 (`schema-guard.ts:27,31`); no 0105 or 0019 on any ref (`git log --all`); plan test pins 27 and 4 (`production-migration-plan.test.js:57-63`); `infra-consistency.test.js:270` and the ANON pin; the pepper `grep -q` and warning (`ci.yml:1267`); production refuses (`:2664`); conformance triggers (`conformance-report.yml`); trace fixture ids exist.

## 3. Per-slice verdict

- S0: external; the plan is consistent. Block meaning is owner-pending (F-18).
- S14: right size; the helpers do not exist yet (verified).
- S16: right size; docs-only, no staging layer; Done waits on a later SHA.
- S15: right size; the golden claim "3 hits" is really 2 lines in each of 8 files (immaterial).
- S5: a spike with no CI job; fails the Merged rule as written.
- S6: right size; the staging read cannot be born red.
- S2: M is plausible; hard-gated on an owner secret and an unverified KV token scope; red T1 blocks everything behind it.
- S3: sized S, behaves M; depends on the unmerged #1069.
- S4: sized M, behaves L; the block on OSE-1784 is ambiguous.
- S7: M; waits on #1069, S3 and D4 plus the legal check.

## 4. Not checked

Linear (no access): OSE-1766 to 1784 states, blockers, OSE-1782/1751 status. Whether staging holds the pepper. KV token scope. Whether `mint-t4-report-tokens.mjs` accepts a new event. Workers Logs retention. `full-pipeline/*` reviewer gating in repo settings. I ran no tests and no CI. I did not read the ourSharedEvents `workers/` source.

## 5. Commands

Read: scrum-master.knowledge.md, subject in 4 parts. Bash (read-only, in the `ose-clock-gate` worktree unless noted): git log/status/show --stat; grep and sed on `threat-ledger.ts`, `schema-guard.ts`, `ci.yml`, `infra-consistency.test.js`, `born-red-harness.spec.ts`, `check-pr-linear-close.mjs`, the migration plan and test, the `timestamp-precision` spec, `qr-scan.ts`, `shortlinks.ts`, `forms.ts`, `scan-cells.ts`, `never-who.ts`, goldens; `ls` of migrations, scripts/ci, docs; `git log --all --diff-filter=A` on migrations 0105/0019; `git branch -r`; `gh pr list --state open`; `gh pr view 1069 --json ...`; sed on `STORY-FORMAT.md` and `ROLE-STATE.md` grep (ourSharedEvents). One mkdir -p plus this heredoc write. None refused.
