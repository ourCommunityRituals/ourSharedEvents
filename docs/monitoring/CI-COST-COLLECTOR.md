# CI Cost Collector (COST-302 / OSE-781)

Surfaces **CI wall-clock per job over time** — the dev-time cost line that
complements the served-user runtime metric (`OPERATION_COST`, COST-301). Rising
CI minutes are a real, if secondary, cost surface; this makes them visible as a
committed time-series a future dashboard can read.

## How it works

- **Collector:** [`scripts/ci-cost-collector.mjs`](../../scripts/ci-cost-collector.mjs)
  queries recent **completed** `oursharedevents-ci` runs via the `gh` CLI
  (`gh run list` + `gh run view --json jobs`), computes each job's wall-clock
  duration, and appends new records to the history file.
- **Schedule:** [`.github/workflows/ci-cost-collector.yml`](../../.github/workflows/ci-cost-collector.yml)
  runs daily on GitHub-hosted ubuntu (read-only Actions-API work, not a build),
  then commits the updated history back to `main` with `[skip ci]`.
- **History:** [`ci-cost-history.jsonl`](./ci-cost-history.jsonl) — one JSON
  record per line, appended over time. Machine-written; do not hand-edit.

## Record schema (`ci-cost/v1`)

```json
{
  "schema": "ci-cost/v1",
  "runId": 31957882699,
  "runNumber": 412,
  "workflow": "oursharedevents-ci",
  "event": "pull_request",
  "headBranch": "some-branch",
  "headSha": "0d448c3abcde",
  "jobId": 95188524815,
  "jobName": "T0 Gate (tests)",
  "conclusion": "success",
  "startedAt": "2026-08-16T16:02:30Z",
  "durationSec": 61
}
```

## Guarantees

- **Idempotent.** Records are keyed by `runId:jobId`; re-running never
  duplicates a line. Only completed runs are collected (durations are final).
- **Never-who — dev identities too.** Records carry run/job timing, the branch,
  and the (truncated) commit SHA — but **no actor / committer login, email, or
  person identity**. CI cost is a property of a job, not of a person. The L6
  test asserts no identity field can appear.
- **Failing jobs are recorded.** Cost is incurred regardless of outcome, so a
  `failure` job still contributes its duration.

## Tests

- L6 integration: [`tests/integration/ci-cost-collector.test.js`](../../tests/integration/ci-cost-collector.test.js)
  — parse/aggregate/merge against a `gh run view --json jobs` fixture, plus the
  never-who assertion. Runs in the T0 gate (root vitest).

## Related

- Runtime cost metric: [`COST-METRIC-CONTRACT.md`](./COST-METRIC-CONTRACT.md) (COST-301/303)
- Backlog: Cost Sustainability & Free-Forever Guardrails (OSE), M3 Observability
