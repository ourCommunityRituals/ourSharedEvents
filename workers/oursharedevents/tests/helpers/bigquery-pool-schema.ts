/**
 * Check a row against its BigQuery pool table schema (OSE-1416).
 *
 * The four pool tables (`bigquery/*.schema.json`) are created from those files
 * by `scripts/bq-create-pool-tables.sh`. The export specs run every row they
 * capture through `poolSchemaViolations`, so an export that starts sending a
 * field with no column, drops a REQUIRED one, or changes a value's type turns
 * them red here instead of failing insertAll in production.
 */
import eventsBackup from '../../bigquery/events_backup.schema.json';
import corridorReturns from '../../bigquery/corridor_returns_export.schema.json';
import corridorDensity from '../../bigquery/corridor_density_baseline_export.schema.json';
import eventSeries from '../../bigquery/event_series_export.schema.json';

interface Field {
  name: string;
  type: string;
  mode: string;
}

const POOL_TABLES: Record<string, Field[]> = {
  events_backup: eventsBackup,
  corridor_returns_export: corridorReturns,
  corridor_density_baseline_export: corridorDensity,
  event_series_export: eventSeries,
};

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function fits(type: string, value: unknown): boolean {
  switch (type) {
    case 'STRING':
      return typeof value === 'string';
    case 'INT64':
      return typeof value === 'number' && Number.isInteger(value);
    case 'TIMESTAMP':
      return typeof value === 'string' && TIMESTAMP_RE.test(value);
    default:
      return false;
  }
}

/** What insertAll would reject for this row. Empty = the row fits. */
export function poolSchemaViolations(table: string, row: Record<string, unknown>): string[] {
  const fields = POOL_TABLES[table];
  if (!fields) return [`${table}: no bigquery/${table}.schema.json`];
  const byName = new Map(fields.map((f) => [f.name, f]));
  const out: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    const f = byName.get(key);
    if (!f) out.push(`${table}.${key}: field is sent but has no column`);
    else if (value !== null && value !== undefined && !fits(f.type, value))
      out.push(`${table}.${key}: ${JSON.stringify(value)} is not ${f.type}`);
  }
  for (const f of fields) {
    if (f.mode === 'REQUIRED' && (row[f.name] === null || row[f.name] === undefined))
      out.push(`${table}.${f.name}: REQUIRED column is missing`);
  }
  return out;
}
