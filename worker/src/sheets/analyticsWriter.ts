/**
 * Analytics Writer for Google Sheets
 *
 * Handles logging analytics events to the ANALYTICS sheet.
 * Logs with source=worker and environment (stg/prod) for tracking.
 *
 * Row format (12 columns):
 * [timestamp, eventId, surface, metric, sponsorId, value, token, userAgent, sessionId, visibleSponsorIds, source, env]
 *
 * @module sheets/analyticsWriter
 * @see Story 3.3 - Port recordResult to Worker
 */

import {
  appendRow,
  type SheetsEnv,
  type AppendResult,
} from '../sheetsClient';

// =============================================================================
// Constants
// =============================================================================

const ANALYTICS_SHEET = 'ANALYTICS';

/**
 * Column indices for ANALYTICS sheet (0-based)
 */
export const ANALYTICS_COL = {
  TIMESTAMP: 0,
  EVENT_ID: 1,
  SURFACE: 2,
  METRIC: 3,
  SPONSOR_ID: 4,
  VALUE: 5,
  TOKEN: 6,
  USER_AGENT: 7,
  SESSION_ID: 8,
  VISIBLE_SPONSOR_IDS: 9,
  SOURCE: 10,
  ENV: 11,
} as const;

/**
 * Valid sources for analytics logging
 */
export const ANALYTICS_SOURCE = {
  WORKER: 'worker',
  GAS: 'gas',
  CLIENT: 'client',
} as const;

/**
 * Valid environments for analytics logging
 */
export const ANALYTICS_ENV = {
  PRODUCTION: 'prod',
  STAGING: 'stg',
  DEVELOPMENT: 'dev',
} as const;

/**
 * Valid surfaces for analytics
 */
export const VALID_SURFACES = ['public', 'display', 'poster', 'admin'] as const;
export type Surface = typeof VALID_SURFACES[number];

/**
 * Valid metrics for analytics
 */
export const VALID_METRICS = [
  'impression',
  'click',
  'scan',
  'dwellSec',
  'result_update',
  'schedule_update',
  'standings_update',
  'bracket_update',
] as const;
export type Metric = typeof VALID_METRICS[number];

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings required for analytics writer
 */
export interface AnalyticsWriterEnv extends SheetsEnv {
  WORKER_ENV?: string;
}

/**
 * Input for logging a single analytics event
 */
export interface AnalyticsLogInput {
  /** Event ID (required) */
  eventId: string;
  /** Surface where event occurred (required) */
  surface: Surface | string;
  /** Metric type (required) */
  metric: Metric | string;
  /** Optional sponsor ID */
  sponsorId?: string;
  /** Optional numeric value (e.g., dwell time) */
  value?: number;
  /** Optional session token */
  token?: string;
  /** Optional user agent */
  userAgent?: string;
  /** Optional session ID */
  sessionId?: string;
  /** Optional visible sponsor IDs */
  visibleSponsorIds?: string;
  /** Optional timestamp (defaults to now) */
  timestamp?: string;
}

/**
 * Result of analytics logging
 */
export interface AnalyticsLogResult {
  /** Whether logging succeeded */
  success: boolean;
  /** Error message (if failure) */
  error?: string;
}

/**
 * Result of batch analytics logging
 */
export interface AnalyticsBatchLogResult {
  /** Whether all logs succeeded */
  success: boolean;
  /** Number of rows logged */
  count: number;
  /** Error message (if any failure) */
  error?: string;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Determine the environment string from WORKER_ENV
 */
export function getEnvironmentString(env: AnalyticsWriterEnv): string {
  const workerEnv = env.WORKER_ENV?.toLowerCase();
  if (workerEnv === 'production' || workerEnv === 'prod') {
    return ANALYTICS_ENV.PRODUCTION;
  }
  if (workerEnv === 'staging' || workerEnv === 'stg') {
    return ANALYTICS_ENV.STAGING;
  }
  return ANALYTICS_ENV.DEVELOPMENT;
}

/**
 * Validate surface value
 */
export function isValidSurface(surface: string): surface is Surface {
  return VALID_SURFACES.includes(surface as Surface);
}

/**
 * Validate metric value
 */
export function isValidMetric(metric: string): boolean {
  return VALID_METRICS.includes(metric as Metric) || metric.length > 0;
}

/**
 * Sanitize a value for spreadsheet storage
 * Prevents formula injection by prefixing potentially dangerous values
 */
export function sanitizeSpreadsheetValue(value: string): string {
  if (!value || typeof value !== 'string') {
    return '';
  }

  // Prefix dangerous characters that could be interpreted as formulas
  const dangerous = ['=', '+', '-', '@', '\t', '\r', '\n'];
  if (dangerous.some(char => value.startsWith(char))) {
    return `'${value}`;
  }

  return value;
}

// =============================================================================
// Analytics Logging Functions
// =============================================================================

/**
 * Build a row for the ANALYTICS sheet
 */
export function buildAnalyticsRow(
  input: AnalyticsLogInput,
  source: string,
  env: string
): (string | number)[] {
  const now = input.timestamp || new Date().toISOString();

  return [
    now,                                                    // TIMESTAMP
    sanitizeSpreadsheetValue(input.eventId),               // EVENT_ID
    sanitizeSpreadsheetValue(input.surface),               // SURFACE
    sanitizeSpreadsheetValue(input.metric),                // METRIC
    sanitizeSpreadsheetValue(input.sponsorId || ''),       // SPONSOR_ID
    Number(input.value || 0),                              // VALUE
    sanitizeSpreadsheetValue(input.token || ''),           // TOKEN
    sanitizeSpreadsheetValue((input.userAgent || '').slice(0, 200)), // USER_AGENT (truncated)
    sanitizeSpreadsheetValue(input.sessionId || ''),       // SESSION_ID
    sanitizeSpreadsheetValue(input.visibleSponsorIds || ''), // VISIBLE_SPONSOR_IDS
    source,                                                 // SOURCE
    env,                                                    // ENV
  ];
}

/**
 * Log a single analytics event to the ANALYTICS sheet
 *
 * @param env - Worker environment with Sheets credentials
 * @param input - Analytics event to log
 * @returns Log result
 *
 * @example
 * await logAnalyticsEvent(env, {
 *   eventId: 'evt-123',
 *   surface: 'admin',
 *   metric: 'result_update',
 *   value: 1,
 * });
 */
export async function logAnalyticsEvent(
  env: AnalyticsWriterEnv,
  input: AnalyticsLogInput
): Promise<AnalyticsLogResult> {
  // Validate required fields
  if (!input.eventId || typeof input.eventId !== 'string') {
    return { success: false, error: 'Missing required field: eventId' };
  }

  if (!input.surface || typeof input.surface !== 'string') {
    return { success: false, error: 'Missing required field: surface' };
  }

  if (!input.metric || typeof input.metric !== 'string') {
    return { success: false, error: 'Missing required field: metric' };
  }

  const source = ANALYTICS_SOURCE.WORKER;
  const environment = getEnvironmentString(env);

  const row = buildAnalyticsRow(input, source, environment);

  try {
    const result: AppendResult = await appendRow(env, ANALYTICS_SHEET, row);

    if (result.updatedRows !== 1) {
      return {
        success: false,
        error: 'Analytics row was not appended correctly',
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to log analytics event',
    };
  }
}

/**
 * Log multiple analytics events to the ANALYTICS sheet
 *
 * Note: Currently appends one row at a time. Could be optimized
 * to use batch append if volume increases.
 *
 * @param env - Worker environment with Sheets credentials
 * @param inputs - Array of analytics events to log
 * @returns Batch log result
 */
export async function logAnalyticsEvents(
  env: AnalyticsWriterEnv,
  inputs: AnalyticsLogInput[]
): Promise<AnalyticsBatchLogResult> {
  if (!inputs || inputs.length === 0) {
    return { success: true, count: 0 };
  }

  let successCount = 0;
  const errors: string[] = [];

  for (const input of inputs) {
    const result = await logAnalyticsEvent(env, input);
    if (result.success) {
      successCount++;
    } else {
      errors.push(result.error || 'Unknown error');
    }
  }

  return {
    success: errors.length === 0,
    count: successCount,
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

/**
 * Log a result update action to analytics
 *
 * Convenience function for logging result/schedule/standings updates.
 *
 * @param env - Worker environment
 * @param eventId - Event ID being updated
 * @param metric - Type of update ('result_update', 'schedule_update', etc.)
 * @param details - Optional additional details
 */
export async function logResultUpdate(
  env: AnalyticsWriterEnv,
  eventId: string,
  metric: 'result_update' | 'schedule_update' | 'standings_update' | 'bracket_update',
  details?: { sessionId?: string; userAgent?: string }
): Promise<AnalyticsLogResult> {
  return logAnalyticsEvent(env, {
    eventId,
    surface: 'admin',
    metric,
    value: 1,
    sessionId: details?.sessionId,
    userAgent: details?.userAgent,
  });
}
