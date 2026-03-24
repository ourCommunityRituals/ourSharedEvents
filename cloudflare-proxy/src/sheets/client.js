/**
 * Google Sheets API Client
 *
 * Low-level client for reading/writing Google Sheets data.
 * Uses service account authentication via JWT.
 *
 * Required secrets:
 * - GOOGLE_CLIENT_EMAIL
 * - GOOGLE_PRIVATE_KEY
 * - SHEETS_SPREADSHEET_ID
 */

import { getAccessToken, hasCredentials } from './auth.js';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Error codes for Sheets API operations
 */
export const SHEETS_ERROR_CODES = {
  NOT_CONFIGURED: 'SHEETS_NOT_CONFIGURED',
  AUTH_FAILED: 'SHEETS_AUTH_FAILED',
  NOT_FOUND: 'SHEETS_NOT_FOUND',
  RATE_LIMITED: 'SHEETS_RATE_LIMITED',
  API_ERROR: 'SHEETS_API_ERROR'
};

/**
 * SheetsError class for typed error handling
 */
export class SheetsError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'SheetsError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Check if Sheets API is configured
 * @param {Object} env - Worker environment
 * @returns {boolean}
 */
export function isConfigured(env) {
  return hasCredentials(env) && !!env.SHEETS_SPREADSHEET_ID;
}

// Alias for backward compatibility with worker.js import
export const isSheetsConfigured = isConfigured;

/**
 * Get spreadsheet ID from environment
 * @param {Object} env - Worker environment
 * @param {string} [brandId] - Optional brand ID for multi-tenant
 * @returns {string}
 */
function getSpreadsheetId(env, brandId = null) {
  // Future: Support per-brand spreadsheets
  // const brandKey = `SHEETS_SPREADSHEET_ID_${brandId?.toUpperCase()}`;
  // if (brandId && env[brandKey]) return env[brandKey];
  return env.SHEETS_SPREADSHEET_ID;
}

/**
 * Make an authenticated request to Google Sheets API
 * @param {Object} env - Worker environment
 * @param {string} endpoint - API endpoint path
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>}
 */
async function sheetsRequest(env, endpoint, options = {}) {
  if (!isConfigured(env)) {
    throw new SheetsError(
      SHEETS_ERROR_CODES.NOT_CONFIGURED,
      'Google Sheets API not configured. Set GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, and SHEETS_SPREADSHEET_ID secrets.'
    );
  }

  const accessToken = await getAccessToken(env);
  const url = `${SHEETS_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  return response;
}

/**
 * Parse Sheets API error response
 * @param {Response} response - Fetch response
 * @returns {Promise<SheetsError>}
 */
async function parseError(response) {
  let errorDetails;
  try {
    errorDetails = await response.json();
  } catch {
    errorDetails = { message: await response.text() };
  }

  if (response.status === 401 || response.status === 403) {
    return new SheetsError(
      SHEETS_ERROR_CODES.AUTH_FAILED,
      'Google Sheets API authentication failed',
      errorDetails
    );
  }

  if (response.status === 404) {
    return new SheetsError(
      SHEETS_ERROR_CODES.NOT_FOUND,
      'Spreadsheet or sheet not found',
      errorDetails
    );
  }

  if (response.status === 429) {
    return new SheetsError(
      SHEETS_ERROR_CODES.RATE_LIMITED,
      'Google Sheets API rate limit exceeded',
      errorDetails
    );
  }

  return new SheetsError(
    SHEETS_ERROR_CODES.API_ERROR,
    `Google Sheets API error: ${response.status}`,
    errorDetails
  );
}

/**
 * Read values from a sheet range
 *
 * @param {Object} env - Worker environment
 * @param {string} range - A1 notation range (e.g., 'EVENTS!A:Z')
 * @param {Object} options - Options
 * @param {string} [options.valueRenderOption] - How to render values (FORMATTED_VALUE, UNFORMATTED_VALUE, FORMULA)
 * @param {string} [options.dateTimeRenderOption] - How to render dates (SERIAL_NUMBER, FORMATTED_STRING)
 * @returns {Promise<string[][]>} 2D array of values
 */
export async function readRange(env, range, options = {}) {
  const spreadsheetId = getSpreadsheetId(env);
  const params = new URLSearchParams();

  if (options.valueRenderOption) {
    params.set('valueRenderOption', options.valueRenderOption);
  }
  if (options.dateTimeRenderOption) {
    params.set('dateTimeRenderOption', options.dateTimeRenderOption);
  }

  const endpoint = `/${spreadsheetId}/values/${encodeURIComponent(range)}?${params}`;
  const response = await sheetsRequest(env, endpoint, { method: 'GET' });

  if (!response.ok) {
    throw await parseError(response);
  }

  const data = await response.json();
  return data.values || [];
}

/**
 * Write values to a sheet range
 *
 * @param {Object} env - Worker environment
 * @param {string} range - A1 notation range
 * @param {string[][]} values - 2D array of values to write
 * @param {Object} options - Options
 * @param {string} [options.valueInputOption] - How to interpret input (RAW, USER_ENTERED)
 * @returns {Promise<Object>} Update response
 */
export async function writeRange(env, range, values, options = {}) {
  const spreadsheetId = getSpreadsheetId(env);
  const valueInputOption = options.valueInputOption || 'RAW';

  const endpoint = `/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`;
  const response = await sheetsRequest(env, endpoint, {
    method: 'PUT',
    body: JSON.stringify({ values })
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json();
}

/**
 * Append rows to a sheet
 *
 * @param {Object} env - Worker environment
 * @param {string} range - A1 notation range (e.g., 'EVENTS!A:Z')
 * @param {string[][]} values - 2D array of rows to append
 * @param {Object} options - Options
 * @param {string} [options.valueInputOption] - How to interpret input (RAW, USER_ENTERED)
 * @param {string} [options.insertDataOption] - Where to insert (OVERWRITE, INSERT_ROWS)
 * @returns {Promise<Object>} Append response
 */
export async function appendRows(env, range, values, options = {}) {
  const spreadsheetId = getSpreadsheetId(env);
  const params = new URLSearchParams({
    valueInputOption: options.valueInputOption || 'RAW',
    insertDataOption: options.insertDataOption || 'INSERT_ROWS'
  });

  const endpoint = `/${spreadsheetId}/values/${encodeURIComponent(range)}:append?${params}`;
  const response = await sheetsRequest(env, endpoint, {
    method: 'POST',
    body: JSON.stringify({ values })
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json();
}

/**
 * Get spreadsheet metadata (sheets, properties)
 *
 * @param {Object} env - Worker environment
 * @returns {Promise<Object>} Spreadsheet metadata
 */
export async function getSpreadsheetMetadata(env) {
  const spreadsheetId = getSpreadsheetId(env);
  const endpoint = `/${spreadsheetId}?fields=spreadsheetId,properties,sheets.properties`;

  const response = await sheetsRequest(env, endpoint, { method: 'GET' });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json();
}

/**
 * Batch read multiple ranges
 *
 * @param {Object} env - Worker environment
 * @param {string[]} ranges - Array of A1 notation ranges
 * @param {Object} options - Options
 * @returns {Promise<Object[]>} Array of range results
 */
export async function batchRead(env, ranges, options = {}) {
  const spreadsheetId = getSpreadsheetId(env);
  const params = new URLSearchParams();

  ranges.forEach(range => params.append('ranges', range));

  if (options.valueRenderOption) {
    params.set('valueRenderOption', options.valueRenderOption);
  }

  const endpoint = `/${spreadsheetId}/values:batchGet?${params}`;
  const response = await sheetsRequest(env, endpoint, { method: 'GET' });

  if (!response.ok) {
    throw await parseError(response);
  }

  const data = await response.json();
  return data.valueRanges || [];
}

/**
 * Health check - test connection to Sheets API
 *
 * @param {Object} env - Worker environment
 * @returns {Promise<{connected: boolean, latencyMs: number, error?: string}>}
 */
export async function healthCheck(env) {
  const startTime = Date.now();

  try {
    if (!isConfigured(env)) {
      return {
        connected: false,
        latencyMs: 0,
        error: 'Not configured'
      };
    }

    // Just fetch metadata to verify connection
    await getSpreadsheetMetadata(env);

    return {
      connected: true,
      latencyMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      connected: false,
      latencyMs: Date.now() - startTime,
      error: error.message
    };
  }
}
