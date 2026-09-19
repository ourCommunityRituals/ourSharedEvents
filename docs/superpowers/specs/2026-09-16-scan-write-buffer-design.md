# Design — Scan write-buffer (Cloudflare Queues)

**Date:** 2026-09-16 · **Status:** APPROVED (design) · **Owner:** Matt / BE
**Class:** architectural (subsystem #1 of 3 ahead-of-demand engine-hardening changes) · **Launch-blocking:** NO

## Problem

The `/q/:qr_token` QR-scan ingestion (`src/handlers/qr-scan.ts`) does **two D1 INSERTs per scan** on the request hot path (`env.DB.batch([scan_placement_events, scan_node_returns])`). D1 is single-primary SQLite — reads scale, writes do not scale infinitely. A viral spike (a flood of scans on one poster) is a **write burst** that can throttle the hot path. This is the one hardening item that **cannot be fixed mid-spike**, so it is built ahead of demand.

## Goal

Decouple the `/q/` hot path from D1 **writes** so a scan spike cannot throttle it — while preserving the **exact row schema** and the full never-who BI, including the anon-return dimension (`scan_node_returns.anonymous_id`, used for repeat-visitor analysis).

## Non-goals

- **Counter aggregation** (increment an h3-cell counter instead of a row). REJECTED: it collapses the `anonymous_id` return dimension — part of the moat.
- Changing the public **read** path (already cache-fronted; fine).
- The other two hardening items (cache-versioning, observability) — separate cycles.

## Design — Cloudflare Queues, rows preserved

**Hot path (`/q/:token`)** — unchanged up to the write:

1. Resolve poster deployment (D1 read — unchanged).
2. KV dedup (5-min bucket — unchanged).
3. **If `env.SCAN_QUEUE` is bound → `SCAN_QUEUE.send(msg)`; else fall back to today's direct `env.DB.batch([...])`.** Then redirect.
   - The "else" makes this **dark-launchable**: merged code behaves exactly as today until the queue is provisioned; no flip-day.
   - If `SCAN_QUEUE.send` **throws** (queue outage), fall back to the direct D1 batch write — **counts are never lost**. The queue is the optimization; the direct write is the floor.

**Message shape** (only the anonymized fields the rows already store — no new PII, internal-only):

```
{ event_id, deployment_id, anon_id, ua_hash, country, scan_bucket }
```

**Consumer** (`queue(batch, env)` in `index.ts`):

- Receives a batch (Cloudflare batches by `max_batch_size` / `max_batch_timeout`).
- One **batched** D1 write of the `scan_placement_events` + `scan_node_returns` rows for all messages (schema unchanged).
- `message.ack()` per success; failures retry (Queues auto-retry) → **dead-letter queue** for poison messages.

## Invariants preserved

- **never-who**: the message carries the same anonymized pseudonym + ua_hash + country + hour-bucket the row already stores; internal-only; no exact timestamp.
- **SCAN_PATH (no h3-js on the hot path)**: unchanged — geo/h3 tagging stays where it is; the consumer only writes the same rows the hot path used to.
- **Dedup** stays on the hot path (KV before enqueue) — same semantics as today, and avoids enqueuing dupes.

## Bindings / config (`wrangler.toml`)

- `[[queues.producers]]` → `SCAN_QUEUE` = `ose-scans`.
- `[[queues.consumers]]` → `ose-scans`, `max_batch_size` (e.g. 100), `max_batch_timeout` (e.g. 5s), `max_retries`, `dead_letter_queue = ose-scans-dlq`.
- New `SCAN_QUEUE?: Queue` on the `/q/` handler env type (optional → the dark-launch fallback works when unbound).

## Split — code vs owner's Cloudflare account

- **I build:** the `/q/` enqueue + fallback, the `queue()` consumer, the `wrangler.toml` producer/consumer config, env types, and born-red tests.
- **Owner provisions (separate terminal):** `wrangler queues create ose-scans` and `wrangler queues create ose-scans-dlq` (staging + production). The binding lives in `wrangler.toml`, so deploy wires it. (Exact commands handed over at build time.)

## Testing (miniflare `cloudflare:test`)

Born-red, verified by reverting:

1. Hot path with `SCAN_QUEUE` bound → **sends the message, does NOT write D1** (assert `env.DB` untouched, queue received the payload).
2. Consumer given a batch → **writes both rows for every message in one batched call**.
3. `SCAN_QUEUE.send` throws → hot path **falls back to the direct D1 batch** (counts preserved).
4. `SCAN_QUEUE` unbound → hot path uses the direct D1 batch (dark-launch parity with today).

## Rollout

Additive + dark-launchable: merge behind the "queue bound?" check → behaves as today. Provision the queues → deploy → scans route through the buffer. Reversible by unbinding.
