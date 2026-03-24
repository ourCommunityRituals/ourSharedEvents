/**
 * BackupService.gs - Control Sheet Backup & Restore
 *
 * Provides backup/restore functionality for critical data sheets.
 * See RUNBOOK.md for recovery procedures.
 *
 * Main functions:
 * - backupControlSheet(): Create timestamped backup of key tabs
 * - restoreFromBackup_(): Restore data from backup sheet
 * - listBackups_(): List available backups
 * - getBackupStats_(): Get backup health statistics
 *
 * Story 14: Backup / Restore & Data Safety Smoke
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const BACKUP_CONFIG = Object.freeze({
  // Sheets to backup (critical data)
  SHEETS_TO_BACKUP: ['EVENTS', 'SPONSORS', 'ANALYTICS', 'TEMPLATES'],

  // Backup naming pattern: BACKUP_YYYY_MM_DD_HHMM
  PREFIX: 'BACKUP_',

  // Maximum backups to retain (oldest will be purged)
  MAX_BACKUPS: 10,

  // Minimum time between backups (milliseconds) - 1 hour
  MIN_BACKUP_INTERVAL_MS: 60 * 60 * 1000
});

// =============================================================================
// MAIN BACKUP FUNCTION
// =============================================================================

/**
 * Creates a timestamped backup of key control sheet tabs.
 *
 * This is the main backup function for data safety. It:
 * 1. Creates a backup sheet named with timestamp
 * 2. Copies data from critical sheets (EVENTS, SPONSORS, etc.)
 * 3. Enforces backup retention limits
 * 4. Returns an Ok envelope with backup details
 *
 * @param {string} [spreadsheetId] - Optional spreadsheet ID. Uses root brand if not provided.
 * @param {object} [options] - Optional configuration
 * @param {boolean} [options.dryRun] - If true, only validate without creating backup
 * @param {string[]} [options.sheets] - Override which sheets to backup
 * @returns {object} Ok envelope with backup summary or Err envelope on failure
 *
 * @example
 * // Create backup of default sheets
 * const result = backupControlSheet();
 * if (result.ok) {
 *   console.log('Backup created:', result.value.backupId);
 * }
 *
 * @example
 * // Dry run to check if backup is possible
 * const result = backupControlSheet(null, { dryRun: true });
 */
function backupControlSheet(spreadsheetId, options = {}) {
  const startTime = Date.now();
  const { dryRun = false, sheets = BACKUP_CONFIG.SHEETS_TO_BACKUP } = options;

  const summary = {
    backupId: null,
    timestamp: new Date().toISOString(),
    sheets: {},
    totalRows: 0,
    dryRun: dryRun,
    durationMs: 0,
    errors: []
  };

  try {
    // Get spreadsheet
    const ss = _getSpreadsheetForBackup_(spreadsheetId);
    if (!ss) {
      return _backupErr_('INTERNAL', 'Could not access spreadsheet for backup');
    }

    // Check if recent backup exists (prevent too-frequent backups)
    if (!dryRun) {
      const recentBackup = _getRecentBackup_(ss);
      if (recentBackup) {
        const elapsed = Date.now() - recentBackup.timestamp;
        if (elapsed < BACKUP_CONFIG.MIN_BACKUP_INTERVAL_MS) {
          const minutesAgo = Math.round(elapsed / 60000);
          return _backupOk_({
            ...summary,
            skipped: true,
            reason: `Recent backup exists (${minutesAgo} minutes ago)`,
            lastBackupId: recentBackup.name,
            durationMs: Date.now() - startTime
          });
        }
      }
    }

    // Generate backup ID
    const backupId = _generateBackupId_();
    summary.backupId = backupId;

    // Validate source sheets exist
    for (const sheetName of sheets) {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        summary.sheets[sheetName] = { exists: false, rows: 0, backed: false };
        summary.errors.push(`Sheet not found: ${sheetName}`);
        continue;
      }

      const rowCount = Math.max(0, sheet.getLastRow() - 1); // Exclude header
      summary.sheets[sheetName] = { exists: true, rows: rowCount, backed: false };
      summary.totalRows += rowCount;
    }

    // If dry run, return validation results
    if (dryRun) {
      summary.durationMs = Date.now() - startTime;
      return _backupOk_(summary);
    }

    // Create backup
    const backupResult = _createBackupSheet_(ss, backupId, sheets);
    if (!backupResult.ok) {
      return backupResult;
    }

    // Update summary with backup results
    for (const [sheetName, result] of Object.entries(backupResult.sheetsBackedUp)) {
      if (summary.sheets[sheetName]) {
        summary.sheets[sheetName].backed = result.backed;
        summary.sheets[sheetName].rows = result.rows;
      }
    }

    // Enforce retention limit
    const purgeResult = _purgeOldBackups_(ss);
    if (purgeResult.purged.length > 0) {
      summary.purgedBackups = purgeResult.purged;
    }

    // Log backup completion
    _logBackupCompletion_(ss, summary);

    summary.durationMs = Date.now() - startTime;
    return _backupOk_(summary);

  } catch (e) {
    summary.errors.push('Fatal error: ' + e.toString());
    summary.durationMs = Date.now() - startTime;
    console.error('backupControlSheet failed:', e);

    return _backupErr_('INTERNAL', 'Backup failed: ' + e.message, {
      stack: e.stack,
      summary: summary
    });
  }
}

// =============================================================================
// BACKUP CREATION
// =============================================================================

/**
 * Creates the actual backup sheet with data from source sheets.
 *
 * @param {Spreadsheet} ss - The spreadsheet
 * @param {string} backupId - Backup identifier
 * @param {string[]} sheets - Sheet names to backup
 * @returns {object} Result with backup status
 */
function _createBackupSheet_(ss, backupId, sheets) {
  const result = {
    ok: true,
    backupSheetName: backupId,
    sheetsBackedUp: {}
  };

  try {
    // Create backup sheet
    let backupSheet = ss.getSheetByName(backupId);
    if (backupSheet) {
      // Backup with this ID already exists (shouldn't happen)
      return _backupErr_('BAD_INPUT', `Backup already exists: ${backupId}`);
    }

    backupSheet = ss.insertSheet(backupId);

    // Write backup metadata header
    const metadata = [
      ['BACKUP METADATA'],
      ['Created', new Date().toISOString()],
      ['Backup ID', backupId],
      ['Sheets Included', sheets.join(', ')],
      [''],
      ['--- SHEET DATA FOLLOWS ---'],
      ['']
    ];
    backupSheet.getRange(1, 1, metadata.length, 2).setValues(metadata);

    let currentRow = metadata.length + 1;

    // Copy each sheet's data
    for (const sheetName of sheets) {
      const sourceSheet = ss.getSheetByName(sheetName);
      result.sheetsBackedUp[sheetName] = { backed: false, rows: 0 };

      if (!sourceSheet) {
        // Sheet doesn't exist, skip
        continue;
      }

      const lastRow = sourceSheet.getLastRow();
      const lastCol = sourceSheet.getLastColumn();

      if (lastRow === 0 || lastCol === 0) {
        // Empty sheet
        result.sheetsBackedUp[sheetName] = { backed: true, rows: 0 };
        continue;
      }

      // Write sheet marker
      backupSheet.getRange(currentRow, 1).setValue(`=== ${sheetName} ===`);
      currentRow++;

      // Copy data
      const data = sourceSheet.getRange(1, 1, lastRow, lastCol).getValues();
      backupSheet.getRange(currentRow, 1, data.length, data[0].length).setValues(data);

      result.sheetsBackedUp[sheetName] = { backed: true, rows: lastRow - 1 };
      currentRow += data.length + 1; // +1 for spacing
    }

    // Format backup sheet
    backupSheet.setFrozenRows(1);
    backupSheet.setColumnWidth(1, 200);
    backupSheet.setColumnWidth(2, 300);

    return result;

  } catch (e) {
    console.error('_createBackupSheet_ failed:', e);
    return _backupErr_('INTERNAL', 'Failed to create backup sheet: ' + e.message);
  }
}

/**
 * Generates a unique backup ID with timestamp.
 * Format: BACKUP_YYYY_MM_DD_HHMM
 *
 * @returns {string} Backup ID
 */
function _generateBackupId_() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');

  return `${BACKUP_CONFIG.PREFIX}${year}_${month}_${day}_${hour}${minute}`;
}

// =============================================================================
// RESTORE FUNCTIONS
// =============================================================================

/**
 * Restores data from a backup sheet to the original sheets.
 *
 * WARNING: This will OVERWRITE existing data in the target sheets.
 *
 * @param {string} backupId - The backup ID to restore from
 * @param {string} [spreadsheetId] - Optional spreadsheet ID
 * @param {object} [options] - Options
 * @param {boolean} [options.dryRun] - If true, only validate without restoring
 * @param {string[]} [options.sheets] - Specific sheets to restore (default: all)
 * @returns {object} Ok/Err envelope with restore results
 */
function restoreFromBackup_(backupId, spreadsheetId, options = {}) {
  const { dryRun = false, sheets = null } = options;
  const startTime = Date.now();

  const summary = {
    backupId: backupId,
    timestamp: new Date().toISOString(),
    sheets: {},
    totalRowsRestored: 0,
    dryRun: dryRun,
    durationMs: 0,
    errors: []
  };

  try {
    const ss = _getSpreadsheetForBackup_(spreadsheetId);
    if (!ss) {
      return _backupErr_('INTERNAL', 'Could not access spreadsheet');
    }

    // Find backup sheet
    const backupSheet = ss.getSheetByName(backupId);
    if (!backupSheet) {
      return _backupErr_('NOT_FOUND', `Backup not found: ${backupId}`);
    }

    // Parse backup metadata and data
    const backupData = _parseBackupSheet_(backupSheet);
    if (!backupData.ok) {
      return backupData;
    }

    // Determine which sheets to restore
    const sheetsToRestore = sheets || Object.keys(backupData.sheets);

    // Validate or restore
    for (const sheetName of sheetsToRestore) {
      if (!backupData.sheets[sheetName]) {
        summary.sheets[sheetName] = { restored: false, error: 'Not in backup' };
        continue;
      }

      const sheetData = backupData.sheets[sheetName];
      summary.sheets[sheetName] = {
        rows: sheetData.length - 1, // Exclude header
        restored: false
      };

      if (dryRun) {
        summary.sheets[sheetName].restored = true;
        summary.totalRowsRestored += sheetData.length - 1;
        continue;
      }

      // Restore the sheet
      const targetSheet = ss.getSheetByName(sheetName);
      if (!targetSheet) {
        summary.sheets[sheetName].error = 'Target sheet not found';
        summary.errors.push(`Target sheet not found: ${sheetName}`);
        continue;
      }

      // Clear existing data and restore
      targetSheet.clear();
      if (sheetData.length > 0) {
        targetSheet.getRange(1, 1, sheetData.length, sheetData[0].length).setValues(sheetData);
      }
      targetSheet.setFrozenRows(1);

      summary.sheets[sheetName].restored = true;
      summary.totalRowsRestored += sheetData.length - 1;
    }

    // Log restore completion
    if (!dryRun) {
      _logRestoreCompletion_(ss, summary);
    }

    summary.durationMs = Date.now() - startTime;
    return _backupOk_(summary);

  } catch (e) {
    summary.errors.push('Fatal error: ' + e.toString());
    summary.durationMs = Date.now() - startTime;
    console.error('restoreFromBackup_ failed:', e);

    return _backupErr_('INTERNAL', 'Restore failed: ' + e.message, {
      stack: e.stack
    });
  }
}

/**
 * Parses a backup sheet to extract sheet data.
 *
 * @param {Sheet} backupSheet - The backup sheet
 * @returns {object} Parsed data with sheets map
 */
function _parseBackupSheet_(backupSheet) {
  try {
    const data = backupSheet.getDataRange().getValues();
    const sheets = {};
    let currentSheetName = null;
    let currentSheetData = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const firstCell = String(row[0]).trim();

      // Check for sheet marker
      const markerMatch = firstCell.match(/^=== (.+) ===$/);
      if (markerMatch) {
        // Save previous sheet data
        if (currentSheetName && currentSheetData.length > 0) {
          sheets[currentSheetName] = currentSheetData;
        }
        currentSheetName = markerMatch[1];
        currentSheetData = [];
        continue;
      }

      // Skip metadata rows
      if (firstCell.startsWith('BACKUP') ||
          firstCell.startsWith('Created') ||
          firstCell.startsWith('---') ||
          firstCell === '') {
        continue;
      }

      // Add data row if we're in a sheet section
      if (currentSheetName) {
        currentSheetData.push(row);
      }
    }

    // Save last sheet data
    if (currentSheetName && currentSheetData.length > 0) {
      sheets[currentSheetName] = currentSheetData;
    }

    return { ok: true, sheets: sheets };

  } catch (e) {
    console.error('_parseBackupSheet_ failed:', e);
    return _backupErr_('INTERNAL', 'Failed to parse backup: ' + e.message);
  }
}

// =============================================================================
// BACKUP MANAGEMENT
// =============================================================================

/**
 * Lists all available backups with their metadata.
 *
 * @param {string} [spreadsheetId] - Optional spreadsheet ID
 * @returns {object} Ok envelope with list of backups
 */
function listBackups_(spreadsheetId) {
  try {
    const ss = _getSpreadsheetForBackup_(spreadsheetId);
    if (!ss) {
      return _backupErr_('INTERNAL', 'Could not access spreadsheet');
    }

    const backups = [];
    const sheets = ss.getSheets();
    const backupPattern = /^BACKUP_(\d{4})_(\d{2})_(\d{2})_(\d{2})(\d{2})$/;

    for (const sheet of sheets) {
      const name = sheet.getName();
      const match = name.match(backupPattern);

      if (match) {
        const [, year, month, day, hour, minute] = match;
        const timestamp = new Date(
          parseInt(year),
          parseInt(month) - 1,
          parseInt(day),
          parseInt(hour),
          parseInt(minute)
        );

        backups.push({
          id: name,
          timestamp: timestamp.toISOString(),
          rowCount: sheet.getLastRow()
        });
      }
    }

    // Sort by timestamp (newest first)
    backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return _backupOk_({
      backups: backups,
      count: backups.length,
      maxRetained: BACKUP_CONFIG.MAX_BACKUPS
    });

  } catch (e) {
    console.error('listBackups_ failed:', e);
    return _backupErr_('INTERNAL', 'Failed to list backups: ' + e.message);
  }
}

/**
 * Gets backup health statistics.
 *
 * @param {string} [spreadsheetId] - Optional spreadsheet ID
 * @returns {object} Ok envelope with backup stats
 */
function getBackupStats_(spreadsheetId) {
  try {
    const listResult = listBackups_(spreadsheetId);
    if (!listResult.ok) {
      return listResult;
    }

    const backups = listResult.value.backups;
    const stats = {
      totalBackups: backups.length,
      maxBackups: BACKUP_CONFIG.MAX_BACKUPS,
      sheetsBackedUp: BACKUP_CONFIG.SHEETS_TO_BACKUP,
      latestBackup: null,
      oldestBackup: null,
      backupHealth: 'unknown'
    };

    if (backups.length > 0) {
      stats.latestBackup = {
        id: backups[0].id,
        timestamp: backups[0].timestamp,
        ageHours: Math.round((Date.now() - new Date(backups[0].timestamp)) / 3600000)
      };
      stats.oldestBackup = {
        id: backups[backups.length - 1].id,
        timestamp: backups[backups.length - 1].timestamp
      };

      // Determine health based on latest backup age
      const ageHours = stats.latestBackup.ageHours;
      if (ageHours < 24) {
        stats.backupHealth = 'good';
      } else if (ageHours < 72) {
        stats.backupHealth = 'stale';
      } else {
        stats.backupHealth = 'critical';
      }
    } else {
      stats.backupHealth = 'none';
    }

    return _backupOk_(stats);

  } catch (e) {
    console.error('getBackupStats_ failed:', e);
    return _backupErr_('INTERNAL', 'Failed to get backup stats: ' + e.message);
  }
}

/**
 * Gets the most recent backup if one exists.
 *
 * @param {Spreadsheet} ss - The spreadsheet
 * @returns {object|null} Recent backup info or null
 */
function _getRecentBackup_(ss) {
  const sheets = ss.getSheets();
  const backupPattern = /^BACKUP_(\d{4})_(\d{2})_(\d{2})_(\d{2})(\d{2})$/;
  let mostRecent = null;
  let mostRecentTime = 0;

  for (const sheet of sheets) {
    const name = sheet.getName();
    const match = name.match(backupPattern);

    if (match) {
      const [, year, month, day, hour, minute] = match;
      const timestamp = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute)
      ).getTime();

      if (timestamp > mostRecentTime) {
        mostRecentTime = timestamp;
        mostRecent = { name: name, timestamp: timestamp };
      }
    }
  }

  return mostRecent;
}

/**
 * Purges old backups beyond the retention limit.
 *
 * @param {Spreadsheet} ss - The spreadsheet
 * @returns {object} Summary of purged backups
 */
function _purgeOldBackups_(ss) {
  const result = { purged: [], retained: [], errors: [] };

  try {
    const listResult = listBackups_();
    if (!listResult.ok) {
      result.errors.push('Failed to list backups');
      return result;
    }

    const backups = listResult.value.backups;

    // Keep only MAX_BACKUPS
    if (backups.length > BACKUP_CONFIG.MAX_BACKUPS) {
      const toDelete = backups.slice(BACKUP_CONFIG.MAX_BACKUPS);

      for (const backup of toDelete) {
        try {
          const sheet = ss.getSheetByName(backup.id);
          if (sheet) {
            ss.deleteSheet(sheet);
            result.purged.push(backup.id);
          }
        } catch (e) {
          result.errors.push(`Failed to delete ${backup.id}: ${e.message}`);
        }
      }

      result.retained = backups.slice(0, BACKUP_CONFIG.MAX_BACKUPS).map(b => b.id);
    } else {
      result.retained = backups.map(b => b.id);
    }

  } catch (e) {
    result.errors.push('Purge error: ' + e.toString());
  }

  return result;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Gets the spreadsheet for backup operations.
 *
 * @param {string} [spreadsheetId] - Optional spreadsheet ID
 * @returns {Spreadsheet|null} The spreadsheet object or null
 */
function _getSpreadsheetForBackup_(spreadsheetId) {
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
 * Logs backup completion to the DIAG sheet.
 *
 * @param {Spreadsheet} ss - The spreadsheet
 * @param {object} summary - Backup summary
 */
function _logBackupCompletion_(ss, summary) {
  try {
    if (typeof diag_ === 'function') {
      diag_('info', 'backupControlSheet', 'Backup completed', {
        backupId: summary.backupId,
        totalRows: summary.totalRows,
        sheets: Object.keys(summary.sheets),
        durationMs: summary.durationMs,
        errors: summary.errors.length > 0 ? summary.errors : undefined
      });
    } else {
      console.log('Backup completed:', summary);
    }
  } catch (e) {
    console.error('Failed to log backup completion:', e);
  }
}

/**
 * Logs restore completion to the DIAG sheet.
 *
 * @param {Spreadsheet} ss - The spreadsheet
 * @param {object} summary - Restore summary
 */
function _logRestoreCompletion_(ss, summary) {
  try {
    if (typeof diag_ === 'function') {
      diag_('warn', 'restoreFromBackup_', 'Restore completed', {
        backupId: summary.backupId,
        totalRowsRestored: summary.totalRowsRestored,
        sheets: Object.keys(summary.sheets),
        durationMs: summary.durationMs,
        errors: summary.errors.length > 0 ? summary.errors : undefined
      });
    } else {
      console.log('Restore completed:', summary);
    }
  } catch (e) {
    console.error('Failed to log restore completion:', e);
  }
}

// =============================================================================
// ENVELOPE HELPERS
// =============================================================================

/**
 * Creates a success envelope for backup operations.
 * @param {object} value - The success value
 * @returns {object} Ok envelope
 */
function _backupOk_(value) {
  // Use Ok if available, otherwise create envelope directly
  if (typeof Ok === 'function') {
    return Ok(value);
  }
  return { ok: true, value: value };
}

/**
 * Creates an error envelope for backup operations.
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @param {object} [extra] - Additional error context
 * @returns {object} Err envelope
 */
function _backupErr_(code, message, extra = {}) {
  // Use Err if available, otherwise create envelope directly
  if (typeof Err === 'function') {
    const result = Err(code, message);
    if (extra.stack || extra.summary) {
      // Log but don't expose internals
      console.error(`Backup error [${code}]: ${message}`, extra);
    }
    return result;
  }
  return { ok: false, code: code, message: message };
}

// =============================================================================
// MANUAL BACKUP REMINDER (Documentation)
// =============================================================================

/**
 * MANUAL BACKUP PROCEDURE
 *
 * If scripted backups are not available or for additional safety:
 *
 * 1. Open the master spreadsheet
 * 2. File > Make a copy
 * 3. Name it: "MVP-EVENT-TOOLKIT-BACKUP-YYYY-MM-DD"
 * 4. Store in a "Backups" folder
 *
 * Recommended: Create a copy weekly before any major changes.
 *
 * To restore from a manual backup:
 * 1. Open the backup copy
 * 2. Copy the relevant sheet tabs to the production spreadsheet
 * 3. Or: Replace the entire spreadsheet and update Config.gs spreadsheetId
 */
