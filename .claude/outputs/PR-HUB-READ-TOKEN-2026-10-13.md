# PR draft: hub read token split (prepared 2026-10-13, nothing pushed)

Worktree: `C:\Users\mzdan\dev\ourCommunityRituals\_hubread-wt`, branch `ci/split-hub-read-and-write-tokens`, fast-forwarded to `origin/main` 10206fea. All changes uncommitted.

## Do not push or merge until

1. `OCR_HUB_READ` exists as an org secret visible to this repo (hub and OCR-docs, Contents read, Metadata read, 90-day expiry). Merging earlier breaks every staging and brain-checkout job, T1 included.
2. Decision D5 is made (also create it as a Dependabot secret, or leave Dependabot as it is).
3. The agent token has no Workflows scope (HARD-1), so the owner pushes this branch from their own terminal.

## Owner terminal (after 1 and 2)

```bash
cd /c/Users/mzdan/dev/ourCommunityRituals/_hubread-wt
git add .ci-integrity-baseline.json .github/workflows docs/adr/ADR-020-copilot-ci-human-approval-gate.md docs/brain/CONSTRAINTS.md scripts/check-pr-secret-exposure.allowlist.json scripts/ci-stage-ocr-workspace.sh scripts/ci/ci-integrity-ratchets.mjs scripts/ci/hub-token-wiring.mjs tests/integration/adr008-wiring.test.js tests/integration/ci-integrity-ratchets.test.js tests/integration/hub-pin-ancestry.test.js workers/oursharedevents/docs/ops/copilot-pr-ci-approval-runbook.md
git diff --cached --stat   # expect 24 modified + 1 new, nothing under workers/oursharedevents/src
git commit   # paste the commit message below, then add the Co-Authored-By line if you want it
git push -u origin ci/split-hub-read-and-write-tokens
```

## Commit message

```
ci: hub and OCR-docs reads use a read-only token; ratchet the wiring

The org PAT OCR_PROPAGATE_TOKEN carried write scope into every PR job
that only needed to read the hub or OCR-docs. Those read uses now take
OCR_HUB_READ (read-only, hub and OCR-docs). The old name stays at
exactly two write steps until they move to their own tokens.

- 22 hub-staging steps and 6 OCR-docs checkouts pass OCR_HUB_READ; the
  staging script has no fallback to the old name, so a log shows which
  token ran
- one enumerator (scripts/ci/hub-token-wiring.mjs) feeds both the
  adr008-wiring property spec and the CI integrity ratchet
- ratchet: wired steps and checkouts may only rise (retired list for a
  deliberate removal); unwired steps and old-token references may only
  fall
- allowlist, ADR-020 and the runbook name the new secret

Part of OSE-1695
```

## PR body

### What and why

Splits the read half off `OCR_PROPAGATE_TOKEN`. A write-capable org token was reachable from 12 PR jobs that only clone the hub or check out OCR-docs. They now use `OCR_HUB_READ`. The two write steps (`conformance-report.yml` PR opening, `notify-osm-flag-change.yml`) keep the old name for now and move in a follow-up that needs the environments from OSE-1693.

Part of OSE-1695. Related: OSE-1467, OSE-1693, OSE-1701.

### Order matters

`OCR_HUB_READ` must exist (org secret, this repo selected) before this merges. Not merging first is the only thing keeping staging and brain-checkout jobs green.

### Executions covered

|                                                                                                                                    | Before                | After                     |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------- |
| Steps that stage the hub (22, across 11 workflows incl. deploy-production and smoke-production)                                    | `OCR_PROPAGATE_TOKEN` | `OCR_HUB_READ`            |
| OCR-docs checkouts (6)                                                                                                             | `OCR_PROPAGATE_TOKEN` | `OCR_HUB_READ`            |
| `secrets.OCR_PROPAGATE_TOKEN` references in workflows (30 = 22 staging + 6 checkouts + 2 write; counted on `origin/main` 10206fea) | 30                    | 2, both named write steps |

### Ratchet (improve, never regress)

| Measurement               | Direction | Baseline |
| ------------------------- | --------- | -------- |
| Hub-staging steps wired   | up only   | 22       |
| OCR-docs checkouts wired  | up only   | 6        |
| Hub-staging steps unwired | down only | 0        |
| Old-token references      | down only | 2        |

A lost wired execution, an unregistered new one, or a third old-token use turns the lint shard red. Each message names the step and the edit that fixes it.

### Test layers

| Layer            | What                                                         | Result                                                                               |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Lint shard       | `ci-integrity-ratchets.mjs --root . --base-config`           | green locally; base-branch rules bite from the next PR (this PR introduces the keys) |
| Root integration | `adr008-wiring`, `ci-integrity-ratchets`, `hub-pin-ancestry` | 61 pass                                                                              |
| Architecture     | `npm run test:arch`                                          | agent reports 283 pass, 10 runtime skips                                             |
| Staging          | T1 to T4 on the merge SHA                                    | pending: needs `OCR_HUB_READ`                                                        |

Born red: every fault was watched failing at its named assertion and restored byte-identical (old env name on a staging step, no env, wrong job-level value, new workflow with an odd invocation, composite action, third old-token use, OCR-docs checkout on the old token, anchor/alias and folded-scalar forms, a new wired step without a baseline raise, a deleted step, a lowered floor with and without a retired entry).

### Privacy and invariants

No file under `workers/oursharedevents/src`, `migrations*`, templates, or `lib/pii.ts`, `forms-db.ts`, `count-floor.ts`, `sponsor-card.ts` changed. Failure messages print secret names, step names and counts only; a test proves a literal value never appears.

### Known gaps, not changed here

- Dependabot PRs get no Actions secrets, so the hub staging step and the two checks that need it fail there today (`T0 Gate (tests)`, `Validate against OCR-docs brain`). A Dependabot secret named `OCR_HUB_READ` is the owner's call.
- Local `npm run lint:ci` fails on files this change does not touch; CI's lint command is the check.
- A lowered floor on a PR is caught by the lint shard only, since the root-vitest checkout is shallow.
- The 2 remaining old-token references leave when the write sites get their own tokens.

---

Generated with Claude Code
