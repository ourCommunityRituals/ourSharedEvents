/**
 * Scan write-buffer — decouple the `/q/:qr_token` QR-scan hot path from D1
 * WRITES so a viral scan spike cannot throttle it. D1 is single-primary SQLite:
 * reads scale, writes do not scale infinitely, and a write burst is the one
 * hardening item that cannot be fixed mid-spike — so it is built ahead of demand.
 *
 * Design: docs/superpowers/specs/2026-09-16-scan-write-buffer-design.md
 *
 *   Hot path (producer): if SCAN_QUEUE is bound → enqueue and return; else fall
 *   back to today's direct D1 batch. If send() throws (queue outage) → fall back
 *   to the direct write. The queue is the optimization; the direct write is the
 *   floor, so counts are NEVER lost. The unbound branch makes this dark-launchable
 *   — merged code behaves exactly as today until the queue is provisioned.
 *
 *   Consumer: one batched D1 write of the same two rows per message, then ack.
 *
 * INVARIANTS:
 *  - never-who: the message carries only the anonymized fields the rows already
 *    store (keyed scan id, ua hash, hour-bucket; never a country, OSE-1460) — no exact
 *    timestamp, no PII, internal-only. The two opaque row ids are pre-generated
 *    separately so queue retries are idempotent without creating a durable join key.
 *  - SCAN_PATH (no h3-js on the hot path): unchanged — this file only writes the
 *    same rows `handleQrScan` used to; no geo/h3 work here.
 *  - two-DB isolation: writes go only to `DB` (the anonymous surface).
 */

import { isScanNodeKey } from './scan-node-key';

/**
 * The only fields the buffered write needs — each already lands in a scan row
 * today. Internal-only (never serialized to a client); never-who by construction.
 */
export interface ScanMessage {
  placement_row_id: string;
  return_row_id: string;
  event_id: string;
  deployment_id: string;
  /**
   * The keyed scan id (`lib/scan-node-key.ts`, `snk1_…`), never the `ose_anon`
   * cookie value (OSE-1659); null when ANON_ID_HASH_PEPPER is not set. The field
   * keeps its old name so a rolled-back consumer still finds it. Whatever it
   * holds, `buildScanStatements` stores only a well-formed key.
   */
  anon_id: string | null;
  /** Browser-name hash; stored only when `anon_id` is not a keyed id (TL-078). */
  ua_hash: string | null;
  /**
   * Always null (OSE-1460: the visitor's country is never read). Kept on the
   * wire for rollback safety: the previous consumer binds `msg.country`, and
   * D1 rejects an undefined binding, so a message without the field would
   * dead-letter if the Worker were rolled back while scans are queued. Remove
   * once no older consumer can still be deployed.
   */
  country: null;
  scan_bucket: string;
}

/** Env surface the buffer needs: the anonymous DB, the optional scan queue and dedup KV. */
export interface ScanBufferEnv {
  DB: D1Database;
  SCAN_QUEUE?: Queue<ScanMessage>;
  RATE_LIMIT_KV?: KVNamespace;
}

/**
 * The /q/ dedup marker for one person at one poster in one hour bucket
 * (OSE-1459). Shared by the hot path, which sets it, and the queue consumer,
 * which releases it when a scan is finally dropped. The hot path passes the
 * keyed scan id when it has one, so the marker (1-hour TTL) does not name the
 * cookie value either.
 */
export function scanDedupKey(anonId: string, deploymentId: string, scanBucket: string): string {
  return `scan:dedup:${anonId}:${deploymentId}:${scanBucket}`;
}

/**
 * Must equal `max_retries` on the scan queue consumer in wrangler.toml (pinned
 * by a test). Queues delivers a message at most max_retries + 1 times, then
 * dead-letters it.
 */
export const SCAN_QUEUE_MAX_RETRIES = 3;

/**
 * The `created_at` both split tables store: the scan's hour bucket, and nothing
 * finer (OSE-923, N-DS-2). The two rows of one scan are written in one batch, so
 * a second-precision stamp would let (event_id, created_at) join who to where one
 * scan at a time, whatever the bucket size. `scan_bucket` is `YYYY-MM-DDTHH:00`;
 * the stamp is the same hour in the table's `YYYY-MM-DD HH:MM:SS` shape. No clock
 * is read, so a queued scan processed later still gets its own hour.
 */
export function hourStamp(scanBucket: string): string {
  return `${scanBucket.slice(0, 10)} ${scanBucket.slice(11, 13)}:00:00`;
}

/**
 * The two INSERTs for one scan — split so no durable row carries both a placement
 * id (WHERE) and a session-derived value (WHO) (OSE-798, doctrine rule 6). Row PKs
 * are generated before enqueue and replayed on retry; they are independent opaque
 * ids so the two tables still do not gain a shared durable correlation key.
 */
export function buildScanStatements(db: D1Database, msg: ScanMessage): D1PreparedStatement[] {
  // OSE-1659: only a keyed scan id is stored. A raw cookie value (from a
  // message the previous Worker queued) or anything else becomes NULL.
  const scanKey = isScanNodeKey(msg.anon_id) ? msg.anon_id : null;
  return [
    db
      .prepare(
        `INSERT OR IGNORE INTO scan_placement_events
           (id, event_id, poster_deployment_id, scan_bucket, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        msg.placement_row_id,
        msg.event_id,
        msg.deployment_id,
        msg.scan_bucket,
        hourStamp(msg.scan_bucket)
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO scan_node_returns
           (id, event_id, anonymous_id, user_agent_hash, country_code, scan_bucket, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`
      )
      .bind(
        msg.return_row_id,
        msg.event_id,
        scanKey,
        // TL-078 (2026-10-10): a row with a keyed id keeps no browser-name hash.
        // The hash is only the visitor-count fallback for a scan with no id
        // (ANON_ID_HASH_PEPPER unset), so it is stored only then. Applies to
        // messages the previous Worker queued, too.
        scanKey ? null : msg.ua_hash,
        msg.scan_bucket,
        hourStamp(msg.scan_bucket)
      ),
  ];
}

/**
 * Hot-path producer. Enqueue when the queue is bound and healthy; otherwise (or on
 * a send failure) write straight to D1. Returns which path was taken so the caller
 * can log it (SCAN_ENQUEUED vs SCAN_RECORDED). Never throws for a queue outage —
 * the direct write is the floor.
 */
export async function enqueueOrWriteScan(
  env: ScanBufferEnv,
  msg: ScanMessage
): Promise<'enqueued' | 'written'> {
  if (env.SCAN_QUEUE) {
    try {
      await env.SCAN_QUEUE.send(msg);
      return 'enqueued';
    } catch {
      // Queue outage — fall through to the direct write so counts are never lost.
    }
  }
  await env.DB.batch(buildScanStatements(env.DB, msg));
  return 'written';
}

/**
 * Queue consumer. Flatten every message's two statements into ONE batched D1 write
 * (both rows for all messages land or none does), then ack each message. If the
 * batch write throws, retry the whole batch — Queues auto-retry, and poison
 * messages dead-letter after max_retries.
 */
export async function handleScanBatch(
  batch: MessageBatch<ScanMessage>,
  env: ScanBufferEnv
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const message of batch.messages) {
    statements.push(...buildScanStatements(env.DB, message.body));
  }
  if (statements.length === 0) return;

  try {
    await env.DB.batch(statements);
    for (const message of batch.messages) message.ack();
  } catch {
    // Let Queues retry the batch (→ DLQ after max_retries). Do not ack.
    for (const message of batch.messages) {
      // On the last delivery the scan is about to be dead-lettered, not
      // stored. Release its hour's dedup marker so the person's next scan in
      // that hour is recorded instead of being taken as a repeat.
      // Without ANON_ID_HASH_PEPPER the message carries no id, so its marker
      // cannot be named here; it expires with its hour (1-hour TTL).
      const m = message.body;
      if (message.attempts > SCAN_QUEUE_MAX_RETRIES && env.RATE_LIMIT_KV && m.anon_id) {
        await env.RATE_LIMIT_KV.delete(
          scanDedupKey(m.anon_id, m.deployment_id, m.scan_bucket)
        ).catch(() => {});
      }
      message.retry();
    }
  }
}
