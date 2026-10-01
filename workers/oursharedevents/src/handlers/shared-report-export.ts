/**
 * OSE-272 Session 4 — SharedReport BigQuery export cron orchestrator
 *
 * Called from index.ts scheduled() alongside runSharedReportMaterialization
 * (Session 3) and the existing runBigQueryBackup. Per S4-Q1 ratified, same
 * cron tick as materialization.
 *
 * Failure isolation per S4-Q4: each phase wrapped in its own try/catch
 * (also inside the exporters themselves). A failed phase logs + marks its
 * state row 'failed', but the next phase still runs. Materialization
 * (Session 3) always runs regardless of export outcome.
 *
 * Gate 5 (tests/shared-report-pipeline-invariants.spec.ts) enforces that
 * this handler is invoked ONLY from index.ts scheduled() — never from
 * router.ts. Cron-only by static-source check.
 */

import {
  exportAnonIdReturns,
  exportCorridorDensityBaseline,
  exportEventSeries,
  type ExportResult,
  type SharedReportExportEnv,
} from '../lib/shared-report-export';
import { logExportManifest } from '../lib/audit-log';

/** BigQuery table each phase writes, for the manifest's provenance record. */
const PHASE_TABLE: Record<string, string> = {
  anon_id_returns: 'corridor_returns_export', // OSE-1460: counts, not per-person rows
  corridor_density_baseline: 'corridor_density_baseline_export',
  event_series: 'event_series_export',
};

export interface SharedReportExportRunResult {
  ok: boolean;
  phases: ExportResult[];
  totalRowsExported: number;
  totalErrors: number;
  totalDurationMs: number;
}

export async function runSharedReportBigQueryExport(
  env: SharedReportExportEnv
): Promise<SharedReportExportRunResult> {
  const start = Date.now();
  const phases: ExportResult[] = [];

  // Phase 1 — anon_id_returns. Each phase isolates its own failure.
  try {
    phases.push(await exportAnonIdReturns(env));
  } catch (err) {
    phases.push({
      phase: 'anon_id_returns',
      rowsRead: 0,
      rowsExported: 0,
      rowsSkipped: 0,
      errors: 1,
      perPool: { general: 0 }, // declined regimes removed (OSE-1220)
      durationMs: 0,
    });
    console.error(
      JSON.stringify({
        type: 'SHARED_REPORT_EXPORT_PHASE_THREW',
        phase: 'anon_id_returns',
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }

  // Phase 2 — corridor_density_baseline
  try {
    phases.push(await exportCorridorDensityBaseline(env));
  } catch (err) {
    phases.push({
      phase: 'corridor_density_baseline',
      rowsRead: 0,
      rowsExported: 0,
      rowsSkipped: 0,
      errors: 1,
      perPool: { general: 0 }, // declined regimes removed (OSE-1220)
      durationMs: 0,
    });
    console.error(
      JSON.stringify({
        type: 'SHARED_REPORT_EXPORT_PHASE_THREW',
        phase: 'corridor_density_baseline',
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }

  // Phase 3 — event_series
  try {
    phases.push(await exportEventSeries(env));
  } catch (err) {
    phases.push({
      phase: 'event_series',
      rowsRead: 0,
      rowsExported: 0,
      rowsSkipped: 0,
      errors: 1,
      perPool: { general: 0 }, // declined regimes removed (OSE-1220)
      durationMs: 0,
    });
    console.error(
      JSON.stringify({
        type: 'SHARED_REPORT_EXPORT_PHASE_THREW',
        phase: 'event_series',
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }

  const totalRowsExported = phases.reduce((acc, p) => acc + p.rowsExported, 0);
  const totalErrors = phases.reduce((acc, p) => acc + p.errors, 0);
  const totalDurationMs = Date.now() - start;
  const ok = totalErrors === 0;

  // OSE-556 / OSE-616: every phase that ran against the D1 → BigQuery
  // boundary leaves a manifest row, including a configured run with nothing
  // past its watermark (rows 0) and a phase that threw. Counts, routing and
  // corridor coverage only, never row-level data. The one thing not logged is
  // a phase that never ran because BigQuery is not configured here.
  const runId = crypto.randomUUID();
  for (const p of phases) {
    if (!p.ran && p.errors === 0) continue;
    await logExportManifest(env, {
      export_type: 'BIGQUERY',
      event_id: 'cron:shared-report',
      actor: 'cron:scheduler',
      request_id: runId,
      rows_exported: p.rowsExported,
      outcome: p.errors === 0 ? 'success' : 'failed',
      details: {
        phase: p.phase,
        table: PHASE_TABLE[p.phase] ?? p.phase,
        rows_read: p.rowsRead,
        rows_withheld: p.rowsSkipped,
        per_pool: p.perPool,
        corridor_id_present: p.corridorIdPresent ?? 0,
        corridor_id_unknown: p.corridorIdUnknown ?? 0,
        geography: 'corridor (H3 res7) or coarser; sub-corridor rows rejected',
      },
    });
  }

  console.log(
    JSON.stringify({
      type: 'SHARED_REPORT_EXPORT_COMPLETE',
      ok,
      totalRowsExported,
      totalErrors,
      totalDurationMs,
      phases: phases.map((p) => ({
        phase: p.phase,
        rowsRead: p.rowsRead,
        rowsExported: p.rowsExported,
        errors: p.errors,
        perPool: p.perPool,
        durationMs: p.durationMs,
      })),
    })
  );

  return { ok, phases, totalRowsExported, totalErrors, totalDurationMs };
}
