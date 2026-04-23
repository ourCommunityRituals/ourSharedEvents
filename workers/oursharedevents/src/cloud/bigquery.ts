/**
 * BigQuery streaming insert + query client (OSE-215 / BE-19)
 *
 * Uses the BigQuery Storage Write API (v2 insertAll endpoint) — no SDK.
 * Workers-compatible: uses fetch + WebCrypto only.
 */

import { getGoogleAccessToken, type GoogleAuthEnv } from '../google/auth';
import { GCP_API_URLS, getProjectId, getDatasetId, type CloudEnv } from './config';

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
    env.GOOGLE_SA_CLIENT_EMAIL?.trim() &&
    env.GOOGLE_SA_PRIVATE_KEY_PEM?.trim() &&
    env.GCP_PROJECT_ID?.trim()
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

  const { token } = await getGoogleAccessToken(env);
  const projectId = getProjectId(env);
  const datasetId = getDatasetId(env);
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
    return { rowCount: rows.length };
  } catch (err) {
    if (err instanceof BigQueryError) throw err;
    throw new BigQueryError('INSERT_FAILED', 'BQ insert request failed', err);
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
