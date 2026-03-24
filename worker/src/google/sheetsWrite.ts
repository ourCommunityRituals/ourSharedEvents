/**
 * Google Sheets Write API Client for Cloudflare Workers
 *
 * Provides sheets write operations (append, update) using the service account
 * authentication from Story B1. This module is the canonical way to write to
 * Google Sheets in the Cloudflare Worker.
 *
 * Write Strategy (MVP):
 * - Create event = append row to Events sheet
 * - Update event = find row by id then update range
 *
 * @module google/sheetsWrite
 * @see Story C2 - Sheets Write Client (Append + Update)
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

/**
 * Column index for status field (0-based)
 * Per Story D2: status = active | archived
 */
export const STATUS_COLUMN_INDEX = 7;

/**
 * Column index for isDefault field (0-based)
 * Per Story D3: isDefault = true | false
 * Column I = index 8
 */
export const IS_DEFAULT_COLUMN_INDEX = 8;

/**
 * Column index for brand field (0-based)
 * Column B = index 1
 */
export const BRAND_COLUMN_INDEX = 1;

/** Valid status values */
export const EVENT_STATUS = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
} as const;

export type EventStatus = typeof EVENT_STATUS[keyof typeof EVENT_STATUS];

// =============================================================================
// Error Codes (Story C2)
// =============================================================================

/**
 * Sheets write error codes per Story C2 acceptance criteria
 */
export const SHEETS_WRITE_ERROR_CODES = {
  /** Append operation failed */
  SHEETS_APPEND_FAILED: 'SHEETS_APPEND_FAILED',
  /** Update operation failed */
  SHEETS_UPDATE_FAILED: 'SHEETS_UPDATE_FAILED',
  /** Event not found for update (404 case) */
  SHEETS_EVENT_NOT_FOUND: 'SHEETS_EVENT_NOT_FOUND',
} as const;

export type SheetsWriteErrorCode = typeof SHEETS_WRITE_ERROR_CODES[keyof typeof SHEETS_WRITE_ERROR_CODES];

// =============================================================================
// Types
// =============================================================================

/**
 * Worker environment bindings for Sheets API write access
 */
export interface SheetsWriteEnv extends GoogleServiceAccountEnv {
  /** Google Sheets spreadsheet ID */
  SHEETS_SPREADSHEET_ID?: string;
}

/**
 * Custom error class for Sheets write failures
 *
 * Per Story C2: Structured errors with code, googleStatus, and googleBody snippet
 */
export class SheetsWriteError extends Error {
  readonly code: SheetsWriteErrorCode;
  /** HTTP status from Google Sheets API */
  readonly googleStatus?: number;
  /** Truncated snippet of Google API response body (max 400 chars) */
  readonly googleBody?: string;

  constructor(
    code: SheetsWriteErrorCode,
    message: string,
    options?: {
      googleStatus?: number;
      googleBody?: string;
    }
  ) {
    super(message);
    this.name = 'SheetsWriteError';
    this.code = code;
    this.googleStatus = options?.googleStatus;
    // Per Backend Architect spec: never dump full Google responses (max 400 chars)
    this.googleBody = options?.googleBody
      ? truncateSnippet(options.googleBody, MAX_GOOGLE_BODY_SNIPPET_LENGTH)
      : undefined;
  }
}

/**
 * Minimal event shape per Backend Architect spec
 *
 * Required: id, name
 * Optional: startDateISO, slug, brand
 */
export interface MinimalEventShape {
  /** Unique event ID (required) */
  id: string;
  /** Event name (required) */
  name: string;
  /** Event start date in ISO format (optional) */
  startDateISO?: string;
  /** URL-friendly slug (optional) */
  slug?: string;
  /** Brand identifier (optional) */
  brand?: string;
}

/**
 * Options for sheetsAppendValues
 */
export interface SheetsAppendOptions {
  /** How input data should be interpreted (default: USER_ENTERED) */
  valueInputOption?: 'RAW' | 'USER_ENTERED';
  /** How to insert new rows (default: INSERT_ROWS) */
  insertDataOption?: 'OVERWRITE' | 'INSERT_ROWS';
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
}

/**
 * Options for sheetsUpdateValues
 */
export interface SheetsUpdateOptions {
  /** How input data should be interpreted (default: USER_ENTERED) */
  valueInputOption?: 'RAW' | 'USER_ENTERED';
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
}

/**
 * Result from sheetsAppendValues
 */
export interface SheetsAppendResult {
  /** The spreadsheet ID */
  spreadsheetId: string;
  /** The range where data was appended */
  tableRange: string;
  /** Number of rows updated */
  updatedRows: number;
  /** Number of columns updated */
  updatedColumns: number;
  /** Number of cells updated */
  updatedCells: number;
  /** The range that was updated */
  updatedRange: string;
}

/**
 * Result from sheetsUpdateValues
 */
export interface SheetsUpdateResult {
  /** The spreadsheet ID */
  spreadsheetId: string;
  /** The range that was updated */
  updatedRange: string;
  /** Number of rows updated */
  updatedRows: number;
  /** Number of columns updated */
  updatedColumns: number;
  /** Number of cells updated */
  updatedCells: number;
}

/**
 * Result from finding an event row
 */
export interface FindEventRowResult {
  /** Whether the event was found */
  found: boolean;
  /** Row number (1-indexed, for A1 notation) */
  rowNumber?: number;
  /** Current row data */
  rowData?: string[];
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
// ID Generation (Story C2)
// =============================================================================

/**
 * Generate a UUID v4 compliant identifier
 *
 * Uses crypto.randomUUID() when available (Cloudflare Workers support),
 * falls back to a manual implementation for compatibility.
 *
 * @returns UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function generateUUID(): string {
  // Use native crypto.randomUUID() if available (Cloudflare Workers)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback: manual UUID v4 generation
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Set version (4) and variant (10xx) bits per RFC 4122
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generate a short ID (more compact alternative to UUID)
 *
 * Format: {timestamp36}-{random6}
 * Example: "m5abc123-x7y8z9"
 *
 * @param prefix - Optional prefix (e.g., "evt" for "evt-m5abc123-x7y8z9")
 * @returns Short ID string
 */
export function generateShortId(prefix?: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  const id = `${timestamp}-${random}`;
  return prefix ? `${prefix}-${id}` : id;
}

// =============================================================================
// Public API - Append
// =============================================================================

/**
 * Append values to a Google Sheets range (adds new rows)
 *
 * Per Story C2: Create event = append row to Events sheet
 *
 * @param env - Worker environment with Google credentials
 * @param spreadsheetId - Google Sheets spreadsheet ID
 * @param rangeA1 - A1 notation range (e.g., 'EVENTS!A:G' or 'Sheet1!A1')
 * @param values - 2D array of values to append
 * @param options - Optional append options
 * @returns SheetsAppendResult with updated range info
 * @throws {SheetsWriteError} If the append fails (with code SHEETS_APPEND_FAILED)
 *
 * @example
 * // Append a new event row
 * const result = await sheetsAppendValues(env, spreadsheetId, 'EVENTS!A:G', [
 *   ['evt-123', 'abc', null, '{"name":"Test Event"}', '2025-01-01', 'test-event', '2025-01-01']
 * ]);
 */
export async function sheetsAppendValues(
  env: SheetsWriteEnv,
  spreadsheetId: string,
  rangeA1: string,
  values: (string | number | boolean | null)[][],
  options: SheetsAppendOptions = {}
): Promise<SheetsAppendResult> {
  // Validate spreadsheet ID is provided
  if (!spreadsheetId) {
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_APPEND_FAILED,
      'spreadsheetId is required'
    );
  }

  // Validate values
  if (!values || values.length === 0) {
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_APPEND_FAILED,
      'Values array cannot be empty'
    );
  }

  // Get access token (this handles auth validation internally)
  let accessToken: string;
  try {
    const tokenResult = await getGoogleAccessToken(env);
    accessToken = tokenResult.accessToken;
  } catch (error) {
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_APPEND_FAILED,
      `Failed to get access token: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Build the URL with proper encoding
  const encodedRange = encodeURIComponent(rangeA1);
  const params = new URLSearchParams({
    valueInputOption: options.valueInputOption || 'USER_ENTERED',
    insertDataOption: options.insertDataOption || 'INSERT_ROWS',
  });

  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodedRange}:append?${params}`;

  // Set up timeout
  const timeoutMs = options.timeoutMs ?? SHEETS_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        values,
        majorDimension: 'ROWS',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      interface AppendResponse {
        spreadsheetId: string;
        tableRange?: string;
        updates?: {
          spreadsheetId: string;
          updatedRange: string;
          updatedRows: number;
          updatedColumns: number;
          updatedCells: number;
        };
      }

      const data = await response.json() as AppendResponse;

      return {
        spreadsheetId: data.spreadsheetId,
        tableRange: data.tableRange || '',
        updatedRows: data.updates?.updatedRows || 0,
        updatedColumns: data.updates?.updatedColumns || 0,
        updatedCells: data.updates?.updatedCells || 0,
        updatedRange: data.updates?.updatedRange || '',
      };
    }

    // Handle error responses
    const googleBody = await safeGetResponseText(response);

    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_APPEND_FAILED,
      `Sheets API append error: HTTP ${response.status}`,
      {
        googleStatus: response.status,
        googleBody,
      }
    );
  } catch (error) {
    clearTimeout(timeoutId);

    // Re-throw SheetsWriteError as-is
    if (error instanceof SheetsWriteError) {
      throw error;
    }

    // Handle timeout
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SheetsWriteError(
        SHEETS_WRITE_ERROR_CODES.SHEETS_APPEND_FAILED,
        `Sheets API append request timed out after ${timeoutMs}ms`
      );
    }

    // Handle network errors
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_APPEND_FAILED,
      `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// =============================================================================
// Public API - Update
// =============================================================================

/**
 * Update values in a specific Google Sheets range
 *
 * Per Story C2: Update event = find row by id then update range
 *
 * @param env - Worker environment with Google credentials
 * @param spreadsheetId - Google Sheets spreadsheet ID
 * @param rangeA1 - A1 notation range to update (e.g., 'EVENTS!A5:G5')
 * @param values - 2D array of values to write
 * @param options - Optional update options
 * @returns SheetsUpdateResult with updated range info
 * @throws {SheetsWriteError} If the update fails (with code SHEETS_UPDATE_FAILED)
 *
 * @example
 * // Update a specific row
 * const result = await sheetsUpdateValues(env, spreadsheetId, 'EVENTS!A5:G5', [
 *   ['evt-123', 'abc', null, '{"name":"Updated Event"}', '2025-01-01', 'test-event', '2025-01-02']
 * ]);
 */
export async function sheetsUpdateValues(
  env: SheetsWriteEnv,
  spreadsheetId: string,
  rangeA1: string,
  values: (string | number | boolean | null)[][],
  options: SheetsUpdateOptions = {}
): Promise<SheetsUpdateResult> {
  // Validate spreadsheet ID is provided
  if (!spreadsheetId) {
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
      'spreadsheetId is required'
    );
  }

  // Validate values
  if (!values || values.length === 0) {
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
      'Values array cannot be empty'
    );
  }

  // Get access token (this handles auth validation internally)
  let accessToken: string;
  try {
    const tokenResult = await getGoogleAccessToken(env);
    accessToken = tokenResult.accessToken;
  } catch (error) {
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
      `Failed to get access token: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Build the URL with proper encoding
  const encodedRange = encodeURIComponent(rangeA1);
  const params = new URLSearchParams({
    valueInputOption: options.valueInputOption || 'USER_ENTERED',
  });

  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodedRange}?${params}`;

  // Set up timeout
  const timeoutMs = options.timeoutMs ?? SHEETS_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        values,
        majorDimension: 'ROWS',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      interface UpdateResponse {
        spreadsheetId: string;
        updatedRange: string;
        updatedRows: number;
        updatedColumns: number;
        updatedCells: number;
      }

      const data = await response.json() as UpdateResponse;

      return {
        spreadsheetId: data.spreadsheetId,
        updatedRange: data.updatedRange,
        updatedRows: data.updatedRows || 0,
        updatedColumns: data.updatedColumns || 0,
        updatedCells: data.updatedCells || 0,
      };
    }

    // Handle error responses
    const googleBody = await safeGetResponseText(response);

    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
      `Sheets API update error: HTTP ${response.status}`,
      {
        googleStatus: response.status,
        googleBody,
      }
    );
  } catch (error) {
    clearTimeout(timeoutId);

    // Re-throw SheetsWriteError as-is
    if (error instanceof SheetsWriteError) {
      throw error;
    }

    // Handle timeout
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SheetsWriteError(
        SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
        `Sheets API update request timed out after ${timeoutMs}ms`
      );
    }

    // Handle network errors
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
      `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// =============================================================================
// Public API - Find and Update Event
// =============================================================================

/**
 * Find an event row by ID in a sheet
 *
 * @param env - Worker environment with Google credentials
 * @param spreadsheetId - Google Sheets spreadsheet ID
 * @param sheetName - Name of the sheet (e.g., 'EVENTS')
 * @param eventId - Event ID to find
 * @param idColumnIndex - Column index where IDs are stored (0-based, default: 0)
 * @returns FindEventRowResult with row number if found
 * @throws {SheetsWriteError} If the read operation fails
 */
export async function findEventRowById(
  env: SheetsWriteEnv,
  spreadsheetId: string,
  sheetName: string,
  eventId: string,
  idColumnIndex: number = 0
): Promise<FindEventRowResult> {
  // Validate spreadsheet ID is provided
  if (!spreadsheetId) {
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
      'spreadsheetId is required'
    );
  }

  // Get access token
  let accessToken: string;
  try {
    const tokenResult = await getGoogleAccessToken(env);
    accessToken = tokenResult.accessToken;
  } catch (error) {
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
      `Failed to get access token: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Read all rows from the sheet to find the event
  const range = encodeURIComponent(`${sheetName}!A:Z`);
  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${range}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SHEETS_REQUEST_TIMEOUT_MS);

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

    if (!response.ok) {
      const googleBody = await safeGetResponseText(response);
      throw new SheetsWriteError(
        SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
        `Failed to read sheet for event lookup: HTTP ${response.status}`,
        {
          googleStatus: response.status,
          googleBody,
        }
      );
    }

    interface GetValuesResponse {
      values?: string[][];
    }

    const data = await response.json() as GetValuesResponse;
    const rows = data.values || [];

    // Search for the event by ID (skip header row)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[idColumnIndex] === eventId) {
        return {
          found: true,
          rowNumber: i + 1, // Convert to 1-indexed for A1 notation
          rowData: row,
        };
      }
    }

    return { found: false };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof SheetsWriteError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new SheetsWriteError(
        SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
        `Sheet read request timed out after ${SHEETS_REQUEST_TIMEOUT_MS}ms`
      );
    }

    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
      `Network error during event lookup: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Update an event by ID (find row, then update)
 *
 * Per Story C2: Update event = find row by id then update range
 *
 * @param env - Worker environment with Google credentials
 * @param spreadsheetId - Google Sheets spreadsheet ID
 * @param sheetName - Name of the sheet (e.g., 'EVENTS')
 * @param eventId - Event ID to update
 * @param values - New row values
 * @param options - Optional update options
 * @returns SheetsUpdateResult with updated range info
 * @throws {SheetsWriteError} With code SHEETS_EVENT_NOT_FOUND if event doesn't exist
 * @throws {SheetsWriteError} With code SHEETS_UPDATE_FAILED if update fails
 *
 * @example
 * // Update an event by ID
 * const result = await updateEventById(env, spreadsheetId, 'EVENTS', 'evt-123', [
 *   ['evt-123', 'abc', null, '{"name":"Updated Event"}', '2025-01-01', 'test-event', '2025-01-02']
 * ]);
 */
export async function updateEventById(
  env: SheetsWriteEnv,
  spreadsheetId: string,
  sheetName: string,
  eventId: string,
  values: (string | number | boolean | null)[][],
  options: SheetsUpdateOptions = {}
): Promise<SheetsUpdateResult> {
  // Find the event row
  const findResult = await findEventRowById(env, spreadsheetId, sheetName, eventId);

  if (!findResult.found || !findResult.rowNumber) {
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_EVENT_NOT_FOUND,
      `Event with ID '${eventId}' not found in sheet '${sheetName}'`
    );
  }

  // Calculate the range for this row
  // Determine number of columns from values
  const numColumns = values[0]?.length || 7;
  const endColumn = String.fromCharCode('A'.charCodeAt(0) + numColumns - 1);
  const range = `${sheetName}!A${findResult.rowNumber}:${endColumn}${findResult.rowNumber}`;

  // Update the row
  return sheetsUpdateValues(env, spreadsheetId, range, values, options);
}

// =============================================================================
// Public API - Update Event Status
// =============================================================================

/**
 * Update an event's status column by ID
 *
 * Per Story D2: Archive/Unarchive sets status = active | archived
 *
 * @param env - Worker environment with Google credentials
 * @param spreadsheetId - Google Sheets spreadsheet ID
 * @param sheetName - Name of the sheet (e.g., 'EVENTS')
 * @param eventId - Event ID to update
 * @param status - New status ('active' or 'archived')
 * @returns SheetsUpdateResult with updated range info
 * @throws {SheetsWriteError} With code SHEETS_EVENT_NOT_FOUND if event doesn't exist
 * @throws {SheetsWriteError} With code SHEETS_UPDATE_FAILED if update fails
 */
export async function updateEventStatus(
  env: SheetsWriteEnv,
  spreadsheetId: string,
  sheetName: string,
  eventId: string,
  status: EventStatus
): Promise<{ rowNumber: number; result: SheetsUpdateResult }> {
  // Find the event row
  const findResult = await findEventRowById(env, spreadsheetId, sheetName, eventId);

  if (!findResult.found || !findResult.rowNumber) {
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_EVENT_NOT_FOUND,
      `Event with ID '${eventId}' not found in sheet '${sheetName}'`
    );
  }

  // Update only column H (status column, index 7 = column H)
  // A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7
  const range = `${sheetName}!H${findResult.rowNumber}`;

  const result = await sheetsUpdateValues(env, spreadsheetId, range, [[status]]);

  return { rowNumber: findResult.rowNumber, result };
}

/**
 * Get an event's current status by ID
 *
 * @param env - Worker environment with Google credentials
 * @param spreadsheetId - Google Sheets spreadsheet ID
 * @param sheetName - Name of the sheet (e.g., 'EVENTS')
 * @param eventId - Event ID to find
 * @returns Current status or 'active' if not set
 */
export async function getEventStatus(
  env: SheetsWriteEnv,
  spreadsheetId: string,
  sheetName: string,
  eventId: string
): Promise<EventStatus> {
  const findResult = await findEventRowById(env, spreadsheetId, sheetName, eventId);

  if (!findResult.found || !findResult.rowData) {
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_EVENT_NOT_FOUND,
      `Event with ID '${eventId}' not found in sheet '${sheetName}'`
    );
  }

  // Column H is index 7
  const status = findResult.rowData[STATUS_COLUMN_INDEX];

  // Default to 'active' if not set
  if (!status || (status !== EVENT_STATUS.ACTIVE && status !== EVENT_STATUS.ARCHIVED)) {
    return EVENT_STATUS.ACTIVE;
  }

  return status as EventStatus;
}

// =============================================================================
// Public API - Set Default Event (Story D3)
// =============================================================================

/**
 * Result from setting an event as default
 */
export interface SetDefaultEventResult {
  /** Event ID that was set as default */
  eventId: string;
  /** Brand ID */
  brand: string;
  /** IDs of events that were unset as default */
  previousDefaults: string[];
  /** Row number of the target event */
  rowNumber: number;
}

/**
 * Set an event as the default for its brand
 *
 * Per Story D3 - Default Event Enforcement:
 * - Exactly ONE default event per brand
 * - Find all events for brand
 * - Unset existing defaults
 * - Set target event as default
 * - Ensure no double-default state possible
 *
 * @param env - Worker environment with Google credentials
 * @param spreadsheetId - Google Sheets spreadsheet ID
 * @param sheetName - Name of the sheet (e.g., 'EVENTS')
 * @param eventId - Event ID to set as default
 * @returns SetDefaultEventResult with operation details
 * @throws {SheetsWriteError} With code SHEETS_EVENT_NOT_FOUND if event doesn't exist
 * @throws {SheetsWriteError} With code SHEETS_UPDATE_FAILED if update fails
 */
export async function setEventAsDefault(
  env: SheetsWriteEnv,
  spreadsheetId: string,
  sheetName: string,
  eventId: string
): Promise<SetDefaultEventResult> {
  // Validate spreadsheet ID is provided
  if (!spreadsheetId) {
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
      'spreadsheetId is required'
    );
  }

  // Get access token
  let accessToken: string;
  try {
    const tokenResult = await getGoogleAccessToken(env);
    accessToken = tokenResult.accessToken;
  } catch (error) {
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
      `Failed to get access token: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Read all rows from the sheet
  const range = encodeURIComponent(`${sheetName}!A:Z`);
  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${range}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SHEETS_REQUEST_TIMEOUT_MS);

  let rows: string[][];

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

    if (!response.ok) {
      const googleBody = await safeGetResponseText(response);
      throw new SheetsWriteError(
        SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
        `Failed to read sheet for default event operation: HTTP ${response.status}`,
        {
          googleStatus: response.status,
          googleBody,
        }
      );
    }

    interface GetValuesResponse {
      values?: string[][];
    }

    const data = await response.json() as GetValuesResponse;
    rows = data.values || [];
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof SheetsWriteError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new SheetsWriteError(
        SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
        `Sheet read request timed out after ${SHEETS_REQUEST_TIMEOUT_MS}ms`
      );
    }

    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
      `Network error during default event lookup: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Find the target event and its brand, and collect previous defaults for same brand
  let targetRowNumber: number | undefined;
  let targetBrand: string | undefined;
  const previousDefaults: Array<{ id: string; rowNumber: number }> = [];

  // Skip header row (i = 0)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const rowId = row[0]; // Column A = ID
    const rowBrand = row[BRAND_COLUMN_INDEX]; // Column B = brand

    if (rowId === eventId) {
      targetRowNumber = i + 1; // Convert to 1-indexed for A1 notation
      targetBrand = rowBrand || 'root';
    }
  }

  // If target event not found, throw error
  if (!targetRowNumber || !targetBrand) {
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_EVENT_NOT_FOUND,
      `Event with ID '${eventId}' not found in sheet '${sheetName}'`
    );
  }

  // Now find all events for the same brand that are currently default
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const rowId = row[0];
    const rowBrand = row[BRAND_COLUMN_INDEX] || 'root';
    const isDefault = row[IS_DEFAULT_COLUMN_INDEX];

    // Skip the target event (we'll set it separately)
    if (rowId === eventId) continue;

    // Check if this event is for the same brand and is currently default
    if (rowBrand === targetBrand && isDefault === 'true') {
      previousDefaults.push({ id: rowId, rowNumber: i + 1 });
    }
  }

  // Unset existing defaults first, then set the new default
  // This ensures atomicity - if any operation fails, we stop
  // Note: Google Sheets API doesn't support true transactions, but we do our best

  // Unset previous defaults (set isDefault = 'false')
  for (const prev of previousDefaults) {
    const unsetRange = `${sheetName}!I${prev.rowNumber}`;
    await sheetsUpdateValues(env, spreadsheetId, unsetRange, [['false']]);
  }

  // Set the target event as default (set isDefault = 'true')
  const setRange = `${sheetName}!I${targetRowNumber}`;
  await sheetsUpdateValues(env, spreadsheetId, setRange, [['true']]);

  return {
    eventId,
    brand: targetBrand,
    previousDefaults: previousDefaults.map(p => p.id),
    rowNumber: targetRowNumber,
  };
}

/**
 * Get an event's current isDefault value by ID
 *
 * @param env - Worker environment with Google credentials
 * @param spreadsheetId - Google Sheets spreadsheet ID
 * @param sheetName - Name of the sheet (e.g., 'EVENTS')
 * @param eventId - Event ID to find
 * @returns Current isDefault value or false if not set
 */
export async function getEventIsDefault(
  env: SheetsWriteEnv,
  spreadsheetId: string,
  sheetName: string,
  eventId: string
): Promise<boolean> {
  const findResult = await findEventRowById(env, spreadsheetId, sheetName, eventId);

  if (!findResult.found || !findResult.rowData) {
    throw new SheetsWriteError(
      SHEETS_WRITE_ERROR_CODES.SHEETS_EVENT_NOT_FOUND,
      `Event with ID '${eventId}' not found in sheet '${sheetName}'`
    );
  }

  // Column I is index 8
  const isDefault = findResult.rowData[IS_DEFAULT_COLUMN_INDEX];

  return isDefault === 'true';
}

// =============================================================================
// Error Response Helper
// =============================================================================

/**
 * Create a structured error response for sheets write failures
 *
 * Per Story C2: Failures produce deterministic structured errors
 *
 * @param error - SheetsWriteError or generic error
 * @param requestId - Request ID for tracing
 * @returns Response with structured JSON error body
 */
export function createSheetsWriteErrorResponse(
  error: SheetsWriteError | Error,
  requestId: string
): Response {
  const isWriteError = error instanceof SheetsWriteError;

  // Determine appropriate HTTP status
  let httpStatus = 503;
  if (isWriteError && error.code === SHEETS_WRITE_ERROR_CODES.SHEETS_EVENT_NOT_FOUND) {
    httpStatus = 404;
  }

  const body = {
    ok: false,
    status: httpStatus,
    code: isWriteError ? error.code : SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED,
    error: error.message,
    requestId,
    timestamp: new Date().toISOString(),
    ...(isWriteError && error.googleStatus ? { googleStatus: error.googleStatus } : {}),
    ...(isWriteError && error.googleBody ? { googleBody: error.googleBody } : {}),
  };

  // Log failure for CI/CD gates (per SDET requirement)
  console.error(JSON.stringify({
    type: 'SHEETS_WRITE_ERROR',
    code: body.code,
    requestId,
    timestamp: body.timestamp,
    ...(isWriteError && error.googleStatus ? { googleStatus: error.googleStatus } : {}),
  }));

  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
    },
  });
}
