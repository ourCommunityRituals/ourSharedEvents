/**
 * Google Sheets API Client for Cloudflare Workers
 *
 * Provides a single abstraction for all Sheets API calls with:
 * - DRY, testable interface
 * - Automatic retry for 429 (rate limit) and 5xx errors
 * - Bounded exponential backoff
 * - Structured error handling and logging
 *
 * @module sheetsClient
 * @see Story 1.2 - Implement sheetsClient.ts for Workers
 */

import {
  getAccessToken,
  hasCredentials,
  AuthError,
  logAuthError,
  type GoogleAuthEnv,
} from './googleAuth';

// =============================================================================
// Constants
// =============================================================================

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 8000;
const RETRY_BACKOFF_MULTIPLIER = 2;

// =============================================================================
// Types
// =============================================================================

/**
 * Worker environment bindings for Sheets API access.
 *
 * Note: SHEETS_SPREADSHEET_ID is optional to match the reality that
 * environment variables may not be set. Use isConfigured() to check
 * at runtime before making API calls.
 */
export interface SheetsEnv extends GoogleAuthEnv {
  SHEETS_SPREADSHEET_ID?: string;
}

/**
 * Error codes for Sheets API operations
 */
export const SHEETS_ERROR_CODES = {
  NOT_CONFIGURED: 'SHEETS_NOT_CONFIGURED',
  AUTH_ERROR: 'SHEETS_AUTH_ERROR',
  INVALID_RANGE: 'SHEETS_INVALID_RANGE',
  NOT_FOUND: 'SHEETS_NOT_FOUND',
  PERMISSION_DENIED: 'SHEETS_PERMISSION_DENIED',
  RATE_LIMITED: 'SHEETS_RATE_LIMITED',
  SERVER_ERROR: 'SHEETS_SERVER_ERROR',
  NETWORK_ERROR: 'SHEETS_NETWORK_ERROR',
  RETRY_EXHAUSTED: 'SHEETS_RETRY_EXHAUSTED',
} as const;

export type SheetsErrorCode = typeof SHEETS_ERROR_CODES[keyof typeof SHEETS_ERROR_CODES];

/**
 * Custom error class for Sheets API failures
 */
export class SheetsError extends Error {
  readonly code: SheetsErrorCode;
  readonly httpStatus?: number;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(
    code: SheetsErrorCode,
    message: string,
    options?: {
      httpStatus?: number;
      details?: unknown;
      retryable?: boolean;
    }
  ) {
    super(message);
    this.name = 'SheetsError';
    this.code = code;
    this.httpStatus = options?.httpStatus;
    this.details = options?.details;
    this.retryable = options?.retryable ?? false;
  }
}

/**
 * Result type for Sheets API read operations
 */
export type SheetValues = string[][];

/**
 * Options for Sheets API read operations
 */
export interface ReadOptions {
  valueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
  dateTimeRenderOption?: 'SERIAL_NUMBER' | 'FORMATTED_STRING';
}

/**
 * Options for Sheets API write operations
 */
export interface WriteOptions {
  valueInputOption?: 'RAW' | 'USER_ENTERED';
}

/**
 * Response from batch get operation
 */
export interface BatchGetResult {
  range: string;
  values: SheetValues;
}

/**
 * Response from update operations
 */
export interface UpdateResult {
  updatedRange: string;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
}

/**
 * Response from append operations
 */
export interface AppendResult {
  tableRange: string;
  updatedRange: string;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
}

// =============================================================================
// Retry Logic
// =============================================================================

/**
 * Determine if an HTTP status code is retryable
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Calculate delay for exponential backoff
 */
function calculateRetryDelay(attempt: number): number {
  const delay = INITIAL_RETRY_DELAY_MS * Math.pow(RETRY_BACKOFF_MULTIPLIER, attempt);
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract retry-after header value in milliseconds
 */
function getRetryAfterMs(response: Response): number | null {
  const retryAfter = response.headers.get('Retry-After');
  if (!retryAfter) return null;

  // Check if it's a number (seconds)
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // Check if it's a date
  const date = Date.parse(retryAfter);
  if (!isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return null;
}

// =============================================================================
// Internal Request Handler
// =============================================================================

/**
 * Make an authenticated request to Google Sheets API with retry logic
 */
async function sheetsRequest<T>(
  env: SheetsEnv,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  // Validate configuration
  if (!hasCredentials(env)) {
    throw new SheetsError(
      SHEETS_ERROR_CODES.NOT_CONFIGURED,
      'Google Sheets API credentials not configured',
      { retryable: false }
    );
  }

  if (!env.SHEETS_SPREADSHEET_ID) {
    throw new SheetsError(
      SHEETS_ERROR_CODES.NOT_CONFIGURED,
      'SHEETS_SPREADSHEET_ID not configured',
      { retryable: false }
    );
  }

  // Get access token
  let accessToken: string;
  try {
    accessToken = await getAccessToken(env);
  } catch (error) {
    if (error instanceof AuthError) {
      logAuthError(error);
      throw new SheetsError(
        SHEETS_ERROR_CODES.AUTH_ERROR,
        `Authentication failed: ${error.message}`,
        { details: error.details, retryable: false }
      );
    }
    throw error;
  }

  const url = `${SHEETS_API_BASE}${endpoint}`;
  const requestOptions: RequestInit = {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  };

  // Retry loop
  let lastError: SheetsError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, requestOptions);

      if (response.ok) {
        return await response.json() as T;
      }

      // Handle non-OK responses
      const error = await parseErrorResponse(response);

      // Check if retryable
      if (error.retryable && attempt < MAX_RETRIES) {
        const retryAfterMs = getRetryAfterMs(response);
        const delayMs = retryAfterMs ?? calculateRetryDelay(attempt);

        logSheetsClientError(error, {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          retryDelayMs: delayMs,
          endpoint,
        });

        await sleep(delayMs);
        lastError = error;
        continue;
      }

      throw error;
    } catch (error) {
      if (error instanceof SheetsError) {
        throw error;
      }

      // Network error
      const networkError = new SheetsError(
        SHEETS_ERROR_CODES.NETWORK_ERROR,
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { details: error, retryable: true }
      );

      if (attempt < MAX_RETRIES) {
        const delayMs = calculateRetryDelay(attempt);
        logSheetsClientError(networkError, {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          retryDelayMs: delayMs,
          endpoint,
        });
        await sleep(delayMs);
        lastError = networkError;
        continue;
      }

      throw networkError;
    }
  }

  // Retries exhausted
  throw new SheetsError(
    SHEETS_ERROR_CODES.RETRY_EXHAUSTED,
    `All ${MAX_RETRIES} retries exhausted`,
    { details: lastError, retryable: false }
  );
}

/**
 * Parse error response from Sheets API
 */
async function parseErrorResponse(response: Response): Promise<SheetsError> {
  let errorDetails: unknown;
  try {
    errorDetails = await response.json();
  } catch {
    errorDetails = { message: await response.text() };
  }

  const status = response.status;

  // Map HTTP status to error code
  if (status === 400) {
    // Check for invalid range error
    const errorMessage = extractErrorMessage(errorDetails);
    if (errorMessage.toLowerCase().includes('range')) {
      return new SheetsError(
        SHEETS_ERROR_CODES.INVALID_RANGE,
        `Invalid range: ${errorMessage}`,
        { httpStatus: status, details: errorDetails, retryable: false }
      );
    }
    return new SheetsError(
      SHEETS_ERROR_CODES.NOT_CONFIGURED,
      `Bad request: ${errorMessage}`,
      { httpStatus: status, details: errorDetails, retryable: false }
    );
  }

  if (status === 401 || status === 403) {
    return new SheetsError(
      status === 401 ? SHEETS_ERROR_CODES.AUTH_ERROR : SHEETS_ERROR_CODES.PERMISSION_DENIED,
      `Authentication/permission error: ${response.statusText}`,
      { httpStatus: status, details: errorDetails, retryable: false }
    );
  }

  if (status === 404) {
    return new SheetsError(
      SHEETS_ERROR_CODES.NOT_FOUND,
      'Spreadsheet or sheet not found',
      { httpStatus: status, details: errorDetails, retryable: false }
    );
  }

  if (status === 429) {
    return new SheetsError(
      SHEETS_ERROR_CODES.RATE_LIMITED,
      'Google Sheets API rate limit exceeded',
      { httpStatus: status, details: errorDetails, retryable: true }
    );
  }

  if (status >= 500) {
    return new SheetsError(
      SHEETS_ERROR_CODES.SERVER_ERROR,
      `Google Sheets API server error: ${status}`,
      { httpStatus: status, details: errorDetails, retryable: true }
    );
  }

  return new SheetsError(
    SHEETS_ERROR_CODES.SERVER_ERROR,
    `Google Sheets API error: ${status} ${response.statusText}`,
    { httpStatus: status, details: errorDetails, retryable: false }
  );
}

/**
 * Extract error message from Google API error response
 */
function extractErrorMessage(details: unknown): string {
  if (!details || typeof details !== 'object') {
    return 'Unknown error';
  }

  const obj = details as Record<string, unknown>;

  // Google API error format
  if (obj.error && typeof obj.error === 'object') {
    const error = obj.error as Record<string, unknown>;
    if (typeof error.message === 'string') {
      return error.message;
    }
  }

  // Simple message format
  if (typeof obj.message === 'string') {
    return obj.message;
  }

  return 'Unknown error';
}

// =============================================================================
// Logging
// =============================================================================

/**
 * Log Sheets client error with structured format
 */
export function logSheetsClientError(
  error: SheetsError,
  context?: Record<string, unknown>
): void {
  console.error(JSON.stringify({
    type: 'SHEETS_CLIENT_ERROR',
    code: error.code,
    message: error.message,
    httpStatus: error.httpStatus,
    retryable: error.retryable,
    timestamp: new Date().toISOString(),
    ...context,
  }));
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if Sheets API is properly configured
 */
export function isConfigured(env: Partial<SheetsEnv>): boolean {
  return hasCredentials(env) && !!env.SHEETS_SPREADSHEET_ID;
}

/**
 * Get values from a sheet range
 *
 * @param env - Worker environment with Sheets credentials
 * @param sheetName - Name of the sheet (e.g., 'EVENTS')
 * @param range - A1 notation range within the sheet (e.g., 'A:Z' or 'A1:G10')
 * @param options - Read options
 * @returns 2D array of cell values
 *
 * @example
 * const values = await getSheetValues(env, 'EVENTS', 'A:G');
 * // values = [['id', 'name', ...], ['1', 'Event 1', ...], ...]
 */
export async function getSheetValues(
  env: SheetsEnv,
  sheetName: string,
  range: string,
  options: ReadOptions = {}
): Promise<SheetValues> {
  const fullRange = `${sheetName}!${range}`;
  const params = new URLSearchParams();

  if (options.valueRenderOption) {
    params.set('valueRenderOption', options.valueRenderOption);
  }
  if (options.dateTimeRenderOption) {
    params.set('dateTimeRenderOption', options.dateTimeRenderOption);
  }

  const endpoint = `/${env.SHEETS_SPREADSHEET_ID}/values/${encodeURIComponent(fullRange)}?${params}`;

  interface GetResponse {
    range: string;
    majorDimension: string;
    values?: string[][];
  }

  const result = await sheetsRequest<GetResponse>(env, endpoint, { method: 'GET' });
  return result.values || [];
}

/**
 * Batch get multiple ranges in a single API call
 *
 * @param env - Worker environment with Sheets credentials
 * @param ranges - Array of ranges in 'SheetName!A1:Z10' format
 * @param options - Read options
 * @returns Array of results with range and values
 *
 * @example
 * const results = await batchGetRanges(env, ['EVENTS!A:G', 'SPONSORS!A:E']);
 */
export async function batchGetRanges(
  env: SheetsEnv,
  ranges: string[],
  options: ReadOptions = {}
): Promise<BatchGetResult[]> {
  const params = new URLSearchParams();

  ranges.forEach(range => params.append('ranges', range));

  if (options.valueRenderOption) {
    params.set('valueRenderOption', options.valueRenderOption);
  }
  if (options.dateTimeRenderOption) {
    params.set('dateTimeRenderOption', options.dateTimeRenderOption);
  }

  const endpoint = `/${env.SHEETS_SPREADSHEET_ID}/values:batchGet?${params}`;

  interface BatchGetResponse {
    spreadsheetId: string;
    valueRanges?: Array<{
      range: string;
      majorDimension: string;
      values?: string[][];
    }>;
  }

  const result = await sheetsRequest<BatchGetResponse>(env, endpoint, { method: 'GET' });

  return (result.valueRanges || []).map(vr => ({
    range: vr.range,
    values: vr.values || [],
  }));
}

/**
 * Append a row to a sheet
 *
 * @param env - Worker environment with Sheets credentials
 * @param sheetName - Name of the sheet (e.g., 'EVENTS')
 * @param row - Array of cell values for the new row
 * @param options - Write options
 * @returns Append result with updated range info
 *
 * @example
 * await appendRow(env, 'EVENTS', ['id-123', 'Event Name', 'data...']);
 */
export async function appendRow(
  env: SheetsEnv,
  sheetName: string,
  row: (string | number | boolean | null)[],
  options: WriteOptions = {}
): Promise<AppendResult> {
  const range = `${sheetName}!A:Z`;
  const params = new URLSearchParams({
    valueInputOption: options.valueInputOption || 'RAW',
    insertDataOption: 'INSERT_ROWS',
  });

  const endpoint = `/${env.SHEETS_SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append?${params}`;

  interface AppendResponse {
    spreadsheetId: string;
    tableRange: string;
    updates: {
      spreadsheetId: string;
      updatedRange: string;
      updatedRows: number;
      updatedColumns: number;
      updatedCells: number;
    };
  }

  const result = await sheetsRequest<AppendResponse>(env, endpoint, {
    method: 'POST',
    body: JSON.stringify({
      values: [row.map(v => v === null ? '' : String(v))],
    }),
  });

  return {
    tableRange: result.tableRange,
    updatedRange: result.updates.updatedRange,
    updatedRows: result.updates.updatedRows,
    updatedColumns: result.updates.updatedColumns,
    updatedCells: result.updates.updatedCells,
  };
}

/**
 * Update a specific row in a sheet
 *
 * @param env - Worker environment with Sheets credentials
 * @param sheetName - Name of the sheet (e.g., 'EVENTS')
 * @param rowIndex - 1-based row index (row 1 is typically headers)
 * @param row - Array of cell values for the row
 * @param options - Write options
 * @returns Update result with updated range info
 *
 * @example
 * await updateRow(env, 'EVENTS', 5, ['id-123', 'Updated Name', 'data...']);
 */
export async function updateRow(
  env: SheetsEnv,
  sheetName: string,
  rowIndex: number,
  row: (string | number | boolean | null)[],
  options: WriteOptions = {}
): Promise<UpdateResult> {
  if (rowIndex < 1) {
    throw new SheetsError(
      SHEETS_ERROR_CODES.INVALID_RANGE,
      'Row index must be >= 1',
      { retryable: false }
    );
  }

  // Determine the range based on row length
  const endColumn = columnIndexToLetter(row.length);
  const range = `${sheetName}!A${rowIndex}:${endColumn}${rowIndex}`;
  const params = new URLSearchParams({
    valueInputOption: options.valueInputOption || 'RAW',
  });

  const endpoint = `/${env.SHEETS_SPREADSHEET_ID}/values/${encodeURIComponent(range)}?${params}`;

  interface UpdateResponse {
    spreadsheetId: string;
    updatedRange: string;
    updatedRows: number;
    updatedColumns: number;
    updatedCells: number;
  }

  const result = await sheetsRequest<UpdateResponse>(env, endpoint, {
    method: 'PUT',
    body: JSON.stringify({
      values: [row.map(v => v === null ? '' : String(v))],
    }),
  });

  return {
    updatedRange: result.updatedRange,
    updatedRows: result.updatedRows,
    updatedColumns: result.updatedColumns,
    updatedCells: result.updatedCells,
  };
}

/**
 * Convert a column index (1-based) to Excel-style letter(s)
 */
function columnIndexToLetter(index: number): string {
  let result = '';
  let n = index;

  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }

  return result || 'A';
}

/**
 * Create a safe upstream error response (502 Bad Gateway)
 * for client-facing errors that shouldn't expose internal details
 */
export function createUpstreamSafeError(
  error: SheetsError,
  correlationId?: string
): Response {
  const body = {
    ok: false,
    status: 502,
    code: 'UPSTREAM_ERROR',
    message: 'An error occurred while communicating with the data source',
    correlationId,
    timestamp: new Date().toISOString(),
  };

  // Log the actual error server-side
  logSheetsClientError(error, { correlationId });

  return new Response(JSON.stringify(body), {
    status: 502,
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId || '',
    },
  });
}

/**
 * Health check for Sheets connectivity
 */
export async function healthCheck(
  env: SheetsEnv
): Promise<{ connected: boolean; latencyMs: number; error?: string }> {
  const startTime = Date.now();

  try {
    if (!isConfigured(env)) {
      return {
        connected: false,
        latencyMs: 0,
        error: 'Not configured',
      };
    }

    // Fetch spreadsheet metadata to verify connectivity
    const endpoint = `/${env.SHEETS_SPREADSHEET_ID}?fields=spreadsheetId,properties.title`;
    await sheetsRequest<{ spreadsheetId: string }>(env, endpoint, { method: 'GET' });

    return {
      connected: true,
      latencyMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      connected: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
