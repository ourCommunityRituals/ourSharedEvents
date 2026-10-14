# CI Cost Collector (COST-302 / OSE-781)

Surfaces **CI wall-clock per job over time** — the dev-time cost line that
complements the served-user runtime metric (`OPERATION_COST`, COST-301). Rising
CI minutes are a real, if secondary, cost surface; this makes them visible as a
JSONL time-series (a daily workflow artifact) a future dashboard can read.

## How it works

- **Collector:** [`scripts/ci-cost-collector.mjs`](../../scripts/ci-cost-collector.mjs)
  queries recent **completed** `oursharedevents-ci` runs via the `gh` CLI
  (`gh run list` + `gh run view --json jobs`), computes each job's wall-clock
  duration, and merges new records into the history file.
- **Schedule:** [`.github/workflows/ci-cost-collector.yml`](../../.github/workflows/ci-cost-collector.yml)
  runs daily (05:17 UTC) on GitHub-hosted ubuntu (read-only Actions-API work,
  not a build) with a read-only token, then uploads the history as the
  `ci-cost-history-<run id>` artifact (90 days) and prints the collector's
  summary line in the run summary. It can also be run on demand via
  **workflow_dispatch** (optional `limit`).
- **Not committed.** The job does not push to `main`: `main` is protected, so
  the push was rejected daily (GH006, 2026-10-14) and the job ran red. Each
  artifact is a snapshot of the last `limit` completed runs; records are keyed
  by `runId:jobId`, so a consumer can union artifacts without duplicates. To
  commit a series again, deliver it through a PR like `conformance-report.yml`
  with the write token from the `main-automation` environment (OSE-1693 /
  OSE-1695).
- **History:** [`ci-cost-history.jsonl`](./ci-cost-history.jsonl) — one JSON
  record per line. The file in the repo is the empty seed the collector merges
  into; the data is in the run's artifact. Machine-written; do not hand-edit.

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
