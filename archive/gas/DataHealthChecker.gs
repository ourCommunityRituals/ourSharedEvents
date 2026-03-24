/**
 * DataHealthChecker.gs - Nightly Data Sanity Checker for EVENTS & DIAG
 *
 * Provides early-warning detection of data corruption, missing fields,
 * and impossible states before they cause live event issues.
 *
 * Main functions:
 * - checkDataHealth_(): Run full data health check
 * - installDataHealthTrigger_(): Set up nightly automatic checking
 * - getDataHealthSummary_(): Get quick health status
 *
 * See docs/RUNBOOK.md for operational procedures.
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const DATA_HEALTH_CONFIG = {
  // Sheet names
  ISSUES_SHEET: 'DATA_ISSUES',
  EVENTS_SHEET: 'EVENTS',
  DIAG_SHEET: 'DIAG',
  ANALYTICS_SHEET: 'ANALYTICS',

  // Limits
  MAX_ISSUES_TO_LOG: 500,        // Prevent runaway logging
  MAX_ROWS_TO_CHECK: 50000,      // Safety limit for large datasets

  // Severity levels
  SEVERITY: {
    ERROR: 'error',    // Data corruption, missing required fields
    WARNING: 'warn',   // Anomalies that should be investigated
    INFO: 'info'       // Informational notes
  },

  // Issue categories
  CATEGORIES: {
    EVENTS_MISSING_FIELD: 'EVENTS_MISSING_FIELD',
    EVENTS_INVALID_DATA: 'EVENTS_INVALID_DATA',
    EVENTS_CONTRACT_VIOLATION: 'EVENTS_CONTRACT_VIOLATION',
    DIAG_MISSING_FIELD: 'DIAG_MISSING_FIELD',
    DIAG_INVALID_DATA: 'DIAG_INVALID_DATA',
    DIAG_ORPHAN_EVENT: 'DIAG_ORPHAN_EVENT',
    ANALYTICS_ORPHAN_EVENT: 'ANALYTICS_ORPHAN_EVENT',
    CROSS_REFERENCE_ERROR: 'CROSS_REFERENCE_ERROR'
  }
};

// =============================================================================
// EVENTS REQUIRED FIELDS
// =============================================================================

const EVENTS_REQUIRED_FIELDS = {
  // Sheet-level required fields (columns in EVENTS sheet)
  sheetColumns: ['id', 'brandId', 'templateId', 'dataJSON', 'createdAt', 'slug'],

  // dataJSON required fields (MVP contract from EVENT_CONTRACT.md)
  dataJSONRequired: {
    identity: ['id', 'slug', 'name', 'startDateISO', 'venue'],
    links: ['publicUrl', 'displayUrl', 'posterUrl'],  // signupUrl can be null
    qr: ['public', 'signup'],
    ctas: {
      primary: ['label']  // url can be null/empty
    },
    settings: ['showSchedule', 'showStandings', 'showBracket'],
    metadata: ['createdAtISO', 'updatedAtISO']
  }
};

// =============================================================================
// DIAG REQUIRED FIELDS
// =============================================================================

const DIAG_REQUIRED_FIELDS = {
  sheetColumns: ['ts', 'level', 'where', 'msg'],  // meta is optional
  validLevels: ['info', 'warn', 'error', 'debug']
};

// =============================================================================
// MAIN HEALTH CHECK FUNCTION
// =============================================================================

/**
 * Main entry point for data health checking.
 * Validates EVENTS and DIAG sheets, checks for impossible states,
 * and logs issues to DATA_ISSUES sheet.
 *
 * @param {Object} options - Configuration options
 * @param {string} [options.spreadsheetId] - Spreadsheet ID (uses root brand if not provided)
 * @param {string} [options.brandId] - Brand ID for filtering (checks all if not provided)
 * @param {boolean} [options.sendEmail] - Send email summary if issues found (default: false)
 * @param {string} [options.emailRecipient] - Email recipient (uses script owner if not provided)
 * @param {boolean} [options.clearPreviousIssues] - Clear previous issues before check (default: true)
 * @returns {Object} Health check summary
 */
function checkDataHealth_(options) {
  const startTime = Date.now();
  options = options || {};

  const summary = {
    timestamp: new Date().toISOString(),
    spreadsheetId: null,
    brandId: options.brandId || 'all',
    eventsChecked: 0,
    diagRowsChecked: 0,
    issues: {
      errors: 0,
      warnings: 0,
      info: 0,
      total: 0
    },
    categories: {},
    healthy: true,
    durationMs: 0,
    errors: []
  };

  try {
    // Get spreadsheet
    const ss = _getSpreadsheetForHealthCheck_(options.spreadsheetId);
    if (!ss) {
      summary.errors.push('Could not access spreadsheet');
      summary.healthy = false;
      return summary;
    }
    summary.spreadsheetId = ss.getId();

    // Ensure DATA_ISSUES sheet exists
    const issuesSheet = _ensureDataIssuesSheet_(ss);
    if (!issuesSheet) {
      summary.errors.push('Could not create DATA_ISSUES sheet');
      summary.healthy = false;
      return summary;
    }

    // Clear previous issues if requested
    if (options.clearPreviousIssues !== false) {
      _clearPreviousIssues_(issuesSheet);
    }

    // Collect all issues
    const allIssues = [];

    // Check EVENTS sheet
    const eventsResult = _checkEventsHealth_(ss, options.brandId);
    summary.eventsChecked = eventsResult.rowsChecked;
    allIssues.push(...eventsResult.issues);

    // Check DIAG sheet
    const diagResult = _checkDiagHealth_(ss);
    summary.diagRowsChecked = diagResult.rowsChecked;
    allIssues.push(...diagResult.issues);

    // Check for impossible states (cross-reference validation)
    const crossRefResult = _checkCrossReferences_(ss, eventsResult.eventIds);
    allIssues.push(...crossRefResult.issues);

    // Tally issues
    allIssues.forEach(function(issue) {
      summary.issues.total++;
      if (issue.severity === DATA_HEALTH_CONFIG.SEVERITY.ERROR) {
        summary.issues.errors++;
      } else if (issue.severity === DATA_HEALTH_CONFIG.SEVERITY.WARNING) {
        summary.issues.warnings++;
      } else {
        summary.issues.info++;
      }

      summary.categories[issue.category] = (summary.categories[issue.category] || 0) + 1;
    });

    // Write issues to sheet
    if (allIssues.length > 0) {
      _writeIssuesToSheet_(issuesSheet, allIssues.slice(0, DATA_HEALTH_CONFIG.MAX_ISSUES_TO_LOG));
      summary.healthy = summary.issues.errors === 0;
    }

    // Send email if requested and issues found
    if (options.sendEmail && allIssues.length > 0) {
      _sendHealthCheckEmail_(summary, options.emailRecipient);
    }

    // Log completion to DIAG
    _logHealthCheckCompletion_(ss, summary);

  } catch (e) {
    summary.errors.push('Fatal error: ' + e.toString());
    summary.healthy = false;
    console.error('checkDataHealth_ failed:', e);
  }

  summary.durationMs = Date.now() - startTime;
  return summary;
}

// =============================================================================
// EVENTS VALIDATION
// =============================================================================

/**
 * Validates all rows in the EVENTS sheet.
 *
 * @param {Spreadsheet} ss - The spreadsheet
 * @param {string} [brandId] - Optional brand ID to filter
 * @returns {Object} { rowsChecked, issues, eventIds }
 */
function _checkEventsHealth_(ss, brandId) {
  const result = { rowsChecked: 0, issues: [], eventIds: new Set() };

  try {
    const sheet = ss.getSheetByName(DATA_HEALTH_CONFIG.EVENTS_SHEET);
    if (!sheet) {
      result.issues.push({
        severity: DATA_HEALTH_CONFIG.SEVERITY.WARNING,
        category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_MISSING_FIELD,
        rowNumber: 0,
        field: 'EVENTS sheet',
        message: 'EVENTS sheet does not exist',
        value: null
      });
      return result;
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      // Only header, no data - this is fine
      return result;
    }

    // Get header to map column indices
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colIndex = {};
    header.forEach(function(col, idx) {
      colIndex[String(col).toLowerCase()] = idx;
    });

    // Validate header has required columns
    EVENTS_REQUIRED_FIELDS.sheetColumns.forEach(function(col) {
      if (colIndex[col.toLowerCase()] === undefined) {
        result.issues.push({
          severity: DATA_HEALTH_CONFIG.SEVERITY.ERROR,
          category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_MISSING_FIELD,
          rowNumber: 1,
          field: col,
          message: 'Required column "' + col + '" missing from EVENTS header',
          value: null
        });
      }
    });

    // Get all data rows (limit for safety)
    const rowsToCheck = Math.min(lastRow - 1, DATA_HEALTH_CONFIG.MAX_ROWS_TO_CHECK);
    const data = sheet.getRange(2, 1, rowsToCheck, sheet.getLastColumn()).getValues();

    data.forEach(function(row, rowIdx) {
      const rowNumber = rowIdx + 2; // Adjust for 0-index and header
      result.rowsChecked++;

      // Filter by brand if specified
      const rowBrandId = row[colIndex['brandid']] || row[colIndex['brandId']];
      if (brandId && rowBrandId !== brandId) {
        return; // Skip this row
      }

      // Get field values
      const id = row[colIndex['id']];
      const slug = row[colIndex['slug']];
      const dataJSONRaw = row[colIndex['datajson']] || row[colIndex['dataJSON']];
      const createdAt = row[colIndex['createdat']] || row[colIndex['createdAt']];

      // Track event ID for cross-reference checks
      if (id) {
        result.eventIds.add(String(id));
      }

      // Validate required sheet columns
      if (!id) {
        result.issues.push({
          severity: DATA_HEALTH_CONFIG.SEVERITY.ERROR,
          category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_MISSING_FIELD,
          rowNumber: rowNumber,
          field: 'id',
          message: 'Missing required field: id',
          value: null
        });
      }

      if (!slug) {
        result.issues.push({
          severity: DATA_HEALTH_CONFIG.SEVERITY.ERROR,
          category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_MISSING_FIELD,
          rowNumber: rowNumber,
          field: 'slug',
          message: 'Missing required field: slug',
          value: null
        });
      }

      if (!dataJSONRaw) {
        result.issues.push({
          severity: DATA_HEALTH_CONFIG.SEVERITY.ERROR,
          category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_MISSING_FIELD,
          rowNumber: rowNumber,
          field: 'dataJSON',
          message: 'Missing required field: dataJSON',
          value: null
        });
        return; // Can't validate further without dataJSON
      }

      // Parse and validate dataJSON
      var eventData;
      try {
        eventData = typeof dataJSONRaw === 'string' ? JSON.parse(dataJSONRaw) : dataJSONRaw;
      } catch (parseErr) {
        result.issues.push({
          severity: DATA_HEALTH_CONFIG.SEVERITY.ERROR,
          category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_INVALID_DATA,
          rowNumber: rowNumber,
          field: 'dataJSON',
          message: 'Invalid JSON in dataJSON: ' + parseErr.message,
          value: String(dataJSONRaw).substring(0, 100)
        });
        return;
      }

      // Validate dataJSON required fields
      _validateEventDataJSON_(eventData, rowNumber, result.issues);
    });

  } catch (e) {
    result.issues.push({
      severity: DATA_HEALTH_CONFIG.SEVERITY.ERROR,
      category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_INVALID_DATA,
      rowNumber: 0,
      field: 'EVENTS',
      message: 'Error reading EVENTS sheet: ' + e.toString(),
      value: null
    });
    console.error('_checkEventsHealth_ failed:', e);
  }

  return result;
}

/**
 * Validates the dataJSON content against the event contract.
 *
 * @param {Object} eventData - Parsed event data
 * @param {number} rowNumber - Row number for error reporting
 * @param {Array} issues - Issues array to append to
 */
function _validateEventDataJSON_(eventData, rowNumber, issues) {
  const req = EVENTS_REQUIRED_FIELDS.dataJSONRequired;

  // Identity fields
  req.identity.forEach(function(field) {
    if (!eventData[field]) {
      issues.push({
        severity: DATA_HEALTH_CONFIG.SEVERITY.ERROR,
        category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_CONTRACT_VIOLATION,
        rowNumber: rowNumber,
        field: field,
        message: 'Missing required dataJSON field: ' + field,
        value: null
      });
    }
  });

  // Validate name length
  if (eventData.name && eventData.name.length > 200) {
    issues.push({
      severity: DATA_HEALTH_CONFIG.SEVERITY.WARNING,
      category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_CONTRACT_VIOLATION,
      rowNumber: rowNumber,
      field: 'name',
      message: 'Event name exceeds 200 characters',
      value: eventData.name.length + ' chars'
    });
  }

  // Validate startDateISO format
  if (eventData.startDateISO && !/^\d{4}-\d{2}-\d{2}$/.test(eventData.startDateISO)) {
    issues.push({
      severity: DATA_HEALTH_CONFIG.SEVERITY.ERROR,
      category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_CONTRACT_VIOLATION,
      rowNumber: rowNumber,
      field: 'startDateISO',
      message: 'Invalid startDateISO format (expected YYYY-MM-DD)',
      value: eventData.startDateISO
    });
  }

  // Links validation
  if (eventData.links) {
    req.links.forEach(function(field) {
      if (!eventData.links[field]) {
        issues.push({
          severity: DATA_HEALTH_CONFIG.SEVERITY.ERROR,
          category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_CONTRACT_VIOLATION,
          rowNumber: rowNumber,
          field: 'links.' + field,
          message: 'Missing required links field: ' + field,
          value: null
        });
      }
    });
  } else {
    issues.push({
      severity: DATA_HEALTH_CONFIG.SEVERITY.ERROR,
      category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_CONTRACT_VIOLATION,
      rowNumber: rowNumber,
      field: 'links',
      message: 'Missing required object: links',
      value: null
    });
  }

  // QR validation
  if (eventData.qr) {
    req.qr.forEach(function(field) {
      if (!eventData.qr[field]) {
        issues.push({
          severity: DATA_HEALTH_CONFIG.SEVERITY.WARNING,
          category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_CONTRACT_VIOLATION,
          rowNumber: rowNumber,
          field: 'qr.' + field,
          message: 'Missing QR field: ' + field,
          value: null
        });
      }
    });
  }

  // CTAs validation
  if (eventData.ctas && eventData.ctas.primary) {
    req.ctas.primary.forEach(function(field) {
      if (!eventData.ctas.primary[field]) {
        issues.push({
          severity: DATA_HEALTH_CONFIG.SEVERITY.ERROR,
          category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_CONTRACT_VIOLATION,
          rowNumber: rowNumber,
          field: 'ctas.primary.' + field,
          message: 'Missing required CTA field: ' + field,
          value: null
        });
      }
    });
  } else {
    issues.push({
      severity: DATA_HEALTH_CONFIG.SEVERITY.ERROR,
      category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_CONTRACT_VIOLATION,
      rowNumber: rowNumber,
      field: 'ctas.primary',
      message: 'Missing required object: ctas.primary',
      value: null
    });
  }

  // Settings validation
  if (eventData.settings) {
    req.settings.forEach(function(field) {
      if (typeof eventData.settings[field] !== 'boolean') {
        issues.push({
          severity: DATA_HEALTH_CONFIG.SEVERITY.WARNING,
          category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_CONTRACT_VIOLATION,
          rowNumber: rowNumber,
          field: 'settings.' + field,
          message: 'Missing or non-boolean settings field: ' + field,
          value: typeof eventData.settings[field]
        });
      }
    });
  } else {
    issues.push({
      severity: DATA_HEALTH_CONFIG.SEVERITY.WARNING,
      category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_CONTRACT_VIOLATION,
      rowNumber: rowNumber,
      field: 'settings',
      message: 'Missing settings object',
      value: null
    });
  }

  // Metadata validation
  req.metadata.forEach(function(field) {
    if (!eventData[field]) {
      issues.push({
        severity: DATA_HEALTH_CONFIG.SEVERITY.WARNING,
        category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_CONTRACT_VIOLATION,
        rowNumber: rowNumber,
        field: field,
        message: 'Missing metadata field: ' + field,
        value: null
      });
    }
  });

  // Sponsor validation (if present)
  if (Array.isArray(eventData.sponsors) && eventData.sponsors.length > 0) {
    eventData.sponsors.forEach(function(sponsor, idx) {
      if (!sponsor.id) {
        issues.push({
          severity: DATA_HEALTH_CONFIG.SEVERITY.WARNING,
          category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_CONTRACT_VIOLATION,
          rowNumber: rowNumber,
          field: 'sponsors[' + idx + '].id',
          message: 'Sponsor missing id',
          value: null
        });
      }
      if (!sponsor.name) {
        issues.push({
          severity: DATA_HEALTH_CONFIG.SEVERITY.WARNING,
          category: DATA_HEALTH_CONFIG.CATEGORIES.EVENTS_CONTRACT_VIOLATION,
          rowNumber: rowNumber,
          field: 'sponsors[' + idx + '].name',
          message: 'Sponsor missing name',
          value: null
        });
      }
    });
  }
}

// =============================================================================
// DIAG VALIDATION
// =============================================================================

/**
 * Validates all rows in the DIAG sheet.
 *
 * @param {Spreadsheet} ss - The spreadsheet
 * @returns {Object} { rowsChecked, issues }
 */
function _checkDiagHealth_(ss) {
  const result = { rowsChecked: 0, issues: [] };

  try {
    const sheet = ss.getSheetByName(DATA_HEALTH_CONFIG.DIAG_SHEET);
    if (!sheet) {
      // DIAG sheet not existing is informational only
      result.issues.push({
        severity: DATA_HEALTH_CONFIG.SEVERITY.INFO,
        category: DATA_HEALTH_CONFIG.CATEGORIES.DIAG_MISSING_FIELD,
        rowNumber: 0,
        field: 'DIAG sheet',
        message: 'DIAG sheet does not exist (may be new deployment)',
        value: null
      });
      return result;
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return result; // Only header, no data
    }

    // Get header to map column indices
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colIndex = {};
    header.forEach(function(col, idx) {
      colIndex[String(col).toLowerCase()] = idx;
    });

    // Validate header has required columns
    DIAG_REQUIRED_FIELDS.sheetColumns.forEach(function(col) {
      if (colIndex[col.toLowerCase()] === undefined) {
        result.issues.push({
          severity: DATA_HEALTH_CONFIG.SEVERITY.ERROR,
          category: DATA_HEALTH_CONFIG.CATEGORIES.DIAG_MISSING_FIELD,
          rowNumber: 1,
          field: col,
          message: 'Required column "' + col + '" missing from DIAG header',
          value: null
        });
      }
    });

    // Sample check - only check first 1000 and last 1000 rows for performance
    const totalRows = lastRow - 1;
    const sampleSize = 1000;

    if (totalRows <= sampleSize * 2) {
      // Check all rows
      _validateDiagRows_(sheet, 2, totalRows, colIndex, result);
    } else {
      // Check first and last sample
      _validateDiagRows_(sheet, 2, sampleSize, colIndex, result);
      _validateDiagRows_(sheet, lastRow - sampleSize + 1, sampleSize, colIndex, result);
    }

    result.rowsChecked = Math.min(totalRows, sampleSize * 2);

  } catch (e) {
    result.issues.push({
      severity: DATA_HEALTH_CONFIG.SEVERITY.ERROR,
      category: DATA_HEALTH_CONFIG.CATEGORIES.DIAG_INVALID_DATA,
      rowNumber: 0,
      field: 'DIAG',
      message: 'Error reading DIAG sheet: ' + e.toString(),
      value: null
    });
    console.error('_checkDiagHealth_ failed:', e);
  }

  return result;
}

/**
 * Validates a range of DIAG rows.
 */
function _validateDiagRows_(sheet, startRow, numRows, colIndex, result) {
  const data = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();

  data.forEach(function(row, rowIdx) {
    const rowNumber = startRow + rowIdx;

    const ts = row[colIndex['ts']];
    const level = row[colIndex['level']];
    const where = row[colIndex['where']];
    const msg = row[colIndex['msg']];

    // Validate timestamp
    if (!ts) {
      result.issues.push({
        severity: DATA_HEALTH_CONFIG.SEVERITY.ERROR,
        category: DATA_HEALTH_CONFIG.CATEGORIES.DIAG_MISSING_FIELD,
        rowNumber: rowNumber,
        field: 'ts',
        message: 'Missing timestamp',
        value: null
      });
    } else {
      // Validate timestamp format (ISO 8601)
      const tsStr = String(ts);
      if (!/^\d{4}-\d{2}-\d{2}T/.test(tsStr) && !(ts instanceof Date)) {
        result.issues.push({
          severity: DATA_HEALTH_CONFIG.SEVERITY.WARNING,
          category: DATA_HEALTH_CONFIG.CATEGORIES.DIAG_INVALID_DATA,
          rowNumber: rowNumber,
          field: 'ts',
          message: 'Invalid timestamp format',
          value: tsStr.substring(0, 30)
        });
      }
    }

    // Validate level
    if (!level) {
      result.issues.push({
        severity: DATA_HEALTH_CONFIG.SEVERITY.WARNING,
        category: DATA_HEALTH_CONFIG.CATEGORIES.DIAG_MISSING_FIELD,
        rowNumber: rowNumber,
        field: 'level',
        message: 'Missing log level',
        value: null
      });
    } else if (DIAG_REQUIRED_FIELDS.validLevels.indexOf(String(level).toLowerCase()) === -1) {
      result.issues.push({
        severity: DATA_HEALTH_CONFIG.SEVERITY.WARNING,
        category: DATA_HEALTH_CONFIG.CATEGORIES.DIAG_INVALID_DATA,
        rowNumber: rowNumber,
        field: 'level',
        message: 'Invalid log level (expected: info, warn, error, debug)',
        value: level
      });
    }

    // Validate where (function name)
    if (!where) {
      result.issues.push({
        severity: DATA_HEALTH_CONFIG.SEVERITY.WARNING,
        category: DATA_HEALTH_CONFIG.CATEGORIES.DIAG_MISSING_FIELD,
        rowNumber: rowNumber,
        field: 'where',
        message: 'Missing function location',
        value: null
      });
    }

    // Validate msg
    if (!msg) {
      result.issues.push({
        severity: DATA_HEALTH_CONFIG.SEVERITY.WARNING,
        category: DATA_HEALTH_CONFIG.CATEGORIES.DIAG_MISSING_FIELD,
        rowNumber: rowNumber,
        field: 'msg',
        message: 'Missing log message',
        value: null
      });
    }
  });
}

// =============================================================================
// CROSS-REFERENCE VALIDATION (IMPOSSIBLE STATES)
// =============================================================================

/**
 * Checks for impossible states where DIAG or ANALYTICS reference non-existent events.
 *
 * @param {Spreadsheet} ss - The spreadsheet
 * @param {Set} validEventIds - Set of valid event IDs from EVENTS sheet
 * @returns {Object} { issues }
 */
function _checkCrossReferences_(ss, validEventIds) {
  const result = { issues: [] };

  // Check DIAG for orphan event references
  _checkDiagEventReferences_(ss, validEventIds, result.issues);

  // Check ANALYTICS for orphan event references
  _checkAnalyticsEventReferences_(ss, validEventIds, result.issues);

  return result;
}

/**
 * Checks DIAG sheet for references to non-existent events.
 */
function _checkDiagEventReferences_(ss, validEventIds, issues) {
  try {
    const sheet = ss.getSheetByName(DATA_HEALTH_CONFIG.DIAG_SHEET);
    if (!sheet || sheet.getLastRow() <= 1) {
      return;
    }

    // Get header
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const metaColIdx = header.findIndex(function(col) {
      return String(col).toLowerCase() === 'meta';
    });

    if (metaColIdx === -1) {
      return; // No meta column
    }

    // Sample recent rows (last 500)
    const lastRow = sheet.getLastRow();
    const sampleStart = Math.max(2, lastRow - 499);
    const numRows = lastRow - sampleStart + 1;

    if (numRows <= 0) return;

    const data = sheet.getRange(sampleStart, metaColIdx + 1, numRows, 1).getValues();
    const orphanEventIds = new Set();

    data.forEach(function(row, rowIdx) {
      const meta = row[0];
      if (!meta) return;

      try {
        const metaObj = typeof meta === 'string' ? JSON.parse(meta) : meta;
        if (metaObj && metaObj.eventId && validEventIds.size > 0) {
          const eventId = String(metaObj.eventId);
          if (!validEventIds.has(eventId) && eventId !== 'unknown' && eventId !== 'null') {
            orphanEventIds.add(eventId);
          }
        }
      } catch (e) {
        // Ignore parse errors for meta
      }
    });

    // Report orphan event IDs (aggregate to avoid noise)
    if (orphanEventIds.size > 0) {
      const orphanArray = Array.from(orphanEventIds).slice(0, 10);
      issues.push({
        severity: DATA_HEALTH_CONFIG.SEVERITY.WARNING,
        category: DATA_HEALTH_CONFIG.CATEGORIES.DIAG_ORPHAN_EVENT,
        rowNumber: 0,
        field: 'meta.eventId',
        message: 'DIAG references ' + orphanEventIds.size + ' event ID(s) not in EVENTS sheet',
        value: orphanArray.join(', ') + (orphanEventIds.size > 10 ? '...' : '')
      });
    }

  } catch (e) {
    console.error('_checkDiagEventReferences_ failed:', e);
  }
}

/**
 * Checks ANALYTICS sheet for references to non-existent events.
 */
function _checkAnalyticsEventReferences_(ss, validEventIds, issues) {
  try {
    const sheet = ss.getSheetByName(DATA_HEALTH_CONFIG.ANALYTICS_SHEET);
    if (!sheet || sheet.getLastRow() <= 1) {
      return;
    }

    // Get header
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const eventIdColIdx = header.findIndex(function(col) {
      return String(col).toLowerCase() === 'eventid';
    });

    if (eventIdColIdx === -1) {
      return; // No eventId column
    }

    // Sample recent rows (last 500)
    const lastRow = sheet.getLastRow();
    const sampleStart = Math.max(2, lastRow - 499);
    const numRows = lastRow - sampleStart + 1;

    if (numRows <= 0) return;

    const data = sheet.getRange(sampleStart, eventIdColIdx + 1, numRows, 1).getValues();
    const orphanEventIds = new Set();

    data.forEach(function(row) {
      const eventId = row[0];
      if (eventId && validEventIds.size > 0) {
        const eventIdStr = String(eventId);
        if (!validEventIds.has(eventIdStr) && eventIdStr !== 'unknown' && eventIdStr !== 'null') {
          orphanEventIds.add(eventIdStr);
        }
      }
    });

    // Report orphan event IDs
    if (orphanEventIds.size > 0) {
      const orphanArray = Array.from(orphanEventIds).slice(0, 10);
      issues.push({
        severity: DATA_HEALTH_CONFIG.SEVERITY.WARNING,
        category: DATA_HEALTH_CONFIG.CATEGORIES.ANALYTICS_ORPHAN_EVENT,
        rowNumber: 0,
        field: 'eventId',
        message: 'ANALYTICS references ' + orphanEventIds.size + ' event ID(s) not in EVENTS sheet',
        value: orphanArray.join(', ') + (orphanEventIds.size > 10 ? '...' : '')
      });
    }

  } catch (e) {
    console.error('_checkAnalyticsEventReferences_ failed:', e);
  }
}

// =============================================================================
// DATA_ISSUES SHEET MANAGEMENT
// =============================================================================

/**
 * Ensures the DATA_ISSUES sheet exists with proper headers.
 *
 * @param {Spreadsheet} ss - The spreadsheet
 * @returns {Sheet|null} The DATA_ISSUES sheet
 */
function _ensureDataIssuesSheet_(ss) {
  try {
    var sheet = ss.getSheetByName(DATA_HEALTH_CONFIG.ISSUES_SHEET);

    if (!sheet) {
      sheet = ss.insertSheet(DATA_HEALTH_CONFIG.ISSUES_SHEET);
      sheet.appendRow([
        'timestamp',
        'severity',
        'category',
        'sheet',
        'rowNumber',
        'field',
        'message',
        'value'
      ]);
      sheet.setFrozenRows(1);

      // Set column widths
      sheet.setColumnWidth(1, 180);  // timestamp
      sheet.setColumnWidth(2, 80);   // severity
      sheet.setColumnWidth(3, 200);  // category
      sheet.setColumnWidth(4, 80);   // sheet
      sheet.setColumnWidth(5, 80);   // rowNumber
      sheet.setColumnWidth(6, 150);  // field
      sheet.setColumnWidth(7, 400);  // message
      sheet.setColumnWidth(8, 200);  // value

      // Conditional formatting for severity
      _applyIssueSeverityFormatting_(sheet);
    }

    return sheet;

  } catch (e) {
    console.error('_ensureDataIssuesSheet_ failed:', e);
    return null;
  }
}

/**
 * Applies conditional formatting for severity levels.
 */
function _applyIssueSeverityFormatting_(sheet) {
  try {
    const severityRange = sheet.getRange('B:B');

    // Error rows - red background
    const errorRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('error')
      .setBackground('#f4c7c3')
      .setRanges([severityRange])
      .build();

    // Warning rows - yellow background
    const warnRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('warn')
      .setBackground('#fce8b2')
      .setRanges([severityRange])
      .build();

    // Info rows - blue background
    const infoRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('info')
      .setBackground('#c9daf8')
      .setRanges([severityRange])
      .build();

    const rules = sheet.getConditionalFormatRules();
    rules.push(errorRule, warnRule, infoRule);
    sheet.setConditionalFormatRules(rules);

  } catch (e) {
    console.error('_applyIssueSeverityFormatting_ failed:', e);
  }
}

/**
 * Clears previous issues from the DATA_ISSUES sheet.
 */
function _clearPreviousIssues_(sheet) {
  try {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
  } catch (e) {
    console.error('_clearPreviousIssues_ failed:', e);
  }
}

/**
 * Writes issues to the DATA_ISSUES sheet.
 *
 * @param {Sheet} sheet - The DATA_ISSUES sheet
 * @param {Array} issues - Array of issue objects
 */
function _writeIssuesToSheet_(sheet, issues) {
  if (!issues || issues.length === 0) {
    return;
  }

  try {
    const timestamp = new Date().toISOString();
    const rows = issues.map(function(issue) {
      return [
        timestamp,
        issue.severity,
        issue.category,
        _getSheetFromCategory_(issue.category),
        issue.rowNumber || '',
        issue.field,
        issue.message,
        issue.value || ''
      ];
    });

    // Batch write
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, 8).setValues(rows);

  } catch (e) {
    console.error('_writeIssuesToSheet_ failed:', e);
  }
}

/**
 * Derives sheet name from issue category.
 */
function _getSheetFromCategory_(category) {
  if (category.startsWith('EVENTS_')) return 'EVENTS';
  if (category.startsWith('DIAG_')) return 'DIAG';
  if (category.startsWith('ANALYTICS_')) return 'ANALYTICS';
  return 'CROSS-REF';
}

// =============================================================================
// EMAIL NOTIFICATION
// =============================================================================

/**
 * Sends an email summary of health check issues.
 *
 * @param {Object} summary - Health check summary
 * @param {string} [recipient] - Email recipient (uses script owner if not provided)
 */
function _sendHealthCheckEmail_(summary, recipient) {
  try {
    // Get recipient email
    var toEmail = recipient;
    if (!toEmail) {
      toEmail = Session.getEffectiveUser().getEmail();
    }

    if (!toEmail) {
      console.warn('No email recipient available for health check notification');
      return;
    }

    const subject = summary.healthy
      ? '[DataHealth] Check passed with warnings - ' + summary.timestamp.substring(0, 10)
      : '[DataHealth] ISSUES FOUND - ' + summary.timestamp.substring(0, 10);

    const body = [
      'Data Health Check Summary',
      '=========================',
      '',
      'Timestamp: ' + summary.timestamp,
      'Spreadsheet: ' + summary.spreadsheetId,
      'Brand Filter: ' + summary.brandId,
      'Duration: ' + summary.durationMs + 'ms',
      '',
      'Results:',
      '--------',
      'Events checked: ' + summary.eventsChecked,
      'DIAG rows checked: ' + summary.diagRowsChecked,
      '',
      'Issues Found:',
      '- Errors: ' + summary.issues.errors,
      '- Warnings: ' + summary.issues.warnings,
      '- Info: ' + summary.issues.info,
      '- Total: ' + summary.issues.total,
      '',
      'Categories:',
      Object.keys(summary.categories).map(function(cat) {
        return '  ' + cat + ': ' + summary.categories[cat];
      }).join('\n'),
      '',
      'Overall Health: ' + (summary.healthy ? 'HEALTHY' : 'UNHEALTHY'),
      '',
      '---',
      'Check the DATA_ISSUES sheet in the spreadsheet for full details.',
      'See RUNBOOK.md for resolution procedures.'
    ].join('\n');

    MailApp.sendEmail({
      to: toEmail,
      subject: subject,
      body: body
    });

    console.log('Health check email sent to: ' + toEmail);

  } catch (e) {
    console.error('_sendHealthCheckEmail_ failed:', e);
  }
}

// =============================================================================
// TRIGGER MANAGEMENT
// =============================================================================

/**
 * Installs a nightly timer trigger for automatic data health checking.
 * Runs every day at 3 AM (after potential diag archiving at 2 AM).
 *
 * @returns {string} Trigger ID or error message
 */
function installDataHealthTrigger_() {
  try {
    // Check if trigger already exists
    const existingTriggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < existingTriggers.length; i++) {
      if (existingTriggers[i].getHandlerFunction() === 'runNightlyHealthCheck_') {
        return 'Trigger already exists: ' + existingTriggers[i].getUniqueId();
      }
    }

    // Create new daily trigger at 3 AM
    const trigger = ScriptApp.newTrigger('runNightlyHealthCheck_')
      .timeBased()
      .everyDays(1)
      .atHour(3)
      .create();

    const triggerId = trigger.getUniqueId();

    // Log trigger installation
    if (typeof diag_ === 'function') {
      diag_('info', 'installDataHealthTrigger_', 'Nightly health check trigger installed', {
        triggerId: triggerId,
        schedule: 'Daily at 3 AM'
      });
    }

    return 'Trigger installed: ' + triggerId;

  } catch (e) {
    console.error('Failed to install health check trigger:', e);
    return 'Error: ' + e.toString();
  }
}

/**
 * Removes all timer triggers for the health check function.
 *
 * @returns {string} Summary of removed triggers
 */
function uninstallDataHealthTrigger_() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    var removed = 0;

    triggers.forEach(function(trigger) {
      if (trigger.getHandlerFunction() === 'runNightlyHealthCheck_') {
        ScriptApp.deleteTrigger(trigger);
        removed++;
      }
    });

    if (typeof diag_ === 'function' && removed > 0) {
      diag_('info', 'uninstallDataHealthTrigger_', 'Health check triggers removed', {
        count: removed
      });
    }

    return 'Removed ' + removed + ' trigger(s)';

  } catch (e) {
    console.error('Failed to uninstall health check triggers:', e);
    return 'Error: ' + e.toString();
  }
}

/**
 * Lists all triggers related to data health checking.
 *
 * @returns {Array} Array of trigger info objects
 */
function listDataHealthTriggers_() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    const healthTriggers = [];

    triggers.forEach(function(trigger) {
      if (trigger.getHandlerFunction() === 'runNightlyHealthCheck_') {
        healthTriggers.push({
          id: trigger.getUniqueId(),
          handler: trigger.getHandlerFunction(),
          type: trigger.getTriggerSource().toString(),
          eventType: trigger.getEventType().toString()
        });
      }
    });

    return healthTriggers;

  } catch (e) {
    console.error('Failed to list health check triggers:', e);
    return [{ error: e.toString() }];
  }
}

/**
 * Entry point for nightly trigger.
 * Runs health check and sends email if issues found.
 */
function runNightlyHealthCheck_() {
  const summary = checkDataHealth_({
    sendEmail: true,
    clearPreviousIssues: true
  });

  console.log('Nightly health check completed:', JSON.stringify(summary));
  return summary;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Gets the spreadsheet for health check operations.
 *
 * @param {string} [spreadsheetId] - Optional spreadsheet ID
 * @returns {Spreadsheet|null} The spreadsheet object or null
 */
function _getSpreadsheetForHealthCheck_(spreadsheetId) {
  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }

  // Try to get from root brand
  if (typeof findBrand_ === 'function') {
    const rootBrand = findBrand_('root');
    if (rootBrand && rootBrand.store && rootBrand.store.spreadsheetId) {
      return SpreadsheetApp.openById(rootBrand.store.spreadsheetId);
    }
  }

  // Fall back to active spreadsheet
  return SpreadsheetApp.getActive();
}

/**
 * Logs health check completion to the DIAG sheet.
 */
function _logHealthCheckCompletion_(ss, summary) {
  try {
    if (typeof diag_ === 'function') {
      diag_('info', 'checkDataHealth_', 'Data health check completed', {
        eventsChecked: summary.eventsChecked,
        diagRowsChecked: summary.diagRowsChecked,
        errors: summary.issues.errors,
        warnings: summary.issues.warnings,
        totalIssues: summary.issues.total,
        healthy: summary.healthy,
        durationMs: summary.durationMs
      }, ss.getId());
    } else {
      console.log('Health check completed:', summary);
    }
  } catch (e) {
    console.error('Failed to log health check completion:', e);
  }
}

/**
 * Gets a quick health summary without writing to sheet.
 * Useful for status checks and monitoring.
 *
 * @param {string} [spreadsheetId] - Optional spreadsheet ID
 * @returns {Object} Quick health summary
 */
function getDataHealthSummary_(spreadsheetId) {
  const summary = {
    timestamp: new Date().toISOString(),
    healthy: true,
    quickChecks: {
      eventsSheet: { exists: false, rowCount: 0 },
      diagSheet: { exists: false, rowCount: 0 },
      dataIssuesSheet: { exists: false, issueCount: 0 }
    }
  };

  try {
    const ss = _getSpreadsheetForHealthCheck_(spreadsheetId);
    if (!ss) {
      summary.healthy = false;
      summary.error = 'Could not access spreadsheet';
      return summary;
    }

    // Check EVENTS sheet
    const eventsSheet = ss.getSheetByName(DATA_HEALTH_CONFIG.EVENTS_SHEET);
    if (eventsSheet) {
      summary.quickChecks.eventsSheet.exists = true;
      summary.quickChecks.eventsSheet.rowCount = Math.max(0, eventsSheet.getLastRow() - 1);
    }

    // Check DIAG sheet
    const diagSheet = ss.getSheetByName(DATA_HEALTH_CONFIG.DIAG_SHEET);
    if (diagSheet) {
      summary.quickChecks.diagSheet.exists = true;
      summary.quickChecks.diagSheet.rowCount = Math.max(0, diagSheet.getLastRow() - 1);
    }

    // Check DATA_ISSUES sheet
    const issuesSheet = ss.getSheetByName(DATA_HEALTH_CONFIG.ISSUES_SHEET);
    if (issuesSheet) {
      summary.quickChecks.dataIssuesSheet.exists = true;
      summary.quickChecks.dataIssuesSheet.issueCount = Math.max(0, issuesSheet.getLastRow() - 1);

      // If there are recent issues, mark as unhealthy
      if (summary.quickChecks.dataIssuesSheet.issueCount > 0) {
        summary.healthy = false;
        summary.lastIssueCheck = 'Issues present in DATA_ISSUES sheet';
      }
    }

  } catch (e) {
    summary.healthy = false;
    summary.error = e.toString();
  }

  return summary;
}

/**
 * Manual helper to run health check for a specific brand.
 * Useful for debugging brand-specific issues.
 *
 * @param {string} brandId - Brand ID (root, abc, cbc, cbl)
 * @returns {Object} Health check summary
 */
function checkBrandDataHealth_(brandId) {
  if (!brandId) {
    return { error: 'Brand ID required' };
  }

  return checkDataHealth_({
    brandId: brandId,
    sendEmail: false,
    clearPreviousIssues: false
  });
}

/**
 * Manual helper to run health check with email notification.
 * Useful for ad-hoc checks before events.
 *
 * @param {string} [emailRecipient] - Optional email recipient
 * @returns {Object} Health check summary
 */
function checkDataHealthWithEmail_(emailRecipient) {
  return checkDataHealth_({
    sendEmail: true,
    emailRecipient: emailRecipient,
    clearPreviousIssues: true
  });
}
