/**
 * BigQuery streaming insert + query client (OSE-215 / BE-19)
 *
 * Uses the BigQuery Storage Write API (v2 insertAll endpoint) — no SDK.
 * Workers-compatible: uses fetch + WebCrypto only.
 */

import { getGoogleAccessToken, type GoogleAuthEnv } from '../google/auth';
import {
  GCP_API_URLS,
  getProjectId,
  getDatasetId,
  CloudConfigError,
  type CloudEnv,
} from './config';

export class BigQueryError extends Error {
  constructor(
    public readonly code: 'NOT_CONFIGURED' | 'TOO_MANY_ROWS' | 'INSERT_FAILED' | 'QUERY_FAILED',
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'BigQueryError';
  }
}

export const BACKUP_TABLES = {
  events: 'events_backup',
} as const;

const MAX_ROWS_PER_BATCH = 500;
const REQUEST_TIMEOUT_MS = 15_000;

export type BigQueryEnv = GoogleAuthEnv & CloudEnv;

export function isBigQueryConfigured(env: BigQueryEnv): boolean {
  return Boolean(
    env.WIF_PRIVATE_KEY_PEM?.trim() &&
    env.GCP_PROJECT_NUMBER?.trim() &&
    env.WIF_POOL_ID?.trim() &&
    env.WIF_PROVIDER_ID?.trim() &&
    env.GCP_PROJECT_ID?.trim()
  );
}

/**
 * tabledata.insertAll reports per-row rejections inside an HTTP 200
 * (`insertErrors`). Treating 2xx as full success would let a caller count and
 * manifest rows BigQuery never stored, and advance past them. Both insertAll
 * clients below call this after the status check (OSE-616).
 */
async function assertNoInsertErrors(res: Response, rowCount: number, where: string): Promise<void> {
  const result = (await res.json().catch(() => ({}))) as {
    insertErrors?: Array<{
      index?: number;
      errors?: Array<{ reason?: string; message?: string }>;
    }>;
  };
  const rejected = result.insertErrors ?? [];
  if (rejected.length === 0) return;
  const first = rejected[0]?.errors?.[0];
  throw new BigQueryError(
    'INSERT_FAILED',
    `BQ insertAll rejected ${rejected.length}/${rowCount} rows (${where})` +
      (first ? `: ${first.reason ?? ''} ${first.message ?? ''}`.trimEnd() : '')
  );
}

/**
 * Stream rows into a BigQuery table via the insertAll API.
 * Max 500 rows per batch (BQ limit).
 */
export async function bigQueryInsertRows(
  env: BigQueryEnv,
  tableId: string,
  rows: Record<string, unknown>[]
): Promise<{ rowCount: number }> {
  if (!isBigQueryConfigured(env)) {
    throw new BigQueryError(
      'NOT_CONFIGURED',
      'BigQuery is not configured — set GCP_PROJECT_ID and Google SA credentials'
    );
  }
  if (rows.length > MAX_ROWS_PER_BATCH) {
    throw new BigQueryError(
      'TOO_MANY_ROWS',
      `Batch size ${rows.length} exceeds max ${MAX_ROWS_PER_BATCH}`
    );
  }
  if (rows.length === 0) return { rowCount: 0 };

  let datasetId: string;
  try {
    datasetId = getDatasetId(env);
  } catch (err) {
    if (err instanceof CloudConfigError) throw new BigQueryError('NOT_CONFIGURED', err.message);
    throw err;
  }
  const { token } = await getGoogleAccessToken(env);
  const projectId = getProjectId(env);
  const url = GCP_API_URLS.bigqueryInsert(projectId, datasetId, tableId);

  const body = {
    rows: rows.map((row, i) => ({ insertId: `${tableId}-${Date.now()}-${i}`, json: row })),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BigQueryError('INSERT_FAILED', `BQ insertAll failed: ${res.status} ${text}`);
    }
    await assertNoInsertErrors(res, rows.length, `dataset=${datasetId} table=${tableId}`);
    return { rowCount: rows.length };
  } catch (err) {
    if (err instanceof BigQueryError) throw err;
    throw new BigQueryError('INSERT_FAILED', 'BQ insert request failed', err);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Stream rows into a BigQuery table in a SPECIFIC dataset, with an
 * optional caller-supplied insertId function for idempotency.
 *
 * Used by the SharedReport BigQuery export (OSE-272 Session 4) where
 * different rows must route to different datasets per regulatory pool,
 * and where retries must be safe (BQ deduplicates on insertId).
 *
 * - Same 500-row batch limit as bigQueryInsertRows.
 * - insertIdFn defaults to ${tableId}-${Date.now()}-${i} (non-idempotent,
 *   matches legacy bigQueryInsertRows behavior). Pass an explicit function
 *   to compute insertIds from row content for crash-safe retries.
 */
export async function bigQueryInsertRowsToDataset(
  env: BigQueryEnv,
  datasetId: string,
  tableId: string,
  rows: Record<string, unknown>[],
  insertIdFn?: (row: Record<string, unknown>, i: number) => string
): Promise<{ rowCount: number }> {
  if (!isBigQueryConfigured(env)) {
    throw new BigQueryError(
      'NOT_CONFIGURED',
      'BigQuery is not configured — set GCP_PROJECT_ID and Google SA credentials'
    );
  }
  if (rows.length > MAX_ROWS_PER_BATCH) {
    throw new BigQueryError(
      'TOO_MANY_ROWS',
      `Batch size ${rows.length} exceeds max ${MAX_ROWS_PER_BATCH}`
    );
  }
  if (rows.length === 0) return { rowCount: 0 };

  const { token } = await getGoogleAccessToken(env);
  const projectId = getProjectId(env);
  const url = GCP_API_URLS.bigqueryInsert(projectId, datasetId, tableId);

  const makeInsertId =
    insertIdFn ?? ((_row: Record<string, unknown>, i: number) => `${tableId}-${Date.now()}-${i}`);
  const body = {
    rows: rows.map((row, i) => ({ insertId: makeInsertId(row, i), json: row })),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BigQueryError(
        'INSERT_FAILED',
        `BQ insertAll failed (dataset=${datasetId} table=${tableId}): ${res.status} ${text}`
      );
    }
    await assertNoInsertErrors(res, rows.length, `dataset=${datasetId} table=${tableId}`);
    return { rowCount: rows.length };
  } catch (err) {
    if (err instanceof BigQueryError) throw err;
    throw new BigQueryError(
      'INSERT_FAILED',
      `BQ insert request failed (dataset=${datasetId} table=${tableId})`,
      err
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Run a synchronous BigQuery query. Returns up to 1000 rows.
 */
export async function bigQueryRunQuery(
  env: BigQueryEnv,
  query: string
): Promise<Record<string, unknown>[]> {
  if (!isBigQueryConfigured(env)) {
    throw new BigQueryError('NOT_CONFIGURED', 'BigQuery is not configured');
  }
  const { token } = await getGoogleAccessToken(env);
  const projectId = getProjectId(env);
  const url = GCP_API_URLS.bigqueryQuery(projectId);

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, useLegacySql: false, maxResults: 1000 }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new BigQueryError('QUERY_FAILED', `BQ query failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as {
    schema?: { fields: { name: string }[] };
    rows?: { f: { v: unknown }[] }[];
  };
  const fields = data.schema?.fields ?? [];
  return (data.rows ?? []).map((row) =>
    Object.fromEntries(fields.map((f, i) => [f.name, row.f[i]?.v]))
  );
}

/**
 * Convenience: back up a list of events to the events_backup BQ table.
 * Graceful no-op if BQ is not configured.
 */
export async function backupEvents(
  env: BigQueryEnv,
  events: Record<string, unknown>[]
): Promise<{ skipped: boolean; rowCount?: number }> {
  if (!isBigQueryConfigured(env)) return { skipped: true };
  if (events.length === 0) return { skipped: false, rowCount: 0 };
  const rows = events.map((e) => ({ ...e, backed_up_at: new Date().toISOString() }));
  const result = await bigQueryInsertRows(env, BACKUP_TABLES.events, rows);
  return { skipped: false, rowCount: result.rowCount };
}
