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
 *    store (pseudonymous anon id, ua hash, country, hour-bucket) — no exact
 *    timestamp, no PII, internal-only. The row schema is byte-for-byte unchanged.
 *  - SCAN_PATH (no h3-js on the hot path): unchanged — this file only writes the
 *    same rows `handleQrScan` used to; no geo/h3 work here.
 *  - two-DB isolation: writes go only to `DB` (the anonymous surface).
 */

/**
 * The only fields the buffered write needs — each already lands in a scan row
 * today. Internal-only (never serialized to a client); never-who by construction.
 */
export interface ScanMessage {
  event_id: string;
  deployment_id: string;
  anon_id: string;
  ua_hash: string | null;
  country: string | null;
  scan_bucket: string;
}

/** Env surface the buffer needs: the anonymous DB, and the optional scan queue. */
export interface ScanBufferEnv {
  DB: D1Database;
  SCAN_QUEUE?: Queue<ScanMessage>;
}

/**
 * The two INSERTs for one scan — split so no durable row carries both a placement
 * id (WHERE) and a session-derived value (WHO) (OSE-798, doctrine rule 6). Row PKs
 * are generated here at write time; they are opaque and carry no meaning. Schema
 * is identical to the pre-buffer inline write in `handleQrScan`.
 */
export function buildScanStatements(db: D1Database, msg: ScanMessage): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO scan_placement_events
           (id, event_id, poster_deployment_id, scan_bucket, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .bind(`spe_${crypto.randomUUID()}`, msg.event_id, msg.deployment_id, msg.scan_bucket),
    db
      .prepare(
        `INSERT INTO scan_node_returns
           (id, event_id, anonymous_id, user_agent_hash, country_code, scan_bucket, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .bind(
        `snr_${crypto.randomUUID()}`,
        msg.event_id,
        msg.anon_id,
        msg.ua_hash,
        msg.country,
        msg.scan_bucket
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
    for (const message of batch.messages) message.retry();
  }
}
