/**
 * BigQuery Client for Data Backup
 *
 * Provides BigQuery insert/query operations using the service account
 * authentication from google/auth.ts. Used for backing up event data,
 * analytics, and shared reports to BigQuery for long-term storage
 * and cross-event analysis.
 *
 * @module cloud/bigquery
 */

import { getGoogleAccessToken, type GoogleServiceAccountEnv } from '../google/auth';
import { GCP_API_URLS, GCP_SCOPES, getProjectId, type CloudEnv } from './config';

// =============================================================================
// Constants
// =============================================================================

/** Default dataset for event data backup */
const DEFAULT_DATASET_ID = 'oursharedevents_backup';

/** Default request timeout (15 seconds — BigQuery can be slower) */
const BIGQUERY_REQUEST_TIMEOUT_MS = 15000;

/** Maximum rows per streaming insert batch */
const MAX_INSERT_BATCH_SIZE = 500;

// =============================================================================
// Error Codes
// =============================================================================

export const BIGQUERY_ERROR_CODES = {
  QUERY_FAILED: 'BIGQUERY_QUERY_FAILED',
  INSERT_FAILED: 'BIGQUERY_INSERT_FAILED',
  NOT_CONFIGURED: 'BIGQUERY_NOT_CONFIGURED',
} as const;

export type BigQueryErrorCode = typeof BIGQUERY_ERROR_CODES[keyof typeof BIGQUERY_ERROR_CODES];

// =============================================================================
// Types
// =============================================================================

export interface BigQueryEnv extends GoogleServiceAccountEnv, CloudEnv {}

export class BigQueryError extends Error {
  readonly code: BigQueryErrorCode;
  readonly googleStatus?: number;

  constructor(code: BigQueryErrorCode, message: string, googleStatus?: number) {
    super(message);
    this.name = 'BigQueryError';
    this.code = code;
    this.googleStatus = googleStatus;
  }
}

/** Row for streaming insert */
export interface BigQueryInsertRow {
  /** Optional unique insert ID for deduplication */
  insertId?: string;
  /** Row data as key-value pairs */
  json: Record<string, unknown>;
}

/** Result of a streaming insert */
export interface BigQueryInsertResult {
  /** Number of rows successfully inserted */
  rowCount: number;
  /** Any per-row errors returned by BigQuery */
  insertErrors?: Array<{ index: number; errors: Array<{ reason: string; message: string }> }>;
}

/** Result of a query */
export interface BigQueryQueryResult {
  /** Column names */
  fields: string[];
  /** Row data */
  rows: Record<string, string>[];
  /** Total rows matching the query */
  totalRows: number;
  /** Whether the query is complete */
  jobComplete: boolean;
}

// =============================================================================
// Backup Table Schemas
// =============================================================================

/** Table names for backup data */
export const BACKUP_TABLES = {
  EVENTS: 'events_backup',
  ANALYTICS: 'analytics_backup',
  SHARED_REPORTS: 'shared_reports_backup',
  SPONSORS: 'sponsors_backup',
} as const;

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if BigQuery backup is configured
 */
export function isBigQueryConfigured(env: BigQueryEnv): boolean {
  return !!(env.GOOGLE_SA_CLIENT_EMAIL && env.GOOGLE_SA_PRIVATE_KEY_PEM);
}

/**
 * Get the effective dataset ID
 */
function getDatasetId(env: BigQueryEnv): string {
  return env.BIGQUERY_DATASET_ID || DEFAULT_DATASET_ID;
}

/**
 * Insert rows into a BigQuery table (streaming insert)
 *
 * Used for backing up event data, analytics, and shared reports.
 *
 * @param env - Worker environment with Google credentials
 * @param tableId - Target table name (e.g., 'events_backup')
 * @param rows - Array of row data to insert
 * @returns Insert result with row count and any errors
 * @throws {BigQueryError} If the insert fails
 */
export async function bigQueryInsertRows(
  env: BigQueryEnv,
  tableId: string,
  rows: BigQueryInsertRow[]
): Promise<BigQueryInsertResult> {
  if (!isBigQueryConfigured(env)) {
    throw new BigQueryError(
      BIGQUERY_ERROR_CODES.NOT_CONFIGURED,
      'BigQuery credentials not configured'
    );
  }

  if (rows.length === 0) {
    return { rowCount: 0 };
  }

  if (rows.length > MAX_INSERT_BATCH_SIZE) {
    throw new BigQueryError(
      BIGQUERY_ERROR_CODES.INSERT_FAILED,
      `Batch size ${rows.length} exceeds maximum of ${MAX_INSERT_BATCH_SIZE}`
    );
  }

  const tokenResult = await getGoogleAccessToken(env);
  const projectId = getProjectId(env);
  const datasetId = getDatasetId(env);

  const url = `${GCP_API_URLS.BIGQUERY}/projects/${projectId}/datasets/${datasetId}/tables/${tableId}/insertAll`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BIGQUERY_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenResult.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rows }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new BigQueryError(
        BIGQUERY_ERROR_CODES.INSERT_FAILED,
        `BigQuery insert failed: HTTP ${response.status}`,
        response.status
      );
    }

    const data = await response.json() as {
      insertErrors?: Array<{ index: number; errors: Array<{ reason: string; message: string }> }>;
    };

    return {
      rowCount: rows.length,
      insertErrors: data.insertErrors,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof BigQueryError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      throw new BigQueryError(
        BIGQUERY_ERROR_CODES.INSERT_FAILED,
        `BigQuery request timed out after ${BIGQUERY_REQUEST_TIMEOUT_MS}ms`
      );
    }

    throw new BigQueryError(
      BIGQUERY_ERROR_CODES.INSERT_FAILED,
      'BigQuery insert network error'
    );
  }
}

/**
 * Run a query against BigQuery
 *
 * Used for retrieving backed-up data for cross-event analysis
 * (consumed by OurEventRings).
 *
 * @param env - Worker environment with Google credentials
 * @param query - SQL query string
 * @param useLegacySql - Whether to use legacy SQL (default: false)
 * @returns Query result with fields and rows
 * @throws {BigQueryError} If the query fails
 */
export async function bigQueryRunQuery(
  env: BigQueryEnv,
  query: string,
  useLegacySql: boolean = false
): Promise<BigQueryQueryResult> {
  if (!isBigQueryConfigured(env)) {
    throw new BigQueryError(
      BIGQUERY_ERROR_CODES.NOT_CONFIGURED,
      'BigQuery credentials not configured'
    );
  }

  const tokenResult = await getGoogleAccessToken(env);
  const projectId = getProjectId(env);

  const url = `${GCP_API_URLS.BIGQUERY}/projects/${projectId}/queries`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BIGQUERY_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenResult.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        useLegacySql,
        maxResults: 1000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new BigQueryError(
        BIGQUERY_ERROR_CODES.QUERY_FAILED,
        `BigQuery query failed: HTTP ${response.status}`,
        response.status
      );
    }

    interface BQField { name: string; type: string }
    interface BQCell { v: string }
    interface BQRow { f: BQCell[] }
    interface BQResponse {
      schema?: { fields: BQField[] };
      rows?: BQRow[];
      totalRows?: string;
      jobComplete: boolean;
    }

    const data = await response.json() as BQResponse;

    const fields = (data.schema?.fields || []).map(f => f.name);
    const rows = (data.rows || []).map(row => {
      const obj: Record<string, string> = {};
      row.f.forEach((cell, i) => {
        if (fields[i]) {
          obj[fields[i]] = cell.v;
        }
      });
      return obj;
    });

    return {
      fields,
      rows,
      totalRows: parseInt(data.totalRows || '0', 10),
      jobComplete: data.jobComplete,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof BigQueryError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      throw new BigQueryError(
        BIGQUERY_ERROR_CODES.QUERY_FAILED,
        `BigQuery query timed out after ${BIGQUERY_REQUEST_TIMEOUT_MS}ms`
      );
    }

    throw new BigQueryError(
      BIGQUERY_ERROR_CODES.QUERY_FAILED,
      'BigQuery query network error'
    );
  }
}

/**
 * Backup event data to BigQuery
 *
 * Convenience function for backing up event rows from Google Sheets
 * to the events_backup table.
 *
 * @param env - Worker environment
 * @param events - Array of event objects to back up
 * @returns Insert result
 */
export async function backupEvents(
  env: BigQueryEnv,
  events: Record<string, unknown>[]
): Promise<BigQueryInsertResult> {
  const rows: BigQueryInsertRow[] = events.map(event => ({
    insertId: event.eventId as string | undefined,
    json: {
      ...event,
      backedUpAt: new Date().toISOString(),
    },
  }));

  return bigQueryInsertRows(env, BACKUP_TABLES.EVENTS, rows);
}

/**
 * Backup a shared report to BigQuery
 *
 * @param env - Worker environment
 * @param reportBundle - The SharedReport bundle to back up
 * @returns Insert result
 */
export async function backupSharedReport(
  env: BigQueryEnv,
  reportBundle: Record<string, unknown>
): Promise<BigQueryInsertResult> {
  const row: BigQueryInsertRow = {
    json: {
      ...reportBundle,
      backedUpAt: new Date().toISOString(),
    },
  };

  return bigQueryInsertRows(env, BACKUP_TABLES.SHARED_REPORTS, [row]);
}
