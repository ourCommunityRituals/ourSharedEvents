/**
 * Shortlinks API Module - Worker-Native Implementation
 *
 * Story 5.2 - DNS Cutover: Implements shortlink resolution directly
 * via Google Sheets API, eliminating GAS dependency.
 *
 * Shortlink format: /r?t={token} or /redirect?token={token}
 * SHORTLINKS sheet columns: [token, targetUrl, eventId, sponsorId, surface, createdAt, brandId]
 *
 * @module api/shortlinks
 */

import { readRange, appendRows, isConfigured, SheetsError, SHEETS_ERROR_CODES } from '../sheets/client.js';

/**
 * Error codes for shortlink operations
 */
export const SHORTLINK_ERROR_CODES = {
  NOT_FOUND: 'SHORTLINK_NOT_FOUND',
  INVALID_TOKEN: 'SHORTLINK_INVALID_TOKEN',
  INVALID_URL: 'SHORTLINK_INVALID_URL',
  SHEETS_ERROR: 'SHORTLINK_SHEETS_ERROR'
};

/**
 * Handle shortlink redirect request
 *
 * Resolves token from SHORTLINKS sheet and returns redirect response.
 * Records click analytics if ANALYTICS sheet exists.
 *
 * @param {Request} request - Original request
 * @param {URL} url - Parsed request URL
 * @param {Object} env - Worker environment
 * @returns {Promise<Response>} Redirect response or error
 */
export async function handleShortlinkRedirect(request, url, env) {
  const token = url.searchParams.get('t') || url.searchParams.get('token') || '';

  // Validate token
  if (!token || token.length < 4 || token.length > 64) {
    return createShortlinkErrorResponse(
      400,
      SHORTLINK_ERROR_CODES.INVALID_TOKEN,
      'Invalid or missing shortlink token'
    );
  }

  // Check if Sheets is configured
  if (!isConfigured(env)) {
    console.error('[SHORTLINK] Sheets API not configured');
    return createShortlinkErrorResponse(
      503,
      SHORTLINK_ERROR_CODES.SHEETS_ERROR,
      'Shortlink service temporarily unavailable'
    );
  }

  try {
    // Read SHORTLINKS sheet
    // Columns: token | targetUrl | eventId | sponsorId | surface | createdAt | brandId
    const rows = await readRange(env, 'SHORTLINKS!A:G');

    if (!rows || rows.length === 0) {
      console.log('[SHORTLINK] SHORTLINKS sheet is empty');
      return createShortlinkErrorResponse(
        404,
        SHORTLINK_ERROR_CODES.NOT_FOUND,
        'Shortlink not found'
      );
    }

    // Find matching token (skip header row if present)
    const hasHeader = rows[0][0]?.toLowerCase() === 'token';
    const dataRows = hasHeader ? rows.slice(1) : rows;

    const matchingRow = dataRows.find(row => row[0] === token);

    if (!matchingRow) {
      console.log(`[SHORTLINK] Token not found: ${token.slice(0, 8)}...`);
      return createShortlinkErrorResponse(
        404,
        SHORTLINK_ERROR_CODES.NOT_FOUND,
        'Shortlink not found'
      );
    }

    const [, targetUrl, eventId, sponsorId, surface] = matchingRow;

    // Validate target URL
    if (!targetUrl || !isValidUrl(targetUrl)) {
      console.error(`[SHORTLINK] Invalid target URL for token ${token.slice(0, 8)}: ${targetUrl?.slice(0, 50)}`);
      return createShortlinkErrorResponse(
        500,
        SHORTLINK_ERROR_CODES.INVALID_URL,
        'Invalid shortlink target'
      );
    }

    // Log successful resolution
    console.log(`[SHORTLINK] Resolved: ${token.slice(0, 8)}... -> ${targetUrl.slice(0, 50)}...`);

    // Record analytics asynchronously (don't block redirect)
    recordShortlinkClick(env, {
      token,
      eventId: eventId || '',
      sponsorId: sponsorId || '',
      surface: surface || 'shortlink',
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get('user-agent') || '',
      referer: request.headers.get('referer') || ''
    }).catch(err => {
      console.error('[SHORTLINK] Analytics error:', err.message);
    });

    // Return redirect response
    return new Response(null, {
      status: 302,
      headers: {
        'Location': targetUrl,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Proxied-By': 'zeventbooks-worker',
        'X-Shortlink-Token': token.slice(0, 8) + '...'
      }
    });

  } catch (error) {
    console.error('[SHORTLINK] Error resolving shortlink:', error.message);

    if (error instanceof SheetsError) {
      return createShortlinkErrorResponse(
        503,
        SHORTLINK_ERROR_CODES.SHEETS_ERROR,
        'Shortlink service temporarily unavailable'
      );
    }

    return createShortlinkErrorResponse(
      500,
      SHORTLINK_ERROR_CODES.SHEETS_ERROR,
      'Error resolving shortlink'
    );
  }
}

/**
 * Record shortlink click to ANALYTICS sheet
 *
 * @param {Object} env - Worker environment
 * @param {Object} clickData - Click analytics data
 */
async function recordShortlinkClick(env, clickData) {
  try {
    // Append to ANALYTICS sheet
    // Columns match GAS format: timestamp | type | eventId | sponsorId | surface | data
    const row = [
      clickData.timestamp,
      'shortlink_click',
      clickData.eventId,
      clickData.sponsorId,
      clickData.surface,
      JSON.stringify({
        token: clickData.token,
        userAgent: clickData.userAgent?.slice(0, 200),
        referer: clickData.referer?.slice(0, 200)
      })
    ];

    await appendRows(env, 'ANALYTICS!A:F', [row]);
  } catch (error) {
    // Don't throw - analytics is best-effort
    console.warn('[SHORTLINK] Failed to record analytics:', error.message);
  }
}

/**
 * Validate URL format and protocol
 *
 * @param {string} urlString - URL to validate
 * @returns {boolean}
 */
function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    // Only allow http and https protocols
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Create error response for shortlink errors
 *
 * @param {number} status - HTTP status code
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @returns {Response}
 */
function createShortlinkErrorResponse(status, code, message) {
  // For user-facing errors, return a simple HTML page
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Link Not Found - ZEventBooks</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    p { opacity: 0.9; margin-bottom: 1.5rem; }
    a {
      color: white;
      text-decoration: none;
      padding: 0.75rem 1.5rem;
      border: 2px solid white;
      border-radius: 4px;
      transition: all 0.2s;
    }
    a:hover { background: white; color: #667eea; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Link Not Found</h1>
    <p>${status === 404 ? 'This link may have expired or been removed.' : 'Unable to process this link right now.'}</p>
    <a href="https://www.zeventbooks.io">Go to ZEventBooks</a>
  </div>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Error-Code': code,
      'X-Proxied-By': 'zeventbooks-worker',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

/**
 * Check if request is a shortlink request
 *
 * @param {URL} url - Request URL
 * @returns {boolean}
 */
export function isShortlinkRequest(url) {
  const pathname = url.pathname.toLowerCase();
  const p = url.searchParams.get('p')?.toLowerCase();

  // Path-based: /r or /redirect
  if (pathname === '/r' || pathname === '/redirect') {
    return true;
  }

  // Query-based: ?p=r or ?p=redirect (legacy format)
  if (p === 'r' || p === 'redirect') {
    return true;
  }

  return false;
}

export default {
  handleShortlinkRedirect,
  isShortlinkRequest,
  SHORTLINK_ERROR_CODES
};
