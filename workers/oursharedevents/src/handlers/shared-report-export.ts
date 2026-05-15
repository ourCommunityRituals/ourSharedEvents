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
      perPool: { general: 0, hipaa: 0, coppa: 0 },
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
      perPool: { general: 0, hipaa: 0, coppa: 0 },
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
      perPool: { general: 0, hipaa: 0, coppa: 0 },
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
