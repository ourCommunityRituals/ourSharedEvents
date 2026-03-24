// === Zeventbook Production-Grade Backend ===
// Build: triangle-prod-v1.2
//
// =============================================================================
// TABLE OF CONTENTS - Section Index
// =============================================================================
// Navigate this file using [Sxx] section markers:
//
// [S00] FILE HEADER & API INVENTORY .......................... (this section)
// [S01] CONSTANTS & ERROR HANDLING ........................... ERR, Ok, Err, CorrId
// [S02] SCHEMA VALIDATION .................................... schemaCheck, SC_* contracts
// [S03] LOGGING & DIAGNOSTICS ................................ diag_, runSafe, _logError_
// [S04] CSRF PROTECTION ...................................... generateCSRFToken_, validateCSRFToken_
// [S05] ROUTER (doGet) ....................................... URL routing, page resolution
// [S06] REST API HANDLERS (doPost) ........................... handleRestApiGet_, handleRestApiPost_
// [S07] CORS & JSON RESPONSE ................................. jsonResponse_, origin validation
// [S08] TEMPLATE CONTEXT & INCLUDES .......................... include(), global context
// [S09] SHORTLINK HANDLER .................................... handleRedirect_, token resolution
// [S10] AUTHENTICATION ....................................... authenticateRequest_, JWT verification
// [S11] MVP API CONTRACTS .................................... api_generateToken, api_getEventTemplates
// [S12] GUARDS & INPUT VALIDATION ............................ gate_, sanitize*, isUrl
// [S13] SHEET UTILITIES ...................................... getStoreSheet_, _ensure*Sheet_
// [S14] STATUS & SETUP APIs .................................. api_status, api_setupCheck
// [S15] HEALTH & CONFIG APIs ................................. api_healthCheck, api_getConfig
// [S16] EVENT CONTRACT HYDRATION ............................. _buildEventContract_, EVENT_DEFAULTS_
// [S17] CONTRACT VALIDATION & LOADERS ........................ validateEventContract_, getEventById_
// [S18] EVENT CRUD ........................................... saveEvent_, generateQRDataUri_
// [S19] READ APIs ............................................ api_list, api_get, api_getPublicBundle
// [S20] BUNDLE APIs .......................................... api_getDisplayBundle, api_getPosterBundle
// [S21] REPORT APIs .......................................... api_getSharedReportBundle, api_getReport
// [S22] WRITE APIs ........................................... api_create, api_updateEventData, api_saveEvent
// [S23] TRACKING APIs ........................................ api_logEvents, api_trackEventMetric
// [S24] SPONSOR ANALYTICS APIs ............................... api_getSponsorAnalytics, api_getSponsorROI
// [S25] SHORTLINKS & FORMS APIs .............................. api_createShortlink, api_createFormFromTemplate
// [S26] V2+ PORTFOLIO APIs ................................... api_getPortfolioSponsorReport
//
// =============================================================================
//
// =============================================================================
// [S00] FILE HEADER & API INVENTORY
// =============================================================================
//
// =============================================================================
// MVP SCOPE LOCK - Focus Group Critical
// =============================================================================
// MVP Surfaces (5 total):
//   ✅ Admin.html        ?page=admin
//   ✅ Public.html       ?page=public
//   ✅ Display.html      ?page=display
//   ✅ Poster.html       ?page=poster
//   ✅ SharedReport.html ?page=report
//
// V2+ Surfaces (NOT in MVP):
//   ❌ Sponsor.html
//   ❌ ApiDocs.html
//   ❌ Diagnostics*.html
//   ❌ Test.html
//   ❌ Signup.html
//   ❌ PlannerCards.html
//   ❌ ConfigHtml.html
//
// Any new surface goes in V2 section by default until explicitly promoted.
// DO NOT add new surfaces without schema review
// =============================================================================
//
// =============================================================================
// PUBLIC API INVENTORY → ApiSchemas.gs
// =============================================================================
// Each api_* function below MUST have a corresponding schema in ApiSchemas.gs.
// See ApiSchemas.gs "RPC ENDPOINT INVENTORY" for the full mapping.
//
// MVP APIs (used by 5 surfaces):
//   api_getEventTemplates   → ApiSchemas.templates.list
//   api_saveEvent           → ApiSchemas.events.saveEvent [CANONICAL write - ZEVENT-003]
//   api_get                 → ApiSchemas.events.get
//   api_list                → ApiSchemas.events.list
//   api_getPublicBundle     → ApiSchemas.bundles.public
//   api_getDisplayBundle    → ApiSchemas.bundles.display
//   api_getPosterBundle     → ApiSchemas.bundles.poster
//   api_getSharedAnalytics  → ApiSchemas.analytics.sharedReport
//   api_createFormFromTemplate → ApiSchemas.forms.createFromTemplate
//   api_generateFormShortlink  → ApiSchemas.forms.generateShortlink
//
// Orphaned (backward compatibility only - ZEVENT-003):
//   api_create              → ApiSchemas.events.create
//   api_updateEventData     → ApiSchemas.events.update
//
// =============================================================================

/**
 * Returns the canonical list of all supported MVP API endpoints.
 * Used for:
 *   - Routing assertions
 *   - Test harness generation
 *   - API contract validation
 *
 * @returns {string[]} Array of MVP API endpoint names
 */
function _listMvpApis_() {
  return [
    'api_getEventTemplates',
    'api_saveEvent',
    'api_get',
    'api_list',
    'api_getPublicBundle',
    'api_getDisplayBundle',
    'api_getPosterBundle',
    'api_getSharedAnalytics'
  ];
}

// =============================================================================
// [S01] CONSTANTS & ERROR HANDLING
// =============================================================================
// Core error codes, response envelopes (Ok/Err), correlation ID generation,
// and structured error logging utilities.
//
// Key exports:
//   ERR                    - Frozen error code constants
//   Ok(value)              - Success envelope factory
//   Err(code, message)     - Error envelope factory
//   generateCorrId_()      - Unique correlation ID for request tracing
//   ErrWithCorrId_()       - Error with automatic logging & corrId
//   UserFriendlyErr_()     - Sanitized user-facing error with corrId
//   HtmlErrorWithCorrId_() - HTML error page with corrId
// =============================================================================

const ERR = Object.freeze({
  BAD_INPUT:   'BAD_INPUT',
  NOT_FOUND:   'NOT_FOUND',
  RATE_LIMITED:'RATE_LIMITED',
  INTERNAL:    'INTERNAL',
  CONTRACT:    'CONTRACT'
});
const Ok  = (value={}) => ({ ok:true,  value });
const Err = (code, message, corrId) => {
  const envelope = { ok:false, code, message: message||code };
  if (corrId) envelope.corrId = corrId;
  return envelope;
};

// =============================================================================
// ENVELOPE BOUNDARY HELPERS (API_CONTRACT.md compliance)
// =============================================================================
// Flat endpoints (status, statusmvp) return data at root level.
// All other endpoints must wrap data in Ok(value) or Err(code, message).
// See API_CONTRACT.md for the canonical contract.
// =============================================================================

/**
 * List of endpoints that return FLAT responses (no envelope wrapper).
 * These endpoints return { ok, buildId, brandId, time, ... } directly.
 * All other endpoints must return envelope format: Ok(value) or Err(code, msg)
 * @constant {string[]}
 * @see API_CONTRACT.md
 */
const FLAT_ENDPOINTS = Object.freeze(['status', 'statusmvp', 'statusPure']);

// Helper to safely check if object has own property (ESLint no-prototype-builtins)
const _hasOwn_ = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);

/**
 * Checks if a response object is envelope-wrapped.
 * Used to detect contract violations where flat endpoints return envelopes.
 * @param {object} response - The response object to check
 * @returns {boolean} True if response has envelope structure (value wrapper)
 */
function isEnvelope_(response) {
  if (!response || typeof response !== 'object') return false;
  if (typeof response.ok !== 'boolean') return false;
  // Success envelope has value property
  if (response.ok === true && _hasOwn_(response, 'value')) return true;
  // Error envelope has code property (flat errors don't have code)
  if (response.ok === false && _hasOwn_(response, 'code')) return true;
  return false;
}

/**
 * Checks if a response object is flat format (for status endpoints).
 * Flat responses have ok, buildId, brandId, time at root level.
 * @param {object} response - The response object to check
 * @returns {boolean} True if response is flat format
 */
function isFlatResponse_(response) {
  if (!response || typeof response !== 'object') return false;
  if (typeof response.ok !== 'boolean') return false;
  // Must NOT have value wrapper
  if (_hasOwn_(response, 'value')) return false;
  // Success flat responses have buildId, brandId, time at root
  if (response.ok === true) {
    return _hasOwn_(response, 'buildId') &&
           _hasOwn_(response, 'brandId') &&
           _hasOwn_(response, 'time');
  }
  // Flat error responses have message and buildId but no code
  return _hasOwn_(response, 'message') && _hasOwn_(response, 'buildId');
}

/**
 * Validates that a flat endpoint response does NOT have envelope wrapper.
 * Throws if the response accidentally wraps data in { ok, value }.
 * @param {string} endpointName - Name of the endpoint (for error message)
 * @param {object} response - The response to validate
 * @throws {Error} If response has envelope structure
 * @see API_CONTRACT.md Rule 1
 */
function assertFlatBoundary_(endpointName, response) {
  if (response && _hasOwn_(response, 'value')) {
    throw new Error(
      `CONTRACT VIOLATION: Flat endpoint '${endpointName}' returned envelope format. ` +
      'Flat endpoints must return data at root level (no value wrapper). ' +
      'See API_CONTRACT.md Rule 1.'
    );
  }
}

/**
 * Validates that an envelope endpoint response HAS the value wrapper.
 * Throws if the response accidentally returns flat data.
 * @param {string} endpointName - Name of the endpoint (for error message)
 * @param {object} response - The response to validate
 * @throws {Error} If response is flat when it should be envelope
 * @see API_CONTRACT.md Rule 2
 */
function assertEnvelopeBoundary_(endpointName, response) {
  if (response && response.ok === true && !response.notModified) {
    if (!_hasOwn_(response, 'value')) {
      throw new Error(
        `CONTRACT VIOLATION: Envelope endpoint '${endpointName}' returned flat data. ` +
        'Use Ok(value) to wrap the response. See API_CONTRACT.md Rule 2.'
      );
    }
    // Additional check: should not have flat endpoint fields at root
    if (_hasOwn_(response, 'buildId') || _hasOwn_(response, 'brandId')) {
      throw new Error(
        `CONTRACT VIOLATION: Envelope endpoint '${endpointName}' has flat fields at root. ` +
        'buildId/brandId should be inside value. See API_CONTRACT.md.'
      );
    }
  }
}

/**
 * Generate a correlation ID for request tracing
 * Format: {endpoint}_{timestamp}_{random}
 * Example: "api_20251128_182310_Z9F7"
 * @param {string} endpoint - Optional endpoint name to include in corrId
 * @returns {string} Unique correlation ID
 */
function generateCorrId_(endpoint) {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const safeEndpoint = (endpoint || 'api').slice(0, 8).replace(/[^a-zA-Z0-9]/g, '');
  return `${safeEndpoint}_${ts}_${rand}`;
}

/**
 * Log a structured error with correlation ID for observability
 * All errors are logged with: timestamp (via diag_), brandId, action, code, message
 *
 * @param {string} level - Log level (error, warn, info)
 * @param {string} corrId - Correlation ID for tracing
 * @param {string} endpoint - API endpoint/function name (action)
 * @param {string} message - Error message
 * @param {string} stack - Error stack trace (optional)
 * @param {string} eventId - Event ID if applicable (optional)
 * @param {object} extra - Additional metadata (optional)
 *   - code: Error code from ERR constants
 *   - brandId: Brand identifier for multi-tenant logging
 */
function logStructuredError_(level, corrId, endpoint, message, stack, eventId, extra = {}) {
  const structured = {
    level: level,
    corrId: corrId,
    action: endpoint, // action = endpoint for API telemetry
    message: message
  };
  // Include error code if provided
  if (extra.code) structured.code = extra.code;
  // Include brandId if provided
  if (extra.brandId) structured.brandId = extra.brandId;
  if (stack) structured.stack = stack;
  if (eventId) structured.eventId = eventId;
  // Copy remaining extra fields (excluding code/brandId already handled)
  const { code: _code, brandId: _brandId, ...rest } = extra;
  if (Object.keys(rest).length > 0) {
    Object.assign(structured, rest);
  }
  diag_(level, endpoint, `[${corrId}] ${message}`, structured);
}

/**
 * Centralized error logging helper for error telemetry
 * Logs: timestamp, brandId, action, code, message (all fields required by observability baseline)
 *
 * @param {object} params - Error parameters
 * @param {string} params.code - Error code from ERR constants (required)
 * @param {string} params.action - API action/endpoint name (required)
 * @param {string} params.message - Human-readable error message (required)
 * @param {string} params.brandId - Brand identifier (optional, defaults to 'unknown')
 * @param {string} params.corrId - Correlation ID (optional, auto-generated if not provided)
 * @param {string} params.stack - Stack trace (optional)
 * @param {string} params.eventId - Event ID (optional)
 * @param {object} params.extra - Additional context (optional)
 */
function logError(params) {
  const {
    code,
    action,
    message,
    brandId = 'unknown',
    corrId,
    stack,
    eventId,
    extra = {}
  } = params;

  // Generate corrId if not provided
  const finalCorrId = corrId || generateCorrId_(action);

  // Build structured log entry with all required telemetry fields
  const structured = {
    timestamp: new Date().toISOString(),
    brandId: brandId,
    action: action,
    code: code,
    message: message,
    corrId: finalCorrId
  };

  if (stack) structured.stack = stack;
  if (eventId) structured.eventId = eventId;
  if (Object.keys(extra).length > 0) {
    Object.assign(structured, extra);
  }

  // Log to DIAG sheet via diag_
  diag_('error', action, `[${finalCorrId}] [${code}] ${message}`, structured);

  return finalCorrId;
}

/**
 * Creates an error response with correlation ID
 * - Logs detailed structured error internally (with stack trace)
 * - Returns sanitized error to client (with corrId, without stack)
 * Logs: timestamp, brandId, action, code, message for telemetry
 *
 * @param {string} code - Error code (ERR.*)
 * @param {string} internalMessage - Detailed internal message (logged, not shown to user)
 * @param {object} options - Options: { stack, eventId, endpoint, brandId, extra }
 * @returns {object} Error envelope with corrId and sanitized message
 */
function ErrWithCorrId_(code, internalMessage, options = {}) {
  const { stack, eventId, endpoint = 'api', brandId, extra = {} } = options;
  const corrId = generateCorrId_(endpoint);

  // Log structured error with full details including code and brandId
  logStructuredError_('error', corrId, endpoint, internalMessage, stack, eventId, {
    ...extra,
    code: code,
    brandId: brandId || extra.brandId || 'unknown'
  });

  // Return sanitized error to client with corrId but no stack
  return Err(code, `Something went wrong. Reference: ${corrId}`, corrId);
}

// Fixed: Bug #48 - Sanitize error messages to prevent information disclosure
/**
 * Creates a user-friendly error response while logging detailed information internally
 * Now includes correlation ID for request tracing (Story 5.1)
 * Logs: timestamp, brandId, action, code, message for telemetry
 *
 * @param {string} code - Error code (ERR.*)
 * @param {string} internalMessage - Detailed internal message (logged, not shown to user)
 * @param {object} logDetails - Additional details to log (stack, eventId, brandId, extra)
 * @param {string} where - Function name for logging context
 * @returns {object} Error envelope with corrId and sanitized message
 */
function UserFriendlyErr_(code, internalMessage, logDetails = {}, where = 'api') {
  const { stack, eventId, brandId, ...extra } = logDetails;
  const corrId = generateCorrId_(where);

  // Log structured error with full details including code and brandId
  logStructuredError_('error', corrId, where, internalMessage, stack, eventId, {
    ...extra,
    code: code,
    brandId: brandId || extra.brandId || 'unknown'
  });

  // Map error codes to generic user-facing messages (with corrId reference)
  const userMessages = {
    'BAD_INPUT': `Invalid request. Reference: ${corrId}`,
    'NOT_FOUND': `The requested resource was not found. Reference: ${corrId}`,
    'UNAUTHORIZED': `Authentication failed. Reference: ${corrId}`,
    'RATE_LIMITED': `Too many requests. Reference: ${corrId}`,
    'INTERNAL': `An internal error occurred. Reference: ${corrId}`,
    'CONTRACT': `An unexpected error occurred. Reference: ${corrId}`
  };

  // Return sanitized error to user with corrId
  const sanitizedMessage = userMessages[code] || `An error occurred. Reference: ${corrId}`;
  return Err(code, sanitizedMessage, corrId);
}

/**
 * Creates an HTML error page with correlation ID for tracing
 * - Logs detailed structured error internally (with stack trace)
 * - Returns user-friendly HTML page with corrId (without stack)
 * Logs: timestamp, brandId, action, code, message for telemetry
 * Story 11: HTML surfaces show generic error with correlation ID
 *
 * @param {string} title - Error title shown to user (e.g., "Invalid shortlink")
 * @param {string} internalMessage - Detailed internal message (logged, not shown)
 * @param {object} options - Options: { code, stack, eventId, endpoint, brandId, extra, spreadsheetId }
 * @returns {HtmlOutput} - HTML page with error message and correlation ID
 */
function HtmlErrorWithCorrId_(title, internalMessage, options = {}) {
  const { code = ERR.INTERNAL, stack, eventId, endpoint = 'html', brandId, extra = {}, spreadsheetId } = options;
  const corrId = generateCorrId_(endpoint);

  // Log structured error with full details including code and brandId
  logStructuredError_('error', corrId, endpoint, internalMessage, stack, eventId, {
    ...extra,
    code: code,
    brandId: brandId || extra.brandId || 'unknown'
  });

  // Also log to DIAG sheet if spreadsheetId is provided
  if (spreadsheetId) {
    diag_('error', endpoint, `[${corrId}] [${code}] ${internalMessage}`, { corrId, code, brandId: brandId || 'unknown', ...extra }, spreadsheetId);
  }

  // Return user-friendly HTML with corrId but no internal details
  const safeTitle = String(title)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return HtmlService.createHtmlOutput(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Error - ${safeTitle}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
        .error-box { background: #fee2e2; border: 1px solid #fca5a5; padding: 30px;
                     border-radius: 8px; }
        h1 { color: #dc2626; margin-bottom: 15px; }
        .message { color: #7f1d1d; margin-bottom: 20px; }
        .reference { background: #f5f5f5; padding: 10px; border-radius: 4px;
                     font-family: monospace; font-size: 14px; color: #666; }
        .help-text { margin-top: 15px; font-size: 13px; color: #888; }
      </style>
    </head>
    <body>
      <div class="error-box">
        <h1>⚠️ ${safeTitle}</h1>
        <p class="message">Something went wrong. Please try again or contact support.</p>
        <div class="reference">Reference: ${corrId}</div>
        <p class="help-text">If you need assistance, please provide this reference code.</p>
      </div>
    </body>
    </html>
  `).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);
}

// =============================================================================
// [S02] SCHEMA VALIDATION
// =============================================================================
// Runtime contract validation for API responses. Ensures responses match
// expected shapes before returning to clients.
//
// Key exports:
//   schemaCheck(schema, obj) - Validate object against schema
//   SC_OK, SC_LIST, SC_GET   - Common response schemas
//   _ensureOk_(label, schema, obj) - Validate and return or wrap error
// =============================================================================

function schemaCheck(schema, obj, where='') {
  if (schema.type === 'object' && obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(schema.props || {})) {
      if (v.required && !(k in obj)) {
        diag_('error', where||'schemaCheck', 'Missing required field', {field: k});
        throw new Error(`Missing required field: ${k}`);
      }
      if (k in obj && v.type && typeof obj[k] !== v.type) {
        diag_('error', where||'schemaCheck', 'Type mismatch', {field: k, expected: v.type, got: typeof obj[k]});
        throw new Error(`Type mismatch for ${k}: expected ${v.type}, got ${typeof obj[k]}`);
      }
    }
  } else if (schema.type === 'array' && Array.isArray(obj)) {
    // Arrays are valid
  } else if (schema.type && typeof obj !== schema.type) {
    diag_('error', where||'schemaCheck', 'Schema type mismatch', {expected: schema.type, got: typeof obj});
    throw new Error(`Schema type mismatch: expected ${schema.type}, got ${typeof obj}`);
  }
  return true;
}

// Response schemas
const SC_OK = {type: 'object', props: {ok: {type: 'boolean', required: true}}};
const SC_LIST = {type: 'object', props: {ok: {type: 'boolean', required: true}, value: {type: 'object'}}};
const SC_GET = {type: 'object', props: {ok: {type: 'boolean', required: true}, value: {type: 'object'}}};
const SC_STATUS = {type: 'object', props: {ok: {type: 'boolean', required: true}, value: {type: 'object'}}};

// Fixed: Bug #26 - Check if obj is error response before schema validation
function _ensureOk_(label, schema, obj) {
  // If already an error envelope, return as-is without validation
  if (obj && obj.ok === false) {
    return obj;
  }

  try {
    schemaCheck(schema, obj, label);
    return obj;
  } catch(e) {
    // Story 5.1 - Structured error logging with correlation ID
    return ErrWithCorrId_(ERR.CONTRACT, `Contract violation in ${label}: ${e.message}`, {
      stack: e && e.stack,
      endpoint: label,
      extra: { error: String(e), obj }
    });
  }
}

// =============================================================================
// [S03] LOGGING & DIAGNOSTICS
// =============================================================================
// Append-only logging to DIAG sheet with automatic cleanup.
// Includes structured error logging to LOG_ERRORS sheet.
//
// Key exports:
//   diag_(level, where, msg, meta)     - Log to DIAG sheet
//   runSafe(where, fn, eventId)        - Execute with error capture
//   _logError_(params)                 - Structured error log to LOG_ERRORS
//   _getErrorLogSheet_(spreadsheetId)  - Get/create LOG_ERRORS sheet
//   _handleRequestSafe_(method, e, fn) - Wrap request with error handling
//
// Configuration:
//   DIAG_MAX = 3000      - Maximum rows in DIAG sheet
//   DIAG_PER_DAY = 800   - Maximum rows per day
//   LOG_ERRORS_MAX = 5000 - Maximum rows in LOG_ERRORS
// =============================================================================

const DIAG_SHEET='DIAG', DIAG_MAX=3000, DIAG_PER_DAY=800;
const LOG_ERRORS_SHEET = 'LOG_ERRORS', LOG_ERRORS_MAX = 5000;

/**
 * Get or create the LOG_ERRORS sheet for structured error logging
 * Columns: ts, corrId, endpoint, method, eventId, errorName, message, stack, params, postData
 * @param {string} spreadsheetId - Optional spreadsheet ID
 * @returns {Sheet} The LOG_ERRORS sheet
 */
function _getErrorLogSheet_(spreadsheetId) {
  let ss;
  if (spreadsheetId) {
    ss = SpreadsheetApp.openById(spreadsheetId);
  } else {
    const rootBrand = findBrand_('root');
    if (rootBrand && rootBrand.store && rootBrand.store.spreadsheetId) {
      ss = SpreadsheetApp.openById(rootBrand.store.spreadsheetId);
    } else {
      ss = SpreadsheetApp.getActive();
    }
  }

  let sh = ss.getSheetByName(LOG_ERRORS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_ERRORS_SHEET);
    sh.appendRow(['ts', 'corrId', 'endpoint', 'method', 'eventId', 'errorName', 'message', 'stack', 'params', 'postData', 'userAgent', 'severity']);
    sh.setFrozenRows(1);
    // Set column widths for readability
    sh.setColumnWidth(1, 180);  // ts
    sh.setColumnWidth(2, 200);  // corrId
    sh.setColumnWidth(3, 120);  // endpoint
    sh.setColumnWidth(7, 300);  // message
    sh.setColumnWidth(8, 400);  // stack
  }
  return sh;
}

/**
 * Story 14: Structured error logging to LOG_ERRORS sheet
 * Logs errors with full context for debugging while keeping user-facing messages safe.
 *
 * @param {object} params - Error details
 * @param {string} params.method - HTTP method (GET/POST)
 * @param {string} params.endpoint - API endpoint/function name
 * @param {string} params.corrId - Correlation ID for tracing
 * @param {object} params.e - Request event object
 * @param {Error} params.err - Error object
 * @param {string} params.eventId - Event ID if applicable
 * @param {string} params.severity - Severity level (ERROR, WARN, INFO)
 */
function _logError_(params) {
  const { method, endpoint, corrId, e, err, eventId, severity = 'ERROR' } = params;

  try {
    const sheet = _getErrorLogSheet_();

    // Sanitize and extract request data
    const sanitizedParams = sanitizeMetaForLogging_(e && e.parameter ? { ...e.parameter } : {});
    const sanitizedPostData = sanitizeMetaForLogging_(e && e.postData ? { contents: (e.postData.contents || '').slice(0, 500) } : {});
    const userAgent = (e && e.headers && e.headers['user-agent']) || '';

    const row = [
      new Date().toISOString(),                                    // ts
      corrId || '',                                                 // corrId
      endpoint || '',                                               // endpoint
      method || '',                                                 // method
      eventId || _getEventIdFromParams_(e) || '',                  // eventId
      (err && err.name) || 'Error',                                // errorName
      (err && err.message) || String(err) || 'Unknown error',      // message
      ((err && err.stack) || '').slice(0, 2000),                   // stack (truncated)
      JSON.stringify(sanitizedParams || {}).slice(0, 500),         // params (truncated)
      JSON.stringify(sanitizedPostData || {}).slice(0, 500),       // postData (truncated)
      userAgent.slice(0, 200),                                     // userAgent (truncated)
      severity                                                      // severity
    ];

    sheet.appendRow(row);

    // Cleanup old rows if exceeding max
    const lastRow = sheet.getLastRow();
    if (lastRow > LOG_ERRORS_MAX) {
      const rowsToDelete = lastRow - LOG_ERRORS_MAX;
      sheet.deleteRows(2, rowsToDelete);
    }
  } catch (logErr) {
    // Last resort: log to Apps Script native logs; do NOT throw
    console.error('_logError_ failed:', logErr && logErr.message, { corrId, endpoint, err: err && err.message });
  }
}

/**
 * Extract event ID from request parameters
 * @param {object} e - Request event object
 * @returns {string|null} Event ID if found
 */
function _getEventIdFromParams_(e) {
  if (!e || !e.parameter) return null;
  return e.parameter.id || e.parameter.eventId || e.parameter.event || null;
}

/**
 * Story 14: Central request handler with structured error handling
 * Wraps all request processing with correlation ID and error logging.
 *
 * @param {string} method - HTTP method (GET/POST)
 * @param {object} e - Request event object
 * @param {function} handler - Handler function to execute
 * @returns {*} Handler result or error response
 */
function _handleRequestSafe_(method, e, handler) {
  const endpoint = _resolveEndpointFromRequest_(e, method);
  const corrId = generateCorrId_(endpoint);

  try {
    // Execute the handler with corrId available
    return handler(corrId);
  } catch (err) {
    // Log to LOG_ERRORS sheet
    _logError_({
      method,
      endpoint,
      corrId,
      e,
      err,
      severity: 'ERROR'
    });

    // Return appropriate error response based on request type
    if (_isApiRequest_(e, method)) {
      const errorResponse = {
        ok: false,
        code: ERR.INTERNAL,
        error: `Something went wrong. Reference: ${corrId}`,
        corrId
      };
      return ContentService.createTextOutput(JSON.stringify(errorResponse))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // HTML error response using template
    return _renderErrorPage_(corrId);
  }
}

/**
 * Resolve endpoint name from request for corrId generation
 * @param {object} e - Request event object
 * @param {string} method - HTTP method
 * @returns {string} Endpoint name
 */
function _resolveEndpointFromRequest_(e, method) {
  if (method === 'POST') {
    try {
      const body = JSON.parse(e.postData.contents || '{}');
      return body.action ? `api_${body.action}` : 'doPost';
    } catch (_) {
      return 'doPost';
    }
  }

  const action = e && e.parameter && e.parameter.action;
  if (action) return `api_${action}`;

  const page = e && e.parameter && (e.parameter.page || e.parameter.p);
  if (page) return `page_${page}`;

  const pathInfo = e && e.pathInfo;
  if (pathInfo) {
    const parts = pathInfo.split('/').filter(p => p);
    return parts.length > 0 ? `path_${parts[parts.length - 1]}` : 'doGet';
  }

  return 'doGet';
}

/**
 * Check if request is an API request (expects JSON response)
 * @param {object} e - Request event object
 * @param {string} method - HTTP method
 * @returns {boolean}
 */
function _isApiRequest_(e, method) {
  if (method === 'POST') return true;
  if (e && e.parameter && e.parameter.action) return true;
  const accept = e && e.headers && e.headers.accept;
  if (accept && accept.includes('application/json')) return true;
  return false;
}

/**
 * Render the error page template with corrId
 * @param {string} corrId - Correlation ID
 * @returns {HtmlOutput}
 */
function _renderErrorPage_(corrId) {
  try {
    const tpl = HtmlService.createTemplateFromFile('ErrorTemplate');
    tpl.corrId = corrId;
    return tpl.evaluate()
      .setTitle('Error · EventAngle')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);
  } catch (_) {
    // Fallback if template doesn't exist
    return HtmlService.createHtmlOutput(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Error</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                 max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
          .error-box { background: #fee2e2; border: 1px solid #fca5a5; padding: 30px;
                       border-radius: 8px; }
          h1 { color: #dc2626; margin-bottom: 15px; }
          .reference { background: #f5f5f5; padding: 10px; border-radius: 4px;
                       font-family: monospace; font-size: 14px; color: #666; }
        </style>
      </head>
      <body>
        <div class="error-box">
          <h1>Something went wrong</h1>
          <p>We hit an unexpected error while loading this page.</p>
          <div class="reference">Reference: ${corrId}</div>
          <p style="margin-top: 15px; font-size: 13px; color: #888;">
            You can refresh the page, or share this reference code with the event organizer if the problem continues.
          </p>
        </div>
      </body>
      </html>
    `).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);
  }
}

/**
 * Diagnostic logging with spreadsheet ID support for web app context
 * @param {string} level - Log level (error, warn, info, debug)
 * @param {string} where - Function/location name
 * @param {string} msg - Log message
 * @param {object} meta - Optional metadata object
 * @param {string} spreadsheetId - Optional spreadsheet ID (uses root brand if not provided)
 */
// Delegate to SecurityMiddleware for consistent sanitization across codebase
function sanitizeMetaForLogging_(meta) {
  return SecurityMiddleware_sanitizeMetaForLogging(meta);
}

function diag_(level, where, msg, meta, spreadsheetId){
  try{
    // If spreadsheet ID not provided, try to get from root brand
    if (!spreadsheetId) {
      const rootBrand = findBrand_('root');
      if (rootBrand && rootBrand.store && rootBrand.store.spreadsheetId) {
        spreadsheetId = rootBrand.store.spreadsheetId;
      }
    }

    // Fall back to getActive() only if no spreadsheet ID available (UI context)
    const ss = spreadsheetId
      ? SpreadsheetApp.openById(spreadsheetId)
      : SpreadsheetApp.getActive();

    let sh = ss.getSheetByName(DIAG_SHEET);
    if(!sh){
      sh = ss.insertSheet(DIAG_SHEET);
      sh.appendRow(['ts','level','where','msg','meta']);
      sh.setFrozenRows(1);
    }

    // Fixed: Bug #17 - Sanitize metadata before logging
    const sanitizedMeta = sanitizeMetaForLogging_(meta);
    sh.appendRow([new Date().toISOString(), level, where, msg, sanitizedMeta ? JSON.stringify(sanitizedMeta) : '']);

    // Fixed: Bug #47 - Add error handling for cleanup operations
    try {
      // Hard cap cleanup - Fixed: Bug #8
      const last = sh.getLastRow();
      if(last > DIAG_MAX){
        const rowsToDelete = last - DIAG_MAX;
        if (rowsToDelete > 0) {
          sh.deleteRows(2, rowsToDelete);
        }
      }

      // Fixed: Bug #42 - Use counter instead of random for deterministic cleanup
      // Run cleanup every 50 log entries instead of random 10% chance
      const cache = CacheService.getScriptCache();
      const cleanupCounterKey = 'diag_cleanup_counter';
      const counter = parseInt(cache.get(cleanupCounterKey) || '0', 10) + 1;
      cache.put(cleanupCounterKey, String(counter), 3600);

      const shouldCleanup = (counter % 50 === 0); // Every 50th log entry
      if(shouldCleanup && last > DIAG_PER_DAY){
        const today = (new Date()).toISOString().slice(0,10);
        const lastRow = sh.getLastRow();
        // Fixed: Bug #23 - Check if sheet has more than just header
        if (lastRow > 1) {
          const ts = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
          const idx = ts.map((t, i) => String(t).startsWith(today) ? i + 2 : null).filter(Boolean);
          if(idx.length > DIAG_PER_DAY){
            const rowsToDelete = idx.length - DIAG_PER_DAY;
            if (rowsToDelete > 0) {
              sh.deleteRows(idx[0], rowsToDelete);
            }
          }
        }
      }
    } catch (cleanupErr) {
      console.error('Diagnostic cleanup failed:', cleanupErr);
      // Continue execution - don't fail logging due to cleanup error
    }
  } catch(e) {
    console.error('diag_ failed:', e, {level, where, msg, meta});
  }
}

function runSafe(where, fn, eventId){
  try{ return fn(); }
  catch(e){
    // Use structured error logging with correlation ID
    return ErrWithCorrId_(ERR.INTERNAL, String(e), {
      stack: e && e.stack,
      eventId: eventId,
      endpoint: where,
      extra: { err: String(e) }
    });
  }
}

// =============================================================================
// [S04] CSRF PROTECTION
// =============================================================================
// Cross-Site Request Forgery protection using one-time tokens.
// Tokens are stored in UserCache with 1-hour expiry.
//
// Key exports:
//   generateCSRFToken_()     - Create new one-time CSRF token
//   validateCSRFToken_(tok)  - Validate and consume token (atomic)
//
// Fixed: Bug #4 - Add CSRF token generation and validation
// =============================================================================

function generateCSRFToken_() {
  const token = Utilities.getUuid();
  const cache = CacheService.getUserCache();
  cache.put('csrf_' + token, '1', 3600); // 1 hour expiry
  return token;
}

function validateCSRFToken_(token) {
  if (!token || typeof token !== 'string') return false;

  // Fixed: Bug #4 - Use LockService for atomic check-and-remove to prevent race condition
  const lock = LockService.getUserLock();
  try {
    // Acquire lock with 5 second timeout
    if (!lock.tryLock(5000)) {
      diag_('warn', 'validateCSRFToken_', 'Failed to acquire lock', { token: token.substring(0, 8) + '...' });
      return false;
    }

    const cache = CacheService.getUserCache();
    const valid = cache.get('csrf_' + token);

    if (valid) {
      cache.remove('csrf_' + token); // One-time use (now atomic)
      return true;
    }
    return false;
  } finally {
    // Always release lock
    try {
      lock.releaseLock();
    } catch (e) {
      // Lock might have expired, ignore
    }
  }
}

// =============================================================================
// [S05] ROUTER (doGet)
// =============================================================================
// Main entry point for GET requests. Routes to HTML surfaces based on:
//   - page/p parameter (page=admin, page=public, etc.)
//   - pathInfo (friendly URLs: /events, /manage, /display)
//   - shortlink tokens (/s/TOKEN)
//
// MVP Routes (5 surfaces):
//   admin, public (default), display, poster, report/analytics
//
// Key exports:
//   doGet(e)                   - Main GET handler
//   routePage_(e, page, brand) - Render specific page
//
// See docs/MVP_SURFACES.md for scope definition
// Story 16: Removed non-MVP routes (test, diagnostics, signup, config, planner,
// sponsor, sponsor-roi) - these reference V2 files not in deployment (src/mvp only)
// =============================================================================

function doGet(e){
  const pageParam = (e?.parameter?.page || e?.parameter?.p || '').toString();
  const actionParam = (e?.parameter?.action || '').toString();
  const hostHeader = (e?.headers?.host || e?.parameter?.host || '').toString();
  let brand= findBrandByHost_(hostHeader) || findBrand_('root');

  // Allow brand parameter to override default brand
  if (e?.parameter?.brand) {
    const overrideBrand = findBrand_(e.parameter.brand);
    if (overrideBrand) {
      brand = overrideBrand;
    }
  }

  // Demo mode detection (for testing, UAT, demos, and screenshots)
  const demoMode = (e?.parameter?.demo === 'true' || e?.parameter?.test === 'true');

  // ===== Customer-Friendly URL Routing =====
  // Supports patterns like:
  //   /abc/events → brand=abc, page=public
  //   /abc/manage → brand=abc, page=admin, mode=advanced
  //   /events → brand=root, page=public
  //   /display → brand=root, page=display
  const pathInfo = (e?.pathInfo || '').toString().replace(/^\/+|\/+$/g, '');

  if (pathInfo) {
    const pathParts = pathInfo.split('/').filter(p => p);

    // Check if first part is a brand ID
    let brandFromPath = null;
    let aliasFromPath = null;

    if (pathParts.length >= 2) {
      // Pattern: /{brand}/{alias}
      const possibleBrand = findBrand_(pathParts[0]);
      if (possibleBrand) {
        brandFromPath = possibleBrand;
        aliasFromPath = pathParts[1];
      }
    }

    if (!brandFromPath && pathParts.length >= 1) {
      // Pattern: /{alias} (use default brand)
      aliasFromPath = pathParts[0];
    }

    // Resolve alias to page configuration
    if (aliasFromPath) {
      const aliasConfig = resolveUrlAlias_(aliasFromPath, brandFromPath?.id || brand.id);

      if (aliasConfig) {
        // API endpoints should return JSON/special content, not HTML pages
        // Handle these directly instead of routing through routePage_()
        const resolvedPage = aliasConfig.page;

        // Handle API-like pages that return JSON
        if (resolvedPage === 'status') {
          const brandParam = (e?.parameter?.brand || brand.id || 'root').toString();
          const status = api_statusPure(brandParam);
          return ContentService.createTextOutput(JSON.stringify(status, null, 2))
            .setMimeType(ContentService.MimeType.JSON);
        }

        if (resolvedPage === 'statusmvp' || resolvedPage === 'status-mvp') {
          const brandParam = (e?.parameter?.brand || brand.id || 'root').toString();
          const status = api_statusMvp(brandParam);
          return ContentService.createTextOutput(JSON.stringify(status, null, 2))
            .setMimeType(ContentService.MimeType.JSON);
        }

        if (resolvedPage === 'setup' || resolvedPage === 'setupcheck') {
          const brandParam = (e?.parameter?.brand || brand.id || 'root').toString();
          const setupResult = api_setupCheck(brandParam);
          return ContentService.createTextOutput(JSON.stringify(setupResult, null, 2))
            .setMimeType(ContentService.MimeType.JSON);
        }

        if (resolvedPage === 'permissions' || resolvedPage === 'checkpermissions') {
          const brandParam = (e?.parameter?.brand || brand.id || 'root').toString();
          const permissionResult = api_checkPermissions(brandParam);
          return ContentService.createTextOutput(JSON.stringify(permissionResult, null, 2))
            .setMimeType(ContentService.MimeType.JSON);
        }

        // Ultra-simple ping endpoint for uptime monitoring (UptimeRobot, Pingdom, etc.)
        if (resolvedPage === 'ping') {
          return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
            .setMimeType(ContentService.MimeType.JSON);
        }

        // Story 16: Removed API docs route - ApiDocs.html not in MVP deployment
        // API docs available in archive/v2-code/ApiDocs.html for future use

        // Standard HTML page routing
        // Override brand if specified in path
        if (brandFromPath) {
          brand = brandFromPath;
        }

        // Block V2 surfaces even when accessed via URL aliases (router locked to MVP)
        const blockedV2Surfaces = ['templates-v2', 'randomizer', 'teams', 'picker', 'portfolio', 'portfolio-dashboard'];
        if (blockedV2Surfaces.includes(resolvedPage)) {
          return HtmlErrorWithCorrId_(
            'Surface Not Available',
            `V2 surface "${resolvedPage}" is not available in MVP deployment`,
            { endpoint: 'doGet', extra: { requestedPage: resolvedPage, alias: aliasFromPath, brand: brand.id } }
          );
        }

        const resolvedMode = aliasConfig.mode;

        // Continue routing with resolved values
        return routePage_(
          e,
          resolvedPage,
          brand,
          demoMode,
          { mode: resolvedMode, fromAlias: true, alias: aliasFromPath }
        );
      }
    }
  }

  // REST API Routes (for custom frontends)
  if (actionParam) {
    return handleRestApiGet_(e, actionParam, brand);
  }

  // Shortlink redirect route
  if (pageParam === 'r' || pageParam === 'redirect') {
    const token = (e?.parameter?.t || e?.parameter?.token || '').toString();
    return handleRedirect_(token);
  }

  // Story 16: Removed API docs route - ApiDocs.html not in MVP deployment

  // Status endpoint (pure - no external dependencies)
  if (pageParam === 'status') {
    const brandParam = (e?.parameter?.brand || 'root').toString();
    const status = api_statusPure(brandParam);
    return ContentService.createTextOutput(JSON.stringify(status, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Story 4: Whoami endpoint - returns deployment and account info for CI
  if (pageParam === 'whoami') {
    const brandParam = (e?.parameter?.brand || 'root').toString();
    const whoami = api_whoami(brandParam);
    return ContentService.createTextOutput(JSON.stringify(whoami, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // MVP Status endpoint with analytics health checks
  if (pageParam === 'statusmvp' || pageParam === 'status-mvp') {
    const brandParam = (e?.parameter?.brand || 'root').toString();
    const status = api_statusMvp(brandParam);
    return ContentService.createTextOutput(JSON.stringify(status, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Setup check endpoint - comprehensive diagnostics for first-time setup
  if (pageParam === 'setup' || pageParam === 'setupcheck') {
    const brandParam = (e?.parameter?.brand || 'root').toString();
    const setupResult = api_setupCheck(brandParam);
    return ContentService.createTextOutput(JSON.stringify(setupResult, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Permission check endpoint - quick diagnostic for permission issues
  if (pageParam === 'permissions' || pageParam === 'checkpermissions') {
    const brandParam = (e?.parameter?.brand || 'root').toString();
    const permissionResult = api_checkPermissions(brandParam);
    return ContentService.createTextOutput(JSON.stringify(permissionResult, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Ultra-simple ping endpoint for uptime monitoring (UptimeRobot, Pingdom, etc.)
  // Returns minimal JSON for fastest response and simplest text predicate matching
  if (pageParam === 'ping') {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const path = (e?.pathInfo || '').toString().replace(/^\/+|\/+$/g,'');
  const scope = (e?.parameter?.scope || 'events').toString();
  const allowed = brand.scopesAllowed?.length ? brand.scopesAllowed : ['events','leagues','tournaments'];

  if (!allowed.includes(scope)){
    const first = allowed[0] || 'events';
    return HtmlService.createHtmlOutput(`<meta http-equiv="refresh" content="0;url=?p=${first}&brand=${brand.id}">`);
  }

  // Page routing - MVP surfaces ONLY (5 total): admin, public (default), display, poster, report/analytics
  // Router is LOCKED to MVP surfaces - V2 surfaces return hard error to prevent scope creep
  // Uses _isMvpSurface_() to validate against canonical list from _listMvpSurfaces_()

  // Known V2 surfaces that are explicitly blocked (hard error, not silent fallback)
  const blockedV2Surfaces = ['templates-v2', 'randomizer', 'teams', 'picker', 'portfolio', 'portfolio-dashboard'];

  if (pageParam && blockedV2Surfaces.includes(pageParam)) {
    return HtmlErrorWithCorrId_(
      'Surface Not Available',
      `V2 surface "${pageParam}" is not available in MVP deployment`,
      { endpoint: 'doGet', extra: { requestedPage: pageParam, brand: brand.id } }
    );
  }

  // Router is LOCKED: any non-MVP page returns error (no silent fallback to public)
  // Only default to 'public' when no page parameter is provided at all
  if (pageParam && !_isMvpSurface_(pageParam)) {
    return HtmlErrorWithCorrId_(
      'Surface Not Available',
      `Surface "${pageParam}" is not enabled in this build`,
      { endpoint: 'doGet', extra: { requestedPage: pageParam, brand: brand.id } }
    );
  }

  let page = pageParam || 'public';

  // Route using helper function
  return routePage_(e, page, brand, demoMode, { mode: e?.parameter?.mode });
}

/**
 * Route to a specific page with brand and options
 * Centralizes page routing logic for both query params and friendly URLs
 *
 * @param {object} e - Request event object
 * @param {string} page - Page to route to
 * @param {object} brand - Brand configuration
 * @param {boolean} demoMode - Demo mode flag
 * @param {object} options - Additional routing options (mode, fromAlias, etc.)
 * @returns {HtmlOutput} - Rendered page
 */
function routePage_(e, page, brand, demoMode, options = {}) {
  // Story 16: Simplified admin routing - only Admin.html is deployed
  // Admin variant files (AdminWizard.html, AdminEnhanced.html) were moved to archive
  // All admin routes now use the single Admin.html dashboard

  // Dark Launch / Kill Switch: Return 404 for SharedReport page when disabled
  if ((page === 'report' || page === 'analytics') && !isBrandFeatureEnabled_(brand.id, 'sharedReportEnabled')) {
    return HtmlService.createHtmlOutput(
      '<html><head><title>Page Not Found</title></head><body style="font-family:sans-serif;text-align:center;padding:50px;">' +
      '<h1>404 - Page Not Found</h1>' +
      '<p>The requested page is not available for this organization.</p>' +
      '<a href="/?brand=' + brand.id + '">Return to Events</a>' +
      '</body></html>'
    ).setTitle('Page Not Found');
  }

  const scope = (e?.parameter?.scope || 'events').toString();
  const allowed = brand.scopesAllowed?.length ? brand.scopesAllowed : ['events','leagues','tournaments'];

  if (!allowed.includes(scope) && page === 'public'){
    const first = allowed[0] || 'events';
    return HtmlService.createHtmlOutput(`<meta http-equiv="refresh" content="0;url=?p=${first}&brand=${brand.id}">`);
  }

  const tpl = HtmlService.createTemplateFromFile(pageFile_(page));
  // Fixed: Bug #35 - Sanitize template variables to prevent injection
  tpl.appTitle = sanitizeInput_(`${brand.name} · ${scope}`, 200);
  tpl.brandId = sanitizeId_(brand.id) || brand.id;
  tpl.scope = sanitizeInput_(scope, 50);
  tpl.execUrl = ScriptApp.getService().getUrl();
  tpl.ZEB = ZEB;
  tpl.demoMode = demoMode; // Pass demo mode flag to templates
  tpl.brand = brand; // Pass brand object for template consistency
  tpl.brandFeatures = getBrandFeatures_(brand.id); // Pass feature flags for Dark Launch / Kill Switch

  // Pass friendly URL info if routed via alias
  if (options.fromAlias) {
    tpl.friendlyUrl = true;
    tpl.urlAlias = options.alias || '';
  }

  // Set global template context for include() function to use
  // This allows included templates to access these variables
  global_setTemplateContext_({
    appTitle: tpl.appTitle,
    brandId: tpl.brandId,
    scope: tpl.scope,
    execUrl: tpl.execUrl,
    ZEB: tpl.ZEB,
    demoMode: tpl.demoMode,
    brand: tpl.brand,
    brandFeatures: tpl.brandFeatures,
    friendlyUrl: tpl.friendlyUrl || false,
    urlAlias: tpl.urlAlias || ''
  });

  // Fixed: Bug #31 - Add security headers
  return tpl.evaluate()
    .setTitle(`${tpl.appTitle} · ${page}${demoMode ? ' (Demo)' : ''}`)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// =============================================================================
// [S06] REST API HANDLERS (doPost)
// =============================================================================
// Main entry point for POST requests and REST API routing.
// Handles both read-only (GET-style) and write operations.
//
// Key exports:
//   doPost(e)                        - Main POST handler
//   handleRestApiGet_(e, action)     - Read-only API operations
//   handleRestApiPost_(e, action)    - Write API operations (require auth)
//
// Supported actions: See PUBLIC API INVENTORY in [S00] header
// =============================================================================

function doPost(e){
  // Fixed: Bug #22 - Separate try-catch blocks for better error reporting
  let body;
  try {
    body = JSON.parse(e.postData.contents || '{}');
  } catch(jsonErr) {
    // Story 5.1 - Structured error logging with correlation ID
    return jsonResponse_(ErrWithCorrId_(ERR.BAD_INPUT, 'Invalid JSON body', {
      stack: jsonErr && jsonErr.stack,
      endpoint: 'doPost'
    }));
  }

  try {
    // Fixed: Bug #16 - Validate request origin to prevent unauthorized access
    const origin = e.parameter?.origin || e.headers?.origin || e.headers?.referer;
    if (!isAllowedOrigin_(origin, e.headers)) {
      // Story 5.1 - Structured error logging with correlation ID
      return jsonResponse_(ErrWithCorrId_(ERR.BAD_INPUT, 'Unauthorized origin or missing auth headers', {
        endpoint: 'doPost',
        extra: { origin }
      }));
    }

    const action = body.action || e.parameter?.action || '';
    const brand= findBrandByHost_(e?.headers?.host) || findBrand_('root');

    // Fixed: Bug #4 - CSRF protection for state-changing operations
    // ZEVENT-003: saveEvent is canonical, but legacy endpoints kept for backward compat
    const stateChangingActions = ['saveEvent', 'api_saveEvent', 'create', 'update', 'delete', 'updateEventData', 'createShortlink', 'createFormFromTemplate', 'generateFormShortlink'];
    if (stateChangingActions.includes(action)) {
      if (!validateCSRFToken_(body.csrfToken)) {
        // Story 5.1 - Structured error logging with correlation ID
        return jsonResponse_(ErrWithCorrId_(ERR.BAD_INPUT, 'Invalid or missing CSRF token', {
          endpoint: 'doPost',
          extra: { action }
        }));
      }
    }

    return handleRestApiPost_(e, action, body, brand);
  } catch(err) {
    // Story 5.1 - Structured error logging with correlation ID
    return jsonResponse_(ErrWithCorrId_(ERR.INTERNAL, 'Request handler failed: ' + String(err), {
      stack: err && err.stack,
      endpoint: 'doPost'
    }));
  }
}

// === REST API GET Handler (read-only operations) ==========================
function handleRestApiGet_(e, action, brand) {
  const brandId = e.parameter.brand || brand.id;
  const scope = e.parameter.scope || 'events';
  const etag = e.parameter.etag || '';
  const id = e.parameter.id || '';

  // Public endpoints (no auth required)
  if (action === 'status') {
    return jsonResponse_(api_status(brandId));
  }

  // Story 5: Health check endpoint for CI/CD pipelines
  if (action === 'health') {
    return jsonResponse_(api_health(brandId));
  }

  // Fixed: Bug #4 - CSRF token generation endpoint
  if (action === 'generateCSRFToken') {
    const token = generateCSRFToken_();
    return jsonResponse_(Ok({ csrfToken: token }));
  }

  if (action === 'config') {
    return jsonResponse_(api_getConfig({brandId, scope, ifNoneMatch: etag}));
  }

  if (action === 'list') {
    return jsonResponse_(api_list({brandId, scope, ifNoneMatch: etag}));
  }

  // Event selector dropdown - clean shape for Admin UI
  if (action === 'getEventsSafe') {
    return jsonResponse_(api_getEventsSafe({brandId}));
  }

  if (action === 'get') {
    if (!id) return jsonResponse_(Err(ERR.BAD_INPUT, 'Missing id parameter'));
    return jsonResponse_(api_get({brandId, scope, id, ifNoneMatch: etag}));
  }

  // Public bundle endpoints (no auth required)
  if (action === 'getPublicBundle') {
    if (!id) return jsonResponse_(Err(ERR.BAD_INPUT, 'Missing id parameter'));
    return jsonResponse_(api_getPublicBundle({brandId, scope, id, ifNoneMatch: etag}));
  }

  if (action === 'getDisplayBundle') {
    if (!id) return jsonResponse_(Err(ERR.BAD_INPUT, 'Missing id parameter'));
    return jsonResponse_(api_getDisplayBundle({brandId, scope, id, ifNoneMatch: etag}));
  }

  if (action === 'getPosterBundle') {
    if (!id) return jsonResponse_(Err(ERR.BAD_INPUT, 'Missing id parameter'));
    return jsonResponse_(api_getPosterBundle({brandId, scope, id, ifNoneMatch: etag}));
  }

  if (action === 'getSponsorBundle') {
    if (!id) return jsonResponse_(Err(ERR.BAD_INPUT, 'Missing id parameter'));
    return jsonResponse_(api_getSponsorBundle({brandId, scope, id, ifNoneMatch: etag}));
  }

  if (action === 'getSharedReportBundle') {
    if (!id) return jsonResponse_(Err(ERR.BAD_INPUT, 'Missing id parameter'));
    return jsonResponse_(api_getSharedReportBundle({brandId, scope, id, ifNoneMatch: etag}));
  }

  return jsonResponse_(Err(ERR.BAD_INPUT, `Unknown action: ${action}`));
}

// === REST API POST Handler (write operations, require auth) ===============
function handleRestApiPost_(e, action, body, brand) {
  const brandId = body.brandId || e.parameter?.brand || brand.id;
  const scope = body.scope || e.parameter?.scope || 'events';

  // Special case: token generation uses old auth flow
  if (action === 'generateToken') {
    return jsonResponse_(api_generateToken({
      brandId,
      adminKey: body.adminKey,
      expiresIn: body.expiresIn,
      scope
    }));
  }

  // Check authorization using multi-method authentication
  const authCheck = authenticateRequest_(e, body, brandId);
  if (!authCheck.ok) {
    return jsonResponse_(authCheck);
  }

  const authenticatedBrand = authCheck.value.brand;
  const adminKey = body.adminKey || getAdminSecret_(authenticatedBrand.id); // For backward compatibility

  // Route to appropriate API function

  // CANONICAL EVENT WRITE API (ZEVENT-003)
  if (action === 'saveEvent' || action === 'api_saveEvent') {
    return jsonResponse_(api_saveEvent({
      brandId,
      adminKey,
      event: body.event,
      scope,
      templateId: body.templateId
    }));
  }

  // Legacy create endpoint (orphaned - kept for backward compatibility)
  if (action === 'create') {
    return jsonResponse_(api_create({
      brandId,
      adminKey,
      scope,
      templateId: body.templateId,
      data: body.data
    }));
  }

  // Legacy update endpoint (orphaned - kept for backward compatibility)
  if (action === 'update') {
    return jsonResponse_(api_updateEventData({
      brandId,
      adminKey,
      scope,
      id: body.id,
      data: body.data
    }));
  }

  if (action === 'logEvents') {
    return jsonResponse_(api_logEvents({
      items: body.items || []
    }));
  }

  if (action === 'getReport') {
    return jsonResponse_(api_getReport({
      brandId,
      adminKey,
      id: body.eventId || '',  // Fixed: Changed eventId to id to match api_getReport
      startDate: body.startDate || '',
      endDate: body.endDate || ''
    }));
  }

  // Admin Bundle - optimized bundle for Admin.html surface
  if (action === 'getAdminBundle') {
    return jsonResponse_(api_getAdminBundle({
      brandId,
      adminKey,
      scope,
      id: body.id || body.eventId || '',
      ifNoneMatch: body.ifNoneMatch || ''
    }));
  }

  if (action === 'createShortlink') {
    return jsonResponse_(api_createShortlink({
      brandId,
      adminKey,
      targetUrl: body.targetUrl,
      eventId: body.eventId || '',
      sponsorId: body.sponsorId || '',
      surface: body.surface || ''
    }));
  }

  if (action === 'listFormTemplates') {
    return jsonResponse_(api_listFormTemplates());
  }

  if (action === 'createFormFromTemplate') {
    return jsonResponse_(api_createFormFromTemplate({
      brandId,
      adminKey,
      templateType: body.templateType,
      eventName: body.eventName || '',
      eventId: body.eventId || ''
    }));
  }

  if (action === 'generateFormShortlink') {
    return jsonResponse_(api_generateFormShortlink({
      brandId,
      adminKey,
      formUrl: body.formUrl,
      formType: body.formType || '',
      eventId: body.eventId || ''
    }));
  }

  // Brand Portfolio Analytics (Parent Organizations)
  if (action === 'api_getPortfolioSponsorReport') {
    return jsonResponse_(api_getPortfolioSponsorReport({
      brandId,
      adminKey,
      sponsorId: body.sponsorId || '',
      options: body.options || {}
    }));
  }

  if (action === 'api_getPortfolioSummary') {
    return jsonResponse_(api_getPortfolioSummary({
      brandId,
      adminKey
    }));
  }

  if (action === 'api_getPortfolioSponsors') {
    return jsonResponse_(api_getPortfolioSponsors({
      brandId,
      adminKey
    }));
  }

  // Sponsor Configuration Endpoints
  if (action === 'getSponsorSettings' || action === 'api_getSponsorSettings') {
    return jsonResponse_(api_getSponsorSettings({
      brandId
    }));
  }

  if (action === 'validateSponsorPlacements' || action === 'api_validateSponsorPlacements') {
    return jsonResponse_(api_validateSponsorPlacements({
      brandId,
      sponsors: body.sponsors || []
    }));
  }

  // Sponsor ROI Dashboard (High-Value Feature)
  if (action === 'getSponsorROI' || action === 'api_getSponsorROI') {
    return jsonResponse_(api_getSponsorROI({
      sponsorId: body.sponsorId || '',
      sponsorshipCost: body.sponsorshipCost || 0,
      costPerClick: body.costPerClick || 0,
      conversionRate: body.conversionRate || 0,
      avgTransactionValue: body.avgTransactionValue || 0,
      dateFrom: body.dateFrom || '',
      dateTo: body.dateTo || '',
      brandId,
      adminKey
    }));
  }

  // Sponsor Analytics
  if (action === 'getSponsorAnalytics' || action === 'api_getSponsorAnalytics') {
    return jsonResponse_(api_getSponsorAnalytics({
      sponsorId: body.sponsorId || '',
      eventId: body.eventId || '',
      dateFrom: body.dateFrom || '',
      dateTo: body.dateTo || '',
      brandId,
      adminKey
    }));
  }

  // Sponsor Report QR Code
  if (action === 'getSponsorReportQr' || action === 'api_getSponsorReportQr') {
    return jsonResponse_(api_getSponsorReportQr({
      sponsorId: body.sponsorId || '',
      brandId,
      adminKey
    }));
  }

  // Story 16: Removed V2 Webhook endpoints (registerWebhook, unregisterWebhook, listWebhooks,
  // testWebhook, getWebhookDeliveries) - WebhookService.gs not in MVP deployment
  // Webhook service code archived in archive/v2-code/WebhookService.gs

  // Story 16: Removed V2 i18n endpoints (translate, getSupportedLocales, setUserLocale)
  // i18nService.gs not in MVP deployment, archived in archive/v2-code/i18nService.gs

  // Template Management Endpoints
  if (action === 'getTemplate' || action === 'api_getTemplate') {
    return jsonResponse_(api_getTemplate({
      templateId: body.templateId || '',
      locale: body.locale || ''
    }));
  }

  if (action === 'listTemplates' || action === 'api_listTemplates') {
    return jsonResponse_(api_listTemplates({
      category: body.category || '',
      locale: body.locale || '',
      includeDeprecated: body.includeDeprecated || false
    }));
  }

  if (action === 'validateTemplateData' || action === 'api_validateTemplateData') {
    return jsonResponse_(api_validateTemplateData({
      templateId: body.templateId || '',
      data: body.data || {},
      locale: body.locale || ''
    }));
  }

  return jsonResponse_(Err(ERR.BAD_INPUT, `Unknown action: ${action}`));
}

// =============================================================================
// [S07] CORS & JSON RESPONSE
// =============================================================================
// Origin validation and JSON response helpers with CORS headers.
//
// Key exports:
//   isAllowedOrigin_(origin)  - Validate request origin
//   jsonResponse_(data)       - Create JSON response with CORS headers
//   _listMvpSurfaces_()       - List of valid MVP surface pages
//   _isMvpSurface_(page)      - Check if page is MVP surface
//   pageFile_(page)           - Map page name to HTML file
// =============================================================================

// Fixed: Bug #16 - Add origin validation to prevent unauthorized API access
function isAllowedOrigin_(origin, authHeaders) {
  // Fixed: Bug #16 Part 2 - Requests without origin (curl, Postman, server-to-server)
  // must have authentication headers (JWT token or Authorization header)
  if (!origin) {
    // Non-browser requests must provide authentication
    const hasAuth = authHeaders && (
      authHeaders.authorization ||
      authHeaders.Authorization ||
      authHeaders['x-api-key'] ||
      authHeaders['X-API-Key']
    );

    if (!hasAuth) {
      diag_('warn', 'isAllowedOrigin_', 'Non-browser request without auth headers', {});
      return false;
    }

    // Has auth headers, allow to proceed to authentication layer
    return true;
  }

  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.hostname.toLowerCase();

    // Allow localhost for development
    if (originHost === 'localhost' || originHost === '127.0.0.1') {
      return true;
    }

    // Check against brand hostnames
    for (const brand of BRANDS) {
      if (brand.hostnames && brand.hostnames.some(h => h.toLowerCase() === originHost)) {
        return true;
      }
    }

    // Allow script.google.com for Apps Script frontends
    if (originHost.endsWith('.google.com')) {
      return true;
    }

    return false;
  } catch (e) {
    diag_('warn', 'isAllowedOrigin_', 'Invalid origin URL', {origin, error: String(e)});
    return false;
  }
}

// === JSON Response Helper with CORS =======================================
function jsonResponse_(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data, null, 2))
    .setMimeType(ContentService.MimeType.JSON);

  // CORS headers are automatically handled by Apps Script
  // Origin validation is performed in doPost/doGet handlers
  return output;
}

/**
 * Returns the canonical list of MVP surfaces
 * This is the single source of truth for allowed ?page= values.
 *
 * Used by:
 * - Router validation (doGet)
 * - Node.js surface check script (scripts/check-surfaces.js)
 * - pageFile_() for template mapping
 *
 * MVP surfaces (5 total):
 *   - admin: Event management dashboard
 *   - public: Event listing & registration (default)
 *   - display: TV/kiosk display
 *   - poster: Printable poster with QR
 *   - report: Analytics & sponsor performance (alias: analytics)
 *
 * @returns {string[]} Array of valid MVP surface identifiers
 */
function _listMvpSurfaces_() {
  return ['admin', 'public', 'display', 'poster', 'report'];
}

/**
 * Check if a page identifier is a valid MVP surface
 *
 * MVP Surfaces (5 total, locked - no V2 surfaces allowed):
 *   - admin, public, display, poster, report
 *   - 'analytics' is an alias for 'report'
 *
 * @param {string} page - Page identifier to check
 * @returns {boolean} True if page is a valid MVP surface
 */
function _isMvpSurface_(page) {
  const surfaces = _listMvpSurfaces_();
  // 'analytics' is an alias for 'report'
  return surfaces.includes(page) || page === 'analytics';
}

/**
 * Map page identifiers to HTML template files
 * Page routing: URL param → internal page → HTML file
 *
 * MVP surfaces (5 total, LOCKED - no V2 surfaces):
 *   public → Public.html (default)
 *   admin → Admin.html
 *   poster → Poster.html
 *   display → Display.html
 *   report/analytics → SharedReport.html
 *
 * V2 surfaces have been removed from the router to prevent scope creep.
 * See archive/v2-code/ for V2 implementation files.
 *
 * @param {string} page - Page identifier from routing (must be MVP surface)
 * @returns {string} HTML template filename (without .html extension)
 */
function pageFile_(page){
  // === MVP SURFACES ONLY (5 total) ===
  if (page==='admin') return 'Admin';
  if (page==='poster') return 'Poster';
  if (page==='display') return 'Display';
  if (page==='report' || page==='analytics') return 'SharedReport';

  // Default to Public for any unknown/missing page
  // Note: Non-MVP surfaces are blocked earlier in doGet() with hard error
  return 'Public';
}

// =============================================================================
// [S08] TEMPLATE CONTEXT & INCLUDES
// =============================================================================
// Global template context for passing data to HTML templates.
// Includes the include() function for template composition.
//
// Key exports:
//   global_setTemplateContext_(ctx)  - Set context for current request
//   global_getTemplateContext_()     - Get context in template
//   include(filename)                - Include partial HTML files
//
// Usage: Set context in routePage_, retrieve in HTML templates via <?!= ?>
// =============================================================================

var TEMPLATE_CONTEXT_ = null;

/**
 * Set the global template context (used by include() to pass variables)
 * @param {object} context - Template variables to make available to included files
 * @private
 */
function global_setTemplateContext_(context) {
  TEMPLATE_CONTEXT_ = context;
}

/**
 * Get the global template context
 * @returns {object|null} - Current template context or null
 * @private
 */
function global_getTemplateContext_() {
  return TEMPLATE_CONTEXT_;
}

/**
 * Include and evaluate an HTML template file with template variable support
 *
 * This function is called from HTML templates using <?!= include('filename') ?>
 * It evaluates the included file as a template, allowing it to use <?= ?> tags
 * for variable substitution.
 *
 * @param {string} filename - The name of the HTML file to include (without .html extension)
 * @returns {string} - The evaluated HTML content
 */
function include(filename) {
  // Create template from file to enable template tag evaluation
  const template = HtmlService.createTemplateFromFile(filename);

  // Get the global template context (set by routePage_)
  const context = global_getTemplateContext_();

  // Pass template variables from context to the included template
  // This enables <?= variableName ?> tags in included files to work correctly
  if (context) {
    Object.keys(context).forEach(function(key) {
      template[key] = context[key];
    });
  }

  // Evaluate the template and return the HTML content
  return template.evaluate().getContent();
}

// =============================================================================
// [S09] SHORTLINK HANDLER
// =============================================================================
// Handles /s/TOKEN shortlink redirects with click tracking.
// Shortlinks are stored in SHORTLINKS sheet with metadata.
//
// Key exports:
//   handleRedirect_(token)  - Resolve and redirect shortlink
//
// Shortlink format: /s/{token} → target URL
// Tracking: Logs clicks to ANALYTICS sheet for reporting
// =============================================================================

function handleRedirect_(token) {
  // Story 11: All HTML errors include correlation IDs for tracing
  if (!token) {
    return HtmlErrorWithCorrId_('Invalid shortlink', 'Missing token parameter', {
      endpoint: 'handleRedirect_'
    });
  }

  // Use root brand spreadsheet for shortlinks
  const rootBrand = findBrand_('root');
  if (!rootBrand || !rootBrand.store || !rootBrand.store.spreadsheetId) {
    return HtmlErrorWithCorrId_('Configuration error', 'Root brand spreadsheet not configured', {
      endpoint: 'handleRedirect_',
      extra: { token }
    });
  }

  const spreadsheetId = rootBrand.store.spreadsheetId;
  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sh = ss.getSheetByName('SHORTLINKS');
  if (!sh) {
    return HtmlErrorWithCorrId_('Shortlink not found', 'SHORTLINKS sheet does not exist', {
      endpoint: 'handleRedirect_',
      extra: { token },
      spreadsheetId
    });
  }

  const rows = sh.getDataRange().getValues().slice(1);
  const row = rows.find(r => r[0] === token);

  if (!row) {
    return HtmlErrorWithCorrId_('Shortlink not found', `Token not found: ${token}`, {
      endpoint: 'handleRedirect_',
      extra: { token },
      spreadsheetId
    });
  }

  // Fixed: Bug #53 - Extract brandId for validation (7th column if present)
  const [tok, targetUrl, eventId, sponsorId, surface, createdAt, shortlinkBrandId] = row;

  // Fixed: Bug #52 - Validate URL before redirect to prevent XSS
  if (!isUrl(targetUrl)) {
    return HtmlErrorWithCorrId_('Invalid shortlink URL', `URL validation failed for token: ${token}`, {
      endpoint: 'handleRedirect_',
      extra: { token, targetUrl },
      spreadsheetId
    });
  }

  // Additional validation: ensure HTTP(S) only
  try {
    const url = new URL(targetUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return HtmlErrorWithCorrId_('Invalid shortlink protocol', `Non-HTTP protocol: ${url.protocol}`, {
        endpoint: 'handleRedirect_',
        extra: { token, protocol: url.protocol },
        spreadsheetId
      });
    }
  } catch(e) {
    return HtmlErrorWithCorrId_('Invalid shortlink URL', `URL parsing failed: ${String(e)}`, {
      endpoint: 'handleRedirect_',
      stack: e && e.stack,
      extra: { token, targetUrl },
      spreadsheetId
    });
  }

  // Log analytics
  try {
    api_logEvents({
      items: [{
        eventId: eventId || '',
        surface: surface || 'shortlink',
        metric: 'click',
        sponsorId: sponsorId || '',
        token: tok
      }]
    });
  } catch(e) {
    diag_('warn', 'handleRedirect_', 'Analytics log failed', {error: String(e)}, spreadsheetId);
  }

  diag_('info', 'handleRedirect_', 'Redirect', {token, targetUrl, eventId, sponsorId}, spreadsheetId);

  // Fixed: Bug #1 - Add warning page for external redirects to prevent phishing
  const url = new URL(targetUrl);
  const hostname = url.hostname.toLowerCase();

  // Check if this is an external domain (not a known brand domain)
  let isExternal = true;
  for (const brand of BRANDS) {
    if (brand.hostnames && brand.hostnames.some(h => h.toLowerCase() === hostname)) {
      isExternal = false;
      break;
    }
  }

  // Use sanitized URL - escape it for HTML context
  const escapedUrl = String(targetUrl)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

  // If external domain, show warning page
  if (isExternal) {
    return HtmlService.createHtmlOutput(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>External Link Warning</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 20px; border-radius: 5px; }
          .url { word-break: break-all; background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 3px; }
          .buttons { margin-top: 20px; }
          button { padding: 10px 20px; margin-right: 10px; cursor: pointer; }
          .continue { background: #007bff; color: white; border: none; border-radius: 3px; }
          .cancel { background: #6c757d; color: white; border: none; border-radius: 3px; }
        </style>
      </head>
      <body>
        <div class="warning">
          <h2>⚠️ External Link Warning</h2>
          <p>You are about to leave this site and visit an external website:</p>
          <div class="url">${escapedUrl}</div>
          <p><strong>Warning:</strong> We cannot guarantee the safety or content of external websites. Proceed with caution.</p>
          <div class="buttons">
            <button class="continue" onclick="window.location.href='${escapedUrl}'">Continue to External Site</button>
            <button class="cancel" onclick="window.close()">Cancel</button>
          </div>
        </div>
      </body>
      </html>
    `);
  }

  // Internal redirect - proceed immediately
  return HtmlService.createHtmlOutput(`
    <meta http-equiv="refresh" content="0;url=${escapedUrl}">
    <p>Redirecting...</p>
  `);
}

// =============================================================================
// [S10] AUTHENTICATION
// =============================================================================
// Multi-method authentication for write operations.
// Read operations are public; write operations require auth.
//
// Supported methods:
//   1. adminKey (legacy)    - Simple secret key in body/param
//   2. Bearer token (JWT)   - Authorization: Bearer {token}
//   3. API Key (header)     - X-API-Key header
//
// Key exports:
//   authenticateRequest_(e, body, brandId) - Validate auth credentials
//   timingSafeCompare_(a, b)               - Constant-time comparison
//   verifyJWT_(token, brand)               - Validate JWT token
// =============================================================================

function authenticateRequest_(e, body, brandId) {
  const brand= findBrand_(brandId);
  if (!brand) {
    return Err(ERR.NOT_FOUND, 'Unknown brand');
  }

  // Method 1: adminKey in body (legacy, backward compatible)
  const adminKey = body?.adminKey || e?.parameter?.adminKey || '';
  const brandSecret = getAdminSecret_(brand.id);
  if (adminKey && brandSecret && adminKey === brandSecret) {
    return Ok({ brand, method: 'adminKey' });
  }

  // Method 2: Bearer token (JWT)
  const authHeader = e?.headers?.Authorization || e?.headers?.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const jwtResult = verifyJWT_(token, brand);
    if (jwtResult.ok) {
      return Ok({ brand, method: 'jwt', claims: jwtResult.value });
    }
  }

  // Method 3: API Key in header
  const apiKey = e?.headers?.['X-API-Key'] || e?.headers?.['x-api-key'] || '';
  const brandApiSecret = getAdminSecret_(brand.id);
  if (apiKey && brandApiSecret && apiKey === brandApiSecret) {
    return Ok({ brand, method: 'apiKey' });
  }

  // No valid authentication found
  return Err(ERR.BAD_INPUT, 'Invalid authentication credentials');
}

/**
 * Simple JWT verification (for demonstration)
 * In production, use a proper JWT library or Google's OAuth
 */
// Fixed: Bug #2 - Add algorithm verification to prevent "none" algorithm attack
/**
 * Timing-safe string comparison to prevent timing attacks
 * Returns true if strings are equal, false otherwise
 * Always takes constant time regardless of where strings differ
 */
function timingSafeCompare_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // Different lengths = not equal, but still compare all bytes to maintain constant time
  const aLen = a.length;
  const bLen = b.length;
  let result = aLen === bLen ? 0 : 1;

  // Compare all bytes, using modulo to handle different lengths
  const maxLen = Math.max(aLen, bLen);
  for (let i = 0; i < maxLen; i++) {
    const aChar = i < aLen ? a.charCodeAt(i) : 0;
    const bChar = i < bLen ? b.charCodeAt(i) : 0;
    result |= aChar ^ bChar;
  }

  return result === 0;
}

function verifyJWT_(token, brand) {
  try {
    // Simple validation: decode base64 payload
    const parts = token.split('.');
    if (parts.length !== 3) {
      return Err(ERR.BAD_INPUT, 'Invalid JWT format');
    }

    // Verify algorithm in header (prevent "none" algorithm attack)
    let header;
    try {
      header = JSON.parse(Utilities.newBlob(Utilities.base64Decode(parts[0])).getDataAsString());
    } catch (e) {
      return Err(ERR.BAD_INPUT, 'Invalid JWT header');
    }

    // Only allow HS256 algorithm
    if (!header.alg || header.alg !== 'HS256') {
      diag_('error', 'verifyJWT_', 'Invalid algorithm', {alg: header.alg});
      return Err(ERR.BAD_INPUT, 'Invalid JWT algorithm');
    }

    const payload = JSON.parse(Utilities.newBlob(Utilities.base64Decode(parts[1])).getDataAsString());

    // Verify brand
    if (payload.brand !== brand.id) {
      return Err(ERR.BAD_INPUT, 'Token brand mismatch');
    }

    // Verify expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return Err(ERR.BAD_INPUT, 'Token expired');
    }

    // Verify signature (simplified - use proper crypto in production)
    const brandSecret = getAdminSecret_(brand.id);
    if (!brandSecret) {
      return UserFriendlyErr_(ERR.INTERNAL, 'Brand secret not configured', { brandId: brand.id }, 'verifyJWT_');
    }
    const expectedSignature = generateJWTSignature_(parts[0] + '.' + parts[1], brandSecret);

    // Timing-safe comparison to prevent timing attacks
    if (!timingSafeCompare_(parts[2], expectedSignature)) {
      return Err(ERR.BAD_INPUT, 'Invalid token signature');
    }

    // Verify not-before if present
    if (payload.nbf && payload.nbf > now) {
      return Err(ERR.BAD_INPUT, 'Token not yet valid');
    }

    return Ok(payload);
  } catch (e) {
    return UserFriendlyErr_(ERR.BAD_INPUT, 'Invalid JWT verification', { error: e.message }, 'verifyJWT_');
  }
}

// =============================================================================
// [S11] MVP API CONTRACTS
// =============================================================================
// Core API functions and token generation for Triangle Live Demo.
// Surfaces: Admin, Poster, Display, Public, Sponsor, SharedReport
//
// DO NOT change these contracts without updating:
//   - NUSDK.html (API client)
//   - tests/e2e/* (end-to-end tests)
//   - tests/unit/* (unit tests)
//
// ┌─────────────────────────────────────────────────────────────────────────────
// │ MVP CONTRACTS - Don't break during iteration
// ├─────────────────────────────────────────────────────────────────────────────
// │ Event Core:
// │   api_create()              → Create new event (Admin)
// │   api_get()                 → Get single event (all surfaces)
// │   api_updateEventData()     → Update event data (Admin)
// │   api_getPublicBundle()     → Public bundle (Public, Poster, Display)
// │
// │ Forms:
// │   api_createFormFromTemplate() → Create registration form (Admin)
// │   api_generateFormShortlink()  → Trackable form links (Admin)
// │
// │ Sponsors & Analytics:
// │   api_getSponsorSettings()  → Sponsor placements (all surfaces)
// │   api_getSharedAnalytics()  → Shared analytics (SharedReport) [SharedReporting.gs]
// │   api_getSponsorAnalytics() → Sponsor metrics (Sponsor, SharedReport)
// │   api_getSponsorROI()       → ROI calculation (Sponsor, SharedReport)
// │
// │ Templates:
// │   api_getEventTemplates()   → Available templates for brand (Admin)
// └─────────────────────────────────────────────────────────────────────────────
//
// ┌─────────────────────────────────────────────────────────────────────────────
// │ v2+ APIs - Working but not MVP focus
// ├─────────────────────────────────────────────────────────────────────────────
// │ Portfolio:     api_getPortfolioSponsorReport, api_getPortfolioSummary,
// │                api_getPortfolioSponsors
// │ Multi-brand:   Brand hierarchy, child brand rollups
// │ Exports:       api_exportReport (advanced spreadsheet exports)
// │ i18n:          Full internationalization system
// └─────────────────────────────────────────────────────────────────────────────
// =============================================================================

/**
 * Generate JWT token for a brand (for demo/testing)
 * @tier mvp
 */
function api_generateToken(req) {
  const authCheck = gate_(req.brandId, req.adminKey);
  if (!authCheck.ok) return authCheck;

  const brand= authCheck.value.brand;
  const expiresIn = req.expiresIn || 3600; // 1 hour default

  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const payload = {
    brand: brand.id,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresIn,
    scope: req.scope || 'events'
  };

  const headerB64 = Utilities.base64EncodeWebSafe(JSON.stringify(header));
  const payloadB64 = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  const brandSecret = getAdminSecret_(brand.id);
  if (!brandSecret) {
    return UserFriendlyErr_(ERR.INTERNAL, 'Brand secret not configured', { brandId: brand.id }, 'api_generateToken');
  }
  const signature = generateJWTSignature_(headerB64 + '.' + payloadB64, brandSecret);

  const token = headerB64 + '.' + payloadB64 + '.' + signature;

  return Ok({
    token,
    expiresIn,
    expiresAt: new Date((payload.exp * 1000)).toISOString(),
    usage: `Authorization: Bearer ${token}`
  });
}

function generateJWTSignature_(data, secret) {
  const signature = Utilities.computeHmacSha256Signature(data, secret);
  return Utilities.base64EncodeWebSafe(signature);
}

/**
 * Get available event templates for a brand
 * Admin calls this to populate template picker dropdown/tiles
 *
 * STAGE-GATE: Only returns MVP-tier templates by default.
 * V2 templates are filtered out until V2 features ship.
 *
 * @tier mvp
 * @param {Object} payload - Request payload
 * @param {string} payload.brandId - Brand ID
 * @param {boolean} payload.includeV2 - Include V2 templates (admin override, default false)
 * @param {boolean} payload.grouped - Return templates grouped by category (default true)
 * @param {Object} ctx - Request context
 */
function api_getEventTemplates(payload, ctx) {
  return runSafe('api_getEventTemplates', () => {
    const brandId = (ctx && ctx.brandId) || (payload && payload.brandId) || 'root';
    const includeV2 = payload && payload.includeV2 === true;
    const grouped = payload && payload.grouped !== false;  // Default to grouped
    const cfg = getBrandTemplateConfig_(brandId);

    // Stage-gate: Filter to MVP tier only (unless includeV2 is explicitly true)
    const tier = includeV2 ? null : TEMPLATE_TIER.MVP;

    // Get templates for this brand, filtered by tier
    const brandTemplates = cfg.templates || [];
    let templates;

    if (tier) {
      // Filter by both brand config AND tier
      templates = getTemplatesByTier_(tier).filter(function(t) {
        return brandTemplates.indexOf(t.id) !== -1;
      });
    } else {
      // Only filter by brand config
      templates = getEventTemplates_().filter(function(t) {
        return brandTemplates.indexOf(t.id) !== -1;
      });
    }

    // Sort templates by displayOrder
    templates.sort(function(a, b) {
      return (a.displayOrder || 99) - (b.displayOrder || 99);
    });

    // Calculate default template (prefer brand default if in available templates)
    let defaultTemplateId = cfg.defaultTemplateId || 'custom';
    const templateIds = templates.map(function(t) { return t.id; });
    if (templateIds.indexOf(defaultTemplateId) === -1) {
      // Brand default not available after tier filtering, fall back to first available
      defaultTemplateId = templates.length > 0 ? templates[0].id : 'custom';
    }

    diag_('info', 'api_getEventTemplates', 'loaded templates', {
      brandId: brandId,
      tier: tier || 'all',
      templateCount: templates.length,
      defaultTemplateId: defaultTemplateId,
      grouped: grouped
    });

    // Return grouped or flat based on request
    if (grouped) {
      // Group templates by category
      const groups = getGroupedTemplates_(tier);
      // Filter groups to only include templates available for this brand
      const filteredGroups = groups.map(function(group) {
        return {
          id: group.id,
          label: group.label,
          description: group.description,
          icon: group.icon,
          templates: group.templates.filter(function(t) {
            return brandTemplates.indexOf(t.id) !== -1;
          })
        };
      }).filter(function(group) {
        return group.templates.length > 0;
      });

      return Ok({
        groups: filteredGroups,
        items: templates,  // Also include flat list for backward compatibility
        defaultTemplateId: defaultTemplateId,
        tier: tier || 'all'
      });
    }

    return Ok({
      items: templates,
      defaultTemplateId: defaultTemplateId,
      tier: tier || 'all'
    });
  });
}

// =============================================================================
// [S12] GUARDS & INPUT VALIDATION
// =============================================================================
// Authorization guards, rate limiting, and input sanitization.
//
// Key exports:
//   gate_(brandId, adminKey, ip)   - Auth guard with rate limiting
//   assertScopeAllowed_(brand, s)  - Check scope permissions
//   isUrl(s, maxLength)            - URL validation
//   safeJSONParse_(json, default)  - Safe JSON parsing
//   sanitizeInput_(input, max)     - Input sanitization
//   sanitizeId_(id)                - ID sanitization
//
// Configuration:
//   RATE_MAX_PER_MIN = 10          - Max requests per minute
//   RATE_LOCKOUT_MINS = 15         - Lockout duration
//   MAX_FAILED_AUTH = 5            - Max failed auth attempts
//
// Fixed: Bug #18 - Improved rate limiting with IP tracking and backoff
// =============================================================================

const RATE_MAX_PER_MIN = 10; // Reduced from 20
const RATE_LOCKOUT_MINS = 15;
const MAX_FAILED_AUTH = 5;

function gate_(brandId, adminKey, ipAddress = null){
  const brand=findBrand_(brandId);
  if(!brand) return Err(ERR.NOT_FOUND,'Unknown brand');

  const brandSecret = getAdminSecret_(brand.id);
  const cache = CacheService.getScriptCache();

  // Track failed authentication attempts per IP
  if (brandSecret && adminKey !== brandSecret) {
    if (ipAddress) {
      const failKey = `auth_fail:${brandId}:${ipAddress}`;
      const fails = Number(cache.get(failKey) || '0');

      if (fails >= MAX_FAILED_AUTH) {
        return Err(ERR.RATE_LIMITED, `Too many failed authentication attempts. Try again in ${RATE_LOCKOUT_MINS} minutes.`);
      }

      cache.put(failKey, String(fails + 1), RATE_LOCKOUT_MINS * 60); // 15 min lockout
    }
    return Err(ERR.BAD_INPUT,'Invalid admin key');
  }

  // Rate limiting per brand AND per IP (if available)
  const identifier = ipAddress ? `${brandId}:${ipAddress}` : brandId;
  const rateKey = `rate:${identifier}:${new Date().toISOString().slice(0,16)}`;
  const n = Number(cache.get(rateKey)||'0');
  if (n >= RATE_MAX_PER_MIN) return Err(ERR.RATE_LIMITED,'Too many requests. Please try again later.');
  cache.put(rateKey, String(n+1), 60);

  return Ok({brand});
}

function assertScopeAllowed_(brand, scope){
  const allowed = (brand.scopesAllowed && brand.scopesAllowed.length)
    ? brand.scopesAllowed : ['events','leagues','tournaments'];
  if (!allowed.includes(scope)) {
    return UserFriendlyErr_(ERR.BAD_INPUT, `Scope not enabled: ${scope}`, { scope, brandId: brand.id, allowedScopes: allowed }, 'assertScopeAllowed_');
  }
  return Ok();
}

// Fixed: Bug #32 - Comprehensive URL validation
function isUrl(s, maxLength = 2048) {
  if (!s || typeof s !== 'string') return false;

  const urlStr = String(s);

  // Length check
  if (urlStr.length > maxLength) return false;

  try {
    const url = new URL(urlStr);

    // Only allow http/https protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }

    // Blocklist dangerous patterns
    const dangerous = ['javascript:', 'data:', 'vbscript:', 'file:'];
    if (dangerous.some(d => urlStr.toLowerCase().includes(d))) {
      return false;
    }

    // Prevent SSRF - block private IPs and localhost
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('127.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('172.16.') ||
        hostname.startsWith('172.17.') ||
        hostname.startsWith('172.18.') ||
        hostname.startsWith('172.19.') ||
        hostname.startsWith('172.20.') ||
        hostname.startsWith('172.21.') ||
        hostname.startsWith('172.22.') ||
        hostname.startsWith('172.23.') ||
        hostname.startsWith('172.24.') ||
        hostname.startsWith('172.25.') ||
        hostname.startsWith('172.26.') ||
        hostname.startsWith('172.27.') ||
        hostname.startsWith('172.28.') ||
        hostname.startsWith('172.29.') ||
        hostname.startsWith('172.30.') ||
        hostname.startsWith('172.31.') ||
        hostname.startsWith('169.254.')) { // Link-local
      return false;
    }

    return true;
  } catch(_) {
    return false;
  }
}

// Fixed: Bug #28 - Safe JSON parsing helper
function safeJSONParse_(jsonString, defaultValue = {}) {
  try {
    return JSON.parse(jsonString || '{}');
  } catch (e) {
    diag_('error', 'safeJSONParse_', 'JSON parse failed', {
      error: e.message,
      jsonString: String(jsonString).slice(0, 200)
    });
    return defaultValue;
  }
}

// Delegate to SecurityMiddleware for consistent sanitization across codebase
// See SecurityMiddleware.gs for implementation details
function sanitizeInput_(input, maxLength = 1000) {
  return SecurityMiddleware_sanitizeInput(input, maxLength);
}

function sanitizeId_(id) {
  return SecurityMiddleware_sanitizeId(id);
}

function sanitizeSpreadsheetValue_(value) {
  return SecurityMiddleware_sanitizeSpreadsheetValue(value);
}

// =============================================================================
// [S13] SHEET UTILITIES
// =============================================================================
// Spreadsheet access and sheet initialization utilities.
// Each sheet type has an _ensure* function that creates it if missing.
//
// Key exports:
//   getStoreSheet_(brand, scope)     - Get/create scope sheet (EVENTS, SPONSORS)
//   _ensureAnalyticsSheet_(ssId)     - Get/create ANALYTICS sheet
//   _ensureShortlinksSheet_(ssId)    - Get/create SHORTLINKS sheet
//
// NOTE: These could be extracted to SheetUtils.gs in the future for better
// modularity. Keeping here for now to minimize risk during refactoring.
// =============================================================================

function getStoreSheet_(brand, scope){
  const ss = SpreadsheetApp.openById(brand.store.spreadsheetId);
  const title = scope.toUpperCase();
  let sh = ss.getSheetByName(title);
  if (!sh){
    sh = ss.insertSheet(title);
    sh.appendRow(['id','brandId','templateId','dataJSON','createdAt','slug']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _ensureAnalyticsSheet_(spreadsheetId){
  // If no spreadsheet ID provided, use root brand
  if (!spreadsheetId) {
    const rootBrand = findBrand_('root');
    if (rootBrand && rootBrand.store && rootBrand.store.spreadsheetId) {
      spreadsheetId = rootBrand.store.spreadsheetId;
    }
  }

  const ss = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActive();

  let sh = ss.getSheetByName('ANALYTICS');
  if (!sh){
    sh = ss.insertSheet('ANALYTICS');
    // Extended columns for sponsor/BBN attribution: sessionId ties events together, visibleSponsorIds for context
    sh.appendRow(['timestamp','eventId','surface','metric','sponsorId','value','token','userAgent','sessionId','visibleSponsorIds']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _ensureShortlinksSheet_(spreadsheetId){
  // If no spreadsheet ID provided, use root brand
  if (!spreadsheetId) {
    const rootBrand = findBrand_('root');
    if (rootBrand && rootBrand.store && rootBrand.store.spreadsheetId) {
      spreadsheetId = rootBrand.store.spreadsheetId;
    }
  }

  const ss = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActive();

  let sh = ss.getSheetByName('SHORTLINKS');
  if (!sh){
    sh = ss.insertSheet('SHORTLINKS');
    sh.appendRow(['token','targetUrl','eventId','sponsorId','surface','createdAt']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// =============================================================================
// [S14] STATUS & SETUP APIs
// =============================================================================
// System status, health checks, and setup verification APIs.
// Used by Status.html and deployment verification scripts.
//
// Key exports:
//   api_status(brandId)            - Database connectivity check
//   api_statusPure(brandId)        - Pure status (no side effects)
//   api_statusMvp(brandId)         - MVP-specific status check
//   api_setupCheck(brandId)        - Comprehensive setup verification
//   checkAnalyticsSheetHealth_()   - Analytics sheet validation
//   checkSharedAnalyticsContract_() - Contract validation
//   api_checkPermissions(brandId)  - Permission verification
// =============================================================================

/**
 * System status check - verifies database connectivity and returns build info
 * @tier mvp
 */
function api_status(brandId){
  return runSafe('api_status', () => {
    try {
      // Get brand info if provided
      const brand= brandId ? findBrand_(brandId) : findBrand_('root');
      if (!brand) {
        return Err(ERR.NOT_FOUND, `Brand not found: ${brandId}`);
      }

      const brandInfo = brand.id;

      // Use brand's spreadsheet ID instead of getActive() for web app context
      const ss = SpreadsheetApp.openById(brand.store.spreadsheetId);
      if (!ss) {
        return Err(ERR.INTERNAL, `Failed to open spreadsheet (returned null): ${brand.store.spreadsheetId}`);
      }
      const id = ss.getId();
      const dbOk = !!id;

      return _ensureOk_('api_status', SC_STATUS, Ok({
        build: ZEB.BUILD_ID,
        contract: ZEB.CONTRACT_VER,
        brand: brandInfo,
        time: new Date().toISOString(),
        db: { ok: dbOk, id }
      }));
    } catch(e) {
      // Enhanced error handling with setup guidance
      const errorMsg = String(e.message || e);
      const setupUrl = ScriptApp.getService().getUrl() + '?p=setup';

      if (errorMsg.includes('not found') || errorMsg.includes('does not exist')) {
        return Err(ERR.INTERNAL,
          `Spreadsheet not found or inaccessible. Please check:\n` +
          `1. Spreadsheet ID is correct: ${brand.store.spreadsheetId}\n` +
          `2. Script owner has access to the spreadsheet\n` +
          `3. Run setup check: ${setupUrl}`
        );
      }

      if (errorMsg.includes('permission') || errorMsg.includes('authorization')) {
        return Err(ERR.INTERNAL,
          `Permission denied accessing spreadsheet. Please:\n` +
          `1. Ensure script owner can edit the spreadsheet\n` +
          `2. Check OAuth scopes include spreadsheets access\n` +
          `3. Re-authorize the deployment if needed`
        );
      }

      return Err(ERR.INTERNAL,
        `Status check failed: ${errorMsg}\n` +
        `Run setup diagnostics: ${setupUrl}`
      );
    }
  });
}

/**
 * Pure status endpoint for health checks - production SLO anchor
 * Returns a flat JSON response suitable for quick health monitoring.
 *
 * External uptime / SLO is measured via ?p=status.
 *
 * This endpoint is the canonical health check for production monitoring:
 * - Always returns flat JSON (never HTML)
 * - Includes optional db.ok health flag for datastore connectivity
 * - Fast and reliable for SLO measurement
 *
 * If brand is invalid, returns ok:false with message.
 * If db check fails, returns ok:true but db.ok:false (API is live, db is not).
 *
 * @tier mvp
 * @param {string} brandId - Brand identifier (defaults to 'root')
 * @returns {Object} Flat status object { ok, buildId, brandId, time, db: { ok }, [message] }
 */
function api_statusPure(brandId) {
  const brand = brandId ? findBrand_(brandId) : findBrand_('root');

  if (!brand) {
    return {
      ok: false,
      buildId: ZEB.BUILD_ID,
      brandId: brandId || 'unknown',
      time: new Date().toISOString(),
      db: { ok: false },
      message: `Brand not found: ${brandId || 'undefined'}`
    };
  }

  // Optional db health check - fast spreadsheet connectivity test
  let dbOk = false;
  try {
    if (brand.store && brand.store.spreadsheetId) {
      const ss = SpreadsheetApp.openById(brand.store.spreadsheetId);
      dbOk = !!ss;
    }
  } catch (e) {
    // db check failed - report but don't fail the overall status
    dbOk = false;
  }

  return {
    ok: true,
    buildId: ZEB.BUILD_ID,
    brandId: brand.id,
    time: new Date().toISOString(),
    db: { ok: dbOk }
  };
}

/**
 * GAS /whoami endpoint - returns deployment and account information
 * Story 4: Returns structured JSON for CI consumption and comparison with Worker /env-status
 *
 * @tier mvp
 * @param {string} brandId - Brand identifier (defaults to 'root')
 * @returns {Object} Flat object { scriptId, deploymentId, email, buildId, brand, time }
 */
function api_whoami(brandId) {
  const brand = brandId ? findBrand_(brandId) : findBrand_('root');
  const brandName = brand ? brand.id : (brandId || 'root');

  // Get script ID
  let scriptId = 'unknown';
  try {
    scriptId = ScriptApp.getScriptId();
  } catch (e) {
    // Script ID not available
  }

  // Get deployment ID from web app URL
  // URL format: https://script.google.com/macros/s/{deploymentId}/exec
  let deploymentId = 'unknown';
  try {
    const webAppUrl = ScriptApp.getService().getUrl();
    if (webAppUrl) {
      const match = webAppUrl.match(/\/macros\/s\/([^/]+)\//);
      if (match && match[1]) {
        deploymentId = match[1];
      }
    }
  } catch (e) {
    // Deployment ID not available
  }

  // Get account email (effective user running the script)
  let email = 'unknown';
  try {
    email = Session.getEffectiveUser().getEmail() || 'unknown';
  } catch (e) {
    // Email not available (permission or scope issue)
  }

  return {
    scriptId: scriptId,
    deploymentId: deploymentId,
    email: email,
    buildId: ZEB.BUILD_ID,
    brand: brandName,
    time: new Date().toISOString()
  };
}

/**
 * MVP Status endpoint with analytics health checks
 * Extends api_statusPure with analytics system health verification.
 * Returns "green" status only if all analytics systems are operational.
 *
 * @tier mvp
 * @param {string} brandId - Brand identifier (defaults to 'root')
 * @returns {Object} Status object with analytics health fields:
 *   { ok, buildId, brandId, time, analyticsSheetHealthy, sharedAnalyticsContractOk, [message] }
 */
function api_statusMvp(brandId) {
  const brand = brandId ? findBrand_(brandId) : findBrand_('root');

  if (!brand) {
    return {
      ok: false,
      buildId: ZEB.BUILD_ID,
      brandId: brandId || 'unknown',
      time: new Date().toISOString(),
      analyticsSheetHealthy: false,
      sharedAnalyticsContractOk: false,
      message: `Brand not found: ${brandId || 'undefined'}`
    };
  }

  // Check analytics sheet health
  const analyticsHealth = checkAnalyticsSheetHealth_(brand);

  // Check shared analytics contract
  const contractHealth = checkSharedAnalyticsContract_();

  // Overall status is only OK if all checks pass
  const allHealthy = analyticsHealth.healthy && contractHealth.ok;

  const result = {
    ok: allHealthy,
    buildId: ZEB.BUILD_ID,
    brandId: brand.id,
    time: new Date().toISOString(),
    analyticsSheetHealthy: analyticsHealth.healthy,
    sharedAnalyticsContractOk: contractHealth.ok
  };

  // Add message if any health check failed
  if (!allHealthy) {
    const issues = [];
    if (!analyticsHealth.healthy) {
      issues.push(`Analytics: ${analyticsHealth.reason}`);
    }
    if (!contractHealth.ok) {
      issues.push(`Contract: ${contractHealth.reason}`);
    }
    result.message = issues.join('; ');
  }

  return result;
}

/**
 * Check analytics sheet health
 * Verifies the ANALYTICS sheet exists and is accessible.
 *
 * @param {Object} brand - Brand configuration object
 * @returns {Object} { healthy: boolean, reason: string }
 */
function checkAnalyticsSheetHealth_(brand) {
  try {
    // Verify spreadsheet ID exists
    if (!brand.store || !brand.store.spreadsheetId) {
      return { healthy: false, reason: 'No spreadsheetId configured for brand' };
    }

    // Try to open the spreadsheet
    const ss = SpreadsheetApp.openById(brand.store.spreadsheetId);
    if (!ss) {
      return { healthy: false, reason: 'Could not open spreadsheet' };
    }

    // Check for ANALYTICS sheet
    const analyticsSheet = ss.getSheetByName('ANALYTICS');
    if (!analyticsSheet) {
      // Sheet doesn't exist yet - this is OK for fresh installs
      // The sheet will be created on first analytics write
      return { healthy: true, reason: 'Sheet not yet created (fresh install)' };
    }

    // Verify sheet has the expected header structure
    const headerRow = analyticsSheet.getRange(1, 1, 1, 10).getValues()[0];
    const expectedHeaders = ['timestamp', 'eventId', 'surface', 'metric', 'sponsorId', 'value', 'token', 'userAgent'];

    // Check that at least the required headers are present (in order)
    const hasRequiredHeaders = expectedHeaders.every((h, i) =>
      headerRow[i] && headerRow[i].toString().toLowerCase() === h.toLowerCase()
    );

    if (!hasRequiredHeaders) {
      return { healthy: false, reason: 'ANALYTICS sheet has invalid header structure' };
    }

    return { healthy: true, reason: 'OK' };

  } catch (e) {
    return { healthy: false, reason: `Error checking analytics sheet: ${e.message}` };
  }
}

/**
 * Check shared analytics contract validity
 * Performs a quick schema check to verify the SharedAnalytics contract is properly configured.
 *
 * @returns {Object} { ok: boolean, reason: string }
 */
function checkSharedAnalyticsContract_() {
  try {
    // Verify the SC_SHARED_ANALYTICS schema constant exists and has required structure
    if (typeof SC_SHARED_ANALYTICS === 'undefined') {
      return { ok: false, reason: 'SC_SHARED_ANALYTICS schema not defined' };
    }

    // Verify required top-level properties exist in schema
    const requiredProps = ['lastUpdatedISO', 'summary', 'surfaces'];
    const schemaProps = SC_SHARED_ANALYTICS.properties || {};

    for (const prop of requiredProps) {
      if (!schemaProps[prop]) {
        return { ok: false, reason: `Missing required schema property: ${prop}` };
      }
    }

    // Verify summary sub-schema has required fields
    const summarySchema = schemaProps.summary;
    if (!summarySchema || !summarySchema.properties) {
      return { ok: false, reason: 'Summary schema not properly defined' };
    }

    const requiredSummaryFields = [
      'totalImpressions', 'totalClicks', 'totalQrScans',
      'totalSignups', 'uniqueEvents', 'uniqueSponsors'
    ];

    for (const field of requiredSummaryFields) {
      if (!summarySchema.properties[field]) {
        return { ok: false, reason: `Missing required summary field: ${field}` };
      }
    }

    // Verify surfaces array schema
    const surfacesSchema = schemaProps.surfaces;
    if (!surfacesSchema || surfacesSchema.type !== 'array') {
      return { ok: false, reason: 'Surfaces schema not properly defined as array' };
    }

    return { ok: true, reason: 'Contract schema validated' };

  } catch (e) {
    return { ok: false, reason: `Error validating contract: ${e.message}` };
  }
}

/**
 * Health check endpoint for CI/CD pipelines
 * Story 5: Lightweight health check that validates:
 * - GAS connectivity (can read config/control sheet)
 * - Events index is readable
 *
 * Returns a flat response suitable for quick CI health monitoring.
 * The Worker will wrap this with status code and version info.
 *
 * @tier mvp
 * @param {string} brandId - Brand identifier (defaults to 'root')
 * @returns {Object} Health check result:
 *   {
 *     ok: boolean,
 *     gasBuildId: string,
 *     time: string,
 *     checks: {
 *       gas: "ok" | "error",
 *       eventsIndex: "ok" | "error"
 *     },
 *     [errors]: string[] // Only present if checks failed
 *   }
 */
function api_health(brandId) {
  const startTime = Date.now();
  const errors = [];
  const checks = {
    gas: 'error',
    eventsIndex: 'error'
  };

  // Get brand - use root as default
  const brand = brandId ? findBrand_(brandId) : findBrand_('root');

  if (!brand) {
    return {
      ok: false,
      gasBuildId: ZEB.BUILD_ID,
      time: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      checks: checks,
      errors: [`Brand not found: ${brandId || 'root'}`]
    };
  }

  // Check 1: GAS connectivity - verify we can access the spreadsheet
  try {
    if (!brand.store || !brand.store.spreadsheetId) {
      errors.push('No spreadsheetId configured for brand');
    } else {
      const ss = SpreadsheetApp.openById(brand.store.spreadsheetId);
      if (ss && ss.getId()) {
        checks.gas = 'ok';
      } else {
        errors.push('Could not access spreadsheet');
      }
    }
  } catch (e) {
    errors.push(`GAS check failed: ${e.message || String(e)}`);
  }

  // Check 2: Events index - verify EVENTS sheet exists and is readable
  try {
    if (checks.gas === 'ok' && brand.store && brand.store.spreadsheetId) {
      const ss = SpreadsheetApp.openById(brand.store.spreadsheetId);
      const eventsSheet = ss.getSheetByName('EVENTS');
      if (eventsSheet) {
        // Quick read test - just get the last row
        const lastRow = eventsSheet.getLastRow();
        checks.eventsIndex = 'ok';
      } else {
        errors.push('EVENTS sheet not found');
      }
    } else if (checks.gas !== 'ok') {
      errors.push('Skipped eventsIndex check due to GAS connectivity failure');
    }
  } catch (e) {
    errors.push(`Events index check failed: ${e.message || String(e)}`);
  }

  const allOk = checks.gas === 'ok' && checks.eventsIndex === 'ok';

  const result = {
    ok: allOk,
    gasBuildId: ZEB.BUILD_ID,
    brandId: brand.id,
    time: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    checks: checks
  };

  // Only include errors array if there are errors
  if (errors.length > 0) {
    result.errors = errors;
  }

  return result;
}

/**
 * Comprehensive setup verification endpoint for first-time configuration
 * Checks all critical setup requirements and provides actionable guidance
 * @tier mvp
 */
function api_setupCheck(brandId) {
  return runSafe('api_setupCheck', () => {
    const checks = [];
    const issues = [];
    const warnings = [];
    const fixes = [];

    const brand= brandId ? findBrand_(brandId) : findBrand_('root');
    if (!brand) {
      return Err(ERR.NOT_FOUND, `Brand not found: ${brandId || 'root'}`);
    }

    // Check 1: Brand Configuration
    checks.push({ name: 'Brand Configuration', status: 'checking' });
    try {
      if (!brand.id || !brand.name || !brand.store) {
        issues.push('Brand configuration incomplete');
        fixes.push('Verify brand configuration in Config.gs');
        checks[0].status = 'error';
      } else {
        checks[0].status = 'ok';
        checks[0].details = `Brand: ${brand.name} (${brand.id})`;
      }
    } catch(e) {
      checks[0].status = 'error';
      checks[0].error = String(e.message);
    }

    // Check 2: Spreadsheet Access
    checks.push({ name: 'Spreadsheet Access', status: 'checking' });
    try {
      const spreadsheetId = brand.store.spreadsheetId;
      if (!spreadsheetId) {
        issues.push('Spreadsheet ID not configured');
        fixes.push('Set spreadsheetId in Config.gs for brand: ' + brand.id);
        checks[1].status = 'error';
      } else {
        try {
          const ss = SpreadsheetApp.openById(spreadsheetId);
          if (!ss) {
            throw new Error('SpreadsheetApp.openById returned null');
          }
          const name = ss.getName();
          const id = ss.getId();
          checks[1].status = 'ok';
          checks[1].details = `Connected to: "${name}" (${id})`;

          // Verify ownership/edit access
          try {
            ss.getSheetByName('TEST_PERMISSIONS');
            const testSheet = ss.insertSheet('TEST_PERMISSIONS');
            ss.deleteSheet(testSheet);
            checks[1].permissions = 'owner/editor';
          } catch(permErr) {
            warnings.push('Limited spreadsheet permissions - may affect some operations');
            checks[1].permissions = 'viewer/limited';
          }

        } catch(accessErr) {
          const errMsg = String(accessErr.message);
          checks[1].status = 'error';
          checks[1].error = errMsg;

          if (errMsg.includes('not found')) {
            issues.push(`Spreadsheet not found: ${spreadsheetId}`);
            fixes.push('Update spreadsheetId in Config.gs with a valid Google Sheets ID');
            fixes.push('Ensure spreadsheet ID is from URL: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit');
          } else if (errMsg.includes('permission')) {
            issues.push('No permission to access spreadsheet');
            fixes.push('Share the spreadsheet with script owner (zeventbook@gmail.com)');
            fixes.push('Grant at least "Editor" access to the spreadsheet');
          } else {
            issues.push('Cannot access spreadsheet: ' + errMsg);
            fixes.push('Verify spreadsheet ID and permissions');
          }
        }
      }
    } catch(e) {
      checks[1].status = 'error';
      checks[1].error = String(e.message);
    }

    // Check 3: Admin Secrets
    checks.push({ name: 'Admin Secrets', status: 'checking' });
    try {
      const secret = getAdminSecret_(brand.id);
      if (!secret) {
        warnings.push(`Admin secret not set for brand: ${brand.id}`);
        fixes.push(`Set admin secret via Script Properties: ADMIN_SECRET_${brand.id.toUpperCase()}`);
        fixes.push('Go to: Project Settings > Script Properties > Add property');
        checks[2].status = 'warning';
        checks[2].details = 'Not configured (write operations will fail)';
      } else {
        checks[2].status = 'ok';
        checks[2].details = 'Configured (length: ' + secret.length + ' chars)';
      }
    } catch(e) {
      checks[2].status = 'error';
      checks[2].error = String(e.message);
    }

    // Check 4: Deployment Settings
    checks.push({ name: 'Deployment Configuration', status: 'checking' });
    try {
      const deploymentUrl = ScriptApp.getService().getUrl();
      if (!deploymentUrl) {
        issues.push('No active deployment found');
        fixes.push('Deploy as Web App: Deploy > New deployment');
        fixes.push('Set: Execute as = Me, Who has access = Anyone');
        checks[3].status = 'error';
      } else {
        checks[3].status = 'ok';
        checks[3].details = deploymentUrl;

        // Check if deployment is accessible
        try {
          const isAnonymous = ScriptApp.getService().isEnabled();
          checks[3].access = isAnonymous ? 'anonymous' : 'requires-auth';

          if (!isAnonymous) {
            warnings.push('Deployment may require authentication');
            fixes.push('Edit deployment: Who has access = Anyone');
          }
        } catch(e) {
          // Can't determine access level
        }
      }
    } catch(e) {
      checks[3].status = 'error';
      checks[3].error = String(e.message);
    }

    // Check 5: OAuth Scopes
    checks.push({ name: 'OAuth Scopes', status: 'checking' });
    try {
      // Try to access services to verify scopes
      const scopeTests = [];

      // Spreadsheets scope
      try {
        SpreadsheetApp.getActiveSpreadsheet();
        scopeTests.push({ scope: 'spreadsheets', ok: true });
      } catch(e) {
        if (brand.store.spreadsheetId) {
          try {
            SpreadsheetApp.openById(brand.store.spreadsheetId);
            scopeTests.push({ scope: 'spreadsheets', ok: true });
          } catch(e2) {
            scopeTests.push({ scope: 'spreadsheets', ok: false, error: 'Permission denied' });
          }
        }
      }

      // External requests scope
      try {
        UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
        scopeTests.push({ scope: 'external_request', ok: true });
      } catch(e) {
        scopeTests.push({ scope: 'external_request', ok: false, error: String(e.message) });
      }

      const failedScopes = scopeTests.filter(t => !t.ok);
      if (failedScopes.length > 0) {
        warnings.push('Some OAuth scopes may not be authorized');
        fixes.push('Re-authorize deployment to grant all permissions');
        checks[4].status = 'warning';
        checks[4].details = scopeTests;
      } else {
        checks[4].status = 'ok';
        checks[4].details = 'All required scopes authorized';
      }
    } catch(e) {
      checks[4].status = 'error';
      checks[4].error = String(e.message);
    }

    // Check 6: Required Sheets Structure
    checks.push({ name: 'Database Structure', status: 'checking' });
    try {
      if (checks[1].status === 'ok') {
        const ss = SpreadsheetApp.openById(brand.store.spreadsheetId);
        const existingSheets = ss.getSheets().map(s => s.getName());

        const requiredSheets = ['EVENTS', 'SPONSORS', 'ANALYTICS', 'SHORTLINKS', 'DIAG'];
        const missingSheets = requiredSheets.filter(name => !existingSheets.includes(name));

        if (missingSheets.length > 0) {
          warnings.push('Some data sheets will be auto-created on first use');
          checks[5].status = 'warning';
          checks[5].details = `Missing sheets: ${missingSheets.join(', ')}`;
          checks[5].note = 'These will be created automatically when needed';
        } else {
          checks[5].status = 'ok';
          checks[5].details = 'All required sheets present';
        }
      } else {
        checks[5].status = 'skipped';
        checks[5].details = 'Spreadsheet not accessible';
      }
    } catch(e) {
      checks[5].status = 'warning';
      checks[5].error = String(e.message);
    }

    // Determine overall status
    const hasErrors = checks.some(c => c.status === 'error');
    const hasWarnings = checks.some(c => c.status === 'warning');

    let overallStatus = 'ok';
    let message = 'All setup checks passed! System is ready to use.';

    if (hasErrors) {
      overallStatus = 'error';
      message = `Setup incomplete. Found ${issues.length} critical issue(s) that must be fixed.`;
    } else if (hasWarnings) {
      overallStatus = 'warning';
      message = `Setup mostly complete. Found ${warnings.length} warning(s) that should be addressed.`;
    }

    return Ok({
      status: overallStatus,
      message,
      brand: brand.id,
      timestamp: new Date().toISOString(),
      checks,
      issues,
      warnings,
      fixes,
      nextSteps: fixes.length > 0 ? fixes : [
        'Your setup is complete!',
        'Test the API: ' + ScriptApp.getService().getUrl() + '?page=status&brand=' + brand.id,
        'View admin dashboard: ' + ScriptApp.getService().getUrl() + '?page=admin&brand=' + brand.id
      ]
    });
  });
}

/**
 * Quick permission check endpoint
 * Tests if the deployment has necessary permissions to access spreadsheets
 *
 * Usage: GET /exec?page=permissions or GET /exec?page=permissions&brand=abc
 *
 * Returns:
 * - ok: true if all permissions are granted
 * - error: detailed error message if permissions are missing
 * - details: information about what was tested
 * @tier mvp
 */
function api_checkPermissions(brandId) {
  return runSafe('api_checkPermissions', () => {
    const results = {
      deployment: {},
      spreadsheet: {},
      oauth: {},
      recommendations: []
    };

    // Check brand
    const brand = brandId ? findBrand_(brandId) : findBrand_('root');
    if (!brand) {
      return Err(ERR.NOT_FOUND, `Brand not found: ${brandId || 'root'}`);
    }

    results.brand = {
      id: brand.id,
      name: brand.name,
      spreadsheetId: brand.store?.spreadsheetId || 'not configured'
    };

    // Check deployment info
    try {
      const service = ScriptApp.getService();
      results.deployment.url = service.getUrl();
      results.deployment.configured = true;
    } catch (e) {
      results.deployment.error = 'Could not get deployment URL';
      results.deployment.configured = false;
      results.recommendations.push('Deploy the script as a web app');
    }

    // Check spreadsheet access
    if (brand.store?.spreadsheetId) {
      try {
        const ss = SpreadsheetApp.openById(brand.store.spreadsheetId);
        if (!ss) {
          throw new Error('SpreadsheetApp.openById returned null');
        }
        const name = ss.getName();
        const id = ss.getId();

        results.spreadsheet.accessible = true;
        results.spreadsheet.name = name;
        results.spreadsheet.id = id;
        results.spreadsheet.message = 'Spreadsheet access granted';
      } catch (e) {
        results.spreadsheet.accessible = false;
        results.spreadsheet.error = String(e.message);

        if (e.message.includes('not found') || e.message.includes('does not exist')) {
          results.spreadsheet.message = 'Spreadsheet not found';
          results.recommendations.push('Verify spreadsheet ID in Config.gs: ' + brand.store.spreadsheetId);
          results.recommendations.push('Check that spreadsheet exists: https://docs.google.com/spreadsheets/d/' + brand.store.spreadsheetId);
        } else if (e.message.includes('permission') || e.message.includes('authorization')) {
          results.spreadsheet.message = 'Permission denied';
          results.recommendations.push('The deployment needs to be authorized to access spreadsheets');
          results.recommendations.push('Steps to authorize:');
          results.recommendations.push('1. Open Apps Script editor: https://script.google.com');
          results.recommendations.push('2. Select function "api_checkPermissions" and click Run');
          results.recommendations.push('3. Grant permissions when prompted');
          results.recommendations.push('4. Re-deploy the web app');
        } else {
          results.spreadsheet.message = 'Unexpected error accessing spreadsheet';
          results.recommendations.push('Error: ' + e.message);
        }
      }
    } else {
      results.spreadsheet.accessible = false;
      results.spreadsheet.message = 'No spreadsheet ID configured';
      results.recommendations.push('Configure spreadsheet ID in Config.gs for brand: ' + brand.id);
    }

    // Check OAuth scopes
    const scopeTests = [];

    // Test spreadsheet scope
    try {
      if (results.spreadsheet.accessible) {
        scopeTests.push({ scope: 'spreadsheets', granted: true });
      } else {
        // Try to open any spreadsheet to test the scope
        try {
          SpreadsheetApp.getActiveSpreadsheet();
          scopeTests.push({ scope: 'spreadsheets', granted: true });
        } catch (e) {
          scopeTests.push({
            scope: 'spreadsheets',
            granted: false,
            error: 'Spreadsheet access not authorized'
          });
        }
      }
    } catch (e) {
      scopeTests.push({
        scope: 'spreadsheets',
        granted: false,
        error: String(e.message)
      });
    }

    // Test external request scope
    try {
      UrlFetchApp.fetch('https://www.google.com', {
        muteHttpExceptions: true,
        method: 'HEAD'
      });
      scopeTests.push({ scope: 'external_request', granted: true });
    } catch (e) {
      scopeTests.push({
        scope: 'external_request',
        granted: false,
        error: String(e.message)
      });
      results.recommendations.push('External request scope not granted (may be needed for webhooks)');
    }

    results.oauth.scopes = scopeTests;
    results.oauth.allGranted = scopeTests.every(s => s.granted);

    // Determine overall status
    const allOk = results.deployment.configured &&
                  results.spreadsheet.accessible &&
                  results.oauth.allGranted;

    if (allOk) {
      return Ok({
        status: 'ok',
        message: 'All permissions are properly configured!',
        details: results,
        nextSteps: [
          'Your deployment is ready to use',
          'Test the API: ' + (results.deployment.url || '') + '?page=status&brand=' + brand.id,
          'View admin: ' + (results.deployment.url || '') + '?page=admin&brand=' + brand.id
        ]
      });
    } else {
      return Ok({
        status: 'error',
        message: 'Permission issues detected',
        details: results,
        recommendations: results.recommendations,
        helpUrl: 'See APPS_SCRIPT_DEPLOYMENT_GUIDE.md for detailed instructions'
      });
    }
  });
}

// =============================================================================
// [S15] HEALTH & CONFIG APIs
// =============================================================================
// Lightweight health check and configuration endpoints.
//
// Key exports:
//   api_healthCheck()  - Simple alive ping
//   api_getConfig(arg) - Brand/environment configuration (with ETag caching)
// =============================================================================

function api_healthCheck(){
  return runSafe('api_healthCheck', () => {
    diag_('info','health','ping',{build:ZEB.BUILD_ID});
    return Ok({ checks:[{ ok:true, message:'alive' }] });
  });
}

/**
 * Get brand/environment configuration
 * @tier mvp
 */
function api_getConfig(arg){
  return runSafe('api_getConfig', () => {
    const brands = loadBrands_().map(t => ({
      id:t.id, name:t.name, scopesAllowed:t.scopesAllowed||['events','leagues','tournaments']
    }));
    const value = { brands, templates:TEMPLATES, build:ZEB.BUILD_ID };
    const etag = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(value)));
    if (arg?.ifNoneMatch === etag) return { ok:true, notModified:true, etag };
    return { ok:true, etag, value };
  });
}

// =============================================================================
// [S16] EVENT CONTRACT HYDRATION
// =============================================================================
// Transforms raw spreadsheet data into canonical Event shape.
// Single source of truth per /schemas/event.schema.json and EVENT_CONTRACT.md.
//
// Key exports:
//   EVENT_DEFAULTS_            - Default values for event fields
//   _buildEventContract_(row)  - Build canonical Event from row data
//
// This is THE contract boundary - if a field isn't in event.schema.json,
// it doesn't exist in the output. All surfaces get identical Event shapes.
// =============================================================================

/**
 * Default values for event fields per EVENT_CONTRACT.md v2.0 (MVP + V2-Ready)
 * @private
 */
const EVENT_DEFAULTS_ = {
  // Schedule/Standings/Bracket (MVP Optional)
  schedule: null,
  standings: null,
  bracket: null,

  // CTAs (MVP Required)
  ctas: {
    primary: {
      label: 'Sign Up',
      url: ''
    },
    secondary: null
  },

  // Sponsors (V2 Optional - null per schema)
  sponsors: null,

  // Media (V2 Optional - null per schema)
  media: null,

  // External Data (V2 Optional - null per schema)
  externalData: null,

  // Analytics (Reserved - null per schema)
  analytics: null,

  // Payments (Reserved - null per schema)
  payments: null,

  // Settings (MVP Required) - must match /schemas/event.schema.json Settings
  settings: {
    // MVP Required
    showSchedule: false,
    showStandings: false,
    showBracket: false,
    // MVP Optional (V2 content but MVP toggles)
    showSponsors: false,
    // Feature 4: Template-Aware Content Section Toggles (default true for backwards compat)
    showVideo: true,
    showMap: true,
    showGallery: true,
    // MVP Optional - surface-specific toggles (default true)
    showSponsorBanner: true,
    showSponsorStrip: true,
    showLeagueStrip: true,
    showQRSection: true
  }
};

/**
 * Lifecycle phase enum constants
 * Used by all surfaces (Admin, Public, Display, Poster, SharedReport)
 * for consistent event state interpretation.
 *
 * @constant {Object}
 * @property {string} PRE_EVENT - Before event date
 * @property {string} EVENT_DAY - On event date
 * @property {string} POST_EVENT - After event date
 */
const LIFECYCLE_PHASE = {
  PRE_EVENT: 'pre-event',
  EVENT_DAY: 'event-day',
  POST_EVENT: 'post-event'
};

/**
 * Lifecycle phase labels for UI display
 * Matches LIFECYCLE_PHASE keys
 */
const LIFECYCLE_LABELS = {
  'pre-event': 'Pre-Event Preparation',
  'event-day': 'Event Day - Live',
  'post-event': 'Post-Event Analytics'
};

/**
 * Compute event lifecycle phase from startDateISO
 * Single source of truth for lifecycle state interpretation.
 * All bundles use this helper to ensure parity across surfaces.
 *
 * @param {string} startDateISO - Event start date in ISO format (YYYY-MM-DD)
 * @returns {Object} { phase: string, label: string, isLive: boolean }
 * @private
 */
function computeLifecyclePhase_(startDateISO) {
  if (!startDateISO) {
    return {
      phase: LIFECYCLE_PHASE.PRE_EVENT,
      label: LIFECYCLE_LABELS[LIFECYCLE_PHASE.PRE_EVENT],
      isLive: false
    };
  }

  // Parse dates without time component for date-only comparison
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const eventDate = new Date(startDateISO);
  eventDate.setHours(0, 0, 0, 0);

  let phase = LIFECYCLE_PHASE.PRE_EVENT;

  if (eventDate.getTime() === today.getTime()) {
    phase = LIFECYCLE_PHASE.EVENT_DAY;
  } else if (eventDate < today) {
    phase = LIFECYCLE_PHASE.POST_EVENT;
  }

  return {
    phase: phase,
    label: LIFECYCLE_LABELS[phase],
    isLive: phase === LIFECYCLE_PHASE.EVENT_DAY
  };
}

/**
 * Build canonical Event object matching /schemas/event.schema.json
 *
 * THIS IS THE SINGLE SOURCE OF TRUTH FOR EVENT SHAPE.
 * If a field isn't in event.schema.json, it doesn't exist.
 * If it's in the schema, it must be returned here.
 *
 * @param {Array} row - Raw spreadsheet row [id, brandId, templateId, data, createdAt, slug]
 * @param {Object} options - { baseUrl, hydrateSponsors: boolean }
 * @returns {Object} Canonical Event object per /schemas/event.schema.json
 * @see /schemas/event.schema.json
 * @see EVENT_CONTRACT.md
 * @private
 */
/**
 * _buildEventContract_ - Build canonical Event shape from database row
 *
 * STORY 6: This is THE single source of truth for event hydration.
 * All bundle endpoints (Public, Display, Poster, Admin, SharedReport) call this
 * through getEventById_(), ensuring consistent v2 contract compliance.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LEGACY FIELD MAPPINGS (Story 6: Documented, NOT Required for MVP)
 * ═══════════════════════════════════════════════════════════════════════════════
 * These legacy fields are automatically migrated to canonical names at read time:
 *
 * | Legacy Field          | Canonical Field       | Notes                        |
 * |-----------------------|-----------------------|------------------------------|
 * | dateISO               | startDateISO          | YYYY-MM-DD format            |
 * | location              | venue                 | String, venue name           |
 * | venueName             | venue                 | Alternative legacy name      |
 * | ctaLabels[]           | ctas.{primary,second} | Array → object conversion    |
 * | sections.*.enabled    | settings.show*        | Object → boolean conversion  |
 * | videoUrl              | media.videoUrl        | Moved to media object        |
 * | mapEmbedUrl           | media.mapUrl          | Moved to media object        |
 * | sponsorIds            | sponsors[]            | Hydrated from SPONSORS sheet |
 *
 * Frontend consumers MUST read from canonical fields only.
 * Legacy fields are NOT exposed in API responses.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function _buildEventContract_(row, options = {}) {
  const [id, brandId, templateId, dataJson, createdAt, slug] = row;
  const data = safeJSONParse_(dataJson, {});

  // Use canonical base URL for user-facing links (QR codes, shareable URLs)
  // getBaseUrl() returns friendly domain or falls back to GAS URL
  const friendlyBaseUrl = getBaseUrl();
  const rawBaseUrl = options.baseUrl || ScriptApp.getService().getUrl();

  // Extract startDateISO (backward compat: dateISO → startDateISO)
  const startDateISO = data.startDateISO || data.dateISO || '';

  // Extract venue (backward compat: location/venueName → venue)
  const venue = data.venue || data.location || data.venueName || '';

  // Extract signupUrl for links (from data or build default)
  const signupUrl = data.signupUrl || data.ctas?.primary?.url || '';

  // Build links object using friendly URLs
  // These URLs are shown to users and embedded in QR codes
  const links = {
    publicUrl: `${friendlyBaseUrl}/events?brand=${brandId}&id=${id}`,
    displayUrl: `${friendlyBaseUrl}/display?brand=${brandId}&id=${id}&tv=1`,
    posterUrl: `${friendlyBaseUrl}/poster?brand=${brandId}&id=${id}`,
    signupUrl: signupUrl,
    sharedReportUrl: null  // V2 Optional
  };

  // Generate QR codes as base64 PNG data URIs
  const qr = {
    public: generateQRDataUri_(links.publicUrl),
    signup: signupUrl ? generateQRDataUri_(signupUrl) : generateQRDataUri_(links.publicUrl)
  };

  // Build CTAs (backward compat: ctaLabels[0] → ctas.primary)
  let ctas = EVENT_DEFAULTS_.ctas;
  if (data.ctas?.primary) {
    ctas = {
      primary: {
        label: data.ctas.primary.label || 'Sign Up',
        url: data.ctas.primary.url || signupUrl
      },
      secondary: data.ctas.secondary || null
    };
  } else if (Array.isArray(data.ctaLabels) && data.ctaLabels.length > 0) {
    // Backward compat: convert ctaLabels array to ctas object
    const firstCta = data.ctaLabels[0];
    ctas = {
      primary: {
        label: firstCta.label || 'Sign Up',
        url: firstCta.url || signupUrl
      },
      secondary: data.ctaLabels[1] ? {
        label: data.ctaLabels[1].label,
        url: data.ctaLabels[1].url || ''
      } : null
    };
  }

  // Build settings (backward compat: sections.*.enabled → settings.show*)
  // Must match /schemas/event.schema.json Settings definition (MVP-frozen)
  let settings = EVENT_DEFAULTS_.settings;
  if (data.settings) {
    settings = {
      // MVP Required
      showSchedule: !!data.settings.showSchedule,
      showStandings: !!data.settings.showStandings,
      showBracket: !!data.settings.showBracket,
      // MVP Optional (V2 content but MVP toggles)
      showSponsors: !!data.settings.showSponsors,
      // Feature 4: Template-Aware Content Section Toggles (default true for backwards compat)
      showVideo: data.settings.showVideo !== false,
      showMap: data.settings.showMap !== false,
      showGallery: data.settings.showGallery !== false,
      // MVP Optional - surface-specific toggles (default true if undefined)
      showSponsorBanner: data.settings.showSponsorBanner !== false,
      showSponsorStrip: data.settings.showSponsorStrip !== false,
      showLeagueStrip: data.settings.showLeagueStrip !== false,
      showQRSection: data.settings.showQRSection !== false
    };
  } else if (data.sections) {
    // Backward compat: sections object → settings flags
    // Support both boolean (sections.video: true) and object (sections.video.enabled: true) formats
    const getSectionEnabled = (section) => {
      if (typeof section === 'boolean') return section;
      if (typeof section === 'object' && section !== null) return !!section.enabled;
      return false;
    };
    settings = {
      showSchedule: getSectionEnabled(data.sections.schedule),
      showStandings: getSectionEnabled(data.sections.standings),
      showBracket: getSectionEnabled(data.sections.bracket),
      showSponsors: getSectionEnabled(data.sections.sponsors),
      // Feature 4: Template-Aware Content Section Toggles (default true for legacy data without explicit false)
      showVideo: data.sections.video !== false,
      showMap: data.sections.map !== false,
      showGallery: data.sections.gallery !== false,
      // Surface toggles default to true for legacy data
      showSponsorBanner: true,
      showSponsorStrip: true,
      showLeagueStrip: true,
      showQRSection: true
    };
  }

  // Hydrate sponsors from IDs if requested (V2 Optional)
  let sponsors = [];
  if (options.hydrateSponsors && data.sponsorIds) {
    const hydratedSponsors = hydrateSponsorIds_(brandId, data.sponsorIds);
    // Add default placement for V2 compat
    sponsors = hydratedSponsors.map(s => ({
      id: s.id,
      name: s.name,
      logoUrl: s.logoUrl || '',
      linkUrl: s.website || null,
      placement: 'public'  // Default placement
    }));
  } else if (Array.isArray(data.sponsors)) {
    sponsors = data.sponsors;
  }

  // Build media object (V2 Optional, backward compat from videoUrl/mapEmbedUrl)
  let media = {};
  if (data.media && typeof data.media === 'object') {
    media = data.media;
  } else if (data.videoUrl || data.mapEmbedUrl) {
    media = {
      videoUrl: data.videoUrl || null,
      mapUrl: data.mapEmbedUrl || null,
      gallery: null
    };
  }

  // Build externalData (V2 Optional, simplified)
  let externalData = {};
  if (data.externalData && typeof data.externalData === 'object') {
    externalData = {
      scheduleUrl: data.externalData.scheduleUrl || null,
      standingsUrl: data.externalData.standingsUrl || null,
      bracketUrl: data.externalData.bracketUrl || null
    };
  }

  // Timestamps
  const now = new Date().toISOString();
  const createdAtISO = createdAt || now;
  const updatedAtISO = data.updatedAtISO || createdAtISO;

  // ═══════════════════════════════════════════════════════════════════════════
  // CANONICAL EVENT SHAPE - MUST MATCH /schemas/event.schema.json
  // Story 6: All bundles return this shape, validated by validateEventContractV2
  // ═══════════════════════════════════════════════════════════════════════════
  return {
    // Identity (MVP Required)
    id: id,
    slug: slug || id,
    name: data.name || '',
    startDateISO: startDateISO,
    venue: venue,
    templateId: templateId || 'event',  // MVP Optional, defaults to 'event'

    // Links (MVP Required)
    links: links,

    // QR Codes (MVP Required)
    qr: qr,

    // Schedule/Standings/Bracket (MVP Optional)
    schedule: Array.isArray(data.schedule) ? data.schedule : EVENT_DEFAULTS_.schedule,
    standings: Array.isArray(data.standings) ? data.standings : EVENT_DEFAULTS_.standings,
    bracket: data.bracket || EVENT_DEFAULTS_.bracket,

    // CTAs (MVP Required)
    ctas: ctas,

    // Sponsors (V2 Optional)
    sponsors: sponsors,

    // Media (V2 Optional)
    media: media,

    // External Data (V2 Optional)
    externalData: externalData,

    // Analytics (Reserved)
    analytics: data.analytics || EVENT_DEFAULTS_.analytics,

    // Payments (Reserved)
    payments: data.payments || EVENT_DEFAULTS_.payments,

    // Settings (MVP Required)
    settings: settings,

    // Metadata (MVP Required)
    createdAtISO: createdAtISO,
    updatedAtISO: updatedAtISO
  };
}

// =============================================================================
// [S17] CONTRACT VALIDATION & LOADERS
// =============================================================================
// Single source of truth for event data access. All read/write operations
// MUST go through these functions to ensure contract compliance.
//
// Key exports:
//   validateEventContract_(event, opts) - Validate event against schema
//   getEventById_(brandId, id, opts)    - Load single event by ID
//   getEventsByBrand_(brandId, opts)    - Load all events for brand
//   normalizeCreatePayloadToEvent_(p)   - Normalize create payload
//   mergeEventUpdate_(existing, data)   - Merge update into event
//
// See /schemas/event.schema.json and EVENT_CONTRACT.md for specifications.
// =============================================================================

/**
 * Validate an event against EVENT_CONTRACT.md v2.0 requirements
 * Checks all MVP REQUIRED fields are present and valid
 *
 * @param {Object} event - Event object to validate (hydrated or raw data)
 * @param {Object} options - { allowPartial: boolean } for update operations
 * @returns {Object} { ok: true } or { ok: false, code: 'CONTRACT', message: string, errors: string[] }
 * @private
 */
function validateEventContract_(event, options = {}) {
  const errors = [];
  const { allowPartial = false } = options;

  if (!event || typeof event !== 'object') {
    return Err(ERR.CONTRACT, 'Event must be an object');
  }

  // === IDENTITY (MVP REQUIRED) ===
  if (!allowPartial) {
    if (!event.id || typeof event.id !== 'string') {
      errors.push('Missing required field: id');
    }
    if (!event.slug || typeof event.slug !== 'string') {
      errors.push('Missing required field: slug');
    }
  }

  if (!event.name || typeof event.name !== 'string' || !event.name.trim()) {
    errors.push('Missing required field: name (non-empty string)');
  } else if (event.name.length > 200) {
    errors.push('Field name exceeds max length of 200 characters');
  }

  if (!event.startDateISO || typeof event.startDateISO !== 'string') {
    errors.push('Missing required field: startDateISO');
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(event.startDateISO)) {
    errors.push('Invalid startDateISO format: must be YYYY-MM-DD');
  }

  if (!event.venue || typeof event.venue !== 'string' || !event.venue.trim()) {
    errors.push('Missing required field: venue (non-empty string)');
  } else if (event.venue.length > 200) {
    errors.push('Field venue exceeds max length of 200 characters');
  }

  // === LINKS (MVP REQUIRED - validated only on full event, not input) ===
  if (!allowPartial && event.links) {
    if (!event.links.publicUrl) errors.push('Missing required field: links.publicUrl');
    if (!event.links.displayUrl) errors.push('Missing required field: links.displayUrl');
    if (!event.links.posterUrl) errors.push('Missing required field: links.posterUrl');
    if (event.links.signupUrl === undefined) errors.push('Missing required field: links.signupUrl');
  }

  // === QR CODES (MVP REQUIRED - validated only on full event) ===
  if (!allowPartial && event.qr) {
    if (!event.qr.public) errors.push('Missing required field: qr.public');
    if (!event.qr.signup) errors.push('Missing required field: qr.signup');
  }

  // === CTAs (MVP REQUIRED) ===
  if (!event.ctas || !event.ctas.primary) {
    errors.push('Missing required field: ctas.primary');
  } else {
    if (!event.ctas.primary.label || typeof event.ctas.primary.label !== 'string') {
      errors.push('Missing required field: ctas.primary.label');
    }
    if (event.ctas.primary.url === undefined) {
      errors.push('Missing required field: ctas.primary.url');
    }
  }

  // === SETTINGS (MVP REQUIRED) ===
  if (!event.settings || typeof event.settings !== 'object') {
    errors.push('Missing required field: settings');
  } else {
    if (typeof event.settings.showSchedule !== 'boolean') {
      errors.push('Missing required field: settings.showSchedule (boolean)');
    }
    if (typeof event.settings.showStandings !== 'boolean') {
      errors.push('Missing required field: settings.showStandings (boolean)');
    }
    if (typeof event.settings.showBracket !== 'boolean') {
      errors.push('Missing required field: settings.showBracket (boolean)');
    }
  }

  // === METADATA (MVP REQUIRED - validated only on full event) ===
  if (!allowPartial) {
    if (!event.createdAtISO) errors.push('Missing required field: createdAtISO');
    if (!event.updatedAtISO) errors.push('Missing required field: updatedAtISO');
  }

  // === URL VALIDATION for optional URL fields ===
  const urlFields = [
    { path: 'ctas.secondary.url', value: event.ctas?.secondary?.url },
    { path: 'media.videoUrl', value: event.media?.videoUrl },
    { path: 'media.mapUrl', value: event.media?.mapUrl },
    { path: 'externalData.scheduleUrl', value: event.externalData?.scheduleUrl },
    { path: 'externalData.standingsUrl', value: event.externalData?.standingsUrl },
    { path: 'externalData.bracketUrl', value: event.externalData?.bracketUrl }
  ];

  for (const { path, value } of urlFields) {
    if (value && typeof value === 'string' && value.trim()) {
      if (!/^https?:\/\/.+/.test(value)) {
        errors.push(`Invalid URL format for ${path}: must start with http:// or https://`);
      }
    }
  }

  // === SPONSOR VALIDATION (V2 OPTIONAL but must be valid if present) ===
  if (Array.isArray(event.sponsors)) {
    event.sponsors.forEach((sponsor, idx) => {
      if (!sponsor.id) errors.push(`sponsors[${idx}]: missing id`);
      if (!sponsor.name) errors.push(`sponsors[${idx}]: missing name`);
      if (!sponsor.logoUrl) errors.push(`sponsors[${idx}]: missing logoUrl`);
      if (sponsor.placement && !['poster', 'display', 'public', 'tv-banner'].includes(sponsor.placement)) {
        errors.push(`sponsors[${idx}]: invalid placement value`);
      }
    });
  }

  if (errors.length > 0) {
    const result = Err(ERR.CONTRACT, `Event contract validation failed: ${errors.join('; ')}`);
    result.errors = errors;
    return result;
  }

  return Ok();
}

/**
 * Get event by ID - Single Source of Truth Loader
 * Reads the row, hydrates to canonical shape, validates contract
 *
 * @param {string} brandId - Brand ID
 * @param {string} id - Event ID
 * @param {Object} options - { scope?: string, hydrateSponsors?: boolean, skipValidation?: boolean }
 * @returns {Object} { ok: true, value: Event } or { ok: false, code, message }
 * @private
 */
function getEventById_(brandId, id, options = {}) {
  const { scope = 'events', hydrateSponsors = true, skipValidation = false } = options;

  // Validate ID format
  const sanitizedId = sanitizeId_(id);
  if (!sanitizedId) {
    return Err(ERR.BAD_INPUT, 'Invalid ID format');
  }

  // Get brand
  const brand = findBrand_(brandId);
  if (!brand) {
    return Err(ERR.NOT_FOUND, 'Unknown brand');
  }

  // Check scope
  const scopeCheck = assertScopeAllowed_(brand, scope);
  if (!scopeCheck.ok) return scopeCheck;

  // Get event row
  const sh = getStoreSheet_(brand, scope);
  const rows = sh.getDataRange().getValues().slice(1);
  const row = rows.find(r => r[0] === sanitizedId && r[1] === brandId);

  if (!row) {
    return Err(ERR.NOT_FOUND, 'Event not found');
  }

  // Hydrate to canonical shape
  const baseUrl = ScriptApp.getService().getUrl();
  const event = _buildEventContract_(row, { baseUrl, hydrateSponsors });

  // Validate contract (unless explicitly skipped for performance)
  if (!skipValidation) {
    const validation = validateEventContract_(event);
    if (!validation.ok) {
      diag_('warn', 'getEventById_', 'Event failed contract validation', {
        id: sanitizedId,
        brandId,
        errors: validation.errors
      });
      // Still return the event but log the warning
      // In strict mode, we could return the error instead
    }
  }

  return Ok(event);
}

/**
 * Get all events for a brand with pagination - List variant of single source of truth
 * Returns canonical Event shapes with contract validation
 *
 * @param {string} brandId - Brand ID
 * @param {Object} options - { scope, limit, offset, hydrateSponsors }
 * @returns {Object} { ok: true, value: { items: Event[], pagination: {...} } }
 * @private
 */
function getEventsByBrand_(brandId, options = {}) {
  const {
    scope = 'events',
    limit = 100,
    offset = 0,
    hydrateSponsors = false  // Default false for list performance
  } = options;

  // Get brand
  const brand = findBrand_(brandId);
  if (!brand) {
    return Err(ERR.NOT_FOUND, 'Unknown brand');
  }

  // Check scope
  const scopeCheck = assertScopeAllowed_(brand, scope);
  if (!scopeCheck.ok) return scopeCheck;

  // Get all events for brand
  const sh = getStoreSheet_(brand, scope);
  const lastRow = sh.getLastRow();

  const allRows = lastRow > 1
    ? sh.getRange(2, 1, lastRow - 1, 6).getValues().filter(r => r[1] === brandId)
    : [];

  // Pagination
  const pageLimit = Math.min(parseInt(limit) || 100, 1000);
  const pageOffset = Math.max(parseInt(offset) || 0, 0);
  const totalCount = allRows.length;

  // Hydrate each event to canonical shape
  const baseUrl = ScriptApp.getService().getUrl();
  const items = allRows
    .slice(pageOffset, pageOffset + pageLimit)
    .map(row => {
      const event = _buildEventContract_(row, { baseUrl, hydrateSponsors });
      // Validate but don't block - log warnings for broken events
      const validation = validateEventContract_(event);
      if (!validation.ok) {
        diag_('warn', 'getEventsByBrand_', 'Event failed contract validation', {
          id: event.id,
          brandId,
          errors: validation.errors
        });
      }
      return event;
    });

  return Ok({
    items,
    pagination: {
      total: totalCount,
      limit: pageLimit,
      offset: pageOffset,
      hasMore: (pageOffset + pageLimit) < totalCount
    }
  });
}

/**
 * Normalize API create payload into canonical Event structure (ZEVENT-003)
 * Transforms { brandId, scope, templateId, data } into a clean Event object
 * that can be passed to saveEvent_().
 *
 * @param {Object} payload - API payload { brandId, scope, templateId, data }
 * @returns {Object} { event, brandId, scope, templateId } normalized for saveEvent_
 * @private
 */
function normalizeCreatePayloadToEvent_(payload) {
  const { brandId, scope = 'events', templateId = 'custom', data = {} } = payload || {};

  // Build canonical event structure from data
  const event = {
    // Identity - id/slug handled by saveEvent_ if not provided
    id: data.id || null,
    slug: data.slug || null,
    name: data.name || '',
    startDateISO: data.startDateISO || data.dateISO || '',
    venue: data.venue || data.location || '',

    // signupUrl for links generation
    signupUrl: data.signupUrl || data.links?.signupUrl || '',

    // CTAs
    ctas: data.ctas || null,

    // Settings
    settings: data.settings || null,

    // MVP Optional
    schedule: data.schedule !== undefined ? data.schedule : null,
    standings: data.standings !== undefined ? data.standings : null,
    bracket: data.bracket !== undefined ? data.bracket : null,

    // V2 Optional
    sponsors: data.sponsors !== undefined ? data.sponsors : [],
    media: data.media !== undefined ? data.media : {},
    externalData: data.externalData !== undefined ? data.externalData : {},

    // Reserved
    analytics: data.analytics || { enabled: false },
    payments: data.payments || { enabled: false }
  };

  return { event, brandId, scope, templateId };
}

/**
 * Merge update data into existing hydrated Event (ZEVENT-003)
 * Overlays incoming partial data onto a full Event object.
 * Preserves existing values for fields not in the update.
 *
 * @param {Object} existingEvent - Full hydrated Event from getEventById_
 * @param {Object} updateData - Partial update data from API
 * @returns {Object} Merged Event object ready for saveEvent_
 * @private
 */
function mergeEventUpdate_(existingEvent, updateData) {
  if (!updateData || typeof updateData !== 'object') {
    return existingEvent;
  }

  // Start with existing event
  const merged = { ...existingEvent };

  // Identity fields (name, venue can be updated; id/slug are immutable)
  if (updateData.name !== undefined) {
    merged.name = updateData.name;
  }
  if (updateData.startDateISO !== undefined || updateData.dateISO !== undefined) {
    merged.startDateISO = updateData.startDateISO || updateData.dateISO;
  }
  if (updateData.venue !== undefined || updateData.location !== undefined) {
    merged.venue = updateData.venue || updateData.location;
  }

  // signupUrl
  if (updateData.signupUrl !== undefined || updateData.links?.signupUrl !== undefined) {
    merged.signupUrl = updateData.signupUrl || updateData.links?.signupUrl || '';
  }

  // CTAs - full replacement if provided
  if (updateData.ctas !== undefined) {
    merged.ctas = updateData.ctas;
  }

  // Settings - full replacement if provided
  if (updateData.settings !== undefined) {
    merged.settings = updateData.settings;
  }

  // MVP Optional
  if (updateData.schedule !== undefined) {
    merged.schedule = updateData.schedule;
  }
  if (updateData.standings !== undefined) {
    merged.standings = updateData.standings;
  }
  if (updateData.bracket !== undefined) {
    merged.bracket = updateData.bracket;
  }

  // V2 Optional
  if (updateData.sponsors !== undefined) {
    merged.sponsors = updateData.sponsors;
  }
  if (updateData.media !== undefined) {
    merged.media = updateData.media;
  }
  if (updateData.externalData !== undefined) {
    merged.externalData = updateData.externalData;
  }

  // Reserved
  if (updateData.analytics !== undefined) {
    merged.analytics = updateData.analytics;
  }
  if (updateData.payments !== undefined) {
    merged.payments = updateData.payments;
  }

  return merged;
}

// =============================================================================
// [S18] EVENT CRUD
// =============================================================================
// Core create/update/save operations for events.
// All write operations go through saveEvent_() which enforces contract.
//
// Key exports:
//   saveEvent_(brandId, id, data, opts)  - Canonical event save (ZEVENT-003)
//   generateQRDataUri_(url)              - Generate QR code data URI
//   hydrateSponsorIds_(brandId, ids)     - Load sponsor data for event
//
// QR codes are generated as base64 PNG data URIs for portable embedding.
// =============================================================================

/**
 * Contract-first save path for events (ZEVENT-003)
 * Canonical function for both creating and updating events.
 * Validates required fields, ensures id/slug, regenerates links & QR,
 * writes row, and returns hydrated event via _buildEventContract_().
 *
 * @param {string} brandId - Brand ID
 * @param {string|null} id - Event ID (null for create, required for update)
 * @param {Object} data - Event data to save (full for create, partial for update)
 * @param {Object} options - { scope, mode, templateId }
 *   - mode: 'create' | 'update' (default: 'update' for backward compat)
 *   - templateId: Template ID for create mode (default: 'custom')
 * @returns {Object} { ok: true, value: Event } or { ok: false, ... }
 * @private
 */
function saveEvent_(brandId, id, data, options = {}) {
  const { scope = 'events', mode = 'update', templateId = 'custom' } = options;
  const isCreate = mode === 'create';

  // Get brand
  const brand = findBrand_(brandId);
  if (!brand) {
    return Err(ERR.NOT_FOUND, 'Unknown brand');
  }

  // Check scope
  const scopeCheck = assertScopeAllowed_(brand, scope);
  if (!scopeCheck.ok) return scopeCheck;

  // === Validate/Generate ID ===
  let sanitizedId;
  if (isCreate) {
    // For create: use provided ID or generate new one
    if (id) {
      // Validate UUID format if provided
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) {
        return Err(ERR.BAD_INPUT, 'Invalid id format: must be UUID v4');
      }
      sanitizedId = id;
    } else {
      sanitizedId = Utilities.getUuid();
    }
  } else {
    // For update: ID is required
    sanitizedId = sanitizeId_(id);
    if (!sanitizedId) {
      return Err(ERR.BAD_INPUT, 'Invalid ID format');
    }
  }

  // === Validate MVP REQUIRED fields for create ===
  if (isCreate) {
    const name = sanitizeInput_(String(data?.name || '').trim());
    const startDateISO = String(data?.startDateISO || data?.dateISO || '').trim();
    const venue = sanitizeInput_(String(data?.venue || data?.location || '').trim());

    if (!name) {
      return Err(ERR.BAD_INPUT, 'Missing required field: name');
    }
    if (name.length > 200) {
      return Err(ERR.BAD_INPUT, 'name exceeds max length of 200 characters');
    }
    if (!startDateISO) {
      return Err(ERR.BAD_INPUT, 'Missing required field: startDateISO');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateISO)) {
      return Err(ERR.BAD_INPUT, 'Invalid date format: startDateISO must be YYYY-MM-DD');
    }
    if (!venue) {
      return Err(ERR.BAD_INPUT, 'Missing required field: venue');
    }
    if (venue.length > 200) {
      return Err(ERR.BAD_INPUT, 'venue exceeds max length of 200 characters');
    }
  }

  const sh = getStoreSheet_(brand, scope);
  const baseUrl = ScriptApp.getService().getUrl();
  const now = new Date().toISOString();

  // Use lock for atomic operations
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const rows = sh.getDataRange().getValues();
    let existingData = {};
    let rowIdx = -1;
    let createdAt = now;
    let slug = '';

    if (isCreate) {
      // === CREATE MODE ===

      // Generate or validate slug
      slug = data?.slug;
      if (slug) {
        slug = String(slug).toLowerCase().replace(/[^a-z0-9-]/g, '').substring(0, 50);
        if (!slug) {
          lock.releaseLock();
          return Err(ERR.BAD_INPUT, 'Invalid slug format');
        }
      } else {
        // Generate from name
        const name = sanitizeInput_(String(data?.name || '').trim());
        slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').substring(0, 50);
      }

      // Check for slug collisions
      const existingSlugs = rows.slice(1).map(r => r[5]);
      let counter = 2;
      const originalSlug = slug;
      while (existingSlugs.includes(slug)) {
        slug = `${originalSlug}-${counter}`;
        counter++;
      }

      // Check for ID collisions
      const existingIds = rows.slice(1).map(r => r[0]);
      if (existingIds.includes(sanitizedId)) {
        lock.releaseLock();
        return Err(ERR.BAD_INPUT, 'Event with this ID already exists');
      }

    } else {
      // === UPDATE MODE ===

      rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === sanitizedId && r[1] === brandId);
      if (rowIdx === -1) {
        lock.releaseLock();
        return Err(ERR.NOT_FOUND, 'Event not found');
      }

      const existingRow = rows[rowIdx];
      existingData = safeJSONParse_(existingRow[3], {});
      createdAt = existingRow[4];
      slug = existingRow[5];
    }

    // === Build merged data with validation ===
    const mergedData = { ...existingData };

    // Name (MVP REQUIRED)
    if (data.name !== undefined) {
      const name = sanitizeInput_(String(data.name).trim());
      if (!name) {
        lock.releaseLock();
        return Err(ERR.BAD_INPUT, 'name cannot be empty');
      }
      if (name.length > 200) {
        lock.releaseLock();
        return Err(ERR.BAD_INPUT, 'name exceeds max length of 200 characters');
      }
      mergedData.name = name;
    }

    // startDateISO (MVP REQUIRED)
    if (data.startDateISO !== undefined || data.dateISO !== undefined) {
      const startDateISO = String(data.startDateISO || data.dateISO || '').trim();
      if (startDateISO && !/^\d{4}-\d{2}-\d{2}$/.test(startDateISO)) {
        lock.releaseLock();
        return Err(ERR.BAD_INPUT, 'startDateISO must be YYYY-MM-DD format');
      }
      if (startDateISO) {
        mergedData.startDateISO = startDateISO;
      }
    }

    // venue (MVP REQUIRED) - with backward compat for location
    if (data.venue !== undefined || data.location !== undefined) {
      const venue = sanitizeInput_(String(data.venue || data.location || '').trim());
      if (data.venue !== undefined && !venue) {
        lock.releaseLock();
        return Err(ERR.BAD_INPUT, 'venue cannot be empty');
      }
      if (venue && venue.length > 200) {
        lock.releaseLock();
        return Err(ERR.BAD_INPUT, 'venue exceeds max length of 200 characters');
      }
      if (venue) {
        mergedData.venue = venue;
      }
    }

    // signupUrl (stored for links generation)
    if (data.signupUrl !== undefined || data.links?.signupUrl !== undefined) {
      mergedData.signupUrl = data.signupUrl || data.links?.signupUrl || '';
    }

    // CTAs (MVP REQUIRED)
    if (data.ctas !== undefined) {
      if (!data.ctas.primary || !data.ctas.primary.label) {
        lock.releaseLock();
        return Err(ERR.BAD_INPUT, 'ctas.primary.label is required');
      }
      mergedData.ctas = {
        primary: {
          label: sanitizeInput_(String(data.ctas.primary.label).trim()),
          url: data.ctas.primary.url || ''
        },
        secondary: data.ctas.secondary ? {
          label: sanitizeInput_(String(data.ctas.secondary.label || '').trim()),
          url: data.ctas.secondary.url || ''
        } : null
      };
    } else if (isCreate && !mergedData.ctas) {
      // Default CTAs for create
      const signupUrl = data.signupUrl || data.links?.signupUrl || '';
      mergedData.ctas = {
        primary: {
          label: 'Sign Up',
          url: signupUrl
        },
        secondary: null
      };
    }

    // Settings (MVP REQUIRED)
    if (data.settings !== undefined) {
      mergedData.settings = {
        // MVP Required data section toggles
        showSchedule: !!data.settings.showSchedule,
        showStandings: !!data.settings.showStandings,
        showBracket: !!data.settings.showBracket,
        showSponsors: !!data.settings.showSponsors,
        // Feature 4: Template-Aware Content Section Toggles
        showVideo: data.settings.showVideo !== false,
        showMap: data.settings.showMap !== false,
        showGallery: data.settings.showGallery !== false,
        // MVP Optional surface-specific toggles
        showSponsorBanner: data.settings.showSponsorBanner !== false,
        showSponsorStrip: data.settings.showSponsorStrip !== false,
        showLeagueStrip: data.settings.showLeagueStrip !== false,
        showQRSection: data.settings.showQRSection !== false
      };
    } else if (isCreate && !mergedData.settings) {
      // Default settings for create
      mergedData.settings = {
        showSchedule: false,
        showStandings: false,
        showBracket: false,
        showSponsors: false,
        // Feature 4: Template-Aware Content Section Toggles (default true)
        showVideo: true,
        showMap: true,
        showGallery: true,
        // Surface toggles default true
        showSponsorBanner: true,
        showSponsorStrip: true,
        showLeagueStrip: true,
        showQRSection: true
      };
    }

    // Schedule (MVP OPTIONAL)
    if (data.schedule !== undefined) {
      mergedData.schedule = Array.isArray(data.schedule) ? data.schedule : null;
    }

    // Standings (MVP OPTIONAL)
    if (data.standings !== undefined) {
      mergedData.standings = Array.isArray(data.standings) ? data.standings : null;
    }

    // Bracket (MVP OPTIONAL)
    if (data.bracket !== undefined) {
      mergedData.bracket = data.bracket || null;
    }

    // Sponsors (V2 OPTIONAL)
    if (data.sponsors !== undefined) {
      mergedData.sponsors = Array.isArray(data.sponsors) ? data.sponsors : [];
    }

    // Media (V2 OPTIONAL)
    if (data.media !== undefined) {
      mergedData.media = data.media || {};
    }

    // External Data (V2 OPTIONAL)
    if (data.externalData !== undefined) {
      mergedData.externalData = data.externalData || {};
    }

    // Analytics (RESERVED)
    if (data.analytics !== undefined) {
      mergedData.analytics = data.analytics || { enabled: false };
    }

    // Payments (RESERVED)
    if (data.payments !== undefined) {
      mergedData.payments = data.payments || { enabled: false };
    }

    // Update timestamp
    mergedData.updatedAtISO = now;

    // === Write data ===
    if (isCreate) {
      // Append new row: [id, brandId, templateId, dataJSON, createdAt, slug]
      sh.appendRow([sanitizedId, brandId, templateId, JSON.stringify(mergedData), now, slug]);
      diag_('info', 'saveEvent_', 'Event created', { id: sanitizedId, brandId, mode: 'create' });
    } else {
      // Update existing row
      sh.getRange(rowIdx + 1, 4).setValue(JSON.stringify(mergedData));
      diag_('info', 'saveEvent_', 'Event updated', { id: sanitizedId, brandId, mode: 'update' });
    }

    lock.releaseLock();

    // === Return hydrated event ===
    const savedRow = [sanitizedId, brandId, templateId, JSON.stringify(mergedData), createdAt, slug];
    const event = _buildEventContract_(savedRow, { baseUrl, hydrateSponsors: true });

    // Validate the result
    const validation = validateEventContract_(event);
    if (!validation.ok) {
      diag_('warn', 'saveEvent_', 'Saved event has contract warnings', {
        id: sanitizedId,
        brandId,
        mode,
        errors: validation.errors
      });
    }

    return Ok(event);

  } catch (e) {
    try { lock.releaseLock(); } catch (_) { /* ignore */ }
    diag_('error', 'saveEvent_', 'Failed to save event', { id: sanitizedId, mode, error: e.message });
    return Err(ERR.INTERNAL, 'Failed to save event: ' + e.message);
  }
}

// =============================================================================
// QR CODE FLOW CONFIGURATION - MVP SCOPE LOCK
// =============================================================================
// RULE: Unlimited backend QR flows; poster may render max 3 flows as display QRs.
//
// Backend can define any number of QR flow types (public, signup, display, etc.)
// Poster.html enforces a hard limit of 3 QR display slots regardless of how
// many flows backend provides. See docs/MVP_SCOPE.md for full rules.
//
// Current MVP Flows:
//   - public:  Points to Public.html event page
//   - signup:  Points to signup/registration URL
//   - display: Points to Display.html (v2, reserved)
//
// To add new QR flow types:
//   1. Add generation logic here
//   2. Update _buildEventContract_() to include in event.qr object
//   3. DO NOT modify Poster.html 3-slot limit
// =============================================================================

/**
 * Generate QR code as base64 PNG data URI
 * Uses Google Charts API for QR code generation
 * @param {string} url - URL to encode
 * @returns {string} Base64 PNG data URI
 * @private
 */
function generateQRDataUri_(url) {
  if (!url) return '';
  try {
    // Use Google Charts API for QR generation
    const qrApiUrl = `https://chart.googleapis.com/chart?cht=qr&chs=200x200&chl=${encodeURIComponent(url)}`;
    const response = UrlFetchApp.fetch(qrApiUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() === 200) {
      const blob = response.getBlob();
      const base64 = Utilities.base64Encode(blob.getBytes());
      return `data:image/png;base64,${base64}`;
    }
  } catch (e) {
    diag_('warn', 'generateQRDataUri_', 'Failed to generate QR code', { url, error: e.message });
  }
  return '';
}

/**
 * Hydrate sponsor IDs into full sponsor objects
 * @param {string} brandId - Brand to look up sponsors in
 * @param {string} sponsorIds - Comma-separated sponsor IDs
 * @returns {Array} Array of sponsor objects
 * @private
 */
function hydrateSponsorIds_(brandId, sponsorIds) {
  if (!sponsorIds) return [];

  const ids = String(sponsorIds).split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) return [];

  try {
    const brand = findBrand_(brandId);
    if (!brand) return [];

    const sh = getStoreSheet_(brand, 'sponsors');
    const rows = sh.getDataRange().getValues().slice(1);

    return ids.map(id => {
      const row = rows.find(r => r[0] === id && r[1] === brandId);
      if (!row) return { id, name: 'Unknown', logoUrl: null, website: null, tier: null };

      const data = safeJSONParse_(row[3], {});
      return {
        id: row[0],
        name: data.name || 'Unknown',
        logoUrl: data.logoUrl || null,
        website: data.website || null,
        tier: data.tier || null
      };
    });
  } catch (e) {
    diag_('warn', 'hydrateSponsorIds_', 'Failed to hydrate sponsors', { brandId, error: e.message });
    return [];
  }
}

// =============================================================================
// [S19] READ APIs
// =============================================================================
// Public read-only APIs for listing and fetching events.
// All use single-source-of-truth loaders from [S17].
//
// Key exports:
//   api_list(payload)          - List events with pagination
//   api_get(payload)           - Get single event by ID
//   api_getPublicBundle(p)     - Public surface data bundle
//   api_getAdminBundle(p)      - Admin surface data bundle
//   getAllSponsorsForBrand_(b) - Get all sponsors for a brand
//   getEventDiagnostics_(b,id) - Get event diagnostics
// =============================================================================

/**
 * List events with pagination
 * Uses getEventsByBrand_() single source of truth loader
 * Returns canonical Event shapes per EVENT_CONTRACT.md v2.0
 * @tier mvp
 */
function api_list(payload){
  return runSafe('api_list', () => {
    const { brandId, scope, limit, offset } = payload||{};

    // Use single source of truth loader with contract validation
    const result = getEventsByBrand_(brandId, {
      scope: scope || 'events',
      limit: limit,
      offset: offset,
      hydrateSponsors: false  // Performance: don't hydrate sponsors in list
    });

    if (!result.ok) return result;

    const value = result.value;
    const etag = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(value)));
    if (payload?.ifNoneMatch === etag) return { ok:true, notModified:true, etag };
    return _ensureOk_('api_list', SC_LIST, { ok:true, etag, value });
  });
}

/**
 * Get single event by ID
 * Uses getEventById_() single source of truth loader
 * Returns full canonical Event shape per EVENT_CONTRACT.md v2.0
 * @tier mvp
 */
function api_get(payload){
  return runSafe('api_get', () => {
    const { brandId, scope, id } = payload||{};

    // Use single source of truth loader with contract validation
    const result = getEventById_(brandId, id, {
      scope: scope || 'events',
      hydrateSponsors: true
    });

    if (!result.ok) return result;

    const value = result.value;
    const etag = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(value)));
    if (payload?.ifNoneMatch === etag) return { ok:true, notModified:true, etag };
    return _ensureOk_('api_get', SC_GET, { ok:true, etag, value });
  });
}

/**
 * Bundled endpoint for public pages - returns event + config in single call
 * Uses getEventById_() single source of truth loader
 * Returns canonical Event shape per EVENT_CONTRACT.md v2.0
 * @param {object} payload - { brandId, scope, id, ifNoneMatch }
 * @returns {object} { ok, value: { event, config }, etag }
 * @tier mvp
 */
function api_getPublicBundle(payload){
  return runSafe('api_getPublicBundle', () => {
    const { brandId, scope, id } = payload||{};

    // Use single source of truth loader with contract validation
    const result = getEventById_(brandId, id, {
      scope: scope || 'events',
      hydrateSponsors: true
    });

    if (!result.ok) return result;

    const event = result.value;
    const brand = findBrand_(brandId);

    // Compute lifecycle phase from startDateISO (single source of truth)
    const lifecyclePhase = computeLifecyclePhase_(event.startDateISO);

    // Build bundled response - derive public DTO from canonical event
    const value = {
      // Full canonical event shape
      event: event,
      // Brand config subset (public-safe fields only)
      config: {
        appTitle: brand.appTitle || brand.name || 'Events',
        brandId: brand.id,
        brandName: brand.name
      },
      // Lifecycle phase for consistent state interpretation across surfaces
      lifecyclePhase: lifecyclePhase
    };

    const etag = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(value)));
    if (payload?.ifNoneMatch === etag) return { ok:true, notModified:true, etag };
    return _ensureOk_('api_getPublicBundle', SC_GET, { ok:true, etag, value });
  });
}

/**
 * Admin Bundle - Optimized bundle for Admin.html surface
 * Returns event + admin-specific config, templates, diagnostics, and all sponsors
 *
 * AdminEventBundle interface:
 * - event: EventCore (full canonical event shape)
 * - brandConfig: { brandId, allowedTemplates, defaultTemplateId }
 * - templates: TemplateDescriptor[] (available templates for this brand)
 * - diagnostics: { hasForm, hasShortlinks, lastPublishedAt }
 * - allSponsors: Sponsor[] (all sponsors for brand, for dropdown linking)
 *
 * Admin editable fields (MVP):
 *   templateId (while status === 'draft'), name, description, dateTime, timezone,
 *   location, venueName, imageUrl, videoUrl, mapEmbedUrl, audience, notesLabel, notes,
 *   sections.*.enabled, sections.*.label, ctaLabels (labels only),
 *   externalData.scheduleUrl/standingsUrl/bracketUrl, sponsor attachments
 *
 * Admin cannot edit: id, short*Url fields, analytics-derived data
 *
 * @param {object} payload - { brandId, scope, id, adminKey, ifNoneMatch }
 * @returns {object} { ok, value: AdminEventBundle, etag }
 * @tier mvp
 */
function api_getAdminBundle(payload){
  return runSafe('api_getAdminBundle', () => {
    const { brandId, scope, id, adminKey } = payload||{};

    // Auth required for admin bundle
    const g = gate_(brandId, adminKey);
    if (!g.ok) return g;

    // Use single source of truth loader with contract validation
    const result = getEventById_(brandId, id, {
      scope: scope || 'events',
      hydrateSponsors: true
    });

    if (!result.ok) return result;

    const event = result.value;
    const brand = findBrand_(brandId);
    const sanitizedId = event.id;

    // Get brand template config
    const templateConfig = getBrandTemplateConfig_(brandId);
    const templates = getTemplatesForBrand_(brandId);

    // Get all sponsors for brand (for dropdown linking)
    const allSponsors = getAllSponsorsForBrand_(brandId);

    // Build diagnostics - check for forms and shortlinks
    const diagnostics = getEventDiagnostics_(brandId, sanitizedId);

    // Compute lifecycle phase from startDateISO (single source of truth)
    const lifecyclePhase = computeLifecyclePhase_(event.startDateISO);

    // Build bundled response matching AdminEventBundle interface
    const value = {
      // Full canonical event shape
      event: event,

      // Brand configuration for admin
      brandConfig: {
        brandId: brand.id,
        allowedTemplates: templateConfig.templates,
        defaultTemplateId: templateConfig.defaultTemplateId
      },

      // Available templates for this brand
      templates: templates,

      // System diagnostics (readonly in UI)
      diagnostics: diagnostics,

      // All sponsors for dropdown/linking
      allSponsors: allSponsors,

      // Lifecycle phase for consistent state interpretation across surfaces
      lifecyclePhase: lifecyclePhase
    };

    const etag = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(value)));
    if (payload?.ifNoneMatch === etag) return { ok:true, notModified:true, etag };
    return _ensureOk_('api_getAdminBundle', SC_GET, { ok:true, etag, value });
  });
}

/**
 * Get all sponsors for a brand (helper for admin bundle)
 * @param {string} brandId - Brand ID
 * @returns {Array} Array of sponsor objects
 * @private
 */
function getAllSponsorsForBrand_(brandId) {
  try {
    const brand = findBrand_(brandId);
    if (!brand) return [];

    const sh = getStoreSheet_(brand, 'sponsors');
    const lastRow = sh.getLastRow();
    if (lastRow <= 1) return [];

    const rows = sh.getRange(2, 1, lastRow - 1, 6).getValues();

    return rows
      .filter(r => r[1] === brandId)
      .map(row => {
        const data = safeJSONParse_(row[3], {});
        return {
          id: row[0],
          name: data.name || 'Unknown',
          logoUrl: data.logoUrl || null,
          website: data.website || null,
          tier: data.tier || null,
          entity: data.entity || null
        };
      });
  } catch (e) {
    diag_('error', 'getAllSponsorsForBrand_', 'Failed to get sponsors', { brandId, error: String(e) });
    return [];
  }
}

/**
 * Get event diagnostics for admin bundle
 * @param {string} brandId - Brand ID
 * @param {string} eventId - Event ID
 * @returns {object} Diagnostics object
 * @private
 */
function getEventDiagnostics_(brandId, eventId) {
  try {
    // Check for shortlinks (look in SHORTLINKS sheet)
    let hasShortlinks = false;
    let hasForm = false;
    let lastPublishedAt = null;

    const brand = findBrand_(brandId);
    if (brand) {
      const ss = SpreadsheetApp.openById(brand.store.spreadsheetId);

      // Check SHORTLINKS sheet for this event
      const slSheet = ss.getSheetByName('SHORTLINKS');
      if (slSheet && slSheet.getLastRow() > 1) {
        const slData = slSheet.getDataRange().getValues().slice(1);
        hasShortlinks = slData.some(row => row[2] === eventId || String(row[1]).includes(eventId));
      }

      // Check if event has form URLs set (signupUrl, checkinUrl, feedbackUrl)
      const evSheet = ss.getSheetByName('events');
      if (evSheet) {
        const evData = evSheet.getDataRange().getValues().slice(1);
        const eventRow = evData.find(r => r[0] === eventId && r[1] === brandId);
        if (eventRow) {
          const data = safeJSONParse_(eventRow[3], {});
          hasForm = !!(data.signupUrl || data.checkinUrl || data.feedbackUrl);

          // Check for lastPublishedAt in data or use status change
          if (data.status === 'published' && data.publishedAt) {
            lastPublishedAt = data.publishedAt;
          }
        }
      }
    }

    return {
      hasForm: hasForm,
      hasShortlinks: hasShortlinks,
      lastPublishedAt: lastPublishedAt
    };
  } catch (e) {
    diag_('error', 'getEventDiagnostics_', 'Failed to get diagnostics', { brandId, eventId, error: String(e) });
    return {
      hasForm: false,
      hasShortlinks: false,
      lastPublishedAt: null
    };
  }
}

// =============================================================================
// [S20] BUNDLE APIs
// =============================================================================
// Surface-specific data bundles optimized for each HTML surface.
// Bundles include event data plus surface-specific computed properties.
//
// Key exports:
//   api_getDisplayBundle(p)   - TV/kiosk display bundle
//   getDisplayConfig_(t, b)   - Compute display config from template
//   api_getPosterBundle(p)    - Print poster bundle with QR codes
//   generateQRCodes_(event)   - Generate all QR codes for event
//   generatePrintStrings_(e)  - Generate print-friendly strings
//   api_getSponsorBundle(p)   - Sponsor portal bundle
//   getSponsorMetricsForEvent_(b, id) - Get sponsor metrics
// =============================================================================

/**
 * Display Bundle - Optimized bundle for Display.html (TV mode)
 * Returns event + rotation/layout config computed from Config + Template + Brand
 *
 * DisplayBundle interface:
 * - event: EventCore (full canonical event shape with hydrated sponsors)
 * - rotation: { sponsorSlots, rotationMs } - sponsor display config
 * - layout: { hasSidePane, emphasis } - layout emphasis ('scores'|'sponsors'|'hero')
 *
 * All values are computed from ZEB.DISPLAY_CONFIG with template-specific overrides.
 * No extra DB fields needed.
 *
 * @param {object} payload - { brandId, scope, id, ifNoneMatch }
 * @returns {object} { ok, value: DisplayBundle, etag }
 * @tier mvp
 */
function api_getDisplayBundle(payload){
  return runSafe('api_getDisplayBundle', () => {
    const { brandId, scope, id } = payload||{};

    // Use single source of truth loader with contract validation
    const result = getEventById_(brandId, id, {
      scope: scope || 'events',
      hydrateSponsors: true
    });

    if (!result.ok) return result;

    const event = result.value;

    // Get display config computed from Config + Template
    const displayConfig = getDisplayConfig_(event.templateId, brandId);

    // Get event-level rotation override from settings (schema: settings.displayRotation)
    const eventRotation = event.settings?.displayRotation || {};

    // Determine effective panes: event override > template default
    const effectivePanes = (eventRotation.panes && eventRotation.panes.length > 0)
      ? eventRotation.panes
      : displayConfig.panes;

    // Compute lifecycle phase from startDateISO (single source of truth)
    const lifecyclePhase = computeLifecyclePhase_(event.startDateISO);

    // Build bundled response matching DisplayBundle interface
    const value = {
      // Full canonical event shape
      event: event,

      // Rotation config (sponsor display settings)
      rotation: {
        sponsorSlots: displayConfig.rotation.sponsorSlots,
        rotationMs: displayConfig.rotation.rotationMs
      },

      // Layout config (emphasis and pane settings)
      layout: {
        hasSidePane: displayConfig.layout.hasSidePane,
        emphasis: displayConfig.layout.emphasis
      },

      // V2: Display rotation engine configuration
      // Schema: settings.displayRotation in /schemas/event.schema.json
      displayRotation: {
        // Rotation is enabled if explicitly set on event OR template has panes
        enabled: eventRotation.enabled === true || effectivePanes.length > 0,
        // Default dwell time: event override > 15000ms
        defaultDwellMs: eventRotation.defaultDwellMs || 15000,
        // Panes to rotate through
        panes: effectivePanes,
        // Pane type metadata for frontend rendering
        paneTypes: displayConfig.paneTypes
      },

      // Lifecycle phase for consistent state interpretation across surfaces
      lifecyclePhase: lifecyclePhase
    };

    const etag = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(value)));
    if (payload?.ifNoneMatch === etag) return { ok:true, notModified:true, etag };
    return _ensureOk_('api_getDisplayBundle', SC_GET, { ok:true, etag, value });
  });
}

/**
 * Get display configuration for a template/brand
 * Merges ZEB.DISPLAY_CONFIG defaults with template-specific overrides
 *
 * @param {string} templateId - Event template ID
 * @param {string} brandId - Brand ID (for future brand-specific overrides)
 * @returns {object} Display config { rotation, layout, panes, paneTypes }
 * @private
 */
function getDisplayConfig_(templateId, brandId) {
  const defaults = ZEB.DISPLAY_CONFIG;

  // Start with global defaults
  const config = {
    rotation: { ...defaults.rotation },
    layout: { ...defaults.layout },
    panes: defaults.defaultPanes ? [...defaults.defaultPanes] : [],
    paneTypes: defaults.paneTypes || {}
  };

  // Apply template-specific overrides
  const templateOverrides = defaults.templateOverrides?.[templateId];
  if (templateOverrides) {
    if (templateOverrides.rotation) {
      Object.assign(config.rotation, templateOverrides.rotation);
    }
    if (templateOverrides.layout) {
      Object.assign(config.layout, templateOverrides.layout);
    }
    // V2: Template-specific panes override defaults
    if (templateOverrides.defaultPanes) {
      config.panes = [...templateOverrides.defaultPanes];
    }
  }

  // Future: Apply brand-specific overrides here
  // const brand = findBrand_(brandId);
  // if (brand?.displayConfig) { ... }

  return config;
}

/**
 * Poster Bundle - Optimized bundle for Poster.html (print-friendly)
 * Returns event + QR codes + print-formatted strings
 *
 * PosterBundle interface:
 * - event: EventCore (full canonical event shape with hydrated sponsors)
 * - qrCodes: { public, signup } - QR code URLs for scanning
 * - print: { dateLine, venueLine } - Pre-formatted strings for print
 *
 * Note: Tracking is maintained through event.links URLs which can be
 * shortlinks created via api_createShortlink for full analytics.
 *
 * @param {object} payload - { brandId, scope, id, ifNoneMatch }
 * @returns {object} { ok, value: PosterBundle, etag }
 * @tier mvp
 */
function api_getPosterBundle(payload){
  return runSafe('api_getPosterBundle', () => {
    const { brandId, scope, id } = payload||{};

    // Use single source of truth loader with contract validation
    const result = getEventById_(brandId, id, {
      scope: scope || 'events',
      hydrateSponsors: true
    });

    if (!result.ok) return result;

    const event = result.value;

    // Generate QR code URLs using quickchart.io (works for print)
    const qrCodes = generateQRCodes_(event);

    // Generate print-friendly formatted strings
    const printStrings = generatePrintStrings_(event);

    // Compute lifecycle phase from startDateISO (single source of truth)
    const lifecyclePhase = computeLifecyclePhase_(event.startDateISO);

    // Build bundled response matching PosterBundle interface
    const value = {
      // Full canonical event shape (includes links for tracking)
      event: event,

      // QR code URLs
      qrCodes: qrCodes,

      // Print-friendly formatted strings
      print: printStrings,

      // Lifecycle phase for consistent state interpretation across surfaces
      lifecyclePhase: lifecyclePhase
    };

    const etag = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(value)));
    if (payload?.ifNoneMatch === etag) return { ok:true, notModified:true, etag };
    return _ensureOk_('api_getPosterBundle', SC_GET, { ok:true, etag, value });
  });
}

/**
 * Generate QR code URLs for poster
 * Uses quickchart.io API which is reliable for print use
 *
 * @param {object} event - Hydrated event object
 * @returns {object} { public, signup } QR code image URLs
 * @private
 */
function generateQRCodes_(event) {
  const QR_SIZE = 200;
  const QR_MARGIN = 1;

  // Helper to generate QR URL
  const qrUrl = (targetUrl) => {
    if (!targetUrl) return null;
    return `https://quickchart.io/qr?text=${encodeURIComponent(targetUrl)}&size=${QR_SIZE}&margin=${QR_MARGIN}`;
  };

  return {
    // Public event page QR - uses event.links.publicUrl (can be shortlink for tracking)
    public: qrUrl(event.links?.publicUrl),

    // Signup form QR - uses event.links.signupUrl (schema-compliant)
    signup: qrUrl(event.links?.signupUrl)
  };
}

/**
 * Generate print-friendly formatted strings
 * EVENT_CONTRACT.md v2.0: Uses canonical fields
 *
 * @param {object} event - Hydrated event object per EVENT_CONTRACT.md
 * @returns {object} { dateLine, venueLine } formatted strings
 * @private
 */
function generatePrintStrings_(event) {
  let dateLine = null;
  let venueLine = null;

  // Format date line from event.startDateISO (MVP Required)
  if (event.startDateISO) {
    try {
      // startDateISO is YYYY-MM-DD format, no time in MVP
      const dt = new Date(event.startDateISO + 'T00:00:00');
      if (!isNaN(dt.getTime())) {
        // Format: "Saturday, August 15, 2025"
        const dateOpts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateLine = dt.toLocaleDateString('en-US', dateOpts);
      }
    } catch (e) {
      // If date parsing fails, leave as null
    }
  }

  // Format venue line from event.venue (MVP Required)
  if (event.venue) {
    venueLine = event.venue;
  }

  return {
    dateLine: dateLine,
    venueLine: venueLine
  };
}

/**
 * api_getSponsorBundle - Optimized bundle for sponsor portal
 * Returns thin event view + sponsors with analytics metrics
 *
 * @param {object} payload - { brandId, scope, id, ifNoneMatch }
 * @returns {object} { ok, value: SponsorBundle, etag }
 * @tier mvp
 */
function api_getSponsorBundle(payload){
  return runSafe('api_getSponsorBundle', () => {
    const { brandId, scope, id } = payload||{};

    // Use single source of truth loader with contract validation
    const result = getEventById_(brandId, id, {
      scope: scope || 'events',
      hydrateSponsors: true
    });

    if (!result.ok) return result;

    const event = result.value;
    const brand = findBrand_(brandId);
    const sanitizedId = event.id;

    // Get sponsor metrics from ANALYTICS sheet
    const sponsorMetrics = getSponsorMetricsForEvent_(brand, sanitizedId);

    // Build thin event view per EVENT_CONTRACT.md v2.0
    // Derived DTO from canonical Event - uses only contract fields
    const thinEvent = {
      id: event.id,
      name: event.name,
      startDateISO: event.startDateISO,  // MVP Required (was: dateTime)
      venue: event.venue,                 // MVP Required (was: location)
      templateId: event.templateId
    };

    // Enrich sponsors with metrics
    const sponsorsWithMetrics = (event.hydratedSponsors || []).map(sponsor => {
      const metrics = sponsorMetrics[sponsor.id] || { impressions: 0, clicks: 0 };
      const ctr = metrics.impressions > 0
        ? +((metrics.clicks / metrics.impressions) * 100).toFixed(2)
        : 0;
      return {
        ...sponsor,
        metrics: {
          impressions: metrics.impressions,
          clicks: metrics.clicks,
          ctr: ctr
        }
      };
    });

    // Build bundled response matching SponsorBundle interface
    const value = {
      event: thinEvent,
      sponsors: sponsorsWithMetrics
    };

    const etag = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(value)));
    if (payload?.ifNoneMatch === etag) return { ok:true, notModified:true, etag };
    return _ensureOk_('api_getSponsorBundle', SC_GET, { ok:true, etag, value });
  });
}

/**
 * Get sponsor metrics (impressions, clicks) for a specific event
 * Reads from ANALYTICS sheet and aggregates by sponsorId
 *
 * @param {object} brand - Brand configuration
 * @param {string} eventId - Event ID to filter by
 * @returns {object} { [sponsorId]: { impressions, clicks } }
 * @private
 */
function getSponsorMetricsForEvent_(brand, eventId) {
  const metrics = {};

  try {
    // Get analytics sheet
    const spreadsheetId = brand.spreadsheetId || ZEB.MASTER_SHEET_ID;
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const analyticsSheet = ss.getSheetByName('ANALYTICS');

    if (!analyticsSheet) {
      // No analytics sheet yet - return empty metrics
      return metrics;
    }

    const data = analyticsSheet.getDataRange().getValues().slice(1); // Skip header

    // Filter by eventId and aggregate by sponsorId
    // Columns: 0=timestamp, 1=eventId, 2=surface, 3=metric, 4=sponsorId, 5=value
    for (const row of data) {
      const rowEventId = row[1];
      const metricType = row[3];
      const sponsorId = row[4];

      // Skip if not for this event or no sponsorId
      if (rowEventId !== eventId || !sponsorId) continue;

      // Initialize sponsor entry if needed
      if (!metrics[sponsorId]) {
        metrics[sponsorId] = { impressions: 0, clicks: 0 };
      }

      // Aggregate based on metric type
      if (metricType === 'impression') {
        metrics[sponsorId].impressions++;
      } else if (metricType === 'click') {
        metrics[sponsorId].clicks++;
      }
    }
  } catch (e) {
    // If analytics sheet doesn't exist or error, return empty metrics
    Logger.log('getSponsorMetricsForEvent_ error: ' + e.message);
  }

  return metrics;
}

// =============================================================================
// [S21] REPORT APIs
// =============================================================================
// Analytics and reporting APIs for SharedReport.html and exports.
//
// Key exports:
//   api_getSharedReportBundle(p) - Report bundle (Story 6: v2 compliant)
//   getEventMetricsForReport_(b, id) - Get event metrics from ANALYTICS
//   api_getReport(req)           - Get report data
//   api_exportReport(req)        - Export report to spreadsheet
//
// Note: SharedReport.html uses the canonical 3-endpoint set from
// SharedReporting.gs: api_getSharedAnalytics, api_getSponsorAnalytics, etc.
// =============================================================================

/**
 * api_getSharedReportBundle - Bundle for shared analytics reports
 *
 * STORY 6 UPDATE: Now returns FULL canonical event per EVENT_CONTRACT.md v2.0.
 * Previously returned thin event subset - now follows same pattern as other bundles.
 *
 * SharedReport.html uses the canonical 3-endpoint set for primary access:
 *   - api_getSharedAnalytics
 *   - api_getSponsorAnalytics
 *   - api_getSponsorReportQr
 *
 * This bundle provides a single-call alternative with full event + metrics.
 * Event passes validateEventContractV2 for consistent contract compliance.
 *
 * @param {object} payload - { brandId, scope, id, ifNoneMatch }
 * @returns {object} { ok, value: { event: EventCore, metrics: SharedMetrics }, etag }
 * @tier mvp
 */
function api_getSharedReportBundle(payload){
  return runSafe('api_getSharedReportBundle', () => {
    const { brandId, scope, id } = payload||{};

    // Dark Launch / Kill Switch: Check if SharedReport is enabled for this brand
    const featureGate = requireBrandFeature_(brandId, 'sharedReportEnabled');
    if (featureGate) {
      return featureGate;
    }

    // Use single source of truth loader with contract validation
    // Story 6: Now hydrates sponsors for full v2 contract compliance
    const result = getEventById_(brandId, id, {
      scope: scope || 'events',
      hydrateSponsors: true
    });

    if (!result.ok) return result;

    const event = result.value;
    const brand = findBrand_(brandId);
    const sanitizedId = event.id;

    // Get event metrics from ANALYTICS sheet
    const metrics = getEventMetricsForReport_(brand, sanitizedId);

    // Compute lifecycle phase from startDateISO (single source of truth)
    const lifecyclePhase = computeLifecyclePhase_(event.startDateISO);

    // Story 6: Return FULL canonical event (passes validateEventContractV2)
    // Previously returned thin event subset - now v2 compliant like other bundles
    const value = {
      // Full canonical event shape per EVENT_CONTRACT.md v2.0
      event: event,
      // Aggregated metrics from ANALYTICS sheet
      metrics: metrics,
      // Lifecycle phase for consistent state interpretation across surfaces
      lifecyclePhase: lifecyclePhase
    };

    const etag = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(value)));
    if (payload?.ifNoneMatch === etag) return { ok:true, notModified:true, etag };
    return _ensureOk_('api_getSharedReportBundle', SC_GET, { ok:true, etag, value });
  });
}

/**
 * Get aggregated event metrics for SharedReportBundle
 * Reads from ANALYTICS sheet and aggregates by metric type
 *
 * All metrics are derived from logs, not stored on EventCore:
 * - views/uniqueViews from 'view' metric
 * - signupClicks/checkinClicks/feedbackClicks from 'click' with token
 * - sponsor metrics from 'impression'/'click' with sponsorId
 * - league metrics from 'click' with token (schedule/standings/bracket)
 *
 * @param {object} brand - Brand configuration
 * @param {string} eventId - Event ID to filter by
 * @returns {object} SharedReportBundle.metrics structure
 * @private
 */
function getEventMetricsForReport_(brand, eventId) {
  // Initialize metrics structure
  const metrics = {
    views: 0,
    uniqueViews: 0,
    signupClicks: 0,
    checkinClicks: 0,
    feedbackClicks: 0,
    sponsor: {
      totalImpressions: 0,
      totalClicks: 0,
      avgCtr: 0
    },
    league: {
      scheduleClicks: 0,
      standingsClicks: 0,
      bracketClicks: 0
    },
    broadcast: {
      statsClicks: 0,
      scoreboardClicks: 0,
      streamClicks: 0
    }
  };

  try {
    // Get analytics sheet
    const spreadsheetId = brand.spreadsheetId || ZEB.MASTER_SHEET_ID;
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const analyticsSheet = ss.getSheetByName('ANALYTICS');

    if (!analyticsSheet) {
      // No analytics sheet yet - return zero metrics
      return metrics;
    }

    const data = analyticsSheet.getDataRange().getValues().slice(1); // Skip header

    // Track unique userAgents for uniqueViews
    const uniqueUserAgents = new Set();

    // Filter by eventId and aggregate metrics
    // Columns: 0=timestamp, 1=eventId, 2=surface, 3=metric, 4=sponsorId, 5=value, 6=token, 7=userAgent
    for (const row of data) {
      const rowEventId = row[1];

      // Skip if not for this event
      if (rowEventId !== eventId) continue;

      const metricType = row[3];
      const sponsorId = row[4];
      const token = row[6] || '';
      const userAgent = row[7] || '';

      // Aggregate based on metric type
      switch (metricType) {
        case 'view':
        case 'pageview':
          metrics.views++;
          if (userAgent) uniqueUserAgents.add(userAgent);
          break;

        case 'impression':
          if (sponsorId) {
            metrics.sponsor.totalImpressions++;
          }
          break;

        case 'click':
          if (sponsorId) {
            // Sponsor click
            metrics.sponsor.totalClicks++;
          } else {
            // Non-sponsor click - check token for type
            const tokenLower = token.toLowerCase();
            if (tokenLower === 'signup' || tokenLower.includes('signup')) {
              metrics.signupClicks++;
            } else if (tokenLower === 'checkin' || tokenLower.includes('checkin')) {
              metrics.checkinClicks++;
            } else if (tokenLower === 'feedback' || tokenLower.includes('feedback')) {
              metrics.feedbackClicks++;
            }
          }
          break;

        case 'external_click':
          // BBN external link clicks (api_logExternalClick stores linkType in sponsorId column)
          // Valid linkTypes: schedule, standings, bracket, stats, scoreboard, stream
          switch (sponsorId) {
            case 'schedule':
              metrics.league.scheduleClicks++;
              break;
            case 'standings':
              metrics.league.standingsClicks++;
              break;
            case 'bracket':
              metrics.league.bracketClicks++;
              break;
            case 'stats':
              metrics.broadcast.statsClicks++;
              break;
            case 'scoreboard':
              metrics.broadcast.scoreboardClicks++;
              break;
            case 'stream':
              metrics.broadcast.streamClicks++;
              break;
          }
          break;
      }
    }

    // Calculate unique views
    metrics.uniqueViews = uniqueUserAgents.size;

    // Calculate sponsor avgCtr
    if (metrics.sponsor.totalImpressions > 0) {
      metrics.sponsor.avgCtr = +((metrics.sponsor.totalClicks / metrics.sponsor.totalImpressions) * 100).toFixed(2);
    }

  } catch (e) {
    // If analytics sheet doesn't exist or error, return zero metrics
    Logger.log('getEventMetricsForReport_ error: ' + e.message);
  }

  return metrics;
}

// =============================================================================
// [S22] WRITE APIs
// =============================================================================
// Event creation and update APIs requiring authentication.
// All write operations delegate to saveEvent_() from [S18].
//
// Key exports:
//   api_create(payload)        - [LEGACY] Create new event
//   api_updateEventData(req)   - [LEGACY] Update existing event
//   api_saveEvent(req)         - [CANONICAL] Unified create/update (ZEVENT-003)
//
// ZEVENT-003: api_saveEvent is the canonical write path; api_create and
// api_updateEventData are adapters for backward compatibility.
// =============================================================================

/**
 * Create new event (ZEVENT-003: Adapter using saveEvent_)
 * Normalizes payload to Event, delegates to saveEvent_() for contract-first creation
 * @tier mvp
 */
function api_create(payload){
  return runSafe('api_create', () => {
    if(!payload||typeof payload!=='object') return Err(ERR.BAD_INPUT,'Missing payload');
    const { brandId, adminKey, idemKey } = payload;

    // Auth gate
    const g = gate_(brandId, adminKey);
    if (!g.ok) return g;

    // Idempotency check (request-level logic, stays in adapter)
    if (idemKey) {
      if (!/^[a-zA-Z0-9-]{1,128}$/.test(idemKey)) {
        return Err(ERR.BAD_INPUT, 'Invalid idempotency key format');
      }
      const c = CacheService.getScriptCache();
      const k = `idem:${brandId}:${payload.scope || 'events'}:${idemKey}`;
      if (c.get(k)) return Err(ERR.BAD_INPUT, 'Duplicate create');
      c.put(k, '1', 600);
    }

    // Normalize payload to canonical Event structure
    const normalized = normalizeCreatePayloadToEvent_(payload);

    // Delegate to canonical saveEvent_ with mode: 'create'
    const result = saveEvent_(normalized.brandId, normalized.event.id, normalized.event, {
      scope: normalized.scope,
      mode: 'create',
      templateId: normalized.templateId
    });

    if (!result.ok) return result;

    // Generate etag and return with envelope
    const event = result.value;
    const etag = Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(event))
    );

    diag_('info', 'api_create', 'created via normalized saveEvent_', {
      id: event.id,
      brandId: normalized.brandId,
      scope: normalized.scope
    });

    return _ensureOk_('api_create', SC_GET, { ok: true, etag, value: event });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CANONICAL EVENT WRITE API DECISION (ZEVENT-003)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Canonical event write API: api_saveEvent
 *
 * ARCHITECTURE:
 *   api_saveEvent (canonical)     - Contract-First pattern: accepts full Event
 *                                   object per EVENT_CONTRACT.md. Supports both
 *                                   create (no id) and update (has id) modes.
 *                                   This is the V2 canonical write endpoint.
 *
 *   api_updateEventData (alias)   - Load-Merge-Save convenience wrapper for MVP.
 *                                   Loads existing event, merges partial data,
 *                                   delegates to saveEvent_. Kept for backward
 *                                   compatibility with MVP Admin forms.
 *
 * INTERNAL FLOW:
 *   api_saveEvent      → saveEvent_() → Sheet persistence
 *   api_updateEventData → getEventById_() → mergeEventUpdate_() → saveEvent_()
 *
 * WHY api_saveEvent IS CANONICAL:
 *   1. Maps directly to EVENT_CONTRACT.md schema
 *   2. Single source of truth for event shape
 *   3. Cleaner validation (full object vs partial merge)
 *   4. Enables contract-first development in Admin V2
 *
 * MIGRATION PATH:
 *   - MVP Admin continues using api_updateEventData for partial form saves
 *   - V2 Admin will use api_saveEvent with full Event objects
 *   - Both APIs remain supported; neither is deprecated
 *
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Update event data (ZEVENT-003: Load-Merge-Save pattern)
 * Loads existing event via _buildEventContract_, merges update data, saves via saveEvent_
 *
 * NOTE: This is a convenience wrapper over the canonical api_saveEvent.
 * Use for partial field updates in MVP Admin. For full event saves, prefer api_saveEvent.
 *
 * @tier mvp
 */
function api_updateEventData(req){
  return runSafe('api_updateEventData', () => {
    if(!req||typeof req!=='object') return Err(ERR.BAD_INPUT,'Missing payload');
    const { brandId, scope, id, data, adminKey } = req;

    // Auth gate
    const g = gate_(brandId, adminKey);
    if (!g.ok) return g;

    // Step 1: Load existing event via getEventById_ (uses _buildEventContract_)
    const existingResult = getEventById_(brandId, id, {
      scope: scope || 'events',
      hydrateSponsors: true,
      skipValidation: true  // We'll validate after merge
    });

    if (!existingResult.ok) return existingResult;

    // Step 2: Merge incoming data into the existing hydrated event
    const mergedEvent = mergeEventUpdate_(existingResult.value, data);

    // Step 3: Save the merged event via canonical saveEvent_
    const result = saveEvent_(brandId, id, mergedEvent, {
      scope: scope || 'events',
      mode: 'update'
    });

    if (!result.ok) return result;

    // saveEvent_ returns the full hydrated event
    const event = result.value;
    const etag = Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(event))
    );

    diag_('info', 'api_updateEventData', 'updated via load-merge-save', {
      id: event.id,
      brandId,
      scope: scope || 'events'
    });

    return _ensureOk_('api_updateEventData', SC_GET, { ok: true, etag, value: event });
  });
}

/**
 * CANONICAL EVENT WRITE API (ZEVENT-003: Contract-First)
 *
 * Save full Event object. Accepts a complete Event from the frontend and
 * persists via saveEvent_(). This is the canonical write endpoint.
 *
 * Modes:
 *   - CREATE: When event.id is absent, generates new ID/slug/links/QR
 *   - UPDATE: When event.id is present, updates existing event
 *
 * @param {Object} req - Request payload
 * @param {string} req.brandId - Brand ID (required)
 * @param {string} req.adminKey - Admin authentication key (required)
 * @param {Object} req.event - Full Event object per EVENT_CONTRACT.md (required)
 * @param {string} [req.scope] - Scope (default: 'events')
 * @param {string} [req.templateId] - Template ID for create (default: 'custom')
 * @returns {Object} { ok: true, etag, value: Event } or error
 * @tier v2
 * @canonical - This is the canonical event write endpoint
 */
function api_saveEvent(req) {
  return runSafe('api_saveEvent', () => {
    if (!req || typeof req !== 'object') return Err(ERR.BAD_INPUT, 'Missing payload');
    const { brandId, adminKey, event, scope = 'events', templateId = 'custom' } = req;

    // Validate required fields
    if (!event || typeof event !== 'object') {
      return Err(ERR.BAD_INPUT, 'Missing required field: event');
    }

    // Auth gate
    const g = gate_(brandId, adminKey);
    if (!g.ok) return g;

    // Determine mode: create if no ID, update if ID exists
    const isCreate = !event.id;
    const mode = isCreate ? 'create' : 'update';

    // Delegate to canonical saveEvent_
    const result = saveEvent_(brandId, event.id || null, event, {
      scope,
      mode,
      templateId
    });

    if (!result.ok) return result;

    // Generate etag and return
    const savedEvent = result.value;
    const etag = Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(savedEvent))
    );

    diag_('info', 'api_saveEvent', `${mode}d via contract-first save`, {
      id: savedEvent.id,
      brandId,
      scope,
      mode
    });

    return _ensureOk_('api_saveEvent', SC_GET, { ok: true, etag, value: savedEvent });
  });
}

// =============================================================================
// [S23] TRACKING APIs
// =============================================================================
// Analytics event logging and metric tracking. No auth required - public endpoints.
// Data is written to ANALYTICS sheet for reporting.
//
// Key exports:
//   api_logEvents(req)         - Log impressions, clicks, dwell time
//   api_trackEventMetric(req)  - Track individual metric
//   api_logExternalClick(req)  - Log external link clicks with attribution
// =============================================================================

/**
 * Log analytics events (impressions, clicks, dwell time)
 * Core tracking endpoint for the analytics loop
 * Fire-and-forget - no auth required for public tracking
 *
 * Extended columns for attribution:
 * - sessionId: ties events from same page visit together
 * - visibleSponsorIds: (reserved for external_click, not used here)
 *
 * @tier mvp
 */
function api_logEvents(req){
  return runSafe('api_logEvents', () => {
    const items = (req && req.items) || [];
    if (!items.length) return Ok({count:0});

    const sh = _ensureAnalyticsSheet_();
    const now = Date.now();

    // Fixed: Bug #29 - Sanitize all values for spreadsheet to prevent formula injection
    // Extended to 10 columns: +sessionId, +visibleSponsorIds (empty for regular events)
    const rows = items.map(it => [
      new Date(it.ts || now),
      sanitizeSpreadsheetValue_(it.eventId || ''),
      sanitizeSpreadsheetValue_(it.surface || ''),
      sanitizeSpreadsheetValue_(it.metric || ''),
      sanitizeSpreadsheetValue_(it.sponsorId || ''),
      Number(it.value || 0),
      sanitizeSpreadsheetValue_(it.token || ''),
      sanitizeSpreadsheetValue_((it.ua || '').slice(0, 200)),
      sanitizeSpreadsheetValue_(it.sessionId || ''),  // Session ID for attribution
      ''  // visibleSponsorIds - not used for regular sponsor events
    ]);
    sh.getRange(sh.getLastRow()+1, 1, rows.length, 10).setValues(rows);

    diag_('info','api_logEvents','logged',{count: rows.length});
    return Ok({count: rows.length});
  });
}

/**
 * Track a single event metric (simplified analytics seam)
 * Simplified frontend-facing API for analytics tracking
 *
 * Usage from frontend:
 *   trackEventMetric(event.id, 'public', 'view')
 *   trackEventMetric(event.id, 'display', 'impression')
 *   trackEventMetric(event.id, 'poster', 'scan')
 *
 * @param {Object} req
 * @param {string} req.eventId - Event ID (required)
 * @param {string} req.surface - Surface: 'public'|'display'|'poster'|'admin' (required)
 * @param {string} req.action - Action: 'view'|'impression'|'click'|'scan'|'cta_click' (required)
 * @param {string} [req.sponsorId] - Optional sponsor ID for sponsor-specific tracking
 * @param {number} [req.value] - Optional numeric value (e.g., dwell time in seconds)
 * @returns {Object} Result envelope with logged count
 * @tier mvp
 */
function api_trackEventMetric(req) {
  return runSafe('api_trackEventMetric', () => {
    const { eventId, surface, action, sponsorId, value } = req || {};

    // Validate required fields
    if (!eventId || typeof eventId !== 'string') {
      return Err(ERR.BAD_INPUT, 'missing eventId');
    }
    if (!surface || typeof surface !== 'string') {
      return Err(ERR.BAD_INPUT, 'missing surface');
    }
    if (!action || typeof action !== 'string') {
      return Err(ERR.BAD_INPUT, 'missing action');
    }

    // Validate surface is one of the expected values
    const validSurfaces = ['public', 'display', 'poster', 'admin'];
    if (!validSurfaces.includes(surface)) {
      return Err(ERR.BAD_INPUT, 'invalid surface - expected: ' + validSurfaces.join(', '));
    }

    // Validate action is one of the expected values
    const validActions = ['view', 'impression', 'click', 'scan', 'cta_click', 'sponsor_click', 'dwell'];
    if (!validActions.includes(action)) {
      return Err(ERR.BAD_INPUT, 'invalid action - expected: ' + validActions.join(', '));
    }

    // Log to analytics sheet via existing infrastructure
    const sh = _ensureAnalyticsSheet_();
    const now = new Date();

    // Map action to metric name for consistency
    const metricMap = {
      'view': 'impression',
      'impression': 'impression',
      'click': 'click',
      'scan': 'impression',
      'cta_click': 'click',
      'sponsor_click': 'click',
      'dwell': 'dwellSec'
    };

    const row = [
      now,
      sanitizeSpreadsheetValue_(eventId),
      sanitizeSpreadsheetValue_(surface),
      sanitizeSpreadsheetValue_(metricMap[action] || action),
      sanitizeSpreadsheetValue_(sponsorId || ''),
      Number(value || (action === 'dwell' ? 0 : 1)),
      '', // token - not used for simple tracking
      '', // ua - not used for simple tracking
      '', // sessionId - not used for simple tracking
      ''  // visibleSponsorIds - not used for simple tracking
    ];

    sh.getRange(sh.getLastRow() + 1, 1, 1, 10).setValues([row]);

    diag_('info', 'api_trackEventMetric', 'tracked', { eventId, surface, action });
    return Ok({ count: 1 });
  });
}

/**
 * Log external link clicks from League & Broadcast card (BBN/BocceLabs)
 * Fire-and-forget analytics for sponsor/BBN attribution
 *
 * Extended for attribution analysis:
 * - sessionId: ties this click to sponsor impressions in same session
 * - visibleSponsorIds: which sponsors were on-screen when click happened
 *
 * @param {Object} req
 * @param {string} req.eventId - Event ID
 * @param {string} req.linkType - schedule|standings|bracket|stats|scoreboard|stream
 * @param {string} [req.sessionId] - Session UUID for attribution
 * @param {string[]} [req.visibleSponsorIds] - Sponsor IDs visible at click time
 * @param {string} [req.surface] - Surface where click happened (default: 'public')
 * @tier mvp
 */
function api_logExternalClick(req) {
  return runSafe('api_logExternalClick', () => {
    const { eventId, linkType, sessionId, visibleSponsorIds, surface } = req || {};

    // Validate inputs
    if (!eventId || typeof eventId !== 'string') {
      return Err(ERR.BAD_INPUT, 'missing or invalid eventId');
    }
    if (!linkType || typeof linkType !== 'string') {
      return Err(ERR.BAD_INPUT, 'missing or invalid linkType');
    }

    // Validate linkType is one of the expected values
    const validLinkTypes = ['schedule', 'standings', 'bracket', 'stats', 'scoreboard', 'stream'];
    if (!validLinkTypes.includes(linkType)) {
      return Err(ERR.BAD_INPUT, 'invalid linkType');
    }

    // Log to analytics sheet
    const sh = _ensureAnalyticsSheet_();
    const now = new Date();

    // Serialize visibleSponsorIds as JSON if provided
    const sponsorIdsJson = Array.isArray(visibleSponsorIds) && visibleSponsorIds.length > 0
      ? JSON.stringify(visibleSponsorIds.slice(0, 20))  // Cap at 20 to prevent bloat
      : '';

    // Extended analytics columns (10 total):
    // [timestamp, eventId, surface, metric, sponsorId/linkType, value, token, ua, sessionId, visibleSponsorIds]
    const row = [
      now,
      sanitizeSpreadsheetValue_(eventId),
      sanitizeSpreadsheetValue_(surface || 'public'),  // surface
      'external_click',                                 // metric
      sanitizeSpreadsheetValue_(linkType),              // linkType in sponsorId column
      1,                                                // value (1 click)
      '',                                               // token (unused)
      '',                                               // ua (unused for this endpoint)
      sanitizeSpreadsheetValue_(sessionId || ''),       // sessionId for attribution
      sanitizeSpreadsheetValue_(sponsorIdsJson)         // visibleSponsorIds JSON
    ];

    sh.getRange(sh.getLastRow() + 1, 1, 1, 10).setValues([row]);

    diag_('info', 'api_logExternalClick', 'logged', { eventId, linkType, hasSession: !!sessionId, sponsorCount: visibleSponsorIds?.length || 0 });
    return Ok({ logged: true });
  });
}

/**
 * Get event analytics report
 * @tier mvp
 */
function api_getReport(req){
  return runSafe('api_getReport', () => {
    const { brandId, adminKey } = req || {};

    // Fixed: Add authentication check - Bug #6
    const g = gate_(brandId || 'root', adminKey);
    if (!g.ok) return g;

    const eventId = String(req && req.id || '');
    if (!eventId) return Err(ERR.BAD_INPUT,'missing id');

    // Fixed: Bug #30 - Verify event belongs to brand before returning analytics
    const brand= g.value.brand;
    const eventSheet = SpreadsheetApp.openById(brand.store.spreadsheetId)
      .getSheetByName(brand.scopesAllowed.includes('events') ? 'EVENTS' : 'EVENTS');

    if (!eventSheet) {
      return Err(ERR.NOT_FOUND, 'Events sheet not found');
    }

    // Verify event exists and belongs to this brand
    const eventRows = eventSheet.getDataRange().getValues().slice(1);
    const event = eventRows.find(r => r[0] === eventId && r[1] === brandId);

    if (!event) {
      diag_('warn', 'api_getReport', 'Unauthorized analytics access attempt', { eventId, brandId });
      return Err(ERR.NOT_FOUND, 'Event not found or unauthorized');
    }

    const sh = _ensureAnalyticsSheet_();
    const data = sh.getDataRange().getValues().slice(1)
      .filter(r => r[1] === eventId);

    const agg = {
      totals: { impressions:0, clicks:0, dwellSec:0 },
      bySurface: {},
      bySponsor: {},
      byToken: {}
    };

    // Fixed: Bug #39 - Use explicit null/undefined checks instead of || operator
    for (const r of data){
      const surface = r[2];
      const metric = r[3];
      const sponsorId = (r[4] !== null && r[4] !== undefined && r[4] !== '') ? r[4] : '-';
      const value = Number((r[5] !== null && r[5] !== undefined) ? r[5] : 0);
      const token = (r[6] !== null && r[6] !== undefined && r[6] !== '') ? r[6] : '-';

      if (!agg.bySurface[surface]) agg.bySurface[surface] = {impressions:0, clicks:0, dwellSec:0};
      if (!agg.bySponsor[sponsorId]) agg.bySponsor[sponsorId] = {impressions:0, clicks:0, dwellSec:0};
      if (!agg.byToken[token]) agg.byToken[token] = {impressions:0, clicks:0, dwellSec:0};
      const surf = agg.bySurface[surface];
      const spons = agg.bySponsor[sponsorId];
      const tok = agg.byToken[token];

      if (metric === 'impression'){
        agg.totals.impressions++; surf.impressions++; spons.impressions++; tok.impressions++;
      }
      if (metric === 'click'){
        agg.totals.clicks++; surf.clicks++; spons.clicks++; tok.clicks++;
      }
      if (metric === 'dwellSec'){
        agg.totals.dwellSec += value; surf.dwellSec += value; spons.dwellSec += value; tok.dwellSec += value;
      }
    }

    // Calculate CTR for sponsors and tokens
    for (const k in agg.bySponsor){
      const s = agg.bySponsor[k];
      s.ctr = s.impressions ? +(s.clicks / s.impressions).toFixed(4) : 0;
    }
    for (const k in agg.byToken){
      const t = agg.byToken[k];
      t.ctr = t.impressions ? +(t.clicks / t.impressions).toFixed(4) : 0;
    }

    return Ok(agg);
  });
}

/**
 * Export report to spreadsheet
 * @tier v2 - Advanced export matrix
 */
function api_exportReport(req){
  return runSafe('api_exportReport', () => {
    const eventId = String(req && req.id || '');
    if (!eventId) return Err(ERR.BAD_INPUT,'missing id');

    // Security fix: Pass credentials to api_getReport for proper authentication
    const { brandId, adminKey } = req || {};
    const rep = api_getReport({id: eventId, brandId: brandId || 'root', adminKey});
    if (!rep.ok) return rep;

    const ss = SpreadsheetApp.getActive();
    const name = `Report – ${eventId}`;
    let sh = ss.getSheetByName(name);
    if (sh) ss.deleteSheet(sh);
    sh = ss.insertSheet(name);

    // Totals
    sh.getRange(1,1,1,2).setValues([['Metric','Total']]).setFontWeight('bold');
    sh.getRange(2,1,3,2).setValues([
      ['Impressions', rep.value.totals.impressions],
      ['Clicks',      rep.value.totals.clicks],
      ['Dwell (sec)', rep.value.totals.dwellSec]
    ]);

    // By Surface
    sh.getRange(6,1,1,4).setValues([['Surface','Impressions','Clicks','Dwell (sec)']]).setFontWeight('bold');
    const srows = Object.entries(rep.value.bySurface).map(([k,v]) => [k,v.impressions,v.clicks,v.dwellSec]);
    if (srows.length) sh.getRange(7,1,srows.length,4).setValues(srows);

    // By Sponsor
    sh.getRange(6,6,1,5).setValues([['SponsorId','Impressions','Clicks','CTR','Dwell (sec)']]).setFontWeight('bold');
    const prows = Object.entries(rep.value.bySponsor).map(([k,v]) => [k,v.impressions,v.clicks,v.ctr,v.dwellSec]);
    if (prows.length) sh.getRange(7,6,prows.length,5).setValues(prows);

    // By Token
    sh.getRange(6,12,1,5).setValues([['Token','Impressions','Clicks','CTR','Dwell (sec)']]).setFontWeight('bold');
    const trows = Object.entries(rep.value.byToken).filter(([k]) => k !== '-').map(([k,v]) => [k,v.impressions,v.clicks,v.ctr,v.dwellSec]);
    if (trows.length) sh.getRange(7,12,trows.length,5).setValues(trows);

    sh.autoResizeColumns(1, 15);

    diag_('info','api_exportReport','exported',{eventId, sheetId: sh.getSheetId()});
    return Ok({sheetUrl: ss.getUrl() + '#gid=' + sh.getSheetId()});
  });
}

// =============================================================================
// [S24] SPONSOR ANALYTICS APIs
// =============================================================================
// Sponsor-specific analytics, ROI calculation, and settings APIs.
// Used by Sponsor.html and SharedReport.html surfaces.
//
// Key exports:
//   api_getSponsorAnalytics(req)      - Sponsor-scoped analytics
//   api_getSponsorROI(req)            - ROI calculation with engagement score
//   api_getSponsorSettings(req)       - Sponsor placement settings
//   api_getSponsorReportQr(req)       - Generate sponsor report QR code
//   api_validateSponsorPlacements(req) - Validate placement configuration
//   calculateEngagementScore_(...)    - Compute engagement score
//   generateSponsorInsights_(agg)     - Generate insights from aggregates
// =============================================================================

/**
 * Get sponsor-specific analytics data
 *
 * SCHEMA CONTRACT: /schemas/analytics.schema.json
 * Returns the same SharedAnalytics shape as api_getSharedAnalytics,
 * but scoped to a specific sponsor.
 *
 * @param {object} req - Request object
 * @param {string} req.sponsorId - Sponsor ID (required)
 * @param {string} [req.eventId] - Filter by specific event
 * @param {string} [req.brandId] - Brand ID
 * @returns {object} SharedAnalytics shape scoped to sponsor
 * @tier mvp - Core analytics for sponsor value proposition
 */
function api_getSponsorAnalytics(req) {
  return runSafe('api_getSponsorAnalytics', () => {
    if (!req || typeof req !== 'object') return Err(ERR.BAD_INPUT, 'Missing payload');

    const { sponsorId, eventId, brandId } = req;

    if (!sponsorId) return Err(ERR.BAD_INPUT, 'Missing sponsorId');

    // Dark Launch / Kill Switch: Check if Sponsor Analytics is enabled for this brand
    const featureGate = requireBrandFeature_(brandId, 'sponsorAnalyticsEnabled');
    if (featureGate) {
      return featureGate;
    }

    // Delegate to api_getSharedAnalytics with sponsor filter
    // This ensures both endpoints return the exact same shape
    return api_getSharedAnalytics({
      brandId: brandId,
      sponsorId: sponsorId,
      eventId: eventId,
      isSponsorView: true
    });
  });
}

/**
 * Get Sponsor ROI Dashboard
 * High-value feature providing comprehensive ROI analysis for sponsors
 *
 * @param {object} req - Request object
 * @param {string} req.sponsorId - Sponsor ID
 * @param {number} [req.sponsorshipCost] - Total sponsorship investment
 * @param {number} [req.costPerClick] - Expected cost per click
 * @param {number} [req.conversionRate] - Conversion rate percentage
 * @param {number} [req.avgTransactionValue] - Average transaction value
 * @param {string} [req.dateFrom] - Start date (ISO)
 * @param {string} [req.dateTo] - End date (ISO)
 * @param {string} [req.brandId] - Brand ID
 * @param {string} [req.adminKey] - Admin key for authentication
 * @returns {object} ROI dashboard with metrics, financials, and insights
 * @tier mvp - The WOW factor: real ROI numbers for sponsors
 */
function api_getSponsorROI(req) {
  return runSafe('api_getSponsorROI', () => {
    if (!req || typeof req !== 'object') {
      return Err(ERR.BAD_INPUT, 'Missing payload');
    }

    const { sponsorId, brandId, adminKey } = req;

    if (!sponsorId) {
      return Err(ERR.BAD_INPUT, 'Missing sponsorId');
    }

    // Dark Launch / Kill Switch: Check if Sponsor Analytics is enabled for this brand
    const featureGate = requireBrandFeature_(brandId, 'sponsorAnalyticsEnabled');
    if (featureGate) {
      return featureGate;
    }

    // Optional authentication - sponsors can view their own data
    // Admin key allows viewing any sponsor's data
    if (adminKey) {
      const g = gate_(brandId || 'root', adminKey);
      if (!g.ok) return g;
    }

    // Use SponsorService to calculate ROI
    const roiResult = SponsorService_calculateROI({
      sponsorId: req.sponsorId,
      sponsorshipCost: req.sponsorshipCost || 0,
      costPerClick: req.costPerClick || 0,
      conversionRate: req.conversionRate || 0,
      avgTransactionValue: req.avgTransactionValue || 0,
      dateFrom: req.dateFrom,
      dateTo: req.dateTo
    });

    if (!roiResult.ok) {
      return roiResult;
    }

    diag_('info', 'api_getSponsorROI', 'ROI dashboard retrieved', {
      sponsorId,
      roi: roiResult.value.financials.roi
    });

    return roiResult;
  });
}

/**
 * Get sponsor placement settings and configurations
 *
 * Returns available placement positions, allowed positions per surface,
 * and upsell opportunities (e.g., dedicated TV pane).
 *
 * @param {object} req - Request parameters
 * @param {string} [req.brandId] - Brand ID for brand-specific settings
 * @returns {object} Result envelope with sponsor settings
 * @tier mvp
 */
function api_getSponsorSettings(req) {
  return runSafe('api_getSponsorSettings', () => {
    const { brandId } = req || {};

    // Use SponsorService to get settings
    const settingsResult = SponsorService_getSettings({ brandId });

    if (!settingsResult.ok) {
      return settingsResult;
    }

    diag_('info', 'api_getSponsorSettings', 'Settings retrieved', {
      brandId: brandId || 'default',
      placementsCount: Object.keys(settingsResult.value.placements).length
    });

    return settingsResult;
  });
}

/**
 * Get QR code for sponsor report link
 *
 * Generates a QR code that links to the sponsor's SharedReport view.
 * Returns both the URL and base64-encoded PNG QR code.
 *
 * Invariant: If the URL cannot be verified (e.g., no valid deployment),
 * qrB64 will be empty and the frontend should not render the QR image.
 *
 * @param {object} req - Request parameters
 * @param {string} req.sponsorId - Sponsor ID to generate QR for
 * @param {string} [req.brandId] - Brand ID (optional)
 * @param {string} [req.adminKey] - Admin key for authentication
 * @returns {object} Result envelope with { url, qrB64 }
 * @tier mvp
 */
function api_getSponsorReportQr(req) {
  return runSafe('api_getSponsorReportQr', () => {
    if (!req || typeof req !== 'object') {
      return Err(ERR.BAD_INPUT, 'Missing payload');
    }

    const { sponsorId, brandId, adminKey } = req;

    if (!sponsorId) {
      return Err(ERR.BAD_INPUT, 'Missing sponsorId');
    }

    // Sanitize sponsorId to prevent injection
    const sanitizedSponsorId = sanitizeId_(sponsorId);
    if (!sanitizedSponsorId) {
      return Err(ERR.BAD_INPUT, 'Invalid sponsorId format');
    }

    // Optional authentication - admin can request QR for any sponsor
    if (adminKey && brandId) {
      const g = gate_(brandId, adminKey);
      if (!g.ok) return g;
    }

    // Build the sponsor report URL
    let baseUrl = '';
    try {
      baseUrl = ScriptApp.getService().getUrl();
    } catch (e) {
      diag_('warn', 'api_getSponsorReportQr', 'Could not get deployment URL', { error: e.message });
      // Return empty QR if URL cannot be verified
      return Ok({ url: '', qrB64: '', verified: false });
    }

    if (!baseUrl) {
      // No valid deployment URL - return empty QR (invariant: no QR for unverified URLs)
      return Ok({ url: '', qrB64: '', verified: false });
    }

    // Build sponsor report URL: ?page=report&sponsor=true&sponsorId=<ID>
    const sponsorReportUrl = `${baseUrl}?page=report&sponsor=true&sponsorId=${encodeURIComponent(sanitizedSponsorId)}`;

    // Generate QR code as base64 data URI
    const qrDataUri = generateQRDataUri_(sponsorReportUrl);

    // Extract just the base64 part (remove "data:image/png;base64," prefix)
    let qrB64 = '';
    if (qrDataUri && qrDataUri.startsWith('data:image/png;base64,')) {
      qrB64 = qrDataUri.substring('data:image/png;base64,'.length);
    }

    diag_('info', 'api_getSponsorReportQr', 'QR code generated', {
      sponsorId: sanitizedSponsorId,
      hasQr: !!qrB64
    });

    return Ok({
      url: sponsorReportUrl,
      qrB64: qrB64,
      verified: !!qrB64  // QR only generated for verified/valid URLs
    });
  });
}

/**
 * Validate sponsor placement configuration
 *
 * Ensures sponsors are assigned to valid placements and don't exceed limits.
 *
 * @param {object} req - Request parameters
 * @param {array} req.sponsors - Array of sponsor objects with placements
 * @param {string} [req.brandId] - Brand ID for settings lookup
 * @returns {object} Result envelope with validation results
 * @tier mvp
 */
function api_validateSponsorPlacements(req) {
  return runSafe('api_validateSponsorPlacements', () => {
    const { sponsors, brandId } = req || {};

    if (!Array.isArray(sponsors)) {
      return Err(ERR.BAD_INPUT, 'Sponsors must be an array');
    }

    // Use SponsorService to validate placements
    const validationResult = SponsorService_validatePlacements({
      sponsors,
      brandId
    });

    if (!validationResult.ok) {
      return validationResult;
    }

    diag_('info', 'api_validateSponsorPlacements', 'Placements validated', {
      brandId: brandId || 'default',
      valid: validationResult.value.valid,
      totalSponsors: validationResult.value.totalSponsors,
      errorsCount: validationResult.value.errors.length,
      warningsCount: validationResult.value.warnings.length
    });

    return validationResult;
  });
}

/**
 * Calculate engagement score from CTR and dwell time
 * @param {number} ctr - Click-through rate (percentage)
 * @param {number} dwellSec - Total dwell time in seconds
 * @param {number} impressions - Total impressions
 * @returns {number} Engagement score (0-100)
 */
function calculateEngagementScore_(ctr, dwellSec, impressions) {
  if (impressions === 0) return 0;

  // Normalize dwell time (assuming 5 seconds is good engagement per impression)
  const avgDwellPerImpression = dwellSec / impressions;
  const normalizedDwell = Math.min(avgDwellPerImpression / 5 * 100, 100);

  // Weight: 60% CTR, 40% dwell time
  const score = (ctr * 0.6) + (normalizedDwell * 0.4);

  return +score.toFixed(2);
}

/**
 * Generate performance insights for sponsors
 * @param {object} agg - Aggregated analytics data
 * @returns {array} Array of insight objects
 */
function generateSponsorInsights_(agg) {
  const insights = [];

  // Insight 1: Best performing surface
  let bestSurface = null;
  let bestCTR = 0;

  for (const [surface, data] of Object.entries(agg.bySurface)) {
    if (data.ctr > bestCTR && data.impressions >= 10) { // Need at least 10 impressions for statistical relevance
      bestCTR = data.ctr;
      bestSurface = surface;
    }
  }

  if (bestSurface) {
    insights.push({
      type: 'success',
      title: 'Top Performing Surface',
      message: `Your ${bestSurface} ads have the highest CTR at ${bestCTR}%. Consider increasing investment in this channel.`,
      metric: { surface: bestSurface, ctr: bestCTR }
    });
  }

  // Insight 2: Low CTR warning
  if (agg.totals.impressions >= 100 && agg.totals.ctr < 1) {
    insights.push({
      type: 'warning',
      title: 'Low Click-Through Rate',
      message: `Your overall CTR is ${agg.totals.ctr}%. Consider refreshing your ad creative or targeting to improve engagement.`,
      metric: { ctr: agg.totals.ctr }
    });
  }

  // Insight 3: Surface comparison
  const surfaces = Object.keys(agg.bySurface);
  if (surfaces.length > 1) {
    const surfacePerformance = surfaces.map(s => ({
      name: s,
      ...agg.bySurface[s]
    })).sort((a, b) => b.ctr - a.ctr);

    if (surfacePerformance.length >= 2) {
      const top = surfacePerformance[0];
      const bottom = surfacePerformance[surfacePerformance.length - 1];

      if (top.ctr > bottom.ctr * 2 && bottom.impressions >= 10) {
        insights.push({
          type: 'info',
          title: 'Surface Performance Gap',
          message: `${top.name} performs ${(top.ctr / bottom.ctr).toFixed(1)}x better than ${bottom.name}. Consider reallocating budget.`,
          metric: { topSurface: top.name, topCTR: top.ctr, bottomSurface: bottom.name, bottomCTR: bottom.ctr }
        });
      }
    }
  }

  // Insight 4: Engagement quality
  if (agg.totals.impressions > 0) {
    const avgDwell = agg.totals.dwellSec / agg.totals.impressions;
    if (avgDwell > 5) {
      insights.push({
        type: 'success',
        title: 'High Engagement Quality',
        message: `Users spend an average of ${avgDwell.toFixed(1)} seconds viewing your ads, indicating strong interest.`,
        metric: { avgDwellSec: avgDwell }
      });
    } else if (avgDwell < 2 && agg.totals.impressions >= 50) {
      insights.push({
        type: 'warning',
        title: 'Short View Duration',
        message: `Average view time is only ${avgDwell.toFixed(1)} seconds. Your ad creative may not be capturing attention.`,
        metric: { avgDwellSec: avgDwell }
      });
    }
  }

  // Insight 5: Recent trend
  if (agg.timeline.length >= 7) {
    const recent = agg.timeline.slice(-7);
    const older = agg.timeline.slice(-14, -7);

    if (older.length >= 7) {
      const recentAvgCTR = recent.reduce((sum, d) => sum + d.ctr, 0) / recent.length;
      const olderAvgCTR = older.reduce((sum, d) => sum + d.ctr, 0) / older.length;

      if (recentAvgCTR > olderAvgCTR * 1.2) {
        insights.push({
          type: 'success',
          title: 'Improving Trend',
          message: `Your CTR has increased by ${((recentAvgCTR / olderAvgCTR - 1) * 100).toFixed(0)}% in the last week compared to the previous week.`,
          metric: { recentCTR: recentAvgCTR, previousCTR: olderAvgCTR, change: recentAvgCTR - olderAvgCTR }
        });
      } else if (olderAvgCTR > recentAvgCTR * 1.2) {
        insights.push({
          type: 'warning',
          title: 'Declining Performance',
          message: `Your CTR has decreased by ${((1 - recentAvgCTR / olderAvgCTR) * 100).toFixed(0)}% in the last week. Consider refreshing your ad creative.`,
          metric: { recentCTR: recentAvgCTR, previousCTR: olderAvgCTR, change: recentAvgCTR - olderAvgCTR }
        });
      }
    }
  }

  return insights;
}

// =============================================================================
// [S25] SHORTLINKS & FORMS APIs
// =============================================================================
// Shortlink creation and Google Forms integration.
// Shortlinks enable CTR tracking; Forms provide registration capabilities.
//
// Key exports:
//   api_createShortlink(req)        - Create trackable shortlink
//   api_listFormTemplates()         - List available form templates
//   api_createFormFromTemplate(req) - Create Google Form from template
//   api_generateFormShortlink(req)  - Create trackable form link
// =============================================================================

/**
 * Create trackable shortlink for CTR tracking
 * @tier mvp - Core tracking for analytics loop
 */
function api_createShortlink(req){
  return runSafe('api_createShortlink', () => {
    if(!req||typeof req!=='object') return Err(ERR.BAD_INPUT,'Missing payload');
    const { targetUrl, eventId, sponsorId, surface, adminKey, brandId } = req;

    if (!targetUrl) return Err(ERR.BAD_INPUT,'Missing targetUrl');

    // Fixed: Bug #45 & #51 - Validate targetUrl format and length
    if (!isUrl(targetUrl, 2048)) {
      diag_('warn', 'api_createShortlink', 'Invalid or too long URL', {targetUrl: targetUrl.substring(0, 100)});
      return Err(ERR.BAD_INPUT, 'Invalid or too long targetUrl (max 2048 characters)');
    }

    const g=gate_(brandId||'root', adminKey); if(!g.ok) return g;

    const sh = _ensureShortlinksSheet_();

    // Fixed: Bug #34 - Use full UUID for secure token generation (128-bit entropy)
    // Previously used only first 8 chars which was guessable (~30-bit entropy)
    const token = Utilities.getUuid();

    // Fixed: Bug #53 - Store brandId for validation on redirect
    sh.appendRow([
      token,
      targetUrl,
      eventId||'',
      sponsorId||'',
      surface||'',
      new Date().toISOString(),
      brandId||'root' // Add brandId for cross-brand validation
    ]);

    const base = ScriptApp.getService().getUrl();
    const shortlink = `${base}?p=r&t=${token}`;

    diag_('info','api_createShortlink','created',{token, targetUrl, eventId, sponsorId});
    return Ok({ token, shortlink, targetUrl });
  });
}

// === Google Forms Template Creation ===

/**
 * List available form templates
 * @tier mvp
 */
function api_listFormTemplates(){
  return runSafe('api_listFormTemplates', () => {
    const templates = listFormTemplates_();
    return Ok({ templates });
  });
}

/**
 * Create Google Form from template
 * @tier mvp
 */
function api_createFormFromTemplate(req){
  return runSafe('api_createFormFromTemplate', () => {
    if(!req||typeof req!=='object') return Err(ERR.BAD_INPUT,'Missing payload');
    const { templateType, eventName, eventId, adminKey, brandId } = req;

    if (!templateType) return Err(ERR.BAD_INPUT,'Missing templateType');

    const g=gate_(brandId||'root', adminKey); if(!g.ok) return g;

    const template = findFormTemplate_(templateType);
    if (!template) return Err(ERR.BAD_INPUT, `Unknown template type: ${templateType}`);

    try {
      // Create the form
      const formTitle = eventName ? `${eventName} - ${template.label}` : template.label;
      const form = FormApp.create(formTitle);

      form.setDescription(template.description);
      form.setCollectEmail(true);
      form.setLimitOneResponsePerUser(false);
      form.setShowLinkToRespondAgain(true);

      // Add questions from template
      template.questions.forEach(q => {
        let item;

        switch(q.type) {
          case 'TEXT':
            item = form.addTextItem();
            item.setTitle(q.title);
            if (q.required) item.setRequired(true);
            break;

          case 'PARAGRAPH_TEXT':
            item = form.addParagraphTextItem();
            item.setTitle(q.title);
            if (q.required) item.setRequired(true);
            break;

          case 'MULTIPLE_CHOICE':
            item = form.addMultipleChoiceItem();
            item.setTitle(q.title);
            if (q.choices && q.choices.length > 0) {
              item.setChoiceValues(q.choices);
            }
            if (q.required) item.setRequired(true);
            break;

          case 'SCALE':
            item = form.addScaleItem();
            item.setTitle(q.title);
            if (q.scaleMin && q.scaleMax) {
              item.setBounds(q.scaleMin, q.scaleMax);
            }
            if (q.scaleMinLabel) item.setLabels(q.scaleMinLabel, q.scaleMaxLabel || '');
            if (q.required) item.setRequired(true);
            break;

          default:
            // Default to text item
            item = form.addTextItem();
            item.setTitle(q.title);
            if (q.required) item.setRequired(true);
        }
      });

      // Create response spreadsheet
      const responseSheet = SpreadsheetApp.create(`${formTitle} - Responses`);
      form.setDestination(FormApp.DestinationType.SPREADSHEET, responseSheet.getId());

      const formId = form.getId();
      const editUrl = form.getEditUrl();
      const publishedUrl = form.getPublishedUrl();
      const responseSheetUrl = responseSheet.getUrl();

      diag_('info','api_createFormFromTemplate','created',{formId, templateType, eventId});

      return Ok({
        formId,
        editUrl,
        publishedUrl,
        responseSheetUrl,
        templateType,
        eventId: eventId || ''
      });

    } catch(e) {
      diag_('error','api_createFormFromTemplate','failed',{error: e.toString(), templateType});
      return Err(ERR.INTERNAL, `Failed to create form: ${e.toString()}`);
    }
  });
}

/**
 * Generate trackable shortlink for form URL
 * @tier mvp
 */
function api_generateFormShortlink(req){
  return runSafe('api_generateFormShortlink', () => {
    if(!req||typeof req!=='object') return Err(ERR.BAD_INPUT,'Missing payload');
    const { formUrl, formType, eventId, adminKey, brandId } = req;

    if (!formUrl) return Err(ERR.BAD_INPUT,'Missing formUrl');

    // Use existing shortlink API
    return api_createShortlink({
      targetUrl: formUrl,
      eventId: eventId || '',
      sponsorId: '',
      surface: `form-${formType || 'unknown'}`,
      adminKey,
      brandId
    });
  });
}

// =============================================================================
// [S26] V2+ PORTFOLIO APIs
// =============================================================================
// Multi-brand portfolio analytics for parent organizations.
// These APIs work but are NOT MVP focus - don't design around them for v1.
//
// ═══════════════════════════════════════════════════════════════════════════════
// [V2-ONLY] FEATURE FLAG GUARD: PORTFOLIO_V2
// ═══════════════════════════════════════════════════════════════════════════════
// All portfolio APIs below require FEATURE_FLAGS.PORTFOLIO_V2 = true
// With PORTFOLIO_V2 = false (MVP default), these APIs return a "feature disabled" error.
//
// Key exports:
//   api_getPortfolioSponsorReport(req) - Cross-brand sponsor report
//   api_getPortfolioSummary(req)       - Portfolio summary metrics
//   api_getPortfolioSponsors(req)      - List portfolio sponsors
//   api_runDiagnostics()               - System diagnostics
//   getPortfolioSponsorReport_(...)    - Portfolio report implementation
//   getPortfolioSummary_(brandId)      - Summary implementation
//   getPortfolioSponsors_(brandId)     - Sponsors list implementation
// =============================================================================

/**
 * Get consolidated sponsor report across brand portfolio
 * @param {object} req - Request with brandId, adminKey, sponsorId, options
 * @returns {object} - Portfolio-wide sponsor analytics
 * @tier v2 - Multi-event portfolio analytics
 * @feature PORTFOLIO_V2
 */
function api_getPortfolioSponsorReport(req) {
  return runSafe('api_getPortfolioSponsorReport', () => {
    // [V2-ONLY] Guard: Require PORTFOLIO_V2 feature flag
    const featureCheck = requireFeature_('PORTFOLIO_V2');
    if (featureCheck) return featureCheck;

    const { brandId, adminKey, sponsorId, options } = req;

    // Validate parent brand
    const brand= findBrand_(brandId);
    if (!brand) {
      return Err(ERR.NOT_FOUND, 'Brand not found');
    }

    if (brand.type !== 'parent') {
      return Err(ERR.BAD_INPUT, 'Only parent organizations can access portfolio reports');
    }

    // Verify admin access
    if (!isValidAdminKey_(adminKey, brandId)) {
      return Err(ERR.BAD_INPUT, 'Invalid admin key');
    }

    // Get portfolio report
    const result = getPortfolioSponsorReport_(brandId, sponsorId, options || {});

    if (!result.ok) {
      return Err(ERR.INTERNAL, result.error || 'Failed to generate portfolio report');
    }

    return Ok(result.value);
  });
}

/**
 * Get brand portfolio summary for parent organization
 * @param {object} req - Request with brandId, adminKey
 * @returns {object} - Portfolio summary
 * @tier v2 - Multi-event portfolio analytics
 * @feature PORTFOLIO_V2
 */
function api_getPortfolioSummary(req) {
  return runSafe('api_getPortfolioSummary', () => {
    // [V2-ONLY] Guard: Require PORTFOLIO_V2 feature flag
    const featureCheck = requireFeature_('PORTFOLIO_V2');
    if (featureCheck) return featureCheck;

    const { brandId, adminKey } = req;

    // Validate parent brand
    const brand= findBrand_(brandId);
    if (!brand) {
      return Err(ERR.NOT_FOUND, 'Brand not found');
    }

    if (brand.type !== 'parent') {
      return Err(ERR.BAD_INPUT, 'Only parent organizations can access portfolio summary');
    }

    // Verify admin access
    if (!isValidAdminKey_(adminKey, brandId)) {
      return Err(ERR.BAD_INPUT, 'Invalid admin key');
    }

    // Get portfolio summary
    const result = getPortfolioSummary_(brandId);

    if (!result.ok) {
      return Err(ERR.INTERNAL, result.error || 'Failed to generate portfolio summary');
    }

    return Ok(result.value);
  });
}

/**
 * Get list of all sponsors across brand portfolio
 * @param {object} req - Request with brandId, adminKey
 * @returns {object} - Portfolio sponsors list
 * @tier v2 - Multi-event portfolio analytics
 * @feature PORTFOLIO_V2
 */
function api_getPortfolioSponsors(req) {
  return runSafe('api_getPortfolioSponsors', () => {
    // [V2-ONLY] Guard: Require PORTFOLIO_V2 feature flag
    const featureCheck = requireFeature_('PORTFOLIO_V2');
    if (featureCheck) return featureCheck;

    const { brandId, adminKey } = req;

    // Validate parent brand
    const brand= findBrand_(brandId);
    if (!brand) {
      return Err(ERR.NOT_FOUND, 'Brand not found');
    }

    if (brand.type !== 'parent') {
      return Err(ERR.BAD_INPUT, 'Only parent organizations can access portfolio sponsors');
    }

    // Verify admin access
    if (!isValidAdminKey_(adminKey, brandId)) {
      return Err(ERR.BAD_INPUT, 'Invalid admin key');
    }

    // Get portfolio sponsors
    const result = getPortfolioSponsors_(brandId);

    if (!result.ok) {
      return Err(ERR.INTERNAL, result.error || 'Failed to get portfolio sponsors');
    }

    return Ok(result.value);
  });
}

/**
 * Run full system diagnostics
 * @tier mvp - Useful for debugging setup issues
 */
function api_runDiagnostics(){
  return runSafe('api_runDiagnostics', () => {
    const steps = [];
    let eventId = null;
    let sheetUrl = null;

    try {
      // 1. Status check
      const st = api_status('root');
      steps.push({ name: 'status', ok: st.ok, error: st.ok ? null : st.message });
      if (!st.ok) return Ok({ steps, ok: false });

      // 2. Create temp event
      const create = api_create({
        brandId: 'root',
        scope: 'events',
        templateId: 'event',
        adminKey: getAdminSecret_('root'),
        idemKey: `diag-${Date.now()}`,
        data: { name: 'Diagnostic Test Event', dateISO: '2025-12-31', signupUrl: '' }
      });
      steps.push({ name: 'create_event', ok: create.ok, error: create.ok ? null : create.message });
      if (!create.ok) return Ok({ steps, ok: false });
      eventId = create.value.id;

      // 3. Update display config
      const upd = api_updateEventData({
        brandId: 'root',
        scope: 'events',
        id: eventId,
        adminKey: getAdminSecret_('root'),
        data: {
          display: { mode: 'static' },
          sponsors: [{ id: 'test-sp1', name: 'Test Sponsor', placements: { tvTop: true } }]
        }
      });
      steps.push({ name: 'update_config', ok: upd.ok, error: upd.ok ? null : upd.message });

      // 4. Log analytics
      const log = api_logEvents({
        items: [
          { eventId, surface: 'display', metric: 'impression', sponsorId: 'test-sp1' },
          { eventId, surface: 'display', metric: 'dwellSec', value: 10 }
        ]
      });
      steps.push({ name: 'log_analytics', ok: log.ok, error: log.ok ? null : log.message });

      // 5. Get report
      const rep = api_getReport({ id: eventId });
      steps.push({ name: 'get_report', ok: rep.ok, error: rep.ok ? null : rep.message });

      // 6. Export report
      const exp = api_exportReport({ id: eventId });
      steps.push({ name: 'export_report', ok: exp.ok, error: exp.ok ? null : exp.message });
      if (exp.ok) sheetUrl = exp.value.sheetUrl;

      // 7. Create shortlink
      const sl = api_createShortlink({
        brandId: 'root',
        adminKey: findBrand_('root').adminSecret,
        targetUrl: create.value.links.publicUrl,
        eventId,
        surface: 'test'
      });
      steps.push({ name: 'create_shortlink', ok: sl.ok, error: sl.ok ? null : sl.message });

      const allOk = steps.every(s => s.ok);
      diag_('info', 'api_runDiagnostics', allOk ? 'All checks passed' : 'Some checks failed', { steps });

      return Ok({ steps, eventId, sheetUrl, ok: allOk });
    } catch(e) {
      steps.push({ name: 'exception', ok: false, error: String(e) });
      return Ok({ steps, ok: false });
    }
  });
}

/**
 * Get consolidated sponsor report across brand portfolio
 *
 * @param {string} parentBrandId - Parent organization (e.g., 'abc')
 * @param {string} sponsorId - Sponsor ID to report on
 * @param {object} options - Optional filters (dateRange, etc.)
 * @returns {object} - Aggregated sponsor metrics
 */
function getPortfolioSponsorReport_(parentBrandId, sponsorId, options = {}) {
  const parentBrand = findBrand_(parentBrandId);

  if (!parentBrand || parentBrand.type !== 'parent') {
    return {
      ok: false,
      error: 'Invalid parent brand or not a parent organization'
    };
  }

  const report = {
    parentOrg: {
      id: parentBrandId,
      name: parentBrand.name
    },
    sponsor: {
      id: sponsorId,
      name: null  // Will be populated from data
    },
    portfolioSummary: {
      totalImpressions: 0,
      totalClicks: 0,
      totalEvents: 0,
      portfolioCTR: 0,
      dateRange: options.dateRange || { start: null, end: null }
    },
    byBrand: {},
    topPerformingEvents: [],
    generatedAt: new Date().toISOString()
  };

  // Get sponsor data from parent brand
  const parentData = getSponsorDataForBrand_(parentBrandId, sponsorId, options);
  if (parentData) {
    report.portfolioSummary.totalImpressions += parentData.impressions || 0;
    report.portfolioSummary.totalClicks += parentData.clicks || 0;
    report.portfolioSummary.totalEvents += parentData.events || 0;
    report.byBrand[parentBrandId] = {
      name: parentBrand.name,
      ...parentData
    };

    // Set sponsor name if found
    if (parentData.sponsorName) {
      report.sponsor.name = parentData.sponsorName;
    }
  }

  // Get sponsor data from child brands
  const childBrandIds = parentBrand.childBrands || [];
  childBrandIds.forEach(childId => {
    const childBrand = findBrand_(childId);
    if (!childBrand) return;

    // Skip child brands not included in portfolio reports
    if (childBrand.includeInPortfolioReports === false) return;

    const childData = getSponsorDataForBrand_(childId, sponsorId, options);
    if (childData) {
      report.portfolioSummary.totalImpressions += childData.impressions || 0;
      report.portfolioSummary.totalClicks += childData.clicks || 0;
      report.portfolioSummary.totalEvents += childData.events || 0;
      report.byBrand[childId] = {
        name: childBrand.name,
        ...childData
      };

      // Set sponsor name if not yet set
      if (!report.sponsor.name && childData.sponsorName) {
        report.sponsor.name = childData.sponsorName;
      }
    }
  });

  // Calculate portfolio CTR
  if (report.portfolioSummary.totalImpressions > 0) {
    report.portfolioSummary.portfolioCTR = (
      (report.portfolioSummary.totalClicks / report.portfolioSummary.totalImpressions) * 100
    ).toFixed(2);
  }

  // Aggregate top performing events across all brands
  report.topPerformingEvents = getTopPerformingEventsAcrossPortfolio_(
    parentBrandId,
    sponsorId,
    childBrandIds,
    5  // Top 5 events
  );

  return {
    ok: true,
    value: report
  };
}

/**
 * Get sponsor data for a specific brand
 *
 * @param {string} brandId - Brand ID
 * @param {string} sponsorId - Sponsor ID
 * @param {object} options - Optional filters
 * @returns {object|null} - Sponsor data or null
 */
function getSponsorDataForBrand_(brandId, sponsorId, options = {}) {
  try {
    // Get all events for this brand
    const brand= findBrand_(brandId);
    if (!brand) return null;

    const db = getDb_(brand);
    const events = db.list('events') || [];

    // Get sponsors to find sponsor name
    const sponsors = db.list('sponsors') || [];
    const sponsor = sponsors.find(s => s.id === sponsorId);
    const sponsorName = sponsor ? sponsor.name : null;

    // Filter events that have this sponsor
    const sponsoredEvents = events.filter(event => {
      const eventSponsorIds = (event.sponsorIds || '').split(',').map(id => id.trim());
      return eventSponsorIds.includes(sponsorId);
    });

    if (sponsoredEvents.length === 0) {
      return {
        sponsorName: sponsorName,
        impressions: 0,
        clicks: 0,
        events: 0,
        ctr: 0,
        eventsList: []
      };
    }

    // Aggregate metrics
    let totalImpressions = 0;
    let totalClicks = 0;
    const eventsList = [];

    sponsoredEvents.forEach(event => {
      // Get analytics for this event (if available)
      const eventImpressions = event.analytics?.impressions || 0;
      const eventClicks = event.analytics?.clicks || 0;

      totalImpressions += eventImpressions;
      totalClicks += eventClicks;

      eventsList.push({
        id: event.id,
        name: event.name,
        date: event.dateISO,
        impressions: eventImpressions,
        clicks: eventClicks,
        ctr: eventImpressions > 0 ? ((eventClicks / eventImpressions) * 100).toFixed(2) : 0
      });
    });

    const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : 0;

    return {
      sponsorName: sponsorName,
      impressions: totalImpressions,
      clicks: totalClicks,
      events: sponsoredEvents.length,
      ctr: ctr,
      eventsList: eventsList
    };

  } catch (error) {
    console.error(`Error getting sponsor data for brand ${brandId}:`, error);
    return null;
  }
}

/**
 * Get top performing events across brand portfolio
 *
 * @param {string} parentBrandId - Parent brand ID
 * @param {string} sponsorId - Sponsor ID
 * @param {array} childBrandIds - Child brand IDs
 * @param {number} limit - Number of top events to return
 * @returns {array} - Top performing events
 */
function getTopPerformingEventsAcrossPortfolio_(parentBrandId, sponsorId, childBrandIds, limit = 5) {
  const allEvents = [];

  // Collect events from parent
  const parentData = getSponsorDataForBrand_(parentBrandId, sponsorId);
  if (parentData && parentData.eventsList) {
    parentData.eventsList.forEach(event => {
      allEvents.push({
        ...event,
        brandId: parentBrandId,
        brandName: findBrand_(parentBrandId)?.name || parentBrandId
      });
    });
  }

  // Collect events from children
  childBrandIds.forEach(childId => {
    const childBrand = findBrand_(childId);
    // Skip child brands not included in portfolio reports
    if (!childBrand || childBrand.includeInPortfolioReports === false) return;

    const childData = getSponsorDataForBrand_(childId, sponsorId);
    if (childData && childData.eventsList) {
      childData.eventsList.forEach(event => {
        allEvents.push({
          ...event,
          brandId: childId,
          brandName: childBrand.name || childId
        });
      });
    }
  });

  // Sort by impressions (descending) and return top N
  return allEvents
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

/**
 * Get brand portfolio summary for parent organization
 * Shows overall portfolio health and activity
 *
 * @param {string} parentBrandId - Parent brand ID
 * @returns {object} - Portfolio summary
 */
function getPortfolioSummary_(parentBrandId) {
  const parentBrand = findBrand_(parentBrandId);

  if (!parentBrand || parentBrand.type !== 'parent') {
    return {
      ok: false,
      error: 'Invalid parent brand or not a parent organization'
    };
  }

  const summary = {
    portfolio: {
      parent: {
        id: parentBrandId,
        name: parentBrand.name
      },
      children: []
    },
    metrics: {
      totalEvents: 0,
      totalSponsors: 0,
      totalImpressions: 0,
      activeSponsors: new Set()
    },
    byBrand: {}
  };

  // Get parent metrics
  const parentDb = getDb_(parentBrand);
  const parentEvents = parentDb.list('events') || [];
  const parentSponsors = parentDb.list('sponsors') || [];

  summary.metrics.totalEvents += parentEvents.length;
  summary.metrics.totalSponsors += parentSponsors.length;

  // Track active sponsors (sponsors with events)
  parentEvents.forEach(event => {
    const sponsorIds = (event.sponsorIds || '').split(',').map(id => id.trim()).filter(id => id);
    sponsorIds.forEach(sid => summary.metrics.activeSponsors.add(sid));

    const eventImpressions = event.analytics?.impressions || 0;
    summary.metrics.totalImpressions += eventImpressions;
  });

  summary.byBrand[parentBrandId] = {
    name: parentBrand.name,
    events: parentEvents.length,
    sponsors: parentSponsors.length
  };

  // Get child metrics
  const childBrandIds = parentBrand.childBrands || [];
  childBrandIds.forEach(childId => {
    const childBrand = findBrand_(childId);
    if (!childBrand) return;

    // Skip child brands not included in portfolio reports
    if (childBrand.includeInPortfolioReports === false) return;

    summary.portfolio.children.push({
      id: childId,
      name: childBrand.name
    });

    const childDb = getDb_(childBrand);
    const childEvents = childDb.list('events') || [];
    const childSponsors = childDb.list('sponsors') || [];

    summary.metrics.totalEvents += childEvents.length;
    summary.metrics.totalSponsors += childSponsors.length;

    // Track active sponsors
    childEvents.forEach(event => {
      const sponsorIds = (event.sponsorIds || '').split(',').map(id => id.trim()).filter(id => id);
      sponsorIds.forEach(sid => summary.metrics.activeSponsors.add(sid));

      const eventImpressions = event.analytics?.impressions || 0;
      summary.metrics.totalImpressions += eventImpressions;
    });

    summary.byBrand[childId] = {
      name: childBrand.name,
      events: childEvents.length,
      sponsors: childSponsors.length
    };
  });

  // Convert Set to count
  summary.metrics.activeSponsors = summary.metrics.activeSponsors.size;

  return {
    ok: true,
    value: summary
  };
}

/**
 * Get list of all sponsors across brand portfolio
 * Useful for parent organizations to see all sponsors
 *
 * @param {string} parentBrandId - Parent brand ID
 * @returns {object} - List of sponsors with brand breakdown
 */
function getPortfolioSponsors_(parentBrandId) {
  const parentBrand = findBrand_(parentBrandId);

  if (!parentBrand || parentBrand.type !== 'parent') {
    return {
      ok: false,
      error: 'Invalid parent brand or not a parent organization'
    };
  }

  const sponsorsMap = new Map();

  // Helper to add sponsor to map
  const addSponsor = (sponsor, brandId, brandName) => {
    const key = sponsor.id;
    if (!sponsorsMap.has(key)) {
      sponsorsMap.set(key, {
        id: sponsor.id,
        name: sponsor.name,
        logoUrl: sponsor.logoUrl,
        website: sponsor.website,
        tier: sponsor.tier,
        brands: []
      });
    }
    sponsorsMap.get(key).brands.push({
      brandId: brandId,
      brandName: brandName
    });
  };

  // Get sponsors from parent
  const parentDb = getDb_(parentBrand);
  const parentSponsors = parentDb.list('sponsors') || [];
  parentSponsors.forEach(sponsor => {
    addSponsor(sponsor, parentBrandId, parentBrand.name);
  });

  // Get sponsors from children
  const childBrandIds = parentBrand.childBrands || [];
  childBrandIds.forEach(childId => {
    const childBrand = findBrand_(childId);
    if (!childBrand) return;

    // Skip child brands not included in portfolio reports
    if (childBrand.includeInPortfolioReports === false) return;

    const childDb = getDb_(childBrand);
    const childSponsors = childDb.list('sponsors') || [];
    childSponsors.forEach(sponsor => {
      addSponsor(sponsor, childId, childBrand.name);
    });
  });

  return {
    ok: true,
    value: {
      sponsors: Array.from(sponsorsMap.values()),
      totalCount: sponsorsMap.size
    }
  };
}

// =============================================================================
// [S20] CONSOLE HELPERS - Event Lifecycle Core
// =============================================================================
// Console-friendly functions for Apps Script editor testing.
// These wrap the API functions with sensible defaults.
//
// Usage from Apps Script console:
//   createEvent({ name: 'Test Event', date: '2025-12-20', venue: 'My Bar' })
//   getEventsSafe()
// =============================================================================

/**
 * Create an event from the Apps Script console.
 * Simplified wrapper around api_create for quick testing.
 *
 * @param {Object} opts - Event options
 * @param {string} opts.name - Event name (required)
 * @param {string} opts.date - Event date YYYY-MM-DD (required)
 * @param {string} opts.venue - Event venue (required)
 * @param {string} [opts.brandId] - Brand ID (default: 'abc')
 * @param {string} [opts.templateId] - Template ID (default: 'custom')
 * @param {string} [opts.adminKey] - Admin key (auto-resolved if not provided)
 * @returns {Object} Created event or error
 *
 * @example
 * // From Apps Script console:
 * createEvent({ name: 'Friday Night Bocce', date: '2025-12-20', venue: 'Sports Bar' })
 */
function createEvent(opts = {}) {
  const brandId = opts.brandId || 'abc';
  const brand = findBrand_(brandId);

  if (!brand) {
    return { ok: false, error: 'Unknown brand: ' + brandId };
  }

  // Auto-resolve admin key from Script Properties
  let adminKey = opts.adminKey;
  if (!adminKey) {
    const props = PropertiesService.getScriptProperties();
    adminKey = props.getProperty('ADMIN_SECRET_' + brandId.toUpperCase()) ||
               props.getProperty('ADMIN_SECRET_ABC') ||
               props.getProperty('ADMIN_SECRET');
  }

  if (!adminKey) {
    return { ok: false, error: 'No admin key found. Set ADMIN_SECRET_' + brandId.toUpperCase() + ' in Script Properties.' };
  }

  // Validate required fields
  if (!opts.name) return { ok: false, error: 'Missing required field: name' };
  if (!opts.date) return { ok: false, error: 'Missing required field: date' };
  if (!opts.venue) return { ok: false, error: 'Missing required field: venue' };

  // Normalize date format
  const dateISO = String(opts.date).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    return { ok: false, error: 'Invalid date format. Use YYYY-MM-DD.' };
  }

  const result = api_create({
    brandId: brandId,
    adminKey: adminKey,
    templateId: opts.templateId || 'custom',
    scope: 'events',
    data: {
      name: opts.name,
      startDateISO: dateISO,
      venue: opts.venue
    }
  });

  if (result.ok) {
    Logger.log('✅ Event created: ' + result.value.name);
    Logger.log('   ID: ' + result.value.id);
    Logger.log('   Public URL: ' + result.value.links.publicUrl);
    Logger.log('   Display URL: ' + result.value.links.displayUrl);
  } else {
    Logger.log('❌ Failed: ' + (result.message || result.error));
  }

  return result;
}

/**
 * Alias for createEvent - creates an eventbook (same as event).
 * @param {Object} opts - Same as createEvent
 * @returns {Object} Created event or error
 */
function createEventbook(opts) {
  return createEvent(opts);
}

/**
 * Get all events with a clean, predictable return shape.
 * Safe for console use - always returns array, never throws.
 *
 * @param {Object} [opts] - Options
 * @param {string} [opts.brandId] - Brand ID (default: 'abc')
 * @returns {Array<Object>} Array of events with clean shape:
 *   - id: Event ID
 *   - name: Event name
 *   - startDateISO: Event date (YYYY-MM-DD)
 *   - eventSpreadsheetUrl: URL to event data spreadsheet
 *   - publicUrl: Public-facing event page URL
 *   - displayUrl: TV display URL
 *
 * @example
 * // From Apps Script console:
 * getEventsSafe()
 * getEventsSafe({ brandId: 'cbc' })
 */
function getEventsSafe(opts = {}) {
  const brandId = opts.brandId || 'abc';

  try {
    const result = api_list({ brandId: brandId, scope: 'events' });

    if (!result.ok) {
      Logger.log('⚠️ getEventsSafe failed: ' + (result.message || result.error));
      return [];
    }

    const items = result.value?.items || [];
    const brand = findBrand_(brandId);
    const spreadsheetUrl = brand?.store?.spreadsheetId
      ? 'https://docs.google.com/spreadsheets/d/' + brand.store.spreadsheetId
      : '';

    // Map to clean shape
    const events = items.map(event => ({
      id: event.id,
      name: event.name || '',
      startDateISO: event.startDateISO || '',
      eventSpreadsheetUrl: spreadsheetUrl,
      publicUrl: event.links?.publicUrl || '',
      displayUrl: event.links?.displayUrl || ''
    }));

    Logger.log('📋 Found ' + events.length + ' events for brand: ' + brandId);
    events.forEach((e, i) => {
      Logger.log('  ' + (i + 1) + '. ' + e.name + ' (' + e.startDateISO + ')');
    });

    return events;
  } catch (err) {
    Logger.log('❌ getEventsSafe error: ' + err.message);
    return [];
  }
}

/**
 * API endpoint: Get events with safe, clean return shape.
 * Designed for Admin dropdown population.
 *
 * @param {Object} payload - Request payload
 * @param {string} payload.brandId - Brand ID (required)
 * @returns {Object} { ok, value: { items: [...] } }
 * @tier mvp
 */
function api_getEventsSafe(payload) {
  return runSafe('api_getEventsSafe', () => {
    const { brandId } = payload || {};

    if (!brandId) {
      return Err(ERR.BAD_INPUT, 'Missing brandId');
    }

    const events = getEventsSafe({ brandId });

    return Ok({ items: events });
  });
}
