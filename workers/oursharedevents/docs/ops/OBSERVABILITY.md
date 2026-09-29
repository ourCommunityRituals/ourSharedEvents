# Observability runbook (L7 — OSE-1380)

The OSE Worker was flying blind: zero dashboards, zero alerting, no baselines. This is
the tier-appropriate observability stack (**not** Logpush — that's largely Enterprise).
Split into what's **code** (in this repo) and what's **dashboard/API** (separate terminal).

## What's in code

### GraphQL Analytics baseline — `scripts/observability/cf-analytics-baseline.mjs`

Pulls request / error / latency baselines for a Worker script from the Cloudflare
**GraphQL Analytics API** (`workersInvocationsAdaptive`) and prints a **never-who**
summary: aggregate counts, error rate, HTTP-status distribution, CPU-time percentiles —
no user / IP / id / token identity (enforced by `assertNeverWho`, which refuses to print
a leaky summary). Unit-tested in `tests/observability-cf-analytics.spec.ts` (node pool).

Run it in **your own shell** (the agent never handles the token):

```sh
CF_API_TOKEN="$(...)" \            # required — Account Analytics:Read, scoped to the OSE account
CF_WORKER_SCRIPT=oursharedevents-stg \   # or oursharedevents-prod
WINDOW_HOURS=24 \
node scripts/observability/cf-analytics-baseline.mjs
```

Token: dash → My Profile → API Tokens → `Account.Account Analytics:Read`. Never paste it in chat.
Use it to set the first **performance baselines** (p50/p99 CPU time, error rate) before/after a deploy.

### Structured logs already emitted (consume these)

The Worker already logs structured single-line JSON to stdout — each line carries a
`type` tag. Parse them in a Tail Worker or Instant Logs. The operationally useful tags
today, by purpose (request-path is never-who; the error/alert tags feed the Notifications
below):

<!-- STRUCTURED_LOG_TAGS:start — every tag below is asserted to exist as `type: '…'` in src/ by tests/observability-runbook-tags.spec.ts; edit the two in lockstep -->

- **request-path:** `FORM_EVENT`, `FLAG_EVENT`, `TURNSTILE_EVENT`, `OPERATION_COST` (never-who, gated)
- **scheduled-job completion:** `LIFECYCLE_COMPLETE`, `SECURITY_CRON_COMPLETE`
- **error / alert (watch these):** `LIFECYCLE_PHASE_ERROR`, `UNHANDLED_ERROR`, `DB_ERROR`, `SCHEMA_DRIFT`, `SECURITY_ALERT_RAISED`

<!-- STRUCTURED_LOG_TAGS:end -->

There is no bare `LIFECYCLE` line — the scheduled phase job emits `LIFECYCLE_COMPLETE`
(and `LIFECYCLE_PHASE_ERROR` on failure). More `*_COMPLETE` / `*_ERROR` / `*_NOOP` tags
exist per scheduled subsystem (draft-expiry, subscribers/scan-returns retention,
shared-report materialize/export, bigquery-backup, security-cron); `grep "type: '" src/`
for the full set.

## What's dashboard / API (separate terminal — not code)

### Workers Logs (already enabled)

`[observability] enabled = true` in `wrangler.toml` → Workers Logs are on. Confirm retention +
build a saved view in dash → Workers → oursharedevents-{stg,prod} → Logs. Instant Logs (live tail)
is available there too.

### Cloudflare Notifications (set up in dash → Notifications)

Create these (email/webhook), scoped to the OSE zone/worker:

- **HTTP 5xx spike** (zone) — origin/worker error surge; corroborate in Logs with the
  `UNHANDLED_ERROR` / `DB_ERROR` lines above.
- **Health Check failure** — if a CF Health Check is configured on `/health`.
- **Security Events spike** — WAF/bot activity surge (ties into the OSE-1377 edge work);
  the Worker's own `SECURITY_ALERT_RAISED` line is the in-app counterpart.
- **Worker errors / CPU-limit** — via Workers alerting where available on the plan.
- **Schema drift** — the `SCHEMA_DRIFT` line fires when the live D1 shape diverges from
  the canonical set; a saved Logs view on it is the cheapest guard until a Tail Worker lands.

## Next slice (post-launch) — Tail Worker (`tail_consumers`)

A dedicated **Tail Worker** is the on-brand log-aggregation primitive: it consumes the
main Worker's tail events (the structured lines above), aggregates them into never-who
counters, and is the natural **egress guard** — the one place to assert no identifying
field leaves the box. Deferred because it needs a new Worker deploy **and** a
`tail_consumers` binding on the main worker (a launch-week deploy risk). Tracked on OSE-1380.

**Never-who rule for all of the above:** nothing exported off-box may carry a user, IP,
id, slug, or QR-token identity — same invariant the `OPERATION_COST` line already enforces.
