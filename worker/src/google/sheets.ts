/**
 * Google Sheets API Client for Cloudflare Workers
 *
 * Provides sheets read operations using the service account authentication
 * from Story B1. This module is the canonical way to read from Google Sheets
 * in the Cloudflare Worker.
 *
 * @module google/sheets
 * @see Story B3 - Sheets Client Read sheetsGetValues() (Structured Failures)
 */

import { getGoogleAccessToken, type GoogleServiceAccountEnv } from './auth';

// =============================================================================
// Constants
// =============================================================================

/** Google Sheets API base URL */
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Maximum length for googleBody snippet in error responses (per Backend Architect spec) */
const MAX_GOOGLE_BODY_SNIPPET_LENGTH = 400;

/** Default timeout for Sheets API requests (10 seconds) */
const SHEETS_REQUEST_TIMEOUT_MS = 10000;

// =============================================================================
// Error Codes (Story B3)
// =============================================================================

/**
 * Sheets error codes per Story B3 acceptance criteria
 */
export const SHEETS_READ_ERROR_CODES = {
  /** Generic sheets read failure */
  SHEETS_READ_FAILED: 'SHEETS_READ_FAILED',
} as const;

export type SheetsReadErrorCode = typeof SHEETS_READ_ERROR_CODES[keyof typeof SHEETS_READ_ERROR_CODES];

// =============================================================================
// Types
// =============================================================================

/**
 * Worker environment bindings for Sheets API access
 */
export interface SheetsEnv extends GoogleServiceAccountEnv {
  /** Google Sheets spreadsheet ID */
  SHEETS_SPREADSHEET_ID?: string;
}

/**
 * Custom error class for Sheets read failures
 *
 * Per Story B3: Structured errors with code, googleStatus, and googleBody snippet
 */
export class SheetsReadError extends Error {
  readonly code: SheetsReadErrorCode;
  /** HTTP status from Google Sheets API */
  readonly googleStatus?: number;
  /** Truncated snippet of Google API response body (max 400 chars) */
  readonly googleBody?: string;

  constructor(
    code: SheetsReadErrorCode,
    message: string,
    options?: {
      googleStatus?: number;
      googleBody?: string;
    }
  ) {
    super(message);
    this.name = 'SheetsReadError';
    this.code = code;
    this.googleStatus = options?.googleStatus;
    // Per Backend Architect spec: never dump full Google responses (max 400 chars)
    this.googleBody = options?.googleBody
      ? truncateSnippet(options.googleBody, MAX_GOOGLE_BODY_SNIPPET_LENGTH)
      : undefined;
  }
}

/**
 * Result type for Sheets API read operations
 */
export type SheetValues = string[][];

/**
 * Options for sheetsGetValues
 */
export interface SheetsGetValuesOptions {
  /** How values should be rendered (default: FORMATTED_VALUE) */
  valueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
  /** How dates should be rendered (default: FORMATTED_STRING) */
  dateTimeRenderOption?: 'SERIAL_NUMBER' | 'FORMATTED_STRING';
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
}

/**
 * Result from sheetsGetValues
 */
export interface SheetsGetValuesResult {
  /** The range that was read */
  range: string;
  /** The values in the range (2D array) */
  values: SheetValues;
  /** Major dimension of the data */
  majorDimension: 'ROWS' | 'COLUMNS';
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Truncate a string to a maximum length with ellipsis
 *
 * Per Backend Architect spec: never dump full Google responses
 */
function truncateSnippet(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Safely extract text from a Response for error reporting
 */
async function safeGetResponseText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return truncateSnippet(text, MAX_GOOGLE_BODY_SNIPPET_LENGTH);
  } catch {
    return '[unable to read response body]';
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Read values from a Google Sheets range
 *
 * Per Story B3: Centralized abstraction for Google Sheets reads with deterministic failures.
 *
 * @param env - Worker environment with Google credentials
 * @param spreadsheetId - Google Sheets spreadsheet ID
 * @param rangeA1 - A1 notation range (e.g., 'Sheet1!A1:Z100' or 'A1:Z100')
 * @param options - Optional read options
 * @returns SheetsGetValuesResult with range and values
 * @throws {SheetsReadError} If the read fails (with code, googleStatus, googleBody)
 *
 * @example
 * // Read from a specific sheet
 * const result = await sheetsGetValues(env, spreadsheetId, 'EVENTS!A:G');
 * console.log(result.values); // [['id', 'name', ...], ['1', 'Event 1', ...], ...]
 *
 * @example
 * // Read a simple range (uses first sheet)
 * const result = await sheetsGetValues(env, spreadsheetId, 'A1:A1');
 */
export async function sheetsGetValues(
  env: SheetsEnv,
  spreadsheetId: string,
  rangeA1: string,
  options: SheetsGetValuesOptions = {}
): Promise<SheetsGetValuesResult> {
  // Validate spreadsheet ID is provided
  if (!spreadsheetId) {
    throw new SheetsReadError(
      SHEETS_READ_ERROR_CODES.SHEETS_READ_FAILED,
      'spreadsheetId is required'
    );
  }

  // Get access token (this handles auth validation internally)
  let accessToken: string;
  try {
    const tokenResult = await getGoogleAccessToken(env);
    accessToken = tokenResult.accessToken;
  } catch (error) {
    throw new SheetsReadError(
      SHEETS_READ_ERROR_CODES.SHEETS_READ_FAILED,
      `Failed to get access token: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Build the URL with proper encoding
  // Per Story B3: Ensure encodeURIComponent is applied properly
  const encodedRange = encodeURIComponent(rangeA1);
  const params = new URLSearchParams();

  if (options.valueRenderOption) {
    params.set('valueRenderOption', options.valueRenderOption);
  }
  if (options.dateTimeRenderOption) {
    params.set('dateTimeRenderOption', options.dateTimeRenderOption);
  }

  const queryString = params.toString();
  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodedRange}${queryString ? `?${queryString}` : ''}`;

  // Set up timeout
  const timeoutMs = options.timeoutMs ?? SHEETS_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      interface GetValuesResponse {
        range: string;
        majorDimension?: 'ROWS' | 'COLUMNS';
        values?: string[][];
      }

      const data = await response.json() as GetValuesResponse;

      return {
        range: data.range,
        values: data.values || [],
        majorDimension: data.majorDimension || 'ROWS',
      };
    }

    // Handle error responses
    // Per Story B3: Include googleStatus and small googleBody snippet (max 400 chars)
    const googleBody = await safeGetResponseText(response);

    throw new SheetsReadError(
      SHEETS_READ_ERROR_CODES.SHEETS_READ_FAILED,
      `Sheets API error: HTTP ${response.status}`,
      {
        googleStatus: response.status,
        googleBody,
      }
    );
  } catch (error) {
    clearTimeout(timeoutId);

    // Re-throw SheetsReadError as-is
    if (error instanceof SheetsReadError) {
      throw error;
    }

    // Handle timeout
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SheetsReadError(
        SHEETS_READ_ERROR_CODES.SHEETS_READ_FAILED,
        `Sheets API request timed out after ${timeoutMs}ms`
      );
    }

    // Handle network errors
    // Per Story B3: Network errors → SHEETS_READ_FAILED with message "fetch failed"
    throw new SheetsReadError(
      SHEETS_READ_ERROR_CODES.SHEETS_READ_FAILED,
      'fetch failed'
    );
  }
}

/**
 * Create a structured error response for sheets read failures
 *
 * Per Story B3: Failures produce deterministic structured errors
 *
 * @param error - SheetsReadError or generic error
 * @param requestId - Request ID for tracing
 * @returns Response with structured JSON error body
 */
export function createSheetsReadErrorResponse(
  error: SheetsReadError | Error,
  requestId: string
): Response {
  const isReadError = error instanceof SheetsReadError;

  const body = {
    ok: false,
    status: 503,
    code: isReadError ? error.code : SHEETS_READ_ERROR_CODES.SHEETS_READ_FAILED,
    error: error.message,
    requestId,
    timestamp: new Date().toISOString(),
    ...(isReadError && error.googleStatus ? { googleStatus: error.googleStatus } : {}),
    ...(isReadError && error.googleBody ? { googleBody: error.googleBody } : {}),
  };

  // Log failure for CI/CD gates (per SDET requirement)
  console.error(JSON.stringify({
    type: 'SHEETS_READ_ERROR',
    code: body.code,
    requestId,
    timestamp: body.timestamp,
    ...(isReadError && error.googleStatus ? { googleStatus: error.googleStatus } : {}),
  }));

  return new Response(JSON.stringify(body), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
    },
  });
}
