/**
 * OSE-272 — SharedReport materialization cron orchestrator
 *
 * Single entry point called from the scheduled() handler in src/index.ts.
 * Runs the SharedReport materialization phases sequentially:
 *
 *  -1. scan_aggregation  — roll up raw scans into scan_aggregates (OSE-632)
 *   0. h3_cell_backfill  — tag scan_aggregates rows with h3 cells from events
 *   1. anon_id_returns   — per-event upsert of return-rate signal
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
 *   as a structured log line for SRE observability.
 */

import {
  aggregateScanBuckets,
  backfillH3Cells,
  materializeAnonIdReturns,
  refreshCorridorBaselines,
  detectEventSeriesClusters,
  type SharedReportMaterializeEnv,
  type MaterializationResult,
} from '../lib/shared-report';

import { errorLabel } from '../lib/error-label';
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

  // Phase 1 — per-event return-rate materialization
  try {
    const r = await materializeAnonIdReturns(env);
    phases.push(r);
    totalErrors += r.errors;
  } catch (err) {
    totalErrors++;
    phases.push(makeErrorResult('anon_id_returns', errorLabel(err)));
  }

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

  // Structured log line for SRE observability — mirrors the lifecycle
  // log shape from runFormDataLifecycle so existing log dashboards can
  // index this consistently.
  console.log(
    JSON.stringify({
      type: 'SHARED_REPORT_MATERIALIZE_COMPLETE',
      total_duration_ms: totalDurationMs,
      total_errors: totalErrors,
      phases: phases.map((p) => ({
        phase: p.phase,
        events_processed: p.eventsProcessed,
        rows_upserted: p.rowsUpserted,
        rows_skipped: p.rowsSkipped,
        errors: p.errors,
        duration_ms: p.durationMs,
      })),
    })
  );

  return {
    ok: totalErrors === 0,
    phases,
    totalDurationMs,
    totalErrors,
  };
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
