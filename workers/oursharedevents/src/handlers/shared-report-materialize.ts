/**
 * OSE-272 — SharedReport materialization cron orchestrator
 *
 * Single entry point called from the scheduled() handler in src/index.ts.
 * Runs the SharedReport materialization phases sequentially:
 *
 *  -1. scan_aggregation  — roll up raw scans into scan_aggregates (OSE-632)
 *   0. h3_cell_backfill  — tag scan_aggregates rows with h3 cells from events
 *   1. (retired)         — anon_id_returns, the per-phone return rate (OSE-2214)
 *   2. corridor_density  — rolling 30/90d baseline refresh
 *   3. event_series      — Q2 hybrid auto-detector (pending candidates)
 *
 * Gate 4 (CI-enforced in tests/shared-report-pipeline-invariants.spec.ts):
 *
 *   This handler MUST NOT be wired to any user-facing route. Only the
 *   scheduled() trigger reaches it. A grep of router.ts for
 *   `runSharedReportMaterialization` MUST return zero matches.
 *
 * Failure isolation:
 *
 *   Each phase is wrapped so a failure in one does NOT abort the others
 *   (same discipline as runFormDataLifecycle). All results are emitted
 *   as one structured log line, SHARED_REPORT_MATERIALIZE_COMPLETE: the
 *   run's summary for SRE observability.
 */

import {
  aggregateScanBuckets,
  backfillH3Cells,
  refreshCorridorBaselines,
  detectEventSeriesClusters,
  type SharedReportMaterializeEnv,
  type MaterializationResult,
} from '../lib/shared-report';

import { publishCount } from '../lib/count-floor';
import { errorLabel } from '../lib/error-label';
import { CORRIDOR_MAP_MIN_COUNT } from '../lib/shared-report';
export interface SharedReportMaterializeRunResult {
  ok: boolean;
  phases: MaterializationResult[];
  totalDurationMs: number;
  totalErrors: number;
}

export async function runSharedReportMaterialization(
  env: SharedReportMaterializeEnv
): Promise<SharedReportMaterializeRunResult> {
  const start = Date.now();
  const phases: MaterializationResult[] = [];
  let totalErrors = 0;

  // Phase -1 — scan bucket aggregation (must run before h3_cell_backfill
  //             so backfill has rows to tag with h3 cells)
  try {
    const r = await aggregateScanBuckets(env);
    phases.push(r);
    totalErrors += r.errors;
  } catch (err) {
    totalErrors++;
    phases.push(makeErrorResult('scan_aggregation', errorLabel(err)));
  }

  // Phase 0 — H3 cell backfill (must run before read-side corridor-map queries)
  try {
    const r = await backfillH3Cells(env);
    phases.push(r);
    totalErrors += r.errors;
  } catch (err) {
    totalErrors++;
    phases.push(makeErrorResult('h3_cell_backfill', errorLabel(err)));
  }

  // Phase 1 (anon_id_returns, the per-phone return rate) is retired: OSE
  // counts scans of the code, never people (OSE-2214).

  // Phase 2 — corridor baseline refresh
  try {
    const r = await refreshCorridorBaselines(env);
    phases.push(r);
    totalErrors += r.errors;
  } catch (err) {
    totalErrors++;
    phases.push(makeErrorResult('corridor_density_baseline', errorLabel(err)));
  }

  // Phase 3 — event-series auto-detector
  try {
    const r = await detectEventSeriesClusters(env);
    phases.push(r);
    totalErrors += r.errors;
  } catch (err) {
    totalErrors++;
    phases.push(makeErrorResult('event_series_detector', errorLabel(err)));
  }

  const totalDurationMs = Date.now() - start;

  // The materialization summary (OSE-634): one line a run, written whatever
  // the phases found, so a quiet healthy run (ok, zero events, zero errors)
  // reads differently from a broken one. It mirrors the lifecycle log shape
  // from runFormDataLifecycle so existing log dashboards index it the same way.
  // Aggregate-only: no event, cell or person is named in it.
  console.log(
    JSON.stringify({
      type: 'SHARED_REPORT_MATERIALIZE_COMPLETE',
      ok: totalErrors === 0,
      total_duration_ms: totalDurationMs,
      total_errors: totalErrors,
      count_floor: CORRIDOR_MAP_MIN_COUNT,
      phases: phases.map((p) => ({
        phase: p.phase,
        events_processed: p.eventsProcessed,
        rows_upserted: summaryRowCount(p.phase, 'upserted', p.rowsUpserted),
        rows_skipped: summaryRowCount(p.phase, 'skipped', p.rowsSkipped),
        errors: p.errors,
        duration_ms: p.durationMs,
      })),
      timestamp: new Date().toISOString(),
    })
  );

  return {
    ok: totalErrors === 0,
    phases,
    totalDurationMs,
    totalErrors,
  };
}

/**
 * The row counters that count places, time buckets or events, and so are
 * written to the summary line as they are. Every other counter counts scans
 * (the scan roll-up's skipped rows are scans), and the line gives those only
 * from the floor up (AGENTS.md invariant 2): below it the value is null, never 0.
 * A phase or counter not listed here is withheld the same way, so a new phase
 * has to be read against the floor before its row counts reach a log.
 */
const EXACT_ROW_COUNTS: Record<string, readonly ('upserted' | 'skipped')[]> = {
  scan_aggregation: ['upserted'],
  h3_cell_backfill: ['upserted', 'skipped'],
  corridor_density_baseline: ['upserted', 'skipped'],
  event_series_detector: ['upserted', 'skipped'],
};

function summaryRowCount(phase: string, counter: 'upserted' | 'skipped', n: number): number | null {
  if (Object.hasOwn(EXACT_ROW_COUNTS, phase) && EXACT_ROW_COUNTS[phase].includes(counter)) return n;
  return publishCount(n).count;
}

function makeErrorResult(phase: string, error: string): MaterializationResult {
  console.error(
    JSON.stringify({
      type: 'SHARED_REPORT_MATERIALIZE_PHASE_FATAL',
      phase,
      error,
    })
  );
  return {
    phase,
    eventsProcessed: 0,
    rowsUpserted: 0,
    rowsSkipped: 0,
    errors: 1,
    durationMs: 0,
  };
}
