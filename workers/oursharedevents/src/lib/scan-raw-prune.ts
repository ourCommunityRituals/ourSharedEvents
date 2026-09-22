/**
 * Scan raw-row prune — the "prune-raw" half of the aggregate-in → prune-raw
 * scan-ingest pipeline (OSE-1091).
 *
 * WHERE THIS SITS. The ingest pipeline has three stages and, until this module,
 * only the first two existed:
 *
 *   1. INGEST   `/q/:qr_token` → `lib/scan-buffer.ts` → (SCAN_QUEUE) → two raw
 *               rows per scan: `scan_placement_events` (WHERE) and
 *               `scan_node_returns` (WHO).
 *   2. AGGREGATE cron → `aggregateScanBuckets` (OSE-632) rolls raw rows up into
 *               `scan_aggregates`; `materializeAnonIdReturns` folds the same raw
 *               rows into the peppered `anon_id_returns` return signal.
 *   3. PRUNE    ← this module. Once a raw row's value has been extracted into
 *               the derived tables, the raw row is a liability that nothing
 *               reads.
 *
 * Without stage 3 the pipeline never closes: `scan_node_returns` grows forever,
 * holding a RAW (unpeppered) `anonymous_id` per scan. That column is the
 * sharpest cross-event correlation vector the platform has — it is the reason
 * `lib/scan-returns-retention.ts` exists and the reason OSE-1350 built an
 * erasure path for it.
 *
 * ── Why this prunes ONLY the WHO side ────────────────────────────────────────
 *
 * OSE-798 (doctrine rule 6) split one scan into two rows precisely so that no
 * durable row carries both a placement id and a session-derived value:
 *
 *   `scan_placement_events` — WHERE. Placement id + hour bucket. Already
 *      never-who. It is the count of record: `handlers/event-stats.ts` reads it
 *      (not the returns table) for the scan gauge, and `handleDeleteEvent`'s
 *      activity guard counts it to refuse destroying an event that met reality.
 *      This module NEVER touches it. Counts, stats, and that guard are
 *      unaffected by a prune.
 *
 *   `scan_node_returns` — WHO. Raw `anonymous_id`, ua hash, country. Its
 *      analytical value is fully captured by stage 2: the distinct-visitor count
 *      lands in `scan_aggregates.distinct_agent_hashes`, and the return signal
 *      lands in `anon_id_returns` as a PEPPERED hash. After both, the raw id
 *      buys nothing and costs correlation risk.
 *
 * So a prune here strictly SHRINKS the re-identification surface while leaving
 * every number the product reports exactly where it was.
 *
 * ── This is not a TTL, and deliberately so ───────────────────────────────────
 *
 * A retention window deletes by age whether or not the data was ever used. This
 * deletes only rows whose value is PROVABLY already extracted, which is what
 * makes it lossless rather than a judgement call about how much history to keep.
 * Two interlocks enforce that, and both must hold:
 *
 *   1. The event has at least one `scan_aggregates` row. That row can only have
 *      been written by `aggregateScanBuckets`, so its existence is proof the
 *      aggregate-in half actually ran for this event. No aggregate → no prune,
 *      however old the raw rows are.
 *   2. `ANON_ID_HASH_PEPPER` is configured. Without it
 *      `materializeAnonIdReturns` no-ops by design (see `lib/shared-report.ts`),
 *      so `anon_id_returns` was never populated and pruning would destroy return
 *      signal that nothing ever captured. Missing pepper → refuse to prune.
 *
 * A third rule protects the aggregate already written. `aggregateScanBuckets`
 * re-reads raw rows for every event started in the last 90 days and rewrites
 * each hour bucket with INSERT OR REPLACE. Dropping a WHOLE bucket is safe (it
 * leaves that query entirely, so nothing is rewritten), but dropping PART of one
 * makes the rollup recompute a smaller number over the correct one — a silent
 * undercount. So a bucket is pruned all-or-nothing: no row is deleted while a
 * newer row shares its (event_id, scan_bucket). That holds for ANY window, so
 * correctness never depends on an operator picking a value above the 90-day
 * aggregation horizon.
 *
 * On top of all three, `MIN_PRUNE_DAYS` keeps the window clear of the 26-hour
 * materialization ceiling, so a prune can never race a cron that is still
 * entitled to read the row.
 *
 * ── Off by default, and off by RULING ───────────────────────────────────────
 *
 * Unset knob → no-op with a structured log line, matching OSE-207's subscribers
 * retention and OSE-1351's returns retention.
 *
 * As of 2026-09-22 this is not merely a cautious default but a product ruling:
 * QR SCAN DATA IS RETAINED INDEFINITELY. Scans are part of an event's permanent
 * historical record and the basis for longitudinal and geo-spatial
 * intelligence, so — unlike FORMS_DB (opt-in PII, bounded lifecycle) and
 * `subscribers` (365 days) — scan signal has no expiry. `wrangler.toml` ships
 * `SCAN_RAW_PRUNE_DAYS = "0"`.
 *
 * This module therefore exists as an available MECHANISM, wired and tested, not
 * as an active sweep. Keeping it built means the capability is ready if a
 * specific deployment (a stricter regulatory tier, a customer contract) ever
 * needs bounded raw retention, without anyone having to re-derive the interlocks
 * under time pressure. It also means the codebase does not quietly overturn the
 * Q3-ratified "no table-level windowing" decision recorded in
 * `migrations/0031_create_anon_id_returns.sql`.
 *
 * AUDIT. One `admin_audit_log` row per run (action `SCAN_RAW_PRUNE`, actor
 * `system:lifecycle`), aggregate counts only — never an anon id.
 */

export interface ScanRawPruneEnv {
  DB: D1Database;
  /** Days of raw `scan_node_returns` to keep. Unset / non-positive → disabled. */
  SCAN_RAW_PRUNE_DAYS?: string;
  /** Interlock 2: without the pepper, stage 2's return-signal half never ran. */
  ANON_ID_HASH_PEPPER?: string;
}

export interface ScanRawPruneResult {
  enabled: boolean;
  days: number;
  rowsPruned: number;
  /** True when the sweep was refused because the pepper is unset (interlock 2). */
  blockedOnPepper: boolean;
  errors: number;
}

/**
 * Floor on the configured window.
 *
 * `materializeAnonIdReturns` may read an event's raw rows until 26 hours after
 * its `end_date`. A 2-day floor keeps any prune comfortably outside that
 * window even if a cron tick is late, so the two jobs can never contend for the
 * same row. A knob set below the floor is RAISED to it rather than rejected —
 * the safe direction, since the alternative is silently disabling the sweep an
 * operator believed they had enabled.
 */
export const MIN_PRUNE_DAYS = 2;

/** Unset / blank / junk / non-positive → 0 (disabled). Below the floor → floor. */
export function resolveScanRawPruneDays(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return 0;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(n, MIN_PRUNE_DAYS);
}

export async function runScanRawPrune(env: ScanRawPruneEnv): Promise<ScanRawPruneResult> {
  const now = new Date().toISOString();
  const days = resolveScanRawPruneDays(env.SCAN_RAW_PRUNE_DAYS);
  const result: ScanRawPruneResult = {
    enabled: days > 0,
    days,
    rowsPruned: 0,
    blockedOnPepper: false,
    errors: 0,
  };

  if (!result.enabled) {
    console.log(
      JSON.stringify({
        type: 'SCAN_RAW_PRUNE_NOOP',
        reason:
          'SCAN_RAW_PRUNE_DAYS unset or non-positive; raw scan_node_returns rows are retained indefinitely (OSE-1091 — prune is opt-in)',
        timestamp: now,
      })
    );
    await audit(env, result);
    return result;
  }

  // Interlock 2 — see the header. Pruning without the pepper would delete return
  // signal that `materializeAnonIdReturns` never had the means to extract.
  if (!env.ANON_ID_HASH_PEPPER?.trim()) {
    result.blockedOnPepper = true;
    console.warn(
      JSON.stringify({
        type: 'SCAN_RAW_PRUNE_BLOCKED',
        reason:
          'ANON_ID_HASH_PEPPER is unset, so anon_id_returns materialization is a no-op; pruning raw rows now would discard un-extracted return signal',
        days,
        timestamp: now,
      })
    );
    await audit(env, result);
    return result;
  }

  try {
    // Interlock 1 is the first EXISTS: only prune raw rows belonging to an
    // event that already has an aggregate. `scan_placement_events` is
    // deliberately absent from this statement — the WHERE side is never pruned.
    //
    // Interlock 3 (bucket atomicity) is the NOT EXISTS. `aggregateScanBuckets`
    // re-reads raw rows for every event started in the last 90 days, recomputes
    // each hour bucket, and writes it back with INSERT OR REPLACE. Removing an
    // ENTIRE bucket is safe — it drops out of that query, no REPLACE fires, and
    // the stored aggregate stands. Removing PART of one is not: the recomputed
    // count comes back lower and overwrites the correct value, silently
    // understating the event.
    //
    // That is not an edge case. The cutoff is a moving instant and the cron
    // runs hourly, so it lands inside an hour bucket routinely. Refusing to
    // delete any row whose bucket still holds a newer sibling makes a prune
    // all-or-nothing per bucket, which keeps the two stages off each other's
    // rows for ANY window — rather than relying on an operator choosing a value
    // above the 90-day aggregation horizon. The straggler is simply collected
    // on a later run, once its whole bucket has aged out.
    const res = await env.DB.prepare(
      `DELETE FROM scan_node_returns
         WHERE created_at < datetime('now', ?)
           AND EXISTS (
             SELECT 1 FROM scan_aggregates
              WHERE scan_aggregates.event_id = scan_node_returns.event_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM scan_node_returns AS newer
              WHERE newer.event_id   = scan_node_returns.event_id
                AND newer.scan_bucket = scan_node_returns.scan_bucket
                AND newer.created_at >= datetime('now', ?)
           )`
    )
      .bind(`-${days} days`, `-${days} days`)
      .run();
    result.rowsPruned = res.meta?.changes ?? 0;
  } catch (err) {
    result.errors++;
    console.error(
      JSON.stringify({
        type: 'SCAN_RAW_PRUNE_ERROR',
        error: err instanceof Error ? err.message : String(err),
        days,
        timestamp: now,
      })
    );
  }

  console.log(
    JSON.stringify({
      type: 'SCAN_RAW_PRUNE_COMPLETE',
      days,
      rowsPruned: result.rowsPruned,
      errors: result.errors,
      timestamp: now,
    })
  );
  await audit(env, result);
  return result;
}

async function audit(env: ScanRawPruneEnv, r: ScanRawPruneResult): Promise<void> {
  const id = crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}`;
  try {
    await env.DB.prepare(
      `INSERT INTO admin_audit_log
         (id, action, actor, resource_type, resource_id, request_id, outcome, ip, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        'SCAN_RAW_PRUNE',
        'system:lifecycle',
        'scan_node_returns',
        null,
        id,
        r.errors > 0 ? 'denied' : 'success',
        null,
        JSON.stringify({
          enabled: r.enabled,
          days: r.days,
          rowsPruned: r.rowsPruned,
          blockedOnPepper: r.blockedOnPepper,
          errors: r.errors,
        })
      )
      .run();
  } catch {
    // Audit failures must never break the lifecycle job.
  }
}
