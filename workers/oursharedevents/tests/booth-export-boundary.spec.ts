/**
 * No stall leaves for BigQuery (OSE-2004 scope: "no booth-level row leaves for
 * BigQuery unless the acceptance contract (OCR-154) names it"; it names none).
 *
 * Two halves:
 *   1. the row guard every exporter calls (assertCorridorGrainRow) refuses a
 *      row that carries a stall: its id, number, name or hall spot;
 *   2. no exporter reads a stall: neither BigQuery exporter's source names
 *      `event_booths` or `booth_id`, so there is nothing for the guard to catch
 *      today. Placements are not exported at all (the guard already refuses
 *      `poster_deployment_id`), so there is no placement row a stall could
 *      ride on.
 *
 * @born-red OSE-2004 | method: run against export-geography.ts before the
 *   stall keys joined SUB_CORRIDOR_KEY: half 1 red (1 of 2); `booth_id` written
 *   into the event SELECT in handlers/bigquery.ts: half 2 red (1 of 2) | date: 2026-11-16
 *
 * Placement: node project (reads src/ and imports a pure module).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ExportGeographyError, assertCorridorGrainRow } from '../src/lib/export-geography';

const SRC = join(__dirname, '..', 'src');
const EXPORTERS = ['handlers/bigquery.ts', 'lib/shared-report-export.ts'];

describe('OSE-2004 | a stall never crosses the BigQuery boundary', () => {
  test('the row guard refuses every stall-shaped column', () => {
    for (const key of [
      'booth_id',
      'BOOTH_ID',
      'booth',
      'booth_number',
      'booth_name',
      'stall',
      'stall_id',
      'stall_number',
      'hall_x',
      'hall_y',
    ]) {
      expect(() => assertCorridorGrainRow({ corridor_id: 'unknown', [key]: 'x' }), key).toThrow(
        ExportGeographyError
      );
    }
    expect(() => assertCorridorGrainRow({ corridor_id: 'unknown', scans: 5 })).not.toThrow();
  });

  test('no exporter reads a stall', () => {
    for (const file of EXPORTERS) {
      const text = readFileSync(join(SRC, file), 'utf8');
      expect(text, file).not.toMatch(/event_booths|booth_id/i);
    }
  });
});
