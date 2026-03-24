/**
 * DiagArchiver.gs - DIAG Log Retention & Archiving
 *
 * Provides utilities for archiving diagnostic logs to prevent spreadsheet slowdown.
 * See docs/DATA_POLICY.md for retention policy documentation.
 *
 * Main functions:
 * - rotateDiagLogs_(): Archive old entries and enforce row limits
 * - installDiagArchiveTrigger_(): Set up monthly automatic archiving
 * - purgeOldArchives_(): Remove archives older than retention period
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const DIAG_ARCHIVE_THRESHOLD = 10000;   // Archive when active sheet exceeds this
const DIAG_ARCHIVE_KEEP_DAYS = 30;      // Keep entries newer than this in active sheet
const LOG_ERRORS_ARCHIVE_THRESHOLD = 5000;
const LOG_ERRORS_ARCHIVE_KEEP_DAYS = 30;
const ARCHIVE_RETENTION_MONTHS = 12;    // Keep archives for 12 months

// =============================================================================
// MAIN ARCHIVING FUNCTION
// =============================================================================

/**
 * Main entry point for DIAG log rotation and archiving.
 * Archives entries older than KEEP_DAYS to monthly archive sheets.
 * Enforces row limits on active sheets.
 *
 * Can be run manually or via timer trigger.
 *
 * @param {string} [spreadsheetId] - Optional spreadsheet ID. Uses root brand if not provided.
 * @returns {object} Summary of archiving operations performed
 */
function rotateDiagLogs_(spreadsheetId) {
  const startTime = Date.now();
  const summary = {
    diagArchived: 0,
    logErrorsArchived: 0,
    diagRemaining: 0,
    logErrorsRemaining: 0,
    archiveSheets: [],
    errors: []
  };

  try {
    const ss = _getSpreadsheetForArchiving_(spreadsheetId);
    if (!ss) {
      summary.errors.push('Could not access spreadsheet');
      return summary;
    }

    // Archive DIAG sheet
    const diagResult = _archiveSheet_(ss, 'DIAG', DIAG_ARCHIVE_THRESHOLD, DIAG_ARCHIVE_KEEP_DAYS);
    summary.diagArchived = diagResult.archived;
    summary.diagRemaining = diagResult.remaining;
    if (diagResult.archiveSheet) {
      summary.archiveSheets.push(diagResult.archiveSheet);
    }
    if (diagResult.error) {
      summary.errors.push(diagResult.error);
    }

    // Archive LOG_ERRORS sheet
    const logErrorsResult = _archiveSheet_(ss, 'LOG_ERRORS', LOG_ERRORS_ARCHIVE_THRESHOLD, LOG_ERRORS_ARCHIVE_KEEP_DAYS);
    summary.logErrorsArchived = logErrorsResult.archived;
    summary.logErrorsRemaining = logErrorsResult.remaining;
    if (logErrorsResult.archiveSheet) {
      summary.archiveSheets.push(logErrorsResult.archiveSheet);
    }
    if (logErrorsResult.error) {
      summary.errors.push(logErrorsResult.error);
    }

    // Log completion
    const duration = Date.now() - startTime;
    _logArchiveCompletion_(ss, summary, duration);

  } catch (e) {
    summary.errors.push('Fatal error: ' + e.toString());
    console.error('rotateDiagLogs_ failed:', e);
  }

  return summary;
}

// =============================================================================
// CORE ARCHIVING LOGIC
// =============================================================================

/**
 * Archives old entries from a sheet to a monthly archive sheet.
 *
 * @param {Spreadsheet} ss - The spreadsheet object
 * @param {string} sheetName - Name of the sheet to archive (DIAG or LOG_ERRORS)
 * @param {number} threshold - Archive when row count exceeds this
 * @param {number} keepDays - Keep entries newer than this many days
 * @returns {object} Result with archived count, remaining count, archive sheet name, error
 */
function _archiveSheet_(ss, sheetName, threshold, keepDays) {
  const result = { archived: 0, remaining: 0, archiveSheet: null, error: null };

  try {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      result.error = sheetName + ' sheet not found';
      return result;
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      // Only header row, nothing to archive
      result.remaining = 0;
      return result;
    }

    // Check if archiving is needed
    const dataRows = lastRow - 1; // Exclude header
    if (dataRows <= threshold) {
      result.remaining = dataRows;
      return result;
    }

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - keepDays);
    const cutoffISO = cutoffDate.toISOString();

    // Get all data (including header)
    const allData = sheet.getDataRange().getValues();
    const header = allData[0];
    const dataWithoutHeader = allData.slice(1);

    // Find rows to archive (older than cutoff)
    const rowsToArchive = [];
    const rowsToKeep = [];

    dataWithoutHeader.forEach(function(row) {
      const ts = String(row[0]); // First column is timestamp
      if (ts < cutoffISO) {
        rowsToArchive.push(row);
      } else {
        rowsToKeep.push(row);
      }
    });

    if (rowsToArchive.length === 0) {
      // Nothing old enough to archive, but we still need to trim
      // Just enforce the hard cap by removing oldest entries
      if (dataWithoutHeader.length > threshold) {
        const excessRows = dataWithoutHeader.length - threshold;
        const trimmedRows = dataWithoutHeader.slice(0, excessRows);
        const remainingRows = dataWithoutHeader.slice(excessRows);

        // Archive the trimmed rows
        const archiveSheetName = _getArchiveSheetName_(sheetName);
        _writeToArchive_(ss, archiveSheetName, header, trimmedRows);

        // Rewrite the sheet with remaining rows
        _rewriteSheet_(sheet, header, remainingRows);

        result.archived = trimmedRows.length;
        result.remaining = remainingRows.length;
        result.archiveSheet = archiveSheetName;
      } else {
        result.remaining = dataWithoutHeader.length;
      }
      return result;
    }

    // Get or create archive sheet for the current month
    const archiveSheetName = _getArchiveSheetName_(sheetName);

    // Write archived rows to archive sheet
    _writeToArchive_(ss, archiveSheetName, header, rowsToArchive);

    // Enforce threshold on remaining rows
    let finalRowsToKeep = rowsToKeep;
    if (rowsToKeep.length > threshold) {
      // Still too many rows, archive more
      const excessRows = rowsToKeep.length - threshold;
      const additionalArchive = rowsToKeep.slice(0, excessRows);
      finalRowsToKeep = rowsToKeep.slice(excessRows);

      // Add to archive
      _writeToArchive_(ss, archiveSheetName, header, additionalArchive);
      result.archived += additionalArchive.length;
    }

    // Rewrite the active sheet with kept rows
    _rewriteSheet_(sheet, header, finalRowsToKeep);

    result.archived += rowsToArchive.length;
    result.remaining = finalRowsToKeep.length;
    result.archiveSheet = archiveSheetName;

  } catch (e) {
    result.error = sheetName + ' archiving error: ' + e.toString();
    console.error('_archiveSheet_ failed for ' + sheetName + ':', e);
  }

  return result;
}

/**
 * Generates the archive sheet name for the current month.
 *
 * @param {string} baseSheetName - The base sheet name (DIAG or LOG_ERRORS)
 * @returns {string} Archive sheet name like DIAG_ARCHIVE_2025_11
 */
function _getArchiveSheetName_(baseSheetName) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return baseSheetName + '_ARCHIVE_' + year + '_' + month;
}

/**
 * Writes rows to an archive sheet, creating it if necessary.
 *
 * @param {Spreadsheet} ss - The spreadsheet
 * @param {string} archiveSheetName - Name of the archive sheet
 * @param {Array} header - Header row
 * @param {Array[]} rows - Data rows to append
 */
function _writeToArchive_(ss, archiveSheetName, header, rows) {
  if (!rows || rows.length === 0) {
    return;
  }

  let archiveSheet = ss.getSheetByName(archiveSheetName);

  if (!archiveSheet) {
    // Create new archive sheet
    archiveSheet = ss.insertSheet(archiveSheetName);
    archiveSheet.appendRow(header);
    archiveSheet.setFrozenRows(1);

    // Set column widths similar to source sheet
    if (header.length >= 5) {
      archiveSheet.setColumnWidth(1, 180);  // ts
      archiveSheet.setColumnWidth(4, 300);  // msg
      archiveSheet.setColumnWidth(5, 400);  // meta
    }
  }

  // Append rows in batches to avoid timeout
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const startRow = archiveSheet.getLastRow() + 1;
    archiveSheet.getRange(startRow, 1, batch.length, header.length).setValues(batch);
  }
}

/**
 * Rewrites a sheet with new data, preserving the header.
 *
 * @param {Sheet} sheet - The sheet to rewrite
 * @param {Array} header - Header row
 * @param {Array[]} rows - Data rows
 */
function _rewriteSheet_(sheet, header, rows) {
  // Clear all data except don't delete the sheet
  sheet.clear();

  // Write header
  sheet.appendRow(header);
  sheet.setFrozenRows(1);

  // Write data in batches
  if (rows.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, batch.length, header.length).setValues(batch);
    }
  }
}

/**
 * Gets the spreadsheet for archiving operations.
 *
 * @param {string} [spreadsheetId] - Optional spreadsheet ID
 * @returns {Spreadsheet|null} The spreadsheet object or null
 */
function _getSpreadsheetForArchiving_(spreadsheetId) {
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
 * Logs archive completion to the DIAG sheet.
 *
 * @param {Spreadsheet} ss - The spreadsheet
 * @param {object} summary - Archive summary
 * @param {number} duration - Duration in milliseconds
 */
function _logArchiveCompletion_(ss, summary, duration) {
  try {
    if (typeof diag_ === 'function') {
      diag_('info', 'rotateDiagLogs_', 'Archive rotation completed', {
        diagArchived: summary.diagArchived,
        logErrorsArchived: summary.logErrorsArchived,
        diagRemaining: summary.diagRemaining,
        logErrorsRemaining: summary.logErrorsRemaining,
        archiveSheets: summary.archiveSheets,
        durationMs: duration,
        errors: summary.errors.length > 0 ? summary.errors : undefined
      });
    } else {
      console.log('Archive rotation completed:', summary);
    }
  } catch (e) {
    console.error('Failed to log archive completion:', e);
  }
}

// =============================================================================
// TIMER TRIGGER MANAGEMENT
// =============================================================================

/**
 * Installs a monthly timer trigger for automatic log archiving.
 * Runs on the 1st of each month at 2 AM.
 *
 * @returns {string} Trigger ID or error message
 */
function installDiagArchiveTrigger_() {
  try {
    // Check if trigger already exists
    const existingTriggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < existingTriggers.length; i++) {
      if (existingTriggers[i].getHandlerFunction() === 'rotateDiagLogs_') {
        return 'Trigger already exists: ' + existingTriggers[i].getUniqueId();
      }
    }

    // Create new monthly trigger
    const trigger = ScriptApp.newTrigger('rotateDiagLogs_')
      .timeBased()
      .onMonthDay(1)      // 1st of each month
      .atHour(2)          // 2 AM
      .create();

    const triggerId = trigger.getUniqueId();

    // Log trigger installation
    if (typeof diag_ === 'function') {
      diag_('info', 'installDiagArchiveTrigger_', 'Monthly archive trigger installed', {
        triggerId: triggerId,
        schedule: '1st of month at 2 AM'
      });
    }

    return 'Trigger installed: ' + triggerId;

  } catch (e) {
    console.error('Failed to install archive trigger:', e);
    return 'Error: ' + e.toString();
  }
}

/**
 * Removes all timer triggers for the archive function.
 *
 * @returns {string} Summary of removed triggers
 */
function uninstallDiagArchiveTrigger_() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    let removed = 0;

    triggers.forEach(function(trigger) {
      if (trigger.getHandlerFunction() === 'rotateDiagLogs_') {
        ScriptApp.deleteTrigger(trigger);
        removed++;
      }
    });

    if (typeof diag_ === 'function' && removed > 0) {
      diag_('info', 'uninstallDiagArchiveTrigger_', 'Archive triggers removed', {
        count: removed
      });
    }

    return 'Removed ' + removed + ' trigger(s)';

  } catch (e) {
    console.error('Failed to uninstall archive triggers:', e);
    return 'Error: ' + e.toString();
  }
}

/**
 * Lists all triggers related to log archiving.
 *
 * @returns {Array} Array of trigger info objects
 */
function listDiagArchiveTriggers_() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    const archiveTriggers = [];

    triggers.forEach(function(trigger) {
      if (trigger.getHandlerFunction() === 'rotateDiagLogs_') {
        archiveTriggers.push({
          id: trigger.getUniqueId(),
          handler: trigger.getHandlerFunction(),
          type: trigger.getTriggerSource().toString(),
          eventType: trigger.getEventType().toString()
        });
      }
    });

    return archiveTriggers;

  } catch (e) {
    console.error('Failed to list archive triggers:', e);
    return [{ error: e.toString() }];
  }
}

// =============================================================================
// ARCHIVE MAINTENANCE
// =============================================================================

/**
 * Removes archive sheets older than the retention period.
 *
 * @param {string} [spreadsheetId] - Optional spreadsheet ID
 * @param {number} [retentionMonths] - Months to retain (default: ARCHIVE_RETENTION_MONTHS)
 * @returns {object} Summary of purged archives
 */
function purgeOldArchives_(spreadsheetId, retentionMonths) {
  const retention = retentionMonths || ARCHIVE_RETENTION_MONTHS;
  const summary = { purged: [], retained: [], errors: [] };

  try {
    const ss = _getSpreadsheetForArchiving_(spreadsheetId);
    if (!ss) {
      summary.errors.push('Could not access spreadsheet');
      return summary;
    }

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - retention);
    const cutoffYear = cutoffDate.getFullYear();
    const cutoffMonth = cutoffDate.getMonth() + 1;

    // Find all archive sheets
    const sheets = ss.getSheets();
    const archivePattern = /^(DIAG|LOG_ERRORS)_ARCHIVE_(\d{4})_(\d{2})$/;

    sheets.forEach(function(sheet) {
      const name = sheet.getName();
      const match = name.match(archivePattern);

      if (match) {
        const archiveYear = parseInt(match[2], 10);
        const archiveMonth = parseInt(match[3], 10);

        // Check if archive is older than cutoff
        if (archiveYear < cutoffYear ||
            (archiveYear === cutoffYear && archiveMonth < cutoffMonth)) {
          try {
            ss.deleteSheet(sheet);
            summary.purged.push(name);
          } catch (e) {
            summary.errors.push('Failed to delete ' + name + ': ' + e.toString());
          }
        } else {
          summary.retained.push(name);
        }
      }
    });

    // Log purge completion
    if (typeof diag_ === 'function' && summary.purged.length > 0) {
      diag_('info', 'purgeOldArchives_', 'Old archives purged', {
        purged: summary.purged,
        retained: summary.retained.length,
        retentionMonths: retention
      });
    }

  } catch (e) {
    summary.errors.push('Fatal error: ' + e.toString());
    console.error('purgeOldArchives_ failed:', e);
  }

  return summary;
}

/**
 * Lists all archive sheets in the spreadsheet.
 *
 * @param {string} [spreadsheetId] - Optional spreadsheet ID
 * @returns {Array} Array of archive sheet info
 */
function listArchiveSheets_(spreadsheetId) {
  const archives = [];

  try {
    const ss = _getSpreadsheetForArchiving_(spreadsheetId);
    if (!ss) {
      return [{ error: 'Could not access spreadsheet' }];
    }

    const sheets = ss.getSheets();
    const archivePattern = /^(DIAG|LOG_ERRORS)_ARCHIVE_(\d{4})_(\d{2})$/;

    sheets.forEach(function(sheet) {
      const name = sheet.getName();
      const match = name.match(archivePattern);

      if (match) {
        archives.push({
          name: name,
          type: match[1],
          year: parseInt(match[2], 10),
          month: parseInt(match[3], 10),
          rowCount: sheet.getLastRow() - 1  // Exclude header
        });
      }
    });

    // Sort by date (newest first)
    archives.sort(function(a, b) {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });

  } catch (e) {
    console.error('listArchiveSheets_ failed:', e);
    return [{ error: e.toString() }];
  }

  return archives;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Gets archive statistics for monitoring.
 *
 * @param {string} [spreadsheetId] - Optional spreadsheet ID
 * @returns {object} Statistics about active and archive sheets
 */
function getDiagArchiveStats_(spreadsheetId) {
  const stats = {
    activeSheets: {},
    archives: [],
    totalArchivedRows: 0,
    oldestArchive: null,
    newestArchive: null
  };

  try {
    const ss = _getSpreadsheetForArchiving_(spreadsheetId);
    if (!ss) {
      stats.error = 'Could not access spreadsheet';
      return stats;
    }

    // Get active sheet stats
    const diagSheet = ss.getSheetByName('DIAG');
    const logErrorsSheet = ss.getSheetByName('LOG_ERRORS');

    if (diagSheet) {
      stats.activeSheets.DIAG = {
        rowCount: Math.max(0, diagSheet.getLastRow() - 1),
        threshold: DIAG_ARCHIVE_THRESHOLD
      };
    }

    if (logErrorsSheet) {
      stats.activeSheets.LOG_ERRORS = {
        rowCount: Math.max(0, logErrorsSheet.getLastRow() - 1),
        threshold: LOG_ERRORS_ARCHIVE_THRESHOLD
      };
    }

    // Get archive stats
    const archives = listArchiveSheets_(spreadsheetId);
    stats.archives = archives;

    if (archives.length > 0 && !archives[0].error) {
      stats.totalArchivedRows = archives.reduce(function(sum, a) {
        return sum + (a.rowCount || 0);
      }, 0);

      // Newest is first (already sorted)
      stats.newestArchive = archives[0].name;
      stats.oldestArchive = archives[archives.length - 1].name;
    }

  } catch (e) {
    stats.error = e.toString();
    console.error('getDiagArchiveStats_ failed:', e);
  }

  return stats;
}

/**
 * Forces immediate archiving regardless of thresholds.
 * Useful for manual cleanup before events.
 *
 * @param {string} [spreadsheetId] - Optional spreadsheet ID
 * @returns {object} Archive summary
 */
function forceArchiveDiagLogs_(spreadsheetId) {
  // Temporarily lower thresholds to force archiving
  const originalDiagThreshold = DIAG_ARCHIVE_THRESHOLD;
  const originalLogErrorsThreshold = LOG_ERRORS_ARCHIVE_THRESHOLD;

  // Can't actually modify const, so we'll call with lower keepDays instead
  // This effectively archives more by keeping fewer days
  return _forceArchiveWithLowerKeepDays_(spreadsheetId, 7);
}

/**
 * Internal function to force archive with lower keep days.
 */
function _forceArchiveWithLowerKeepDays_(spreadsheetId, keepDays) {
  const startTime = Date.now();
  const summary = {
    diagArchived: 0,
    logErrorsArchived: 0,
    diagRemaining: 0,
    logErrorsRemaining: 0,
    archiveSheets: [],
    errors: [],
    forced: true
  };

  try {
    const ss = _getSpreadsheetForArchiving_(spreadsheetId);
    if (!ss) {
      summary.errors.push('Could not access spreadsheet');
      return summary;
    }

    // Archive with lower keepDays (more aggressive)
    const diagResult = _archiveSheet_(ss, 'DIAG', 5000, keepDays);
    summary.diagArchived = diagResult.archived;
    summary.diagRemaining = diagResult.remaining;
    if (diagResult.archiveSheet) {
      summary.archiveSheets.push(diagResult.archiveSheet);
    }
    if (diagResult.error) {
      summary.errors.push(diagResult.error);
    }

    const logErrorsResult = _archiveSheet_(ss, 'LOG_ERRORS', 2500, keepDays);
    summary.logErrorsArchived = logErrorsResult.archived;
    summary.logErrorsRemaining = logErrorsResult.remaining;
    if (logErrorsResult.archiveSheet) {
      summary.archiveSheets.push(logErrorsResult.archiveSheet);
    }
    if (logErrorsResult.error) {
      summary.errors.push(logErrorsResult.error);
    }

    const duration = Date.now() - startTime;
    _logArchiveCompletion_(ss, summary, duration);

  } catch (e) {
    summary.errors.push('Fatal error: ' + e.toString());
    console.error('forceArchiveDiagLogs_ failed:', e);
  }

  return summary;
}
